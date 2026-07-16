import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeSync,
  type BigIntStats,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  defaultLanguage,
  languageConfigs,
  supportedLanguages,
} from "@/lib/content/languages";
import { validateTranslationCandidateField } from "@/lib/i18n/translation-candidate-quality";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import { isTranslationFieldLikelyFluent } from "@/lib/i18n/translation-quality";
import {
  assertCurrentLongTailValidatorPolicy,
  calculateLongTailValidatorPolicySha256,
  createLongTailValidatorPolicyProvenance,
} from "./translation-validator-policy-provenance";
import type {
  LegacyLongTailSeedSalvageCurrentValidation,
  LegacyLongTailSeedSalvageMasterWorklist,
  LegacyLongTailSeedSalvageSeedMemory,
} from "./legacy-long-tail-seed-salvage-contract";
import { parseStrictTranslationSemanticJsonBytes } from "./verify-translation-semantic-audit";

export const LEGACY_LONG_TAIL_SEED_SALVAGE_KIND =
  "inspir-untrusted-obsolete-long-tail-seed-salvage-v1" as const;
export const LEGACY_LONG_TAIL_SEED_SALVAGE_POLICY = Object.freeze({
  trustModel: "untrusted-obsolete-input-current-policy-revalidation",
  authentication: "none",
  inputStatus: "obsolete-self-attested-candidate-seed-only",
  currentValidation: "every-current-occurrence-context",
  currentSeedPrecedence: "current-seed-wins",
  grantsReleaseEvidence: false,
  canApply: false,
  canPromote: false,
  canDeploy: false,
  canWriteProduction: false,
} as const);
export const LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_KIND =
  "inspir-legacy-long-tail-seed-salvage-acceptance-v1" as const;
export const LEGACY_LONG_TAIL_SEED_SALVAGE_EVIDENCE_BASENAME =
  "legacy-seed-salvage-evidence.json" as const;
export const LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_BASENAME =
  "legacy-seed-salvage-acceptance.json" as const;
export const LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_STATEMENT =
  "I accept this exact recomputed salvage solely as candidate-generation input; it grants no release, promotion, deployment, or production-write authority." as const;
export const LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_POLICY = Object.freeze({
  trustModel: "trusted-single-user-local-workspace",
  authentication: "none",
  identityClaimsVerified: false,
  scope: "exact-recomputed-salvage-candidate-generation-input-only",
  canUseRecomputedSeedForCandidateGeneration: true,
  grantsReleaseEvidence: false,
  substitutesCandidateValidation: false,
  substitutesSemanticAudit: false,
  substitutesReleaseGates: false,
  canPromoteByItself: false,
  canDeploy: false,
  canWriteProduction: false,
} as const);

const LEGACY_PIPELINE_VERSION = "inspir-long-tail-local-nllb-v2" as const;
const WORKLIST_KIND = "inspir-long-tail-translation-worklist-v1" as const;
const SEED_MEMORY_KIND = "inspir-long-tail-translation-seed-memory-v1" as const;
const SOURCE_STALE_REPLACEMENT_KIND =
  "inspir-long-tail-source-stale-replacement-v1" as const;
const PROTECTOR_KIND = "inspir-long-tail-literal-protector-v1" as const;
const MAXIMUM_LEGACY_WORKLIST_BYTES = 160 * 1024 * 1024;
const MAXIMUM_IMPLEMENTATION_BYTES = 16 * 1024 * 1024;
const MAXIMUM_ACCEPTANCE_BYTES = 256 * 1024;
const MAXIMUM_ACCEPTANCE_LIFETIME_MS = 31 * 24 * 60 * 60 * 1_000;
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256Schema = z.string().regex(sha256Pattern);
const targetLanguageSchema = z.enum(supportedLanguages).refine(
  (language) => language !== defaultLanguage,
  "English cannot be a legacy translation target.",
);
const safeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  "Expected a non-negative safe integer.",
);
const positiveIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);

function isSafeRelativePath(value: string): boolean {
  return Boolean(value) &&
    !value.includes("\u0000") &&
    !value.includes("\\") &&
    !path.posix.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    value.split("/").every(
      (segment) => Boolean(segment) && segment !== "." && segment !== "..",
    );
}

const relativePathSchema = z.string().min(1).max(1_024).refine(
  isSafeRelativePath,
  "Expected a safe normalized relative path.",
);
const protectedSegmentSchema = z.object({
  kind: z.enum(["text", "literal"]),
  value: z.string().max(100_000),
}).strict();
const sourceEntrySchema = z.object({
  key: z.string().min(1).max(1_024),
  source: z.string().max(100_000),
  sourceSha256: sha256Schema,
  invariantSha256: sha256Schema,
  segments: z.array(protectedSegmentSchema).min(1).max(10_000),
}).strict();
const sourceCatalogSchema = z.object({
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  sourceEntriesSha256: sha256Schema,
  entries: z.array(sourceEntrySchema).min(1).max(20_000),
}).strict();
const seedEntrySchema = z.object({
  language: targetLanguageSchema,
  locale: z.string().min(1).max(32),
  source: z.string().max(100_000),
  sourceSha256: sha256Schema,
  value: z.string().min(1).max(200_000),
  valueSha256: sha256Schema,
}).strict();
const seedConflictSchema = z.object({
  language: targetLanguageSchema,
  locale: z.string().min(1).max(32),
  sourceSha256: sha256Schema,
}).strict();
const obsoleteSeedMemorySchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(SEED_MEMORY_KIND),
  entries: z.array(seedEntrySchema).max(500_000),
  conflicts: z.array(seedConflictSchema).max(500_000),
  seedMemorySha256: sha256Schema,
}).strict();
const validatorPolicyFileSchema = z.object({
  relativePath: relativePathSchema,
  bytes: safeIntegerSchema,
  sha256: sha256Schema,
}).strict();
const obsoleteValidatorPolicySchema = z.object({
  kind: z.literal("inspir-long-tail-validator-policy-v1"),
  files: z.array(validatorPolicyFileSchema).max(64),
  validatorPolicySha256: sha256Schema,
}).strict();
const generationConfigSchema = z.object({
  batchSize: positiveIntegerSchema.refine((value) => value <= 256),
  numBeams: positiveIntegerSchema.refine((value) => value <= 8),
  noRepeatNgramSize: z.number().int().min(0).max(16),
  dtype: z.enum(["float16", "float32"]),
  device: z.enum(["auto", "cpu", "mps"]),
  maxSourceTokens: positiveIntegerSchema.refine((value) => value <= 1_022),
  maxNewTokens: positiveIntegerSchema.refine((value) => value <= 1_022),
  maxRetryAttempts: positiveIntegerSchema.refine((value) => value <= 3),
}).strict();
const obsoleteProvenanceSchema = z.object({
  pipelineVersion: z.literal(LEGACY_PIPELINE_VERSION),
  protectorVersion: z.literal(PROTECTOR_KIND),
  protectorSha256: sha256Schema,
  pipelineImplementationSha256: sha256Schema,
  workerImplementationSha256: sha256Schema,
  validatorPolicy: obsoleteValidatorPolicySchema,
  modelLabel: z.string().min(1).max(256),
  modelSha256: sha256Schema,
  seedMemorySha256: sha256Schema,
  seedMemoryEntries: safeIntegerSchema.refine((value) => value <= 500_000),
  seedMemoryConflicts: safeIntegerSchema.refine((value) => value <= 500_000),
  generationConfig: generationConfigSchema,
}).strict();
const sourceStaleReplacementSchema = z.object({
  kind: z.literal(SOURCE_STALE_REPLACEMENT_KIND),
  existingFileSha256: sha256Schema,
  priorSourceHash: sha256Schema,
}).strict();
const obsoleteJobMaterialSchema = z.object({
  language: targetLanguageSchema,
  locale: z.string().min(1).max(32),
  nllbCode: z.string().regex(/^[a-z]{3}_[A-Za-z]{4}$/),
  namespace: z.string().min(1).max(1_024),
  sourceHash: sha256Schema,
  sourceEntriesSha256: sha256Schema,
  entryCount: positiveIntegerSchema,
  worklistRelativePath: relativePathSchema,
  candidateRelativePath: relativePathSchema,
  targetRelativePath: relativePathSchema,
  replacement: sourceStaleReplacementSchema.optional(),
}).strict();
const obsoleteJobSchema = obsoleteJobMaterialSchema.extend({
  jobSha256: sha256Schema,
}).strict();
const obsoleteWorklistSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(WORKLIST_KIND),
  provenance: obsoleteProvenanceSchema,
  seedMemory: obsoleteSeedMemorySchema,
  sources: z.array(sourceCatalogSchema).min(1).max(1_000),
  jobs: z.array(obsoleteJobSchema).max(100_000),
  worklistSha256: sha256Schema,
}).strict();

