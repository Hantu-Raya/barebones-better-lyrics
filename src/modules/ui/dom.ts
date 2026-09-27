import {
  AD_PLAYING_ATTR,
  DISCORD_INVITE_URL,
  DISCORD_LOGO_SRC,
  DOCK_CLASS,
  FONT_LINK,
  FOOTER_CLASS,
  FOOTER_NOT_VISIBLE_LOG,
  GENIUS_LOGO_SRC,
  HIDDEN_CLASS,
  HOMEPAGE_DOMAIN,
  HOMEPAGE_ICON_URL,
  HOMEPAGE_URL,
  LINE_CLASS,
  LOADER_TRANSITION_ENDED,
  LYRICS_AD_OVERLAY_ID,
  LYRICS_CLASS,
  LYRICS_LOADER_ID,
  LYRICS_PAGE_TYPE,
  LYRICS_WRAPPER_CREATED_LOG,
  LYRICS_WRAPPER_ID,
  NO_LYRICS_TEXT_SELECTOR,
  NOTO_SANS_UNIVERSAL_LINK,
  PLAYER_BAR_SELECTOR,
  PROVIDER_CONFIGS,
  type SyncType,
  TAB_RENDERER_SELECTOR,
  TRANSLATED_LYRICS_CLASS,
  WORD_HIGHLIGHT_CLASS,
} from "@constants";
import { AppState } from "@core/appState";
import { t } from "@core/i18n";
import type { ThumbnailElement } from "@modules/lyrics/requestSniffer/NextResponse";
import { measureWidth, type ObserverHandle, observeLayoutWidth, observeResize } from "@modules/ui/layout/layoutWidth";
import { lyricsElementAdded, mainView } from "@modules/ui/mainLyricsView";
import {
  createFullscreenControls,
  type FullscreenControlsHandle,
  wrapSongInfoWithActions,
} from "@modules/ui/playerControls/fullscreenControls";
import { activateBylineLink, getBylineLinks, observeByline } from "@modules/ui/playerControls/playerBarControls";
import type { PlaybackSnapshot } from "@modules/ui/playerControls/playhead";
import { getResumeScrollElement } from "@modules/ui/resumeScrollButton";
import { reflow, toMs } from "@braccato/core/util";
import { buildControlsSegment, buildSourceSlot, closeSourceMenu } from "./lyricsDock/controls";
import { parseSvgString, syncTypeColors, syncTypeIcons } from "./lyricsDock/icons";
import { loadSavedOffset } from "./lyricsDock/offset";
import { scrollEventHandler } from "./observer";
import { logCore } from "@core/logger";

const providerDisplayInfo: Record<string, { name: string; syncType: SyncType }> = Object.fromEntries(
  PROVIDER_CONFIGS.map(p => [p.key, { name: p.displayName, syncType: p.syncType }])
);

interface ActionButtonOptions {
  text: string;
  href: string;
  logoSrc?: string;
  logoAlt?: string;
}

function createActionButton(options: ActionButtonOptions): HTMLElement {
  const { text, href, logoSrc, logoAlt } = options;

  const container = document.createElement("div");
  container.className = `${FOOTER_CLASS}__container`;

  if (logoSrc) {
    const img = document.createElement("img");
    img.src = logoSrc;
    img.alt = logoAlt ?? "";
    img.width = 20;
    img.height = 20;
    container.appendChild(img);
  }

  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.textContent = text;
  link.style.height = "100%";
  container.appendChild(link);

  return container;
}

let lyricsObserver: MutationObserver | null = null;
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

  logCore(LYRICS_WRAPPER_CREATED_LOG);
  return wrapper;
}

/**
 * Adds a footer with source attribution and action buttons to the lyrics container.
 *
 * @param source - Source name for attribution
 * @param sourceHref - URL for the source link
 * @param song - Song title
 * @param artist - Artist name
 * @param album - Album name
 * @param duration - Song duration in seconds
 * @param providerKey - Provider key for display name and sync type lookup
 */
