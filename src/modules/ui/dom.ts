import {
  AD_PLAYING_ATTR,
  DOCK_CLASS,
  FOOTER_CLASS,
  LINE_CLASS,
  LYRICS_AD_OVERLAY_ID,
  LYRICS_CLASS,
  LYRICS_LOADER_ID,
  LYRICS_PAGE_TYPE,
  LYRICS_WRAPPER_ID,
  PLAYER_BAR_SELECTOR,
  PROVIDER_CONFIGS,
  TAB_RENDERER_SELECTOR,
  TRANSLATED_LYRICS_CLASS,
  WORD_HIGHLIGHT_CLASS,
} from "@constants";
import { AppState } from "@core/appState";
import { t } from "@core/i18n";
import type { LyricSourceKey } from "@modules/lyrics/providers/shared";
import { lyricsElementAdded, mainView } from "@modules/ui/mainLyricsView";
import { getResumeScrollElement } from "@modules/ui/resumeScrollButton";
import { reflow, toMs } from "@braccato/core/util";
import { buildControlsSegment, buildSourceSlot, closeSourceMenu } from "./lyricsDock/controls";
import { parseSvgString, syncTypeColors, syncTypeIcons } from "./lyricsDock/icons";
import { loadSavedOffset } from "./lyricsDock/offset";
import { scrollEventHandler } from "./observer";
import { restoreNativeLyricsFocus } from "./nativeLyricsFocus";

let adStateObserver: MutationObserver | null = null;
/**
 * Creates or reuses the lyrics wrapper element and sets up scroll event handling.
 *
 * @returns The lyrics wrapper element
 */
export function createLyricsWrapper(): HTMLElement {
  const tabRenderer = document.querySelector(TAB_RENDERER_SELECTOR) as HTMLElement;

  tabRenderer.removeEventListener("scroll", scrollEventHandler);
  tabRenderer.addEventListener("scroll", scrollEventHandler);

  const existingWrapper = document.getElementById(LYRICS_WRAPPER_ID);

  if (existingWrapper) {
    existingWrapper.dataset.extensionRoot = "true";
    existingWrapper.replaceChildren();
    return existingWrapper;
  }

  const wrapper = document.createElement("div");
  wrapper.id = LYRICS_WRAPPER_ID;
  wrapper.dataset.extensionRoot = "true";
  tabRenderer.appendChild(wrapper);

  wrapper.addEventListener("copy", (e: ClipboardEvent) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const fragment = range.cloneContents();

    fragment.querySelectorAll(`.${WORD_HIGHLIGHT_CLASS}`).forEach(el => el.remove());

    const lineElements = fragment.querySelectorAll(`.${LINE_CLASS}`);

    if (lineElements.length === 0) {
      const text = fragment.textContent?.replace(/\s+/g, " ").trim();
      if (text && e.clipboardData) {
        e.preventDefault();
        e.clipboardData.setData("text/plain", text);
      }
      return;
    }

    const lines: string[] = [];

    for (const line of lineElements) {
      const mainLine = Array.from(line.children).find(child => child.classList.contains("blyrics-line-main"));
      const mainText = mainLine?.textContent?.replace(/\s+/g, " ").trim();

      const translated = line.querySelector(`.${TRANSLATED_LYRICS_CLASS}`)?.textContent?.trim();

      const lineParts = [mainText, translated].filter(Boolean);
      if (lineParts.length > 0) lines.push(lineParts.join("\n"));
    }

    if (lines.length > 0) {
      e.preventDefault();
      e.clipboardData?.setData("text/plain", lines.join("\n"));
    }
  });

  return wrapper;
}

/**
 * Adds a plain-text footer naming the lyric source (no links or remote logos) to the lyrics
 * container, records the provider for the dock and mounts it.
 *
 * @param providerKey - Provider key for display name and sync type lookup
 */
