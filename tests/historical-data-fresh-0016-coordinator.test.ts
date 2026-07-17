import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET,
} from "../scripts/cloudflare/apply-historical-data-fresh-0016-migration";
import {
  MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
} from "../scripts/cloudflare/check-d1-runtime-migration-budget";
import type { D1ReleaseBudgetReservationResult } from "../scripts/cloudflare/d1-release-budget-ledger";
import {
  createHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
  HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG,
  HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE,
  HISTORICAL_FRESH_0016_WORKERS_FREE_UTC_RESET_TIMING_MODE,
  type HistoricalFresh0016CutoverTimingMode,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import {
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
  HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME,
} from "../scripts/cloudflare/historical-data-fresh-0016-migration-budget";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_PREREQUISITES_KIND,
} from "../scripts/cloudflare/historical-data-fresh-0016-prerequisites";
import {
  createHistoricalFresh0016RunDirectory,
  publishHistoricalFresh0016StateStage,
  classifyHistoricalFresh0016State,
  type HistoricalFresh0016Owner,
} from "../scripts/cloudflare/historical-data-fresh-0016-state";
import {
  historicalDataHmacKeyId,
} from "../scripts/cloudflare/historical-data-hmac-key";
import {
  RELEASE_BACKUP_DIR_ENV,
} from "../scripts/cloudflare/migration-config";
import {
  HISTORICAL_FRESH_0016_CHAIN_CLAIM_KIND,
} from "../scripts/cloudflare/verify-historical-data-fresh-0016-cutover-chain";
import {
  parseHistoricalFresh0016CutoverCliArgs,
  runHistoricalDataFresh0016Cutover,
  type HistoricalFresh0016CoordinatorBoundary,
  type HistoricalFresh0016CoordinatorDependencies,
} from "../scripts/cloudflare/run-historical-data-fresh-0016-cutover";
import {
  buildWorkerCandidateUploadEvidence,
  workerCandidateEvidenceSha256,
  workerCandidateUploadEvidencePath,
  workerReleaseMessageSha256,
  writeWorkerCandidateEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";

const source = {
  sha256: "a".repeat(64),
  fileCount: 7,
} as const;
const targetCandidateVersionId = "11111111-1111-4111-8111-111111111111";
const serviceBaselineVersionId = "22222222-2222-4222-8222-222222222222";
const baselineDeploymentStatusOutput = JSON.stringify({
  id: "33333333-3333-4333-8333-333333333333",
  versions: [{ version_id: serviceBaselineVersionId, percentage: 100 }],
});
const secret = "b".repeat(64);
const hmacKeyId = historicalDataHmacKeyId(secret);
const usage = {
  databaseCount: 1,
  queryGroups: 0,
  rowsRead: 100,
  rowsWritten: 10,
  executions: 0,
  windowMinutes: 5,
} as const;
const cardinalities = {
  users: 2,
  chats: 3,
  messages: 4,
  aiRuns: 1,
  rateLimitWindows: 1,
  opsEvents: 1,
  activityRuns: 1,
  userMemorySettings: 1,
  memorySourceFeedback: 1,
  suppressionBackfillUsers: 1,
} as const;
const releaseMessageSha256 = workerReleaseMessageSha256(
  "fresh-0016 coordinator fixture",
);
const uploadEvidence = buildWorkerCandidateUploadEvidence({
  createdAt: "2026-07-14T23:40:00.000Z",
  targetCandidateVersionId,
  serviceBaselineVersionId,
  expectedReleaseTag: "fresh-0016-coordinator-fixture",
  expectedReleaseMessageSha256: releaseMessageSha256,
  uploadCommandEvidenceSha256: "1".repeat(64),
  workerDeployPreparationSha256: "2".repeat(64),
  git: {
    head: "c".repeat(40),
    upstream: "c".repeat(40),
    upstreamRef: "origin/main",
  },
  artifacts: {
    sourceFingerprintSha256: source.sha256,
    sourceFingerprintFileCount: source.fileCount,
    workerSourceSha256: "d".repeat(64),
    wranglerConfigSha256: "e".repeat(64),
    assetManifestSha256: "f".repeat(64),
    assetManifestFileCount: 100,
    assetManifestBytes: 10_000,
  },
  uploadOutput: {
    type: "version-upload",
    version: 1,
    workerName: "inspirlearning",
    workerTag: "worker-fixture-tag",
    versionId: targetCandidateVersionId,
    previewUrl: null,
    previewAliasUrl: null,
    wranglerEnvironment: null,
    workerNameOverridden: false,
    timestamp: "2026-07-14T23:39:00.000Z",
  },
  versionView: {
    versionId: targetCandidateVersionId,
    createdAt: "2026-07-14T23:38:00.000Z",
    source: "fixture",
    releaseTag: "fresh-0016-coordinator-fixture",
    releaseMessageSha256,
    resourceConfigSha256: "3".repeat(64),
  },
  soleBaselineTopology: {
    deploymentId: "44444444-4444-4444-8444-444444444444",
    serviceBaselineVersionId,
    percentage: 100,
    observedVersions: 1,
  },
});
const uploadEvidenceSha256 = workerCandidateEvidenceSha256(uploadEvidence);
const workerRelease = Object.freeze({
  phase: "uploaded-inactive" as const,
  targetCandidateVersionId,
  serviceBaselineVersionId,
  uploadEvidenceSha256,
});

test("fresh-0016 package and runbook wiring use the current accepted boundary without legacy fallback", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve("package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.["cf:cutover:historical-data-fresh-0016"],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:cutover:historical-data-fresh-0016",
  );
  assert.equal(
    packageJson.scripts?.[
      "cf:verify:historical-data-fresh-0016-preservation"
    ],
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:verify:historical-data-fresh-0016-preservation",
  );

  const runbook = fs.readFileSync(path.resolve("deploy.md"), "utf8");
  const boundary = runbook.indexOf(
    "### One-release accepted fresh trust boundary for migration 0016",
  );
  const deployment = runbook.indexOf(
    "## Additive D1 runtime migrations 0013-0017",
  );
  assert.ok(boundary >= 0 && deployment > boundary);
  const releaseSection = runbook.slice(boundary, deployment);
  const acceptanceCommand = releaseSection.indexOf(
    "pnpm cf:accept:fresh-boundary -- --confirm-lost-key-fresh-boundary",
  );
  const preparationCommand = releaseSection.indexOf("pnpm cf:prepare:deploy");
  assert.ok(
    acceptanceCommand >= 0 && preparationCommand > acceptanceCommand,
    "the immutable local acceptance must precede deploy preparation",
  );
  assert.match(releaseSection, /run-trust-bound-production-command\.ts/);
  assert.match(releaseSection, /--confirm-paid-expedited-cutover/);
  assert.match(releaseSection, /releaseTimingMode: "paid-expedited"/);
  assert.match(releaseSection, /without waiting for that reset window/);
  assert.match(releaseSection, /cf:cutover:historical-data-fresh-0016/);
  assert.match(releaseSection, /--confirm-lost-key-fresh-boundary/);
  assert.match(
    releaseSection,
    /cf:verify:historical-data-fresh-0016-preservation/,
  );
  assert.match(releaseSection, /no legacy-baseline or expired-rollover fallback/);
  assert.doesNotMatch(releaseSection, /--capture-successor/);
  assert.doesNotMatch(releaseSection, /--verify-rollover/);

  const preservation = fs.readFileSync(
    path.resolve("scripts/cloudflare/verify-historical-data-preservation.ts"),
    "utf8",
  );
  const preservationAdapter = fs.readFileSync(
    path.resolve(
      "scripts/cloudflare/historical-data-fresh-0016-preservation-cli-adapter.ts",
    ),
    "utf8",
  );
  const preservationCli = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-historical-data-preservation.ts"),
    "utf8",
  );
  assert.match(preservation, /--fresh-0016-cutover-baseline/);
  assert.doesNotMatch(
    preservation,
    /verify-historical-data-fresh-0016-cutover-chain/,
  );
  assert.match(
    preservationAdapter,
    /readAndValidateHistoricalFresh0016CutoverComplete/,
  );
  assert.match(preservationAdapter, /successorReportFileSha256/);
  assert.match(
    preservationCli,
    /historical-data-fresh-0016-preservation-cli-adapter/,
  );
});

