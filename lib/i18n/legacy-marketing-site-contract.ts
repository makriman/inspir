import { createHash } from "node:crypto";
import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "@/lib/content/languages";
import { validateTranslationCandidateField } from "@/lib/i18n/translation-candidate-quality";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import {
  isTranslationBundleCompleteAndFluent,
  isTranslationBundleFieldValid,
} from "@/lib/i18n/translation-quality";
import { siteSourceManifest } from "@/lib/i18n/site-source-manifest";
import type {
  TranslationBundle,
  TranslationSource,
} from "@/lib/i18n/translation-types";
import {
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
  LONG_TAIL_TRANSLATION_PROTECTOR_VERSION,
  hasExactLongTailInvariantParity,
  protectLongTailSourceText,
} from "@/scripts/generate-long-tail-translations";
import { LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256 } from "@/scripts/long-tail-nllb-execution-profile";

export const LEGACY_MARKETING_SITE_NAMESPACE = "marketing-site" as const;
export const LEGACY_MARKETING_SITE_DELTA_ROOT =
  "translations/legacy-marketing-site-delta" as const;
export const LEGACY_MARKETING_SITE_DELTA_MANIFEST_RELATIVE_PATH =
  `${LEGACY_MARKETING_SITE_DELTA_ROOT}/manifest.json` as const;
export const LEGACY_MARKETING_SITE_DELTA_RUN_DIRECTORY =
  "tmp/legacy-marketing-site-delta-v1" as const;
export const LEGACY_MARKETING_SITE_DELTA_CORPUS_KIND =
  "inspir-legacy-marketing-site-delta-corpus-v1" as const;
const LEGACY_MARKETING_SITE_CURATED_PROVENANCE_KIND =
  "inspir-long-tail-curated-provenance-v1" as const;
const LEGACY_MARKETING_SITE_COMPOSED_CORPUS_KIND =
  "inspir-legacy-marketing-site-composed-corpus-v1" as const;
const LEGACY_MARKETING_SITE_COMPOSED_MODEL_PREFIX =
  "legacy-marketing-site-composed-v1:" as const;
export const LEGACY_MARKETING_SITE_GRANDFATHERED_ENTRY_MODELS = Object.freeze([
  "curated-quality-repair-v2",
  "curated-quality-repair-v3",
] as const);

export const LEGACY_MARKETING_SITE_EXPECTED_ROUTE_NAMESPACE_COUNT = 124;
export const LEGACY_MARKETING_SITE_EXPECTED_ROUTE_KEY_COUNT = 4_456;
export const LEGACY_MARKETING_SITE_EXPECTED_DELTA_KEY_COUNT = 40;
export const LEGACY_MARKETING_SITE_EXPECTED_PAYLOAD_KEY_COUNT = 4_496;
export const LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT = 69;
export const LEGACY_MARKETING_SITE_EXPECTED_CURATED_SITE_ROW_COUNT = 8_556;
export const LEGACY_MARKETING_SITE_EXPECTED_SITE_ROW_COUNT = 8_625;
export const LEGACY_MARKETING_SITE_EXPECTED_FINAL_TRANSLATION_ROW_COUNT = 8_694;
export const LEGACY_MARKETING_SITE_D1_MAX_STATEMENT_BYTES = 99_999;
const LEGACY_MARKETING_SITE_D1_MAX_WRITE_BATCH_ROWS = 25;

export const LEGACY_MARKETING_SITE_EXPECTED_SOURCE_HASH =
  "1f55532abaf57a40388508a7e26135a7505c3db8fb8653be36ca30596f5deb64" as const;
export const LEGACY_MARKETING_SITE_EXPECTED_ROUTE_UNION_HASH =
  "b2fe639257070fa976b48309745610b3a759b11393df0dbc129d1fd42389cc86" as const;
export const LEGACY_MARKETING_SITE_EXPECTED_DELTA_HASH =
  "da31fac9206a335a8c7fae5f32c6cdb2279c64773058fd08a57e52cbdc836ce9" as const;
export const LEGACY_MARKETING_SITE_EXPECTED_OWNER_MAP_HASH =
  "fbd0d191d3181a405039fa4e113a5a6720f3261ab3e7667d254ee5dc163ba1b6" as const;

const sha256Pattern = /^[a-f0-9]{64}$/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export type LegacyMarketingSiteTargetLanguage = Exclude<
  SupportedLanguage,
  typeof defaultLanguage
>;

export const legacyMarketingSiteTargetLanguages = Object.freeze(
  supportedLanguages.filter(
    (language): language is LegacyMarketingSiteTargetLanguage =>
      language !== defaultLanguage,
  ),
);

export type LegacyMarketingSiteSourceManifestEntry = Readonly<{
  sourceHash: string;
  sourceStrings: Readonly<Record<string, string>>;
}>;

export type LegacyMarketingSiteSourceManifest = Readonly<
  Record<string, LegacyMarketingSiteSourceManifestEntry>
>;

export type LegacyMarketingSiteContract = Readonly<{
  namespace: typeof LEGACY_MARKETING_SITE_NAMESPACE;
  marketingSourceHash: string;
  marketingSourceStrings: Readonly<Record<string, string>>;
  routeNamespaces: readonly string[];
  routeSourcesByNamespace: Readonly<
    Record<string, LegacyMarketingSiteSourceManifestEntry>
  >;
  routeUnionSourceStrings: Readonly<Record<string, string>>;
  routeUnionHash: string;
  deltaSourceStrings: Readonly<Record<string, string>>;
  deltaHash: string;
  ownerByKey: Readonly<Record<string, string>>;
  ownerMapHash: string;
}>;

export type LegacyMarketingSiteTranslationPack = Readonly<{
  schemaVersion: 1;
  language: SupportedLanguage;
  locale: string;
  namespace: string;
  sourceHash: string;
  model: string;
  entries?: readonly Readonly<{
    key: string;
    source: string;
    value: string;
  }>[];
  translations?: Readonly<Record<string, string>>;
}>;

export type LegacyMarketingSiteDeltaPackProvenance = Readonly<{
  kind: typeof LEGACY_MARKETING_SITE_CURATED_PROVENANCE_KIND;
  pipelineVersion: string;
  executionProfileSha256: string;
  protectorVersion: string;
  protectorSha256: string;
  masterWorklistSha256: string;
  packWorklistSha256: string;
  jobSha256: string;
  sourceEntriesSha256: string;
  modelSha256: string;
  pipelineImplementationSha256: string;
  workerImplementationSha256: string;
  validatorPolicySha256: string;
  candidateSha256: string;
  provenanceSha256: string;
}>;

