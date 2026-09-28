import { LOG_PREFIX } from "@constants";

export type LogSink = (...args: unknown[]) => void;

// Barebones: informational logging is permanently off. Only warnings reach the console, and
// callers must not pass lyric bodies, request bodies or tokens to them.
export const warnCore: LogSink = console.warn.bind(
  console,
  `%c${LOG_PREFIX}`,
  "background:#6d28d9;color:#fff;padding:1px 5px;border-radius:3px;font-weight:600"
);

// The renderer host contract requires an informational sink; it stays silent.
export const logCore: LogSink = () => {};
