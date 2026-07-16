import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  __testOnlyAfrikaansReconciliationAdapter,
  defaultAfrikaansReconciliationAdapterPaths,
  parseAfrikaansReconciliationAdapterCli,
  sha256CanonicalAfrikaansReconciliation,
  type AfrikaansReconciliationAdapterPaths,
  type AfrikaansReconciliationFrozenPolicy,
} from "../scripts/afrikaans-reconciliation-apply-adapter";
import {
  sha256CanonicalAfrikaansEscalationResolution,
  sha256TextAfrikaansEscalationResolution,
  verifyAfrikaansEscalationResolution,
  type AfrikaansEscalationResolutionFrozenPolicy,
} from "../scripts/afrikaans-escalation-resolution-verifier";
import { createLongTailValidatorPolicyProvenance } from "../scripts/translation-validator-policy-provenance";
import { AFRIKAANS_RECONCILIATION_FROZEN_V3_POLICY } from "../scripts/afrikaans-reconciliation-frozen-policy";
import { __testOnlyValidateHybridTranslationCandidateManifest } from "../scripts/compose-hybrid-translation-candidates";

type Namespace = "main-app" | "marketing-shell";
type ReviewerId = "reviewer-a" | "reviewer-b";

type Field = {
  language: "Afrikaans";
  locale: "af";
  namespace: Namespace;
  sourceHash: string;
  key: string;
  source: string;
  sourceSha256: string;
  currentValue: string;
  currentValueSha256: string;
};

type ScopeEntry = {
  language: "Afrikaans";
  locale: "af";
  namespace: Namespace;
  sourceHash: string;
  key: string;
  source: string;
  existingCandidate: string | null;
  reasons: string[];
};

type Member = {
  fieldIdentitySha256: string;
  namespace: Namespace;
  sourceHash: string;
  key: string;
};

type SemanticDecision = {
  decisionIdentitySha256: string;
  language: "Afrikaans";
  locale: "af";
  source: string;
  sourceSha256: string;
  currentValue: string;
  currentValueSha256: string;
  fieldCount: number;
  members: Member[];
};

type Proposal = SemanticDecision & {
  proposalIdentitySha256: string;
  proposedValue: string;
  proposedValueSha256: string;
};

type Fixture = ReturnType<typeof createFixture>;
const verificationNowEpochMs = Date.parse("2026-07-15T00:02:00Z");

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function rawFileSha256(file: string) {
  return sha256(readFileSync(file));
}

function writeJson(file: string, value: unknown, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  chmodSync(file, mode);
}

function readJsonRecord(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  assertRecord(value);
  return value;
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
}

function mutatePreparedExactDecision(
  fixture: Fixture,
  predicate: (decision: Record<string, unknown>) => boolean,
  mutate: (decision: Record<string, unknown>) => void,
) {
  const plan = readJsonRecord(fixture.paths.preparedPlanPath);
  const adjudication = plan.semanticAdjudication;
  assertRecord(adjudication);
  const decisions = adjudication.exactDecisions;
  assert.ok(Array.isArray(decisions));
  const decision = decisions.find((value) => {
    assertRecord(value);
    return predicate(value);
  });
  assert.ok(decision);
  assertRecord(decision);
  mutate(decision);
  writeJson(fixture.paths.preparedPlanPath, plan);
  return {
    ...fixture.policy,
    preparedPlanSha256: rawFileSha256(fixture.paths.preparedPlanPath),
  };
}

function describeTree(root: string, fields: number) {
  const files = readdirSync(path.join(root, "af"))
    .sort()
    .map((name) => {
      const file = path.join(root, "af", name);
      const bytes = readFileSync(file).byteLength;
      return {
        relativePath: `af/${name}`,
        bytes,
        sha256: rawFileSha256(file),
      };
    });
  return {
    path: root,
    files,
    fields,
    treeSha256: sha256CanonicalAfrikaansReconciliation(
      files.map((file) => [file.relativePath, file.bytes, file.sha256]),
    ),
  };
}

function makeField(input: {
  namespace: Namespace;
  sourceHash: string;
  key: string;
  source: string;
  currentValue: string;
}): Field {
  return {
    language: "Afrikaans",
    locale: "af",
    namespace: input.namespace,
    sourceHash: input.sourceHash,
    key: input.key,
    source: input.source,
    sourceSha256: sha256(input.source),
    currentValue: input.currentValue,
    currentValueSha256: sha256(input.currentValue),
  };
}

function scopeEntryForField(field: Field): ScopeEntry {
  return {
    language: field.language,
    locale: field.locale,
    namespace: field.namespace,
    sourceHash: field.sourceHash,
    key: field.key,
    source: field.source,
    existingCandidate: field.currentValue,
    reasons: ["forced-repair-scope"],
  };
}

function repairScopeFingerprint(entries: readonly ScopeEntry[]) {
  const rows = [...entries]
    .sort(
      (left, right) =>
        left.locale.localeCompare(right.locale) ||
        left.namespace.localeCompare(right.namespace) ||
        left.key.localeCompare(right.key) ||
        left.sourceHash.localeCompare(right.sourceHash) ||
        left.source.localeCompare(right.source) ||
        left.language.localeCompare(right.language) ||
        (left.existingCandidate ?? "").localeCompare(right.existingCandidate ?? ""),
    )
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
  return sha256(rows.length ? `${rows.join("\n")}\n` : "");
}

function decisionForField(field: Field): SemanticDecision {
  const member = {
    fieldIdentitySha256: sha256CanonicalAfrikaansReconciliation({
      schemaVersion: 1,
      kind: "afrikaans-semantic-field-identity-v1",
      field,
    }),
    namespace: field.namespace,
    sourceHash: field.sourceHash,
    key: field.key,
  };
  return {
    decisionIdentitySha256: sha256CanonicalAfrikaansReconciliation({
      schemaVersion: 1,
      kind: "afrikaans-semantic-decision-identity-v1",
      language: field.language,
      locale: field.locale,
      source: field.source,
      sourceSha256: field.sourceSha256,
      currentValue: field.currentValue,
      currentValueSha256: field.currentValueSha256,
      members: [member],
    }),
    language: "Afrikaans",
    locale: "af",
    source: field.source,
    sourceSha256: field.sourceSha256,
    currentValue: field.currentValue,
    currentValueSha256: field.currentValueSha256,
    fieldCount: 1,
    members: [member],
  };
}

