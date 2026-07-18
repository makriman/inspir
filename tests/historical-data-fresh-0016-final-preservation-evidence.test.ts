import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertFreshHistoricalFresh0016FinalPreservation,
  createHistoricalFresh0016FinalVerificationLiveTopology,
  selectHistoricalFresh0016FinalVerificationLiveTopology,
} from "../scripts/cloudflare/historical-data-fresh-0016-preservation-cli-adapter";
import {
  buildWorkerCandidateActivationEvidence,
  buildWorkerCandidateStagedEvidence,
  buildWorkerCandidateUploadEvidence,
  workerCandidateEvidenceSha256,
} from "../scripts/cloudflare/worker-candidate-release-evidence";
import {
  assertHistoricalDataFresh0016FinalVerificationReplayTopology,
} from "../scripts/cloudflare/verify-historical-data-preservation";

const targetCandidateVersionId =
  "22222222-2222-4222-8222-222222222222";
const serviceBaselineVersionId =
  "11111111-1111-4111-8111-111111111111";
const uploadEvidenceSha256 = "a".repeat(64);
const activationEvidenceSha256 = "f".repeat(64);
const now = new Date("2026-07-15T12:00:00.000Z");

function canonicalProof() {
  return Object.freeze({
    createdAt: "2026-07-15T11:59:00.000Z",
    cutoverRunId: "33333333-3333-4333-8333-333333333333",
    canonicalArtifactSha256: "b".repeat(64),
    successorReportSha256: "c".repeat(64),
    sourceFingerprint: Object.freeze({
      sha256: "d".repeat(64),
      fileCount: 123,
    }),
    workerRelease: Object.freeze({
      phase: "uploaded-inactive" as const,
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256,
    }),
    activationEvidenceSha256,
    authorizationPath: "/private/final-verifier-authorization.json",
    reportPath: "/private/historical-data-preservation-verification.json",
  });
}

function assertionInput() {
  return {
    backupDirectory: "/private/release-evidence",
    cwd: "/private/source",
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
    activationEvidenceSha256,
    now,
  } as const;
}

