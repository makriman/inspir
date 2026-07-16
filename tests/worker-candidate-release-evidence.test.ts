import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  WORKER_CANDIDATE_ACTIVATION_EVIDENCE_KIND,
  WORKER_CANDIDATE_UPLOAD_EVIDENCE_KIND,
  buildWorkerCandidateActivationEvidence,
  buildWorkerCandidateStagedEvidence,
  buildWorkerCandidateUploadEvidence,
  finalizeWorkerCandidateActivationEvidence,
  finalizeWorkerCandidateStagedEvidence,
  finalizeWorkerCandidateUploadEvidence,
  parseActivatedWorkerTopology,
  parseSoleBaselineTopology,
  parseStagedWorkerTopology,
  parseWorkerCandidateActivationEvidence,
  parseWorkerCandidateStagedEvidence,
  parseWorkerCandidateUploadEvidence,
  parseWorkerDeploymentStatusOutput,
  parseWorkerVersionDeployOutput,
  parseWorkerVersionUploadOutput,
  parseWorkerVersionViewOutput,
  readWorkerCandidateActivationEvidence,
  readWorkerCandidateUploadEvidence,
  verifyWorkerCandidateActivationEvidence,
  verifyWorkerCandidateStagedEvidence,
  workerCandidateActivationEvidencePath,
  workerCandidateEvidenceSha256,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
  workerReleaseMessageSha256,
  writeWorkerCandidateEvidence,
  type WorkerCandidateActivationEvidence,
  type WorkerCandidateArtifactIdentity,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateGitIdentity,
  type WorkerCandidateStagedEvidence,
  type WorkerCandidateUploadEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";
import {
  WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_KIND,
  parseWorkerCandidatePreActivationSeal,
  workerCandidatePreActivationCanonicalValueSha256,
  workerCandidatePreActivationSealPath,
  writeWorkerCandidatePreActivationSeal,
} from "../scripts/cloudflare/worker-candidate-pre-activation-seal-file";

const BASELINE_VERSION_ID = "11111111-1111-1111-1111-111111111111";
const CANDIDATE_VERSION_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_VERSION_ID = "33333333-3333-3333-3333-333333333333";
const BASELINE_DEPLOYMENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STAGED_DEPLOYMENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ACTIVATION_DEPLOYMENT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const UPLOAD_EVENT_AT = "2026-07-15T10:00:00.000Z";
const UPLOAD_EVIDENCE_AT = "2026-07-15T10:01:00.000Z";
const STAGED_EVIDENCE_AT = "2026-07-15T10:02:00.000Z";
const STAGE_DEPLOY_EVENT_AT = "2026-07-15T10:01:30.000Z";
const DEPLOY_EVENT_AT = "2026-07-15T10:03:00.000Z";
const ACTIVATION_EVIDENCE_AT = "2026-07-15T10:04:00.000Z";
const RELEASE_TAG = "release-2026-07-15-candidate-22222222";
const RELEASE_MESSAGE = "Immutable inspirlearning production candidate";
const RELEASE_MESSAGE_SHA256 = workerReleaseMessageSha256(RELEASE_MESSAGE);
const PRE_ACTIVATION_SEAL_SHA256 = "7".repeat(64);

const GIT: WorkerCandidateGitIdentity = Object.freeze({
  head: "a".repeat(40),
  upstream: "a".repeat(40),
  upstreamRef: "refs/remotes/origin/codex/release",
});
const ARTIFACTS: WorkerCandidateArtifactIdentity = Object.freeze({
  sourceFingerprintSha256: "1".repeat(64),
  sourceFingerprintFileCount: 321,
  workerSourceSha256: "2".repeat(64),
  wranglerConfigSha256: "3".repeat(64),
  assetManifestSha256: "4".repeat(64),
  assetManifestFileCount: 42,
  assetManifestBytes: 9_999,
});

test("version-upload output parser requires one exact unambiguous candidate event", () => {
  const event = parseWorkerVersionUploadOutput(uploadOutput());
  assert.equal(event.versionId, CANDIDATE_VERSION_ID);
  assert.equal(event.workerName, "inspirlearning");
  assert.equal(event.workerNameOverridden, false);

  assert.throws(
    () =>
      parseWorkerVersionUploadOutput(
        `${uploadOutput()}${uploadOutput(OTHER_VERSION_ID)}`,
      ),
    /exactly one unambiguous JSON event/i,
  );
  assert.throws(
    () => parseWorkerVersionUploadOutput("not-json\n"),
    /exact valid JSON/i,
  );
  assert.throws(
    () => parseWorkerVersionUploadOutput(uploadOutput().trimEnd()),
    /newline-terminated NDJSON/i,
  );
  assert.throws(
    () =>
      parseWorkerVersionUploadOutput(
        uploadOutput("NOT-A-UUID"),
      ),
    /invalid/i,
  );
  assert.throws(
    () =>
      parseWorkerVersionUploadOutput(
        uploadOutput(CANDIDATE_VERSION_ID, {
          worker_name: "other-worker",
        }),
      ),
    /wrong Worker/i,
  );
  assert.throws(
    () =>
      parseWorkerVersionUploadOutput(
        uploadOutput(CANDIDATE_VERSION_ID, {
          worker_name_overridden: true,
        }),
      ),
    /invalid/i,
  );
  assert.throws(
    () =>
      parseWorkerVersionUploadOutput(
        uploadOutput(CANDIDATE_VERSION_ID, {
          version_traffic: { [CANDIDATE_VERSION_ID]: 100 },
        }),
      ),
    /unexpected version_traffic/i,
  );
  assert.throws(
    () =>
      parseWorkerVersionUploadOutput(
        uploadOutput(CANDIDATE_VERSION_ID, { worker_tag: null }),
      ),
    /invalid/i,
  );
});

