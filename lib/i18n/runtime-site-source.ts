import { defaultLanguage } from "@/lib/content/languages";
import { getAppTranslationSource } from "@/lib/db/queries";
import {
  siteTranslationNamespace,
} from "@/lib/i18n/site-source-constants";
import {
  getPotentialSiteTranslationNamespacesForPath,
  isPotentialSiteTranslationNamespace,
} from "@/lib/i18n/site-path-namespaces";
import type { TranslationBundle, TranslationSource } from "@/lib/i18n/translation-types";

type CachedRuntimeSource = {
  expiresAt: number;
  promise: Promise<TranslationSource | null>;
};

const runtimeSourceCacheTtlMs = 5 * 60 * 1000;
const runtimeSourceCache = new Map<string, CachedRuntimeSource>();

export function isKnownRuntimeSiteTranslationNamespace(namespace: string) {
  return isPotentialSiteTranslationNamespace(namespace);
}

export function getRuntimeSiteTranslationNamespacesForPath(pathname: string) {
  return getPotentialSiteTranslationNamespacesForPath(pathname);
}

export async function getRuntimeSiteTranslationSource(namespace = siteTranslationNamespace) {
  if (!isKnownRuntimeSiteTranslationNamespace(namespace)) return null;

  const cached = runtimeSourceCache.get(namespace);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  if (cached) runtimeSourceCache.delete(namespace);

  const promise = readRuntimeSiteTranslationSource(namespace).catch((error) => {
    runtimeSourceCache.delete(namespace);
    console.warn("site_translation_source_unavailable", {
      namespace,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  runtimeSourceCache.set(namespace, { expiresAt: Date.now() + runtimeSourceCacheTtlMs, promise });
  return promise;
}

export async function getRuntimeEnglishSiteTranslationBundle(namespace = siteTranslationNamespace) {
  const source = await getRuntimeSiteTranslationSource(namespace);
  if (!source) return null;
  return {
    namespace: source.namespace,
    language: defaultLanguage,
    sourceHash: source.sourceHash,
    sourceStrings: source.sourceStrings,
    strings: source.sourceStrings,
  } satisfies TranslationBundle;
}

async function readRuntimeSiteTranslationSource(namespace: string): Promise<TranslationSource | null> {
  const row = await getAppTranslationSource(namespace);
  if (!row) return null;
  return {
    namespace: row.namespace,
    sourceHash: row.sourceHash,
    sourceStrings: row.sourceStrings,
    systemInstruction: buildRuntimeSiteTranslationSystemInstruction(),
  };
}

function buildRuntimeSiteTranslationSystemInstruction() {
  return [
    "You are a meticulous localization specialist for inspir, an education website and AI learning app.",
    "Translate exactly the provided visible website, article, metadata, legal, or app-adjacent text into the target language.",
    "Return only JSON with the translated value in the value field.",
    "Preserve markdown-visible meaning, placeholders, punctuation attached to placeholders, URLs, route slugs, code terms, and the product name inspir.",
    "Do not translate HTML class names, file names, package names, route paths, email addresses, URLs, or code identifiers.",
    "Legal translations must be clear and conservative; do not add legal obligations or remove limitations.",
    "Use natural educational product copy in the target language.",
  ].join("\n");
}
