import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type BigIntStats,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  calculateTranslationSemanticSiteSourceCatalogEvidence,
  calculateTranslationSemanticAuditTreeEvidence,
  AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  isTranslationSemanticMainAppWorkbenchPath,
  parseStrictTranslationSemanticJsonBytes,
  TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT,
  TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES,
  TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND,
  translationSemanticAuditTreeDigestSchema,
  translationSemanticPromotionEvidenceUnionSchema,
  verifyAfrikaansTranslationSemanticAuditManifest,
  type AfrikaansTranslationSemanticPromotionEvidence,
  type TranslationSemanticPromotionEvidenceUnion,
  type VerifiedAfrikaansTranslationSemanticAudit,
} from "./verify-translation-semantic-audit";
import {
  LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
} from "./long-tail-nllb-execution-profile";

export const LONG_TAIL_PROMOTION_PREPARED_KIND =
  "inspir-long-tail-promotion-prepared-v2" as const;
export const LONG_TAIL_PROMOTION_COMMITTED_KIND =
  "inspir-long-tail-promotion-committed-v2" as const;
export const LONG_TAIL_PROMOTION_TRANSACTION_ROOT_RELATIVE_PATH =
  "tmp/long-tail-promotion-snapshots" as const;
export const LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND =
  "inspir-long-tail-source-stale-replacement-approval-v1" as const;
export const LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND =
  "inspir-long-tail-quality-stale-replacement-approval-v1" as const;

const MAXIMUM_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAXIMUM_WORKBENCH_FILES = 1_000;
const MAXIMUM_WORKBENCH_BYTES = 512 * 1024 * 1024;
const MAXIMUM_RETAINED_TRANSACTIONS = 32;
const MAXIMUM_TRANSACTION_DIRECTORY_ENTRIES = 128;
const LONG_TAIL_PROMOTION_TRANSACTION_IDENTITY_KIND =
  "inspir-long-tail-promotion-transaction-identity-v2" as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const relativePathSchema = z.string().min(1).max(4_096).superRefine(
  (value, context) => {
    if (!isSafeRelativePath(value)) {
      context.addIssue({
        code: "custom",
        message: "Path must be normalized, relative POSIX syntax.",
      });
    }
  },
);

const sourceStaleReplacementInputSchema = z.object({
  kind: z.literal(LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND),
  approvedExistingSha256: sha256Schema,
  priorSourceHash: sha256Schema,
  newSourceHash: sha256Schema,
  backupRelativePath: relativePathSchema,
}).strict().refine(
  (value) => value.priorSourceHash !== value.newSourceHash,
  "Approved replacement must bind different source hashes.",
);
const qualityStaleReplacementInputSchema = z.object({
  kind: z.literal(LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND),
  approvedExistingSha256: sha256Schema,
  priorSourceHash: sha256Schema,
  newSourceHash: sha256Schema,
  validatorPolicySha256: sha256Schema,
  backupRelativePath: relativePathSchema,
}).strict().refine(
  (value) => value.priorSourceHash === value.newSourceHash,
  "Quality-stale replacement must remain bound to the same source hash.",
);
const replacementInputSchema = z.union([
  sourceStaleReplacementInputSchema,
  qualityStaleReplacementInputSchema,
]);

const artifactMetadataSchema = z.object({
  targetRelativePath: relativePathSchema,
  checkpointRelativePath: relativePathSchema,
  replacement: replacementInputSchema.optional(),
}).strict();

const publicationSchema = z.enum(["created", "exact-replay", "replaced"]);
const priorTargetSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing") }).strict(),
  z.object({ state: z.literal("exact"), sha256: sha256Schema }).strict(),
]);
const presentTreeDigestSchema = translationSemanticAuditTreeDigestSchema.extend({
  exists: z.literal(true),
}).strict();
const absentTreeDigestSchema = translationSemanticAuditTreeDigestSchema.extend({
  exists: z.literal(false),
  files: z.literal(0),
  bytes: z.literal(0),
}).strict();
const priorTreeSchema = z.union([
  presentTreeDigestSchema,
  absentTreeDigestSchema,
]);
const preparedSourceStaleReplacementSchema = z.object({
  kind: z.literal(LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND),
  approvedExistingSha256: sha256Schema,
  priorSourceHash: sha256Schema,
  newSourceHash: sha256Schema,
  approvalSha256: sha256Schema,
  backupRelativePath: relativePathSchema,
  backupSha256: sha256Schema,
}).strict();
const preparedQualityStaleReplacementSchema = z.object({
  kind: z.literal(LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND),
  approvedExistingSha256: sha256Schema,
  priorSourceHash: sha256Schema,
  newSourceHash: sha256Schema,
  validatorPolicySha256: sha256Schema,
  approvalSha256: sha256Schema,
  backupRelativePath: relativePathSchema,
  backupSha256: sha256Schema,
}).strict();
const preparedReplacementSchema = z.union([
  preparedSourceStaleReplacementSchema,
  preparedQualityStaleReplacementSchema,
]);
const preparedEntrySchema = z.object({
  targetRelativePath: relativePathSchema,
  targetSha256: sha256Schema,
  targetBytes: z.number().int().min(1).max(MAXIMUM_ARTIFACT_BYTES),
  checkpointRelativePath: relativePathSchema,
  checkpointSha256: sha256Schema,
  checkpointBytes: z.number().int().min(1).max(MAXIMUM_ARTIFACT_BYTES),
  publication: publicationSchema,
  prior: priorTargetSchema,
  replacement: preparedReplacementSchema.optional(),
}).strict();
const preparedMaterialSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal(LONG_TAIL_PROMOTION_PREPARED_KIND),
  transactionId: sha256Schema,
  masterWorklistSha256: sha256Schema,
  semanticEvidence: translationSemanticPromotionEvidenceUnionSchema.optional(),
  artifactSetSha256: sha256Schema,
  priorSiteTree: priorTreeSchema,
  nextSiteTree: presentTreeDigestSchema,
  staticMainAppTree: presentTreeDigestSchema.optional(),
  entries: z.array(preparedEntrySchema).min(1).max(100_000),
}).strict();
const preparedSchema = preparedMaterialSchema.extend({
  preparedSha256: sha256Schema,
}).strict();
const committedMaterialSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal(LONG_TAIL_PROMOTION_COMMITTED_KIND),
  transactionId: sha256Schema,
  masterWorklistSha256: sha256Schema,
  preparedSha256: sha256Schema,
  activeSiteTree: presentTreeDigestSchema,
  staticMainAppTree: presentTreeDigestSchema.optional(),
}).strict();
const committedSchema = committedMaterialSchema.extend({
  committedSha256: sha256Schema,
}).strict();
export const LONG_TAIL_PROMOTION_JOURNAL_BINDING_KIND =
  "inspir-long-tail-promotion-journal-binding-v1" as const;
const journalPublicationCountsSchema = z.object({
  created: z.number().int().nonnegative().max(100_000),
  replayed: z.number().int().nonnegative().max(100_000),
  replaced: z.number().int().nonnegative().max(100_000),
}).strict();
const journalBindingMaterialSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal(LONG_TAIL_PROMOTION_JOURNAL_BINDING_KIND),
  transactionId: sha256Schema,
  masterWorklistSha256: sha256Schema,
  semanticEvidenceKind: z.union([
    z.literal(TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND),
    z.literal(AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND),
  ]),
  semanticEvidenceSha256: sha256Schema,
  generatorExecutionProfileSha256: z.literal(
    LONG_TAIL_NLLB_EXECUTION_PROFILE_SHA256,
  ),
  preparedSha256: sha256Schema,
  committedSha256: sha256Schema,
  artifactSetSha256: sha256Schema,
  entriesRootSha256: sha256Schema,
  artifacts: z.number().int().positive().max(100_000),
  publications: journalPublicationCountsSchema,
  priorSiteTree: priorTreeSchema,
  postSiteTree: presentTreeDigestSchema,
  staticMainAppTree: presentTreeDigestSchema,
  retainedPrior: z.boolean(),
}).strict();
export const longTailPromotionJournalBindingSchema =
  journalBindingMaterialSchema.extend({
    bindingSha256: sha256Schema,
  }).strict();
export type LongTailPromotionJournalBinding = z.infer<
  typeof longTailPromotionJournalBindingSchema
>;
export const longTailPromotionSnapshotFaultPoints = Object.freeze([
  "after-checkpoints-and-backups-fsync",
  "after-artifacts-before-next-validation",
  "after-next-tree-fsync",
  "before-prepared-rename",
  "after-prepared-rename-before-parent-fsync",
  "after-prepared-parent-fsync",
  "before-active-to-old-rename",
  "after-active-to-old-rename-before-parent-fsync",
  "after-active-to-old-parent-fsync",
  "after-workbench-source-to-carrier-rename",
  "after-workbench-carrier-link-before-unlink",
  "before-next-to-active-rename",
  "after-next-to-active-rename-before-parent-fsync",
  "after-next-to-active-parent-fsync",
  "before-committed-rename",
  "after-committed-rename-before-parent-fsync",
  "after-committed-parent-fsync",
] as const);

export const longTailPromotionSnapshotFinalizeFaultPoints = Object.freeze([
  "before-finalize-next-remove",
  "after-finalize-next-remove-before-parent-fsync",
  "after-finalize-next-parent-fsync",
  "before-finalize-prior-retain",
  "after-finalize-prior-retain-before-parent-fsync",
  "after-finalize-prior-retain-parent-fsync",
] as const);

export type LongTailPromotionSnapshotFaultPoint =
  (typeof longTailPromotionSnapshotFaultPoints)[number];

export type LongTailPromotionSnapshotCrashHook = (
  point: LongTailPromotionSnapshotFaultPoint,
) => void;

export type LongTailPromotionSnapshotFinalizeFaultPoint =
  (typeof longTailPromotionSnapshotFinalizeFaultPoints)[number];

export type LongTailPromotionSnapshotFinalizeCrashHook = (
  point: LongTailPromotionSnapshotFinalizeFaultPoint,
) => void;

export type LongTailPromotionSourceStaleReplacementArtifact = Readonly<{
  kind: typeof LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND;
  approvedExistingSha256: string;
  priorSourceHash: string;
  newSourceHash: string;
  backupRelativePath: string;
}>;
export type LongTailPromotionQualityStaleReplacementArtifact = Readonly<{
  kind: typeof LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND;
  approvedExistingSha256: string;
  priorSourceHash: string;
  newSourceHash: string;
  validatorPolicySha256: string;
  backupRelativePath: string;
}>;
export type LongTailPromotionReplacementArtifact =
  | LongTailPromotionSourceStaleReplacementArtifact
  | LongTailPromotionQualityStaleReplacementArtifact;

export type LongTailPromotionSnapshotArtifact = Readonly<{
  targetRelativePath: string;
  targetBytes: Uint8Array;
  checkpointRelativePath: string;
  checkpointBytes: Uint8Array;
  replacement?: LongTailPromotionReplacementArtifact;
}>;

export type LongTailPromotionSnapshotInput = Readonly<{
  curatedRoot: string;
  transactionRoot: string;
  masterWorklistSha256: string;
  semanticEvidence?: TranslationSemanticPromotionEvidenceUnion;
  artifacts: readonly LongTailPromotionSnapshotArtifact[];
  crashHook?: LongTailPromotionSnapshotCrashHook;
}>;

export type LongTailPromotionSnapshotRecoveryInput = Readonly<{
  curatedRoot: string;
  transactionRoot: string;
  transactionId: string;
  crashHook?: LongTailPromotionSnapshotCrashHook;
}>;

export type LongTailPromotionSnapshotArtifactRecoveryInput = Readonly<{
  curatedRoot: string;
  transactionRoot: string;
  masterWorklistSha256: string;
  expectedSemanticEvidenceKind:
    TranslationSemanticPromotionEvidenceUnion["kind"];
  artifacts: readonly LongTailPromotionSnapshotArtifact[];
  crashHook?: LongTailPromotionSnapshotCrashHook;
}>;

export type LongTailPromotionSnapshotFinalizeInput = Readonly<{
  curatedRoot: string;
  transactionRoot: string;
  transactionId: string;
  crashHook?: LongTailPromotionSnapshotFinalizeCrashHook;
}>;

export type LongTailPromotionSnapshotFinalizeResult = Readonly<{
  transactionId: string;
  outcome: "finalized" | "exact-replay";
  activeTreeSha256: string;
  removedNextRoot: boolean;
  movedPriorRoot: boolean;
  retainedPriorRoot: string | null;
}>;

export type LongTailPromotionSnapshotSettlementInput = Readonly<{
  transactionRoot: string;
}>;

export type LongTailPromotionSnapshotResult = Readonly<{
  transactionId: string;
  outcome: "committed" | "exact-replay";
  activeTreeSha256: string;
  activeRoot: string;
  priorRoot: string | null;
  semanticEvidence?: TranslationSemanticPromotionEvidenceUnion;
  publications: Readonly<{
    created: number;
    replayed: number;
    replaced: number;
  }>;
  checkpoints: readonly Readonly<{
    relativePath: string;
    sha256: string;
    bytes: Uint8Array;
  }>[];
  backups: readonly Readonly<{
    targetRelativePath: string;
    relativePath: string;
    sha256: string;
    kind:
      | typeof LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND
      | typeof LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND;
    approvedExistingSha256: string;
    priorSourceHash: string;
    newSourceHash: string;
    approvalSha256: string;
    validatorPolicySha256?: string;
    bytes: Uint8Array;
  }>[];
}>;

type PreparedPromotion = z.infer<typeof preparedSchema>;
type PreparedPromotionEntry = z.infer<typeof preparedEntrySchema>;
type TreeInspection = Readonly<{
  treeSha256: string;
  fileCount: number;
  bytes: number;
  files: ReadonlyMap<string, Readonly<{ sha256: string; bytes: number }>>;
}>;
type WorkbenchInspection = ReadonlyMap<string, Readonly<{
  dev: bigint;
  ino: bigint;
  bytes: number;
  links: number;
}>>;
type VerifiedPromotionEvidence = Readonly<{
  checkpoints: readonly Readonly<{
    relativePath: string;
    sha256: string;
    bytes: Buffer;
  }>[];
  backups: readonly Readonly<{
    targetRelativePath: string;
    relativePath: string;
    sha256: string;
    kind:
      | typeof LONG_TAIL_SOURCE_STALE_REPLACEMENT_APPROVAL_KIND
      | typeof LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND;
    approvedExistingSha256: string;
    priorSourceHash: string;
    newSourceHash: string;
    approvalSha256: string;
    validatorPolicySha256?: string;
    bytes: Buffer;
  }>[];
}>;
type SnapshotPaths = Readonly<{
  curatedRoot: string;
  curatedParent: string;
  nextRoot: string;
  oldRoot: string;
  transactionRoot: string;
  transactionDirectory: string;
  preparedPath: string;
  committedPath: string;
  retainedPriorRoot: string;
  workbenchCarrierRoot: string;
  checkpointRoot: string;
  backupRoot: string;
}>;

export class LongTailPromotionSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LongTailPromotionSnapshotError";
  }
}

