import { LRCLIB_API_URL, LRCLIB_CLIENT_HEADER, PROVIDER_TIMEOUT_MS } from "@constants";
import { warnCore } from "@core/logger";
import { parseLRC } from "@braccato/parsers";
import { type ProviderParameters, parseRetryAfterMs } from "./shared";

const KEY = "lrclib-synced";

/** Local backoff after a 429; while it runs the provider makes no request and caches nothing. */
let backoffUntil = 0;

function markMiss(p: ProviderParameters): void {
  p.sourceMap[KEY].lyricSourceResult = null;
  p.sourceMap[KEY].filled = true;
}

/**
 * Source #2: LRCLIB `/api/get`, synced LRC only. 404 and an entry without `syncedLyrics` are misses
 * (negative-cached); a 429 starts a local backoff honouring Retry-After and ends the attempt without
 * a retry. A 429 or network error leaves the source unfilled so nothing is cached.
 */
export default async function lrclib(p: ProviderParameters): Promise<void> {
  if (Date.now() < backoffUntil) {
    return;
  }

  const url = new URL(LRCLIB_API_URL);
  url.searchParams.set("track_name", p.song);
  url.searchParams.set("artist_name", p.artist);
  if (p.album) url.searchParams.set("album_name", p.album);
  if (p.duration) url.searchParams.set("duration", String(Math.round(p.duration)));

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "Lrclib-Client": LRCLIB_CLIENT_HEADER },
      signal: AbortSignal.any([p.signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]),
      credentials: "omit",
    });
  } catch (err) {
    if (!p.signal.aborted) warnCore("LRCLIB request failed:", err);
    return;
  }

  if (response.status === 429) {
    backoffUntil = Date.now() + parseRetryAfterMs(response.headers.get("Retry-After"));
    warnCore("LRCLIB rate limited; backing off");
    return;
  }

  if (response.status === 404) {
    markMiss(p);
    return;
  }

  if (!response.ok) {
    warnCore(`LRCLIB returned ${response.status}`);
    return;
  }

  let synced: unknown;
  try {
    const body: unknown = await response.json();
    synced = body && typeof body === "object" && "syncedLyrics" in body ? body.syncedLyrics : undefined;
  } catch (err) {
    if (!p.signal.aborted) warnCore("LRCLIB returned an unreadable body:", err);
    return;
  }

  if (typeof synced !== "string" || synced.trim().length === 0) {
    markMiss(p);
    return;
  }

  const lyrics = parseLRC(synced, p.duration * 1000);
  p.sourceMap[KEY].lyricSourceResult =
    lyrics.length > 0
      ? { lyrics, source: "LRCLIB", musicVideoSynced: false, cacheAllowed: true }
      : null;
  p.sourceMap[KEY].filled = true;
}
