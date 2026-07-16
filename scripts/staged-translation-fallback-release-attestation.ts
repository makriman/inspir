import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
  type SupportedLanguage,
} from "../lib/content/languages";
import {
  getMainAppSourceHash,
  getMainAppSourceStrings,
  mainAppTranslationNamespace,
} from "../lib/i18n/main-app-source";
import { parseStaticMainAppTranslationsValue } from "../lib/i18n/static-main-app-translations";
import { staticSiteTranslationNamespaceAvailability } from "../lib/i18n/site-availability-manifest";
import { siteSourceManifest } from "../lib/i18n/site-source-manifest";
import {
  getSiteTranslationSource,
  isKnownSiteTranslationNamespace,
} from "../lib/i18n/site-source";
import { siteTranslationNamespace } from "../lib/i18n/site-source-constants";
import { isRenderLocalizedSiteTranslationNamespace } from "../lib/i18n/render-localized-namespaces";
import { isTranslationBundleCompleteAndFluent } from "../lib/i18n/translation-quality";
import type { TranslationBundle } from "../lib/i18n/translation-types";
import {
  buildStaticAssetLocalizedPathContract,
  type StaticAssetTranslationAvailability,
} from "./cloudflare/static-asset-release-contract";
import {
  isTranslationSemanticMainAppWorkbenchPath,
  parseStrictTranslationSemanticJsonBytes,
} from "./verify-translation-semantic-audit";
import {
  createSourceCatalogEntry,
  LONG_TAIL_TRANSLATION_CURATED_PROVENANCE_KIND,
  LONG_TAIL_TRANSLATION_PROTECTOR_VERSION,
} from "./generate-long-tail-translations";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  LONG_TAIL_TRANSLATION_PIPELINE_VERSION,
} from "./long-tail-nllb-execution-profile";
import { readAndValidateAfrikaansStagedPromotionProof } from "./long-tail-promotion-snapshot";

export const STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND =
  "inspir-staged-translation-fallback-release-attestation-v1" as const;
export const STAGED_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH =
  "translations/staged-fallback-release-attestation.json" as const;
export const STAGED_TRANSLATION_FALLBACK_ATTESTATION_CHECK_NAME =
  "staged translation release with canonical English fallback" as const;
export const CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND =
  "inspir-current-translation-fallback-no-site-promotion-attestation-v1" as const;
export const CURRENT_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH =
  "translations/current-fallback-no-site-promotion-attestation.json" as const;

const SOURCE_MANIFEST_RELATIVE_PATH = "lib/i18n/site-source-manifest.ts" as const;
const AVAILABILITY_MANIFEST_RELATIVE_PATH =
  "lib/i18n/site-availability-manifest.ts" as const;
const CURATED_SITE_ROOT_RELATIVE_PATH = "translations/curated" as const;
const STATIC_MAIN_APP_ROOT_RELATIVE_PATH =
  "translations/static-main-app" as const;
const MAXIMUM_ATTESTATION_BYTES = 8 * 1024 * 1024;
const MAXIMUM_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAXIMUM_PACK_BYTES = 16 * 1024 * 1024;
const EXPECTED_AFRIKAANS_CANDIDATE_PACKS = 121 as const;
const EXPECTED_AFRIKAANS_AUDITED_PACKS = 125 as const;
const EXPECTED_AFRIKAANS_AUDITED_FIELDS = 16_564 as const;
const EXPECTED_POST_AFRIKAANS_PHYSICAL_SITE_PACKS = 812 as const;
const EXPECTED_POST_AFRIKAANS_CLEAN_PHYSICAL_SITE_PACKS = 720 as const;
const EXPECTED_DEFERRED_STALE_REPLACEMENTS = 92 as const;
const EXPECTED_POST_AFRIKAANS_MISSING_SITE_PACKS = 7_744 as const;
const EXPECTED_POST_AFRIKAANS_PENDING_JOBS = 7_836 as const;
const EXPECTED_CURRENT_PHYSICAL_SITE_PACKS = 691 as const;
const EXPECTED_CURRENT_CLEAN_PHYSICAL_SITE_PACKS = 599 as const;
const EXPECTED_CURRENT_STALE_SITE_PACKS = 92 as const;
const EXPECTED_CURRENT_MISSING_SITE_PACKS = 7_865 as const;
const EXPECTED_CURRENT_PENDING_JOBS = 7_957 as const;
const EXPECTED_CURRENT_AVAILABILITY_ENTRIES = 245 as const;
const EXPECTED_CURRENT_LOCALIZED_HTML_PATHS = 245 as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const canonicalIsoSchema = z.string().datetime({ offset: false });
const safeRelativePathSchema = z.string().min(1).max(4_096).refine(
  (value) =>
    !value.includes("\\") &&
    !value.includes("\u0000") &&
    !path.posix.isAbsolute(value) &&
    value.split("/").every((part) => part && part !== "." && part !== ".."),
  "Path must be a canonical safe relative path.",
);

const targetLanguages = Object.freeze(
  supportedLanguages.filter(
    (language): language is Exclude<SupportedLanguage, typeof defaultLanguage> =>
      language !== defaultLanguage,
  ),
);
const languageByLocale = new Map(
  targetLanguages.map((language) => [localeForLanguage(language), language]),
);
const targetNamespaces = Object.freeze(
  Object.keys(siteSourceManifest)
    .filter((namespace) => namespace !== siteTranslationNamespace)
    .sort(compareCodePoints),
);
const FULL_SITE_PACK_TARGET = targetLanguages.length * targetNamespaces.length;
const pendingLedgerEntrySchema = z.tuple([
  z.string().min(1).max(32),
  z.string().min(1).max(1_024),
  z.enum(["missing", "stale"]),
  sha256Schema,
  sha256Schema.nullable(),
]);
const treeBindingSchema = z.object({
  relativePath: safeRelativePathSchema,
  files: z.number().int().nonnegative().max(20_000),
  bytes: z.number().int().nonnegative(),
  sha256: sha256Schema,
}).strict();
const inventoryCountsSchema = z.object({
  targetLanguages: z.number().int().positive(),
  targetSiteNamespaces: z.number().int().positive(),
  fullSitePackTarget: z.number().int().positive(),
  physicalSitePacks: z.number().int().nonnegative(),
  cleanPhysicalSitePacks: z.number().int().nonnegative(),
  stalePhysicalSitePacks: z.number().int().nonnegative(),
  missingSitePacks: z.number().int().nonnegative(),
  pendingCandidateJobs: z.number().int().nonnegative(),
  staticMainAppPacks: z.number().int().nonnegative(),
  availabilityNamespaceEntries: z.number().int().nonnegative(),
  advertisedLocalizedHtmlPaths: z.number().int().nonnegative(),
}).strict();
export const stagedTranslationFallbackInventoryEvidenceSchema = z.object({
  sourceManifest: z.object({
    relativePath: z.literal(SOURCE_MANIFEST_RELATIVE_PATH),
    fileSha256: sha256Schema,
    catalogRootSha256: sha256Schema,
    namespaces: z.number().int().positive(),
    targetNamespaces: z.number().int().positive(),
  }).strict(),
  availabilityManifest: z.object({
    relativePath: z.literal(AVAILABILITY_MANIFEST_RELATIVE_PATH),
    fileSha256: sha256Schema,
    logicalSha256: sha256Schema,
    namespaceEntries: z.number().int().nonnegative(),
    localizedHtmlPaths: z.number().int().nonnegative(),
    localizedHtmlPathsSha256: sha256Schema,
  }).strict(),
  curatedSiteTree: treeBindingSchema,
  staticMainAppTree: treeBindingSchema,
  counts: inventoryCountsSchema,
  targetSetSha256: sha256Schema,
  cleanTargetSetSha256: sha256Schema,
  pendingLedger: z.object({
    missing: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
    entries: z.array(pendingLedgerEntrySchema).max(FULL_SITE_PACK_TARGET),
    sha256: sha256Schema,
  }).strict(),
}).strict();

export type StagedTranslationFallbackInventoryEvidence = z.infer<
  typeof stagedTranslationFallbackInventoryEvidenceSchema
>;

const afrikaansReleaseProofMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("inspir-afrikaans-scoped-release-proof-v1"),
  language: z.literal("Afrikaans"),
  locale: z.literal("af"),
  candidatePacks: z.literal(EXPECTED_AFRIKAANS_CANDIDATE_PACKS),
  auditedPacks: z.literal(EXPECTED_AFRIKAANS_AUDITED_PACKS),
  auditedFields: z.literal(EXPECTED_AFRIKAANS_AUDITED_FIELDS),
  passed: z.literal(true),
  unadjudicatedFailures: z.literal(0),
  adjudicatedFailures: z.literal(0),
  auditManifestSha256: sha256Schema,
  semanticEvidenceSha256: sha256Schema,
  promotion: z.object({
    state: z.literal("committed-finalized"),
    transactionId: sha256Schema,
    journalBindingSha256: sha256Schema,
    preparedSha256: sha256Schema,
    committedSha256: sha256Schema,
    artifacts: z.literal(EXPECTED_AFRIKAANS_CANDIDATE_PACKS),
    publications: z.object({
      created: z.number().int().nonnegative().max(EXPECTED_AFRIKAANS_CANDIDATE_PACKS),
      replayed: z.number().int().nonnegative().max(EXPECTED_AFRIKAANS_CANDIDATE_PACKS),
      replaced: z.number().int().nonnegative().max(EXPECTED_AFRIKAANS_CANDIDATE_PACKS),
    }).strict(),
    postSiteTreeSha256: sha256Schema,
  }).strict(),
}).strict();
export const afrikaansStagedReleaseProofSchema =
  afrikaansReleaseProofMaterialSchema.extend({
    proofSha256: sha256Schema,
  }).strict();