const implementationBindingSchema = z.object({
  relativePath: relativePathSchema,
  bytes: safeIntegerSchema,
  sha256: sha256Schema,
}).strict();
const implementationBindingsSchema = z.tuple([
  implementationBindingSchema.extend({
    relativePath: z.literal("scripts/generate-long-tail-translations.ts"),
  }).strict(),
  implementationBindingSchema.extend({
    relativePath: z.literal("scripts/legacy-long-tail-seed-salvage.ts"),
  }).strict(),
  implementationBindingSchema.extend({
    relativePath: z.literal("scripts/verify-translation-semantic-audit.ts"),
  }).strict(),
]);
const authoritySchema = z.object({
  trustModel: z.literal(LEGACY_LONG_TAIL_SEED_SALVAGE_POLICY.trustModel),
  authentication: z.literal(LEGACY_LONG_TAIL_SEED_SALVAGE_POLICY.authentication),
  inputStatus: z.literal(LEGACY_LONG_TAIL_SEED_SALVAGE_POLICY.inputStatus),
  currentValidation: z.literal(
    LEGACY_LONG_TAIL_SEED_SALVAGE_POLICY.currentValidation,
  ),
  currentSeedPrecedence: z.literal(
    LEGACY_LONG_TAIL_SEED_SALVAGE_POLICY.currentSeedPrecedence,
  ),
  grantsReleaseEvidence: z.literal(false),
  canApply: z.literal(false),
  canPromote: z.literal(false),
  canDeploy: z.literal(false),
  canWriteProduction: z.literal(false),
}).strict();
const rejectionCountsSchema = z.record(
  z.string().min(1).max(128),
  safeIntegerSchema,
);
const salvageEvidenceMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(LEGACY_LONG_TAIL_SEED_SALVAGE_KIND),
  authority: authoritySchema,
  input: z.object({
    relativePath: relativePathSchema,
    bytes: positiveIntegerSchema.refine(
      (value) => value <= MAXIMUM_LEGACY_WORKLIST_BYTES,
    ),
    fileSha256: sha256Schema,
    declaredWorklistSha256: sha256Schema,
    declaredSeedMemorySha256: sha256Schema,
    declaredProvenanceSha256: sha256Schema,
    entries: safeIntegerSchema,
    conflicts: safeIntegerSchema,
  }).strict(),
  current: z.object({
    repoRootRealpathSha256: sha256Schema,
    planningMasterWorklistSha256: sha256Schema,
    sourceCatalogSha256: sha256Schema,
    occurrenceContextSha256: sha256Schema,
    eligiblePairSha256: sha256Schema,
    sourceNamespaces: positiveIntegerSchema,
    sourceOccurrences: positiveIntegerSchema,
    distinctSourceTexts: positiveIntegerSchema,
    targetJobs: positiveIntegerSchema,
    targetLanguages: positiveIntegerSchema,
    eligiblePairs: positiveIntegerSchema,
    validatorPolicySha256: sha256Schema,
    validatorPolicyFilesSha256: sha256Schema,
    baseSeedMemorySha256: sha256Schema,
    baseSeedEntries: safeIntegerSchema,
    baseSeedConflicts: safeIntegerSchema,
    implementations: implementationBindingsSchema,
  }).strict(),
  decisions: z.object({
    examinedEntries: safeIntegerSchema,
    revalidatedAgainstAllCurrentContexts: safeIntegerSchema,
    excludedOutsideCurrentWorkload: safeIntegerSchema,
    eligibleRevalidatedEntries: safeIntegerSchema,
    overlapWithCurrentSeed: safeIntegerSchema,
    addedEntries: safeIntegerSchema,
    currentSeedValueConflicts: safeIntegerSchema,
    currentSeedDeclaredConflictRejections: safeIntegerSchema,
    currentPolicyRejectedEntries: safeIntegerSchema,
    rejectedEntries: safeIntegerSchema,
    obsoleteDeclaredConflicts: safeIntegerSchema,
    eligibleObsoleteDeclaredConflicts: safeIntegerSchema,
    addedConflictRecords: safeIntegerSchema,
    rejectionCounts: rejectionCountsSchema,
    decisionRecordsSha256: sha256Schema,
    revalidatedEntriesSha256: sha256Schema,
    addedEntriesSha256: sha256Schema,
    conflictRecordsSha256: sha256Schema,
  }).strict(),
  result: z.object({
    seedMemorySha256: sha256Schema,
    entries: safeIntegerSchema,
    conflicts: safeIntegerSchema,
    pipelineProvenanceMustBindExactSeedMemory: z.literal(true),
  }).strict(),
}).strict();
const salvageEvidenceSchema = salvageEvidenceMaterialSchema.extend({
  evidenceSha256: sha256Schema,
}).strict();
const acceptanceAuthoritySchema = z.object({
  trustModel: z.literal(
    LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_POLICY.trustModel,
  ),
  authentication: z.literal(
    LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_POLICY.authentication,
  ),
  identityClaimsVerified: z.literal(false),
  scope: z.literal(LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_POLICY.scope),
  canUseRecomputedSeedForCandidateGeneration: z.literal(true),
  grantsReleaseEvidence: z.literal(false),
  substitutesCandidateValidation: z.literal(false),
  substitutesSemanticAudit: z.literal(false),
  substitutesReleaseGates: z.literal(false),
  canPromoteByItself: z.literal(false),
  canDeploy: z.literal(false),
  canWriteProduction: z.literal(false),
}).strict();
const acceptanceBindingsSchema = z.object({
  input: z.object({
    relativePath: relativePathSchema,
    bytes: positiveIntegerSchema.refine(
      (value) => value <= MAXIMUM_LEGACY_WORKLIST_BYTES,
    ),
    fileSha256: sha256Schema,
    declaredWorklistSha256: sha256Schema,
    declaredSeedMemorySha256: sha256Schema,
    declaredProvenanceSha256: sha256Schema,
  }).strict(),
  diagnostic: z.object({
    kind: z.literal(LEGACY_LONG_TAIL_SEED_SALVAGE_KIND),
    evidenceSha256: sha256Schema,
  }).strict(),
  result: z.object({
    seedMemorySha256: sha256Schema,
    entries: safeIntegerSchema,
    conflicts: safeIntegerSchema,
  }).strict(),
  current: z.object({
    repoRootRealpathSha256: sha256Schema,
    planningMasterWorklistSha256: sha256Schema,
    sourceCatalogSha256: sha256Schema,
    occurrenceContextSha256: sha256Schema,
    eligiblePairSha256: sha256Schema,
    validatorPolicySha256: sha256Schema,
    validatorPolicyFilesSha256: sha256Schema,
    baseSeedMemorySha256: sha256Schema,
    implementations: implementationBindingsSchema,
  }).strict(),
}).strict();
const acceptanceMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_KIND),
  authority: acceptanceAuthoritySchema,
  acceptanceStatement: z.literal(
    LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_STATEMENT,
  ),
  acceptedAt: z.string().min(1).max(64),
  expiresAt: z.string().min(1).max(64),
  bindings: acceptanceBindingsSchema,
}).strict();
const acceptanceSchema = acceptanceMaterialSchema.extend({
  acceptanceSha256: sha256Schema,
}).strict();

