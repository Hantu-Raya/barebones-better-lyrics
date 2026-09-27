// Barebones Better Lyrics options page. Every change is written straight to chrome.storage on its
// `change` event; the Music page applies it through storage.onChanged (no tabs messaging).

import { getLanguageDisplayName, initI18n, loadLocaleOverride, SUPPORTED_LOCALES, t } from "@core/i18n";
import { clearAllOffsets, clearCache, getOffsetInfo } from "@core/storage";

const MAX_OFFSET_SECONDS = 30;
const OFFSET_KEYS = ["globalLyricOffset", "richsyncOffsetTrim", "lineOffsetTrim"] as const;

const DEFAULTS = {
  isTranslateEnabled: false,
  translationLanguage: "en",
  translationDisabledLanguages: [] as string[],
  uiLanguage: "auto",
  globalLyricOffset: 0,
  richsyncOffsetTrim: 0,
  lineOffsetTrim: 0,
};

let translationDisabledLanguages: string[] = [];

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// -- Status --------------------------

let statusTimer: number | undefined;

function showStatus(message: string): void {
  const status = byId<HTMLElement>("status");
  status.textContent = message;
  status.classList.add("active");
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    status.classList.remove("active");
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
    }, 200);
  }, 2500);
}

// -- Validation --------------------------

function translationLanguageCodes(): string[] {
  return Array.from(byId<HTMLSelectElement>("translationLanguage").options)
    .map(option => option.value)
    .filter(Boolean);
}

function isValidTranslationLanguage(code: unknown): code is string {
  return typeof code === "string" && translationLanguageCodes().includes(code);
}

function isValidUiLanguage(code: unknown): code is string {
  return code === "auto" || SUPPORTED_LOCALES.some(locale => locale.code === code);
}

function parseOffset(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number) || Math.abs(number) > MAX_OFFSET_SECONDS) return null;
  return Math.round(number * 10) / 10;
}

// -- Translation --------------------------

function renderTranslationLanguagePills(): void {
  const container = byId<HTMLElement>("translation-pills-container");
  container.replaceChildren();

  for (const langCode of translationLanguageCodes()) {
    const langName = getLanguageDisplayName(langCode);
    const excluded = translationDisabledLanguages.includes(langCode);

    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `lang-pill${excluded ? " disabled" : ""}`;
    pill.dataset.langCode = langCode;
    pill.dataset.langName = langName.toLowerCase();
    pill.setAttribute("aria-pressed", String(excluded));
    pill.textContent = langName;
    container.appendChild(pill);
  }
  filterLanguagePills(byId<HTMLInputElement>("translation-search").value);
}

function filterLanguagePills(query: string): void {
  const normalized = query.toLowerCase().trim();
  for (const pill of byId<HTMLElement>("translation-pills-container").querySelectorAll<HTMLElement>(".lang-pill")) {
    const matches =
      (pill.dataset.langName ?? "").includes(normalized) || (pill.dataset.langCode ?? "").includes(normalized);
    pill.classList.toggle("lang-pill-hidden", !matches);
  }
}

function initTranslation(): void {
  byId<HTMLInputElement>("translate").addEventListener("change", event => {
    void chrome.storage.sync.set({ isTranslateEnabled: (event.target as HTMLInputElement).checked });
  });

  const languageSelect = byId<HTMLSelectElement>("translationLanguage");
  languageSelect.addEventListener("change", () => {
    if (!isValidTranslationLanguage(languageSelect.value)) {
      languageSelect.value = DEFAULTS.translationLanguage;
    }
    void chrome.storage.sync.set({ translationLanguage: languageSelect.value });
  });

  byId<HTMLElement>("translation-pills-container").addEventListener("click", event => {
    const pill = (event.target as HTMLElement).closest<HTMLElement>("[data-lang-code]");
    const code = pill?.dataset.langCode;
    if (!code) return;
    translationDisabledLanguages = translationDisabledLanguages.includes(code)
      ? translationDisabledLanguages.filter(lang => lang !== code)
      : [...translationDisabledLanguages, code];
    void chrome.storage.sync.set({ translationDisabledLanguages });
    renderTranslationLanguagePills();
    byId<HTMLElement>("translation-pills-container")
      .querySelector<HTMLElement>(`[data-lang-code="${CSS.escape(code)}"]`)
      ?.focus();
  });

  const search = byId<HTMLInputElement>("translation-search");
  search.addEventListener("input", () => filterLanguagePills(search.value));
}

// -- UI language --------------------------

