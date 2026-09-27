// Function to save user options

import {
  DOCK_CONTROL_ORDER_DEFAULT,
  DOCK_DEFAULT_POSITION,
} from "@constants";
import { attachHoldRepeat } from "@core/holdRepeat";
import { getLanguageDisplayName, initI18n, loadLocaleOverride, SUPPORTED_LOCALES, t } from "@core/i18n";
import { clearAllOffsets, getOffsetInfo } from "@core/storage";
import { parseSvgString, syncTypeColors } from "@modules/ui/lyricsDock/icons";
import { mergePreferredProviders } from "@modules/lyrics/providers/providerList";
import Sortable from "sortablejs";

interface Options {
  isLogsEnabled: boolean;
  isAutoSwitchEnabled: boolean;
  isAlbumArtEnabled: boolean;
  isShadersPromoEnabled: boolean;
  isFullScreenDisabled: boolean;
  isFullscreenControlsEnabled: boolean;
  isStylizedAnimationsEnabled: boolean;
  isPassiveScrollEnabled: boolean;
  isTranslateEnabled: boolean;
  translationLanguage: string;
  isCursorAutoHideEnabled: boolean;
  preferredProviderList: string[];
  translationDisabledLanguages: string[];
  uiLanguage: string;
  isControlsDockEnabled: boolean;
  controlsDockPosition: string;
  isControlsDockAutoHideInFullscreenEnabled: boolean;
  isDockSourceEnabled: boolean;
  isDockTranslateEnabled: boolean;
  isDockOffsetEnabled: boolean;
  isDockRefreshEnabled: boolean;
  dockControlsOrder: string[];
  globalLyricOffset: number;
  richsyncOffsetTrim: number;
  lineOffsetTrim: number;
}

const saveOptions = (): void => {
  const options = getOptionsFromForm();
  saveOptionsToStorage(options);
};

// Coalesces rapid changes (spam-clicking a control tile or quick reordering) into a single
// write so chrome.storage's write-per-minute quota is not exceeded.
let saveOptionsTimer: ReturnType<typeof setTimeout> | null = null;
const debouncedSaveOptions = (): void => {
  if (saveOptionsTimer) clearTimeout(saveOptionsTimer);
  saveOptionsTimer = setTimeout(saveOptions, 400);
};

// Function to get options from form elements
const getOptionsFromForm = (): Options => {
  const preferredProviderList: string[] = [];
  const providerElems = document.getElementById("providers-list")!.children;
  for (let i = 0; i < providerElems.length; i++) {
    let id = providerElems[i].id.slice(2);
    if (!(providerElems[i].children[1].children[0] as HTMLInputElement).checked) {
      id = "d_" + id;
    }
    preferredProviderList.push(id);
  }

  return {
    isLogsEnabled: (document.getElementById("logs") as HTMLInputElement).checked,
    isAutoSwitchEnabled: (document.getElementById("autoSwitch") as HTMLInputElement).checked,
    isAlbumArtEnabled: (document.getElementById("albumArt") as HTMLInputElement).checked,
    isShadersPromoEnabled: (document.getElementById("isShadersPromoEnabled") as HTMLInputElement).checked,
    isFullScreenDisabled: (document.getElementById("isFullScreenDisabled") as HTMLInputElement).checked,
    isFullscreenControlsEnabled: (document.getElementById("isFullscreenControlsEnabled") as HTMLInputElement).checked,
    isStylizedAnimationsEnabled: (document.getElementById("isStylizedAnimationsEnabled") as HTMLInputElement).checked,
    isPassiveScrollEnabled: (document.getElementById("isPassiveScrollEnabled") as HTMLInputElement).checked,
    isTranslateEnabled: (document.getElementById("translate") as HTMLInputElement).checked,
    translationLanguage: (document.getElementById("translationLanguage") as HTMLInputElement).value,
    isCursorAutoHideEnabled: (document.getElementById("cursorAutoHide") as HTMLInputElement).checked,
    preferredProviderList: preferredProviderList,
    translationDisabledLanguages: translationDisabledLanguages,
    uiLanguage: (document.getElementById("uiLanguage") as HTMLSelectElement).value,
    isControlsDockEnabled: (document.getElementById("isUnisonPinnedDockEnabled") as HTMLInputElement).checked,
    controlsDockPosition: getSelectedUnisonPosition(),
    isControlsDockAutoHideInFullscreenEnabled: (
      document.getElementById("isUnisonAutoHideInFullscreenEnabled") as HTMLInputElement
    ).checked,
    isDockSourceEnabled: (document.getElementById("isDockSourceEnabled") as HTMLInputElement).checked,
    isDockTranslateEnabled: (document.getElementById("isDockTranslateEnabled") as HTMLInputElement).checked,
    isDockOffsetEnabled: (document.getElementById("isDockOffsetEnabled") as HTMLInputElement).checked,
    isDockRefreshEnabled: (document.getElementById("isDockRefreshEnabled") as HTMLInputElement).checked,
    dockControlsOrder: getDockControlsOrder(),
    globalLyricOffset: parseFloat((document.getElementById("globalLyricOffset") as HTMLInputElement).value) || 0,
    richsyncOffsetTrim: parseFloat((document.getElementById("richsyncOffsetTrim") as HTMLInputElement).value) || 0,
    lineOffsetTrim: parseFloat((document.getElementById("lineOffsetTrim") as HTMLInputElement).value) || 0,
  };
};

