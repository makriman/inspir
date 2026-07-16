import assert from "node:assert/strict";
import test from "node:test";
import {
  remoteDurableObjectInfrastructureCheck,
  type DeployPreflightWorkerTopologyPhase,
} from "../scripts/cloudflare/deploy-preflight";
import {
  buildWorkerCandidateStagedEvidence,
  buildWorkerCandidateUploadEvidence,
  parseWorkerVersionViewOutput,
  workerCandidateEvidenceSha256,
  workerReleaseMessageSha256,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateStagedEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";

const baselineVersionId = "11111111-1111-4111-8111-111111111111";
const candidateVersionId = "22222222-2222-4222-8222-222222222222";
const baselineDeploymentId = "33333333-3333-4333-8333-333333333333";
const stagedDeploymentId = "44444444-4444-4444-8444-444444444444";
const activeDeploymentId = "55555555-5555-4555-8555-555555555555";
const releaseTag = "inspir-aaaaaaaaaaaa-bbbbbbbbbbbb";
const releaseMessage =
  "inspir candidate git=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa prep=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const createdAt = "2026-07-15T04:00:00.000Z";

test("deploy preflight retains the sole-active baseline contract by default", () => {
  const check = remoteDurableObjectInfrastructureCheck({
    backupDir: "/tmp/inspir-preflight-fixture",
    phase: "baseline-sole-active",
    runner: (args) => ({
      status: 0,
      stdout: args[0] === "deployments"
        ? deploymentStatus(baselineDeploymentId, [{
          versionId: baselineVersionId,
          percentage: 100,
        }])
        : versionView({ versionId: baselineVersionId }),
      stderr: "",
    }),
  });
  assert.equal(check.status, "pass");
});

test("deploy preflight accepts only the exact staged and active candidate topologies", () => {
  const fixture = candidateFixture();
  const stagedCommands: string[][] = [];
  const staged = checkCandidateTopology({
    phase: "candidate-staged",
    stagedHandle: fixture.stagedHandle,
    deploymentOutput: deploymentStatus(stagedDeploymentId, [
      { versionId: baselineVersionId, percentage: 100 },
      { versionId: candidateVersionId, percentage: 0 },
    ]),
    versionViewOutput: fixture.versionViewOutput,
    commands: stagedCommands,
  });
  assert.equal(staged.status, "pass");
  assert.deepEqual(stagedCommands, [
    ["deployments", "status", "--json", "--name", "inspirlearning"],
    ["versions", "view", candidateVersionId, "--name", "inspirlearning", "--json"],
  ]);

  const active = checkCandidateTopology({
    phase: "candidate-active",
    stagedHandle: fixture.stagedHandle,
    deploymentOutput: deploymentStatus(activeDeploymentId, [
      { versionId: candidateVersionId, percentage: 100 },
    ]),
    versionViewOutput: fixture.versionViewOutput,
  });
  assert.equal(active.status, "pass");
});

test("deploy preflight rejects candidate topology, identity, and resource drift", () => {
  const fixture = candidateFixture();
  const wrongBaseline = checkCandidateTopology({
    phase: "candidate-staged",
    stagedHandle: fixture.stagedHandle,
    deploymentOutput: deploymentStatus(stagedDeploymentId, [
      {
        versionId: "66666666-6666-4666-8666-666666666666",
        percentage: 100,
      },
      { versionId: candidateVersionId, percentage: 0 },
    ]),
    versionViewOutput: fixture.versionViewOutput,
  });
  assert.equal(wrongBaseline.status, "fail");
  assert.match(JSON.stringify(wrongBaseline.detail), /exact immutable/);

  const candidateAlreadyActive = checkCandidateTopology({
    phase: "candidate-staged",
    stagedHandle: fixture.stagedHandle,
    deploymentOutput: deploymentStatus(activeDeploymentId, [
      { versionId: candidateVersionId, percentage: 100 },
    ]),
    versionViewOutput: fixture.versionViewOutput,
  });
  assert.equal(candidateAlreadyActive.status, "fail");

  const extraVersion = checkCandidateTopology({
    phase: "candidate-staged",
    stagedHandle: fixture.stagedHandle,
    deploymentOutput: deploymentStatus(stagedDeploymentId, [
      { versionId: baselineVersionId, percentage: 100 },
      { versionId: candidateVersionId, percentage: 0 },
      {
        versionId: "77777777-7777-4777-8777-777777777777",
        percentage: 0,
      },
    ]),
    versionViewOutput: fixture.versionViewOutput,
  });
  assert.equal(extraVersion.status, "fail");

  const resourceDrift = checkCandidateTopology({
    phase: "candidate-active",
    stagedHandle: fixture.stagedHandle,
    deploymentOutput: deploymentStatus(activeDeploymentId, [
      { versionId: candidateVersionId, percentage: 100 },
    ]),
    versionViewOutput: versionView({ driftResource: true }),
  });
  assert.equal(resourceDrift.status, "fail");
  assert.match(JSON.stringify(resourceDrift.detail), /resources drifted/);

  const annotationDrift = checkCandidateTopology({
    phase: "candidate-active",
    stagedHandle: fixture.stagedHandle,
    deploymentOutput: deploymentStatus(activeDeploymentId, [
      { versionId: candidateVersionId, percentage: 100 },
    ]),
    versionViewOutput: versionView({ releaseTag: `${releaseTag}-drift` }),
  });
  assert.equal(annotationDrift.status, "fail");
  assert.match(JSON.stringify(annotationDrift.detail), /tag or message/);
});

function candidateFixture() {
  const versionViewOutput = versionView();
  const expectedReleaseMessageSha256 = workerReleaseMessageSha256(releaseMessage);
  const versionViewEvidence = parseWorkerVersionViewOutput(
    versionViewOutput,
    candidateVersionId,
    {
      releaseTag,
      releaseMessageSha256: expectedReleaseMessageSha256,
    },
  );
  const upload = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-15T04:00:02.000Z",
    targetCandidateVersionId: candidateVersionId,
    serviceBaselineVersionId: baselineVersionId,
    expectedReleaseTag: releaseTag,
    expectedReleaseMessageSha256,
    uploadCommandEvidenceSha256: "a".repeat(64),
    workerDeployPreparationSha256: "b".repeat(64),
    git: {
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/codex/free-static-no-games",
    },
    artifacts: {
      sourceFingerprintSha256: "d".repeat(64),
      sourceFingerprintFileCount: 10,
      workerSourceSha256: "e".repeat(64),
      wranglerConfigSha256: "f".repeat(64),
      assetManifestSha256: "0".repeat(64),
      assetManifestFileCount: 20,
      assetManifestBytes: 4_096,
    },
    uploadOutput: {
      type: "version-upload",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "service-production",
      versionId: candidateVersionId,
      previewUrl: null,
      previewAliasUrl: null,
      wranglerEnvironment: null,
      workerNameOverridden: false,
      timestamp: "2026-07-15T04:00:00.000Z",
    },
    versionView: versionViewEvidence,
    soleBaselineTopology: {
      deploymentId: baselineDeploymentId,
      serviceBaselineVersionId: baselineVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  const uploadSha256 = workerCandidateEvidenceSha256(upload);
  const staged = buildWorkerCandidateStagedEvidence({
    createdAt: "2026-07-15T04:10:00.000Z",
    uploadEvidence: upload,
    uploadEvidenceSha256: uploadSha256,
    deployOutput: {
      type: "version-deploy",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "service-production",
      deploymentId: stagedDeploymentId,
      timestamp: "2026-07-15T04:09:58.000Z",
    },
    topology: {
      deploymentId: stagedDeploymentId,
      serviceBaselineVersionId: baselineVersionId,
      targetCandidateVersionId: candidateVersionId,
      baselinePercentage: 100,
      candidatePercentage: 0,
      observedVersions: 2,
    },
  });
  const stagedHandle: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence> =
    Object.freeze({
      path: "/tmp/worker-candidate-staged-report.json",
      value: staged,
      sha256: workerCandidateEvidenceSha256(staged),
    });
  return { stagedHandle, versionViewOutput };
}

function checkCandidateTopology(input: {
  phase: Exclude<DeployPreflightWorkerTopologyPhase, "baseline-sole-active">;
  stagedHandle: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  deploymentOutput: string;
  versionViewOutput: string;
  commands?: string[][];
}) {
  return remoteDurableObjectInfrastructureCheck({
    backupDir: "/tmp/inspir-preflight-fixture",
    phase: input.phase,
    stagedEvidenceLoader: () => input.stagedHandle,
    runner: (args) => {
      input.commands?.push([...args]);
      return {
        status: 0,
        stdout: args[0] === "deployments"
          ? input.deploymentOutput
          : input.versionViewOutput,
        stderr: "",
      };
    },
  });
}

function deploymentStatus(
  deploymentId: string,
  versions: readonly Readonly<{ versionId: string; percentage: number }>[],
) {
  return JSON.stringify({
    id: deploymentId,
    versions: versions.map((entry) => ({
      version_id: entry.versionId,
      percentage: entry.percentage,
    })),
  });
}

function versionView(options: {
  driftResource?: boolean;
  releaseTag?: string;
  versionId?: string;
} = {}) {
  return JSON.stringify({
    id: options.versionId ?? candidateVersionId,
    metadata: {
      created_on: createdAt,
      source: "wrangler",
    },
    annotations: {
      "workers/tag": options.releaseTag ?? releaseTag,
      "workers/message": releaseMessage,
    },
    resources: {
      bindings: [{
        name: "NEXT_CACHE_DO_QUEUE",
        type: "durable_object_namespace",
        class_name: "DOQueueHandler",
      }],
      compatibility_date: "2026-06-20",
      ...(options.driftResource ? { compatibility_flags: ["drift"] } : {}),
    },
  });
}