function initUiLanguage(current: string): void {
  const select = byId<HTMLSelectElement>("uiLanguage");

  const autoOption = document.createElement("option");
  autoOption.value = "auto";
  autoOption.textContent = `${t("options_language_displayLanguageAuto")} (${chrome.i18n.getUILanguage()})`;
  select.appendChild(autoOption);

  for (const locale of SUPPORTED_LOCALES) {
    const option = document.createElement("option");
    option.value = locale.code;
    option.textContent = locale.nativeName;
    select.appendChild(option);
  }
  select.value = isValidUiLanguage(current) ? current : "auto";

  select.addEventListener("change", async () => {
    const value = isValidUiLanguage(select.value) ? select.value : "auto";
    await chrome.storage.sync.set({ uiLanguage: value });
    location.reload();
  });
}

// -- Timing --------------------------

function initOffsets(): void {
  for (const key of OFFSET_KEYS) {
    const input = byId<HTMLInputElement>(key);
    input.addEventListener("change", () => {
      const value = parseOffset(input.value);
      if (value === null) {
        input.setAttribute("aria-invalid", "true");
        showStatus(t("options_bb_offsetInvalid"));
        return;
      }
      input.removeAttribute("aria-invalid");
      input.value = String(value);
      void chrome.storage.sync.set({ [key]: value });
    });
  }
}

// -- Data --------------------------

function formatBytes(bytes: number): string {
  if (!+bytes) return "0 Bytes";
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${sizes[i]}`;
}

function updateCacheInfo(cacheInfo: unknown): void {
  const info = (cacheInfo ?? {}) as { count?: unknown; size?: unknown };
  const count = typeof info.count === "number" ? info.count : 0;
  const size = typeof info.size === "number" ? info.size : 0;
  byId<HTMLElement>("lyrics-count").textContent = String(count);
  byId<HTMLElement>("cache-size").textContent = formatBytes(size);
}

function initData(): void {
  byId<HTMLButtonElement>("clear-cache").addEventListener("click", async () => {
    try {
      await clearCache();
      // The Music page clears its in-memory translation cache and reloads when this changes.
      await chrome.storage.sync.set({ cacheClearedAt: Date.now() });
      showStatus(t("options_alert_cacheCleared"));
    } catch {
      showStatus(t("options_alert_cacheClearFailed"));
    }
  });

  byId<HTMLButtonElement>("clear-offsets").addEventListener("click", async () => {
    if (!window.confirm(t("options_bb_resetOffsetsConfirm"))) return;
    await clearAllOffsets();
    byId<HTMLElement>("offset-count").textContent = String((await getOffsetInfo()).count);
    showStatus(t("options_bb_offsetsReset"));
  });
}

// -- Load and live updates --------------------------

function applyStoredValues(items: Record<string, unknown>): void {
  byId<HTMLInputElement>("translate").checked = items.isTranslateEnabled === true;

  byId<HTMLSelectElement>("translationLanguage").value = isValidTranslationLanguage(items.translationLanguage)
    ? items.translationLanguage
    : DEFAULTS.translationLanguage;

  translationDisabledLanguages = Array.isArray(items.translationDisabledLanguages)
    ? items.translationDisabledLanguages.filter(isValidTranslationLanguage)
    : [];
  renderTranslationLanguagePills();

  for (const key of OFFSET_KEYS) byId<HTMLInputElement>(key).value = String(parseOffset(items[key]) ?? 0);
}

function listenForStorageChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.cacheInfo) updateCacheInfo(changes.cacheInfo.newValue);
    // Reflect edits made from the Music page dock (translate toggle, offsets) while this page is open.
    if (changes.isTranslateEnabled) {
      byId<HTMLInputElement>("translate").checked = changes.isTranslateEnabled.newValue === true;
    }
    for (const key of OFFSET_KEYS) {
      const change = changes[key];
      if (change && document.activeElement !== byId(key)) {
        byId<HTMLInputElement>(key).value = String(parseOffset(change.newValue) ?? 0);
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadLocaleOverride();
  initI18n();

  const version = chrome.runtime.getManifest().version;
  byId<HTMLElement>("version").textContent = version;
  byId<HTMLElement>("version-badge").textContent = version;

  const items = (await chrome.storage.sync.get({ ...DEFAULTS, cacheInfo: null })) as Record<string, unknown>;
  initUiLanguage(typeof items.uiLanguage === "string" ? items.uiLanguage : "auto");
  initTranslation();
  initOffsets();
  initData();
  applyStoredValues(items);
  updateCacheInfo(items.cacheInfo);
  byId<HTMLElement>("offset-count").textContent = String((await getOffsetInfo()).count);
  listenForStorageChanges();
});
