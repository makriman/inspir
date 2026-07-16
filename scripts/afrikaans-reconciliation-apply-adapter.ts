import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  type BigIntStats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { validateTranslationCandidateField } from "@/lib/i18n/translation-candidate-quality";
import {
  AFRIKAANS_RECONCILIATION_FROZEN_V3_POLICY,
  type AfrikaansReconciliationFrozenPolicy,
} from "./afrikaans-reconciliation-frozen-policy";
import {
  verifyAfrikaansEscalationResolution,
  type AfrikaansEscalationResolutionFrozenPolicy,
  type AfrikaansEscalationResolutionVerification,
} from "./afrikaans-escalation-resolution-verifier";
import {
  validateTranslationRepairCandidateDirectories,
  type TranslationCandidateQaExceptionPolicy,
  type TranslationCandidateQaReviewedException,
} from "./validate-translation-repair-candidates";

const MAXIMUM_JSON_BYTES = 32 * 1024 * 1024;
const MAXIMUM_JSON_DEPTH = 64;
const ADAPTER_KIND = "afrikaans-reconciliation-apply-adapter-v2";
const OWNER_ACCEPTANCE_KIND = "afrikaans-reconciliation-owner-acceptance-v2";
const HYBRID_MANIFEST_KIND = "translation-hybrid-candidate-manifest";
const HYBRID_DRAFT_MODEL = "afrikaans-owner-reconciled-v2";
const TRUST_MODEL = "trusted-single-user-local-workspace";
const AUTHENTICATION_MODEL = "none";
const ATTESTATION_KIND = "procedural-self-attestation";
const AUTHORITY_SCOPE = "ignored-materialization-only";
const PREPARED_PLAN_KIND = "afrikaans-residual-repair-workbench-plan-v1";
const PARTITION_PLAN_KIND = "afrikaans-parallel-semantic-adjudication-plan-v1";
const REVIEW_BUNDLE_KIND = "afrikaans-parallel-semantic-review-bundle-v1";
const REVIEW_EVIDENCE_KIND = "afrikaans-semantic-review-evidence-v1";
const RECONCILIATION_KIND = "afrikaans-semantic-review-reconciliation-v2";
const DIAGNOSTIC_MANIFEST_KIND =
  "afrikaans-residual-repair-diagnostic-proposal-manifest-v1";
const EXPECTED_CANDIDATE_FILES = [
  "af/main-app.json",
  "af/marketing-shell.json",
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const utcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u)
  .refine(isCanonicalUtcTimestamp, "Timestamp must be a real canonical UTC instant.");
const namespaceSchema = z.enum(["main-app", "marketing-shell"]);
const reviewerIdSchema = z.enum(["reviewer-a", "reviewer-b"]);

const reviewedCandidateQaExceptionSchema = z
  .object({
    kind: z.literal("reviewed-candidate-field-exception-v1"),
    language: z.literal("Afrikaans"),
    locale: z.literal("af"),
    namespace: namespaceSchema,
    sourceHash: sha256Schema,
    key: z.string().min(1),
    sourceSha256: sha256Schema,
    valueSha256: sha256Schema,
    decisionIdentitySha256: sha256Schema,
    proposalIdentitySha256: sha256Schema,
    fieldIdentitySha256: sha256Schema,
    reviewerId: reviewerIdSchema,
    authority: z.literal("original-review-evidence"),
    verdict: z.literal("preserve-current"),
    failures: z.tuple([z.literal("protected-literal-parity")]),
  })
  .strict();

const AFRIKAANS_REVIEWED_CANDIDATE_QA_EXCEPTION = Object.freeze({
  kind: "reviewed-candidate-field-exception-v1",
  language: "Afrikaans",
  locale: "af",
  namespace: "main-app",
  sourceHash: "fa5fea90383a0633c245723dd10edef065b80e2d80b41570651ab175b83d4fd0",
  key: "topic.draw-sketch-board.name",
  sourceSha256: "c1edc007f61be0298a886b3c6f74ee0fa5138f86f17c6d686f1bf701d27c620c",
  valueSha256: "6f571e8cf1f416dba231c19b386f8299f32bdcfd7e9fe7a0cbd0feacdaecdce3",
  decisionIdentitySha256:
    "0f5cde518dedd32c6a2b2301179cbb9f3402e14366f894c4c416e4441185fc97",
  proposalIdentitySha256:
    "7dab9684afab490e216a7084b6d2ebd32a0265c408b3297030106bf912401a49",
  fieldIdentitySha256:
    "5756f86de4525e4cc04a503f15cf6706cc4ca14f3d7a313dac5772aa5f684a72",
  reviewerId: "reviewer-a",
  authority: "original-review-evidence",
  verdict: "preserve-current",
  failures: Object.freeze(["protected-literal-parity"] as const),
} satisfies TranslationCandidateQaReviewedException);

const fieldSchema = z
  .object({
    language: z.literal("Afrikaans"),
    locale: z.literal("af"),
    namespace: namespaceSchema,
    sourceHash: sha256Schema,
    key: z.string().min(1),
    source: z.string().min(1),
    sourceSha256: sha256Schema,
    currentValue: z.string().min(1),
    currentValueSha256: sha256Schema,
  })
  .strict();

const repairScopeEntrySchema = z
  .object({
    language: z.literal("Afrikaans"),
    locale: z.literal("af"),
    namespace: namespaceSchema,
    sourceHash: sha256Schema,
    key: z.string().refine((value) => Boolean(value.trim()), "Scope key must be nonempty."),
    source: z
      .string()
      .refine((value) => Boolean(value.trim()), "Scope source must be nonempty."),
    existingCandidate: z.string().nullable(),
    reasons: z
      .array(
        z
          .string()
          .refine((value) => Boolean(value.trim()), "Scope reason must be nonempty."),
      )
      .min(1),
  })
  .strict();

const repairScopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("translation-repair-scope"),
    fields: z.number().int().positive(),
    sourceHashes: z
      .object({
        "main-app": sha256Schema,
        "marketing-shell": sha256Schema,
      })
      .strict(),
    entries: z.array(repairScopeEntrySchema).min(1),
    canonicalSha256: sha256Schema,
  })
  .strict();

const exactDecisionSchema = z
  .object({
    action: z.enum(["preserve", "replace"]),
    evidence: z.string().min(1),
    reviewPairIdentitySha256: sha256Schema.nullable(),
    reviewFieldIdentitySha256: sha256Schema.nullable(),
    field: fieldSchema,
    decidedValue: z.string().min(1),
    decidedValueSha256: sha256Schema,
  })
  .strict()
  .superRefine((decision, context) => {
    const isPlannerAdded = decision.evidence === "planner-added:source-trigram-repair";
    const pairIsNull = decision.reviewPairIdentitySha256 === null;
    const fieldIsNull = decision.reviewFieldIdentitySha256 === null;
    if (pairIsNull !== fieldIsNull) {
      context.addIssue({
        code: "custom",
        message: "Exact decisions must keep both review identity hashes or neither.",
      });
    }
    if (isPlannerAdded) {
      if (decision.action !== "replace" || !pairIsNull || !fieldIsNull) {
        context.addIssue({
          code: "custom",
          message:
            "Planner-added source-trigram repairs must be replacements with null review identities.",
        });
      }
    } else if (pairIsNull || fieldIsNull) {
      context.addIssue({
        code: "custom",
        message: "Review-backed exact decisions require both review identity hashes.",
      });
    }
  });

const unresolvedFieldSchema = z
  .object({
    field: fieldSchema,
    disposition: z.literal("requires-owner-semantic-adjudication"),
  })
  .strict();

const worklistEntrySchema = z
  .object({
    key: z.string().min(1),
    source: z.string().min(1),
    existingCandidate: z.string().nullable(),
    reasons: z.array(z.string().min(1)).min(1),
    value: z.literal(""),
  })
  .strict();

const worklistSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("translation-repair-worklist"),
    protectorVersion: z.string().min(1),
    protectorFingerprint: sha256Schema,
    language: z.literal("Afrikaans"),
    locale: z.literal("af"),
    namespace: namespaceSchema,
    sourceHash: sha256Schema,
    entries: z.array(worklistEntrySchema).min(1),
  })
  .strict();

const candidateEntrySchema = worklistEntrySchema.extend({ value: z.string().min(1) });
const candidateSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("translation-repair-candidate"),
    protectorVersion: z.string().min(1),
    protectorFingerprint: sha256Schema,
    language: z.literal("Afrikaans"),
    locale: z.literal("af"),
    namespace: namespaceSchema,
    sourceHash: sha256Schema,
    entries: z.array(candidateEntrySchema).min(1),
    draftModel: z.string().min(1),
  })
  .strict();

const memberSchema = z
  .object({
    fieldIdentitySha256: sha256Schema,
    namespace: namespaceSchema,
    sourceHash: sha256Schema,
    key: z.string().min(1),
  })
  .strict();

const semanticDecisionSchema = z
  .object({
    decisionIdentitySha256: sha256Schema,
    language: z.literal("Afrikaans"),
    locale: z.literal("af"),
    source: z.string().min(1),
    sourceSha256: sha256Schema,
    currentValue: z.string().min(1),
    currentValueSha256: sha256Schema,
    fieldCount: z.number().int().positive(),
    members: z.array(memberSchema).min(1),
  })
  .strict();

const proposalSchema = semanticDecisionSchema.extend({
  proposalIdentitySha256: sha256Schema,
  proposedValue: z.string().min(1),
  proposedValueSha256: sha256Schema,
});

const reviewerPartitionSchema = z
  .object({
    reviewerId: reviewerIdSchema,
    decisionCount: z.number().int().positive(),
    fieldCount: z.number().int().positive(),
    partitionRootSha256: sha256Schema,
    decisionIds: z.array(sha256Schema).min(1),
  })
  .strict();

const reviewerBundlePartitionSchema = z
  .object({
    reviewerId: reviewerIdSchema,
    partitionRootSha256: sha256Schema,
    decisionCount: z.number().int().positive(),
    fieldCount: z.number().int().positive(),
    proposals: z.array(proposalSchema).min(1),
  })
  .strict();

const reviewEvidenceDecisionSchema = z
  .object({
    decisionIdentitySha256: sha256Schema,
    proposalIdentitySha256: sha256Schema,
    verdict: z.enum(["accept-proposal", "preserve-current", "escalate"]),
    finalValue: z.string().min(1).nullable(),
    finalValueSha256: sha256Schema.nullable(),
    rationale: z.string().min(1),
  })
  .strict();

const reviewEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(REVIEW_EVIDENCE_KIND),
    diagnosticOnly: z.literal(true),
    trackedWritesPerformed: z.literal(false),
    trackedWritesPermitted: z.literal(false),
    promotePermitted: z.literal(false),
    importPermitted: z.literal(false),
    applyPermitted: z.literal(false),
    releaseAttestation: z.literal(false),
    inputBindings: z
      .object({
        partitionPlanSha256: sha256Schema,
        reviewBundleSha256: sha256Schema,
        preparedPlanSha256: sha256Schema,
        decisionRootSha256: sha256Schema,
        partitionRootSha256: sha256Schema,
        proposalRootSha256: sha256Schema,
        candidateTreeSha256: sha256Schema,
      })
      .strict(),
    reviewer: z
      .object({
        reviewerId: reviewerIdSchema,
        reviewerName: z.string().min(1),
        completedAtUtc: utcTimestampSchema,
      })
      .strict(),
    summary: z
      .object({
        decisions: z.number().int().nonnegative(),
        fields: z.number().int().nonnegative(),
        acceptedProposals: z.number().int().nonnegative(),
        preservedCurrentValues: z.number().int().nonnegative(),
        escalations: z.number().int().nonnegative(),
      })
      .strict(),
    decisions: z.array(reviewEvidenceDecisionSchema),
  })
  .strict();

const fileDescriptorSchema = z
  .object({
    path: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
  })
  .strict();

const treeFileDescriptorSchema = z
  .object({
    relativePath: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: sha256Schema,
  })
  .strict();

const treeDescriptorSchema = z
  .object({
    path: z.string().min(1),
    files: z.array(treeFileDescriptorSchema).min(1),
    fields: z.number().int().positive(),
    treeSha256: sha256Schema,
  })
  .strict();

const reviewerEvidenceDescriptorSchema = fileDescriptorSchema.extend({
  reviewerId: reviewerIdSchema,
});

const resolutionProposalActorSchema = z
  .object({
    author: z
      .object({
        authorName: z.string().min(1),
        identityAssurance: z.literal("trusted-local-assertion"),
        authoredAtUtc: utcTimestampSchema,
      })
      .strict(),
  })
  .passthrough();

const resolutionReviewActorSchema = z
  .object({
    reviewer: z
      .object({
        reviewerName: z.string().min(1),
        identityAssurance: z.literal("trusted-local-assertion"),
        completedAtUtc: utcTimestampSchema,
      })
      .strict(),
  })
  .passthrough();

const ownerAcceptanceSchema = z
  .object({
    schemaVersion: z.literal(2),
    kind: z.literal(OWNER_ACCEPTANCE_KIND),
    trustModel: z.literal(TRUST_MODEL),
    authentication: z.literal(AUTHENTICATION_MODEL),
    attestationKind: z.literal(ATTESTATION_KIND),
    authorityScope: z.literal(AUTHORITY_SCOPE),
    cryptographicIdentityVerified: z.literal(false),
    ownerName: z.string().min(1),
    acceptedAtUtc: utcTimestampSchema,
    authority: z
      .object({
        materializeValidatorBackedCandidates: z.literal(true),
        applyTrackedTranslations: z.literal(false),
        promoteCandidates: z.literal(false),
        importCandidates: z.literal(false),
        releaseAttestation: z.literal(false),
      })
      .strict(),
    bindings: z
      .object({
        adapterImplementationSha256: sha256Schema,
        candidateValidatorImplementationSha256: sha256Schema,
        preparedPlanSha256: sha256Schema,
        partitionPlanSha256: sha256Schema,
        reviewBundleSha256: sha256Schema,
        reviewerAEvidenceSha256: sha256Schema,
        reviewerBEvidenceSha256: sha256Schema,
        resolutionVerifierImplementationSha256: sha256Schema,
        resolutionFrozenPolicySha256: sha256Schema,
        resolutionValidatorPolicySha256: sha256Schema,
        thirdValueProposalsSha256: sha256Schema,
        thirdValueReviewSha256: sha256Schema,
        escalationDecisionRootSha256: sha256Schema,
        thirdValueRootSha256: sha256Schema,
        resolvedEscalationDecisionRootSha256: sha256Schema,
        reconciliationSha256: sha256Schema,
        diagnosticManifestSha256: sha256Schema,
        diagnosticCandidateTreeSha256: sha256Schema,
        repairWorklistTreeSha256: sha256Schema,
        exactDecisionRootSha256: sha256Schema,
        unresolvedSemanticRootSha256: sha256Schema,
        reconciledDecisionRootSha256: sha256Schema,
        finalValueRootSha256: sha256Schema,
      })
      .strict(),
    canonicalSha256: sha256Schema,
  })
  .strict();

const manifestIdentitySchema = z
  .object({
    namespace: namespaceSchema,
    sourceHash: sha256Schema,
    key: z.string().min(1),
    sourceSha256: sha256Schema,
    valueSha256: sha256Schema,
    authority: z.enum([
      "locked-prepared-plan",
      "reviewer-reconciliation",
      "approved-third-value-resolution",
    ]),
  })
  .strict();

const reconciliationManifestProvenanceSchema = z
  .object({
    adapterKind: z.literal(ADAPTER_KIND),
    repoRoot: z.string().min(1),
    adapterImplementation: fileDescriptorSchema,
    candidateValidatorImplementation: fileDescriptorSchema,
    frozenPlanVersion: z.literal("afrikaans-residual-repair-workbench-v3"),
    preparedPlan: fileDescriptorSchema,
    workbench: fileDescriptorSchema,
    workbenchReadme: fileDescriptorSchema,
    noModelGateEvidence: fileDescriptorSchema,
    scope: fileDescriptorSchema,
    worklist: treeDescriptorSchema,
    diagnosticManifest: fileDescriptorSchema,
    diagnosticCandidates: treeDescriptorSchema,
    partitionLaneImplementation: fileDescriptorSchema,
    reviewEvidenceSchema: fileDescriptorSchema,
    partitionPlan: fileDescriptorSchema,
    reviewBundle: fileDescriptorSchema,
    reviewerEvidence: z
      .tuple([reviewerEvidenceDescriptorSchema, reviewerEvidenceDescriptorSchema]),
    resolutionVerifierImplementation: fileDescriptorSchema,
    thirdValueProposals: fileDescriptorSchema,
    thirdValueReview: fileDescriptorSchema,
    resolutionFrozenPolicySha256: sha256Schema,
    resolutionValidatorPolicySha256: sha256Schema,
    escalationDecisionRootSha256: sha256Schema,
    thirdValueRootSha256: sha256Schema,
    resolvedEscalationDecisionRootSha256: sha256Schema,
    reconciliation: fileDescriptorSchema,
    ownerAcceptance: fileDescriptorSchema,
    exactDecisionRootSha256: sha256Schema,
    unresolvedSemanticRootSha256: sha256Schema,
    reconciledDecisionRootSha256: sha256Schema,
    finalValueRootSha256: sha256Schema,
  })
  .strict();

const reconciliationHybridManifestSchema = z
  .object({
    schemaVersion: z.literal(3),
    kind: z.literal(HYBRID_MANIFEST_KIND),
    hybridDraftModel: z.literal(HYBRID_DRAFT_MODEL),
    provenance: reconciliationManifestProvenanceSchema,
    output: treeDescriptorSchema.extend({ draftModel: z.literal(HYBRID_DRAFT_MODEL) }),
    counts: z
      .object({
        files: z.number().int().positive(),
        fields: z.number().int().positive(),
        replacedFields: z.number().int().nonnegative(),
        lockedFields: z.number().int().nonnegative(),
        reviewerReconciledFields: z.number().int().nonnegative(),
        resolvedEscalationFields: z.number().int().nonnegative(),
        ordinaryCandidateQaFields: z.number().int().nonnegative(),
        reviewedCandidateQaExceptionFields: z.number().int().nonnegative(),
      })
      .strict(),
    identities: z.array(manifestIdentitySchema).min(1),
    canonicalSha256: sha256Schema,
  })
  .strict();