function getSelectedUnisonPosition(): string {
  const selected = document.querySelector<HTMLElement>("#unison-position-frame .position-cell[data-selected='true']");
  return selected?.dataset.pos ?? DOCK_DEFAULT_POSITION;
}

function getDockControlsOrder(): string[] {
  const cells = document.querySelectorAll<HTMLElement>(".controls-shown-picker .control-cell");
  const order = Array.from(cells, cell => cell.dataset.control).filter((key): key is string => !!key);
  return order.length ? order : [...DOCK_CONTROL_ORDER_DEFAULT];
}

function setDockControlsOrderInForm(order: string[]): void {
  const picker = document.querySelector(".controls-shown-picker");
  if (!picker || !Array.isArray(order)) return;
  for (const key of order) {
    const cell = picker.querySelector(`.control-cell[data-control="${key}"]`);
    if (cell) picker.appendChild(cell);
  }
  // A control added after the stored order was written is absent from it, so re-append it here;
  // otherwise it stays put while every listed cell moves past it and it ends up first.
  for (const cell of Array.from(picker.querySelectorAll<HTMLElement>(".control-cell"))) {
    if (cell.dataset.control && !order.includes(cell.dataset.control)) picker.appendChild(cell);
  }
}

// Function to save options to Chrome storage
const saveOptionsToStorage = (options: Options): void => {
  chrome.storage.sync.set(options, () => {
    chrome.tabs.query({ url: "https://music.youtube.com/*" }, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id!, {
          action: "updateSettings",
          settings: options,
        });
      });
    });
  });
};

// Function to show save confirmation message
const _showSaveConfirmation = (): void => {
  const status = document.getElementById("status")!;
  status.textContent = "Options saved. Refresh tab to apply changes.";
  status.classList.add("active");
  setTimeout(hideSaveConfirmation, 4000);
};

// Function to hide save confirmation message
const hideSaveConfirmation = (): void => {
  const status = document.getElementById("status")!;
  status.classList.remove("active");
  setTimeout(() => {
    status.textContent = "";
  }, 200);
};

// Function to show alert message
const showAlert = (message: string): void => {
  const status = document.getElementById("status")!;
  status.innerText = message;
  status.classList.add("active");

  setTimeout(() => {
    status.classList.remove("active");
    setTimeout(() => {
      status.innerText = "";
    }, 200);
  }, 2000);
};

// Function to clear transient lyrics
const clearTransientLyrics = (callback?: () => void): void => {
  chrome.tabs.query({ url: "https://music.youtube.com/*" }, tabs => {
    if (tabs.length === 0) {
      updateCacheInfo(null);
      showAlert(t("options_alert_cacheCleared"));
      if (callback && typeof callback === "function") callback();
      return;
    }

    let completedTabs = 0;
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id!, { action: "clearCache" }, response => {
        completedTabs++;
        if (completedTabs === tabs.length) {
          if (response?.success) {
            updateCacheInfo(null);
            showAlert(t("options_alert_cacheCleared"));
          } else {
            showAlert(t("options_alert_cacheClearFailed"));
          }
          if (callback && typeof callback === "function") callback();
        }
      });
    });
  });
};

const _formatBytes = (bytes: number, decimals = 2): string => {
  if (!+bytes) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
};

// Function to subscribe to cache info updates
const subscribeToCacheInfo = (): void => {
  chrome.storage.sync.get("cacheInfo", items => {
    //@ts-ignore -- I'm lazy someone fix this
    updateCacheInfo(items);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.cacheInfo) {
      updateCacheInfo({
        cacheInfo: changes.cacheInfo.newValue as {
          count: number;
          size: number;
        },
      });
    }
  });
};

// Function to update cache info
const updateCacheInfo = (items: { cacheInfo: { count: number; size: number } } | null): void => {
  if (!items) {
    showAlert(t("options_alert_nothingToClear"));
    return;
  }
  const cacheInfo = items.cacheInfo || { count: 0, size: 0 };
  const cacheCount = document.getElementById("lyrics-count")!;
  const cacheSize = document.getElementById("cache-size")!;

  cacheCount.textContent = cacheInfo.count.toString();
  cacheSize.textContent = _formatBytes(cacheInfo.size);
};

