import {
  defaultLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { staticSiteTranslationNamespaceAvailability } from "@/lib/i18n/site-availability-manifest";
import { getPotentialSiteTranslationNamespacesForPath } from "@/lib/i18n/site-path-namespaces";

const staticPathAvailabilityCache = new Map<string, SupportedLanguage[]>();

export function isStaticSiteLanguageAvailableForPath(pathname: string, language: SupportedLanguage) {
  if (language === defaultLanguage) return true;

  const availableNamespaces = staticSiteTranslationNamespaceAvailability[language];
  if (!availableNamespaces?.length) return false;
  const available = new Set<string>(availableNamespaces);

  return getPotentialSiteTranslationNamespacesForPath(pathname).every((namespace) => available.has(namespace));
}

export function staticSiteLanguagesForPath(pathname: string) {
  const cacheKey = pathname || "/";
  const cached = staticPathAvailabilityCache.get(cacheKey);
  if (cached) return cached;

  const languages = supportedLanguages.filter((language) => isStaticSiteLanguageAvailableForPath(pathname, language));
  staticPathAvailabilityCache.set(cacheKey, languages);
  return languages;
}
