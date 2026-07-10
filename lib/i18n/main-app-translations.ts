import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import { getDatabaseTranslationBundle } from "@/lib/i18n/db-translations";
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
    sourceHash: getMainAppSourceHash(),
    sourceStrings,
  };
}

export async function getCachedMainAppTranslationBundle(language: string) {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) return getEnglishMainAppTranslationBundle();

  const source = getMainAppTranslationSource();
  const bundle = await getDatabaseTranslationBundle(source, normalized);
  if (!bundle) return null;
  return buildMainAppTranslationBundle(normalized, bundle.strings);
}
