import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  protectedLiteralsIn,
  validateTranslationCandidateField,
} from "@/lib/i18n/translation-candidate-quality";
import { isValidFieldTranslation } from "@/lib/i18n/translation-field-validation";
import { inspectTranslationFieldFluency } from "@/lib/i18n/translation-quality";
import { placeholdersIn } from "@/lib/i18n/translation-validation";
import { createLongTailValidatorPolicyProvenance } from "./translation-validator-policy-provenance";

const PARTITION_PLAN_KIND = "afrikaans-parallel-semantic-adjudication-plan-v1";
const REVIEW_BUNDLE_KIND = "afrikaans-parallel-semantic-review-bundle-v1";
const REVIEW_EVIDENCE_KIND = "afrikaans-semantic-review-evidence-v1";
const THIRD_VALUE_PROPOSALS_KIND =
  "afrikaans-escalation-third-value-proposals-v1";
const THIRD_VALUE_REVIEW_KIND = "afrikaans-escalation-third-value-review-v1";
const VERIFICATION_KIND = "afrikaans-escalation-resolution-verification-v1";
const FAILURE_KIND = "afrikaans-escalation-resolution-verification-failure-v1";
const MAXIMUM_JSON_BYTES = 16 * 1024 * 1024;
const MAXIMUM_JSON_DEPTH = 64;
const ISO_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const namespaceSchema = z.enum(["main-app", "marketing-shell"]);
const originalReviewerIdSchema = z.enum(["reviewer-a", "reviewer-b"]);

const safetyShape = {
  diagnosticOnly: z.literal(true),
  trustModel: z.literal("trusted-single-user-local-workspace"),
  authentication: z.literal("none"),
  identityClaimsVerified: z.literal(false),
  trackedWritesPerformed: z.literal(false),
  trackedWritesPermitted: z.literal(false),
  writePermitted: z.literal(false),
  materializePermitted: z.literal(false),
  applyPermitted: z.literal(false),
  promotePermitted: z.literal(false),
  importPermitted: z.literal(false),
  releaseAttestation: z.literal(false),
} as const;

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

const proposalSchema = semanticDecisionSchema
  .extend({
    proposalIdentitySha256: sha256Schema,
    proposedValue: z.string().min(1),
    proposedValueSha256: sha256Schema,
  })
  .strict();

const reviewerPartitionSchema = z
  .object({
    reviewerId: originalReviewerIdSchema,
    decisionCount: z.number().int().positive(),
    fieldCount: z.number().int().positive(),
    partitionRootSha256: sha256Schema,
    decisionIds: z.array(sha256Schema).min(1),
  })
  .strict();

const partitionPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(PARTITION_PLAN_KIND),
    diagnosticOnly: z.literal(true),
    trackedWritesPermitted: z.literal(false),
    promotePermitted: z.literal(false),
    importPermitted: z.literal(false),
    applyPermitted: z.literal(false),
    releaseAttestation: z.literal(false),
    inputBindings: z
      .object({
        preparedPlanSha256: sha256Schema,
      })
      .passthrough(),
    laneImplementationBindings: z.unknown(),
    corpus: z
      .object({
        fields: z.number().int().positive(),
        decisions: z.number().int().positive(),
        groupingKey: z.string().min(1),
        groupingInvariant: z.string().min(1),
        duplicateSourceGroups: z.number().int().nonnegative(),
        fieldIdentityRootSha256: sha256Schema,
        decisionRootSha256: sha256Schema,
      })
      .strict(),
    partitionAlgorithm: z.unknown(),
    decisions: z.array(semanticDecisionSchema).min(1),
    reviewers: z.tuple([reviewerPartitionSchema, reviewerPartitionSchema]),
    evidenceContract: z.unknown(),
    reconciliationContract: z.unknown(),
  })
  .strict();

const reviewerBundlePartitionSchema = z
  .object({
    reviewerId: originalReviewerIdSchema,
    partitionRootSha256: sha256Schema,
    decisionCount: z.number().int().positive(),
    fieldCount: z.number().int().positive(),
    proposals: z.array(proposalSchema).min(1),
  })
  .strict();

const reviewBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(REVIEW_BUNDLE_KIND),
    diagnosticOnly: z.literal(true),
    trackedWritesPermitted: z.literal(false),
    promotePermitted: z.literal(false),
    importPermitted: z.literal(false),
    applyPermitted: z.literal(false),
    releaseAttestation: z.literal(false),
    inputBindings: z
      .object({
        partitionPlanSha256: sha256Schema,
        preparedPlanSha256: sha256Schema,
        decisionRootSha256: sha256Schema,
        diagnosticManifestSha256: sha256Schema,
        diagnosticManifestKind: z.string().min(1),
        candidateTreeSha256: sha256Schema,
        proposalRootSha256: sha256Schema,
      })
      .strict(),
    proposalCount: z.number().int().positive(),
    proposalFieldCount: z.number().int().positive(),
    reviewers: z.tuple([
      reviewerBundlePartitionSchema,
      reviewerBundlePartitionSchema,
    ]),
    evidenceInstructions: z.unknown(),
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
        reviewerId: originalReviewerIdSchema,
        reviewerName: z.string().min(1),
        completedAtUtc: z.string().regex(ISO_UTC_PATTERN),
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

const resolutionInputBindingsSchema = z
  .object({
    verifierImplementationSha256: sha256Schema,
    frozenPolicySha256: sha256Schema,
    validatorPolicySha256: sha256Schema,
    partitionPlanSha256: sha256Schema,
    reviewBundleSha256: sha256Schema,
    reviewerAEvidenceSha256: sha256Schema,
    reviewerBEvidenceSha256: sha256Schema,
    decisionRootSha256: sha256Schema,
    proposalRootSha256: sha256Schema,
    candidateTreeSha256: sha256Schema,
    escalationDecisionRootSha256: sha256Schema,
  })
  .strict();

const thirdValueProposalRowSchema = z
  .object({
    originalReviewerId: originalReviewerIdSchema,
    decisionIdentitySha256: sha256Schema,
    proposalIdentitySha256: sha256Schema,
    sourceSha256: sha256Schema,
    currentValueSha256: sha256Schema,
    proposedValueSha256: sha256Schema,
    fieldCount: z.number().int().positive(),
    members: z.array(memberSchema).min(1),
    thirdValue: z.string().min(1),
    thirdValueSha256: sha256Schema,
    rationale: z.string().min(1),
  })
  .strict();

const thirdValueProposalsSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(THIRD_VALUE_PROPOSALS_KIND),
    ...safetyShape,
    inputBindings: resolutionInputBindingsSchema,
    author: z
      .object({
        authorName: z.string().min(1),
        identityAssurance: z.literal("trusted-local-assertion"),
        authoredAtUtc: z.string().regex(ISO_UTC_PATTERN),
      })
      .strict(),
    summary: z
      .object({
        decisions: z.number().int().positive(),
        fields: z.number().int().positive(),
        escalationDecisionRootSha256: sha256Schema,
        thirdValueRootSha256: sha256Schema,
      })
      .strict(),
    proposals: z.array(thirdValueProposalRowSchema).min(1),
  })
  .strict();

