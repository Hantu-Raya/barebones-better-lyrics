/**
 * @fileoverview Early injection script for request interception.
 * Intercepts YouTube Music API requests to extract song metadata and timing information.
 */

/**
 * Extension.js content-script entrypoint. The framework mounts this function and
 * calls the returned cleanup before reinjecting an updated build.
 */
export default function initializeRequestInterceptor() {
  const REQUEST_REPLAY_EVENT = "blyrics-request-sniff-replay";
  const RESPONSE_EVENT = "blyrics-send-response";
  const REPLAY_CACHE_KEY = Symbol.for("better-lyrics.request-sniffer-replay-cache");
  const REPLAY_CACHE_VERSION = 1;
  const MAX_BROWSE_REPLAY_ENTRIES = 32;

  /** Store reference to original fetch function */
  const originalFetch = window.fetch;

  function getLyricsBrowseId(responseJson) {
    return (
      responseJson?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
        ?.tabs?.[1]?.tabRenderer?.endpoint?.browseEndpoint?.browseId ?? null
    );
  }

  // The isolated-world content script is replaced during hot reload, including all of its
  // module-scoped Maps. Keep the raw responses in the page world, whose `window` survives that
  // reinjection, so the next content-script generation can rebuild its parsed caches.
  const existingReplayCache = window[REPLAY_CACHE_KEY];
  const replayCache =
    existingReplayCache?.version === REPLAY_CACHE_VERSION && existingReplayCache.browseResponses instanceof Map
      ? existingReplayCache
      : {
          version: REPLAY_CACHE_VERSION,
          lastNextResponse: null,
          lyricsBrowseId: null,
          browseResponses: new Map(),
        };
  replayCache.lyricsBrowseId = getLyricsBrowseId(replayCache.lastNextResponse?.responseJson);
  if (replayCache.lastNextResponse) {
    for (const browseId of replayCache.browseResponses.keys()) {
      if (browseId !== replayCache.lyricsBrowseId) replayCache.browseResponses.delete(browseId);
    }
  }
  window[REPLAY_CACHE_KEY] = replayCache;

  function emitSniffResponse(detail) {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail }));
  }

  function rememberSniffResponse(detail) {
    let path;
    try {
      path = new URL(detail.url).pathname;
    } catch (_error) {
      return;
    }

    if (path.startsWith("/youtubei/v1/next")) {
      replayCache.lastNextResponse = detail;
      replayCache.lyricsBrowseId = getLyricsBrowseId(detail.responseJson);
      for (const browseId of replayCache.browseResponses.keys()) {
        if (browseId !== replayCache.lyricsBrowseId) replayCache.browseResponses.delete(browseId);
      }
      return;
    }

    if (!path.startsWith("/youtubei/v1/browse")) return;
    const browseId = detail.requestJson?.browseId;
    if (typeof browseId !== "string" || browseId.length === 0) return;
    // Once `/next` identifies the lyrics endpoint, unrelated browse payloads (home, artist,
    // album, etc.) are intentionally not retained. Some of those responses are very large.
    if (replayCache.lastNextResponse && browseId !== replayCache.lyricsBrowseId) return;

    // Refresh insertion order so the bounded cache retains the most recently used responses.
    replayCache.browseResponses.delete(browseId);
    replayCache.browseResponses.set(browseId, detail);
    while (replayCache.browseResponses.size > MAX_BROWSE_REPLAY_ENTRIES) {
      const oldestBrowseId = replayCache.browseResponses.keys().next().value;
      replayCache.browseResponses.delete(oldestBrowseId);
    }
  }

  function replaySniffResponses() {
    // `/next` establishes browseId -> videoId associations, so it must be replayed before the
    // corresponding `/browse` responses that contain the lyrics.
    if (replayCache.lastNextResponse) emitSniffResponse(replayCache.lastNextResponse);
    for (const detail of replayCache.browseResponses.values()) emitSniffResponse(detail);
  }

  const handleReplayRequest = () => replaySniffResponses();
  document.addEventListener(REQUEST_REPLAY_EVENT, handleReplayRequest);

  // Passive observation only: the page's own /next and /browse responses are read and never
  // re-requested (no English-locale re-fetch).
  function dispatchSniffResponse(url, requestJson, responseJson, status) {
    const detail = { url, requestJson, responseJson, status, timestamp: Date.now() };
    rememberSniffResponse(detail);
    emitSniffResponse(detail);
  }

  /**
   * Overrides the global fetch function to intercept YouTube Music API requests.
   * Extracts and dispatches song data for lyrics synchronization.
   *
   * @param {string|Request} request - Fetch request URL or Request object
   * @param {RequestInit} [init] - Optional fetch configuration
   * @returns {Promise<Response>} The original fetch response
   */
  const interceptedFetch = async function (request, init) {
    const urlString = typeof request === "string" ? request : request.url;

    if (
      urlString.startsWith("https://music.youtube.com/youtubei/v1/browse") ||
      urlString.startsWith("https://music.youtube.com/youtubei/v1/next")
    ) {
      try {
        const requestToFetch = typeof request === "string" ? request : request.clone();
        const originalRequestForJson = typeof request === "string" ? new Request(request, init) : request.clone();

        // Determine the request method to avoid reading body of GET requests
        const method = originalRequestForJson.method || (init && init.method) || "GET";

        const response = await originalFetch(requestToFetch, init);
        const clonedResponseForJson = response.clone();

        // Only read the request body if it's a POST request
        let requestBodyPromise;
        if (method.toUpperCase() === "POST") {
          const contentEncoding = originalRequestForJson.headers.get("content-encoding")?.toLowerCase();
          if (
            (contentEncoding === "gzip" || contentEncoding === "deflate") &&
            typeof DecompressionStream !== "undefined"
          ) {
            requestBodyPromise = originalRequestForJson
              .arrayBuffer()
              .then(async buffer => {
                try {
                  const ds = new DecompressionStream(contentEncoding);
                  const decompressedStream = new Response(buffer).body.pipeThrough(ds);
                  return await new Response(decompressedStream).text();
                } catch (e) {
                  console.error("Better Lyrics: Error decompressing request body:", e);
                  return "{}";
                }
              })
              .catch(e => {
                console.error("Better Lyrics: Error reading request arrayBuffer:", e);
                return "{}";
              });
          } else {
            requestBodyPromise = originalRequestForJson.text().catch(e => {
              console.error("Better Lyrics: Error reading request text:", e);
              return "{}";
            });
          }
        } else {
          // For GET or other methods, resolve immediately with an empty object string
          requestBodyPromise = Promise.resolve("{}");
        }

        Promise.all([
          requestBodyPromise,
          clonedResponseForJson.text().catch(e => {
            console.error("Better Lyrics: Error reading response text:", e);
            return "{}";
          }),
        ])
          .then(awaitedTexts => {
            let requestJson, responseJson;
            try {
              // No need to parse requestJson if it wasn't a POST, but the empty object handles it gracefully
              requestJson = JSON.parse(awaitedTexts[0]);
            } catch (e) {
              console.error("Better Lyrics: Error parsing request JSON", e);
              requestJson = { error: "Failed to parse request JSON" };
            }
            try {
              responseJson = JSON.parse(awaitedTexts[1]);
            } catch (e) {
              console.error("Better Lyrics: Error parsing response JSON", e);
              responseJson = { error: "Failed to parse response JSON" };
            }

            const eventUrl = clonedResponseForJson.url || urlString;
            const status = clonedResponseForJson.status;
            dispatchSniffResponse(eventUrl, requestJson, responseJson, status);
          })
          .catch(error => {
            console.error("Better Lyrics: Error processing response", error);
          });

        return response; // Return the original response fetched
      } catch (error) {
        console.error("Better Lyrics: Error in fetch wrapper", error);
        return originalFetch(request, init); // Fallback to original fetch on error
      }
    } else {
      return originalFetch(request, init);
    }
  };

  window.fetch = interceptedFetch;

  return () => {
    // Do not overwrite a newer interceptor if another build mounted first.
    if (window.fetch === interceptedFetch) window.fetch = originalFetch;
    document.removeEventListener(REQUEST_REPLAY_EVENT, handleReplayRequest);
  };
}