function proposalForDecision(decision: SemanticDecision, proposedValue: string): Proposal {
  const proposedValueSha256 = sha256(proposedValue);
  return {
    ...decision,
    proposalIdentitySha256: sha256CanonicalAfrikaansReconciliation({
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

function createFixture(
  t: test.TestContext,
  options?: { invalidLockedValue?: boolean; invalidReviewerCompletedAtUtc?: string },
) {
  const repoRoot = realpathSync(process.cwd());
  const fixtureRoot = path.join(repoRoot, "tmp");
  mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(path.join(fixtureRoot, "inspir-af-reconciliation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "tmp"), { recursive: true, mode: 0o700 });

  const sourceHashes = { "main-app": sha256("main source"), "marketing-shell": sha256("marketing source") };
  const lockedMain = makeField({
    namespace: "main-app",
    sourceHash: sourceHashes["main-app"],
    key: "chat.save",
    source: "Save chat",
    currentValue: "Stoor gesprek",
  });
  const lockedMarketing = makeField({
    namespace: "marketing-shell",
    sourceHash: sourceHashes["marketing-shell"],
    key: "terms.read",
    source: "Read terms",
    currentValue: "Lees bepalings",
  });
  const unresolvedMain = makeField({
    namespace: "main-app",
    sourceHash: sourceHashes["main-app"],
    key: "learn.now",
    source: "Learn now",
    currentValue: "Leer nou",
  });
  const unresolvedMarketing = makeField({
    namespace: "marketing-shell",
    sourceHash: sourceHashes["marketing-shell"],
    key: "settings.open",
    source: "Open settings",
    currentValue: "Maak instellings oop",
  });
  const unresolvedResolved = makeField({
    namespace: "main-app",
    sourceHash: sourceHashes["main-app"],
    key: "lesson.review",
    source: "Review the lesson",
    currentValue: "Hersien les",
  });
  const exactDecisions = [
    {
      action: "preserve",
      evidence: "owner-lock:test",
      reviewPairIdentitySha256: sha256("pair-main"),
      reviewFieldIdentitySha256: sha256("field-main"),
      field: lockedMain,
      decidedValue: options?.invalidLockedValue ? lockedMain.source : lockedMain.currentValue,
      decidedValueSha256: sha256(options?.invalidLockedValue ? lockedMain.source : lockedMain.currentValue),
    },
    {
      action: "replace",
      evidence: "planner-added:source-trigram-repair",
      reviewPairIdentitySha256: null,
      reviewFieldIdentitySha256: null,
      field: lockedMarketing,
      decidedValue: "Lees die bepalings",
      decidedValueSha256: sha256("Lees die bepalings"),
    },
  ];
  if (options?.invalidLockedValue) {
    exactDecisions[0].action = "replace";
  }
  const unresolved = [
    { field: unresolvedMain, disposition: "requires-owner-semantic-adjudication" },
    { field: unresolvedMarketing, disposition: "requires-owner-semantic-adjudication" },
    { field: unresolvedResolved, disposition: "requires-owner-semantic-adjudication" },
  ];
  const exactDecisionRootSha256 = sha256CanonicalAfrikaansReconciliation(exactDecisions);
  const unresolvedSemanticRootSha256 = sha256CanonicalAfrikaansReconciliation(unresolved);
  const scopeEntries = [
    lockedMain,
    lockedMarketing,
    unresolvedMain,
    unresolvedMarketing,
    unresolvedResolved,
  ].map(scopeEntryForField);
  const scopeCanonicalSha256 = repairScopeFingerprint(scopeEntries);

  const paths: AfrikaansReconciliationAdapterPaths = {
    repoRoot,
    adapterImplementationPath: realpathSync(
      path.join(repoRoot, "scripts/afrikaans-reconciliation-apply-adapter.ts"),
    ),
    candidateValidatorImplementationPath: realpathSync(
      path.join(repoRoot, "scripts/validate-translation-repair-candidates.ts"),
    ),
    preparedPlanPath: path.join(root, "tmp/workbench/prepared-plan.json"),
    workbenchPath: path.join(root, "tmp/workbench/workbench.ts"),
    workbenchReadmePath: path.join(root, "tmp/workbench/README.md"),
    noModelGateEvidencePath: path.join(root, "tmp/workbench/no-model-gate-evidence.json"),
    scopePath: path.join(root, "tmp/scope.json"),
    worklistDir: path.join(root, "tmp/workbench/repair-worklists"),
    diagnosticManifestPath: path.join(root, "tmp/workbench/diagnostic-proposal-manifest.json"),
    diagnosticCandidateDir: path.join(root, "tmp/workbench/repair-candidates"),
    partitionLaneImplementationPath: path.join(root, "tmp/lane/lane.mjs"),
    reviewEvidenceSchemaPath: path.join(root, "tmp/lane/review-evidence.schema.json"),
    partitionPlanPath: path.join(root, "tmp/lane/partition-plan.json"),
    reviewBundlePath: path.join(root, "tmp/lane/review-bundle.json"),
    reviewerAEvidencePath: path.join(root, "tmp/lane/reviewer-a.json"),
    reviewerBEvidencePath: path.join(root, "tmp/lane/reviewer-b.json"),
    resolutionVerifierImplementationPath: realpathSync(
      path.join(repoRoot, "scripts/afrikaans-escalation-resolution-verifier.ts"),
    ),
    thirdValueProposalsPath: path.join(
      root,
      "tmp/lane/escalation-third-value-proposals.json",
    ),
    thirdValueReviewPath: path.join(
      root,
      "tmp/lane/escalation-third-value-review.json",
    ),
    reconciliationPath: path.join(root, "tmp/lane/reconciliation.json"),
  };
  mkdirSync(path.dirname(paths.workbenchPath), { recursive: true, mode: 0o700 });
  mkdirSync(path.dirname(paths.partitionLaneImplementationPath), { recursive: true, mode: 0o700 });
  writeFileSync(paths.workbenchPath, "export {};\n", { mode: 0o600 });
  writeFileSync(paths.workbenchReadmePath, "# frozen v3\n", { mode: 0o600 });
  writeFileSync(paths.partitionLaneImplementationPath, "export {};\n", { mode: 0o600 });
  writeJson(paths.reviewEvidenceSchemaPath, { schemaVersion: 1, kind: "test-review-schema" });
  writeJson(paths.scopePath, {
    schemaVersion: 1,
    kind: "translation-repair-scope",
    fields: scopeEntries.length,
    sourceHashes,
    entries: scopeEntries,
    canonicalSha256: scopeCanonicalSha256,
  });

  const reason = ["forced-repair-scope"];
  const worklistEntries = {
    "main-app": [lockedMain, unresolvedMain, unresolvedResolved].map((field) => ({
      key: field.key,
      source: field.source,
      existingCandidate: field.currentValue,
      reasons: reason,
      value: "",
    })),
    "marketing-shell": [lockedMarketing, unresolvedMarketing].map((field) => ({
      key: field.key,
      source: field.source,
      existingCandidate: field.currentValue,
      reasons: reason,
      value: "",
    })),
  };
  for (const namespace of ["main-app", "marketing-shell"] as const) {
    const base = {
      schemaVersion: 1,
      protectorVersion: "literal-protector-v2",
      protectorFingerprint: sha256("literal-protector-v2"),
      language: "Afrikaans",
      locale: "af",
      namespace,
      sourceHash: sourceHashes[namespace],
    };
    writeJson(path.join(paths.worklistDir, "af", `${namespace}.json`), {
      ...base,
      kind: "translation-repair-worklist",
      entries: worklistEntries[namespace],
    });
    const proposalValues =
      namespace === "main-app"
        ? [
            lockedMain.currentValue,
            "Leer asseblief nou",
            "Gaan die les na",
          ]
        : ["Lees die bepalings", "Open asseblief instellings"];
    writeJson(path.join(paths.diagnosticCandidateDir, "af", `${namespace}.json`), {
      ...base,
      kind: "translation-repair-candidate",
      entries: worklistEntries[namespace].map((entry, index) => ({ ...entry, value: proposalValues[index] })),
      draftModel: "diagnostic-test-model",
    });
  }
  const worklistDescriptor = describeTree(paths.worklistDir, 5);
  const diagnosticCandidateDescriptor = describeTree(paths.diagnosticCandidateDir, 5);
  const scopeFileSha256 = rawFileSha256(paths.scopePath);
  const workbenchSha256 = rawFileSha256(paths.workbenchPath);
  const workbenchReadmeSha256 = rawFileSha256(paths.workbenchReadmePath);
  const currentCatalogs = {
    mainAppFileSha256: sha256("main catalog"),
    marketingShellFileSha256: sha256("marketing catalog"),
  };
  const preparedPlan = {
    schemaVersion: 1,
    kind: "afrikaans-residual-repair-workbench-plan-v1",
    evidenceClassification: "diagnostic-proposal-evidence",
    releaseAttestation: false,
    trackedWritesPermitted: false,
    seedPolicy: "disabled",
    scope: { fileSha256: scopeFileSha256, canonicalSha256: scopeCanonicalSha256 },
    repairWorklists: {
      files: worklistDescriptor.files,
      treeSha256: worklistDescriptor.treeSha256,
      totalProposalFields: 5,
    },
    semanticAdjudication: {
      diagnosticOnly: true,
      ownerSemanticAdjudicationComplete: false,
      applyReady: false,
      releaseAttestation: false,
      currentCatalogs,
      exactDecisions,
      exactDecisionFields: 2,
      exactDecisionRootSha256,
      unresolvedFields: unresolved,
      unresolvedSemanticFields: 3,
      unresolvedSemanticRootSha256,
    },
    implementationBindings: {
      requiredExecutionPipelineVersion: "inspir-long-tail-local-nllb-v5",
      genericPipelineSha256: sha256("pipeline"),
      genericWorkerSha256: sha256("worker"),
      executionProfileSha256: sha256("profile"),
      executionProfileImplementationSha256: sha256("profile implementation"),
      validatorPolicySha256: sha256("validator"),
    },
    outputContract: { mayApplyTrackedChanges: false, mayClaimReleaseAttestation: false },
  };
  writeJson(paths.preparedPlanPath, preparedPlan);
  const preparedPlanSha256 = rawFileSha256(paths.preparedPlanPath);
  const noModelGate = {
    schemaVersion: 1,
    kind: "afrikaans-residual-repair-no-model-gate-evidence-v1",
    diagnosticOnly: true,
    modelLoaded: false,
    modelFilesRead: false,
    modelWorkerStarted: false,
    trackedWritesPerformed: false,
    releaseAttestation: false,
    planSha256: preparedPlanSha256,
    workbenchSha256,
    genericMasterWorklistSha256: sha256("generic master worklist"),
    genericFields: 3,
    distinctModelSourceLanguagePairs: 3,
  };
  writeJson(paths.noModelGateEvidencePath, noModelGate);
  const noModelGateEvidenceSha256 = rawFileSha256(paths.noModelGateEvidencePath);
  const policy: AfrikaansReconciliationFrozenPolicy = {
    adapterImplementationSha256: rawFileSha256(paths.adapterImplementationPath),
    candidateValidatorImplementationSha256: rawFileSha256(
      paths.candidateValidatorImplementationPath,
    ),
    preparedPlanSha256,
    workbenchSha256,
    workbenchReadmeSha256,
    noModelGateEvidenceSha256,
    scopeFileSha256,
    scopeCanonicalSha256,
    repairWorklistTreeSha256: worklistDescriptor.treeSha256,
    exactDecisionFields: 2,
    exactDecisionRootSha256,
    unresolvedFields: 3,
    unresolvedSemanticRootSha256,
    totalProposalFields: 5,
    semanticDecisions: 3,
    resolutionVerifierImplementationSha256: rawFileSha256(
      paths.resolutionVerifierImplementationPath,
    ),
    resolutionPartitionPlanSha256: "0".repeat(64),
    resolutionReviewBundleSha256: "0".repeat(64),
    resolutionReviewerAEvidenceSha256: "0".repeat(64),
    resolutionReviewerBEvidenceSha256: "0".repeat(64),
    resolutionFrozenPolicySha256: "0".repeat(64),
    resolutionValidatorPolicySha256:
      createLongTailValidatorPolicyProvenance(repoRoot).validatorPolicySha256,
    thirdValueProposalsSha256: "0".repeat(64),
    thirdValueReviewSha256: "0".repeat(64),
    escalationDecisionRootSha256: "0".repeat(64),
    thirdValueRootSha256: "0".repeat(64),
    resolvedEscalationDecisionRootSha256: "0".repeat(64),
    resolvedEscalationDecisions: 1,
    resolvedEscalationFields: 1,
  };
  const diagnosticManifest = {
    schemaVersion: 1,
    kind: "afrikaans-residual-repair-diagnostic-proposal-manifest-v1",
    evidenceClassification: "diagnostic-proposal-evidence",
    releaseAttestation: false,
    trackedWritesPerformed: false,
    ownerSemanticAdjudicationComplete: false,
    applyReady: false,
    planSha256: policy.preparedPlanSha256,
    scopeFileSha256: policy.scopeFileSha256,
    scopeCanonicalSha256: policy.scopeCanonicalSha256,
    repairWorklistTreeSha256: policy.repairWorklistTreeSha256,
    repairCandidateTreeSha256: diagnosticCandidateDescriptor.treeSha256,
    repairCandidateFields: 5,
    exactDecisionFields: 2,
    exactDecisionRootSha256,
    unresolvedSemanticFields: 3,
    unresolvedSemanticRootSha256,
    genericPipelineImplementationSha256: preparedPlan.implementationBindings.genericPipelineSha256,
    genericWorkerImplementationSha256: preparedPlan.implementationBindings.genericWorkerSha256,
    runtimeExecutionProfileSha256: preparedPlan.implementationBindings.executionProfileSha256,
    runtimeExecutionProfileImplementationSha256:
      preparedPlan.implementationBindings.executionProfileImplementationSha256,
    validatorPolicySha256: preparedPlan.implementationBindings.validatorPolicySha256,
  };
  writeJson(paths.diagnosticManifestPath, diagnosticManifest);

  const decisions = [
    decisionForField(unresolvedMain),
    decisionForField(unresolvedMarketing),
    decisionForField(unresolvedResolved),
  ].sort((a, b) => a.decisionIdentitySha256.localeCompare(b.decisionIdentitySha256));
  const decisionRootSha256 = sha256CanonicalAfrikaansReconciliation(decisions);
  const fieldIdentityRootSha256 = sha256CanonicalAfrikaansReconciliation(
    decisions.flatMap((decision) => decision.members.map((member) => member.fieldIdentitySha256)).sort(),
  );
  const partitionInputs: ReadonlyArray<
    readonly [ReviewerId, readonly SemanticDecision[]]
  > = [
    ["reviewer-a", decisions.slice(0, 2)],
    ["reviewer-b", decisions.slice(2)],
  ];
  const partitions = partitionInputs.map(([reviewerId, assigned]) => {
    const decisionIds = assigned.map((decision) => decision.decisionIdentitySha256);
    return {
      reviewerId,
      decisionCount: decisionIds.length,
      fieldCount: decisionIds.length,
      partitionRootSha256: sha256CanonicalAfrikaansReconciliation({
        schemaVersion: 1,
        kind: "afrikaans-semantic-reviewer-partition-v1",
        reviewerId,
        preparedPlanSha256,
        decisionRootSha256,
        decisionCount: decisionIds.length,
        fieldCount: decisionIds.length,
        decisionIds,
      }),
      decisionIds,
    };
  });
  const partitionPlan = {
    schemaVersion: 1,
    kind: "afrikaans-parallel-semantic-adjudication-plan-v1",
    diagnosticOnly: true,
    trackedWritesPermitted: false,
    promotePermitted: false,
    importPermitted: false,
    applyPermitted: false,
    releaseAttestation: false,
    inputBindings: {
      preparedPlanRelativePath: path.relative(paths.repoRoot, paths.preparedPlanPath),
      preparedPlanSha256,
      preparedPlanKind: "afrikaans-residual-repair-workbench-plan-v1",
      workbenchRelativePath: path.relative(paths.repoRoot, paths.workbenchPath),
      workbenchSha256,
      workbenchReadmeRelativePath: path.relative(paths.repoRoot, paths.workbenchReadmePath),
      workbenchReadmeSha256,
      noModelGateEvidenceRelativePath: path.relative(
        paths.repoRoot,
        paths.noModelGateEvidencePath,
      ),
      noModelGateEvidenceSha256,
      noModelGateEvidenceKind: "afrikaans-residual-repair-no-model-gate-evidence-v1",
      genericMasterWorklistSha256: noModelGate.genericMasterWorklistSha256,
      scopeCanonicalSha256,
      repairWorklistTreeSha256: worklistDescriptor.treeSha256,
      unresolvedSemanticRootSha256,
      currentCatalogs,
      preparedWorkBenchSha256: workbenchSha256,
      pipelineVersion: preparedPlan.implementationBindings.requiredExecutionPipelineVersion,
      executionProfileSha256: preparedPlan.implementationBindings.executionProfileSha256,
      executionProfileImplementationSha256:
        preparedPlan.implementationBindings.executionProfileImplementationSha256,
      pipelineImplementationSha256: preparedPlan.implementationBindings.genericPipelineSha256,
      workerImplementationSha256: preparedPlan.implementationBindings.genericWorkerSha256,
    },
    laneImplementationBindings: {
      laneImplementationSha256: rawFileSha256(paths.partitionLaneImplementationPath),
      reviewEvidenceSchemaSha256: rawFileSha256(paths.reviewEvidenceSchemaPath),
    },
    corpus: {
      fields: 3,
      decisions: 3,
      groupingKey: "sourceSha256",
      groupingInvariant: "Every member has byte-identical NFC source/currentValue and matching hashes.",
      duplicateSourceGroups: 0,
      fieldIdentityRootSha256,
      decisionRootSha256,
    },
    partitionAlgorithm: {
      id: "balanced-atomic-source-groups-v1",
      reviewerADecisionTarget: partitions[0].decisionCount,
      reviewerAFieldTarget: partitions[0].fieldCount,
      rule:
        "Choose the lexicographically smallest set of repeated-source decision IDs whose excess fields reach the reviewer-A target, then fill reviewer A with the lexicographically first singleton decision IDs; reviewer B is the exact complement.",
    },
    decisions,
    reviewers: partitions,
    evidenceContract: {
      schemaRelativePath: path.relative(paths.repoRoot, paths.reviewEvidenceSchemaPath),
      allowedVerdicts: ["accept-proposal", "preserve-current", "escalate"],
      exactOneEvidenceRowPerAssignedDecision: true,
      crossPartitionEvidencePermitted: false,
      escalationsPermitReconciliation: false,
    },
    reconciliationContract: {
      exactReviewBundleRequired: true,
      exactDiagnosticManifestRequired: true,
      completeDisjointCoverageRequired: true,
      ownerAcceptanceRequiredAfterReconciliation: true,
      trackedWritesPermitted: false,
      mayApplyTrackedChanges: false,
      mayPromote: false,
      mayImport: false,
      mayClaimReleaseAttestation: false,
      outputChannel: "stdout-only",
    },
  };
  writeJson(paths.partitionPlanPath, partitionPlan);
  const partitionPlanSha256 = rawFileSha256(paths.partitionPlanPath);
  const diagnosticManifestSha256 = rawFileSha256(paths.diagnosticManifestPath);

  const proposalByDecision = new Map(
    decisions.map((decision) => {
      const proposedValue =
        decision.source === unresolvedMain.source
          ? "Leer asseblief nou"
          : decision.source === unresolvedMarketing.source
            ? "Open asseblief instellings"
            : "Gaan die les na";
      return [decision.decisionIdentitySha256, proposalForDecision(decision, proposedValue)] as const;
    }),
  );
  const proposals = decisions.map((decision) => {
    const proposal = proposalByDecision.get(decision.decisionIdentitySha256);
    assert.ok(proposal);
    return proposal;
  });
  const proposalRootSha256 = sha256CanonicalAfrikaansReconciliation(proposals);
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
      diagnosticManifestSha256,
      diagnosticManifestKind: "afrikaans-residual-repair-diagnostic-proposal-manifest-v1",
      candidateTreeSha256: diagnosticCandidateDescriptor.treeSha256,
      proposalRootSha256,
    },
    proposalCount: 3,
    proposalFieldCount: 3,
    reviewers: partitions.map((partition) => {
      const partitionProposals = partition.decisionIds.map((decisionId) => {
        const proposal = proposalByDecision.get(decisionId);
        assert.ok(proposal);
        return proposal;
      });
      return {
        reviewerId: partition.reviewerId,
        partitionRootSha256: partition.partitionRootSha256,
        decisionCount: partition.decisionCount,
        fieldCount: partition.fieldCount,
        proposals: partitionProposals,
      };
    }),
    evidenceInstructions: {
      schemaRelativePath: "tmp/af-adjudication-parallel-plan-v1/review-evidence.schema.json",
      allowedVerdicts: ["accept-proposal", "preserve-current", "escalate"],
      escalationRule: "Use escalate when neither proposedValue nor currentValue is semantically proper.",
    },
  };
  writeJson(paths.reviewBundlePath, reviewBundle);
  const reviewBundleSha256 = rawFileSha256(paths.reviewBundlePath);
  const evidence = partitions.map((partition, index) => {
    const reviewDecisions = partition.decisionIds.map((decisionId) => {
      const proposal = proposalByDecision.get(decisionId);
      assert.ok(proposal);
      if (proposal.source === unresolvedResolved.source) {
        return {
          decisionIdentitySha256: proposal.decisionIdentitySha256,
          proposalIdentitySha256: proposal.proposalIdentitySha256,
          verdict: "escalate" as const,
          finalValue: null,
          finalValueSha256: null,
          rationale: "Neither bound value is sufficiently precise.",
        };
      }
      const acceptProposal = proposal.source === unresolvedMain.source;
      return {
        decisionIdentitySha256: proposal.decisionIdentitySha256,
        proposalIdentitySha256: proposal.proposalIdentitySha256,
        verdict: acceptProposal
          ? ("accept-proposal" as const)
          : ("preserve-current" as const),
        finalValue: acceptProposal ? proposal.proposedValue : proposal.currentValue,
        finalValueSha256: acceptProposal
          ? proposal.proposedValueSha256
          : proposal.currentValueSha256,
        rationale: acceptProposal
          ? "The proposal is idiomatic."
          : "The current value is idiomatic.",
      };
    });
    const acceptedProposals = reviewDecisions.filter(
      (decision) => decision.verdict === "accept-proposal",
    ).length;
    const preservedCurrentValues = reviewDecisions.filter(
      (decision) => decision.verdict === "preserve-current",
    ).length;
    const escalations = reviewDecisions.filter(
      (decision) => decision.verdict === "escalate",
    ).length;
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
        partitionPlanSha256,
        reviewBundleSha256,
        preparedPlanSha256,
        decisionRootSha256,
        partitionRootSha256: partition.partitionRootSha256,
        proposalRootSha256,
        candidateTreeSha256: diagnosticCandidateDescriptor.treeSha256,
      },
      reviewer: {
        reviewerId: partition.reviewerId,
        reviewerName: index === 0 ? "Reviewer Alpha" : "Reviewer Beta",
        completedAtUtc:
          index === 0 && options?.invalidReviewerCompletedAtUtc
            ? options.invalidReviewerCompletedAtUtc
            : `2026-07-15T00:00:0${index}Z`,
      },
      summary: {
        decisions: reviewDecisions.length,
        fields: reviewDecisions.length,
        acceptedProposals,
        preservedCurrentValues,
        escalations,
      },
      decisions: reviewDecisions,
    };
  });
  writeJson(paths.reviewerAEvidencePath, evidence[0]);
  writeJson(paths.reviewerBEvidencePath, evidence[1]);
  const reviewerEvidenceSha256 = [
    rawFileSha256(paths.reviewerAEvidencePath),
    rawFileSha256(paths.reviewerBEvidencePath),
  ] as const;
  const escalation = evidence
    .flatMap((review, reviewIndex) =>
      review.decisions
        .filter((decision) => decision.verdict === "escalate")
        .map((decision) => ({ review, reviewIndex, decision })),
    )
    .at(0);
  assert.ok(escalation);
  const escalationProposal = proposalByDecision.get(
    escalation.decision.decisionIdentitySha256,
  );
  assert.ok(escalationProposal);
  const resolutionPolicy: AfrikaansEscalationResolutionFrozenPolicy = {
    policyId: "afrikaans-escalation-resolution-frozen-v1",
    partitionPlanSha256,
    reviewBundleSha256,
    reviewerAEvidenceSha256: reviewerEvidenceSha256[0],
    reviewerBEvidenceSha256: reviewerEvidenceSha256[1],
  };
  const resolutionFrozenPolicySha256 =
    sha256CanonicalAfrikaansEscalationResolution(resolutionPolicy);
  const escalationDecisionRootSha256 =
    sha256CanonicalAfrikaansEscalationResolution([
      escalationProposal.decisionIdentitySha256,
    ]);
  const thirdValue = "Hersien die les deeglik";
  const thirdValueSha256 =
    sha256TextAfrikaansEscalationResolution(thirdValue);
  const resolutionInputBindings = {
    verifierImplementationSha256: rawFileSha256(
      paths.resolutionVerifierImplementationPath,
    ),
    frozenPolicySha256: resolutionFrozenPolicySha256,
    validatorPolicySha256:
      createLongTailValidatorPolicyProvenance(repoRoot).validatorPolicySha256,
    partitionPlanSha256,
    reviewBundleSha256,
    reviewerAEvidenceSha256: reviewerEvidenceSha256[0],
    reviewerBEvidenceSha256: reviewerEvidenceSha256[1],
    decisionRootSha256,
    proposalRootSha256,
    candidateTreeSha256: diagnosticCandidateDescriptor.treeSha256,
    escalationDecisionRootSha256,
  };
  const thirdValueRootSha256 =
    sha256CanonicalAfrikaansEscalationResolution([
      {
        decisionIdentitySha256: escalationProposal.decisionIdentitySha256,
        proposalIdentitySha256: escalationProposal.proposalIdentitySha256,
        thirdValue,
        thirdValueSha256,
      },
    ]);
  const safety = {
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
  } as const;
  const thirdValueProposals = {
    schemaVersion: 1,
    kind: "afrikaans-escalation-third-value-proposals-v1",
    ...safety,
    inputBindings: resolutionInputBindings,
    author: {
      authorName: "Resolution Author",
      identityAssurance: "trusted-local-assertion",
      authoredAtUtc: "2026-07-15T00:00:30.000Z",
    },
    summary: {
      decisions: 1,
      fields: 1,
      escalationDecisionRootSha256,
      thirdValueRootSha256,
    },
    proposals: [
      {
        originalReviewerId: escalation.review.reviewer.reviewerId,
        decisionIdentitySha256: escalationProposal.decisionIdentitySha256,
        proposalIdentitySha256: escalationProposal.proposalIdentitySha256,
        sourceSha256: escalationProposal.sourceSha256,
        currentValueSha256: escalationProposal.currentValueSha256,
        proposedValueSha256: escalationProposal.proposedValueSha256,
        fieldCount: escalationProposal.fieldCount,
        members: escalationProposal.members,
        thirdValue,
        thirdValueSha256,
        rationale: "The third value is precise, grammatical Afrikaans.",
      },
    ],
  };
  writeJson(paths.thirdValueProposalsPath, thirdValueProposals);
  const thirdValueProposalsSha256 = rawFileSha256(
    paths.thirdValueProposalsPath,
  );
  const thirdValueReview = {
    schemaVersion: 1,
    kind: "afrikaans-escalation-third-value-review-v1",
    ...safety,
    inputBindings: {
      ...resolutionInputBindings,
      thirdValueProposalsSha256,
      thirdValueRootSha256,
    },
    reviewer: {
      reviewerName: "Resolution Reviewer",
      identityAssurance: "trusted-local-assertion",
      completedAtUtc: "2026-07-15T00:01:00.000Z",
    },
    summary: {
      decisions: 1,
      fields: 1,
      approvedThirdValues: 1,
      rejectedThirdValues: 0,
      escalatedAgain: 0,
    },
    decisions: [
      {
        originalReviewerId: escalation.review.reviewer.reviewerId,
        decisionIdentitySha256: escalationProposal.decisionIdentitySha256,
        proposalIdentitySha256: escalationProposal.proposalIdentitySha256,
        sourceSha256: escalationProposal.sourceSha256,
        fieldCount: escalationProposal.fieldCount,
        members: escalationProposal.members,
        thirdValueSha256,
        verdict: "approve-third-value",
        rationale: "The third value is accurate and idiomatic.",
      },
    ],
  };
  writeJson(paths.thirdValueReviewPath, thirdValueReview);
  const thirdValueReviewSha256 = rawFileSha256(paths.thirdValueReviewPath);
  const resolutionVerification = verifyAfrikaansEscalationResolution({
    paths: {
      partitionPlanPath: paths.partitionPlanPath,
      reviewBundlePath: paths.reviewBundlePath,
      reviewerAEvidencePath: paths.reviewerAEvidencePath,
      reviewerBEvidencePath: paths.reviewerBEvidencePath,
      thirdValueProposalsPath: paths.thirdValueProposalsPath,
      thirdValueReviewPath: paths.thirdValueReviewPath,
    },
    policy: resolutionPolicy,
    trustedInputRoot: repoRoot,
    nowEpochMs: verificationNowEpochMs,
  });
  const finalPolicy: AfrikaansReconciliationFrozenPolicy = {
    ...policy,
    resolutionPartitionPlanSha256: partitionPlanSha256,
    resolutionReviewBundleSha256: reviewBundleSha256,
    resolutionReviewerAEvidenceSha256: reviewerEvidenceSha256[0],
    resolutionReviewerBEvidenceSha256: reviewerEvidenceSha256[1],
    resolutionFrozenPolicySha256,
    thirdValueProposalsSha256,
    thirdValueReviewSha256,
    escalationDecisionRootSha256,
    thirdValueRootSha256,
    resolvedEscalationDecisionRootSha256:
      resolutionVerification.resolvedDecisionRootSha256,
  };
  const resolvedById = new Map(
    resolutionVerification.resolvedDecisions.map((decision) => [
      decision.decisionIdentitySha256,
      decision,
    ]),
  );
  const reconciled = evidence
    .flatMap((review, index) => {
      const proposalIndex = new Map(
        reviewBundle.reviewers[index].proposals.map((proposal) => [
          proposal.decisionIdentitySha256,
          proposal,
        ]),
      );
      return review.decisions.map((row) => {
        const proposal = proposalIndex.get(row.decisionIdentitySha256);
        assert.ok(proposal);
        const resolved = resolvedById.get(row.decisionIdentitySha256);
        const isEscalation = row.verdict === "escalate";
        if (isEscalation) assert.ok(resolved);
        return {
          decisionIdentitySha256: row.decisionIdentitySha256,
          proposalIdentitySha256: row.proposalIdentitySha256,
          originalReviewerId: review.reviewer.reviewerId,
          originalVerdict: row.verdict,
          authority: isEscalation
            ? "approved-third-value-resolution"
            : "original-review-evidence",
          finalValue: isEscalation ? resolved?.finalValue : row.finalValue,
          finalValueSha256: isEscalation
            ? resolved?.finalValueSha256
            : row.finalValueSha256,
          fieldCount: proposal.fieldCount,
          members: proposal.members,
          originalRationale: row.rationale,
        };
      });
    })
    .sort((a, b) => a.decisionIdentitySha256.localeCompare(b.decisionIdentitySha256));
  const reconciliation = {
    schemaVersion: 2,
    kind: "afrikaans-semantic-review-reconciliation-v2",
    evidenceClassification: "diagnostic-semantic-review-and-resolution-evidence",
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
      partitionPlanSha256,
      reviewBundleSha256,
      preparedPlanSha256,
      decisionRootSha256,
      proposalRootSha256,
      diagnosticManifestSha256,
      candidateTreeSha256: diagnosticCandidateDescriptor.treeSha256,
      resolutionVerifierImplementationSha256:
        resolutionVerification.inputBindings.verifierImplementationSha256,
      resolutionFrozenPolicySha256:
        resolutionVerification.inputBindings.frozenPolicySha256,
      resolutionValidatorPolicySha256:
        resolutionVerification.inputBindings.validatorPolicySha256,
      thirdValueProposalsSha256:
        resolutionVerification.inputBindings.thirdValueProposalsSha256,
      thirdValueReviewSha256:
        resolutionVerification.inputBindings.thirdValueReviewSha256,
      escalationDecisionRootSha256:
        resolutionVerification.inputBindings.escalationDecisionRootSha256,
      thirdValueRootSha256:
        resolutionVerification.inputBindings.thirdValueRootSha256,
      resolvedEscalationDecisionRootSha256:
        resolutionVerification.resolvedDecisionRootSha256,
    },
    reviewers: evidence.map((review, index) => ({
      reviewerId: review.reviewer.reviewerId,
      evidenceSha256: reviewerEvidenceSha256[index],
      reviewerName: review.reviewer.reviewerName,
      completedAtUtc: review.reviewer.completedAtUtc,
      decisionCount: review.decisions.length,
      partitionRootSha256: partitions[index].partitionRootSha256,
    })),
    resolution: {
      verificationKind: resolutionVerification.kind,
      diagnosticOnly: true,
      identityClaimsVerified: false,
      applyReady: false,
      outputChannel: "stdout-only",
      proposalAuthorName: thirdValueProposals.author.authorName,
      proposalAuthoredAtUtc: thirdValueProposals.author.authoredAtUtc,
      reviewerName: thirdValueReview.reviewer.reviewerName,
      reviewedAtUtc: thirdValueReview.reviewer.completedAtUtc,
      decisions: resolutionVerification.summary.decisions,
      fields: resolutionVerification.summary.fields,
      resolvedDecisionRootSha256:
        resolutionVerification.resolvedDecisionRootSha256,
    },
    summary: {
      decisions: 3,
      fields: 3,
      acceptedProposals: 1,
      preservedCurrentValues: 1,
      resolvedEscalations: 1,
      unresolvedEscalations: 0,
    },
    reconciledDecisionRootSha256: sha256CanonicalAfrikaansReconciliation(reconciled),
    decisions: reconciled,
  };
  writeJson(paths.reconciliationPath, reconciliation);
  return {
    root,
    paths,
    policy: finalPolicy,
    resolutionPolicy,
    resolutionVerification,
    diagnosticManifest,
    worklistDescriptor,
    diagnosticCandidateDescriptor,
    partitionPlanSha256,
    reviewBundleSha256,
    reviewerEvidenceSha256,
    reconciliation,
  };
}

function writeOwnerAcceptance(
  fixture: Fixture,
  overrides?: {
    finalValueRootSha256?: string;
    acceptedAtUtc?: string;
    ownerName?: string;
  },
) {
  const verification = __testOnlyAfrikaansReconciliationAdapter.verify({
    paths: fixture.paths,
    policy: fixture.policy,
  });
  const acceptancePath = path.join(fixture.root, "tmp/owner-acceptance.json");
  const core = {
    schemaVersion: 2,
    kind: "afrikaans-reconciliation-owner-acceptance-v2",
    trustModel: "trusted-single-user-local-workspace",
    authentication: "none",
    attestationKind: "procedural-self-attestation",
    authorityScope: "ignored-materialization-only",
    cryptographicIdentityVerified: false,
    ownerName: overrides?.ownerName ?? "Translation Owner",
    acceptedAtUtc: overrides?.acceptedAtUtc ?? "2026-07-15T00:01:30Z",
    authority: {
      materializeValidatorBackedCandidates: true,
      applyTrackedTranslations: false,
      promoteCandidates: false,
      importCandidates: false,
      releaseAttestation: false,
    },
    bindings: {
      ...verification.ownerAcceptanceRequest.bindings,
      finalValueRootSha256: overrides?.finalValueRootSha256 ?? verification.finalValueRootSha256,
    },
  };
  writeJson(acceptancePath, {
    ...core,
    canonicalSha256: sha256CanonicalAfrikaansReconciliation(core),
  });
  return acceptancePath;
}

test("default live paths use the frozen lane's documented reviewer evidence filenames", () => {
  const paths = defaultAfrikaansReconciliationAdapterPaths(process.cwd());
  assert.equal(
    rawFileSha256(paths.adapterImplementationPath),
    AFRIKAANS_RECONCILIATION_FROZEN_V3_POLICY.adapterImplementationSha256,
  );
  assert.equal(
    rawFileSha256(paths.candidateValidatorImplementationPath),
    AFRIKAANS_RECONCILIATION_FROZEN_V3_POLICY.candidateValidatorImplementationSha256,
  );
  assert.equal(path.basename(paths.reviewerAEvidencePath), "reviewer-a-evidence.json");
  assert.equal(path.basename(paths.reviewerBEvidencePath), "reviewer-b-evidence.json");
  assert.equal(
    path.basename(paths.thirdValueProposalsPath),
    "escalation-third-value-proposals.json",
  );
  assert.equal(
    path.basename(paths.thirdValueReviewPath),
    "escalation-third-value-review.json",
  );
});

test("reviewed candidate QA exception rejects drift in every frozen evidence binding", async (t) => {
  const frozen =
    __testOnlyAfrikaansReconciliationAdapter.reviewedCandidateQaExceptionBinding;
  assert.equal(
    __testOnlyAfrikaansReconciliationAdapter.validateReviewedCandidateQaExceptionBinding(
      frozen,
    ),
    frozen,
  );
  const mutations: ReadonlyArray<
    readonly [string, (value: Record<string, unknown>) => void]
  > = [
    ["kind", (value) => { value.kind = "wrong-kind"; }],
    ["language", (value) => { value.language = "Spanish"; }],
    ["locale", (value) => { value.locale = "en"; }],
    ["namespace", (value) => { value.namespace = "marketing-shell"; }],
    ["sourceHash", (value) => { value.sourceHash = "0".repeat(64); }],
    ["key", (value) => { value.key = "topic.other.name"; }],
    ["sourceSha256", (value) => { value.sourceSha256 = "1".repeat(64); }],
    ["valueSha256", (value) => { value.valueSha256 = "2".repeat(64); }],
    ["decisionIdentitySha256", (value) => { value.decisionIdentitySha256 = "3".repeat(64); }],
    ["proposalIdentitySha256", (value) => { value.proposalIdentitySha256 = "4".repeat(64); }],
    ["fieldIdentitySha256", (value) => { value.fieldIdentitySha256 = "5".repeat(64); }],
    ["reviewerId", (value) => { value.reviewerId = "reviewer-b"; }],
    ["authority", (value) => { value.authority = "approved-third-value-resolution"; }],
    ["verdict", (value) => { value.verdict = "accept-proposal"; }],
    ["different failure", (value) => { value.failures = ["source-equality"]; }],
    ["extra failure", (value) => {
      value.failures = ["protected-literal-parity", "source-equality"];
    }],
    ["extra key", (value) => { value.unexpected = true; }],
  ];
  for (const [label, mutate] of mutations) {
    await t.test(label, () => {
      const candidate: Record<string, unknown> = {
        ...frozen,
        failures: [...frozen.failures],
      };
      mutate(candidate);
      assert.throws(() =>
        __testOnlyAfrikaansReconciliationAdapter.validateReviewedCandidateQaExceptionBinding(
          candidate,
        ),
      );
    });
  }
});

test("repair scope rejects tampered embedded hashes, payloads, and extra keys", async (t) => {
  await t.test("embedded canonical hash", (subtest) => {
    const fixture = createFixture(subtest);
    const scope = readJsonRecord(fixture.paths.scopePath);
    scope.canonicalSha256 = "f".repeat(64);
    writeJson(fixture.paths.scopePath, scope);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: {
            ...fixture.policy,
            scopeFileSha256: rawFileSha256(fixture.paths.scopePath),
          },
        }),
      /embedded canonical SHA-256 drifted from frozen v3/u,
    );
  });

  await t.test("fingerprinted payload", (subtest) => {
    const fixture = createFixture(subtest);
    const scope = readJsonRecord(fixture.paths.scopePath);
    assert.ok(Array.isArray(scope.entries));
    const entry = scope.entries[0];
    assertRecord(entry);
    entry.source = `${String(entry.source)} tampered`;
    writeJson(fixture.paths.scopePath, scope);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: {
            ...fixture.policy,
            scopeFileSha256: rawFileSha256(fixture.paths.scopePath),
          },
        }),
      /canonical fingerprint is stale or tampered/u,
    );
  });

  await t.test("extra root key", (subtest) => {
    const fixture = createFixture(subtest);
    const scope = readJsonRecord(fixture.paths.scopePath);
    scope.unexpectedAuthority = true;
    writeJson(fixture.paths.scopePath, scope);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: {
            ...fixture.policy,
            scopeFileSha256: rawFileSha256(fixture.paths.scopePath),
          },
        }),
      /Repair scope root contract is invalid/u,
    );
  });
});