export function calculateLongTailPromotionSnapshotTransactionId(input: {
  masterWorklistSha256: string;
  artifacts: readonly LongTailPromotionSnapshotArtifact[];
  semanticEvidence?: TranslationSemanticPromotionEvidenceUnion;
}) {
  const masterWorklistSha256 = sha256Schema.parse(input.masterWorklistSha256);
  const artifacts = normalizeArtifacts(input.artifacts);
  const semanticEvidence = input.semanticEvidence
    ? parseSemanticEvidence(input.semanticEvidence)
    : null;
  return sha256Canonical({
    kind: LONG_TAIL_PROMOTION_TRANSACTION_IDENTITY_KIND,
    masterWorklistSha256,
    ...(semanticEvidence ? { semanticEvidence } : {}),
    artifacts: artifacts.map((artifact) => artifact.material),
  });
}

export function promoteLongTailPromotionSnapshot(
  input: LongTailPromotionSnapshotInput,
): LongTailPromotionSnapshotResult {
  const masterWorklistSha256 = sha256Schema.parse(input.masterWorklistSha256);
  const artifacts = normalizeArtifacts(input.artifacts);
  const semanticEvidence = input.semanticEvidence
    ? parseSemanticEvidence(input.semanticEvidence)
    : null;
  const transactionId = sha256Canonical({
    kind: LONG_TAIL_PROMOTION_TRANSACTION_IDENTITY_KIND,
    masterWorklistSha256,
    ...(semanticEvidence ? { semanticEvidence } : {}),
    artifacts: artifacts.map((artifact) => artifact.material),
  });
  const paths = snapshotPaths({
    curatedRoot: input.curatedRoot,
    transactionRoot: input.transactionRoot,
    transactionId,
  });

  return withPromotionLock(paths, transactionId, () => {
    if (pathKind(paths.preparedPath) === "file") {
      const prepared = readPrepared(paths.preparedPath);
      if (
        prepared.transactionId !== transactionId ||
        prepared.masterWorklistSha256 !== masterWorklistSha256 ||
        (semanticEvidence?.semanticEvidenceSha256 ?? null) !==
          (prepared.semanticEvidence?.semanticEvidenceSha256 ?? null) ||
        prepared.artifactSetSha256 !== sha256Canonical(
          artifacts.map((artifact) => artifact.material),
        )
      ) {
        throw new LongTailPromotionSnapshotError(
          "Prepared promotion journal does not match the requested artifacts.",
        );
      }
      return recoverPreparedPromotion(paths, prepared, input.crashHook);
    }

    resetUnpreparedTransaction(paths);
    const prepared = preparePromotionSnapshot(
      paths,
      masterWorklistSha256,
      artifacts,
      semanticEvidence ?? undefined,
      input.crashHook,
    );
    return recoverPreparedPromotion(paths, prepared, input.crashHook);
  });
}

export function recoverLongTailPromotionSnapshot(
  input: LongTailPromotionSnapshotRecoveryInput,
): LongTailPromotionSnapshotResult {
  const transactionId = sha256Schema.parse(input.transactionId);
  const paths = snapshotPaths({
    curatedRoot: input.curatedRoot,
    transactionRoot: input.transactionRoot,
    transactionId,
  });
  return withPromotionLock(paths, transactionId, () => {
    if (pathKind(paths.preparedPath) !== "file") {
      throw new LongTailPromotionSnapshotError(
        "Promotion has no durable PREPARED journal and did not mutate the active corpus.",
      );
    }
    return recoverPreparedPromotion(
      paths,
      readPrepared(paths.preparedPath),
      input.crashHook,
    );
  });
}

export function recoverLongTailPromotionSnapshotByExactArtifacts(
  input: LongTailPromotionSnapshotArtifactRecoveryInput,
): LongTailPromotionSnapshotResult {
  const masterWorklistSha256 = sha256Schema.parse(input.masterWorklistSha256);
  const artifacts = normalizeArtifacts(input.artifacts);
  const artifactSetSha256 = sha256Canonical(
    artifacts.map((artifact) => artifact.material),
  );
  const transactionRoot = path.resolve(input.transactionRoot);
  if (pathKind(transactionRoot) !== "directory") {
    throw new LongTailPromotionSnapshotError(
      "No durable promotion transaction root exists for semantic recovery.",
    );
  }
  assertNoSymlinkComponents(transactionRoot, "transaction root");
  const transactionsRoot = path.join(transactionRoot, "transactions");
  if (pathKind(transactionsRoot) !== "directory") {
    throw new LongTailPromotionSnapshotError(
      "No durable promotion journals exist for semantic recovery.",
    );
  }
  const matches: Array<Readonly<{
    transactionId: string;
    semanticEvidence: TranslationSemanticPromotionEvidenceUnion;
  }>> = [];
  for (const transactionId of readdirSync(transactionsRoot).sort(compareCodePoints)) {
    if (!/^[a-f0-9]{64}$/.test(transactionId)) {
      throw new LongTailPromotionSnapshotError(
        "Promotion journal directory has a noncanonical transaction identity.",
      );
    }
    const transactionDirectory = path.join(transactionsRoot, transactionId);
    if (pathKind(transactionDirectory) !== "directory") {
      throw new LongTailPromotionSnapshotError(
        `Promotion journal is not a real directory: ${transactionId}.`,
      );
    }
    const preparedPath = path.join(transactionDirectory, "PREPARED.json");
    if (pathKind(preparedPath) === "missing") continue;
    if (pathKind(preparedPath) !== "file") {
      throw new LongTailPromotionSnapshotError(
        `Promotion PREPARED journal is unsafe: ${transactionId}.`,
      );
    }
    const prepared = readPrepared(preparedPath);
    if (
      prepared.masterWorklistSha256 !== masterWorklistSha256 ||
      prepared.artifactSetSha256 !== artifactSetSha256
    ) {
      continue;
    }
    if (!prepared.semanticEvidence) {
      throw new LongTailPromotionSnapshotError(
        "Matching promotion journal predates mandatory semantic evidence.",
      );
    }
    if (
      prepared.semanticEvidence.kind !== input.expectedSemanticEvidenceKind
    ) {
      continue;
    }
    const expectedTransactionId = calculateLongTailPromotionSnapshotTransactionId({
      masterWorklistSha256,
      artifacts: input.artifacts,
      semanticEvidence: prepared.semanticEvidence,
    });
    if (expectedTransactionId !== transactionId) {
      throw new LongTailPromotionSnapshotError(
        "Matching promotion journal has a forged transaction identity.",
      );
    }
    const committedPath = path.join(transactionDirectory, "COMMITTED.json");
    if (pathKind(committedPath) !== "file") {
      throw new LongTailPromotionSnapshotError(
        "Matching semantic promotion has no durable COMMITTED journal.",
      );
    }
    verifyCommittedMatchesPrepared(readCommitted(committedPath), prepared);
    matches.push(Object.freeze({
      transactionId,
      semanticEvidence: prepared.semanticEvidence,
    }));
  }
  if (matches.length !== 1) {
    throw new LongTailPromotionSnapshotError(
      `Expected exactly one committed semantic promotion journal; found ${matches.length}.`,
    );
  }
  const match = matches[0];
  if (!match) {
    throw new LongTailPromotionSnapshotError(
      "Committed semantic promotion journal disappeared.",
    );
  }
  return promoteLongTailPromotionSnapshot({
    curatedRoot: input.curatedRoot,
    transactionRoot,
    masterWorklistSha256,
    semanticEvidence: match.semanticEvidence,
    artifacts: input.artifacts,
    crashHook: input.crashHook,
  });
}

export function finalizeLongTailPromotionSnapshot(
  input: LongTailPromotionSnapshotFinalizeInput,
): LongTailPromotionSnapshotFinalizeResult {
  const transactionId = sha256Schema.parse(input.transactionId);
  const paths = snapshotPaths({
    curatedRoot: input.curatedRoot,
    transactionRoot: input.transactionRoot,
    transactionId,
  });

  return withPromotionLock(paths, transactionId, () => {
    if (pathKind(paths.preparedPath) !== "file") {
      throw new LongTailPromotionSnapshotError(
        "Finalization requires a durable PREPARED journal.",
      );
    }
    if (pathKind(paths.committedPath) !== "file") {
      throw new LongTailPromotionSnapshotError(
        "Finalization requires a durable COMMITTED journal.",
      );
    }

    const prepared = readPrepared(paths.preparedPath);
    if (prepared.transactionId !== transactionId) {
      throw new LongTailPromotionSnapshotError(
        "PREPARED journal belongs to a different transaction.",
      );
    }
    const committed = readCommitted(paths.committedPath);
    verifyCommittedMatchesPrepared(committed, prepared);
    verifyPreparedSiteSourceCatalog(paths, prepared);
    fsyncRegularFile(paths.preparedPath, "prepared journal finalization");
    fsyncRegularFile(paths.committedPath, "committed journal finalization");
    fsyncDirectory(paths.transactionDirectory);
    fsyncRenameParents(paths.transactionRoot, paths.curatedParent);
    verifyPreparedReceipts(paths, prepared);
    assertPreparedTransitionFromAvailablePrior(paths, prepared);
    verifyActiveSnapshot(paths.curatedRoot, prepared);
    verifyPreparedStaticMainAppTree(paths, prepared);
    assertWorkbenchCarrierEmpty(
      paths.workbenchCarrierRoot,
      "Finalized workbench carrier",
    );
    const exactNoop = isExactNoopPromotion(prepared);
    if (exactNoop && pathKind(paths.nextRoot) === "directory") {
      const redundantNext = presentTreeDigest(inspectTree(paths.nextRoot));
      if (
        sha256Canonical(redundantNext) !==
          sha256Canonical(prepared.nextSiteTree)
      ) {
        throw new LongTailPromotionSnapshotError(
          "Exact no-op staged snapshot changed before finalization.",
        );
      }
    }

    const removedNextRoot = removeFinalizedSnapshotRoot(
      paths.nextRoot,
      paths.transactionRoot,
      "next",
      input.crashHook,
      exactNoop,
      () => verifyPreparedSiteSourceCatalog(paths, prepared),
    );
    const retainedPrior = retainFinalizedPriorSnapshot(
      paths,
      prepared,
      input.crashHook,
      () => verifyPreparedSiteSourceCatalog(paths, prepared),
    );
    verifyPreparedSiteSourceCatalog(paths, prepared);

    return Object.freeze({
      transactionId,
      outcome: removedNextRoot || retainedPrior.moved
        ? "finalized"
        : "exact-replay",
      activeTreeSha256: prepared.nextSiteTree.sha256,
      removedNextRoot,
      movedPriorRoot: retainedPrior.moved,
      retainedPriorRoot: retainedPrior.path,
    });
  });
}

export function readAndValidateLongTailPromotionJournal(input: {
  curatedRoot: string;
  transactionRoot: string;
  transactionId: string;
  expectedSemanticEvidence?: TranslationSemanticPromotionEvidenceUnion;
}): LongTailPromotionJournalBinding {
  const transactionId = sha256Schema.parse(input.transactionId);
  const requestedTransactionRoot = path.resolve(input.transactionRoot);
  if (pathKind(requestedTransactionRoot) !== "directory") {
    throw new LongTailPromotionSnapshotError(
      "Promotion journal validation requires an existing transaction root.",
    );
  }
  const paths = snapshotPaths({
    curatedRoot: input.curatedRoot,
    transactionRoot: requestedTransactionRoot,
    transactionId,
  });
  return withPromotionLock(paths, transactionId, () => {
    if (
      pathKind(paths.preparedPath) !== "file" ||
      pathKind(paths.committedPath) !== "file"
    ) {
      throw new LongTailPromotionSnapshotError(
        "Promotion attestation requires durable PREPARED and COMMITTED journals.",
      );
    }
    const prepared = readPrepared(paths.preparedPath);
    const committed = readCommitted(paths.committedPath);
    if (prepared.transactionId !== transactionId) {
      throw new LongTailPromotionSnapshotError(
        "Promotion journal belongs to a different transaction.",
      );
    }
    verifyCommittedMatchesPrepared(committed, prepared);
    verifyPreparedSiteSourceCatalog(paths, prepared);
    fsyncRegularFile(paths.preparedPath, "prepared journal attestation");
    fsyncRegularFile(paths.committedPath, "committed journal attestation");
    fsyncDirectory(paths.transactionDirectory);
    fsyncRenameParents(paths.transactionRoot, paths.curatedParent);
    if (!prepared.semanticEvidence || !prepared.staticMainAppTree) {
      throw new LongTailPromotionSnapshotError(
        "Promotion journal predates mandatory semantic/static evidence.",
      );
    }
    if (
      input.expectedSemanticEvidence &&
      sha256Canonical(parseSemanticEvidence(input.expectedSemanticEvidence)) !==
        sha256Canonical(prepared.semanticEvidence)
    ) {
      throw new LongTailPromotionSnapshotError(
        "Promotion journal semantic evidence does not match the attestation request.",
      );
    }
    verifyPreparedReceipts(paths, prepared);
    assertPreparedTransitionFromAvailablePrior(paths, prepared);
    verifyActiveSnapshot(paths.curatedRoot, prepared);
    verifyPreparedStaticMainAppTree(paths, prepared);
    if (
      pathKind(paths.oldRoot) !== "missing" ||
      pathKind(paths.nextRoot) !== "missing"
    ) {
      throw new LongTailPromotionSnapshotError(
        "Promotion journal is not finalized to its retained state.",
      );
    }
    assertWorkbenchCarrierEmpty(
      paths.workbenchCarrierRoot,
      "Attested workbench carrier",
    );
    const retainedPrior = prepared.priorSiteTree.exists &&
      !isExactNoopPromotion(prepared);
    if (retainedPrior) {
      if (pathKind(paths.retainedPriorRoot) !== "directory") {
        throw new LongTailPromotionSnapshotError(
          "Promotion journal is missing RETAINED_PRIOR.",
        );
      }
      verifyRetainedPriorSnapshot(paths.retainedPriorRoot, prepared);
    } else if (pathKind(paths.retainedPriorRoot) !== "missing") {
      throw new LongTailPromotionSnapshotError(
        "Promotion journal has an unexpected RETAINED_PRIOR.",
      );
    }

    const publications = publicationCounts(prepared);
    const material = journalBindingMaterialSchema.parse({
      schemaVersion: 1,
      kind: LONG_TAIL_PROMOTION_JOURNAL_BINDING_KIND,
      transactionId,
      masterWorklistSha256: prepared.masterWorklistSha256,
      semanticEvidenceKind: prepared.semanticEvidence.kind,
      semanticEvidenceSha256:
        prepared.semanticEvidence.semanticEvidenceSha256,
      generatorExecutionProfileSha256:
        prepared.semanticEvidence.generatorExecutionProfileSha256,
      preparedSha256: prepared.preparedSha256,
      committedSha256: committed.committedSha256,
      artifactSetSha256: prepared.artifactSetSha256,
      entriesRootSha256: sha256Canonical(prepared.entries),
      artifacts: prepared.entries.length,
      publications,
      priorSiteTree: prepared.priorSiteTree,
      postSiteTree: prepared.nextSiteTree,
      staticMainAppTree: prepared.staticMainAppTree,
      retainedPrior,
    });
    const binding = longTailPromotionJournalBindingSchema.parse({
      ...material,
      bindingSha256: sha256Canonical(material),
    });

    const finalPrepared = readPrepared(paths.preparedPath);
    const finalCommitted = readCommitted(paths.committedPath);
    if (
      finalPrepared.preparedSha256 !== prepared.preparedSha256 ||
      finalCommitted.committedSha256 !== committed.committedSha256
    ) {
      throw new LongTailPromotionSnapshotError(
        "Promotion journals changed during attestation validation.",
      );
    }
    verifyActiveSnapshot(paths.curatedRoot, finalPrepared);
    verifyPreparedStaticMainAppTree(paths, finalPrepared);
    verifyPreparedSiteSourceCatalog(paths, finalPrepared);
    if (retainedPrior) {
      verifyRetainedPriorSnapshot(paths.retainedPriorRoot, finalPrepared);
    }
    assertWorkbenchCarrierEmpty(
      paths.workbenchCarrierRoot,
      "Final attested workbench carrier",
    );
    return binding;
  });
}