type Field = z.infer<typeof fieldSchema>;
type RepairScope = z.infer<typeof repairScopeSchema>;
type RepairScopeEntry = z.infer<typeof repairScopeEntrySchema>;
type ExactDecision = z.infer<typeof exactDecisionSchema>;
type Worklist = z.infer<typeof worklistSchema>;
type Candidate = z.infer<typeof candidateSchema>;
type SemanticDecision = z.infer<typeof semanticDecisionSchema>;
type Proposal = z.infer<typeof proposalSchema>;
type ReviewerPartition = z.infer<typeof reviewerPartitionSchema>;
type ReviewerBundlePartition = z.infer<typeof reviewerBundlePartitionSchema>;
type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>;
type FileDescriptor = z.infer<typeof fileDescriptorSchema>;
type TreeDescriptor = z.infer<typeof treeDescriptorSchema>;
type OwnerAcceptance = z.infer<typeof ownerAcceptanceSchema>;
type ManifestIdentity = z.infer<typeof manifestIdentitySchema>;
type FinalCandidateValue = {
  value: string;
  valueSha256: string;
  authority: ManifestIdentity["authority"];
  reconciledDecision?: ReconciledDecision;
};
type ResolutionActorMetadata = Readonly<{
  proposalAuthorName: string;
  proposalAuthoredAtUtc: string;
  reviewerName: string;
  reviewedAtUtc: string;
}>;
type ReconciledDecision = Readonly<{
  decisionIdentitySha256: string;
  proposalIdentitySha256: string;
  originalReviewerId: "reviewer-a" | "reviewer-b";
  originalVerdict: "accept-proposal" | "preserve-current" | "escalate";
  authority: "original-review-evidence" | "approved-third-value-resolution";
  finalValue: string;
  finalValueSha256: string;
  fieldCount: number;
  members: readonly z.infer<typeof memberSchema>[];
  originalRationale: string;
}>;

export type { AfrikaansReconciliationFrozenPolicy } from "./afrikaans-reconciliation-frozen-policy";

export type AfrikaansReconciliationAdapterPaths = Readonly<{
  repoRoot: string;
  adapterImplementationPath: string;
  candidateValidatorImplementationPath: string;
  preparedPlanPath: string;
  workbenchPath: string;
  workbenchReadmePath: string;
  noModelGateEvidencePath: string;
  scopePath: string;
  worklistDir: string;
  diagnosticManifestPath: string;
  diagnosticCandidateDir: string;
  partitionLaneImplementationPath: string;
  reviewEvidenceSchemaPath: string;
  partitionPlanPath: string;
  reviewBundlePath: string;
  reviewerAEvidencePath: string;
  reviewerBEvidencePath: string;
  resolutionVerifierImplementationPath: string;
  thirdValueProposalsPath: string;
  thirdValueReviewPath: string;
  reconciliationPath: string;
}>;

export type VerifyAfrikaansReconciliationArgs = Readonly<{
  paths: AfrikaansReconciliationAdapterPaths;
}>;

export type MaterializeAfrikaansReconciliationArgs = VerifyAfrikaansReconciliationArgs &
  Readonly<{
    execute: boolean;
    ownerAcceptancePath: string;
    outputCandidateDir: string;
    manifestPath: string;
  }>;

export type AfrikaansReconciliationVerification = Readonly<{
  files: number;
  fields: number;
  lockedFields: number;
  reconciledFields: number;
  reviewerReconciledFields: number;
  resolvedEscalationFields: number;
  replacedFields: number;
  ordinaryCandidateQaFields: number;
  reviewedCandidateQaExceptionFields: number;
  finalValueRootSha256: string;
  reconciledDecisionRootSha256: string;
  candidates: readonly Candidate[];
  ownerAcceptanceRequest: Readonly<{
    kind: "afrikaans-reconciliation-owner-acceptance-request-v2";
    diagnosticOnly: true;
    grantsAuthority: false;
    ownerAcceptanceKind: typeof OWNER_ACCEPTANCE_KIND;
    trustModel: typeof TRUST_MODEL;
    authentication: typeof AUTHENTICATION_MODEL;
    attestationKind: typeof ATTESTATION_KIND;
    authorityScope: typeof AUTHORITY_SCOPE;
    cryptographicIdentityVerified: false;
    bindings: OwnerAcceptance["bindings"];
  }>;
}>;

export type AfrikaansReconciliationManifestValidation = Readonly<{
  manifestPath: string;
  worklistDir: string;
  candidateDir: string;
  files: number;
  fields: number;
  replacedFields: number;
  ordinaryCandidateQaFields: number;
  reviewedCandidateQaExceptionFields: number;
  draftModel: string;
  canonicalSha256: string;
}>;

type LoadedCore = {
  paths: AfrikaansReconciliationAdapterPaths;
  policy: AfrikaansReconciliationFrozenPolicy;
  preparedPlan: Record<string, unknown>;
  exactDecisions: ExactDecision[];
  worklists: Worklist[];
  worklistDescriptor: TreeDescriptor;
  diagnosticCandidateDescriptor: TreeDescriptor;
  partitionPlan: Record<string, unknown>;
  reviewBundle: Record<string, unknown>;
  reviewerEvidence: [ReviewEvidence, ReviewEvidence];
  reconciliation: Record<string, unknown>;
  resolutionVerification: AfrikaansEscalationResolutionVerification;
  resolutionActors: ResolutionActorMetadata;
  reviewerReconciledFields: number;
  resolvedEscalationFields: number;
  reconciledDecisionRootSha256: string;
  finalValueRootSha256: string;
  candidates: Candidate[];
  identities: ManifestIdentity[];
  replacedFields: number;
  ordinaryCandidateQaFields: number;
  reviewedCandidateQaExceptionFields: number;
  candidateQaExceptionPolicy?: TranslationCandidateQaExceptionPolicy;
  descriptors: {
    adapterImplementation: FileDescriptor;
    candidateValidatorImplementation: FileDescriptor;
    preparedPlan: FileDescriptor;
    workbench: FileDescriptor;
    workbenchReadme: FileDescriptor;
    noModelGateEvidence: FileDescriptor;
    scope: FileDescriptor;
    diagnosticManifest: FileDescriptor;
    partitionLaneImplementation: FileDescriptor;
    reviewEvidenceSchema: FileDescriptor;
    partitionPlan: FileDescriptor;
    reviewBundle: FileDescriptor;
    reviewerEvidence: [FileDescriptor & { reviewerId: "reviewer-a" }, FileDescriptor & { reviewerId: "reviewer-b" }];
    resolutionVerifierImplementation: FileDescriptor;
    thirdValueProposals: FileDescriptor;
    thirdValueReview: FileDescriptor;
    reconciliation: FileDescriptor;
  };
};

type AdapterVerificationContext = Readonly<{
  policy: AfrikaansReconciliationFrozenPolicy;
  nowEpochMs: number;
  expectedAdapterPath: string;
  expectedRepoRoot: string;
  testHooks?: Readonly<{
    beforeCoreSettlement?: (paths: AfrikaansReconciliationAdapterPaths) => void;
    beforeOutputReservation?: () => void;
    beforeManifestCreate?: (outputCandidateDir: string, manifestPath: string) => void;
  }>;
}>;

type InternalVerifyAfrikaansReconciliationArgs = VerifyAfrikaansReconciliationArgs &
  Readonly<{ context: AdapterVerificationContext }>;

type InternalMaterializeAfrikaansReconciliationArgs = MaterializeAfrikaansReconciliationArgs &
  Readonly<{ context: AdapterVerificationContext }>;

const ACTUAL_ADAPTER_PATH = realpathSync(fileURLToPath(import.meta.url));
const ACTUAL_REPO_ROOT = realpathSync(resolve(dirname(ACTUAL_ADAPTER_PATH), ".."));
const ACTUAL_RESOLUTION_VERIFIER_PATH = realpathSync(
  resolve(dirname(ACTUAL_ADAPTER_PATH), "afrikaans-escalation-resolution-verifier.ts"),
);
const ACTUAL_CANDIDATE_VALIDATOR_PATH = realpathSync(
  resolve(dirname(ACTUAL_ADAPTER_PATH), "validate-translation-repair-candidates.ts"),
);

export function defaultAfrikaansReconciliationAdapterPaths(
  repoRoot = process.cwd(),
): AfrikaansReconciliationAdapterPaths {
  const root = resolve(repoRoot);
  return Object.freeze({
    repoRoot: root,
    adapterImplementationPath: fileURLToPath(import.meta.url),
    candidateValidatorImplementationPath: ACTUAL_CANDIDATE_VALIDATOR_PATH,
    preparedPlanPath: join(root, "tmp/afrikaans-residual-repair-workbench-v1/prepared-plan.json"),
    workbenchPath: join(root, "tmp/afrikaans-residual-repair-workbench-v1/workbench.ts"),
    workbenchReadmePath: join(root, "tmp/afrikaans-residual-repair-workbench-v1/README.md"),
    noModelGateEvidencePath: join(
      root,
      "tmp/afrikaans-residual-repair-workbench-v1/no-model-gate-evidence.json",
    ),
    scopePath: join(root, "tmp/afrikaans-residual-repair-scope-v1.json"),
    worklistDir: join(root, "tmp/afrikaans-residual-repair-workbench-v1/repair-worklists"),
    diagnosticManifestPath: join(
      root,
      "tmp/afrikaans-residual-repair-workbench-v1/diagnostic-proposal-manifest.json",
    ),
    diagnosticCandidateDir: join(
      root,
      "tmp/afrikaans-residual-repair-workbench-v1/repair-candidates",
    ),
    partitionLaneImplementationPath: join(root, "tmp/af-adjudication-parallel-plan-v1/lane.mjs"),
    reviewEvidenceSchemaPath: join(
      root,
      "tmp/af-adjudication-parallel-plan-v1/review-evidence.schema.json",
    ),
    partitionPlanPath: join(root, "tmp/af-adjudication-parallel-plan-v1/partition-plan.json"),
    reviewBundlePath: join(root, "tmp/af-adjudication-parallel-plan-v1/review-bundle.json"),
    reviewerAEvidencePath: join(
      root,
      "tmp/af-adjudication-parallel-plan-v1/reviewer-a-evidence.json",
    ),
    reviewerBEvidencePath: join(
      root,
      "tmp/af-adjudication-parallel-plan-v1/reviewer-b-evidence.json",
    ),
    resolutionVerifierImplementationPath: ACTUAL_RESOLUTION_VERIFIER_PATH,
    thirdValueProposalsPath: join(
      root,
      "tmp/af-adjudication-parallel-plan-v1/escalation-third-value-proposals.json",
    ),
    thirdValueReviewPath: join(
      root,
      "tmp/af-adjudication-parallel-plan-v1/escalation-third-value-review.json",
    ),
    reconciliationPath: join(root, "tmp/af-adjudication-parallel-plan-v1/reconciliation.json"),
  });
}

function productionVerificationContext(): AdapterVerificationContext {
  return buildVerificationContext(AFRIKAANS_RECONCILIATION_FROZEN_V3_POLICY, Date.now());
}

function buildVerificationContext(
  policy: AfrikaansReconciliationFrozenPolicy,
  nowEpochMs: number,
  testHooks?: AdapterVerificationContext["testHooks"],
): AdapterVerificationContext {
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
    throw new Error("Adapter verification clock must be a non-negative safe integer.");
  }
  return Object.freeze({
    policy,
    nowEpochMs,
    expectedAdapterPath: ACTUAL_ADAPTER_PATH,
    expectedRepoRoot: ACTUAL_REPO_ROOT,
    ...(testHooks ? { testHooks } : {}),
  });
}

/**
 * Synthetic-policy seam for isolated fixtures. Production CLI and manifest
 * consumers never call this object and cannot select its policy or clock.
 */
export const __testOnlyAfrikaansReconciliationAdapter = Object.freeze({
  reviewedCandidateQaExceptionBinding: AFRIKAANS_REVIEWED_CANDIDATE_QA_EXCEPTION,
  validateReviewedCandidateQaExceptionBinding(value: unknown) {
    return validateFrozenReviewedCandidateQaExceptionBinding(value);
  },
  verify(
    args: VerifyAfrikaansReconciliationArgs & {
      policy: AfrikaansReconciliationFrozenPolicy;
      nowEpochMs?: number;
      testHooks?: AdapterVerificationContext["testHooks"];
    },
  ) {
    return verifyAfrikaansReconciliationApplyAdapterInternal({
      paths: args.paths,
      context: buildVerificationContext(
        args.policy,
        args.nowEpochMs ?? Date.now(),
        args.testHooks,
      ),
    });
  },
  materialize(
    args: MaterializeAfrikaansReconciliationArgs & {
      policy: AfrikaansReconciliationFrozenPolicy;
      nowEpochMs?: number;
      testHooks?: AdapterVerificationContext["testHooks"];
    },
  ) {
    return materializeAfrikaansReconciliationApplyAdapterInternal({
      paths: args.paths,
      execute: args.execute,
      ownerAcceptancePath: args.ownerAcceptancePath,
      outputCandidateDir: args.outputCandidateDir,
      manifestPath: args.manifestPath,
      context: buildVerificationContext(
        args.policy,
        args.nowEpochMs ?? Date.now(),
        args.testHooks,
      ),
    });
  },
  validateManifest(
    args: {
      worklistDir: string;
      candidateDir: string;
      manifestPath: string;
      policy: AfrikaansReconciliationFrozenPolicy;
      nowEpochMs?: number;
    },
  ) {
    return validateAfrikaansReconciliationHybridCandidateManifestInternal({
      worklistDir: args.worklistDir,
      candidateDir: args.candidateDir,
      manifestPath: args.manifestPath,
      context: buildVerificationContext(args.policy, args.nowEpochMs ?? Date.now()),
    });
  },
});

export function verifyAfrikaansReconciliationApplyAdapter(
  args: VerifyAfrikaansReconciliationArgs,
): AfrikaansReconciliationVerification {
  return verifyAfrikaansReconciliationApplyAdapterInternal({
    ...args,
    context: productionVerificationContext(),
  });
}

function verifyAfrikaansReconciliationApplyAdapterInternal(
  args: InternalVerifyAfrikaansReconciliationArgs,
): AfrikaansReconciliationVerification {
  const core = loadAndVerifyCore(args);
  return Object.freeze({
    files: core.candidates.length,
    fields: core.candidates.reduce((sum, candidate) => sum + candidate.entries.length, 0),
    lockedFields: core.exactDecisions.length,
    reconciledFields: core.policy.unresolvedFields,
    reviewerReconciledFields: core.reviewerReconciledFields,
    resolvedEscalationFields: core.resolvedEscalationFields,
    replacedFields: core.replacedFields,
    ordinaryCandidateQaFields: core.ordinaryCandidateQaFields,
    reviewedCandidateQaExceptionFields: core.reviewedCandidateQaExceptionFields,
    finalValueRootSha256: core.finalValueRootSha256,
    reconciledDecisionRootSha256: core.reconciledDecisionRootSha256,
    candidates: Object.freeze(core.candidates),
    ownerAcceptanceRequest: Object.freeze({
      kind: "afrikaans-reconciliation-owner-acceptance-request-v2",
      diagnosticOnly: true,
      grantsAuthority: false,
      ownerAcceptanceKind: OWNER_ACCEPTANCE_KIND,
      trustModel: TRUST_MODEL,
      authentication: AUTHENTICATION_MODEL,
      attestationKind: ATTESTATION_KIND,
      authorityScope: AUTHORITY_SCOPE,
      cryptographicIdentityVerified: false,
      bindings: buildOwnerAcceptanceBindings(core),
    }),
  });
}

export function materializeAfrikaansReconciliationApplyAdapter(
  args: MaterializeAfrikaansReconciliationArgs,
): AfrikaansReconciliationManifestValidation {
  return materializeAfrikaansReconciliationApplyAdapterInternal({
    ...args,
    context: productionVerificationContext(),
  });
}

function materializeAfrikaansReconciliationApplyAdapterInternal(
  args: InternalMaterializeAfrikaansReconciliationArgs,
): AfrikaansReconciliationManifestValidation {
  if (args.execute !== true) {
    throw new Error("Materialization requires the explicit execute boundary.");
  }
  const core = loadAndVerifyCore(args);
  const ownerAcceptance = readAndValidateOwnerAcceptance(
    args.ownerAcceptancePath,
    core,
    args.context.nowEpochMs,
  );
  const outputCandidateDir = assertNewIgnoredOutputDirectory(
    args.outputCandidateDir,
    core.paths.repoRoot,
    "Output candidate directory",
  );
  const manifestPath = assertNewIgnoredOutputFile(
    args.manifestPath,
    core.paths.repoRoot,
    "Hybrid candidate manifest",
  );
  assertDifferentPaths(
    [outputCandidateDir, manifestPath, ...Object.values(core.paths)],
    "Adapter inputs and outputs",
  );
  assertPathOutsideDirectory(manifestPath, outputCandidateDir, "Hybrid candidate manifest");

  let ownedCandidateRoot: OwnedPath | null = null;
  let ownedLocaleRoot: OwnedPath | null = null;
  const ownedCandidateFiles: OwnedPath[] = [];
  let ownedManifest: OwnedPath | null = null;
  try {
    args.context.testHooks?.beforeOutputReservation?.();
    mkdirSync(outputCandidateDir, { recursive: false, mode: 0o700 });
    ownedCandidateRoot = captureOwnedPath(
      outputCandidateDir,
      "directory",
      "Output candidate directory",
    );
    const localeRoot = join(outputCandidateDir, "af");
    mkdirSync(localeRoot, { recursive: false, mode: 0o700 });
    ownedLocaleRoot = captureOwnedPath(
      localeRoot,
      "directory",
      "Output candidate locale directory",
    );
    for (const candidate of core.candidates) {
      const relativePath = candidatePath(candidate.namespace);
      const outputPath = join(outputCandidateDir, relativePath);
      ownedCandidateFiles.push(writeRestrictedJson(outputPath, candidate));
    }
    const qa = validateTranslationRepairCandidateDirectories({
      worklistDir: core.paths.worklistDir,
      candidateDir: outputCandidateDir,
      ...(core.candidateQaExceptionPolicy
        ? { exceptionPolicy: core.candidateQaExceptionPolicy }
        : {}),
    });
    if (
      !qa.ok ||
      qa.draftModel !== HYBRID_DRAFT_MODEL ||
      qa.ordinaryCheckedFields !== core.ordinaryCandidateQaFields ||
      qa.acceptedExceptionFields !== core.reviewedCandidateQaExceptionFields
    ) {
      throw new Error(`Materialized candidates failed validator QA: ${JSON.stringify(qa.issues.slice(0, 20))}.`);
    }
    const outputDescriptor = {
      ...describeCandidateTree(outputCandidateDir),
      draftModel: HYBRID_DRAFT_MODEL,
    } as const;
    const manifestCore = buildManifestCore(core, ownerAcceptance, outputDescriptor);
    const canonicalSha256 = sha256Canonical(manifestCore);
    args.context.testHooks?.beforeManifestCreate?.(outputCandidateDir, manifestPath);
    ownedManifest = writeRestrictedJson(manifestPath, { ...manifestCore, canonicalSha256 });
    return validateAfrikaansReconciliationHybridCandidateManifestInternal({
      worklistDir: core.paths.worklistDir,
      candidateDir: outputCandidateDir,
      manifestPath,
      context: args.context,
    });
  } catch (error: unknown) {
    const cleanupErrors: Error[] = [];
    if (ownedManifest) {
      try {
        removeOwnedFile(ownedManifest, "Hybrid candidate manifest");
      } catch (cleanupError: unknown) {
        cleanupErrors.push(toError(cleanupError));
      }
    }
    if (ownedCandidateRoot) {
      try {
        removeOwnedCandidateTree({
          root: ownedCandidateRoot,
          localeRoot: ownedLocaleRoot,
          files: ownedCandidateFiles,
        });
      } catch (cleanupError: unknown) {
        cleanupErrors.push(toError(cleanupError));
      }
    }
    if (cleanupErrors.length) {
      throw new Error(
        `Adapter failed and refused to clobber filesystem paths it no longer exclusively owned. ` +
          `Original error: ${toError(error).message}. Cleanup errors: ${cleanupErrors
            .map((cleanupError) => cleanupError.message)
            .join(" | ")}.`,
      );
    }
    throw error;
  }
}

