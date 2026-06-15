import {
  defaultLanguage,
  normalizeLanguage,
  type SupportedLanguage,
} from "@/lib/content/languages";

type ResolveRequestLanguageInput = {
  localeLanguage?: SupportedLanguage | null;
  cookieLanguage?: string | null;
  referrerLanguage?: SupportedLanguage | null;
};

export function resolveRequestLanguage({
  localeLanguage,
  cookieLanguage,
  referrerLanguage,
}: ResolveRequestLanguageInput): SupportedLanguage {
  if (localeLanguage) return localeLanguage;
  if (cookieLanguage) return normalizeLanguage(cookieLanguage);
  return referrerLanguage ?? defaultLanguage;
}