export type LegacyMarketingSiteDeltaPack = Readonly<{
  schemaVersion: 1;
  language: LegacyMarketingSiteTargetLanguage;
  locale: string;
  namespace: typeof LEGACY_MARKETING_SITE_NAMESPACE;
  sourceHash: string;
  model: string;
  provenance: LegacyMarketingSiteDeltaPackProvenance;
  translations: Readonly<Record<string, string>>;
}>;

export type LegacyMarketingSiteDeltaPackArtifact = Readonly<{
  relativePath: string;
  bytes: Uint8Array;
}>;

export type LegacyMarketingSiteDeltaCorpusPack = Readonly<{
  language: LegacyMarketingSiteTargetLanguage;
  locale: string;
  relativePath: string;
  bytes: number;
  sha256: string;
  provenanceSha256: string;
}>;

export type LegacyMarketingSiteDeltaCorpusManifest = Readonly<{
  schemaVersion: 1;
  kind: typeof LEGACY_MARKETING_SITE_DELTA_CORPUS_KIND;
  namespace: typeof LEGACY_MARKETING_SITE_NAMESPACE;
  marketingSourceHash: string;
  routeNamespaceCount: number;
  routeUnionKeyCount: number;
  routeUnionHash: string;
  deltaKeyCount: number;
  deltaHash: string;
  payloadKeyCount: number;
  ownerMapHash: string;
  targetLanguageCount: number;
  model: string;
  pipelineVersion: string;
  executionProfileSha256: string;
  protectorVersion: string;
  protectorSha256: string;
  modelSha256: string;
  pipelineImplementationSha256: string;
  workerImplementationSha256: string;
  validatorPolicySha256: string;
  masterWorklistSha256: string;
  provenanceSha256: string;
  packs: readonly LegacyMarketingSiteDeltaCorpusPack[];
  corpusSha256: string;
}>;

export type LegacyMarketingSiteDatabaseRow = Readonly<{
  namespace: string;
  language: string;
  source_hash: string;
  payload: string;
  model: string;
}>;

export type LegacyMarketingSiteComposedPayload = Readonly<{
  language: LegacyMarketingSiteTargetLanguage;
  payload: Readonly<Record<string, string>>;
  payloadJson: string;
  payloadBytes: number;
  payloadSha256: string;
}>;

export type LegacyMarketingSiteComposedCorpusIdentity = Readonly<{
  schemaVersion: 1;
  kind: typeof LEGACY_MARKETING_SITE_COMPOSED_CORPUS_KIND;
  namespace: typeof LEGACY_MARKETING_SITE_NAMESPACE;
  marketingSourceHash: string;
  routeUnionHash: string;
  deltaHash: string;
  ownerMapHash: string;
  deltaCorpusSha256: string;
  targetLanguageCount: number;
  payloadKeyCount: number;
  payloads: readonly Readonly<{
    language: LegacyMarketingSiteTargetLanguage;
    payloadBytes: number;
    payloadSha256: string;
  }>[];
  corpusSha256: string;
  model: string;
}>;

export type LegacyMarketingSiteComposedCorpus = Readonly<{
  identity: LegacyMarketingSiteComposedCorpusIdentity;
  payloads: readonly LegacyMarketingSiteComposedPayload[];
}>;

type CanonicalJsonObject = Readonly<{ [key: string]: CanonicalJson }>;

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | CanonicalJsonObject;

export class LegacyMarketingSiteContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyMarketingSiteContractError";
  }
}

export function hashLegacyMarketingSiteRecord(
  values: Readonly<Record<string, string>>,
) {
  const stablePayload = Object.keys(values)
    .sort(compareCodePoints)
    .map((key) => `${key}\u0000${values[key]}`)
    .join("\u0001");
  return sha256Text(stablePayload);
}

export function hashLegacyMarketingSiteSourceEntries(
  sourceStrings: Readonly<Record<string, string>>,
) {
  const entries = Object.entries(sourceStrings)
    .sort(([left], [right]) => compareCodePoints(left, right))
    .map(([key, source]) => {
      const protectedText = protectLongTailSourceText(source);
      return {
        key,
        source,
        sourceSha256: sha256Text(source),
        invariantSha256: protectedText.invariantSha256,
        segments: protectedText.segments,
      };
    });
  return sha256Canonical(entries);
}

export function deriveLegacyMarketingSiteContract(
  manifest: LegacyMarketingSiteSourceManifest,
): LegacyMarketingSiteContract {
  const namespaceEntries = Object.entries(manifest);
  const marketingSource = manifest[LEGACY_MARKETING_SITE_NAMESPACE];
  if (!marketingSource) {
    throw contractError("The source manifest has no marketing-site namespace.");
  }
  assertSourceManifestEntry(LEGACY_MARKETING_SITE_NAMESPACE, marketingSource);

  const routeEntries = namespaceEntries.filter(
    ([namespace]) => namespace !== LEGACY_MARKETING_SITE_NAMESPACE,
  );
  if (!routeEntries.length) {
    throw contractError("The source manifest has no route namespaces.");
  }

  const routeSourcesByNamespace: Record<
    string,
    LegacyMarketingSiteSourceManifestEntry
  > = {};
  const routeUnionSourceStrings: Record<string, string> = {};
  const ownerByKey: Record<string, string> = {};
  for (const [namespace, source] of routeEntries) {
    assertSourceManifestEntry(namespace, source);
    routeSourcesByNamespace[namespace] = Object.freeze({
      sourceHash: source.sourceHash,
      sourceStrings: freezeStringRecord(source.sourceStrings),
    });
    for (const [key, sourceText] of Object.entries(source.sourceStrings)) {
      const previous = routeUnionSourceStrings[key];
      if (previous !== undefined && previous !== sourceText) {
        throw contractError(
          `Route source key ${key} conflicts between ${ownerByKey[key]} and ${namespace}.`,
        );
      }
      if (previous === undefined) {
        routeUnionSourceStrings[key] = sourceText;
        ownerByKey[key] = namespace;
      }
    }
  }

  for (const [key, sourceText] of Object.entries(routeUnionSourceStrings)) {
    if (marketingSource.sourceStrings[key] !== sourceText) {
      throw contractError(
        `Route source key ${key} is absent or different in marketing-site.`,
      );
    }
  }

  const deltaSourceStrings = Object.fromEntries(
    Object.entries(marketingSource.sourceStrings)
      .filter(([key]) => routeUnionSourceStrings[key] === undefined)
      .sort(([left], [right]) => compareCodePoints(left, right)),
  );
  if (
    Object.keys(routeUnionSourceStrings).length +
      Object.keys(deltaSourceStrings).length !==
    Object.keys(marketingSource.sourceStrings).length
  ) {
    throw contractError(
      "The route union and marketing delta do not exactly partition marketing-site.",
    );
  }

  return Object.freeze({
    namespace: LEGACY_MARKETING_SITE_NAMESPACE,
    marketingSourceHash: marketingSource.sourceHash,
    marketingSourceStrings: freezeStringRecord(marketingSource.sourceStrings),
    routeNamespaces: Object.freeze(routeEntries.map(([namespace]) => namespace)),
    routeSourcesByNamespace: Object.freeze(routeSourcesByNamespace),
    routeUnionSourceStrings: freezeStringRecord(routeUnionSourceStrings),
    routeUnionHash: hashLegacyMarketingSiteRecord(routeUnionSourceStrings),
    deltaSourceStrings: freezeStringRecord(deltaSourceStrings),
    deltaHash: hashLegacyMarketingSiteRecord(deltaSourceStrings),
    ownerByKey: freezeStringRecord(ownerByKey),
    ownerMapHash: hashLegacyMarketingSiteRecord(ownerByKey),
  });
}