export function validateAfrikaansReconciliationHybridCandidateManifest(args: {
  worklistDir: string;
  candidateDir: string;
  manifestPath: string;
}): AfrikaansReconciliationManifestValidation {
  return validateAfrikaansReconciliationHybridCandidateManifestInternal({
    ...args,
    context: productionVerificationContext(),
  });
}

function validateAfrikaansReconciliationHybridCandidateManifestInternal(args: {
  worklistDir: string;
  candidateDir: string;
  manifestPath: string;
  context: AdapterVerificationContext;
}): AfrikaansReconciliationManifestValidation {
  assertPathWithin(join(args.context.expectedRepoRoot, "tmp"), args.worklistDir, "Worklist directory");
  assertPathWithin(join(args.context.expectedRepoRoot, "tmp"), args.candidateDir, "Candidate directory");
  assertPathWithin(join(args.context.expectedRepoRoot, "tmp"), args.manifestPath, "Hybrid candidate manifest");
  assertExactRealPathWithin(args.context.expectedRepoRoot, args.worklistDir, "Worklist directory");
  assertExactRealPathWithin(args.context.expectedRepoRoot, args.candidateDir, "Candidate directory");
  assertExactRealPathWithin(
    args.context.expectedRepoRoot,
    args.manifestPath,
    "Hybrid candidate manifest",
  );
  const manifestPath = resolve(args.manifestPath);
  const manifestDescriptor = describeFile(manifestPath, "hybrid candidate manifest", true);
  const manifest = reconciliationHybridManifestSchema.parse(
    readJson(manifestPath, "hybrid candidate manifest", manifestDescriptor),
  );
  const { canonicalSha256: claimedManifestSha256, ...coreWithoutFingerprint } = manifest;
  if (sha256Canonical(coreWithoutFingerprint) !== claimedManifestSha256) {
    throw new Error("Reconciliation hybrid candidate manifest fingerprint mismatch.");
  }
  const provenance = manifest.provenance;
  if (resolve(args.worklistDir) !== resolve(provenance.worklist.path)) {
    throw new Error("Hybrid manifest worklist path differs from the requested worklist.");
  }
  if (resolve(args.candidateDir) !== resolve(manifest.output.path)) {
    throw new Error("Hybrid manifest candidate path differs from the requested candidate tree.");
  }
  const paths: AfrikaansReconciliationAdapterPaths = {
    repoRoot: provenance.repoRoot,
    adapterImplementationPath: provenance.adapterImplementation.path,
    preparedPlanPath: provenance.preparedPlan.path,
    workbenchPath: provenance.workbench.path,
    workbenchReadmePath: provenance.workbenchReadme.path,
    noModelGateEvidencePath: provenance.noModelGateEvidence.path,
    scopePath: provenance.scope.path,
    worklistDir: provenance.worklist.path,
    diagnosticManifestPath: provenance.diagnosticManifest.path,
    diagnosticCandidateDir: provenance.diagnosticCandidates.path,
    partitionLaneImplementationPath: provenance.partitionLaneImplementation.path,
    reviewEvidenceSchemaPath: provenance.reviewEvidenceSchema.path,
    partitionPlanPath: provenance.partitionPlan.path,
    reviewBundlePath: provenance.reviewBundle.path,
    reviewerAEvidencePath: provenance.reviewerEvidence[0].path,
    reviewerBEvidencePath: provenance.reviewerEvidence[1].path,
    resolutionVerifierImplementationPath:
      provenance.resolutionVerifierImplementation.path,
    thirdValueProposalsPath: provenance.thirdValueProposals.path,
    thirdValueReviewPath: provenance.thirdValueReview.path,
    reconciliationPath: provenance.reconciliation.path,
    candidateValidatorImplementationPath:
      provenance.candidateValidatorImplementation.path,
  };
  const core = loadAndVerifyCore({ paths, context: args.context });
  const ownerAcceptance = readAndValidateOwnerAcceptance(
    provenance.ownerAcceptance.path,
    core,
    args.context.nowEpochMs,
  );
  const outputTreeDescriptor = describeCandidateTree(args.candidateDir);
  const outputDescriptor = {
    ...outputTreeDescriptor,
    draftModel: HYBRID_DRAFT_MODEL,
  } as const;
  const expectedCore = buildManifestCore(core, ownerAcceptance, outputDescriptor);
  const expected = { ...expectedCore, canonicalSha256: sha256Canonical(expectedCore) };
  if (canonicalJson(expected) !== canonicalJson(manifest)) {
    throw new Error("Reconciliation hybrid candidate manifest or provenance drifted.");
  }
  assertCandidatesEqual(core.candidates, loadCandidateTree(args.candidateDir));
  const qa = validateTranslationRepairCandidateDirectories({
    worklistDir: args.worklistDir,
    candidateDir: args.candidateDir,
    ...(core.candidateQaExceptionPolicy
      ? { exceptionPolicy: core.candidateQaExceptionPolicy }
      : {}),
  });
  if (
    !qa.ok ||
    qa.draftModel !== HYBRID_DRAFT_MODEL ||
    qa.ordinaryCheckedFields !== core.ordinaryCandidateQaFields ||
    qa.acceptedExceptionFields !== core.reviewedCandidateQaExceptionFields
  ) {
    throw new Error(`Reconciliation hybrid candidates failed final QA: ${JSON.stringify(qa.issues.slice(0, 20))}.`);
  }
  assertTreeDescriptorSettled(
    outputTreeDescriptor,
    describeJsonTree(args.candidateDir, outputDescriptor.fields),
    "Reconciliation output candidate tree",
  );
  assertFileDescriptorSettled(
    manifestDescriptor,
    describeFile(manifestPath, "settled hybrid candidate manifest", true),
    "Hybrid candidate manifest",
  );
  return Object.freeze({
    manifestPath,
    worklistDir: resolve(args.worklistDir),
    candidateDir: resolve(args.candidateDir),
    files: outputDescriptor.files.length,
    fields: outputDescriptor.fields,
    replacedFields: core.replacedFields,
    ordinaryCandidateQaFields: core.ordinaryCandidateQaFields,
    reviewedCandidateQaExceptionFields: core.reviewedCandidateQaExceptionFields,
    draftModel: HYBRID_DRAFT_MODEL,
    canonicalSha256: manifest.canonicalSha256,
  });
}

function loadAndVerifyCore(args: InternalVerifyAfrikaansReconciliationArgs): LoadedCore {
  const policy = args.context.policy;
  const paths = normalizeAndValidateInputPaths(args.paths, args.context);
  const reviewerEvidenceDescriptors: LoadedCore["descriptors"]["reviewerEvidence"] = [
    Object.assign(describeFile(paths.reviewerAEvidencePath, "reviewer A evidence"), {
      reviewerId: "reviewer-a" as const,
    }),
    Object.assign(describeFile(paths.reviewerBEvidencePath, "reviewer B evidence"), {
      reviewerId: "reviewer-b" as const,
    }),
  ];
  const descriptors: LoadedCore["descriptors"] = {
    adapterImplementation: describeFile(paths.adapterImplementationPath, "adapter implementation"),
    candidateValidatorImplementation: describeFile(
      paths.candidateValidatorImplementationPath,
      "candidate validator implementation",
    ),
    preparedPlan: describeFile(paths.preparedPlanPath, "prepared plan"),
    workbench: describeFile(paths.workbenchPath, "workbench"),
    workbenchReadme: describeFile(paths.workbenchReadmePath, "workbench README"),
    noModelGateEvidence: describeFile(paths.noModelGateEvidencePath, "no-model gate evidence"),
    scope: describeFile(paths.scopePath, "repair scope"),
    diagnosticManifest: describeFile(paths.diagnosticManifestPath, "diagnostic manifest"),
    partitionLaneImplementation: describeFile(paths.partitionLaneImplementationPath, "partition lane implementation"),
    reviewEvidenceSchema: describeFile(paths.reviewEvidenceSchemaPath, "review evidence schema"),
    partitionPlan: describeFile(paths.partitionPlanPath, "partition plan"),
    reviewBundle: describeFile(paths.reviewBundlePath, "review bundle"),
    reviewerEvidence: reviewerEvidenceDescriptors,
    resolutionVerifierImplementation: describeFile(
      paths.resolutionVerifierImplementationPath,
      "escalation-resolution verifier implementation",
    ),
    thirdValueProposals: describeFile(
      paths.thirdValueProposalsPath,
      "third-value proposals",
    ),
    thirdValueReview: describeFile(paths.thirdValueReviewPath, "third-value review"),
    reconciliation: describeFile(paths.reconciliationPath, "reconciliation"),
  };
  assertFrozenFile(
    descriptors.adapterImplementation,
    policy.adapterImplementationSha256,
    "adapter implementation",
  );
  assertFrozenFile(
    descriptors.candidateValidatorImplementation,
    policy.candidateValidatorImplementationSha256,
    "candidate validator implementation",
  );
  assertFrozenFile(descriptors.preparedPlan, policy.preparedPlanSha256, "prepared plan");
  assertFrozenFile(descriptors.workbench, policy.workbenchSha256, "workbench");
  assertFrozenFile(descriptors.workbenchReadme, policy.workbenchReadmeSha256, "workbench README");
  assertFrozenFile(
    descriptors.noModelGateEvidence,
    policy.noModelGateEvidenceSha256,
    "no-model gate evidence",
  );
  assertFrozenFile(descriptors.scope, policy.scopeFileSha256, "repair scope");
  assertFrozenFile(
    descriptors.resolutionVerifierImplementation,
    policy.resolutionVerifierImplementationSha256,
    "escalation-resolution verifier implementation",
  );
  assertFrozenFile(
    descriptors.thirdValueProposals,
    policy.thirdValueProposalsSha256,
    "third-value proposals",
  );
  assertFrozenFile(
    descriptors.thirdValueReview,
    policy.thirdValueReviewSha256,
    "third-value review",
  );
  validateRepairScope(
    readJson(paths.scopePath, "repair scope", descriptors.scope),
    policy,
  );

  const preparedPlan = requireRecord(
    readJson(paths.preparedPlanPath, "prepared plan", descriptors.preparedPlan),
    "prepared plan",
  );
  const prepared = parsePreparedPlan(preparedPlan, policy);
  const noModelGateEvidence = validateNoModelGate(
    paths.noModelGateEvidencePath,
    descriptors.noModelGateEvidence,
    policy,
  );
  const worklists = loadWorklistTree(paths.worklistDir);
  const worklistDescriptor = describeWorklistTree(paths.worklistDir, worklists);
  if (worklistDescriptor.treeSha256 !== policy.repairWorklistTreeSha256) {
    throw new Error("Exact repair worklist tree drifted from frozen v3.");
  }
  validatePreparedWorklistBindings(preparedPlan, worklistDescriptor, policy);
  const fieldByIdentity = validateExactPreparedCorpus(prepared.exactDecisions, prepared.unresolved, policy);
  validateWorklistCoverage(worklists, fieldByIdentity, policy.totalProposalFields);

  const diagnosticManifest = requireRecord(
    readJson(paths.diagnosticManifestPath, "diagnostic manifest", descriptors.diagnosticManifest),
    "diagnostic manifest",
  );
  const diagnosticCandidates = loadCandidateTree(paths.diagnosticCandidateDir);
  const diagnosticCandidateDescriptor = describeCandidateTree(
    paths.diagnosticCandidateDir,
    diagnosticCandidates,
  );
  validateDiagnosticManifest(diagnosticManifest, diagnosticCandidateDescriptor, preparedPlan, policy);
  validateCandidateIdentityAgainstWorklists(worklists, diagnosticCandidates);

  const unresolvedDecisions = buildSemanticDecisions(prepared.unresolved);
  if (unresolvedDecisions.length !== policy.semanticDecisions) {
    throw new Error(`Expected ${policy.semanticDecisions} semantic decisions; found ${unresolvedDecisions.length}.`);
  }
  const partitionPlan = requireRecord(
    readJson(paths.partitionPlanPath, "partition plan", descriptors.partitionPlan),
    "partition plan",
  );
  const partitions = validatePartitionPlan(
    partitionPlan,
    unresolvedDecisions,
    descriptors,
    preparedPlan,
    noModelGateEvidence,
    paths,
    policy,
  );
  const proposals = buildProposals(unresolvedDecisions, diagnosticCandidates);
  const reviewBundle = requireRecord(
    readJson(paths.reviewBundlePath, "review bundle", descriptors.reviewBundle),
    "review bundle",
  );
  const bundlePartitions = validateReviewBundle(
    reviewBundle,
    partitions,
    proposals,
    descriptors,
    partitionPlan,
    diagnosticCandidateDescriptor,
    policy,
  );
  const reviewerA = reviewEvidenceSchema.parse(
    readJson(paths.reviewerAEvidencePath, "reviewer A evidence", descriptors.reviewerEvidence[0]),
  );
  const reviewerB = reviewEvidenceSchema.parse(
    readJson(paths.reviewerBEvidencePath, "reviewer B evidence", descriptors.reviewerEvidence[1]),
  );
  const reviewerAValidation = validateReviewEvidence(
    reviewerA,
    partitions[0],
    bundlePartitions[0],
    descriptors,
    partitionPlan,
    reviewBundle,
    policy,
  );
  const reviewerBValidation = validateReviewEvidence(
    reviewerB,
    partitions[1],
    bundlePartitions[1],
    descriptors,
    partitionPlan,
    reviewBundle,
    policy,
  );
  if (
    reviewerA.reviewer.reviewerName.trim().toLocaleLowerCase("en-US") ===
    reviewerB.reviewer.reviewerName.trim().toLocaleLowerCase("en-US")
  ) {
    throw new Error("Reviewer A and reviewer B must be distinct people.");
  }
  const resolutionVerification = verifyAfrikaansEscalationResolution({
    paths: {
      partitionPlanPath: paths.partitionPlanPath,
      reviewBundlePath: paths.reviewBundlePath,
      reviewerAEvidencePath: paths.reviewerAEvidencePath,
      reviewerBEvidencePath: paths.reviewerBEvidencePath,
      thirdValueProposalsPath: paths.thirdValueProposalsPath,
      thirdValueReviewPath: paths.thirdValueReviewPath,
    },
    nowEpochMs: args.context.nowEpochMs,
    trustedInputRoot: paths.repoRoot,
    policy: {
      policyId: "afrikaans-escalation-resolution-frozen-v1",
      partitionPlanSha256: policy.resolutionPartitionPlanSha256,
      reviewBundleSha256: policy.resolutionReviewBundleSha256,
      reviewerAEvidenceSha256: policy.resolutionReviewerAEvidenceSha256,
      reviewerBEvidenceSha256: policy.resolutionReviewerBEvidenceSha256,
    } satisfies AfrikaansEscalationResolutionFrozenPolicy,
  });
  validateResolutionVerificationBindings({
    verification: resolutionVerification,
    descriptors,
    policy,
    evidence: [reviewerA, reviewerB],
    bundlePartitions,
  });
  const resolutionActors = readResolutionActorMetadata(
    paths,
    descriptors,
  );
  const resolvedEscalationFields = resolutionVerification.summary.fields;
  const reviewerReconciledFields =
    policy.unresolvedFields - resolvedEscalationFields;
  if (
    reviewerAValidation.escalations + reviewerBValidation.escalations !==
      resolutionVerification.summary.decisions ||
    reviewerReconciledFields < 0
  ) {
    throw new Error("Resolution counts do not exactly close the original escalation set.");
  }
  const reconciliation = requireRecord(
    readJson(paths.reconciliationPath, "reconciliation", descriptors.reconciliation),
    "reconciliation",
  );
  const expectedReconciliation = buildExpectedReconciliation({
    partitionPlan,
    reviewBundle,
    partitions,
    bundlePartitions,
    evidence: [reviewerA, reviewerB],
    resolutionVerification,
    resolutionActors,
    descriptors,
    policy,
  });
  if (canonicalJson(reconciliation) !== canonicalJson(expectedReconciliation)) {
    throw new Error("Reconciliation is stale or is not the exact reviewer-derived result.");
  }
  const reconciledDecisionRootSha256 = requireSha256(
    reconciliation.reconciledDecisionRootSha256,
    "reconciled decision root",
  );
  const final = buildFinalCandidates(
    worklists,
    prepared.exactDecisions,
    expectedReconciliation.decisions,
    policy,
  );
  args.context.testHooks?.beforeCoreSettlement?.(paths);
  assertCoreInputsSettled(
    descriptors,
    worklistDescriptor,
    diagnosticCandidateDescriptor,
    paths,
  );
  return {
    paths,
    policy,
    preparedPlan,
    exactDecisions: prepared.exactDecisions,
    worklists,
    worklistDescriptor,
    diagnosticCandidateDescriptor,
    partitionPlan,
    reviewBundle,
    reviewerEvidence: [reviewerA, reviewerB],
    reconciliation,
    resolutionVerification,
    resolutionActors,
    reviewerReconciledFields,
    resolvedEscalationFields,
    reconciledDecisionRootSha256,
    finalValueRootSha256: final.finalValueRootSha256,
    candidates: final.candidates,
    identities: final.identities,
    replacedFields: final.replacedFields,
    ordinaryCandidateQaFields: final.ordinaryCandidateQaFields,
    reviewedCandidateQaExceptionFields: final.reviewedCandidateQaExceptionFields,
    ...(final.candidateQaExceptionPolicy
      ? { candidateQaExceptionPolicy: final.candidateQaExceptionPolicy }
      : {}),
    descriptors,
  };
}

function assertCoreInputsSettled(
  descriptors: LoadedCore["descriptors"],
  worklistDescriptor: TreeDescriptor,
  diagnosticCandidateDescriptor: TreeDescriptor,
  paths: AfrikaansReconciliationAdapterPaths,
) {
  const files: FileDescriptor[] = [
    descriptors.adapterImplementation,
    descriptors.candidateValidatorImplementation,
    descriptors.preparedPlan,
    descriptors.workbench,
    descriptors.workbenchReadme,
    descriptors.noModelGateEvidence,
    descriptors.scope,
    descriptors.diagnosticManifest,
    descriptors.partitionLaneImplementation,
    descriptors.reviewEvidenceSchema,
    descriptors.partitionPlan,
    descriptors.reviewBundle,
    ...descriptors.reviewerEvidence,
    descriptors.resolutionVerifierImplementation,
    descriptors.thirdValueProposals,
    descriptors.thirdValueReview,
    descriptors.reconciliation,
  ];
  for (const expected of files) {
    const current = describeFile(expected.path, `settled input ${expected.path}`);
    assertFileDescriptorSettled(expected, current, "Input");
  }
  assertTreeDescriptorSettled(
    worklistDescriptor,
    describeJsonTree(paths.worklistDir, worklistDescriptor.fields),
    "Worklist tree",
  );
  assertTreeDescriptorSettled(
    diagnosticCandidateDescriptor,
    describeJsonTree(paths.diagnosticCandidateDir, diagnosticCandidateDescriptor.fields),
    "Diagnostic candidate tree",
  );
}

