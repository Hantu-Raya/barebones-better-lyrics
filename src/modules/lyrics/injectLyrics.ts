import { NO_LYRICS_FOUND_LOG, TAB_HEADER_CLASS } from "@constants";
import { AppState } from "@core/appState";
import { t } from "@core/i18n";
import { applySegmentMapToLyrics, type LyricSourceResultWithMeta } from "@modules/lyrics/lyrics";
import { getTranslationFromCache, translateBatch } from "@modules/lyrics/translation";
import { addFooter, cleanup, createLyricsWrapper, flushLoader, renderLoader, showNoLyricsState } from "@modules/ui/dom";
import { lyricsElementAdded, mainView } from "@modules/ui/mainLyricsView";
import { disableNativeLyricsFocus } from "@modules/ui/nativeLyricsFocus";
import { injectTranslation, type LineData } from "@braccato/core";
import { containsNonLatin, detectNonLatinLanguage } from "@braccato/core/text";
import { langCodesMatch, languageMatchesAny } from "@utils";

export type { LineData };

/**
 * What the translation pass puts on one line. It inject straight into the main
 * view's elements and write nothing back to the `Lyric` objects, so a second view building from the
 * same lines would otherwise show neither.
 */
interface LyricLineDecoration {
  translation?: string;
  translationLanguage?: string;
}

/**
 * Keyed by the line's index in the lyrics array, which is the only handle a view that built its own
 * elements has on the line these belong to.
 */
export type LyricDecorations = Record<number, LyricLineDecoration>;

function recordLyricDecoration(index: number, decoration: LyricLineDecoration): void {
  AppState.lyricDecorations[index] = { ...AppState.lyricDecorations[index], ...decoration };
}

function updateLyricLanguage(language: string): void {
  if (AppState.lyricData) AppState.lyricData.language = language;
  mainView.setLanguage(language);
}

function isTranslationDisabledForLang(lang: string): boolean {
  return languageMatchesAny(lang, AppState.translationDisabledLanguages);
}

export type SyncType = "richsync" | "synced" | "none";

/**
 * What the current song's lyrics are, independent of any view that renders them. The render
 * records, their container and its measured size belong to the animation engine instance that
 * built them.
 */
export interface LyricsData {
  syncType: SyncType;
  isMusicVideoSynced: boolean;
  tabSelector: HTMLElement;
  hasNonLatin: boolean;
  language?: string | null;
}

/**
 * Processes lyrics data and prepares it for rendering.
 * Sets language settings, validates data, and initiates DOM injection.
 *
 * @param doc - Document the translation nodes are created in
 * @param data - Processed lyrics data
 * @param keepLoaderVisible
 * @param signal - AbortSignal to cancel async operations
 * @param data.language - Language code for the lyrics
 * @param data.lyrics - Array of lyric lines
 */
export function processLyrics(
  doc: Document,
  data: LyricSourceResultWithMeta,
  keepLoaderVisible = false,
  signal?: AbortSignal
): void {
  const lyrics = data.lyrics;
  if (!lyrics || lyrics.length === 0) {
    throw new Error(NO_LYRICS_FOUND_LOG);
  }

  // The previous song's container, not the one this injection builds: injectLyrics creates that
  // one later. cleanup() drops both this reference and the element together, so a null here means
  // there is nothing on screen to clear.
  mainView.clearOnScreenLyrics();

  injectLyrics(doc, data, keepLoaderVisible, signal);
}

/**
 * Injects lyrics into the DOM with timing, click handlers, and animations.
 * Creates the complete lyrics interface including synchronization support.
 *
 * @param doc - Document the translation nodes are created in
 * @param data - Complete lyrics data object
 * @param keepLoaderVisible
 * @param signal - AbortSignal to cancel async operations
 * @param data.lyrics - Array of lyric lines with timing
 * @param [data.source] - Source attribution for lyrics
 */
function injectLyrics(
  doc: Document,
  data: LyricSourceResultWithMeta,
  keepLoaderVisible = false,
  signal?: AbortSignal
): void {
  const injectionId = AppState.currentInjectionId;
  const isStale = () => AppState.currentInjectionId !== injectionId;

  const lyrics = data.lyrics!;
  cleanup();
  disableNativeLyricsFocus();

  const lyricsWrapper = createLyricsWrapper();
  lyricsWrapper.removeAttribute("is-empty");


  const allZero = lyrics.every(item => item.startTimeMs === 0);
  const noLyrics = lyrics[0].words === t("lyrics_notFound");

  if (keepLoaderVisible) {
    renderLoader(true);
  } else {
    flushLoader(allZero && !noLyrics);
  }

  mainView.setLyrics(lyrics, {
    mount: lyricsWrapper,
    loaderVisible: keepLoaderVisible,
    noLyrics,
    language: data.language,
  });

  const syncType: SyncType = mainView.syncType;
  const lines: readonly LineData[] = mainView.lines;

  const tabSelector = document.getElementsByClassName(TAB_HEADER_CLASS)[1] as HTMLElement;

  const lyricsData: LyricsData = {
    syncType: syncType,
    language: data.language,
    isMusicVideoSynced: data.musicVideoSynced === true,
    tabSelector,
    hasNonLatin: lyrics.some(item => !!item.words && containsNonLatin(item.words)),
  };

  // Set before addFooter so the dock controls read the current song's lyric data.
  AppState.lyricData = lyricsData;

  if (!noLyrics) {
    addFooter(data.source, data.providerKey);
  } else {
    showNoLyricsState();
  }

  void processBatchTranslations(doc, data, lines, isStale, signal);

  if (data.segmentMap) {
    applySegmentMapToLyrics(lyricsData, lines, data.segmentMap);
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
    const isSourceLangDisabled = !!trustedLanguage && isTranslationDisabledForLang(trustedLanguage);

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
        recordLyricDecoration(index, { translation: translationResult, translationLanguage });
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
  const promises: Promise<void>[] = [];

  if (translationBatch.length > 0) {
    promises.push(
      (async () => {
        const response = await translateBatch({
          lines: translationBatch.map(b => b.text),
          targetLanguage: targetTranslationLang,
          signal,
        });
        if (isStale()) return;

        if (!sourceLanguage && response.detectedLanguage) {
          sourceLanguage = response.detectedLanguage;
          updateLyricLanguage(sourceLanguage);
        }

        if (isTranslationDisabledForLang(sourceLanguage || "")) return;

        response.results.forEach((result, i) => {
          if (result) {
            const originalIndex = translationBatch[i].index;
            injectTranslation(doc, linesData[originalIndex].lyricElement, result.translatedText, targetTranslationLang);
            recordLyricDecoration(originalIndex, {
              translation: result.translatedText,
              translationLanguage: targetTranslationLang,
            });
          }
        });
        lyricsElementAdded();
      })()
    );
  }

  await Promise.all(promises);
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
