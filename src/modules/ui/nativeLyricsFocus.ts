import { logCore } from "@core/logger";

const NATIVE_LYRICS_SHELF_SELECTOR = "#tab-renderer ytmusic-description-shelf-renderer";
const NATIVE_LYRICS_HEADER_SELECTOR =
  "#tab-renderer ytmusic-description-shelf-renderer yt-formatted-string.header.ytmusic-description-shelf-renderer";

let observer: MutationObserver | null = null;
let applyScheduled = false;
let active = false;

// YouTube's own lyrics shelf is taken out of focus and the accessibility tree only while the fork's
// lyrics replace it; each change is recorded so restoreNativeLyricsFocus() can put it back.
const hiddenShelves = new Set<HTMLElement>();
const strippedTabIndex = new Map<HTMLElement, string>();

function applyNativeLyricsFocusDisabled(): void {
  applyScheduled = false;
  if (!active) return;

  const shelves = document.querySelectorAll<HTMLElement>(NATIVE_LYRICS_SHELF_SELECTOR);
  for (const shelf of shelves) {
    hiddenShelves.add(shelf);
    if (!shelf.hasAttribute("inert")) {
      shelf.setAttribute("inert", "");
    }
    if (shelf.getAttribute("aria-hidden") !== "true") {
      shelf.setAttribute("aria-hidden", "true");
    }
  }

  const headers = document.querySelectorAll<HTMLElement>(NATIVE_LYRICS_HEADER_SELECTOR);
  for (const header of headers) {
    if (header.hasAttribute("tabindex")) {
      strippedTabIndex.set(header, header.getAttribute("tabindex")!);
      header.removeAttribute("tabindex");
    }
  }
}

function scheduleApply(): void {
  if (applyScheduled) {
    return;
  }

  applyScheduled = true;
  requestAnimationFrame(applyNativeLyricsFocusDisabled);
}

function shouldHandleMutation(mutation: MutationRecord): boolean {
  if (!(mutation.target instanceof Element)) {
    return true;
  }

  return !mutation.target.closest("#blyrics-wrapper, #blyrics-loader, #blyrics-ad-overlay");
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!mutations.some(shouldHandleMutation)) {
    return;
  }

  logCore("Native lyrics focus observer fired", { mutationCount: mutations.length });
  scheduleApply();
}

export function disableNativeLyricsFocus(): void {
  active = true;
  applyNativeLyricsFocusDisabled();

  if (observer) {
    return;
  }

  const tabRenderer = document.getElementById("tab-renderer");
  if (!tabRenderer) {
    return;
  }

  observer = new MutationObserver(handleMutations);
  observer.observe(tabRenderer, {
    attributeFilter: ["aria-hidden", "inert", "tabindex"],
    attributes: true,
    childList: true,
    subtree: true,
  });
}

/**
 * Undoes disableNativeLyricsFocus(): called whenever the fork's lyrics leave the tab.
 */
export function restoreNativeLyricsFocus(): void {
  active = false;
  observer?.disconnect();
  observer = null;
  applyScheduled = false;

  for (const shelf of hiddenShelves) {
    shelf.removeAttribute("inert");
    shelf.removeAttribute("aria-hidden");
  }
  hiddenShelves.clear();

  for (const [header, tabIndex] of strippedTabIndex) {
    if (!header.hasAttribute("tabindex")) header.setAttribute("tabindex", tabIndex);
  }
  strippedTabIndex.clear();
}