// Function to restore user options
const restoreOptions = (): void => {
  subscribeToCacheInfo();

  const defaultOptions: Options = {
    isLogsEnabled: true,
    isAutoSwitchEnabled: false,
    isAlbumArtEnabled: true,
    isShadersPromoEnabled: true,
    isCursorAutoHideEnabled: true,
    isFullScreenDisabled: false,
    isFullscreenControlsEnabled: true,
    isStylizedAnimationsEnabled: true,
    isPassiveScrollEnabled: true,
    isTranslateEnabled: false,
    translationLanguage: "en",
    preferredProviderList: [
      "bLyrics-richsynced",
      "bLyrics-synced",
      "lrclib-synced",
      "yt-lyrics",
    ],
    translationDisabledLanguages: [],
    uiLanguage: "auto",
    isControlsDockEnabled: true,
    controlsDockPosition: DOCK_DEFAULT_POSITION,
    isControlsDockAutoHideInFullscreenEnabled: true,
    isDockSourceEnabled: true,
    isDockTranslateEnabled: true,
    isDockOffsetEnabled: true,
    isDockRefreshEnabled: false,
    dockControlsOrder: [...DOCK_CONTROL_ORDER_DEFAULT],
    globalLyricOffset: 0,
    richsyncOffsetTrim: 0,
    lineOffsetTrim: 0,
  };

  const readKeys = [
    ...Object.keys(defaultOptions),
    "isUnisonPinnedDockEnabled",
    "unisonPinnedDockPosition",
    "isUnisonAutoHideInFullscreenEnabled",
  ];

  chrome.storage.sync.get(readKeys, (raw: { [key: string]: any }) => {
    setOptionsInForm({
      ...defaultOptions,
      ...(raw as Options),
      isControlsDockEnabled:
        raw.isControlsDockEnabled ?? raw.isUnisonPinnedDockEnabled ?? defaultOptions.isControlsDockEnabled,
      controlsDockPosition:
        raw.controlsDockPosition ?? raw.unisonPinnedDockPosition ?? defaultOptions.controlsDockPosition,
      isControlsDockAutoHideInFullscreenEnabled:
        raw.isControlsDockAutoHideInFullscreenEnabled ??
        raw.isUnisonAutoHideInFullscreenEnabled ??
        defaultOptions.isControlsDockAutoHideInFullscreenEnabled,
    });
  });

  document.getElementById("clear-cache")!.addEventListener("click", () => clearTransientLyrics());
  setupUnisonActionsModal();
  initOffsetModal();
};

// Function to set options in form elements
const setOptionsInForm = (items: Options): void => {
  (document.getElementById("logs") as HTMLInputElement).checked = items.isLogsEnabled;
  (document.getElementById("albumArt") as HTMLInputElement).checked = items.isAlbumArtEnabled;
  (document.getElementById("isShadersPromoEnabled") as HTMLInputElement).checked = items.isShadersPromoEnabled;
  (document.getElementById("autoSwitch") as HTMLInputElement).checked = items.isAutoSwitchEnabled;
  (document.getElementById("cursorAutoHide") as HTMLInputElement).checked = items.isCursorAutoHideEnabled;
  (document.getElementById("isFullScreenDisabled") as HTMLInputElement).checked = items.isFullScreenDisabled;
  (document.getElementById("isFullscreenControlsEnabled") as HTMLInputElement).checked =
    items.isFullscreenControlsEnabled;
  (document.getElementById("isStylizedAnimationsEnabled") as HTMLInputElement).checked =
    items.isStylizedAnimationsEnabled;
  (document.getElementById("isPassiveScrollEnabled") as HTMLInputElement).checked = items.isPassiveScrollEnabled;
  (document.getElementById("translate") as HTMLInputElement).checked = items.isTranslateEnabled;
  (document.getElementById("translationLanguage") as HTMLInputElement).value = items.translationLanguage;
  (document.getElementById("uiLanguage") as HTMLSelectElement).value = items.uiLanguage;
  (document.getElementById("isUnisonPinnedDockEnabled") as HTMLInputElement).checked = items.isControlsDockEnabled;
  (document.getElementById("isUnisonAutoHideInFullscreenEnabled") as HTMLInputElement).checked =
    items.isControlsDockAutoHideInFullscreenEnabled;
  setUnisonPositionInForm(items.controlsDockPosition);
  (document.getElementById("isDockSourceEnabled") as HTMLInputElement).checked = items.isDockSourceEnabled;
  (document.getElementById("isDockTranslateEnabled") as HTMLInputElement).checked = items.isDockTranslateEnabled;
  (document.getElementById("isDockOffsetEnabled") as HTMLInputElement).checked = items.isDockOffsetEnabled;
  (document.getElementById("isDockRefreshEnabled") as HTMLInputElement).checked = items.isDockRefreshEnabled;
  setOffsetDisplay("globalLyricOffset", items.globalLyricOffset);
  setOffsetDisplay("richsyncOffsetTrim", items.richsyncOffsetTrim);
  setOffsetDisplay("lineOffsetTrim", items.lineOffsetTrim);
  setDockControlsOrderInForm(items.dockControlsOrder);
  syncUnisonModalDependentState(items.isControlsDockEnabled);
  translationDisabledLanguages = items.translationDisabledLanguages || [];
  updateExclusionsConfigVisibility();
  renderTranslationLanguagePills();

  const providersListElem = document.getElementById("providers-list")!;
  providersListElem.replaceChildren();

  const defaultProviderOrder = [
    "bLyrics-richsynced",
    "bLyrics-synced",
    "lrclib-synced",
    "yt-lyrics",
  ];

  for (const providerId of mergePreferredProviders(items.preferredProviderList, defaultProviderOrder)) {
    const disabled = providerId.startsWith("d_");
    const rawProviderId = disabled ? providerId.slice(2) : providerId;
    const providerElem = createProviderElem(rawProviderId, !disabled);

    if (providerElem === null) continue;
    providersListElem.appendChild(providerElem);
  }
};
type SyncType = "syllable" | "word" | "line" | "unsynced";

