import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { getSiteTranslationNamespacesForPath, getSiteTranslationSource } from "@/lib/i18n/site-source";
import { getCachedSiteTranslationBundle } from "@/lib/i18n/site-translations";
import { absoluteUrl } from "@/lib/seo/config";
import { localizePath } from "@/lib/i18n/routing";

export type LanguageAvailability = {
  language: SupportedLanguage;
  complete: boolean;
};

const availabilityCacheTtlMs = 5 * 60 * 1000;
const availabilityCache = new Map<string, { expiresAt: number; promise: Promise<LanguageAvailability[]> }>();

export function defaultOnlyLanguageAvailability(): LanguageAvailability[] {
  return supportedLanguages.map((language) => ({
    language,
    complete: language === defaultLanguage,
  }));
}

export async function getSiteLanguageAvailabilityForPath(pathname: string): Promise<LanguageAvailability[]> {
  const cacheKey = pathname || "/";
  const cached = availabilityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = readSiteLanguageAvailabilityForPath(pathname).catch((error) => {
    availabilityCache.delete(cacheKey);
    throw error;
  });
  availabilityCache.set(cacheKey, { expiresAt: Date.now() + availabilityCacheTtlMs, promise });
  return promise;
}

async function readSiteLanguageAvailabilityForPath(pathname: string): Promise<LanguageAvailability[]> {
  const namespaces = getSiteTranslationNamespacesForPath(pathname);
  const sources = new Map(namespaces.map((namespace) => [namespace, getSiteTranslationSource(namespace)]));

  return Promise.all(supportedLanguages.map(async (language) => {
    if (language === defaultLanguage) return { language, complete: true };
    const checks = await Promise.all(namespaces.map(async (namespace) => {
      const source = sources.get(namespace);
      if (!source) return false;
      const bundle = await getCachedSiteTranslationBundle(language, namespace);
      if (!bundle || bundle.sourceHash !== source.sourceHash) return false;
      return Object.keys(source.sourceStrings).every((key) => typeof bundle.strings[key] === "string" && bundle.strings[key].trim());
    }));
    const complete = checks.every(Boolean);
    return { language, complete };
  }));
}

export async function getAvailableSiteLanguagesForPath(pathname: string) {
  const availability = await getSiteLanguageAvailabilityForPath(pathname);
  return availability.filter((item) => item.complete).map((item) => item.language);
}

export async function isSiteLanguageAvailableForPath(pathname: string, language: SupportedLanguage) {
  if (language === defaultLanguage) return true;
  const available = await getAvailableSiteLanguagesForPath(pathname);
  return available.includes(language);
}

export function alternatesForAvailableLanguages(pathname: string, languages: SupportedLanguage[]) {
  return Object.fromEntries(
    languages.map((language) => [
      languageConfigs[language].locale,
      absoluteUrl(localizePath(pathname, language)),
    ]),
  );
}
