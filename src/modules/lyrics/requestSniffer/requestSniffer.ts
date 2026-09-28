import type { LongBylineText, NextResponse } from "@modules/lyrics/requestSniffer/NextResponse";

interface Segment {
  primaryVideoStartTimeMilliseconds: number;
  counterpartVideoStartTimeMilliseconds: number;
  durationMilliseconds: number;
}

export interface SegmentMap {
  segment: Segment[];
}

interface LyricsInfo {
  hasLyrics: boolean;
  lyrics: string | null;
  sourceText: string | null;
}

/** What the lyric lookup needs to know about a queued video, read from the page's own /next response. */
interface VideoMetadata {
  title: string;
  artist: string;
  counterpartVideoId: string | null;
  segmentMap: SegmentMap | null;
}

const browseIdToVideoIdMap = new Map<string, string>();
const videoIdToLyricsMap = new Map<string, LyricsInfo>();
const videoMetaDataMap = new Map<string, VideoMetadata>();
const videoIdToAlbumMap = new Map<string, string | null>();
const REQUEST_REPLAY_EVENT = "blyrics-request-sniff-replay";
const RESPONSE_EVENT = "blyrics-send-response";
const REPLAY_RETRY_DELAY_MS = 100;

function getPlaylistPanelContents(response: NextResponse) {
  return (
    response.contents?.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer.tabs?.[0]
      .tabRenderer.content?.musicQueueRenderer.content?.playlistPanelRenderer.contents ??
    response.continuationContents?.playlistPanelContinuation.contents
  );
}

let firstRequestMissedVideoId: string | null = null;

const LYRICS_POLL_MAX_CHECKS = 250;

/**
 * Resolves YouTube Music's own lyrics for the video once the page's /browse response has been seen,
 * polling for up to LYRICS_POLL_MAX_CHECKS ticks.
 *
 * @param videoId
 * @param signal - AbortSignal to cancel polling
 * @return
 */
export function getLyrics(videoId: string, signal?: AbortSignal): Promise<LyricsInfo> {
  if (videoIdToLyricsMap.has(videoId)) {
    return Promise.resolve(videoIdToLyricsMap.get(videoId)!);
  }

  if (signal?.aborted) {
    return Promise.resolve({ hasLyrics: false, lyrics: "", sourceText: "" });
  }

  let checkCount = 0;
  return new Promise(resolve => {
    const abortHandler = () => {
      clearInterval(checkInterval);
      resolve({ hasLyrics: false, lyrics: "", sourceText: "" });
    };
    const checkInterval = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(checkInterval);
        signal?.removeEventListener("abort", abortHandler);
        resolve({ hasLyrics: false, lyrics: "", sourceText: "" });
        return;
      }
      if (videoIdToLyricsMap.has(videoId)) {
        clearInterval(checkInterval);
        signal?.removeEventListener("abort", abortHandler);
        resolve(videoIdToLyricsMap.get(videoId)!);
        return;
      }
      const metadata = videoMetaDataMap.get(videoId);
      if (metadata?.counterpartVideoId && videoIdToLyricsMap.has(metadata.counterpartVideoId)) {
        clearInterval(checkInterval);
        signal?.removeEventListener("abort", abortHandler);
        resolve(videoIdToLyricsMap.get(metadata.counterpartVideoId)!);
        return;
      }
      if (checkCount > LYRICS_POLL_MAX_CHECKS) {
        clearInterval(checkInterval);
        signal?.removeEventListener("abort", abortHandler);
        resolve({ hasLyrics: false, lyrics: "", sourceText: "" });
        return;
      }
      checkCount += 1;
    }, 20);

    signal?.addEventListener("abort", abortHandler, { once: true });
  });
}

/**
 *
 * @param videoId
 * @param maxCheckCount
 * @param signal - AbortSignal to cancel polling
 * @return
 */
export function getSongMetadata(
  videoId: string,
  maxCheckCount = 250,
  signal?: AbortSignal
): Promise<VideoMetadata | null> {
  if (videoMetaDataMap.has(videoId)) {
    return Promise.resolve(videoMetaDataMap.get(videoId)!);
  }

  if (signal?.aborted) {
    return Promise.resolve(null);
  }

  let checkCount = 0;
  return new Promise(resolve => {
    const abortHandler = () => {
      clearInterval(checkInterval);
      resolve(null);
    };
    const checkInterval = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(checkInterval);
        signal?.removeEventListener("abort", abortHandler);
        resolve(null);
        return;
      }
      const metadata = videoMetaDataMap.get(videoId);
      if (metadata) {
        clearInterval(checkInterval);
        signal?.removeEventListener("abort", abortHandler);
        resolve(metadata);
        return;
      }
      if (checkCount > maxCheckCount) {
        clearInterval(checkInterval);
        signal?.removeEventListener("abort", abortHandler);
        resolve(null);
        return;
      }
      checkCount += 1;
    }, 20);

    signal?.addEventListener("abort", abortHandler, { once: true });
  });
}