function parsePreparedPlan(plan: Record<string, unknown>, policy: AfrikaansReconciliationFrozenPolicy) {
  if (
    plan.schemaVersion !== 1 ||
    plan.kind !== PREPARED_PLAN_KIND ||
    plan.evidenceClassification !== "diagnostic-proposal-evidence" ||
    plan.releaseAttestation !== false ||
    plan.trackedWritesPermitted !== false ||
    plan.seedPolicy !== "disabled"
  ) {
    throw new Error("Prepared plan is not the frozen diagnostic-only contract.");
  }
  const adjudication = requireRecord(plan.semanticAdjudication, "prepared semantic adjudication");
  if (
    adjudication.diagnosticOnly !== true ||
    adjudication.ownerSemanticAdjudicationComplete !== false ||
    adjudication.applyReady !== false ||
    adjudication.releaseAttestation !== false ||
    adjudication.exactDecisionFields !== policy.exactDecisionFields ||
    adjudication.exactDecisionRootSha256 !== policy.exactDecisionRootSha256 ||
    adjudication.unresolvedSemanticFields !== policy.unresolvedFields ||
    adjudication.unresolvedSemanticRootSha256 !== policy.unresolvedSemanticRootSha256
  ) {
    throw new Error("Prepared semantic adjudication safety or frozen roots drifted.");
  }
  const outputContract = requireRecord(plan.outputContract, "prepared output contract");
  if (
    outputContract.mayApplyTrackedChanges !== false ||
    outputContract.mayClaimReleaseAttestation !== false
  ) {
    throw new Error("Prepared output contract is not fail closed.");
  }
  const exactDecisions = z.array(exactDecisionSchema).parse(adjudication.exactDecisions);
  const unresolved = z.array(unresolvedFieldSchema).parse(adjudication.unresolvedFields);
  return { exactDecisions, unresolved };
}

function validateNoModelGate(
  path: string,
  descriptor: FileDescriptor,
  policy: AfrikaansReconciliationFrozenPolicy,
) {
  const evidence = requireRecord(
    readJson(path, "no-model gate evidence", descriptor),
    "no-model gate evidence",
  );
  if (
    evidence.schemaVersion !== 1 ||
    evidence.kind !== "afrikaans-residual-repair-no-model-gate-evidence-v1" ||
    evidence.diagnosticOnly !== true ||
    evidence.modelLoaded !== false ||
    evidence.modelFilesRead !== false ||
    evidence.modelWorkerStarted !== false ||
    evidence.trackedWritesPerformed !== false ||
    evidence.releaseAttestation !== false ||
    evidence.planSha256 !== policy.preparedPlanSha256 ||
    evidence.workbenchSha256 !== policy.workbenchSha256 ||
    evidence.genericFields !== policy.unresolvedFields ||
    evidence.distinctModelSourceLanguagePairs !== policy.semanticDecisions
  ) {
    throw new Error("No-model gate evidence differs from frozen v3.");
  }
  return evidence;
}