export type LegacyLongTailSeedSalvageEvidence = Readonly<
  z.infer<typeof salvageEvidenceSchema>
>;
export type LegacyLongTailSeedSalvageResult<
  TSeedMemory extends LegacyLongTailSeedSalvageSeedMemory =
    LegacyLongTailSeedSalvageSeedMemory,
> = Readonly<{
  seedMemory: TSeedMemory;
  evidence: LegacyLongTailSeedSalvageEvidence;
}>;
export type LegacyLongTailSeedSalvageAcceptance = Readonly<
  z.infer<typeof acceptanceSchema>
>;
export type AcceptedLegacyLongTailSeedSalvageResult<
  TSeedMemory extends LegacyLongTailSeedSalvageSeedMemory =
    LegacyLongTailSeedSalvageSeedMemory,
> = Readonly<{
  seedMemory: TSeedMemory;
  evidence: LegacyLongTailSeedSalvageEvidence;
  acceptance: LegacyLongTailSeedSalvageAcceptance;
}>;
export type LegacyLongTailStableReadFaultPoint =
  | "after-open-before-read"
  | "after-read-before-final-identity";

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical salvage JSON cannot contain non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isUnknownRecord(value)) {
    return `{${Object.keys(value).sort(compareCodePoints).map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  throw new Error(`Canonical salvage JSON cannot encode ${typeof value}.`);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Canonical(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

class CanonicalArraySha256 {
  private readonly digest = createHash("sha256");
  private count = 0;
  private finalized = false;

  constructor() {
    this.digest.update("[", "utf8");
  }

  add(value: unknown): void {
    if (this.finalized) {
      throw new Error("Canonical salvage digest was already finalized.");
    }
    if (this.count > 0) this.digest.update(",", "utf8");
    this.digest.update(canonicalJson(value), "utf8");
    this.count += 1;
  }

  finalize(): string {
    if (this.finalized) {
      throw new Error("Canonical salvage digest was already finalized.");
    }
    this.finalized = true;
    this.digest.update("]", "utf8");
    return this.digest.digest("hex");
  }
}

function freezeDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) freezeDeep(entry);
  } else if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) freezeDeep(entry);
  }
  if (typeof value === "object" && value !== null) Object.freeze(value);
  return value;
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} is malformed: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.isFile() && right.isFile() &&
    left.nlink === BigInt(1) && right.nlink === BigInt(1) &&
    left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs && left.mode === right.mode &&
    left.uid === right.uid;
}

function currentUserId(): bigint {
  if (typeof process.getuid !== "function") {
    throw new Error(
      "Legacy seed salvage private artifacts require a local numeric user ID.",
    );
  }
  return BigInt(process.getuid());
}

function assertOwnerPrivateFile(metadata: BigIntStats, label: string): void {
  if (
    metadata.uid !== currentUserId() ||
    (metadata.mode & BigInt(0o777)) !== BigInt(0o600)
  ) {
    throw new Error(`${label} must be current-owner mode 0600.`);
  }
}

function assertOwnerPrivateDirectory(
  metadata: BigIntStats,
  label: string,
): void {
  if (
    !metadata.isDirectory() ||
    metadata.uid !== currentUserId() ||
    (metadata.mode & BigInt(0o777)) !== BigInt(0o700)
  ) {
    throw new Error(`${label} must be a current-owner mode-0700 directory.`);
  }
}

function assertNoSymlinkComponents(file: string, label: string): void {
  const resolved = path.resolve(file);
  const parsed = path.parse(resolved);
  let cursor = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep)) {
    if (!segment) continue;
    cursor = path.join(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`${label} contains a symbolic-link component: ${cursor}.`);
    }
  }
}

function readStableFile(input: Readonly<{
  file: string;
  maximumBytes: number;
  label: string;
  ownerPrivate?: boolean;
  raceHook?: (point: LegacyLongTailStableReadFaultPoint) => void;
}>): Readonly<{ bytes: Buffer; sha256: string }> {
  assertNoSymlinkComponents(input.file, input.label);
  const pathBefore = lstatSync(input.file, { bigint: true });
  if (
    !pathBefore.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.nlink !== BigInt(1) ||
    pathBefore.size <= BigInt(0) ||
    pathBefore.size > BigInt(input.maximumBytes)
  ) {
    throw new Error(
      `${input.label} must be a bounded, single-link, regular file.`,
    );
  }
  if (input.ownerPrivate) {
    assertOwnerPrivateFile(pathBefore, input.label);
  }
  const descriptor = openSync(
    input.file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(pathBefore, before)) {
      throw new Error(`${input.label} changed while it was opened.`);
    }
    input.raceHook?.("after-open-before-read");
    const expectedBytes = Number(before.size);
    const bytes = Buffer.allocUnsafe(expectedBytes);
    let offset = 0;
    while (offset < expectedBytes) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        expectedBytes - offset,
        null,
      );
      if (count === 0) throw new Error(`${input.label} was truncated while read.`);
      offset += count;
    }
    const growthProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, growthProbe, 0, 1, null) !== 0) {
      throw new Error(`${input.label} grew while it was read.`);
    }
    input.raceHook?.("after-read-before-final-identity");
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(input.file, { bigint: true });
    assertNoSymlinkComponents(input.file, input.label);
    if (
      !sameFileIdentity(before, after) ||
      !sameFileIdentity(after, pathAfter) ||
      BigInt(bytes.byteLength) !== after.size
    ) {
      throw new Error(`${input.label} changed while it was read.`);
    }
    if (input.ownerPrivate) {
      assertOwnerPrivateFile(after, input.label);
    }
    return Object.freeze({ bytes, sha256: sha256Bytes(bytes) });
  } finally {
    closeSync(descriptor);
  }
}

function resolveContainedTemporaryFile(
  repoRoot: string,
  requestedPath: string,
  label: string,
): Readonly<{ repoRoot: string; file: string; relativePath: string }> {
  const requestedRepoRoot = path.resolve(repoRoot);
  const realRepoRoot = realpathSync(requestedRepoRoot);
  if (requestedRepoRoot !== realRepoRoot) {
    throw new Error("The repository root must be its exact real path.");
  }
  const temporaryRoot = path.join(realRepoRoot, "tmp");
  const file = path.resolve(realRepoRoot, requestedPath);
  if (!file.startsWith(`${temporaryRoot}${path.sep}`)) {
    throw new Error(`${label} must remain below repository tmp/.`);
  }
  assertNoSymlinkComponents(file, label);
  if (realpathSync(file) !== file) {
    throw new Error(`${label} must resolve without symlinks.`);
  }
  const relativePath = path.relative(realRepoRoot, file).split(path.sep).join("/");
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`${label} has an unsafe repository path.`);
  }
  return Object.freeze({ repoRoot: realRepoRoot, file, relativePath });
}

function sourceStringsSha256(
  entries: readonly Readonly<{ key: string; source: string }>[],
): string {
  const stablePayload = [...entries]
    .sort((left, right) => compareCodePoints(left.key, right.key))
    .map((entry) => `${entry.key}\u0000${entry.source}`)
    .join("\u0001");
  return sha256Text(stablePayload);
}

function expectedLocale(language: (typeof supportedLanguages)[number]): string {
  return languageConfigs[language].prefix || languageConfigs[language].locale;
}

function assertStrictlyOrderedUnique(
  values: readonly string[],
  label: string,
): void {
  let prior: string | undefined;
  for (const value of values) {
    if (prior !== undefined && compareCodePoints(prior, value) >= 0) {
      throw new Error(`${label} is duplicate or noncanonical.`);
    }
    prior = value;
  }
}

function validateObsoleteWorklist(value: unknown) {
  const worklist = parseSchema(
    obsoleteWorklistSchema,
    value,
    "Untrusted obsolete worklist",
  );
  const { seedMemorySha256, ...seedMaterial } = worklist.seedMemory;
  if (sha256Canonical(seedMaterial) !== seedMemorySha256) {
    throw new Error("Untrusted obsolete seed-memory hash is stale or tampered.");
  }
  if (
    worklist.provenance.seedMemorySha256 !== seedMemorySha256 ||
    worklist.provenance.seedMemoryEntries !== worklist.seedMemory.entries.length ||
    worklist.provenance.seedMemoryConflicts !== worklist.seedMemory.conflicts.length
  ) {
    throw new Error("Untrusted obsolete provenance does not bind its seed memory.");
  }
  if (
    calculateLongTailValidatorPolicySha256(
      worklist.provenance.validatorPolicy.files,
    ) !== worklist.provenance.validatorPolicy.validatorPolicySha256
  ) {
    throw new Error("Untrusted obsolete validator-policy hash is stale or tampered.");
  }
  const entryIdentities: string[] = [];
  for (const entry of worklist.seedMemory.entries) {
    const identity = `${entry.locale}\u0000${entry.sourceSha256}`;
    entryIdentities.push(identity);
    if (
      entry.locale !== expectedLocale(entry.language) ||
      sha256Text(entry.source) !== entry.sourceSha256 ||
      sha256Text(entry.value) !== entry.valueSha256
    ) {
      throw new Error(`Untrusted obsolete seed entry is internally stale: ${identity}.`);
    }
  }
  assertStrictlyOrderedUnique(entryIdentities, "Untrusted obsolete seed entries");
  const conflictIdentities: string[] = [];
  const entryIdentitySet = new Set(entryIdentities);
  for (const conflict of worklist.seedMemory.conflicts) {
    const identity = `${conflict.locale}\u0000${conflict.sourceSha256}`;
    conflictIdentities.push(identity);
    if (
      conflict.locale !== expectedLocale(conflict.language) ||
      entryIdentitySet.has(identity)
    ) {
      throw new Error(`Untrusted obsolete conflict is internally stale: ${identity}.`);
    }
  }
  assertStrictlyOrderedUnique(
    conflictIdentities,
    "Untrusted obsolete conflict entries",
  );
  const sourceByNamespace = new Map<string, z.infer<typeof sourceCatalogSchema>>();
  const sourceNamespaces: string[] = [];
  for (const source of worklist.sources) {
    sourceNamespaces.push(source.namespace);
    const keys = source.entries.map((entry) => entry.key);
    assertStrictlyOrderedUnique(keys, `Untrusted obsolete source ${source.namespace} keys`);
    for (const entry of source.entries) {
      const joined = entry.segments.map((segment) => segment.value).join("");
      const invariantValues = entry.segments
        .filter((segment) => segment.kind === "literal")
        .map((segment) => segment.value);
      if (
        joined !== entry.source ||
        sha256Text(entry.source) !== entry.sourceSha256 ||
        sha256Canonical(invariantValues) !== entry.invariantSha256
      ) {
        throw new Error(
          `Untrusted obsolete source entry is internally stale: ${source.namespace}/${entry.key}.`,
        );
      }
    }
    if (
      sha256Canonical(source.entries) !== source.sourceEntriesSha256 ||
      sourceStringsSha256(source.entries) !== source.sourceHash
    ) {
      throw new Error(`Untrusted obsolete source is internally stale: ${source.namespace}.`);
    }
    sourceByNamespace.set(source.namespace, source);
  }
  assertStrictlyOrderedUnique(sourceNamespaces, "Untrusted obsolete sources");
  const jobPaths: string[] = [];
  const jobHashes = new Set<string>();
  for (const job of worklist.jobs) {
    const { jobSha256, ...jobMaterial } = job;
    const source = sourceByNamespace.get(job.namespace);
    if (
      sha256Canonical(jobMaterial) !== jobSha256 ||
      jobHashes.has(jobSha256) ||
      !source ||
      source.sourceHash !== job.sourceHash ||
      source.sourceEntriesSha256 !== job.sourceEntriesSha256 ||
      source.entries.length !== job.entryCount ||
      job.locale !== expectedLocale(job.language)
    ) {
      throw new Error(
        `Untrusted obsolete job is internally stale: ${job.locale}/${job.namespace}.`,
      );
    }
    jobHashes.add(jobSha256);
    jobPaths.push(job.candidateRelativePath);
  }
  assertStrictlyOrderedUnique(jobPaths, "Untrusted obsolete jobs");
  const { worklistSha256, ...worklistMaterial } = worklist;
  if (sha256Canonical(worklistMaterial) !== worklistSha256) {
    throw new Error("Untrusted obsolete worklist hash is stale or tampered.");
  }
  return freezeDeep(worklist);
}

function implementationBinding(repoRoot: string, relativePath: string) {
  const file = path.resolve(repoRoot, relativePath);
  if (!file.startsWith(`${repoRoot}${path.sep}`) || realpathSync(file) !== file) {
    throw new Error(`Salvage implementation binding is unsafe: ${relativePath}.`);
  }
  const read = readStableFile({
    file,
    maximumBytes: MAXIMUM_IMPLEMENTATION_BYTES,
    label: `Salvage implementation ${relativePath}`,
  });
  return Object.freeze({
    relativePath,
    bytes: read.bytes.byteLength,
    sha256: read.sha256,
  });
}

function increment(map: Map<string, number>, code: string): void {
  map.set(code, (map.get(code) ?? 0) + 1);
}

export function salvageLegacyLongTailSeedMemory<
  TMaster extends LegacyLongTailSeedSalvageMasterWorklist,
  TSeedMemory extends LegacyLongTailSeedSalvageSeedMemory,
>(input: Readonly<{
  repoRoot: string;
  obsoleteWorklistPath: string;
  currentPlanningMaster: TMaster;
  baseSeedMemory: TSeedMemory;
  currentValidation: LegacyLongTailSeedSalvageCurrentValidation<
    TMaster,
    TSeedMemory
  >;
  raceHook?: (point: LegacyLongTailStableReadFaultPoint) => void;
}>): LegacyLongTailSeedSalvageResult<TSeedMemory> {
  const resolved = resolveContainedTemporaryFile(
    input.repoRoot,
    input.obsoleteWorklistPath,
    "Legacy seed salvage input",
  );
  const stableInput = readStableFile({
    file: resolved.file,
    maximumBytes: MAXIMUM_LEGACY_WORKLIST_BYTES,
    label: "Legacy seed salvage input",
    raceHook: input.raceHook,
  });
  const obsolete = validateObsoleteWorklist(
    parseStrictTranslationSemanticJsonBytes(
      stableInput.bytes,
      `Legacy seed salvage input ${resolved.relativePath}`,
    ),
  );
  const master = input.currentValidation.parseMasterWorklist(
    input.currentPlanningMaster,
  );
  const baseSeed = input.currentValidation.parseSeedMemory(
    input.baseSeedMemory,
  );
  if (master.seedMemory.seedMemorySha256 !== baseSeed.seedMemorySha256) {
    throw new Error("Current planning master does not bind the supplied base seed.");
  }
  const currentPolicy = createLongTailValidatorPolicyProvenance(
    resolved.repoRoot,
  );
  assertCurrentLongTailValidatorPolicy(
    resolved.repoRoot,
    master.provenance.validatorPolicy,
  );
  if (
    currentPolicy.validatorPolicySha256 !==
      master.provenance.validatorPolicy.validatorPolicySha256
  ) {
    throw new Error("Current planning master validator policy is stale.");
  }

  type CurrentContext = Readonly<{
    namespace: string;
    sourceHash: string;
    key: string;
    source: string;
    sourceSha256: string;
  }>;
  const sourceTextBySha = new Map<string, string>();
  const contextsBySourceSha = new Map<string, CurrentContext[]>();
  const allContexts: CurrentContext[] = [];
  for (const source of master.sources) {
    if (sourceStringsSha256(source.entries) !== source.sourceHash) {
      throw new Error(`Current source hash is stale: ${source.namespace}.`);
    }
    for (const entry of source.entries) {
      const priorSource = sourceTextBySha.get(entry.sourceSha256);
      if (priorSource !== undefined && priorSource !== entry.source) {
        throw new Error("Current source catalog contains a SHA-256 collision.");
      }
      sourceTextBySha.set(entry.sourceSha256, entry.source);
      const context = Object.freeze({
        namespace: source.namespace,
        sourceHash: source.sourceHash,
        key: entry.key,
        source: entry.source,
        sourceSha256: entry.sourceSha256,
      });
      allContexts.push(context);
      const contexts = contextsBySourceSha.get(entry.sourceSha256) ?? [];
      contexts.push(context);
      contextsBySourceSha.set(entry.sourceSha256, contexts);
    }
  }
  allContexts.sort((left, right) =>
    compareCodePoints(left.sourceSha256, right.sourceSha256) ||
    compareCodePoints(left.namespace, right.namespace) ||
    compareCodePoints(left.key, right.key)
  );
  const sourceByNamespace = new Map(
    master.sources.map((source) => [source.namespace, source]),
  );
  const eligiblePairs = new Set<string>();
  const targetLanguages = new Set<string>();
  for (const job of master.jobs) {
    const source = sourceByNamespace.get(job.namespace);
    if (!source) throw new Error(`Current planning job lost ${job.namespace}.`);
    targetLanguages.add(job.language);
    for (const entry of source.entries) {
      eligiblePairs.add(`${job.locale}\u0000${entry.sourceSha256}`);
    }
  }
  if (!eligiblePairs.size || !master.jobs.length) {
    throw new Error("Current planning master has no salvage-eligible workload.");
  }

  const baseEntries = new Map(
    baseSeed.entries.map((entry) => [
      `${entry.locale}\u0000${entry.sourceSha256}`,
      entry,
    ]),
  );
  const baseConflicts = new Map(
    baseSeed.conflicts.map((conflict) => [
      `${conflict.locale}\u0000${conflict.sourceSha256}`,
      conflict,
    ]),
  );
  const addedEntries = new Map<string, z.infer<typeof seedEntrySchema>>();
  const addedConflicts = new Map<string, z.infer<typeof seedConflictSchema>>();
  const rejectionCounts = new Map<string, number>();
  const decisionRecordsDigest = new CanonicalArraySha256();
  const revalidatedEntriesDigest = new CanonicalArraySha256();
  let revalidated = 0;
  let excludedOutsideWorkload = 0;
  let eligibleRevalidated = 0;
  let overlap = 0;
  let currentSeedValueConflicts = 0;
  let currentSeedDeclaredConflictRejections = 0;
  let currentPolicyRejectedEntries = 0;
  let rejected = 0;

  for (const entry of obsolete.seedMemory.entries) {
    const identity = `${entry.locale}\u0000${entry.sourceSha256}`;
    const failures = new Set<string>();
    const currentSource = sourceTextBySha.get(entry.sourceSha256);
    if (!targetLanguages.has(entry.language)) failures.add("language-not-current");
    if (entry.locale !== expectedLocale(entry.language)) failures.add("locale-invalid");
    if (currentSource === undefined) {
      failures.add("source-not-current");
    } else if (
      currentSource !== entry.source ||
      sha256Text(currentSource) !== entry.sourceSha256
    ) {
      failures.add("source-bytes-or-hash-mismatch");
    }
    if (entry.value !== entry.value.normalize("NFC")) failures.add("value-not-nfc");
    if (
      validateTranslationCandidateField({
        language: entry.language,
        source: entry.source,
        value: entry.value,
      }).failures.length
    ) {
      failures.add("candidate-policy-failure");
    }
    if (
      !input.currentValidation.hasExactInvariantParity(
        entry.source,
        entry.value,
      )
    ) {
      failures.add("invariant-parity-failure");
    }
    const contexts = contextsBySourceSha.get(entry.sourceSha256) ?? [];
    if (currentSource !== undefined && !contexts.length) {
      throw new Error(`Current source has no occurrence contexts: ${entry.sourceSha256}.`);
    }
    for (const context of contexts) {
      if (
        !isValidFieldTranslation(
          entry.source,
          entry.value,
          entry.language,
          context.key,
        )
      ) {
        failures.add("field-policy-context-failure");
      }
      if (
        !isTranslationFieldLikelyFluent(
          entry.source,
          entry.value,
          entry.language,
          context,
        )
      ) {
        failures.add("fluency-context-failure");
      }
    }
    const sortedFailures = [...failures].sort(compareCodePoints);
    if (sortedFailures.length) {
      currentPolicyRejectedEntries += 1;
      rejected += 1;
      for (const failure of sortedFailures) increment(rejectionCounts, failure);
      decisionRecordsDigest.add(Object.freeze({
        identity,
        valueSha256: entry.valueSha256,
        disposition: "rejected-current-policy",
        failures: Object.freeze(sortedFailures),
      }));
      continue;
    }
    revalidated += 1;
    revalidatedEntriesDigest.add(entry);
    if (!eligiblePairs.has(identity)) {
      excludedOutsideWorkload += 1;
      decisionRecordsDigest.add(Object.freeze({
        identity,
        valueSha256: entry.valueSha256,
        disposition: "revalidated-not-needed-by-current-worklist",
        failures: Object.freeze([]),
      }));
      continue;
    }
    eligibleRevalidated += 1;
    if (baseConflicts.has(identity)) {
      currentSeedDeclaredConflictRejections += 1;
      increment(rejectionCounts, "current-seed-declared-conflict");
      rejected += 1;
      decisionRecordsDigest.add(Object.freeze({
        identity,
        valueSha256: entry.valueSha256,
        disposition: "rejected-current-seed-conflict",
        failures: Object.freeze(["current-seed-declared-conflict"]),
      }));
      continue;
    }
    const baseEntry = baseEntries.get(identity);
    if (baseEntry) {
      if (baseEntry.value === entry.value && baseEntry.valueSha256 === entry.valueSha256) {
        overlap += 1;
        decisionRecordsDigest.add(Object.freeze({
          identity,
          valueSha256: entry.valueSha256,
          disposition: "exact-current-seed-overlap",
          failures: Object.freeze([]),
        }));
      } else {
        currentSeedValueConflicts += 1;
        increment(rejectionCounts, "current-seed-value-conflict");
        rejected += 1;
        decisionRecordsDigest.add(Object.freeze({
          identity,
          valueSha256: entry.valueSha256,
          disposition: "rejected-current-seed-wins",
          failures: Object.freeze(["current-seed-value-conflict"]),
        }));
      }
      continue;
    }
    addedEntries.set(identity, freezeDeep({ ...entry }));
    decisionRecordsDigest.add(Object.freeze({
      identity,
      valueSha256: entry.valueSha256,
      disposition: "added-after-current-context-revalidation",
      failures: Object.freeze([]),
    }));
  }

  const conflictDecisionRecordsDigest = new CanonicalArraySha256();
  let eligibleObsoleteDeclaredConflicts = 0;
  for (const conflict of obsolete.seedMemory.conflicts) {
    const identity = `${conflict.locale}\u0000${conflict.sourceSha256}`;
    if (!eligiblePairs.has(identity)) {
      conflictDecisionRecordsDigest.add(Object.freeze({
        identity,
        disposition: "obsolete-conflict-outside-current-workload",
      }));
      continue;
    }
    eligibleObsoleteDeclaredConflicts += 1;
    if (baseEntries.has(identity)) {
      conflictDecisionRecordsDigest.add(Object.freeze({
        identity,
        disposition: "current-seed-entry-wins-over-obsolete-conflict",
      }));
      continue;
    }
    if (!baseConflicts.has(identity)) {
      addedConflicts.set(identity, freezeDeep({ ...conflict }));
    }
    conflictDecisionRecordsDigest.add(Object.freeze({
      identity,
      disposition: baseConflicts.has(identity)
        ? "exact-current-conflict-overlap"
        : "added-obsolete-declared-conflict",
    }));
  }

  const resultEntries = [...baseSeed.entries, ...addedEntries.values()].sort(
    (left, right) =>
      compareCodePoints(left.locale, right.locale) ||
      compareCodePoints(left.sourceSha256, right.sourceSha256),
  );
  const resultConflicts = [...baseSeed.conflicts, ...addedConflicts.values()].sort(
    (left, right) =>
      compareCodePoints(left.locale, right.locale) ||
      compareCodePoints(left.sourceSha256, right.sourceSha256),
  );
  const resultMaterial = {
    schemaVersion: 1 as const,
    kind: SEED_MEMORY_KIND,
    entries: resultEntries,
    conflicts: resultConflicts,
  };
  const resultSeedMemory = input.currentValidation.parseSeedMemory({
    ...resultMaterial,
    seedMemorySha256: sha256Canonical(resultMaterial),
  });
  const sortedAddedEntries = [...addedEntries.values()].sort((left, right) =>
    compareCodePoints(left.locale, right.locale) ||
    compareCodePoints(left.sourceSha256, right.sourceSha256)
  );
  const rejectionCountsObject = Object.fromEntries(
    [...rejectionCounts].sort(([left], [right]) => compareCodePoints(left, right)),
  );
  const implementations = [
    implementationBinding(
      resolved.repoRoot,
      "scripts/generate-long-tail-translations.ts",
    ),
    implementationBinding(
      resolved.repoRoot,
      "scripts/legacy-long-tail-seed-salvage.ts",
    ),
    implementationBinding(
      resolved.repoRoot,
      "scripts/verify-translation-semantic-audit.ts",
    ),
  ] as const;
  if (
    implementations[0].sha256 !==
      master.provenance.pipelineImplementationSha256
  ) {
    throw new Error(
      "Current planning master does not bind the executing pipeline implementation.",
    );
  }
  if (
    revalidated + currentPolicyRejectedEntries !==
      obsolete.seedMemory.entries.length ||
    eligibleRevalidated !==
      addedEntries.size + overlap + currentSeedValueConflicts +
        currentSeedDeclaredConflictRejections ||
    rejected !==
      currentPolicyRejectedEntries + currentSeedValueConflicts +
        currentSeedDeclaredConflictRejections ||
    resultSeedMemory.entries.length !==
      baseSeed.entries.length + addedEntries.size ||
    resultSeedMemory.conflicts.length !==
      baseSeed.conflicts.length + addedConflicts.size
  ) {
    throw new Error("Legacy seed salvage decision accounting is inconsistent.");
  }
  const validatorPolicyFilesSha256 = sha256Canonical(currentPolicy.files);
  const eligiblePairList = [...eligiblePairs].sort(compareCodePoints);
  const declaredWorklistSha256 = obsolete.worklistSha256;
  const evidenceMaterial = parseSchema(salvageEvidenceMaterialSchema, {
    schemaVersion: 1,
    kind: LEGACY_LONG_TAIL_SEED_SALVAGE_KIND,
    authority: LEGACY_LONG_TAIL_SEED_SALVAGE_POLICY,
    input: {
      relativePath: resolved.relativePath,
      bytes: stableInput.bytes.byteLength,
      fileSha256: stableInput.sha256,
      declaredWorklistSha256,
      declaredSeedMemorySha256: obsolete.seedMemory.seedMemorySha256,
      declaredProvenanceSha256: sha256Canonical(obsolete.provenance),
      entries: obsolete.seedMemory.entries.length,
      conflicts: obsolete.seedMemory.conflicts.length,
    },
    current: {
      repoRootRealpathSha256: sha256Text(resolved.repoRoot),
      planningMasterWorklistSha256: master.worklistSha256,
      sourceCatalogSha256: sha256Canonical(master.sources),
      occurrenceContextSha256: sha256Canonical(allContexts),
      eligiblePairSha256: sha256Canonical(eligiblePairList),
      sourceNamespaces: master.sources.length,
      sourceOccurrences: allContexts.length,
      distinctSourceTexts: sourceTextBySha.size,
      targetJobs: master.jobs.length,
      targetLanguages: targetLanguages.size,
      eligiblePairs: eligiblePairs.size,
      validatorPolicySha256: currentPolicy.validatorPolicySha256,
      validatorPolicyFilesSha256,
      baseSeedMemorySha256: baseSeed.seedMemorySha256,
      baseSeedEntries: baseSeed.entries.length,
      baseSeedConflicts: baseSeed.conflicts.length,
      implementations,
    },
    decisions: {
      examinedEntries: obsolete.seedMemory.entries.length,
      revalidatedAgainstAllCurrentContexts: revalidated,
      excludedOutsideCurrentWorkload: excludedOutsideWorkload,
      eligibleRevalidatedEntries: eligibleRevalidated,
      overlapWithCurrentSeed: overlap,
      addedEntries: addedEntries.size,
      currentSeedValueConflicts,
      currentSeedDeclaredConflictRejections,
      currentPolicyRejectedEntries,
      rejectedEntries: rejected,
      obsoleteDeclaredConflicts: obsolete.seedMemory.conflicts.length,
      eligibleObsoleteDeclaredConflicts,
      addedConflictRecords: addedConflicts.size,
      rejectionCounts: rejectionCountsObject,
      decisionRecordsSha256: decisionRecordsDigest.finalize(),
      revalidatedEntriesSha256: revalidatedEntriesDigest.finalize(),
      addedEntriesSha256: sha256Canonical(sortedAddedEntries),
      conflictRecordsSha256: conflictDecisionRecordsDigest.finalize(),
    },
    result: {
      seedMemorySha256: resultSeedMemory.seedMemorySha256,
      entries: resultSeedMemory.entries.length,
      conflicts: resultSeedMemory.conflicts.length,
      pipelineProvenanceMustBindExactSeedMemory: true,
    },
  }, "Legacy seed salvage evidence");
  const evidence = freezeDeep(parseSchema(salvageEvidenceSchema, {
    ...evidenceMaterial,
    evidenceSha256: sha256Canonical(evidenceMaterial),
  }, "Legacy seed salvage evidence"));
  return Object.freeze({ seedMemory: resultSeedMemory, evidence });
}

export function parseLegacyLongTailSeedSalvageEvidence(
  value: unknown,
): LegacyLongTailSeedSalvageEvidence {
  const evidence = parseSchema(
    salvageEvidenceSchema,
    value,
    "Legacy seed salvage evidence",
  );
  const { evidenceSha256, ...material } = evidence;
  if (sha256Canonical(material) !== evidenceSha256) {
    throw new Error("Legacy seed salvage evidence hash is stale or tampered.");
  }
  if (canonicalJson(evidence.authority) !== canonicalJson(LEGACY_LONG_TAIL_SEED_SALVAGE_POLICY)) {
    throw new Error("Legacy seed salvage evidence authority policy drifted.");
  }
  return freezeDeep(evidence);
}

function acceptanceBindingsFromEvidence(
  untrustedEvidence: unknown,
): z.infer<typeof acceptanceBindingsSchema> {
  const evidence = parseLegacyLongTailSeedSalvageEvidence(untrustedEvidence);
  return freezeDeep(parseSchema(acceptanceBindingsSchema, {
    input: {
      relativePath: evidence.input.relativePath,
      bytes: evidence.input.bytes,
      fileSha256: evidence.input.fileSha256,
      declaredWorklistSha256: evidence.input.declaredWorklistSha256,
      declaredSeedMemorySha256: evidence.input.declaredSeedMemorySha256,
      declaredProvenanceSha256: evidence.input.declaredProvenanceSha256,
    },
    diagnostic: {
      kind: evidence.kind,
      evidenceSha256: evidence.evidenceSha256,
    },
    result: {
      seedMemorySha256: evidence.result.seedMemorySha256,
      entries: evidence.result.entries,
      conflicts: evidence.result.conflicts,
    },
    current: {
      repoRootRealpathSha256: evidence.current.repoRootRealpathSha256,
      planningMasterWorklistSha256:
        evidence.current.planningMasterWorklistSha256,
      sourceCatalogSha256: evidence.current.sourceCatalogSha256,
      occurrenceContextSha256: evidence.current.occurrenceContextSha256,
      eligiblePairSha256: evidence.current.eligiblePairSha256,
      validatorPolicySha256: evidence.current.validatorPolicySha256,
      validatorPolicyFilesSha256:
        evidence.current.validatorPolicyFilesSha256,
      baseSeedMemorySha256: evidence.current.baseSeedMemorySha256,
      implementations: evidence.current.implementations,
    },
  }, "Legacy seed salvage acceptance bindings"));
}

function canonicalUtcTimestamp(value: string, label: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${label} must be canonical UTC with millisecond precision.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} is not a real canonical UTC timestamp.`);
  }
  return milliseconds;
}