export type AfrikaansStagedReleaseProof = z.infer<
  typeof afrikaansStagedReleaseProofSchema
>;

export const afrikaansStagedReleaseProofRequestSchema = z.object({
  runRoot: safeRelativePathSchema,
  transactionId: sha256Schema,
  transactionRoot: safeRelativePathSchema,
}).strict();
export type AfrikaansStagedReleaseProofRequest = z.infer<
  typeof afrikaansStagedReleaseProofRequestSchema
>;

export type AfrikaansStagedReleaseProofValidator = (input: Readonly<{
  workspaceRoot: string;
  request: AfrikaansStagedReleaseProofRequest;
}>) => AfrikaansStagedReleaseProof;

export type AfrikaansStagedPromotionProofReaderInput = Readonly<{
  workspaceRoot: string;
  runRoot: string;
  transactionRoot: string;
  transactionId: string;
}>;
export type AfrikaansStagedPromotionProofReaderResult = Readonly<{
  state: "committed-finalized";
  semanticAudit: Readonly<{
    manifestSha256: string;
    fields: number;
    packs: number;
    manifest: Readonly<{
      results: Readonly<{
        passed: true;
        counts: Readonly<{
          candidatePacks: number;
          unadjudicatedFailures: number;
          adjudicatedFailures: number;
        }>;
      }>;
    }>;
  }>;
  semanticEvidence: Readonly<{ semanticEvidenceSha256: string }>;
  journalBinding: Readonly<{ bindingSha256: string }>;
  transactionId: string;
  preparedSha256: string;
  committedSha256: string;
  artifacts: number;
  publications: Readonly<{
    created: number;
    replayed: number;
    replaced: number;
  }>;
  postSiteTree: Readonly<{ sha256: string }>;
}>;
export type AfrikaansStagedPromotionProofReader = (
  input: AfrikaansStagedPromotionProofReaderInput,
) => AfrikaansStagedPromotionProofReaderResult;

export function validateAfrikaansStagedReleaseProof(
  input: Readonly<{
    workspaceRoot: string;
    request: AfrikaansStagedReleaseProofRequest;
  }>,
  reader: AfrikaansStagedPromotionProofReader =
    readAndValidateAfrikaansStagedPromotionProof,
): AfrikaansStagedReleaseProof {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const request = afrikaansStagedReleaseProofRequestSchema.parse(input.request);
  const runRoot = resolveWorkspaceRelativePath(
    workspaceRoot,
    request.runRoot,
    "Afrikaans semantic run root",
  );
  const transactionRoot = resolveWorkspaceRelativePath(
    workspaceRoot,
    request.transactionRoot,
    "Afrikaans promotion transaction root",
  );
  assertNoSymlinkComponents(runRoot, "Afrikaans semantic run root");
  assertNoSymlinkComponents(
    transactionRoot,
    "Afrikaans promotion transaction root",
  );
  const finalized = reader({
    workspaceRoot,
    runRoot,
    transactionRoot,
    transactionId: request.transactionId,
  });
  if (
    finalized.state !== "committed-finalized" ||
    finalized.transactionId !== request.transactionId
  ) {
    throw new Error(
      "Scoped Afrikaans promotion proof is not the requested finalized transaction.",
    );
  }
  const counts = finalized.semanticAudit.manifest.results.counts;
  const material = afrikaansReleaseProofMaterialSchema.parse({
    schemaVersion: 1,
    kind: "inspir-afrikaans-scoped-release-proof-v1",
    language: "Afrikaans",
    locale: "af",
    candidatePacks: counts.candidatePacks,
    auditedPacks: finalized.semanticAudit.packs,
    auditedFields: finalized.semanticAudit.fields,
    passed: finalized.semanticAudit.manifest.results.passed,
    unadjudicatedFailures: counts.unadjudicatedFailures,
    adjudicatedFailures: counts.adjudicatedFailures,
    auditManifestSha256: finalized.semanticAudit.manifestSha256,
    semanticEvidenceSha256:
      finalized.semanticEvidence.semanticEvidenceSha256,
    promotion: {
      state: finalized.state,
      transactionId: finalized.transactionId,
      journalBindingSha256: finalized.journalBinding.bindingSha256,
      preparedSha256: finalized.preparedSha256,
      committedSha256: finalized.committedSha256,
      artifacts: finalized.artifacts,
      publications: finalized.publications,
      postSiteTreeSha256: finalized.postSiteTree.sha256,
    },
  });
  return afrikaansStagedReleaseProofSchema.parse({
    ...material,
    proofSha256: sha256Canonical(material),
  });
}

export const STAGED_TRANSLATION_FALLBACK_POLICY = Object.freeze({
  canonicalLanguage: "English",
  localizedRouteAdmission: "complete-source-current-fluent-availability-only",
  unavailableInternalNavigation: "canonical-English-unlocalized-URL",
  unavailableSitemapEntries: "omitted",
  unavailableStaticHtml: "not-materialized",
  mixedLanguageLocalizedPages: false,
  mainAppTranslations: "complete-static-bundles-for-all-69-target-languages",
} as const);

const authoritySchema = z.object({
  satisfiesStagedTranslationGate: z.literal(true),
  grantsDeploymentByItself: z.literal(false),
  canDeploy: z.literal(false),
  canWriteProduction: z.literal(false),
  fullSemanticTranslationRelease: z.literal(false),
  fullD1TranslationRepair: z.literal(false),
  productionD1TranslationSync: z.literal(false),
  legacyMarketingDeltaRelease: z.literal(false),
  productionTranslationWrites: z.literal(false),
}).strict();
export const STAGED_TRANSLATION_FALLBACK_AUTHORITIES = Object.freeze({
  satisfiesStagedTranslationGate: true,
  grantsDeploymentByItself: false,
  canDeploy: false,
  canWriteProduction: false,
  fullSemanticTranslationRelease: false,
  fullD1TranslationRepair: false,
  productionD1TranslationSync: false,
  legacyMarketingDeltaRelease: false,
  productionTranslationWrites: false,
} as const);

const attestationMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND),
  createdAt: canonicalIsoSchema,
  releaseMode: z.literal("staged-canonical-English-fallback"),
  inventory: stagedTranslationFallbackInventoryEvidenceSchema,
  afrikaansProofRequest: afrikaansStagedReleaseProofRequestSchema,
  afrikaansProof: afrikaansStagedReleaseProofSchema,
  fallbackPolicy: z.object({
    canonicalLanguage: z.literal(STAGED_TRANSLATION_FALLBACK_POLICY.canonicalLanguage),
    localizedRouteAdmission: z.literal(STAGED_TRANSLATION_FALLBACK_POLICY.localizedRouteAdmission),
    unavailableInternalNavigation: z.literal(STAGED_TRANSLATION_FALLBACK_POLICY.unavailableInternalNavigation),
    unavailableSitemapEntries: z.literal(STAGED_TRANSLATION_FALLBACK_POLICY.unavailableSitemapEntries),
    unavailableStaticHtml: z.literal(STAGED_TRANSLATION_FALLBACK_POLICY.unavailableStaticHtml),
    mixedLanguageLocalizedPages: z.literal(false),
    mainAppTranslations: z.literal(STAGED_TRANSLATION_FALLBACK_POLICY.mainAppTranslations),
  }).strict(),
  fallbackPolicySha256: sha256Schema,
  authorities: authoritySchema,
}).strict();
export const stagedTranslationFallbackReleaseAttestationSchema =
  attestationMaterialSchema.extend({ attestationSha256: sha256Schema }).strict();
export type StagedTranslationFallbackReleaseAttestation = z.infer<
  typeof stagedTranslationFallbackReleaseAttestationSchema
>;
export type StagedTranslationFallbackReleaseAttestationHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  artifact: StagedTranslationFallbackReleaseAttestation;
}>;

export const CURRENT_TRANSLATION_FALLBACK_PROMOTION_SCOPE = Object.freeze({
  sitePromotion: "none-for-this-release",
  candidateWorkbenches: "excluded-from-release-authority",
  admittedSiteRows: "tracked-source-current-clean-availability-only",
} as const);

const currentFallbackAttestationMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND),
  createdAt: canonicalIsoSchema,
  releaseMode: z.literal("staged-canonical-English-fallback"),
  promotionScope: z.object({
    sitePromotion: z.literal(
      CURRENT_TRANSLATION_FALLBACK_PROMOTION_SCOPE.sitePromotion,
    ),
    candidateWorkbenches: z.literal(
      CURRENT_TRANSLATION_FALLBACK_PROMOTION_SCOPE.candidateWorkbenches,
    ),
    admittedSiteRows: z.literal(
      CURRENT_TRANSLATION_FALLBACK_PROMOTION_SCOPE.admittedSiteRows,
    ),
  }).strict(),
  promotionScopeSha256: sha256Schema,
  inventory: stagedTranslationFallbackInventoryEvidenceSchema,
  fallbackPolicy: attestationMaterialSchema.shape.fallbackPolicy,
  fallbackPolicySha256: sha256Schema,
  authorities: authoritySchema,
}).strict();