test("fresh-0016 CLI is strict and status rejects mutation authority", () => {
  assert.throws(
    () => parseHistoricalFresh0016CutoverCliArgs(["finish"]),
    /requires exact --confirm-production/,
  );
  assert.throws(
    () =>
      parseHistoricalFresh0016CutoverCliArgs([
        "status",
        "--run-id",
        randomUUID(),
        HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG,
      ]),
    /read-only and rejects mutation confirmations/,
  );
  assert.throws(
    () =>
      parseHistoricalFresh0016CutoverCliArgs([
        "start",
        "--confirm-production",
        HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
        "--confirm-production",
      ]),
    /Duplicate/,
  );
  const parsed = parseHistoricalFresh0016CutoverCliArgs([
    "finish",
    "--run-id",
    "22222222-2222-4222-8222-222222222222",
    "--confirm-production",
    HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
    HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG,
  ]);
  assert.equal(parsed.mode, "finish");
  assert.equal(parsed.productionConfirmation, "--confirm-production");
  assert.equal(
    parsed.lostKeyBoundaryConfirmation,
    HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
  );
  assert.equal(
    parsed.paidExpeditedConfirmation,
    HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG,
  );
});

test("fresh-0016 CLI honors the trust-bound wrapper backup environment", () => {
  const original = process.env[RELEASE_BACKUP_DIR_ENV];
  const backupDirectory = path.join(os.tmpdir(), `fresh-0016-wrapper-${randomUUID()}`);
  try {
    process.env[RELEASE_BACKUP_DIR_ENV] = backupDirectory;
    const parsed = parseHistoricalFresh0016CutoverCliArgs([
      "start",
      "--confirm-production",
      HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
      HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG,
    ]);
    assert.equal(parsed.backupDirectory, path.resolve(backupDirectory));
  } finally {
    if (original === undefined) {
      delete process.env[RELEASE_BACKUP_DIR_ENV];
    } else {
      process.env[RELEASE_BACKUP_DIR_ENV] = original;
    }
  }
});

