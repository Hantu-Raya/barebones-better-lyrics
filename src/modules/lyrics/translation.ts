import { TRANSLATE_LYRICS_URL, TRANSLATION_ERROR_LOG } from "@constants";
import { logCore } from "@core/logger";

interface TranslationResult {
  originalLanguage: string;
  translatedText: string;
}

const translationCache = new Map<string, TranslationResult>();

interface BatchRequest {
  lines: string[];
  targetLanguage?: string;
  signal?: AbortSignal;
}

interface BatchTranslationResponse {
  results: (TranslationResult | null)[];
  detectedLanguage: string;
}

const BATCH_SEPARATOR = "\n\n;\n\n";
/** Target length of one Google `client=gtx` request URL; lines are batched up to this size. */
const MAX_URL_LENGTH = 15000;

/**
 * Translates a batch of lyric lines in a single request, chunked if necessary.
 */
export async function translateBatch(request: BatchRequest): Promise<BatchTranslationResponse> {
  const { lines, targetLanguage, signal } = request;
  if (!targetLanguage || lines.length === 0) {
    return { results: lines.map(() => null), detectedLanguage: "" };
  }

  const results: (TranslationResult | null)[] = new Array(lines.length).fill(null);
  const toTranslate: { index: number; text: string }[] = [];

  // Check cache first
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "♪") return;

    const cacheKey = `${targetLanguage}_${trimmed}`;
    if (translationCache.has(cacheKey)) {
      results[index] = translationCache.get(cacheKey)!;
    } else {
      toTranslate.push({ index, text: trimmed });
    }
  });

  if (toTranslate.length === 0) {
    return { results, detectedLanguage: results.find(r => r !== null)?.originalLanguage || "" };
  }

  let detectedLanguage = "";

  // Chunk toTranslate based on URL length limits
  const chunks: { index: number; text: string }[][] = [];
  let currentChunk: { index: number; text: string }[] = [];
  let currentEncodedLength = 0;

  const baseUrl = TRANSLATE_LYRICS_URL(targetLanguage, "");
  const separatorEncoded = encodeURIComponent(BATCH_SEPARATOR);

  for (const item of toTranslate) {
    const itemEncoded = encodeURIComponent(item.text);
    // A single line that cannot fit the URL budget on its own is skipped, not sent: Google would
    // reject or truncate it. The line stays untranslated rather than silently mangled.
    if (baseUrl.length + itemEncoded.length > MAX_URL_LENGTH) {
      logCore(TRANSLATION_ERROR_LOG, `Skipping a line whose encoded length (${itemEncoded.length}) exceeds the URL budget`);
      continue;
    }
    const addedLength = (currentChunk.length > 0 ? separatorEncoded.length : 0) + itemEncoded.length;

    if (currentChunk.length > 0 && baseUrl.length + currentEncodedLength + addedLength > MAX_URL_LENGTH) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentEncodedLength = 0;
    }

    currentChunk.push(item);
    currentEncodedLength += (currentChunk.length > 1 ? separatorEncoded.length : 0) + itemEncoded.length;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  for (const chunk of chunks) {
    try {
      const combinedText = chunk.map(item => item.text).join(BATCH_SEPARATOR);
      const url = TRANSLATE_LYRICS_URL(targetLanguage, combinedText);

      const response = await fetch(url, { cache: "force-cache", signal });
      const data = await response.json();

      if (!detectedLanguage) {
        detectedLanguage = data[2] || "";
      }

      let fullTranslatedText = "";
      data[0].forEach((part: string[]) => {
        fullTranslatedText += part[0];
      });

      let translatedLines = fullTranslatedText.split(BATCH_SEPARATOR);

      // Fallback: If Google merged the translations into fewer blocks than expected
      if (translatedLines.length < chunk.length) {
        const semicolonSplit = fullTranslatedText.split(";").filter(l => l.trim().length > 0);
        if (semicolonSplit.length === chunk.length) {
          translatedLines = semicolonSplit;
        } else {
          const singleNewlineSplit = fullTranslatedText.split(/\r?\n/).filter(l => l.trim().length > 0);
          if (singleNewlineSplit.length === chunk.length) {
            translatedLines = singleNewlineSplit;
          } else if (translatedLines.length === 1 && chunk.length > 1) {
            logCore(TRANSLATION_ERROR_LOG, `Batch translation failed to split: expected ${chunk.length} lines, got 1.`);
            translatedLines = [];
          }
        }
      }

      chunk.forEach((item, i) => {
        const translatedText = translatedLines[i]?.trim();
        if (translatedText && translatedText.toLowerCase() !== item.text.toLowerCase()) {
          const result = { originalLanguage: detectedLanguage, translatedText };
          translationCache.set(`${targetLanguage}_${item.text}`, result);
          results[item.index] = result;
        }
      });
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        logCore(TRANSLATION_ERROR_LOG, error);
      }
    }
  }

  return { results, detectedLanguage };
}

export function clearCache(): void {
  translationCache.clear();
}

export function getTranslationFromCache(text: string, targetLanguage: string): TranslationResult | null {
  const cacheKey = `${targetLanguage}_${text.trim()}`;
  return translationCache.get(cacheKey) || null;
}