test("version-deploy output exposes only deployment identity and never trusts version_traffic", () => {
  const event = parseWorkerVersionDeployOutput(
    deployOutput({ [OTHER_VERSION_ID]: 100 }),
  );
  assert.deepEqual(event, {
    type: "version-deploy",
    version: 1,
    workerName: "inspirlearning",
    workerTag: "worker-service-tag",
    deploymentId: ACTIVATION_DEPLOYMENT_ID,
    timestamp: DEPLOY_EVENT_AT,
  });
  assert.equal(Object.hasOwn(event, "versionTraffic"), false);

  assert.throws(
    () =>
      parseWorkerVersionDeployOutput(
        deployOutput({}, { deployment_id: "malformed" }),
      ),
    /invalid/i,
  );
  assert.throws(
    () =>
      parseWorkerVersionDeployOutput(
        ndjson({
          type: "version-deploy",
          version: 1,
          worker_name: "inspirlearning",
          worker_tag: null,
          deployment_id: ACTIVATION_DEPLOYMENT_ID,
          timestamp: DEPLOY_EVENT_AT,
        }),
      ),
    /missing version_traffic/i,
  );
});

test("versions-view parser binds the exact candidate and canonical resource/config signature", () => {
  const first = parseWorkerVersionViewOutput(
    versionViewOutput(),
    CANDIDATE_VERSION_ID,
    releaseAnnotations(),
  );
  const reordered = parseWorkerVersionViewOutput(
    versionViewOutput({
      script_runtime: {
        compatibility_flags: ["nodejs_compat"],
        compatibility_date: "2026-07-01",
      },
      script: { handlers: ["fetch", "scheduled"], etag: "etag-1" },
      bindings: [
        { name: "DB", type: "d1", id: "database-id" },
        { name: "API_SECRET", type: "secret_text" },
      ],
    }),
    CANDIDATE_VERSION_ID,
    releaseAnnotations(),
  );
  assert.equal(first.versionId, CANDIDATE_VERSION_ID);
  assert.equal(first.resourceConfigSha256, reordered.resourceConfigSha256);
  assert.match(first.resourceConfigSha256, /^[0-9a-f]{64}$/);

  const changed = parseWorkerVersionViewOutput(
    versionViewOutput({
      bindings: [{ name: "DB", type: "d1", id: "different-database" }],
      script: { etag: "etag-1", handlers: ["fetch", "scheduled"] },
      script_runtime: {
        compatibility_date: "2026-07-01",
        compatibility_flags: ["nodejs_compat"],
      },
    }),
    CANDIDATE_VERSION_ID,
    releaseAnnotations(),
  );
  assert.notEqual(first.resourceConfigSha256, changed.resourceConfigSha256);
  assert.throws(
    () =>
      parseWorkerVersionViewOutput(
        versionViewOutput(),
        OTHER_VERSION_ID,
        releaseAnnotations(),
      ),
    /wrong candidate UUID/i,
  );
  assert.equal(
    parseWorkerVersionViewOutput(
      JSON.stringify({
        ...versionViewRecord(),
        unknown_provider_field: true,
        annotations: {
          ...versionViewRecord().annotations,
          "workers/triggered_by": "upload",
        },
      }),
      CANDIDATE_VERSION_ID,
      releaseAnnotations(),
    ).versionId,
    CANDIDATE_VERSION_ID,
  );
  assert.throws(
    () =>
      parseWorkerVersionViewOutput(
        JSON.stringify({
          ...versionViewRecord(),
          annotations: {
            "workers/tag": "wrong-release-tag",
            "workers/message": RELEASE_MESSAGE,
          },
        }),
        CANDIDATE_VERSION_ID,
        releaseAnnotations(),
      ),
    /tag or message does not match/i,
  );
  assert.throws(
    () =>
      parseWorkerVersionViewOutput(
        versionViewOutput(),
        CANDIDATE_VERSION_ID,
        {
          releaseTag: RELEASE_TAG,
          releaseMessageSha256: "f".repeat(64),
        },
      ),
    /tag or message does not match/i,
  );
  assert.throws(
    () =>
      parseWorkerVersionViewOutput(
        JSON.stringify({
          ...versionViewRecord(),
          annotations: { "workers/tag": RELEASE_TAG },
        }),
        CANDIDATE_VERSION_ID,
        releaseAnnotations(),
      ),
    /workers\/message/i,
  );
});