export type FinalizedAfrikaansStagedPromotionProof = Readonly<{
  state: "committed-finalized";
  semanticAudit: VerifiedAfrikaansTranslationSemanticAudit;
  semanticEvidence: AfrikaansTranslationSemanticPromotionEvidence;
  journalBinding: LongTailPromotionJournalBinding;
  transactionId: string;
  preparedSha256: string;
  committedSha256: string;
  artifacts: number;
  publications: LongTailPromotionJournalBinding["publications"];
  postSiteTree: LongTailPromotionJournalBinding["postSiteTree"];
}>;

export function readAndValidateAfrikaansStagedPromotionProof(input: {
  workspaceRoot: string;
  runRoot: string;
  transactionRoot: string;
  transactionId: string;
}): FinalizedAfrikaansStagedPromotionProof {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const curatedRoot = path.join(
    workspaceRoot,
    "translations/curated",
  );
  const transactionRoot = path.resolve(input.transactionRoot);
  const transactionId = sha256Schema.parse(input.transactionId);
  const initialBinding = readAndValidateLongTailPromotionJournal({
    curatedRoot,
    transactionRoot,
    transactionId,
  });
  if (
    initialBinding.semanticEvidenceKind !==
      AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND
  ) {
    throw new LongTailPromotionSnapshotError(
      "Finalized promotion journal is not Afrikaans staged-release evidence.",
    );
  }
  const paths = snapshotPaths({
    curatedRoot,
    transactionRoot,
    transactionId,
  });
  const prepared = readPrepared(paths.preparedPath);
  const semanticEvidence = prepared.semanticEvidence;
  if (
    semanticEvidence?.kind !==
      AFRIKAANS_TRANSLATION_SEMANTIC_PROMOTION_EVIDENCE_KIND
  ) {
    throw new LongTailPromotionSnapshotError(
      "Finalized Afrikaans promotion lost its exact semantic evidence.",
    );
  }
  const semanticAudit = verifyAfrikaansTranslationSemanticAuditManifest({
    workspaceRoot,
    runRoot: input.runRoot,
    committedPromotionEvidence: semanticEvidence,
  });
  const journalBinding = readAndValidateLongTailPromotionJournal({
    curatedRoot,
    transactionRoot,
    transactionId,
    expectedSemanticEvidence: semanticEvidence,
  });
  if (
    journalBinding.bindingSha256 !== initialBinding.bindingSha256 ||
    journalBinding.semanticEvidenceSha256 !==
      semanticAudit.promotionEvidence.semanticEvidenceSha256 ||
    journalBinding.artifacts !==
      TRANSLATION_SEMANTIC_AUDIT_AFRIKAANS_EXPECTED_CANDIDATE_PACK_COUNT
  ) {
    throw new LongTailPromotionSnapshotError(
      "Finalized Afrikaans promotion proof changed or is not the exact 121-pack cohort.",
    );
  }
  return Object.freeze({
    state: "committed-finalized",
    semanticAudit,
    semanticEvidence,
    journalBinding,
    transactionId,
    preparedSha256: journalBinding.preparedSha256,
    committedSha256: journalBinding.committedSha256,
    artifacts: journalBinding.artifacts,
    publications: journalBinding.publications,
    postSiteTree: journalBinding.postSiteTree,
  });
}

export function assertLongTailPromotionSnapshotTransactionRootSettled(
  input: LongTailPromotionSnapshotSettlementInput,
): void {
  const requestedRoot = path.resolve(input.transactionRoot);
  const requestedKind = pathKind(requestedRoot);
  if (requestedKind === "symlink") {
    throw new LongTailPromotionSnapshotError(
      "Transaction root cannot be a symbolic link.",
    );
  }
  if (requestedKind !== "directory") {
    throw new LongTailPromotionSnapshotError(
      "Settlement assertion requires an existing transaction root.",
    );
  }
  const transactionRoot = realpathSync(requestedRoot);
  assertNoSymlinkComponents(transactionRoot, "transaction root");
  assertDirectory(transactionRoot, "transaction root");

  if (pathKind(path.join(transactionRoot, "PROMOTION.lock")) !== "missing") {
    throw new LongTailPromotionSnapshotError(
      "Transaction root has an unresolved promotion lock.",
    );
  }

  const assertNoUnfinalizedSnapshotRoot = () => {
    const transactionRootEntries = readdirSync(transactionRoot);
    if (transactionRootEntries.length > MAXIMUM_TRANSACTION_DIRECTORY_ENTRIES) {
      throw new LongTailPromotionSnapshotError(
        "Transaction root exceeds its entry resource bound.",
      );
    }
    const unfinalizedSnapshotRoot = transactionRootEntries
      .sort(compareCodePoints)
      .find((name) => name.startsWith(".next-") || name.startsWith(".old-"));
    if (unfinalizedSnapshotRoot) {
      throw new LongTailPromotionSnapshotError(
        `Transaction root has an unfinalized promotion snapshot: ${unfinalizedSnapshotRoot}.`,
      );
    }
  };

  const transactionsRoot = path.join(transactionRoot, "transactions");
  const transactionsKind = pathKind(transactionsRoot);
  if (transactionsKind === "missing") {
    assertNoUnfinalizedSnapshotRoot();
    return;
  }
  if (transactionsKind !== "directory") {
    throw new LongTailPromotionSnapshotError(
      "Transaction journal root must be a real directory.",
    );
  }
  assertNoSymlinkComponents(transactionsRoot, "transaction journal root");
  assertDirectory(transactionsRoot, "transaction journal root");

  const transactionIds = readdirSync(transactionsRoot).sort(compareCodePoints);
  if (transactionIds.length > MAXIMUM_RETAINED_TRANSACTIONS) {
    throw new LongTailPromotionSnapshotError(
      "Promotion journal history exceeds its retained-transaction bound; review archival before continuing.",
    );
  }
  for (const transactionId of transactionIds) {
    if (!sha256Schema.safeParse(transactionId).success) {
      throw new LongTailPromotionSnapshotError(
        `Unexpected transaction directory: ${transactionId}.`,
      );
    }
    const transactionDirectory = path.join(transactionsRoot, transactionId);
    if (pathKind(transactionDirectory) !== "directory") {
      throw new LongTailPromotionSnapshotError(
        `Transaction entry must be a real directory: ${transactionId}.`,
      );
    }
    assertNoSymlinkComponents(transactionDirectory, "transaction directory");
    assertDirectory(transactionDirectory, "transaction directory");
    if (
      readdirSync(transactionDirectory).length >
        MAXIMUM_TRANSACTION_DIRECTORY_ENTRIES
    ) {
      throw new LongTailPromotionSnapshotError(
        `Transaction ${transactionId} exceeds its directory entry bound.`,
      );
    }

    const preparedPath = path.join(transactionDirectory, "PREPARED.json");
    const committedPath = path.join(transactionDirectory, "COMMITTED.json");
    const preparedKind = pathKind(preparedPath);
    const committedKind = pathKind(committedPath);
    if (
      (preparedKind !== "missing" && preparedKind !== "file") ||
      (committedKind !== "missing" && committedKind !== "file")
    ) {
      throw new LongTailPromotionSnapshotError(
        `Transaction ${transactionId} has a non-regular journal path.`,
      );
    }
    if (preparedKind === "missing") {
      const detail = committedKind === "file"
        ? "COMMITTED without PREPARED"
        : "no durable PREPARED journal";
      throw new LongTailPromotionSnapshotError(
        `Transaction ${transactionId} is unresolved: ${detail}.`,
      );
    }

    const prepared = readPrepared(preparedPath);
    if (prepared.transactionId !== transactionId) {
      throw new LongTailPromotionSnapshotError(
        `PREPARED journal identity mismatch for ${transactionId}.`,
      );
    }
    if (committedKind === "missing") {
      throw new LongTailPromotionSnapshotError(
        `Transaction ${transactionId} is unresolved: PREPARED without COMMITTED.`,
      );
    }
    verifyCommittedMatchesPrepared(readCommitted(committedPath), prepared);
    const retainedPriorRoot = path.join(
      transactionDirectory,
      "RETAINED_PRIOR",
    );
    if (prepared.priorSiteTree.exists && !isExactNoopPromotion(prepared)) {
      if (pathKind(retainedPriorRoot) !== "directory") {
        throw new LongTailPromotionSnapshotError(
          `Transaction ${transactionId} is not finalized to RETAINED_PRIOR.`,
        );
      }
      verifyRetainedPriorSnapshot(retainedPriorRoot, prepared);
    } else if (pathKind(retainedPriorRoot) !== "missing") {
      throw new LongTailPromotionSnapshotError(
        `Creation transaction ${transactionId} has an unexpected RETAINED_PRIOR.`,
      );
    } else if (!prepared.priorSiteTree.exists) {
      assertPreparedTransitionFromPriorInspection(
        prepared,
        null,
        `Creation transaction ${transactionId}`,
      );
    }
    assertWorkbenchCarrierEmpty(
      path.join(transactionDirectory, "WORKBENCH_CARRIER"),
      `Transaction ${transactionId} workbench carrier`,
    );
  }
  assertNoUnfinalizedSnapshotRoot();
}

function preparePromotionSnapshot(
  paths: SnapshotPaths,
  masterWorklistSha256: string,
  artifacts: readonly NormalizedArtifact[],
  semanticEvidence: TranslationSemanticPromotionEvidenceUnion | undefined,
  crashHook: LongTailPromotionSnapshotCrashHook | undefined,
): PreparedPromotion {
  const priorInspection = pathKind(paths.curatedRoot) === "missing"
    ? null
    : inspectTree(paths.curatedRoot);
  let staticMainAppTree:
    | z.infer<typeof presentTreeDigestSchema>
    | undefined;
  mkdirPrivate(paths.transactionDirectory);
  mkdirPrivate(paths.checkpointRoot);
  mkdirPrivate(paths.backupRoot);
  cloneTree(paths.curatedRoot, paths.nextRoot);
  if (semanticEvidence) {
    if (semanticEvidence.masterWorklistSha256 !== masterWorklistSha256) {
      throw new LongTailPromotionSnapshotError(
        "Semantic evidence belongs to a different master worklist.",
      );
    }
    const stagedBase = calculateTranslationSemanticAuditTreeEvidence({
      root: paths.nextRoot,
      label: "Staged audited curated tree",
      ignoreMainAppWorkbench: true,
    });
    const expectedBase = semanticEvidence.inputTrees.curated;
    const priorBase = priorInspection
      ? presentTreeDigest(priorInspection)
      : absentTreeDigest();
    if (
      !expectedBase.exists ||
      sha256Canonical(priorBase) !== sha256Canonical(expectedBase) ||
      stagedBase.sha256 !== expectedBase.sha256 ||
      stagedBase.files !== expectedBase.files ||
      stagedBase.bytes !== expectedBase.bytes
    ) {
      throw new LongTailPromotionSnapshotError(
        "Curated corpus changed after semantic verification and before promotion.",
      );
    }
    const staticMainApp = calculateTranslationSemanticAuditTreeEvidence({
      root: path.join(paths.curatedParent, "static-main-app"),
      label: "Tracked static main-app tree",
    });
    const expectedStaticMainApp = semanticEvidence.inputTrees.staticMainApp;
    if (
      !expectedStaticMainApp.exists ||
      staticMainApp.sha256 !== expectedStaticMainApp.sha256 ||
      staticMainApp.files !== expectedStaticMainApp.files ||
      staticMainApp.bytes !== expectedStaticMainApp.bytes
    ) {
      throw new LongTailPromotionSnapshotError(
        "Tracked static main-app corpus changed after semantic verification and before promotion.",
      );
    }
    staticMainAppTree = presentTreeDigestSchema.parse(staticMainApp);
  }

  const entries: PreparedPromotionEntry[] = [];
  for (const artifact of artifacts) {
    if (isTranslationSemanticMainAppWorkbenchPath(artifact.targetRelativePath)) {
      throw new LongTailPromotionSnapshotError(
        "Promotion cannot target ignored main-app workbench paths.",
      );
    }
    const prior = priorInspection?.files.get(artifact.targetRelativePath);
    const publication = classifyPublication(prior?.sha256, artifact);
    const targetPath = resolveContainedPath(
      paths.nextRoot,
      artifact.targetRelativePath,
      "staged target",
    );
    writeDurableReplacement(targetPath, artifact.targetBytes);

    const checkpointPath = resolveContainedPath(
      paths.checkpointRoot,
      artifact.checkpointRelativePath,
      "checkpoint receipt",
    );
    writeDurableExact(checkpointPath, artifact.checkpointBytes);

    let replacement: PreparedPromotionEntry["replacement"];
    if (publication === "replaced") {
      const approval = artifact.replacement;
      if (!approval || !prior) {
        throw new LongTailPromotionSnapshotError(
          "Replacement classification lost its approved prior target.",
        );
      }
      const priorPath = resolveContainedPath(
        paths.curatedRoot,
        artifact.targetRelativePath,
        "replacement source",
      );
      const priorBytes = readRegularUnlinkedFile(priorPath);
      if (sha256Buffer(priorBytes) !== approval.approvedExistingSha256) {
        throw new LongTailPromotionSnapshotError(
          `Approved replacement bytes changed for ${artifact.targetRelativePath}.`,
        );
      }
      const backupPath = resolveContainedPath(
        paths.backupRoot,
        approval.backupRelativePath,
        "replacement backup",
      );
      writeDurableExact(backupPath, priorBytes);
      const approvalMaterial = replacementApprovalMaterial(approval);
      const common = {
        approvedExistingSha256: approval.approvedExistingSha256,
        priorSourceHash: approval.priorSourceHash,
        newSourceHash: approval.newSourceHash,
        approvalSha256: sha256Canonical(approvalMaterial),
        backupRelativePath: approval.backupRelativePath,
        backupSha256: sha256Buffer(priorBytes),
      };
      replacement = approval.kind ===
          LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND
        ? {
          kind: approval.kind,
          ...common,
          validatorPolicySha256: approval.validatorPolicySha256,
        }
        : { kind: approval.kind, ...common };
    }

    entries.push({
      targetRelativePath: artifact.targetRelativePath,
      targetSha256: artifact.targetSha256,
      targetBytes: artifact.targetBytes.length,
      checkpointRelativePath: artifact.checkpointRelativePath,
      checkpointSha256: artifact.checkpointSha256,
      checkpointBytes: artifact.checkpointBytes.length,
      publication,
      prior: prior
        ? { state: "exact", sha256: prior.sha256 }
        : { state: "missing" },
      ...(replacement ? { replacement } : {}),
    });
  }

  fsyncTree(paths.checkpointRoot);
  fsyncTree(paths.backupRoot);
  crashHook?.("after-checkpoints-and-backups-fsync");
  crashHook?.("after-artifacts-before-next-validation");

  const nextInspection = inspectTree(paths.nextRoot);
  const expectedNextInspection = deriveExpectedPostInspection(
    priorInspection,
    entries,
  );
  if (!sameTreeInspection(nextInspection, expectedNextInspection)) {
    throw new LongTailPromotionSnapshotError(
      "Staged curated corpus contains changes outside the exact authorized artifact set.",
    );
  }
  fsyncTree(paths.nextRoot);
  crashHook?.("after-next-tree-fsync");

  const preparedMaterial = preparedMaterialSchema.parse({
    schemaVersion: 2,
    kind: LONG_TAIL_PROMOTION_PREPARED_KIND,
    transactionId: path.basename(paths.transactionDirectory),
    masterWorklistSha256,
    ...(semanticEvidence ? { semanticEvidence } : {}),
    artifactSetSha256: sha256Canonical(
      artifacts.map((artifact) => artifact.material),
    ),
    priorSiteTree: priorInspection
      ? presentTreeDigest(priorInspection)
      : absentTreeDigest(),
    nextSiteTree: presentTreeDigest(nextInspection),
    ...(staticMainAppTree ? { staticMainAppTree } : {}),
    entries,
  });
  const prepared = preparedSchema.parse({
    ...preparedMaterial,
    preparedSha256: sha256Canonical(preparedMaterial),
  });
  installJournalFile(
    paths.preparedPath,
    prettyJsonBytes(prepared),
    crashHook,
    "prepared",
  );
  return prepared;
}

