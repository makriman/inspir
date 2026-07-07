import { cache } from "react";
import { defaultLanguage, type SupportedLanguage } from "@/lib/content/languages";
import {
  getRequestLanguage,
  getRequestPathname,
  getRequestRecommendedLanguage,
  requestHasLocalePrefix,
} from "@/lib/i18n/request-locale";
import { isStaticSiteLanguageAvailableForPath } from "@/lib/i18n/static-availability";
import {
  getCachedSiteTranslationBundle,
  getCachedSiteTranslationEntries,
  getSiteTranslationNamespaces,
} from "@/lib/i18n/site-translations";
import { createTranslationLookup, normalizeTranslationText } from "@/lib/i18n/translation-lookup";
import type { TranslationBundle } from "@/lib/i18n/translation-types";

export type MarketingChrome = {
  language: SupportedLanguage;
  hrefLanguage: SupportedLanguage;
  recommendedLanguage: SupportedLanguage;
  currentPathname: string;
  hasLocalePrefix: boolean;
  translationNamespaces: string[];
  translationEntries: Array<[string, string]>;
  t: (value: string) => string;
};

type MarketingChromeInput = {
  language: SupportedLanguage;
  recommendedLanguage: SupportedLanguage;
  currentPathname: string;
  hasLocalePrefix: boolean;
};

export const getStaticMarketingChrome = cache(async function getStaticMarketingChrome(
  currentPathname: string,
  language: SupportedLanguage = defaultLanguage,
): Promise<MarketingChrome> {
  return buildMarketingChrome({
    language,
    recommendedLanguage: defaultLanguage,
    currentPathname,
    hasLocalePrefix: language !== defaultLanguage,
  });
});

export const getRequestMarketingChrome = cache(async function getRequestMarketingChrome() {
  const [language, recommendedLanguage, currentPathname, hasLocalePrefix] = await Promise.all([
    getRequestLanguage(),
    getRequestRecommendedLanguage(),
    getRequestPathname(),
    requestHasLocalePrefix(),
  ]);
  return buildMarketingChrome({ language, recommendedLanguage, currentPathname, hasLocalePrefix });
});

async function buildMarketingChrome({
  language,
  recommendedLanguage,
  currentPathname,
  hasLocalePrefix,
}: MarketingChromeInput): Promise<MarketingChrome> {
  const languageAvailable = language === defaultLanguage || isStaticSiteLanguageAvailableForPath(currentPathname, language);
  const hrefLanguage = languageAvailable ? language : defaultLanguage;
  const translationNamespaces = languageAvailable ? getSiteTranslationNamespaces(currentPathname) : [];
  const bundles =
    language === defaultLanguage || !languageAvailable
      ? []
      : await Promise.all(translationNamespaces.map((namespace) => getCachedSiteTranslationBundle(language, namespace)));
  const translationEntries =
    language === defaultLanguage || !languageAvailable
      ? []
      : await getCachedSiteTranslationEntries(language, translationNamespaces);
  const textMap = buildTextMap(bundles.filter((bundle) => bundle !== null));
  const lookup = createTranslationLookup(translationEntries);

  return {
    language,
    hrefLanguage,
    recommendedLanguage,
    currentPathname,
    hasLocalePrefix,
    translationNamespaces,
    translationEntries,
    t: (value: string) => translateMarketingText(value, lookup.translate, textMap),
  };
}

function buildTextMap(bundles: TranslationBundle[]) {
  const map = new Map<string, string>();
  for (const bundle of bundles) {
    for (const [key, source] of Object.entries(bundle.sourceStrings)) {
      const translated = bundle.strings[key];
      if (translated) map.set(normalizeTranslationText(source), translated);
    }
  }
  return map;
}

function translateMarketingText(
  value: string,
  translate: (value: string) => string,
  textMap: Map<string, string>,
) {
  const normalized = normalizeTranslationText(value);
  if (!normalized) return value;
  const translated = textMap.get(normalized) ?? translate(normalized);
  if (!translated || translated === normalized) return value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  return `${leading}${translated}${trailing}`;
}
