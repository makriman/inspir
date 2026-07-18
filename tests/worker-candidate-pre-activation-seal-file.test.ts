import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_KIND,
  WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS,
  assertFileBackedWorkerCandidatePreActivationSealHandle,
  parseWorkerCandidatePreActivationSeal,
  readWorkerCandidatePreActivationSeal,
  workerCandidatePreActivationCanonicalValueSha256,
  workerCandidatePreActivationSealPath,
  writeWorkerCandidatePreActivationSeal,
  type WorkerCandidatePreActivationPrerequisites,
  type WorkerCandidatePreActivationSeal,
} from "../scripts/cloudflare/worker-candidate-pre-activation-seal-file";

const BASELINE_VERSION_ID = "11111111-1111-1111-1111-111111111111";
const CANDIDATE_VERSION_ID = "22222222-2222-2222-2222-222222222222";
const CREATED_AT = "2026-07-15T10:10:00.000Z";
const VALID_UNTIL = "2026-07-15T10:55:00.000Z";

const GIT = Object.freeze({
  head: "a".repeat(40),
  upstream: "a".repeat(40),
  upstreamRef: "refs/remotes/origin/codex/release",
});

const ARTIFACTS = Object.freeze({
  sourceFingerprintSha256: "1".repeat(64),
  sourceFingerprintFileCount: 321,
  workerSourceSha256: "2".repeat(64),
  wranglerConfigSha256: "3".repeat(64),
  assetManifestSha256: "4".repeat(64),
  assetManifestFileCount: 42,
  assetManifestBytes: 9_999,
});

test("seal schema binds authorization hashes and exact chronology", () => {
  const fixture = makePrivateBackup("worker-pre-activation-schema-");
  try {
    const valid = buildSeal(fixture.root);
    assert.equal(
      valid.authorizationMaterialSha256,
      authorizationMaterialSha256(valid),
    );

    assert.throws(
      () =>
        parseWorkerCandidatePreActivationSeal({
          ...valid,
          prerequisites: {
            ...valid.prerequisites,
            vectorize: {
              ...valid.prerequisites.vectorize,
              vectorCount: valid.prerequisites.vectorize.vectorCount + 1,
            },
          },
        }),
      /chronology, candidate identity, or preparation validity/i,
    );
    assert.throws(
      () =>
        parseWorkerCandidatePreActivationSeal({
          ...valid,
          authorizationMaterialSha256: "f".repeat(64),
        }),
      /chronology, candidate identity, or preparation validity/i,
    );
    assert.throws(
      () =>
        buildSeal(fixture.root, {
          release: {
            ...valid.release,
            targetCandidateVersionId: BASELINE_VERSION_ID,
          },
        }),
      /chronology, candidate identity, or preparation validity/i,
    );
    assert.throws(
      () =>
        buildSeal(fixture.root, {
          preparation: {
            ...valid.preparation,
            createdAt: "2026-07-15T10:10:01.000Z",
          },
        }),
      /chronology, candidate identity, or preparation validity/i,
    );
    assert.throws(
      () =>
        buildSeal(fixture.root, {
          preflight: {
            ...valid.preflight,
            createdAt: "2026-07-15T10:10:01.000Z",
          },
        }),
      /chronology, candidate identity, or preparation validity/i,
    );
    assert.throws(
      () =>
        buildSeal(fixture.root, {
          preparation: {
            ...valid.preparation,
            validUntil: "2026-07-15T10:54:59.999Z",
          },
        }),
      /chronology, candidate identity, or preparation validity/i,
    );
    assert.throws(
      () =>
        buildSeal(fixture.root, {
          versionOverrideSmoke: {
            ...valid.versionOverrideSmoke,
            targetCandidateVersionId: BASELINE_VERSION_ID,
          },
        }),
      /chronology, candidate identity, or preparation validity/i,
    );
    assert.throws(
      () =>
        buildSeal(fixture.root, {
          versionOverrideSmoke: {
            ...valid.versionOverrideSmoke,
            validUntil: "2026-07-15T10:54:59.999Z",
          },
        }),
      /chronology, candidate identity, or preparation validity/i,
    );
  } finally {
    fixture.cleanup();
  }
});

test("seal schema rejects prerequisite evidence created after authorization", () => {
  const fixture = makePrivateBackup("worker-pre-activation-future-prerequisite-");
  try {
    const prerequisites = buildPrerequisites(fixture.root);
    assert.throws(
      () =>
        buildSeal(fixture.root, {
          prerequisites: {
            ...prerequisites,
            runtimeMigration0017: {
              ...prerequisites.runtimeMigration0017,
              createdAt: "2026-07-15T10:10:00.001Z",
            },
          },
        }),
      /prerequisite.*after|chronology/i,
    );
  } finally {
    fixture.cleanup();
  }
});