test("prepared decisions preserve the legitimate planner-null identity class", (t) => {
  const fixture = createFixture(t);
  const plan = readJsonRecord(fixture.paths.preparedPlanPath);
  const adjudication = plan.semanticAdjudication;
  assertRecord(adjudication);
  const decisions = adjudication.exactDecisions;
  assert.ok(Array.isArray(decisions));
  const plannerDecision = decisions.find((value) => {
    assertRecord(value);
    return value.evidence === "planner-added:source-trigram-repair";
  });
  assert.ok(plannerDecision);
  assertRecord(plannerDecision);
  assert.equal(plannerDecision.action, "replace");
  assert.equal(plannerDecision.reviewPairIdentitySha256, null);
  assert.equal(plannerDecision.reviewFieldIdentitySha256, null);
  assert.equal(
    __testOnlyAfrikaansReconciliationAdapter.verify({
      paths: fixture.paths,
      policy: fixture.policy,
    }).lockedFields,
    2,
  );
});

test("prepared decision review identities reject null mismatches and schema drift", async (t) => {
  await t.test("one-null mismatch", (subtest) => {
    const fixture = createFixture(subtest);
    const policy = mutatePreparedExactDecision(
      fixture,
      (decision) => decision.evidence === "planner-added:source-trigram-repair",
      (decision) => {
        decision.reviewPairIdentitySha256 = sha256("invented-review-pair");
      },
    );
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy,
        }),
      /must keep both review identity hashes or neither/u,
    );
  });

  await t.test("unexpected null on review-backed decision", (subtest) => {
    const fixture = createFixture(subtest);
    const policy = mutatePreparedExactDecision(
      fixture,
      (decision) => decision.evidence !== "planner-added:source-trigram-repair",
      (decision) => {
        decision.reviewPairIdentitySha256 = null;
        decision.reviewFieldIdentitySha256 = null;
      },
    );
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy,
        }),
      /Review-backed exact decisions require both review identity hashes/u,
    );
  });

  await t.test("omitted review identity", (subtest) => {
    const fixture = createFixture(subtest);
    const policy = mutatePreparedExactDecision(
      fixture,
      () => true,
      (decision) => {
        delete decision.reviewPairIdentitySha256;
      },
    );
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy,
        }),
      /reviewPairIdentitySha256/u,
    );
  });

  await t.test("extra decision key", (subtest) => {
    const fixture = createFixture(subtest);
    const policy = mutatePreparedExactDecision(
      fixture,
      () => true,
      (decision) => {
        decision.unexpectedReviewAuthority = "invented";
      },
    );
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy,
        }),
      /Unrecognized key/u,
    );
  });
});

