import {
  LYRICS_CACHE_TTL_MS,
  LYRICS_NEGATIVE_CACHE_TTL_MS,
  PROVIDER_CONFIGS,
} from "@constants";
import { getTransientStorage, setTransientStorage } from "@core/storage";
import betterLyricsApi from "./betterLyricsApi";
import lrclib from "./lrclib";
import ytLyrics, { type YTLyricSourceResult } from "./yt";
import { logCore } from "@core/logger";
/** Current version of the lyrics cache format */
const LYRIC_CACHE_VERSION = "2.1.0";

interface LyricSource {
  filled: boolean;
  resultCached: boolean;
  lyricSourceResult: LyricSourceResult | YTLyricSourceResult | null;
  lyricSourceFiller: (providerParameters: ProviderParameters) => Promise<void>;
}

export interface LyricSourceResult {
  lyrics: Lyric[] | null;
  language?: string | null;
  source: string;
  musicVideoSynced?: boolean | null;
  cacheAllowed?: boolean;
}

export type LyricsArray = Lyric[];

export interface Lyric {
  startTimeMs: number;
  words: string;
  durationMs: number;
  key?: string;
  parts?: LyricPart[];
  agent?: string;
  translations?: { [lang: string]: string };
  translation?: { text: string; lang: string }; // old property
  isInstrumental?: boolean;
}

export interface LyricPart {
  startTimeMs: number;
  words: string;
  durationMs: number;
  isBackground?: boolean;
  explicit?: boolean;
}

export interface ProviderParameters {
  song: string;
  artist: string;
  duration: number;
  videoId: string;
  album: string | null;
  sourceMap: SourceMapType;
  signal: AbortSignal;
}

export type SourceMapType = {
  [key in LyricSourceKey]: LyricSource;
};

/** Fixed source order: Better Lyrics API, then LRCLIB, then YouTube Music's own lyrics. */
export const providerPriority: readonly LyricSourceKey[] = [...PROVIDER_CONFIGS]
  .sort((a, b) => a.priority - b.priority)
  .map(p => p.key as LyricSourceKey);

// Source #1 fills both Better Lyrics keys from one response; source #2 is LRCLIB; the last is
// YouTube Music's own lyrics, which only count when timed (see lyrics.ts).
const sourceKeyToFillFn = {
  "bLyrics-richsynced": betterLyricsApi,
  "bLyrics-synced": betterLyricsApi,
  "lrclib-synced": lrclib,
  "yt-lyrics": ytLyrics,
} as const;

export type LyricSourceKey = Readonly<keyof typeof sourceKeyToFillFn>;

export function newSourceMap(): SourceMapType {
  function mapValues<T extends object, U>(obj: T, fn: (value: T[keyof T], key: keyof T) => U): { [K in keyof T]: U } {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, fn(value as T[keyof T], key as keyof T)])
    ) as { [K in keyof T]: U };
  }

  return mapValues(sourceKeyToFillFn, filler => ({
    filled: false,
    lyricSourceResult: null,
    resultCached: false,
    lyricSourceFiller: filler,
  }));
}

export async function saveLyricsToCache(providerParameters: ProviderParameters, provider: LyricSourceKey) {
  let source = providerParameters.sourceMap[provider];
  if (source.filled && !source.resultCached && !source.lyricSourceResult) {
    source.resultCached = true;
    const cacheKey = `blyrics_${providerParameters.videoId}_${provider}`;
    await setTransientStorage(
      cacheKey,
      JSON.stringify({ version: LYRIC_CACHE_VERSION, missing: true }),
      LYRICS_NEGATIVE_CACHE_TTL_MS
    );
    return;
  }

  if (
    source.filled &&
    !source.resultCached &&
    source.lyricSourceResult &&
    source.lyricSourceResult.cacheAllowed !== false
  ) {
    source.resultCached = true;
    const cacheKey = `blyrics_${providerParameters.videoId}_${provider}`;
    let versionedData = {
      version: LYRIC_CACHE_VERSION,
      ...source.lyricSourceResult,
    };
    await setTransientStorage(cacheKey, JSON.stringify(versionedData), LYRICS_CACHE_TTL_MS);
  }
}

/**
 * @param providerParameters
 * @param sourceName
 */
export async function getLyrics(
  providerParameters: ProviderParameters,
  sourceName: LyricSourceKey
): Promise<LyricSourceResult | null> {
  let lyricSource = providerParameters.sourceMap[sourceName];
  if (!lyricSource.filled) {
    // Check cache first
    const cacheKey = `blyrics_${providerParameters.videoId}_${sourceName}`;
    const cachedData = await getTransientStorage(cacheKey);
    if (cachedData) {
      const data = JSON.parse(cachedData);
      if (data && data.version && data.version === LYRIC_CACHE_VERSION) {
        lyricSource.filled = true;
        lyricSource.resultCached = true;
        if (data.missing === true) {
          lyricSource.lyricSourceResult = null;
          return null;
        }
        lyricSource.lyricSourceResult = data;
        return data;
      }
    }

    await lyricSource.lyricSourceFiller(providerParameters);
  }

  // Save result to cache for each provider
  await Promise.allSettled(
    providerPriority.map(async provider => {
      await saveLyricsToCache(providerParameters, provider);
    })
  );

  return lyricSource.lyricSourceResult;
}

const DEFAULT_RETRY_AFTER_MS = 60_000;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;

/**
 * Converts a Retry-After header (delta-seconds or HTTP-date) into a local backoff in milliseconds.
 * Missing or unreadable values fall back to one minute; the result is capped at one hour.
 */
export function parseRetryAfterMs(header: string | null): number {
  let ms = DEFAULT_RETRY_AFTER_MS;
  if (header) {
    const trimmed = header.trim();
    if (/^\d+$/.test(trimmed)) {
      ms = Number(trimmed) * 1000;
    } else {
      const date = Date.parse(trimmed);
      if (!Number.isNaN(date)) ms = Math.max(0, date - Date.now());
    }
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}
