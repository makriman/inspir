import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { siteSourceManifest } from "@/lib/i18n/site-source-manifest";
import { staticSiteTranslationNamespaceAvailability } from "@/lib/i18n/site-availability-manifest";
import {
  defaultLanguage,
  supportedLanguages,
} from "@/lib/content/languages";
import { getCuratedTranslationBundle } from "@/lib/i18n/curated-translations";
import { isRenderLocalizedSiteTranslationNamespace } from "@/lib/i18n/render-localized-namespaces";
import { isTranslationBundleCompleteAndFluent } from "@/lib/i18n/translation-quality";
import {
  getAllSiteTranslationNamespaces,
  getSiteSourceHash,
  getSiteTranslationSource,
  getSiteTranslationSourceKey,
  siteTranslationNamespace,
} from "@/lib/i18n/site-source";
import { buildStaticAssetLocalizedPathContract } from "./cloudflare/static-asset-release-contract";

export const SITE_SOURCE_MANIFEST_FRESHNESS_CHECK_NAME =
  "complete site source manifest freshness";

type SiteSourceEntry = Readonly<{
  namespace: string;
  sourceHash: string;
  sourceStrings: Readonly<Record<string, string>>;
}>;

export type SiteSourceManifestFreshnessValidation = Readonly<{
  namespaceCount: number;
  fieldCount: number;
  routedNamespaceCount: number;
  routedFieldCount: number;
  manifestRootSha256: string;
  extractedRootSha256: string;
  routedManifestRootSha256: string;
  routedExtractedRootSha256: string;
  staleNamespaceCount: 0;
  staleFieldCount: 0;
}>;

export type SiteAvailabilityManifestFreshnessValidation = Readonly<{
  availabilityLanguages: number;
  availabilityNamespaceEntries: number;
  availabilityRootSha256: string;
  invalidAdvertisedNamespaceCount: 0;
}>;

export type CurrentSiteSourceManifestFreshnessValidation =
  SiteSourceManifestFreshnessValidation &
  SiteAvailabilityManifestFreshnessValidation &
  Readonly<{
    localizedHtmlPaths: number;
    localizedHtmlPathsSha256: string;
  }>;

export function assertSiteSourceManifestFreshness(input: Readonly<{
  extractedNamespaceOrder: readonly string[];
  manifest: unknown;
  extractSource: (namespace: string) => unknown;
  aggregateNamespace?: string;
}>): SiteSourceManifestFreshnessValidation {
  const extractedNamespaceOrder = validateNamespaceOrder(
    input.extractedNamespaceOrder,
    "extracted site source",
  );
  if (
    input.aggregateNamespace !== undefined &&
    !extractedNamespaceOrder.includes(input.aggregateNamespace)
  ) {
    throw new Error(
      `The aggregate site source namespace ${JSON.stringify(input.aggregateNamespace)} is absent from extraction.`,
    );
  }

  const manifestRecord = requireRecord(input.manifest, "generated site source manifest");
  const manifestNamespaceOrder = validateNamespaceOrder(
    Object.keys(manifestRecord),
    "generated site source manifest",
  );
  assertExactOrderedSequence(
    manifestNamespaceOrder,
    extractedNamespaceOrder,
    "Generated site source manifest namespace order is stale",
  );

  const manifestEntries: SiteSourceEntry[] = [];
  const extractedEntries: SiteSourceEntry[] = [];
  for (const namespace of extractedNamespaceOrder) {
    const manifestEntry = parseSiteSourceEntry(
      manifestRecord[namespace],
      namespace,
      false,
      "generated manifest",
    );
    const extractedEntry = parseSiteSourceEntry(
      input.extractSource(namespace),
      namespace,
      true,
      "current extraction",
    );

    validateEntryIntegrity(manifestEntry, "Generated manifest");
    validateEntryIntegrity(extractedEntry, "Current extraction");
    assertEntriesEqual(manifestEntry, extractedEntry);
    manifestEntries.push(manifestEntry);
    extractedEntries.push(extractedEntry);
  }

  const manifestSnapshot = buildSnapshot(manifestEntries);
  const extractedSnapshot = buildSnapshot(extractedEntries);
  if (manifestSnapshot.rootSha256 !== extractedSnapshot.rootSha256) {
    throw new Error(
      "Generated site source manifest root differs from the current extraction after field validation.",
    );
  }

  const routedManifestEntries = withoutAggregate(
    manifestEntries,
    input.aggregateNamespace,
  );
  const routedExtractedEntries = withoutAggregate(
    extractedEntries,
    input.aggregateNamespace,
  );
  const routedManifestSnapshot = buildSnapshot(routedManifestEntries);
  const routedExtractedSnapshot = buildSnapshot(routedExtractedEntries);
  if (routedManifestSnapshot.rootSha256 !== routedExtractedSnapshot.rootSha256) {
    throw new Error(
      "Generated routed site source manifest root differs from the current extraction.",
    );
  }

  return Object.freeze({
    namespaceCount: manifestEntries.length,
    fieldCount: manifestSnapshot.fieldCount,
    routedNamespaceCount: routedManifestEntries.length,
    routedFieldCount: routedManifestSnapshot.fieldCount,
    manifestRootSha256: manifestSnapshot.rootSha256,
    extractedRootSha256: extractedSnapshot.rootSha256,
    routedManifestRootSha256: routedManifestSnapshot.rootSha256,
    routedExtractedRootSha256: routedExtractedSnapshot.rootSha256,
    staleNamespaceCount: 0,
    staleFieldCount: 0,
  });
}