test("CLI rejects unknown authority flags, duplicates, and execute-only arguments", () => {
  for (const flag of [
    "--promote",
    "--apply",
    "--import",
    "--release",
    "--release-attestation",
  ]) {
    assert.throws(
      () => parseAfrikaansReconciliationAdapterCli([flag, "true"]),
      /Unknown adapter flag/u,
    );
  }
  assert.throws(
    () =>
      parseAfrikaansReconciliationAdapterCli([
        "--reviewer-a=first.json",
        "--reviewer-a=second.json",
      ]),
    /Duplicate adapter flag/u,
  );
  assert.throws(
    () => parseAfrikaansReconciliationAdapterCli(["--execute", "--execute"]),
    /Duplicate adapter flag/u,
  );
  assert.throws(
    () => parseAfrikaansReconciliationAdapterCli(["--owner-acceptance=owner.json"]),
    /Execute-only adapter flags require --execute/u,
  );
  const readOnly = parseAfrikaansReconciliationAdapterCli([
    "--resolution-proposals=proposals.json",
    "--resolution-review=review.json",
  ]);
  assert.equal(readOnly.execute, false);
  assert.equal(
    readOnly.paths.thirdValueProposalsPath,
    path.resolve("proposals.json"),
  );
  assert.equal(readOnly.paths.thirdValueReviewPath, path.resolve("review.json"));
});