function replacementApprovalMaterial(
  replacement:
    | z.infer<typeof replacementInputSchema>
    | z.infer<typeof preparedReplacementSchema>,
) {
  const common = {
    kind: replacement.kind,
    approvedExistingSha256: replacement.approvedExistingSha256,
    priorSourceHash: replacement.priorSourceHash,
    newSourceHash: replacement.newSourceHash,
    backupRelativePath: replacement.backupRelativePath,
  };
  return replacement.kind ===
      LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND
    ? Object.freeze({
      ...common,
      validatorPolicySha256: replacement.validatorPolicySha256,
    })
    : Object.freeze(common);
}

function recoverPreparedPromotion(
  paths: SnapshotPaths,
  prepared: PreparedPromotion,
  crashHook: LongTailPromotionSnapshotCrashHook | undefined,
): LongTailPromotionSnapshotResult {
  const assertReleaseInputsStable = () =>
    verifyPreparedSiteSourceCatalog(paths, prepared);
  const evidence = verifyPreparedReceipts(paths, prepared);
  fsyncRegularFile(paths.preparedPath, "prepared journal recovery");
  fsyncDirectory(paths.transactionDirectory);
  verifyPreparedStaticMainAppTree(paths, prepared);
  assertPreparedTransitionFromAvailablePrior(paths, prepared);
  assertReleaseInputsStable();
  if (pathKind(paths.committedPath) === "file") {
    const committed = readCommitted(paths.committedPath);
    verifyCommittedMatchesPrepared(committed, prepared);
    verifyActiveSnapshot(paths.curatedRoot, prepared);
    assertNoWorkbenchFiles(paths.oldRoot, "Committed prior snapshot");
    assertNoWorkbenchFiles(paths.nextRoot, "Committed staged snapshot");
    assertWorkbenchCarrierEmpty(
      paths.workbenchCarrierRoot,
      "Committed workbench carrier",
    );
    fsyncRegularFile(paths.preparedPath, "prepared journal replay");
    fsyncRegularFile(paths.committedPath, "committed journal replay");
    fsyncDirectory(paths.transactionDirectory);
    fsyncRenameParents(paths.transactionRoot, paths.curatedParent);
    assertReleaseInputsStable();
    return promotionResult(paths, prepared, evidence, "exact-replay");
  }

  let active = inspectOptionalTree(paths.curatedRoot);
  if (
    active === null &&
    pathKind(paths.oldRoot) === "directory" &&
    pathKind(paths.nextRoot) === "directory"
  ) {
    fsyncRenameParents(paths.curatedParent, paths.transactionRoot);
    assertReleaseInputsStable();
    transferWorkbenchInodes(paths, crashHook, assertReleaseInputsStable);
  }
  let staged = inspectOptionalTree(paths.nextRoot);
  let prior = inspectOptionalTree(paths.oldRoot);
  const priorSha = prepared.priorSiteTree.exists
    ? prepared.priorSiteTree.sha256
    : null;

  if (active?.treeSha256 === prepared.nextSiteTree.sha256) {
    assertNoWorkbenchFiles(paths.oldRoot, "Activated prior snapshot");
    assertNoWorkbenchFiles(paths.nextRoot, "Activated staged snapshot");
    assertWorkbenchCarrierEmpty(
      paths.workbenchCarrierRoot,
      "Activated workbench carrier",
    );
    fsyncRenameParents(paths.transactionRoot, paths.curatedParent);
  } else {
    if (prepared.priorSiteTree.exists) {
      if (active?.treeSha256 === priorSha && prior === null) {
        if (staged?.treeSha256 !== prepared.nextSiteTree.sha256) {
          throw new LongTailPromotionSnapshotError(
            "Prepared next snapshot is missing or changed before the first rename.",
          );
        }
        crashHook?.("before-active-to-old-rename");
        assertReleaseInputsStable();
        renameSync(paths.curatedRoot, paths.oldRoot);
        crashHook?.("after-active-to-old-rename-before-parent-fsync");
        fsyncRenameParents(paths.curatedParent, paths.transactionRoot);
        crashHook?.("after-active-to-old-parent-fsync");
        active = null;
        prior = inspectTree(paths.oldRoot);
      } else if (active !== null) {
        throw new LongTailPromotionSnapshotError(
          "Active corpus does not match the prepared old or new snapshot.",
        );
      }
      if (prior?.treeSha256 !== priorSha) {
        throw new LongTailPromotionSnapshotError(
          "Prior snapshot is missing or changed during recovery.",
        );
      }
      assertReleaseInputsStable();
      transferWorkbenchInodes(paths, crashHook, assertReleaseInputsStable);
    } else if (active !== null) {
      throw new LongTailPromotionSnapshotError(
        "Prepared creation expected no active curated root.",
      );
    }

    staged = inspectOptionalTree(paths.nextRoot);
    if (staged?.treeSha256 !== prepared.nextSiteTree.sha256) {
      throw new LongTailPromotionSnapshotError(
        "Prepared next snapshot is missing or changed before activation.",
      );
    }
    crashHook?.("before-next-to-active-rename");
    assertReleaseInputsStable();
    renameSync(paths.nextRoot, paths.curatedRoot);
    crashHook?.("after-next-to-active-rename-before-parent-fsync");
    fsyncRenameParents(paths.transactionRoot, paths.curatedParent);
    crashHook?.("after-next-to-active-parent-fsync");
  }

  verifyActiveSnapshot(paths.curatedRoot, prepared);
  assertNoWorkbenchFiles(paths.oldRoot, "Prior snapshot before COMMITTED");
  assertNoWorkbenchFiles(paths.nextRoot, "Staged snapshot before COMMITTED");
  assertWorkbenchCarrierEmpty(
    paths.workbenchCarrierRoot,
    "Workbench carrier before COMMITTED",
  );
  verifyPreparedStaticMainAppTree(paths, prepared);
  assertReleaseInputsStable();
  const activeSiteTree = calculateTranslationSemanticAuditTreeEvidence({
    root: paths.curatedRoot,
    label: "Committed curated site tree",
    ignoreMainAppWorkbench: true,
  });
  const committedMaterial = committedMaterialSchema.parse({
    schemaVersion: 2,
    kind: LONG_TAIL_PROMOTION_COMMITTED_KIND,
    transactionId: prepared.transactionId,
    masterWorklistSha256: prepared.masterWorklistSha256,
    preparedSha256: prepared.preparedSha256,
    activeSiteTree,
    ...(prepared.staticMainAppTree
      ? { staticMainAppTree: prepared.staticMainAppTree }
      : {}),
  });
  const committed = committedSchema.parse({
    ...committedMaterial,
    committedSha256: sha256Canonical(committedMaterial),
  });
  installJournalFile(
    paths.committedPath,
    prettyJsonBytes(committed),
    crashHook,
    "committed",
    assertReleaseInputsStable,
  );
  assertNoWorkbenchFiles(paths.oldRoot, "Prior snapshot after COMMITTED");
  assertWorkbenchCarrierEmpty(
    paths.workbenchCarrierRoot,
    "Workbench carrier after COMMITTED",
  );
  assertReleaseInputsStable();
  return promotionResult(paths, prepared, evidence, "committed");
}

function verifyPreparedSiteSourceCatalog(
  paths: SnapshotPaths,
  prepared: PreparedPromotion,
): void {
  if (!prepared.semanticEvidence) return;
  const workspaceRoot = path.dirname(paths.curatedParent);
  const current = calculateTranslationSemanticSiteSourceCatalogEvidence({
    workspaceRoot,
  });
  if (
    canonicalJson(current) !==
      canonicalJson(prepared.semanticEvidence.siteSourceCatalog)
  ) {
    throw new LongTailPromotionSnapshotError(
      "Tracked site source catalog changed after semantic verification and before promotion.",
    );
  }
}

function verifyPreparedStaticMainAppTree(
  paths: SnapshotPaths,
  prepared: PreparedPromotion,
): void {
  if (!prepared.semanticEvidence) return;
  const actual = calculateTranslationSemanticAuditTreeEvidence({
    root: path.join(paths.curatedParent, "static-main-app"),
    label: "Tracked static main-app tree",
  });
  const expected = prepared.semanticEvidence.inputTrees.staticMainApp;
  if (
    !expected.exists ||
    actual.sha256 !== expected.sha256 ||
    actual.files !== expected.files ||
    actual.bytes !== expected.bytes
  ) {
    throw new LongTailPromotionSnapshotError(
      "Tracked static main-app corpus changed during promotion.",
    );
  }
}

function verifyPreparedReceipts(
  paths: SnapshotPaths,
  prepared: PreparedPromotion,
): VerifiedPromotionEvidence {
  const checkpoints: VerifiedPromotionEvidence["checkpoints"][number][] = [];
  const backups: VerifiedPromotionEvidence["backups"][number][] = [];
  for (const entry of prepared.entries) {
    const checkpoint = readRegularUnlinkedFile(resolveContainedPath(
      paths.checkpointRoot,
      entry.checkpointRelativePath,
      "checkpoint receipt",
    ));
    if (
      checkpoint.length !== entry.checkpointBytes ||
      sha256Buffer(checkpoint) !== entry.checkpointSha256
    ) {
      throw new LongTailPromotionSnapshotError(
        `Checkpoint receipt changed for ${entry.targetRelativePath}.`,
      );
    }
    checkpoints.push(Object.freeze({
      relativePath: entry.checkpointRelativePath,
      sha256: entry.checkpointSha256,
      bytes: checkpoint,
    }));
    if (!entry.replacement) continue;
    const backup = readRegularUnlinkedFile(resolveContainedPath(
      paths.backupRoot,
      entry.replacement.backupRelativePath,
      "replacement backup",
    ));
    const approvalSha256 = sha256Canonical(
      replacementApprovalMaterial(entry.replacement),
    );
    const backupSha256 = sha256Buffer(backup);
    if (
      entry.prior.state !== "exact" ||
      entry.prior.sha256 !== entry.replacement.approvedExistingSha256 ||
      entry.replacement.backupSha256 !==
        entry.replacement.approvedExistingSha256 ||
      backupSha256 !== entry.replacement.backupSha256 ||
      approvalSha256 !== entry.replacement.approvalSha256
    ) {
      throw new LongTailPromotionSnapshotError(
        `Replacement backup or approval changed for ${entry.targetRelativePath}.`,
      );
    }
    backups.push(Object.freeze({
      targetRelativePath: entry.targetRelativePath,
      relativePath: entry.replacement.backupRelativePath,
      sha256: backupSha256,
      kind: entry.replacement.kind,
      approvedExistingSha256:
        entry.replacement.approvedExistingSha256,
      priorSourceHash: entry.replacement.priorSourceHash,
      newSourceHash: entry.replacement.newSourceHash,
      approvalSha256: entry.replacement.approvalSha256,
      ...(entry.replacement.kind ===
          LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND
        ? {
          validatorPolicySha256:
            entry.replacement.validatorPolicySha256,
        }
        : {}),
      bytes: backup,
    }));
  }
  return Object.freeze({
    checkpoints: Object.freeze(checkpoints),
    backups: Object.freeze(backups),
  });
}

function verifyActiveSnapshot(root: string, prepared: PreparedPromotion) {
  const active = inspectTree(root);
  if (
    sha256Canonical(presentTreeDigest(active)) !==
      sha256Canonical(prepared.nextSiteTree)
  ) {
    throw new LongTailPromotionSnapshotError(
      "Active curated corpus does not match the committed snapshot.",
    );
  }
}

function promotionResult(
  paths: SnapshotPaths,
  prepared: PreparedPromotion,
  evidence: VerifiedPromotionEvidence,
  outcome: "committed" | "exact-replay",
): LongTailPromotionSnapshotResult {
  const counts = { created: 0, replayed: 0, replaced: 0 };
  for (const entry of prepared.entries) {
    if (entry.publication === "created") counts.created += 1;
    else if (entry.publication === "replaced") counts.replaced += 1;
    else counts.replayed += 1;
  }
  const checkpoints = evidence.checkpoints.map((checkpoint) => Object.freeze({
    relativePath: checkpoint.relativePath,
    sha256: checkpoint.sha256,
    bytes: new Uint8Array(checkpoint.bytes),
  }));
  const backups = evidence.backups.map((backup) => Object.freeze({
    targetRelativePath: backup.targetRelativePath,
    relativePath: backup.relativePath,
    sha256: backup.sha256,
    kind: backup.kind,
    approvedExistingSha256: backup.approvedExistingSha256,
    priorSourceHash: backup.priorSourceHash,
    newSourceHash: backup.newSourceHash,
    approvalSha256: backup.approvalSha256,
    ...(backup.validatorPolicySha256
      ? { validatorPolicySha256: backup.validatorPolicySha256 }
      : {}),
    bytes: new Uint8Array(backup.bytes),
  }));
  return Object.freeze({
    transactionId: prepared.transactionId,
    outcome,
    activeTreeSha256: prepared.nextSiteTree.sha256,
    activeRoot: paths.curatedRoot,
    priorRoot: prepared.priorSiteTree.exists
      ? pathKind(paths.oldRoot) === "directory"
        ? paths.oldRoot
        : pathKind(paths.retainedPriorRoot) === "directory"
        ? paths.retainedPriorRoot
        : null
      : null,
    ...(prepared.semanticEvidence
      ? { semanticEvidence: prepared.semanticEvidence }
      : {}),
    publications: Object.freeze(counts),
    checkpoints: Object.freeze(checkpoints),
    backups: Object.freeze(backups),
  });
}

