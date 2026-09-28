/**
 * @fileoverview YouTube Music player integration for Better Lyrics.
 * Publishes authoritative metadata/state snapshots without driving every
 * animation tick across the MAIN/ISOLATED world boundary.
 */

/**
 * Extension.js content-script entrypoint. The framework mounts this function and
 * calls the returned cleanup before reinjecting an updated build.
 */
export default function initializePlayerBridge() {
  const PLAYER_SNAPSHOT_INTERVAL_MS = 1000;
  const VIDEO_STATE_EVENTS = [
    "loadedmetadata",
    "durationchange",
    "play",
    "playing",
    "pause",
    "waiting",
    "seeking",
    "seeked",
    "ratechange",
    "ended",
    "emptied",
  ];

  let snapshotInterval;
  let cachedContentRect = null;
  let playerResizeObserver = null;
  let observedPlayer = null;
  let observedVideoElement = null;

  const publishPlayerSnapshot = () => {
    const player = observedPlayer;
    if (!player?.isConnected) return;

    try {
      const { video_id, title, author } = player.getVideoData();
      const playerResponse = typeof player.getPlayerResponse === "function" ? player.getPlayerResponse() : null;
      const progressState = typeof player.getProgressState === "function" ? player.getProgressState() : null;
      const metadataDuration = Number(playerResponse?.videoDetails?.lengthSeconds);
      const seekableDuration = progressState?.duration;
      let duration = player.getDuration();
      if (Number.isFinite(seekableDuration) && seekableDuration > 0) duration = seekableDuration;
      if (Number.isFinite(metadataDuration) && metadataDuration > 0) duration = metadataDuration;
      if (
        !video_id ||
        typeof title !== "string" ||
        !title.trim() ||
        typeof author !== "string" ||
        !author.trim() ||
        !Number.isFinite(duration) ||
        duration <= 0
      ) {
        return;
      }

      if (!cachedContentRect && typeof player.getVideoContentRect === "function") {
        cachedContentRect = player.getVideoContentRect();
      }

      const { isPlaying, isBuffering, isSeeking, isUiSeeking } = player.getPlayerStateObject();
      document.dispatchEvent(
        new CustomEvent("blyrics-send-player-time", {
          detail: {
            currentTime: player.getCurrentTime(),
            videoId: video_id,
            song: title,
            artist: author,
            duration,
            browserTime: Date.now(),
            isPlaying,
            playing: isPlaying && !isBuffering && !isSeeking && !isUiSeeking,
            playbackRate: observedVideoElement?.playbackRate ?? 1,
            contentRect: cachedContentRect ?? { width: 0, height: 0 },
          },
        })
      );
    } catch {
      // Player API not ready yet; the next snapshot retries.
    }
  };

  const handleVideoStateChange = () => {
    publishPlayerSnapshot();
  };

  const detachVideoListeners = () => {
    if (!observedVideoElement) return;
    observedVideoElement.removeEventListener("resize", handleVideoStateChange);
    for (const event of VIDEO_STATE_EVENTS) {
      observedVideoElement.removeEventListener(event, handleVideoStateChange);
    }
    observedVideoElement = null;
  };

  const attachVideoListeners = player => {
    const video = player?.querySelector("video") ?? null;
    if (video === observedVideoElement) return;

    detachVideoListeners();
    observedVideoElement = video;
    if (!video) return;

    video.addEventListener("resize", handleVideoStateChange);
    for (const event of VIDEO_STATE_EVENTS) {
      video.addEventListener(event, handleVideoStateChange);
    }
  };

  const handlePlayerStateChange = () => publishPlayerSnapshot();

  const detachPlayer = () => {
    if (observedPlayer && typeof observedPlayer.removeEventListener === "function") {
      observedPlayer.removeEventListener("onStateChange", handlePlayerStateChange);
    }
    playerResizeObserver?.disconnect();
    playerResizeObserver = null;
    detachVideoListeners();
    observedPlayer = null;
    cachedContentRect = null;
  };

  const attachPlayer = player => {
    if (player === observedPlayer) {
      attachVideoListeners(player);
      return;
    }

    detachPlayer();
    observedPlayer = player;

    if (typeof player.addEventListener === "function") {
      player.addEventListener("onStateChange", handlePlayerStateChange);
    }

    playerResizeObserver = new ResizeObserver(() => {
      if (typeof player.getVideoContentRect === "function") {
        cachedContentRect = player.getVideoContentRect();
      }
      attachVideoListeners(player);
    });
    playerResizeObserver.observe(player);
    attachVideoListeners(player);
  };

  const checkPlayerAndPublish = () => {
    const player = document.getElementById("movie_player");
    if (player) attachPlayer(player);
    else if (observedPlayer) detachPlayer();

    // Intentionally unconditional. If the initial document_end snapshot races
    // isolated-world initialization, the next 1 Hz snapshot still initializes
    // lyrics instead of being suppressed as a duplicate.
    publishPlayerSnapshot();
  };

  const stopPlayerBridge = () => {
    if (snapshotInterval) {
      clearInterval(snapshotInterval);
      snapshotInterval = null;
    }
    detachPlayer();
  };

  window.addEventListener("unload", stopPlayerBridge);

  const handleSeek = event => {
    const player = document.getElementById("movie_player");
    const seekTime = event.detail ?? 0;
    if (player && seekTime >= 0) {
      player.seekTo(seekTime, true);
      player.playVideo();
    }
  };

  document.addEventListener("blyrics-seek-to", handleSeek);

  checkPlayerAndPublish();
  snapshotInterval = setInterval(checkPlayerAndPublish, PLAYER_SNAPSHOT_INTERVAL_MS);

  return () => {
    stopPlayerBridge();
    window.removeEventListener("unload", stopPlayerBridge);
    document.removeEventListener("blyrics-seek-to", handleSeek);
  };
}