test("verifies exact locked + reconciled values without writing outputs", (t) => {
  const fixture = createFixture(t);
  const before = readdirSync(path.join(fixture.root, "tmp")).sort();
  const result = __testOnlyAfrikaansReconciliationAdapter.verify({
    paths: fixture.paths,
    policy: fixture.policy,
  });
  assert.equal(result.files, 2);
  assert.equal(result.fields, 5);
  assert.equal(result.lockedFields, 2);
  assert.equal(result.reconciledFields, 3);
  assert.equal(result.reviewerReconciledFields, 2);
  assert.equal(result.resolvedEscalationFields, 1);
  assert.equal(result.replacedFields, 3);
  const resolvedEntry = result.candidates
    .flatMap((candidate) => candidate.entries)
    .find((entry) => entry.key === "lesson.review");
  assert.equal(resolvedEntry?.value, "Hersien die les deeglik");
  assert.equal(
    result.ownerAcceptanceRequest.bindings.resolvedEscalationDecisionRootSha256,
    fixture.resolutionVerification.resolvedDecisionRootSha256,
  );
  assert.equal(result.ownerAcceptanceRequest.trustModel, "trusted-single-user-local-workspace");
  assert.equal(result.ownerAcceptanceRequest.authentication, "none");
  assert.equal(result.ownerAcceptanceRequest.attestationKind, "procedural-self-attestation");
  assert.equal(result.ownerAcceptanceRequest.authorityScope, "ignored-materialization-only");
  assert.equal(result.ownerAcceptanceRequest.cryptographicIdentityVerified, false);
  assert.deepEqual(readdirSync(path.join(fixture.root, "tmp")).sort(), before);
});

