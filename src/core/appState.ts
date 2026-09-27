import type { LyricDecorations, LyricsData } from "@modules/lyrics/injectLyrics";
import { createLyrics, type ParsedLyrics } from "@modules/lyrics/lyrics";
import type { LyricSourceKey } from "@modules/lyrics/providers/shared";
import { flushLoader } from "@modules/ui/dom";
import { clearSongCache } from "@core/storage";
import { logError } from "@core/logger";

export interface PlayerDetails {
  currentTime: number;
  videoId: string;
  song: string;
  artist: string;
  duration: string;
  audioTrackData: any;
  browserTime: number;
  isPlaying: boolean;
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
  parsedLyrics: ParsedLyrics | null;
  lyricDecorations: LyricDecorations;
  areLyricsLoaded: boolean;
  lyricInjectionFailed: boolean;
  lastVideoId: string | null;
  lastVideoDetails: any | null;
  lyricInjectionPromise: Promise<any> | null;
  queueLyricInjection: boolean;
  loaderAnimationEndTimeout: number | undefined;
  lastLoadedVideoId: string | null;
  lyricAbortController: AbortController | null;
  isTranslateEnabled: boolean;
  translationDisabledLanguages: string[];
  translationLanguage: string;
  isPassiveScrollEnabled: boolean;
  currentInjectionId: number;
  lyricOffset: number;
  globalLyricOffset: number;
  richsyncOffsetTrim: number;
  lineOffsetTrim: number;
  currentProviderKey: string | null;
  manualProviderKey: LyricSourceKey | null;
  availableProviderKeys: LyricSourceKey[];
}

export const AppState: AppStateType = {
  suppressZeroTime: 0,
  areLyricsTicking: false,
  lyricData: null,
  parsedLyrics: null,
  lyricDecorations: {},
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
  isPassiveScrollEnabled: true,
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
    // flushLoader(); // Flush loader immediately when aborting
    // Don't wait for old promise - start new song immediately
    // Old promise will complete eventually and its finally block will handle cleanup
  }

  AppState.currentInjectionId++;
  AppState.lyricAbortController = new AbortController();
  AppState.lyricInjectionPromise = createLyrics(detail, AppState.lyricAbortController.signal).catch(err => {
    logError(err);
    AppState.areLyricsLoaded = false;
    AppState.lyricInjectionFailed = true;
  });
}