type NormalizedArtifact = Readonly<{
  targetRelativePath: string;
  targetBytes: Buffer;
  targetSha256: string;
  checkpointRelativePath: string;
  checkpointBytes: Buffer;
  checkpointSha256: string;
  replacement?: z.infer<typeof replacementInputSchema>;
  material: Readonly<{
    targetRelativePath: string;
    targetSha256: string;
    targetBytes: number;
    checkpointRelativePath: string;
    checkpointSha256: string;
    checkpointBytes: number;
    replacement?: z.infer<typeof replacementInputSchema>;
  }>;
}>;

function normalizeArtifacts(
  values: readonly LongTailPromotionSnapshotArtifact[],
): readonly NormalizedArtifact[] {
  if (!values.length || values.length > 100_000) {
    throw new LongTailPromotionSnapshotError(
      "Promotion requires between one and 100,000 artifacts.",
    );
  }
  const normalized = values.map((value) => {
    const metadata = artifactMetadataSchema.parse({
      targetRelativePath: value.targetRelativePath,
      checkpointRelativePath: value.checkpointRelativePath,
      ...(value.replacement ? { replacement: value.replacement } : {}),
    });
    const targetBytes = boundedBytes(value.targetBytes, "target");
    const checkpointBytes = boundedBytes(value.checkpointBytes, "checkpoint");
    assertJsonObjectBytes(targetBytes, "target");
    assertJsonObjectBytes(checkpointBytes, "checkpoint");
    const targetSha256 = sha256Buffer(targetBytes);
    const checkpointSha256 = sha256Buffer(checkpointBytes);
    const material = Object.freeze({
      targetRelativePath: metadata.targetRelativePath,
      targetSha256,
      targetBytes: targetBytes.length,
      checkpointRelativePath: metadata.checkpointRelativePath,
      checkpointSha256,
      checkpointBytes: checkpointBytes.length,
      ...(metadata.replacement
        ? { replacement: Object.freeze(metadata.replacement) }
        : {}),
    });
    return Object.freeze({
      ...material,
      targetBytes,
      checkpointBytes,
      material,
    });
  }).sort((left, right) => compareCodePoints(
    left.targetRelativePath,
    right.targetRelativePath,
  ));
  assertUniquePortablePaths(
    normalized.map((value) => value.targetRelativePath),
    "target",
  );
  assertUniquePortablePaths(
    normalized.map((value) => value.checkpointRelativePath),
    "checkpoint",
  );
  assertUniquePortablePaths(
    normalized.flatMap((value) =>
      value.replacement ? [value.replacement.backupRelativePath] : []
    ),
    "backup",
  );
  return Object.freeze(normalized);
}

function classifyPublication(
  priorSha256: string | undefined,
  artifact: NormalizedArtifact,
): z.infer<typeof publicationSchema> {
  if (priorSha256 === undefined) {
    if (artifact.replacement) {
      throw new LongTailPromotionSnapshotError(
        `Approved replacement target is missing: ${artifact.targetRelativePath}.`,
      );
    }
    return "created";
  }
  if (priorSha256 === artifact.targetSha256) {
    if (artifact.replacement) {
      throw new LongTailPromotionSnapshotError(
        `Replacement is already active without its exact transaction journal: ${artifact.targetRelativePath}.`,
      );
    }
    return "exact-replay";
  }
  if (
    !artifact.replacement ||
    artifact.replacement.approvedExistingSha256 !== priorSha256
  ) {
    throw new LongTailPromotionSnapshotError(
      `Refusing unapproved target replacement: ${artifact.targetRelativePath}.`,
    );
  }
  return "replaced";
}

function snapshotPaths(input: {
  curatedRoot: string;
  transactionRoot: string;
  transactionId: string;
}): SnapshotPaths {
  const requestedCuratedRoot = path.resolve(input.curatedRoot);
  const requestedCuratedParent = path.dirname(requestedCuratedRoot);
  if (pathKind(requestedCuratedParent) !== "directory") {
    throw new LongTailPromotionSnapshotError(
      "Curated parent must be an existing directory.",
    );
  }
  if (pathKind(requestedCuratedRoot) === "symlink") {
    throw new LongTailPromotionSnapshotError(
      "Curated root cannot be a symbolic link.",
    );
  }
  const curatedParent = realpathSync(requestedCuratedParent);
  const basename = path.basename(requestedCuratedRoot);
  const curatedRoot = path.join(curatedParent, basename);
  const requestedTransactionRoot = path.resolve(input.transactionRoot);
  if (pathKind(requestedTransactionRoot) === "symlink") {
    throw new LongTailPromotionSnapshotError(
      "Transaction root cannot be a symbolic link.",
    );
  }
  mkdirPrivate(requestedTransactionRoot);
  const transactionRoot = realpathSync(requestedTransactionRoot);
  if (
    curatedRoot === transactionRoot ||
    isWithin(curatedRoot, transactionRoot)
  ) {
    throw new LongTailPromotionSnapshotError(
      "Transaction root cannot be inside the active curated corpus.",
    );
  }
  mkdirPrivate(transactionRoot);
  assertNoSymlinkComponents(transactionRoot, "transaction root");
  if (statSync(curatedParent).dev !== statSync(transactionRoot).dev) {
    throw new LongTailPromotionSnapshotError(
      "Curated and transaction roots must be on the same filesystem device.",
    );
  }
  const transactionDirectory = path.join(
    transactionRoot,
    "transactions",
    input.transactionId,
  );
  return Object.freeze({
    curatedRoot,
    curatedParent,
    nextRoot: path.join(transactionRoot, `.next-${input.transactionId}`),
    oldRoot: path.join(transactionRoot, `.old-${input.transactionId}`),
    transactionRoot,
    transactionDirectory,
    preparedPath: path.join(transactionDirectory, "PREPARED.json"),
    committedPath: path.join(transactionDirectory, "COMMITTED.json"),
    retainedPriorRoot: path.join(transactionDirectory, "RETAINED_PRIOR"),
    workbenchCarrierRoot: path.join(
      transactionDirectory,
      "WORKBENCH_CARRIER",
    ),
    checkpointRoot: path.join(transactionDirectory, "checkpoints"),
    backupRoot: path.join(transactionDirectory, "backups"),
  });
}

function resetUnpreparedTransaction(paths: SnapshotPaths) {
  if (pathKind(paths.oldRoot) !== "missing") {
    throw new LongTailPromotionSnapshotError(
      "Prior snapshot exists without a durable PREPARED journal.",
    );
  }
  if (pathKind(paths.retainedPriorRoot) !== "missing") {
    throw new LongTailPromotionSnapshotError(
      "Retained prior evidence exists without a durable PREPARED journal.",
    );
  }
  assertResettableUnpreparedTransaction(paths.transactionDirectory);
  if (pathKind(paths.nextRoot) !== "missing") {
    assertNoWorkbenchFiles(paths.nextRoot, "Unprepared staged snapshot");
    inspectTree(paths.nextRoot);
  }
  removePrivateTree(paths.nextRoot, "unprepared next snapshot");
  removePrivateTree(paths.transactionDirectory, "unprepared transaction");
}

function assertResettableUnpreparedTransaction(root: string): void {
  const kind = pathKind(root);
  if (kind === "missing") return;
  if (kind !== "directory") {
    throw new LongTailPromotionSnapshotError(
      "Unprepared transaction path is unsafe.",
    );
  }
  const allowedTopLevel = new Set(["checkpoints", "backups"]);
  let directories = 0;
  let files = 0;
  let bytes = 0;
  const visit = (directory: string, relativeDirectory: string): void => {
    directories += 1;
    const depth = relativeDirectory ? relativeDirectory.split("/").length : 0;
    if (directories > 30_000 || depth > 64) {
      throw new LongTailPromotionSnapshotError(
        "Unprepared transaction exceeds its directory resource bound.",
      );
    }
    for (const name of readdirSync(directory).sort(compareCodePoints)) {
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      if (
        !relativeDirectory &&
        !allowedTopLevel.has(name) &&
        !/^\.PREPARED\.json\.tmp-[0-9]+-[0-9a-f-]+$/.test(name)
      ) {
        throw new LongTailPromotionSnapshotError(
          `Unprepared transaction contains unexpected retained data: ${name}.`,
        );
      }
      const child = path.join(directory, name);
      const metadata = lstatSync(child);
      if (metadata.isSymbolicLink()) {
        throw new LongTailPromotionSnapshotError(
          `Unprepared transaction contains a symbolic link: ${relative}.`,
        );
      }
      if (metadata.isDirectory()) {
        visit(child, relative);
        continue;
      }
      if (!metadata.isFile() || metadata.nlink !== 1) {
        throw new LongTailPromotionSnapshotError(
          `Unprepared transaction contains an unsafe entry: ${relative}.`,
        );
      }
      files += 1;
      bytes += metadata.size;
      if (files > 30_000 || bytes > 4 * 1024 * 1024 * 1024) {
        throw new LongTailPromotionSnapshotError(
          "Unprepared transaction exceeds its file or byte resource bound.",
        );
      }
    }
  };
  visit(root, "");
}

function assertSafeWorkbenchFile(
  file: string,
  relativePath: string,
  allowedLinkCounts: readonly number[] = [1],
) {
  if (
    !isSafeRelativePath(relativePath) ||
    !isTranslationSemanticMainAppWorkbenchPath(relativePath)
  ) {
    throw new LongTailPromotionSnapshotError(
      `Optional main-app workbench path is not canonical: ${relativePath}.`,
    );
  }
  const metadata = lstatSync(file, { bigint: true });
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    !allowedLinkCounts.includes(Number(metadata.nlink)) ||
    metadata.size > BigInt(MAXIMUM_ARTIFACT_BYTES)
  ) {
    throw new LongTailPromotionSnapshotError(
      `Optional main-app workbench entry is unsafe: ${relativePath}.`,
    );
  }
  const descriptor = openSync(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  let opened: BigIntStats | null = null;
  try {
    opened = fstatSync(descriptor, { bigint: true });
  } finally {
    closeSync(descriptor);
  }
  const after = lstatSync(file, { bigint: true });
  if (
    !opened ||
    !sameWorkbenchFileIdentity(metadata, opened, allowedLinkCounts) ||
    !sameWorkbenchFileIdentity(opened, after, allowedLinkCounts)
  ) {
    throw new LongTailPromotionSnapshotError(
      `Optional main-app workbench entry changed while inspected: ${relativePath}.`,
    );
  }
  return Object.freeze({
    dev: after.dev,
    ino: after.ino,
    bytes: Number(after.size),
    links: Number(after.nlink),
  });
}

function sameWorkbenchFileIdentity(
  first: BigIntStats,
  second: BigIntStats,
  allowedLinkCounts: readonly number[],
): boolean {
  return first.isFile() && second.isFile() &&
    allowedLinkCounts.includes(Number(first.nlink)) &&
    allowedLinkCounts.includes(Number(second.nlink)) &&
    first.dev === second.dev && first.ino === second.ino &&
    first.size === second.size && first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs && first.mode === second.mode &&
    first.uid === second.uid;
}

function inspectWorkbenchFiles(
  root: string,
  allowedLinkCounts: readonly number[] = [1],
): WorkbenchInspection {
  if (pathKind(root) === "missing") return new Map();
  assertDirectory(root, "optional workbench root");
  const files = new Map<string, Readonly<{
    dev: bigint;
    ino: bigint;
    bytes: number;
    links: number;
  }>>();
  let totalBytes = 0;
  for (const locale of TRANSLATION_SEMANTIC_AUDIT_EXPECTED_LOCALES) {
    const localeRoot = path.join(root, locale);
    const localeKind = pathKind(localeRoot);
    if (localeKind === "missing") continue;
    if (localeKind !== "directory") {
      throw new LongTailPromotionSnapshotError(
        `Optional workbench locale root is unsafe: ${locale}.`,
      );
    }
    for (const basename of readdirSync(localeRoot).sort(compareCodePoints)) {
      const relativePath = `${locale}/${basename}`;
      if (!isTranslationSemanticMainAppWorkbenchPath(relativePath)) continue;
      const metadata = assertSafeWorkbenchFile(
        path.join(localeRoot, basename),
        relativePath,
        allowedLinkCounts,
      );
      totalBytes += metadata.bytes;
      if (
        files.size + 1 > MAXIMUM_WORKBENCH_FILES ||
        totalBytes > MAXIMUM_WORKBENCH_BYTES
      ) {
        throw new LongTailPromotionSnapshotError(
          "Optional main-app workbench exceeds its resource bound.",
        );
      }
      files.set(relativePath, metadata);
    }
  }
  return files;
}

function assertNoWorkbenchFiles(root: string, label: string): void {
  const entries = inspectWorkbenchFiles(root);
  if (entries.size !== 0) {
    throw new LongTailPromotionSnapshotError(
      `${label} retains ${entries.size} optional main-app workbench file(s).`,
    );
  }
}

function assertWorkbenchCarrierEmpty(root: string, label: string): void {
  if (pathKind(root) === "missing") return;
  assertNoWorkbenchFiles(root, label);
  const inspection = inspectTree(root);
  if (inspection.fileCount !== 0) {
    throw new LongTailPromotionSnapshotError(
      `${label} retains ${inspection.fileCount} unexpected file(s).`,
    );
  }
}