function assertAcceptanceTimeWindow(input: Readonly<{
  acceptedAt: string;
  expiresAt: string;
  now: Date;
}>): void {
  const acceptedAt = canonicalUtcTimestamp(input.acceptedAt, "acceptedAt");
  const expiresAt = canonicalUtcTimestamp(input.expiresAt, "expiresAt");
  const now = input.now.getTime();
  if (!Number.isFinite(now)) {
    throw new Error("Acceptance validation time is invalid.");
  }
  if (expiresAt <= acceptedAt) {
    throw new Error("Legacy seed salvage acceptance must expire after acceptance.");
  }
  if (expiresAt - acceptedAt > MAXIMUM_ACCEPTANCE_LIFETIME_MS) {
    throw new Error("Legacy seed salvage acceptance lifetime exceeds 31 days.");
  }
  if (acceptedAt > now) {
    throw new Error("Legacy seed salvage acceptance is future-dated.");
  }
  if (expiresAt <= now) {
    throw new Error("Legacy seed salvage acceptance has expired.");
  }
}

export function parseLegacyLongTailSeedSalvageAcceptance(
  value: unknown,
  now: Date = new Date(),
): LegacyLongTailSeedSalvageAcceptance {
  const acceptance = parseSchema(
    acceptanceSchema,
    value,
    "Legacy seed salvage acceptance",
  );
  const { acceptanceSha256, ...material } = acceptance;
  if (sha256Canonical(material) !== acceptanceSha256) {
    throw new Error("Legacy seed salvage acceptance hash is stale or tampered.");
  }
  if (
    canonicalJson(acceptance.authority) !==
      canonicalJson(LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_POLICY)
  ) {
    throw new Error("Legacy seed salvage acceptance authority policy drifted.");
  }
  assertAcceptanceTimeWindow({
    acceptedAt: acceptance.acceptedAt,
    expiresAt: acceptance.expiresAt,
    now,
  });
  return freezeDeep(acceptance);
}