const thirdValueReviewDecisionSchema = z
  .object({
    originalReviewerId: originalReviewerIdSchema,
    decisionIdentitySha256: sha256Schema,
    proposalIdentitySha256: sha256Schema,
    sourceSha256: sha256Schema,
    fieldCount: z.number().int().positive(),
    members: z.array(memberSchema).min(1),
    thirdValueSha256: sha256Schema,
    verdict: z.enum([
      "approve-third-value",
      "reject-third-value",
      "escalate-again",
    ]),
    rationale: z.string().min(1),
  })
  .strict();

const thirdValueReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(THIRD_VALUE_REVIEW_KIND),
    ...safetyShape,
    inputBindings: resolutionInputBindingsSchema
      .extend({
        thirdValueProposalsSha256: sha256Schema,
        thirdValueRootSha256: sha256Schema,
      })
      .strict(),
    reviewer: z
      .object({
        reviewerName: z.string().min(1),
        identityAssurance: z.literal("trusted-local-assertion"),
        completedAtUtc: z.string().regex(ISO_UTC_PATTERN),
      })
      .strict(),
    summary: z
      .object({
        decisions: z.number().int().positive(),
        fields: z.number().int().positive(),
        approvedThirdValues: z.number().int().nonnegative(),
        rejectedThirdValues: z.number().int().nonnegative(),
        escalatedAgain: z.number().int().nonnegative(),
      })
      .strict(),
    decisions: z.array(thirdValueReviewDecisionSchema).min(1),
  })
  .strict();

type Member = z.infer<typeof memberSchema>;
type SemanticDecision = z.infer<typeof semanticDecisionSchema>;
type Proposal = z.infer<typeof proposalSchema>;
type ReviewerPartition = z.infer<typeof reviewerPartitionSchema>;
type PartitionPlan = z.infer<typeof partitionPlanSchema>;
type ReviewBundle = z.infer<typeof reviewBundleSchema>;
type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>;
type ThirdValueProposals = z.infer<typeof thirdValueProposalsSchema>;
type ThirdValueReview = z.infer<typeof thirdValueReviewSchema>;

export type AfrikaansEscalationResolutionFrozenPolicy = Readonly<{
  policyId: "afrikaans-escalation-resolution-frozen-v1";
  partitionPlanSha256: string;
  reviewBundleSha256: string;
  reviewerAEvidenceSha256: string;
  reviewerBEvidenceSha256: string;
}>;

export const AFRIKAANS_ESCALATION_RESOLUTION_FROZEN_V1_POLICY = Object.freeze({
  policyId: "afrikaans-escalation-resolution-frozen-v1",
  partitionPlanSha256:
    "26d79b70458b7a01c1e24aab0183a8b8a5608d18878c0fda6e83c7b6cd33b74f",
  reviewBundleSha256:
    "cb230d18703aaff2298fca9e780e12531670ec204ea655f969c45e814b97bf34",
  reviewerAEvidenceSha256:
    "8f874ba98878aa286ba14ca0fdc717c71dad6194e4d7f89aee81848e7e6f8ecd",
  reviewerBEvidenceSha256:
    "db869863af2f90372ba8789268cd4409f8e3be433ce13eee655bbb87b3f80304",
} satisfies AfrikaansEscalationResolutionFrozenPolicy);

export type AfrikaansEscalationResolutionPaths = Readonly<{
  partitionPlanPath: string;
  reviewBundlePath: string;
  reviewerAEvidencePath: string;
  reviewerBEvidencePath: string;
  thirdValueProposalsPath: string;
  thirdValueReviewPath: string;
}>;

export type VerifyAfrikaansEscalationResolutionArgs = Readonly<{
  paths: AfrikaansEscalationResolutionPaths;
  policy?: AfrikaansEscalationResolutionFrozenPolicy;
  nowEpochMs?: number;
  trustedInputRoot?: string;
}>;

type LoadedJson<T> = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  value: T;
}>;

type Escalation = Readonly<{
  originalReviewerId: "reviewer-a" | "reviewer-b";
  proposal: Proposal;
}>;

export type AfrikaansEscalationResolvedDecision = Readonly<{
  originalReviewerId: "reviewer-a" | "reviewer-b";
  decisionIdentitySha256: string;
  proposalIdentitySha256: string;
  source: string;
  sourceSha256: string;
  finalValue: string;
  finalValueSha256: string;
  fieldCount: number;
  members: readonly Member[];
}>;

export type AfrikaansEscalationResolutionVerification = Readonly<{
  schemaVersion: 1;
  kind: typeof VERIFICATION_KIND;
  diagnosticOnly: true;
  trustModel: "trusted-single-user-local-workspace";
  authentication: "none";
  identityClaimsVerified: false;
  trackedWritesPerformed: false;
  trackedWritesPermitted: false;
  writePermitted: false;
  materializePermitted: false;
  applyPermitted: false;
  promotePermitted: false;
  importPermitted: false;
  releaseAttestation: false;
  applyReady: false;
  outputChannel: "stdout-only";
  inputBindings: Readonly<{
    verifierImplementationSha256: string;
    frozenPolicySha256: string;
    validatorPolicySha256: string;
    partitionPlanSha256: string;
    reviewBundleSha256: string;
    reviewerAEvidenceSha256: string;
    reviewerBEvidenceSha256: string;
    thirdValueProposalsSha256: string;
    thirdValueReviewSha256: string;
    escalationDecisionRootSha256: string;
    thirdValueRootSha256: string;
  }>;
  summary: Readonly<{
    decisions: number;
    fields: number;
    approvedThirdValues: number;
  }>;
  resolvedDecisionRootSha256: string;
  resolvedDecisions: readonly AfrikaansEscalationResolvedDecision[];
}>;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(scriptDirectory, "..");

export function defaultAfrikaansEscalationResolutionPaths(
  repoRoot = defaultRepoRoot,
): AfrikaansEscalationResolutionPaths {
  const laneRoot = resolve(repoRoot, "tmp/af-adjudication-parallel-plan-v1");
  return Object.freeze({
    partitionPlanPath: resolve(laneRoot, "partition-plan.json"),
    reviewBundlePath: resolve(laneRoot, "review-bundle.json"),
    reviewerAEvidencePath: resolve(laneRoot, "reviewer-a-evidence.json"),
    reviewerBEvidencePath: resolve(laneRoot, "reviewer-b-evidence.json"),
    thirdValueProposalsPath: resolve(
      laneRoot,
      "escalation-third-value-proposals.json",
    ),
    thirdValueReviewPath: resolve(
      laneRoot,
      "escalation-third-value-review.json",
    ),
  });
}