export const currentTranslationFallbackReleaseAttestationSchema =
  currentFallbackAttestationMaterialSchema.extend({
    attestationSha256: sha256Schema,
  }).strict();

export type CurrentTranslationFallbackReleaseAttestation = z.infer<
  typeof currentTranslationFallbackReleaseAttestationSchema
>;
export type CurrentTranslationFallbackReleaseAttestationHandle = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  artifact: CurrentTranslationFallbackReleaseAttestation;
}>;
export type TranslationFallbackReleaseAttestationHandle =
  | StagedTranslationFallbackReleaseAttestationHandle
  | CurrentTranslationFallbackReleaseAttestationHandle;

export type StagedTranslationFallbackD1SiteRow = Readonly<{
  namespace: Exclude<keyof typeof siteSourceManifest, typeof siteTranslationNamespace>;
  language: Exclude<SupportedLanguage, typeof defaultLanguage>;
  locale: string;
  sourceHash: string;
  payload: Readonly<Record<string, string>>;
  model: string;
  relativePath: string;
  fileSha256: string;
}>;

export type StagedTranslationFallbackD1SiteCorpus<
  TAttestation extends TranslationFallbackReleaseAttestationHandle =
    CurrentTranslationFallbackReleaseAttestationHandle,
> = Readonly<{
  attestation: TAttestation;
  rows: readonly StagedTranslationFallbackD1SiteRow[];
  mainAppRows: readonly StagedTranslationFallbackD1MainAppRow[];
  rowSetSha256: string;
  payloadCorpusSha256: string;
}>;

export type StagedTranslationFallbackD1MainAppRow = Readonly<{
  namespace: typeof mainAppTranslationNamespace;
  language: Exclude<SupportedLanguage, typeof defaultLanguage>;
  locale: string;
  sourceHash: string;
  payload: Readonly<Record<string, string>>;
  model: "codex-curated-free-static-no-games-main-app-v1";
  relativePath: string;
  fileSha256: string;
}>;

export type StagedTranslationFallbackAttestationDependencies = Readonly<{
  inspectInventory: (workspaceRoot: string) =>
    StagedTranslationFallbackInventoryEvidence;
  validateAfrikaansReleaseProof: AfrikaansStagedReleaseProofValidator;
}>;

export const STAGED_TRANSLATION_FALLBACK_ATTESTATION_CLI_USAGE =
  "pnpm translations:attest-staged-fallback -- --run-dir <safe-relative-path> --transaction-root <safe-relative-path> --transaction-id <64-lowercase-hex>" as const;

export type StagedTranslationFallbackAttestationCliReport = Readonly<{
  kind: typeof STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND;
  releaseMode: "staged-canonical-English-fallback";
  artifactRelativePath:
    typeof STAGED_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH;
  artifactFileSha256: string;
  attestationSha256: string;
  inputs: AfrikaansStagedReleaseProofRequest;
  counts: StagedTranslationFallbackInventoryEvidence["counts"];
  bindings: Readonly<{
    curatedSiteTreeSha256: string;
    staticMainAppTreeSha256: string;
    availabilityManifestSha256: string;
    localizedHtmlPathsSha256: string;
    pendingLedgerSha256: string;
    auditManifestSha256: string;
    semanticEvidenceSha256: string;
    journalBindingSha256: string;
    postSiteTreeSha256: string;
  }>;
  authorities: typeof STAGED_TRANSLATION_FALLBACK_AUTHORITIES;
}>;