test("fresh-0016 status is filesystem-only and returns no payload or secret", async () => {
  const fixture = createStageFourFixture();
  try {
    let unexpectedCalls = 0;
    const result = await runHistoricalDataFresh0016Cutover({
      mode: "status",
      backupDirectory: fixture.backupDirectory,
      runId: fixture.runId,
      dependencies: {
        loadDailyUsage: () => {
          unexpectedCalls += 1;
          throw new Error("D1 must not run during status.");
        },
        readHmacKey: async () => {
          unexpectedCalls += 1;
          throw new Error("Keychain must not run during status.");
        },
      },
    });
    assert.equal(unexpectedCalls, 0);
    assert.equal(result.currentStage, "predecessor-complete");
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes("payload"), false);
    assert.equal(serialized.includes(fixture.backupDirectory), false);
    await assert.rejects(
      runHistoricalDataFresh0016Cutover({
        mode: "status",
        backupDirectory: fixture.backupDirectory,
        runId: fixture.runId,
        productionConfirmation: "--confirm-production",
      }),
      /read-only and rejects mutation confirmations/,
    );
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 start creates one fresh key, resumes by key ID, and never acquires the finish lock", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-fresh-start-coordinator-"),
  );
  fs.chmodSync(root, 0o700);
  const backupDirectory = path.join(root, "backup");
  fs.mkdirSync(backupDirectory, { mode: 0o700 });
  let createKeyCalls = 0;
  let readKeyCalls = 0;
  let lockCalls = 0;
  let crashAt: HistoricalFresh0016CoordinatorBoundary = "claim-published";
  let claimedRunId = "";
  const dependencies: Partial<HistoricalFresh0016CoordinatorDependencies> = {
    assertGitIdentity: () => ({
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/main",
    }),
    buildSourceFingerprint: () => ({ ...source, files: [] }),
    readCandidateUploadEvidence: candidateUploadHandle,
    observeLiveTopology: topologyObservation,
    readPredecessorPrerequisites: () => predecessorPrerequisites(),
    verifyPredecessorRuntimeGate: () =>
      predecessorPrerequisites().liveRuntimeState,
    createHmacKey: async () => {
      createKeyCalls += 1;
      return { hmacKeyId, secret };
    },
    readHmacKey: async (expectedKeyId) => {
      readKeyCalls += 1;
      assert.equal(expectedKeyId, hmacKeyId);
      return { hmacKeyId, secret };
    },
    acquireExclusion: () => {
      lockCalls += 1;
      throw new Error("Start must never acquire the finish exclusion.");
    },
    loadDailyUsage: () => usage,
    reserveBudget: (input) => {
      const result: D1ReleaseBudgetReservationResult = {
        ledgerPath: path.join(
          backupDirectory,
          "cloudflare",
          "d1-release-budget-ledger-2026-07-14.json",
        ),
        utcDay: "2026-07-14",
        revision: 1,
        idempotent: false,
        reservation: {
          operationId: input.operationId,
          operation: input.operation,
          candidateVersionId: targetCandidateVersionId,
          phase: "maximum",
          rowsRead: input.rowsRead,
          rowsWritten: 0,
          maximumRowsRead: input.rowsRead,
          maximumRowsWritten: 0,
          createdAt: "2026-07-14T23:45:00.000Z",
          updatedAt: "2026-07-14T23:45:00.000Z",
        },
        totals: { rowsRead: input.rowsRead, rowsWritten: 0 },
        accountedUsage: {
          rowsRead: usage.rowsRead + input.rowsRead,
          rowsWritten: usage.rowsWritten,
        },
      };
      return result;
    },
    afterBoundary: (boundary) => {
      if (boundary === "claim-published") {
        const policyRoot = path.join(
          backupDirectory,
          ...HISTORICAL_FRESH_0016_CUTOVER_POLICY.storage
            .runsRelativeDirectory.split("/"),
        );
        claimedRunId = fs.readdirSync(policyRoot)[0] ?? "";
      }
      if (boundary === crashAt) throw new Error(`crash:${boundary}`);
    },
  };
  const common = {
    mode: "start" as const,
    cwd: root,
    backupDirectory,
    productionConfirmation: "--confirm-production",
    lostKeyBoundaryConfirmation:
      HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
    runner: () => {
      throw new Error("No real Wrangler or network call is allowed.");
    },
    clock: () => new Date("2026-07-14T23:45:00.000Z"),
    dependencies,
  };
  try {
    await assert.rejects(
      runHistoricalDataFresh0016Cutover(common),
      /crash:claim-published/,
    );
    assert.equal(createKeyCalls, 1);
    assert.equal(readKeyCalls, 0);
    assert.match(claimedRunId, /^[0-9a-f-]{36}$/);

    crashAt = "predecessor-maximum-reserved";
    await assert.rejects(
      runHistoricalDataFresh0016Cutover({ ...common, runId: claimedRunId }),
      /crash:predecessor-maximum-reserved/,
    );
    assert.equal(createKeyCalls, 1);
    assert.equal(readKeyCalls, 1);
    assert.equal(lockCalls, 0);
    const claim = classifyHistoricalFresh0016State({
      backupDirectory,
      runId: claimedRunId,
    });
    assert.equal(claim.currentStage, "claim");
    assert.equal(
      canonicalText(claim).includes(secret),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unresolved predecessor and successor authorization tails fail closed before D1 or lock work", async () => {
  const predecessorFixture = createAuthorizationTailFixture("predecessor");
  const successorFixture = createAuthorizationTailFixture("successor");
  let d1Calls = 0;
  let lockCalls = 0;
  const dependencies: Partial<HistoricalFresh0016CoordinatorDependencies> = {
    assertGitIdentity: () => ({
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/main",
    }),
    buildSourceFingerprint: () => ({ ...source, files: [] }),
    readCandidateUploadEvidence: candidateUploadHandle,
    observeLiveTopology: topologyObservation,
    readPredecessorPrerequisites: () => predecessorPrerequisites(),
    verifyPredecessorRuntimeGate: () =>
      predecessorPrerequisites().liveRuntimeState,
    readHmacKey: async () => ({ hmacKeyId, secret }),
    readPredecessorIdentity: () => ({
      sha256: "d".repeat(64),
      report: { hmacKeyId, utcDay: "2026-07-14" },
    }),
    loadDailyUsage: () => {
      d1Calls += 1;
      throw new Error("An authorization tail must not reach D1.");
    },
    acquireExclusion: () => {
      lockCalls += 1;
      throw new Error("An authorization tail must not acquire the lock.");
    },
  };
  const common = {
    cwd: predecessorFixture.root,
    productionConfirmation: "--confirm-production",
    lostKeyBoundaryConfirmation:
      HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
    runner: () => {
      throw new Error("No real Wrangler or network call is allowed.");
    },
    dependencies,
  } as const;
  try {
    await assert.rejects(
      runHistoricalDataFresh0016Cutover({
        ...common,
        mode: "start",
        backupDirectory: predecessorFixture.backupDirectory,
        runId: predecessorFixture.runId,
        clock: () => new Date("2026-07-14T23:55:00.000Z"),
      }),
      /predecessor authorization is unresolved/,
    );
    await assert.rejects(
      runHistoricalDataFresh0016Cutover({
        ...common,
        mode: "finish",
        cwd: successorFixture.root,
        backupDirectory: successorFixture.backupDirectory,
        runId: successorFixture.runId,
        clock: () => new Date("2026-07-15T00:05:00.000Z"),
      }),
      /successor authorization is unresolved/,
    );
    assert.equal(d1Calls, 0);
    assert.equal(lockCalls, 0);
  } finally {
    predecessorFixture.cleanup();
    successorFixture.cleanup();
  }
});

