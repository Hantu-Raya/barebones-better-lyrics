import { AppState, reloadLyrics } from "@core/appState";
import { getStorage } from "@core/storage";
import { clearCache as clearTranslationCache } from "@modules/lyrics/translation";
import { applyGlobalOffsets } from "@modules/ui/lyricsDock/offset";

// Offsets are seconds; anything outside this range (or non-finite) in storage is treated as 0.
export const MAX_GLOBAL_OFFSET_SECONDS = 30;

function sanitizeOffset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_GLOBAL_OFFSET_SECONDS
    ? value
    : 0;
}

const TRANSLATION_KEYS = ["isTranslateEnabled", "translationLanguage", "translationDisabledLanguages"];
const OFFSET_KEYS = ["globalLyricOffset", "richsyncOffsetTrim", "lineOffsetTrim"];

let hasInitializedSettingsListener = false;

function translationStateKey(): string {
  return JSON.stringify([
    AppState.isTranslateEnabled,
    AppState.translationLanguage,
    AppState.translationDisabledLanguages,
  ]);
}

/**
 * Applies settings written by the options page. The options page only writes chrome.storage;
 * this listener is the whole propagation path (no tabs messaging).
 */
export function listenForSettingsChanges(): void {
  if (hasInitializedSettingsListener) return;
  hasInitializedSettingsListener = true;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const changed = Object.keys(changes);

    if (changed.some(key => TRANSLATION_KEYS.includes(key))) {
      const before = translationStateKey();
      loadTranslationSettings(() => {
        // The dock toggle already updated AppState and reloaded; only react to outside edits.
        if (translationStateKey() === before) return;
        clearTranslationCache();
        reloadLyrics();
      });
    }
    if (changed.some(key => OFFSET_KEYS.includes(key))) {
      loadLyricOffsetSettings();
    }
    if (changes.isPassiveScrollEnabled) {
      loadPassiveScrollSetting();
    }
    if (changes.cacheClearedAt) {
      clearTranslationCache();
      reloadLyrics();
    }
  });
}

export function loadPassiveScrollSetting(): void {
  getStorage({ isPassiveScrollEnabled: true }, items => {
    AppState.isPassiveScrollEnabled = items.isPassiveScrollEnabled !== false;
  });
}

/**
 * Loads translation settings from storage and updates AppState.
 */
export function loadTranslationSettings(callback?: () => void): void {
  getStorage(
    {
      isTranslateEnabled: false,
      translationLanguage: "en",
      translationDisabledLanguages: [],
    },
    items => {
      AppState.isTranslateEnabled = items.isTranslateEnabled === true;
      AppState.translationLanguage = typeof items.translationLanguage === "string" && items.translationLanguage
        ? items.translationLanguage
        : "en";
      AppState.translationDisabledLanguages = Array.isArray(items.translationDisabledLanguages)
        ? items.translationDisabledLanguages.filter((lang: unknown) => typeof lang === "string")
        : [];
      callback?.();
    }
  );
}

/**
 * Loads the global and per-sync-type lyric offsets from storage into AppState.
 */
export function loadLyricOffsetSettings(): void {
  getStorage(
    {
      globalLyricOffset: 0,
      richsyncOffsetTrim: 0,
      lineOffsetTrim: 0,
    },
    items => {
      applyGlobalOffsets({
        globalLyricOffset: sanitizeOffset(items.globalLyricOffset),
        richsyncOffsetTrim: sanitizeOffset(items.richsyncOffsetTrim),
        lineOffsetTrim: sanitizeOffset(items.lineOffsetTrim),
      });
    }
  );
}