function validateRepairScope(
  value: unknown,
  policy: AfrikaansReconciliationFrozenPolicy,
): RepairScope {
  const parsed = repairScopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Repair scope root contract is invalid: ${parsed.error.message}`);
  }
  const scope = parsed.data;
  if (scope.fields !== scope.entries.length) {
    throw new Error("Repair scope field count differs from its entries.");
  }
  const identities = new Set<string>();
  for (const [index, entry] of scope.entries.entries()) {
    const identity = `${entry.language}\u0000${entry.namespace}\u0000${entry.key}`;
    if (identities.has(identity)) {
      throw new Error(`Repair scope duplicates identity ${identity}.`);
    }
    identities.add(identity);
    if (entry.sourceHash !== scope.sourceHashes[entry.namespace]) {
      throw new Error(`Repair scope entry ${index} source hash drifted.`);
    }
    if (!isSortedUnique(entry.reasons)) {
      throw new Error(`Repair scope entry ${index} reasons must be sorted and unique.`);
    }
  }
  if (scope.canonicalSha256 !== policy.scopeCanonicalSha256) {
    throw new Error("Repair scope embedded canonical SHA-256 drifted from frozen v3.");
  }
  if (repairScopeFingerprint(scope.entries) !== scope.canonicalSha256) {
    throw new Error("Repair scope canonical fingerprint is stale or tampered.");
  }
  return scope;
}

function repairScopeFingerprint(entries: readonly RepairScopeEntry[]) {
  const rows = [...entries]
    .sort(compareRepairScopeEntries)
    .map((entry) =>
      JSON.stringify([
        entry.language,
        entry.locale,
        entry.namespace,
        entry.sourceHash,
        entry.key,
        entry.source,
        entry.existingCandidate,
      ]),
    );
  return sha256Text(rows.length ? `${rows.join("\n")}\n` : "");
}

function compareRepairScopeEntries(left: RepairScopeEntry, right: RepairScopeEntry) {
  return (
    left.locale.localeCompare(right.locale) ||
    left.namespace.localeCompare(right.namespace) ||
    left.key.localeCompare(right.key) ||
    left.sourceHash.localeCompare(right.sourceHash) ||
    left.source.localeCompare(right.source) ||
    left.language.localeCompare(right.language) ||
    (left.existingCandidate ?? "").localeCompare(right.existingCandidate ?? "")
  );
}

function validatePreparedWorklistBindings(
  plan: Record<string, unknown>,
  descriptor: TreeDescriptor,
  policy: AfrikaansReconciliationFrozenPolicy,
) {
  const scope = requireRecord(plan.scope, "prepared scope binding");
  const worklists = requireRecord(plan.repairWorklists, "prepared worklist binding");
  if (
    scope.fileSha256 !== policy.scopeFileSha256 ||
    scope.canonicalSha256 !== policy.scopeCanonicalSha256 ||
    worklists.treeSha256 !== policy.repairWorklistTreeSha256 ||
    worklists.totalProposalFields !== policy.totalProposalFields ||
    canonicalJson(worklists.files) !== canonicalJson(descriptor.files)
  ) {
    throw new Error("Prepared scope/worklist bindings drifted.");
  }
}

function validateExactPreparedCorpus(
  exactDecisions: ExactDecision[],
  unresolved: Array<z.infer<typeof unresolvedFieldSchema>>,
  policy: AfrikaansReconciliationFrozenPolicy,
) {
  if (
    exactDecisions.length !== policy.exactDecisionFields ||
    sha256Canonical(exactDecisions) !== policy.exactDecisionRootSha256 ||
    unresolved.length !== policy.unresolvedFields ||
    sha256Canonical(unresolved) !== policy.unresolvedSemanticRootSha256
  ) {
    throw new Error("Exact locked or unresolved prepared corpus drifted.");
  }
  const fields = new Map<string, { field: Field; authority: "locked" | "unresolved" }>();
  for (const decision of exactDecisions) {
    validateFieldHashes(decision.field);
    if (
      sha256Text(decision.decidedValue) !== decision.decidedValueSha256 ||
      (decision.action === "preserve" && decision.decidedValue !== decision.field.currentValue) ||
      (decision.action === "replace" && decision.decidedValue === decision.field.currentValue)
    ) {
      throw new Error(`Invalid locked decision for ${decision.field.namespace}/${decision.field.key}.`);
    }
    addPreparedField(fields, decision.field, "locked");
  }
  for (const item of unresolved) {
    validateFieldHashes(item.field);
    addPreparedField(fields, item.field, "unresolved");
  }
  if (fields.size !== policy.totalProposalFields) {
    throw new Error("Locked and unresolved prepared fields overlap or omit worklist fields.");
  }
  return fields;
}

function validateWorklistCoverage(
  worklists: Worklist[],
  fields: Map<string, { field: Field; authority: "locked" | "unresolved" }>,
  expectedFields: number,
) {
  const seen = new Set<string>();
  for (const worklist of worklists) {
    for (const entry of worklist.entries) {
      const identity = fieldKey(worklist.namespace, entry.key);
      if (seen.has(identity)) throw new Error(`Duplicate worklist field ${identity}.`);
      seen.add(identity);
      const prepared = fields.get(identity);
      if (
        !prepared ||
        prepared.field.sourceHash !== worklist.sourceHash ||
        prepared.field.source !== entry.source ||
        prepared.field.currentValue !== entry.existingCandidate
      ) {
        throw new Error(`Worklist field ${identity} differs from its prepared identity.`);
      }
    }
  }
  if (seen.size !== expectedFields || seen.size !== fields.size) {
    throw new Error("Worklists do not exactly cover the frozen prepared corpus.");
  }
}

function validateDiagnosticManifest(
  manifest: Record<string, unknown>,
  candidateDescriptor: TreeDescriptor,
  preparedPlan: Record<string, unknown>,
  policy: AfrikaansReconciliationFrozenPolicy,
) {
  const implementation = requireRecord(preparedPlan.implementationBindings, "prepared implementation bindings");
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== DIAGNOSTIC_MANIFEST_KIND ||
    manifest.evidenceClassification !== "diagnostic-proposal-evidence" ||
    manifest.releaseAttestation !== false ||
    manifest.trackedWritesPerformed !== false ||
    manifest.ownerSemanticAdjudicationComplete !== false ||
    manifest.applyReady !== false ||
    manifest.planSha256 !== policy.preparedPlanSha256 ||
    manifest.scopeFileSha256 !== policy.scopeFileSha256 ||
    manifest.scopeCanonicalSha256 !== policy.scopeCanonicalSha256 ||
    manifest.repairWorklistTreeSha256 !== policy.repairWorklistTreeSha256 ||
    manifest.repairCandidateTreeSha256 !== candidateDescriptor.treeSha256 ||
    manifest.repairCandidateFields !== policy.totalProposalFields ||
    manifest.exactDecisionFields !== policy.exactDecisionFields ||
    manifest.exactDecisionRootSha256 !== policy.exactDecisionRootSha256 ||
    manifest.unresolvedSemanticFields !== policy.unresolvedFields ||
    manifest.unresolvedSemanticRootSha256 !== policy.unresolvedSemanticRootSha256 ||
    manifest.genericPipelineImplementationSha256 !== implementation.genericPipelineSha256 ||
    manifest.genericWorkerImplementationSha256 !== implementation.genericWorkerSha256 ||
    manifest.runtimeExecutionProfileSha256 !== implementation.executionProfileSha256 ||
    manifest.runtimeExecutionProfileImplementationSha256 !==
      implementation.executionProfileImplementationSha256 ||
    manifest.validatorPolicySha256 !== implementation.validatorPolicySha256
  ) {
    throw new Error("Diagnostic manifest is stale or not fail closed.");
  }
}

function buildSemanticDecisions(
  unresolved: Array<z.infer<typeof unresolvedFieldSchema>>,
): SemanticDecision[] {
  const groups = new Map<
    string,
    Omit<SemanticDecision, "decisionIdentitySha256" | "fieldCount"> & { members: z.infer<typeof memberSchema>[] }
  >();
  const identities = new Set<string>();
  for (const item of unresolved) {
    const field = item.field;
    const fieldIdentitySha256 = sha256Canonical({
      schemaVersion: 1,
      kind: "afrikaans-semantic-field-identity-v1",
      field,
    });
    if (identities.has(fieldIdentitySha256)) throw new Error("Duplicate unresolved field identity.");
    identities.add(fieldIdentitySha256);
    const member = {
      fieldIdentitySha256,
      namespace: field.namespace,
      sourceHash: field.sourceHash,
      key: field.key,
    };
    const group = groups.get(field.sourceSha256);
    if (!group) {
      groups.set(field.sourceSha256, {
        language: "Afrikaans",
        locale: "af",
        source: field.source,
        sourceSha256: field.sourceSha256,
        currentValue: field.currentValue,
        currentValueSha256: field.currentValueSha256,
        members: [member],
      });
      continue;
    }
    if (
      group.source !== field.source ||
      group.currentValue !== field.currentValue ||
      group.currentValueSha256 !== field.currentValueSha256
    ) {
      throw new Error(`Unresolved source group ${field.sourceSha256} is not atomic.`);
    }
    group.members.push(member);
  }
  const decisions = [...groups.values()].map((group) => {
    group.members.sort(compareMembers);
    const identity = {
      schemaVersion: 1,
      kind: "afrikaans-semantic-decision-identity-v1",
      language: group.language,
      locale: group.locale,
      source: group.source,
      sourceSha256: group.sourceSha256,
      currentValue: group.currentValue,
      currentValueSha256: group.currentValueSha256,
      members: group.members,
    };
    return semanticDecisionSchema.parse({
      decisionIdentitySha256: sha256Canonical(identity),
      language: group.language,
      locale: group.locale,
      source: group.source,
      sourceSha256: group.sourceSha256,
      currentValue: group.currentValue,
      currentValueSha256: group.currentValueSha256,
      fieldCount: group.members.length,
      members: group.members,
    });
  });
  decisions.sort((left, right) => compareCodePoints(left.decisionIdentitySha256, right.decisionIdentitySha256));
  return decisions;
}

function validatePartitionPlan(
  plan: Record<string, unknown>,
  decisions: SemanticDecision[],
  descriptors: LoadedCore["descriptors"],
  preparedPlan: Record<string, unknown>,
  noModelGateEvidence: Record<string, unknown>,
  paths: AfrikaansReconciliationAdapterPaths,
  policy: AfrikaansReconciliationFrozenPolicy,
): [ReviewerPartition, ReviewerPartition] {
  assertExactKeys(
    plan,
    [
      "schemaVersion",
      "kind",
      "diagnosticOnly",
      "trackedWritesPermitted",
      "promotePermitted",
      "importPermitted",
      "applyPermitted",
      "releaseAttestation",
      "inputBindings",
      "laneImplementationBindings",
      "corpus",
      "partitionAlgorithm",
      "decisions",
      "reviewers",
      "evidenceContract",
      "reconciliationContract",
    ],
    "partition plan",
  );
  if (
    plan.schemaVersion !== 1 ||
    plan.kind !== PARTITION_PLAN_KIND ||
    plan.diagnosticOnly !== true ||
    plan.trackedWritesPermitted !== false ||
    plan.promotePermitted !== false ||
    plan.importPermitted !== false ||
    plan.applyPermitted !== false ||
    plan.releaseAttestation !== false ||
    canonicalJson(plan.decisions) !== canonicalJson(decisions)
  ) {
    throw new Error("Partition plan is stale or not fail closed.");
  }
  const bindings = requireRecord(plan.inputBindings, "partition input bindings");
  assertExactKeys(
    bindings,
    [
      "preparedPlanRelativePath",
      "preparedPlanSha256",
      "preparedPlanKind",
      "workbenchRelativePath",
      "workbenchSha256",
      "workbenchReadmeRelativePath",
      "workbenchReadmeSha256",
      "noModelGateEvidenceRelativePath",
      "noModelGateEvidenceSha256",
      "noModelGateEvidenceKind",
      "genericMasterWorklistSha256",
      "scopeCanonicalSha256",
      "repairWorklistTreeSha256",
      "unresolvedSemanticRootSha256",
      "currentCatalogs",
      "preparedWorkBenchSha256",
      "pipelineVersion",
      "executionProfileSha256",
      "executionProfileImplementationSha256",
      "pipelineImplementationSha256",
      "workerImplementationSha256",
    ],
    "partition input bindings",
  );
  const currentCatalogs = requireRecord(
    requireRecord(preparedPlan.semanticAdjudication, "prepared semantic adjudication").currentCatalogs,
    "prepared current catalogs",
  );
  const implementation = requireRecord(preparedPlan.implementationBindings, "prepared implementation bindings");
  const relativePath = (target: string) => relative(paths.repoRoot, target).split(sep).join("/");
  if (
    bindings.preparedPlanRelativePath !== relativePath(paths.preparedPlanPath) ||
    bindings.preparedPlanSha256 !== policy.preparedPlanSha256 ||
    bindings.preparedPlanKind !== PREPARED_PLAN_KIND ||
    bindings.workbenchRelativePath !== relativePath(paths.workbenchPath) ||
    bindings.workbenchSha256 !== policy.workbenchSha256 ||
    bindings.workbenchReadmeRelativePath !== relativePath(paths.workbenchReadmePath) ||
    bindings.workbenchReadmeSha256 !== policy.workbenchReadmeSha256 ||
    bindings.noModelGateEvidenceRelativePath !== relativePath(paths.noModelGateEvidencePath) ||
    bindings.noModelGateEvidenceSha256 !== policy.noModelGateEvidenceSha256 ||
    bindings.noModelGateEvidenceKind !== noModelGateEvidence.kind ||
    bindings.genericMasterWorklistSha256 !== noModelGateEvidence.genericMasterWorklistSha256 ||
    bindings.scopeCanonicalSha256 !== policy.scopeCanonicalSha256 ||
    bindings.repairWorklistTreeSha256 !== policy.repairWorklistTreeSha256 ||
    bindings.unresolvedSemanticRootSha256 !== policy.unresolvedSemanticRootSha256 ||
    canonicalJson(bindings.currentCatalogs) !== canonicalJson(currentCatalogs) ||
    bindings.preparedWorkBenchSha256 !== policy.workbenchSha256 ||
    bindings.pipelineVersion !== implementation.requiredExecutionPipelineVersion ||
    bindings.executionProfileSha256 !== implementation.executionProfileSha256 ||
    bindings.executionProfileImplementationSha256 !==
      implementation.executionProfileImplementationSha256 ||
    bindings.pipelineImplementationSha256 !== implementation.genericPipelineSha256 ||
    bindings.workerImplementationSha256 !== implementation.genericWorkerSha256
  ) {
    throw new Error("Partition plan does not bind frozen v3 inputs.");
  }
  const corpus = requireRecord(plan.corpus, "partition corpus");
  assertExactKeys(
    corpus,
    [
      "fields",
      "decisions",
      "groupingKey",
      "groupingInvariant",
      "duplicateSourceGroups",
      "fieldIdentityRootSha256",
      "decisionRootSha256",
    ],
    "partition corpus",
  );
  const decisionRootSha256 = sha256Canonical(decisions);
  const fieldIdentityRootSha256 = sha256Canonical(
    decisions.flatMap((decision) => decision.members.map((member) => member.fieldIdentitySha256)).sort(compareCodePoints),
  );
  if (
    corpus.fields !== policy.unresolvedFields ||
    corpus.decisions !== policy.semanticDecisions ||
    corpus.groupingKey !== "sourceSha256" ||
    corpus.groupingInvariant !==
      "Every member has byte-identical NFC source/currentValue and matching hashes." ||
    corpus.duplicateSourceGroups !== decisions.filter((decision) => decision.fieldCount > 1).length ||
    corpus.decisionRootSha256 !== decisionRootSha256 ||
    corpus.fieldIdentityRootSha256 !== fieldIdentityRootSha256
  ) {
    throw new Error("Partition corpus roots or counts drifted.");
  }
  const laneBindings = requireRecord(plan.laneImplementationBindings, "lane implementation bindings");
  assertExactKeys(
    laneBindings,
    ["laneImplementationSha256", "reviewEvidenceSchemaSha256"],
    "lane implementation bindings",
  );
  if (
    laneBindings.laneImplementationSha256 !== descriptors.partitionLaneImplementation.sha256 ||
    laneBindings.reviewEvidenceSchemaSha256 !== descriptors.reviewEvidenceSchema.sha256
  ) {
    throw new Error("Partition lane implementation or reviewer schema drifted.");
  }
  const partitionsRaw = z.array(reviewerPartitionSchema).length(2).parse(plan.reviewers);
  if (partitionsRaw[0].reviewerId !== "reviewer-a" || partitionsRaw[1].reviewerId !== "reviewer-b") {
    throw new Error("Partition reviewer order must be reviewer-a then reviewer-b.");
  }
  const allIds = decisions.map((decision) => decision.decisionIdentitySha256);
  const observedIds = partitionsRaw.flatMap((partition) => partition.decisionIds);
  if (
    observedIds.length !== allIds.length ||
    new Set(observedIds).size !== allIds.length ||
    [...observedIds].sort(compareCodePoints).some((id, index) => id !== allIds[index])
  ) {
    throw new Error("Reviewer partitions overlap, omit, or add semantic decisions.");
  }
  const decisionById = new Map(decisions.map((decision) => [decision.decisionIdentitySha256, decision]));
  for (const partition of partitionsRaw) {
    if (!isSortedUnique(partition.decisionIds)) {
      throw new Error(`${partition.reviewerId} decision IDs are not sorted and unique.`);
    }
    const fieldCount = partition.decisionIds.reduce((sum, id) => {
      const decision = decisionById.get(id);
      if (!decision) throw new Error(`Unknown partition decision ${id}.`);
      return sum + decision.fieldCount;
    }, 0);
    const material = {
      schemaVersion: 1,
      kind: "afrikaans-semantic-reviewer-partition-v1",
      reviewerId: partition.reviewerId,
      preparedPlanSha256: policy.preparedPlanSha256,
      decisionRootSha256,
      decisionCount: partition.decisionIds.length,
      fieldCount,
      decisionIds: partition.decisionIds,
    };
    if (
      partition.decisionCount !== partition.decisionIds.length ||
      partition.fieldCount !== fieldCount ||
      partition.partitionRootSha256 !== sha256Canonical(material)
    ) {
      throw new Error(`${partition.reviewerId} partition accounting or root drifted.`);
    }
  }
  const partitionAlgorithm = requireRecord(plan.partitionAlgorithm, "partition algorithm");
  assertExactKeys(
    partitionAlgorithm,
    ["id", "reviewerADecisionTarget", "reviewerAFieldTarget", "rule"],
    "partition algorithm",
  );
  if (
    partitionAlgorithm.id !== "balanced-atomic-source-groups-v1" ||
    partitionAlgorithm.reviewerADecisionTarget !== partitionsRaw[0].decisionCount ||
    partitionAlgorithm.reviewerAFieldTarget !== partitionsRaw[0].fieldCount ||
    partitionAlgorithm.rule !==
      "Choose the lexicographically smallest set of repeated-source decision IDs whose excess fields reach the reviewer-A target, then fill reviewer A with the lexicographically first singleton decision IDs; reviewer B is the exact complement."
  ) {
    throw new Error("Partition algorithm metadata drifted.");
  }
  const evidenceContract = requireRecord(plan.evidenceContract, "review evidence contract");
  assertExactKeys(
    evidenceContract,
    [
      "schemaRelativePath",
      "allowedVerdicts",
      "exactOneEvidenceRowPerAssignedDecision",
      "crossPartitionEvidencePermitted",
      "escalationsPermitReconciliation",
    ],
    "review evidence contract",
  );
  if (
    evidenceContract.schemaRelativePath !== relativePath(paths.reviewEvidenceSchemaPath) ||
    canonicalJson(evidenceContract.allowedVerdicts) !==
      canonicalJson(["accept-proposal", "preserve-current", "escalate"]) ||
    evidenceContract.exactOneEvidenceRowPerAssignedDecision !== true ||
    evidenceContract.crossPartitionEvidencePermitted !== false ||
    evidenceContract.escalationsPermitReconciliation !== false
  ) {
    throw new Error("Review evidence contract drifted.");
  }
  const reconciliationContract = requireRecord(plan.reconciliationContract, "reconciliation contract");
  assertExactKeys(
    reconciliationContract,
    [
      "exactReviewBundleRequired",
      "exactDiagnosticManifestRequired",
      "completeDisjointCoverageRequired",
      "ownerAcceptanceRequiredAfterReconciliation",
      "trackedWritesPermitted",
      "mayApplyTrackedChanges",
      "mayPromote",
      "mayImport",
      "mayClaimReleaseAttestation",
      "outputChannel",
    ],
    "reconciliation contract",
  );
  if (
    reconciliationContract.exactReviewBundleRequired !== true ||
    reconciliationContract.exactDiagnosticManifestRequired !== true ||
    reconciliationContract.completeDisjointCoverageRequired !== true ||
    reconciliationContract.ownerAcceptanceRequiredAfterReconciliation !== true ||
    reconciliationContract.trackedWritesPermitted !== false ||
    reconciliationContract.mayApplyTrackedChanges !== false ||
    reconciliationContract.mayPromote !== false ||
    reconciliationContract.mayImport !== false ||
    reconciliationContract.mayClaimReleaseAttestation !== false ||
    reconciliationContract.outputChannel !== "stdout-only"
  ) {
    throw new Error("Partition reconciliation contract is not fail closed.");
  }
  return [partitionsRaw[0], partitionsRaw[1]];
}

function buildProposals(decisions: SemanticDecision[], candidates: Candidate[]): Proposal[] {
  const candidateIndex = new Map<string, z.infer<typeof candidateEntrySchema>>();
  for (const candidate of candidates) {
    for (const entry of candidate.entries) {
      candidateIndex.set(fieldKey(candidate.namespace, entry.key), entry);
    }
  }
  return decisions.map((decision) => {
    const values = new Set<string>();
    for (const member of decision.members) {
      const candidate = candidateIndex.get(fieldKey(member.namespace, member.key));
      if (!candidate || candidate.source !== decision.source) {
        throw new Error(`Diagnostic proposal is missing or source-drifted for ${member.namespace}/${member.key}.`);
      }
      values.add(candidate.value);
    }
    if (values.size !== 1) {
      throw new Error(`Atomic source group ${decision.decisionIdentitySha256} has divergent proposals.`);
    }
    const proposedValue = [...values][0];
    const proposedValueSha256 = sha256Text(proposedValue);
    return proposalSchema.parse({
      ...decision,
      proposalIdentitySha256: sha256Canonical({
        schemaVersion: 1,
        kind: "afrikaans-semantic-proposal-identity-v1",
        decisionIdentitySha256: decision.decisionIdentitySha256,
        proposedValue,
        proposedValueSha256,
      }),
      proposedValue,
      proposedValueSha256,
    });
  });
}

function validateReviewBundle(
  bundle: Record<string, unknown>,
  partitions: [ReviewerPartition, ReviewerPartition],
  proposals: Proposal[],
  descriptors: LoadedCore["descriptors"],
  partitionPlan: Record<string, unknown>,
  diagnosticCandidates: TreeDescriptor,
  policy: AfrikaansReconciliationFrozenPolicy,
): [ReviewerBundlePartition, ReviewerBundlePartition] {
  const proposalRootSha256 = sha256Canonical(proposals);
  const decisionRootSha256 = requireSha256(
    requireRecord(partitionPlan.corpus, "partition corpus").decisionRootSha256,
    "partition decision root",
  );
  const expectedBinding = {
    partitionPlanSha256: descriptors.partitionPlan.sha256,
    preparedPlanSha256: policy.preparedPlanSha256,
    decisionRootSha256,
    diagnosticManifestSha256: descriptors.diagnosticManifest.sha256,
    diagnosticManifestKind: DIAGNOSTIC_MANIFEST_KIND,
    candidateTreeSha256: diagnosticCandidates.treeSha256,
    proposalRootSha256,
  };
  const proposalById = new Map(proposals.map((proposal) => [proposal.decisionIdentitySha256, proposal]));
  const expectedReviewers = partitions.map((partition) => ({
    reviewerId: partition.reviewerId,
    partitionRootSha256: partition.partitionRootSha256,
    decisionCount: partition.decisionCount,
    fieldCount: partition.fieldCount,
    proposals: partition.decisionIds.map((id) => {
      const proposal = proposalById.get(id);
      if (!proposal) throw new Error(`Missing proposal ${id}.`);
      return proposal;
    }),
  }));
  const expected = {
    schemaVersion: 1,
    kind: REVIEW_BUNDLE_KIND,
    diagnosticOnly: true,
    trackedWritesPermitted: false,
    promotePermitted: false,
    importPermitted: false,
    applyPermitted: false,
    releaseAttestation: false,
    inputBindings: expectedBinding,
    proposalCount: proposals.length,
    proposalFieldCount: proposals.reduce((sum, proposal) => sum + proposal.fieldCount, 0),
    reviewers: expectedReviewers,
    evidenceInstructions: {
      schemaRelativePath: "tmp/af-adjudication-parallel-plan-v1/review-evidence.schema.json",
      allowedVerdicts: ["accept-proposal", "preserve-current", "escalate"],
      escalationRule: "Use escalate when neither proposedValue nor currentValue is semantically proper.",
    },
  };
  if (canonicalJson(bundle) !== canonicalJson(expected)) {
    throw new Error("Review bundle is stale or differs from exact diagnostic proposals.");
  }
  const parsed = z.array(reviewerBundlePartitionSchema).length(2).parse(bundle.reviewers);
  return [parsed[0], parsed[1]];
}

function validateReviewEvidence(
  evidence: ReviewEvidence,
  partition: ReviewerPartition,
  bundlePartition: ReviewerBundlePartition,
  descriptors: LoadedCore["descriptors"],
  partitionPlan: Record<string, unknown>,
  reviewBundle: Record<string, unknown>,
  policy: AfrikaansReconciliationFrozenPolicy,
) {
  if (evidence.reviewer.reviewerId !== partition.reviewerId) {
    throw new Error(`${partition.reviewerId} reviewer identity drifted.`);
  }
  const decisionRootSha256 = requireSha256(
    requireRecord(partitionPlan.corpus, "partition corpus").decisionRootSha256,
    "partition decision root",
  );
  const bundleBindings = requireRecord(reviewBundle.inputBindings, "review bundle bindings");
  const expectedBindings = {
    partitionPlanSha256: descriptors.partitionPlan.sha256,
    reviewBundleSha256: descriptors.reviewBundle.sha256,
    preparedPlanSha256: policy.preparedPlanSha256,
    decisionRootSha256,
    partitionRootSha256: partition.partitionRootSha256,
    proposalRootSha256: bundleBindings.proposalRootSha256,
    candidateTreeSha256: bundleBindings.candidateTreeSha256,
  };
  if (canonicalJson(evidence.inputBindings) !== canonicalJson(expectedBindings)) {
    throw new Error(`${partition.reviewerId} evidence bindings drifted.`);
  }
  const observedIds = evidence.decisions.map((decision) => decision.decisionIdentitySha256);
  if (
    observedIds.length !== partition.decisionIds.length ||
    observedIds.some((id, index) => id !== partition.decisionIds[index])
  ) {
    throw new Error(`${partition.reviewerId} evidence omits, duplicates, or reorders its exact partition.`);
  }
  const proposalById = new Map(
    bundlePartition.proposals.map((proposal) => [proposal.decisionIdentitySha256, proposal]),
  );
  let accepted = 0;
  let preserved = 0;
  let escalations = 0;
  for (const decision of evidence.decisions) {
    const proposal = proposalById.get(decision.decisionIdentitySha256);
    if (!proposal || decision.proposalIdentitySha256 !== proposal.proposalIdentitySha256) {
      throw new Error(`${partition.reviewerId} evidence proposal binding drifted.`);
    }
    if (decision.rationale.normalize("NFC") !== decision.rationale) {
      throw new Error(`${partition.reviewerId} rationale is not NFC.`);
    }
    if (decision.verdict === "accept-proposal") {
      accepted += 1;
      if (
        decision.finalValue !== proposal.proposedValue ||
        decision.finalValueSha256 !== proposal.proposedValueSha256
      ) {
        throw new Error(`${partition.reviewerId} accepted value differs from the proposal.`);
      }
    } else if (decision.verdict === "preserve-current") {
      preserved += 1;
      if (
        decision.finalValue !== proposal.currentValue ||
        decision.finalValueSha256 !== proposal.currentValueSha256
      ) {
        throw new Error(`${partition.reviewerId} preserved value differs from current.`);
      }
    } else {
      escalations += 1;
      if (decision.finalValue !== null || decision.finalValueSha256 !== null) {
        throw new Error(`${partition.reviewerId} escalation chose a value.`);
      }
    }
  }
  const expectedSummary = {
    decisions: partition.decisionCount,
    fields: partition.fieldCount,
    acceptedProposals: accepted,
    preservedCurrentValues: preserved,
    escalations,
  };
  if (canonicalJson(evidence.summary) !== canonicalJson(expectedSummary)) {
    throw new Error(`${partition.reviewerId} evidence summary is not exact.`);
  }
  return Object.freeze({ accepted, preserved, escalations });
}

function validateResolutionVerificationBindings(input: {
  verification: AfrikaansEscalationResolutionVerification;
  descriptors: LoadedCore["descriptors"];
  policy: AfrikaansReconciliationFrozenPolicy;
  evidence: [ReviewEvidence, ReviewEvidence];
  bundlePartitions: [ReviewerBundlePartition, ReviewerBundlePartition];
}) {
  const { verification, descriptors, policy } = input;
  if (
    verification.diagnosticOnly !== true ||
    verification.authentication !== "none" ||
    verification.identityClaimsVerified !== false ||
    verification.trackedWritesPerformed !== false ||
    verification.trackedWritesPermitted !== false ||
    verification.writePermitted !== false ||
    verification.materializePermitted !== false ||
    verification.applyPermitted !== false ||
    verification.promotePermitted !== false ||
    verification.importPermitted !== false ||
    verification.releaseAttestation !== false ||
    verification.applyReady !== false ||
    verification.outputChannel !== "stdout-only"
  ) {
    throw new Error("Escalation resolution attempted to grant mutation authority.");
  }
  const bindings = verification.inputBindings;
  if (
    bindings.verifierImplementationSha256 !==
      policy.resolutionVerifierImplementationSha256 ||
    bindings.verifierImplementationSha256 !==
      descriptors.resolutionVerifierImplementation.sha256 ||
    bindings.frozenPolicySha256 !== policy.resolutionFrozenPolicySha256 ||
    bindings.validatorPolicySha256 !== policy.resolutionValidatorPolicySha256 ||
    bindings.partitionPlanSha256 !== descriptors.partitionPlan.sha256 ||
    bindings.reviewBundleSha256 !== descriptors.reviewBundle.sha256 ||
    bindings.reviewerAEvidenceSha256 !== descriptors.reviewerEvidence[0].sha256 ||
    bindings.reviewerBEvidenceSha256 !== descriptors.reviewerEvidence[1].sha256 ||
    bindings.thirdValueProposalsSha256 !== policy.thirdValueProposalsSha256 ||
    bindings.thirdValueProposalsSha256 !== descriptors.thirdValueProposals.sha256 ||
    bindings.thirdValueReviewSha256 !== policy.thirdValueReviewSha256 ||
    bindings.thirdValueReviewSha256 !== descriptors.thirdValueReview.sha256 ||
    bindings.escalationDecisionRootSha256 !== policy.escalationDecisionRootSha256 ||
    bindings.thirdValueRootSha256 !== policy.thirdValueRootSha256 ||
    verification.resolvedDecisionRootSha256 !==
      policy.resolvedEscalationDecisionRootSha256 ||
    verification.summary.decisions !== policy.resolvedEscalationDecisions ||
    verification.summary.fields !== policy.resolvedEscalationFields ||
    verification.summary.approvedThirdValues !== policy.resolvedEscalationDecisions
  ) {
    throw new Error("Escalation-resolution implementation, inputs, roots, or counts drifted.");
  }

  const expectedEscalations = input.evidence
    .flatMap((evidence, evidenceIndex) => {
      const proposalById = new Map(
        input.bundlePartitions[evidenceIndex].proposals.map((proposal) => [
          proposal.decisionIdentitySha256,
          proposal,
        ]),
      );
      return evidence.decisions
        .filter((decision) => decision.verdict === "escalate")
        .map((decision) => {
          const proposal = proposalById.get(decision.decisionIdentitySha256);
          if (!proposal) {
            throw new Error("Original escalation is missing its exact proposal.");
          }
          return {
            originalReviewerId: evidence.reviewer.reviewerId,
            proposal,
          };
        });
    })
    .sort((left, right) =>
      compareCodePoints(
        left.proposal.decisionIdentitySha256,
        right.proposal.decisionIdentitySha256,
      ),
    );
  if (expectedEscalations.length !== verification.resolvedDecisions.length) {
    throw new Error("Escalation resolution does not exactly cover the original escalations.");
  }
  for (const [index, expected] of expectedEscalations.entries()) {
    const resolved = verification.resolvedDecisions[index];
    const proposal = expected.proposal;
    const expectedIdentity = {
      originalReviewerId: expected.originalReviewerId,
      decisionIdentitySha256: proposal.decisionIdentitySha256,
      proposalIdentitySha256: proposal.proposalIdentitySha256,
      source: proposal.source,
      sourceSha256: proposal.sourceSha256,
      fieldCount: proposal.fieldCount,
      members: proposal.members,
    };
    const observedIdentity = {
      originalReviewerId: resolved.originalReviewerId,
      decisionIdentitySha256: resolved.decisionIdentitySha256,
      proposalIdentitySha256: resolved.proposalIdentitySha256,
      source: resolved.source,
      sourceSha256: resolved.sourceSha256,
      fieldCount: resolved.fieldCount,
      members: resolved.members,
    };
    if (canonicalJson(expectedIdentity) !== canonicalJson(observedIdentity)) {
      throw new Error(`Resolved escalation ${index} changed its original identity.`);
    }
  }
}

function readResolutionActorMetadata(
  paths: AfrikaansReconciliationAdapterPaths,
  descriptors: LoadedCore["descriptors"],
): ResolutionActorMetadata {
  const proposals = resolutionProposalActorSchema.parse(
    readJson(
      paths.thirdValueProposalsPath,
      "third-value proposal actors",
      descriptors.thirdValueProposals,
    ),
  );
  const review = resolutionReviewActorSchema.parse(
    readJson(
      paths.thirdValueReviewPath,
      "third-value review actors",
      descriptors.thirdValueReview,
    ),
  );
  return Object.freeze({
    proposalAuthorName: proposals.author.authorName,
    proposalAuthoredAtUtc: proposals.author.authoredAtUtc,
    reviewerName: review.reviewer.reviewerName,
    reviewedAtUtc: review.reviewer.completedAtUtc,
  });
}

function buildExpectedReconciliation(input: {
  partitionPlan: Record<string, unknown>;
  reviewBundle: Record<string, unknown>;
  partitions: [ReviewerPartition, ReviewerPartition];
  bundlePartitions: [ReviewerBundlePartition, ReviewerBundlePartition];
  evidence: [ReviewEvidence, ReviewEvidence];
  resolutionVerification: AfrikaansEscalationResolutionVerification;
  resolutionActors: ResolutionActorMetadata;
  descriptors: LoadedCore["descriptors"];
  policy: AfrikaansReconciliationFrozenPolicy;
}) {
  const resolvedById = new Map(
    input.resolutionVerification.resolvedDecisions.map((decision) => [
      decision.decisionIdentitySha256,
      decision,
    ]),
  );
  const reconciled: ReconciledDecision[] = input.evidence.flatMap((evidence, evidenceIndex) => {
    const bundlePartition = input.bundlePartitions[evidenceIndex];
    const proposalById = new Map(
      bundlePartition.proposals.map((proposal) => [proposal.decisionIdentitySha256, proposal]),
    );
    return evidence.decisions.map((decision) => {
      const proposal = proposalById.get(decision.decisionIdentitySha256);
      if (!proposal) {
        throw new Error("Original review decision is missing its exact proposal.");
      }
      const resolved = resolvedById.get(decision.decisionIdentitySha256);
      if (decision.verdict === "escalate") {
        if (!resolved) {
          throw new Error("Original escalation is missing its approved third value.");
        }
        return {
          decisionIdentitySha256: decision.decisionIdentitySha256,
          proposalIdentitySha256: decision.proposalIdentitySha256,
          originalReviewerId: evidence.reviewer.reviewerId,
          originalVerdict: "escalate",
          authority: "approved-third-value-resolution",
          finalValue: resolved.finalValue,
          finalValueSha256: resolved.finalValueSha256,
          fieldCount: proposal.fieldCount,
          members: proposal.members,
          originalRationale: decision.rationale,
        } satisfies ReconciledDecision;
      }
      if (
        resolved ||
        decision.finalValue === null ||
        decision.finalValueSha256 === null
      ) {
        throw new Error(
          "Non-escalated review evidence is incomplete or was resolution-laundered.",
        );
      }
      return {
        decisionIdentitySha256: decision.decisionIdentitySha256,
        proposalIdentitySha256: decision.proposalIdentitySha256,
        originalReviewerId: evidence.reviewer.reviewerId,
        originalVerdict: decision.verdict,
        authority: "original-review-evidence",
        finalValue: decision.finalValue,
        finalValueSha256: decision.finalValueSha256,
        fieldCount: proposal.fieldCount,
        members: proposal.members,
        originalRationale: decision.rationale,
      } satisfies ReconciledDecision;
    });
  });
  reconciled.sort((left, right) => compareCodePoints(left.decisionIdentitySha256, right.decisionIdentitySha256));
  if (
    reconciled.length !== input.policy.semanticDecisions ||
    new Set(reconciled.map((decision) => decision.decisionIdentitySha256)).size !== reconciled.length ||
    reconciled.reduce((sum, decision) => sum + decision.fieldCount, 0) !== input.policy.unresolvedFields
  ) {
    throw new Error("Reconciliation omits or duplicates semantic fields.");
  }
  const reviewBindings = requireRecord(input.reviewBundle.inputBindings, "review bundle bindings");
  const decisionRootSha256 = requireSha256(
    requireRecord(input.partitionPlan.corpus, "partition corpus").decisionRootSha256,
    "partition decision root",
  );
  return {
    schemaVersion: 2,
    kind: RECONCILIATION_KIND,
    evidenceClassification:
      "diagnostic-semantic-review-and-resolution-evidence",
    diagnosticOnly: true,
    parallelReviewComplete: true,
    escalationResolutionComplete: true,
    ownerAcceptanceRequired: true,
    ownerAcceptanceRecorded: false,
    trackedWritesPerformed: false,
    trackedWritesPermitted: false,
    applyReady: false,
    promotePermitted: false,
    importPermitted: false,
    releaseAttestation: false,
    inputBindings: {
      partitionPlanSha256: input.descriptors.partitionPlan.sha256,
      reviewBundleSha256: input.descriptors.reviewBundle.sha256,
      preparedPlanSha256: input.policy.preparedPlanSha256,
      decisionRootSha256,
      proposalRootSha256: reviewBindings.proposalRootSha256,
      diagnosticManifestSha256: reviewBindings.diagnosticManifestSha256,
      candidateTreeSha256: reviewBindings.candidateTreeSha256,
      resolutionVerifierImplementationSha256:
        input.resolutionVerification.inputBindings.verifierImplementationSha256,
      resolutionFrozenPolicySha256:
        input.resolutionVerification.inputBindings.frozenPolicySha256,
      resolutionValidatorPolicySha256:
        input.resolutionVerification.inputBindings.validatorPolicySha256,
      thirdValueProposalsSha256:
        input.resolutionVerification.inputBindings.thirdValueProposalsSha256,
      thirdValueReviewSha256:
        input.resolutionVerification.inputBindings.thirdValueReviewSha256,
      escalationDecisionRootSha256:
        input.resolutionVerification.inputBindings.escalationDecisionRootSha256,
      thirdValueRootSha256:
        input.resolutionVerification.inputBindings.thirdValueRootSha256,
      resolvedEscalationDecisionRootSha256:
        input.resolutionVerification.resolvedDecisionRootSha256,
    },
    reviewers: input.evidence.map((evidence, index) => ({
      reviewerId: evidence.reviewer.reviewerId,
      evidenceSha256: input.descriptors.reviewerEvidence[index].sha256,
      reviewerName: evidence.reviewer.reviewerName,
      completedAtUtc: evidence.reviewer.completedAtUtc,
      decisionCount: evidence.decisions.length,
      partitionRootSha256: input.partitions[index].partitionRootSha256,
    })),
    resolution: {
      verificationKind: input.resolutionVerification.kind,
      diagnosticOnly: true,
      identityClaimsVerified: false,
      applyReady: false,
      outputChannel: "stdout-only",
      proposalAuthorName: input.resolutionActors.proposalAuthorName,
      proposalAuthoredAtUtc: input.resolutionActors.proposalAuthoredAtUtc,
      reviewerName: input.resolutionActors.reviewerName,
      reviewedAtUtc: input.resolutionActors.reviewedAtUtc,
      decisions: input.resolutionVerification.summary.decisions,
      fields: input.resolutionVerification.summary.fields,
      resolvedDecisionRootSha256:
        input.resolutionVerification.resolvedDecisionRootSha256,
    },
    summary: {
      decisions: reconciled.length,
      fields: reconciled.reduce((sum, decision) => sum + decision.fieldCount, 0),
      acceptedProposals: reconciled.filter(
        (decision) => decision.originalVerdict === "accept-proposal",
      ).length,
      preservedCurrentValues: reconciled.filter(
        (decision) => decision.originalVerdict === "preserve-current",
      ).length,
      resolvedEscalations: reconciled.filter(
        (decision) => decision.authority === "approved-third-value-resolution",
      ).length,
      unresolvedEscalations: 0,
    },
    reconciledDecisionRootSha256: sha256Canonical(reconciled),
    decisions: reconciled,
  } as const;
}

function buildFinalCandidates(
  worklists: Worklist[],
  exactDecisions: ExactDecision[],
  reconciled: readonly ReconciledDecision[],
  policy: AfrikaansReconciliationFrozenPolicy,
) {
  const values = new Map<
    string,
    FinalCandidateValue
  >();
  for (const decision of exactDecisions) {
    addFinalValue(values, decision.field.namespace, decision.field.key, {
      value: decision.decidedValue,
      valueSha256: decision.decidedValueSha256,
      authority: "locked-prepared-plan",
    });
  }
  for (const decision of reconciled) {
    if (sha256Text(decision.finalValue) !== decision.finalValueSha256) {
      throw new Error("Reconciled final-value hash drifted.");
    }
    for (const member of decision.members) {
      addFinalValue(values, member.namespace, member.key, {
        value: decision.finalValue,
        valueSha256: decision.finalValueSha256,
        authority:
          decision.authority === "approved-third-value-resolution"
            ? "approved-third-value-resolution"
            : "reviewer-reconciliation",
        reconciledDecision: decision,
      });
    }
  }
  if (values.size !== policy.totalProposalFields) {
    throw new Error("Final values omit or duplicate prepared fields.");
  }
  const identities: ManifestIdentity[] = [];
  let replacedFields = 0;
  let ordinaryCandidateQaFields = 0;
  const reviewedCandidateQaExceptions: TranslationCandidateQaReviewedException[] = [];
  const candidates = worklists.map((worklist) => {
    const entries = worklist.entries.map((entry) => {
      const final = values.get(fieldKey(worklist.namespace, entry.key));
      if (!final) throw new Error(`Missing final value for ${worklist.namespace}/${entry.key}.`);
      const quality = validateTranslationCandidateField({
        language: "Afrikaans",
        source: entry.source,
        value: final.value,
      });
      if (quality.failures.length) {
        reviewedCandidateQaExceptions.push(
          buildReviewedCandidateQaException({
            worklist,
            entry,
            final,
            failures: quality.failures,
          }),
        );
      } else {
        ordinaryCandidateQaFields += 1;
      }
      if (final.value !== entry.existingCandidate) replacedFields += 1;
      identities.push({
        namespace: worklist.namespace,
        sourceHash: worklist.sourceHash,
        key: entry.key,
        sourceSha256: sha256Text(entry.source),
        valueSha256: final.valueSha256,
        authority: final.authority,
      });
      return { ...entry, value: final.value };
    });
    return candidateSchema.parse({
      schemaVersion: 1,
      kind: "translation-repair-candidate",
      protectorVersion: worklist.protectorVersion,
      protectorFingerprint: worklist.protectorFingerprint,
      language: worklist.language,
      locale: worklist.locale,
      namespace: worklist.namespace,
      sourceHash: worklist.sourceHash,
      entries,
      draftModel: HYBRID_DRAFT_MODEL,
    });
  });
  if (reviewedCandidateQaExceptions.length > 1) {
    throw new Error("Only the single frozen reviewed candidate QA exception is permitted.");
  }
  const finalValueRootSha256 = sha256Canonical(identities);
  const candidateQaExceptionPolicy = reviewedCandidateQaExceptions.length
    ? Object.freeze({
        kind: "reviewed-candidate-field-exceptions-v1" as const,
        exceptions: Object.freeze(reviewedCandidateQaExceptions),
      })
    : undefined;
  return {
    candidates,
    identities,
    replacedFields,
    ordinaryCandidateQaFields,
    reviewedCandidateQaExceptionFields: reviewedCandidateQaExceptions.length,
    ...(candidateQaExceptionPolicy ? { candidateQaExceptionPolicy } : {}),
    finalValueRootSha256,
  };
}

function buildReviewedCandidateQaException(input: {
  worklist: Worklist;
  entry: z.infer<typeof worklistEntrySchema>;
  final: FinalCandidateValue;
  failures: readonly string[];
}): TranslationCandidateQaReviewedException {
  const decision = input.final.reconciledDecision;
  if (
    !decision ||
    decision.members.length !== 1 ||
    decision.fieldCount !== 1 ||
    decision.finalValue !== input.entry.existingCandidate ||
    input.final.value !== input.entry.existingCandidate ||
    input.final.valueSha256 !== sha256Text(input.final.value)
  ) {
    throw new Error(
      `Unvalidated final value for ${input.worklist.namespace}/${input.entry.key}: candidate QA exception is not an exact one-field preserve-current reconciliation.`,
    );
  }
  const member = decision.members[0];
  const binding = reviewedCandidateQaExceptionSchema.parse({
    kind: "reviewed-candidate-field-exception-v1",
    language: input.worklist.language,
    locale: input.worklist.locale,
    namespace: input.worklist.namespace,
    sourceHash: input.worklist.sourceHash,
    key: input.entry.key,
    sourceSha256: sha256Text(input.entry.source),
    valueSha256: input.final.valueSha256,
    decisionIdentitySha256: decision.decisionIdentitySha256,
    proposalIdentitySha256: decision.proposalIdentitySha256,
    fieldIdentitySha256: member.fieldIdentitySha256,
    reviewerId: decision.originalReviewerId,
    authority: decision.authority,
    verdict: decision.originalVerdict,
    failures: input.failures,
  });
  if (
    member.namespace !== input.worklist.namespace ||
    member.sourceHash !== input.worklist.sourceHash ||
    member.key !== input.entry.key ||
    canonicalJson(
      validateFrozenReviewedCandidateQaExceptionBinding(binding),
    ) !== canonicalJson(AFRIKAANS_REVIEWED_CANDIDATE_QA_EXCEPTION)
  ) {
    throw new Error(
      `Unvalidated final value for ${input.worklist.namespace}/${input.entry.key}: candidate QA exception evidence drifted.`,
    );
  }
  return AFRIKAANS_REVIEWED_CANDIDATE_QA_EXCEPTION;
}

function validateFrozenReviewedCandidateQaExceptionBinding(
  value: unknown,
): TranslationCandidateQaReviewedException {
  const binding = reviewedCandidateQaExceptionSchema.parse(value);
  if (canonicalJson(binding) !== canonicalJson(AFRIKAANS_REVIEWED_CANDIDATE_QA_EXCEPTION)) {
    throw new Error("Candidate QA exception is not the exact frozen reviewer-evidence binding.");
  }
  return AFRIKAANS_REVIEWED_CANDIDATE_QA_EXCEPTION;
}

function readAndValidateOwnerAcceptance(
  path: string,
  core: LoadedCore,
  nowEpochMs = Date.now(),
): OwnerAcceptance {
  const absolutePath = resolve(path);
  assertPathWithin(join(core.paths.repoRoot, "tmp"), absolutePath, "Owner acceptance");
  assertNoSymlinkAncestors(dirname(absolutePath), core.paths.repoRoot, "Owner acceptance");
  assertExactRealPathWithin(core.paths.repoRoot, absolutePath, "Owner acceptance");
  const descriptor = describeFile(absolutePath, "owner acceptance", true);
  const acceptance = ownerAcceptanceSchema.parse(
    readJson(absolutePath, "owner acceptance", descriptor),
  );
  const { canonicalSha256: claimedAcceptanceSha256, ...unsigned } = acceptance;
  if (sha256Canonical(unsigned) !== claimedAcceptanceSha256) {
    throw new Error("Owner acceptance fingerprint mismatch.");
  }
  const reviewerNames = new Set(
    [
      ...core.reviewerEvidence.map((evidence) => evidence.reviewer.reviewerName),
      core.resolutionActors.proposalAuthorName,
      core.resolutionActors.reviewerName,
    ].map((name) => name.trim().toLocaleLowerCase("en-US")),
  );
  if (reviewerNames.has(acceptance.ownerName.trim().toLocaleLowerCase("en-US"))) {
    throw new Error(
      "Owner acceptance must be independent of both semantic reviewers and both resolution actors.",
    );
  }
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
    throw new Error("Owner-acceptance verification clock must be a non-negative safe integer.");
  }
  const acceptedAtEpochMs = parseCanonicalUtcTimestamp(
    acceptance.acceptedAtUtc,
    "Owner acceptance timestamp",
  );
  const latestReviewEpochMs = Math.max(
    ...core.reviewerEvidence.map((evidence) =>
      parseCanonicalUtcTimestamp(
        evidence.reviewer.completedAtUtc,
        `${evidence.reviewer.reviewerId} completion timestamp`,
      ),
    ),
    parseCanonicalUtcTimestamp(
      core.resolutionActors.proposalAuthoredAtUtc,
      "Third-value proposal timestamp",
    ),
    parseCanonicalUtcTimestamp(
      core.resolutionActors.reviewedAtUtc,
      "Third-value review timestamp",
    ),
  );
  if (acceptedAtEpochMs <= latestReviewEpochMs) {
    throw new Error(
      "Owner acceptance must be causally later than the original and third-value reviews.",
    );
  }
  if (acceptedAtEpochMs > nowEpochMs) {
    throw new Error("Owner acceptance cannot be future-dated relative to the verification clock.");
  }
  const expectedBindings = buildOwnerAcceptanceBindings(core);
  if (canonicalJson(acceptance.bindings) !== canonicalJson(expectedBindings)) {
    throw new Error("Owner acceptance is stale or does not bind the exact reconciled result.");
  }
  assertFileDescriptorSettled(
    descriptor,
    describeFile(absolutePath, "settled owner acceptance", true),
    "Owner acceptance",
  );
  ownerAcceptancePaths.set(acceptance, descriptor.path);
  return acceptance;
}

function buildOwnerAcceptanceBindings(core: LoadedCore): OwnerAcceptance["bindings"] {
  return {
    adapterImplementationSha256: core.descriptors.adapterImplementation.sha256,
    candidateValidatorImplementationSha256:
      core.descriptors.candidateValidatorImplementation.sha256,
    preparedPlanSha256: core.policy.preparedPlanSha256,
    partitionPlanSha256: core.descriptors.partitionPlan.sha256,
    reviewBundleSha256: core.descriptors.reviewBundle.sha256,
    reviewerAEvidenceSha256: core.descriptors.reviewerEvidence[0].sha256,
    reviewerBEvidenceSha256: core.descriptors.reviewerEvidence[1].sha256,
    resolutionVerifierImplementationSha256:
      core.resolutionVerification.inputBindings.verifierImplementationSha256,
    resolutionFrozenPolicySha256:
      core.resolutionVerification.inputBindings.frozenPolicySha256,
    resolutionValidatorPolicySha256:
      core.resolutionVerification.inputBindings.validatorPolicySha256,
    thirdValueProposalsSha256:
      core.resolutionVerification.inputBindings.thirdValueProposalsSha256,
    thirdValueReviewSha256:
      core.resolutionVerification.inputBindings.thirdValueReviewSha256,
    escalationDecisionRootSha256:
      core.resolutionVerification.inputBindings.escalationDecisionRootSha256,
    thirdValueRootSha256:
      core.resolutionVerification.inputBindings.thirdValueRootSha256,
    resolvedEscalationDecisionRootSha256:
      core.resolutionVerification.resolvedDecisionRootSha256,
    reconciliationSha256: core.descriptors.reconciliation.sha256,
    diagnosticManifestSha256: core.descriptors.diagnosticManifest.sha256,
    diagnosticCandidateTreeSha256: core.diagnosticCandidateDescriptor.treeSha256,
    repairWorklistTreeSha256: core.worklistDescriptor.treeSha256,
    exactDecisionRootSha256: core.policy.exactDecisionRootSha256,
    unresolvedSemanticRootSha256: core.policy.unresolvedSemanticRootSha256,
    reconciledDecisionRootSha256: core.reconciledDecisionRootSha256,
    finalValueRootSha256: core.finalValueRootSha256,
  };
}

function buildManifestCore(
  core: LoadedCore,
  ownerAcceptance: OwnerAcceptance,
  output: TreeDescriptor & { draftModel: typeof HYBRID_DRAFT_MODEL },
) {
  const ownerAcceptanceDescriptor = describeFile(
    findOwnerAcceptancePath(ownerAcceptance, core),
    "owner acceptance",
    true,
  );
  return {
    schemaVersion: 3,
    kind: HYBRID_MANIFEST_KIND,
    hybridDraftModel: HYBRID_DRAFT_MODEL,
    provenance: {
      adapterKind: ADAPTER_KIND,
      repoRoot: core.paths.repoRoot,
      adapterImplementation: core.descriptors.adapterImplementation,
      candidateValidatorImplementation:
        core.descriptors.candidateValidatorImplementation,
      frozenPlanVersion: "afrikaans-residual-repair-workbench-v3",
      preparedPlan: core.descriptors.preparedPlan,
      workbench: core.descriptors.workbench,
      workbenchReadme: core.descriptors.workbenchReadme,
      noModelGateEvidence: core.descriptors.noModelGateEvidence,
      scope: core.descriptors.scope,
      worklist: core.worklistDescriptor,
      diagnosticManifest: core.descriptors.diagnosticManifest,
      diagnosticCandidates: core.diagnosticCandidateDescriptor,
      partitionLaneImplementation: core.descriptors.partitionLaneImplementation,
      reviewEvidenceSchema: core.descriptors.reviewEvidenceSchema,
      partitionPlan: core.descriptors.partitionPlan,
      reviewBundle: core.descriptors.reviewBundle,
      reviewerEvidence: core.descriptors.reviewerEvidence,
      resolutionVerifierImplementation:
        core.descriptors.resolutionVerifierImplementation,
      thirdValueProposals: core.descriptors.thirdValueProposals,
      thirdValueReview: core.descriptors.thirdValueReview,
      resolutionFrozenPolicySha256:
        core.resolutionVerification.inputBindings.frozenPolicySha256,
      resolutionValidatorPolicySha256:
        core.resolutionVerification.inputBindings.validatorPolicySha256,
      escalationDecisionRootSha256:
        core.resolutionVerification.inputBindings.escalationDecisionRootSha256,
      thirdValueRootSha256:
        core.resolutionVerification.inputBindings.thirdValueRootSha256,
      resolvedEscalationDecisionRootSha256:
        core.resolutionVerification.resolvedDecisionRootSha256,
      reconciliation: core.descriptors.reconciliation,
      ownerAcceptance: ownerAcceptanceDescriptor,
      exactDecisionRootSha256: core.policy.exactDecisionRootSha256,
      unresolvedSemanticRootSha256: core.policy.unresolvedSemanticRootSha256,
      reconciledDecisionRootSha256: core.reconciledDecisionRootSha256,
      finalValueRootSha256: core.finalValueRootSha256,
    },
    output,
    counts: {
      files: output.files.length,
      fields: output.fields,
      replacedFields: core.replacedFields,
      lockedFields: core.exactDecisions.length,
      reviewerReconciledFields: core.reviewerReconciledFields,
      resolvedEscalationFields: core.resolvedEscalationFields,
      ordinaryCandidateQaFields: core.ordinaryCandidateQaFields,
      reviewedCandidateQaExceptionFields:
        core.reviewedCandidateQaExceptionFields,
    },
    identities: core.identities,
  } as const;
}

const ownerAcceptancePaths = new WeakMap<OwnerAcceptance, string>();

function findOwnerAcceptancePath(acceptance: OwnerAcceptance, core: LoadedCore) {
  const remembered = ownerAcceptancePaths.get(acceptance);
  if (remembered) return remembered;
  throw new Error(
    `Owner acceptance path was not retained for ${core.paths.reconciliationPath}.`,
  );
}

function normalizeAndValidateInputPaths(
  input: AfrikaansReconciliationAdapterPaths,
  context: AdapterVerificationContext,
): AfrikaansReconciliationAdapterPaths {
  const repoRoot = resolve(input.repoRoot);
  const realRepoRoot = realpathSync(repoRoot);
  if (repoRoot !== context.expectedRepoRoot || realRepoRoot !== context.expectedRepoRoot) {
    throw new Error(
      `Adapter repo root must be the executing adapter's exact repository root: ${context.expectedRepoRoot}.`,
    );
  }
  assertNoSymlinkAncestors(repoRoot, repoRoot, "Adapter repo root");
  const normalized: AfrikaansReconciliationAdapterPaths = {
    repoRoot,
    adapterImplementationPath: resolve(input.adapterImplementationPath),
    candidateValidatorImplementationPath: resolve(
      input.candidateValidatorImplementationPath,
    ),
    preparedPlanPath: resolve(input.preparedPlanPath),
    workbenchPath: resolve(input.workbenchPath),
    workbenchReadmePath: resolve(input.workbenchReadmePath),
    noModelGateEvidencePath: resolve(input.noModelGateEvidencePath),
    scopePath: resolve(input.scopePath),
    worklistDir: resolve(input.worklistDir),
    diagnosticManifestPath: resolve(input.diagnosticManifestPath),
    diagnosticCandidateDir: resolve(input.diagnosticCandidateDir),
    partitionLaneImplementationPath: resolve(input.partitionLaneImplementationPath),
    reviewEvidenceSchemaPath: resolve(input.reviewEvidenceSchemaPath),
    partitionPlanPath: resolve(input.partitionPlanPath),
    reviewBundlePath: resolve(input.reviewBundlePath),
    reviewerAEvidencePath: resolve(input.reviewerAEvidencePath),
    reviewerBEvidencePath: resolve(input.reviewerBEvidencePath),
    resolutionVerifierImplementationPath: resolve(
      input.resolutionVerifierImplementationPath,
    ),
    thirdValueProposalsPath: resolve(input.thirdValueProposalsPath),
    thirdValueReviewPath: resolve(input.thirdValueReviewPath),
    reconciliationPath: resolve(input.reconciliationPath),
  };
  for (const [key, value] of Object.entries(normalized)) {
    if (key === "repoRoot") continue;
    assertPathWithin(repoRoot, value, key);
    assertNoSymlinkAncestors(dirname(value), repoRoot, key);
    const realValue = realpathSync(value);
    if (realValue !== value) {
      throw new Error(`${key} must use its exact real path without symbolic-link traversal: ${value}.`);
    }
    assertPathWithin(realRepoRoot, realValue, key);
  }
  if (normalized.adapterImplementationPath !== context.expectedAdapterPath) {
    throw new Error(
      `Adapter implementation path must be the executing module: ${context.expectedAdapterPath}.`,
    );
  }
  if (
    normalized.candidateValidatorImplementationPath !==
    ACTUAL_CANDIDATE_VALIDATOR_PATH
  ) {
    throw new Error(
      `Candidate validator implementation path must be the imported module: ${ACTUAL_CANDIDATE_VALIDATOR_PATH}.`,
    );
  }
  if (
    normalized.resolutionVerifierImplementationPath !==
    ACTUAL_RESOLUTION_VERIFIER_PATH
  ) {
    throw new Error(
      `Resolution verifier implementation path must be the imported module: ${ACTUAL_RESOLUTION_VERIFIER_PATH}.`,
    );
  }
  return normalized;
}