export function createLegacyLongTailSeedSalvageAcceptance(input: Readonly<{
  evidence: LegacyLongTailSeedSalvageEvidence;
  acceptanceStatement: typeof LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_STATEMENT;
  acceptedAt: string;
  expiresAt: string;
  now?: Date;
}>): LegacyLongTailSeedSalvageAcceptance {
  const material = parseSchema(acceptanceMaterialSchema, {
    schemaVersion: 1,
    kind: LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_KIND,
    authority: LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_POLICY,
    acceptanceStatement: input.acceptanceStatement,
    acceptedAt: input.acceptedAt,
    expiresAt: input.expiresAt,
    bindings: acceptanceBindingsFromEvidence(input.evidence),
  }, "Legacy seed salvage acceptance");
  return parseLegacyLongTailSeedSalvageAcceptance({
    ...material,
    acceptanceSha256: sha256Canonical(material),
  }, input.now);
}

function createFreshPrivateAcceptanceDirectory(input: Readonly<{
  repoRoot: string;
  outputDirectoryPath: string;
}>): Readonly<{ directory: string; relativePath: string }> {
  const requestedRepoRoot = path.resolve(input.repoRoot);
  const repoRoot = realpathSync(requestedRepoRoot);
  if (requestedRepoRoot !== repoRoot) {
    throw new Error("The repository root must be its exact real path.");
  }
  const temporaryRoot = path.join(repoRoot, "tmp");
  if (realpathSync(temporaryRoot) !== temporaryRoot) {
    throw new Error("The repository tmp directory must resolve without symlinks.");
  }
  assertNoSymlinkComponents(temporaryRoot, "Repository tmp directory");
  const directory = path.resolve(repoRoot, input.outputDirectoryPath);
  if (
    path.dirname(directory) !== temporaryRoot ||
    !isSafeRelativePath(path.relative(repoRoot, directory).split(path.sep).join("/"))
  ) {
    throw new Error(
      "Legacy seed salvage acceptance output must be one fresh direct child of repository tmp/.",
    );
  }
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch {
    throw new Error(
      "Legacy seed salvage acceptance output directory must not already exist.",
    );
  }
  const metadata = lstatSync(directory, { bigint: true });
  assertNoSymlinkComponents(directory, "Legacy seed salvage acceptance output");
  if (realpathSync(directory) !== directory) {
    throw new Error(
      "Legacy seed salvage acceptance output must resolve without symlinks.",
    );
  }
  assertOwnerPrivateDirectory(
    metadata,
    "Legacy seed salvage acceptance output",
  );
  return Object.freeze({
    directory,
    relativePath: path.relative(repoRoot, directory).split(path.sep).join("/"),
  });
}