export function assertProductionLegacyMarketingSiteContract(
  contract: LegacyMarketingSiteContract,
) {
  const checks = [
    ["marketing source hash", contract.marketingSourceHash, LEGACY_MARKETING_SITE_EXPECTED_SOURCE_HASH],
    ["route union hash", contract.routeUnionHash, LEGACY_MARKETING_SITE_EXPECTED_ROUTE_UNION_HASH],
    ["delta hash", contract.deltaHash, LEGACY_MARKETING_SITE_EXPECTED_DELTA_HASH],
    ["owner-map hash", contract.ownerMapHash, LEGACY_MARKETING_SITE_EXPECTED_OWNER_MAP_HASH],
  ] as const;
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) {
      throw contractError(`Production ${label} drifted: ${actual}.`);
    }
  }
  assertCount(
    "production route namespaces",
    contract.routeNamespaces.length,
    LEGACY_MARKETING_SITE_EXPECTED_ROUTE_NAMESPACE_COUNT,
  );
  assertCount(
    "production route-union keys",
    Object.keys(contract.routeUnionSourceStrings).length,
    LEGACY_MARKETING_SITE_EXPECTED_ROUTE_KEY_COUNT,
  );
  assertCount(
    "production delta keys",
    Object.keys(contract.deltaSourceStrings).length,
    LEGACY_MARKETING_SITE_EXPECTED_DELTA_KEY_COUNT,
  );
  assertCount(
    "production payload keys",
    Object.keys(contract.marketingSourceStrings).length,
    LEGACY_MARKETING_SITE_EXPECTED_PAYLOAD_KEY_COUNT,
  );
  assertCount(
    "production target languages",
    legacyMarketingSiteTargetLanguages.length,
    LEGACY_MARKETING_SITE_EXPECTED_TARGET_LANGUAGE_COUNT,
  );
  return contract;
}

export const legacyMarketingSiteContract =
  assertProductionLegacyMarketingSiteContract(
    deriveLegacyMarketingSiteContract(siteSourceManifest),
  );

function validateLegacyMarketingSiteRoutePacks(input: {
  contract?: LegacyMarketingSiteContract;
  language: SupportedLanguage;
  packs: readonly unknown[];
}) {
  const contract = input.contract ?? legacyMarketingSiteContract;
  assertTargetLanguage(input.language);
  if (input.packs.length !== contract.routeNamespaces.length) {
    throw contractError(
      `Expected ${contract.routeNamespaces.length} route packs for ${input.language}; received ${input.packs.length}.`,
    );
  }

  const valuesByNamespace = new Map<string, Readonly<Record<string, string>>>();
  for (const rawPack of input.packs) {
    const header = parseTranslationPackHeader(rawPack);
    const expectedSource = contract.routeSourcesByNamespace[header.namespace];
    if (!expectedSource) {
      throw contractError(
        `Unexpected route namespace ${header.namespace} for ${input.language}.`,
      );
    }
    if (valuesByNamespace.has(header.namespace)) {
      throw contractError(
        `Duplicate route pack ${header.namespace} for ${input.language}.`,
      );
    }
    assertPackIdentity({
      header,
      language: input.language,
      namespace: header.namespace,
      sourceHash: expectedSource.sourceHash,
    });
    valuesByNamespace.set(
      header.namespace,
      parsePackTranslations(
        rawPack,
        { namespace: header.namespace, ...expectedSource },
        input.language,
      ),
    );
  }
  for (const namespace of contract.routeNamespaces) {
    if (!valuesByNamespace.has(namespace)) {
      throw contractError(
        `Missing route pack ${namespace} for ${input.language}.`,
      );
    }
  }
  return valuesByNamespace;
}

export function composeLegacyMarketingSiteRouteUnion(input: {
  contract?: LegacyMarketingSiteContract;
  language: SupportedLanguage;
  routePacks: readonly unknown[];
}) {
  const contract = input.contract ?? legacyMarketingSiteContract;
  const valuesByNamespace = validateLegacyMarketingSiteRoutePacks({
    contract,
    language: input.language,
    packs: input.routePacks,
  });
  const union: Record<string, string> = {};
  for (const key of Object.keys(contract.routeUnionSourceStrings).sort(compareCodePoints)) {
    const owner = contract.ownerByKey[key];
    const value = valuesByNamespace.get(owner)?.[key];
    if (!value) {
      throw contractError(
        `Owner ${owner} did not supply route-union key ${key} for ${input.language}.`,
      );
    }
    union[key] = value;
  }
  return freezeStringRecord(union);
}

export function parseLegacyMarketingSiteDeltaPack(
  rawPack: unknown,
  contract: LegacyMarketingSiteContract = legacyMarketingSiteContract,
): LegacyMarketingSiteDeltaPack {
  const record = requireRecord(rawPack, "legacy marketing delta pack");
  assertExactKeys(record, [
    "schemaVersion",
    "language",
    "locale",
    "namespace",
    "sourceHash",
    "model",
    "provenance",
    "translations",
  ], "legacy marketing delta pack");
  if (record.schemaVersion !== 1) {
    throw contractError("Legacy marketing delta pack schemaVersion must be 1.");
  }
  const language = requireTargetLanguage(record.language, "delta pack language");
  const locale = requireString(record.locale, "delta pack locale");
  const namespace = requireString(record.namespace, "delta pack namespace");
  const sourceHash = requireHash(record.sourceHash, "delta pack sourceHash");
  const model = requireNonemptyString(record.model, "delta pack model");
  assertPackIdentity({
    header: { language, locale, namespace, sourceHash },
    language,
    namespace: LEGACY_MARKETING_SITE_NAMESPACE,
    sourceHash: contract.deltaHash,
  });
  const provenance = parseLegacyMarketingSiteImmutablePackProvenance(
    record.provenance,
  );
  if (
    provenance.sourceEntriesSha256 !==
    hashLegacyMarketingSiteSourceEntries(contract.deltaSourceStrings)
  ) {
    throw contractError("Delta pack source-entry provenance is stale.");
  }
  const translations = parseTranslationRecord(
    record.translations,
    {
      namespace: LEGACY_MARKETING_SITE_NAMESPACE,
      sourceHash: contract.deltaHash,
      sourceStrings: contract.deltaSourceStrings,
    },
    language,
    "delta pack translations",
  );
  return Object.freeze({
    schemaVersion: 1,
    language,
    locale,
    namespace: LEGACY_MARKETING_SITE_NAMESPACE,
    sourceHash,
    model,
    provenance,
    translations,
  });
}