export function verifyAfrikaansEscalationResolution(
  args: VerifyAfrikaansEscalationResolutionArgs,
): AfrikaansEscalationResolutionVerification {
  const policy =
    args.policy ?? AFRIKAANS_ESCALATION_RESOLUTION_FROZEN_V1_POLICY;
  validateFrozenPolicy(policy);
  const nowEpochMs = args.nowEpochMs ?? Date.now();
  if (!Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0) {
    throw new Error("Escalation resolution verification clock is invalid.");
  }
  const trustedInputRoot = canonicalTrustedRoot(
    args.trustedInputRoot ?? defaultRepoRoot,
  );
  const implementation = readStableRegularFile(
    fileURLToPath(import.meta.url),
    canonicalTrustedRoot(defaultRepoRoot),
    "escalation-resolution verifier implementation",
  );
  const verifierImplementationSha256 = createHash("sha256")
    .update(implementation.bytes)
    .digest("hex");
  const frozenPolicySha256 =
    sha256CanonicalAfrikaansEscalationResolution(policy);
  const validatorPolicySha256 = createLongTailValidatorPolicyProvenance(
    defaultRepoRoot,
  ).validatorPolicySha256;

  const partitionPlan = loadJson(
    args.paths.partitionPlanPath,
    partitionPlanSchema,
    "partition plan",
    trustedInputRoot,
  );
  const reviewBundle = loadJson(
    args.paths.reviewBundlePath,
    reviewBundleSchema,
    "review bundle",
    trustedInputRoot,
  );
  const reviewerA = loadJson(
    args.paths.reviewerAEvidencePath,
    reviewEvidenceSchema,
    "reviewer-a evidence",
    trustedInputRoot,
  );
  const reviewerB = loadJson(
    args.paths.reviewerBEvidencePath,
    reviewEvidenceSchema,
    "reviewer-b evidence",
    trustedInputRoot,
  );

  assertHash(
    partitionPlan.sha256,
    policy.partitionPlanSha256,
    "Frozen partition plan",
  );
  assertHash(
    reviewBundle.sha256,
    policy.reviewBundleSha256,
    "Frozen review bundle",
  );
  assertHash(
    reviewerA.sha256,
    policy.reviewerAEvidenceSha256,
    "Immutable reviewer-a evidence",
  );
  assertHash(
    reviewerB.sha256,
    policy.reviewerBEvidenceSha256,
    "Immutable reviewer-b evidence",
  );

  const core = validateFrozenCore({
    partitionPlan,
    reviewBundle,
    reviewerA,
    reviewerB,
    nowEpochMs,
    verifierImplementationSha256,
    frozenPolicySha256,
    validatorPolicySha256,
  });
  if (!core.escalations.length) {
    throw new Error("Escalation resolution requires at least one original escalation.");
  }

  const thirdValueProposals = loadJson(
    args.paths.thirdValueProposalsPath,
    thirdValueProposalsSchema,
    "third-value proposals",
    trustedInputRoot,
  );
  const validatedProposals = validateThirdValueProposals({
    loaded: thirdValueProposals,
    core,
    originalEvidence: [reviewerA.value, reviewerB.value],
    nowEpochMs,
  });
  const thirdValueReview = loadJson(
    args.paths.thirdValueReviewPath,
    thirdValueReviewSchema,
    "third-value review",
    trustedInputRoot,
  );
  validateThirdValueReview({
    loaded: thirdValueReview,
    proposalFile: thirdValueProposals,
    proposals: validatedProposals,
    core,
    originalEvidence: [reviewerA.value, reviewerB.value],
    nowEpochMs,
  });

  const resolvedDecisions = core.escalations.map((escalation, index) => {
    const proposal = validatedProposals.artifact.proposals[index];
    return Object.freeze({
      originalReviewerId: escalation.originalReviewerId,
      decisionIdentitySha256: escalation.proposal.decisionIdentitySha256,
      proposalIdentitySha256: escalation.proposal.proposalIdentitySha256,
      source: escalation.proposal.source,
      sourceSha256: escalation.proposal.sourceSha256,
      finalValue: proposal.thirdValue,
      finalValueSha256: proposal.thirdValueSha256,
      fieldCount: escalation.proposal.fieldCount,
      members: Object.freeze(escalation.proposal.members.map((member) => Object.freeze({ ...member }))),
    });
  });
  const fields = resolvedDecisions.reduce(
    (sum, decision) => sum + decision.fieldCount,
    0,
  );

  return Object.freeze({
    schemaVersion: 1,
    kind: VERIFICATION_KIND,
    diagnosticOnly: true,
    trustModel: "trusted-single-user-local-workspace",
    authentication: "none",
    identityClaimsVerified: false,
    trackedWritesPerformed: false,
    trackedWritesPermitted: false,
    writePermitted: false,
    materializePermitted: false,
    applyPermitted: false,
    promotePermitted: false,
    importPermitted: false,
    releaseAttestation: false,
    applyReady: false,
    outputChannel: "stdout-only",
    inputBindings: Object.freeze({
      verifierImplementationSha256,
      frozenPolicySha256,
      validatorPolicySha256,
      partitionPlanSha256: partitionPlan.sha256,
      reviewBundleSha256: reviewBundle.sha256,
      reviewerAEvidenceSha256: reviewerA.sha256,
      reviewerBEvidenceSha256: reviewerB.sha256,
      thirdValueProposalsSha256: thirdValueProposals.sha256,
      thirdValueReviewSha256: thirdValueReview.sha256,
      escalationDecisionRootSha256: core.escalationDecisionRootSha256,
      thirdValueRootSha256: validatedProposals.thirdValueRootSha256,
    }),
    summary: Object.freeze({
      decisions: resolvedDecisions.length,
      fields,
      approvedThirdValues: resolvedDecisions.length,
    }),
    resolvedDecisionRootSha256:
      sha256CanonicalAfrikaansEscalationResolution(resolvedDecisions),
    resolvedDecisions: Object.freeze(resolvedDecisions),
  });
}

