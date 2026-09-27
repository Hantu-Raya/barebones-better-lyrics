import { injectI18nCssVars, loadLocaleOverride, subscribeToLocaleChanges } from "@core/i18n";
import { purgeExpiredKeys, saveCacheInfo } from "@core/storage";
import { initProviders } from "@modules/lyrics/providers/shared";
import { setupRequestSniffer } from "@modules/lyrics/requestSniffer/requestSniffer";
import {
  listenForSettingsChanges,
  loadLyricOffsetSettings,
  loadPassiveScrollSetting,
  loadTranslationSettings,
} from "@modules/settings/settings";
import { cleanup as cleanupLyrics, injectHeadTags, observeLyricsPageType, setupAdObserver, unmountDock } from "@modules/ui/dom";
import {
  enableLyricsTab,
  initializeLyrics,
  lyricReloader,
  setUpAvButtonListener,
  setupAltHoverHandler,
} from "@modules/ui/observer";

/**
 * Initializes the extension: local styles, locale, observers, settings, storage and providers.
 */
async function modify(isDisposed: () => boolean): Promise<void> {
  await injectHeadTags();
  if (isDisposed()) return;
  await loadLocaleOverride();
  if (isDisposed()) return;
  injectI18nCssVars();
  subscribeToLocaleChanges();
  setupAdObserver();
  enableLyricsTab();
  observeLyricsPageType();
  loadTranslationSettings();
  loadLyricOffsetSettings();
  loadPassiveScrollSetting();
  await purgeExpiredKeys();
  await saveCacheInfo();
  listenForSettingsChanges();
  lyricReloader();
  initializeLyrics();
  setupAltHoverHandler();
  initProviders();
  setUpAvButtonListener();
}

/**
 * Initializes the application by setting up the DOM content loaded event listener.
 * Entry point for the BetterLyrics extension.
 */
function init(): () => void {
  let disposed = false;
  let modifyStarted = false;
  const runModify = (): void => {
    if (modifyStarted || disposed) return;
    modifyStarted = true;
    void modify(() => disposed);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runModify, { once: true });
  } else {
    runModify();
  }

  const cleanupRequestSniffer = setupRequestSniffer();
  return () => {
    disposed = true;
    document.removeEventListener("DOMContentLoaded", runModify);
    cleanupRequestSniffer();
    if (document.querySelector('[data-extension-root="true"]')) cleanupLyrics();
    unmountDock();
  };
}

/**
 * Extension.js content-script entrypoint. The framework invokes this function
 * and runs the returned cleanup before reinjecting an updated build.
 */
export default function initializeBetterLyrics(): () => void {
  return init();
}
