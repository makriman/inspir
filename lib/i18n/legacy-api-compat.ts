import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { staticSiteTranslationNamespaceAvailability } from "@/lib/i18n/site-availability-manifest";
import { knownSiteTranslationNamespaces } from "@/lib/i18n/site-namespace-manifest";
import { marketingShellTranslationNamespace } from "@/lib/i18n/site-source-constants";

export const legacyLanguagePreferenceApiPath = "/api/language-preference";
export const legacyMainAppTranslationsApiPath = "/api/main-app-translations";
export const legacySiteTranslationsApiPath = "/api/site-translations";
export const legacySiteTranslationStaticAssetNamespaces = [
  marketingShellTranslationNamespace,
  "route:home",
  "route:mission",
] as const;

export type LegacyTranslationAssetKind = "main-app" | "site";
export type LegacySiteTranslationPair = Readonly<{
  language: SupportedLanguage;
  namespace: string;
}>;

const supportedLanguageNames = new Set<string>(supportedLanguages);
const knownSiteNamespaces = new Set<string>(knownSiteTranslationNamespaces);
const legacySiteTranslationStaticAssetNamespaceSet = new Set<string>(
  legacySiteTranslationStaticAssetNamespaces,
);
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

export function getPublishedLegacySiteTranslationNamespaces(
  language: SupportedLanguage,
): readonly string[] {
  if (language === defaultLanguage) {
    return legacySiteTranslationStaticAssetNamespaces;
  }
  return (staticSiteTranslationNamespaceAvailability[language] ?? []).filter(
    (namespace) => legacySiteTranslationStaticAssetNamespaceSet.has(namespace),
  );
}

export function getPublishedLegacySiteTranslationPairs(): LegacySiteTranslationPair[] {
  return supportedLanguages.flatMap((language) =>
    getPublishedLegacySiteTranslationNamespaces(language).map((namespace) => ({
      language,
      namespace,
    })),
  );
}

export function isPublishedLegacySiteTranslationPair(
  language: SupportedLanguage,
  namespace: string,
) {
  return getPublishedLegacySiteTranslationNamespaces(language).includes(namespace);
}

export function legacyTranslationAssetPath(options: {
  kind: LegacyTranslationAssetKind;
  language: SupportedLanguage;
  namespace?: string;
}) {
  const locale =
    languageConfigs[options.language].prefix || languageConfigs[options.language].locale;
  if (options.kind === "main-app") {
    return `i18n/legacy-api/main-app/${locale}.complete.json`;
  }

  const namespace = options.namespace;
  if (!namespace || !safeNamespacePattern.test(namespace)) {
    throw new Error(`Unsafe legacy site-translation namespace: ${namespace ?? "missing"}`);
  }
  return `i18n/legacy-api/site/${locale}/${namespace.replaceAll(":", "~")}.complete.json`;
}