function transferWorkbenchInodes(
  paths: SnapshotPaths,
  crashHook?: LongTailPromotionSnapshotCrashHook,
  assertReleaseInputsStable?: () => void,
) {
  mkdirPrivateDurable(paths.workbenchCarrierRoot);
  const source = inspectWorkbenchFiles(paths.oldRoot, [1]);
  const carrier = inspectWorkbenchFiles(paths.workbenchCarrierRoot, [1, 2]);
  const destination = inspectWorkbenchFiles(paths.nextRoot, [1, 2]);
  const logicalPaths = new Set([
    ...source.keys(),
    ...carrier.keys(),
    ...destination.keys(),
  ]);
  if (logicalPaths.size > MAXIMUM_WORKBENCH_FILES) {
    throw new LongTailPromotionSnapshotError(
      "Optional main-app workbench exceeds its file resource bound.",
    );
  }
  const totalBytes = [...logicalPaths].reduce((total, relativePath) => {
    const sourceEntry = source.get(relativePath);
    const carrierEntry = carrier.get(relativePath);
    const destinationEntry = destination.get(relativePath);
    if (sourceEntry && (carrierEntry || destinationEntry)) {
      throw new LongTailPromotionSnapshotError(
        `Optional main-app workbench has a public/private conflict for ${relativePath}.`,
      );
    }
    if (
      carrierEntry && destinationEntry &&
      (carrierEntry.dev !== destinationEntry.dev ||
        carrierEntry.ino !== destinationEntry.ino ||
        carrierEntry.links !== 2 || destinationEntry.links !== 2)
    ) {
      throw new LongTailPromotionSnapshotError(
        `Optional main-app workbench carrier conflict for ${relativePath}.`,
      );
    }
    if (carrierEntry && !destinationEntry && carrierEntry.links !== 1) {
      throw new LongTailPromotionSnapshotError(
        `Optional main-app workbench carrier has an unexplained link for ${relativePath}.`,
      );
    }
    if (destinationEntry && !carrierEntry && destinationEntry.links !== 1) {
      throw new LongTailPromotionSnapshotError(
        `Optional main-app workbench destination has an unexplained link for ${relativePath}.`,
      );
    }
    const entry = destinationEntry ?? carrierEntry ?? sourceEntry;
    if (!entry) {
      throw new LongTailPromotionSnapshotError(
        `Optional main-app workbench entry disappeared: ${relativePath}.`,
      );
    }
    return total + entry.bytes;
  }, 0);
  if (totalBytes > MAXIMUM_WORKBENCH_BYTES) {
    throw new LongTailPromotionSnapshotError(
      "Optional main-app workbench exceeds its byte resource bound.",
    );
  }
  for (const relativePath of [...logicalPaths].sort(compareCodePoints)) {
    const initialSource = source.get(relativePath);
    const initialCarrier = carrier.get(relativePath);
    const initialDestination = destination.get(relativePath);
    const sourcePath = resolveContainedPath(
      paths.oldRoot,
      relativePath,
      "optional workbench transfer source",
    );
    const carrierPath = resolveContainedPath(
      paths.workbenchCarrierRoot,
      relativePath,
      "optional workbench private carrier",
    );
    const destinationPath = resolveContainedPath(
      paths.nextRoot,
      relativePath,
      "optional workbench transfer destination",
    );
    const sourceParent = path.dirname(sourcePath);
    const carrierParent = path.dirname(carrierPath);
    const destinationParent = path.dirname(destinationPath);
    mkdirPrivateDurable(carrierParent);
    mkdirPrivateDurable(destinationParent);
    let expected = initialDestination ?? initialCarrier ?? initialSource;
    if (!expected) {
      throw new LongTailPromotionSnapshotError(
        `Optional main-app workbench transfer state disappeared for ${relativePath}.`,
      );
    }
    if (initialSource) {
      if (
        pathKind(carrierPath) !== "missing" ||
        pathKind(destinationPath) !== "missing"
      ) {
        throw new LongTailPromotionSnapshotError(
          `Optional main-app workbench private destination appeared for ${relativePath}.`,
        );
      }
      assertReleaseInputsStable?.();
      renameSync(sourcePath, carrierPath);
      fsyncRenameParents(sourceParent, carrierParent);
      const movedToCarrier = assertSafeWorkbenchFile(
        carrierPath,
        relativePath,
        [1],
      );
      if (
        movedToCarrier.dev !== initialSource.dev ||
        movedToCarrier.ino !== initialSource.ino
      ) {
        throw new LongTailPromotionSnapshotError(
          `Optional main-app workbench carrier inode changed for ${relativePath}.`,
        );
      }
      fsyncRegularFile(carrierPath, "optional workbench private carrier");
      expected = movedToCarrier;
      crashHook?.("after-workbench-source-to-carrier-rename");
      assertReleaseInputsStable?.();
      if (pathKind(sourcePath) !== "missing") {
        throw new LongTailPromotionSnapshotError(
          `Optional main-app workbench was recreated during transfer: ${relativePath}.`,
        );
      }
    }

    const destinationState = pathKind(destinationPath);
    if (destinationState === "missing") {
      assertReleaseInputsStable?.();
      linkSync(carrierPath, destinationPath);
      fsyncRegularFile(destinationPath, "optional workbench transfer");
      fsyncDirectory(destinationParent);
      const linkedCarrier = assertSafeWorkbenchFile(
        carrierPath,
        relativePath,
        [2],
      );
      const linkedDestination = assertSafeWorkbenchFile(
        destinationPath,
        relativePath,
        [2],
      );
      if (
        linkedCarrier.dev !== expected.dev ||
        linkedCarrier.ino !== expected.ino ||
        linkedDestination.dev !== expected.dev ||
        linkedDestination.ino !== expected.ino
      ) {
        throw new LongTailPromotionSnapshotError(
          `Optional main-app workbench inode changed while linking ${relativePath}.`,
        );
      }
      crashHook?.("after-workbench-carrier-link-before-unlink");
      assertReleaseInputsStable?.();
    } else if (destinationState !== "file") {
      throw new LongTailPromotionSnapshotError(
        `Optional main-app workbench destination is unsafe for ${relativePath}.`,
      );
    }
    if (pathKind(sourcePath) !== "missing") {
      throw new LongTailPromotionSnapshotError(
        `Optional main-app workbench public source reappeared for ${relativePath}.`,
      );
    }
    fsyncRegularFile(destinationPath, "optional workbench destination replay");
    fsyncDirectory(destinationParent);
    fsyncDirectory(sourceParent);
    fsyncDirectory(carrierParent);
    if (pathKind(carrierPath) === "file") {
      assertReleaseInputsStable?.();
      unlinkSync(carrierPath);
      fsyncDirectory(carrierParent);
    } else {
      fsyncDirectory(carrierParent);
    }
    const moved = assertSafeWorkbenchFile(destinationPath, relativePath, [1]);
    if (moved.dev !== expected.dev || moved.ino !== expected.ino) {
      throw new LongTailPromotionSnapshotError(
        `Optional main-app workbench inode changed for ${relativePath}.`,
      );
    }
  }
  assertNoWorkbenchFiles(paths.oldRoot, "Workbench transfer source");
  assertWorkbenchCarrierEmpty(
    paths.workbenchCarrierRoot,
    "Workbench transfer carrier",
  );
}

function cloneTree(sourceRoot: string, destinationRoot: string) {
  if (pathKind(destinationRoot) !== "missing") {
    throw new LongTailPromotionSnapshotError(
      "Next snapshot path already exists before staging.",
    );
  }
  mkdirPrivate(destinationRoot);
  if (pathKind(sourceRoot) === "missing") {
    fsyncDirectory(path.dirname(destinationRoot));
    return;
  }
  assertDirectory(sourceRoot, "active curated root");

  let directories = 0;
  let files = 0;
  let totalBytes = 0;
  const copyDirectory = (source: string, destination: string, relative: string) => {
    const depth = relative ? relative.split("/").length : 0;
    directories += 1;
    if (depth > 64 || directories > 30_000) {
      throw new LongTailPromotionSnapshotError(
        "Active corpus exceeds its directory resource bound.",
      );
    }
    const names = readdirSync(source).sort(compareCodePoints);
    for (const name of names) {
      const sourcePath = path.join(source, name);
      const destinationPath = path.join(destination, name);
      const metadata = lstatSync(sourcePath);
      if (metadata.isSymbolicLink()) {
        throw new LongTailPromotionSnapshotError(
          `Active corpus contains a symbolic link: ${sourcePath}.`,
        );
      }
      if (metadata.isDirectory()) {
        mkdirPrivate(destinationPath);
        copyDirectory(
          sourcePath,
          destinationPath,
          relative ? `${relative}/${name}` : name,
        );
        fsyncDirectory(destinationPath);
        continue;
      }
      if (!metadata.isFile()) {
        throw new LongTailPromotionSnapshotError(
          `Active corpus contains a non-regular entry: ${sourcePath}.`,
        );
      }
      files += 1;
      totalBytes += metadata.size;
      if (files > 30_000 || totalBytes > 4 * 1024 * 1024 * 1024) {
        throw new LongTailPromotionSnapshotError(
          "Active corpus exceeds its file or byte resource bound.",
        );
      }
      const childRelative = relative ? `${relative}/${name}` : name;
      if (isTranslationSemanticMainAppWorkbenchPath(childRelative)) {
        assertSafeWorkbenchFile(sourcePath, childRelative);
        continue;
      }
      const contents = readRegularUnlinkedFile(sourcePath);
      writeDurableExact(destinationPath, contents);
    }
    fsyncDirectory(destination);
  };
  copyDirectory(sourceRoot, destinationRoot, "");
  fsyncDirectory(path.dirname(destinationRoot));
}

function inspectOptionalTree(root: string) {
  return pathKind(root) === "missing" ? null : inspectTree(root);
}

function presentTreeDigest(
  inspection: TreeInspection,
): z.infer<typeof presentTreeDigestSchema> {
  return presentTreeDigestSchema.parse({
    exists: true,
    sha256: inspection.treeSha256,
    files: inspection.fileCount,
    bytes: inspection.bytes,
  });
}

type TreeTransitionEntry = Readonly<{
  targetRelativePath: string;
  targetSha256: string;
  targetBytes: number;
}>;

function treeInspectionFromFiles(
  input: ReadonlyMap<string, Readonly<{ sha256: string; bytes: number }>>,
): TreeInspection {
  const material = [...input.entries()]
    .map(([relativePath, value]) => ({
      relativePath,
      sha256: value.sha256,
      bytes: value.bytes,
    }))
    .sort((left, right) => compareCodePoints(
      left.relativePath,
      right.relativePath,
    ));
  const files = new Map(
    material.map((entry) => [
      entry.relativePath,
      Object.freeze({ sha256: entry.sha256, bytes: entry.bytes }),
    ] as const),
  );
  const bytes = material.reduce((total, entry) => total + entry.bytes, 0);
  return Object.freeze({
    treeSha256: sha256Canonical({
      exists: true,
      files: material.map((entry) => [
        entry.relativePath,
        entry.bytes,
        entry.sha256,
      ]),
    }),
    fileCount: files.size,
    bytes,
    files,
  });
}

function deriveExpectedPostInspection(
  prior: TreeInspection | null,
  entries: readonly TreeTransitionEntry[],
): TreeInspection {
  const expectedFiles = new Map(prior?.files ?? []);
  for (const entry of entries) {
    expectedFiles.set(entry.targetRelativePath, Object.freeze({
      sha256: entry.targetSha256,
      bytes: entry.targetBytes,
    }));
  }
  return treeInspectionFromFiles(expectedFiles);
}

function sameTreeInspection(
  actual: TreeInspection,
  expected: TreeInspection,
): boolean {
  if (
    actual.treeSha256 !== expected.treeSha256 ||
    actual.fileCount !== expected.fileCount ||
    actual.bytes !== expected.bytes ||
    actual.files.size !== expected.files.size
  ) return false;
  for (const [relativePath, expectedFile] of expected.files) {
    const actualFile = actual.files.get(relativePath);
    if (
      !actualFile ||
      actualFile.sha256 !== expectedFile.sha256 ||
      actualFile.bytes !== expectedFile.bytes
    ) return false;
  }
  return true;
}

function assertPreparedTransitionFromPriorInspection(
  prepared: PreparedPromotion,
  prior: TreeInspection | null,
  label: string,
): void {
  const actualPriorTree = prior
    ? presentTreeDigest(prior)
    : absentTreeDigest();
  if (
    sha256Canonical(actualPriorTree) !==
      sha256Canonical(prepared.priorSiteTree)
  ) {
    throw new LongTailPromotionSnapshotError(
      `${label} does not match the PREPARED prior tree.`,
    );
  }
  for (const entry of prepared.entries) {
    const actualPrior = prior?.files.get(entry.targetRelativePath);
    if (
      entry.prior.state === "missing"
        ? actualPrior !== undefined
        : !actualPrior || actualPrior.sha256 !== entry.prior.sha256
    ) {
      throw new LongTailPromotionSnapshotError(
        `${label} does not match the PREPARED prior state for ${entry.targetRelativePath}.`,
      );
    }
  }
  const expectedPost = deriveExpectedPostInspection(prior, prepared.entries);
  if (
    sha256Canonical(presentTreeDigest(expectedPost)) !==
      sha256Canonical(prepared.nextSiteTree)
  ) {
    throw new LongTailPromotionSnapshotError(
      `${label} and the authorized artifact set do not derive the PREPARED post tree.`,
    );
  }
}

function assertPreparedTransitionFromAvailablePrior(
  paths: SnapshotPaths,
  prepared: PreparedPromotion,
): void {
  if (!prepared.priorSiteTree.exists) {
    assertPreparedTransitionFromPriorInspection(
      prepared,
      null,
      "Creation transaction",
    );
    return;
  }
  for (const [candidate, label] of [
    [paths.retainedPriorRoot, "Retained prior snapshot"],
    [paths.oldRoot, "Prior snapshot"],
    [paths.curatedRoot, "Active prior snapshot"],
  ] as const) {
    const kind = pathKind(candidate);
    if (kind === "missing") continue;
    if (kind !== "directory") {
      throw new LongTailPromotionSnapshotError(
        `${label} path is unsafe.`,
      );
    }
    const inspection = inspectTree(candidate);
    if (
      sha256Canonical(presentTreeDigest(inspection)) ===
        sha256Canonical(prepared.priorSiteTree)
    ) {
      assertPreparedTransitionFromPriorInspection(
        prepared,
        inspection,
        label,
      );
      return;
    }
  }
  throw new LongTailPromotionSnapshotError(
    "No available prior snapshot proves the deterministic PREPARED tree transition.",
  );
}

function absentTreeDigest(): z.infer<typeof absentTreeDigestSchema> {
  return absentTreeDigestSchema.parse({
    exists: false,
    sha256: sha256Canonical({ exists: false, files: [] }),
    files: 0,
    bytes: 0,
  });
}

function inspectTree(root: string): TreeInspection {
  assertDirectory(root, "snapshot root");
  const files = new Map<string, Readonly<{ sha256: string; bytes: number }>>();
  const portablePaths = new Set<string>();
  let directoryCount = 0;
  let fileEntryCount = 0;
  let resourceBytes = 0;
  const visit = (directory: string, relativeDirectory: string) => {
    const depth = relativeDirectory ? relativeDirectory.split("/").length : 0;
    directoryCount += 1;
    if (depth > 64 || directoryCount > 30_000) {
      throw new LongTailPromotionSnapshotError(
        "Snapshot exceeds its directory resource bound.",
      );
    }
    const names = readdirSync(directory).sort(compareCodePoints);
    for (const name of names) {
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      if (!isSafeRelativePath(relative)) {
        throw new LongTailPromotionSnapshotError(
          `Snapshot contains an unsafe path: ${relative}.`,
        );
      }
      const collisionKey = portableCollisionKey(relative);
      if (portablePaths.has(collisionKey)) {
        throw new LongTailPromotionSnapshotError(
          `Snapshot contains a case-fold or normalization collision: ${relative}.`,
        );
      }
      portablePaths.add(collisionKey);
      const file = path.join(directory, name);
      const metadata = lstatSync(file);
      if (metadata.isSymbolicLink()) {
        throw new LongTailPromotionSnapshotError(
          `Snapshot contains a symbolic link: ${relative}.`,
        );
      }
      if (metadata.isDirectory()) {
        visit(file, relative);
        continue;
      }
      if (!metadata.isFile()) {
        throw new LongTailPromotionSnapshotError(
          `Snapshot contains a non-regular entry: ${relative}.`,
        );
      }
      fileEntryCount += 1;
      resourceBytes += metadata.size;
      if (
        fileEntryCount > 30_000 ||
        resourceBytes > 4 * 1024 * 1024 * 1024
      ) {
        throw new LongTailPromotionSnapshotError(
          "Snapshot exceeds its file or byte resource bound.",
        );
      }
      if (isTranslationSemanticMainAppWorkbenchPath(relative)) {
        assertSafeWorkbenchFile(file, relative);
        continue;
      }
      const bytes = readRegularUnlinkedFile(file);
      files.set(relative, Object.freeze({
        sha256: sha256Buffer(bytes),
        bytes: bytes.length,
      }));
    }
  };
  visit(root, "");
  const material = [...files.entries()]
    .map(([relativePath, value]) => ({
      relativePath,
      sha256: value.sha256,
      bytes: value.bytes,
    }))
    .sort((left, right) => compareCodePoints(
      left.relativePath,
      right.relativePath,
    ));
  const bytes = material.reduce((total, entry) => total + entry.bytes, 0);
  return Object.freeze({
    treeSha256: sha256Canonical({
      exists: true,
      files: material.map((entry) => [
        entry.relativePath,
        entry.bytes,
        entry.sha256,
      ]),
    }),
    fileCount: files.size,
    bytes,
    files,
  });
}

