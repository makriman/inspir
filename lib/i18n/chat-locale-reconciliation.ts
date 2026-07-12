import {
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { getLocalizedPathInfo, localizeHref } from "@/lib/i18n/routing";

export type ChatLocaleRedirect = {
  href: string;
  language: SupportedLanguage;
};

export function parseSupportedChatLanguage(value: unknown): SupportedLanguage | null {
  if (typeof value !== "string") return null;
  return supportedLanguages.find((language) => language === value) ?? null;
}

export function getChatLocaleRedirect(
  location: string,
  routeLanguage: SupportedLanguage,
  preferredLanguage: unknown,
): ChatLocaleRedirect | null {
  const language = parseSupportedChatLanguage(preferredLanguage);
  if (!language || language === routeLanguage || !location) return null;

  try {
    const base = new URL("https://inspir.invalid");
    const url = new URL(location, base);
    if (url.origin !== base.origin) return null;

    const { pathnameWithoutLocale } = getLocalizedPathInfo(url.pathname);
    if (pathnameWithoutLocale !== "/chat" && !pathnameWithoutLocale.startsWith("/chat/")) {
      return null;
    }

    const currentHref = `${url.pathname}${url.search}${url.hash}`;
    const href = localizeHref(currentHref, language);
    return href === currentHref ? null : { href, language };
  } catch {
    return null;
  }
}
