import {
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { knownSiteTranslationNamespaces } from "@/lib/i18n/site-namespace-manifest";

export const legacyLanguagePreferenceApiPath = "/api/language-preference";
export const legacyMainAppTranslationsApiPath = "/api/main-app-translations";
export const legacySiteTranslationsApiPath = "/api/site-translations";

export type LegacyTranslationCompletion = "complete" | "incomplete";
export type LegacyTranslationAssetKind = "main-app" | "site";

const supportedLanguageNames = new Set<string>(supportedLanguages);
const knownSiteNamespaces = new Set<string>(knownSiteTranslationNamespaces);
const safeNamespacePattern = /^[a-z0-9][a-z0-9:-]{0,127}$/;

export function isSupportedLegacyTranslationLanguage(
  value: string | null,
): value is SupportedLanguage {
  return value !== null && supportedLanguageNames.has(value);
}

export function isKnownLegacySiteTranslationNamespace(
  value: string | null,
): value is (typeof knownSiteTranslationNamespaces)[number] {
  return value !== null && safeNamespacePattern.test(value) && knownSiteNamespaces.has(value);
}

export function legacyTranslationAssetPath(options: {
  kind: LegacyTranslationAssetKind;
  language: SupportedLanguage;
  completion: LegacyTranslationCompletion;
  namespace?: string;
}) {
  const locale =
    languageConfigs[options.language].prefix || languageConfigs[options.language].locale;
  if (options.kind === "main-app") {
    return `i18n/legacy-api/main-app/${locale}.${options.completion}.json`;
  }

  const namespace = options.namespace;
  if (!namespace || !safeNamespacePattern.test(namespace)) {
    throw new Error(`Unsafe legacy site-translation namespace: ${namespace ?? "missing"}`);
  }
  return `i18n/legacy-api/site/${locale}/${namespace.replaceAll(":", "~")}.${options.completion}.json`;
}