test("materialization remains a no-op without the explicit execute boundary", (t) => {
  const fixture = createFixture(t);
  const outputCandidateDir = path.join(fixture.root, "tmp/not-created-candidates");
  const manifestPath = path.join(fixture.root, "tmp/not-created-manifest.json");
  assert.throws(
    () =>
      __testOnlyAfrikaansReconciliationAdapter.materialize({
        paths: fixture.paths,
        policy: fixture.policy,
        execute: false,
        ownerAcceptancePath: path.join(fixture.root, "tmp/not-read-owner-acceptance.json"),
        outputCandidateDir,
        manifestPath,
      }),
    /explicit execute boundary/u,
  );
  assert.equal(readdirSync(path.join(fixture.root, "tmp")).includes("not-created-candidates"), false);
  assert.equal(readdirSync(path.join(fixture.root, "tmp")).includes("not-created-manifest.json"), false);
});

test("rejects diagnostic applyReady as authority", (t) => {
  const fixture = createFixture(t);
  writeJson(fixture.paths.diagnosticManifestPath, {
    ...fixture.diagnosticManifest,
    applyReady: true,
  });
  assert.throws(
    () =>
      __testOnlyAfrikaansReconciliationAdapter.verify({
        paths: fixture.paths,
        policy: fixture.policy,
      }),
    /not fail closed/u,
  );
});

test("rejects omissions and escalations in reviewer evidence", async (t) => {
  await t.test("omission", (subtest) => {
    const fixture = createFixture(subtest);
    const evidence = readJsonRecord(fixture.paths.reviewerAEvidencePath);
    evidence.decisions = [];
    writeJson(fixture.paths.reviewerAEvidencePath, evidence);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: fixture.policy,
        }),
      /omits, duplicates, or reorders/u,
    );
  });
  await t.test("escalation", (subtest) => {
    const fixture = createFixture(subtest);
    const evidence = readJsonRecord(fixture.paths.reviewerAEvidencePath);
    const decisions = evidence.decisions;
    const summary = evidence.summary;
    assert.ok(Array.isArray(decisions));
    assertRecord(summary);
    const row = decisions.find((decision) => {
      assertRecord(decision);
      return decision.verdict !== "escalate";
    });
    assert.ok(row);
    assertRecord(row);
    const previousVerdict = row.verdict;
    row.verdict = "escalate";
    row.finalValue = null;
    row.finalValueSha256 = null;
    if (previousVerdict === "accept-proposal") {
      summary.acceptedProposals = Number(summary.acceptedProposals) - 1;
    } else {
      summary.preservedCurrentValues = Number(summary.preservedCurrentValues) - 1;
    }
    summary.escalations = Number(summary.escalations) + 1;
    writeJson(fixture.paths.reviewerAEvidencePath, evidence);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: fixture.policy,
        }),
      /SHA-256 drifted|resolution/u,
    );
  });
});

test("consumes only the exact independently approved escalation resolution", async (t) => {
  await t.test("rejected third value fails closed", (subtest) => {
    const fixture = createFixture(subtest);
    const review = readJsonRecord(fixture.paths.thirdValueReviewPath);
    assert.ok(Array.isArray(review.decisions));
    const decision = review.decisions[0];
    assertRecord(decision);
    decision.verdict = "reject-third-value";
    const summary = review.summary;
    assertRecord(summary);
    summary.approvedThirdValues = 0;
    summary.rejectedThirdValues = 1;
    writeJson(fixture.paths.thirdValueReviewPath, review);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: {
            ...fixture.policy,
            thirdValueReviewSha256: rawFileSha256(
              fixture.paths.thirdValueReviewPath,
            ),
          },
        }),
      /fails closed/u,
    );
  });

  await t.test("resolution cannot be laundered onto a non-escalated decision", (subtest) => {
    const fixture = createFixture(subtest);
    const review = readJsonRecord(fixture.paths.thirdValueReviewPath);
    const reconciliation = fixture.reconciliation;
    const originalRows = reconciliation.decisions;
    assert.ok(Array.isArray(originalRows));
    const nonEscalated = originalRows.find((row) => {
      assertRecord(row);
      return row.originalVerdict !== "escalate";
    });
    assert.ok(nonEscalated);
    assertRecord(nonEscalated);
    assert.ok(Array.isArray(review.decisions));
    const resolutionRow = review.decisions[0];
    assertRecord(resolutionRow);
    resolutionRow.decisionIdentitySha256 = nonEscalated.decisionIdentitySha256;
    writeJson(fixture.paths.thirdValueReviewPath, review);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: {
            ...fixture.policy,
            thirdValueReviewSha256: rawFileSha256(
              fixture.paths.thirdValueReviewPath,
            ),
          },
        }),
      /omits, duplicates, adds, or reorders|identity drifted/u,
    );
  });

  await t.test("adapter policy root drift is rejected after verifier success", (subtest) => {
    const fixture = createFixture(subtest);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: {
            ...fixture.policy,
            thirdValueRootSha256: sha256("wrong third-value root"),
          },
        }),
      /inputs, roots, or counts drifted/u,
    );
  });
});

test("strict reconciliation parsing rejects duplicate keys", (t) => {
  const fixture = createFixture(t);
  const bytes = readFileSync(fixture.paths.reconciliationPath, "utf8");
  writeFileSync(
    fixture.paths.reconciliationPath,
    bytes.replace(
      '"schemaVersion": 2,',
      '"schemaVersion": 1,\n  "schemaVersion": 2,',
    ),
    { mode: 0o600 },
  );
  assert.throws(
    () =>
      __testOnlyAfrikaansReconciliationAdapter.verify({
        paths: fixture.paths,
        policy: fixture.policy,
      }),
    /duplicate JSON key/u,
  );
});

test("rejects stale reconciliation and validator-invalid final values", async (t) => {
  await t.test("stale reconciliation", (subtest) => {
    const fixture = createFixture(subtest);
    const reconciliation = readJsonRecord(fixture.paths.reconciliationPath);
    reconciliation.reconciledDecisionRootSha256 = sha256("stale reconciliation");
    writeJson(fixture.paths.reconciliationPath, reconciliation);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: fixture.policy,
        }),
      /stale or is not the exact/u,
    );
  });
  await t.test("duplicate reconciled decision", (subtest) => {
    const fixture = createFixture(subtest);
    const reconciliation = readJsonRecord(fixture.paths.reconciliationPath);
    const decisions = reconciliation.decisions;
    assert.ok(Array.isArray(decisions));
    reconciliation.decisions = [decisions[0], decisions[0]];
    reconciliation.reconciledDecisionRootSha256 =
      sha256CanonicalAfrikaansReconciliation(reconciliation.decisions);
    writeJson(fixture.paths.reconciliationPath, reconciliation);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: fixture.policy,
        }),
      /stale or is not the exact/u,
    );
  });
  await t.test("invalid final value", (subtest) => {
    const fixture = createFixture(subtest, { invalidLockedValue: true });
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: fixture.policy,
        }),
      /Unvalidated final value/u,
    );
  });
});

test("rejects extra empty directories in every exact AF tree", async (t) => {
  await t.test("worklist tree", (subtest) => {
    const fixture = createFixture(subtest);
    mkdirSync(path.join(fixture.paths.worklistDir, "empty-extra"));
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: fixture.policy,
        }),
      /exact root\/af directory shape/u,
    );
  });
  await t.test("diagnostic candidate tree", (subtest) => {
    const fixture = createFixture(subtest);
    mkdirSync(path.join(fixture.paths.diagnosticCandidateDir, "empty-extra"));
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: fixture.policy,
        }),
      /exact root\/af directory shape/u,
    );
  });
  await t.test("materialized candidate tree", (subtest) => {
    const fixture = createFixture(subtest);
    const acceptance = writeOwnerAcceptance(fixture);
    const outputCandidateDir = path.join(fixture.root, "tmp/final-candidates");
    const manifestPath = path.join(fixture.root, "tmp/final-manifest.json");
    __testOnlyAfrikaansReconciliationAdapter.materialize({
      paths: fixture.paths,
      policy: fixture.policy,
      nowEpochMs: verificationNowEpochMs,
      execute: true,
      ownerAcceptancePath: acceptance,
      outputCandidateDir,
      manifestPath,
    });
    mkdirSync(path.join(outputCandidateDir, "empty-extra"));
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.validateManifest({
          worklistDir: fixture.paths.worklistDir,
          candidateDir: outputCandidateDir,
          manifestPath,
          policy: fixture.policy,
          nowEpochMs: verificationNowEpochMs,
        }),
      /exact root\/af directory shape/u,
    );
  });
});

