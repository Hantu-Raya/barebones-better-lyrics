// Removes message keys that no retained file references from every _locales/*/messages.json.
//
// A key is kept when it is referenced explicitly (t("key"), chrome.i18n.getMessage("key"),
// __MSG_key__, data-i18n="key", CSS attr(key)) or when it appears as a quoted string literal in a
// retained source file (covers keys chosen by a ternary or looked up from a table).
// Fails (exit 1) when an explicitly referenced key is missing from the source locale (en).
//
// Usage: npx tsx tooling/prune-locales.ts [--check]
//   --check  report what would change without writing.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(repoRoot, "_locales");
const SOURCE_LOCALE = "en";
const checkOnly = process.argv.includes("--check");

const SCAN_ROOTS = ["src", "public", "manifest.json"];
const SCAN_EXTENSIONS: Record<string, true> = { ".ts": true, ".js": true, ".html": true, ".css": true, ".json": true };
const SKIP_DIRS: Record<string, true> = { node_modules: true, dist: true, generated: true };

function walk(path: string, out: string[]): void {
  if (!existsSync(path)) return;
  if (statSync(path).isFile()) {
    if (SCAN_EXTENSIONS[extname(path)]) out.push(path);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS[entry.name]) continue;
    walk(join(path, entry.name), out);
  }
}

const files: string[] = [];
for (const root of SCAN_ROOTS) walk(join(repoRoot, root), files);

const EXPLICIT_PATTERNS = [
  /\bt\(\s*["'`]([A-Za-z0-9_]+)["'`]/g,
  /getMessage\(\s*["'`]([A-Za-z0-9_]+)["'`]/g,
  /__MSG_([A-Za-z0-9_]+)__/g,
  /data-i18n(?:-[a-z-]+)?\s*=\s*["']([A-Za-z0-9_]+)["']/g,
  /attr\(\s*([A-Za-z0-9_]+)/g,
];
const LITERAL_PATTERN = /["'`]([A-Za-z][A-Za-z0-9_]*)["'`]/g;

type Bundle = Record<string, { message: string; description?: string; placeholders?: unknown }>;

function loadBundle(locale: string): Bundle {
  return JSON.parse(readFileSync(join(localesDir, locale, "messages.json"), "utf8")) as Bundle;
}

const source = loadBundle(SOURCE_LOCALE);
const explicit = new Map<string, string>(); // key -> first file that references it
const literals = new Set<string>();

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const label = relative(repoRoot, file);
  for (const pattern of EXPLICIT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      // CSS attr() also matches ordinary attribute names; only count it when it names a message.
      if (pattern.source.startsWith("attr") && !Object.hasOwn(source, match[1])) continue;
      if (!explicit.has(match[1])) explicit.set(match[1], label);
    }
  }
  for (const match of text.matchAll(LITERAL_PATTERN)) literals.add(match[1]);
}

const missing = [...explicit].filter(([key]) => !Object.hasOwn(source, key));
if (missing.length > 0) {
  console.error(`Keys referenced by retained files but missing from _locales/${SOURCE_LOCALE}/messages.json:`);
  for (const [key, file] of missing) console.error(`  ${key}  (${file})`);
  process.exit(1);
}

const used = new Set<string>([...explicit.keys(), ...[...literals].filter(key => Object.hasOwn(source, key))]);

const locales = readdirSync(localesDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(localesDir, entry.name, "messages.json")))
  .map(entry => entry.name)
  .sort();

let totalRemoved = 0;
for (const locale of locales) {
  const path = join(localesDir, locale, "messages.json");
  const raw = readFileSync(path, "utf8");
  const bundle = JSON.parse(raw) as Bundle;
  const kept: Bundle = {};
  let removed = 0;
  for (const [key, value] of Object.entries(bundle)) {
    if (used.has(key)) kept[key] = value;
    else removed++;
  }
  totalRemoved += removed;
  if (removed > 0 && !checkOnly) {
    const indent = /^\{\r?\n( +|\t)"/.exec(raw)?.[1] ?? "  ";
    writeFileSync(path, `${JSON.stringify(kept, null, indent)}\n`);
  }
  console.log(`${locale}: ${removed} unused key(s) ${checkOnly ? "would be removed" : "removed"}, ${Object.keys(kept).length} kept`);
}

console.log(`${used.size} key(s) in use; ${totalRemoved} removed across ${locales.length} locale(s).`);