function fsyncTree(root: string) {
  assertDirectory(root, "durability tree");
  let directories = 0;
  let files = 0;
  let bytes = 0;
  const visit = (directory: string, depth: number) => {
    directories += 1;
    if (directories > 30_000 || depth > 64) {
      throw new LongTailPromotionSnapshotError(
        "Durability tree exceeds its directory resource bound.",
      );
    }
    for (const name of readdirSync(directory).sort(compareCodePoints)) {
      const child = path.join(directory, name);
      const metadata = lstatSync(child);
      if (metadata.isSymbolicLink()) {
        throw new LongTailPromotionSnapshotError(
          `Durability tree contains a symbolic link: ${child}.`,
        );
      }
      if (metadata.isDirectory()) visit(child, depth + 1);
      else {
        if (!metadata.isFile() || metadata.nlink !== 1) {
          throw new LongTailPromotionSnapshotError(
            `Durability tree contains a non-regular entry: ${child}.`,
          );
        }
        files += 1;
        bytes += metadata.size;
        if (files > 30_000 || bytes > 4 * 1024 * 1024 * 1024) {
          throw new LongTailPromotionSnapshotError(
            "Durability tree exceeds its file or byte resource bound.",
          );
        }
        assertRegularUnlinkedFile(child, "durability file");
      }
    }
    fsyncDirectory(directory);
  };
  visit(root, 0);
}

function installJournalFile(
  destination: string,
  bytes: Buffer,
  crashHook: LongTailPromotionSnapshotCrashHook | undefined,
  kind: "prepared" | "committed",
  assertReleaseInputsStable?: () => void,
) {
  if (pathKind(destination) === "file") {
    const existing = readRegularUnlinkedFile(destination);
    if (!existing.equals(bytes)) {
      throw new LongTailPromotionSnapshotError(
        `Conflicting ${kind.toUpperCase()} journal already exists.`,
      );
    }
    fsyncRegularFile(destination, `${kind} journal replay`);
    fsyncDirectory(path.dirname(destination));
    assertReleaseInputsStable?.();
    return;
  }
  mkdirPrivate(path.dirname(destination));
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.tmp-${process.pid}-${randomUUID()}`,
  );
  writeDurableExact(temporary, bytes);
  const before = kind === "prepared"
    ? "before-prepared-rename"
    : "before-committed-rename";
  const after = kind === "prepared"
    ? "after-prepared-rename-before-parent-fsync"
    : "after-committed-rename-before-parent-fsync";
  const durable = kind === "prepared"
    ? "after-prepared-parent-fsync"
    : "after-committed-parent-fsync";
  crashHook?.(before);
  assertReleaseInputsStable?.();
  renameSync(temporary, destination);
  crashHook?.(after);
  fsyncDirectory(path.dirname(destination));
  crashHook?.(durable);
  assertReleaseInputsStable?.();
}

function writeDurableReplacement(file: string, bytes: Buffer) {
  mkdirPrivate(path.dirname(file));
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp-${process.pid}-${randomUUID()}`,
  );
  writeDurableExact(temporary, bytes);
  if (pathKind(file) !== "missing") {
    assertRegularUnlinkedFile(file, "staged replacement target");
  }
  renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
  const readback = readRegularUnlinkedFile(file);
  if (!readback.equals(bytes)) {
    throw new LongTailPromotionSnapshotError(
      `Staged target readback changed: ${file}.`,
    );
  }
}

function writeDurableExact(file: string, bytes: Buffer) {
  mkdirPrivate(path.dirname(file));
  if (pathKind(file) !== "missing") {
    const existing = readRegularUnlinkedFile(file);
    if (!existing.equals(bytes)) {
      throw new LongTailPromotionSnapshotError(
        `Exact durable file contains conflicting bytes: ${file}.`,
      );
    }
    return;
  }
  const descriptor = openSync(
    file,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const readback = readRegularUnlinkedFile(file);
  if (!readback.equals(bytes)) {
    throw new LongTailPromotionSnapshotError(
      `Durable file readback changed: ${file}.`,
    );
  }
}

function readRegularUnlinkedFile(file: string) {
  assertNoSymlinkComponents(file, "stable regular file");
  const pathBefore = lstatSync(file, { bigint: true });
  if (
    !pathBefore.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.nlink !== BigInt(1) ||
    pathBefore.size > BigInt(MAXIMUM_ARTIFACT_BYTES)
  ) {
    throw new LongTailPromotionSnapshotError(
      `File must be a bounded regular, non-symlink, single-link file: ${file}.`,
    );
  }
  const descriptor = openSync(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!sameStableFileIdentity(pathBefore, before)) {
      throw new LongTailPromotionSnapshotError(
        `File changed while it was opened: ${file}.`,
      );
    }
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
      if (count === 0) {
        throw new LongTailPromotionSnapshotError(
          `File was truncated while it was read: ${file}.`,
        );
      }
      offset += count;
    }
    const growthProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, growthProbe, 0, 1, null) !== 0) {
      throw new LongTailPromotionSnapshotError(
        `File grew while it was read: ${file}.`,
      );
    }
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(file, { bigint: true });
    if (
      !sameStableFileIdentity(before, after) ||
      !sameStableFileIdentity(after, pathAfter) ||
      BigInt(bytes.length) !== after.size
    ) {
      throw new LongTailPromotionSnapshotError(
        `File changed while it was read: ${file}.`,
      );
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function sameStableFileIdentity(
  first: BigIntStats,
  second: BigIntStats,
): boolean {
  return first.isFile() && second.isFile() &&
    first.nlink === BigInt(1) && second.nlink === BigInt(1) &&
    first.dev === second.dev && first.ino === second.ino &&
    first.size === second.size && first.mtimeNs === second.mtimeNs &&
    first.ctimeNs === second.ctimeNs && first.mode === second.mode &&
    first.uid === second.uid;
}

function assertRegularUnlinkedFile(file: string, label: string) {
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new LongTailPromotionSnapshotError(
      `${label} must be a regular, non-symlink, single-link file: ${file}.`,
    );
  }
}

function assertDirectory(directory: string, label: string) {
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new LongTailPromotionSnapshotError(
      `${label} must be a real directory: ${directory}.`,
    );
  }
}

function mkdirPrivate(directory: string) {
  assertNoSymlinkComponents(directory, "private directory");
  if (pathKind(directory) === "missing") {
    const parent = path.dirname(directory);
    if (parent !== directory && pathKind(parent) === "missing") {
      mkdirPrivate(parent);
    }
    mkdirSync(directory, { mode: 0o700 });
    fsyncDirectory(directory);
    if (parent !== directory) fsyncDirectory(parent);
  }
  assertNoSymlinkComponents(directory, "private directory");
  assertDirectory(directory, "private directory");
}

function mkdirPrivateDurable(directory: string) {
  mkdirPrivate(directory);
}

function removePrivateTree(target: string, label: string) {
  if (pathKind(target) === "missing") return;
  assertTreeContainsNoLinks(target, label);
  rmSync(target, { recursive: true, force: true });
  fsyncDirectory(path.dirname(target));
}

function removeFinalizedSnapshotRoot(
  target: string,
  transactionRoot: string,
  kind: "next" | "old",
  crashHook: LongTailPromotionSnapshotFinalizeCrashHook | undefined,
  allowRemoval = false,
  assertReleaseInputsStable?: () => void,
) {
  const expectedPrefix = `.${kind}-`;
  if (
    path.dirname(target) !== transactionRoot ||
    !path.basename(target).startsWith(expectedPrefix)
  ) {
    throw new LongTailPromotionSnapshotError(
      `Refusing to finalize a non-transaction-owned ${kind} root.`,
    );
  }

  const existingKind = pathKind(target);
  const before = kind === "next"
    ? "before-finalize-next-remove"
    : "before-finalize-prior-retain";
  const after = kind === "next"
    ? "after-finalize-next-remove-before-parent-fsync"
    : "after-finalize-prior-retain-before-parent-fsync";
  const durable = kind === "next"
    ? "after-finalize-next-parent-fsync"
    : "after-finalize-prior-retain-parent-fsync";
  crashHook?.(before);
  assertReleaseInputsStable?.();
  if (existingKind !== "missing") {
    assertNoWorkbenchFiles(target, `Finalized ${kind} snapshot`);
    inspectTree(target);
    if (!allowRemoval) {
      throw new LongTailPromotionSnapshotError(
        `Committed transaction retains an unexpected ${kind} snapshot.`,
      );
    }
    rmSync(target, { recursive: true, force: true });
  }
  crashHook?.(after);
  fsyncDirectory(transactionRoot);
  crashHook?.(durable);
  return existingKind !== "missing";
}

function isExactNoopPromotion(prepared: PreparedPromotion): boolean {
  return prepared.priorSiteTree.exists &&
    sha256Canonical(prepared.priorSiteTree) ===
      sha256Canonical(prepared.nextSiteTree) &&
    prepared.entries.every((entry) => entry.publication === "exact-replay");
}

function retainFinalizedPriorSnapshot(
  paths: SnapshotPaths,
  prepared: PreparedPromotion,
  crashHook: LongTailPromotionSnapshotFinalizeCrashHook | undefined,
  assertReleaseInputsStable?: () => void,
): Readonly<{ moved: boolean; path: string | null }> {
  const oldKind = pathKind(paths.oldRoot);
  const retainedKind = pathKind(paths.retainedPriorRoot);
  if (oldKind !== "missing" && retainedKind !== "missing") {
    throw new LongTailPromotionSnapshotError(
      "Both mutable and retained prior snapshots exist.",
    );
  }
  if (!prepared.priorSiteTree.exists) {
    if (oldKind !== "missing" || retainedKind !== "missing") {
      throw new LongTailPromotionSnapshotError(
        "A creation transaction cannot retain a prior snapshot.",
      );
    }
    return Object.freeze({ moved: false, path: null });
  }

  if (isExactNoopPromotion(prepared)) {
    if (oldKind !== "missing" || retainedKind !== "missing") {
      throw new LongTailPromotionSnapshotError(
        "Exact no-op promotion cannot retain a prior snapshot.",
      );
    }
    return Object.freeze({ moved: false, path: null });
  }

  if (oldKind === "missing") {
    if (retainedKind !== "directory") {
      throw new LongTailPromotionSnapshotError(
        "Committed replacement is missing its retained prior snapshot.",
      );
    }
    verifyRetainedPriorSnapshot(paths.retainedPriorRoot, prepared);
    fsyncRenameParents(paths.transactionRoot, paths.transactionDirectory);
    return Object.freeze({
      moved: false,
      path: paths.retainedPriorRoot,
    });
  }
  if (oldKind !== "directory" || retainedKind !== "missing") {
    throw new LongTailPromotionSnapshotError(
      "Prior snapshot retention paths are unsafe.",
    );
  }

  crashHook?.("before-finalize-prior-retain");
  assertReleaseInputsStable?.();
  assertNoWorkbenchFiles(paths.oldRoot, "Prior snapshot before retention");
  verifyPriorSiteTree(paths.oldRoot, prepared, "Prior snapshot before retention");
  renameSync(paths.oldRoot, paths.retainedPriorRoot);
  crashHook?.("after-finalize-prior-retain-before-parent-fsync");
  fsyncRenameParents(paths.transactionRoot, paths.transactionDirectory);
  crashHook?.("after-finalize-prior-retain-parent-fsync");
  verifyRetainedPriorSnapshot(paths.retainedPriorRoot, prepared);
  return Object.freeze({
    moved: true,
    path: paths.retainedPriorRoot,
  });
}

function verifyPriorSiteTree(
  root: string,
  prepared: PreparedPromotion,
  label: string,
): void {
  if (!prepared.priorSiteTree.exists) {
    throw new LongTailPromotionSnapshotError(
      `${label} is unexpected for a creation transaction.`,
    );
  }
  const inspection = inspectTree(root);
  const actual = presentTreeDigest(inspection);
  if (sha256Canonical(actual) !== sha256Canonical(prepared.priorSiteTree)) {
    throw new LongTailPromotionSnapshotError(
      `${label} does not match PREPARED prior-site evidence.`,
    );
  }
  assertPreparedTransitionFromPriorInspection(prepared, inspection, label);
}

function verifyRetainedPriorSnapshot(
  root: string,
  prepared: PreparedPromotion,
): void {
  assertNoWorkbenchFiles(root, "Retained prior snapshot");
  verifyPriorSiteTree(root, prepared, "Retained prior snapshot");
}

function assertTreeContainsNoLinks(root: string, label: string) {
  let directories = 0;
  let files = 0;
  let bytes = 0;
  const visit = (target: string, depth: number): void => {
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink()) {
      throw new LongTailPromotionSnapshotError(`${label} is a symbolic link.`);
    }
    if (!metadata.isDirectory()) {
      if (!metadata.isFile() || metadata.nlink !== 1) {
        throw new LongTailPromotionSnapshotError(
          `${label} contains a non-regular entry.`,
        );
      }
      files += 1;
      bytes += metadata.size;
      if (files > 30_000 || bytes > 4 * 1024 * 1024 * 1024) {
        throw new LongTailPromotionSnapshotError(
          `${label} exceeds its file or byte resource bound.`,
        );
      }
      return;
    }
    directories += 1;
    if (directories > 30_000 || depth > 64) {
      throw new LongTailPromotionSnapshotError(
        `${label} exceeds its directory resource bound.`,
      );
    }
    for (const name of readdirSync(target).sort(compareCodePoints)) {
      visit(path.join(target, name), depth + 1);
    }
  };
  visit(root, 0);
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