function validateFrozenCore(input: {
  partitionPlan: LoadedJson<PartitionPlan>;
  reviewBundle: LoadedJson<ReviewBundle>;
  reviewerA: LoadedJson<ReviewEvidence>;
  reviewerB: LoadedJson<ReviewEvidence>;
  nowEpochMs: number;
  verifierImplementationSha256: string;
  frozenPolicySha256: string;
  validatorPolicySha256: string;
}) {
  const decisions = input.partitionPlan.value.decisions;
  if (!isSortedUnique(decisions.map((decision) => decision.decisionIdentitySha256))) {
    throw new Error("Partition semantic decisions are not sorted and unique.");
  }
  const memberIdentities = new Set<string>();
  for (const decision of decisions) {
    validateSemanticDecision(decision);
    for (const member of decision.members) {
      if (memberIdentities.has(member.fieldIdentitySha256)) {
        throw new Error("Partition contains a duplicate semantic member identity.");
      }
      memberIdentities.add(member.fieldIdentitySha256);
    }
  }
  const decisionRootSha256 =
    sha256CanonicalAfrikaansEscalationResolution(decisions);
  const fieldIdentityRootSha256 =
    sha256CanonicalAfrikaansEscalationResolution(
      [...memberIdentities].sort(compareCodePoints),
    );
  const corpus = input.partitionPlan.value.corpus;
  const fieldCount = decisions.reduce(
    (sum, decision) => sum + decision.fieldCount,
    0,
  );
  if (
    corpus.decisions !== decisions.length ||
    corpus.fields !== fieldCount ||
    corpus.duplicateSourceGroups !==
      decisions.filter((decision) => decision.fieldCount > 1).length ||
    corpus.decisionRootSha256 !== decisionRootSha256 ||
    corpus.fieldIdentityRootSha256 !== fieldIdentityRootSha256
  ) {
    throw new Error("Partition corpus counts or identity roots drifted.");
  }

  const partitions = input.partitionPlan.value.reviewers;
  if (
    partitions[0].reviewerId !== "reviewer-a" ||
    partitions[1].reviewerId !== "reviewer-b"
  ) {
    throw new Error("Partition reviewer order must be reviewer-a then reviewer-b.");
  }
  const decisionById = new Map(
    decisions.map((decision) => [decision.decisionIdentitySha256, decision]),
  );
  const coveredIds = partitions.flatMap((partition) => partition.decisionIds);
  if (
    coveredIds.length !== decisions.length ||
    new Set(coveredIds).size !== decisions.length ||
    [...coveredIds]
      .sort(compareCodePoints)
      .some(
        (decisionId, index) =>
          decisionId !== decisions[index].decisionIdentitySha256,
      )
  ) {
    throw new Error("Reviewer partitions omit, overlap, or add semantic decisions.");
  }
  for (const partition of partitions) {
    validateReviewerPartition(
      partition,
      decisionById,
      input.partitionPlan.value.inputBindings.preparedPlanSha256,
      decisionRootSha256,
    );
  }

  const bundle = input.reviewBundle.value;
  if (
    bundle.inputBindings.partitionPlanSha256 !== input.partitionPlan.sha256 ||
    bundle.inputBindings.preparedPlanSha256 !==
      input.partitionPlan.value.inputBindings.preparedPlanSha256 ||
    bundle.inputBindings.decisionRootSha256 !== decisionRootSha256
  ) {
    throw new Error("Review bundle is stale against the frozen partition plan.");
  }
  if (
    bundle.reviewers[0].reviewerId !== "reviewer-a" ||
    bundle.reviewers[1].reviewerId !== "reviewer-b"
  ) {
    throw new Error("Review bundle reviewer order must be reviewer-a then reviewer-b.");
  }
  const allProposals: Proposal[] = [];
  for (const [index, bundlePartition] of bundle.reviewers.entries()) {
    const partition = partitions[index];
    if (
      bundlePartition.reviewerId !== partition.reviewerId ||
      bundlePartition.partitionRootSha256 !== partition.partitionRootSha256 ||
      bundlePartition.decisionCount !== partition.decisionCount ||
      bundlePartition.fieldCount !== partition.fieldCount ||
      bundlePartition.proposals.length !== partition.decisionIds.length
    ) {
      throw new Error(`${partition.reviewerId} review-bundle partition drifted.`);
    }
    for (const [proposalIndex, proposal] of bundlePartition.proposals.entries()) {
      if (proposal.decisionIdentitySha256 !== partition.decisionIds[proposalIndex]) {
        throw new Error(`${partition.reviewerId} proposals are not in exact partition order.`);
      }
      validateProposal(proposal);
      const decision = decisionById.get(proposal.decisionIdentitySha256);
      if (!decision || canonicalJson(semanticProjection(proposal)) !== canonicalJson(decision)) {
        throw new Error("Review-bundle proposal does not bind its semantic decision.");
      }
      allProposals.push(proposal);
    }
  }
  allProposals.sort((left, right) =>
    compareCodePoints(
      left.decisionIdentitySha256,
      right.decisionIdentitySha256,
    ),
  );
  if (!isSortedUnique(allProposals.map((proposal) => proposal.decisionIdentitySha256))) {
    throw new Error("Review bundle contains duplicate proposal decisions.");
  }
  const proposalRootSha256 =
    sha256CanonicalAfrikaansEscalationResolution(allProposals);
  if (
    bundle.proposalCount !== allProposals.length ||
    bundle.proposalFieldCount !==
      allProposals.reduce((sum, proposal) => sum + proposal.fieldCount, 0) ||
    bundle.inputBindings.proposalRootSha256 !== proposalRootSha256
  ) {
    throw new Error("Review-bundle proposal counts or root drifted.");
  }

  const proposalById = new Map(
    allProposals.map((proposal) => [proposal.decisionIdentitySha256, proposal]),
  );
  const evidenceInputs = [input.reviewerA, input.reviewerB] as const;
  const escalations: Escalation[] = [];
  for (const [index, evidence] of evidenceInputs.entries()) {
    const partition = partitions[index];
    const bundlePartition = bundle.reviewers[index];
    escalations.push(
      ...validateOriginalEvidence({
        loaded: evidence,
        partition,
        bundlePartition,
        proposalById,
        partitionPlanSha256: input.partitionPlan.sha256,
        reviewBundleSha256: input.reviewBundle.sha256,
        preparedPlanSha256:
          input.partitionPlan.value.inputBindings.preparedPlanSha256,
        decisionRootSha256,
        proposalRootSha256,
        candidateTreeSha256: bundle.inputBindings.candidateTreeSha256,
        nowEpochMs: input.nowEpochMs,
      }),
    );
  }
  const originalNames = evidenceInputs.map((evidence) =>
    normalizedActorName(
      evidence.value.reviewer.reviewerName,
      `${evidence.value.reviewer.reviewerId} reviewer name`,
    ),
  );
  if (originalNames[0] === originalNames[1]) {
    throw new Error("Original reviewer-a and reviewer-b must be distinct people.");
  }
  escalations.sort((left, right) =>
    compareCodePoints(
      left.proposal.decisionIdentitySha256,
      right.proposal.decisionIdentitySha256,
    ),
  );
  if (!isSortedUnique(escalations.map((item) => item.proposal.decisionIdentitySha256))) {
    throw new Error("Original escalation set contains duplicate decisions.");
  }
  const escalationDecisionRootSha256 =
    sha256CanonicalAfrikaansEscalationResolution(
      escalations.map((item) => item.proposal.decisionIdentitySha256),
    );
  return {
    decisionRootSha256,
    proposalRootSha256,
    candidateTreeSha256: bundle.inputBindings.candidateTreeSha256,
    escalationDecisionRootSha256,
    escalations,
    descriptors: {
      verifierImplementationSha256: input.verifierImplementationSha256,
      frozenPolicySha256: input.frozenPolicySha256,
      validatorPolicySha256: input.validatorPolicySha256,
      partitionPlanSha256: input.partitionPlan.sha256,
      reviewBundleSha256: input.reviewBundle.sha256,
      reviewerAEvidenceSha256: input.reviewerA.sha256,
      reviewerBEvidenceSha256: input.reviewerB.sha256,
    },
  };
}