test("seal publication is canonical, owner-only, one-link, and exclusive", () => {
  const fixture = makePrivateBackup("worker-pre-activation-publication-");
  try {
    const value = buildSeal(fixture.root);
    const canonicalPath = workerCandidatePreActivationSealPath(fixture.root);
    const handle = writeWorkerCandidatePreActivationSeal(canonicalPath, value);

    assert.equal(handle.path, canonicalPath);
    assert.equal(fs.statSync(canonicalPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(canonicalPath).nlink, 1);
    assert.deepEqual(readWorkerCandidatePreActivationSeal(canonicalPath), handle);
    assert.deepEqual(
      assertFileBackedWorkerCandidatePreActivationSealHandle(
        handle,
        canonicalPath,
      ),
      handle,
    );
    assert.throws(
      () => writeWorkerCandidatePreActivationSeal(canonicalPath, value),
      /published exclusively/i,
    );
    assert.throws(
      () =>
        writeWorkerCandidatePreActivationSeal(
          path.join(fixture.cloudflare, "noncanonical-seal.json"),
          value,
        ),
      /canonical backup path/i,
    );

    const hardlink = path.join(fixture.cloudflare, "seal-hardlink.json");
    fs.linkSync(canonicalPath, hardlink);
    assert.throws(
      () => readWorkerCandidatePreActivationSeal(canonicalPath),
      /one-link owner-only/i,
    );
    fs.unlinkSync(hardlink);

    fs.chmodSync(canonicalPath, 0o640);
    assert.throws(
      () => readWorkerCandidatePreActivationSeal(canonicalPath),
      /one-link owner-only/i,
    );
  } finally {
    fixture.cleanup();
  }
});

test("seal publication rejects a writable or indirect canonical directory", async (t) => {
  await t.test("group-writable", () => {
    const fixture = makePrivateBackup("worker-pre-activation-writable-dir-");
    try {
      fs.chmodSync(fixture.cloudflare, 0o770);
      assert.throws(
        () =>
          writeWorkerCandidatePreActivationSeal(
            workerCandidatePreActivationSealPath(fixture.root),
            buildSeal(fixture.root),
          ),
        /not group\/world writable/i,
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("symlinked", () => {
    const fixture = makePrivateBackup("worker-pre-activation-symlink-dir-");
    const target = fs.mkdtempSync(
      path.join(os.tmpdir(), "worker-pre-activation-symlink-target-"),
    );
    try {
      fs.chmodSync(target, 0o700);
      fs.rmSync(fixture.cloudflare, { recursive: true });
      fs.symlinkSync(target, fixture.cloudflare);
      assert.throws(
        () =>
          writeWorkerCandidatePreActivationSeal(
            workerCandidatePreActivationSealPath(fixture.root),
            buildSeal(fixture.root),
          ),
        /directory must be real/i,
      );
    } finally {
      fixture.cleanup();
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});

test("a replaced canonical seal invalidates the previously authorized handle", () => {
  const fixture = makePrivateBackup("worker-pre-activation-replaced-");
  try {
    const canonicalPath = workerCandidatePreActivationSealPath(fixture.root);
    const initial = writeWorkerCandidatePreActivationSeal(
      canonicalPath,
      buildSeal(fixture.root),
    );
    fs.renameSync(canonicalPath, `${canonicalPath}.initial`);
    writeWorkerCandidatePreActivationSeal(
      canonicalPath,
      buildSeal(fixture.root, {
        preflight: {
          ...initial.value.preflight,
          passedChecks: initial.value.preflight.passedChecks + 1,
        },
      }),
    );

    assert.throws(
      () =>
        assertFileBackedWorkerCandidatePreActivationSealHandle(
          initial,
          canonicalPath,
        ),
      /not the exact nofollow file-backed seal/i,
    );
  } finally {
    fixture.cleanup();
  }
});

test("stable seal reads reject a named-path swap after descriptor read", (t) => {
  const fixture = makePrivateBackup("worker-pre-activation-path-swap-");
  try {
    const canonicalPath = workerCandidatePreActivationSealPath(fixture.root);
    const initial = writeWorkerCandidatePreActivationSeal(
      canonicalPath,
      buildSeal(fixture.root),
    );
    const parkedInitial = `${canonicalPath}.parked-initial`;
    const parkedReplacement = `${canonicalPath}.parked-replacement`;
    fs.renameSync(canonicalPath, parkedInitial);
    writeWorkerCandidatePreActivationSeal(
      canonicalPath,
      buildSeal(fixture.root, {
        preflight: {
          ...initial.value.preflight,
          passedChecks: initial.value.preflight.passedChecks + 1,
        },
      }),
    );
    fs.renameSync(canonicalPath, parkedReplacement);
    fs.renameSync(parkedInitial, canonicalPath);

    const originalStat = fs.statSync(canonicalPath);
    const parkedAfterRead = `${canonicalPath}.parked-after-read`;
    const originalReadFileSync = fs.readFileSync;
    let swapped = false;
    t.mock.method(
      fs,
      "readFileSync",
      (
        file: fs.PathOrFileDescriptor,
        options?: Parameters<typeof fs.readFileSync>[1],
      ) => {
        const result = originalReadFileSync(file, options);
        if (!swapped && typeof file === "number") {
          const opened = fs.fstatSync(file);
          if (opened.dev === originalStat.dev && opened.ino === originalStat.ino) {
            swapped = true;
            fs.renameSync(canonicalPath, parkedAfterRead);
            fs.renameSync(parkedReplacement, canonicalPath);
          }
        }
        return result;
      },
    );

    assert.throws(
      () => readWorkerCandidatePreActivationSeal(canonicalPath),
      /(?:path )?changed during its stable read/i,
    );
    assert.equal(swapped, true);
  } finally {
    fixture.cleanup();
  }
});

test("stable seal reads reject same-inode rewrites with restored size and mtime", (t) => {
  const fixture = makePrivateBackup("worker-pre-activation-inode-rewrite-");
  try {
    const canonicalPath = workerCandidatePreActivationSealPath(fixture.root);
    const initial = writeWorkerCandidatePreActivationSeal(
      canonicalPath,
      buildSeal(fixture.root),
    );
    const parkedInitial = `${canonicalPath}.parked-initial`;
    const parkedReplacement = `${canonicalPath}.parked-replacement`;
    fs.renameSync(canonicalPath, parkedInitial);
    writeWorkerCandidatePreActivationSeal(
      canonicalPath,
      buildSeal(fixture.root, {
        preflight: {
          ...initial.value.preflight,
          passedChecks: initial.value.preflight.passedChecks + 1,
        },
      }),
    );
    const replacementBytes = fs.readFileSync(canonicalPath);
    fs.renameSync(canonicalPath, parkedReplacement);
    fs.renameSync(parkedInitial, canonicalPath);

    const originalStat = fs.statSync(canonicalPath);
    assert.equal(replacementBytes.byteLength, originalStat.size);
    const originalReadFileSync = fs.readFileSync;
    let rewritten = false;
    t.mock.method(
      fs,
      "readFileSync",
      (
        file: fs.PathOrFileDescriptor,
        options?: Parameters<typeof fs.readFileSync>[1],
      ) => {
        const result = originalReadFileSync(file, options);
        if (!rewritten && typeof file === "number") {
          const opened = fs.fstatSync(file);
          if (opened.dev === originalStat.dev && opened.ino === originalStat.ino) {
            rewritten = true;
            fs.writeFileSync(canonicalPath, replacementBytes);
            fs.utimesSync(
              canonicalPath,
              originalStat.atimeMs / 1_000,
              originalStat.mtimeMs / 1_000,
            );
          }
        }
        return result;
      },
    );

    assert.throws(
      () => readWorkerCandidatePreActivationSeal(canonicalPath),
      /changed during its stable read/i,
    );
    assert.equal(rewritten, true);
  } finally {
    fixture.cleanup();
  }
});

type SealOverrides = Readonly<{
  release?: WorkerCandidatePreActivationSeal["release"];
  preparation?: WorkerCandidatePreActivationSeal["preparation"];
  preflight?: WorkerCandidatePreActivationSeal["preflight"];
  versionOverrideSmoke?: WorkerCandidatePreActivationSeal["versionOverrideSmoke"];
  prerequisites?: WorkerCandidatePreActivationPrerequisites;
}>;

function buildSeal(
  backupDirectory: string,
  overrides: SealOverrides = {},
): WorkerCandidatePreActivationSeal {
  const release =
    overrides.release ??
    Object.freeze({
      targetCandidateVersionId: CANDIDATE_VERSION_ID,
      serviceBaselineVersionId: BASELINE_VERSION_ID,
      uploadEvidenceSha256: "5".repeat(64),
      stagedEvidenceSha256: "6".repeat(64),
    });
  const preparation =
    overrides.preparation ??
    Object.freeze({
      sha256: "7".repeat(64),
      createdAt: "2026-07-15T10:00:00.000Z",
      validUntil: "2026-07-15T22:00:00.000Z",
    });
  const preflight =
    overrides.preflight ??
    Object.freeze({
      workerTopologyPhase: "candidate-staged" as const,
      createdAt: "2026-07-15T10:09:00.000Z",
      reportCanonicalSha256: "8".repeat(64),
      checksCanonicalSha256: "9".repeat(64),
      passedChecks: 25,
    });
  const prerequisites =
    overrides.prerequisites ?? buildPrerequisites(backupDirectory);
  const versionOverrideSmoke =
    overrides.versionOverrideSmoke ??
    Object.freeze({
      evidence: {
        scope: "backup" as const,
        absolutePath: path.join(
          backupDirectory,
          "cloudflare/worker-candidate-version-override-smoke.json",
        ),
        bytes: 512,
        sha256: "a".repeat(64),
      },
      createdAt: "2026-07-15T10:09:30.000Z",
      validUntil: "2026-07-15T11:09:30.000Z",
      targetCandidateVersionId: CANDIDATE_VERSION_ID,
      serviceBaselineVersionId: BASELINE_VERSION_ID,
      uploadEvidenceSha256: release.uploadEvidenceSha256,
      stagedEvidenceSha256: release.stagedEvidenceSha256,
      stagedDeploymentId: "33333333-3333-3333-3333-333333333333",
      stagedTopologySha256: "a".repeat(64),
      unpinnedResponseSha256: "b".repeat(64),
      candidateResponseSha256: "c".repeat(64),
    });
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
  return parseWorkerCandidatePreActivationSeal({
    kind: WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_KIND,
    schemaVersion: 1,
    phase: "candidate-staged",
    createdAt: CREATED_AT,
    validUntil: VALID_UNTIL,
    maximumAgeMs: WORKER_CANDIDATE_PRE_ACTIVATION_SEAL_MAX_AGE_MS,
    backupDirectory: path.resolve(backupDirectory),
    ...authorizationMaterial,
    authorizationMaterialSha256:
      workerCandidatePreActivationCanonicalValueSha256(
        authorizationMaterial,
      ),
  });
}

function buildPrerequisites(
  backupDirectory: string,
): WorkerCandidatePreActivationPrerequisites {
  const evidence = (
    name: string,
    scope: "backup" | "workspace" = "backup",
  ) => ({
    scope,
    absolutePath: path.join(backupDirectory, `${name}.json`),
    bytes: 128,
    sha256: "b".repeat(64),
  });
  return {
    vectorize: {
      evidence: evidence("vectorize"),
      createdAt: "2026-07-15T10:01:00.000Z",
      phase: "uploaded-inactive",
      soleServingVersionId: BASELINE_VERSION_ID,
      vectorCount: 2,
    },
    topic: {
      evidence: evidence("topic"),
      createdAt: "2026-07-15T10:02:00.000Z",
      seedSha256: "c".repeat(64),
      verifiedTopics: 3,
      verifiedArchivedTopics: 1,
    },
    translation: {
      evidence: evidence("translation"),
      createdAt: "2026-07-15T10:03:00.000Z",
      method: "read-only-drift",
      remoteQueries: 1,
      billedRowsRead: 2,
      repairApplied: false,
    },
    runtimeMigrations0013To0016: {
      evidence: evidence("runtime-0013-0016"),
      createdAt: "2026-07-15T10:04:00.000Z",
    },
    runtimeMigration0017: {
      evidence: evidence("runtime-0017"),
      createdAt: "2026-07-15T10:05:00.000Z",
    },
    fresh0016Cutover: {
      evidence: evidence("fresh-0016"),
      createdAt: "2026-07-15T10:06:00.000Z",
      cutoverRunId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      workerRelease: {
        phase: "uploaded-inactive",
        targetCandidateVersionId: CANDIDATE_VERSION_ID,
        serviceBaselineVersionId: BASELINE_VERSION_ID,
        uploadEvidenceSha256: "5".repeat(64),
      },
      finalizationLiveTopologySha256: "1".repeat(64),
      serviceBaselineDeploymentId:
        "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      targetCandidateState: "absent",
      predecessorPrerequisitesSha256: "d".repeat(64),
      continuityDecisionsSha256: "e".repeat(64),
      outboxRowsBeforeActivation: 0,
    },
    semanticTranslations: {
      releaseMode: "full-semantic",
      evidence: evidence("semantic-translations", "workspace"),
      curatedTreeSha256: "f".repeat(64),
      semanticEvidenceSha256: "0".repeat(64),
    },
  };
}

function authorizationMaterialSha256(
  value: WorkerCandidatePreActivationSeal,
) {
  return workerCandidatePreActivationCanonicalValueSha256({
    release: value.release,
    git: value.git,
    artifacts: value.artifacts,
    preparation: value.preparation,
    preflight: value.preflight,
    versionOverrideSmoke: value.versionOverrideSmoke,
    prerequisites: value.prerequisites,
    prerequisitesSha256: value.prerequisitesSha256,
  });
}

function makePrivateBackup(prefix: string) {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = fs.realpathSync.native(created);
  fs.chmodSync(root, 0o700);
  const cloudflare = path.join(root, "cloudflare");
  fs.mkdirSync(cloudflare, { mode: 0o700 });
  fs.chmodSync(cloudflare, 0o700);
  return {
    root,
    cloudflare,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
