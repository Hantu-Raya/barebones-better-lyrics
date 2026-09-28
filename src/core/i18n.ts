import { LOCALE_CODES } from "@core/generated/locales";
import { warnCore } from "@core/logger";

// -- Display Code Mapping --------------------------

const DISPLAY_CODE_MAP: Record<string, string> = {
  "zh-CN": "zh-Hans",
  "zh-TW": "zh-Hant",
};

// -- Supported Locales --------------------------

function getNativeName(code: string): string {
  const bcp47 = code.replace("_", "-");
  const displayCode = DISPLAY_CODE_MAP[bcp47] ?? bcp47;
  try {
    const name = new Intl.DisplayNames([displayCode], { type: "language" }).of(displayCode);
    if (!name) return code;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return code;
  }
}

export const SUPPORTED_LOCALES = LOCALE_CODES.map(code => ({
  code,
  nativeName: getNativeName(code),
}));

// -- Locale Override Engine --------------------------

// No retained message uses placeholders, so an entry resolves to its message text as-is.
interface MessageEntry {
  message: string;
}

let overrideMessages: Record<string, MessageEntry> | null = null;

export async function loadLocaleOverride(): Promise<void> {
  try {
    const items = await chrome.storage.sync.get({ uiLanguage: "auto" });
    const locale = items.uiLanguage as string | undefined;

    if (!locale || locale === "auto") {
      overrideMessages = null;
      return;
    }

    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const response = await fetch(url);
    if (!response.ok) {
      warnCore(`Failed to load locale "${locale}": ${response.status}`);
      overrideMessages = null;
      return;
    }

    overrideMessages = await response.json();
  } catch (e) {
    warnCore(`Failed to load locale override:`, e);
    overrideMessages = null;
  }
}

export function t(key: string): string {
  const override = overrideMessages?.[key];
  if (override) return override.message;

  return chrome.i18n.getMessage(key) || key;
}

export function getLanguageDisplayName(langCode: string): string {
  try {
    const displayCode = DISPLAY_CODE_MAP[langCode] ?? langCode;
    const displayNames = new Intl.DisplayNames([navigator.language], { type: "language" });
    return displayNames.of(displayCode) ?? langCode;
  } catch (e) {
    warnCore(`Failed to get display name for "${langCode}":`, e);
    return langCode;
  }
}

// Re-resolves the override once the display language changes, so later t() calls use it.
export function subscribeToLocaleChanges(): void {
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync" || !changes.uiLanguage) return;
    await loadLocaleOverride();
    injectI18nCssVars();
  });
}

// Nativune: a fork-owned <style> scoped to the fork's overlay, so YouTube's <html> gets no inline style.
export function injectI18nCssVars(): void {
  const text = t("lyrics_adPlaying").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  let style = document.getElementById("blyrics-i18n-vars");
  if (!style) {
    style = document.createElement("style");
    style.id = "blyrics-i18n-vars";
    (document.head ?? document.documentElement).appendChild(style);
  }
  style.textContent = `#blyrics-ad-overlay { --blyrics-text-ad-playing: "${text}"; }`;
}

export function initI18n(): void {
  const msgPattern = /__MSG_(\w+)__/g;

  const processNode = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent) {
      const newText = node.textContent.replace(msgPattern, (_, key) => t(key));
      if (newText !== node.textContent) {
        node.textContent = newText;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      for (const attr of Array.from(el.attributes)) {
        if (attr.value.includes("__MSG_")) {
          attr.value = attr.value.replace(msgPattern, (_, key) => t(key));
        }
      }
      for (const child of Array.from(node.childNodes)) {
        processNode(child);
      }
    }
  };

  processNode(document.body);
  document.title = document.title.replace(msgPattern, (_, key) => t(key));
  document.body.classList.add("i18n-ready");
}
