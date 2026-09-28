import { LYRICS_WRAPPER_ID, TAB_CONTENT_CLASS, TAB_HEADER_CLASS, TAB_RENDERER_SELECTOR } from "@constants";
import { AppState, handleModifications, type PlayerDetails, reloadLyrics } from "@core/appState";
import { adjustLyricOffset, OFFSET_STEP, OFFSET_STEP_LARGE } from "@modules/ui/lyricsDock/offset";
import { currentTickOptions, mainView } from "@modules/ui/mainLyricsView";
import { getResumeScrollElement } from "@modules/ui/resumeScrollButton";
import { cleanup, renderLoader } from "./dom";

// -- Observer Storage & Init Guards --------------------------
let lyricsTabObserver: MutationObserver | null = null;

let hasInitializedLyricReloader = false;
let hasInitializedAltHover = false;
let hasInitializedLyrics = false;
const ANIMATION_ENGINE_INTERVAL_MS = 20;
let animationFrameRequest: number | null = null;
let lastAnimationEngineRun = -Infinity;
let latestPlayerPlaying = false;
let latestPlayerTime = 0;
let latestPlayerSnapshotTime = 0;
let latestPlayerDuration = 0;
let latestPlaybackRate = 1;

function runAnimationEngine(now: number, force = false): void {
  if (!force && (!latestPlayerPlaying || now - lastAnimationEngineRun < ANIMATION_ENGINE_INTERVAL_MS)) return;

  lastAnimationEngineRun = now;
  const wallTime = Date.now();
  const elapsedS = latestPlayerPlaying
    ? (Math.max(0, wallTime - latestPlayerSnapshotTime) * latestPlaybackRate) / 1000
    : 0;
  const currentTime = Math.min(latestPlayerTime + elapsedS, latestPlayerDuration || Infinity);
  if (AppState.suppressZeroTime < wallTime || currentTime !== 0) {
    if (
      AppState.areLyricsTicking &&
      mainView.tick(currentTime, currentTickOptions(wallTime, latestPlayerPlaying)) === "lyrics-missing"
    ) {
      AppState.areLyricsTicking = false;
    }
  }
}

function animationFrameLoop(now: number): void {
  runAnimationEngine(now);
  animationFrameRequest = requestAnimationFrame(animationFrameLoop);
}

function startAnimationFrameLoop(): void {
  if (animationFrameRequest !== null) return;
  animationFrameRequest = requestAnimationFrame(animationFrameLoop);
}

/**
 * Enables the lyrics tab and prevents it from being disabled by YouTube Music.
 * Sets up a MutationObserver to watch for attribute changes.
 */
export function enableLyricsTab(): void {
  const tabSelector = document.getElementsByClassName(TAB_HEADER_CLASS)[1] as HTMLElement;
  if (!tabSelector) {
    setTimeout(() => {
      enableLyricsTab();
    }, 1000);
    return;
  }

  if (lyricsTabObserver) {
    lyricsTabObserver.disconnect();
  }

  tabSelector.removeAttribute("disabled");
  tabSelector.setAttribute("aria-disabled", "false");

  lyricsTabObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      if (mutation.attributeName === "disabled") {
        tabSelector.removeAttribute("disabled");
        tabSelector.setAttribute("aria-disabled", "false");
      }
    });
  });
  lyricsTabObserver.observe(tabSelector, { attributes: true });
}

let currentTab = 0;
let scrollPositions = [0, 0, 0];

/**
 * Sets up tab click handlers and manages scroll positions between tabs.
 * Handles lyrics reloading when the lyrics tab is clicked.
 */
export function lyricReloader(): void {
  if (hasInitializedLyricReloader) {
    return;
  }

  const tabs = document.getElementsByClassName(TAB_CONTENT_CLASS);

  const [tab1, tab2, tab3] = Array.from(tabs);

  if (tab1 !== undefined && tab2 !== undefined && tab3 !== undefined) {
    hasInitializedLyricReloader = true;

    for (let i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", () => {
        const tabRenderer = document.querySelector(TAB_RENDERER_SELECTOR) as HTMLElement;
        scrollPositions[currentTab] = tabRenderer.scrollTop;
        tabRenderer.scrollTop = scrollPositions[i];
        setTimeout(() => {
          tabRenderer.scrollTop = scrollPositions[i];
          // Don't start ticking until we set the height
          AppState.areLyricsTicking = AppState.areLyricsLoaded && i === 1;
        }, 0);
        currentTab = i;

        if (i !== 1) {
          // stop ticking immediately
          AppState.areLyricsTicking = false;
        }
      });
    }

    tab2.addEventListener("click", () => {
      getResumeScrollElement().classList.remove("blyrics-hidden");
      if (!AppState.areLyricsLoaded) {
        cleanup();
        renderLoader();
        reloadLyrics();
      }
    });

    const onNonLyricTabClick = () => {
      getResumeScrollElement().classList.add("blyrics-hidden");
    };

    tab1.addEventListener("click", onNonLyricTabClick);
    tab3.addEventListener("click", onNonLyricTabClick);
  } else {
    setTimeout(() => lyricReloader(), 1000);
  }
}

