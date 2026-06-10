import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import { getCuratedTranslationBundle } from "@/lib/i18n/curated-translations";
import {
  buildMainAppTranslationBundle,
  getEnglishMainAppTranslationBundle,
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "@/lib/i18n/main-app-source";
import type { TranslationResult, TranslationSource } from "./translation-types";
import type { MainAppTranslationBundle } from "./main-app-types";

export type MainAppTranslationResult = TranslationResult & {
  bundle: MainAppTranslationBundle;
};

function getMainAppTranslationSource(): TranslationSource {
  const sourceStrings = getMainAppSourceStrings();
  return {
    namespace: mainAppTranslationNamespace,
    sourceHash: getMainAppSourceHash(sourceStrings),
    sourceStrings,
  };
}

export async function getCachedMainAppTranslationBundle(language: string) {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) return getEnglishMainAppTranslationBundle();

  const source = getMainAppTranslationSource();
  const bundle = getCuratedTranslationBundle(source, normalized);
  if (!bundle) return null;
  return buildMainAppTranslationBundle(normalized, bundle.strings);
}

export async function getOrCreateMainAppTranslationBundle(language: string): Promise<MainAppTranslationBundle> {
  return (await getOrCreateMainAppTranslationResult(language)).bundle;
}

export async function getOrCreateMainAppTranslationResult(language: string): Promise<MainAppTranslationResult> {
  const source = getMainAppTranslationSource();
  const normalized = normalizeLanguage(language);
  const bundle =
    normalized === defaultLanguage
      ? getEnglishMainAppTranslationBundle()
      : await getCachedMainAppTranslationBundle(normalized);
  const complete = Boolean(bundle);
  return {
    bundle: bundle ?? buildMainAppTranslationBundle(normalized, {}),
    complete,
    translatedCount: bundle ? Object.keys(bundle.strings).length : 0,
    totalCount: Object.keys(source.sourceStrings).length,
  };
}