function validateReviewerPartition(
  partition: ReviewerPartition,
  decisionById: ReadonlyMap<string, SemanticDecision>,
  preparedPlanSha256: string,
  decisionRootSha256: string,
) {
  if (!isSortedUnique(partition.decisionIds)) {
    throw new Error(`${partition.reviewerId} partition IDs are not sorted and unique.`);
  }
  const fields = partition.decisionIds.reduce((sum, decisionId) => {
    const decision = decisionById.get(decisionId);
    if (!decision) throw new Error(`Unknown partition decision ${decisionId}.`);
    return sum + decision.fieldCount;
  }, 0);
  const expectedRoot = sha256CanonicalAfrikaansEscalationResolution({
    schemaVersion: 1,
    kind: "afrikaans-semantic-reviewer-partition-v1",
    reviewerId: partition.reviewerId,
    preparedPlanSha256,
    decisionRootSha256,
    decisionCount: partition.decisionIds.length,
    fieldCount: fields,
    decisionIds: partition.decisionIds,
  });
  if (
    partition.decisionCount !== partition.decisionIds.length ||
    partition.fieldCount !== fields ||
    partition.partitionRootSha256 !== expectedRoot
  ) {
    throw new Error(`${partition.reviewerId} partition accounting or root drifted.`);
  }
}

function validateOriginalEvidence(input: {
  loaded: LoadedJson<ReviewEvidence>;
  partition: ReviewerPartition;
  bundlePartition: ReviewBundle["reviewers"][number];
  proposalById: ReadonlyMap<string, Proposal>;
  partitionPlanSha256: string;
  reviewBundleSha256: string;
  preparedPlanSha256: string;
  decisionRootSha256: string;
  proposalRootSha256: string;
  candidateTreeSha256: string;
  nowEpochMs: number;
}): Escalation[] {
  const evidence = input.loaded.value;
  if (evidence.reviewer.reviewerId !== input.partition.reviewerId) {
    throw new Error(`${input.partition.reviewerId} evidence reviewer identity drifted.`);
  }
  normalizedActorName(
    evidence.reviewer.reviewerName,
    `${input.partition.reviewerId} reviewer name`,
  );
  const completedAt = timestampMs(
    evidence.reviewer.completedAtUtc,
    `${input.partition.reviewerId} completion timestamp`,
  );
  if (completedAt > input.nowEpochMs) {
    throw new Error(`${input.partition.reviewerId} evidence timestamp is in the future.`);
  }
  const expectedBindings = {
    partitionPlanSha256: input.partitionPlanSha256,
    reviewBundleSha256: input.reviewBundleSha256,
    preparedPlanSha256: input.preparedPlanSha256,
    decisionRootSha256: input.decisionRootSha256,
    partitionRootSha256: input.partition.partitionRootSha256,
    proposalRootSha256: input.proposalRootSha256,
    candidateTreeSha256: input.candidateTreeSha256,
  };
  if (canonicalJson(evidence.inputBindings) !== canonicalJson(expectedBindings)) {
    throw new Error(`${input.partition.reviewerId} evidence bindings are stale.`);
  }
  const ids = evidence.decisions.map((decision) => decision.decisionIdentitySha256);
  if (
    ids.length !== input.partition.decisionIds.length ||
    ids.some((decisionId, index) => decisionId !== input.partition.decisionIds[index])
  ) {
    throw new Error(`${input.partition.reviewerId} evidence coverage or order drifted.`);
  }
  let accepted = 0;
  let preserved = 0;
  let escalationCount = 0;
  const escalations: Escalation[] = [];
  for (const decision of evidence.decisions) {
    const proposal = input.proposalById.get(decision.decisionIdentitySha256);
    if (
      !proposal ||
      decision.proposalIdentitySha256 !== proposal.proposalIdentitySha256
    ) {
      throw new Error(`${input.partition.reviewerId} evidence proposal binding drifted.`);
    }
    requireNfcNonBlank(
      decision.rationale,
      `${input.partition.reviewerId} evidence rationale`,
    );
    if (decision.verdict === "accept-proposal") {
      accepted += 1;
      if (
        decision.finalValue !== proposal.proposedValue ||
        decision.finalValueSha256 !== proposal.proposedValueSha256
      ) {
        throw new Error(`${input.partition.reviewerId} accepted a non-proposal value.`);
      }
    } else if (decision.verdict === "preserve-current") {
      preserved += 1;
      if (
        decision.finalValue !== proposal.currentValue ||
        decision.finalValueSha256 !== proposal.currentValueSha256
      ) {
        throw new Error(`${input.partition.reviewerId} preserved a non-current value.`);
      }
    } else {
      escalationCount += 1;
      if (decision.finalValue !== null || decision.finalValueSha256 !== null) {
        throw new Error(`${input.partition.reviewerId} escalation chose a final value.`);
      }
      escalations.push({
        originalReviewerId: input.partition.reviewerId,
        proposal,
      });
    }
    if (
      decision.finalValue !== null &&
      sha256TextAfrikaansEscalationResolution(decision.finalValue) !==
        decision.finalValueSha256
    ) {
      throw new Error(`${input.partition.reviewerId} final-value hash drifted.`);
    }
  }
  const expectedSummary = {
    decisions: input.partition.decisionCount,
    fields: input.partition.fieldCount,
    acceptedProposals: accepted,
    preservedCurrentValues: preserved,
    escalations: escalationCount,
  };
  if (canonicalJson(evidence.summary) !== canonicalJson(expectedSummary)) {
    throw new Error(`${input.partition.reviewerId} evidence summary drifted.`);
  }
  return escalations;
}