test("authoritative deployment parser rejects malformed, duplicate, and non-total traffic", () => {
  const status = parseWorkerDeploymentStatusOutput(
    JSON.stringify({
      ...statusRecord(BASELINE_DEPLOYMENT_ID, [[BASELINE_VERSION_ID, 100]]),
      unknown_provider_field: true,
    }),
  );
  assert.equal(status.deploymentId, BASELINE_DEPLOYMENT_ID);
  assert.deepEqual(status.versions, [
    { versionId: BASELINE_VERSION_ID, percentage: 100 },
  ]);

  assert.throws(
    () =>
      parseWorkerDeploymentStatusOutput(
        statusOutput(BASELINE_DEPLOYMENT_ID, [
          [BASELINE_VERSION_ID, 50],
          [BASELINE_VERSION_ID, 50],
        ]),
      ),
    /duplicate version UUIDs/i,
  );
  assert.throws(
    () =>
      parseWorkerDeploymentStatusOutput(
        statusOutput(BASELINE_DEPLOYMENT_ID, [
          [BASELINE_VERSION_ID, 90],
        ]),
      ),
    /total exactly 100/i,
  );
  assert.throws(
    () =>
      parseWorkerDeploymentStatusOutput(
        JSON.stringify({
          id: BASELINE_DEPLOYMENT_ID,
          versions: [
            { version_id: BASELINE_VERSION_ID, percentage: "100" },
          ],
        }),
      ),
    /finite percentage/i,
  );
});

test("topology parsers enforce inactive, staged zero-traffic, and exact activation states", () => {
  const sole = parseSoleBaselineTopology(
    statusOutput(BASELINE_DEPLOYMENT_ID, [
      [BASELINE_VERSION_ID, 100],
    ]),
    BASELINE_VERSION_ID,
  );
  assert.equal(sole.serviceBaselineVersionId, BASELINE_VERSION_ID);

  const staged = parseStagedWorkerTopology(
    statusOutput(STAGED_DEPLOYMENT_ID, [
      [CANDIDATE_VERSION_ID, 0],
      [BASELINE_VERSION_ID, 100],
    ]),
    BASELINE_VERSION_ID,
    CANDIDATE_VERSION_ID,
  );
  assert.equal(staged.baselinePercentage, 100);
  assert.equal(staged.candidatePercentage, 0);

  const active = parseActivatedWorkerTopology(
    statusOutput(ACTIVATION_DEPLOYMENT_ID, [
      [CANDIDATE_VERSION_ID, 100],
    ]),
    CANDIDATE_VERSION_ID,
    ACTIVATION_DEPLOYMENT_ID,
  );
  assert.equal(active.targetCandidateVersionId, CANDIDATE_VERSION_ID);

  assert.throws(
    () =>
      parseSoleBaselineTopology(
        statusOutput(BASELINE_DEPLOYMENT_ID, [
          [OTHER_VERSION_ID, 100],
        ]),
        BASELINE_VERSION_ID,
      ),
    /exact service baseline/i,
  );
  assert.throws(
    () =>
      parseStagedWorkerTopology(
        statusOutput(STAGED_DEPLOYMENT_ID, [
          [BASELINE_VERSION_ID, 99],
          [CANDIDATE_VERSION_ID, 1],
        ]),
        BASELINE_VERSION_ID,
        CANDIDATE_VERSION_ID,
      ),
    /exactly baseline 100% plus candidate 0%/i,
  );
  assert.throws(
    () =>
      parseStagedWorkerTopology(
        statusOutput(STAGED_DEPLOYMENT_ID, [
          [BASELINE_VERSION_ID, 100],
          [CANDIDATE_VERSION_ID, 0],
          [OTHER_VERSION_ID, 0],
        ]),
        BASELINE_VERSION_ID,
        CANDIDATE_VERSION_ID,
      ),
    /no extra versions/i,
  );
  assert.throws(
    () =>
      parseActivatedWorkerTopology(
        statusOutput(ACTIVATION_DEPLOYMENT_ID, [
          [OTHER_VERSION_ID, 100],
        ]),
        CANDIDATE_VERSION_ID,
        ACTIVATION_DEPLOYMENT_ID,
      ),
    /exact uploaded candidate/i,
  );
  assert.throws(
    () =>
      parseActivatedWorkerTopology(
        statusOutput(OTHER_VERSION_ID, [
          [CANDIDATE_VERSION_ID, 100],
        ]),
        CANDIDATE_VERSION_ID,
        ACTIVATION_DEPLOYMENT_ID,
      ),
    /output deployment ID/i,
  );
});

