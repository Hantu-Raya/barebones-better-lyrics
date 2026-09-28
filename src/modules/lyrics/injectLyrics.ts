import { NO_LYRICS_FOUND_LOG, TAB_HEADER_CLASS } from "@constants";
import { AppState } from "@core/appState";
import { t } from "@core/i18n";
import { applySegmentMapToLyrics, type LyricSourceResultWithMeta } from "@modules/lyrics/lyrics";
import { getTranslationFromCache, translateBatch } from "@modules/lyrics/translation";
import { addFooter, cleanup, createLyricsWrapper, flushLoader, unmountDock } from "@modules/ui/dom";
import { lyricsElementAdded, mainView } from "@modules/ui/mainLyricsView";
import { disableNativeLyricsFocus } from "@modules/ui/nativeLyricsFocus";
import { injectTranslation, type LineData, type LyricSyncType } from "@braccato/core";
import { containsNonLatin, detectNonLatinLanguage } from "@braccato/core/text";
import { langCodesMatch, languageMatchesAny } from "@utils";

/**
 * What the current song's lyrics are, independent of any view that renders them. The render
 * records, their container and its measured size belong to the animation engine instance that
 * built them.
 */
export interface LyricsData {
  syncType: LyricSyncType;
  tabSelector: HTMLElement;
}

/**
 * Processes lyrics data and prepares it for rendering.
 * Validates data and initiates DOM injection.
 *
 * @param doc - Document the translation nodes are created in
 * @param data - Processed lyrics data
 * @param signal - AbortSignal to cancel async operations
 */
export function processLyrics(doc: Document, data: LyricSourceResultWithMeta, signal?: AbortSignal): void {
  const lyrics = data.lyrics;
  if (!lyrics || lyrics.length === 0) {
    throw new Error(NO_LYRICS_FOUND_LOG);
  }

  // The previous song's container, not the one this injection builds: injectLyrics creates that
  // one later. cleanup() drops both this reference and the element together, so a null here means
  // there is nothing on screen to clear.
  mainView.clearOnScreenLyrics();

  injectLyrics(doc, data, signal);
}

/**
 * Injects lyrics into the DOM with timing, click handlers, and animations.
 * Creates the complete lyrics interface including synchronization support.
 *
 * @param doc - Document the translation nodes are created in
 * @param data - Complete lyrics data object
 * @param signal - AbortSignal to cancel async operations
 */
function injectLyrics(doc: Document, data: LyricSourceResultWithMeta, signal?: AbortSignal): void {
  const injectionId = AppState.currentInjectionId;
  const isStale = () => AppState.currentInjectionId !== injectionId;

  const lyrics = data.lyrics!;
  cleanup();
  disableNativeLyricsFocus();

  const lyricsWrapper = createLyricsWrapper();
  lyricsWrapper.removeAttribute("is-empty");

  const noLyrics = lyrics[0].words === t("lyrics_notFound");

  flushLoader();

  mainView.setLyrics(lyrics, {
    mount: lyricsWrapper,
    loaderVisible: false,
    noLyrics,
    language: data.language,
  });

  const lines: readonly LineData[] = mainView.lines;

  const tabSelector = document.getElementsByClassName(TAB_HEADER_CLASS)[1] as HTMLElement;

  // Set before addFooter so the dock controls read the current song's lyric data.
  AppState.lyricData = { syncType: mainView.syncType, tabSelector };

  // The placeholder carries no provider: there is nothing to attribute and nothing for the dock to control.
  if (data.providerKey) {
    addFooter(data.providerKey);
  } else {
    unmountDock();
  }

  void processBatchTranslations(doc, data, lines, isStale, signal);

  if (data.segmentMap) {
    applySegmentMapToLyrics(lines, data.segmentMap);
  }

  AppState.areLyricsTicking = true;
  mainView.relayout();

  AppState.areLyricsLoaded = true;
}

/**
 * Handles batch translation processing.
 */
async function processBatchTranslations(
  doc: Document,
  data: LyricSourceResultWithMeta,
  linesData: readonly LineData[],
  isStale: () => boolean,
  signal?: AbortSignal
): Promise<void> {
  const lyrics = data.lyrics!;
  const targetTranslationLang = AppState.translationLanguage;
  const isTranslateEnabled = AppState.isTranslateEnabled;

  const translationBatch: { index: number; text: string }[] = [];

  let sourceLanguage = data.language;
  let didInjectCachedContent = false;

  // 1. Identify what needs to be translated
  lyrics.forEach((item, index) => {
    if (item.isInstrumental) return;

    const lineData = linesData[index];
    const lyricElement = lineData.lyricElement;

    // Authoring tools stamp a default xml:lang on every file, so a language the script contradicts cannot veto.
    const scriptLanguage = detectNonLatinLanguage(item.words);
    const trustedLanguage =
      sourceLanguage && scriptLanguage && !langCodesMatch(sourceLanguage, scriptLanguage) ? undefined : sourceLanguage;

    // --- Translation ---
    const isSourceLangDisabled =
      !!trustedLanguage && languageMatchesAny(trustedLanguage, AppState.translationDisabledLanguages);

    if (isTranslateEnabled && !isSourceLangDisabled) {
      let translationResult: string | null = null;
      let translationLanguage = targetTranslationLang;

      const matchedLang =
        item.translations && Object.keys(item.translations).find(lang => langCodesMatch(targetTranslationLang, lang));
      if (item.translations && matchedLang) {
        translationResult = item.translations[matchedLang];
        translationLanguage = matchedLang;
      } else if (item.translation && langCodesMatch(targetTranslationLang, item.translation.lang)) {
        translationResult = item.translation.text;
        translationLanguage = item.translation.lang;
      } else {
        const cached = getTranslationFromCache(item.words, targetTranslationLang);
        translationResult = cached?.translatedText || null;
      }

      if (translationResult && !isSameText(translationResult, item.words)) {
        injectTranslation(doc, lyricElement, translationResult, translationLanguage);
        didInjectCachedContent = true;
      } else if (sourceLanguage !== targetTranslationLang || containsNonLatin(item.words) || !sourceLanguage) {
        translationBatch.push({ index, text: item.words });
      }
    }
  });

  if (didInjectCachedContent) {
    lyricsElementAdded();
  }

  if (isStale()) return;

  // 2. Perform Batch Requests
  if (translationBatch.length > 0) {
    const response = await translateBatch({
      lines: translationBatch.map(b => b.text),
      targetLanguage: targetTranslationLang,
      signal,
    });
    if (isStale()) return;

    if (!sourceLanguage && response.detectedLanguage) {
      sourceLanguage = response.detectedLanguage;
      mainView.setLanguage(sourceLanguage);
    }

    if (languageMatchesAny(sourceLanguage || "", AppState.translationDisabledLanguages)) return;

    response.results.forEach((result, i) => {
      if (result) {
        const originalIndex = translationBatch[i].index;
        injectTranslation(doc, linesData[originalIndex].lyricElement, result.translatedText, targetTranslationLang);
      }
    });
    lyricsElementAdded();
  }
}

/**
 * Compares strings without care for punctuation or capitalization
 * @param str1
 * @param str2
 */
function isSameText(str1: string, str2: string): boolean {
  str1 = str1
    .toLowerCase()
    .replaceAll(/(\p{P})/gu, "")
    .trim();
  str2 = str2
    .toLowerCase()
    .replaceAll(/(\p{P})/gu, "")
    .trim();

  return str1 === str2;
}
