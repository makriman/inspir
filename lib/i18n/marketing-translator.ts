import { cache } from "react";
import { defaultLanguage, type SupportedLanguage } from "@/lib/content/languages";
import { getRequestLanguage, getRequestPathname } from "@/lib/i18n/request-locale";
import { isStaticSiteLanguageAvailableForPath } from "@/lib/i18n/static-availability";
import {
  getCachedSiteTranslationBundle,
  getCachedSiteTranslationEntries,
  getSiteTranslationNamespaces,
} from "@/lib/i18n/site-translations";
import { createTranslationLookup, normalizeTranslationText } from "@/lib/i18n/translation-lookup";
import type { TranslationBundle } from "@/lib/i18n/translation-types";

export type MarketingTranslator = {
  language: SupportedLanguage;
  hrefLanguage: SupportedLanguage;
  pathname: string;
  translationNamespaces: string[];
  isAvailable: boolean;
  t: (value: string) => string;
};

export const getMarketingTranslator = cache(async function getMarketingTranslator(
  pathnameOverride?: string,
): Promise<MarketingTranslator> {
  const [language, requestPathname] = await Promise.all([
    getRequestLanguage(),
    pathnameOverride ? Promise.resolve(pathnameOverride) : getRequestPathname(),
  ]);
  const pathname = pathnameOverride ?? requestPathname;
  const isAvailable = language === defaultLanguage || isStaticSiteLanguageAvailableForPath(pathname, language);
  const hrefLanguage = isAvailable ? language : defaultLanguage;
  const translationNamespaces = isAvailable ? getSiteTranslationNamespaces(pathname) : [];
  const bundles =
    language === defaultLanguage || !isAvailable
      ? []
      : await Promise.all(translationNamespaces.map((namespace) => getCachedSiteTranslationBundle(language, namespace)));
  const translationEntries =
    language === defaultLanguage || !isAvailable
      ? []
      : await getCachedSiteTranslationEntries(language, translationNamespaces);
  const textMap = buildTextMap(bundles.filter((bundle) => bundle !== null));
  const lookup = createTranslationLookup(translationEntries);

  return {
    language,
    hrefLanguage,
    pathname,
    translationNamespaces,
    isAvailable,
    t: (value: string) => translateMarketingText(value, lookup.translate, textMap),
  };
});

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
