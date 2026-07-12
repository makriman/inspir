import fs from "node:fs";
import path from "node:path";
import {
  supportedLanguages,
  type SupportedLanguage,
} from "../../lib/content/languages";
import { getCuratedTranslationBundle } from "../../lib/i18n/curated-translations";
import {
  isKnownLegacySiteTranslationNamespace,
  legacyTranslationAssetPath,
  type LegacyTranslationCompletion,
} from "../../lib/i18n/legacy-api-compat";
import { getCuratedMainAppTranslationBundle } from "../../lib/i18n/main-app-curated";
import { getMainAppSourceHash } from "../../lib/i18n/main-app-source";
import { knownSiteTranslationNamespaces } from "../../lib/i18n/site-namespace-manifest";
import { getSiteTranslationSource } from "../../lib/i18n/site-source";
import type { TranslationBundle, TranslationResult } from "../../lib/i18n/translation-types";

export type LegacyTranslationApiAssetOptions = {
  languages?: readonly SupportedLanguage[];
  siteNamespaces?: readonly string[];
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
  const languages = [...(options.languages ?? supportedLanguages)];
  const siteNamespaces = [
    ...(options.siteNamespaces ?? knownSiteTranslationNamespaces),
  ];
  assertUnique(languages, "language");
  assertUnique(siteNamespaces, "site namespace");

  const paths: string[] = [];
  let completeResponses = 0;
  let incompleteResponses = 0;
  let bytes = 0;
  const mainAppSourceHash = getMainAppSourceHash();

  for (const language of languages) {
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

  for (const namespace of siteNamespaces) {
    if (!isKnownLegacySiteTranslationNamespace(namespace)) {
      throw new Error(`Unknown legacy site-translation namespace: ${namespace}`);
    }
    const source = getSiteTranslationSource(namespace);
    if (source.namespace !== namespace) {
      throw new Error(`Unknown legacy site-translation namespace: ${namespace}`);
    }
    for (const language of languages) {
      const curatedBundle = getCuratedTranslationBundle(source, language);
      const bundle: TranslationBundle = curatedBundle ?? {
        namespace,
        language,
        sourceHash: source.sourceHash,
        sourceStrings: source.sourceStrings,
        strings: {},
      };
      const result = buildTranslationResult(bundle);
      const written = writeResultAsset(assetsRoot, "site", language, namespace, result);
      paths.push(written.path);
      bytes += written.bytes;
      if (result.complete) completeResponses += 1;
      else incompleteResponses += 1;
    }
  }

  paths.sort();
  return {
    paths,
    mainAppResponses: languages.length,
    siteResponses: languages.length * siteNamespaces.length,
    completeResponses,
    incompleteResponses,
    bytes,
  };
}

function buildTranslationResult(bundle: TranslationBundle): TranslationResult {
  const translatedCount = Object.keys(bundle.strings).length;
  const totalCount = Object.keys(bundle.sourceStrings).length;
  return {
    bundle,
    complete: translatedCount === totalCount,
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
  const completion: LegacyTranslationCompletion = result.complete ? "complete" : "incomplete";
  const relativePath = legacyTranslationAssetPath({
    kind,
    language,
    completion,
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
