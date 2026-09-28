import type { LyricsData } from "@modules/lyrics/injectLyrics";
import { createLyrics } from "@modules/lyrics/lyrics";
import type { LyricSourceKey } from "@modules/lyrics/providers/shared";
import { clearSongCache } from "@core/storage";

export interface PlayerDetails {
  currentTime: number;
  videoId: string;
  song: string;
  artist: string;
  duration: string;
  browserTime: number;
  playing: boolean;
  playbackRate?: number;
  contentRect: {
    width: number;
    height: number;
  };
}

interface AppStateType {
  suppressZeroTime: number;
  areLyricsTicking: boolean;
  lyricData: LyricsData | null;
  areLyricsLoaded: boolean;
  lyricInjectionFailed: boolean;
  lastVideoId: string | null;
  lastVideoDetails: string | null;
  lyricInjectionPromise: Promise<any> | null;
  queueLyricInjection: boolean;
  loaderAnimationEndTimeout: number | undefined;
  lastLoadedVideoId: string | null;
  lyricAbortController: AbortController | null;
  isTranslateEnabled: boolean;
  translationDisabledLanguages: string[];
  translationLanguage: string;
  currentInjectionId: number;
  lyricOffset: number;
  globalLyricOffset: number;
  richsyncOffsetTrim: number;
  lineOffsetTrim: number;
  currentProviderKey: LyricSourceKey | null;
  manualProviderKey: LyricSourceKey | null;
  availableProviderKeys: LyricSourceKey[];
}

export const AppState: AppStateType = {
  suppressZeroTime: 0,
  areLyricsTicking: false,
  lyricData: null,
  areLyricsLoaded: false,
  lyricInjectionFailed: false,
  lastVideoId: null,
  lastVideoDetails: null,
  lyricInjectionPromise: null,
  queueLyricInjection: false,
  loaderAnimationEndTimeout: undefined,
  lastLoadedVideoId: null,
  lyricAbortController: null,
  isTranslateEnabled: false,
  translationDisabledLanguages: [],
  translationLanguage: "en",
  currentInjectionId: 0,
  lyricOffset: 0,
  globalLyricOffset: 0,
  richsyncOffsetTrim: 0,
  lineOffsetTrim: 0,
  currentProviderKey: null,
  manualProviderKey: null,
  availableProviderKeys: [],
};

export function reloadLyrics(): void {
  AppState.lyricAbortController?.abort("Reloading lyrics");
  AppState.lastVideoId = null;
}

export async function refreshCurrentSong(): Promise<void> {
  const videoId = AppState.lastLoadedVideoId;
  AppState.availableProviderKeys = [];
  if (videoId) {
    await clearSongCache(videoId);
  }
  reloadLyrics();
}

export function handleModifications(detail: PlayerDetails): void {
  if (detail.videoId !== AppState.lastLoadedVideoId) {
    AppState.lyricOffset = 0;
    AppState.manualProviderKey = null;
    AppState.availableProviderKeys = [];
  }

  if (AppState.lyricInjectionPromise) {
    AppState.lyricAbortController?.abort("New song is being loaded");
    // Don't wait for old promise - start new song immediately
    // Old promise will complete eventually and its finally block will handle cleanup
  }

  AppState.currentInjectionId++;
  AppState.lyricAbortController = new AbortController();
  AppState.lyricInjectionPromise = createLyrics(detail, AppState.lyricAbortController.signal).catch(() => {
    AppState.areLyricsLoaded = false;
    AppState.lyricInjectionFailed = true;
  });
}
