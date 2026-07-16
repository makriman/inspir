import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  linkSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  defaultAfrikaansEscalationResolutionPaths,
  parseAfrikaansEscalationResolutionCli,
  sha256CanonicalAfrikaansEscalationResolution,
  sha256TextAfrikaansEscalationResolution,
  verifyAfrikaansEscalationResolution,
  type AfrikaansEscalationResolutionFrozenPolicy,
  type AfrikaansEscalationResolutionPaths,
} from "../scripts/afrikaans-escalation-resolution-verifier";
import { createLongTailValidatorPolicyProvenance } from "../scripts/translation-validator-policy-provenance";
import { validateTranslationCandidateField } from "../lib/i18n/translation-candidate-quality";
import { isValidFieldTranslation } from "../lib/i18n/translation-field-validation";
import { inspectTranslationFieldFluency } from "../lib/i18n/translation-quality";

const verifierPath = path.resolve(
  "scripts/afrikaans-escalation-resolution-verifier.ts",
);
const preparedPlanSha256 = sha256TextAfrikaansEscalationResolution(
  "synthetic-prepared-plan",
);
const candidateTreeSha256 = sha256TextAfrikaansEscalationResolution(
  "synthetic-candidate-tree",
);
const sourceHash = sha256TextAfrikaansEscalationResolution(
  "synthetic-main-app-source",
);
const validatorPolicySha256 = createLongTailValidatorPolicyProvenance(
  path.resolve("."),
).validatorPolicySha256;
const safety = Object.freeze({
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
});

type SyntheticFixture = Readonly<{
  root: string;
  paths: AfrikaansEscalationResolutionPaths;
  policy: AfrikaansEscalationResolutionFrozenPolicy;
  nowEpochMs: number;
}>;

function sha256File(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonRecord(filePath: string) {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  return requireRecord(parsed, filePath);
}

function mutateJson(
  filePath: string,
  mutate: (record: Record<string, unknown>) => void,
) {
  const value = readJsonRecord(filePath);
  mutate(value);
  writeJson(filePath, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} is not a record.`);
  }
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array.`);
  return value;
}

