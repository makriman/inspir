import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWorkerCandidateStagedEvidence,
  buildWorkerCandidateUploadEvidence,
  workerCandidateActivationEvidencePath,
  workerCandidateStagedEvidencePath,
  workerCandidateUploadEvidencePath,
  writeWorkerCandidateEvidence,
  type WorkerCandidateEvidenceHandle,
  type WorkerCandidateStagedEvidence,
  type WorkerCandidateUploadEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";
import {
  WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS,
  WORKER_CANDIDATE_VERSION_OVERRIDE_PROPAGATION_DELAY_MS,
  assertFileBackedWorkerCandidateVersionOverrideSmokeEvidence,
  parseWorkerCandidateVersionOverrideSmokeEvidence,
  readWorkerCandidateVersionOverrideSmokeEvidence,
  workerCandidateVersionOverrideSmokeEvidencePath,
  workerVersionOverrideHeaderValue,
  writeWorkerCandidateVersionOverrideSmokeEvidence,
} from "../scripts/cloudflare/worker-candidate-version-override-smoke-evidence";
import {
  assertWorkerCandidateVersionOverrideSmokeInitiallyFresh,
  createWorkerCandidateVersionOverrideSmokeEvidence,
  readAndValidateWorkerCandidateVersionOverrideSmokeEvidence,
} from "../scripts/cloudflare/worker-candidate-version-override-smoke";

const BASELINE_VERSION_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATE_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const WRONG_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const BASELINE_DEPLOYMENT_ID = "44444444-4444-4444-8444-444444444444";
const STAGED_DEPLOYMENT_ID = "55555555-5555-4555-8555-555555555555";
const REPLACEMENT_DEPLOYMENT_ID = "66666666-6666-4666-8666-666666666666";
const RELEASE_CREATED_AT = "2026-07-15T10:00:00.000Z";

test("override smoke proves the unpinned baseline and bounded pinned candidate", async () => {
  const fixture = makeReleaseFixture("worker-override-smoke-success-");
  try {
    const calls: FetchCall[] = [];
    const sleeps: number[] = [];
    const handle = await createWorkerCandidateVersionOverrideSmokeEvidence({
      backupDirectory: fixture.root,
      dependencies: {
        fetch: sequenceFetch(
          [BASELINE_VERSION_ID, BASELINE_VERSION_ID, CANDIDATE_VERSION_ID],
          calls,
        ),
        now: sequentialClock("2026-07-15T10:02:00.000Z"),
        nonce: sequentialNonce(),
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      },
    });

    assert.equal(handle.value.release.targetCandidateVersionId, CANDIDATE_VERSION_ID);
    assert.equal(handle.value.release.serviceBaselineVersionId, BASELINE_VERSION_ID);
    assert.equal(handle.value.release.uploadEvidenceSha256, fixture.upload.sha256);
    assert.equal(handle.value.release.stagedEvidenceSha256, fixture.staged.sha256);
    assert.equal(handle.value.release.stagedDeploymentId, STAGED_DEPLOYMENT_ID);
    assert.equal(handle.value.unpinned.response.health.versionId, BASELINE_VERSION_ID);
    assert.deepEqual(
      handle.value.pinnedAttempts.map((attempt) => attempt.response.health.versionId),
      [BASELINE_VERSION_ID, CANDIDATE_VERSION_ID],
    );
    assert.deepEqual(sleeps, [WORKER_CANDIDATE_VERSION_OVERRIDE_PROPAGATION_DELAY_MS]);
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.overrideHeader, null);
    assert.equal(
      calls[1]?.overrideHeader,
      workerVersionOverrideHeaderValue(CANDIDATE_VERSION_ID),
    );
    assert.equal(
      calls[2]?.overrideHeader,
      workerVersionOverrideHeaderValue(CANDIDATE_VERSION_ID),
    );
    assert.ok(calls.every((call) => call.cache === "no-store"));
    assert.equal(fs.statSync(handle.path).mode & 0o777, 0o600);
    assert.equal(fs.statSync(handle.path).nlink, 1);
    assert.deepEqual(
      readWorkerCandidateVersionOverrideSmokeEvidence(handle.path),
      handle,
    );
    assert.deepEqual(
      readAndValidateWorkerCandidateVersionOverrideSmokeEvidence({
        backupDirectory: fixture.root,
        now: new Date("2026-07-15T10:03:00.000Z"),
        uploadHandle: fixture.upload,
        stagedHandle: fixture.staged,
      }),
      handle,
    );
  } finally {
    fixture.cleanup();
  }
});