interface ProviderInfo {
  name: string;
  syncType: SyncType;
}

const getProviderIdToInfoMap = (): { [key: string]: ProviderInfo } => ({
  "bLyrics-richsynced": { name: t("options_provider_betterLyrics"), syncType: "syllable" },
  "bLyrics-synced": { name: t("options_provider_betterLyrics"), syncType: "line" },
  "lrclib-synced": { name: t("options_provider_lrclib"), syncType: "line" },
  "yt-lyrics": { name: t("options_provider_youtube"), syncType: "line" },
});

const getSyncTypeConfig = (): {
  [key in SyncType]: { label: string; icon: string; tooltip: string };
} => ({
  syllable: {
    label: t("options_syncType_syllable"),
    tooltip: t("options_syncType_syllable_tooltip"),
    icon: `<svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="636" y="239" width="389.981" height="233.271" rx="48" fill-opacity="0.5"/><path d="M0 335C0 289.745 0 267.118 14.0589 253.059C28.1177 239 50.7452 239 96 239H213C243.17 239 258.255 239 267.627 248.373C277 257.745 277 272.83 277 303V408C277 438.17 277 453.255 267.627 462.627C258.255 472 243.17 472 213 472H96C50.7452 472 28.1177 472 14.0589 457.941C0 443.882 0 421.255 0 376V335Z"/><path d="M337 304C337 273.83 337 258.745 346.373 249.373C355.745 240 370.83 240 401 240H460C505.255 240 527.882 240 541.941 254.059C556 268.118 556 290.745 556 336V377C556 422.255 556 444.882 541.941 458.941C527.882 473 505.255 473 460 473H401C370.83 473 355.745 473 346.373 463.627C337 454.255 337 439.17 337 409V304Z" fill-opacity="0.5"/><rect y="552.271" width="1024" height="233" rx="48" fill-opacity="0.5"/></svg>`,
  },
  word: {
    label: t("options_syncType_word"),
    tooltip: t("options_syncType_word_tooltip"),
    icon: `<svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="636" y="239" width="389.981" height="233.271" rx="48" fill-opacity="0.5"/><path d="M0 335C0 289.745 0 267.118 14.0589 253.059C28.1177 239 50.7452 239 96 239H213C243.17 239 258.255 239 267.627 248.373C277 257.745 277 272.83 277 303V408C277 438.17 277 453.255 267.627 462.627C258.255 472 243.17 472 213 472H96C50.7452 472 28.1177 472 14.0589 457.941C0 443.882 0 421.255 0 376V335Z"/><path d="M337 304C337 273.83 337 258.745 346.373 249.373C355.745 240 370.83 240 401 240H460C505.255 240 527.882 240 541.941 254.059C556 268.118 556 290.745 556 336V377C556 422.255 556 444.882 541.941 458.941C527.882 473 505.255 473 460 473H401C370.83 473 355.745 473 346.373 463.627C337 454.255 337 439.17 337 409V304Z"/><rect y="552.271" width="1024" height="233" rx="48" fill-opacity="0.5"/></svg>`,
  },
  line: {
    label: t("options_syncType_line"),
    tooltip: t("options_syncType_line_tooltip"),
    icon: `<svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="636" y="239" width="389.981" height="233.271" rx="48"/><path d="M0 335C0 289.745 0 267.118 14.0589 253.059C28.1177 239 50.7452 239 96 239H213C243.17 239 258.255 239 267.627 248.373C277 257.745 277 272.83 277 303V408C277 438.17 277 453.255 267.627 462.627C258.255 472 243.17 472 213 472H96C50.7452 472 28.1177 472 14.0589 457.941C0 443.882 0 421.255 0 376V335Z"/><path d="M337 304C337 273.83 337 258.745 346.373 249.373C355.745 240 370.83 240 401 240H460C505.255 240 527.882 240 541.941 254.059C556 268.118 556 290.745 556 336V377C556 422.255 556 444.882 541.941 458.941C527.882 473 505.255 473 460 473H401C370.83 473 355.745 473 346.373 463.627C337 454.255 337 439.17 337 409V304Z"/><rect y="552.271" width="1024" height="233" rx="48" fill-opacity="0.5"/></svg>`,
  },
  unsynced: {
    label: t("options_syncType_unsynced"),
    tooltip: t("options_syncType_unsynced_tooltip"),
    icon: `<svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><rect x="636" y="239" width="389.981" height="233.271" rx="48" fill-opacity="0.5"/><path d="M0 335C0 289.745 0 267.118 14.0589 253.059C28.1177 239 50.7452 239 96 239H213C243.17 239 258.255 239 267.627 248.373C277 257.745 277 272.83 277 303V408C277 438.17 277 453.255 267.627 462.627C258.255 472 243.17 472 213 472H96C50.7452 472 28.1177 472 14.0589 457.941C0 443.882 0 421.255 0 376V335Z" fill-opacity="0.5"/><path d="M337 304C337 273.83 337 258.745 346.373 249.373C355.745 240 370.83 240 401 240H460C505.255 240 527.882 240 541.941 254.059C556 268.118 556 290.745 556 336V377C556 422.255 556 444.882 541.941 458.941C527.882 473 505.255 473 460 473H401C370.83 473 355.745 473 346.373 463.627C337 454.255 337 439.17 337 409V304Z" fill-opacity="0.5"/><rect y="552.271" width="1024" height="233" rx="48" fill-opacity="0.5"/></svg>`,
  },
});