export function addFooter(
  source: string,
  sourceHref: string,
  song: string,
  artist: string,
  album: string,
  duration: number,
  providerKey?: string,
  videoId?: string
): void {
  if (document.getElementsByClassName(FOOTER_CLASS).length !== 0) {
    document.getElementsByClassName(FOOTER_CLASS)[0].remove();
  }

  const lyricsElement = document.getElementsByClassName(LYRICS_CLASS)[0];
  const footer = document.createElement("div");
  footer.classList.add(FOOTER_CLASS);
  lyricsElement.appendChild(footer);
  observeFooterForRecalc(footer);
  createFooter(song, artist);

  const footerLink = document.getElementById("betterLyricsFooterLink") as HTMLAnchorElement;
  sourceHref = sourceHref || HOMEPAGE_URL;

  const info = providerKey ? providerDisplayInfo[providerKey] : null;

  footerLink.textContent = "";
  footerLink.href = sourceHref;

  if (info) {
    footerLink.appendChild(document.createTextNode(info.name));
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
    footerLink.appendChild(iconWrapper);
  } else {
    footerLink.textContent = source || HOMEPAGE_DOMAIN;
  }

  AppState.currentProviderKey = providerKey ?? null;
  void loadSavedOffset(AppState.lastLoadedVideoId, AppState.currentProviderKey);

  if (AppState.isControlsDockEnabled) {
    mountDock(AppState.controlsDockPosition);
  }

  updateNoLyricsSuppression();
}

let layoutAttrObserver: MutationObserver | null = null;
let dockHoverActive = false;

function ensureLayoutAttrObserver(): void {
  if (layoutAttrObserver) return;
  const layout = document.getElementById("layout");
  if (!layout) return;
  layoutAttrObserver = new MutationObserver(() => {
    if (!dockHoverActive) return;
    if (!layout.hasAttribute("player-fullscreened")) return;
    if (!layout.hasAttribute("show-fullscreen-controls")) {
      layout.setAttribute("show-fullscreen-controls", "");
    }
  });
  layoutAttrObserver.observe(layout, { attributes: true, attributeFilter: ["show-fullscreen-controls"] });
}

function disconnectLayoutAttrObserver(): void {
  layoutAttrObserver?.disconnect();
  layoutAttrObserver = null;
}

function showPlayerBarOnDockHover(): void {
  dockHoverActive = true;
  const layout = document.getElementById("layout");
  if (layout?.hasAttribute("player-fullscreened")) {
    layout.setAttribute("show-fullscreen-controls", "");
  }
}