function publishExclusivePrivateJson(input: Readonly<{
  file: string;
  label: string;
  value: unknown;
}>): Readonly<{ bytes: number; fileSha256: string }> {
  const bytes = Buffer.from(`${JSON.stringify(input.value, null, 2)}\n`, "utf8");
  if (!bytes.byteLength || bytes.byteLength > MAXIMUM_ACCEPTANCE_BYTES) {
    throw new Error(`${input.label} exceeds its private publication bound.`);
  }
  const descriptor = openSync(
    input.file,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    fchmodSync(descriptor, 0o600);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = writeSync(
        descriptor,
        bytes,
        offset,
        bytes.byteLength - offset,
      );
      if (written <= 0) {
        throw new Error(`${input.label} publication did not make progress.`);
      }
      offset += written;
    }
    fsyncSync(descriptor);
    const descriptorMetadata = fstatSync(descriptor, { bigint: true });
    const pathMetadata = lstatSync(input.file, { bigint: true });
    if (
      !sameFileIdentity(descriptorMetadata, pathMetadata) ||
      descriptorMetadata.size !== BigInt(bytes.byteLength)
    ) {
      throw new Error(`${input.label} changed while it was published.`);
    }
    assertOwnerPrivateFile(descriptorMetadata, input.label);
  } finally {
    closeSync(descriptor);
  }
  return Object.freeze({
    bytes: bytes.byteLength,
    fileSha256: sha256Bytes(bytes),
  });
}