export function addFooter(providerKey: LyricSourceKey): void {
  document.getElementsByClassName(FOOTER_CLASS)[0]?.remove();

  const lyricsElement = document.getElementsByClassName(LYRICS_CLASS)[0];
  const footer = document.createElement("div");
  footer.classList.add(FOOTER_CLASS);
  lyricsElement.appendChild(footer);
  observeFooterForRecalc(footer);

  const footerContainer = document.createElement("div");
  footerContainer.className = `${FOOTER_CLASS}__container`;
  footerContainer.appendChild(document.createTextNode(t("lyrics_source")));

  const footerSource = document.createElement("span");
  const info = PROVIDER_CONFIGS.find(config => config.key === providerKey);
  if (info) {
    footerSource.appendChild(document.createTextNode(info.displayName));
    const iconWrapper = document.createElement("span");
    iconWrapper.style.opacity = "0.5";
    iconWrapper.style.marginLeft = "6px";
    iconWrapper.style.display = "inline-flex";
    iconWrapper.style.verticalAlign = "middle";
    iconWrapper.style.color = syncTypeColors[info.syncType];
    const svgIcon = parseSvgString(syncTypeIcons[info.syncType]);
    if (svgIcon) {
      iconWrapper.appendChild(svgIcon);
    }
    footerSource.appendChild(iconWrapper);
  }
  footerContainer.appendChild(footerSource);
  footer.appendChild(footerContainer);

  AppState.currentProviderKey = providerKey;
  void loadSavedOffset(AppState.lastLoadedVideoId, providerKey);

  mountDock();

  updateNoLyricsSuppression();
}

type DockSuppressionReason = "ad" | "loading" | "noLyrics" | "notLyricsPage";
const dockSuppressionReasons = new Set<DockSuppressionReason>();

const DOCK_HOST_CLASS = "blyrics-has-dock";

let lyricsPageTypeObserver: MutationObserver | null = null;

function syncNotLyricsPageSuppression(tabRenderer: Element): void {
  setDockSuppression("notLyricsPage", tabRenderer.getAttribute("page-type") !== LYRICS_PAGE_TYPE);
}

export function observeLyricsPageType(): void {
  const tabRenderer = document.querySelector(TAB_RENDERER_SELECTOR);
  if (!tabRenderer) {
    setTimeout(observeLyricsPageType, 1000);
    return;
  }

  lyricsPageTypeObserver?.disconnect();
  syncNotLyricsPageSuppression(tabRenderer);
  lyricsPageTypeObserver = new MutationObserver(() => syncNotLyricsPageSuppression(tabRenderer));
  lyricsPageTypeObserver.observe(tabRenderer, { attributes: true, attributeFilter: ["page-type"] });
}

function updateNoLyricsSuppression(): void {
  const inner = document.getElementsByClassName(`${DOCK_CLASS}__inner`)[0];
  if (!inner) return;
  const controls = inner.querySelector(`.${DOCK_CLASS}__controls`);
  const hasControls = !!controls && controls.childElementCount > 0;
  setDockSuppression("noLyrics", !hasControls);
}

function applyDockSuppression(): void {
  const dock = document.getElementsByClassName(DOCK_CLASS)[0] as HTMLElement | undefined;
  if (!dock) return;
  dock.classList.toggle(`${DOCK_CLASS}--hidden`, dockSuppressionReasons.size > 0);
  dock.classList.toggle(`${DOCK_CLASS}--loading`, dockSuppressionReasons.has("loading"));
  dock.classList.toggle(`${DOCK_CLASS}--off-page`, dockSuppressionReasons.has("notLyricsPage"));
}

function setDockSuppression(reason: DockSuppressionReason, suppressed: boolean): void {
  const had = dockSuppressionReasons.has(reason);
  if (suppressed === had) return;
  if (suppressed) dockSuppressionReasons.add(reason);
  else dockSuppressionReasons.delete(reason);
  applyDockSuppression();
}

