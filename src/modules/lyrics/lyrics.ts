/**
 * @fileoverview Main lyrics handling module for
 * Manages lyrics fetching, caching, processing, and rendering.
 */

import { SEEK_EVENT, TAB_HEADER_CLASS } from "@constants";
import { AppState, type PlayerDetails } from "@core/appState";
import { t } from "@core/i18n";
import { type LineData, type LyricsData, processLyrics } from "@modules/lyrics/injectLyrics";
import { stringSimilarity } from "@modules/lyrics/lyricParseUtils";
import { flushLoader, refreshDockSources, renderLoader } from "@modules/ui/dom";
import type { Lyric, LyricSourceResult, ProviderParameters, SourceMapType } from "./providers/shared";
import { getLyrics, newSourceMap, providerPriority } from "./providers/shared";
import type { YTLyricSourceResult } from "./providers/yt";
import { getSongAlbum, getSongMetadata, type SegmentMap } from "./requestSniffer/requestSniffer";
import { clearCache as clearTranslationCache } from "./translation";
import { mainView } from "@modules/ui/mainLyricsView";
import { resetPlaybackClock, resumeAllAutoscroll } from "@braccato/core";

export function seekPlayer(timeS: number): void {
  document.dispatchEvent(new CustomEvent(SEEK_EVENT, { detail: timeS }));
  resumeAllAutoscroll();
}

/** Plain/unsynced results carry no timing (every line starts at 0); only timed lyrics are shown. */
function isTimed(lyrics: Lyric[]): boolean {
  return lyrics.some(lyric => lyric.startTimeMs > 0);
}

function normalizeArtist(artist: string): string {
  return artist.trim().replace(", & ", ", ");
}

export type LyricSourceResultWithMeta = LyricSourceResult & {
  segmentMap: SegmentMap | null;
  providerKey?: string;
};

/**
 * What a view needs to build its own lyric DOM from scratch: the parsed lines, the language the
 * translation pass keys off, and the timing context. The attribution and dock
 * fields of {@link LyricSourceResultWithMeta} stay out; those are host chrome, not lyrics.
 */
export interface ParsedLyrics {
  lyrics: Lyric[];
  language?: string | null;
  musicVideoSynced?: boolean | null;
  segmentMap: SegmentMap | null;
}

/**
 * Holds onto the parsed lyrics after injection has consumed them, so a second view can build from
 * the same lines. Runs after {@link processLyrics} because injection calls cleanup(), which clears
 * this alongside the render records. That ordering is also why the floating window is told from
 * here rather than from injectLyrics: the lines it builds from do not exist until now.
 */
function retainParsedLyrics(data: LyricSourceResultWithMeta): void {
  if (!data.lyrics) return;

  AppState.parsedLyrics = {
    lyrics: data.lyrics,
    language: data.language,
    musicVideoSynced: data.musicVideoSynced,
    segmentMap: data.segmentMap,
  };
}

/**
 * How far a time recorded against the counterpart video moves when the same song is played back as
 * its other version. Pure, so a view that renders the lyrics somewhere other than the side panel can
 * shift a copy of them instead of the records the side panel is animating.
 *
 * @param segmentMap - Segment map pairing the two versions of the song
 * @param timeMs - Time on the counterpart video's timeline, in milliseconds
 * @returns The shift to add, in milliseconds
 */
export function getSegmentMapTimeShiftMs(segmentMap: SegmentMap, timeMs: number): number {
  let lastTimeChange = 0;
  for (let segment of segmentMap.segment) {
    if (timeMs >= segment.counterpartVideoStartTimeMilliseconds) {
      lastTimeChange = segment.primaryVideoStartTimeMilliseconds - segment.counterpartVideoStartTimeMilliseconds;
      if (timeMs <= segment.counterpartVideoStartTimeMilliseconds + segment.durationMilliseconds) {
        break;
      }
    }
  }
  return lastTimeChange;
}

