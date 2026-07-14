import fs from "node:fs";
import path from "node:path";
import {
  supportedLanguages,
  type SupportedLanguage,
} from "../../lib/content/languages";
import { getCuratedTranslationBundle } from "../../lib/i18n/curated-translations";
import {
  getPublishedLegacySiteTranslationPairs,
  isKnownLegacySiteTranslationNamespace,
  isPublishedLegacySiteTranslationPair,
  legacyTranslationAssetPath,
  type LegacySiteTranslationPair,
} from "../../lib/i18n/legacy-api-compat";
import { getCuratedMainAppTranslationBundle } from "../../lib/i18n/main-app-curated";
import { getMainAppSourceHash } from "../../lib/i18n/main-app-source";
import { getSiteTranslationSource } from "../../lib/i18n/site-source";
import type { TranslationBundle, TranslationResult } from "../../lib/i18n/translation-types";

export type LegacyTranslationApiAssetOptions = {
  mainAppLanguages?: readonly SupportedLanguage[];
  sitePairs?: readonly LegacySiteTranslationPair[];
};

export type LegacyTranslationApiAssetReport = {
  paths: string[];
  mainAppResponses: number;
  siteResponses: number;
  completeResponses: number;
  incompleteResponses: number;
  bytes: number;
};

export function materializeLegacyTranslationApiAssets(
  assetsRoot: string,
  options: LegacyTranslationApiAssetOptions = {},
): LegacyTranslationApiAssetReport {
  const mainAppLanguages = [...(options.mainAppLanguages ?? supportedLanguages)];
  const sitePairs = [...(options.sitePairs ?? getPublishedLegacySiteTranslationPairs())];
  assertUnique(mainAppLanguages, "main-app language");
  assertUnique(
    sitePairs.map(({ language, namespace }) => `${language}\u0000${namespace}`),
    "site pair",
  );

  const paths: string[] = [];
  let completeResponses = 0;
  let bytes = 0;
  const mainAppSourceHash = getMainAppSourceHash();

  for (const language of mainAppLanguages) {
    const bundle = getCuratedMainAppTranslationBundle(language);
    if (!bundle || bundle.language !== language || bundle.sourceHash !== mainAppSourceHash) {
      throw new Error(`The legacy main-app translation response is incomplete for ${language}.`);
    }
    const result = buildTranslationResult(bundle);
    if (!result.complete) {
      throw new Error(`The legacy main-app translation response is incomplete for ${language}.`);
    }
    const written = writeResultAsset(assetsRoot, "main-app", language, undefined, result);
    paths.push(written.path);
    bytes += written.bytes;
    completeResponses += 1;
  }

  for (const { language, namespace } of sitePairs) {
    if (!isKnownLegacySiteTranslationNamespace(namespace)) {
      throw new Error(`Unknown legacy site-translation namespace: ${namespace}`);
    }
    if (!isPublishedLegacySiteTranslationPair(language, namespace)) {
      throw new Error(
        `Unpublished legacy site-translation pair: ${language}/${namespace}`,
      );
    }
    const source = getSiteTranslationSource(namespace);
    if (source.namespace !== namespace) {
      throw new Error(`Unknown legacy site-translation namespace: ${namespace}`);
    }
    const bundle = getCuratedTranslationBundle(source, language);
    if (
      !bundle ||
      bundle.namespace !== namespace ||
      bundle.language !== language ||
      bundle.sourceHash !== source.sourceHash
    ) {
      throw new Error(
        `The published legacy site-translation response is stale or missing for ${language}/${namespace}.`,
      );
    }
    const result = buildTranslationResult(bundle);
    if (!result.complete) {
      throw new Error(
        `The published legacy site-translation response is incomplete for ${language}/${namespace}.`,
      );
    }
    const written = writeResultAsset(assetsRoot, "site", language, namespace, result);
    paths.push(written.path);
    bytes += written.bytes;
    completeResponses += 1;
  }

  paths.sort();
  return {
    paths,
    mainAppResponses: mainAppLanguages.length,
    siteResponses: sitePairs.length,
    completeResponses,
    incompleteResponses: 0,
    bytes,
  };
}

function buildTranslationResult(bundle: TranslationBundle): TranslationResult {
  const sourceKeys = Object.keys(bundle.sourceStrings);
  const translatedCount = sourceKeys.filter((key) => bundle.strings[key]?.trim()).length;
  const totalCount = sourceKeys.length;
  return {
    bundle,
    complete:
      translatedCount === totalCount && Object.keys(bundle.strings).length === totalCount,
    translatedCount,
    totalCount,
  };
}

function writeResultAsset(
  assetsRoot: string,
  kind: "main-app" | "site",
  language: SupportedLanguage,
  namespace: string | undefined,
  result: TranslationResult,
) {
  const relativePath = legacyTranslationAssetPath({
    kind,
    language,
    namespace,
  });
  const destination = path.resolve(assetsRoot, relativePath);
  const normalizedRoot = `${path.resolve(assetsRoot)}${path.sep}`;
  if (!destination.startsWith(normalizedRoot)) {
    throw new Error(`Refusing unsafe legacy translation asset path: ${relativePath}`);
  }
  const serialized = JSON.stringify(result);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, serialized);
  return { path: relativePath, bytes: Buffer.byteLength(serialized) };
}

function assertUnique(values: readonly string[], label: string) {
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new Error(`Duplicate legacy translation ${label}.`);
  }
}