function createProviderElem(providerId: string, checked = true): HTMLLIElement | null {
  const providerIdToInfoMap = getProviderIdToInfoMap();
  if (!Object.hasOwn(providerIdToInfoMap, providerId)) {
    console.warn("Unknown provider ID:", providerId);
    return null;
  }

  const providerInfo = providerIdToInfoMap[providerId];
  const syncConfig = getSyncTypeConfig()[providerInfo.syncType];

  const liElem = document.createElement("li");
  liElem.classList.add("sortable-item");
  liElem.id = "p-" + providerId;

  const handleElem = document.createElement("span");
  handleElem.classList.add("sortable-handle");
  liElem.appendChild(handleElem);

  const labelElem = document.createElement("label");
  labelElem.classList.add("checkbox-container");

  const checkboxElem = document.createElement("input");
  checkboxElem.classList.add("provider-checkbox");
  checkboxElem.type = "checkbox";
  checkboxElem.checked = checked;
  checkboxElem.id = "p-" + providerId + "-checkbox";
  labelElem.appendChild(checkboxElem);

  const checkmarkElem = document.createElement("span");
  checkmarkElem.classList.add("checkmark");
  labelElem.appendChild(checkmarkElem);

  const textElem = document.createElement("span");
  textElem.classList.add("provider-name");
  textElem.textContent = providerInfo.name;
  labelElem.appendChild(textElem);

  liElem.appendChild(labelElem);

  const tagElem = document.createElement("span");
  tagElem.classList.add("sync-tag", `sync-tag--${providerInfo.syncType}`);
  tagElem.dataset.tooltip = syncConfig.tooltip;
  const svgDoc = new DOMParser().parseFromString(syncConfig.icon, "image/svg+xml");
  tagElem.appendChild(svgDoc.documentElement);
  const tagLabel = document.createElement("span");
  tagLabel.textContent = syncConfig.label;
  tagElem.appendChild(tagLabel);
  liElem.appendChild(tagElem);

  const styleFromCheckState = () => {
    if (checkboxElem.checked) {
      liElem.classList.remove("disabled-item");
    } else {
      liElem.classList.add("disabled-item");
    }
  };

  checkboxElem.addEventListener("change", () => {
    styleFromCheckState();
    saveOptions();
  });

  styleFromCheckState();

  return liElem;
}

// -- Display Language Dropdown --------------------------

function populateLanguageDropdown(): void {
  const select = document.getElementById("uiLanguage") as HTMLSelectElement | undefined;
  if (!select) return;

  const browserLang = chrome.i18n.getUILanguage();
  const autoOption = document.createElement("option");
  autoOption.value = "auto";
  autoOption.textContent = `${t("options_language_displayLanguageAuto")} (${browserLang})`;
  select.appendChild(autoOption);

  for (const locale of SUPPORTED_LOCALES) {
    const option = document.createElement("option");
    option.value = locale.code;
    option.textContent = locale.nativeName;
    select.appendChild(option);
  }

  select.addEventListener("change", () => {
    saveOptions();
    location.hash = "language-content";
    location.reload();
  });
}

function restoreActiveTab(): void {
  if (!location.hash) return;

  const target = `#${location.hash.slice(1)}`;
  const targetBtn = document.querySelector(`.tab[data-target="${target}"]`);
  const targetContent = document.querySelector(target);
  if (!targetBtn || !targetContent) return;

  document.querySelectorAll(".tab").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));
  targetBtn.classList.add("active");
  targetContent.classList.add("active");
}