export function assertCurrentSiteSourceManifestFreshness(options: Readonly<{
  workspaceRoot?: string;
}> = {}): CurrentSiteSourceManifestFreshnessValidation {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const activeRoot = path.resolve(process.cwd());
  if (workspaceRoot !== activeRoot) {
    throw new Error(
      `Site source extraction is bound to the active workspace ${activeRoot}; refusing to attest ${workspaceRoot}.`,
    );
  }

  const source = assertSiteSourceManifestFreshness({
    extractedNamespaceOrder: [
      siteTranslationNamespace,
      ...getAllSiteTranslationNamespaces({ mode: "extract" }),
    ],
    manifest: siteSourceManifest,
    extractSource: (namespace) =>
      getSiteTranslationSource(namespace, { mode: "extract" }),
    aggregateNamespace: siteTranslationNamespace,
  });
  const targetLanguages = supportedLanguages.filter(
    (language) => language !== defaultLanguage,
  );
  const renderNamespaces = Object.keys(siteSourceManifest).filter(
    (namespace) =>
      namespace !== siteTranslationNamespace &&
      isRenderLocalizedSiteTranslationNamespace(namespace),
  );
  const availability = assertSiteAvailabilityManifestFreshness({
    languages: targetLanguages,
    namespaces: renderNamespaces,
    availability: staticSiteTranslationNamespaceAvailability,
    isAvailable: (language, namespace) => {
      const translationSource = getSiteTranslationSource(namespace);
      return isTranslationBundleCompleteAndFluent(
        translationSource,
        getCuratedTranslationBundle(translationSource, language),
        language,
      );
    },
  });
  const localizedPaths = buildStaticAssetLocalizedPathContract(
    staticSiteTranslationNamespaceAvailability,
  );
  return Object.freeze({
    ...source,
    ...availability,
    localizedHtmlPaths: localizedPaths.localizedPaths.length,
    localizedHtmlPathsSha256: localizedPaths.localizedPathsSha256,
  });
}