function hidePlayerBarOnDockLeave(): void {
  dockHoverActive = false;
  document.getElementById("layout")?.removeAttribute("show-fullscreen-controls");
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

export function setFullscreenNoLyricsState(noLyrics: boolean): void {
  document.querySelector("#player-page")?.toggleAttribute("blyrics-no-lyrics", noLyrics);
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
const BOTTOM_REVEAL_ZONE = 100;
const PLAYER_BAR_HIDE_DELAY = 800;
let dockProximityAttached = false;
let dockProximityListener: ((event: MouseEvent) => void) | null = null;
let dockProximityRaf: number | null = null;
let dockLeaveTimer: ReturnType<typeof setTimeout> | null = null;
let playerBarHideTimer: ReturnType<typeof setTimeout> | null = null;
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

function setPlayerBarShown(shown: boolean): void {
  if (shown) {
    if (playerBarHideTimer) {
      clearTimeout(playerBarHideTimer);
      playerBarHideTimer = null;
    }
    showPlayerBarOnDockHover();
  } else if (dockHoverActive && !playerBarHideTimer) {
    playerBarHideTimer = setTimeout(() => {
      playerBarHideTimer = null;
      hidePlayerBarOnDockLeave();
    }, PLAYER_BAR_HIDE_DELAY);
  }
}

function isCursorNearBottom(event: MouseEvent): boolean {
  const layout = document.getElementById("layout");
  if (!layout?.hasAttribute("player-fullscreened")) return false;
  let threshold = window.innerHeight - BOTTOM_REVEAL_ZONE;
  if (layout.hasAttribute("show-fullscreen-controls")) {
    const bar = document.querySelector(PLAYER_BAR_SELECTOR)?.getBoundingClientRect();
    if (bar && bar.height > 0) threshold = Math.min(threshold, bar.top);
  }
  return event.clientY >= threshold;
}

function evaluateDockProximity(event: MouseEvent): void {
  const inner = document.getElementsByClassName(`${DOCK_CLASS}__inner`)[0] as HTMLElement | undefined;
  if (!inner) return;

  const barNear = isCursorNearBottom(event);
  const rect = inner.getBoundingClientRect();
  const dock = inner.parentElement as HTMLElement | null;
  const dockActive =
    rect.width > 0 &&
    !dock?.classList.contains(`${DOCK_CLASS}--hidden`) &&
    !dock?.classList.contains(`${DOCK_CLASS}--idle-hidden`);

  if (!dockActive) {
    setPlayerBarShown(barNear);
    return;
  }

  const position = dock?.dataset.position ?? "";
  let { left, right, top, bottom } = rect;
  if (position.includes("right")) left -= DOCK_PROXIMITY;
  if (position.includes("left")) right += DOCK_PROXIMITY;
  if (position.startsWith("top")) {
    bottom += DOCK_PROXIMITY;
  } else {
    top -= DOCK_PROXIMITY;
    // Activating a bottom dock translates it up by --dock-y-shift, which would carry this
    // zone off the cursor and oscillate. Extend the zone down to the dock's resting edge so
    // the shift can never eject the cursor. The live matrix stays exact mid-slide and follows
    // any themed shift value.
    const transform = dock ? getComputedStyle(dock).transform : "none";
    const shiftY = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
    bottom -= shiftY;
  }

  let dockNear = event.clientX >= left && event.clientX <= right && event.clientY >= top && event.clientY <= bottom;

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
  setPlayerBarShown(dockNear || barNear);
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
  if (playerBarHideTimer) {
    clearTimeout(playerBarHideTimer);
    playerBarHideTimer = null;
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
export function mountDock(position: string): void {
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

    ensureLayoutAttrObserver();
    ensureDockProximityListener();

    dock.appendChild(inner);
    sidePanel.appendChild(dock);
    sidePanel.classList.add(DOCK_HOST_CLASS);
  }

  dock.dataset.position = position;
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
  if (!AppState.isControlsDockEnabled) return;
  if (!document.getElementsByClassName(DOCK_CLASS)[0]) return;

  const oldSlot = document.querySelector(`.${DOCK_CLASS}__source`) as HTMLElement | null;
  const newSlot = buildSourceSlot();
  if (!oldSlot || !newSlot) {
    mountDock(AppState.controlsDockPosition);
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
  hidePlayerBarOnDockLeave();
  disconnectLayoutAttrObserver();
  removeDockProximityListener();
  const dock = document.getElementsByClassName(DOCK_CLASS)[0];
  if (dock) dock.remove();
  document.querySelector("#side-panel")?.classList.remove(DOCK_HOST_CLASS);
}

export function updateDockPosition(position: string): void {
  const dock = document.getElementsByClassName(DOCK_CLASS)[0] as HTMLElement | undefined;
  if (dock) dock.dataset.position = position;
}

/**
 * Creates the footer elements including source link, Discord link, and add lyrics button.
 *
 * @param song - Song title
 * @param artist - Artist name
 * @param album - Album name
 * @param duration - Song duration in seconds
 */
function createFooter(song: string, artist: string): void {
  try {
    const footer = document.getElementsByClassName(FOOTER_CLASS)[0] as HTMLElement;
    footer.replaceChildren();

    const footerContainer = document.createElement("div");
    footerContainer.className = `${FOOTER_CLASS}__container`;

    const footerImage = document.createElement("img");
    footerImage.src = HOMEPAGE_ICON_URL;
    footerImage.alt = "Better Lyrics Logo";
    footerImage.width = 20;
    footerImage.height = 20;

    footerContainer.appendChild(footerImage);
    footerContainer.appendChild(document.createTextNode(t("lyrics_source")));

    const footerLink = document.createElement("a");
    footerLink.target = "_blank";
    footerLink.id = "betterLyricsFooterLink";

    footerContainer.appendChild(footerLink);

    const discordImage = document.createElement("img");
    discordImage.src = DISCORD_LOGO_SRC;
    discordImage.alt = "Better Lyrics Discord";
    discordImage.width = 20;
    discordImage.height = 20;

    const discordLink = document.createElement("a");
    discordLink.className = `${FOOTER_CLASS}__discord`;
    discordLink.href = DISCORD_INVITE_URL;
    discordLink.target = "_blank";

    discordLink.appendChild(discordImage);

    footerLink.target = "_blank";

    const geniusContainer = createActionButton({
      text: t("lyrics_searchOnGenius"),
      href: getGeniusLink(song, artist),
      logoSrc: GENIUS_LOGO_SRC,
      logoAlt: "Genius",
    });

    footer.appendChild(footerContainer);
    footer.appendChild(geniusContainer);
    footer.appendChild(discordLink);

    footer.removeAttribute("is-empty");
  } catch (_err) {
    logCore(FOOTER_NOT_VISIBLE_LOG);
  }
}

let loaderStateTimeout: number | undefined;

type LoaderState = "full-loader" | "small-loader" | "showing-message" | "exiting" | "exiting-message" | "hidden";

function setLoaderState(state: LoaderState, text?: string): void {
  const loader = document.getElementById(LYRICS_LOADER_ID);
  if (!loader) return;

  loader.setAttribute("state", state);
  if (text !== undefined) {
    loader.style.setProperty("--blyrics-loader-text", `"${text}"`);
  }
}

/**
 * Renders and displays the loading spinner for lyrics fetching.
 */
export function renderLoader(small = false): void {
  if (isAdPlaying()) {
    return;
  }
  closeSourceMenu();
  setDockSuppression("loading", true);
  if (!small) {
    cleanup();
  }

  try {
    const tabRenderer = document.querySelector(TAB_RENDERER_SELECTOR) as HTMLElement;
    let loaderWrapper = document.getElementById(LYRICS_LOADER_ID);
    if (!loaderWrapper) {
      loaderWrapper = document.createElement("div");
      loaderWrapper.id = LYRICS_LOADER_ID;
      tabRenderer.prepend(loaderWrapper);
    }

    clearTimeout(loaderStateTimeout);
    clearTimeout(AppState.loaderAnimationEndTimeout);

    // Reset state before applying new one to trigger animations correctly
    if (loaderWrapper.getAttribute("state") === "hidden" || loaderWrapper.hidden) {
      loaderWrapper.setAttribute("state", "hidden");
      reflow(loaderWrapper);
    }

    loaderWrapper.hidden = false;

    if (small) {
      setLoaderState("small-loader", t("lyrics_stillSearching"));
    } else {
      setLoaderState("full-loader", t("lyrics_searching"));
    }
  } catch (err) {
    logCore(err);
  }
}

/**
 * Removes the loading spinner with animation and cleanup.
 */
export function flushLoader(showNoSyncAvailable = false): void {
  try {
    setDockSuppression("loading", false);
    const loaderWrapper = document.getElementById(LYRICS_LOADER_ID);
    if (!loaderWrapper) return;

    clearTimeout(loaderStateTimeout);
    clearTimeout(AppState.loaderAnimationEndTimeout);

    const performExit = (fromMessage = false) => {
      setLoaderState(fromMessage ? "exiting-message" : "exiting");

      const duration = toMs(
        window.getComputedStyle(loaderWrapper).getPropertyValue("--blyrics-loader-transition-duration")
      );
      AppState.loaderAnimationEndTimeout = window.setTimeout(() => {
        setLoaderState("hidden");
        loaderWrapper.hidden = true;
        logCore(LOADER_TRANSITION_ENDED);
      }, duration * 2); // Make longer than css duration
    };

    if (showNoSyncAvailable) {
      setLoaderState("showing-message", t("lyrics_noSyncedLyrics"));

      loaderStateTimeout = window.setTimeout(() => {
        performExit(true);
      }, 3000);
    } else {
      // Lyrics were found, flush immediately to allow lyrics to animate in
      // simultaneously with the loader animating out
      performExit(loaderWrapper.getAttribute("state") === "showing-message");
    }
  } catch (err) {
    logCore(err);
  }
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
  } catch (err) {
    logCore(err);
  }
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

  const loader = document.getElementById(LYRICS_LOADER_ID);
  if (loader) {
    loader.removeAttribute("active");
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
 * Clears all lyrics content from the wrapper element.
 */
function clearLyrics(): void {
  try {
    const lyricsWrapper = document.getElementById(LYRICS_WRAPPER_ID);
    if (lyricsWrapper) {
      lyricsWrapper.replaceChildren();
    }
  } catch (err) {
    logCore(err);
  }
}

let albumArtLoadController: AbortController | null = null;

export function reloadAlbumArt() {
  if (lastLoadedThumbnail) {
    addThumbnail(lastLoadedThumbnail);
  }
}

let lastLoadedThumbnail: ThumbnailElement | null = null;
let thumbnailWidth: ObserverHandle | null = null;

export function resetThumbnailState(): void {
  lastLoadedThumbnail = null;
}

function setBackgroundImage(src: string): void {
  const layout = document.getElementById("layout");
  if (AppState.shouldInjectAlbumArt) {
    layout?.style.setProperty("--blyrics-background-img", `url('${src}')`);
  } else {
    layout?.style.removeProperty("--blyrics-background-img");
  }
}

function containerSizeFor(width: number): number {
  return Math.round(Math.max(width, 544));
}

function getContainerSize(): number {
  return containerSizeFor(measureWidth(document.getElementById("thumbnail")) ?? 0);
}

function getHighResImageUrl(smallThumbnail: ThumbnailElement) {
  const containerSize = getContainerSize();
  let url = smallThumbnail.url;
  if (url && /w\d+-h\d+/.test(url)) {
    url = url.replace(/w\d+-h\d+/, `w${containerSize}-h${containerSize}`);
  } else {
    url = url.replace(/\/(sd|hq|mq)?default\.jpg/, "/maxresdefault.jpg");
  }
  return url;
}

export function addThumbnail(smallThumbnail: ThumbnailElement): void {
  thumbnailWidth?.destroy();

  let imgElm = document.getElementById("blyrics-img") as HTMLImageElement | undefined;
  if (!imgElm) {
    imgElm = document.createElement("img");
    imgElm.id = "blyrics-img";
    imgElm.draggable = false;
    imgElm.classList.add("style-scope", "yt-img-shadow");
    imgElm.style.position = "absolute";
    imgElm.style.inset = "0";
    document.getElementById("thumbnail")?.appendChild(imgElm);
  }

  const containerSize = getContainerSize();
  const url = getHighResImageUrl(smallThumbnail);

  albumArtLoadController?.abort();
  const loadController = new AbortController();
  albumArtLoadController = loadController;

  const proxy = new Image();
  proxy.src = url;

  const setHighResImage = () => {
    if (loadController.signal.aborted) return;

    imgElm.src = proxy.src;
    setBackgroundImage(proxy.src);

    if (getContainerSize() !== containerSize) {
      reloadAlbumArt();
      return;
    }

    thumbnailWidth = observeLayoutWidth(
      () => document.getElementById("thumbnail"),
      width => {
        if (width === null || containerSizeFor(width) === containerSize) return;
        thumbnailWidth?.destroy();
        thumbnailWidth = null;
        reloadAlbumArt();
      }
    );
  };

  if (proxy.complete) {
    lastLoadedThumbnail = smallThumbnail;
    setHighResImage();
  } else {
    if (lastLoadedThumbnail !== smallThumbnail) {
      imgElm.src = smallThumbnail.url;
      imgElm.classList.remove(HIDDEN_CLASS);
      setBackgroundImage(smallThumbnail.url);
    }

    lastLoadedThumbnail = smallThumbnail;

    proxy.onload = setHighResImage;
  }
}

export function preloadHighResThumbnail(smallThumbnail: ThumbnailElement) {
  const proxy = new Image();
  proxy.src = getHighResImageUrl(smallThumbnail);
}

export function showYtThumbnail(): void {
  const blyricsImg = document.getElementById("blyrics-img") as HTMLImageElement | null;
  if (blyricsImg) {
    blyricsImg.src = "";
    blyricsImg.classList.add(HIDDEN_CLASS);
  }

  const ytImg = document.querySelector("#thumbnail>#img") as HTMLImageElement | null;
  if (ytImg?.src && AppState.shouldInjectAlbumArt) {
    setBackgroundImage(ytImg.src);
  }
}

/**
 * Adds a button for users to contribute lyrics.
 *
 * @param song - Song title
 * @param artist - Artist name
 * @param album - Album name
 * @param duration - Song duration in seconds
 */
export function addNoLyricsButton(song: string, artist: string): void {
  const lyricsWrapper = document.getElementById(LYRICS_WRAPPER_ID);
  if (!lyricsWrapper) return;

  // No lyrics to control: the dock has nothing to offer here.
  unmountDock();

  const buttonContainer = document.createElement("div");
  buttonContainer.className = "blyrics-no-lyrics-button-container";

  const geniusSearch = createActionButton({
    text: t("lyrics_searchOnGenius"),
    href: getGeniusLink(song, artist),
    logoSrc: GENIUS_LOGO_SRC,
    logoAlt: "Genius",
  });

  buttonContainer.appendChild(geniusSearch);

  lyricsWrapper.appendChild(buttonContainer);
}

/**
 * Injects required head tags including font links and image preloads.
 */
export async function injectHeadTags(): Promise<void> {
  const imgURL = HOMEPAGE_ICON_URL;

  if (!document.head.querySelector(`link[rel="preload"][href="${imgURL}"]`)) {
    const imagePreload = document.createElement("link");
    imagePreload.rel = "preload";
    imagePreload.as = "image";
    imagePreload.href = imgURL;
    document.head.appendChild(imagePreload);
  }

  for (const href of [FONT_LINK, NOTO_SANS_UNIVERSAL_LINK]) {
    if (document.head.querySelector(`link[rel="stylesheet"][href="${href}"]`)) continue;
    const fontLink = document.createElement("link");
    fontLink.href = href;
    fontLink.rel = "stylesheet";
    document.head.appendChild(fontLink);
  }

  const cssFiles = ["css/ytmusic/index.css", "css/blyrics/index.css"];

  for (const file of cssFiles) {
    const id = `blyrics-style-${file.replace(/(\/index)?\.css$/, "")}`;
    if (document.getElementById(id)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL(file);
    link.id = id;
    document.head.appendChild(link);
  }
}

/**
 * Cleans up this elements and resets state when switching songs.
 */
export function cleanup(): void {
  // The side panel's view only, even though on Chromium the floating window's is in the same
  // registry: clearing it from here would go around its own renderer and leave the container it
  // built standing in the floating document. It drops the song off the publish this function ends
  // with instead.
  mainView.clear();
  setFullscreenNoLyricsState(false);

  if (lyricsObserver) {
    lyricsObserver.disconnect();
    lyricsObserver = null;
  }

  AppState.lyricData = null;
  AppState.parsedLyrics = null;
  AppState.lyricDecorations = {};

  const ytMusicLyrics = (document.querySelector(NO_LYRICS_TEXT_SELECTOR) as HTMLElement)?.parentElement;
  if (ytMusicLyrics) {
    ytMusicLyrics.style.display = "";
  }

  const blyricsFooter = document.getElementsByClassName(FOOTER_CLASS)[0];

  if (blyricsFooter) {
    blyricsFooter.remove();
  }

  // The dock persists across re-injections (updated in place by addFooter) so a
  // provider switch or toggle never tears it out of the DOM. It is removed only when
  // there are no lyrics (addNoLyricsButton) or the dock setting is disabled.
  getResumeScrollElement().setAttribute("autoscroll-hidden", "true");

  const buttonContainer = document.querySelector(".blyrics-no-lyrics-button-container");
  if (buttonContainer) {
    buttonContainer.remove();
  }

  clearLyrics();
}

/**
 * Injects song title and artist information used in fullscreen mode.
 *
 * @param title - Song title
 * @param artist - Artist name
 */
let fullscreenControls: FullscreenControlsHandle | null = null;
let fullscreenColumnWidth: ObserverHandle | null = null;

function setFullscreenControls(handle: FullscreenControlsHandle | null): void {
  if (fullscreenControls && fullscreenControls !== handle) fullscreenControls.destroy();
  fullscreenControls = handle;
}

export function updateFullscreenControlsSnapshot(snapshot: PlaybackSnapshot | null): void {
  fullscreenControls?.setSnapshot(snapshot);
}

function trackFullscreenColumnWidth(column: HTMLElement): void {
  fullscreenColumnWidth?.destroy();
  fullscreenColumnWidth = observeLayoutWidth(
    () => document.querySelector<HTMLElement>("#player.ytmusic-player-page"),
    width => {
      if (width === null) {
        column.style.removeProperty("width");
        return;
      }
      column.style.width = `${width}px`;
    }
  );
}

function songInfoLabel(text: string, href: string | null): Node {
  if (!href) return document.createTextNode(text);
  const link = document.createElement("a");
  link.className = "blyrics-song-link";
  link.href = href;
  link.textContent = text;
  link.addEventListener("click", event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (activateBylineLink(document, href)) event.preventDefault();
  });
  return link;
}

let lastSongInfo: { song: string; artist: string; album?: string } | null = null;
let bylineObserverDisconnect: (() => void) | null = null;

function populateArtistElement(artistElm: HTMLElement, artist: string, album?: string): void {
  const { artistRuns, albumHref } = getBylineLinks(document);
  artistElm.replaceChildren();
  if (artistRuns.length > 0) {
    for (const run of artistRuns) artistElm.appendChild(songInfoLabel(run.text, run.href));
  } else {
    artistElm.textContent = artist;
  }
  if (album) {
    const albumElm = document.createElement("span");
    albumElm.id = "blyrics-album";
    albumElm.append(" · ", songInfoLabel(album, albumHref));
    artistElm.appendChild(albumElm);
  }
}

function refreshSongInfoLinks(): void {
  const artistElm = document.getElementById("blyrics-artist");
  if (!artistElm || !lastSongInfo) return;
  if (document.getElementById("blyrics-title")?.textContent !== lastSongInfo.song) return;
  populateArtistElement(artistElm, lastSongInfo.artist, lastSongInfo.album);
}

export function injectSongAttributes(title: string, artist: string, album?: string): void {
  const mainPanel = document.getElementById("main-panel")!;
  console.assert(mainPanel != null);
  const existingColumn = document.getElementById("blyrics-fs-column");
  const existingSongInfo = document.getElementById("blyrics-song-info");
  const existingWatermark = document.getElementById("blyrics-watermark");

  existingColumn?.remove();
  existingSongInfo?.remove();
  existingWatermark?.remove();
  fullscreenColumnWidth?.destroy();
  setFullscreenControls(null);

  const titleElm = document.createElement("p");
  titleElm.id = "blyrics-title";
  titleElm.textContent = title;

  const artistElm = document.createElement("p");
  artistElm.id = "blyrics-artist";
  populateArtistElement(artistElm, artist, album);

  lastSongInfo = { song: title, artist, album };
  bylineObserverDisconnect?.();
  bylineObserverDisconnect = observeByline(document, refreshSongInfoLinks);

  const songInfoWrapper = document.createElement("div");
  songInfoWrapper.id = "blyrics-song-info";
  songInfoWrapper.appendChild(titleElm);
  songInfoWrapper.appendChild(artistElm);

  const row = wrapSongInfoWithActions(document, songInfoWrapper);
  row.id = "blyrics-fs-info-row";
  row.dir = "auto";

  const controls = createFullscreenControls(document);
  controls.element.id = "blyrics-fs-controls";

  const column = document.createElement("div");
  column.id = "blyrics-fs-column";
  column.append(row, controls.element);
  mainPanel.appendChild(column);
  trackFullscreenColumnWidth(column);
  setFullscreenControls(controls);
}

/**
 * Generates link to search on Genius
 *
 * @param song - Song name
 * @param artist - Artist name
 */
function getGeniusLink(song: string, artist: string): string {
  const query = encodeURIComponent(`!ducky site:genius.com ${artist.trim()} ${song.trim()}`);
  return `https://duckduckgo.com/?q=${query}`;
}

let footerResize: ObserverHandle | null = null;

function observeFooterForRecalc(footer: HTMLElement): void {
  footerResize?.destroy();
  footerResize = observeResize([footer], lyricsElementAdded);
}