function loadWorklistTree(root: string): Worklist[] {
  const collection = collectExactAfrikaansTreeFiles(root, "worklist tree");
  const loaded = collection.files.map((file) => {
    const descriptor = describeFile(file, `worklist ${file}`);
    return {
      descriptor,
      value: worklistSchema.parse(readJson(file, `worklist ${file}`, descriptor)),
    };
  });
  const worklists = loaded.map((item) => item.value);
  worklists.sort((left, right) => compareCodePoints(candidatePath(left.namespace), candidatePath(right.namespace)));
  rememberLoadedTreeDescriptor(
    worklists,
    buildTreeDescriptor(
      root,
      worklists.reduce((sum, item) => sum + item.entries.length, 0),
      loaded.map((item) => item.descriptor),
      collection,
    ),
  );
  return worklists;
}

function loadCandidateTree(root: string): Candidate[] {
  const collection = collectExactAfrikaansTreeFiles(root, "candidate tree");
  const loaded = collection.files.map((file) => {
    const descriptor = describeFile(file, `candidate ${file}`);
    return {
      descriptor,
      value: candidateSchema.parse(readJson(file, `candidate ${file}`, descriptor)),
    };
  });
  const candidates = loaded.map((item) => item.value);
  candidates.sort((left, right) => compareCodePoints(candidatePath(left.namespace), candidatePath(right.namespace)));
  rememberLoadedTreeDescriptor(
    candidates,
    buildTreeDescriptor(
      root,
      candidates.reduce((sum, item) => sum + item.entries.length, 0),
      loaded.map((item) => item.descriptor),
      collection,
    ),
  );
  return candidates;
}