export function assertSiteAvailabilityManifestFreshness<Language extends string>(
  input: Readonly<{
    languages: readonly Language[];
    namespaces: readonly string[];
    availability: unknown;
    isAvailable: (language: Language, namespace: string) => boolean;
  }>,
): SiteAvailabilityManifestFreshnessValidation {
  const languages = validateNamespaceOrder(
    input.languages,
    "site availability languages",
  ).map((language) => {
    const matched = input.languages.find((candidate) => candidate === language);
    if (matched === undefined) {
      throw new Error(`Site availability language ${language} is invalid.`);
    }
    return matched;
  });
  const namespaces = validateNamespaceOrder(
    input.namespaces,
    "render-localized site namespaces",
  );
  const rawAvailability = requireRecord(
    input.availability,
    "generated site availability manifest",
  );
  const languageSet = new Set<string>(languages);
  const unexpectedLanguages = Object.keys(rawAvailability).filter(
    (language) => !languageSet.has(language),
  );
  if (unexpectedLanguages.length) {
    throw new Error(
      `Generated site availability manifest contains unknown languages: ${unexpectedLanguages.join(", ")}.`,
    );
  }
  const expectedRows: Array<readonly [Language, readonly string[]]> = [];
  const actualRows: Array<readonly [Language, readonly string[]]> = [];
  const invalidAdvertised: string[] = [];
  for (const language of languages) {
    const expected = namespaces.filter((namespace) =>
      input.isAvailable(language, namespace)
    );
    const raw = rawAvailability[language];
    if (raw !== undefined && !Array.isArray(raw)) {
      throw new Error(
        `Generated site availability manifest entry for ${language} must be an array.`,
      );
    }
    const actual = (raw ?? []).map((namespace) => {
      if (typeof namespace !== "string" || !namespace) {
        throw new Error(
          `Generated site availability manifest contains an invalid namespace for ${language}.`,
        );
      }
      return namespace;
    });
    if (new Set(actual).size !== actual.length) {
      throw new Error(
        `Generated site availability manifest duplicates a namespace for ${language}.`,
      );
    }
    for (const namespace of actual) {
      if (!input.isAvailable(language, namespace)) {
        invalidAdvertised.push(`${language}/${namespace}`);
      }
    }
    assertExactOrderedSequence(
      actual,
      expected,
      `Generated site availability manifest is stale for ${language}`,
    );
    expectedRows.push([language, expected]);
    actualRows.push([language, actual]);
  }
  if (invalidAdvertised.length) {
    throw new Error(
      `Generated site availability manifest advertises non-current or non-fluent packs: ${invalidAdvertised.slice(0, 20).join(", ")}.`,
    );
  }
  const expectedRoot = sha256(JSON.stringify(expectedRows));
  const actualRoot = sha256(JSON.stringify(actualRows));
  if (expectedRoot !== actualRoot) {
    throw new Error("Generated site availability manifest root is stale.");
  }
  return Object.freeze({
    availabilityLanguages: actualRows.filter(([, entries]) => entries.length > 0).length,
    availabilityNamespaceEntries: actualRows.reduce(
      (total, [, entries]) => total + entries.length,
      0,
    ),
    availabilityRootSha256: actualRoot,
    invalidAdvertisedNamespaceCount: 0,
  });
}

export function siteSourceStringsSha256(
  sourceStrings: Readonly<Record<string, string>>,
) {
  return getSiteSourceHash(sourceStrings);
}

export function siteSourceKey(source: string) {
  return getSiteTranslationSourceKey(source);
}

function parseSiteSourceEntry(
  value: unknown,
  expectedNamespace: string,
  requireNamespace: boolean,
  label: string,
): SiteSourceEntry {
  const record = requireRecord(value, `${label} entry ${expectedNamespace}`);
  if (requireNamespace && record.namespace !== expectedNamespace) {
    throw new Error(
      `${label} returned namespace ${JSON.stringify(record.namespace)} for ${expectedNamespace}.`,
    );
  }
  if (typeof record.sourceHash !== "string" || !isSha256(record.sourceHash)) {
    throw new Error(`${label} source hash is invalid for ${expectedNamespace}.`);
  }
  const sourceStringRecord = requireRecord(
    record.sourceStrings,
    `${label} source strings for ${expectedNamespace}`,
  );
  const sourceStrings: Record<string, string> = {};
  for (const key of Object.keys(sourceStringRecord)) {
    const source = sourceStringRecord[key];
    if (typeof source !== "string") {
      throw new Error(`${label} source field ${expectedNamespace}/${key} is not a string.`);
    }
    sourceStrings[key] = source;
  }
  return {
    namespace: expectedNamespace,
    sourceHash: record.sourceHash,
    sourceStrings,
  };
}