const DOCK_PROXIMITY = 104;
const DOCK_LEAVE_GRACE = 120;
let dockProximityAttached = false;
let dockProximityListener: ((event: MouseEvent) => void) | null = null;
let dockProximityRaf: number | null = null;
let dockLeaveTimer: ReturnType<typeof setTimeout> | null = null;
const DOCK_EXPANDED_CLASS = `${DOCK_CLASS}__inner--expanded`;

function setDockNear(inner: HTMLElement, near: boolean): void {
  if (near) {
    if (dockLeaveTimer) {
      clearTimeout(dockLeaveTimer);
      dockLeaveTimer = null;
    }
    inner.classList.add(DOCK_EXPANDED_CLASS);
  } else if (inner.classList.contains(DOCK_EXPANDED_CLASS) && !dockLeaveTimer) {
    dockLeaveTimer = setTimeout(() => {
      dockLeaveTimer = null;
      inner.classList.remove(DOCK_EXPANDED_CLASS);
    }, DOCK_LEAVE_GRACE);
  }
}

function evaluateDockProximity(event: MouseEvent): void {
  const inner = document.getElementsByClassName(`${DOCK_CLASS}__inner`)[0] as HTMLElement | undefined;
  if (!inner) return;

  const rect = inner.getBoundingClientRect();
  const dock = inner.parentElement as HTMLElement | null;
  const dockActive = rect.width > 0 && !dock?.classList.contains(`${DOCK_CLASS}--hidden`);

  if (!dockActive) return;

  // The dock is anchored bottom-right, so the trigger zone extends left and up into the panel.
  const left = rect.left - DOCK_PROXIMITY;
  const top = rect.top - DOCK_PROXIMITY;

  let dockNear =
    event.clientX >= left && event.clientX <= rect.right && event.clientY >= top && event.clientY <= rect.bottom;

  // While the source dropdown is open, treat its bounds (plus a bridging margin) as
  // part of the dock so moving onto it does not collapse the dock or drop the player bar.
  if (!dockNear) {
    const menu = document.querySelector(`.${DOCK_CLASS}__menu--open`);
    if (menu) {
      const m = menu.getBoundingClientRect();
      const pad = 32;
      dockNear =
        event.clientX >= m.left - pad &&
        event.clientX <= m.right + pad &&
        event.clientY >= m.top - pad &&
        event.clientY <= m.bottom + pad;
    }
  }

  setDockNear(inner, dockNear);
}

// Pre-expands the dock when the cursor comes near, so the controls have settled into
// their revealed positions before the pointer reaches them, and keeps the player bar
// shown while the cursor is near the dock. The trigger zone is extended only toward the
// panel interior (the approach side for the dock's anchor) and uses no overlay element,
// so it never shadows clicks on the lyrics or player. Being position-based rather than
// mouseenter/mouseleave, it stays stable while the cursor is held still during a click.
// Reads are coalesced to one per frame to bound the per-move layout/style cost.
function ensureDockProximityListener(): void {
  if (dockProximityAttached) return;
  dockProximityAttached = true;
  dockProximityListener = event => {
    if (dockProximityRaf !== null) cancelAnimationFrame(dockProximityRaf);
    dockProximityRaf = requestAnimationFrame(() => {
      dockProximityRaf = null;
      evaluateDockProximity(event);
    });
  };
  document.addEventListener("mousemove", dockProximityListener, { passive: true });
}

function removeDockProximityListener(): void {
  if (!dockProximityListener) return;
  document.removeEventListener("mousemove", dockProximityListener);
  dockProximityListener = null;
  dockProximityAttached = false;
  if (dockProximityRaf !== null) {
    cancelAnimationFrame(dockProximityRaf);
    dockProximityRaf = null;
  }
  if (dockLeaveTimer) {
    clearTimeout(dockLeaveTimer);
    dockLeaveTimer = null;
  }
}