export function composeLegacyMarketingSitePayload(input: {
  contract?: LegacyMarketingSiteContract;
  language: SupportedLanguage;
  routePacks: readonly unknown[];
  deltaPack: unknown;
}) {
  const contract = input.contract ?? legacyMarketingSiteContract;
  const routeUnion = composeLegacyMarketingSiteRouteUnion({
    contract,
    language: input.language,
    routePacks: input.routePacks,
  });
  const deltaPack = parseLegacyMarketingSiteDeltaPack(input.deltaPack, contract);
  if (deltaPack.language !== input.language) {
    throw contractError(
      `Delta pack language ${deltaPack.language} does not match ${input.language}.`,
    );
  }
  const payload: Record<string, string> = {};
  for (const key of Object.keys(contract.marketingSourceStrings).sort(compareCodePoints)) {
    const value = routeUnion[key] ?? deltaPack.translations[key];
    if (!value) {
      throw contractError(
        `Composed marketing payload is missing ${key} for ${input.language}.`,
      );
    }
    payload[key] = value;
  }
  return validateLegacyMarketingSitePayload({
    contract,
    language: input.language,
    payload,
  });
}

export function validateLegacyMarketingSitePayload(input: {
  contract?: LegacyMarketingSiteContract;
  language: SupportedLanguage;
  payload: unknown;
}) {
  const contract = input.contract ?? legacyMarketingSiteContract;
  assertTargetLanguage(input.language);
  return parseTranslationRecord(
    input.payload,
    {
      namespace: LEGACY_MARKETING_SITE_NAMESPACE,
      sourceHash: contract.marketingSourceHash,
      sourceStrings: contract.marketingSourceStrings,
    },
    input.language,
    `marketing-site payload for ${input.language}`,
  );
}

export function buildLegacyMarketingSiteDeltaCorpusManifest(input: {
  contract?: LegacyMarketingSiteContract;
  artifacts: readonly LegacyMarketingSiteDeltaPackArtifact[];
}) {
  const contract = input.contract ?? legacyMarketingSiteContract;
  if (input.artifacts.length !== legacyMarketingSiteTargetLanguages.length) {
    throw contractError(
      `Delta corpus requires ${legacyMarketingSiteTargetLanguages.length} packs; received ${input.artifacts.length}.`,
    );
  }

  const packs = input.artifacts.map((artifact) => {
    const decoded = decodeCanonicalJsonArtifact(artifact);
    const pack = parseLegacyMarketingSiteDeltaPack(decoded.value, contract);
    const expectedPath = legacyMarketingSiteDeltaPackRelativePath(pack.language);
    if (artifact.relativePath !== expectedPath) {
      throw contractError(
        `Delta pack path ${artifact.relativePath} must be ${expectedPath}.`,
      );
    }
    return Object.freeze({
      language: pack.language,
      locale: pack.locale,
      relativePath: artifact.relativePath,
      bytes: artifact.bytes.byteLength,
      sha256: sha256Bytes(artifact.bytes),
      provenanceSha256: pack.provenance.provenanceSha256,
      pack,
    });
  }).sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));

  const languageSet = new Set(packs.map((pack) => pack.language));
  for (const language of legacyMarketingSiteTargetLanguages) {
    if (!languageSet.has(language)) {
      throw contractError(`Delta corpus is missing ${language}.`);
    }
  }
  if (languageSet.size !== legacyMarketingSiteTargetLanguages.length) {
    throw contractError("Delta corpus contains duplicate or unexpected languages.");
  }

  const first = packs[0];
  if (!first) throw contractError("Delta corpus is empty.");
  const common = {
    model: first.pack.model,
    pipelineVersion: first.pack.provenance.pipelineVersion,
    executionProfileSha256:
      first.pack.provenance.executionProfileSha256,
    protectorVersion: first.pack.provenance.protectorVersion,
    protectorSha256: first.pack.provenance.protectorSha256,
    modelSha256: first.pack.provenance.modelSha256,
    pipelineImplementationSha256:
      first.pack.provenance.pipelineImplementationSha256,
    workerImplementationSha256:
      first.pack.provenance.workerImplementationSha256,
    validatorPolicySha256:
      first.pack.provenance.validatorPolicySha256,
    masterWorklistSha256: first.pack.provenance.masterWorklistSha256,
  };
  for (const item of packs) {
    const pack = item.pack;
    if (
      pack.model !== common.model ||
      pack.provenance.pipelineVersion !== common.pipelineVersion ||
      pack.provenance.executionProfileSha256 !==
        common.executionProfileSha256 ||
      pack.provenance.protectorVersion !== common.protectorVersion ||
      pack.provenance.protectorSha256 !== common.protectorSha256 ||
      pack.provenance.modelSha256 !== common.modelSha256 ||
      pack.provenance.pipelineImplementationSha256 !==
        common.pipelineImplementationSha256 ||
      pack.provenance.workerImplementationSha256 !==
        common.workerImplementationSha256 ||
      pack.provenance.validatorPolicySha256 !==
        common.validatorPolicySha256 ||
      pack.provenance.masterWorklistSha256 !== common.masterWorklistSha256
    ) {
      throw contractError(
        `Delta corpus provenance differs for ${pack.language}.`,
      );
    }
  }
  const provenanceSha256 = sha256Canonical(common);
  const corpusPacks = packs.map((item) => Object.freeze({
    language: item.language,
    locale: item.locale,
    relativePath: item.relativePath,
    bytes: item.bytes,
    sha256: item.sha256,
    provenanceSha256: item.provenanceSha256,
  }));
  const material = {
    schemaVersion: 1,
    kind: LEGACY_MARKETING_SITE_DELTA_CORPUS_KIND,
    namespace: LEGACY_MARKETING_SITE_NAMESPACE,
    marketingSourceHash: contract.marketingSourceHash,
    routeNamespaceCount: contract.routeNamespaces.length,
    routeUnionKeyCount: Object.keys(contract.routeUnionSourceStrings).length,
    routeUnionHash: contract.routeUnionHash,
    deltaKeyCount: Object.keys(contract.deltaSourceStrings).length,
    deltaHash: contract.deltaHash,
    payloadKeyCount: Object.keys(contract.marketingSourceStrings).length,
    ownerMapHash: contract.ownerMapHash,
    targetLanguageCount: legacyMarketingSiteTargetLanguages.length,
    ...common,
    provenanceSha256,
    packs: corpusPacks,
  } as const;
  return Object.freeze({
    ...material,
    corpusSha256: sha256Canonical(material),
  });
}

