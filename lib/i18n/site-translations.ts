import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import { getCuratedTranslationBundle } from "@/lib/i18n/curated-translations";
import { getDatabaseTranslationBundle } from "@/lib/i18n/db-translations";
import type { TranslationResult } from "./translation-types";
import {
  getAllSiteTranslationNamespaces,
  getEnglishSiteTranslationBundle,
  getSiteTranslationSource,
  getSiteTranslationNamespacesForPath,
  isKnownSiteTranslationNamespace as isKnownSiteSourceNamespace,
} from "./site-source";

export type SiteTranslationResult = TranslationResult;

export function isKnownSiteTranslationNamespace(namespace: string) {
  return isKnownSiteSourceNamespace(namespace);
}

export function getAllKnownSiteTranslationNamespaces() {
  return getAllSiteTranslationNamespaces();
}

export function getSiteTranslationNamespaces(pathname: string) {
  return getSiteTranslationNamespacesForPath(pathname);
}

export async function getCachedSiteTranslationBundle(language: string, namespace?: string) {
  const normalized = normalizeLanguage(language);
  const source = getSiteTranslationSource(namespace);
  if (normalized === defaultLanguage) return getEnglishSiteTranslationBundle(source.namespace);

  const curatedBundle = getCuratedTranslationBundle(source, normalized);
  if (curatedBundle) return curatedBundle;

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
  const source = getSiteTranslationSource(namespace);
  const bundle = normalized === defaultLanguage ? getEnglishSiteTranslationBundle(source.namespace) : await getCachedSiteTranslationBundle(normalized, source.namespace);
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
  const timeoutMs = Number(process.env.SITE_TRANSLATION_DB_TIMEOUT_MS ?? 1200);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  return Promise.race<T | null>([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}