// -- Dock entry/exit effect ----------------------------------------------
// The dock's shared reveal: scale, blur, and fade, the same values the dock uses to hide and
// reappear. Used for elements entering or leaving the dock, and for the control set swap (which
// also transitions width so the dock resizes smoothly between the two states).
const DOCK_FX_CLASS = `${DOCK_CLASS}__fx`;
const DOCK_FX_OUT_CLASS = `${DOCK_CLASS}__fx-out`;
const DOCK_FX_MS = 320;

// Reveals an element with the dock effect (scale up + sharpen + fade in).
function animateDockEnter(el: HTMLElement): void {
  el.classList.add(DOCK_FX_CLASS, DOCK_FX_OUT_CLASS);
  void el.offsetWidth;
  el.classList.remove(DOCK_FX_OUT_CLASS);
  setTimeout(() => el.classList.remove(DOCK_FX_CLASS), DOCK_FX_MS + 40);
}

let dockControlsSwapFinalize: (() => void) | null = null;

// Swaps the dock's control set: the outgoing set scales down, blurs, and fades, then the
// incoming set reveals while the dock's width eases from the old to the new size. Finalizable
// mid-flight so a rapid second change settles cleanly first.
function animateControlsSwap(oldControls: HTMLElement, newControls: HTMLElement): void {
  const widthFrom = oldControls.offsetWidth;
  let swapTimer: ReturnType<typeof setTimeout>;
  let doneTimer: ReturnType<typeof setTimeout>;

  function finalize(): void {
    clearTimeout(swapTimer);
    clearTimeout(doneTimer);
    if (oldControls.isConnected) oldControls.replaceWith(newControls);
    newControls.classList.remove(DOCK_FX_CLASS, DOCK_FX_OUT_CLASS);
    newControls.style.width = "";
    dockControlsSwapFinalize = null;
  }

  dockControlsSwapFinalize = finalize;

  oldControls.classList.add(DOCK_FX_CLASS);
  void oldControls.offsetWidth;
  oldControls.classList.add(DOCK_FX_OUT_CLASS);

  swapTimer = setTimeout(() => {
    if (!oldControls.isConnected) {
      finalize();
      return;
    }
    oldControls.replaceWith(newControls);
    const widthTo = newControls.offsetWidth;
    newControls.classList.add(DOCK_FX_CLASS, DOCK_FX_OUT_CLASS);
    newControls.style.width = `${widthFrom}px`;
    void newControls.offsetWidth;
    newControls.classList.remove(DOCK_FX_OUT_CLASS);
    newControls.style.width = `${widthTo}px`;
    doneTimer = setTimeout(finalize, DOCK_FX_MS + 40);
  }, DOCK_FX_MS);
}

// Mounts the dock if absent, otherwise refreshes its controls in place. The dock
// element persists across re-injections so the cursor's hover state (and the expanded
// reveal) is never lost during a provider switch or toggle.
function mountDock(): void {
  let dock = document.getElementsByClassName(DOCK_CLASS)[0] as HTMLElement | undefined;
  let inner: HTMLElement | null;

  if (dock) {
    inner = dock.querySelector(`.${DOCK_CLASS}__inner`);
    if (!inner) return;
  } else {
    const sidePanel = document.querySelector("#side-panel");
    if (!sidePanel) return;

    dock = document.createElement("div");
    dock.className = DOCK_CLASS;
    dock.dataset.extensionRoot = "true";

    inner = document.createElement("div");
    inner.className = `${DOCK_CLASS}__inner`;

    // Drop focus after activating a control, otherwise :focus-within keeps the dock
    // expanded once the cursor leaves and it never collapses.
    inner.addEventListener("click", event => {
      (event.target as HTMLElement).closest("button")?.blur();
    });

    ensureDockProximityListener();

    dock.appendChild(inner);
    sidePanel.appendChild(dock);
    sidePanel.classList.add(DOCK_HOST_CLASS);
  }

  closeSourceMenu();

  dockControlsSwapFinalize?.();

  const controls = buildControlsSegment();
  const existingControls = inner.querySelector(`.${DOCK_CLASS}__controls`) as HTMLElement | null;
  if (existingControls) {
    if (existingControls.dataset.shape !== controls.dataset.shape) {
      animateControlsSwap(existingControls, controls);
    } else {
      existingControls.replaceWith(controls);
    }
  } else {
    inner.prepend(controls);
    animateDockEnter(controls);
  }

  applyDockSuppression();
}