function validateCandidateIdentityAgainstWorklists(worklists: Worklist[], candidates: Candidate[]) {
  if (worklists.length !== candidates.length) throw new Error("Candidate/worklist file count differs.");
  for (let fileIndex = 0; fileIndex < worklists.length; fileIndex += 1) {
    const worklist = worklists[fileIndex];
    const candidate = candidates[fileIndex];
    if (
      candidate.namespace !== worklist.namespace ||
      candidate.sourceHash !== worklist.sourceHash ||
      candidate.protectorVersion !== worklist.protectorVersion ||
      candidate.protectorFingerprint !== worklist.protectorFingerprint ||
      candidate.entries.length !== worklist.entries.length
    ) {
      throw new Error(`Diagnostic candidate identity drifted for ${worklist.namespace}.`);
    }
    for (let entryIndex = 0; entryIndex < worklist.entries.length; entryIndex += 1) {
      const expected = worklist.entries[entryIndex];
      const actual = candidate.entries[entryIndex];
      if (
        expected.key !== actual.key ||
        expected.source !== actual.source ||
        expected.existingCandidate !== actual.existingCandidate ||
        canonicalJson(expected.reasons) !== canonicalJson(actual.reasons)
      ) {
        throw new Error(`Diagnostic candidate entry drifted at ${worklist.namespace}/${expected.key}.`);
      }
    }
  }
}

function assertCandidatesEqual(expected: Candidate[], actual: Candidate[]) {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error("Materialized candidates differ from exact locked + reconciled values.");
  }
}

function describeWorklistTree(root: string, worklists: Worklist[]): TreeDescriptor {
  return (
    loadedTreeDescriptors.get(worklists) ??
    describeJsonTree(root, worklists.reduce((sum, item) => sum + item.entries.length, 0))
  );
}

function describeCandidateTree(root: string, candidates?: Candidate[]): TreeDescriptor {
  const loaded = candidates ?? loadCandidateTree(root);
  return (
    loadedTreeDescriptors.get(loaded) ??
    describeJsonTree(root, loaded.reduce((sum, item) => sum + item.entries.length, 0))
  );
}

function describeJsonTree(root: string, fields: number): TreeDescriptor {
  const absoluteRoot = resolve(root);
  const collection = collectExactAfrikaansTreeFiles(absoluteRoot, "JSON tree");
  const descriptors = collection.files.map((file) =>
    describeFile(file, `JSON tree file ${file}`),
  );
  return buildTreeDescriptor(absoluteRoot, fields, descriptors, collection);
}

type ExactTreeCollection = Readonly<{
  files: string[];
  rootIdentity: FsIdentity;
  localeIdentity: FsIdentity;
}>;

const loadedTreeDescriptors = new WeakMap<object, TreeDescriptor>();
const treeDirectorySnapshots = new WeakMap<
  TreeDescriptor,
  Readonly<{ rootIdentity: FsIdentity; localeIdentity: FsIdentity }>
>();

function rememberLoadedTreeDescriptor(values: object, descriptor: TreeDescriptor) {
  loadedTreeDescriptors.set(values, descriptor);
}

function buildTreeDescriptor(
  root: string,
  fields: number,
  descriptors: FileDescriptor[],
  collection: ExactTreeCollection,
): TreeDescriptor {
  const absoluteRoot = resolve(root);
  assertDirectoryIdentityCurrent(absoluteRoot, collection.rootIdentity, "JSON tree root");
  assertDirectoryIdentityCurrent(
    join(absoluteRoot, "af"),
    collection.localeIdentity,
    "JSON tree locale root",
  );
  const files = descriptors.map((descriptor) => ({
    relativePath: relative(absoluteRoot, descriptor.path).split(sep).join("/"),
    bytes: descriptor.bytes,
    sha256: descriptor.sha256,
  }));
  files.sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
  const tree = treeDescriptorSchema.parse({
    path: absoluteRoot,
    files,
    fields,
    treeSha256: sha256Canonical(files.map((file) => [file.relativePath, file.bytes, file.sha256])),
  });
  treeDirectorySnapshots.set(tree, {
    rootIdentity: collection.rootIdentity,
    localeIdentity: collection.localeIdentity,
  });
  return tree;
}

function assertTreeDescriptorSettled(expected: TreeDescriptor, current: TreeDescriptor, label: string) {
  if (canonicalJson(expected) !== canonicalJson(current)) {
    throw new Error(`${label} bytes or exact shape drifted during verification.`);
  }
  const expectedDirectories = treeDirectorySnapshots.get(expected);
  const currentDirectories = treeDirectorySnapshots.get(current);
  if (
    !expectedDirectories ||
    !currentDirectories ||
    !sameFsIdentity(expectedDirectories.rootIdentity, currentDirectories.rootIdentity) ||
    !sameFsIdentity(expectedDirectories.localeIdentity, currentDirectories.localeIdentity)
  ) {
    throw new Error(`${label} directory inode or metadata drifted during verification.`);
  }
}

type FsIdentity = Readonly<{
  device: string;
  inode: string;
  mode: string;
  links: string;
  size: string;
  modifiedNs: string;
  changedNs: string;
}>;

const fileSnapshots = new WeakMap<
  FileDescriptor,
  Readonly<{ bytes: Buffer; identity: FsIdentity }>
>();

function assertSafeFileMetadata(
  metadata: BigIntStats,
  absolutePath: string,
  label: string,
  requirePrivate: boolean,
) {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== BigInt(1)) {
    throw new Error(`${label} must be a regular, unlinked file: ${absolutePath}.`);
  }
  if (metadata.size < BigInt(2) || metadata.size > BigInt(MAXIMUM_JSON_BYTES)) {
    throw new Error(`${label} has unsafe size: ${absolutePath}.`);
  }
  if (requirePrivate && (metadata.mode & BigInt(0o077)) !== BigInt(0)) {
    throw new Error(`${label} must not be group- or world-accessible.`);
  }
}

function fileIdentity(metadata: BigIntStats): FsIdentity {
  return {
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    mode: metadata.mode.toString(),
    links: metadata.nlink.toString(),
    size: metadata.size.toString(),
    modifiedNs: metadata.mtimeNs.toString(),
    changedNs: metadata.ctimeNs.toString(),
  };
}

function sameFsIdentity(left: FsIdentity, right: FsIdentity) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertFileDescriptorSettled(expected: FileDescriptor, current: FileDescriptor, label: string) {
  if (current.bytes !== expected.bytes || current.sha256 !== expected.sha256) {
    throw new Error(`${label} bytes drifted during verification: ${expected.path}.`);
  }
  const expectedSnapshot = fileSnapshots.get(expected);
  const currentSnapshot = fileSnapshots.get(current);
  if (
    !expectedSnapshot ||
    !currentSnapshot ||
    !sameFsIdentity(expectedSnapshot.identity, currentSnapshot.identity)
  ) {
    throw new Error(`${label} inode or metadata drifted during verification: ${expected.path}.`);
  }
}

function describeFile(path: string, label: string, requirePrivate = false): FileDescriptor {
  const absolute = resolve(path);
  if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
    throw new Error("This platform cannot enforce O_NOFOLLOW for reconciliation inputs.");
  }
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd, { bigint: true });
    assertSafeFileMetadata(before, absolute, label, requirePrivate);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    const beforeIdentity = fileIdentity(before);
    const afterIdentity = fileIdentity(after);
    if (!sameFsIdentity(beforeIdentity, afterIdentity)) {
      throw new Error(`${label} drifted while its bytes were being read: ${absolute}.`);
    }
    if (BigInt(bytes.byteLength) !== before.size) {
      throw new Error(`${label} byte count drifted while being read: ${absolute}.`);
    }
    const pathMetadata = lstatSync(absolute, { bigint: true });
    const pathIdentity = fileIdentity(pathMetadata);
    if (
      pathMetadata.isSymbolicLink() ||
      !pathMetadata.isFile() ||
      !sameFsIdentity(beforeIdentity, pathIdentity)
    ) {
      throw new Error(`${label} path no longer names the opened file: ${absolute}.`);
    }
    const descriptor = {
      path: absolute,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    fileSnapshots.set(descriptor, { bytes, identity: beforeIdentity });
    return descriptor;
  } finally {
    closeSync(fd);
  }
}

function collectExactAfrikaansTreeFiles(root: string, label: string): ExactTreeCollection {
  const absoluteRoot = resolve(root);
  const rootIdentity = snapshotDirectoryIdentity(absoluteRoot, label);
  const rootEntries = readdirSync(absoluteRoot, { withFileTypes: true });
  if (
    rootEntries.length !== 1 ||
    rootEntries[0].name !== "af" ||
    !rootEntries[0].isDirectory() ||
    rootEntries[0].isSymbolicLink()
  ) {
    throw new Error(`${label} must have the exact root/af directory shape.`);
  }
  const localeRoot = join(absoluteRoot, "af");
  const localeIdentity = snapshotDirectoryIdentity(localeRoot, `${label} locale root`);
  const entries = readdirSync(localeRoot, { withFileTypes: true }).sort((left, right) =>
    compareCodePoints(left.name, right.name),
  );
  const expectedNames = EXPECTED_CANDIDATE_FILES.map((file) => file.slice(3));
  if (
    entries.length !== expectedNames.length ||
    entries.some(
      (entry, index) =>
        entry.name !== expectedNames[index] ||
        !entry.isFile() ||
        entry.isSymbolicLink(),
    )
  ) {
    throw new Error(`${label} must contain exactly ${EXPECTED_CANDIDATE_FILES.join(", ")}.`);
  }
  assertDirectoryIdentityCurrent(absoluteRoot, rootIdentity, label);
  assertDirectoryIdentityCurrent(localeRoot, localeIdentity, `${label} locale root`);
  return {
    files: entries.map((entry) => join(localeRoot, entry.name)),
    rootIdentity,
    localeIdentity,
  };
}

