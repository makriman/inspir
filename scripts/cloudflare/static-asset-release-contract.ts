import { createHash } from "node:crypto";
import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "../../lib/content/languages";
import { staticSiteTranslationNamespaceAvailability } from "../../lib/i18n/site-availability-manifest";
import { getPotentialSiteTranslationNamespacesForPath } from "../../lib/i18n/site-path-namespaces";
import { renderLocalizedSiteTranslationNamespaces } from "../../lib/i18n/render-localized-namespaces";

export const STATIC_ASSET_RELEASE_FILE_LIMIT = 5_000;
export const STATIC_ASSET_RELEASE_MAX_FILE_BYTES = 25 * 1024 * 1024;

const localizedStaticRouteSuffixes = [
  "",
  "about",
  "ai-learning-map",
  "blog",
  "chat",
  "compare",
  "for",
  "learn",
  "media",
  "mission",
  "privacy",
  "prompts",
  "schools",
  "subjects",
  "terms",
  "topics",
  "trust",
] as const;

export type StaticAssetTranslationAvailability = Partial<
  Record<SupportedLanguage, readonly string[]>
>;

export type StaticAssetLocalizedPathContract = Readonly<{
  availabilitySha256: string;
  localizedPathsSha256: string;
  localizedPaths: readonly string[];
}>;

/**
 * These are the localized HTML documents that must be present in the final
 * Static Assets tree. OpenNext's internal cache is build input, not uploaded
 * release output, so the release contract is intentionally expressed in
 * `.open-next/assets` paths.
 */
export function buildStaticAssetLocalizedPathContract(
  availability: StaticAssetTranslationAvailability,
): StaticAssetLocalizedPathContract {
  const targetLanguages = supportedLanguages.filter(
    (language) => language !== defaultLanguage,
  );
  const targetLanguageSet = new Set<SupportedLanguage>(targetLanguages);
  const rawLanguageKeys = Object.keys(availability);
  for (const language of rawLanguageKeys) {
    if (!isSupportedLanguage(language) || !targetLanguageSet.has(language)) {
      throw new Error(
        `Static translation availability contains an unsupported language key: ${language}.`,
      );
    }
  }
  const actualLanguageOrder = rawLanguageKeys.map((language) => {
    if (!isSupportedLanguage(language) || !targetLanguageSet.has(language)) {
      throw new Error(`Static translation availability language is invalid: ${language}.`);
    }
    return language;
  });
  const expectedLanguageOrder = targetLanguages.filter((language) =>
    Object.prototype.hasOwnProperty.call(availability, language)
  );
  if (!sameStringSequence(actualLanguageOrder, expectedLanguageOrder)) {
    throw new Error(
      "Static translation availability language keys are not in canonical supported-language order.",
    );
  }
  const allowedNamespaces = new Set<string>(
    renderLocalizedSiteTranslationNamespaces,
  );
  const namespaceOrder = new Map<string, number>(
    renderLocalizedSiteTranslationNamespaces.map((namespace, index) => [namespace, index]),
  );
  const availabilityRows = supportedLanguages
    .filter((language) => language !== defaultLanguage)
    .map((language) => {
      const namespaces = [...(availability[language] ?? [])];
      if (
        Object.prototype.hasOwnProperty.call(availability, language) &&
        namespaces.length === 0
      ) {
        throw new Error(
          `Static translation availability must omit empty language entries for ${language}.`,
        );
      }
      if (new Set(namespaces).size !== namespaces.length) {
        throw new Error(`Static translation availability contains duplicate namespaces for ${language}.`);
      }
      const unsupportedNamespace = namespaces.find(
        (namespace) => !allowedNamespaces.has(namespace),
      );
      if (unsupportedNamespace) {
        throw new Error(
          `Static translation availability contains a non-render namespace for ${language}: ${unsupportedNamespace}.`,
        );
      }
      for (let index = 1; index < namespaces.length; index += 1) {
        const previous = namespaceOrder.get(namespaces[index - 1] ?? "");
        const current = namespaceOrder.get(namespaces[index] ?? "");
        if (previous === undefined || current === undefined || previous >= current) {
          throw new Error(
            `Static translation availability namespaces are not canonical for ${language}.`,
          );
        }
      }
      return Object.freeze([language, Object.freeze(namespaces)] as const);
    });
  const localizedPaths = availabilityRows
    .flatMap(([language, namespaces]) => {
      const available = new Set(namespaces);
      const prefix = languageConfigs[language].prefix;
      return localizedStaticRouteSuffixes.flatMap((suffix) => {
        // Chat uses the complete static main-app bundle, not a marketing-site
        // namespace. Every other localized document is admitted only when the
        // generated availability manifest proves all of its source namespaces.
        const routeAvailable = suffix === "chat" ||
          getPotentialSiteTranslationNamespacesForPath(
            suffix ? `/${suffix}` : "/",
          ).every((namespace) => available.has(namespace));
        return routeAvailable
          ? [`${prefix}${suffix ? `/${suffix}` : ""}/index.html`]
          : [];
      });
    })
    .sort(compareCodePoints);
  if (new Set(localizedPaths).size !== localizedPaths.length) {
    throw new Error("Static translation availability produced duplicate localized asset paths.");
  }
  return Object.freeze({
    availabilitySha256: hashCanonicalRows(availabilityRows),
    localizedPathsSha256: hashPathSet(localizedPaths),
    localizedPaths: Object.freeze(localizedPaths),
  });
}

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return supportedLanguages.some((language) => language === value);
}

function sameStringSequence(left: readonly string[], right: readonly string[]) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

export const staticAssetLocalizedPathContract =
  buildStaticAssetLocalizedPathContract(
    staticSiteTranslationNamespaceAvailability,
  );

export const expectedLocalizedStaticAssetPaths =
  staticAssetLocalizedPathContract.localizedPaths;

function hashCanonicalRows(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashPathSet(paths: readonly string[]): string {
  return createHash("sha256").update(paths.join("\n")).digest("hex");
}

function compareCodePoints(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