export function validateLegacyMarketingSiteDeltaCorpusManifest(input: {
  manifest: unknown;
  artifacts: readonly LegacyMarketingSiteDeltaPackArtifact[];
  contract?: LegacyMarketingSiteContract;
}) {
  const parsed = parseDeltaCorpusManifest(input.manifest);
  const rebuilt = buildLegacyMarketingSiteDeltaCorpusManifest({
    contract: input.contract,
    artifacts: input.artifacts,
  });
  if (canonicalJson(parsed) !== canonicalJson(rebuilt)) {
    throw contractError(
      "Delta corpus manifest does not exactly match its source contract and pack bytes.",
    );
  }
  return rebuilt;
}

export function buildLegacyMarketingSiteComposedCorpus(input: {
  payloads: readonly Readonly<{
    language: SupportedLanguage;
    payload: unknown;
  }>[];
  deltaCorpusSha256: string;
  contract?: LegacyMarketingSiteContract;
}): LegacyMarketingSiteComposedCorpus {
  const contract = input.contract ?? legacyMarketingSiteContract;
  const deltaCorpusSha256 = requireHash(
    input.deltaCorpusSha256,
    "composed corpus deltaCorpusSha256",
  );
  if (input.payloads.length !== legacyMarketingSiteTargetLanguages.length) {
    throw contractError(
      `Composed corpus requires ${legacyMarketingSiteTargetLanguages.length} payloads; received ${input.payloads.length}.`,
    );
  }

  const payloads = input.payloads.map((candidate) => {
    const language = requireTargetLanguage(
      candidate.language,
      "composed corpus language",
    );
    const payload = validateLegacyMarketingSitePayload({
      contract,
      language,
      payload: candidate.payload,
    });
    const payloadJson = canonicalJson(payload);
    return Object.freeze({
      language,
      payload,
      payloadJson,
      payloadBytes: Buffer.byteLength(payloadJson, "utf8"),
      payloadSha256: sha256Text(payloadJson),
    });
  }).sort((left, right) => compareCodePoints(left.language, right.language));

  const languages = new Set(payloads.map((payload) => payload.language));
  if (languages.size !== legacyMarketingSiteTargetLanguages.length) {
    throw contractError("Composed corpus contains duplicate target languages.");
  }
  for (const language of legacyMarketingSiteTargetLanguages) {
    if (!languages.has(language)) {
      throw contractError(`Composed corpus is missing ${language}.`);
    }
  }

  const descriptors = Object.freeze(payloads.map((payload) => Object.freeze({
    language: payload.language,
    payloadBytes: payload.payloadBytes,
    payloadSha256: payload.payloadSha256,
  })));
  const material = {
    schemaVersion: 1,
    kind: LEGACY_MARKETING_SITE_COMPOSED_CORPUS_KIND,
    namespace: LEGACY_MARKETING_SITE_NAMESPACE,
    marketingSourceHash: contract.marketingSourceHash,
    routeUnionHash: contract.routeUnionHash,
    deltaHash: contract.deltaHash,
    ownerMapHash: contract.ownerMapHash,
    deltaCorpusSha256,
    targetLanguageCount: legacyMarketingSiteTargetLanguages.length,
    payloadKeyCount: Object.keys(contract.marketingSourceStrings).length,
    payloads: descriptors,
  } as const;
  const corpusSha256 = sha256Canonical(material);
  const identity = Object.freeze({
    ...material,
    corpusSha256,
    model: `${LEGACY_MARKETING_SITE_COMPOSED_MODEL_PREFIX}${corpusSha256}`,
  });
  return Object.freeze({
    identity,
    payloads: Object.freeze(payloads),
  });
}

export function validateLegacyMarketingSiteDatabaseRows(input: {
  rows: readonly LegacyMarketingSiteDatabaseRow[];
  expectedCorpus: LegacyMarketingSiteComposedCorpus;
  contract?: LegacyMarketingSiteContract;
}) {
  const contract = input.contract ?? legacyMarketingSiteContract;
  const expectedCorpus = buildLegacyMarketingSiteComposedCorpus({
    contract,
    deltaCorpusSha256: input.expectedCorpus.identity.deltaCorpusSha256,
    payloads: input.expectedCorpus.payloads.map(({ language, payload }) => ({
      language,
      payload,
    })),
  });
  if (
    canonicalJson(expectedCorpus.identity) !==
      canonicalJson(input.expectedCorpus.identity)
  ) {
    throw contractError(
      "Expected composed corpus identity does not match its exact payload bytes.",
    );
  }
  if (input.rows.length !== legacyMarketingSiteTargetLanguages.length) {
    throw contractError(
      `Expected ${legacyMarketingSiteTargetLanguages.length} marketing-site database rows; received ${input.rows.length}.`,
    );
  }
  const expectedByLanguage = new Map(
    expectedCorpus.payloads.map((payload) => [payload.language, payload]),
  );
  const payloads = new Map<
    LegacyMarketingSiteTargetLanguage,
    Readonly<Record<string, string>>
  >();
  for (const row of input.rows) {
    const language = requireTargetLanguage(row.language, "database row language");
    if (payloads.has(language)) {
      throw contractError(`Duplicate marketing-site database row for ${language}.`);
    }
    if (
      row.namespace !== LEGACY_MARKETING_SITE_NAMESPACE ||
      row.source_hash !== contract.marketingSourceHash ||
      row.model !== expectedCorpus.identity.model
    ) {
      throw contractError(
        `Marketing-site database metadata is stale for ${language}.`,
      );
    }
    const expected = expectedByLanguage.get(language);
    if (!expected) {
      throw contractError(`Expected composed corpus has no payload for ${language}.`);
    }
    if (typeof row.payload !== "string" || row.payload !== expected.payloadJson) {
      throw contractError(
        `Marketing-site database payload bytes differ for ${language}.`,
      );
    }
    const rawPayload = parseJson(
      row.payload,
      `database payload for ${language}`,
    );
    const validated = validateLegacyMarketingSitePayload({
      contract,
      language,
      payload: rawPayload,
    });
    const payloadJson = canonicalJson(validated);
    if (
      payloadJson !== expected.payloadJson ||
      Buffer.byteLength(payloadJson, "utf8") !== expected.payloadBytes ||
      sha256Text(payloadJson) !== expected.payloadSha256
    ) {
      throw contractError(
        `Marketing-site database payload identity differs for ${language}.`,
      );
    }
    payloads.set(language, validated);
  }
  for (const language of legacyMarketingSiteTargetLanguages) {
    if (!payloads.has(language)) {
      throw contractError(`Missing marketing-site database row for ${language}.`);
    }
  }
  return Object.freeze({
    rows: payloads.size,
    payloadKeys: payloads.size * Object.keys(contract.marketingSourceStrings).length,
    corpusSha256: expectedCorpus.identity.corpusSha256,
    model: expectedCorpus.identity.model,
  });
}