/**
 * Initializes the main player time event listener.
 * Handles video changes, lyric injection, and player state updates.
 */
export function initializeLyrics(): void {
  if (hasInitializedLyrics) {
    return;
  }
  hasInitializedLyrics = true;

  document.addEventListener("visibilitychange", () => {
    mainView.noteVisibilityChange();
    if (document.visibilityState === "visible") {
      runAnimationEngine(performance.now(), true);
    }
  });

  startAnimationFrameLoop();

  // @ts-ignore
  document.addEventListener("blyrics-send-player-time", (event: CustomEvent<PlayerDetails>) => {
    const detail = event.detail;
    latestPlayerPlaying = detail.playing;
    latestPlayerTime = detail.currentTime;
    latestPlayerSnapshotTime = detail.browserTime;
    latestPlayerDuration = Number(detail.duration);
    latestPlaybackRate = detail.playbackRate ?? 1;

    const currentVideoId = detail.videoId;
    const currentVideoDetails = detail.song + " " + detail.artist;

    if (currentVideoId !== AppState.lastVideoId || currentVideoDetails !== AppState.lastVideoDetails) {
      AppState.areLyricsTicking = false;
      AppState.lastVideoId = currentVideoId;
      AppState.lastVideoDetails = currentVideoDetails;
      if (!detail.song || !detail.artist) {
        return;
      }

      AppState.queueLyricInjection = true;
    }

    if (AppState.lyricInjectionFailed) {
      const tabSelector = document.getElementsByClassName(TAB_HEADER_CLASS)[1];
      if (tabSelector && tabSelector.getAttribute("aria-selected") !== "true") {
        return; // wait to resolve until tab is visible
      }
    }

    if (AppState.queueLyricInjection || AppState.lyricInjectionFailed) {
      const tabSelector = document.getElementsByClassName(TAB_HEADER_CLASS)[1] as HTMLElement;
      if (tabSelector) {
        AppState.queueLyricInjection = false;
        AppState.lyricInjectionFailed = false;
        handleModifications(detail);
      }
    }

    // The only path that ticks while playback is paused, so it is what lands a pause on the running
    // word animations.
    if (document.visibilityState === "visible") {
      runAnimationEngine(performance.now(), true);
    }
  });
}

/**
 * Handles scroll events on the tab renderer.
 * Manages autoscroll pause/resume functionality.
 */
export function scrollEventHandler(): void {
  const tabSelector = AppState.lyricData?.tabSelector;
  if (!tabSelector || tabSelector.getAttribute("aria-selected") !== "true" || !AppState.areLyricsTicking) {
    return;
  }

  mainView.noteUserScroll();
}

export function setupAltHoverHandler(): void {
  if (hasInitializedAltHover) {
    return;
  }
  hasInitializedAltHover = true;

  const updateAltState = (isAltPressed: boolean) => {
    const lyricsWrapper = document.getElementById(LYRICS_WRAPPER_ID);
    if (!lyricsWrapper) return;

    if (isAltPressed) {
      lyricsWrapper.setAttribute("blyrics-alt-hover", "");
    } else {
      lyricsWrapper.removeAttribute("blyrics-alt-hover");
    }
  };

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Alt") {
      updateAltState(true);
    }

    if (e.altKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
      const tabSelector = document.getElementsByClassName(TAB_HEADER_CLASS)[1];
      if (tabSelector?.getAttribute("aria-selected") === "true") {
        const step = e.shiftKey ? OFFSET_STEP_LARGE : OFFSET_STEP;
        adjustLyricOffset(e.code === "BracketLeft" ? -step : step);
        e.preventDefault();
      }
    }
  });

  document.addEventListener("keyup", (e: KeyboardEvent) => {
    if (e.key === "Alt") {
      updateAltState(false);
    }
  });

  window.addEventListener("blur", () => {
    updateAltState(false);
  });
}