export function parseStagedTranslationFallbackAttestationCliArgs(
  args: readonly string[],
): AfrikaansStagedReleaseProofRequest {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (normalizedArgs.length !== 6) {
    throw new Error(
      `Staged fallback attestation requires exactly three flag/value pairs. Usage: ${STAGED_TRANSLATION_FALLBACK_ATTESTATION_CLI_USAGE}`,
    );
  }
  let runRoot: string | undefined;
  let transactionRoot: string | undefined;
  let transactionId: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < normalizedArgs.length; index += 2) {
    const flag = normalizedArgs[index];
    const value = normalizedArgs[index + 1];
    if (!flag || !value || value.startsWith("--")) {
      throw new Error(
        `Staged fallback attestation flag ${flag ?? "<missing>"} requires one non-empty value.`,
      );
    }
    if (seen.has(flag)) {
      throw new Error(`Duplicate staged fallback attestation flag: ${flag}.`);
    }
    seen.add(flag);
    if (flag === "--run-dir") runRoot = value;
    else if (flag === "--transaction-root") transactionRoot = value;
    else if (flag === "--transaction-id") transactionId = value;
    else throw new Error(`Unknown staged fallback attestation flag: ${flag}.`);
  }
  const parsed = afrikaansStagedReleaseProofRequestSchema.safeParse({
    runRoot,
    transactionRoot,
    transactionId,
  });
  if (!parsed.success) {
    throw new Error(
      `Staged fallback attestation arguments are invalid: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function runStagedTranslationFallbackAttestationCli(
  args: readonly string[],
  options: Readonly<{
    workspaceRoot?: string;
    createdAt?: Date;
    dependencies?: Partial<StagedTranslationFallbackAttestationDependencies>;
    writeOutput?: (output: string) => void;
  }> = {},
): StagedTranslationFallbackAttestationCliReport {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const request = parseStagedTranslationFallbackAttestationCliArgs(args);
  // Creation returns only after the newly written artifact has been reopened
  // and revalidated against the live inventory and finalized scoped proof.
  const validated = createStagedTranslationFallbackReleaseAttestation({
    workspaceRoot,
    createdAt: options.createdAt,
    afrikaansProofRequest: request,
    dependencies: options.dependencies,
  });
  const artifact = validated.artifact;
  const report: StagedTranslationFallbackAttestationCliReport = Object.freeze({
    kind: STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND,
    releaseMode: artifact.releaseMode,
    artifactRelativePath:
      STAGED_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH,
    artifactFileSha256: validated.sha256,
    attestationSha256: artifact.attestationSha256,
    inputs: request,
    counts: artifact.inventory.counts,
    bindings: Object.freeze({
      curatedSiteTreeSha256: artifact.inventory.curatedSiteTree.sha256,
      staticMainAppTreeSha256: artifact.inventory.staticMainAppTree.sha256,
      availabilityManifestSha256:
        artifact.inventory.availabilityManifest.fileSha256,
      localizedHtmlPathsSha256:
        artifact.inventory.availabilityManifest.localizedHtmlPathsSha256,
      pendingLedgerSha256: artifact.inventory.pendingLedger.sha256,
      auditManifestSha256: artifact.afrikaansProof.auditManifestSha256,
      semanticEvidenceSha256:
        artifact.afrikaansProof.semanticEvidenceSha256,
      journalBindingSha256:
        artifact.afrikaansProof.promotion.journalBindingSha256,
      postSiteTreeSha256:
        artifact.afrikaansProof.promotion.postSiteTreeSha256,
    }),
    authorities: STAGED_TRANSLATION_FALLBACK_AUTHORITIES,
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(output, "utf8") > 16 * 1024) {
    throw new Error("Staged fallback attestation CLI report exceeded its output bound.");
  }
  (options.writeOutput ?? ((value: string) => process.stdout.write(value)))(output);
  return report;
}

export function inspectStagedTranslationFallbackInventory(
  workspaceRoot = process.cwd(),
): StagedTranslationFallbackInventoryEvidence {
  const root = path.resolve(workspaceRoot);
  const sourceManifestFile = readStableFile(
    path.join(root, SOURCE_MANIFEST_RELATIVE_PATH),
    MAXIMUM_MANIFEST_BYTES,
    "Site source manifest",
  );
  const availabilityManifestFile = readStableFile(
    path.join(root, AVAILABILITY_MANIFEST_RELATIVE_PATH),
    MAXIMUM_MANIFEST_BYTES,
    "Site availability manifest",
  );
  const siteInspection = inspectCuratedSiteTree(root);
  const staticMainAppTree = inspectStaticMainAppTree(root);
  const expectedAvailability = availabilityFromCleanTargets(siteInspection.cleanTargets);
  const actualAvailability = normalizeAvailability(
    staticSiteTranslationNamespaceAvailability,
  );
  if (canonicalJson(expectedAvailability) !== canonicalJson(actualAvailability)) {
    const expectedSet = new Set(
      expectedAvailability.flatMap(([language, namespaces]) =>
        namespaces.map((namespace) => `${language}/${namespace}`)
      ),
    );
    const actualSet = new Set(
      actualAvailability.flatMap(([language, namespaces]) =>
        namespaces.map((namespace) => `${language}/${namespace}`)
      ),
    );
    const missing = [...expectedSet].filter((entry) => !actualSet.has(entry));
    const extra = [...actualSet].filter((entry) => !expectedSet.has(entry));
    throw new Error(
      `Site availability manifest does not exactly match the clean render-localized physical pack set: missing ${missing.slice(0, 10).join(", ") || "none"}; extra ${extra.slice(0, 10).join(", ") || "none"}.`,
    );
  }
  const localizedPathContract = buildStaticAssetLocalizedPathContract(
    staticSiteTranslationNamespaceAvailability,
  );
  const sourceRows = Object.entries(siteSourceManifest)
    .map(([namespace, source]) =>
      Object.freeze([
        namespace,
        source.sourceHash,
        Object.keys(source.sourceStrings).sort(compareCodePoints),
      ] as const)
    )
    .sort((left, right) => compareCodePoints(left[0], right[0]));
  const targetRows = targetLanguages.flatMap((language) => {
    const locale = localeForLanguage(language);
    return targetNamespaces.map((namespace) =>
      Object.freeze([
        locale,
        namespace,
        getSiteTranslationSource(namespace).sourceHash,
      ] as const)
    );
  }).sort(compareTupleIdentity);
  const pendingEntries: Array<z.infer<typeof pendingLedgerEntrySchema>> = [];
  for (const [locale, namespace, sourceHash] of targetRows) {
    const target = `${locale}\u0000${namespace}`;
    const physical = siteInspection.physicalTargets.get(target);
    if (!physical) {
      pendingEntries.push([
        locale,
        namespace,
        "missing",
        sourceHash,
        null,
      ]);
    } else if (!siteInspection.cleanTargets.has(target)) {
      pendingEntries.push([
        locale,
        namespace,
        "stale",
        sourceHash,
        physical.sha256,
      ]);
    }
  }
  const missing = pendingEntries.filter((entry) => entry[2] === "missing").length;
  const stale = pendingEntries.length - missing;
  const cleanRows = targetRows.filter(([locale, namespace]) =>
    siteInspection.cleanTargets.has(`${locale}\u0000${namespace}`)
  );
  const evidence = stagedTranslationFallbackInventoryEvidenceSchema.parse({
    sourceManifest: {
      relativePath: SOURCE_MANIFEST_RELATIVE_PATH,
      fileSha256: sourceManifestFile.sha256,
      catalogRootSha256: sha256Canonical(sourceRows),
      namespaces: sourceRows.length,
      targetNamespaces: targetNamespaces.length,
    },
    availabilityManifest: {
      relativePath: AVAILABILITY_MANIFEST_RELATIVE_PATH,
      fileSha256: availabilityManifestFile.sha256,
      logicalSha256: localizedPathContract.availabilitySha256,
      namespaceEntries: actualAvailability.reduce(
        (total, [, namespaces]) => total + namespaces.length,
        0,
      ),
      localizedHtmlPaths: localizedPathContract.localizedPaths.length,
      localizedHtmlPathsSha256: localizedPathContract.localizedPathsSha256,
    },
    curatedSiteTree: siteInspection.tree,
    staticMainAppTree,
    counts: {
      targetLanguages: targetLanguages.length,
      targetSiteNamespaces: targetNamespaces.length,
      fullSitePackTarget: FULL_SITE_PACK_TARGET,
      physicalSitePacks: siteInspection.physicalTargets.size,
      cleanPhysicalSitePacks: siteInspection.cleanTargets.size,
      stalePhysicalSitePacks: stale,
      missingSitePacks: missing,
      pendingCandidateJobs: pendingEntries.length,
      staticMainAppPacks: staticMainAppTree.files,
      availabilityNamespaceEntries: actualAvailability.reduce(
        (total, [, namespaces]) => total + namespaces.length,
        0,
      ),
      advertisedLocalizedHtmlPaths: localizedPathContract.localizedPaths.length,
    },
    targetSetSha256: sha256Canonical(targetRows),
    cleanTargetSetSha256: sha256Canonical(cleanRows),
    pendingLedger: {
      missing,
      stale,
      entries: pendingEntries,
      sha256: sha256Canonical(pendingEntries),
    },
  });
  validateInventoryConsistency(evidence);
  assertStableFileUnchanged(sourceManifestFile, "Site source manifest");
  assertStableFileUnchanged(availabilityManifestFile, "Site availability manifest");
  return evidence;
}

export function createStagedTranslationFallbackReleaseAttestation(input: {
  workspaceRoot: string;
  createdAt?: Date;
  afrikaansProofRequest: AfrikaansStagedReleaseProofRequest;
  dependencies?: Partial<StagedTranslationFallbackAttestationDependencies>;
}): StagedTranslationFallbackReleaseAttestationHandle {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const dependencies = resolveDependencies(input.dependencies);
  const inventory = dependencies.inspectInventory(workspaceRoot);
  validatePostAfrikaansReleaseInventory(inventory);
  const proofRequest = afrikaansStagedReleaseProofRequestSchema.parse(
    input.afrikaansProofRequest,
  );
  const afrikaansProof = validateRequiredAfrikaansProof(
    dependencies.validateAfrikaansReleaseProof,
    workspaceRoot,
    proofRequest,
    inventory,
  );
  const createdAt = canonicalTimestamp(input.createdAt ?? new Date());
  const material = attestationMaterialSchema.parse({
    schemaVersion: 1,
    kind: STAGED_TRANSLATION_FALLBACK_ATTESTATION_KIND,
    createdAt,
    releaseMode: "staged-canonical-English-fallback",
    inventory,
    afrikaansProofRequest: proofRequest,
    afrikaansProof,
    fallbackPolicy: STAGED_TRANSLATION_FALLBACK_POLICY,
    fallbackPolicySha256: sha256Canonical(STAGED_TRANSLATION_FALLBACK_POLICY),
    authorities: STAGED_TRANSLATION_FALLBACK_AUTHORITIES,
  });
  const artifact = stagedTranslationFallbackReleaseAttestationSchema.parse({
    ...material,
    attestationSha256: sha256Canonical(material),
  });
  const file = path.join(
    workspaceRoot,
    STAGED_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH,
  );
  writeTrackedFile(
    file,
    Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
  );
  return readAndValidateStagedTranslationFallbackReleaseAttestation({
    workspaceRoot,
    dependencies,
  });
}

export function readAndValidateStagedTranslationFallbackReleaseAttestation(input: {
  workspaceRoot: string;
  dependencies?: Partial<StagedTranslationFallbackAttestationDependencies>;
}): StagedTranslationFallbackReleaseAttestationHandle {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const dependencies = resolveDependencies(input.dependencies);
  const file = path.join(
    workspaceRoot,
    STAGED_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH,
  );
  const stable = readStableFile(
    file,
    MAXIMUM_ATTESTATION_BYTES,
    "Staged translation fallback release attestation",
  );
  const artifact = parseAttestation(stable.bytes);
  const currentInventory = dependencies.inspectInventory(workspaceRoot);
  validatePostAfrikaansReleaseInventory(currentInventory);
  if (canonicalJson(currentInventory) !== canonicalJson(artifact.inventory)) {
    throw new Error(
      "Staged translation fallback release attestation is stale for the exact manifests or translation trees.",
    );
  }
  const currentProof = validateRequiredAfrikaansProof(
    dependencies.validateAfrikaansReleaseProof,
    workspaceRoot,
    artifact.afrikaansProofRequest,
    currentInventory,
  );
  if (canonicalJson(currentProof) !== canonicalJson(artifact.afrikaansProof)) {
    throw new Error(
      "Staged translation fallback release attestation is stale for the Afrikaans audit or promotion proof.",
    );
  }
  assertStableFileUnchanged(
    stable,
    "Staged translation fallback release attestation",
  );
  return Object.freeze({
    path: file,
    bytes: stable.bytes.byteLength,
    sha256: stable.sha256,
    artifact,
  });
}

export function createCurrentTranslationFallbackReleaseAttestation(input: {
  workspaceRoot: string;
  createdAt?: Date;
  dependencies?: Pick<
    Partial<StagedTranslationFallbackAttestationDependencies>,
    "inspectInventory"
  >;
}): CurrentTranslationFallbackReleaseAttestationHandle {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const inspectInventory =
    input.dependencies?.inspectInventory ??
    inspectStagedTranslationFallbackInventory;
  const inventory = inspectInventory(workspaceRoot);
  validateCurrentNoSitePromotionInventory(inventory);
  const material = currentFallbackAttestationMaterialSchema.parse({
    schemaVersion: 1,
    kind: CURRENT_TRANSLATION_FALLBACK_ATTESTATION_KIND,
    createdAt: canonicalTimestamp(input.createdAt ?? new Date()),
    releaseMode: "staged-canonical-English-fallback",
    promotionScope: CURRENT_TRANSLATION_FALLBACK_PROMOTION_SCOPE,
    promotionScopeSha256: sha256Canonical(
      CURRENT_TRANSLATION_FALLBACK_PROMOTION_SCOPE,
    ),
    inventory,
    fallbackPolicy: STAGED_TRANSLATION_FALLBACK_POLICY,
    fallbackPolicySha256: sha256Canonical(STAGED_TRANSLATION_FALLBACK_POLICY),
    authorities: STAGED_TRANSLATION_FALLBACK_AUTHORITIES,
  });
  const artifact = currentTranslationFallbackReleaseAttestationSchema.parse({
    ...material,
    attestationSha256: sha256Canonical(material),
  });
  const file = path.join(
    workspaceRoot,
    CURRENT_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH,
  );
  writeTrackedFile(
    file,
    Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8"),
  );
  return readAndValidateCurrentTranslationFallbackReleaseAttestation({
    workspaceRoot,
    dependencies: input.dependencies,
  });
}

export function readAndValidateCurrentTranslationFallbackReleaseAttestation(
  input: {
    workspaceRoot: string;
    dependencies?: Pick<
      Partial<StagedTranslationFallbackAttestationDependencies>,
      "inspectInventory"
    >;
  },
): CurrentTranslationFallbackReleaseAttestationHandle {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const file = path.join(
    workspaceRoot,
    CURRENT_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH,
  );
  const stable = readStableFile(
    file,
    MAXIMUM_ATTESTATION_BYTES,
    "Current translation fallback no-site-promotion attestation",
  );
  const artifact = parseCurrentFallbackAttestation(stable.bytes);
  const inspectInventory =
    input.dependencies?.inspectInventory ??
    inspectStagedTranslationFallbackInventory;
  const currentInventory = inspectInventory(workspaceRoot);
  validateCurrentNoSitePromotionInventory(currentInventory);
  if (canonicalJson(currentInventory) !== canonicalJson(artifact.inventory)) {
    throw new Error(
      "Current translation fallback attestation is stale for the exact manifests or tracked translation trees.",
    );
  }
  assertStableFileUnchanged(
    stable,
    "Current translation fallback no-site-promotion attestation",
  );
  return Object.freeze({
    path: file,
    bytes: stable.bytes.byteLength,
    sha256: stable.sha256,
    artifact,
  });
}

export function runCurrentTranslationFallbackAttestationCli(
  args: readonly string[],
  options: Readonly<{
    workspaceRoot?: string;
    createdAt?: Date;
    dependencies?: Pick<
      Partial<StagedTranslationFallbackAttestationDependencies>,
      "inspectInventory"
    >;
    writeOutput?: (output: string) => void;
  }> = {},
) {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (
    normalizedArgs.length !== 1 ||
    normalizedArgs[0] !== "--current-no-site-promotion"
  ) {
    throw new Error(
      "Current fallback attestation requires exactly --current-no-site-promotion.",
    );
  }
  const validated = createCurrentTranslationFallbackReleaseAttestation({
    workspaceRoot: path.resolve(options.workspaceRoot ?? process.cwd()),
    createdAt: options.createdAt,
    dependencies: options.dependencies,
  });
  const report = Object.freeze({
    kind: validated.artifact.kind,
    releaseMode: validated.artifact.releaseMode,
    promotionScope: validated.artifact.promotionScope,
    artifactRelativePath:
      CURRENT_TRANSLATION_FALLBACK_ATTESTATION_RELATIVE_PATH,
    artifactFileSha256: validated.sha256,
    attestationSha256: validated.artifact.attestationSha256,
    counts: validated.artifact.inventory.counts,
    pendingLedgerSha256:
      validated.artifact.inventory.pendingLedger.sha256,
    authorities: validated.artifact.authorities,
  });
  (options.writeOutput ?? ((value: string) => process.stdout.write(value)))(
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

/**
 * Reconstructs the exact source-current site rows that the staged release may
 * store in D1. Missing and source-stale physical packs are deliberately absent
 * from this corpus, so deleting every non-member translation row makes the
 * runtime take its canonical English fallback instead of serving stale bytes.
 *
 * The staged attestation is validated both before and after the row scan. Each
 * pack is independently nofollow-read and identity-checked, closing the gap in
 * which a path, tree, pending ledger, or branch-specific release proof could
 * change after release admission but before SQL construction. The selected
 * current branch binds an explicit no-site-promotion scope; the separate
 * future finalized-Afrikaans loader retains its scoped promotion proof.
 */
export function loadStagedTranslationFallbackD1SiteCorpus(
  workspaceRoot = process.cwd(),
): StagedTranslationFallbackD1SiteCorpus {
  return loadTranslationFallbackD1SiteCorpus(
    workspaceRoot,
    readAndValidateCurrentTranslationFallbackReleaseAttestation,
  );
}

export function loadAfrikaansPromotedStagedTranslationFallbackD1SiteCorpus(
  workspaceRoot = process.cwd(),
): StagedTranslationFallbackD1SiteCorpus<
  StagedTranslationFallbackReleaseAttestationHandle
> {
  return loadTranslationFallbackD1SiteCorpus(
    workspaceRoot,
    readAndValidateStagedTranslationFallbackReleaseAttestation,
  );
}

function loadTranslationFallbackD1SiteCorpus<
  TAttestation extends TranslationFallbackReleaseAttestationHandle,
>(
  workspaceRoot: string,
  readAttestation: (input: {
    workspaceRoot: string;
  }) => TAttestation,
): StagedTranslationFallbackD1SiteCorpus<TAttestation> {
  const root = path.resolve(workspaceRoot);
  const admitted = readAttestation({
    workspaceRoot: root,
  });
  const curatedRoot = path.join(root, CURATED_SITE_ROOT_RELATIVE_PATH);
  assertRealDirectory(curatedRoot, "Curated site translation root");
  const expectedLocales = [...languageByLocale.keys()].sort(compareCodePoints);
  const localeEntries = readdirSync(curatedRoot, { withFileTypes: true })
    .sort((left, right) => compareCodePoints(left.name, right.name));
  if (
    canonicalJson(localeEntries.map((entry) => entry.name)) !==
      canonicalJson(expectedLocales) ||
    localeEntries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())
  ) {
    throw new Error("Curated site translation locale directories are incomplete or unsafe.");
  }

  const rows: StagedTranslationFallbackD1SiteRow[] = [];
  const cleanTargetRows: Array<readonly [string, string, string]> = [];
  const seen = new Set<string>();
  for (const locale of expectedLocales) {
    const language = languageByLocale.get(locale);
    if (!language) throw new Error(`Unknown curated site locale ${locale}.`);
    const localeRoot = path.join(curatedRoot, locale);
    assertRealDirectory(localeRoot, `Curated site locale ${locale}`);
    const entries = readdirSync(localeRoot, { withFileTypes: true })
      .sort((left, right) => compareCodePoints(left.name, right.name));
    for (const entry of entries) {
      const relativePath = `${locale}/${entry.name}`;
      if (isTranslationSemanticMainAppWorkbenchPath(relativePath)) continue;
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
        throw new Error(
          `Curated site locale contains an unsafe entry: ${relativePath}.`,
        );
      }
      const stable = readStableFile(
        path.join(localeRoot, entry.name),
        MAXIMUM_PACK_BYTES,
        `Curated site pack ${relativePath}`,
      );
      const pack = parseStagedCuratedSitePack(stable.bytes, relativePath);
      if (
        pack.language !== language ||
        pack.locale !== languageConfigs[language].locale ||
        !isKnownSiteTranslationNamespace(pack.namespace) ||
        pack.namespace === siteTranslationNamespace ||
        entry.name !== `${fileSafeNamespace(pack.namespace)}.json`
      ) {
        throw new Error(
          `Curated site pack identity is path-mismatched: ${relativePath}.`,
        );
      }
      const source = getSiteTranslationSource(pack.namespace);
      const bundle = currentBundleFromPack(
        pack,
        language,
        source.sourceHash,
        source.sourceStrings,
      );
      assertStableFileUnchanged(stable, `Curated site pack ${relativePath}`);
      if (
        bundle === null ||
        !isTranslationBundleCompleteAndFluent(source, bundle, language)
      ) {
        continue;
      }
      const identity = `${locale}\u0000${pack.namespace}`;
      if (seen.has(identity)) {
        throw new Error(`Staged D1 corpus duplicates ${locale}/${pack.namespace}.`);
      }
      seen.add(identity);
      cleanTargetRows.push([locale, pack.namespace, source.sourceHash]);
      rows.push(Object.freeze({
        namespace: pack.namespace as StagedTranslationFallbackD1SiteRow["namespace"],
        language,
        locale,
        sourceHash: source.sourceHash,
        payload: Object.freeze({ ...bundle.strings }),
        model: pack.model,
        relativePath,
        fileSha256: stable.sha256,
      }));
    }
  }
  rows.sort((left, right) =>
    compareCodePoints(left.namespace, right.namespace) ||
    compareCodePoints(left.language, right.language)
  );
  cleanTargetRows.sort(compareTupleIdentity);
  if (
    rows.length !== admitted.artifact.inventory.counts.cleanPhysicalSitePacks ||
    sha256Canonical(cleanTargetRows) !==
      admitted.artifact.inventory.cleanTargetSetSha256
  ) {
    throw new Error(
      "Staged D1 corpus does not match the attested exact clean target set.",
    );
  }

  const pending = new Set(
    admitted.artifact.inventory.pendingLedger.entries.map(
      ([pendingLocale, namespace]) => `${pendingLocale}\u0000${namespace}`,
    ),
  );
  if (rows.some((row) => pending.has(`${row.locale}\u0000${row.namespace}`))) {
    throw new Error("Staged D1 corpus intersects the attested deferred target ledger.");
  }

  const mainAppRoot = path.join(root, STATIC_MAIN_APP_ROOT_RELATIVE_PATH);
  assertRealDirectory(mainAppRoot, "Static main-app translation root");
  const mainAppSourceStrings = getMainAppSourceStrings();
  const mainAppSourceHash = getMainAppSourceHash(mainAppSourceStrings);
  const mainAppSource = {
    namespace: mainAppTranslationNamespace,
    sourceHash: mainAppSourceHash,
    sourceStrings: mainAppSourceStrings,
    systemInstruction: "",
  };
  const mainAppRows: StagedTranslationFallbackD1MainAppRow[] = [];
  for (const language of targetLanguages) {
    const locale = localeForLanguage(language);
    const relativePath = `${locale}.json`;
    const stable = readStableFile(
      path.join(mainAppRoot, relativePath),
      MAXIMUM_PACK_BYTES,
      `Static main-app pack ${relativePath}`,
    );
    const value = staticMainAppPackSchema.parse(
      parseStrictTranslationSemanticJsonBytes(
        stable.bytes,
        `Static main-app pack ${relativePath}`,
      ),
    );
    const payload = parseStaticMainAppTranslationsValue(
      mainAppSource,
      language,
      value,
    );
    if (
      !isTranslationBundleCompleteAndFluent(
        mainAppSource,
        {
          namespace: mainAppTranslationNamespace,
          language,
          sourceHash: mainAppSourceHash,
          sourceStrings: mainAppSourceStrings,
          strings: payload,
        },
        language,
      )
    ) {
      throw new Error(
        `Static main-app translation is not render-ready for ${language}.`,
      );
    }
    assertStableFileUnchanged(stable, `Static main-app pack ${relativePath}`);
    mainAppRows.push(Object.freeze({
      namespace: mainAppTranslationNamespace,
      language,
      locale,
      sourceHash: mainAppSourceHash,
      payload: Object.freeze(payload),
      model: "codex-curated-free-static-no-games-main-app-v1",
      relativePath,
      fileSha256: stable.sha256,
    }));
  }
  mainAppRows.sort((left, right) => compareCodePoints(left.language, right.language));
  if (
    mainAppRows.length !==
      admitted.artifact.inventory.counts.staticMainAppPacks
  ) {
    throw new Error("Staged D1 corpus does not retain every attested main-app pack.");
  }
  const revalidated = readAttestation({
    workspaceRoot: root,
  });
  if (
    revalidated.sha256 !== admitted.sha256 ||
    revalidated.artifact.attestationSha256 !==
      admitted.artifact.attestationSha256
  ) {
    throw new Error("Staged fallback release evidence changed during D1 corpus loading.");
  }
  return Object.freeze({
    attestation: revalidated,
    rows: Object.freeze(rows),
    mainAppRows: Object.freeze(mainAppRows),
    rowSetSha256: sha256Canonical(
      [...rows, ...mainAppRows]
        .map((row) => [row.namespace, row.language, row.sourceHash] as const)
        .sort(compareTupleIdentity),
    ),
    payloadCorpusSha256: sha256Canonical(
      [...rows, ...mainAppRows]
        .map((row) => [
          row.namespace,
          row.language,
          row.sourceHash,
          row.model,
          row.namespace === mainAppTranslationNamespace
            ? `${STATIC_MAIN_APP_ROOT_RELATIVE_PATH}/${row.relativePath}`
            : `${CURATED_SITE_ROOT_RELATIVE_PATH}/${row.relativePath}`,
          row.fileSha256,
          row.payload,
        ] as const)
        .sort((left, right) =>
          compareCodePoints(
            `${left[0]}\u0000${left[1]}`,
            `${right[0]}\u0000${right[1]}`,
          )
        ),
    ),
  });
}

function inspectCuratedSiteTree(workspaceRoot: string) {
  const curatedRoot = path.join(workspaceRoot, CURATED_SITE_ROOT_RELATIVE_PATH);
  assertRealDirectory(curatedRoot, "Curated site translation root");
  const expectedLocales = [...languageByLocale.keys()].sort(compareCodePoints);
  const localeEntries = readdirSync(curatedRoot, { withFileTypes: true })
    .sort((left, right) => compareCodePoints(left.name, right.name));
  if (
    canonicalJson(localeEntries.map((entry) => entry.name)) !==
      canonicalJson(expectedLocales) ||
    localeEntries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())
  ) {
    throw new Error("Curated site translation locale directories are incomplete or unsafe.");
  }
  const rows: Array<readonly [string, number, string]> = [];
  const physicalTargets = new Map<string, Readonly<{ sha256: string }>>();
  const cleanTargets = new Set<string>();
  for (const locale of expectedLocales) {
    const language = languageByLocale.get(locale);
    if (!language) throw new Error(`Unknown curated site locale ${locale}.`);
    const localeRoot = path.join(curatedRoot, locale);
    assertRealDirectory(localeRoot, `Curated site locale ${locale}`);
    const entries = readdirSync(localeRoot, { withFileTypes: true })
      .sort((left, right) => compareCodePoints(left.name, right.name));
    for (const entry of entries) {
      const relativePath = `${locale}/${entry.name}`;
      if (isTranslationSemanticMainAppWorkbenchPath(relativePath)) {
        continue;
      }
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
        throw new Error(`Curated site locale contains an unsafe entry: ${locale}/${entry.name}.`);
      }
      const stable = readStableFile(
        path.join(localeRoot, entry.name),
        MAXIMUM_PACK_BYTES,
        `Curated site pack ${relativePath}`,
      );
      const pack = parseStagedCuratedSitePack(stable.bytes, relativePath);
      if (
        pack.language !== language ||
        pack.locale !== languageConfigs[language].locale ||
        !isKnownSiteTranslationNamespace(pack.namespace) ||
        pack.namespace === siteTranslationNamespace ||
        entry.name !== `${fileSafeNamespace(pack.namespace)}.json`
      ) {
        throw new Error(`Curated site pack identity is path-mismatched: ${relativePath}.`);
      }
      const target = `${locale}\u0000${pack.namespace}`;
      if (physicalTargets.has(target)) {
        throw new Error(`Curated site tree duplicates target ${locale}/${pack.namespace}.`);
      }
      physicalTargets.set(target, Object.freeze({ sha256: stable.sha256 }));
      rows.push(Object.freeze([relativePath, stable.bytes.byteLength, stable.sha256]));
      const source = getSiteTranslationSource(pack.namespace);
      const bundle = currentBundleFromPack(
        pack,
        language,
        source.sourceHash,
        source.sourceStrings,
      );
      if (
        bundle !== null &&
        isTranslationBundleCompleteAndFluent(source, bundle, language)
      ) {
        cleanTargets.add(target);
      }
    }
  }
  rows.sort((left, right) => compareCodePoints(left[0], right[0]));
  return Object.freeze({
    tree: Object.freeze({
      relativePath: CURATED_SITE_ROOT_RELATIVE_PATH,
      files: rows.length,
      bytes: rows.reduce((total, row) => total + row[1], 0),
      sha256: sha256Canonical(rows),
    }),
    physicalTargets,
    cleanTargets,
  });
}

function inspectStaticMainAppTree(workspaceRoot: string) {
  const staticRoot = path.join(workspaceRoot, STATIC_MAIN_APP_ROOT_RELATIVE_PATH);
  assertRealDirectory(staticRoot, "Static main-app translation root");
  const expectedFiles = targetLanguages
    .map((language) => `${localeForLanguage(language)}.json`)
    .sort(compareCodePoints);
  const entries = readdirSync(staticRoot, { withFileTypes: true })
    .sort((left, right) => compareCodePoints(left.name, right.name));
  if (
    canonicalJson(entries.map((entry) => entry.name)) !== canonicalJson(expectedFiles) ||
    entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
  ) {
    throw new Error("Static main-app translation tree is incomplete or unsafe.");
  }
  const sourceStrings = getMainAppSourceStrings();
  const source = {
    namespace: "main-app",
    sourceHash: getMainAppSourceHash(sourceStrings),
    sourceStrings,
    systemInstruction: "",
  };
  const rows: Array<readonly [string, number, string]> = [];
  for (const language of targetLanguages) {
    const relativePath = `${localeForLanguage(language)}.json`;
    const stable = readStableFile(
      path.join(staticRoot, relativePath),
      MAXIMUM_PACK_BYTES,
      `Static main-app pack ${relativePath}`,
    );
    const pack = staticMainAppPackSchema.parse(
      parseStrictTranslationSemanticJsonBytes(
        stable.bytes,
        `Static main-app pack ${relativePath}`,
      ),
    );
    parseStaticMainAppTranslationsValue(source, language, pack);
    assertStableFileUnchanged(stable, `Static main-app pack ${relativePath}`);
    rows.push(Object.freeze([relativePath, stable.bytes.byteLength, stable.sha256]));
  }
  rows.sort((left, right) => compareCodePoints(left[0], right[0]));
  return Object.freeze({
    relativePath: STATIC_MAIN_APP_ROOT_RELATIVE_PATH,
    files: rows.length,
    bytes: rows.reduce((total, row) => total + row[1], 0),
    sha256: sha256Canonical(rows),
  });
}

const staticMainAppPackSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("static-main-app-values"),
  language: z.enum(supportedLanguages),
  locale: z.string().min(1).max(32),
  sourceHash: sha256Schema,
  keyCount: z.number().int().positive().max(20_000),
  strings: z.array(z.string().min(1).max(200_000)).min(1).max(20_000),
}).strict();
const legacySitePackEntrySchema = z.object({
  key: z.string().min(1).max(1_024),
  source: z.string().max(100_000),
  value: z.string().min(1).max(200_000),
}).strict();
const legacySitePackSchema = z.object({
  schemaVersion: z.literal(1),
  language: z.enum(supportedLanguages),
  locale: z.string().min(1).max(32),
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  model: z.string().min(1).max(256),
  entries: z.array(legacySitePackEntrySchema).min(1).max(20_000),
}).strict();
const promotedSitePackProvenanceMaterialSchema = z.object({
  kind: z.literal(LONG_TAIL_TRANSLATION_CURATED_PROVENANCE_KIND),
  pipelineVersion: z.literal(LONG_TAIL_TRANSLATION_PIPELINE_VERSION),
  executionProfileSha256: z.literal(LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256),
  protectorVersion: z.literal(LONG_TAIL_TRANSLATION_PROTECTOR_VERSION),
  protectorSha256: sha256Schema,
  masterWorklistSha256: sha256Schema,
  packWorklistSha256: sha256Schema,
  jobSha256: sha256Schema,
  sourceEntriesSha256: sha256Schema,
  modelSha256: sha256Schema,
  pipelineImplementationSha256: sha256Schema,
  workerImplementationSha256: sha256Schema,
  validatorPolicySha256: sha256Schema,
  candidateSha256: sha256Schema,
}).strict();
const promotedSitePackProvenanceSchema =
  promotedSitePackProvenanceMaterialSchema.extend({
    provenanceSha256: sha256Schema,
  }).strict();
const promotedSitePackSchema = z.object({
  schemaVersion: z.literal(1),
  language: z.enum(supportedLanguages),
  locale: z.string().min(1).max(32),
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  model: z.string().min(1).max(256),
  provenance: promotedSitePackProvenanceSchema,
  translations: z.record(
    z.string().min(1).max(1_024),
    z.string().min(1).max(200_000),
  ),
}).strict();
export type ParsedStagedCuratedSitePack =
  | z.infer<typeof legacySitePackSchema>
  | z.infer<typeof promotedSitePackSchema>;

export function parseStagedCuratedSitePack(
  bytes: Buffer,
  relativePath: string,
): ParsedStagedCuratedSitePack {
  const value = parseStrictTranslationSemanticJsonBytes(
    bytes,
    `Curated site pack ${relativePath}`,
  );
  const parsed = isJsonRecord(value) &&
      Object.prototype.hasOwnProperty.call(value, "provenance")
    ? promotedSitePackSchema.parse(value)
    : legacySitePackSchema.parse(value);
  const keys = "entries" in parsed
    ? parsed.entries.map((entry) => entry.key)
    : Object.keys(parsed.translations);
  if (
    new Set(keys).size !== keys.length ||
    keys.length < 1 ||
    keys.length > 20_000 ||
    ("entries" in parsed ? parsed.entries : []).some(
      (entry) =>
        entry.source !== entry.source.normalize("NFC") ||
        entry.value !== entry.value.normalize("NFC") ||
        !entry.value.trim(),
    ) ||
    ("translations" in parsed ? Object.values(parsed.translations) : []).some(
      (value) => value !== value.normalize("NFC") || !value.trim(),
    )
  ) {
    throw new Error(`Curated site pack is structurally unsafe: ${relativePath}.`);
  }
  if ("provenance" in parsed) {
    const { provenanceSha256, ...material } = parsed.provenance;
    if (provenanceSha256 !== sha256Canonical(material)) {
      throw new Error(
        `Curated promoted site pack provenance is self-hash invalid: ${relativePath}.`,
      );
    }
  }
  return parsed;
}

function currentBundleFromPack(
  pack: ParsedStagedCuratedSitePack,
  language: SupportedLanguage,
  currentSourceHash: string,
  sourceStrings: Readonly<Record<string, string>>,
): TranslationBundle | null {
  if (pack.sourceHash !== currentSourceHash) return null;
  const strings: Record<string, string> = {};
  if ("entries" in pack) {
    if (pack.entries.length !== Object.keys(sourceStrings).length) return null;
    for (const entry of pack.entries) {
      if (sourceStrings[entry.key] !== entry.source || strings[entry.key] !== undefined) {
        return null;
      }
      strings[entry.key] = entry.value;
    }
  } else {
    const sourceCatalog = createSourceCatalogEntry({
      namespace: pack.namespace,
      sourceHash: currentSourceHash,
      sourceStrings,
    });
    if (
      pack.provenance.sourceEntriesSha256 !==
        sourceCatalog.sourceEntriesSha256
    ) {
      return null;
    }
    const translated = pack.translations;
    if (
      canonicalJson(Object.keys(translated).sort(compareCodePoints)) !==
      canonicalJson(Object.keys(sourceStrings).sort(compareCodePoints))
    ) {
      return null;
    }
    Object.assign(strings, translated);
  }
  return {
    namespace: pack.namespace,
    language,
    sourceHash: pack.sourceHash,
    sourceStrings: { ...sourceStrings },
    strings,
  };
}

function availabilityFromCleanTargets(cleanTargets: ReadonlySet<string>) {
  const availability: StaticAssetTranslationAvailability = {};
  for (const language of targetLanguages) {
    const locale = localeForLanguage(language);
    const namespaces = targetNamespaces.filter(
      (namespace) =>
        isRenderLocalizedSiteTranslationNamespace(namespace) &&
        cleanTargets.has(`${locale}\u0000${namespace}`),
    );
    if (namespaces.length) availability[language] = Object.freeze(namespaces);
  }
  return normalizeAvailability(availability);
}

function normalizeAvailability(availability: StaticAssetTranslationAvailability) {
  return targetLanguages.map((language) => {
    const namespaces = [...(availability[language] ?? [])].sort(compareCodePoints);
    if (new Set(namespaces).size !== namespaces.length) {
      throw new Error(`Availability manifest duplicates a namespace for ${language}.`);
    }
    return Object.freeze([language, Object.freeze(namespaces)] as const);
  });
}

function validateInventoryConsistency(
  inventory: StagedTranslationFallbackInventoryEvidence,
) {
  const { counts, pendingLedger } = inventory;
  const staleEntries = pendingLedger.entries.filter((entry) => entry[2] === "stale");
  const missingEntries = pendingLedger.entries.filter((entry) => entry[2] === "missing");
  const identities = pendingLedger.entries.map((entry) => `${entry[0]}\u0000${entry[1]}`);
  if (
    counts.targetLanguages !== targetLanguages.length ||
    counts.targetSiteNamespaces !== targetNamespaces.length ||
    counts.fullSitePackTarget !== FULL_SITE_PACK_TARGET ||
    inventory.sourceManifest.namespaces !== Object.keys(siteSourceManifest).length ||
    inventory.sourceManifest.targetNamespaces !== targetNamespaces.length ||
    counts.physicalSitePacks + counts.missingSitePacks !== FULL_SITE_PACK_TARGET ||
    counts.cleanPhysicalSitePacks + counts.stalePhysicalSitePacks !==
      counts.physicalSitePacks ||
    counts.pendingCandidateJobs !==
      counts.missingSitePacks + counts.stalePhysicalSitePacks ||
    counts.staticMainAppPacks !== targetLanguages.length ||
    counts.availabilityNamespaceEntries !==
      inventory.availabilityManifest.namespaceEntries ||
    counts.advertisedLocalizedHtmlPaths !==
      inventory.availabilityManifest.localizedHtmlPaths ||
    pendingLedger.missing !== missingEntries.length ||
    pendingLedger.stale !== staleEntries.length ||
    pendingLedger.missing !== counts.missingSitePacks ||
    pendingLedger.stale !== counts.stalePhysicalSitePacks ||
    pendingLedger.entries.length !== counts.pendingCandidateJobs ||
    new Set(identities).size !== identities.length ||
    canonicalJson([...pendingLedger.entries].sort(comparePendingEntries)) !==
      canonicalJson(pendingLedger.entries) ||
    missingEntries.some((entry) => entry[4] !== null) ||
    staleEntries.some((entry) => entry[4] === null) ||
    pendingLedger.sha256 !== sha256Canonical(pendingLedger.entries)
  ) {
    throw new Error("Staged translation fallback inventory accounting is inconsistent.");
  }
}

function validatePostAfrikaansReleaseInventory(
  inventoryValue: StagedTranslationFallbackInventoryEvidence,
) {
  const inventory = stagedTranslationFallbackInventoryEvidenceSchema.parse(
    inventoryValue,
  );
  validateInventoryConsistency(inventory);
  const counts = inventory.counts;
  if (
    counts.physicalSitePacks !== EXPECTED_POST_AFRIKAANS_PHYSICAL_SITE_PACKS ||
    counts.cleanPhysicalSitePacks !==
      EXPECTED_POST_AFRIKAANS_CLEAN_PHYSICAL_SITE_PACKS ||
    counts.stalePhysicalSitePacks !== EXPECTED_DEFERRED_STALE_REPLACEMENTS ||
    counts.missingSitePacks !== EXPECTED_POST_AFRIKAANS_MISSING_SITE_PACKS ||
    counts.pendingCandidateJobs !== EXPECTED_POST_AFRIKAANS_PENDING_JOBS ||
    counts.availabilityNamespaceEntries <= 0 ||
    counts.advertisedLocalizedHtmlPaths <= 0 ||
    inventory.curatedSiteTree.files !==
      EXPECTED_POST_AFRIKAANS_PHYSICAL_SITE_PACKS ||
    inventory.staticMainAppTree.files !== targetLanguages.length
  ) {
    throw new Error(
      "Staged translation fallback attestation requires the exact audited post-Afrikaans inventory.",
    );
  }
}

function validateCurrentNoSitePromotionInventory(
  inventoryValue: StagedTranslationFallbackInventoryEvidence,
) {
  const inventory = stagedTranslationFallbackInventoryEvidenceSchema.parse(
    inventoryValue,
  );
  validateInventoryConsistency(inventory);
  const counts = inventory.counts;
  if (
    counts.physicalSitePacks !== EXPECTED_CURRENT_PHYSICAL_SITE_PACKS ||
    counts.cleanPhysicalSitePacks !==
      EXPECTED_CURRENT_CLEAN_PHYSICAL_SITE_PACKS ||
    counts.stalePhysicalSitePacks !== EXPECTED_CURRENT_STALE_SITE_PACKS ||
    counts.missingSitePacks !== EXPECTED_CURRENT_MISSING_SITE_PACKS ||
    counts.pendingCandidateJobs !== EXPECTED_CURRENT_PENDING_JOBS ||
    counts.availabilityNamespaceEntries !==
      EXPECTED_CURRENT_AVAILABILITY_ENTRIES ||
    counts.advertisedLocalizedHtmlPaths !==
      EXPECTED_CURRENT_LOCALIZED_HTML_PATHS ||
    inventory.curatedSiteTree.files !== EXPECTED_CURRENT_PHYSICAL_SITE_PACKS ||
    inventory.staticMainAppTree.files !== targetLanguages.length
  ) {
    throw new Error(
      "Current translation fallback attestation requires the exact tracked no-site-promotion inventory.",
    );
  }
}

function validateRequiredAfrikaansProof(
  validator: AfrikaansStagedReleaseProofValidator,
  workspaceRoot: string,
  request: AfrikaansStagedReleaseProofRequest,
  inventory: StagedTranslationFallbackInventoryEvidence,
) {
  const proof = afrikaansStagedReleaseProofSchema.parse(
    validator({ workspaceRoot, request }),
  );
  const { proofSha256, ...material } = proof;
  const publicationTotal =
    proof.promotion.publications.created +
    proof.promotion.publications.replayed +
    proof.promotion.publications.replaced;
  if (
    proofSha256 !== sha256Canonical(material) ||
    proof.promotion.transactionId !== request.transactionId ||
    proof.promotion.postSiteTreeSha256 !== inventory.curatedSiteTree.sha256 ||
    publicationTotal !== EXPECTED_AFRIKAANS_CANDIDATE_PACKS
  ) {
    throw new Error(
      "Scoped Afrikaans audit/promotion proof is stale, incomplete, or not bound to the post-promotion tree.",
    );
  }
  return proof;
}

function parseAttestation(bytes: Buffer) {
  const value = parseStrictTranslationSemanticJsonBytes(
    bytes,
    "Staged translation fallback release attestation",
  );
  const artifact = stagedTranslationFallbackReleaseAttestationSchema.parse(value);
  const canonicalBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  const { attestationSha256, ...material } = artifact;
  if (
    !canonicalBytes.equals(bytes) ||
    attestationSha256 !== sha256Canonical(material) ||
    artifact.fallbackPolicySha256 !==
      sha256Canonical(STAGED_TRANSLATION_FALLBACK_POLICY) ||
    canonicalJson(artifact.fallbackPolicy) !==
      canonicalJson(STAGED_TRANSLATION_FALLBACK_POLICY) ||
    canonicalJson(artifact.authorities) !==
      canonicalJson(STAGED_TRANSLATION_FALLBACK_AUTHORITIES)
  ) {
    throw new Error(
      "Staged translation fallback release attestation is noncanonical or self-hash invalid.",
    );
  }
  return artifact;
}

function parseCurrentFallbackAttestation(bytes: Buffer) {
  const value = parseStrictTranslationSemanticJsonBytes(
    bytes,
    "Current translation fallback no-site-promotion attestation",
  );
  const artifact =
    currentTranslationFallbackReleaseAttestationSchema.parse(value);
  const canonicalBytes = Buffer.from(
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  const { attestationSha256, ...material } = artifact;
  if (
    !canonicalBytes.equals(bytes) ||
    attestationSha256 !== sha256Canonical(material) ||
    artifact.promotionScopeSha256 !==
      sha256Canonical(CURRENT_TRANSLATION_FALLBACK_PROMOTION_SCOPE) ||
    canonicalJson(artifact.promotionScope) !==
      canonicalJson(CURRENT_TRANSLATION_FALLBACK_PROMOTION_SCOPE) ||
    artifact.fallbackPolicySha256 !==
      sha256Canonical(STAGED_TRANSLATION_FALLBACK_POLICY) ||
    canonicalJson(artifact.fallbackPolicy) !==
      canonicalJson(STAGED_TRANSLATION_FALLBACK_POLICY) ||
    canonicalJson(artifact.authorities) !==
      canonicalJson(STAGED_TRANSLATION_FALLBACK_AUTHORITIES)
  ) {
    throw new Error(
      "Current translation fallback attestation is noncanonical or self-hash invalid.",
    );
  }
  return artifact;
}

function resolveDependencies(
  overrides?: Partial<StagedTranslationFallbackAttestationDependencies>,
): StagedTranslationFallbackAttestationDependencies {
  return {
    inspectInventory:
      overrides?.inspectInventory ?? inspectStagedTranslationFallbackInventory,
    validateAfrikaansReleaseProof:
      overrides?.validateAfrikaansReleaseProof ??
      validateAfrikaansStagedReleaseProof,
  };
}

function canonicalTimestamp(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error("Attestation clock is invalid.");
  return value.toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (isJsonRecord(value)) {
    const record = value;
    return `{${Object.keys(record).sort(compareCodePoints).map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(",")}}`;
  }
  throw new Error("Canonical JSON contains a non-JSON value.");
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sha256CanonicalStagedTranslationEvidence(value: unknown) {
  return sha256Canonical(value);
}

function sha256Canonical(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function localeForLanguage(language: SupportedLanguage) {
  return languageConfigs[language].prefix || languageConfigs[language].locale;
}

function fileSafeNamespace(namespace: string) {
  const safe = namespace.replace(/[^a-z0-9.-]+/gi, "__");
  if (!safe || safe === "." || safe === "..") {
    throw new Error(`Translation namespace has no safe filename: ${namespace}.`);
  }
  return safe;
}

function resolveWorkspaceRelativePath(
  workspaceRoot: string,
  relativePath: string,
  label: string,
) {
  const parsed = safeRelativePathSchema.parse(relativePath);
  const absolute = path.resolve(workspaceRoot, ...parsed.split("/"));
  const relative = path.relative(workspaceRoot, absolute);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} must resolve strictly inside the workspace.`);
  }
  return absolute;
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareTupleIdentity(
  left: readonly [string, string, string],
  right: readonly [string, string, string],
) {
  return compareCodePoints(`${left[0]}\u0000${left[1]}`, `${right[0]}\u0000${right[1]}`);
}