test("fresh-0016 finish rejects D+2 before ownership, D1, or lock work", async () => {
  const fixture = createStageFourFixture();
  const initialFiles = fs.readdirSync(fixture.paths.runDirectory).sort();
  let acquireExclusionCalls = 0;
  let loadDailyUsageCalls = 0;
  let reserveBudgetCalls = 0;
  let loadCardinalitiesCalls = 0;
  let runnerCalls = 0;
  const dependencies: Partial<HistoricalFresh0016CoordinatorDependencies> = {
    assertGitIdentity: () => ({
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/main",
    }),
    buildSourceFingerprint: () => ({ ...source, files: [] }),
    readCandidateUploadEvidence: candidateUploadHandle,
    observeLiveTopology: topologyObservation,
    readPredecessorPrerequisites: () => predecessorPrerequisites(),
    verifyPredecessorRuntimeGate: () =>
      predecessorPrerequisites().liveRuntimeState,
    readHmacKey: async () => ({ hmacKeyId, secret }),
    readPredecessorIdentity: () => ({
      sha256: "d".repeat(64),
      report: { hmacKeyId, utcDay: "2026-07-14" },
    }),
    acquireExclusion: () => {
      acquireExclusionCalls += 1;
      throw new Error("D+2 must not acquire the production exclusion.");
    },
    loadDailyUsage: () => {
      loadDailyUsageCalls += 1;
      throw new Error("D+2 must not read D1 usage.");
    },
    reserveBudget: () => {
      reserveBudgetCalls += 1;
      throw new Error("D+2 must not reserve D1 budget.");
    },
    loadCardinalities: () => {
      loadCardinalitiesCalls += 1;
      throw new Error("D+2 must not query D1 cardinalities.");
    },
  };
  try {
    await assert.rejects(
      runHistoricalDataFresh0016Cutover({
        mode: "finish",
        cwd: fixture.root,
        backupDirectory: fixture.backupDirectory,
        runId: fixture.runId,
        productionConfirmation: "--confirm-production",
        lostKeyBoundaryConfirmation:
          HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
        runner: () => {
          runnerCalls += 1;
          throw new Error("D+2 must not invoke Wrangler or the network.");
        },
        clock: () => new Date("2026-07-16T00:05:00.000Z"),
        dependencies,
      }),
      /exact next UTC day/,
    );
    assert.equal(acquireExclusionCalls, 0);
    assert.equal(loadDailyUsageCalls, 0);
    assert.equal(reserveBudgetCalls, 0);
    assert.equal(loadCardinalitiesCalls, 0);
    assert.equal(runnerCalls, 0);
    assert.equal(
      classifyHistoricalFresh0016State({
        backupDirectory: fixture.backupDirectory,
        runId: fixture.runId,
      }).currentStage,
      "predecessor-complete",
    );
    assert.deepEqual(
      fs.readdirSync(fixture.paths.runDirectory).sort(),
      initialFiles,
    );
  } finally {
    fixture.cleanup();
  }
});