export function publishLegacyLongTailSeedSalvageAcceptance(input: Readonly<{
  repoRoot: string;
  outputDirectoryPath: string;
  evidence: LegacyLongTailSeedSalvageEvidence;
  acceptance: LegacyLongTailSeedSalvageAcceptance;
  now?: Date;
}>): Readonly<{
  directory: string;
  relativeDirectory: string;
  evidencePath: string;
  evidenceFileSha256: string;
  acceptancePath: string;
  acceptanceFileSha256: string;
}> {
  const evidence = parseLegacyLongTailSeedSalvageEvidence(input.evidence);
  const acceptance = parseLegacyLongTailSeedSalvageAcceptance(
    input.acceptance,
    input.now,
  );
  const expectedBindings = acceptanceBindingsFromEvidence(evidence);
  if (canonicalJson(acceptance.bindings) !== canonicalJson(expectedBindings)) {
    throw new Error(
      "Legacy seed salvage acceptance does not bind the supplied diagnostic evidence.",
    );
  }
  const output = createFreshPrivateAcceptanceDirectory(input);
  const evidencePath = path.join(
    output.directory,
    LEGACY_LONG_TAIL_SEED_SALVAGE_EVIDENCE_BASENAME,
  );
  const acceptancePath = path.join(
    output.directory,
    LEGACY_LONG_TAIL_SEED_SALVAGE_ACCEPTANCE_BASENAME,
  );
  const publishedEvidence = publishExclusivePrivateJson({
    file: evidencePath,
    label: "Legacy seed salvage evidence",
    value: evidence,
  });
  const publishedAcceptance = publishExclusivePrivateJson({
    file: acceptancePath,
    label: "Legacy seed salvage acceptance",
    value: acceptance,
  });
  const directoryDescriptor = openSync(output.directory, fsConstants.O_RDONLY);
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
  assertOwnerPrivateDirectory(
    lstatSync(output.directory, { bigint: true }),
    "Legacy seed salvage acceptance output",
  );
  return Object.freeze({
    directory: output.directory,
    relativeDirectory: output.relativePath,
    evidencePath,
    evidenceFileSha256: publishedEvidence.fileSha256,
    acceptancePath,
    acceptanceFileSha256: publishedAcceptance.fileSha256,
  });
}

