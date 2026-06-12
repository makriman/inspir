import { defaultLanguage, normalizeLanguage, type SupportedLanguage } from "@/lib/content/languages";
import { getAppTranslation } from "@/lib/db/queries";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import type { TranslationBundle, TranslationSource } from "@/lib/i18n/translation-types";

type CachedDbBundle = {
  expiresAt: number;
  promise: Promise<TranslationBundle | null>;
};

const successfulCacheTtlMs = 5 * 60 * 1000;
const failedCacheTtlMs = Number(process.env.TRANSLATION_DB_FAILURE_CACHE_MS ?? 60_000);
const globalFailureCacheTtlMs = Number(process.env.TRANSLATION_DB_GLOBAL_FAILURE_CACHE_MS ?? 5 * 60_000);
const dbBundleCache = new Map<string, CachedDbBundle>();
let translationDbUnavailableUntil = 0;

export function getDatabaseTranslationBundle(source: TranslationSource, language: string) {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) return Promise.resolve(buildTranslationBundle(source, normalized, source.sourceStrings));
  if (translationDbUnavailableUntil > Date.now()) return Promise.resolve(null);

  const cacheKey = `${source.namespace}\u0000${normalized}\u0000${source.sourceHash}`;
  const cached = dbBundleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) dbBundleCache.delete(cacheKey);

  const promise = readDatabaseTranslationBundle(source, normalized).catch((error) => {
    const ttlMs = Number.isFinite(failedCacheTtlMs) && failedCacheTtlMs > 0 ? failedCacheTtlMs : 60_000;
    const globalTtlMs =
      Number.isFinite(globalFailureCacheTtlMs) && globalFailureCacheTtlMs > 0 ? globalFailureCacheTtlMs : 5 * 60_000;
    translationDbUnavailableUntil = Date.now() + globalTtlMs;
    dbBundleCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, promise: Promise.resolve(null) });
    console.warn("translation_db_unavailable", {
      namespace: source.namespace,
      language: normalized,
      sourceHash: source.sourceHash,
      error: getTranslationDbErrorDetails(error),
    });
    return null;
  });
  dbBundleCache.set(cacheKey, { expiresAt: Date.now() + successfulCacheTtlMs, promise });
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

  const strings = translationStringsFromDbPayload(source, row.payload, language);
  if (!Object.keys(strings).length) return null;

  return buildTranslationBundle(source, language, strings);
}

export function translationStringsFromDbPayload(
  source: Pick<TranslationSource, "sourceStrings">,
  payload: Record<string, unknown>,
  language?: string,
) {
  const strings: Record<string, string> = {};
  for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
    const translated = payload[key];
    const value = typeof translated === "string" ? translated : undefined;
    if (value === undefined) continue;
    if (!isValidFieldTranslation(sourceText, value, language)) continue;
    strings[key] = value;
  }
  return strings;
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

function getTranslationDbErrorDetails(error: unknown) {
  const outer = error instanceof Error ? error : undefined;
  const cause = outer && "cause" in outer ? outer.cause : undefined;
  const causeRecord = cause && typeof cause === "object" ? (cause as Record<string, unknown>) : undefined;

  return {
    message: outer?.message ?? String(error),
    causeMessage: cause instanceof Error ? cause.message : undefined,
    code: typeof causeRecord?.code === "string" ? causeRecord.code : undefined,
  };
}