test("upload evidence rejects UUID drift, baseline drift, and resource/config mismatch", () => {
  const valid = buildUploadEvidence();
  assert.equal(valid.kind, WORKER_CANDIDATE_UPLOAD_EVIDENCE_KIND);
  assert.equal(valid.candidateState, "inactive");
  assert.notEqual(
    valid.targetCandidateVersionId,
    valid.serviceBaselineVersionId,
  );

  assert.throws(
    () =>
      parseWorkerCandidateUploadEvidence({
        ...valid,
        targetCandidateVersionId: OTHER_VERSION_ID,
      }),
    /exact candidate UUID/i,
  );
  assert.throws(
    () =>
      parseWorkerCandidateUploadEvidence({
        ...valid,
        serviceBaselineVersionId: OTHER_VERSION_ID,
      }),
    /exact sole-active service baseline/i,
  );
  assert.throws(
    () =>
      buildUploadEvidence({ expectedResourceConfigSha256: "f".repeat(64) }),
    /resource\/config signature differs/i,
  );
  assert.throws(
    () =>
      buildWorkerCandidateUploadEvidence({
        ...uploadBuilderInput(),
        git: { ...GIT, upstream: "b".repeat(40) },
      }),
    /HEAD must equal/i,
  );
});

test("staged and activation builders form one immutable hash-bound release chain", () => {
  const upload = buildUploadEvidence();
  const uploadSha256 = workerCandidateEvidenceSha256(upload);
  const staged = buildStagedEvidence(upload, uploadSha256);
  const stagedSha256 = workerCandidateEvidenceSha256(staged);
  const activation = buildActivationEvidence(
    upload,
    uploadSha256,
    staged,
    stagedSha256,
  );

  assert.equal(staged.uploadEvidenceSha256, uploadSha256);
  assert.equal(activation.stagedEvidenceSha256, stagedSha256);
  assert.equal(
    activation.targetCandidateVersionId,
    upload.targetCandidateVersionId,
  );
  assert.equal(activation.kind, WORKER_CANDIDATE_ACTIVATION_EVIDENCE_KIND);
  assert.deepEqual(
    verifyWorkerCandidateStagedEvidence({
      uploadEvidence: upload,
      uploadEvidenceSha256: uploadSha256,
      stagedEvidence: staged,
      stagedEvidenceSha256: stagedSha256,
    }),
    staged,
  );
  assert.deepEqual(
    verifyWorkerCandidateActivationEvidence({
      uploadEvidence: upload,
      uploadEvidenceSha256: uploadSha256,
      stagedEvidence: staged,
      stagedEvidenceSha256: stagedSha256,
      activationEvidence: activation,
      activationEvidenceSha256: workerCandidateEvidenceSha256(activation),
    }),
    activation,
  );
});

test("hash chain fails closed on upload, staged, candidate, or deployment drift", () => {
  const upload = buildUploadEvidence();
  const uploadSha256 = workerCandidateEvidenceSha256(upload);
  const staged = buildStagedEvidence(upload, uploadSha256);
  const stagedSha256 = workerCandidateEvidenceSha256(staged);
  const activation = buildActivationEvidence(
    upload,
    uploadSha256,
    staged,
    stagedSha256,
  );

  assert.throws(
    () =>
      buildWorkerCandidateStagedEvidence({
        createdAt: STAGED_EVIDENCE_AT,
        uploadEvidence: upload,
        uploadEvidenceSha256: "f".repeat(64),
        deployOutput: stagedDeployOutputEvent(),
        topology: staged.topology,
      }),
    /wrong immutable upload evidence hash/i,
  );
  assert.throws(
    () =>
      parseWorkerCandidateStagedEvidence({
        ...staged,
        targetCandidateVersionId: OTHER_VERSION_ID,
      }),
    /drifted from the immutable upload/i,
  );
  assert.throws(
    () =>
      parseWorkerCandidateStagedEvidence({
        ...staged,
        deployOutput: {
          ...staged.deployOutput,
          deploymentId: OTHER_VERSION_ID,
        },
      }),
    /staging output deployment ID/i,
  );
  assert.throws(
    () =>
      parseWorkerCandidateActivationEvidence({
        ...activation,
        targetCandidateVersionId: OTHER_VERSION_ID,
      }),
    /drifted from the sealed staged/i,
  );
  assert.throws(
    () =>
      parseWorkerCandidateActivationEvidence({
        ...activation,
        stagedEvidenceSha256: "e".repeat(64),
      }),
    /wrong immutable staged evidence hash/i,
  );
  assert.throws(
    () =>
      parseWorkerCandidateActivationEvidence({
        ...activation,
        deployOutput: {
          ...activation.deployOutput,
          deploymentId: OTHER_VERSION_ID,
        },
      }),
    /deployment ID must match/i,
  );
});