test("fresh-0016 paid-expedited finish can advance on the predecessor UTC day only with the paid timing flag", async () => {
  const fixture = createStageFourFixture({
    releaseTimingMode: HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE,
  });
  const owner: HistoricalFresh0016Owner = {
    hostname: os.hostname(),
    pid: process.pid + 10_000,
  };
  const productionOwner = {
    candidateVersionId: targetCandidateVersionId,
    leaseExpiresAt: Date.parse("2026-07-15T01:30:00.000Z"),
    leaseId: "33333333-3333-4333-8333-333333333333",
    runId: "44444444-4444-4444-8444-444444444444",
    sourceFingerprintSha256: source.sha256,
  } as const;
  let acquireExclusionCalls = 0;
  let releaseExclusionCalls = 0;
  let loadDailyUsageCalls = 0;
  const dependencies: Partial<HistoricalFresh0016CoordinatorDependencies> = {
    assertGitIdentity: () => ({
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/main",
    }),
    buildSourceFingerprint: () => ({ ...source, files: [] }),
    readCandidateUploadEvidence: candidateUploadHandle,
    observeLiveTopology: topologyObservation,
    readPredecessorPrerequisites: () => predecessorPrerequisites(),
    verifyPredecessorRuntimeGate: () =>
      predecessorPrerequisites().liveRuntimeState,
    readHmacKey: async () => ({ hmacKeyId, secret }),
    readPredecessorIdentity: () => ({
      sha256: "d".repeat(64),
      report: { hmacKeyId, utcDay: "2026-07-14" },
    }),
    acquireExclusion: () => {
      acquireExclusionCalls += 1;
      return {
        owner: productionOwner,
        budget: {
          operations: 1,
          reservedRowsRead: 32,
          reservedRowsWritten: 4,
          billedRowsRead: 1,
          billedRowsWritten: 1,
        },
        serverNowMs: Date.parse("2026-07-14T23:55:00.000Z"),
      };
    },
    attestExclusion: (exclusion) => exclusion,
    releaseExclusion: () => {
      releaseExclusionCalls += 1;
      return {
        budget: {
          operations: 2,
          reservedRowsRead: 32,
          reservedRowsWritten: 4,
          billedRowsRead: 1,
          billedRowsWritten: 1,
        },
        recoveredFromLostResponse: false,
        releaseError: null,
      };
    },
    loadDailyUsage: () => {
      loadDailyUsageCalls += 1;
      throw new Error("The paid timing smoke stops before D1 usage.");
    },
    afterBoundary: (boundary) => {
      if (boundary === "production-exclusion-attested") {
        throw new Error("crash:production-exclusion-attested");
      }
    },
  };
  const common = {
    mode: "finish" as const,
    cwd: fixture.root,
    backupDirectory: fixture.backupDirectory,
    runId: fixture.runId,
    productionConfirmation: "--confirm-production",
    lostKeyBoundaryConfirmation:
      HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
    runner: () => {
      throw new Error("No real Wrangler or network call is allowed.");
    },
    clock: () => new Date("2026-07-14T23:55:00.000Z"),
    owner,
    dependencies,
  };
  try {
    await assert.rejects(
      runHistoricalDataFresh0016Cutover(common),
      /release timing mode changed/,
    );
    assert.equal(acquireExclusionCalls, 0);
    await assert.rejects(
      runHistoricalDataFresh0016Cutover({
        ...common,
        paidExpeditedConfirmation:
          HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG,
      }),
      /paid timing smoke stops before D1 usage/,
    );
    assert.equal(acquireExclusionCalls, 0);
    assert.equal(releaseExclusionCalls, 0);
    assert.equal(loadDailyUsageCalls, 1);
  } finally {
    fixture.cleanup();
  }
});