test("an ignored version override exhausts only the bounded propagation retry", async () => {
  const fixture = makeReleaseFixture("worker-override-smoke-ignored-");
  try {
    const calls: FetchCall[] = [];
    const sleeps: number[] = [];
    await assert.rejects(
      createWorkerCandidateVersionOverrideSmokeEvidence({
        backupDirectory: fixture.root,
        dependencies: {
          fetch: sequenceFetch(
            [
              BASELINE_VERSION_ID,
              ...Array.from(
                { length: WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS },
                () => BASELINE_VERSION_ID,
              ),
            ],
            calls,
          ),
          now: sequentialClock("2026-07-15T10:02:00.000Z"),
          nonce: sequentialNonce(),
          sleep: async (milliseconds) => {
            sleeps.push(milliseconds);
          },
        },
      }),
      /ignored.*version override|did not propagate/i,
    );
    assert.equal(
      calls.length,
      WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS + 1,
    );
    assert.equal(
      sleeps.length,
      WORKER_CANDIDATE_VERSION_OVERRIDE_MAX_PINNED_ATTEMPTS - 1,
    );
    assert.equal(
      fs.existsSync(workerCandidateVersionOverrideSmokeEvidencePath(fixture.root)),
      false,
    );
  } finally {
    fixture.cleanup();
  }
});

test("a pinned wrong UUID fails immediately without a propagation retry", async () => {
  const fixture = makeReleaseFixture("worker-override-smoke-wrong-uuid-");
  try {
    const calls: FetchCall[] = [];
    let sleeps = 0;
    await assert.rejects(
      createWorkerCandidateVersionOverrideSmokeEvidence({
        backupDirectory: fixture.root,
        dependencies: {
          fetch: sequenceFetch([BASELINE_VERSION_ID, WRONG_VERSION_ID], calls),
          now: sequentialClock("2026-07-15T10:02:00.000Z"),
          nonce: sequentialNonce(),
          sleep: async () => {
            sleeps += 1;
          },
        },
      }),
      /wrong Worker UUID/i,
    );
    assert.equal(calls.length, 2);
    assert.equal(sleeps, 0);
  } finally {
    fixture.cleanup();
  }
});

