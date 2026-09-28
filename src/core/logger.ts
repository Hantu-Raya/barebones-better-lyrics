import { GENERAL_ERROR_LOG, LOG_PREFIX } from "@constants";

export type LogSink = (...args: unknown[]) => void;

// Barebones: informational logging is permanently off. Only warnings and errors reach the console,
// and callers must not pass lyric bodies, request bodies or tokens to them.
const NOOP: LogSink = () => {};

const BADGE_TEXT = "color:#fff;padding:1px 5px;border-radius:3px;font-weight:600";

function createWarnSink(prefix: string): LogSink {
  return console.warn.bind(console, `%c${prefix}`, `background:#6d28d9;${BADGE_TEXT}`);
}

function createErrorSink(prefix: string): LogSink {
  return console.error.bind(console, `%c${prefix}`, `background:#dc2626;${BADGE_TEXT}`);
}

export const warnCore: LogSink = createWarnSink(LOG_PREFIX);
export const warnGeneral: LogSink = createWarnSink(GENERAL_ERROR_LOG);
export const errorCore: LogSink = createErrorSink(LOG_PREFIX);
export const errorGeneral: LogSink = createErrorSink(GENERAL_ERROR_LOG);

// The renderer host contract requires an informational sink; it stays silent.
export const logCore: LogSink = NOOP;