export function assertLegacyMarketingSiteD1StatementBounds(
  statements: readonly string[],
) {
  if (!statements.length) {
    throw contractError("A D1 statement plan cannot be empty.");
  }
  return Object.freeze(
    statements.map((statement, index) => {
      const bytes = Buffer.byteLength(statement, "utf8");
      if (!statement.trim() || bytes > LEGACY_MARKETING_SITE_D1_MAX_STATEMENT_BYTES) {
        throw contractError(
          `D1 statement ${index} is empty or exceeds ${LEGACY_MARKETING_SITE_D1_MAX_STATEMENT_BYTES} UTF-8 bytes.`,
        );
      }
      return bytes;
    }),
  );
}

export function createLegacyMarketingSiteD1WriteBatches<T>(
  rows: readonly T[],
  maximumRows = LEGACY_MARKETING_SITE_D1_MAX_WRITE_BATCH_ROWS,
) {
  if (
    !Number.isSafeInteger(maximumRows) ||
    maximumRows < 1 ||
    maximumRows > LEGACY_MARKETING_SITE_D1_MAX_WRITE_BATCH_ROWS
  ) {
    throw contractError(
      `D1 write batches must contain 1-${LEGACY_MARKETING_SITE_D1_MAX_WRITE_BATCH_ROWS} rows.`,
    );
  }
  const mutableBatches: T[][] = [];
  for (let index = 0; index < rows.length; index += maximumRows) {
    mutableBatches.push(rows.slice(index, index + maximumRows));
  }
  return Object.freeze(
    mutableBatches.map((batch) => Object.freeze(batch)),
  );
}

export function legacyMarketingSiteDeltaPackRelativePath(
  language: SupportedLanguage,
) {
  assertTargetLanguage(language);
  const directory = legacyMarketingSiteLocale(language);
  return `${LEGACY_MARKETING_SITE_DELTA_ROOT}/${directory}/${LEGACY_MARKETING_SITE_NAMESPACE}.json`;
}

function parseTranslationPackHeader(rawPack: unknown) {
  const record = requireRecord(rawPack, "translation pack");
  if (record.schemaVersion !== 1) {
    throw contractError("Translation pack schemaVersion must be 1.");
  }
  return Object.freeze({
    language: requireTargetLanguage(record.language, "translation pack language"),
    locale: requireString(record.locale, "translation pack locale"),
    namespace: requireNonemptyString(record.namespace, "translation pack namespace"),
    sourceHash: requireHash(record.sourceHash, "translation pack sourceHash"),
  });
}

function parsePackTranslations(
  rawPack: unknown,
  sourceDefinition: LegacyMarketingSiteSourceManifestEntry &
    Readonly<{ namespace: string }>,
  language: LegacyMarketingSiteTargetLanguage,
) {
  const record = requireRecord(rawPack, "translation pack");
  const hasEntries = record.entries !== undefined;
  const hasTranslations = record.translations !== undefined;
  if (hasEntries === hasTranslations) {
    throw contractError(
      "Translation pack must contain exactly one of entries or translations.",
    );
  }
  if (hasTranslations) {
    assertExactKeys(record, [
      "schemaVersion",
      "language",
      "locale",
      "namespace",
      "sourceHash",
      "model",
      "provenance",
      "translations",
    ], "compact translation pack");
    requireNonemptyString(record.model, "compact translation pack model");
    const provenance = parseLegacyMarketingSiteImmutablePackProvenance(
      record.provenance,
    );
    if (
      provenance.sourceEntriesSha256 !==
      hashLegacyMarketingSiteSourceEntries(sourceDefinition.sourceStrings)
    ) {
      throw contractError(
        `Compact translation pack source-entry provenance drifted for ${sourceDefinition.namespace}.`,
      );
    }
    return parseTranslationRecord(
      record.translations,
      {
        namespace: sourceDefinition.namespace,
        sourceHash: sourceDefinition.sourceHash,
        sourceStrings: sourceDefinition.sourceStrings,
      },
      language,
      "compact translation pack",
    );
  }
  if (!Array.isArray(record.entries)) {
    throw contractError("Translation pack entries must be an array.");
  }
  assertExactKeys(record, [
    "schemaVersion",
    "language",
    "locale",
    "namespace",
    "sourceHash",
    "model",
    "entries",
  ], "grandfathered entry translation pack");
  const model = requireNonemptyString(
    record.model,
    "grandfathered entry translation pack model",
  );
  if (
    !LEGACY_MARKETING_SITE_GRANDFATHERED_ENTRY_MODELS.some(
      (allowed) => allowed === model,
    )
  ) {
    throw contractError(
      `Entry translation pack model ${model} is not explicitly grandfathered.`,
    );
  }
  const values: Record<string, string> = {};
  for (const rawEntry of record.entries) {
    const entry = requireRecord(rawEntry, "translation pack entry");
    assertExactKeys(
      entry,
      ["key", "source", "value"],
      "translation pack entry",
    );
    const key = requireNonemptyString(entry.key, "translation pack entry key");
    const entrySource = requireString(
      entry.source,
      `translation pack source ${key}`,
    );
    const value = requireString(entry.value, `translation pack value ${key}`);
    if (values[key] !== undefined) {
      throw contractError(`Translation pack duplicates ${key}.`);
    }
    if (sourceDefinition.sourceStrings[key] !== entrySource) {
      throw contractError(`Translation pack source drifted for ${key}.`);
    }
    values[key] = value;
  }
  return parseTranslationRecord(
    values,
    {
      namespace: sourceDefinition.namespace,
      sourceHash: sourceDefinition.sourceHash,
      sourceStrings: sourceDefinition.sourceStrings,
    },
    language,
    "entry translation pack",
  );
}

