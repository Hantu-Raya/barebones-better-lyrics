import {
  GENERAL_ERROR_LOG,
  LOG_PREFIX,
  LOG_PREFIX_AUTH,
  LOG_PREFIX_CONTENT,
} from "@constants";

export type LogSink = (...args: unknown[]) => void;

const NOOP: LogSink = () => {};

// -- Badges --------------------------

const BADGE_TEXT = "color:#fff;padding:1px 5px;border-radius:3px;font-weight:600";

const LOG_BADGES: Record<string, string> = {
  [LOG_PREFIX]: `background:#6d28d9;${BADGE_TEXT}`,
  [LOG_PREFIX_CONTENT]: `background:#0369a1;${BADGE_TEXT}`,
  [LOG_PREFIX_AUTH]: `background:#15803d;${BADGE_TEXT}`,
  [GENERAL_ERROR_LOG]: `background:#dc2626;${BADGE_TEXT}`,
};

// -- Sinks --------------------------

function badgeFor(prefix: string): string {
  return LOG_BADGES[prefix] ?? `background:#475569;${BADGE_TEXT}`;
}

export function createLogSink(prefix: string, enabled: boolean): LogSink {
  if (!enabled) return NOOP;
  return console.log.bind(console, `%c${prefix}`, badgeFor(prefix));
}

function createWarnSink(prefix: string): LogSink {
  return console.warn.bind(console, `%c${prefix}`, badgeFor(prefix));
}

function createErrorSink(prefix: string): LogSink {
  return console.error.bind(console, `%c${prefix}`, badgeFor(prefix));
}

export const warnCore: LogSink = createWarnSink(LOG_PREFIX);
export const warnAuth: LogSink = createWarnSink(LOG_PREFIX_AUTH);
export const warnGeneral: LogSink = createWarnSink(GENERAL_ERROR_LOG);
export const errorCore: LogSink = createErrorSink(LOG_PREFIX);
export const errorGeneral: LogSink = createErrorSink(GENERAL_ERROR_LOG);

export let logCore: LogSink = createLogSink(LOG_PREFIX, true);
export let logContent: LogSink = createLogSink(LOG_PREFIX_CONTENT, true);
export let logAuth: LogSink = createLogSink(LOG_PREFIX_AUTH, true);
export let logError: LogSink = createLogSink(GENERAL_ERROR_LOG, true);

export function configureLogging(enabled: boolean): void {
  logCore = createLogSink(LOG_PREFIX, enabled);
  logContent = createLogSink(LOG_PREFIX_CONTENT, enabled);
  logAuth = createLogSink(LOG_PREFIX_AUTH, enabled);
  logError = createLogSink(GENERAL_ERROR_LOG, enabled);
}
