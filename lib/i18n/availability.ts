import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { getPotentialSiteTranslationNamespacesForPath } from "@/lib/i18n/site-path-namespaces";
import {
  getCachedSiteTranslationBundle,
} from "@/lib/i18n/site-translations";
import { getRuntimeSiteTranslationSource } from "@/lib/i18n/runtime-site-source";
import { isTranslationBundleCompleteAndFluent } from "@/lib/i18n/translation-quality";
import { absoluteUrl } from "@/lib/seo/config";
import { localizePath } from "@/lib/i18n/routing";

export type LanguageAvailability = {
  language: SupportedLanguage;
  complete: boolean;
};

const languageAvailabilityCacheTtlMs = 30 * 1000;
const languageAvailabilityCache = new Map<string, { expiresAt: number; promise: Promise<LanguageAvailability> }>();
const pathAvailabilityCache = new Map<string, { expiresAt: number; promise: Promise<SupportedLanguage[]> }>();

export async function isSiteLanguageAvailableForPath(pathname: string, language: SupportedLanguage) {
  if (language === defaultLanguage) return true;
  const availability = await getSiteLanguageAvailabilityForLanguage(pathname, language);
  return availability.complete;
}

export async function availableSiteLanguagesForPath(pathname: string) {
  const cacheKey = pathname || "/";
  const cached = pathAvailabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = readAvailableSiteLanguagesForPath(pathname).catch((error) => {
    pathAvailabilityCache.delete(cacheKey);
    throw error;
  });
  pathAvailabilityCache.set(cacheKey, { expiresAt: Date.now() + languageAvailabilityCacheTtlMs, promise });
  return promise;
}

async function getSiteLanguageAvailabilityForLanguage(pathname: string, language: SupportedLanguage) {
  const cacheKey = `${pathname || "/"}\u0000${language}`;
  const cached = languageAvailabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = readSiteLanguageAvailabilityForLanguage(pathname, language).catch((error) => {
    languageAvailabilityCache.delete(cacheKey);
    throw error;
  });
  languageAvailabilityCache.set(cacheKey, { expiresAt: Date.now() + languageAvailabilityCacheTtlMs, promise });
  return promise;
}

async function readSiteLanguageAvailabilityForLanguage(
  pathname: string,
  language: SupportedLanguage,
): Promise<LanguageAvailability> {
  if (language === defaultLanguage) return { language, complete: true };

  const namespaces = getPotentialSiteTranslationNamespacesForPath(pathname);
  if (!namespaces.length) return { language, complete: true };

  for (const namespace of namespaces) {
    const source = await getRuntimeSiteTranslationSource(namespace);
    if (!source) return { language, complete: false };
    const bundle = await getCachedSiteTranslationBundle(language, namespace);
    if (!isTranslationBundleCompleteAndFluent(source, bundle, language)) {
      return { language, complete: false };
    }
  }

  return { language, complete: true };
}

async function readAvailableSiteLanguagesForPath(pathname: string) {
  const availability = await Promise.all(
    supportedLanguages.map(async (language) => ({
      language,
      available: await isSiteLanguageAvailableForPath(pathname, language),
    })),
  );
  return availability
    .filter((item) => item.available)
    .map((item) => item.language);
}

export function alternatesForAvailableLanguages(pathname: string, languages: SupportedLanguage[]) {
  return Object.fromEntries(
    languages.map((language) => [
      languageConfigs[language].locale,
      absoluteUrl(localizePath(pathname, language)),
    ]),
  );
}