function parseTranslationRecord(
  raw: unknown,
  source: Readonly<{
    namespace: string;
    sourceHash: string;
    sourceStrings: Readonly<Record<string, string>>;
  }>,
  language: LegacyMarketingSiteTargetLanguage,
  label: string,
) {
  const record = requireRecord(raw, label);
  const sourceKeys = Object.keys(source.sourceStrings).sort(compareCodePoints);
  const translatedKeys = Object.keys(record).sort(compareCodePoints);
  if (
    sourceKeys.length !== translatedKeys.length ||
    sourceKeys.some((key, index) => translatedKeys[index] !== key)
  ) {
    throw contractError(`${label} does not contain the exact source key set.`);
  }
  const translations: Record<string, string> = {};
  for (const key of sourceKeys) {
    const value = requireString(record[key], `${label}/${key}`);
    const sourceText = source.sourceStrings[key];
    const candidateFailures = validateTranslationCandidateField({
      language,
      source: sourceText,
      value,
    }).failures;
    if (
      value !== value.normalize("NFC") ||
      candidateFailures.length > 0 ||
      !hasExactLongTailInvariantParity(sourceText, value) ||
      !isValidFieldTranslation(sourceText, value, language, key)
    ) {
      throw contractError(`${label}/${key} is not a valid translation.`);
    }
    translations[key] = value;
  }
  const translationSource: TranslationSource = {
    namespace: source.namespace,
    sourceHash: source.sourceHash,
    sourceStrings: { ...source.sourceStrings },
  };
  const bundle: TranslationBundle = {
    namespace: source.namespace,
    language,
    sourceHash: source.sourceHash,
    sourceStrings: { ...source.sourceStrings },
    strings: { ...translations },
  };
  if (
    !isTranslationBundleFieldValid(translationSource, bundle, language) ||
    !isTranslationBundleCompleteAndFluent(translationSource, bundle, language)
  ) {
    throw contractError(`${label} failed complete fluent bundle validation.`);
  }
  return freezeStringRecord(translations);
}

export function parseLegacyMarketingSiteImmutablePackProvenance(
  raw: unknown,
): LegacyMarketingSiteDeltaPackProvenance {
  const record = requireRecord(raw, "delta pack provenance");
  const materialKeys = [
    "kind",
    "pipelineVersion",
    "executionProfileSha256",
    "protectorVersion",
    "protectorSha256",
    "masterWorklistSha256",
    "packWorklistSha256",
    "jobSha256",
    "sourceEntriesSha256",
    "modelSha256",
    "pipelineImplementationSha256",
    "workerImplementationSha256",
    "validatorPolicySha256",
    "candidateSha256",
  ] as const;
  assertExactKeys(
    record,
    [...materialKeys, "provenanceSha256"],
    "delta pack provenance",
  );
  if (record.kind !== LEGACY_MARKETING_SITE_CURATED_PROVENANCE_KIND) {
    throw contractError("Delta pack provenance kind is invalid.");
  }
  const pipelineVersion = requireNonemptyString(
    record.pipelineVersion,
    "pipelineVersion",
  );
  const protectorVersion = requireNonemptyString(
    record.protectorVersion,
    "protectorVersion",
  );
  if (
    pipelineVersion !== LONG_TAIL_TRANSLATION_PIPELINE_VERSION ||
    record.executionProfileSha256 !==
      LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256 ||
    protectorVersion !== LONG_TAIL_TRANSLATION_PROTECTOR_VERSION
  ) {
    throw contractError("Immutable pack pipeline/protector version is unsupported.");
  }
  const material = {
    kind: LEGACY_MARKETING_SITE_CURATED_PROVENANCE_KIND,
    pipelineVersion,
    executionProfileSha256: requireHash(
      record.executionProfileSha256,
      "executionProfileSha256",
    ),
    protectorVersion,
    protectorSha256: requireHash(record.protectorSha256, "protectorSha256"),
    masterWorklistSha256: requireHash(record.masterWorklistSha256, "masterWorklistSha256"),
    packWorklistSha256: requireHash(record.packWorklistSha256, "packWorklistSha256"),
    jobSha256: requireHash(record.jobSha256, "jobSha256"),
    sourceEntriesSha256: requireHash(record.sourceEntriesSha256, "sourceEntriesSha256"),
    modelSha256: requireHash(record.modelSha256, "modelSha256"),
    pipelineImplementationSha256: requireHash(
      record.pipelineImplementationSha256,
      "pipelineImplementationSha256",
    ),
    workerImplementationSha256: requireHash(
      record.workerImplementationSha256,
      "workerImplementationSha256",
    ),
    validatorPolicySha256: requireHash(
      record.validatorPolicySha256,
      "validatorPolicySha256",
    ),
    candidateSha256: requireHash(record.candidateSha256, "candidateSha256"),
  } as const;
  const provenanceSha256 = requireHash(
    record.provenanceSha256,
    "provenanceSha256",
  );
  if (provenanceSha256 !== sha256Canonical(material)) {
    throw contractError("Delta pack provenance hash is invalid.");
  }
  return Object.freeze({ ...material, provenanceSha256 });
}

