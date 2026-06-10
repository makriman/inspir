import { cookies, headers } from "next/headers";
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

export async function getRequestLanguage(): Promise<SupportedLanguage> {
  const requestHeaders = await headers();
  const headerLanguage = requestHeaders.get(requestLanguageHeader);
  if (headerLanguage) return normalizeLanguage(headerLanguage);

  const cookieStore = await cookies();
  return normalizeLanguage(cookieStore.get(localeCookieName)?.value ?? defaultLanguage);
}

export async function getRequestLanguageConfig(): Promise<LanguageConfig> {
  return languageConfigs[await getRequestLanguage()];
}

export async function getRequestRecommendedLanguage(): Promise<SupportedLanguage> {
  const requestHeaders = await headers();
  return normalizeLanguage(requestHeaders.get(requestRecommendedLanguageHeader) ?? defaultLanguage);
}

export async function getRequestPathname() {
  const requestHeaders = await headers();
  return requestHeaders.get(requestPathnameHeader) ?? "/";
}

export async function requestHasLocalePrefix() {
  const requestHeaders = await headers();
  return requestHeaders.get(requestLocalePrefixHeader) === "1";
}
