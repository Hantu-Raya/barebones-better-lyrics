import { BETTER_LYRICS_API_URL, PROVIDER_TIMEOUT_MS } from "@constants";
import { warnCore } from "@core/logger";
import { fillTtml } from "./ttmlSource";
import { type ProviderParameters, parseRetryAfterMs } from "./shared";

const RICHSYNC_KEY = "bLyrics-richsynced";
const SYNCED_KEY = "bLyrics-synced";

/** Local backoff after a 429; while it runs the provider makes no request and caches nothing. */
let backoffUntil = 0;

/** One response fills both keys, so a lookup that failed unfilled is not repeated for the second key. */
const attempted = new WeakSet<ProviderParameters["sourceMap"]>();

function markMiss(p: ProviderParameters): void {
  for (const key of [RICHSYNC_KEY, SYNCED_KEY] as const) {
    p.sourceMap[key].lyricSourceResult = null;
    p.sourceMap[key].filled = true;
  }
}

/**
 * Source #1: the public Better Lyrics API, cache-only. No key and no challenge, so the server answers
 * only for songs it already has cached: 200 carries TTML, 401 (uncached) and 404 are misses. A 429
 * starts a local backoff and ends the attempt without a retry. A miss is recorded as filled so the
 * negative cache keeps it; a 429 or network error is left unfilled so nothing is cached.
 */
export default async function betterLyricsApi(p: ProviderParameters): Promise<void> {
  if (attempted.has(p.sourceMap)) return;
  attempted.add(p.sourceMap);

  if (Date.now() < backoffUntil) {
    return;
  }

  const url = new URL(BETTER_LYRICS_API_URL);
  url.searchParams.set("s", p.song);
  url.searchParams.set("a", p.artist);
  if (p.album) url.searchParams.set("al", p.album);
  if (p.duration) url.searchParams.set("d", String(Math.round(p.duration)));

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.any([p.signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]),
      credentials: "omit",
    });
  } catch (err) {
    if (!p.signal.aborted) warnCore("Better Lyrics API request failed:", err);
    return;
  }

  if (response.status === 429) {
    backoffUntil = Date.now() + parseRetryAfterMs(response.headers.get("Retry-After"));
    warnCore("Better Lyrics API rate limited; backing off");
    return;
  }

  if (response.status === 401 || response.status === 404) {
    markMiss(p);
    return;
  }

  if (!response.ok) {
    warnCore(`Better Lyrics API returned ${response.status}`);
    return;
  }

  let ttml: unknown;
  try {
    const body: unknown = await response.json();
    ttml = body && typeof body === "object" && "ttml" in body ? body.ttml : undefined;
  } catch (err) {
    if (!p.signal.aborted) warnCore("Better Lyrics API returned an unreadable body:", err);
    return;
  }

  if (typeof ttml !== "string" || ttml.length === 0) {
    markMiss(p);
    return;
  }

  fillTtml(ttml, p);
}
