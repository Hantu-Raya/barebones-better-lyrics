import { LYRIC_SOURCE_KEYS, OFFSET_STORAGE_PREFIX, STORAGE_TRANSIENT_SET_LOG } from "@constants";
import { compressString, decompressString, isCompressed } from "./compression";
import { logCore, logError } from "@core/logger";

/**
 * Keys that should NEVER be deleted by clearCache or any bulk delete operation.
 * These keys contain critical user data that must persist across cache clears.
 */
export const PROTECTED_STORAGE_KEYS = [
  "userIdentity",
  "identityRegistered",
  "userThemeRatings",
  "keyCertificate",
] as const;

/**
 * Typed wrapper for chrome.storage.local.get that casts results to expected type.
 */
export async function getLocalStorage<T>(keys: string | string[] | null): Promise<T> {
  return (await chrome.storage.local.get(keys as string[])) as unknown as T;
}

/**
 * Typed wrapper for chrome.storage.sync.get that casts results to expected type.
 */
export async function getSyncStorage<T>(keys: string | string[] | null): Promise<T> {
  return (await chrome.storage.sync.get(keys as string[])) as unknown as T;
}

interface TransientStorageItem {
  type: "transient";
  value: any;
  expiry: number;
}

/**
 * Cross-browser storage getter that works with both Chrome and Firefox.
 *
 * @param {Object|string} key - Storage key or object with default values
 * @param {Function} callback - Callback function to handle the retrieved data
 */
export function getStorage(
  key: string | string[] | { [key: string]: any },
  callback: (items: { [key: string]: any }) => void
): void {
  chrome.storage.sync.get(key, callback);
}

/**
 * Cross-browser storage setter that works with both Chrome and Firefox.
 *
 * @param {Object} items - Key/value pairs to persist
 */
export function setStorage(items: { [key: string]: any }): void {
  chrome.storage.sync.set(items);
}

export async function peekTransientStorage(key: string): Promise<{ value: any; expired: boolean } | null> {
  try {
    const result = await chrome.storage.local.get(key);
    const item = result[key] as TransientStorageItem | undefined;

    if (!item) return null;

    const { value, expiry } = item;
    const decoded = typeof value === "string" && isCompressed(value) ? decompressString(value) : value;

    return { value: decoded, expired: Boolean(expiry && Date.now() > expiry) };
  } catch (error) {
    logError(error);
    return null;
  }
}

export async function getTransientStorage(key: string): Promise<any | null> {
  const item = await peekTransientStorage(key);

  if (!item) return null;

  if (item.expired) {
    try {
      await chrome.storage.local.remove(key);
    } catch (error) {
      logError(error);
    }
    return null;
  }

  return item.value;
}

/**
 * Stores a value in transient storage with automatic expiry.
 * Automatically compresses string values to save storage space.
 *
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 * @param {number} ttl - Time to live in milliseconds
 */
export async function setTransientStorage(key: string, value: any, ttl: number): Promise<void> {
  try {
    const expiry = Date.now() + ttl;
    const storedValue = typeof value === "string" ? compressString(value) : value;

    await chrome.storage.local.set({
      [key]: {
        type: "transient",
        value: storedValue,
        expiry,
      },
    });
    logCore(STORAGE_TRANSIENT_SET_LOG, key);
    await saveCacheInfo();
  } catch (error) {
    logError(error);
  }
}

/**
 * Stores a value in local storage with no expiry, so it survives cache purges.
 * Used for durable per-song data such as saved lyric offsets.
 *
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 */
export async function setPersistentStorage(key: string, value: any): Promise<void> {
  try {
    const storedValue = typeof value === "string" ? compressString(value) : value;
    await chrome.storage.local.set({
      [key]: { type: "transient", value: storedValue, expiry: 0 },
    });
  } catch (error) {
    logError(error);
  }
}

function extractVideoIdFromCacheKey(key: string): string | null {
  const withoutPrefix = key.slice("blyrics_".length);
  for (const sourceKey of LYRIC_SOURCE_KEYS) {
    const suffix = `_${sourceKey}`;
    if (withoutPrefix.endsWith(suffix)) {
      return withoutPrefix.slice(0, -suffix.length);
    }
  }
  return null;
}