export function refreshDockSources(): void {
  if (!document.getElementsByClassName(DOCK_CLASS)[0]) return;

  const oldSlot = document.querySelector(`.${DOCK_CLASS}__source`) as HTMLElement | null;
  const newSlot = buildSourceSlot();
  if (!oldSlot || !newSlot) {
    mountDock();
    return;
  }

  closeSourceMenu();
  const widthFrom = oldSlot.offsetWidth;
  oldSlot.replaceWith(newSlot);
  const widthTo = newSlot.offsetWidth;
  newSlot.classList.add(DOCK_FX_CLASS, DOCK_FX_OUT_CLASS);
  newSlot.style.width = `${widthFrom}px`;
  void newSlot.offsetWidth;
  newSlot.classList.remove(DOCK_FX_OUT_CLASS);
  newSlot.style.width = `${widthTo}px`;
  setTimeout(() => {
    newSlot.classList.remove(DOCK_FX_CLASS);
    newSlot.style.width = "";
  }, DOCK_FX_MS + 40);
}

export function unmountDock(): void {
  dockControlsSwapFinalize?.();
  removeDockProximityListener();
  const dock = document.getElementsByClassName(DOCK_CLASS)[0];
  if (dock) dock.remove();
  document.querySelector("#side-panel")?.classList.remove(DOCK_HOST_CLASS);
}

type LoaderState = "full-loader" | "exiting" | "hidden";

function setLoaderState(state: LoaderState): void {
  document.getElementById(LYRICS_LOADER_ID)?.setAttribute("state", state);
}

/**
 * Renders and displays the loading spinner for lyrics fetching.
 */
export function renderLoader(): void {
  if (isAdPlaying()) {
    return;
  }
  closeSourceMenu();
  setDockSuppression("loading", true);
  cleanup();

  try {
    const tabRenderer = document.querySelector(TAB_RENDERER_SELECTOR) as HTMLElement;
    let loaderWrapper = document.getElementById(LYRICS_LOADER_ID);
    if (!loaderWrapper) {
      loaderWrapper = document.createElement("div");
      loaderWrapper.id = LYRICS_LOADER_ID;
      tabRenderer.prepend(loaderWrapper);
    }

    clearTimeout(AppState.loaderAnimationEndTimeout);

    // Reset state before applying new one to trigger animations correctly
    if (loaderWrapper.getAttribute("state") === "hidden" || loaderWrapper.hidden) {
      loaderWrapper.setAttribute("state", "hidden");
      reflow(loaderWrapper);
    }

    loaderWrapper.hidden = false;
    loaderWrapper.style.setProperty("--blyrics-loader-text", `"${t("lyrics_searching")}"`);
    setLoaderState("full-loader");
  } catch {}
}

/**
 * Removes the loading spinner with animation and cleanup. Flushes immediately so the lyrics
 * animate in while the loader animates out.
 */
export function flushLoader(): void {
  try {
    setDockSuppression("loading", false);
    const loaderWrapper = document.getElementById(LYRICS_LOADER_ID);
    if (!loaderWrapper) return;

    clearTimeout(AppState.loaderAnimationEndTimeout);
    setLoaderState("exiting");

    const duration = toMs(
      window.getComputedStyle(loaderWrapper).getPropertyValue("--blyrics-loader-transition-duration")
    );
    AppState.loaderAnimationEndTimeout = window.setTimeout(() => {
      setLoaderState("hidden");
      loaderWrapper.hidden = true;
    }, duration * 2); // Make longer than css duration
  } catch {}
}

/**
 * Checks if the loader is currently active or animating.
 *
 * @returns True if loader is active
 */