function fsyncRegularFile(file: string, label: string) {
  const descriptor = openSync(
    file,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new LongTailPromotionSnapshotError(
        `${label} is not a regular file: ${file}.`,
      );
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncRenameParents(sourceParent: string, destinationParent: string) {
  fsyncDirectory(sourceParent);
  if (destinationParent !== sourceParent) fsyncDirectory(destinationParent);
}

function resolveContainedPath(root: string, relative: string, label: string) {
  if (!isSafeRelativePath(relative)) {
    throw new LongTailPromotionSnapshotError(
      `${label} uses an unsafe relative path: ${relative}.`,
    );
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (!isWithin(resolvedRoot, resolved)) {
    throw new LongTailPromotionSnapshotError(
      `${label} escaped its declared root.`,
    );
  }
  assertNoSymlinkComponents(path.dirname(resolved), label);
  const targetKind = pathKind(resolved);
  if (targetKind === "symlink") {
    throw new LongTailPromotionSnapshotError(`${label} is a symbolic link.`);
  }
  return resolved;
}

function assertNoSymlinkComponents(target: string, label: string) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const segments = resolved
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  let cursor = parsed.root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const kind = pathKind(cursor);
    if (kind === "symlink") {
      throw new LongTailPromotionSnapshotError(
        `${label} contains a symbolic-link component: ${cursor}.`,
      );
    }
  }
}

function pathKind(target: string): "missing" | "file" | "directory" | "symlink" {
  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(target);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return "missing";
    throw error;
  }
  if (metadata.isSymbolicLink()) return "symlink";
  if (metadata.isDirectory()) return "directory";
  if (metadata.isFile()) return "file";
  throw new LongTailPromotionSnapshotError(
    `Unsupported filesystem object: ${target}.`,
  );
}

function readPrepared(file: string): PreparedPromotion {
  const parsed = preparedSchema.parse(readJsonFile(file));
  const { preparedSha256, ...material } = parsed;
  if (sha256Canonical(material) !== preparedSha256) {
    throw new LongTailPromotionSnapshotError(
      "PREPARED journal self-hash is invalid.",
    );
  }
  validatePreparedPromotion(file, parsed);
  return parsed;
}

function preparedEntryArtifactMaterial(
  entry: PreparedPromotionEntry,
): NormalizedArtifact["material"] {
  const replacement = entry.replacement
    ? entry.replacement.kind ===
        LONG_TAIL_QUALITY_STALE_REPLACEMENT_APPROVAL_KIND
      ? {
        kind: entry.replacement.kind,
        approvedExistingSha256: entry.replacement.approvedExistingSha256,
        priorSourceHash: entry.replacement.priorSourceHash,
        newSourceHash: entry.replacement.newSourceHash,
        validatorPolicySha256: entry.replacement.validatorPolicySha256,
        backupRelativePath: entry.replacement.backupRelativePath,
      }
      : {
        kind: entry.replacement.kind,
        approvedExistingSha256: entry.replacement.approvedExistingSha256,
        priorSourceHash: entry.replacement.priorSourceHash,
        newSourceHash: entry.replacement.newSourceHash,
        backupRelativePath: entry.replacement.backupRelativePath,
      }
    : undefined;
  return Object.freeze({
    targetRelativePath: entry.targetRelativePath,
    targetSha256: entry.targetSha256,
    targetBytes: entry.targetBytes,
    checkpointRelativePath: entry.checkpointRelativePath,
    checkpointSha256: entry.checkpointSha256,
    checkpointBytes: entry.checkpointBytes,
    ...(replacement ? { replacement: Object.freeze(replacement) } : {}),
  });
}

function publicationCounts(prepared: PreparedPromotion) {
  const counts = { created: 0, replayed: 0, replaced: 0 };
  for (const entry of prepared.entries) {
    if (entry.publication === "created") counts.created += 1;
    else if (entry.publication === "replaced") counts.replaced += 1;
    else counts.replayed += 1;
  }
  return Object.freeze(counts);
}

function validatePreparedPromotion(
  file: string,
  prepared: PreparedPromotion,
): void {
  const transactionDirectory = path.dirname(file);
  if (
    path.basename(file) !== "PREPARED.json" ||
    path.basename(transactionDirectory) !== prepared.transactionId ||
    path.basename(path.dirname(transactionDirectory)) !== "transactions"
  ) {
    throw new LongTailPromotionSnapshotError(
      "PREPARED journal path does not match its transaction identity.",
    );
  }
  const targetPaths = prepared.entries.map((entry) => entry.targetRelativePath);
  const checkpointPaths = prepared.entries.map((entry) =>
    entry.checkpointRelativePath
  );
  const backupPaths = prepared.entries.flatMap((entry) =>
    entry.replacement ? [entry.replacement.backupRelativePath] : []
  );
  assertUniquePortablePaths(targetPaths, "prepared target");
  assertUniquePortablePaths(checkpointPaths, "prepared checkpoint");
  assertUniquePortablePaths(backupPaths, "prepared backup");
  if (
    targetPaths.some((target, index) =>
      index > 0 && compareCodePoints(targetPaths[index - 1] ?? "", target) >= 0
    )
  ) {
    throw new LongTailPromotionSnapshotError(
      "PREPARED entries are not in canonical target-path order.",
    );
  }

  for (const entry of prepared.entries) {
    if (isTranslationSemanticMainAppWorkbenchPath(entry.targetRelativePath)) {
      throw new LongTailPromotionSnapshotError(
        "PREPARED journal targets an ignored main-app workbench path.",
      );
    }
    const replacement = entry.replacement;
    if (
      entry.publication === "created"
        ? entry.prior.state !== "missing" || replacement !== undefined
        : entry.publication === "exact-replay"
        ? entry.prior.state !== "exact" ||
          entry.prior.sha256 !== entry.targetSha256 ||
          replacement !== undefined
        : entry.prior.state !== "exact" ||
          entry.prior.sha256 === entry.targetSha256 ||
          replacement === undefined ||
          replacement.approvedExistingSha256 !== entry.prior.sha256 ||
          replacement.backupSha256 !== entry.prior.sha256 ||
          replacement.approvalSha256 !==
            sha256Canonical(replacementApprovalMaterial(replacement))
    ) {
      throw new LongTailPromotionSnapshotError(
        `PREPARED publication state is inconsistent for ${entry.targetRelativePath}.`,
      );
    }
  }

  const artifacts = prepared.entries.map((entry) => {
    const material = preparedEntryArtifactMaterial(entry);
    artifactMetadataSchema.parse({
      targetRelativePath: material.targetRelativePath,
      checkpointRelativePath: material.checkpointRelativePath,
      ...(material.replacement ? { replacement: material.replacement } : {}),
    });
    return material;
  });
  const artifactSetSha256 = sha256Canonical(artifacts);
  if (artifactSetSha256 !== prepared.artifactSetSha256) {
    throw new LongTailPromotionSnapshotError(
      "PREPARED artifact-set digest is invalid.",
    );
  }
  const semanticEvidence = prepared.semanticEvidence
    ? parseSemanticEvidence(prepared.semanticEvidence)
    : null;
  if (
    semanticEvidence &&
    (semanticEvidence.masterWorklistSha256 !== prepared.masterWorklistSha256 ||
      semanticEvidence.scope.candidatePacks !== prepared.entries.length ||
      !prepared.priorSiteTree.exists ||
      sha256Canonical(semanticEvidence.inputTrees.curated) !==
        sha256Canonical(prepared.priorSiteTree) ||
      !prepared.staticMainAppTree ||
      sha256Canonical(semanticEvidence.inputTrees.staticMainApp) !==
        sha256Canonical(prepared.staticMainAppTree))
  ) {
    throw new LongTailPromotionSnapshotError(
      "PREPARED semantic evidence or input-tree binding is invalid.",
    );
  }
  if (!semanticEvidence && prepared.staticMainAppTree) {
    throw new LongTailPromotionSnapshotError(
      "PREPARED static tree requires semantic evidence.",
    );
  }
  const counts = publicationCounts(prepared);
  if (
    prepared.nextSiteTree.files !==
      prepared.priorSiteTree.files + counts.created ||
    (!prepared.priorSiteTree.exists &&
      (counts.replayed !== 0 || counts.replaced !== 0))
  ) {
    throw new LongTailPromotionSnapshotError(
      "PREPARED site-tree and publication accounting is invalid.",
    );
  }
  const expectedTransactionId = sha256Canonical({
    kind: LONG_TAIL_PROMOTION_TRANSACTION_IDENTITY_KIND,
    masterWorklistSha256: prepared.masterWorklistSha256,
    ...(semanticEvidence ? { semanticEvidence } : {}),
    artifacts,
  });
  if (expectedTransactionId !== prepared.transactionId) {
    throw new LongTailPromotionSnapshotError(
      "PREPARED transaction identity is invalid.",
    );
  }
}

function parseSemanticEvidence(
  value: TranslationSemanticPromotionEvidenceUnion,
): TranslationSemanticPromotionEvidenceUnion {
  const parsed = translationSemanticPromotionEvidenceUnionSchema.parse(value);
  const { semanticEvidenceSha256, ...material } = parsed;
  if (sha256Canonical(material) !== semanticEvidenceSha256) {
    throw new LongTailPromotionSnapshotError(
      "Semantic promotion evidence self-hash is invalid.",
    );
  }
  return parsed;
}

function readCommitted(file: string) {
  const parsed = committedSchema.parse(readJsonFile(file));
  const { committedSha256, ...material } = parsed;
  if (sha256Canonical(material) !== committedSha256) {
    throw new LongTailPromotionSnapshotError(
      "COMMITTED journal self-hash is invalid.",
    );
  }
  if (
    path.basename(file) !== "COMMITTED.json" ||
    path.basename(path.dirname(file)) !== parsed.transactionId ||
    path.basename(path.dirname(path.dirname(file))) !== "transactions"
  ) {
    throw new LongTailPromotionSnapshotError(
      "COMMITTED journal path does not match its transaction identity.",
    );
  }
  return parsed;
}

function readJsonFile(file: string): unknown {
  const bytes = readRegularUnlinkedFile(file);
  try {
    return parseStrictTranslationSemanticJsonBytes(
      bytes,
      `Transaction JSON at ${file}`,
    );
  } catch (error) {
    throw new LongTailPromotionSnapshotError(
      `Transaction JSON is malformed at ${file}: ${boundedError(error)}.`,
    );
  }
}

function verifyCommittedMatchesPrepared(
  committed: z.infer<typeof committedSchema>,
  prepared: PreparedPromotion,
) {
  if (
    committed.transactionId !== prepared.transactionId ||
    committed.masterWorklistSha256 !== prepared.masterWorklistSha256 ||
    committed.preparedSha256 !== prepared.preparedSha256 ||
    sha256Canonical(committed.activeSiteTree) !==
      sha256Canonical(prepared.nextSiteTree) ||
    sha256Canonical(committed.staticMainAppTree ?? null) !==
      sha256Canonical(prepared.staticMainAppTree ?? null)
  ) {
    throw new LongTailPromotionSnapshotError(
      "COMMITTED journal does not match PREPARED.",
    );
  }
}

function withPromotionLock<T>(
  paths: SnapshotPaths,
  transactionId: string,
  operation: () => T,
) {
  mkdirPrivate(paths.transactionRoot);
  const lockPath = path.join(paths.transactionRoot, "PROMOTION.lock");
  acquireLock(lockPath, transactionId);
  try {
    return operation();
  } finally {
    releaseOwnedLock(lockPath, transactionId);
  }
}

function acquireLock(lockPath: string, transactionId: string) {
  if (pathKind(lockPath) === "file") {
    const existing = readLock(lockPath);
    if (existing.hostname !== os.hostname() || processIsAlive(existing.pid)) {
      throw new LongTailPromotionSnapshotError(
        `Another promotion owns the transaction lock for ${existing.transactionId}.`,
      );
    }
    const stale = `${lockPath}.stale-${existing.transactionId}-${randomUUID()}`;
    renameSync(lockPath, stale);
    fsyncDirectory(path.dirname(lockPath));
  } else if (pathKind(lockPath) !== "missing") {
    throw new LongTailPromotionSnapshotError(
      "Promotion lock path is not a regular file.",
    );
  }
  const lock = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    transactionId,
    hostname: os.hostname(),
    pid: process.pid,
  })}\n`, "utf8");
  const descriptor = openSync(
    lockPath,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(descriptor, lock);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(lockPath));
}

function releaseOwnedLock(lockPath: string, transactionId: string) {
  if (pathKind(lockPath) !== "file") return;
  const lock = readLock(lockPath);
  if (
    lock.transactionId !== transactionId ||
    lock.hostname !== os.hostname() ||
    lock.pid !== process.pid
  ) {
    throw new LongTailPromotionSnapshotError(
      "Promotion lock ownership changed before release.",
    );
  }
  unlinkSync(lockPath);
  fsyncDirectory(path.dirname(lockPath));
}

const lockSchema = z.object({
  schemaVersion: z.literal(1),
  transactionId: sha256Schema,
  hostname: z.string().min(1).max(1_024),
  pid: z.number().int().positive(),
}).strict();

function readLock(file: string) {
  return lockSchema.parse(readJsonFile(file));
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isErrno(error, "ESRCH")) return false;
    return true;
  }
}

function boundedBytes(value: Uint8Array, label: string) {
  if (!(value instanceof Uint8Array)) {
    throw new LongTailPromotionSnapshotError(`${label} bytes are not Uint8Array.`);
  }
  if (!value.byteLength || value.byteLength > MAXIMUM_ARTIFACT_BYTES) {
    throw new LongTailPromotionSnapshotError(
      `${label} bytes must be between one byte and 64 MiB.`,
    );
  }
  return Buffer.from(value);
}

function assertJsonObjectBytes(bytes: Buffer, label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new LongTailPromotionSnapshotError(
      `${label} artifact is not valid JSON: ${boundedError(error)}.`,
    );
  }
  if (!isUnknownRecord(parsed)) {
    throw new LongTailPromotionSnapshotError(
      `${label} artifact JSON must be an object.`,
    );
  }
}

function isSafeRelativePath(value: string) {
  return Boolean(
    value &&
      !value.includes("\u0000") &&
      !value.includes("\\") &&
      !path.posix.isAbsolute(value) &&
      path.posix.normalize(value) === value &&
      value.split("/").every(
        (segment) => segment && segment !== "." && segment !== "..",
      ),
  );
}

function assertUniquePortablePaths(values: readonly string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    const key = portableCollisionKey(value);
    if (seen.has(key)) {
      throw new LongTailPromotionSnapshotError(
        `Duplicate or portable-case-colliding ${label} path: ${value}.`,
      );
    }
    seen.add(key);
  }
}

function portableCollisionKey(value: string) {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(
    relative &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative),
  );
}

function prettyJsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256Buffer(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Canonical(value: unknown) {
  return sha256Buffer(Buffer.from(canonicalJson(value), "utf8"));
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LongTailPromotionSnapshotError(
        "Canonical JSON cannot encode a non-finite number.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isUnknownRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareCodePoints(left, right));
    return `{${entries.map(([key, entry]) =>
      `${JSON.stringify(key)}:${canonicalJson(entry)}`
    ).join(",")}}`;
  }
  throw new LongTailPromotionSnapshotError(
    `Canonical JSON cannot encode ${typeof value}.`,
  );
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}
