import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";
import { getCuratedTranslationBundle } from "@/lib/i18n/curated-translations";
import {
  buildMainAppTranslationBundle,
  getEnglishMainAppTranslationBundle,
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "@/lib/i18n/main-app-source";

export function getCuratedMainAppTranslationBundle(language: string) {
  const normalized = normalizeLanguage(language);
  if (normalized === defaultLanguage) return getEnglishMainAppTranslationBundle();

  const sourceStrings = getMainAppSourceStrings();
  const bundle = getCuratedTranslationBundle(
    {
      namespace: mainAppTranslationNamespace,
      sourceHash: getMainAppSourceHash(sourceStrings),
      sourceStrings,
    },
    normalized,
  );
  return bundle ? buildMainAppTranslationBundle(normalized, bundle.strings) : null;
}