function validateThirdValueProposals(input: {
  loaded: LoadedJson<ThirdValueProposals>;
  core: ReturnType<typeof validateFrozenCore>;
  originalEvidence: readonly [ReviewEvidence, ReviewEvidence];
  nowEpochMs: number;
}) {
  const artifact = input.loaded.value;
  const expectedBindings = {
    ...input.core.descriptors,
    decisionRootSha256: input.core.decisionRootSha256,
    proposalRootSha256: input.core.proposalRootSha256,
    candidateTreeSha256: input.core.candidateTreeSha256,
    escalationDecisionRootSha256: input.core.escalationDecisionRootSha256,
  };
  if (canonicalJson(artifact.inputBindings) !== canonicalJson(expectedBindings)) {
    throw new Error("Third-value proposal bindings are stale or coordinated-rehashed.");
  }
  const originalNames = input.originalEvidence.map((evidence) =>
    normalizedActorName(evidence.reviewer.reviewerName, "original reviewer name"),
  );
  const authorName = normalizedActorName(
    artifact.author.authorName,
    "third-value proposal author",
  );
  if (originalNames.includes(authorName)) {
    throw new Error("Third-value proposal author must differ from both original reviewers.");
  }
  const authoredAt = timestampMs(
    artifact.author.authoredAtUtc,
    "third-value proposal timestamp",
  );
  const latestOriginalReview = Math.max(
    ...input.originalEvidence.map((evidence) =>
      timestampMs(evidence.reviewer.completedAtUtc, "original review timestamp"),
    ),
  );
  if (authoredAt <= latestOriginalReview) {
    throw new Error("Third-value proposals are noncausal relative to original evidence.");
  }
  if (authoredAt > input.nowEpochMs) {
    throw new Error("Third-value proposal timestamp is in the future.");
  }
  const expectedIds = input.core.escalations.map(
    (escalation) => escalation.proposal.decisionIdentitySha256,
  );
  const observedIds = artifact.proposals.map(
    (proposal) => proposal.decisionIdentitySha256,
  );
  if (
    observedIds.length !== expectedIds.length ||
    observedIds.some((decisionId, index) => decisionId !== expectedIds[index])
  ) {
    throw new Error(
      "Third-value proposals omit, duplicate, add, or reorder escalations, or change escalation identities.",
    );
  }
  for (const [index, row] of artifact.proposals.entries()) {
    const escalation = input.core.escalations[index];
    const proposal = escalation.proposal;
    const expectedIdentity = {
      originalReviewerId: escalation.originalReviewerId,
      decisionIdentitySha256: proposal.decisionIdentitySha256,
      proposalIdentitySha256: proposal.proposalIdentitySha256,
      sourceSha256: proposal.sourceSha256,
      currentValueSha256: proposal.currentValueSha256,
      proposedValueSha256: proposal.proposedValueSha256,
      fieldCount: proposal.fieldCount,
      members: proposal.members,
    };
    const observedIdentity = {
      originalReviewerId: row.originalReviewerId,
      decisionIdentitySha256: row.decisionIdentitySha256,
      proposalIdentitySha256: row.proposalIdentitySha256,
      sourceSha256: row.sourceSha256,
      currentValueSha256: row.currentValueSha256,
      proposedValueSha256: row.proposedValueSha256,
      fieldCount: row.fieldCount,
      members: row.members,
    };
    if (canonicalJson(observedIdentity) !== canonicalJson(expectedIdentity)) {
      throw new Error(`Third-value proposal ${index} identity or members drifted.`);
    }
    requireNfcNonBlank(row.rationale, `Third-value proposal ${index} rationale`);
    validateThirdValue(row.thirdValue, row.thirdValueSha256, proposal, index);
  }
  const thirdValueRootSha256 = thirdValueRoot(artifact);
  const fields = artifact.proposals.reduce(
    (sum, proposal) => sum + proposal.fieldCount,
    0,
  );
  const expectedSummary = {
    decisions: input.core.escalations.length,
    fields,
    escalationDecisionRootSha256: input.core.escalationDecisionRootSha256,
    thirdValueRootSha256,
  };
  if (canonicalJson(artifact.summary) !== canonicalJson(expectedSummary)) {
    throw new Error("Third-value proposal summary or roots drifted.");
  }
  return { artifact, thirdValueRootSha256, authorName, authoredAt };
}

function validateThirdValueReview(input: {
  loaded: LoadedJson<ThirdValueReview>;
  proposalFile: LoadedJson<ThirdValueProposals>;
  proposals: ReturnType<typeof validateThirdValueProposals>;
  core: ReturnType<typeof validateFrozenCore>;
  originalEvidence: readonly [ReviewEvidence, ReviewEvidence];
  nowEpochMs: number;
}) {
  const review = input.loaded.value;
  const expectedBindings = {
    ...input.core.descriptors,
    decisionRootSha256: input.core.decisionRootSha256,
    proposalRootSha256: input.core.proposalRootSha256,
    candidateTreeSha256: input.core.candidateTreeSha256,
    escalationDecisionRootSha256: input.core.escalationDecisionRootSha256,
    thirdValueProposalsSha256: input.proposalFile.sha256,
    thirdValueRootSha256: input.proposals.thirdValueRootSha256,
  };
  if (canonicalJson(review.inputBindings) !== canonicalJson(expectedBindings)) {
    throw new Error("Third-value review bindings are stale or coordinated-rehashed.");
  }
  const reviewerName = normalizedActorName(
    review.reviewer.reviewerName,
    "third-value resolution reviewer",
  );
  const forbiddenNames = [
    input.proposals.authorName,
    ...input.originalEvidence.map((evidence) =>
      normalizedActorName(evidence.reviewer.reviewerName, "original reviewer name"),
    ),
  ];
  if (forbiddenNames.includes(reviewerName)) {
    throw new Error(
      "Third-value resolution reviewer must differ from the proposal author and both original reviewers.",
    );
  }
  const reviewedAt = timestampMs(
    review.reviewer.completedAtUtc,
    "third-value review timestamp",
  );
  if (reviewedAt <= input.proposals.authoredAt) {
    throw new Error("Third-value review is noncausal relative to its proposal artifact.");
  }
  if (reviewedAt > input.nowEpochMs) {
    throw new Error("Third-value review timestamp is in the future.");
  }
  const expectedIds = input.proposals.artifact.proposals.map(
    (proposal) => proposal.decisionIdentitySha256,
  );
  const observedIds = review.decisions.map(
    (decision) => decision.decisionIdentitySha256,
  );
  if (
    observedIds.length !== expectedIds.length ||
    observedIds.some((decisionId, index) => decisionId !== expectedIds[index])
  ) {
    throw new Error("Third-value review omits, duplicates, adds, or reorders decisions.");
  }
  let approved = 0;
  let rejected = 0;
  let escalatedAgain = 0;
  for (const [index, row] of review.decisions.entries()) {
    const proposal = input.proposals.artifact.proposals[index];
    const expectedIdentity = {
      originalReviewerId: proposal.originalReviewerId,
      decisionIdentitySha256: proposal.decisionIdentitySha256,
      proposalIdentitySha256: proposal.proposalIdentitySha256,
      sourceSha256: proposal.sourceSha256,
      fieldCount: proposal.fieldCount,
      members: proposal.members,
      thirdValueSha256: proposal.thirdValueSha256,
    };
    const observedIdentity = {
      originalReviewerId: row.originalReviewerId,
      decisionIdentitySha256: row.decisionIdentitySha256,
      proposalIdentitySha256: row.proposalIdentitySha256,
      sourceSha256: row.sourceSha256,
      fieldCount: row.fieldCount,
      members: row.members,
      thirdValueSha256: row.thirdValueSha256,
    };
    if (canonicalJson(observedIdentity) !== canonicalJson(expectedIdentity)) {
      throw new Error(`Third-value review decision ${index} identity drifted.`);
    }
    requireNfcNonBlank(row.rationale, `Third-value review decision ${index} rationale`);
    if (row.verdict === "approve-third-value") approved += 1;
    else if (row.verdict === "reject-third-value") rejected += 1;
    else escalatedAgain += 1;
  }
  const fields = review.decisions.reduce(
    (sum, decision) => sum + decision.fieldCount,
    0,
  );
  const expectedSummary = {
    decisions: review.decisions.length,
    fields,
    approvedThirdValues: approved,
    rejectedThirdValues: rejected,
    escalatedAgain,
  };
  if (canonicalJson(review.summary) !== canonicalJson(expectedSummary)) {
    throw new Error("Third-value review summary drifted.");
  }
  if (rejected || escalatedAgain || approved !== review.decisions.length) {
    throw new Error(
      `Escalation resolution fails closed: ${rejected} rejected and ${escalatedAgain} escalated again.`,
    );
  }
}