test("cacheable or non-native health responses cannot authorize the candidate", async (t) => {
  await t.test("cacheable", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-cacheable-");
    try {
      const calls: FetchCall[] = [];
      await assert.rejects(
        createWorkerCandidateVersionOverrideSmokeEvidence({
          backupDirectory: fixture.root,
          dependencies: {
            fetch: sequenceFetch(
              [
                { versionId: BASELINE_VERSION_ID, cacheControl: "public, max-age=60" },
              ],
              calls,
            ),
            now: sequentialClock("2026-07-15T10:02:00.000Z"),
            nonce: sequentialNonce(),
            sleep: noSleep,
          },
        }),
        /private no-store policy|invalid schema/i,
      );
      assert.equal(calls.length, 1);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("wrong architecture", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-architecture-");
    try {
      const calls: FetchCall[] = [];
      await assert.rejects(
        createWorkerCandidateVersionOverrideSmokeEvidence({
          backupDirectory: fixture.root,
          dependencies: {
            fetch: sequenceFetch(
              [
                BASELINE_VERSION_ID,
                {
                  versionId: CANDIDATE_VERSION_ID,
                  architectureOverrides: { memory: false },
                },
              ],
              calls,
            ),
            now: sequentialClock("2026-07-15T10:02:00.000Z"),
            nonce: sequentialNonce(),
            sleep: noSleep,
          },
        }),
        /lean native accounts.*memory.*games-free architecture/i,
      );
      assert.equal(calls.length, 2);
    } finally {
      fixture.cleanup();
    }
  });
});

test("activation evidence is rejected before, during, and after smoke capture", async (t) => {
  await t.test("before", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-active-before-");
    try {
      writeActivationSentinel(fixture.root);
      let calls = 0;
      await assert.rejects(
        createWorkerCandidateVersionOverrideSmokeEvidence({
          backupDirectory: fixture.root,
          dependencies: {
            fetch: async () => {
              calls += 1;
              return healthResponse(BASELINE_VERSION_ID);
            },
          },
        }),
        /activation evidence.*absent/i,
      );
      assert.equal(calls, 0);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("during", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-active-during-");
    try {
      const calls: FetchCall[] = [];
      const fetchImpl = sequenceFetch(
        [BASELINE_VERSION_ID, CANDIDATE_VERSION_ID],
        calls,
        (index) => {
          if (index === 1) writeActivationSentinel(fixture.root);
        },
      );
      await assert.rejects(
        createWorkerCandidateVersionOverrideSmokeEvidence({
          backupDirectory: fixture.root,
          dependencies: {
            fetch: fetchImpl,
            now: sequentialClock("2026-07-15T10:02:00.000Z"),
            nonce: sequentialNonce(),
            sleep: noSleep,
          },
        }),
        /activation evidence.*absent/i,
      );
      assert.equal(calls.length, 2);
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("after", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-active-after-");
    try {
      await createSuccessfulSmoke(fixture.root);
      writeActivationSentinel(fixture.root);
      assert.throws(
        () =>
          readAndValidateWorkerCandidateVersionOverrideSmokeEvidence({
            backupDirectory: fixture.root,
            now: new Date("2026-07-15T10:03:00.000Z"),
          }),
        /activation evidence.*absent/i,
      );
    } finally {
      fixture.cleanup();
    }
  });
});

test("staged topology drift is rejected during capture and later validation", async (t) => {
  await t.test("during", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-topology-during-");
    try {
      const calls: FetchCall[] = [];
      const fetchImpl = sequenceFetch(
        [BASELINE_VERSION_ID, CANDIDATE_VERSION_ID],
        calls,
        (index) => {
          if (index === 1) replaceStagedEvidence(fixture);
        },
      );
      await assert.rejects(
        createWorkerCandidateVersionOverrideSmokeEvidence({
          backupDirectory: fixture.root,
          dependencies: {
            fetch: fetchImpl,
            now: sequentialClock("2026-07-15T10:02:00.000Z"),
            nonce: sequentialNonce(),
            sleep: noSleep,
          },
        }),
        /staged topology evidence changed/i,
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("after", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-topology-after-");
    try {
      await createSuccessfulSmoke(fixture.root);
      replaceStagedEvidence(fixture);
      assert.throws(
        () =>
          readAndValidateWorkerCandidateVersionOverrideSmokeEvidence({
            backupDirectory: fixture.root,
            now: new Date("2026-07-15T10:03:00.000Z"),
          }),
        /stale or drifted.*staged release topology/i,
      );
    } finally {
      fixture.cleanup();
    }
  });
});

test("stale override smoke evidence cannot enter the pre-activation seal", async () => {
  const fixture = makeReleaseFixture("worker-override-smoke-stale-");
  try {
    const handle = await createSuccessfulSmoke(fixture.root);
    const staleAt = new Date(
      Date.parse(handle.value.validUntil) + 1,
    );
    assert.throws(
      () =>
        readAndValidateWorkerCandidateVersionOverrideSmokeEvidence({
          backupDirectory: fixture.root,
          now: staleAt,
        }),
      /stale or drifted/i,
    );
    assert.throws(
      () =>
        assertWorkerCandidateVersionOverrideSmokeInitiallyFresh(
          handle,
          new Date(Date.parse(handle.value.createdAt) + 5 * 60 * 1_000 + 1),
        ),
      /newly completed/i,
    );
  } finally {
    fixture.cleanup();
  }
});

test("canonical override smoke publication is exclusive before any repeat fetch", async () => {
  const fixture = makeReleaseFixture("worker-override-smoke-exclusive-");
  try {
    await createSuccessfulSmoke(fixture.root);
    let calls = 0;
    await assert.rejects(
      createWorkerCandidateVersionOverrideSmokeEvidence({
        backupDirectory: fixture.root,
        dependencies: {
          fetch: async () => {
            calls += 1;
            return healthResponse(BASELINE_VERSION_ID);
          },
        },
      }),
      /already exists.*cannot be replaced/i,
    );
    assert.equal(calls, 0);
  } finally {
    fixture.cleanup();
  }
});

test("override smoke evidence rejects tampering, replacement, symlinks, and broad permissions", async (t) => {
  await t.test("tampered", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-tampered-");
    try {
      const handle = await createSuccessfulSmoke(fixture.root);
      fs.appendFileSync(handle.path, " \n");
      assert.throws(
        () => readWorkerCandidateVersionOverrideSmokeEvidence(handle.path),
        /not valid JSON|noncanonical|invalid schema/i,
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("replaced", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-replaced-");
    try {
      const initial = await createSuccessfulSmoke(fixture.root);
      fs.renameSync(initial.path, `${initial.path}.initial`);
      const createdAt = new Date(
        Date.parse(initial.value.createdAt) + 1_000,
      ).toISOString();
      const validUntil = new Date(
        Date.parse(createdAt) + initial.value.maximumAgeMs,
      ).toISOString();
      const replacement = parseWorkerCandidateVersionOverrideSmokeEvidence({
        ...initial.value,
        createdAt,
        validUntil,
      });
      writeWorkerCandidateVersionOverrideSmokeEvidence(initial.path, replacement);
      assert.throws(
        () =>
          assertFileBackedWorkerCandidateVersionOverrideSmokeEvidence(
            initial,
            initial.path,
          ),
        /not the exact nofollow file-backed report/i,
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("symlink", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-symlink-");
    try {
      const handle = await createSuccessfulSmoke(fixture.root);
      const parked = `${handle.path}.parked`;
      fs.renameSync(handle.path, parked);
      fs.symlinkSync(parked, handle.path);
      assert.throws(
        () => readWorkerCandidateVersionOverrideSmokeEvidence(handle.path),
        /nofollow owner-only file/i,
      );
    } finally {
      fixture.cleanup();
    }
  });

  await t.test("broad permissions", async () => {
    const fixture = makeReleaseFixture("worker-override-smoke-mode-");
    try {
      const handle = await createSuccessfulSmoke(fixture.root);
      fs.chmodSync(handle.path, 0o640);
      assert.throws(
        () => readWorkerCandidateVersionOverrideSmokeEvidence(handle.path),
        /mode-0600/i,
      );
    } finally {
      fixture.cleanup();
    }
  });
});

test("the package exposes only the trust-sealed production-confirmed smoke command", () => {
  const packageJson: unknown = JSON.parse(
    fs.readFileSync(path.resolve("package.json"), "utf8"),
  );
  assert.ok(isRecord(packageJson));
  assert.ok(isRecord(packageJson.scripts));
  assert.equal(
    packageJson.scripts["cf:verify:candidate-override"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:verify:candidate-override",
  );
});

type ReleaseFixture = Readonly<{
  root: string;
  cloudflare: string;
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>;
  staged: WorkerCandidateEvidenceHandle<WorkerCandidateStagedEvidence>;
  cleanup: () => void;
}>;

function makeReleaseFixture(prefix: string): ReleaseFixture {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = fs.realpathSync.native(created);
  fs.chmodSync(root, 0o700);
  const cloudflare = path.join(root, "cloudflare");
  fs.mkdirSync(cloudflare, { mode: 0o700 });
  fs.chmodSync(cloudflare, 0o700);
  const uploadValue = buildWorkerCandidateUploadEvidence({
    createdAt: RELEASE_CREATED_AT,
    targetCandidateVersionId: CANDIDATE_VERSION_ID,
    serviceBaselineVersionId: BASELINE_VERSION_ID,
    expectedReleaseTag: "release-candidate",
    expectedReleaseMessageSha256: "1".repeat(64),
    uploadCommandEvidenceSha256: "2".repeat(64),
    workerDeployPreparationSha256: "3".repeat(64),
    git: {
      head: "a".repeat(40),
      upstream: "a".repeat(40),
      upstreamRef: "refs/remotes/origin/codex/release",
    },
    artifacts: {
      sourceFingerprintSha256: "4".repeat(64),
      sourceFingerprintFileCount: 100,
      workerSourceSha256: "5".repeat(64),
      wranglerConfigSha256: "6".repeat(64),
      assetManifestSha256: "7".repeat(64),
      assetManifestFileCount: 20,
      assetManifestBytes: 4_096,
    },
    uploadOutput: {
      type: "version-upload",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-service-tag",
      versionId: CANDIDATE_VERSION_ID,
      previewUrl: null,
      previewAliasUrl: null,
      wranglerEnvironment: null,
      workerNameOverridden: false,
      timestamp: "2026-07-15T09:59:58.000Z",
    },
    versionView: {
      versionId: CANDIDATE_VERSION_ID,
      createdAt: "2026-07-15T09:59:59.000Z",
      source: "wrangler",
      releaseTag: "release-candidate",
      releaseMessageSha256: "1".repeat(64),
      resourceConfigSha256: "8".repeat(64),
    },
    soleBaselineTopology: {
      deploymentId: BASELINE_DEPLOYMENT_ID,
      serviceBaselineVersionId: BASELINE_VERSION_ID,
      percentage: 100,
      observedVersions: 1,
    },
  });
  const upload = writeWorkerCandidateEvidence(
    workerCandidateUploadEvidencePath(root),
    uploadValue,
  );
  const stagedValue = stagedEvidenceValue(
    upload,
    STAGED_DEPLOYMENT_ID,
    "2026-07-15T10:01:00.000Z",
  );
  const staged = writeWorkerCandidateEvidence(
    workerCandidateStagedEvidencePath(root),
    stagedValue,
  );
  return {
    root,
    cloudflare,
    upload,
    staged,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function stagedEvidenceValue(
  upload: WorkerCandidateEvidenceHandle<WorkerCandidateUploadEvidence>,
  deploymentId: string,
  createdAt: string,
) {
  return buildWorkerCandidateStagedEvidence({
    createdAt,
    uploadEvidence: upload.value,
    uploadEvidenceSha256: upload.sha256,
    deployOutput: {
      type: "version-deploy",
      version: 1,
      workerName: "inspirlearning",
      workerTag: "worker-service-tag",
      deploymentId,
      timestamp: createdAt,
    },
    topology: {
      deploymentId,
      serviceBaselineVersionId: BASELINE_VERSION_ID,
      targetCandidateVersionId: CANDIDATE_VERSION_ID,
      baselinePercentage: 100,
      candidatePercentage: 0,
      observedVersions: 2,
    },
  });
}

function replaceStagedEvidence(fixture: ReleaseFixture) {
  const stagedPath = workerCandidateStagedEvidencePath(fixture.root);
  fs.renameSync(stagedPath, `${stagedPath}.original`);
  writeWorkerCandidateEvidence(
    stagedPath,
    stagedEvidenceValue(
      fixture.upload,
      REPLACEMENT_DEPLOYMENT_ID,
      "2026-07-15T10:01:30.000Z",
    ),
  );
}

async function createSuccessfulSmoke(backupDirectory: string) {
  const calls: FetchCall[] = [];
  return createWorkerCandidateVersionOverrideSmokeEvidence({
    backupDirectory,
    dependencies: {
      fetch: sequenceFetch(
        [BASELINE_VERSION_ID, CANDIDATE_VERSION_ID],
        calls,
      ),
      now: sequentialClock("2026-07-15T10:02:00.000Z"),
      nonce: sequentialNonce(),
      sleep: noSleep,
    },
  });
}

type HealthResponseOptions = Readonly<{
  versionId: string;
  cacheControl?: string;
  architectureOverrides?: Readonly<Record<string, string | boolean>>;
}>;

type FetchSequenceItem = string | HealthResponseOptions;

type FetchCall = Readonly<{
  url: string;
  overrideHeader: string | null;
  cache: RequestCache | undefined;
}>;

function sequenceFetch(
  sequence: readonly FetchSequenceItem[],
  calls: FetchCall[],
  beforeResponse?: (index: number) => void,
) {
  let index = 0;
  return async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const currentIndex = index;
    const item = sequence[currentIndex];
    index += 1;
    if (item === undefined) {
      throw new Error("Test fetch sequence was exhausted.");
    }
    const headers = new Headers(init?.headers);
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      overrideHeader: headers.get("Cloudflare-Workers-Version-Overrides"),
      cache: init?.cache,
    });
    beforeResponse?.(currentIndex);
    return typeof item === "string"
      ? healthResponse(item)
      : healthResponse(item.versionId, item);
  };
}

function healthResponse(
  versionId: string,
  options: Omit<HealthResponseOptions, "versionId"> = {},
) {
  const architecture = {
    deploymentMode: "free-static-native-accounts",
    publicDocuments: "workers-static-assets",
    workerCpuPlan: "free-10ms",
    openNext: false,
    accounts: true,
    savedState: true,
    memory: true,
    admin: true,
    activities: true,
    games: false,
    ...options.architectureOverrides,
  };
  return new Response(
    JSON.stringify({
      ok: true,
      runtime: "cloudflare-workers",
      version: {
        id: versionId,
        tag: "release-candidate",
        timestamp: RELEASE_CREATED_AT,
      },
      architecture,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control":
          options.cacheControl ??
          "private, no-cache, no-store, max-age=0, must-revalidate",
        "cdn-cache-control": "private, no-store",
        "cloudflare-cdn-cache-control": "private, no-store",
        pragma: "no-cache",
        "x-inspir-delivery": "lean-api-worker",
      },
    },
  );
}

function sequentialClock(start: string) {
  let current = Date.parse(start);
  return () => {
    const value = new Date(current);
    current += 1_000;
    return value;
  };
}

function sequentialNonce() {
  let value = 0;
  return () => {
    value += 1;
    return value.toString(16).padStart(32, "0");
  };
}

async function noSleep() {
  return Promise.resolve();
}

function writeActivationSentinel(backupDirectory: string) {
  fs.writeFileSync(
    workerCandidateActivationEvidencePath(backupDirectory),
    "activation-exists\n",
    { mode: 0o600 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
