import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import { getDatabaseTranslationBundle } from "@/lib/i18n/db-translations";
import type { TranslationResult } from "./translation-types";
import {
  getRuntimeEnglishSiteTranslationBundle,
  getRuntimeSiteTranslationNamespacesForPath,
  getRuntimeSiteTranslationSource,
  isKnownRuntimeSiteTranslationNamespace,
} from "./runtime-site-source";

export type SiteTranslationResult = TranslationResult;

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