function validateThirdValue(
  value: string,
  valueSha256: string,
  proposal: Proposal,
  index: number,
) {
  requireNfcNonBlank(value, `Third value ${index}`);
  if (sha256TextAfrikaansEscalationResolution(value) !== valueSha256) {
    throw new Error(`Third value ${index} hash drifted.`);
  }
  if (
    value === proposal.currentValue ||
    value === proposal.proposedValue ||
    valueSha256 === proposal.currentValueSha256 ||
    valueSha256 === proposal.proposedValueSha256
  ) {
    throw new Error(`Third value ${index} is not distinct from both rejected values.`);
  }
  if (!sameStringMultiset(placeholdersIn(proposal.source), placeholdersIn(value))) {
    throw new Error(`Third value ${index} changed source placeholders.`);
  }
  if (canonicalJson(markupTokensIn(proposal.source)) !== canonicalJson(markupTokensIn(value))) {
    throw new Error(`Third value ${index} changed source markup.`);
  }
  if (
    !sameStringMultiset(
      protectedLiteralsIn(proposal.source),
      protectedLiteralsIn(value),
    )
  ) {
    throw new Error(`Third value ${index} changed protected literals.`);
  }
  if (terminalPunctuation(proposal.source) !== terminalPunctuation(value)) {
    throw new Error(`Third value ${index} changed terminal punctuation.`);
  }
  const candidateQuality = validateTranslationCandidateField({
    language: "Afrikaans",
    source: proposal.source,
    value,
  });
  if (candidateQuality.failures.length) {
    throw new Error(
      `Third value ${index} failed translation candidate validation: ${candidateQuality.failures.join(", ")}.`,
    );
  }
  const invalidMembers: string[] = [];
  for (const member of proposal.members) {
    const fieldValid = isValidFieldTranslation(
      proposal.source,
      value,
      "Afrikaans",
      member.key,
    );
    const fluency = inspectTranslationFieldFluency(
      proposal.source,
      value,
      "Afrikaans",
      {
        namespace: member.namespace,
        sourceHash: member.sourceHash,
        key: member.key,
      },
    );
    if (!fieldValid || !fluency.fluent) {
      invalidMembers.push(
        `${member.namespace}/${member.key}:${
          !fieldValid ? "field-invalid" : fluency.reason ?? "not-fluent"
        }`,
      );
    }
  }
  if (invalidMembers.length) {
    throw new Error(
      `Third value ${index} failed current field/context validation: ${invalidMembers.join(", ")}.`,
    );
  }
}

function validateSemanticDecision(decision: SemanticDecision) {
  requireNfcNonBlank(decision.source, "Semantic decision source");
  requireNfcNonBlank(decision.currentValue, "Semantic decision current value");
  if (
    sha256TextAfrikaansEscalationResolution(decision.source) !==
      decision.sourceSha256 ||
    sha256TextAfrikaansEscalationResolution(decision.currentValue) !==
      decision.currentValueSha256
  ) {
    throw new Error("Semantic decision source or current-value hash drifted.");
  }
  if (
    decision.fieldCount !== decision.members.length ||
    new Set(decision.members.map((member) => member.fieldIdentitySha256)).size !==
      decision.members.length ||
    [...decision.members]
      .sort(compareMembers)
      .some(
        (member, index) =>
          canonicalJson(member) !== canonicalJson(decision.members[index]),
      )
  ) {
    throw new Error("Semantic decision member accounting or order drifted.");
  }
  const expectedIdentity = sha256CanonicalAfrikaansEscalationResolution({
    schemaVersion: 1,
    kind: "afrikaans-semantic-decision-identity-v1",
    language: decision.language,
    locale: decision.locale,
    source: decision.source,
    sourceSha256: decision.sourceSha256,
    currentValue: decision.currentValue,
    currentValueSha256: decision.currentValueSha256,
    members: decision.members,
  });
  if (decision.decisionIdentitySha256 !== expectedIdentity) {
    throw new Error("Semantic decision identity hash drifted.");
  }
}

function validateProposal(proposal: Proposal) {
  validateSemanticDecision(proposal);
  requireNfcNonBlank(proposal.proposedValue, "Semantic proposed value");
  if (
    sha256TextAfrikaansEscalationResolution(proposal.proposedValue) !==
    proposal.proposedValueSha256
  ) {
    throw new Error("Semantic proposed-value hash drifted.");
  }
  const expectedIdentity = sha256CanonicalAfrikaansEscalationResolution({
    schemaVersion: 1,
    kind: "afrikaans-semantic-proposal-identity-v1",
    decisionIdentitySha256: proposal.decisionIdentitySha256,
    proposedValue: proposal.proposedValue,
    proposedValueSha256: proposal.proposedValueSha256,
  });
  if (proposal.proposalIdentitySha256 !== expectedIdentity) {
    throw new Error("Semantic proposal identity hash drifted.");
  }
}

function semanticProjection(proposal: Proposal): SemanticDecision {
  return {
    decisionIdentitySha256: proposal.decisionIdentitySha256,
    language: proposal.language,
    locale: proposal.locale,
    source: proposal.source,
    sourceSha256: proposal.sourceSha256,
    currentValue: proposal.currentValue,
    currentValueSha256: proposal.currentValueSha256,
    fieldCount: proposal.fieldCount,
    members: proposal.members,
  };
}

function thirdValueRoot(artifact: ThirdValueProposals) {
  return sha256CanonicalAfrikaansEscalationResolution(
    artifact.proposals.map((proposal) => ({
      decisionIdentitySha256: proposal.decisionIdentitySha256,
      proposalIdentitySha256: proposal.proposalIdentitySha256,
      thirdValue: proposal.thirdValue,
      thirdValueSha256: proposal.thirdValueSha256,
    })),
  );
}

function markupTokensIn(value: string) {
  const pattern =
    /<\/?[A-Za-z][^>]*>|```[^\n]*|~~~[^\n]*|`[^`\n]*`|!?(?:\[[^\]\n]*\])?\((?:[^()\n]|\([^()\n]*\))*\)/gu;
  return Array.from(value.matchAll(pattern), (match) => match[0]);
}

