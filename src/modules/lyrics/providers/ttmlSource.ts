import { parseTTMLContent } from "@braccato/parsers";
import type { LyricSourceResult, ProviderParameters } from "@modules/lyrics/providers/shared";

const RICHSYNC_KEY = "bLyrics-richsynced";
const SYNCED_KEY = "bLyrics-synced";

/**
 * Parses a Better Lyrics TTML body into the two Better Lyrics source slots: word-timed lyrics fill
 * the richsync slot, line-timed lyrics the synced slot, and the other slot is recorded as a miss.
 */
export function fillTtml(responseString: string, providerParameters: ProviderParameters): void {
  const { sourceMap } = providerParameters;
  const { lyrics, isWordSynced, language } = parseTTMLContent(responseString, {
    songDurationMs: providerParameters.duration * 1000,
  });

  if (lyrics.length === 0) {
    sourceMap[RICHSYNC_KEY].lyricSourceResult = null;
    sourceMap[SYNCED_KEY].lyricSourceResult = null;
  } else {
    const result: LyricSourceResult = {
      cacheAllowed: true,
      language,
      lyrics,
      musicVideoSynced: false,
      source: "Better Lyrics",
    };
    sourceMap[RICHSYNC_KEY].lyricSourceResult = isWordSynced ? result : null;
    sourceMap[SYNCED_KEY].lyricSourceResult = isWordSynced ? null : result;
  }

  sourceMap[SYNCED_KEY].filled = true;
  sourceMap[RICHSYNC_KEY].filled = true;
}