export function isLoaderActive(): boolean {
  try {
    const loaderWrapper = document.getElementById(LYRICS_LOADER_ID);
    if (loaderWrapper) {
      const state = loaderWrapper.getAttribute("state");
      return state !== "hidden" && state !== null;
    }
  } catch {}
  return false;
}

/**
 * Checks if an advertisement is currently playing.
 *
 * @returns True if an ad is playing
 */
export function isAdPlaying(): boolean {
  const playerBar = document.querySelector(PLAYER_BAR_SELECTOR);
  return playerBar?.hasAttribute(AD_PLAYING_ATTR) ?? false;
}

/**
 * Sets up a MutationObserver to watch for advertisement state changes.
 */
export function setupAdObserver(): void {
  const playerBar = document.querySelector(PLAYER_BAR_SELECTOR);
  const tabRenderer = document.querySelector(TAB_RENDERER_SELECTOR) as HTMLElement;

  if (!playerBar || !tabRenderer) {
    setTimeout(setupAdObserver, 1000);
    return;
  }

  if (adStateObserver) {
    adStateObserver.disconnect();
  }

  let adOverlay = document.getElementById(LYRICS_AD_OVERLAY_ID);
  if (!adOverlay) {
    adOverlay = document.createElement("div");
    adOverlay.id = LYRICS_AD_OVERLAY_ID;
    tabRenderer.prepend(adOverlay);
  }

  if (isAdPlaying()) {
    showAdOverlay();
  }

  adStateObserver = new MutationObserver(() => {
    if (isAdPlaying()) {
      showAdOverlay();
    } else {
      hideAdOverlay();
    }
  });

  adStateObserver.observe(playerBar, { attributes: true, attributeFilter: [AD_PLAYING_ATTR] });
}

/**
 * Shows the advertisement overlay on the lyrics panel.
 */
export function showAdOverlay(): void {
  const tabRenderer = document.querySelector(TAB_RENDERER_SELECTOR) as HTMLElement;
  if (!tabRenderer) {
    return;
  }

  let adOverlay = document.getElementById(LYRICS_AD_OVERLAY_ID);
  if (!adOverlay) {
    adOverlay = document.createElement("div");
    adOverlay.id = LYRICS_AD_OVERLAY_ID;
    tabRenderer.prepend(adOverlay);
  }

  adOverlay.setAttribute("active", "");
  setDockSuppression("ad", true);
}

/**
 * Hides the advertisement overlay from the lyrics panel.
 */
export function hideAdOverlay(): void {
  const adOverlay = document.getElementById(LYRICS_AD_OVERLAY_ID);
  if (adOverlay) {
    adOverlay.removeAttribute("active");
  }
  setDockSuppression("ad", false);
}

/**
 * Injects the extension stylesheet (local file only).
 */
export async function injectHeadTags(): Promise<void> {
  const file = "css/blyrics/index.css";
  const id = "blyrics-style-css/blyrics";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL(file);
  link.id = id;
  document.head.appendChild(link);
}

/**
 * Cleans up this elements and resets state when switching songs.
 */
export function cleanup(): void {
  mainView.clear();

  AppState.lyricData = null;

  restoreNativeLyricsFocus();

  document.getElementsByClassName(FOOTER_CLASS)[0]?.remove();

  // The dock persists across re-injections (updated in place by addFooter) so a
  // provider switch or toggle never tears it out of the DOM. It is removed only when
  // there are no lyrics (injectLyrics).
  getResumeScrollElement().setAttribute("autoscroll-hidden", "true");

  document.getElementById(LYRICS_WRAPPER_ID)?.replaceChildren();
}

let footerResize: ResizeObserver | null = null;

// Re-measures the lines and re-ticks whenever the footer's size changes.
function observeFooterForRecalc(footer: HTMLElement): void {
  footerResize?.disconnect();
  footerResize = new ResizeObserver(() => lyricsElementAdded());
  footerResize.observe(footer);
}
