import {
  defaultLanguage,
  languageConfigs,
  normalizeLanguage,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { getDatabaseTranslationBundle } from "@/lib/i18n/db-translations";
import type { TranslationBundle, TranslationResult, TranslationSource } from "./translation-types";
import {
  getRuntimeEnglishSiteTranslationBundle,
  getRuntimeSiteTranslationNamespacesForPath,
  getRuntimeSiteTranslationSource,
  isKnownRuntimeSiteTranslationNamespace,
} from "./runtime-site-source";

export type SiteTranslationResult = TranslationResult;

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

const buildTimeBundleCache = new Map<string, Promise<TranslationBundle | null>>();
const buildTimePackCache = new Map<string, Promise<CuratedTranslationPack[]>>();

export function isKnownSiteTranslationNamespace(namespace: string) {
  return isKnownRuntimeSiteTranslationNamespace(namespace);
}

export function getSiteTranslationNamespaces(pathname: string) {
  return getRuntimeSiteTranslationNamespacesForPath(pathname);
}

export async function getCachedSiteTranslationBundle(language: string, namespace?: string) {
  const normalized = normalizeLanguage(language);
  const source = await getRuntimeSiteTranslationSource(namespace);
  if (!source) return null;
  if (normalized === defaultLanguage) return getRuntimeEnglishSiteTranslationBundle(source.namespace);

  const buildTimeBundle = await getBuildTimeCuratedTranslationBundle(source, normalized);
  if (buildTimeBundle) return buildTimeBundle;

  return translationDbFallbackWithTimeout(getDatabaseTranslationBundle(source, normalized));
}

export async function getCachedSiteTranslationEntries(language: string, namespaces: string[]) {
  const bundles = await Promise.all(namespaces.map((namespace) => getCachedSiteTranslationBundle(language, namespace)));
  const entries: Array<[string, string]> = [];
  for (const bundle of bundles) {
    if (!bundle) continue;
    for (const [key, source] of Object.entries(bundle.sourceStrings)) {
      const translated = bundle.strings[key];
      if (!translated || translated === source) continue;
      entries.push([source, translated]);
    }
  }
  return entries;
}

export async function getOrCreateSiteTranslationResult(
  language: string,
  namespace?: string,
): Promise<SiteTranslationResult> {
  const normalized = normalizeLanguage(language);
  const source = await getRuntimeSiteTranslationSource(namespace);
  if (!source) {
    return {
      bundle: {
        namespace: namespace ?? "",
        language: normalized,
        sourceHash: "",
        sourceStrings: {},
        strings: {},
      },
      complete: false,
      translatedCount: 0,
      totalCount: 0,
    };
  }

  const bundle =
    normalized === defaultLanguage
      ? await getRuntimeEnglishSiteTranslationBundle(source.namespace)
      : await getCachedSiteTranslationBundle(normalized, source.namespace);
  const translatedCount = bundle ? Object.keys(bundle.strings).length : 0;
  const totalCount = Object.keys(source.sourceStrings).length;
  return {
    bundle: bundle ?? {
      namespace: source.namespace,
      language: normalized,
      sourceHash: source.sourceHash,
      sourceStrings: source.sourceStrings,
      strings: {},
    },
    complete: translatedCount === totalCount,
    translatedCount,
    totalCount,
  };
}

function translationDbFallbackWithTimeout<T>(promise: Promise<T | null>) {
  const timeoutMs = Number(process.env.SITE_TRANSLATION_DB_TIMEOUT_MS ?? 3500);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  return Promise.race<T | null>([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

function getBuildTimeCuratedTranslationBundle(source: TranslationSource, language: SupportedLanguage) {
  if (!shouldReadBuildTimeTranslationFiles()) return Promise.resolve(null);

  const cacheKey = `${source.namespace}\u0000${language}\u0000${source.sourceHash}`;
  const cached = buildTimeBundleCache.get(cacheKey);
  if (cached) return cached;

  const promise = readBuildTimeCuratedTranslationBundle(source, language);
  buildTimeBundleCache.set(cacheKey, promise);
  return promise;
}

function shouldReadBuildTimeTranslationFiles() {
  return process.env.NEXT_PHASE === "phase-production-build";
}

async function readBuildTimeCuratedTranslationBundle(source: TranslationSource, language: SupportedLanguage) {
  const packs = await readBuildTimeCuratedPacksForNamespace(language, source.namespace);
  if (!packs.length) return null;

  const strings: Record<string, string> = {};
  for (const pack of packs) {
    if (pack.namespace !== source.namespace || pack.language !== language || pack.sourceHash !== source.sourceHash) {
      return null;
    }

    for (const [key, value] of Object.entries(pack.translations ?? {})) {
      if (key in source.sourceStrings && value.trim()) strings[key] = value;
    }

    for (const entry of pack.entries ?? []) {
      if (!entry.key || !(entry.key in source.sourceStrings)) continue;
      if (entry.value?.trim()) strings[entry.key] = entry.value;
    }
  }

  for (const key of Object.keys(source.sourceStrings)) {
    if (!strings[key]?.trim()) return null;
  }

  return {
    namespace: source.namespace,
    language,
    sourceHash: source.sourceHash,
    sourceStrings: source.sourceStrings,
    strings,
  } satisfies TranslationBundle;
}

function readBuildTimeCuratedPacksForNamespace(language: SupportedLanguage, namespace: string) {
  const cacheKey = `${language}\u0000${namespace}`;
  const cached = buildTimePackCache.get(cacheKey);
  if (cached) return cached;

  const promise = readBuildTimeCuratedPackFiles(language, namespace).catch((error) => {
    console.warn("site_translation_curated_pack_unavailable", {
      language,
      namespace,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  });
  buildTimePackCache.set(cacheKey, promise);
  return promise;
}

async function readBuildTimeCuratedPackFiles(language: SupportedLanguage, namespace: string) {
  const [{ readFile, readdir }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const locale = languageConfigs[language].prefix || languageConfigs[language].locale;
  const languageDir = path.join(process.cwd(), "translations/curated", locale);
  let files: string[];
  try {
    files = await readdir(languageDir);
  } catch {
    return [];
  }

  const safeNamespace = fileSafeNamespace(namespace);
  const packFiles = files
    .filter((file) => file === `${safeNamespace}.json` || file.startsWith(`${safeNamespace}.part-`))
    .filter((file) => file.endsWith(".json"))
    .sort();

  const packs: CuratedTranslationPack[] = [];
  for (const file of packFiles) {
    const parsed: unknown = JSON.parse(await readFile(path.join(languageDir, file), "utf8"));
    const pack = parseCuratedTranslationPack(parsed);
    if (pack) packs.push(pack);
  }
  return packs;
}

function parseCuratedTranslationPack(value: unknown): CuratedTranslationPack | null {
  const record = objectRecord(value);
  if (!record) return null;

  const translations = record.translations === undefined ? undefined : stringRecord(record.translations);
  if (record.translations !== undefined && !translations) return null;

  const entries = record.entries === undefined ? undefined : curatedPackEntries(record.entries);
  if (record.entries !== undefined && !entries) return null;

  return {
    schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : undefined,
    language: typeof record.language === "string" ? record.language : undefined,
    locale: typeof record.locale === "string" ? record.locale : undefined,
    namespace: typeof record.namespace === "string" ? record.namespace : undefined,
    sourceHash: typeof record.sourceHash === "string" ? record.sourceHash : undefined,
    translations: translations ?? undefined,
    entries: entries ?? undefined,
  };
}

function curatedPackEntries(value: unknown): CuratedTranslationPack["entries"] | null {
  if (!Array.isArray(value)) return null;
  const entries: NonNullable<CuratedTranslationPack["entries"]> = [];
  for (const item of value) {
    const record = objectRecord(item);
    if (!record) return null;
    entries.push({
      key: typeof record.key === "string" ? record.key : undefined,
      source: typeof record.source === "string" ? record.source : undefined,
      value: typeof record.value === "string" ? record.value : undefined,
    });
  }
  return entries;
}

function stringRecord(value: unknown) {
  const record = objectRecord(value);
  if (!record) return null;
  const strings: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string") return null;
    strings[key] = item;
  }
  return strings;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function fileSafeNamespace(namespace: string) {
  return namespace.replace(/[^a-z0-9.-]+/gi, "__");
}
