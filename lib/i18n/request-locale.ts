import { cookies, headers } from "next/headers";
import { cache } from "react";
import {
  defaultLanguage,
  languageConfigs,
  normalizeLanguage,
  type LanguageConfig,
  type SupportedLanguage,
} from "@/lib/content/languages";
import {
  localeCookieName,
  requestLanguageHeader,
  requestLocalePrefixHeader,
  requestPathnameHeader,
  requestRecommendedLanguageHeader,
} from "@/lib/i18n/routing";

export const getRequestLanguage = cache(async function getRequestLanguage(): Promise<SupportedLanguage> {
  const { language: headerLanguage } = await getRequestLocaleHeaderSnapshot();
  if (headerLanguage) return normalizeLanguage(headerLanguage);

  const cookieStore = await cookies();
  return normalizeLanguage(cookieStore.get(localeCookieName)?.value ?? defaultLanguage);
});

export const getRequestLanguageConfig = cache(async function getRequestLanguageConfig(): Promise<LanguageConfig> {
  return languageConfigs[await getRequestLanguage()];
});

export const getRequestRecommendedLanguage = cache(async function getRequestRecommendedLanguage(): Promise<SupportedLanguage> {
  const { recommendedLanguage } = await getRequestLocaleHeaderSnapshot();
  return normalizeLanguage(recommendedLanguage ?? defaultLanguage);
});

export const getRequestPathname = cache(async function getRequestPathname() {
  const { pathname } = await getRequestLocaleHeaderSnapshot();
  return pathname ?? "/";
});

export const requestHasLocalePrefix = cache(async function requestHasLocalePrefix() {
  const { hasLocalePrefix } = await getRequestLocaleHeaderSnapshot();
  return hasLocalePrefix;
});

const getRequestLocaleHeaderSnapshot = cache(async function getRequestLocaleHeaderSnapshot() {
  const requestHeaders = await headers();
  return {
    language: requestHeaders.get(requestLanguageHeader),
    recommendedLanguage: requestHeaders.get(requestRecommendedLanguageHeader),
    pathname: requestHeaders.get(requestPathnameHeader),
    hasLocalePrefix: requestHeaders.get(requestLocalePrefixHeader) === "1",
  };
});
