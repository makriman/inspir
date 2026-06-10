import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  defaultLanguage,
  languageConfigs,
  normalizeLanguage,
  type SupportedLanguage,
} from "@/lib/content/languages";
import type { TranslationBundle, TranslationSource } from "@/lib/i18n/translation-types";

type CuratedTranslationPack = {
  schemaVersion?: number;
  language?: string;
  locale?: string;
  namespace?: string;
  sourceHash?: string;
  translations?: Record<string, string>;
  entries?: Array<{
    key?: string;
    source?: string;
    value?: string;
  }>;
};

const curatedRoot = "translations/curated";
const bundleCache = new Map<string, TranslationBundle | null>();

export function getCuratedTranslationBundle(source: TranslationSource, language: string) {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) return buildTranslationBundle(source, normalized, source.sourceStrings);

  const cacheKey = `${source.namespace}\u0000${normalized}\u0000${source.sourceHash}`;
  if (bundleCache.has(cacheKey)) return bundleCache.get(cacheKey) ?? null;

  const packFiles = curatedPackFiles(normalized, source.namespace);
  if (!packFiles.length) {
    const fallbackBundle = getMarketingSiteFallbackBundle(source, normalized);
    bundleCache.set(cacheKey, fallbackBundle);
    return fallbackBundle;
  }

  const strings: Record<string, string> = {};
  for (const file of packFiles) {
    const pack = JSON.parse(readFileSync(file, "utf8")) as CuratedTranslationPack;
    if (pack.namespace !== source.namespace || pack.language !== normalized || pack.sourceHash !== source.sourceHash) {
      bundleCache.set(cacheKey, null);
      return null;
    }

    for (const [key, value] of Object.entries(pack.translations ?? {})) {
      if (key in source.sourceStrings && typeof value === "string" && value.trim()) strings[key] = value;
    }

    for (const entry of pack.entries ?? []) {
      if (!entry.key || !(entry.key in source.sourceStrings)) continue;
      if (typeof entry.value === "string" && entry.value.trim()) strings[entry.key] = entry.value;
    }
  }

  for (const key of Object.keys(source.sourceStrings)) {
    if (!strings[key]?.trim()) {
      const fallbackBundle = getMarketingSiteFallbackBundle(source, normalized, strings);
      bundleCache.set(cacheKey, fallbackBundle);
      return fallbackBundle;
    }
  }

  const bundle = buildTranslationBundle(source, normalized, strings);
  bundleCache.set(cacheKey, bundle);
  return bundle;
}

export function curatedTranslationEntriesForClient(bundle: TranslationBundle) {
  return Object.entries(bundle.sourceStrings)
    .map(([key, source]) => [source, bundle.strings[key]] as [string, string | undefined])
    .filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));
}

function buildTranslationBundle(
  source: TranslationSource,
  language: SupportedLanguage,
  strings: Record<string, string>,
): TranslationBundle {
  return {
    namespace: source.namespace,
    language,
    sourceHash: source.sourceHash,
    sourceStrings: source.sourceStrings,
    strings,
  };
}

function curatedPackFiles(language: SupportedLanguage, namespace: string) {
  const languageDir = join(resolve(process.cwd(), curatedRoot), languageConfigs[language].prefix || languageConfigs[language].locale);
  if (!existsSync(languageDir)) return [];

  const safeNamespace = fileSafeNamespace(namespace);
  return readdirSync(languageDir)
    .filter((file) => file === `${safeNamespace}.json` || file.startsWith(`${safeNamespace}.part-`))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => join(languageDir, file));
}

function fileSafeNamespace(namespace: string) {
  return namespace.replace(/[^a-z0-9.-]+/gi, "__");
}

function getMarketingSiteFallbackBundle(
  source: TranslationSource,
  language: SupportedLanguage,
  initialStrings: Record<string, string> = {},
) {
  if (source.namespace === "marketing-site") return null;

  const entriesBySource = marketingSiteEntriesBySource(language);
  if (!entriesBySource.size) return null;

  const strings: Record<string, string> = { ...initialStrings };
  for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
    if (strings[key]?.trim()) continue;
    const translated = entriesBySource.get(sourceText);
    if (!translated?.trim()) return null;
    strings[key] = translated;
  }

  return buildTranslationBundle(source, language, strings);
}

function marketingSiteEntriesBySource(language: SupportedLanguage) {
  const entries = new Map<string, string>();
  for (const file of curatedPackFiles(language, "marketing-site")) {
    const pack = JSON.parse(readFileSync(file, "utf8")) as CuratedTranslationPack;
    if (pack.namespace !== "marketing-site" || pack.language !== language) continue;

    for (const entry of pack.entries ?? []) {
      if (typeof entry.source !== "string" || typeof entry.value !== "string") continue;
      if (entry.source.trim() && entry.value.trim()) entries.set(entry.source, entry.value);
    }
  }
  return entries;
}
