import { notFound } from "next/navigation";
import {
  defaultLanguage,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { getLanguageFromPrefix } from "@/lib/i18n/routing";

export type LocaleRouteParams = Promise<{ locale: string }>;

export async function resolveLocaleParam(params: LocaleRouteParams): Promise<SupportedLanguage> {
  const { locale } = await params;
  const language = getLanguageFromPrefix(locale);
  if (!language || language === defaultLanguage) notFound();
  return language;
}