export function verifyAcceptedLegacyLongTailSeedSalvage<
  TMaster extends LegacyLongTailSeedSalvageMasterWorklist,
  TSeedMemory extends LegacyLongTailSeedSalvageSeedMemory,
>(input: Readonly<{
  repoRoot: string;
  obsoleteWorklistPath: string;
  acceptancePath: string;
  currentPlanningMaster: TMaster;
  baseSeedMemory: TSeedMemory;
  currentValidation: LegacyLongTailSeedSalvageCurrentValidation<
    TMaster,
    TSeedMemory
  >;
  now?: Date;
  obsoleteInputRaceHook?: (point: LegacyLongTailStableReadFaultPoint) => void;
  acceptanceRaceHook?: (point: LegacyLongTailStableReadFaultPoint) => void;
}>): AcceptedLegacyLongTailSeedSalvageResult<TSeedMemory> {
  const resolvedAcceptance = resolveContainedTemporaryFile(
    input.repoRoot,
    input.acceptancePath,
    "Legacy seed salvage acceptance",
  );
  assertOwnerPrivateDirectory(
    lstatSync(path.dirname(resolvedAcceptance.file), { bigint: true }),
    "Legacy seed salvage acceptance directory",
  );
  const stableAcceptance = readStableFile({
    file: resolvedAcceptance.file,
    maximumBytes: MAXIMUM_ACCEPTANCE_BYTES,
    label: "Legacy seed salvage acceptance",
    ownerPrivate: true,
    raceHook: input.acceptanceRaceHook,
  });
  const acceptance = parseLegacyLongTailSeedSalvageAcceptance(
    parseStrictTranslationSemanticJsonBytes(
      stableAcceptance.bytes,
      `Legacy seed salvage acceptance ${resolvedAcceptance.relativePath}`,
    ),
    input.now,
  );
  const recomputed = salvageLegacyLongTailSeedMemory({
    repoRoot: input.repoRoot,
    obsoleteWorklistPath: input.obsoleteWorklistPath,
    currentPlanningMaster: input.currentPlanningMaster,
    baseSeedMemory: input.baseSeedMemory,
    currentValidation: input.currentValidation,
    raceHook: input.obsoleteInputRaceHook,
  });
  const expectedBindings = acceptanceBindingsFromEvidence(recomputed.evidence);
  if (canonicalJson(acceptance.bindings) !== canonicalJson(expectedBindings)) {
    throw new Error(
      "Legacy seed salvage acceptance does not bind the exact current recomputation.",
    );
  }
  parseLegacyLongTailSeedSalvageAcceptance(
    acceptance,
    input.now ?? new Date(),
  );
  return Object.freeze({
    seedMemory: recomputed.seedMemory,
    evidence: recomputed.evidence,
    acceptance,
  });
}