function comparePendingEntries(
  left: z.infer<typeof pendingLedgerEntrySchema>,
  right: z.infer<typeof pendingLedgerEntrySchema>,
) {
  return compareCodePoints(`${left[0]}\u0000${left[1]}`, `${right[0]}\u0000${right[1]}`);
}

function assertRealDirectory(directory: string, label: string) {
  assertNoSymlinkComponents(directory, label);
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory.`);
  }
}

function assertNoSymlinkComponents(target: string, label: string) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const metadata = lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) throw new Error(`${label} path does not exist: ${current}.`);
    if (metadata.isSymbolicLink()) throw new Error(`${label} contains a symbolic link.`);
  }
}

type StableFile = Readonly<{
  path: string;
  maximumBytes: number;
  bytes: Buffer;
  sha256: string;
  identity: string;
}>;

function readStableFile(file: string, maximumBytes: number, label: string): StableFile {
  assertNoSymlinkComponents(file, label);
  const beforePath = lstatSync(file, { bigint: true });
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.nlink !== BigInt(1) ||
    beforePath.size > BigInt(maximumBytes)
  ) {
    throw new Error(`${label} must be a bounded single-link regular file.`);
  }
  const descriptor = openSync(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  let bytes: Buffer;
  let identity = "";
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== BigInt(1) || before.size > BigInt(maximumBytes)) {
      throw new Error(`${label} must be a bounded single-link regular file.`);
    }
    bytes = Buffer.allocUnsafe(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) throw new Error(`${label} was truncated while read.`);
      offset += count;
    }
    if (readSync(descriptor, Buffer.allocUnsafe(1), 0, 1, null) !== 0) {
      throw new Error(`${label} grew while read.`);
    }
    const after = fstatSync(descriptor, { bigint: true });
    const afterPath = lstatSync(file, { bigint: true });
    const fields = ["dev", "ino", "nlink", "size", "mtimeNs", "ctimeNs", "mode", "uid"] as const;
    if (
      fields.some((field) => before[field] !== after[field] || after[field] !== afterPath[field]) ||
      before.dev !== beforePath.dev ||
      before.ino !== beforePath.ino ||
      before.size !== beforePath.size ||
      BigInt(bytes.length) !== after.size
    ) {
      throw new Error(`${label} changed while read.`);
    }
    identity = fields.map((field) => after[field].toString()).join(":");
  } finally {
    closeSync(descriptor);
  }
  return Object.freeze({
    path: file,
    maximumBytes,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    identity,
  });
}

function assertStableFileUnchanged(prior: StableFile, label: string) {
  const current = readStableFile(prior.path, prior.maximumBytes, label);
  if (current.sha256 !== prior.sha256 || current.identity !== prior.identity) {
    throw new Error(`${label} changed during validation.`);
  }
}

function writeTrackedFile(file: string, bytes: Buffer) {
  const directory = path.dirname(file);
  assertNoSymlinkComponents(
    directory,
    "Staged translation fallback attestation directory",
  );
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.tmp-${process.pid}-${randomUUID()}`,
  );
  const descriptor = openSync(
    temporary,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      fsConstants.O_NOFOLLOW,
    0o644,
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, file);
    fsyncDirectory(directory);
  } finally {
    if (lstatSync(temporary, { throwIfNoEntry: false })) unlinkSync(temporary);
  }
}

function fsyncDirectory(directory: string) {
  const descriptor = openSync(
    directory,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  try {
    runStagedTranslationFallbackAttestationCli(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[translations:attest-staged-fallback] ${message.slice(0, 2_048)}\n`,
    );
    process.exitCode = 1;
  }
}
