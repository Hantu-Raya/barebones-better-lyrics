# Barebones Better Lyrics

A stripped, opt-in lyrics extension for YouTube Music, built for the
Nativune desktop app. It is a modified version of
[Better Lyrics](https://github.com/better-lyrics/better-lyrics) 2.4.1.

It keeps only:

- **Time-synced lyrics** on the YouTube Music Lyrics tab, looked up in this order: the Better Lyrics
  public API cache (`api.betterlyrics.org`), then LRCLIB (`lrclib.net`), then YouTube Music's own timed
  lyrics. Plain (unsynced) lyrics are not shown.
- **Google translation** of lyric lines (`translate.googleapis.com`), off by default.
- A fixed lyrics dock (source menu, per-song offset, refresh, translate toggle), click-to-seek,
  scrolling and instrumental handling.
- An options page for translation, UI language, timing offsets, cache and saved-offset reset.

No other service is contacted: no account, telemetry, remote fonts, logos, themes, store or social
links. Informational console logging is permanently off.

## Modification notice (GPL-3.0 §5a)

Modified from Better Lyrics by Hantu-Raya for Nativune, 2026. Changes from upstream 2.4.1 include:
new extension identity and key; removal of picture-in-picture, Unison accounts/votes/reports,
themes and the theme store, the unified API with its challenge, romanization, the fullscreen layout
and duplicate player controls, album-art backgrounds, dock customisation, next-song prefetch, remote
fonts and logos, the logging toggle, the English `/next` replay and YouTube captions; replacement of
the lyric providers with direct Better Lyrics API cache and LRCLIB lookups; and a reduced options page
that propagates settings through `chrome.storage` only. See the git history on branch `nativune` for
the exact changes.

## Build

Requires Node.js 22.12 or later.

```sh
npm ci --ignore-scripts
npm run build:nativune
```

The unpacked extension is written to `dist/chrome/`. `npm run prune:locales` removes locale messages
no retained file uses.

## License

GPL-3.0, unchanged from upstream; see [LICENSE](LICENSE). This program comes with ABSOLUTELY NO
WARRANTY.

Source: https://github.com/Hantu-Raya/barebones-better-lyrics