// Event listeners
document.addEventListener("DOMContentLoaded", async () => {
  await loadLocaleOverride();
  initI18n();
  populateLanguageDropdown();
  initTabScrollIndicators();
  initSettingHelpTooltips();
  restoreOptions();
  restoreActiveTab();
});
document.querySelectorAll("#options input, #options select").forEach(element => {
  element.addEventListener("change", saveOptions);
});

// Tab switcher
const tabButtons = document.querySelectorAll(".tab");
const tabContents = document.querySelectorAll(".tab-content");

tabButtons.forEach(button => {
  button.addEventListener("click", () => {
    tabButtons.forEach(btn => btn.classList.remove("active"));
    tabContents.forEach(content => content.classList.remove("active"));

    button.classList.add("active");
    const target = button.getAttribute("data-target")!;
    document.querySelector(target)!.classList.add("active");
    history.replaceState(null, "", target);
  });
});

// -- Tab scroll fade indicators --------------------------

function initTabScrollIndicators(): void {
  const container = document.querySelector(".tab-container") as HTMLElement;
  if (!container) return;

  const wrapper = document.createElement("div");
  wrapper.className = "tab-scroll-wrapper";
  container.parentNode!.insertBefore(wrapper, container);
  wrapper.appendChild(container);

  function update(): void {
    const { scrollLeft, scrollWidth, clientWidth } = container;
    const overflow = scrollWidth - clientWidth;

    if (overflow <= 2) {
      delete container.dataset.scrollLeft;
      delete container.dataset.scrollRight;
      return;
    }

    if (scrollLeft > 2) {
      container.dataset.scrollLeft = "";
    } else {
      delete container.dataset.scrollLeft;
    }

    if (scrollLeft < overflow - 2) {
      container.dataset.scrollRight = "";
    } else {
      delete container.dataset.scrollRight;
    }
  }

  container.addEventListener("scroll", update);
  update();
}

// -- Setting help tooltips --------------------------

const TOOLTIP_GAP = 8;

// A modal body counts as a boundary even though it does not clip: a tooltip that runs past its top
// covers the modal title, which is the thing the tooltip is explaining.
function getBoundaryTop(element: HTMLElement): number {
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const clips = !getComputedStyle(ancestor)
      .overflow.split(" ")
      .every(axis => axis === "visible");

    if (clips || ancestor.classList.contains("modal-body")) {
      return ancestor.getBoundingClientRect().top;
    }
  }
  return 0;
}

function initSettingHelpTooltips(): void {
  for (const help of document.querySelectorAll<HTMLElement>(".setting-help")) {
    const place = (): void => {
      const height = parseFloat(getComputedStyle(help, "::after").height) || 0;
      const spaceAbove = help.getBoundingClientRect().top - getBoundaryTop(help);
      help.dataset.tooltipPlacement = spaceAbove >= height + TOOLTIP_GAP ? "top" : "bottom";
    };

    help.addEventListener("pointerenter", place);
    help.addEventListener("focus", place);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new Sortable(document.getElementById("providers-list")!, {
    animation: 150,
    ghostClass: "dragging",
    forceFallback: true,
    filter: ".checkbox-container",
    preventOnFilter: false,
    onUpdate: saveOptions,
  });

  initLangExclusionsModal();
});

// -- Language Exclusions Modal --------------------------

let translationDisabledLanguages: string[] = [];

function updateExclusionsConfigVisibility(): void {
  const translateToggle = document.getElementById("translate") as HTMLInputElement;
  const configContainer = document.getElementById("lang-exclusions-config-container");
  if (!configContainer) return;

  configContainer.style.display = translateToggle?.checked ? "flex" : "none";
}

function initLangExclusionsModal(): void {
  const translateToggle = document.getElementById("translate") as HTMLInputElement;
  const configBtn = document.getElementById("lang-exclusions-config-btn");
  const modalOverlay = document.getElementById("lang-exclusions-modal-overlay");
  const modalClose = document.getElementById("lang-exclusions-modal-close");
  const translationSearchInput = document.getElementById("translation-search") as HTMLInputElement;
  const resetBtn = document.getElementById("lang-exclusions-reset-btn");

  if (!configBtn || !modalOverlay) return;

  translateToggle?.addEventListener("change", updateExclusionsConfigVisibility);

  configBtn.addEventListener("click", () => {
    modalOverlay.classList.add("active");
    if (resetBtn) resetBtn.textContent = t("options_resetToDefault", t("options_translation_tab"));
    translationSearchInput?.focus();
  });

  modalClose?.addEventListener("click", closeLangExclusionsModal);

  modalOverlay.addEventListener("click", e => {
    if (e.target === modalOverlay) {
      closeLangExclusionsModal();
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && modalOverlay.classList.contains("active")) {
      closeLangExclusionsModal();
    }
  });

  translationSearchInput?.addEventListener("input", () => {
    filterLanguagePills("translation-pills-container", translationSearchInput.value);
  });

  resetBtn?.addEventListener("click", () => {
    const tabName = t("options_translation_tab");
    const confirmed = window.confirm(
      `${t("options_langExclusions_resetTitle", tabName)}\n\n${t("options_langExclusions_resetMessage")}`
    );
    if (!confirmed) return;

    translationDisabledLanguages = [];
    renderTranslationLanguagePills();
    saveOptions();
    closeLangExclusionsModal();
    showAlert(t("options_langExclusions_resetSuccess", tabName));
  });
}