function snapshotDirectoryIdentity(path: string, label: string): FsIdentity {
  const metadata = lstatSync(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory: ${path}.`);
  }
  return fileIdentity(metadata);
}

function assertDirectoryIdentityCurrent(path: string, expected: FsIdentity, label: string) {
  const current = snapshotDirectoryIdentity(path, label);
  if (!sameFsIdentity(expected, current)) {
    throw new Error(`${label} inode or metadata drifted during tree verification: ${path}.`);
  }
}

function readJson(path: string, label: string, expectedDescriptor?: FileDescriptor): unknown {
  const descriptor = expectedDescriptor ?? describeFile(path, label);
  if (descriptor.path !== resolve(path)) {
    throw new Error(`${label} descriptor path drifted from ${resolve(path)}.`);
  }
  const snapshot = fileSnapshots.get(descriptor);
  if (!snapshot) throw new Error(`${label} descriptor has no same-FD byte snapshot.`);
  try {
    return parseStrictJsonBytes(snapshot.bytes, label);
  } catch (error: unknown) {
    throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

function parseStrictJsonBytes(raw: Buffer, label: string): unknown {
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) {
    throw new Error(`${label} is not valid UTF-8.`);
  }
  new StrictJsonScanner(text, label).scan();
  return JSON.parse(text) as unknown;
}

class StrictJsonScanner {
  private index = 0;

  constructor(
    private readonly raw: string,
    private readonly label: string,
  ) {}

  scan() {
    this.whitespace();
    this.value(0);
    this.whitespace();
    if (this.index !== this.raw.length) this.fail("has trailing JSON data");
  }

  private value(depth: number): void {
    if (depth > MAXIMUM_JSON_DEPTH) {
      this.fail("exceeds the JSON nesting bound");
    }
    const token = this.raw[this.index];
    if (token === "{") return this.object(depth + 1);
    if (token === "[") return this.array(depth + 1);
    if (token === '"') {
      this.string();
      return;
    }
    if (token === "t") return this.literal("true");
    if (token === "f") return this.literal("false");
    if (token === "n") return this.literal("null");
    if (
      token === "-" ||
      (token !== undefined && token >= "0" && token <= "9")
    ) {
      this.number();
      return;
    }
    this.fail("contains an invalid JSON token");
  }

  private object(depth: number): void {
    this.index += 1;
    this.whitespace();
    const keys = new Set<string>();
    if (this.raw[this.index] === "}") {
      this.index += 1;
      return;
    }
    for (;;) {
      if (this.raw[this.index] !== '"') {
        this.fail("contains an invalid object key");
      }
      const key = this.string();
      if (keys.has(key)) {
        this.fail(`contains duplicate JSON key ${JSON.stringify(key)}`);
      }
      keys.add(key);
      this.whitespace();
      if (this.raw[this.index] !== ":") {
        this.fail("contains an invalid object separator");
      }
      this.index += 1;
      this.whitespace();
      this.value(depth);
      this.whitespace();
      if (this.raw[this.index] === "}") {
        this.index += 1;
        return;
      }
      if (this.raw[this.index] !== ",") {
        this.fail("contains an invalid object delimiter");
      }
      this.index += 1;
      this.whitespace();
    }
  }

  private array(depth: number): void {
    this.index += 1;
    this.whitespace();
    if (this.raw[this.index] === "]") {
      this.index += 1;
      return;
    }
    for (;;) {
      this.value(depth);
      this.whitespace();
      if (this.raw[this.index] === "]") {
        this.index += 1;
        return;
      }
      if (this.raw[this.index] !== ",") {
        this.fail("contains an invalid array delimiter");
      }
      this.index += 1;
      this.whitespace();
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    for (;;) {
      const character = this.raw[this.index];
      if (character === undefined || character < " ") {
        this.fail("contains an invalid JSON string");
      }
      if (character === '"') {
        this.index += 1;
        const decoded: unknown = JSON.parse(this.raw.slice(start, this.index));
        if (typeof decoded !== "string") {
          this.fail("contains an invalid JSON string");
        }
        return decoded;
      }
      if (character === "\\") {
        this.index += 1;
        const escaped = this.raw[this.index];
        if (escaped === "u") {
          if (
            !/^[a-fA-F0-9]{4}$/u.test(
              this.raw.slice(this.index + 1, this.index + 5),
            )
          ) {
            this.fail("contains an invalid Unicode escape");
          }
          this.index += 5;
          continue;
        }
        if (escaped === undefined || !'"\\/bfnrt'.includes(escaped)) {
          this.fail("contains an invalid string escape");
        }
      }
      this.index += 1;
    }
  }

  private number(): void {
    const remaining = this.raw.slice(this.index);
    const match =
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(remaining);
    if (!match) this.fail("contains an invalid JSON number");
    const next = remaining[match[0].length];
    if (next !== undefined && !/[,\]}\s]/u.test(next)) {
      this.fail("contains an invalid JSON number");
    }
    if (!Number.isFinite(Number(match[0]))) {
      this.fail("contains a non-finite JSON number");
    }
    this.index += match[0].length;
  }

  private literal(value: string): void {
    if (this.raw.slice(this.index, this.index + value.length) !== value) {
      this.fail("contains an invalid JSON literal");
    }
    this.index += value.length;
  }

  private whitespace(): void {
    while (
      this.index < this.raw.length &&
      /\s/u.test(this.raw[this.index] ?? "")
    ) {
      this.index += 1;
    }
  }

  private fail(reason: string): never {
    throw new Error(`${this.label} ${reason}.`);
  }
}

type OwnedPath = Readonly<{
  path: string;
  kind: "file" | "directory";
  identity: FsIdentity;
}>;

function captureOwnedPath(path: string, kind: OwnedPath["kind"], label: string): OwnedPath {
  const absolute = resolve(path);
  const metadata = lstatSync(absolute, { bigint: true });
  if (
    metadata.isSymbolicLink() ||
    (kind === "file" && (!metadata.isFile() || metadata.nlink !== BigInt(1))) ||
    (kind === "directory" && !metadata.isDirectory())
  ) {
    throw new Error(`${label} is not the newly owned ${kind}: ${absolute}.`);
  }
  return { path: absolute, kind, identity: fileIdentity(metadata) };
}

function sameNodeIdentity(left: FsIdentity, right: FsIdentity) {
  return left.device === right.device && left.inode === right.inode;
}

function assertOwnedPathCurrent(owned: OwnedPath, label: string, requireFullIdentity: boolean) {
  const current = captureOwnedPath(owned.path, owned.kind, label);
  const matches = requireFullIdentity
    ? sameFsIdentity(owned.identity, current.identity)
    : sameNodeIdentity(owned.identity, current.identity);
  if (!matches) throw new Error(`${label} no longer names the path created by this invocation.`);
}

function removeOwnedFile(owned: OwnedPath, label: string) {
  if (owned.kind !== "file") throw new Error(`${label} cleanup expected an owned file.`);
  assertOwnedPathCurrent(owned, label, true);
  unlinkSync(owned.path);
}

function removeOwnedCandidateTree(input: {
  root: OwnedPath;
  localeRoot: OwnedPath | null;
  files: OwnedPath[];
}) {
  if (input.root.kind !== "directory") {
    throw new Error("Candidate cleanup root is not an owned directory.");
  }
  assertOwnedPathCurrent(input.root, "Candidate cleanup root", false);
  const rootEntries = readdirSync(input.root.path, { withFileTypes: true });
  if (!input.localeRoot) {
    if (rootEntries.length) {
      throw new Error("Candidate cleanup refused an unexpected root entry.");
    }
    rmdirSync(input.root.path);
    return;
  }
  if (
    rootEntries.length !== 1 ||
    rootEntries[0].name !== "af" ||
    !rootEntries[0].isDirectory() ||
    rootEntries[0].isSymbolicLink()
  ) {
    throw new Error("Candidate cleanup refused a drifted root tree shape.");
  }
  assertOwnedPathCurrent(input.localeRoot, "Candidate cleanup locale root", false);
  const localeEntries = readdirSync(input.localeRoot.path, { withFileTypes: true }).sort(
    (left, right) => compareCodePoints(left.name, right.name),
  );
  const expectedNames = input.files
    .map((file) => file.path.slice(file.path.lastIndexOf(sep) + 1))
    .sort(compareCodePoints);
  if (
    localeEntries.length !== expectedNames.length ||
    localeEntries.some(
      (entry, index) =>
        entry.name !== expectedNames[index] || !entry.isFile() || entry.isSymbolicLink(),
    )
  ) {
    throw new Error("Candidate cleanup refused a drifted locale tree shape.");
  }
  for (const file of input.files) removeOwnedFile(file, `Candidate cleanup file ${file.path}`);
  rmdirSync(input.localeRoot.path);
  rmdirSync(input.root.path);
}

function writeRestrictedJson(path: string, value: unknown): OwnedPath {
  if (!Number.isInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
    throw new Error("This platform cannot enforce O_NOFOLLOW for reconciliation outputs.");
  }
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  const openedIdentity = fileIdentity(fstatSync(fd, { bigint: true }));
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
    fchmodSync(fd, 0o600);
    fsyncSync(fd);
    const finalIdentity = fileIdentity(fstatSync(fd, { bigint: true }));
    closeSync(fd);
    const owned = captureOwnedPath(path, "file", `Restricted JSON output ${path}`);
    if (!sameFsIdentity(finalIdentity, owned.identity)) {
      throw new Error(`Restricted JSON output path drifted after creation: ${path}.`);
    }
    return owned;
  } catch (error: unknown) {
    try {
      closeSync(fd);
    } catch {
      // The descriptor may already have been closed after a successful write.
    }
    if (existsSync(path)) {
      const current = captureOwnedPath(path, "file", `Failed restricted JSON output ${path}`);
      if (sameNodeIdentity(openedIdentity, current.identity)) unlinkSync(path);
    }
    throw error;
  }
}

function toError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}

function assertNewIgnoredOutputDirectory(path: string, repoRoot: string, label: string) {
  const absolute = resolve(path);
  assertPathWithin(join(resolve(repoRoot), "tmp"), absolute, label);
  if (existsSync(absolute)) throw new Error(`${label} must not already exist: ${absolute}.`);
  assertNoSymlinkAncestors(dirname(absolute), resolve(repoRoot), label);
  assertNewPathParentAnchored(repoRoot, absolute, label);
  return absolute;
}

function assertNewIgnoredOutputFile(path: string, repoRoot: string, label: string) {
  const absolute = resolve(path);
  assertPathWithin(join(resolve(repoRoot), "tmp"), absolute, label);
  if (existsSync(absolute)) throw new Error(`${label} must not already exist: ${absolute}.`);
  assertNoSymlinkAncestors(dirname(absolute), resolve(repoRoot), label);
  assertNewPathParentAnchored(repoRoot, absolute, label);
  return absolute;
}

function assertNewPathParentAnchored(repoRoot: string, target: string, label: string) {
  let existingAncestor = dirname(resolve(target));
  const boundary = resolve(repoRoot);
  while (!existsSync(existingAncestor)) {
    if (existingAncestor === boundary) break;
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) throw new Error(`${label} escaped ${boundary}.`);
    existingAncestor = parent;
  }
  assertExactRealPathWithin(boundary, existingAncestor, `${label} existing parent`);
}

function assertExactRealPathWithin(repoRoot: string, target: string, label: string) {
  const lexicalRoot = resolve(repoRoot);
  const lexicalTarget = resolve(target);
  const realRoot = realpathSync(lexicalRoot);
  assertPathWithinOrEqual(lexicalRoot, lexicalTarget, label);
  assertNoSymlinkAncestors(
    lexicalTarget === lexicalRoot ? lexicalRoot : dirname(lexicalTarget),
    lexicalRoot,
    label,
  );
  const realTarget = realpathSync(lexicalTarget);
  if (realTarget !== lexicalTarget) {
    throw new Error(`${label} must use its exact real path without symbolic-link traversal: ${lexicalTarget}.`);
  }
  assertPathWithinOrEqual(realRoot, realTarget, label);
}

function assertNoSymlinkAncestors(path: string, stop: string, label: string) {
  let current = resolve(path);
  const boundary = resolve(stop);
  const fromBoundary = relative(boundary, current);
  if (fromBoundary.startsWith("..") || isAbsolute(fromBoundary)) {
    throw new Error(`${label} escaped ${boundary}.`);
  }
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} has a symlink ancestor: ${current}.`);
    }
    if (current === boundary) break;
    const parent = dirname(current);
    if (parent === current) throw new Error(`${label} escaped ${boundary}.`);
    current = parent;
  }
}

function assertPathWithin(root: string, target: string, label: string) {
  const relativePath = relative(resolve(root), resolve(target));
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label} must be below ${resolve(root)}.`);
  }
}

function assertPathWithinOrEqual(root: string, target: string, label: string) {
  const relativePath = relative(resolve(root), resolve(target));
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label} must be within ${resolve(root)}.`);
  }
}

function assertDifferentPaths(paths: string[], label: string) {
  const normalized = paths.map((path) => resolve(path));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must be distinct.`);
}

function assertPathOutsideDirectory(path: string, directory: string, label: string) {
  const nested = relative(resolve(directory), resolve(path));
  if (!nested.startsWith("..") && !isAbsolute(nested)) {
    throw new Error(`${label} must be outside ${directory}.`);
  }
}

function assertFrozenFile(descriptor: FileDescriptor, expectedSha256: string, label: string) {
  if (descriptor.sha256 !== expectedSha256) {
    throw new Error(`${label} SHA-256 drifted: expected ${expectedSha256}, found ${descriptor.sha256}.`);
  }
}

function validateFieldHashes(field: Field) {
  if (
    field.source.normalize("NFC") !== field.source ||
    field.currentValue.normalize("NFC") !== field.currentValue ||
    field.sourceSha256 !== sha256Text(field.source) ||
    field.currentValueSha256 !== sha256Text(field.currentValue)
  ) {
    throw new Error(`Prepared field hash or NFC drifted for ${field.namespace}/${field.key}.`);
  }
}

function addPreparedField(
  fields: Map<string, { field: Field; authority: "locked" | "unresolved" }>,
  field: Field,
  authority: "locked" | "unresolved",
) {
  const identity = fieldKey(field.namespace, field.key);
  if (fields.has(identity)) throw new Error(`Duplicate prepared field ${identity}.`);
  fields.set(identity, { field, authority });
}

function addFinalValue(
  values: Map<string, FinalCandidateValue>,
  namespace: z.infer<typeof namespaceSchema>,
  key: string,
  value: FinalCandidateValue,
) {
  const identity = fieldKey(namespace, key);
  if (values.has(identity)) throw new Error(`Duplicate final value ${identity}.`);
  values.set(identity, value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort(compareCodePoints);
  const expected = [...expectedKeys].sort(compareCodePoints);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((key) => !actualSet.has(key));
    const unexpected = actual.filter((key) => !expectedSet.has(key));
    throw new Error(
      `${label} keys drifted: missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}.`,
    );
  }
}

function requireSha256(value: unknown, label: string): string {
  const parsed = sha256Schema.safeParse(value);
  if (!parsed.success) throw new Error(`${label} must be a lowercase SHA-256.`);
  return parsed.data;
}

function isCanonicalUtcTimestamp(value: string) {
  const epochMs = Date.parse(value);
  if (!Number.isSafeInteger(epochMs)) return false;
  const roundTrip = new Date(epochMs).toISOString();
  const expectedRoundTrip = value.includes(".") ? value : value.replace(/Z$/u, ".000Z");
  return roundTrip === expectedRoundTrip;
}

function parseCanonicalUtcTimestamp(value: string, label: string) {
  if (!isCanonicalUtcTimestamp(value)) {
    throw new Error(`${label} must be a real canonical UTC instant.`);
  }
  const epochMs = Date.parse(value);
  if (!Number.isSafeInteger(epochMs)) {
    throw new Error(`${label} is outside the safe JavaScript timestamp range.`);
  }
  return epochMs;
}

function fieldKey(namespace: string, key: string) {
  return `${namespace}\u0000${key}`;
}

function candidatePath(namespace: z.infer<typeof namespaceSchema>) {
  return `af/${namespace}.json`;
}

function compareMembers(left: z.infer<typeof memberSchema>, right: z.infer<typeof memberSchema>) {
  return (
    compareCodePoints(left.namespace, right.namespace) ||
    compareCodePoints(left.key, right.key) ||
    compareCodePoints(left.sourceHash, right.sourceHash) ||
    compareCodePoints(left.fieldIdentitySha256, right.fieldIdentitySha256)
  );
}

function isSortedUnique(values: readonly string[]) {
  return values.every((value, index) => index === 0 || compareCodePoints(values[index - 1], value) < 0);
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256CanonicalAfrikaansReconciliation(value: unknown) {
  return sha256Canonical(value);
}

function sha256Canonical(value: unknown) {
  return sha256Text(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain non-finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`Unsupported canonical JSON value: ${typeof value}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAfrikaansReconciliationAdapterCli(rawArgs: readonly string[]) {
  const commonKeys = new Set([
    "partition-plan",
    "review-bundle",
    "reviewer-a",
    "reviewer-b",
    "resolution-proposals",
    "resolution-review",
    "reconciliation",
  ]);
  const executeOnlyKeys = new Set([
    "owner-acceptance",
    "output-candidate-dir",
    "manifest",
  ]);
  const allowedKeys = new Set([...commonKeys, ...executeOnlyKeys]);
  let execute = false;
  const values = new Map<string, string>();
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (argument === "--execute") {
      if (execute) throw new Error("Duplicate adapter flag: --execute.");
      execute = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`Unknown adapter argument: ${argument}.`);
    const equals = argument.indexOf("=");
    const key = argument.slice(2, equals >= 0 ? equals : undefined);
    if (!allowedKeys.has(key)) throw new Error(`Unknown adapter flag: --${key}.`);
    if (values.has(key)) throw new Error(`Duplicate adapter flag: --${key}.`);
    if (equals >= 0) {
      const value = argument.slice(equals + 1);
      if (!value) throw new Error(`Missing value for --${key}.`);
      values.set(key, value);
      continue;
    }
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    values.set(key, value);
    index += 1;
  }
  if (!execute) {
    const invalid = [...executeOnlyKeys].filter((key) => values.has(key));
    if (invalid.length) {
      throw new Error(
        `Execute-only adapter flags require --execute: ${invalid.map((key) => `--${key}`).join(", ")}.`,
      );
    }
  }
  const defaults = defaultAfrikaansReconciliationAdapterPaths();
  const paths = {
    ...defaults,
    partitionPlanPath: resolve(values.get("partition-plan") ?? defaults.partitionPlanPath),
    reviewBundlePath: resolve(values.get("review-bundle") ?? defaults.reviewBundlePath),
    reviewerAEvidencePath: resolve(values.get("reviewer-a") ?? defaults.reviewerAEvidencePath),
    reviewerBEvidencePath: resolve(values.get("reviewer-b") ?? defaults.reviewerBEvidencePath),
    thirdValueProposalsPath: resolve(
      values.get("resolution-proposals") ?? defaults.thirdValueProposalsPath,
    ),
    thirdValueReviewPath: resolve(
      values.get("resolution-review") ?? defaults.thirdValueReviewPath,
    ),
    reconciliationPath: resolve(values.get("reconciliation") ?? defaults.reconciliationPath),
  };
  if (!execute) return { execute: false as const, paths };
  const ownerAcceptancePath = values.get("owner-acceptance");
  const outputCandidateDir = values.get("output-candidate-dir");
  const manifestPath = values.get("manifest");
  if (!ownerAcceptancePath || !outputCandidateDir || !manifestPath) {
    throw new Error(
      "--execute requires --owner-acceptance, --output-candidate-dir, and --manifest; it only materializes validator inputs and never applies translations.",
    );
  }
  return {
    execute: true as const,
    paths,
    ownerAcceptancePath: resolve(ownerAcceptancePath),
    outputCandidateDir: resolve(outputCandidateDir),
    manifestPath: resolve(manifestPath),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = parseAfrikaansReconciliationAdapterCli(process.argv.slice(2));
    if (command.execute) {
      const result = materializeAfrikaansReconciliationApplyAdapter(command);
      console.log(JSON.stringify({ event: "afrikaans_reconciliation_candidates_materialized", applyPerformed: false, ...result }));
    } else {
      const result = verifyAfrikaansReconciliationApplyAdapter(command);
      console.log(
        JSON.stringify({
          event: "afrikaans_reconciliation_verified_read_only",
          trackedWritesPerformed: false,
          applyPerformed: false,
          ownerAcceptanceRequiredForMaterialization: true,
          ...result,
          candidates: undefined,
        }),
      );
    }
  } catch (error: unknown) {
    console.error(
      JSON.stringify(
        {
          event: "afrikaans_reconciliation_adapter_failed_closed",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}
