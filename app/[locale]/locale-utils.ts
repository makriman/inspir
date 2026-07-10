import { notFound } from "next/navigation";
import {
  defaultLanguage,
  languageConfigs,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { getLanguageFromPrefix } from "@/lib/i18n/routing";
import { staticSiteLanguagesForPath } from "@/lib/i18n/static-availability";

export type LocaleRouteParams = Promise<{ locale: string }>;

export async function resolveLocaleParam(params: LocaleRouteParams): Promise<SupportedLanguage> {
  const { locale } = await params;
  const language = getLanguageFromPrefix(locale);
  if (!language || language === defaultLanguage) notFound();
  return language;
}

export function generateLocalizedStaticParams(pathname: string): Array<{ locale: string }> {
  return staticSiteLanguagesForPath(pathname)
    .filter((language) => language !== defaultLanguage)
    .map((language) => ({ locale: languageConfigs[language].prefix }));
}