test("prepared migration budget survives every adjacent crash without a second cardinality query", async () => {
  const fixture = createStageFourFixture();
  const owner: HistoricalFresh0016Owner = {
    hostname: os.hostname(),
    pid: process.pid + 10_000,
  };
  const productionOwner = {
    candidateVersionId: targetCandidateVersionId,
    leaseExpiresAt: Date.parse("2026-07-15T01:30:00.000Z"),
    leaseId: "33333333-3333-4333-8333-333333333333",
    runId: "44444444-4444-4444-8444-444444444444",
    sourceFingerprintSha256: source.sha256,
  } as const;
  let crashAt: HistoricalFresh0016CoordinatorBoundary =
    "before-migration-cardinality";
  let cardinalityCalls = 0;
  let maximumCalls = 0;
  let exactCalls = 0;
  let releases = 0;
  let phase: "absent" | "maximum" | "exact" = "absent";
  let operationId = "";
  let maximum: D1ReleaseBudgetReservationResult | undefined;
  let exact: D1ReleaseBudgetReservationResult | undefined;
  const maximumRowsRead =
    HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ;
  const projectionRowsRead = 21_086;
  const projectionRowsWritten = 64;
  const exactRowsRead =
    projectionRowsRead +
    HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
      .projectedRowsRead;
  const dependencies: Partial<HistoricalFresh0016CoordinatorDependencies> = {
    assertGitIdentity: () => ({
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/main",
    }),
    buildSourceFingerprint: () => ({ ...source, files: [] }),
    readCandidateUploadEvidence: candidateUploadHandle,
    observeLiveTopology: topologyObservation,
    readPredecessorPrerequisites: () => predecessorPrerequisites(),
    verifyPredecessorRuntimeGate: () =>
      predecessorPrerequisites().liveRuntimeState,
    readHmacKey: async () => ({ hmacKeyId, secret }),
    readPredecessorIdentity: () => ({
      sha256: "d".repeat(64),
      report: { hmacKeyId, utcDay: "2026-07-14" },
    }),
    acquireExclusion: () => ({
      owner: productionOwner,
      budget: {
        operations: 1,
        reservedRowsRead: 32,
        reservedRowsWritten: 4,
        billedRowsRead: 1,
        billedRowsWritten: 1,
      },
      serverNowMs: Date.parse("2026-07-15T00:05:00.000Z"),
    }),
    attestExclusion: (exclusion) => ({
      ...exclusion,
      budget: {
        operations: 2,
        reservedRowsRead: 36,
        reservedRowsWritten: 4,
        billedRowsRead: 2,
        billedRowsWritten: 1,
      },
    }),
    releaseExclusion: () => {
      releases += 1;
      return {
        budget: {
          operations: 3,
          reservedRowsRead: 44,
          reservedRowsWritten: 8,
          billedRowsRead: 3,
          billedRowsWritten: 2,
        },
        recoveredFromLostResponse: false,
        releaseError: null,
      };
    },
    loadDailyUsage: () => usage,
    reserveBudget: (input) => {
      operationId = input.operationId;
      if (input.phase === "maximum") {
        maximumCalls += 1;
        phase = "maximum";
        maximum = ledgerResult({
          operationId,
          phase,
          revision: 1,
          rowsRead: maximumRowsRead,
          rowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
          maximumRowsRead,
          maximumRowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
          totalsRowsRead: 3_900_000,
          totalsRowsWritten: 70_192,
          updatedAt: "2026-07-15T00:05:00.000Z",
          backupDirectory: fixture.backupDirectory,
        });
        return maximum;
      }
      exactCalls += 1;
      phase = "exact";
      exact = ledgerResult({
        operationId,
        phase,
        revision: 2,
        rowsRead: exactRowsRead,
        rowsWritten: projectionRowsWritten,
        maximumRowsRead,
        maximumRowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
        totalsRowsRead: 3_900_000,
        totalsRowsWritten: 70_192,
        updatedAt: "2026-07-15T00:06:00.000Z",
        backupDirectory: fixture.backupDirectory,
      });
      return exact;
    },
    assertBudget: (input) => {
      if (input.phase === "maximum" && phase === "maximum" && maximum) {
        return { ...maximum, idempotent: true };
      }
      if (input.phase === "exact" && phase === "exact" && exact) {
        return { ...exact, idempotent: true };
      }
      throw new Error("Requested ledger phase is not current.");
    },
    loadCardinalities: () => {
      cardinalityCalls += 1;
      return { cardinalities, rowsRead: 10, rowsWritten: 0 };
    },
    projectMigration: () => ({
      rowsRead: projectionRowsRead,
      rowsWritten: projectionRowsWritten,
      indexedRows: 4,
      runtimeIndexRows: 3,
      activityPartialUniqueIndexRows: 1,
      snapshotRows: 2,
      suppressionBackfillRowsRead: 2,
      suppressionBackfillRowsWritten: 2,
      outboxSchemaRowsRead: 1,
      outboxSchemaRowsWritten: 1,
      freshCutoverMarkerRowsRead: 1,
      freshCutoverMarkerRowsWritten: 2,
    }),
    afterBoundary: (boundary) => {
      if (boundary === crashAt) throw new Error(`crash:${boundary}`);
    },
  };
  const invoke = async (boundary: HistoricalFresh0016CoordinatorBoundary) => {
    crashAt = boundary;
    await assert.rejects(
      runHistoricalDataFresh0016Cutover({
        mode: "finish",
        cwd: fixture.root,
        backupDirectory: fixture.backupDirectory,
        runId: fixture.runId,
        productionConfirmation: "--confirm-production",
        lostKeyBoundaryConfirmation:
          HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
        runner: () => {
          throw new Error("No real Wrangler or network call is allowed.");
        },
        clock: () => new Date("2026-07-15T00:05:00.000Z"),
        owner,
        dependencies,
      }),
      new RegExp(`crash:${boundary}`),
    );
  };
  try {
    await invoke("before-migration-cardinality");
    assert.equal(cardinalityCalls, 0);
    assert.equal(releases, 1);
    assert.equal(
      fs.existsSync(
        fixture.paths.auxiliaryFiles.migrationBudgetPrepared,
      ),
      false,
    );

    await invoke("migration-budget-prepared-published");
    assert.equal(cardinalityCalls, 1);
    assert.equal(maximumCalls, 2);
    assert.equal(exactCalls, 0);
    assert.equal(releases, 1);

    await invoke("before-migration-exact");
    assert.equal(cardinalityCalls, 1);
    assert.equal(exactCalls, 0);

    await invoke("migration-exact-reserved");
    assert.equal(cardinalityCalls, 1);
    assert.equal(exactCalls, 1);

    await invoke("before-manifest");
    assert.equal(cardinalityCalls, 1);
    assert.equal(exactCalls, 1);

    await invoke("manifest-published");
    assert.equal(cardinalityCalls, 1);
    assert.equal(exactCalls, 1);
    assert.equal(
      classifyHistoricalFresh0016State({
        backupDirectory: fixture.backupDirectory,
        runId: fixture.runId,
      }).currentStage,
      "manifest",
    );
  } finally {
    fixture.cleanup();
  }
});