test("requires exact owner acceptance, materializes only candidates, and revalidates manifest", (t) => {
  const fixture = createFixture(t);
  const nonCausalAcceptance = writeOwnerAcceptance(fixture, {
    acceptedAtUtc: "2026-07-15T00:00:01Z",
  });
  assert.throws(
    () =>
      __testOnlyAfrikaansReconciliationAdapter.materialize({
        paths: fixture.paths,
        policy: fixture.policy,
        nowEpochMs: verificationNowEpochMs,
        execute: true,
        ownerAcceptancePath: nonCausalAcceptance,
        outputCandidateDir: path.join(fixture.root, "tmp/noncausal-candidates"),
        manifestPath: path.join(fixture.root, "tmp/noncausal-manifest.json"),
      }),
    /causally later/u,
  );
  rmSync(nonCausalAcceptance);
  const futureAcceptance = writeOwnerAcceptance(fixture, {
    acceptedAtUtc: "2026-07-15T00:03:00Z",
  });
  assert.throws(
    () =>
      __testOnlyAfrikaansReconciliationAdapter.materialize({
        paths: fixture.paths,
        policy: fixture.policy,
        nowEpochMs: verificationNowEpochMs,
        execute: true,
        ownerAcceptancePath: futureAcceptance,
        outputCandidateDir: path.join(fixture.root, "tmp/future-candidates"),
        manifestPath: path.join(fixture.root, "tmp/future-manifest.json"),
      }),
    /future-dated/u,
  );
  rmSync(futureAcceptance);
  const staleAcceptance = writeOwnerAcceptance(fixture, { finalValueRootSha256: sha256("stale") });
  assert.throws(
    () =>
      __testOnlyAfrikaansReconciliationAdapter.materialize({
        paths: fixture.paths,
        policy: fixture.policy,
        nowEpochMs: verificationNowEpochMs,
        execute: true,
        ownerAcceptancePath: staleAcceptance,
        outputCandidateDir: path.join(fixture.root, "tmp/stale-candidates"),
        manifestPath: path.join(fixture.root, "tmp/stale-manifest.json"),
      }),
    /Owner acceptance is stale/u,
  );
  rmSync(staleAcceptance);
  const acceptance = writeOwnerAcceptance(fixture);
  const outputCandidateDir = path.join(fixture.root, "tmp/final-candidates");
  const manifestPath = path.join(fixture.root, "tmp/final-manifest.json");
  const result = __testOnlyAfrikaansReconciliationAdapter.materialize({
    paths: fixture.paths,
    policy: fixture.policy,
    nowEpochMs: verificationNowEpochMs,
    execute: true,
    ownerAcceptancePath: acceptance,
    outputCandidateDir,
    manifestPath,
  });
  assert.equal(result.fields, 5);
  assert.equal(result.files, 2);
  assert.equal(result.draftModel, "afrikaans-owner-reconciled-v2");
  const materializedManifest = readJsonRecord(manifestPath);
  assert.ok(Array.isArray(materializedManifest.identities));
  const authorityCounts = new Map<string, number>();
  for (const identity of materializedManifest.identities) {
    assertRecord(identity);
    const authority = String(identity.authority);
    authorityCounts.set(authority, (authorityCounts.get(authority) ?? 0) + 1);
  }
  assert.deepEqual(Object.fromEntries(authorityCounts), {
    "locked-prepared-plan": 2,
    "reviewer-reconciliation": 2,
    "approved-third-value-resolution": 1,
  });
  const manifestCounts = materializedManifest.counts;
  assertRecord(manifestCounts);
  assert.equal(manifestCounts.lockedFields, 2);
  assert.equal(manifestCounts.reviewerReconciledFields, 2);
  assert.equal(manifestCounts.resolvedEscalationFields, 1);
  assert.deepEqual(
    __testOnlyAfrikaansReconciliationAdapter.validateManifest({
      worklistDir: fixture.paths.worklistDir,
      candidateDir: outputCandidateDir,
      manifestPath,
      policy: fixture.policy,
      nowEpochMs: verificationNowEpochMs,
    }),
    result,
  );
  assert.deepEqual(
    __testOnlyValidateHybridTranslationCandidateManifest({
      worklistDir: fixture.paths.worklistDir,
      candidateDir: outputCandidateDir,
      manifestPath,
      reconciliationPolicy: fixture.policy,
      reconciliationNowEpochMs: verificationNowEpochMs,
    }),
    result,
  );
});

test("rejects impossible owner and reviewer UTC timestamps", async (t) => {
  for (const acceptedAtUtc of [
    "2026-13-40T25:61:61Z",
    "2026-02-31T00:01:00Z",
  ]) {
    await t.test(`owner ${acceptedAtUtc}`, (subtest) => {
      const fixture = createFixture(subtest);
      const acceptance = writeOwnerAcceptance(fixture, { acceptedAtUtc });
      const outputCandidateDir = path.join(fixture.root, "tmp/invalid-time-candidates");
      const manifestPath = path.join(fixture.root, "tmp/invalid-time-manifest.json");
      assert.throws(
        () =>
          __testOnlyAfrikaansReconciliationAdapter.materialize({
            paths: fixture.paths,
            policy: fixture.policy,
            nowEpochMs: verificationNowEpochMs,
            execute: true,
            ownerAcceptancePath: acceptance,
            outputCandidateDir,
            manifestPath,
          }),
        /real canonical UTC instant/u,
      );
      assert.equal(readdirSync(path.join(fixture.root, "tmp")).includes("invalid-time-candidates"), false);
      assert.equal(readdirSync(path.join(fixture.root, "tmp")).includes("invalid-time-manifest.json"), false);
    });
  }

  await t.test("owner acceptance must follow the third-value review", (subtest) => {
    const fixture = createFixture(subtest);
    const acceptance = writeOwnerAcceptance(fixture, {
      acceptedAtUtc: "2026-07-15T00:01:00.000Z",
    });
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.materialize({
          paths: fixture.paths,
          policy: fixture.policy,
          nowEpochMs: verificationNowEpochMs,
          execute: true,
          ownerAcceptancePath: acceptance,
          outputCandidateDir: path.join(fixture.root, "tmp/noncausal-candidates"),
          manifestPath: path.join(fixture.root, "tmp/noncausal-manifest.json"),
        }),
      /causally later than the original and third-value reviews/u,
    );
  });

  for (const ownerName of ["Resolution Author", "Resolution Reviewer"]) {
    await t.test(`owner cannot impersonate ${ownerName}`, (subtest) => {
      const fixture = createFixture(subtest);
      const acceptance = writeOwnerAcceptance(fixture, { ownerName });
      assert.throws(
        () =>
          __testOnlyAfrikaansReconciliationAdapter.materialize({
            paths: fixture.paths,
            policy: fixture.policy,
            nowEpochMs: verificationNowEpochMs,
            execute: true,
            ownerAcceptancePath: acceptance,
            outputCandidateDir: path.join(fixture.root, "tmp/actor-candidates"),
            manifestPath: path.join(fixture.root, "tmp/actor-manifest.json"),
          }),
        /independent of both semantic reviewers and both resolution actors/u,
      );
    });
  }

  await t.test("invalid reviewer completion", (subtest) => {
    assert.throws(
      () =>
        createFixture(subtest, {
          invalidReviewerCompletedAtUtc: "2026-02-31T00:00:00Z",
        }),
      /calendar-valid canonical UTC timestamp/u,
    );
  });

  await t.test("canonical milliseconds remain valid", (subtest) => {
    const fixture = createFixture(subtest);
    const acceptance = writeOwnerAcceptance(fixture, {
      acceptedAtUtc: "2026-07-15T00:01:00.123Z",
    });
    const result = __testOnlyAfrikaansReconciliationAdapter.materialize({
      paths: fixture.paths,
      policy: fixture.policy,
      nowEpochMs: verificationNowEpochMs,
      execute: true,
      ownerAcceptancePath: acceptance,
      outputCandidateDir: path.join(fixture.root, "tmp/millisecond-candidates"),
      manifestPath: path.join(fixture.root, "tmp/millisecond-manifest.json"),
    });
    assert.equal(result.fields, 5);
  });
});

test("anchors the exact repository, executing adapter, and frozen adapter hash", async (t) => {
  await t.test("repo-root symlink alias", (subtest) => {
    const fixture = createFixture(subtest);
    const alias = path.join(fixture.root, "repo-root-alias");
    symlinkSync(fixture.paths.repoRoot, alias, "dir");
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: { ...fixture.paths, repoRoot: alias },
          policy: fixture.policy,
        }),
      /exact repository root/u,
    );
  });

  await t.test("redirected adapter implementation", (subtest) => {
    const fixture = createFixture(subtest);
    const redirectedAdapter = path.join(fixture.root, "redirected-adapter.ts");
    writeFileSync(redirectedAdapter, readFileSync(fixture.paths.adapterImplementationPath), {
      mode: 0o600,
    });
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: { ...fixture.paths, adapterImplementationPath: redirectedAdapter },
          policy: {
            ...fixture.policy,
            adapterImplementationSha256: rawFileSha256(redirectedAdapter),
          },
        }),
      /executing module/u,
    );
  });

  await t.test("frozen adapter hash drift", (subtest) => {
    const fixture = createFixture(subtest);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: { ...fixture.policy, adapterImplementationSha256: sha256("wrong adapter") },
        }),
      /adapter implementation SHA-256 drifted/u,
    );
  });

  await t.test("redirected candidate validator implementation", (subtest) => {
    const fixture = createFixture(subtest);
    const redirectedValidator = path.join(fixture.root, "redirected-candidate-validator.ts");
    writeFileSync(
      redirectedValidator,
      readFileSync(fixture.paths.candidateValidatorImplementationPath),
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: {
            ...fixture.paths,
            candidateValidatorImplementationPath: redirectedValidator,
          },
          policy: {
            ...fixture.policy,
            candidateValidatorImplementationSha256:
              rawFileSha256(redirectedValidator),
          },
        }),
      /imported module/u,
    );
  });

  await t.test("frozen candidate validator hash drift", (subtest) => {
    const fixture = createFixture(subtest);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: {
            ...fixture.policy,
            candidateValidatorImplementationSha256: sha256("wrong validator"),
          },
        }),
      /candidate validator implementation SHA-256 drifted/u,
    );
  });
});

test("rejects internal ancestor symlinks and hardlinks", async (t) => {
  await t.test("core input ancestor symlink", (subtest) => {
    const fixture = createFixture(subtest);
    const alias = path.join(fixture.root, "lane-alias");
    symlinkSync(path.dirname(fixture.paths.partitionPlanPath), alias, "dir");
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: {
            ...fixture.paths,
            partitionPlanPath: path.join(alias, path.basename(fixture.paths.partitionPlanPath)),
          },
          policy: fixture.policy,
        }),
      /symlink ancestor|symbolic-link traversal/u,
    );
  });

  await t.test("hardlinked reviewer evidence", (subtest) => {
    const fixture = createFixture(subtest);
    const hardlink = path.join(fixture.root, "tmp/reviewer-a-hardlink.json");
    linkSync(fixture.paths.reviewerAEvidencePath, hardlink);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: { ...fixture.paths, reviewerAEvidencePath: hardlink },
          policy: fixture.policy,
        }),
      /regular, unlinked file/u,
    );
  });

  await t.test("owner acceptance ancestor symlink", (subtest) => {
    const fixture = createFixture(subtest);
    const acceptance = writeOwnerAcceptance(fixture);
    const alias = path.join(fixture.root, "acceptance-parent-alias");
    symlinkSync(path.dirname(acceptance), alias, "dir");
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.materialize({
          paths: fixture.paths,
          policy: fixture.policy,
          nowEpochMs: verificationNowEpochMs,
          execute: true,
          ownerAcceptancePath: path.join(alias, path.basename(acceptance)),
          outputCandidateDir: path.join(fixture.root, "tmp/symlink-owner-candidates"),
          manifestPath: path.join(fixture.root, "tmp/symlink-owner-manifest.json"),
        }),
      /symlink ancestor|symbolic-link traversal/u,
    );
  });
});

