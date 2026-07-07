import {
  languageConfigs,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { absoluteUrl } from "@/lib/seo/config";
import { localizePath } from "@/lib/i18n/routing";

export function alternatesForAvailableLanguages(pathname: string, languages: SupportedLanguage[]) {
  return Object.fromEntries(
    languages.map((language) => [
      languageConfigs[language].locale,
      absoluteUrl(localizePath(pathname, language)),
    ]),
  );
}