function requireString(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is not a string.`);
  return value;
}

function buildSemanticDecision(input: {
  source: string;
  currentValue: string;
  key: string;
  additionalKeys?: readonly string[];
}) {
  const members = [input.key, ...(input.additionalKeys ?? [])].map((key) => ({
    fieldIdentitySha256: sha256CanonicalAfrikaansEscalationResolution({
      kind: "synthetic-field",
      key,
    }),
    namespace: "main-app" as const,
    sourceHash,
    key,
  })).sort((left, right) => left.key.localeCompare(right.key));
  const sourceSha256 = sha256TextAfrikaansEscalationResolution(input.source);
  const currentValueSha256 = sha256TextAfrikaansEscalationResolution(
    input.currentValue,
  );
  const identityMaterial = {
    schemaVersion: 1,
    kind: "afrikaans-semantic-decision-identity-v1",
    language: "Afrikaans" as const,
    locale: "af" as const,
    source: input.source,
    sourceSha256,
    currentValue: input.currentValue,
    currentValueSha256,
    members,
  };
  return {
    decisionIdentitySha256:
      sha256CanonicalAfrikaansEscalationResolution(identityMaterial),
    language: "Afrikaans" as const,
    locale: "af" as const,
    source: input.source,
    sourceSha256,
    currentValue: input.currentValue,
    currentValueSha256,
    fieldCount: members.length,
    members,
  };
}

function buildProposal(
  decision: ReturnType<typeof buildSemanticDecision>,
  proposedValue: string,
) {
  const proposedValueSha256 =
    sha256TextAfrikaansEscalationResolution(proposedValue);
  return {
    ...decision,
    proposalIdentitySha256:
      sha256CanonicalAfrikaansEscalationResolution({
        schemaVersion: 1,
        kind: "afrikaans-semantic-proposal-identity-v1",
        decisionIdentitySha256: decision.decisionIdentitySha256,
        proposedValue,
        proposedValueSha256,
      }),
    proposedValue,
    proposedValueSha256,
  };
}

function semanticDecisionProjection(
  proposal: ReturnType<typeof buildProposal>,
) {
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

function partitionFor(
  reviewerId: "reviewer-a" | "reviewer-b",
  proposal: ReturnType<typeof buildProposal>,
  decisionRootSha256: string,
) {
  const decisionIds = [proposal.decisionIdentitySha256];
  const material = {
    schemaVersion: 1,
    kind: "afrikaans-semantic-reviewer-partition-v1",
    reviewerId,
    preparedPlanSha256,
    decisionRootSha256,
    decisionCount: 1,
    fieldCount: proposal.fieldCount,
    decisionIds,
  };
  return {
    reviewerId,
    decisionCount: 1,
    fieldCount: proposal.fieldCount,
    partitionRootSha256:
      sha256CanonicalAfrikaansEscalationResolution(material),
    decisionIds,
  };
}

function originalEvidence(input: {
  reviewerId: "reviewer-a" | "reviewer-b";
  reviewerName: string;
  completedAtUtc: string;
  partition: ReturnType<typeof partitionFor>;
  proposal: ReturnType<typeof buildProposal>;
  partitionPlanSha256: string;
  reviewBundleSha256: string;
  decisionRootSha256: string;
  proposalRootSha256: string;
}) {
  return {
    schemaVersion: 1,
    kind: "afrikaans-semantic-review-evidence-v1",
    diagnosticOnly: true,
    trackedWritesPerformed: false,
    trackedWritesPermitted: false,
    promotePermitted: false,
    importPermitted: false,
    applyPermitted: false,
    releaseAttestation: false,
    inputBindings: {
      partitionPlanSha256: input.partitionPlanSha256,
      reviewBundleSha256: input.reviewBundleSha256,
      preparedPlanSha256,
      decisionRootSha256: input.decisionRootSha256,
      partitionRootSha256: input.partition.partitionRootSha256,
      proposalRootSha256: input.proposalRootSha256,
      candidateTreeSha256,
    },
    reviewer: {
      reviewerId: input.reviewerId,
      reviewerName: input.reviewerName,
      completedAtUtc: input.completedAtUtc,
    },
    summary: {
      decisions: 1,
      fields: input.partition.fieldCount,
      acceptedProposals: 0,
      preservedCurrentValues: 0,
      escalations: 1,
    },
    decisions: [
      {
        decisionIdentitySha256: input.proposal.decisionIdentitySha256,
        proposalIdentitySha256: input.proposal.proposalIdentitySha256,
        verdict: "escalate",
        finalValue: null,
        finalValueSha256: null,
        rationale: "Neither bound value is semantically acceptable.",
      },
    ],
  };
}

type SyntheticProposalB = Readonly<{
  source: string;
  currentValue: string;
  proposedValue: string;
  thirdValue: string;
  additionalKeys?: readonly string[];
}>;

function buildSyntheticFixture(
  t: TestContext,
  options: Readonly<{ proposalB?: SyntheticProposalB }> = {},
): SyntheticFixture {
  const rawRoot = mkdtempSync(
    path.join(os.tmpdir(), "inspir-af-escalation-resolution-"),
  );
  const root = realpathSync(rawRoot);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = {
    partitionPlanPath: path.join(root, "partition-plan.json"),
    reviewBundlePath: path.join(root, "review-bundle.json"),
    reviewerAEvidencePath: path.join(root, "reviewer-a-evidence.json"),
    reviewerBEvidencePath: path.join(root, "reviewer-b-evidence.json"),
    thirdValueProposalsPath: path.join(root, "third-value-proposals.json"),
    thirdValueReviewPath: path.join(root, "third-value-review.json"),
  };

  const proposalA = buildProposal(
    buildSemanticDecision({
      source: "Do not remove {count} <strong>GitHub</strong> records.",
      currentValue: "Verwyder {count} <strong>GitHub</strong>-rekords.",
      key: "synthetic.a",
    }),
    "Moet {count} <strong>GitHub</strong>-rekords verwyder.",
  );
  const proposalBInput = options.proposalB ?? {
    source: "Open <em>inspir</em> safely.",
    currentValue: "Open <em>inspir</em>.",
    proposedValue: "Maak <em>inspir</em> oop.",
    thirdValue: "Maak <em>inspir</em> veilig oop.",
  };
  const proposalB = buildProposal(
    buildSemanticDecision({
      source: proposalBInput.source,
      currentValue: proposalBInput.currentValue,
      key: "synthetic.b",
      additionalKeys: proposalBInput.additionalKeys,
    }),
    proposalBInput.proposedValue,
  );
  const decisions = [proposalA, proposalB]
    .map(semanticDecisionProjection)
    .sort((left, right) =>
      left.decisionIdentitySha256.localeCompare(right.decisionIdentitySha256),
    );
  const decisionRootSha256 =
    sha256CanonicalAfrikaansEscalationResolution(decisions);
  const totalFieldCount = decisions.reduce(
    (sum, decision) => sum + decision.fieldCount,
    0,
  );
  const partitionA = partitionFor("reviewer-a", proposalA, decisionRootSha256);
  const partitionB = partitionFor("reviewer-b", proposalB, decisionRootSha256);
  const partitionPlan = {
    schemaVersion: 1,
    kind: "afrikaans-parallel-semantic-adjudication-plan-v1",
    diagnosticOnly: true,
    trackedWritesPermitted: false,
    promotePermitted: false,
    importPermitted: false,
    applyPermitted: false,
    releaseAttestation: false,
    inputBindings: { preparedPlanSha256 },
    laneImplementationBindings: {},
    corpus: {
      fields: totalFieldCount,
      decisions: 2,
      groupingKey: "sourceSha256",
      groupingInvariant:
        "Every member has byte-identical NFC source/currentValue and matching hashes.",
      duplicateSourceGroups: decisions.filter(
        (decision) => decision.fieldCount > 1,
      ).length,
      fieldIdentityRootSha256:
        sha256CanonicalAfrikaansEscalationResolution(
          decisions
            .flatMap((decision) =>
              decision.members.map((member) => member.fieldIdentitySha256),
            )
            .sort(),
        ),
      decisionRootSha256,
    },
    partitionAlgorithm: {},
    decisions,
    reviewers: [partitionA, partitionB],
    evidenceContract: {},
    reconciliationContract: {},
  };
  writeJson(paths.partitionPlanPath, partitionPlan);
  const partitionPlanSha256 = sha256File(paths.partitionPlanPath);

  const allProposals = [proposalA, proposalB].sort((left, right) =>
    left.decisionIdentitySha256.localeCompare(right.decisionIdentitySha256),
  );
  const proposalRootSha256 =
    sha256CanonicalAfrikaansEscalationResolution(allProposals);
  const reviewBundle = {
    schemaVersion: 1,
    kind: "afrikaans-parallel-semantic-review-bundle-v1",
    diagnosticOnly: true,
    trackedWritesPermitted: false,
    promotePermitted: false,
    importPermitted: false,
    applyPermitted: false,
    releaseAttestation: false,
    inputBindings: {
      partitionPlanSha256,
      preparedPlanSha256,
      decisionRootSha256,
      diagnosticManifestSha256:
        sha256TextAfrikaansEscalationResolution("synthetic-diagnostic-manifest"),
      diagnosticManifestKind:
        "afrikaans-residual-repair-diagnostic-proposal-manifest-v1",
      candidateTreeSha256,
      proposalRootSha256,
    },
    proposalCount: 2,
    proposalFieldCount: totalFieldCount,
    reviewers: [
      {
        reviewerId: "reviewer-a",
        partitionRootSha256: partitionA.partitionRootSha256,
        decisionCount: 1,
        fieldCount: partitionA.fieldCount,
        proposals: [proposalA],
      },
      {
        reviewerId: "reviewer-b",
        partitionRootSha256: partitionB.partitionRootSha256,
        decisionCount: 1,
        fieldCount: partitionB.fieldCount,
        proposals: [proposalB],
      },
    ],
    evidenceInstructions: {},
  };
  writeJson(paths.reviewBundlePath, reviewBundle);
  const reviewBundleSha256 = sha256File(paths.reviewBundlePath);

  writeJson(
    paths.reviewerAEvidencePath,
    originalEvidence({
      reviewerId: "reviewer-a",
      reviewerName: "Reviewer Alpha",
      completedAtUtc: "2026-01-01T00:00:00.000Z",
      partition: partitionA,
      proposal: proposalA,
      partitionPlanSha256,
      reviewBundleSha256,
      decisionRootSha256,
      proposalRootSha256,
    }),
  );
  writeJson(
    paths.reviewerBEvidencePath,
    originalEvidence({
      reviewerId: "reviewer-b",
      reviewerName: "Reviewer Beta",
      completedAtUtc: "2026-01-01T00:01:00.000Z",
      partition: partitionB,
      proposal: proposalB,
      partitionPlanSha256,
      reviewBundleSha256,
      decisionRootSha256,
      proposalRootSha256,
    }),
  );
  const reviewerAEvidenceSha256 = sha256File(paths.reviewerAEvidencePath);
  const reviewerBEvidenceSha256 = sha256File(paths.reviewerBEvidencePath);
  const policy = {
    policyId: "afrikaans-escalation-resolution-frozen-v1",
    partitionPlanSha256,
    reviewBundleSha256,
    reviewerAEvidenceSha256,
    reviewerBEvidenceSha256,
  } satisfies AfrikaansEscalationResolutionFrozenPolicy;
  const frozenPolicySha256 =
    sha256CanonicalAfrikaansEscalationResolution(policy);
  const verifierImplementationSha256 = sha256File(verifierPath);
  const escalationRows = [
    {
      originalReviewerId: "reviewer-a" as const,
      proposal: proposalA,
      thirdValue:
        "Moenie {count} <strong>GitHub</strong>-rekords verwyder nie.",
    },
    {
      originalReviewerId: "reviewer-b" as const,
      proposal: proposalB,
      thirdValue: proposalBInput.thirdValue,
    },
  ].sort((left, right) =>
    left.proposal.decisionIdentitySha256.localeCompare(
      right.proposal.decisionIdentitySha256,
    ),
  );
  const escalationDecisionRootSha256 =
    sha256CanonicalAfrikaansEscalationResolution(
      escalationRows.map((row) => row.proposal.decisionIdentitySha256),
    );
  const thirdValueRows = escalationRows.map((row) => ({
    originalReviewerId: row.originalReviewerId,
    decisionIdentitySha256: row.proposal.decisionIdentitySha256,
    proposalIdentitySha256: row.proposal.proposalIdentitySha256,
    sourceSha256: row.proposal.sourceSha256,
    currentValueSha256: row.proposal.currentValueSha256,
    proposedValueSha256: row.proposal.proposedValueSha256,
    fieldCount: row.proposal.fieldCount,
    members: row.proposal.members,
    thirdValue: row.thirdValue,
    thirdValueSha256:
      sha256TextAfrikaansEscalationResolution(row.thirdValue),
    rationale: "This synthetic third value preserves meaning and structure.",
  }));
  const thirdValueRootSha256 =
    sha256CanonicalAfrikaansEscalationResolution(
      thirdValueRows.map((row) => ({
        decisionIdentitySha256: row.decisionIdentitySha256,
        proposalIdentitySha256: row.proposalIdentitySha256,
        thirdValue: row.thirdValue,
        thirdValueSha256: row.thirdValueSha256,
      })),
    );
  const baseResolutionBindings = {
    verifierImplementationSha256,
    frozenPolicySha256,
    validatorPolicySha256,
    partitionPlanSha256,
    reviewBundleSha256,
    reviewerAEvidenceSha256,
    reviewerBEvidenceSha256,
    decisionRootSha256,
    proposalRootSha256,
    candidateTreeSha256,
    escalationDecisionRootSha256,
  };
  const thirdValueProposals = {
    schemaVersion: 1,
    kind: "afrikaans-escalation-third-value-proposals-v1",
    ...safety,
    inputBindings: baseResolutionBindings,
    author: {
      authorName: "Repair Author",
      identityAssurance: "trusted-local-assertion",
      authoredAtUtc: "2026-01-01T00:02:00.000Z",
    },
    summary: {
      decisions: 2,
      fields: totalFieldCount,
      escalationDecisionRootSha256,
      thirdValueRootSha256,
    },
    proposals: thirdValueRows,
  };
  writeJson(paths.thirdValueProposalsPath, thirdValueProposals);
  const thirdValueProposalsSha256 = sha256File(
    paths.thirdValueProposalsPath,
  );
  const reviewRows = thirdValueRows.map((row) => ({
    originalReviewerId: row.originalReviewerId,
    decisionIdentitySha256: row.decisionIdentitySha256,
    proposalIdentitySha256: row.proposalIdentitySha256,
    sourceSha256: row.sourceSha256,
    fieldCount: row.fieldCount,
    members: row.members,
    thirdValueSha256: row.thirdValueSha256,
    verdict: "approve-third-value",
    rationale: "Independent synthetic approval.",
  }));
  writeJson(paths.thirdValueReviewPath, {
    schemaVersion: 1,
    kind: "afrikaans-escalation-third-value-review-v1",
    ...safety,
    inputBindings: {
      ...baseResolutionBindings,
      thirdValueProposalsSha256,
      thirdValueRootSha256,
    },
    reviewer: {
      reviewerName: "Resolution Reviewer",
      identityAssurance: "trusted-local-assertion",
      completedAtUtc: "2026-01-01T00:03:00.000Z",
    },
    summary: {
      decisions: 2,
      fields: totalFieldCount,
      approvedThirdValues: 2,
      rejectedThirdValues: 0,
      escalatedAgain: 0,
    },
    decisions: reviewRows,
  });
  return {
    root,
    paths,
    policy,
    nowEpochMs: Date.parse("2026-01-01T00:04:00.000Z"),
  };
}

function verifyFixture(fixture: SyntheticFixture) {
  return verifyAfrikaansEscalationResolution({
    paths: fixture.paths,
    policy: fixture.policy,
    nowEpochMs: fixture.nowEpochMs,
    trustedInputRoot: fixture.root,
  });
}

function proposalRows(record: Record<string, unknown>) {
  return requireArray(record.proposals, "proposal rows");
}

function reviewRows(record: Record<string, unknown>) {
  return requireArray(record.decisions, "review rows");
}

test("valid synthetic escalation resolution remains diagnostic and stdout-only", (t) => {
  const fixture = buildSyntheticFixture(t);
  const result = verifyFixture(fixture);
  assert.equal(result.kind, "afrikaans-escalation-resolution-verification-v1");
  assert.deepEqual(result.summary, {
    decisions: 2,
    fields: 2,
    approvedThirdValues: 2,
  });
  assert.equal(result.resolvedDecisions.length, 2);
  assert.match(result.resolvedDecisionRootSha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.trustModel, "trusted-single-user-local-workspace");
  assert.equal(result.authentication, "none");
  assert.equal(result.identityClaimsVerified, false);
  assert.equal(result.trackedWritesPerformed, false);
  assert.equal(result.trackedWritesPermitted, false);
  assert.equal(result.writePermitted, false);
  assert.equal(result.materializePermitted, false);
  assert.equal(result.applyPermitted, false);
  assert.equal(result.promotePermitted, false);
  assert.equal(result.importPermitted, false);
  assert.equal(result.releaseAttestation, false);
  assert.equal(result.applyReady, false);
  assert.equal(result.outputChannel, "stdout-only");
});

test("proposal and review coverage rejects omissions, extras, duplicates, and reordering", async (t) => {
  await t.test("proposal omission", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      proposalRows(record).pop();
    });
    assert.throws(() => verifyFixture(fixture), /omit, duplicate, add, or reorder/u);
  });
  await t.test("proposal duplicate extra", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      const rows = proposalRows(record);
      rows.push(structuredClone(rows[0]));
    });
    assert.throws(() => verifyFixture(fixture), /omit, duplicate, add, or reorder/u);
  });
  await t.test("proposal reorder", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      proposalRows(record).reverse();
    });
    assert.throws(() => verifyFixture(fixture), /omit, duplicate, add, or reorder/u);
  });
  await t.test("review omission", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
      reviewRows(record).pop();
    });
    assert.throws(() => verifyFixture(fixture), /review omits, duplicates, adds, or reorders/u);
  });
  await t.test("review duplicate", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
      const rows = reviewRows(record);
      rows[1] = structuredClone(rows[0]);
    });
    assert.throws(() => verifyFixture(fixture), /review omits, duplicates, adds, or reorders/u);
  });
});

test("resolution rejects every non-approval even with an internally consistent summary", async (t) => {
  for (const verdict of ["reject-third-value", "escalate-again"] as const) {
    await t.test(verdict, (subtest) => {
      const fixture = buildSyntheticFixture(subtest);
      mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
        const rows = reviewRows(record);
        requireRecord(rows[0], "review row").verdict = verdict;
        const summary = requireRecord(record.summary, "review summary");
        summary.approvedThirdValues = 1;
        summary.rejectedThirdValues = verdict === "reject-third-value" ? 1 : 0;
        summary.escalatedAgain = verdict === "escalate-again" ? 1 : 0;
      });
      assert.throws(() => verifyFixture(fixture), /fails closed/u);
    });
  }
});

test("stale bindings and coordinated rehash attempts fail closed", async (t) => {
  await t.test("stale proposal binding", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      requireRecord(record.inputBindings, "proposal bindings").reviewerBEvidenceSha256 =
        "0".repeat(64);
    });
    assert.throws(() => verifyFixture(fixture), /bindings are stale/u);
  });
  await t.test("stale review proposal hash", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
      requireRecord(record.inputBindings, "review bindings").thirdValueProposalsSha256 =
        "0".repeat(64);
    });
    assert.throws(() => verifyFixture(fixture), /review bindings are stale/u);
  });
  await t.test("coordinated evidence and downstream rehash", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.reviewerAEvidencePath, (record) => {
      const rows = requireArray(record.decisions, "evidence rows");
      requireRecord(rows[0], "evidence row").rationale = "Coordinated replacement rationale.";
    });
    const newEvidenceHash = sha256File(fixture.paths.reviewerAEvidencePath);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      requireRecord(record.inputBindings, "proposal bindings").reviewerAEvidenceSha256 =
        newEvidenceHash;
    });
    const newProposalsHash = sha256File(fixture.paths.thirdValueProposalsPath);
    mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
      const bindings = requireRecord(record.inputBindings, "review bindings");
      bindings.reviewerAEvidenceSha256 = newEvidenceHash;
      bindings.thirdValueProposalsSha256 = newProposalsHash;
    });
    assert.throws(() => verifyFixture(fixture), /Immutable reviewer-a evidence SHA-256 drifted/u);
  });
});

test("unsafe authority flags are rejected in both append-only artifacts", async (t) => {
  await t.test("proposal apply authority", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      record.applyPermitted = true;
    });
    assert.throws(() => verifyFixture(fixture), /violates its exact contract/u);
  });
  await t.test("review write authority", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
      record.writePermitted = true;
    });
    assert.throws(() => verifyFixture(fixture), /violates its exact contract/u);
  });
  await t.test("proposal cannot claim authentication", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      record.authentication = "cryptographic-signature";
      record.identityClaimsVerified = true;
    });
    assert.throws(() => verifyFixture(fixture), /violates its exact contract/u);
  });
});

test("strict artifact parsing rejects ambiguous bytes", async (t) => {
  await t.test("duplicate JSON key", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    const original = readFileSync(
      fixture.paths.thirdValueProposalsPath,
      "utf8",
    );
    const ambiguous = original.replace(
      '  "applyPermitted": false,',
      '  "applyPermitted": true,\n  "applyPermitted": false,',
    );
    assert.notEqual(ambiguous, original);
    writeFileSync(fixture.paths.thirdValueProposalsPath, ambiguous, "utf8");
    assert.throws(() => verifyFixture(fixture), /duplicate JSON key/u);
  });
  await t.test("invalid UTF-8 inside a JSON string", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    const bytes = readFileSync(fixture.paths.thirdValueProposalsPath);
    const rationale = Buffer.from("This synthetic third value", "utf8");
    const index = bytes.indexOf(rationale);
    assert.notEqual(index, -1);
    bytes[index] = 0xff;
    writeFileSync(fixture.paths.thirdValueProposalsPath, bytes);
    assert.throws(() => verifyFixture(fixture), /not valid UTF-8/u);
  });
});

test("trusted-local actor assertions must be distinct", async (t) => {
  await t.test("proposal author equals original reviewer", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      requireRecord(record.author, "proposal author").authorName = "Reviewer Alpha";
    });
    assert.throws(() => verifyFixture(fixture), /author must differ/u);
  });
  await t.test("resolution reviewer equals proposal author", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
      requireRecord(record.reviewer, "resolution reviewer").reviewerName = "Repair Author";
    });
    assert.throws(() => verifyFixture(fixture), /resolution reviewer must differ/u);
  });
  await t.test("missing trusted-local assertion label", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
      requireRecord(record.reviewer, "resolution reviewer").identityAssurance =
        "cryptographic-identity";
    });
    assert.throws(() => verifyFixture(fixture), /violates its exact contract/u);
  });
});

test("timestamps are strict, finite, calendar-valid, causal, and not future", async (t) => {
  await t.test("noncausal proposal", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      requireRecord(record.author, "proposal author").authoredAtUtc =
        "2026-01-01T00:01:00.000Z";
    });
    assert.throws(() => verifyFixture(fixture), /noncausal relative to original evidence/u);
  });
  await t.test("noncausal review", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
      requireRecord(record.reviewer, "resolution reviewer").completedAtUtc =
        "2026-01-01T00:02:00.000Z";
    });
    assert.throws(() => verifyFixture(fixture), /review is noncausal/u);
  });
  await t.test("future review", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
      requireRecord(record.reviewer, "resolution reviewer").completedAtUtc =
        "2026-01-01T00:05:00.000Z";
    });
    assert.throws(() => verifyFixture(fixture), /timestamp is in the future/u);
  });
  await t.test("calendar-invalid timestamp", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      requireRecord(record.author, "proposal author").authoredAtUtc =
        "2026-02-30T00:02:00.000Z";
    });
    assert.throws(() => verifyFixture(fixture), /calendar-valid canonical UTC/u);
  });
  await t.test("NaN timestamp text", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueReviewPath, (record) => {
      requireRecord(record.reviewer, "resolution reviewer").completedAtUtc = "NaN";
    });
    assert.throws(() => verifyFixture(fixture), /violates its exact contract/u);
  });
  await t.test("NaN verification clock", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    assert.throws(
      () =>
        verifyAfrikaansEscalationResolution({
          paths: fixture.paths,
          policy: fixture.policy,
          nowEpochMs: Number.NaN,
          trustedInputRoot: fixture.root,
        }),
      /verification clock is invalid/u,
    );
  });
});

test("third values enforce distinct NFC hashes and translation structure", async (t) => {
  async function mutateFirstThirdValue(
    label: string,
    mutate: (row: Record<string, unknown>) => void,
    expected: RegExp,
  ) {
    await t.test(label, (subtest) => {
      const fixture = buildSyntheticFixture(subtest);
      mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
        const row = requireRecord(proposalRows(record)[0], "third-value row");
        mutate(row);
      });
      assert.throws(() => verifyFixture(fixture), expected);
    });
  }

  await mutateFirstThirdValue(
    "hash mismatch",
    (row) => {
      row.thirdValueSha256 = "0".repeat(64);
    },
    /hash drifted/u,
  );
  await mutateFirstThirdValue(
    "not distinct from current",
    (row) => {
      const current = "Verwyder {count} <strong>GitHub</strong>-rekords.";
      row.thirdValue = current;
      row.thirdValueSha256 = sha256TextAfrikaansEscalationResolution(current);
    },
    /not distinct/u,
  );
  await mutateFirstThirdValue(
    "non-NFC",
    (row) => {
      const value = `${requireString(row.thirdValue, "third value")} e\u0301`;
      row.thirdValue = value;
      row.thirdValueSha256 = sha256TextAfrikaansEscalationResolution(value);
    },
    /not NFC/u,
  );
  await mutateFirstThirdValue(
    "placeholder removal",
    (row) => {
      const value = requireString(row.thirdValue, "third value").replace(
        "{count} ",
        "",
      );
      row.thirdValue = value;
      row.thirdValueSha256 = sha256TextAfrikaansEscalationResolution(value);
    },
    /changed source placeholders/u,
  );
  await mutateFirstThirdValue(
    "markup removal",
    (row) => {
      const value = requireString(row.thirdValue, "third value")
        .replace("<strong>", "")
        .replace("</strong>", "");
      row.thirdValue = value;
      row.thirdValueSha256 = sha256TextAfrikaansEscalationResolution(value);
    },
    /changed source markup/u,
  );
  await mutateFirstThirdValue(
    "protected literal replacement",
    (row) => {
      const value = requireString(row.thirdValue, "third value").replace(
        "GitHub",
        "GitLab",
      );
      row.thirdValue = value;
      row.thirdValueSha256 = sha256TextAfrikaansEscalationResolution(value);
    },
    /changed protected literals/u,
  );
  await mutateFirstThirdValue(
    "terminal punctuation removal",
    (row) => {
      const value = requireString(row.thirdValue, "third value").replace(
        /\.$/u,
        "",
      );
      row.thirdValue = value;
      row.thirdValueSha256 = sha256TextAfrikaansEscalationResolution(value);
    },
    /changed terminal punctuation/u,
  );
  await mutateFirstThirdValue(
    "candidate validator negation failure",
    (row) => {
      const value = "Skrap {count} <strong>GitHub</strong>-rekords.";
      row.thirdValue = value;
      row.thirdValueSha256 = sha256TextAfrikaansEscalationResolution(value);
    },
    /translation candidate validation: negation-marker-missing/u,
  );
  await t.test("current key and context validators", (subtest) => {
    const source = "Code Tutor";
    const value = "Code Tutor vir leerders";
    const keys = ["synthetic.b", "synthetic.c"] as const;
    assert.deepEqual(
      validateTranslationCandidateField({
        language: "Afrikaans",
        source,
        value,
      }).failures,
      [],
    );
    for (const key of keys) {
      assert.equal(
        isValidFieldTranslation(source, value, "Afrikaans", key),
        true,
      );
      assert.deepEqual(
        inspectTranslationFieldFluency(source, value, "Afrikaans", {
          namespace: "main-app",
          sourceHash,
          key,
        }).reason,
        "embedded-source-phrase",
      );
    }
    const fixture = buildSyntheticFixture(subtest, {
      proposalB: {
        source,
        currentValue: "Kode-tutor",
        proposedValue: "Koderingstutor",
        thirdValue: value,
        additionalKeys: ["synthetic.c"],
      },
    });
    let observedError: unknown;
    try {
      verifyFixture(fixture);
    } catch (error: unknown) {
      observedError = error;
    }
    assert.ok(observedError instanceof Error);
    assert.match(
      observedError.message,
      /main-app\/synthetic\.b:embedded-source-phrase/u,
    );
    assert.match(
      observedError.message,
      /main-app\/synthetic\.c:embedded-source-phrase/u,
    );
  });
});

test("decision, proposal, source, and member identity bindings are exact", async (t) => {
  for (const [label, property, expected] of [
    ["decision", "decisionIdentitySha256", /change escalation identities/u],
    ["proposal", "proposalIdentitySha256", /identity or members drifted/u],
    ["source", "sourceSha256", /identity or members drifted/u],
  ] as const) {
    await t.test(label, (subtest) => {
      const fixture = buildSyntheticFixture(subtest);
      mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
        requireRecord(proposalRows(record)[0], "third-value row")[property] =
          "0".repeat(64);
      });
      assert.throws(() => verifyFixture(fixture), expected);
    });
  }
  await t.test("member", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      const row = requireRecord(proposalRows(record)[0], "third-value row");
      const members = requireArray(row.members, "members");
      requireRecord(members[0], "member").fieldIdentitySha256 = "0".repeat(64);
    });
    assert.throws(() => verifyFixture(fixture), /identity or members drifted/u);
  });
});

test("canonical containment rejects ancestor symlinks and root escapes", async (t) => {
  await t.test("ancestor symlink", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    const alias = path.join(fixture.root, "bundle-alias");
    symlinkSync(fixture.root, alias, "dir");
    const paths = {
      ...fixture.paths,
      reviewBundlePath: path.join(alias, "review-bundle.json"),
    };
    assert.throws(
      () =>
        verifyAfrikaansEscalationResolution({
          paths,
          policy: fixture.policy,
          nowEpochMs: fixture.nowEpochMs,
          trustedInputRoot: fixture.root,
        }),
      /symlink ancestor/u,
    );
  });
  await t.test("trusted-root escape", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    const paths = {
      ...fixture.paths,
      reviewBundlePath: verifierPath,
    };
    assert.throws(
      () =>
        verifyAfrikaansEscalationResolution({
          paths,
          policy: fixture.policy,
          nowEpochMs: fixture.nowEpochMs,
          trustedInputRoot: fixture.root,
        }),
      /escapes its trusted root/u,
    );
  });
  await t.test("hard-linked artifact", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    const hardLink = path.join(fixture.root, "third-value-proposals-hardlink.json");
    linkSync(fixture.paths.thirdValueProposalsPath, hardLink);
    assert.throws(
      () =>
        verifyAfrikaansEscalationResolution({
          paths: {
            ...fixture.paths,
            thirdValueProposalsPath: hardLink,
          },
          policy: fixture.policy,
          nowEpochMs: fixture.nowEpochMs,
          trustedInputRoot: fixture.root,
        }),
      /single-link regular file/u,
    );
  });
});

test("implementation and frozen-policy anchors reject drift", async (t) => {
  await t.test("implementation anchor", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      requireRecord(record.inputBindings, "proposal bindings").verifierImplementationSha256 =
        "0".repeat(64);
    });
    assert.throws(() => verifyFixture(fixture), /bindings are stale/u);
  });
  await t.test("policy anchor", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      requireRecord(record.inputBindings, "proposal bindings").frozenPolicySha256 =
        "0".repeat(64);
    });
    assert.throws(() => verifyFixture(fixture), /bindings are stale/u);
  });
  await t.test("validator-policy anchor", (subtest) => {
    const fixture = buildSyntheticFixture(subtest);
    mutateJson(fixture.paths.thirdValueProposalsPath, (record) => {
      requireRecord(
        record.inputBindings,
        "proposal bindings",
      ).validatorPolicySha256 = "0".repeat(64);
    });
    assert.throws(() => verifyFixture(fixture), /bindings are stale/u);
  });
});

test("CLI is default read-only with an exact six-flag allowlist", () => {
  const root = realpathSync(path.dirname(verifierPath));
  const defaults = defaultAfrikaansEscalationResolutionPaths(root);
  assert.deepEqual(parseAfrikaansEscalationResolutionCli([], root).paths, defaults);
  const parsed = parseAfrikaansEscalationResolutionCli(
    [
      "--partition-plan=one.json",
      "--review-bundle",
      "two.json",
      "--reviewer-a",
      "a.json",
      "--reviewer-b=b.json",
      "--proposals",
      "p.json",
      "--review=r.json",
    ],
    root,
  );
  assert.equal(parsed.paths.partitionPlanPath, path.resolve("one.json"));
  assert.equal(parsed.paths.thirdValueReviewPath, path.resolve("r.json"));
  assert.throws(
    () => parseAfrikaansEscalationResolutionCli(["--execute"], root),
    /Unknown escalation-resolution flag/u,
  );
  assert.throws(
    () =>
      parseAfrikaansEscalationResolutionCli(
        ["--review", "a", "--review", "b"],
        root,
      ),
    /Duplicate escalation-resolution flag/u,
  );
  assert.throws(
    () => parseAfrikaansEscalationResolutionCli(["positional"], root),
    /Unknown escalation-resolution argument/u,
  );
});

test("verifier source imports no mutation API and does not integrate the frozen adapter", () => {
  const source = readFileSync(verifierPath, "utf8");
  for (const forbidden of [
    "writeFile",
    "appendFile",
    "mkdirSync",
    "renameSync",
    "copyFile",
    "rmSync",
    "unlinkSync",
    "child_process",
    "wrangler",
    "afrikaans-reconciliation-apply-adapter",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.match(source, /outputChannel: "stdout-only"/u);
});