test("settled verification detects byte-identical inode and tree replacement", async (t) => {
  await t.test("file inode replacement", (subtest) => {
    const fixture = createFixture(subtest);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: fixture.policy,
          testHooks: {
            beforeCoreSettlement(paths) {
              const replacement = `${paths.reviewerAEvidencePath}.replacement`;
              writeFileSync(replacement, readFileSync(paths.reviewerAEvidencePath), { mode: 0o600 });
              renameSync(replacement, paths.reviewerAEvidencePath);
            },
          },
        }),
      /inode or metadata drifted/u,
    );
  });

  await t.test("resolution artifact inode replacement", (subtest) => {
    const fixture = createFixture(subtest);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: fixture.policy,
          testHooks: {
            beforeCoreSettlement(paths) {
              const replacement = `${paths.thirdValueReviewPath}.replacement`;
              writeFileSync(
                replacement,
                readFileSync(paths.thirdValueReviewPath),
                { mode: 0o600 },
              );
              renameSync(replacement, paths.thirdValueReviewPath);
            },
          },
        }),
      /inode or metadata drifted/u,
    );
  });

  await t.test("tree directory replacement", (subtest) => {
    const fixture = createFixture(subtest);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.verify({
          paths: fixture.paths,
          policy: fixture.policy,
          testHooks: {
            beforeCoreSettlement(paths) {
              const localeRoot = path.join(paths.worklistDir, "af");
              const backup = `${paths.worklistDir}-af-original`;
              renameSync(localeRoot, backup);
              mkdirSync(localeRoot, { mode: 0o700 });
              for (const name of readdirSync(backup)) {
                writeFileSync(path.join(localeRoot, name), readFileSync(path.join(backup, name)), {
                  mode: 0o600,
                });
              }
            },
          },
        }),
      /directory inode or metadata drifted|bytes or exact shape drifted/u,
    );
  });
});

test("schema-v3 validation rejects provenance redirects and hardlinked commit markers", async (t) => {
  await t.test("manifest repo-root redirect", (subtest) => {
    const fixture = createFixture(subtest);
    const acceptance = writeOwnerAcceptance(fixture);
    const outputCandidateDir = path.join(fixture.root, "tmp/redirect-root-candidates");
    const manifestPath = path.join(fixture.root, "tmp/redirect-root-manifest.json");
    __testOnlyAfrikaansReconciliationAdapter.materialize({
      paths: fixture.paths,
      policy: fixture.policy,
      nowEpochMs: verificationNowEpochMs,
      execute: true,
      ownerAcceptancePath: acceptance,
      outputCandidateDir,
      manifestPath,
    });
    const alias = path.join(fixture.root, "manifest-repo-root-alias");
    symlinkSync(fixture.paths.repoRoot, alias, "dir");
    const manifest = readJsonRecord(manifestPath);
    const provenance = manifest.provenance;
    assertRecord(provenance);
    provenance.repoRoot = alias;
    const { canonicalSha256: ignoredCanonicalSha256, ...manifestCore } = manifest;
    void ignoredCanonicalSha256;
    manifest.canonicalSha256 = sha256CanonicalAfrikaansReconciliation(manifestCore);
    writeJson(manifestPath, manifest);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.validateManifest({
          worklistDir: fixture.paths.worklistDir,
          candidateDir: outputCandidateDir,
          manifestPath,
          policy: fixture.policy,
          nowEpochMs: verificationNowEpochMs,
        }),
      /exact repository root/u,
    );
  });

  await t.test("manifest adapter redirect", (subtest) => {
    const fixture = createFixture(subtest);
    const acceptance = writeOwnerAcceptance(fixture);
    const outputCandidateDir = path.join(fixture.root, "tmp/redirect-adapter-candidates");
    const manifestPath = path.join(fixture.root, "tmp/redirect-adapter-manifest.json");
    __testOnlyAfrikaansReconciliationAdapter.materialize({
      paths: fixture.paths,
      policy: fixture.policy,
      nowEpochMs: verificationNowEpochMs,
      execute: true,
      ownerAcceptancePath: acceptance,
      outputCandidateDir,
      manifestPath,
    });
    const redirectedAdapter = path.join(fixture.root, "manifest-redirected-adapter.ts");
    writeFileSync(redirectedAdapter, readFileSync(fixture.paths.adapterImplementationPath), {
      mode: 0o600,
    });
    const manifest = readJsonRecord(manifestPath);
    const provenance = manifest.provenance;
    assertRecord(provenance);
    const adapterImplementation = provenance.adapterImplementation;
    assertRecord(adapterImplementation);
    adapterImplementation.path = redirectedAdapter;
    adapterImplementation.bytes = readFileSync(redirectedAdapter).byteLength;
    adapterImplementation.sha256 = rawFileSha256(redirectedAdapter);
    const { canonicalSha256: ignoredCanonicalSha256, ...manifestCore } = manifest;
    void ignoredCanonicalSha256;
    manifest.canonicalSha256 = sha256CanonicalAfrikaansReconciliation(manifestCore);
    writeJson(manifestPath, manifest);
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.validateManifest({
          worklistDir: fixture.paths.worklistDir,
          candidateDir: outputCandidateDir,
          manifestPath,
          policy: fixture.policy,
          nowEpochMs: verificationNowEpochMs,
        }),
      /executing module/u,
    );
  });

  await t.test("hardlinked manifest", (subtest) => {
    const fixture = createFixture(subtest);
    const acceptance = writeOwnerAcceptance(fixture);
    const outputCandidateDir = path.join(fixture.root, "tmp/hardlink-manifest-candidates");
    const manifestPath = path.join(fixture.root, "tmp/hardlink-manifest.json");
    __testOnlyAfrikaansReconciliationAdapter.materialize({
      paths: fixture.paths,
      policy: fixture.policy,
      nowEpochMs: verificationNowEpochMs,
      execute: true,
      ownerAcceptancePath: acceptance,
      outputCandidateDir,
      manifestPath,
    });
    linkSync(manifestPath, path.join(fixture.root, "tmp/hardlink-manifest-copy.json"));
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.validateManifest({
          worklistDir: fixture.paths.worklistDir,
          candidateDir: outputCandidateDir,
          manifestPath,
          policy: fixture.policy,
          nowEpochMs: verificationNowEpochMs,
        }),
      /regular, unlinked file/u,
    );
  });
});

test("rejects a symlinked output parent before publication", (t) => {
  const fixture = createFixture(t);
  const acceptance = writeOwnerAcceptance(fixture);
  const targetParent = path.join(fixture.root, "tmp/output-parent-target");
  const aliasParent = path.join(fixture.root, "tmp/output-parent-alias");
  mkdirSync(targetParent, { mode: 0o700 });
  symlinkSync(targetParent, aliasParent, "dir");
  assert.throws(
    () =>
      __testOnlyAfrikaansReconciliationAdapter.materialize({
        paths: fixture.paths,
        policy: fixture.policy,
        nowEpochMs: verificationNowEpochMs,
        execute: true,
        ownerAcceptancePath: acceptance,
        outputCandidateDir: path.join(aliasParent, "candidates"),
        manifestPath: path.join(fixture.root, "tmp/symlink-output-manifest.json"),
      }),
    /symlink ancestor|symbolic-link traversal/u,
  );
});

test("exclusive publication never clobbers concurrent tmp paths", async (t) => {
  await t.test("concurrent output directory", (subtest) => {
    const fixture = createFixture(subtest);
    const acceptance = writeOwnerAcceptance(fixture);
    const outputCandidateDir = path.join(fixture.root, "tmp/concurrent-output");
    const manifestPath = path.join(fixture.root, "tmp/concurrent-output-manifest.json");
    const sentinel = path.join(outputCandidateDir, "sentinel.txt");
    assert.throws(() =>
      __testOnlyAfrikaansReconciliationAdapter.materialize({
        paths: fixture.paths,
        policy: fixture.policy,
        nowEpochMs: verificationNowEpochMs,
        execute: true,
        ownerAcceptancePath: acceptance,
        outputCandidateDir,
        manifestPath,
        testHooks: {
          beforeOutputReservation() {
            mkdirSync(outputCandidateDir, { mode: 0o700 });
            writeFileSync(sentinel, "concurrent owner\n", { mode: 0o600 });
          },
        },
      }),
    );
    assert.equal(readFileSync(sentinel, "utf8"), "concurrent owner\n");
    assert.equal(readdirSync(path.dirname(manifestPath)).includes(path.basename(manifestPath)), false);
  });

  await t.test("concurrent manifest", (subtest) => {
    const fixture = createFixture(subtest);
    const acceptance = writeOwnerAcceptance(fixture);
    const outputCandidateDir = path.join(fixture.root, "tmp/concurrent-manifest-candidates");
    const manifestPath = path.join(fixture.root, "tmp/concurrent-manifest.json");
    assert.throws(() =>
      __testOnlyAfrikaansReconciliationAdapter.materialize({
        paths: fixture.paths,
        policy: fixture.policy,
        nowEpochMs: verificationNowEpochMs,
        execute: true,
        ownerAcceptancePath: acceptance,
        outputCandidateDir,
        manifestPath,
        testHooks: {
          beforeManifestCreate() {
            writeFileSync(manifestPath, "concurrent manifest\n", { mode: 0o600 });
          },
        },
      }),
    );
    assert.equal(readFileSync(manifestPath, "utf8"), "concurrent manifest\n");
    assert.equal(readdirSync(path.dirname(outputCandidateDir)).includes(path.basename(outputCandidateDir)), false);
  });

  await t.test("drifted owned tree is preserved instead of recursively deleted", (subtest) => {
    const fixture = createFixture(subtest);
    const acceptance = writeOwnerAcceptance(fixture);
    const outputCandidateDir = path.join(fixture.root, "tmp/drifted-cleanup-candidates");
    const manifestPath = path.join(fixture.root, "tmp/drifted-cleanup-manifest.json");
    const unexpected = path.join(outputCandidateDir, "af/unexpected.txt");
    assert.throws(
      () =>
        __testOnlyAfrikaansReconciliationAdapter.materialize({
          paths: fixture.paths,
          policy: fixture.policy,
          nowEpochMs: verificationNowEpochMs,
          execute: true,
          ownerAcceptancePath: acceptance,
          outputCandidateDir,
          manifestPath,
          testHooks: {
            beforeManifestCreate() {
              writeFileSync(unexpected, "do not delete\n", { mode: 0o600 });
              writeFileSync(manifestPath, "concurrent manifest\n", { mode: 0o600 });
            },
          },
        }),
      /refused to clobber/u,
    );
    assert.equal(readFileSync(unexpected, "utf8"), "do not delete\n");
    assert.equal(readFileSync(manifestPath, "utf8"), "concurrent manifest\n");
  });
});