function closeLangExclusionsModal(): void {
  const modalOverlay = document.getElementById("lang-exclusions-modal-overlay");
  const translationSearchInput = document.getElementById("translation-search") as HTMLInputElement;

  modalOverlay?.classList.remove("active");

  if (translationSearchInput) {
    translationSearchInput.value = "";
    filterLanguagePills("translation-pills-container", "");
  }
}

function getTranslationLanguagesFromSelect(): string[] {
  const select = document.getElementById("translationLanguage") as HTMLSelectElement;
  if (!select) return [];
  return Array.from(select.options)
    .map(opt => opt.value)
    .filter(Boolean);
}

let translationPillsDelegated = false;

function renderTranslationLanguagePills(): void {
  const container = document.getElementById("translation-pills-container");
  if (!container) return;

  if (!translationPillsDelegated) {
    container.addEventListener("click", e => {
      const pill = (e.target as HTMLElement).closest("[data-lang-code]") as HTMLElement | null;
      if (pill?.dataset.langCode) {
        toggleTranslationLanguage(pill.dataset.langCode);
      }
    });
    translationPillsDelegated = true;
  }

  container.replaceChildren();

  for (const langCode of getTranslationLanguagesFromSelect()) {
    const langName = getLanguageDisplayName(langCode);
    const isDisabled = translationDisabledLanguages.includes(langCode);

    const pill = document.createElement("div");
    pill.className = `lang-pill${isDisabled ? " disabled" : ""}`;
    pill.dataset.langCode = langCode;
    pill.dataset.langName = langName.toLowerCase();
    pill.textContent = langName;

    container.appendChild(pill);
  }
}

function toggleTranslationLanguage(langCode: string): void {
  const index = translationDisabledLanguages.indexOf(langCode);
  if (index === -1) {
    translationDisabledLanguages.push(langCode);
  } else {
    translationDisabledLanguages.splice(index, 1);
  }
  saveOptions();
  renderTranslationLanguagePills();
}

function filterLanguagePills(containerId: string, query: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const normalizedQuery = query.toLowerCase().trim();
  const pills = container.querySelectorAll(".lang-pill");

  pills.forEach(pill => {
    const langName = (pill as HTMLElement).dataset.langName || "";
    const langCode = (pill as HTMLElement).dataset.langCode || "";
    const matches = langName.includes(normalizedQuery) || langCode.includes(normalizedQuery);
    pill.classList.toggle("lang-pill-hidden", !matches);
  });
}

function setUnisonPositionInForm(position: string): void {
  const frame = document.getElementById("unison-position-frame");
  if (!frame) return;
  frame.querySelectorAll<HTMLElement>(".position-cell").forEach(cell => {
    if (cell.dataset.pos === position) {
      cell.dataset.selected = "true";
    } else {
      delete cell.dataset.selected;
    }
  });
}

function syncUnisonModalDependentState(enabled: boolean): void {
  const body = document.getElementById("unison-actions-modal-body");
  if (!body) return;
  body.dataset.pinnedDisabled = enabled ? "false" : "true";
}

function resetDockSettings(): void {
  (document.getElementById("isUnisonPinnedDockEnabled") as HTMLInputElement).checked = true;
  (document.getElementById("isUnisonAutoHideInFullscreenEnabled") as HTMLInputElement).checked = true;
  (document.getElementById("isDockSourceEnabled") as HTMLInputElement).checked = true;
  (document.getElementById("isDockTranslateEnabled") as HTMLInputElement).checked = true;
  (document.getElementById("isDockOffsetEnabled") as HTMLInputElement).checked = true;
  (document.getElementById("isDockRefreshEnabled") as HTMLInputElement).checked = false;
  setUnisonPositionInForm(DOCK_DEFAULT_POSITION);
  setDockControlsOrderInForm([...DOCK_CONTROL_ORDER_DEFAULT]);
  syncUnisonModalDependentState(true);
  saveOptions();
}