export function applySegmentMapToLyrics(
  lyricData: LyricsData | null,
  lines: readonly LineData[],
  segmentMap: SegmentMap
) {
  if (segmentMap && lyricData) {
    lyricData.isMusicVideoSynced = !lyricData.isMusicVideoSynced;
    // We're sync lyrics using segment map
    const allZero = lyricData.syncType === "none";

    if (!allZero) {
      for (let lyric of lines) {
        lyric.accumulatedOffsetMs = 1000000; // Force resync by setting to a very large value

        let changeS = getSegmentMapTimeShiftMs(segmentMap, lyric.time * 1000) / 1000;
        lyric.time = lyric.time + changeS;
        lyric.lyricElement.dataset.time = String(lyric.time);
        lyric.parts.forEach(part => {
          part.time = part.time + changeS;
          part.lyricElement.dataset.time = String(part.time);
        });
      }
    }
  }
}

function recordAvailableProviders(sourceMap: SourceMapType): boolean {
  const collected = providerPriority.filter(key => {
    const result = sourceMap[key]?.lyricSourceResult;
    return !!result && "lyrics" in result && Array.isArray(result.lyrics) && isTimed(result.lyrics);
  });
  const known = new Set([...AppState.availableProviderKeys, ...collected]);
  const next = providerPriority.filter(key => known.has(key));
  const changed = next.length !== AppState.availableProviderKeys.length;
  AppState.availableProviderKeys = next;
  return changed;
}

async function completeSourceProbe(providerParameters: ProviderParameters, signal: AbortSignal): Promise<void> {
  try {
    for (const provider of providerPriority) {
      if (signal.aborted) return;
      if (providerParameters.sourceMap[provider].filled) continue;
      try {
        await getLyrics(providerParameters, provider);
      } catch {}
    }
  } catch {}
  if (signal.aborted) return;
  if (recordAvailableProviders(providerParameters.sourceMap)) {
    refreshDockSources();
  }
}

/**
 * Main function to create and inject lyrics for the current song.
 * Handles caching, API requests, and fallback mechanisms.
 *
 * @param detail - Song and player details
 * @param signal - signal to cancel injection
 */