/**
 * Calculates current cache information including count and size of stored lyrics.
 * Count represents unique songs (by video ID), not individual cache entries.
 *
 * @returns {Promise<{count: number, size: number}>} Cache statistics
 */
async function getUpdatedCacheInfo(): Promise<{ count: number; size: number }> {
  try {
    const result = await chrome.storage.local.get(null);
    const lyricsKeys = Object.keys(result).filter(key => key.startsWith("blyrics_"));

    const uniqueVideoIds = new Set<string>();
    for (const key of lyricsKeys) {
      const videoId = extractVideoIdFromCacheKey(key);
      if (videoId) {
        uniqueVideoIds.add(videoId);
      }
    }

    const totalSize = lyricsKeys.reduce((acc, key) => {
      const item = result[key];
      return acc + JSON.stringify(item).length;
    }, 0);

    return {
      count: uniqueVideoIds.size,
      size: totalSize,
    };
  } catch (error) {
    logError(error);
    return { count: 0, size: 0 };
  }
}

/**
 * Updates and saves current cache information to sync storage.
 */
export async function saveCacheInfo(): Promise<void> {
  const cacheInfo = await getUpdatedCacheInfo();
  await chrome.storage.sync.set({ cacheInfo: cacheInfo });
}

/**
 * Clears all cached lyrics data from local storage.
 * Only removes keys with "blyrics_" prefix and explicitly excludes PROTECTED_STORAGE_KEYS.
 */
export async function clearCache(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(null);
    const lyricsKeys = Object.keys(result).filter(
      key =>
        key.startsWith("blyrics_") && !PROTECTED_STORAGE_KEYS.includes(key as (typeof PROTECTED_STORAGE_KEYS)[number])
    );
    await chrome.storage.local.remove(lyricsKeys);
    await saveCacheInfo();
  } catch (error) {
    logError(error);
  }
}

export async function clearSongCache(videoId: string): Promise<void> {
  if (!videoId) return;
  try {
    const prefix = `blyrics_${videoId}_`;
    const result = await chrome.storage.local.get(null);
    const songKeys = Object.keys(result).filter(
      key => key.startsWith(prefix) && !PROTECTED_STORAGE_KEYS.includes(key as (typeof PROTECTED_STORAGE_KEYS)[number])
    );
    await chrome.storage.local.remove(songKeys);
    await saveCacheInfo();
  } catch (error) {
    logError(error);
  }
}

/**
 * Removes expired cache entries from local storage.
 * Scans all BetterLyrics cache keys and removes those past their expiry time.
 */
export async function purgeExpiredKeys(): Promise<void> {
  try {
    const now = Date.now();
    const result = await chrome.storage.local.get(null);
    const keysToRemove: string[] = [];

    Object.keys(result).forEach(key => {
      if (key.startsWith("blyrics_")) {
        const item = result[key] as TransientStorageItem;
        if (item.expiry && now >= item.expiry) {
          keysToRemove.push(key);
        }
      }
    });

    if (keysToRemove.length) {
      await chrome.storage.local.remove(keysToRemove);
    }
  } catch (error) {
    logError(error);
  }
}

/**
 * Returns stats for saved per-song lyric offsets: how many are stored.
 *
 * @returns {Promise<{count: number}>} Offset storage statistics
 */
export async function getOffsetInfo(): Promise<{ count: number }> {
  try {
    const result = await chrome.storage.local.get(null);
    const offsetKeys = Object.keys(result).filter(key => key.startsWith(OFFSET_STORAGE_PREFIX));
    return { count: offsetKeys.length };
  } catch (error) {
    logError(error);
    return { count: 0 };
  }
}

/**
 * Removes every saved per-song lyric offset from local storage.
 *
 * @returns {Promise<number>} The number of offsets removed
 */
export async function clearAllOffsets(): Promise<number> {
  try {
    const result = await chrome.storage.local.get(null);
    const offsetKeys = Object.keys(result).filter(key => key.startsWith(OFFSET_STORAGE_PREFIX));
    await chrome.storage.local.remove(offsetKeys);
    return offsetKeys.length;
  } catch (error) {
    logError(error);
    return 0;
  }
}