function setupUnisonActionsModal(): void {
  const openBtn = document.getElementById("unison-actions-btn");
  const overlay = document.getElementById("unison-actions-modal-overlay");
  const closeBtn = document.getElementById("unison-actions-modal-close");
  const frame = document.getElementById("unison-position-frame");
  const pinnedToggle = document.getElementById("isUnisonPinnedDockEnabled") as HTMLInputElement | null;
  const autoHideToggle = document.getElementById("isUnisonAutoHideInFullscreenEnabled") as HTMLInputElement | null;

  if (!openBtn || !overlay || !closeBtn || !frame || !pinnedToggle || !autoHideToggle) return;

  const closeModal = (): void => overlay.classList.remove("active");

  openBtn.addEventListener("click", () => overlay.classList.add("active"));
  closeBtn.addEventListener("click", closeModal);

  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay.classList.contains("active")) closeModal();
  });

  frame.addEventListener("click", e => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>(".position-cell");
    if (!cell?.dataset.pos) return;
    setUnisonPositionInForm(cell.dataset.pos);
    saveOptions();
  });

  pinnedToggle.addEventListener("change", () => {
    syncUnisonModalDependentState(pinnedToggle.checked);
    saveOptions();
  });

  autoHideToggle.addEventListener("change", saveOptions);

  for (const id of [
    "isDockSourceEnabled",
    "isDockTranslateEnabled",
    "isDockOffsetEnabled",
    "isDockRefreshEnabled",
  ]) {
    document.getElementById(id)?.addEventListener("change", debouncedSaveOptions);
  }

  document.getElementById("dock-settings-reset")?.addEventListener("click", resetDockSettings);

  const picker = document.querySelector<HTMLElement>(".controls-shown-picker");
  if (picker) {
    new Sortable(picker, {
      animation: 150,
      ghostClass: "dragging",
      forceFallback: true,
      onUpdate: debouncedSaveOptions,
    });
  }
}

function formatOffsetDisplay(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}s`;
}

function setOffsetDisplay(id: string, value: number): void {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (input) input.value = String(value);
  const display = document.querySelector<HTMLElement>(`.offset-stepper__value[data-for="${id}"]`);
  if (display) display.textContent = formatOffsetDisplay(value);
}

function initOffsetModal(): void {
  const openBtn = document.getElementById("offset-settings-btn");
  const overlay = document.getElementById("offset-modal-overlay");
  const closeBtn = document.getElementById("offset-modal-close");
  if (!openBtn || !overlay || !closeBtn) return;

  const offsetCount = document.getElementById("offset-count");
  const refreshOffsetCount = async (): Promise<void> => {
    if (offsetCount) offsetCount.textContent = String((await getOffsetInfo()).count);
  };

  const close = (): void => overlay.classList.remove("active");
  openBtn.addEventListener("click", () => {
    overlay.classList.add("active");
    void refreshOffsetCount();
  });
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", event => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && overlay.classList.contains("active")) close();
  });

  document.getElementById("offset-modal-reset")?.addEventListener("click", () => {
    for (const id of ["globalLyricOffset", "richsyncOffsetTrim", "lineOffsetTrim"]) {
      setOffsetDisplay(id, 0);
    }
    debouncedSaveOptions();
  });

  document.getElementById("clear-offsets")?.addEventListener("click", async () => {
    await clearAllOffsets();
    await refreshOffsetCount();
  });

  const offsetApplies: Record<string, SyncType[]> = {
    globalLyricOffset: ["syllable", "word", "line"],
    richsyncOffsetTrim: ["syllable", "word"],
    lineOffsetTrim: ["line"],
  };
  const syncConfig = getSyncTypeConfig();
  for (const applies of document.querySelectorAll<HTMLElement>("#offset-modal-overlay .offset-applies")) {
    const types = applies.dataset.offsetScope ? offsetApplies[applies.dataset.offsetScope] : undefined;
    if (!types) continue;
    for (const type of types) {
      const chip = document.createElement("span");
      chip.className = "offset-applies__chip";
      chip.style.color = syncTypeColors[type];
      const icon = parseSvgString(syncConfig[type].icon);
      if (icon) chip.appendChild(icon);
      const name = document.createElement("span");
      name.textContent = syncConfig[type].label;
      chip.appendChild(name);
      applies.appendChild(chip);
    }
  }

  const OFFSET_STEP = 0.1;
  const OFFSET_STEP_LARGE = 0.5;
  const stepOffset = (id: string, delta: number): void => {
    const input = document.getElementById(id) as HTMLInputElement | null;
    const current = parseFloat(input?.value ?? "0") || 0;
    setOffsetDisplay(id, Math.round((current + delta) * 10) / 10);
    debouncedSaveOptions();
  };

  for (const btn of document.querySelectorAll<HTMLButtonElement>(".offset-stepper__btn")) {
    attachHoldRepeat(btn, event => {
      const id = btn.dataset.offset;
      const dir = Number(btn.dataset.delta);
      if (!id || !dir) return;
      stepOffset(id, dir * (event.altKey || event.shiftKey ? OFFSET_STEP_LARGE : OFFSET_STEP));
    });
  }

  for (const display of document.querySelectorAll<HTMLElement>(".offset-stepper__value")) {
    display.addEventListener("dblclick", () => {
      if (display.dataset.for) {
        setOffsetDisplay(display.dataset.for, 0);
        debouncedSaveOptions();
      }
    });
  }

  // Reflect changes coming from the dock (or another tab) live.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const id of ["globalLyricOffset", "richsyncOffsetTrim", "lineOffsetTrim"]) {
      const change = changes[id];
      if (change) setOffsetDisplay(id, Number(change.newValue ?? 0));
    }
  });
}