export async function createLyrics(detail: PlayerDetails, signal: AbortSignal): Promise<void> {
  let song = detail.song;
  let artist = detail.artist;
  let videoId = detail.videoId;
  let duration = Number(detail.duration);
  const isMusicVideo = detail.contentRect.width !== 0 && detail.contentRect.height !== 0;

  if (!videoId) {
    return;
  }

  let shouldCleanupLoader = false;

  try {
    // We should get recalled if we were executed without a valid song/artist and aren't able to get lyrics

    let matchingSong = await getSongMetadata(videoId, 1, signal);
    let isAVSwitch =
      (matchingSong &&
        matchingSong.counterpartVideoId &&
        matchingSong.counterpartVideoId === AppState.lastLoadedVideoId) ||
      AppState.lastLoadedVideoId === videoId;

    let segmentMap = matchingSong?.segmentMap || null;

    const isSoftReload = AppState.lastLoadedVideoId === videoId && AppState.lyricData != null;

    if (isAVSwitch && segmentMap) {
      applySegmentMapToLyrics(AppState.lyricData, mainView.lines, segmentMap);
      AppState.suppressZeroTime = Date.now() + 5000;
      AppState.areLyricsTicking = true; // Keep lyrics ticking while new lyrics are fetched.
    } else if (isSoftReload) {
      // Same-song reload (provider switch or translation toggle): keep the
      // current lyrics on screen and swap them in once the new ones are ready, no loader.
      AppState.suppressZeroTime = Date.now() + 5000;
      AppState.areLyricsTicking = true;
    } else {
      renderLoader();
      shouldCleanupLoader = true;
      clearTranslationCache();
      matchingSong = await getSongMetadata(videoId, 250, signal);
      segmentMap = matchingSong?.segmentMap || null;
      AppState.areLyricsLoaded = false;
      AppState.areLyricsTicking = false;
      AppState.suppressZeroTime = 0;
      resetPlaybackClock();
    }

    if (matchingSong) {
      song = matchingSong.title;
      artist = matchingSong.artist || artist;

      if (isMusicVideo && matchingSong.counterpartVideoId && matchingSong.segmentMap) {
        videoId = matchingSong.counterpartVideoId;
      }
    }

    const tabSelector = document.getElementsByClassName(TAB_HEADER_CLASS)[1];
    if (tabSelector?.getAttribute("aria-selected") !== "true") {
      AppState.areLyricsLoaded = false;
      AppState.areLyricsTicking = false;
      AppState.lyricInjectionFailed = true;
      return;
    }

    song = song.trim();
    artist = normalizeArtist(artist);
    let album = await getSongAlbum(videoId, signal);
    if (!album) {
      album = "";
    }

    // Check for empty strings after trimming
    if (!song || !artist) {
      return;
    }

    if (signal.aborted) {
      return;
    }
    let lyrics: LyricSourceResult | null = null;
    let sourceMap = newSourceMap();

    let providerParameters: ProviderParameters = {
      song,
      artist,
      duration,
      videoId,
      album,
      sourceMap,
      signal,
    };
    // YouTube Music's own lyrics (from the passively observed page response) are only used as a
    // match check for other sources and as the last timed source; plain text is never shown.
    const ytLyricsPromise = getLyrics(providerParameters, "yt-lyrics");

    let selectedProvider: string | undefined;

    const pinnedProvider = AppState.manualProviderKey;
    const orderedProviders =
      pinnedProvider && providerPriority.includes(pinnedProvider)
        ? [pinnedProvider, ...providerPriority.filter(provider => provider !== pinnedProvider)]
        : providerPriority;

    for (let provider of orderedProviders) {
      if (signal.aborted) {
        return;
      }

      try {
        let sourceLyrics = await getLyrics(providerParameters, provider);

        if (sourceLyrics && sourceLyrics.lyrics && sourceLyrics.lyrics.length > 0) {
          if (!isTimed(sourceLyrics.lyrics)) {
            continue;
          }
          let ytLyrics = (await ytLyricsPromise) as YTLyricSourceResult;

          if (ytLyrics !== null) {
            let lyricText = "";
            sourceLyrics.lyrics.forEach(lyric => {
              lyricText += lyric.words + "\n";
            });

            let matchAmount = stringSimilarity(lyricText.toLowerCase(), ytLyrics.text.toLowerCase());
            if (matchAmount < 0.5) {
              continue;
            }
          }
          lyrics = sourceLyrics;
          selectedProvider = provider;
          break;
        }
      } catch {}
    }

    if (!lyrics) {
      lyrics = {
        lyrics: [
          {
            startTimeMs: 0,
            words: t("lyrics_notFound"),
            durationMs: 0,
          },
        ],
        source: "Unknown",
        musicVideoSynced: false,
        cacheAllowed: false,
      };
    }

    if (!lyrics.lyrics) {
      throw new Error("Lyrics.lyrics is null or undefined. Report this bug");
    }

    if (isMusicVideo === (lyrics.musicVideoSynced === true)) {
      segmentMap = null; // The timing matches, we don't need to apply a segment map!
    }

    let lyricsWithMeta: LyricSourceResultWithMeta = {
      segmentMap,
      providerKey: selectedProvider,
      ...lyrics,
    };

    recordAvailableProviders(sourceMap);

    AppState.lastLoadedVideoId = detail.videoId;
    if (signal.aborted) {
      return;
    }
    processLyrics(document, lyricsWithMeta, false, signal);
    retainParsedLyrics(lyricsWithMeta);
    shouldCleanupLoader = false;
    void completeSourceProbe(providerParameters, signal);
  } finally {
    if (shouldCleanupLoader) {
      flushLoader();
    }
  }
}