/**
 * @param videoId
 * @param signal - AbortSignal to cancel polling
 * @return
 */
export async function getSongAlbum(videoId: string, signal?: AbortSignal): Promise<string | null | undefined> {
  for (let i = 0; i < 250; i++) {
    if (signal?.aborted) return undefined;
    if (videoIdToAlbumMap.has(videoId)) {
      return videoIdToAlbumMap.get(videoId);
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

export function setupRequestSniffer(): () => void {
  let url = new URL(window.location.href);
  if (url.searchParams.has("v")) {
    firstRequestMissedVideoId = url.searchParams.get("v");
  }

  const handleSniffResponse = (event: Event): void => {
    if (!(event instanceof CustomEvent)) return;
    let { /** @type string */ url, requestJson, responseJson } = event.detail;
    if (matchesPath(url, "/youtubei/v1/next")) {
      let nextResponse = responseJson as NextResponse;
      // Only the page's own (possibly localized) response is observed; no English replay.
      let playlistPanelRendererContents = getPlaylistPanelContents(nextResponse);

      if (!playlistPanelRendererContents) {
        playlistPanelRendererContents =
          // lowkey not sure is this key exists; All the samples I've found don't have it, but I assume I initially
          // put it in for some reason
          responseJson.onResponseReceivedEndpoints?.[0]?.queueUpdateCommand?.inlineContents?.playlistPanelRenderer
            ?.contents;
      }

      if (playlistPanelRendererContents) {
        // let's first map this into a sensible type
        let videoPairs = playlistPanelRendererContents
          .map(content => {
            let counterPartRenderer = content.playlistPanelVideoWrapperRenderer?.counterpart?.[0]?.counterpartRenderer;

            let primaryRenderer = content.playlistPanelVideoRenderer;
            if (!primaryRenderer) {
              primaryRenderer = content.playlistPanelVideoWrapperRenderer?.primaryRenderer.playlistPanelVideoRenderer;
            }

            if (!primaryRenderer) {
              return null;
            }

            let primaryId = primaryRenderer?.videoId;
            let primaryTitle = primaryRenderer?.title.runs[0].text;

            function extractByLineInfo(longByLineText: LongBylineText): [string, string] {
              const artists: string[] = [];
              let album = "";
              const runs = longByLineText?.runs;
              if (!runs) {
                return ["", album];
              }
              for (const run of runs) {
                const browse = run.navigationEndpoint?.browseEndpoint;
                const pageType =
                  browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
                if (pageType === "MUSIC_PAGE_TYPE_ALBUM") {
                  album = run.text;
                } else if (browse) {
                  artists.push(run.text);
                }
              }

              if (artists.length === 0) {
                // Topic uploads list every artist in a single unlinked run before the first separator
                const bulletIndex = runs.findIndex(run => run.text.trim() === "•");
                const namedRuns = bulletIndex === -1 ? runs : runs.slice(0, bulletIndex);
                return [
                  namedRuns
                    .map(run => run.text)
                    .join("")
                    .trim(),
                  album,
                ];
              }

              return [artists.join(", "), album];
            }

            let [primaryArtist, primaryAlbum] = extractByLineInfo(primaryRenderer?.longBylineText);

            let primary = {
              id: primaryId,
              title: primaryTitle,
              artist: primaryArtist,
              album: primaryAlbum,
            };

            if (counterPartRenderer) {
              let counterpartId = counterPartRenderer?.playlistPanelVideoRenderer.videoId;
              let counterpartTitle = counterPartRenderer.playlistPanelVideoRenderer.title.runs[0].text;
              let [counterpartArtist, counterpartAlbum] = extractByLineInfo(
                counterPartRenderer?.playlistPanelVideoRenderer.longBylineText
              );

              return {
                primary,
                counterpart: {
                  id: counterpartId,
                  title: counterpartTitle,
                  artist: counterpartArtist,
                  album: counterpartAlbum,
                  segmentMap: content.playlistPanelVideoWrapperRenderer!.counterpart[0].segmentMap,
                },
              };
            } else {
              return { primary: primary };
            }
          })
          .filter(pair => pair); //remove null values

        for (const videoPair of videoPairs) {
          if (!videoPair) {
            continue;
          }

          let counterpart = videoPair.counterpart;
          if (counterpart) {
            let numSegmentMap: SegmentMap | null = null; // our segment map with `Number` as the type
            let reversedSegmentMap: SegmentMap | null = null;

            numSegmentMap = { segment: [] };
            if (counterpart.segmentMap.segment) {
              for (const segment of counterpart.segmentMap.segment) {
                numSegmentMap.segment.push({
                  counterpartVideoStartTimeMilliseconds: Number(segment.counterpartVideoStartTimeMilliseconds),
                  primaryVideoStartTimeMilliseconds: Number(segment.primaryVideoStartTimeMilliseconds),
                  durationMilliseconds: Number(segment.durationMilliseconds),
                });
              }
              reversedSegmentMap = { segment: [] };
              for (let segment of numSegmentMap.segment) {
                reversedSegmentMap.segment.push({
                  primaryVideoStartTimeMilliseconds: segment.counterpartVideoStartTimeMilliseconds,
                  counterpartVideoStartTimeMilliseconds: segment.primaryVideoStartTimeMilliseconds,
                  durationMilliseconds: segment.durationMilliseconds,
                });
              }
            }

            videoMetaDataMap.set(videoPair.primary.id, {
              artist: videoPair.primary.artist,
              title: videoPair.primary.title,
              counterpartVideoId: counterpart.id,
              segmentMap: numSegmentMap,
            });

            videoMetaDataMap.set(counterpart.id, {
              artist: counterpart.artist,
              title: counterpart.title,
              counterpartVideoId: videoPair.primary.id,
              segmentMap: reversedSegmentMap,
            });

            videoIdToAlbumMap.set(counterpart.id, counterpart.album);
          } else {
            videoMetaDataMap.set(videoPair.primary.id, {
              artist: videoPair.primary.artist,
              title: videoPair.primary.title,
              counterpartVideoId: null,
              segmentMap: null,
            });
          }
          videoIdToAlbumMap.set(videoPair.primary.id, videoPair.primary.album);
        }
      }

      let videoId = requestJson.videoId;

      if (!videoId) {
        videoId = responseJson.currentVideoEndpoint?.watchEndpoint?.videoId;
      }

      let album =
        responseJson?.playerOverlays?.playerOverlayRenderer?.browserMediaSession?.browserMediaSessionRenderer?.album
          ?.runs[0]?.text;

      videoIdToAlbumMap.set(videoId, album);
      if (videoMetaDataMap.has(videoId)) {
        let counterpart = videoMetaDataMap.get(videoId)!.counterpartVideoId;
        if (counterpart) {
          videoIdToAlbumMap.set(counterpart, album);
        }
      }

      if (!videoId) {
        return;
      }

      let lyricsTab =
        responseJson.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer
          ?.tabs[1]?.tabRenderer;
      if (lyricsTab && lyricsTab.unselectable) {
        videoIdToLyricsMap.set(videoId, { hasLyrics: false, lyrics: "", sourceText: "" });
      } else if (lyricsTab) {
        let browseId = lyricsTab.endpoint?.browseEndpoint?.browseId;
        if (browseId) {
          browseIdToVideoIdMap.set(browseId, videoId);
        }
      }
    } else if (matchesPath(url, "/youtubei/v1/browse")) {
      let browseId = requestJson.browseId;
      let videoId = browseIdToVideoIdMap.get(browseId);

      if (browseId !== undefined && videoId === undefined && firstRequestMissedVideoId !== null) {
        // it is possible that we missed the first request, so let's just try it with this id
        videoId = firstRequestMissedVideoId;
      }

      if (videoId !== undefined) {
        let lyrics =
          responseJson.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer?.description
            ?.runs?.[0]?.text;
        let sourceText =
          responseJson.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer?.footer?.runs?.[0]
            ?.text;
        if (lyrics && sourceText) {
          videoIdToLyricsMap.set(videoId, { hasLyrics: true, lyrics, sourceText });
          if (videoId === firstRequestMissedVideoId) {
            browseIdToVideoIdMap.set(browseId, videoId);
            firstRequestMissedVideoId = null;
          }
        } else {
          videoIdToLyricsMap.set(videoId, { hasLyrics: false, lyrics: null, sourceText: null });
        }
      }
    }
  };

  document.addEventListener(RESPONSE_EVENT, handleSniffResponse);

  const requestReplay = (): void => {
    document.dispatchEvent(new Event(REQUEST_REPLAY_EVENT));
  };
  requestReplay();
  // Extension.js injects the MAIN and ISOLATED entries independently. The immediate request is
  // normally handled by the old or new interceptor; one retry covers the brief handoff between them.
  const replayRetry = window.setTimeout(requestReplay, REPLAY_RETRY_DELAY_MS);

  return () => {
    window.clearTimeout(replayRetry);
    document.removeEventListener(RESPONSE_EVENT, handleSniffResponse);
  };
}

function matchesPath(urlString: string, path: string) {
  try {
    let url = new URL(urlString);
    return url && url.pathname.startsWith(path) && url.origin === "https://music.youtube.com";
  } catch (_e) {
    return false;
  }
}