test("owner-only canonical evidence publishing is exclusive and stable", () => {
  const fixture = makeEvidenceDirectory("worker-candidate-private-");
  const file = path.join(fixture.cloudflare, "upload.json");
  try {
    const evidence = buildUploadEvidence();
    const handle = writeWorkerCandidateEvidence(file, evidence);
    assert.equal(handle.path, file);
    assert.equal(handle.sha256, workerCandidateEvidenceSha256(evidence));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const bytes = fs.readFileSync(file, "utf8");
    assert.equal(bytes.endsWith("\n"), true);
    assert.equal(bytes.includes("\n "), false);
    assert.deepEqual(readWorkerCandidateUploadEvidence(file), handle);

    assert.throws(
      () => writeWorkerCandidateEvidence(file, evidence),
      /could not be published atomically without replacement/i,
    );
    assert.deepEqual(readWorkerCandidateUploadEvidence(file), handle);
    assert.equal(
      fs.readdirSync(fixture.cloudflare).some((entry) => entry.endsWith(".tmp")),
      false,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("private evidence read rejects broad mode, symlink, hardlink, and noncanonical bytes", () => {
  const fixture = makeEvidenceDirectory("worker-candidate-hostile-file-");
  try {
    const file = path.join(fixture.cloudflare, "upload.json");
    const evidence = buildUploadEvidence();
    writeWorkerCandidateEvidence(file, evidence);

    fs.chmodSync(file, 0o644);
    assert.throws(
      () => readWorkerCandidateUploadEvidence(file),
      /owner-only mode-0600/i,
    );
    fs.chmodSync(file, 0o600);

    const hardlink = path.join(fixture.cloudflare, "hardlink.json");
    fs.linkSync(file, hardlink);
    assert.throws(
      () => readWorkerCandidateUploadEvidence(file),
      /one link/i,
    );
    fs.unlinkSync(hardlink);

    const symlink = path.join(fixture.cloudflare, "symlink.json");
    fs.symlinkSync(file, symlink);
    assert.throws(
      () => readWorkerCandidateUploadEvidence(symlink),
      /nofollow owner-only/i,
    );

    const noncanonical = path.join(fixture.cloudflare, "noncanonical.json");
    fs.writeFileSync(noncanonical, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
    });
    assert.throws(
      () => readWorkerCandidateUploadEvidence(noncanonical),
      /not exact canonical JSON/i,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("no-network finalizers publish exact upload, staged, and activation evidence", () => {
  const fixture = makeEvidenceDirectory("worker-candidate-finalizers-");
  const uploadFile = workerCandidateUploadEvidencePath(fixture.root);
  const stagedFile = workerCandidateStagedEvidencePath(fixture.root);
  const activationFile = workerCandidateActivationEvidencePath(fixture.root);
  try {
    const upload = finalizeWorkerCandidateUploadEvidence({
      file: uploadFile,
      createdAt: UPLOAD_EVIDENCE_AT,
      targetCandidateVersionId: CANDIDATE_VERSION_ID,
      serviceBaselineVersionId: BASELINE_VERSION_ID,
      expectedReleaseTag: RELEASE_TAG,
      expectedReleaseMessageSha256: RELEASE_MESSAGE_SHA256,
      uploadCommandEvidenceSha256: "5".repeat(64),
      workerDeployPreparationSha256: "6".repeat(64),
      git: GIT,
      artifacts: ARTIFACTS,
      uploadOutput: uploadOutput(),
      versionsViewOutput: versionViewOutput(),
      baselineStatusOutput: statusOutput(BASELINE_DEPLOYMENT_ID, [
        [BASELINE_VERSION_ID, 100],
      ]),
    });
    const staged = finalizeWorkerCandidateStagedEvidence({
      file: stagedFile,
      createdAt: STAGED_EVIDENCE_AT,
      uploadHandle: upload,
      deployOutput: stagedDeployOutput(),
      stagedStatusOutput: statusOutput(STAGED_DEPLOYMENT_ID, [
        [BASELINE_VERSION_ID, 100],
        [CANDIDATE_VERSION_ID, 0],
      ]),
    });
    const activation = finalizeWorkerCandidateActivationEvidence({
      file: activationFile,
      createdAt: ACTIVATION_EVIDENCE_AT,
      uploadHandle: upload,
      stagedHandle: staged,
      preActivationSealHandle: writeTestPreActivationSeal(
        fixture.root,
        upload,
        staged,
      ),
      // The intentionally false traffic map proves it is never authoritative.
      deployOutput: deployOutput({ [OTHER_VERSION_ID]: 100 }),
      activationStatusOutput: statusOutput(ACTIVATION_DEPLOYMENT_ID, [
        [CANDIDATE_VERSION_ID, 100],
      ]),
    });

    assert.equal(
      activation.value.targetCandidateVersionId,
      CANDIDATE_VERSION_ID,
    );
    assert.equal(
      activation.value.deployOutput.deploymentId,
      ACTIVATION_DEPLOYMENT_ID,
    );
    assert.deepEqual(
      readWorkerCandidateActivationEvidence(activationFile),
      activation,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("activation finalizer rejects a fresh UUID or split topology despite successful output", () => {
  const fixture = makeEvidenceDirectory("worker-candidate-finalizer-hostile-");
  const uploadFile = workerCandidateUploadEvidencePath(fixture.root);
  const stagedFile = workerCandidateStagedEvidencePath(fixture.root);
  const activationFile = workerCandidateActivationEvidencePath(fixture.root);
  try {
    const upload = writeWorkerCandidateEvidence(
      uploadFile,
      buildUploadEvidence(),
    );
    const stagedValue = buildStagedEvidence(upload.value, upload.sha256);
    const staged = writeWorkerCandidateEvidence(
      stagedFile,
      stagedValue,
    );
    const preActivationSeal = writeTestPreActivationSeal(
      fixture.root,
      upload,
      staged,
    );

    assert.throws(
      () =>
        finalizeWorkerCandidateActivationEvidence({
          file: activationFile,
          createdAt: ACTIVATION_EVIDENCE_AT,
          uploadHandle: upload,
          stagedHandle: staged,
          preActivationSealHandle: preActivationSeal,
          deployOutput: deployOutput({ [CANDIDATE_VERSION_ID]: 100 }),
          activationStatusOutput: statusOutput(ACTIVATION_DEPLOYMENT_ID, [
            [OTHER_VERSION_ID, 100],
          ]),
        }),
      /exact uploaded candidate/i,
    );
    assert.throws(
      () =>
        finalizeWorkerCandidateActivationEvidence({
          file: activationFile,
          createdAt: ACTIVATION_EVIDENCE_AT,
          uploadHandle: upload,
          stagedHandle: staged,
          preActivationSealHandle: preActivationSeal,
          deployOutput: deployOutput({ [CANDIDATE_VERSION_ID]: 100 }),
          activationStatusOutput: statusOutput(ACTIVATION_DEPLOYMENT_ID, [
            [CANDIDATE_VERSION_ID, 90],
            [BASELINE_VERSION_ID, 10],
          ]),
        }),
      /exact uploaded candidate alone at 100%/i,
    );
    assert.equal(fs.existsSync(activationFile), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("phase finalizers reject synthetic paths and re-read prior evidence nofollow", () => {
  const fixture = makeEvidenceDirectory("worker-candidate-file-backed-");
  const uploadFile = workerCandidateUploadEvidencePath(fixture.root);
  const stagedFile = workerCandidateStagedEvidencePath(fixture.root);
  try {
    const upload = writeWorkerCandidateEvidence(
      uploadFile,
      buildUploadEvidence(),
    );
    assert.throws(
      () =>
        finalizeWorkerCandidateStagedEvidence({
          file: stagedFile,
          createdAt: STAGED_EVIDENCE_AT,
          uploadHandle: {
            ...upload,
            path: path.join(fixture.cloudflare, "synthetic-upload.json"),
          },
          deployOutput: stagedDeployOutput(),
          stagedStatusOutput: statusOutput(STAGED_DEPLOYMENT_ID, [
            [BASELINE_VERSION_ID, 100],
            [CANDIDATE_VERSION_ID, 0],
          ]),
        }),
      /canonical release path/i,
    );

    fs.chmodSync(uploadFile, 0o644);
    assert.throws(
      () =>
        finalizeWorkerCandidateStagedEvidence({
          file: stagedFile,
          createdAt: STAGED_EVIDENCE_AT,
          uploadHandle: upload,
          deployOutput: stagedDeployOutput(),
          stagedStatusOutput: statusOutput(STAGED_DEPLOYMENT_ID, [
            [BASELINE_VERSION_ID, 100],
            [CANDIDATE_VERSION_ID, 0],
          ]),
        }),
      /owner-only mode-0600/i,
    );
    assert.equal(fs.existsSync(stagedFile), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

function uploadBuilderInput() {
  const uploadOutputEvent = parseWorkerVersionUploadOutput(uploadOutput());
  return {
    createdAt: UPLOAD_EVIDENCE_AT,
    targetCandidateVersionId: CANDIDATE_VERSION_ID,
    serviceBaselineVersionId: BASELINE_VERSION_ID,
    expectedReleaseTag: RELEASE_TAG,
    expectedReleaseMessageSha256: RELEASE_MESSAGE_SHA256,
    uploadCommandEvidenceSha256: "5".repeat(64),
    workerDeployPreparationSha256: "6".repeat(64),
    git: GIT,
    artifacts: ARTIFACTS,
    uploadOutput: uploadOutputEvent,
    versionView: parseWorkerVersionViewOutput(
      versionViewOutput(),
      CANDIDATE_VERSION_ID,
      releaseAnnotations(),
    ),
    soleBaselineTopology: parseSoleBaselineTopology(
      statusOutput(BASELINE_DEPLOYMENT_ID, [
        [BASELINE_VERSION_ID, 100],
      ]),
      BASELINE_VERSION_ID,
    ),
  };
}

function buildUploadEvidence(
  overrides: Readonly<{ expectedResourceConfigSha256?: string }> = {},
): WorkerCandidateUploadEvidence {
  return buildWorkerCandidateUploadEvidence({
    ...uploadBuilderInput(),
    ...overrides,
  });
}

function buildStagedEvidence(
  upload: WorkerCandidateUploadEvidence,
  uploadSha256: string,
): WorkerCandidateStagedEvidence {
  return buildWorkerCandidateStagedEvidence({
    createdAt: STAGED_EVIDENCE_AT,
    uploadEvidence: upload,
    uploadEvidenceSha256: uploadSha256,
    deployOutput: stagedDeployOutputEvent(),
    topology: parseStagedWorkerTopology(
      statusOutput(STAGED_DEPLOYMENT_ID, [
        [BASELINE_VERSION_ID, 100],
        [CANDIDATE_VERSION_ID, 0],
      ]),
      BASELINE_VERSION_ID,
      CANDIDATE_VERSION_ID,
    ),
  });
}

function buildActivationEvidence(
  upload: WorkerCandidateUploadEvidence,
  uploadSha256: string,
  staged: WorkerCandidateStagedEvidence,
  stagedSha256: string,
): WorkerCandidateActivationEvidence {
  const output = parseWorkerVersionDeployOutput(deployOutput({}));
  return buildWorkerCandidateActivationEvidence({
    createdAt: ACTIVATION_EVIDENCE_AT,
    uploadEvidence: upload,
    uploadEvidenceSha256: uploadSha256,
    stagedEvidence: staged,
    stagedEvidenceSha256: stagedSha256,
    preActivationSealSha256: PRE_ACTIVATION_SEAL_SHA256,
    deployOutput: output,
    topology: parseActivatedWorkerTopology(
      statusOutput(ACTIVATION_DEPLOYMENT_ID, [
        [CANDIDATE_VERSION_ID, 100],
      ]),
      CANDIDATE_VERSION_ID,
      output.deploymentId,
    ),
  });
}

function uploadOutput(
  versionId = CANDIDATE_VERSION_ID,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return ndjson({
    type: "version-upload",
    version: 1,
    worker_name: "inspirlearning",
    worker_tag: "worker-service-tag",
    version_id: versionId,
    preview_url: null,
    preview_alias_url: null,
    worker_name_overridden: false,
    timestamp: UPLOAD_EVENT_AT,
    ...overrides,
  });
}

function deployOutput(
  versionTraffic: Readonly<Record<string, number>>,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return ndjson({
    type: "version-deploy",
    version: 1,
    worker_name: "inspirlearning",
    worker_tag: "worker-service-tag",
    deployment_id: ACTIVATION_DEPLOYMENT_ID,
    version_traffic: versionTraffic,
    timestamp: DEPLOY_EVENT_AT,
    ...overrides,
  });
}

function stagedDeployOutput() {
  return deployOutput(
    { [BASELINE_VERSION_ID]: 100, [CANDIDATE_VERSION_ID]: 0 },
    {
      deployment_id: STAGED_DEPLOYMENT_ID,
      timestamp: STAGE_DEPLOY_EVENT_AT,
    },
  );
}

function stagedDeployOutputEvent() {
  return parseWorkerVersionDeployOutput(stagedDeployOutput());
}

function ndjson(value: Readonly<Record<string, unknown>>) {
  return `${JSON.stringify(value)}\n`;
}

function versionViewOutput(
  resources: Readonly<Record<string, unknown>> = defaultResources(),
) {
  return JSON.stringify(versionViewRecord(resources));
}

function versionViewRecord(
  resources: Readonly<Record<string, unknown>> = defaultResources(),
) {
  return {
    id: CANDIDATE_VERSION_ID,
    number: 7,
    metadata: {
      author_email: "release@example.com",
      created_on: UPLOAD_EVENT_AT,
      source: "wrangler",
    },
    annotations: {
      "workers/tag": RELEASE_TAG,
      "workers/message": RELEASE_MESSAGE,
    },
    resources,
  };
}

function releaseAnnotations() {
  return {
    releaseTag: RELEASE_TAG,
    releaseMessageSha256: RELEASE_MESSAGE_SHA256,
  };
}

function defaultResources() {
  return {
    bindings: [
      { type: "d1", name: "DB", id: "database-id" },
      { type: "secret_text", name: "API_SECRET" },
    ],
    script: { etag: "etag-1", handlers: ["fetch", "scheduled"] },
    script_runtime: {
      compatibility_date: "2026-07-01",
      compatibility_flags: ["nodejs_compat"],
    },
  };
}

function statusOutput(
  deploymentId: string,
  versions: readonly (readonly [string, number])[],
) {
  return JSON.stringify(statusRecord(deploymentId, versions));
}

function statusRecord(
  deploymentId: string,
  versions: readonly (readonly [string, number])[],
) {
  return {
    id: deploymentId,
    strategy: "percentage",
    source: "wrangler",
    author_email: "release@example.com",
    created_on: UPLOAD_EVENT_AT,
    annotations: { "workers/message": "release" },
    versions: versions.map(([versionId, percentage]) => ({
      version_id: versionId,
      percentage,
    })),
  };
}

function writeTestPreActivationSeal(
  backupDirectory: string,
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>,
  staged: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>,
) {
  const evidence = (name: string, scope: "backup" | "workspace" = "backup") => ({
    scope,
    absolutePath: path.join(backupDirectory, `${name}.json`),
    bytes: 128,
    sha256: "8".repeat(64),
  });
  const prerequisites = {
    vectorize: {
      evidence: evidence("vectorize"),
      createdAt: "2026-07-15T10:02:05.000Z",
      phase: "uploaded-inactive" as const,
      soleServingVersionId: BASELINE_VERSION_ID,
      vectorCount: 1,
    },
    topic: {
      evidence: evidence("topic"),
      createdAt: "2026-07-14T10:00:00.000Z",
      seedSha256: "9".repeat(64),
      verifiedTopics: 1,
      verifiedArchivedTopics: 0,
    },
    translation: {
      evidence: evidence("translation"),
      createdAt: "2026-07-14T10:01:00.000Z",
      method: "read-only-drift" as const,
      remoteQueries: 1,
      billedRowsRead: 1,
      repairApplied: false,
    },
    runtimeMigrations0013To0016: {
      evidence: evidence("runtime-0013-0016"),
      createdAt: "2026-07-15T10:02:06.000Z",
    },
    runtimeMigration0017: {
      evidence: evidence("runtime-0017"),
      createdAt: "2026-07-14T10:02:00.000Z",
    },
    fresh0016Cutover: {
      evidence: evidence("fresh-0016"),
      createdAt: "2026-07-15T10:02:07.000Z",
      cutoverRunId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      workerRelease: {
        phase: "uploaded-inactive" as const,
        targetCandidateVersionId: upload.value.targetCandidateVersionId,
        serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
        uploadEvidenceSha256: upload.sha256,
      },
      finalizationLiveTopologySha256: "7".repeat(64),
      serviceBaselineDeploymentId:
        "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      targetCandidateState: "absent" as const,
      predecessorPrerequisitesSha256: "a".repeat(64),
      continuityDecisionsSha256: "b".repeat(64),
      outboxRowsBeforeActivation: 0 as const,
    },
    semanticTranslations: {
      releaseMode: "full-semantic" as const,
      evidence: evidence("semantic-translations", "workspace"),
      curatedTreeSha256: "c".repeat(64),
      semanticEvidenceSha256: "d".repeat(64),
    },
  };
  const release = {
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    stagedEvidenceSha256: staged.sha256,
  };
  const preparation = {
    sha256: "6".repeat(64),
    createdAt: "2026-07-15T10:02:00.000Z",
    validUntil: "2026-07-15T10:30:00.000Z",
  };
  const preflight = {
    workerTopologyPhase: "candidate-staged" as const,
    createdAt: "2026-07-15T10:02:20.000Z",
    reportCanonicalSha256: "e".repeat(64),
    checksCanonicalSha256: "f".repeat(64),
    passedChecks: 10,
  };
  const versionOverrideSmoke = {
    evidence: {
      scope: "backup" as const,
      absolutePath: path.join(
        backupDirectory,
        "cloudflare/worker-candidate-version-override-smoke.json",
      ),
      bytes: 512,
      sha256: "0".repeat(64),
    },
    createdAt: "2026-07-15T10:02:21.000Z",
    validUntil: "2026-07-15T10:32:21.000Z",
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    stagedEvidenceSha256: staged.sha256,
    stagedDeploymentId: staged.value.topology.deploymentId,
    stagedTopologySha256: "1".repeat(64),
    unpinnedResponseSha256: "2".repeat(64),
    candidateResponseSha256: "3".repeat(64),
  };
  const prerequisitesSha256 =
    workerCandidatePreActivationCanonicalValueSha256(prerequisites);
  const authorizationMaterial = {
    release,
    git: GIT,
    artifacts: ARTIFACTS,
    preparation,
    preflight,
    versionOverrideSmoke,
    prerequisites,
    prerequisitesSha256,
  };
  const value = parseWorkerCandidatePreActivationSeal({
    kind: WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_KIND,
    schemaVersion: 1,
    phase: "candidate-staged",
    createdAt: "2026-07-15T10:02:30.000Z",
    validUntil: "2026-07-15T10:22:30.000Z",
    maximumAgeMs: 20 * 60 * 1_000,
    backupDirectory: path.resolve(backupDirectory),
    ...authorizationMaterial,
    authorizationMaterialSha256:
      workerCandidatePreActivationCanonicalValueSha256(
        authorizationMaterial,
      ),
  });
  return writeWorkerCandidatePreActivationSeal(
    workerCandidatePreActivationSealPath(backupDirectory),
    value,
  );
}

function makeEvidenceDirectory(prefix: string) {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = fs.realpathSync.native(created);
  fs.chmodSync(root, 0o700);
  const cloudflare = path.join(root, "cloudflare");
  fs.mkdirSync(cloudflare, { mode: 0o700 });
  fs.chmodSync(cloudflare, 0o700);
  return { root, cloudflare };
}
