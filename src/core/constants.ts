import type { LyricSourceKey } from "@modules/lyrics/providers/shared";

// The renderer module owns the names it emits into the lyrics DOM. They are re-exported here so
// existing importers keep reaching them through @constants.
export {
  FOOTER_CLASS,
  LINE_CLASS,
  LYRICS_CLASS,
  LYRICS_WRAPPER_ID,
  TRANSLATED_LYRICS_CLASS,
  WORD_HIGHLIGHT_CLASS,
} from "@braccato/core/constants";

// DOM Class Names
export const TAB_HEADER_CLASS = "tab-header style-scope ytmusic-player-page" as const;
export const TAB_CONTENT_CLASS = "tab-content style-scope tp-yt-paper-tab" as const;
export const DOCK_CLASS = "blyrics-dock" as const;
export const DOCK_DEFAULT_POSITION = "bottom-right" as const;
export const DOCK_CONTROL_ORDER_DEFAULT = [
  "source",
  "translate",
  "offset",
  "refresh",
] as const;

// DOM Selectors
export const TAB_RENDERER_SELECTOR = "#tab-renderer" as const;
export const LYRICS_PAGE_TYPE = "MUSIC_PAGE_TYPE_TRACK_LYRICS" as const;

// DOM IDs and Attributes
export const LYRICS_LOADER_ID = "blyrics-loader" as const;

// Custom Events
// Duplicated as a literal in public/script.js; that file is a page-world script and cannot import.
export const SEEK_EVENT = "blyrics-seek-to" as const;

// API URLs and Functions
export const TRANSLATE_LYRICS_URL = function (lang: string, text: string): string {
  return `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`;
};
// Better Lyrics public API, cache-only (no key, no challenge): 401 means uncached.
export const BETTER_LYRICS_API_URL = "https://api.betterlyrics.org/getLyrics" as const;
export const LRCLIB_API_URL = "https://lrclib.net/api/get" as const;
export const LRCLIB_CLIENT_HEADER =
  "Barebones Better Lyrics 2.4.1.1 (https://github.com/Hantu-Raya/barebones-better-lyrics)" as const;
export const PROVIDER_TIMEOUT_MS = 20_000;

// Log Prefixes
export const LOG_PREFIX = "[BetterLyrics]" as const;

// Initialization and General Logs
export const GENERAL_ERROR_LOG = "[BetterLyrics] Error:" as const;
export const NO_LYRICS_FOUND_LOG = "[BetterLyrics] No lyrics found for the current song" as const;
export const MUSIC_NOTES = "♪𝅘𝅥𝅮𝅘𝅥𝅯𝅘𝅥𝅰𝅘𝅥𝅱𝅘𝅥𝅲" as const;

export const LYRICS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LYRICS_NEGATIVE_CACHE_TTL_MS = 30 * 60 * 1000;

export const OFFSET_STORAGE_PREFIX = "blyricsOffset_";

export const PLAYER_BAR_SELECTOR = "ytmusic-player-bar" as const;
export const AD_PLAYING_ATTR = "is-advertisement" as const;
export const LYRICS_AD_OVERLAY_ID = "blyrics-ad-overlay" as const;

export type SyncType = "syllable" | "word" | "line" | "unsynced";

interface ProviderConfig {
  key: LyricSourceKey;
  displayName: string;
  syncType: SyncType;
  priority: number;
}

export const PROVIDER_CONFIGS: ProviderConfig[] = [
  { key: "bLyrics-richsynced", displayName: "Better Lyrics", syncType: "syllable", priority: 0 },
  { key: "bLyrics-synced", displayName: "Better Lyrics", syncType: "line", priority: 1 },
  { key: "lrclib-synced", displayName: "LRCLIB", syncType: "line", priority: 2 },
  { key: "yt-lyrics", displayName: "YouTube", syncType: "line", priority: 3 },
] as const;

export const LYRIC_SOURCE_KEYS = PROVIDER_CONFIGS.map(p => p.key);