function createStageFourFixture(
  options: Readonly<{
    releaseTimingMode?: HistoricalFresh0016CutoverTimingMode;
  }> = {},
) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(
      path.join(os.tmpdir(), "inspir-fresh-coordinator-"),
    ),
  );
  fs.chmodSync(root, 0o700);
  const backupDirectory = path.join(root, "backup");
  fs.mkdirSync(backupDirectory, { mode: 0o700 });
  const runId = randomUUID();
  const paths = createHistoricalFresh0016RunDirectory({
    backupDirectory,
    runId,
  });
  fs.chmodSync(path.join(backupDirectory, "cloudflare"), 0o700);
  fs.chmodSync(path.dirname(paths.runDirectory), 0o700);
  fs.chmodSync(paths.runDirectory, 0o700);
  writeWorkerCandidateEvidence(
    workerCandidateUploadEvidencePath(backupDirectory),
    uploadEvidence,
  );
  const owner = { hostname: os.hostname(), pid: process.pid + 10_000 };
  const releaseTimingMode =
    options.releaseTimingMode ??
    HISTORICAL_FRESH_0016_WORKERS_FREE_UTC_RESET_TIMING_MODE;
  const common = {
    backupDirectory,
    runId,
    sourceFingerprint: source,
    owner,
  } as const;
  publishHistoricalFresh0016StateStage({
    ...common,
    stage: "claim",
    payload: {
      kind: HISTORICAL_FRESH_0016_CHAIN_CLAIM_KIND,
      schemaVersion: 2,
      releaseTimingMode,
      operatorConfirmationFlag:
        HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
      lostKeyBoundaryAccepted: true,
      legacyIntervalContinuityProven: false,
      retroactiveContinuityClaimed: false,
      policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
      sourceFingerprint: source,
      workerRelease,
      claimLiveTopology: topologyEvidence(
        "2026-07-14T23:49:30.000Z",
      ),
      hmacKeyId,
      predecessorPrerequisites: predecessorPrerequisites(),
    },
    now: new Date("2026-07-14T23:50:00.000Z"),
  });
  publishHistoricalFresh0016StateStage({
    ...common,
    stage: "predecessor-authorized",
    payload: { fixture: true },
    now: new Date("2026-07-14T23:51:00.000Z"),
  });
  publishHistoricalFresh0016StateStage({
    ...common,
    stage: "predecessor-prepared",
    payload: { fixture: true },
    now: new Date("2026-07-14T23:52:00.000Z"),
  });
  publishHistoricalFresh0016StateStage({
    ...common,
    stage: "predecessor-complete",
    payload: { fixture: true },
    now: new Date("2026-07-14T23:53:00.000Z"),
  });
  return {
    root,
    backupDirectory,
    runId,
    owner,
    paths,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function createAuthorizationTailFixture(
  tail: "predecessor" | "successor",
) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-fresh-authorization-tail-"),
  );
  fs.chmodSync(root, 0o700);
  const backupDirectory = path.join(root, "backup");
  fs.mkdirSync(backupDirectory, { mode: 0o700 });
  const runId = randomUUID();
  const paths = createHistoricalFresh0016RunDirectory({
    backupDirectory,
    runId,
  });
  const owner = { hostname: os.hostname(), pid: process.pid + 10_000 };
  const common = {
    backupDirectory,
    runId,
    sourceFingerprint: source,
    owner,
  } as const;
  publishHistoricalFresh0016StateStage({
    ...common,
    stage: "claim",
    payload: {
      kind: HISTORICAL_FRESH_0016_CHAIN_CLAIM_KIND,
      schemaVersion: 2,
      operatorConfirmationFlag:
        HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
      lostKeyBoundaryAccepted: true,
      legacyIntervalContinuityProven: false,
      retroactiveContinuityClaimed: false,
      policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      database: HISTORICAL_FRESH_0016_CUTOVER_POLICY.database,
      sourceFingerprint: source,
      workerRelease,
      claimLiveTopology: topologyEvidence(
        "2026-07-14T23:49:30.000Z",
      ),
      hmacKeyId,
      predecessorPrerequisites: predecessorPrerequisites(),
    },
    now: new Date("2026-07-14T23:50:00.000Z"),
  });
  publishHistoricalFresh0016StateStage({
    ...common,
    stage: "predecessor-authorized",
    payload: { fixture: true },
    now: new Date("2026-07-14T23:51:00.000Z"),
  });
  if (tail === "successor") {
    for (const [index, stage] of ([
      "predecessor-prepared",
      "predecessor-complete",
    ] as const).entries()) {
      publishHistoricalFresh0016StateStage({
        ...common,
        stage,
        payload: { fixture: true },
        now: new Date(`2026-07-14T23:5${index + 2}:00.000Z`),
      });
    }
    fs.writeFileSync(paths.auxiliaryFiles.migrationBudgetPrepared, "fixture\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    for (const [index, stage] of ([
      "manifest",
      "migration-authorized",
      "migration-complete",
      "runtime-verification",
      "successor-authorized",
    ] as const).entries()) {
      publishHistoricalFresh0016StateStage({
        ...common,
        stage,
        payload: { fixture: true },
        now: new Date(`2026-07-15T00:0${index + 1}:00.000Z`),
      });
    }
  }
  return {
    root,
    backupDirectory,
    runId,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function ledgerResult(input: {
  operationId: string;
  phase: "maximum" | "exact";
  revision: number;
  rowsRead: number;
  rowsWritten: number;
  maximumRowsRead: number;
  maximumRowsWritten: number;
  totalsRowsRead: number;
  totalsRowsWritten: number;
  updatedAt: string;
  backupDirectory: string;
}): D1ReleaseBudgetReservationResult {
  return {
    ledgerPath: path.join(
      input.backupDirectory,
      "cloudflare",
      "d1-release-budget-ledger-2026-07-15.json",
    ),
    utcDay: "2026-07-15",
    revision: input.revision,
    idempotent: false,
    reservation: {
      operationId: input.operationId,
      operation: HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME,
      candidateVersionId: targetCandidateVersionId,
      phase: input.phase,
      rowsRead: input.rowsRead,
      rowsWritten: input.rowsWritten,
      maximumRowsRead: input.maximumRowsRead,
      maximumRowsWritten: input.maximumRowsWritten,
      createdAt: "2026-07-15T00:05:00.000Z",
      updatedAt: input.updatedAt,
    },
    totals: {
      rowsRead: input.totalsRowsRead,
      rowsWritten: input.totalsRowsWritten,
    },
    accountedUsage: {
      rowsRead: usage.rowsRead + input.totalsRowsRead,
      rowsWritten: usage.rowsWritten + input.totalsRowsWritten,
    },
  };
}

function candidateUploadHandle(backupDirectory: string) {
  return {
    path: workerCandidateUploadEvidencePath(backupDirectory),
    value: uploadEvidence,
    sha256: uploadEvidenceSha256,
  };
}

function topologyEvidence(
  observedAt: Date | string,
  release: Readonly<{
    phase: "uploaded-inactive";
    targetCandidateVersionId: string;
    serviceBaselineVersionId: string;
    uploadEvidenceSha256: string;
  }> = workerRelease,
) {
  return createHistoricalFresh0016LiveTopologyEvidence({
    observedAt:
      typeof observedAt === "string" ? new Date(observedAt) : observedAt,
    statusOutput: baselineDeploymentStatusOutput,
    ...release,
  });
}

function topologyObservation(
  input: Parameters<
    HistoricalFresh0016CoordinatorDependencies["observeLiveTopology"]
  >[0],
) {
  return {
    evidence: topologyEvidence(input.observedAt, input.workerRelease),
    statusOutput: baselineDeploymentStatusOutput,
  };
}

function predecessorPrerequisites(
  topology = topologyEvidence("2026-07-14T23:44:30.000Z"),
) {
  return {
    kind: HISTORICAL_FRESH_0016_PREDECESSOR_PREREQUISITES_KIND,
    schemaVersion: 3 as const,
    timing: "completed-on-earlier-utc-day-before-predecessor" as const,
    predecessorUtcDay: "2026-07-14",
    sourceFingerprint: source,
    workerRelease,
    releaseIdentitySha256: "d".repeat(64),
    topic: {
      createdAt: "2026-07-13T20:00:00.000Z",
      evidenceSha256: "e".repeat(64),
      seedSha256: "f".repeat(64),
      verifiedTopics: 12,
      verifiedArchivedTopics: 1,
    },
    translation: {
      createdAt: "2026-07-13T21:00:00.000Z",
      evidenceSha256: "1".repeat(64),
      method: "read-only-drift" as const,
      remoteQueries: 3,
      billedRowsRead: 100,
      repairApplied: false,
    },
    runtimeMigration0017: {
      verifiedAt: "2026-07-14T18:05:00.000Z",
      verificationEvidenceSha256: "4".repeat(64),
      operationId: "d1-runtime-migration-0017" as const,
      reservedRowsRead: 768 as const,
      reservedRowsWritten: 0 as const,
      state: "absent-deferred-free-plan" as const,
      reason:
        "cloudflare-free-plan-verified-production-users-exceed-0017-index-write-envelope" as const,
      runtimePath:
        "users-email-unique-exact-lookup-with-bounded-casefold-fallback" as const,
    },
    liveRuntimeState: {
      kind: "inspir-historical-data-fresh-0016-predecessor-runtime-gate-v2" as const,
      schemaVersion: 2 as const,
      timing:
        "live-before-hmac-run-predecessor-ledger-and-snapshot" as const,
      predecessorUtcDay: "2026-07-14",
      operationId: `historical-fresh-0016-predecessor-runtime-gate:${"6".repeat(64)}`,
      sourceFingerprint: source,
      workerRelease,
      liveTopology: topology,
      maximum: { rowsRead: 17_304 as const, rowsWritten: 0 as const },
      exactState: {
        migrations0013To0015: "applied" as const,
        migration0016: "absent" as const,
        migration0017: "absent-deferred-free-plan" as const,
        appliedStaticCheckCount: 8 as const,
        absent0016StaticCheckCount: 5 as const,
      },
      accounting:
        "dedicated-top-level-maximum-reserved-before-live-read-only-queries" as const,
    },
    mutationRule:
      "no-topic-translation-or-deferred-0017-apply-from-predecessor-through-final-verifier" as const,
    privacy: "release-identities-and-aggregate-counts-only" as const,
  };
}

function canonicalText(value: unknown) {
  return JSON.stringify(value);
}