function parseDeltaCorpusManifest(
  raw: unknown,
): LegacyMarketingSiteDeltaCorpusManifest {
  const record = requireRecord(raw, "delta corpus manifest");
  const keys = [
    "schemaVersion",
    "kind",
    "namespace",
    "marketingSourceHash",
    "routeNamespaceCount",
    "routeUnionKeyCount",
    "routeUnionHash",
    "deltaKeyCount",
    "deltaHash",
    "payloadKeyCount",
    "ownerMapHash",
    "targetLanguageCount",
    "model",
    "pipelineVersion",
    "executionProfileSha256",
    "protectorVersion",
    "protectorSha256",
    "modelSha256",
    "pipelineImplementationSha256",
    "workerImplementationSha256",
    "validatorPolicySha256",
    "masterWorklistSha256",
    "provenanceSha256",
    "packs",
    "corpusSha256",
  ] as const;
  assertExactKeys(record, keys, "delta corpus manifest");
  if (
    record.schemaVersion !== 1 ||
    record.kind !== LEGACY_MARKETING_SITE_DELTA_CORPUS_KIND ||
    record.namespace !== LEGACY_MARKETING_SITE_NAMESPACE
  ) {
    throw contractError("Delta corpus manifest identity is invalid.");
  }
  if (!Array.isArray(record.packs)) {
    throw contractError("Delta corpus manifest packs must be an array.");
  }
  const packs = record.packs.map((rawPack) => {
    const pack = requireRecord(rawPack, "delta corpus pack");
    assertExactKeys(pack, [
      "language",
      "locale",
      "relativePath",
      "bytes",
      "sha256",
      "provenanceSha256",
    ], "delta corpus pack");
    return Object.freeze({
      language: requireTargetLanguage(pack.language, "corpus pack language"),
      locale: requireNonemptyString(pack.locale, "corpus pack locale"),
      relativePath: requireNonemptyString(pack.relativePath, "corpus pack path"),
      bytes: requirePositiveSafeInteger(pack.bytes, "corpus pack bytes"),
      sha256: requireHash(pack.sha256, "corpus pack sha256"),
      provenanceSha256: requireHash(
        pack.provenanceSha256,
        "corpus pack provenanceSha256",
      ),
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    kind: LEGACY_MARKETING_SITE_DELTA_CORPUS_KIND,
    namespace: LEGACY_MARKETING_SITE_NAMESPACE,
    marketingSourceHash: requireHash(record.marketingSourceHash, "marketingSourceHash"),
    routeNamespaceCount: requirePositiveSafeInteger(record.routeNamespaceCount, "routeNamespaceCount"),
    routeUnionKeyCount: requirePositiveSafeInteger(record.routeUnionKeyCount, "routeUnionKeyCount"),
    routeUnionHash: requireHash(record.routeUnionHash, "routeUnionHash"),
    deltaKeyCount: requirePositiveSafeInteger(record.deltaKeyCount, "deltaKeyCount"),
    deltaHash: requireHash(record.deltaHash, "deltaHash"),
    payloadKeyCount: requirePositiveSafeInteger(record.payloadKeyCount, "payloadKeyCount"),
    ownerMapHash: requireHash(record.ownerMapHash, "ownerMapHash"),
    targetLanguageCount: requirePositiveSafeInteger(record.targetLanguageCount, "targetLanguageCount"),
    model: requireNonemptyString(record.model, "model"),
    pipelineVersion: requireNonemptyString(record.pipelineVersion, "pipelineVersion"),
    executionProfileSha256: requireHash(
      record.executionProfileSha256,
      "executionProfileSha256",
    ),
    protectorVersion: requireNonemptyString(record.protectorVersion, "protectorVersion"),
    protectorSha256: requireHash(record.protectorSha256, "protectorSha256"),
    modelSha256: requireHash(record.modelSha256, "modelSha256"),
    pipelineImplementationSha256: requireHash(record.pipelineImplementationSha256, "pipelineImplementationSha256"),
    workerImplementationSha256: requireHash(record.workerImplementationSha256, "workerImplementationSha256"),
    validatorPolicySha256: requireHash(record.validatorPolicySha256, "validatorPolicySha256"),
    masterWorklistSha256: requireHash(record.masterWorklistSha256, "masterWorklistSha256"),
    provenanceSha256: requireHash(record.provenanceSha256, "provenanceSha256"),
    packs: Object.freeze(packs),
    corpusSha256: requireHash(record.corpusSha256, "corpusSha256"),
  });
}

function decodeCanonicalJsonArtifact(
  artifact: LegacyMarketingSiteDeltaPackArtifact,
) {
  let text: string;
  try {
    text = utf8Decoder.decode(artifact.bytes);
  } catch {
    throw contractError(`Delta pack ${artifact.relativePath} is not valid UTF-8.`);
  }
  const value = parseJson(text, artifact.relativePath);
  if (`${JSON.stringify(value, null, 2)}\n` !== text) {
    throw contractError(
      `Delta pack ${artifact.relativePath} is not canonical pretty JSON.`,
    );
  }
  return Object.freeze({ value, text });
}

function assertSourceManifestEntry(
  namespace: string,
  source: LegacyMarketingSiteSourceManifestEntry,
) {
  if (!sha256Pattern.test(source.sourceHash)) {
    throw contractError(`Source hash is invalid for ${namespace}.`);
  }
  if (!Object.keys(source.sourceStrings).length) {
    throw contractError(`Source namespace ${namespace} is empty.`);
  }
  for (const [key, value] of Object.entries(source.sourceStrings)) {
    if (!key || typeof value !== "string" || !value) {
      throw contractError(`Source namespace ${namespace} has an invalid field.`);
    }
  }
  const calculated = hashLegacyMarketingSiteRecord(source.sourceStrings);
  if (calculated !== source.sourceHash) {
    throw contractError(`Source hash drifted for ${namespace}.`);
  }
}

function assertPackIdentity(input: {
  header: Readonly<{
    language: SupportedLanguage;
    locale: string;
    namespace: string;
    sourceHash: string;
  }>;
  language: SupportedLanguage;
  namespace: string;
  sourceHash: string;
}) {
  const expectedLocale = legacyMarketingSiteLocale(input.language);
  if (
    input.header.language !== input.language ||
    input.header.locale !== expectedLocale ||
    input.header.namespace !== input.namespace ||
    input.header.sourceHash !== input.sourceHash
  ) {
    throw contractError(
      `Translation pack identity is stale for ${input.language}/${input.namespace}.`,
    );
  }
}

function assertTargetLanguage(
  language: SupportedLanguage,
): asserts language is LegacyMarketingSiteTargetLanguage {
  if (language === defaultLanguage) {
    throw contractError("English is source-only, not a translation target.");
  }
}

function requireTargetLanguage(
  value: unknown,
  label: string,
): LegacyMarketingSiteTargetLanguage {
  if (
    typeof value !== "string" ||
    !isSupportedLanguage(value) ||
    value === defaultLanguage
  ) {
    throw contractError(`${label} is not a supported target language.`);
  }
  return value;
}

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return supportedLanguages.find((language) => language === value) !== undefined;
}

function legacyMarketingSiteLocale(language: SupportedLanguage) {
  return languageConfigs[language].prefix || languageConfigs[language].locale;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw contractError(`${label} must be an object.`);
  }
  return Object.fromEntries(Object.entries(value));
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw contractError(`${label} must be a string.`);
  }
  return value;
}

function requireNonemptyString(value: unknown, label: string) {
  const result = requireString(value, label);
  if (!result.trim()) throw contractError(`${label} cannot be empty.`);
  return result;
}

function requireHash(value: unknown, label: string) {
  const result = requireString(value, label);
  if (!sha256Pattern.test(result)) {
    throw contractError(`${label} must be a lowercase SHA-256 hash.`);
  }
  return result;
}

function requirePositiveSafeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw contractError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort(compareCodePoints);
  const sortedExpected = [...expected].sort(compareCodePoints);
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw contractError(`${label} has an unexpected field set.`);
  }
}

function assertCount(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw contractError(`${label} expected ${expected}; received ${actual}.`);
  }
}

function freezeStringRecord(values: Readonly<Record<string, string>>) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(values).sort(([left], [right]) => compareCodePoints(left, right)),
    ),
  );
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw contractError(`${label} is not valid JSON.`);
  }
}

function canonicalJson(value: CanonicalJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (isCanonicalJsonArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort(compareCodePoints)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function isCanonicalJsonArray(
  value: readonly CanonicalJson[] | CanonicalJsonObject,
): value is readonly CanonicalJson[] {
  return Array.isArray(value);
}

function sha256Canonical(value: CanonicalJson) {
  return sha256Text(canonicalJson(value));
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function contractError(message: string) {
  return new LegacyMarketingSiteContractError(message);
}
