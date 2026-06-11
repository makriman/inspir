import { defaultLanguage, normalizeLanguage, type SupportedLanguage } from "@/lib/content/languages";
import { getAppTranslation } from "@/lib/db/queries";
import type { TranslationBundle, TranslationSource } from "@/lib/i18n/translation-types";

const dbBundleCache = new Map<string, Promise<TranslationBundle | null>>();

export function getDatabaseTranslationBundle(source: TranslationSource, language: string) {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) return Promise.resolve(buildTranslationBundle(source, normalized, source.sourceStrings));

  const cacheKey = `${source.namespace}\u0000${normalized}\u0000${source.sourceHash}`;
  const cached = dbBundleCache.get(cacheKey);
  if (cached) return cached;

  const promise = readDatabaseTranslationBundle(source, normalized).catch((error) => {
    dbBundleCache.delete(cacheKey);
    throw error;
  });
  dbBundleCache.set(cacheKey, promise);
  return promise;
}

async function readDatabaseTranslationBundle(source: TranslationSource, language: SupportedLanguage) {
  const row = await getAppTranslation(source.namespace, language);
  if (!row) {
    console.warn("translation_db_missing", { namespace: source.namespace, language, sourceHash: source.sourceHash });
    return null;
  }
  if (row.sourceHash !== source.sourceHash) {
    console.warn("translation_db_stale", {
      namespace: source.namespace,
      language,
      expectedSourceHash: source.sourceHash,
      rowSourceHash: row.sourceHash,
    });
    return null;
  }

  const strings: Record<string, string> = {};
  for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
    const translated = row.payload[key];
    if (typeof translated !== "string" || !translated.trim()) return null;
    strings[key] = translated || sourceText;
  }

  return buildTranslationBundle(source, language, strings);
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