function terminalPunctuation(value: string) {
  const match = value
    .trimEnd()
    .match(/([.!?…:;]+)(?:["'’”»)\]}]+)?$/u);
  return match?.[1] ?? "";
}

function sameStringMultiset(left: readonly string[], right: readonly string[]) {
  const leftSorted = [...left].sort(compareCodePoints);
  const rightSorted = [...right].sort(compareCodePoints);
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function compareMembers(left: Member, right: Member) {
  return (
    compareCodePoints(left.namespace, right.namespace) ||
    compareCodePoints(left.key, right.key) ||
    compareCodePoints(left.sourceHash, right.sourceHash) ||
    compareCodePoints(left.fieldIdentitySha256, right.fieldIdentitySha256)
  );
}

function compareCodePoints(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSortedUnique(values: readonly string[]) {
  return values.every(
    (value, index) =>
      index === 0 || compareCodePoints(values[index - 1], value) < 0,
  );
}

function normalizedActorName(value: string, label: string) {
  requireNfcNonBlank(value, label);
  if (value !== value.trim()) throw new Error(`${label} has surrounding whitespace.`);
  return value.toLocaleLowerCase("en-US");
}

function requireNfcNonBlank(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} is blank.`);
  if (value !== value.normalize("NFC")) throw new Error(`${label} is not NFC.`);
}

function timestampMs(value: string, label: string) {
  if (!ISO_UTC_PATTERN.test(value)) throw new Error(`${label} is not exact UTC ISO.`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) {
    throw new Error(`${label} is invalid.`);
  }
  const canonical = new Date(parsed).toISOString();
  const expectedCanonical = value.includes(".")
    ? value
    : value.replace(/Z$/u, ".000Z");
  if (canonical !== expectedCanonical) {
    throw new Error(`${label} is not a calendar-valid canonical UTC timestamp.`);
  }
  return parsed;
}

function validateFrozenPolicy(policy: AfrikaansEscalationResolutionFrozenPolicy) {
  const expectedKeys = [
    "partitionPlanSha256",
    "policyId",
    "reviewBundleSha256",
    "reviewerAEvidenceSha256",
    "reviewerBEvidenceSha256",
  ];
  const observedKeys = Object.keys(policy).sort(compareCodePoints);
  if (canonicalJson(observedKeys) !== canonicalJson(expectedKeys)) {
    throw new Error("Frozen escalation-resolution policy keys drifted.");
  }
  if (policy.policyId !== "afrikaans-escalation-resolution-frozen-v1") {
    throw new Error("Frozen escalation-resolution policy ID drifted.");
  }
  for (const [label, value] of Object.entries(policy).filter(
    ([key]) => key !== "policyId",
  )) {
    if (!/^[a-f0-9]{64}$/u.test(value)) {
      throw new Error(`Frozen policy ${label} is not a SHA-256 digest.`);
    }
  }
}

function assertHash(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} SHA-256 drifted: expected ${expected}, found ${actual}.`);
  }
}

function loadJson<T>(
  path: string,
  schema: z.ZodType<T>,
  label: string,
  trustedRoot: string,
): LoadedJson<T> {
  const loaded = readStableRegularFile(path, trustedRoot, label);
  if (loaded.bytes.length <= 0 || loaded.bytes.length > MAXIMUM_JSON_BYTES) {
    throw new Error(`${label} has an invalid byte size.`);
  }
  let parsed: unknown;
  try {
    parsed = parseStrictJsonBytes(loaded.bytes, label);
  } catch (error: unknown) {
    throw new Error(
      `${label} is not strict JSON: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  let value: T;
  try {
    value = schema.parse(parsed);
  } catch (error: unknown) {
    throw new Error(
      `${label} violates its exact contract: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
  return Object.freeze({
    path: loaded.path,
    bytes: loaded.bytes.length,
    sha256: createHash("sha256").update(loaded.bytes).digest("hex"),
    value,
  });
}

function parseStrictJsonBytes(raw: Buffer, label: string): unknown {
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) {
    throw new Error(`${label} is not valid UTF-8.`);
  }
  new StrictJsonScanner(text, label).scan();
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
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
        const decoded: unknown = JSON.parse(
          this.raw.slice(start, this.index),
        );
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

function canonicalTrustedRoot(path: string) {
  const absolutePath = resolve(path);
  const canonicalPath = realpathSync(absolutePath);
  if (absolutePath !== canonicalPath) {
    throw new Error("Trusted input root must be a canonical path without symlink ancestors.");
  }
  const stat = lstatSync(canonicalPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Trusted input root must be a regular directory.");
  }
  return canonicalPath;
}

function readStableRegularFile(path: string, trustedRoot: string, label: string) {
  const absolutePath = resolve(path);
  const canonicalPath = realpathSync(absolutePath);
  const relativePath = relative(trustedRoot, canonicalPath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`${label} escapes its trusted root.`);
  }
  if (absolutePath !== canonicalPath) {
    throw new Error(`${label} path contains a symlink ancestor.`);
  }
  let cursor = trustedRoot;
  for (const segment of relativePath.split(sep)) {
    cursor = resolve(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`${label} path contains a symlink ancestor.`);
    }
  }
  const descriptor = openSync(
    canonicalPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1) {
      throw new Error(`${label} must be a single-link regular file.`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      bytes.length !== before.size
    ) {
      throw new Error(`${label} changed during its same-descriptor read.`);
    }
    const pathStat = lstatSync(canonicalPath);
    if (
      pathStat.isSymbolicLink() ||
      pathStat.dev !== before.dev ||
      pathStat.ino !== before.ino
    ) {
      throw new Error(`${label} path changed during verification.`);
    }
    return Object.freeze({ path: canonicalPath, bytes });
  } finally {
    closeSync(descriptor);
  }
}

export function sha256TextAfrikaansEscalationResolution(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256CanonicalAfrikaansEscalationResolution(value: unknown) {
  return sha256TextAfrikaansEscalationResolution(canonicalJson(value));
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
      throw new Error("Canonical JSON cannot contain non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("Canonical JSON received an unsupported value.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CLI_FLAGS = Object.freeze({
  "partition-plan": "partitionPlanPath",
  "review-bundle": "reviewBundlePath",
  "reviewer-a": "reviewerAEvidencePath",
  "reviewer-b": "reviewerBEvidencePath",
  proposals: "thirdValueProposalsPath",
  review: "thirdValueReviewPath",
} as const);

type CliFlag = keyof typeof CLI_FLAGS;

export function parseAfrikaansEscalationResolutionCli(
  rawArgs: readonly string[],
  repoRoot = defaultRepoRoot,
) {
  const values = new Map<CliFlag, string>();
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unknown escalation-resolution argument: ${argument}.`);
    }
    const equals = argument.indexOf("=");
    const rawKey = argument.slice(2, equals >= 0 ? equals : undefined);
    if (!(rawKey in CLI_FLAGS)) {
      throw new Error(`Unknown escalation-resolution flag: --${rawKey}.`);
    }
    const key = rawKey as CliFlag;
    if (values.has(key)) {
      throw new Error(`Duplicate escalation-resolution flag: --${key}.`);
    }
    if (equals >= 0) {
      const value = argument.slice(equals + 1);
      if (!value) throw new Error(`Missing value for --${key}.`);
      values.set(key, value);
      continue;
    }
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`);
    }
    values.set(key, value);
    index += 1;
  }
  const defaults = defaultAfrikaansEscalationResolutionPaths(repoRoot);
  const paths = { ...defaults };
  for (const [key, value] of values.entries()) {
    paths[CLI_FLAGS[key]] = resolve(value);
  }
  return Object.freeze({ paths: Object.freeze(paths) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const command = parseAfrikaansEscalationResolutionCli(
      process.argv.slice(2),
    );
    console.log(
      JSON.stringify(verifyAfrikaansEscalationResolution(command), null, 2),
    );
  } catch (error: unknown) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: FAILURE_KIND,
          diagnosticOnly: true,
          trustModel: "trusted-single-user-local-workspace",
          authentication: "none",
          identityClaimsVerified: false,
          trackedWritesPerformed: false,
          trackedWritesPermitted: false,
          writePermitted: false,
          materializePermitted: false,
          applyPermitted: false,
          promotePermitted: false,
          importPermitted: false,
          releaseAttestation: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}
