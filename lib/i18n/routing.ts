import {
  defaultLanguage,
  languageConfigs,
  languagePrefixToLanguage,
  languageUrlPrefixes,
  normalizeLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";

export const localeCookieName = "inspir_locale";
export const localePromptCookieName = "inspir_locale_prompt_dismissed";
export const requestLanguageHeader = "x-inspir-language";
export const requestLocaleHeader = "x-inspir-locale";
export const requestLocalePrefixHeader = "x-inspir-locale-prefix";
export const requestPathnameHeader = "x-inspir-pathname";
export const requestRecommendedLanguageHeader = "x-inspir-recommended-language";

export type LocalizedPathInfo = {
  language: SupportedLanguage;
  prefix: string;
  hasLocalePrefix: boolean;
  pathnameWithoutLocale: string;
};

export function getLanguagePrefix(language: SupportedLanguage | string) {
  return languageUrlPrefixes[normalizeLanguage(language)] ?? "";
}

export function isLocalePrefix(value: string) {
  return Boolean(languagePrefixToLanguage[value.toLowerCase()]);
}

export function getLanguageFromPrefix(prefix: string) {
  return languagePrefixToLanguage[prefix.toLowerCase()] ?? null;
}

export function getLocalizedPathInfo(pathname: string): LocalizedPathInfo {
  const normalizedPathname = normalizePathname(pathname);
  const [, possiblePrefix] = normalizedPathname.split("/");
  const language = possiblePrefix ? getLanguageFromPrefix(possiblePrefix) : null;
  if (!language) {
    return {
      language: defaultLanguage,
      prefix: "",
      hasLocalePrefix: false,
      pathnameWithoutLocale: normalizedPathname,
    };
  }

  const stripped = normalizedPathname.slice(possiblePrefix.length + 1) || "/";
  return {
    language,
    prefix: possiblePrefix,
    hasLocalePrefix: true,
    pathnameWithoutLocale: normalizePathname(stripped),
  };
}

export function stripLocalePrefix(pathname: string) {
  return getLocalizedPathInfo(pathname).pathnameWithoutLocale;
}

export function localizePath(path: string, language: SupportedLanguage | string) {
  const normalizedLanguage = normalizeLanguage(language);
  const prefix = getLanguagePrefix(normalizedLanguage);
  const normalizedPath = normalizePathname(path);
  if (!prefix) return normalizedPath;
  if (normalizedPath === "/") return `/${prefix}`;
  return `/${prefix}${normalizedPath}`;
}

export function removeLocaleFromPath(path: string) {
  const [pathname, suffix = ""] = splitPathAndSuffix(path);
  return `${stripLocalePrefix(pathname)}${suffix}`;
}

export function localizeHref(href: string, language: SupportedLanguage | string) {
  if (/^(?:https?:|mailto:|tel:|#)/i.test(href)) return href;
  const [pathname, suffix = ""] = splitPathAndSuffix(href);
  return `${localizePath(removeLocaleFromPath(pathname), language)}${suffix}`;
}

export function languageAlternatesForPath(path: string) {
  return Object.fromEntries(
    supportedLanguages.map((language) => {
      const config = languageConfigs[language];
      return [config.locale, localizePath(path, language)];
    }),
  );
}

export function normalizePathname(pathname: string) {
  const value = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return value.length > 1 ? value.replace(/\/+$/, "") : "/";
}

function splitPathAndSuffix(path: string) {
  const match = /^([^?#]*)([?#].*)?$/.exec(path);
  return [match?.[1] || "/", match?.[2] || ""] as const;
}