function validateEntryIntegrity(entry: SiteSourceEntry, label: string) {
  const recomputedHash = siteSourceStringsSha256(entry.sourceStrings);
  if (entry.sourceHash !== recomputedHash) {
    throw new Error(
      `${label} source hash is stale for ${entry.namespace}: ${entry.sourceHash} != ${recomputedHash}.`,
    );
  }
  for (const [key, source] of Object.entries(entry.sourceStrings)) {
    const expectedKey = siteSourceKey(source);
    if (key !== expectedKey) {
      throw new Error(
        `${label} source key is stale for ${entry.namespace}/${key}; expected ${expectedKey}.`,
      );
    }
  }
}

function assertEntriesEqual(
  manifestEntry: SiteSourceEntry,
  extractedEntry: SiteSourceEntry,
) {
  const namespace = extractedEntry.namespace;
  if (manifestEntry.sourceHash !== extractedEntry.sourceHash) {
    throw new Error(
      `Generated site source manifest hash is stale for ${namespace}: ${manifestEntry.sourceHash} != ${extractedEntry.sourceHash}.`,
    );
  }

  const manifestKeys = Object.keys(manifestEntry.sourceStrings).sort();
  const extractedKeys = Object.keys(extractedEntry.sourceStrings).sort();
  assertExactOrderedSequence(
    manifestKeys,
    extractedKeys,
    `Generated site source manifest field set is stale for ${namespace}`,
  );
  for (const key of extractedKeys) {
    if (manifestEntry.sourceStrings[key] !== extractedEntry.sourceStrings[key]) {
      throw new Error(
        `Generated site source manifest field is stale for ${namespace}/${key}.`,
      );
    }
  }
}

function buildSnapshot(entries: readonly SiteSourceEntry[]) {
  const fieldCount = entries.reduce(
    (count, entry) => count + Object.keys(entry.sourceStrings).length,
    0,
  );
  const payload = JSON.stringify(
    entries.map((entry) => [
      entry.namespace,
      entry.sourceHash,
      Object.keys(entry.sourceStrings)
        .sort()
        .map((key) => [key, entry.sourceStrings[key]]),
    ]),
  );
  return Object.freeze({ fieldCount, rootSha256: sha256(payload) });
}

function withoutAggregate(
  entries: readonly SiteSourceEntry[],
  aggregateNamespace: string | undefined,
) {
  if (aggregateNamespace === undefined) return [...entries];
  return entries.filter((entry) => entry.namespace !== aggregateNamespace);
}

function validateNamespaceOrder(values: readonly string[], label: string) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${label} contains an invalid namespace.`);
    }
    if (seen.has(value)) {
      throw new Error(`${label} contains duplicate namespace ${value}.`);
    }
    seen.add(value);
    result.push(value);
  }
  if (result.length === 0) {
    throw new Error(`${label} contains no namespaces.`);
  }
  return result;
}

function assertExactOrderedSequence(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
) {
  const firstMismatch = Math.min(actual.length, expected.length);
  let mismatchIndex = firstMismatch;
  for (let index = 0; index < firstMismatch; index += 1) {
    if (actual[index] !== expected[index]) {
      mismatchIndex = index;
      break;
    }
  }
  if (actual.length === expected.length && mismatchIndex === firstMismatch) return;
  throw new Error(
    `${label} at index ${mismatchIndex}: ${JSON.stringify(actual[mismatchIndex])} != ${JSON.stringify(expected[mismatchIndex])}; counts ${actual.length} != ${expected.length}.`,
  );
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return Object.fromEntries(
    Object.keys(value).map((key) => [key, Reflect.get(value, key)]),
  );
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isSha256(value: string) {
  return /^[a-f0-9]{64}$/.test(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = assertCurrentSiteSourceManifestFreshness();
    console.log(
      JSON.stringify(
        {
          check: SITE_SOURCE_MANIFEST_FRESHNESS_CHECK_NAME,
          ok: true,
          ...result,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          check: SITE_SOURCE_MANIFEST_FRESHNESS_CHECK_NAME,
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}