test("authenticated release assertion accepts only the exact canonical final-preservation Worker release", () => {
  let calls = 0;
  const report = assertFreshHistoricalFresh0016FinalPreservation(
    assertionInput(),
    {
      readCanonicalProof: (input) => {
        calls += 1;
        assert.equal(input.backupDirectory, "/private/release-evidence");
        assert.equal(input.cwd, "/private/source");
        assert.equal(input.now.toISOString(), now.toISOString());
        return canonicalProof();
      },
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(report, canonicalProof());

  for (const mismatch of [
    {
      ...assertionInput(),
      targetCandidateVersionId:
        "44444444-4444-4444-8444-444444444444",
    },
    {
      ...assertionInput(),
      serviceBaselineVersionId:
        "55555555-5555-4555-8555-555555555555",
    },
    { ...assertionInput(), uploadEvidenceSha256: "e".repeat(64) },
    { ...assertionInput(), activationEvidenceSha256: "9".repeat(64) },
  ]) {
    assert.throws(
      () =>
        assertFreshHistoricalFresh0016FinalPreservation(mismatch, {
          readCanonicalProof: () => canonicalProof(),
        }),
      /does not bind the exact canonical source and Worker release/,
    );
  }
});

test("final-preservation assertion rejects an invalid clock before reading evidence", () => {
  let called = false;
  assert.throws(
    () =>
      assertFreshHistoricalFresh0016FinalPreservation(
        { ...assertionInput(), now: new Date(Number.NaN) },
        {
          readCanonicalProof: () => {
            called = true;
            return canonicalProof();
          },
        },
      ),
    /clock is invalid/,
  );
  assert.equal(called, false);
});

test("activation evidence and candidate-active topology authorize the final verifier only after activation", () => {
  const fixture = activationFixture();
  const topology = createHistoricalFresh0016FinalVerificationLiveTopology({
    workerRelease: fixture.workerRelease,
    previousLiveTopologyObservedAt: "2026-07-15T11:55:00.000Z",
    now: new Date("2026-07-15T11:59:00.000Z"),
    statusOutput: deploymentStatus(fixture.activeDeploymentId, [
      [targetCandidateVersionId, 100],
    ]),
    upload: fixture.upload,
    staged: fixture.staged,
    activation: fixture.activation,
  });

  assert.equal(
    topology.kind,
    "inspir-historical-fresh-0016-final-active-worker-topology-v1",
  );
  assert.equal(topology.topology.targetCandidateVersionId, targetCandidateVersionId);
  assert.equal(topology.topology.candidatePercentage, 100);
  assert.equal(topology.topology.observedVersions, 1);
  assert.deepEqual(topology.serviceBaseline, {
    versionId: serviceBaselineVersionId,
    state: "absent",
    percentage: 0,
  });
  assert.equal(topology.activationEvidence.sha256, fixture.activation.sha256);
  assert.equal(
    topology.activationEvidence.deploymentId,
    fixture.activeDeploymentId,
  );
  assert.ok(
    Date.parse(topology.observedAt) >
      Date.parse(topology.activationEvidence.createdAt),
  );
});

test("final verifier rejects wrong-baseline, staged, and old baseline-only topology", () => {
  const fixture = activationFixture();
  const common = {
    previousLiveTopologyObservedAt: "2026-07-15T11:55:00.000Z",
    now: new Date("2026-07-15T11:59:00.000Z"),
    upload: fixture.upload,
    staged: fixture.staged,
    activation: fixture.activation,
  } as const;
  assert.throws(
    () =>
      createHistoricalFresh0016FinalVerificationLiveTopology({
        ...common,
        workerRelease: {
          ...fixture.workerRelease,
          serviceBaselineVersionId:
            "99999999-9999-4999-8999-999999999999",
        },
        statusOutput: deploymentStatus(fixture.activeDeploymentId, [
          [targetCandidateVersionId, 100],
        ]),
      }),
    /exact candidate, baseline, or upload evidence/,
  );
  assert.throws(
    () =>
      createHistoricalFresh0016FinalVerificationLiveTopology({
        ...common,
        workerRelease: fixture.workerRelease,
        statusOutput: deploymentStatus(fixture.stagedDeploymentId, [
          [serviceBaselineVersionId, 100],
          [targetCandidateVersionId, 0],
        ]),
      }),
    /exact uploaded candidate alone at 100%/,
  );
  assert.throws(
    () =>
      createHistoricalFresh0016FinalVerificationLiveTopology({
        ...common,
        workerRelease: fixture.workerRelease,
        statusOutput: deploymentStatus(fixture.uploadDeploymentId, [
          [serviceBaselineVersionId, 100],
        ]),
      }),
    /exact uploaded candidate alone at 100%/,
  );
  assert.throws(
    () =>
      createHistoricalFresh0016FinalVerificationLiveTopology({
        ...common,
        workerRelease: fixture.workerRelease,
        statusOutput: deploymentStatus(fixture.uploadDeploymentId, [
          [targetCandidateVersionId, 100],
        ]),
      }),
    /exact uploaded candidate alone at 100%/,
  );
  assert.throws(
    () =>
      createHistoricalFresh0016FinalVerificationLiveTopology({
        ...common,
        workerRelease: fixture.workerRelease,
        statusOutput: deploymentStatus(fixture.activeDeploymentId, [
          [targetCandidateVersionId, 100],
        ]),
        activation: {
          ...fixture.activation,
          sha256: "0".repeat(64),
        },
      }),
    /activation evidence.*canonical.*SHA-256|canonical activation evidence/i,
  );
  assert.throws(
    () =>
      createHistoricalFresh0016FinalVerificationLiveTopology({
        ...common,
        workerRelease: fixture.workerRelease,
        previousLiveTopologyObservedAt:
          fixture.activation.value.createdAt,
        statusOutput: deploymentStatus(fixture.activeDeploymentId, [
          [targetCandidateVersionId, 100],
        ]),
      }),
    /activation after the baseline-only Day-2 topology/,
  );
  assert.throws(
    () =>
      createHistoricalFresh0016FinalVerificationLiveTopology({
        ...common,
        workerRelease: fixture.workerRelease,
        now: new Date(fixture.activation.value.createdAt),
        statusOutput: deploymentStatus(fixture.activeDeploymentId, [
          [targetCandidateVersionId, 100],
        ]),
      }),
    /activation, candidate, or service-baseline identity/,
  );
});

test("final-verifier recovery reuses only the sealed topology after a fresh exact-active check", () => {
  const fixture = activationFixture();
  const shared = {
    workerRelease: fixture.workerRelease,
    previousLiveTopologyObservedAt: "2026-07-15T11:55:00.000Z",
    statusOutput: deploymentStatus(fixture.activeDeploymentId, [
      [targetCandidateVersionId, 100],
    ]),
    upload: fixture.upload,
    staged: fixture.staged,
    activation: fixture.activation,
  } as const;
  const authorizedTopology =
    createHistoricalFresh0016FinalVerificationLiveTopology({
      ...shared,
      now: new Date("2026-07-15T11:59:00.000Z"),
    });
  const currentTopology =
    createHistoricalFresh0016FinalVerificationLiveTopology({
      ...shared,
      now: new Date("2026-07-15T12:00:00.000Z"),
    });

  assert.deepEqual(
    selectHistoricalFresh0016FinalVerificationLiveTopology({
      currentTopology,
    }),
    currentTopology,
  );
  assert.deepEqual(
    selectHistoricalFresh0016FinalVerificationLiveTopology({
      currentTopology,
      authorizedTopology,
    }),
    authorizedTopology,
  );

  const activationHashDrift = structuredClone(currentTopology);
  Object.defineProperty(activationHashDrift.activationEvidence, "sha256", {
    value: "0".repeat(64),
    enumerable: true,
  });
  assert.throws(
    () =>
      selectHistoricalFresh0016FinalVerificationLiveTopology({
        currentTopology: activationHashDrift,
        authorizedTopology,
      }),
    /no longer matches the authorized candidate-active topology/,
  );

  const olderCurrentTopology =
    createHistoricalFresh0016FinalVerificationLiveTopology({
      ...shared,
      now: new Date("2026-07-15T11:58:30.000Z"),
    });
  assert.throws(
    () =>
      selectHistoricalFresh0016FinalVerificationLiveTopology({
        currentTopology: olderCurrentTopology,
        authorizedTopology,
      }),
    /no longer matches the authorized candidate-active topology/,
  );

  const replacedAuthorizationTopology = structuredClone(authorizedTopology);
  Object.defineProperties(replacedAuthorizationTopology, {
    observedAt: {
      value: "2026-07-15T11:59:30.000Z",
      enumerable: true,
    },
    statusOutputSha256: {
      value: "e".repeat(64),
      enumerable: true,
    },
  });
  assert.throws(
    () =>
      assertHistoricalDataFresh0016FinalVerificationReplayTopology({
        currentCheckedTopology: authorizedTopology,
        proofTopology: replacedAuthorizationTopology,
      }),
    /authorization changed after its current candidate-active topology check/,
  );
});

test("canonical final-preservation consumption is local-only and precedes non-age translation binding", () => {
  const adapter = fs.readFileSync(
    path.resolve(
      "scripts/cloudflare/historical-data-fresh-0016-preservation-cli-adapter.ts",
    ),
    "utf8",
  );
  const proofStart = adapter.indexOf(
    "function readHistoricalFresh0016CanonicalFinalPreservationProof",
  );
  const proofEnd = adapter.indexOf(
    "export type HistoricalFresh0016FinalPreservationAssertionDependencies",
    proofStart,
  );
  assert.ok(proofStart >= 0 && proofEnd > proofStart);
  const proofReader = adapter.slice(proofStart, proofEnd);
  assert.match(proofReader, /readHistoricalFresh0016PreservationReference/);
  assert.match(proofReader, /requireSuccessorFreshness:\s*false/);
  assert.match(proofReader, /maximumReportAgeMs:\s*null/);
  assert.match(proofReader, /readHistoricalFresh0016Day2BudgetEnvelope/);
  assert.match(
    proofReader,
    /readAndValidateHistoricalDataFresh0016FinalVerificationProof/,
  );
  assert.doesNotMatch(proofReader, /runWrangler|d1\W+execute|verifyRemoteTranslationDrift/);
  assert.match(
    adapter,
    /assertCutoverBoundPredecessorPrerequisitesStillSafe/,
  );
  assert.match(adapter, /assertDeferred0017EvidenceRecord/);
  assert.match(adapter, /topicAttestationPath/);
  assert.match(adapter, /translationAttestationPath/);

  const preservation = fs.readFileSync(
    path.resolve("scripts/cloudflare/verify-historical-data-preservation.ts"),
    "utf8",
  );
  const validatorStart = preservation.indexOf(
    "export function readAndValidateHistoricalDataFresh0016FinalVerificationProof",
  );
  const validatorEnd = preservation.indexOf(
    "function validateHistoricalDataFresh0016FinalVerificationReportInternal",
    validatorStart,
  );
  assert.ok(validatorStart >= 0 && validatorEnd > validatorStart);
  const validator = preservation.slice(validatorStart, validatorEnd);
  assert.match(validator, /recoveryPaths\.authorization/);
  assert.match(validator, /historicalDataReportPath\(backupDir, "verification"\)/);
  assert.match(
    validator,
    /validateHistoricalDataFresh0016FinalVerificationReport/,
  );
  assert.doesNotMatch(validator, /runWrangler|d1\W+execute/);

  const cliStart = preservation.indexOf(
    "export async function runHistoricalDataPreservationCli",
  );
  assert.ok(cliStart >= 0);
  const cli = preservation.slice(cliStart);
  const replay = cli.indexOf("if (pathEntryExists(existingReportPath))");
  const exactProof = cli.indexOf(
    "readAndValidateHistoricalDataFresh0016FinalVerificationProof",
    replay,
  );
  const checkedTopology = cli.indexOf(
    "assertHistoricalDataFresh0016FinalVerificationReplayTopology",
    exactProof,
  );
  const refinement = cli.indexOf("day2Budget.refineAfterFinalProof", replay);
  assert.ok(
    replay >= 0 &&
      exactProof > replay &&
      checkedTopology > exactProof &&
      refinement > checkedTopology,
  );
  assert.doesNotMatch(
    cli.slice(replay, refinement),
    /validateHistoricalDataFresh0016FinalVerificationReport\(/,
  );

  const contextStart = adapter.indexOf(
    "export function readHistoricalFresh0016FinalVerificationContext",
  );
  assert.ok(contextStart >= 0);
  const context = adapter.slice(contextStart);
  assert.match(
    context,
    /readHistoricalDataFresh0016FinalVerificationAuthorizationIfPresent/,
  );
  assert.match(
    context,
    /selectHistoricalFresh0016FinalVerificationLiveTopology/,
  );

  const authenticated = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-authenticated-production-validation.ts"),
    "utf8",
  );
  const releaseStart = authenticated.indexOf(
    "function assertCandidateReleaseEvidence",
  );
  const releaseEnd = authenticated.indexOf(
    "function recoveryManifestPath",
    releaseStart,
  );
  assert.ok(releaseStart >= 0 && releaseEnd > releaseStart);
  const releaseGate = authenticated.slice(releaseStart, releaseEnd);
  const vectorize = releaseGate.lastIndexOf(
    "assertFreshProductionVectorizeReadiness(",
  );
  const finalPreservation = releaseGate.indexOf(
    "assertFreshHistoricalFresh0016FinalPreservation(",
    vectorize,
  );
  const translation = releaseGate.indexOf(
    "assertProductionTranslationReconciliationReleaseBinding(",
    finalPreservation,
  );
  assert.ok(vectorize >= 0 && finalPreservation > vectorize);
  assert.ok(translation > finalPreservation);
  assert.doesNotMatch(releaseGate, /assertFreshProductionTranslationReconciliation/);
});

function activationFixture() {
  const uploadDeploymentId =
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const stagedDeploymentId =
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const activeDeploymentId =
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const uploadValue = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-15T11:50:00.000Z",
    targetCandidateVersionId,
    serviceBaselineVersionId,
    expectedReleaseTag: "fresh-0016-final-topology",
    expectedReleaseMessageSha256: "1".repeat(64),
    uploadCommandEvidenceSha256: "2".repeat(64),
    workerDeployPreparationSha256: "3".repeat(64),
    git: {
      head: "4".repeat(40),
      upstream: "4".repeat(40),
      upstreamRef: "origin/codex/free-static-no-games",
    },
    artifacts: {
      sourceFingerprintSha256: "5".repeat(64),
      sourceFingerprintFileCount: 10,
      workerSourceSha256: "6".repeat(64),
      wranglerConfigSha256: "7".repeat(64),
      assetManifestSha256: "8".repeat(64),
      assetManifestFileCount: 20,
      assetManifestBytes: 4_096,
    },
    uploadOutput: {
      type: "version-upload",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-tag",
      versionId: targetCandidateVersionId,
      previewUrl: null,
      previewAliasUrl: null,
      wranglerEnvironment: null,
      workerNameOverridden: false,
      timestamp: "2026-07-15T11:49:00.000Z",
    },
    versionView: {
      versionId: targetCandidateVersionId,
      createdAt: "2026-07-15T11:49:00.000Z",
      source: "wrangler",
      releaseTag: "fresh-0016-final-topology",
      releaseMessageSha256: "1".repeat(64),
      resourceConfigSha256: "9".repeat(64),
    },
    soleBaselineTopology: {
      deploymentId: uploadDeploymentId,
      serviceBaselineVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  const upload = Object.freeze({
    path: "/private/worker-candidate-upload.json",
    value: uploadValue,
    sha256: workerCandidateEvidenceSha256(uploadValue),
  });
  const stagedValue = buildWorkerCandidateStagedEvidence({
    createdAt: "2026-07-15T11:56:00.000Z",
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    deployOutput: {
      type: "version-deploy",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-tag",
      deploymentId: stagedDeploymentId,
      timestamp: "2026-07-15T11:56:00.000Z",
    },
    topology: {
      deploymentId: stagedDeploymentId,
      serviceBaselineVersionId,
      targetCandidateVersionId,
      baselinePercentage: 100,
      candidatePercentage: 0,
      observedVersions: 2,
    },
  });
  const staged = Object.freeze({
    path: "/private/worker-candidate-staged.json",
    value: stagedValue,
    sha256: workerCandidateEvidenceSha256(stagedValue),
  });
  const activationValue = buildWorkerCandidateActivationEvidence({
    createdAt: "2026-07-15T11:58:00.000Z",
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    stagedEvidence: staged.value,
    stagedEvidenceSha256: staged.sha256,
    preActivationSealSha256: "d".repeat(64),
    deployOutput: {
      type: "version-deploy",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-tag",
      deploymentId: activeDeploymentId,
      timestamp: "2026-07-15T11:58:00.000Z",
    },
    topology: {
      deploymentId: activeDeploymentId,
      targetCandidateVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  const activation = Object.freeze({
    path: "/private/worker-candidate-activation.json",
    value: activationValue,
    sha256: workerCandidateEvidenceSha256(activationValue),
  });
  return Object.freeze({
    workerRelease: Object.freeze({
      phase: "uploaded-inactive" as const,
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256: upload.sha256,
    }),
    uploadDeploymentId,
    stagedDeploymentId,
    activeDeploymentId,
    upload,
    staged,
    activation,
  });
}

function deploymentStatus(
  deploymentId: string,
  versions: readonly (readonly [string, number])[],
) {
  return JSON.stringify({
    id: deploymentId,
    versions: versions.map(([versionId, percentage]) => ({
      version_id: versionId,
      percentage,
    })),
  });
}
