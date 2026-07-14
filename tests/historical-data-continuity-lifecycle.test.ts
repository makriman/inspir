import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import { HISTORICAL_DATA_CONTINUITY_POLICY } from "../scripts/cloudflare/historical-data-continuity-policy";
import { classifyHistoricalSuccessorCaptureState } from "../scripts/cloudflare/historical-data-successor-capture-state";
import {
  D1_DATABASE_NAME,
  stableStringify,
} from "../scripts/cloudflare/migration-config";
import {
  buildGitCommitSourceFingerprint,
  buildRepoSourceFingerprint,
  type SourceFingerprint,
} from "../scripts/cloudflare/source-fingerprint";
import {
  HISTORICAL_BILLED_READ_LIMIT,
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  HISTORICAL_DATA_LEGACY_PRESERVATION_KIND,
  HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
  HISTORICAL_DATA_PRESERVATION_KIND,
  HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
  historicalDataBudgetOperationId,
  historicalDataHmacKeyId,
  historicalDataReportPath,
  type HistoricalDataBaselineReport,
  type HistoricalDataLegacyBaselineReport,
} from "../scripts/cloudflare/verify-historical-data-preservation";

const predecessorCreatedAt = "2026-07-13T01:10:08.863Z";
const predecessorArchiveAt = new Date("2026-07-13T01:11:08.863Z");
const successorCreatedAt = "2026-07-14T00:10:08.863Z";
const successorVerifyAt = new Date("2026-07-14T00:11:08.863Z");
const successorReplayAfterWindow = new Date("2026-07-14T01:11:08.863Z");
const hmacSecret = "historical-continuity-lifecycle-secret-32-bytes";
const rowsRead = 20;
const maximumRowsRead = HISTORICAL_BILLED_READ_LIMIT;
const emptyUsage = {
  databaseCount: 1,
  queryGroups: 0,
  rowsRead: 0,
  rowsWritten: 0,
  executions: 0,
  windowMinutes: 1,
};

test("archive and rollover bind copied predecessor bytes and one successor byte buffer", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-historical-continuity-lifecycle-"),
  );
  const backupDir = path.join(root, "backup");
  const repoDir = path.join(root, "repo");
  const remoteDir = path.join(root, "remote.git");
  fs.mkdirSync(backupDir, { mode: 0o700 });
  fs.mkdirSync(repoDir, { mode: 0o700 });

  try {
    git(root, "init", "--bare", remoteDir);
    git(repoDir, "init", "--initial-branch=main");
    git(repoDir, "config", "user.email", "continuity@example.com");
    git(repoDir, "config", "user.name", "Continuity Test");
    fs.writeFileSync(path.join(repoDir, "source.txt"), "predecessor\n", "utf8");
    git(repoDir, "add", "source.txt");
    git(repoDir, "commit", "-m", "predecessor");
    git(repoDir, "remote", "add", "origin", remoteDir);
    git(repoDir, "push", "--set-upstream", "origin", "main");

    const predecessorCommit = git(repoDir, "rev-parse", "HEAD");
    const predecessorSource = buildGitCommitSourceFingerprint(predecessorCommit, repoDir);
    fs.writeFileSync(path.join(repoDir, "source.txt"), "successor\n", "utf8");
    git(repoDir, "add", "source.txt");
    git(repoDir, "commit", "-m", "successor");
    git(repoDir, "push");
    const successorSource = buildRepoSourceFingerprint(repoDir);
    assert.notEqual(successorSource.sha256, predecessorSource.sha256);

    const predecessorOperationId = legacyBaselineOperationId(predecessorSource);
    const predecessorLedger = createExactBaselineReservation({
      backupDir,
      operationId: predecessorOperationId,
      sourceFingerprint: predecessorSource,
      createdAt: new Date("2026-07-13T01:09:08.863Z"),
      updatedAt: new Date("2026-07-13T01:09:09.863Z"),
    });
    const predecessor = legacyBaseline({
      backupDir,
      operationId: predecessorOperationId,
      sourceFingerprint: predecessorSource,
      ledger: predecessorLedger,
    });
    const baselinePath = historicalDataReportPath(backupDir, "baseline");
    writePrivateJsonDurably(baselinePath, predecessor, { replace: false });
    const predecessorBaselineBytes = fs.readFileSync(baselinePath);
    const predecessorLedgerBytes = fs.readFileSync(predecessorLedger.ledgerPath);

    Object.assign(HISTORICAL_DATA_CONTINUITY_POLICY.predecessor, {
      gitCommit: predecessorCommit,
      sourceSha256: predecessorSource.sha256,
      sourceFileCount: predecessorSource.fileCount,
      baselineOperationId: predecessorOperationId,
      baselineSha256: sha256(predecessorBaselineBytes),
      ledgerFileName: path.basename(predecessorLedger.ledgerPath),
      ledgerSha256: sha256(predecessorLedgerBytes),
    });
    Object.assign(HISTORICAL_DATA_CONTINUITY_POLICY.budgetBlock, {
      observedRowsRead: 0,
      existingReservedRowsRead: rowsRead,
      requestedVerificationRowsRead: maximumRowsRead,
      projectedRowsRead: maximumRowsRead + rowsRead,
      safeRowsReadLimit: maximumRowsRead + rowsRead - 1,
      d1SnapshotQueryExecuted: false,
    });

    const continuity = await import(
      "../scripts/cloudflare/verify-historical-data-continuity"
    );
    const manifest = continuity.archiveHistoricalDataContinuityPredecessor({
      backupDir,
      cwd: repoDir,
      now: predecessorArchiveAt,
    });
    assert.deepEqual(fs.readFileSync(manifest.baseline.archivePath), predecessorBaselineBytes);
    assert.deepEqual(fs.readFileSync(manifest.ledger.archivePath), predecessorLedgerBytes);

    const successorOperationId = historicalDataBudgetOperationId(
      "baseline",
      compactSource(successorSource),
    );
    const successorLedger = createExactBaselineReservation({
      backupDir,
      operationId: successorOperationId,
      sourceFingerprint: successorSource,
      createdAt: new Date("2026-07-14T00:09:08.863Z"),
      updatedAt: new Date("2026-07-14T00:09:09.863Z"),
      maximumReservationRowsRead:
        HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
    });
    const successor = currentBaseline({
      backupDir,
      operationId: successorOperationId,
      sourceFingerprint: successorSource,
      ledger: successorLedger,
    });
    let keyLoads = 0;
    let baselineCreations = 0;
    let releaseKeyLoad: ((value: { hmacKeyId: string; secret: string }) => void) | undefined;
    const keyLoad = new Promise<{ hmacKeyId: string; secret: string }>((resolve) => {
      releaseKeyLoad = resolve;
    });
    const captureOptions = {
      backupDir,
      cwd: repoDir,
      dependencies: {
        clock: () => successorVerifyAt,
        hmacKeyLoader: async () => {
          keyLoads += 1;
          return await keyLoad;
        },
        baselineCreator: (options) => {
          baselineCreations += 1;
          options.beforeSnapshot?.({
            phase: "baseline",
            backupDir,
            startedAt: new Date("2026-07-14T00:09:08.863Z"),
            utcDay: "2026-07-14",
            operationId: successorOperationId,
            sourceFingerprint: compactSource(successorSource),
            maximumRowsRead,
            maximumAutomaticReadAttempts:
              HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
            maximumBillableRowsRead:
              HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
          });
          return structuredClone(successor);
        },
      },
    } satisfies Parameters<typeof continuity.captureHistoricalDataContinuitySuccessor>[0];
    let signalKeyLoaderEntered: (() => void) | undefined;
    let rejectKeyLoad: ((reason: Error) => void) | undefined;
    const keyLoaderEntered = new Promise<void>((resolve) => {
      signalKeyLoaderEntered = resolve;
    });
    const deniedKeyLoad = new Promise<never>((_resolve, reject) => {
      rejectKeyLoad = reject;
    });
    const deniedCapture = continuity.captureHistoricalDataContinuitySuccessor({
        backupDir,
        cwd: repoDir,
        dependencies: {
          clock: () => successorVerifyAt,
          hmacKeyLoader: async () => {
            signalKeyLoaderEntered?.();
            return await deniedKeyLoad;
          },
          baselineCreator: () => {
            throw new Error("D1 baseline creation must not start without the key");
          },
        },
      });
    await keyLoaderEntered;
    const pendingState = classifyHistoricalSuccessorCaptureState({
      stateDirectory: manifest.archiveDir,
    });
    assert.equal(pendingState.status, "claimed-pre-scan");
    if (pendingState.status !== "claimed-pre-scan") {
      throw new Error("Expected an exact retained pre-scan claim.");
    }
    const retainedRunId = pendingState.claim.value.runId;
    await assert.rejects(
      continuity.captureHistoricalDataContinuitySuccessor({
        backupDir,
        cwd: repoDir,
        resumePreScanRunId: retainedRunId,
        dependencies: {
          clock: () => successorVerifyAt,
          hmacKeyLoader: async () => {
            throw new Error("Concurrent resume must not load the Keychain.");
          },
          baselineCreator: () => {
            throw new Error("Concurrent resume must not scan D1.");
          },
        },
      }),
      /already active in this process/,
    );
    assert.ok(rejectKeyLoad);
    rejectKeyLoad(new Error("simulated Keychain denial before D1 scan"));
    await assert.rejects(
      deniedCapture,
      /simulated Keychain denial before D1 scan/,
    );
    let invalidRetryAccountingCallbacks = 0;
    let invalidRetryAccountingRunnerCalls = 0;
    for (const retryAccounting of [
      {
        maximumAutomaticReadAttempts:
          HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS - 1,
        maximumBillableRowsRead:
          HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      },
      {
        maximumAutomaticReadAttempts:
          HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
        maximumBillableRowsRead: HISTORICAL_BILLED_READ_LIMIT,
      },
    ]) {
      await assert.rejects(
        continuity.captureHistoricalDataContinuitySuccessor({
          backupDir,
          cwd: repoDir,
          resumePreScanRunId: retainedRunId,
          dependencies: {
            clock: () => successorVerifyAt,
            hmacKeyLoader: async () => ({
              hmacKeyId: historicalDataHmacKeyId(hmacSecret),
              secret: hmacSecret,
            }),
            baselineCreator: (options) => {
              invalidRetryAccountingCallbacks += 1;
              const validContext = {
                phase: "baseline",
                backupDir,
                startedAt: new Date("2026-07-14T00:09:08.863Z"),
                utcDay: "2026-07-14",
                operationId: successorOperationId,
                sourceFingerprint: compactSource(successorSource),
                maximumRowsRead,
                maximumAutomaticReadAttempts:
                  HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
                maximumBillableRowsRead:
                  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
              } as const;
              const invalidContext = new Proxy(validContext, {
                get: (target, property, receiver) => {
                  if (property === "maximumAutomaticReadAttempts") {
                    return retryAccounting.maximumAutomaticReadAttempts;
                  }
                  if (property === "maximumBillableRowsRead") {
                    return retryAccounting.maximumBillableRowsRead;
                  }
                  return Reflect.get(target, property, receiver);
                },
              });
              options.beforeSnapshot?.(invalidContext);
              invalidRetryAccountingRunnerCalls += 1;
              throw new Error(
                "Invalid retry accounting reached the D1 snapshot runner.",
              );
            },
          },
        }),
        /scan authorization does not match its exact claim/,
      );
      assert.equal(
        classifyHistoricalSuccessorCaptureState({
          stateDirectory: manifest.archiveDir,
        }).status,
        "claimed-pre-scan",
      );
    }
    assert.equal(invalidRetryAccountingCallbacks, 2);
    assert.equal(invalidRetryAccountingRunnerCalls, 0);
    const resumedCaptureOptions = {
      ...captureOptions,
      resumePreScanRunId: retainedRunId,
    } satisfies Parameters<typeof continuity.captureHistoricalDataContinuitySuccessor>[0];
    const firstCapture = continuity.captureHistoricalDataContinuitySuccessor(
      resumedCaptureOptions,
    );
    await assert.rejects(
      continuity.captureHistoricalDataContinuitySuccessor({
        ...resumedCaptureOptions,
        dependencies: {
          ...captureOptions.dependencies,
          hmacKeyLoader: async () => {
            throw new Error("Concurrent loser must not load the Keychain or scan D1.");
          },
        },
      }),
      /already active in this process/,
    );
    assert.ok(releaseKeyLoad);
    releaseKeyLoad({
      hmacKeyId: historicalDataHmacKeyId(hmacSecret),
      secret: hmacSecret,
    });
    const captured = await firstCapture;
    assert.equal(captured.replayed, false);
    assert.deepEqual(captured.report, successor);
    assert.equal(keyLoads, 1);
    assert.equal(baselineCreations, 1);

    let driftReplayClockCalls = 0;
    await assert.rejects(
      continuity.captureHistoricalDataContinuitySuccessor({
        backupDir,
        cwd: repoDir,
        dependencies: {
          clock: () => {
            driftReplayClockCalls += 1;
            if (driftReplayClockCalls === 2) {
              fs.writeFileSync(path.join(repoDir, "source.txt"), "drifted during replay\n");
            }
            return successorReplayAfterWindow;
          },
          hmacKeyLoader: async () => {
            throw new Error("Completed replay must not load the Keychain.");
          },
          baselineCreator: () => {
            throw new Error("Completed replay must not scan D1.");
          },
        },
      }),
      /clean Git working tree/,
    );
    fs.writeFileSync(path.join(repoDir, "source.txt"), "successor\n");

    const replayed = await continuity.captureHistoricalDataContinuitySuccessor({
      backupDir,
      cwd: repoDir,
      dependencies: {
        clock: () => successorReplayAfterWindow,
        hmacKeyLoader: async () => {
          throw new Error("Completed replay must not load the Keychain.");
        },
        baselineCreator: () => {
          throw new Error("Completed replay must not scan D1.");
        },
      },
    });
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.report, successor);
    assert.equal(keyLoads, 1);
    assert.equal(baselineCreations, 1);
    const successorBaselineBytes = fs.readFileSync(baselinePath);
    const successorBaselineStat = fs.statSync(baselinePath);
    const swappedBytes = Buffer.from('{"swappedAfterDescriptorRead":true}\n', "utf8");
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
          const descriptorStat = fs.fstatSync(file);
          if (
            descriptorStat.dev === successorBaselineStat.dev &&
            descriptorStat.ino === successorBaselineStat.ino
          ) {
            swapped = true;
            const replacementPath = `${baselinePath}.replacement`;
            fs.writeFileSync(replacementPath, swappedBytes, {
              flag: "wx",
              mode: 0o600,
            });
            fs.renameSync(replacementPath, baselinePath);
          }
        }
        return result;
      },
    );

    const report = continuity.verifyHistoricalDataContinuityRollover({
      backupDir,
      cwd: repoDir,
      hmacSecret,
      now: successorVerifyAt,
    });
    assert.equal(swapped, true);
    assert.equal(report.successor.baselineSha256, sha256(successorBaselineBytes));
    assert.notEqual(report.successor.baselineSha256, sha256(swappedBytes));
    assert.deepEqual(fs.readFileSync(baselinePath), swappedBytes);
    assert.deepEqual(fs.readFileSync(manifest.baseline.archivePath), predecessorBaselineBytes);
    assert.deepEqual(fs.readFileSync(manifest.ledger.archivePath), predecessorLedgerBytes);

    fs.writeFileSync(baselinePath, successorBaselineBytes, { mode: 0o600 });
    const validated = continuity.readAndValidateHistoricalDataContinuityReport({
      backupDir,
      cwd: repoDir,
      expectedSourceFingerprint: successorSource,
      now: successorVerifyAt,
    });
    assert.equal(validated.successor.baselineSha256, sha256(successorBaselineBytes));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createExactBaselineReservation(options: {
  backupDir: string;
  operationId: string;
  sourceFingerprint: SourceFingerprint;
  createdAt: Date;
  updatedAt: Date;
  maximumReservationRowsRead?: number;
}) {
  const maximumReservationRowsRead =
    options.maximumReservationRowsRead ?? maximumRowsRead;
  reserveD1ReleaseBudget({
    backupDir: options.backupDir,
    operationId: options.operationId,
    operation: "Historical production data baseline capture",
    sourceFingerprint: compactSource(options.sourceFingerprint),
    phase: "maximum",
    rowsRead: maximumReservationRowsRead,
    rowsWritten: 0,
    observedUsage: emptyUsage,
    now: options.createdAt,
  });
  return reserveD1ReleaseBudget({
    backupDir: options.backupDir,
    operationId: options.operationId,
    operation: "Historical production data baseline capture",
    sourceFingerprint: compactSource(options.sourceFingerprint),
    phase: "exact",
    rowsRead,
    rowsWritten: 0,
    observedUsage: emptyUsage,
    now: options.updatedAt,
    expectedUtcDay: options.updatedAt.toISOString().slice(0, 10),
  });
}

function currentBaseline(options: {
  backupDir: string;
  operationId: string;
  sourceFingerprint: SourceFingerprint;
  ledger: ReturnType<typeof createExactBaselineReservation>;
}): HistoricalDataBaselineReport {
  const coreDatasets = datasets();
  return {
    kind: HISTORICAL_DATA_PRESERVATION_KIND,
    schemaVersion: 2,
    phase: "baseline",
    createdAt: successorCreatedAt,
    utcDay: successorCreatedAt.slice(0, 10),
    operationId: options.operationId,
    backupDir: options.backupDir,
    database: D1_DATABASE_NAME,
    ok: true,
    privacy: "hmac-sha256-no-raw-identifiers",
    hmacKeyId: historicalDataHmacKeyId(hmacSecret),
    sourceFingerprint: options.sourceFingerprint,
    rowsRead,
    rowsWritten: 0,
    usage: { ...emptyUsage, rowsRead },
    ledger: options.ledger,
    limits: {
      coreRows: 350_000,
      supplementalRows: 125_000,
      operationalRows: 10_000,
      logicalSnapshotRowsRead: HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
      logicalRowsReadLimit: HISTORICAL_BILLED_READ_LIMIT,
      maximumAutomaticReadAttempts:
        HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
      billableRowsReadReservation:
        HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      sentinelsPerDataset: 16,
    },
    datasets: coreDatasets,
    supplementalDatasets: {
      ai_runs: dataset("ai_runs"),
      user_memory_graph_edges: { ...coreDatasets.user_memories },
      user_memory_settings: dataset("user_memory_settings"),
      chat_memory_summaries: dataset("chat_memory_summaries"),
      chat_memory_turns: dataset("chat_memory_turns"),
      user_memory_profiles: dataset("user_memory_profiles"),
      user_memory_summaries: dataset("user_memory_summaries"),
      memory_synthesis_runs: dataset("memory_synthesis_runs"),
      memory_source_feedback: dataset("memory_source_feedback"),
      memory_events: dataset("memory_events"),
    },
    operationalDatasets: {
      memory_vector_cleanup_outbox: operationalOutboxDataset(),
    },
  };
}

function legacyBaseline(options: {
  backupDir: string;
  operationId: string;
  sourceFingerprint: SourceFingerprint;
  ledger: ReturnType<typeof createExactBaselineReservation>;
}): HistoricalDataLegacyBaselineReport {
  return {
    kind: HISTORICAL_DATA_LEGACY_PRESERVATION_KIND,
    schemaVersion: 1,
    phase: "baseline",
    createdAt: predecessorCreatedAt,
    utcDay: predecessorCreatedAt.slice(0, 10),
    operationId: options.operationId,
    backupDir: options.backupDir,
    database: D1_DATABASE_NAME,
    ok: true,
    privacy: "hmac-sha256-no-raw-identifiers",
    hmacKeyId: historicalDataHmacKeyId(hmacSecret),
    sourceFingerprint: options.sourceFingerprint,
    rowsRead,
    rowsWritten: 0,
    usage: { ...emptyUsage, rowsRead },
    ledger: options.ledger,
    limits: {
      coreRows: 350_000,
      billedReads: maximumRowsRead,
      sentinelsPerDataset: 16,
    },
    datasets: datasets(),
  };
}

function datasets(): HistoricalDataBaselineReport["datasets"] {
  return {
    users: dataset("users"),
    accounts: dataset("accounts"),
    sessions: dataset("sessions"),
    chats: dataset("chats"),
    messages: dataset("messages"),
    admin_users: dataset("admin_users"),
    user_memories: dataset("user_memories"),
    activity_runs: dataset("activity_runs"),
    product_events: dataset("product_events"),
    profile_photo_pointers: dataset("profile_photo_pointers", "users"),
  };
}

function dataset(name: string, schemaTable = name) {
  const columns = [{
    name: "id",
    type: "text",
    notNull: 1 as const,
    primaryKey: 1,
  }];
  return {
    rowCount: 1,
    schemaTable,
    schemaSha256: createHash("sha256")
      .update(stableStringify(columns.map((column) =>
        `${column.name}\0${column.type}\0${column.notNull}\0${column.primaryKey}`
      )))
      .digest("hex"),
    columns,
    sentinels: [createHash("sha256").update(`sentinel:${name}`).digest("hex")],
  };
}

function operationalOutboxDataset() {
  const columns = [
    { name: "vector_id", type: "text", notNull: 1 as const, primaryKey: 1 },
    { name: "absence_count", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "attempt_count", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "created_at", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "last_attempt_at", type: "integer", notNull: 0 as const, primaryKey: 0 },
    { name: "last_error", type: "text", notNull: 0 as const, primaryKey: 0 },
    { name: "lease_token", type: "text", notNull: 0 as const, primaryKey: 0 },
    { name: "lease_until", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "next_attempt_at", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "owner_user_id", type: "text", notNull: 0 as const, primaryKey: 0 },
    { name: "reason", type: "text", notNull: 1 as const, primaryKey: 0 },
    { name: "source_namespace", type: "text", notNull: 0 as const, primaryKey: 0 },
    { name: "source_row_id", type: "text", notNull: 0 as const, primaryKey: 0 },
    { name: "source_row_revision", type: "integer", notNull: 0 as const, primaryKey: 0 },
    { name: "state", type: "text", notNull: 1 as const, primaryKey: 0 },
    { name: "updated_at", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "write_fence_expires_at", type: "integer", notNull: 0 as const, primaryKey: 0 },
    { name: "write_token", type: "text", notNull: 0 as const, primaryKey: 0 },
  ];
  return {
    lifecycle: "mutable-drainable-outbox" as const,
    rowCount: 0,
    schemaTable: "memory_vector_cleanup_outbox" as const,
    schemaSha256: createHash("sha256")
      .update(stableStringify(columns.map((column) =>
        `${column.name}\0${column.type}\0${column.notNull}\0${column.primaryKey}`
      )))
      .digest("hex"),
    columns,
  };
}

function legacyBaselineOperationId(sourceFingerprint: SourceFingerprint) {
  const binding = createHash("sha256")
    .update(stableStringify({
      kind: HISTORICAL_DATA_LEGACY_PRESERVATION_KIND,
      phase: "baseline",
      sourceFingerprint: compactSource(sourceFingerprint),
    }))
    .digest("hex");
  return `historical-data-preservation-baseline:${binding}`;
}

function compactSource(sourceFingerprint: SourceFingerprint) {
  return {
    sha256: sourceFingerprint.sha256,
    fileCount: sourceFingerprint.fileCount,
  };
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_SYSTEM: os.devNull,
      GIT_OPTIONAL_LOCKS: "0",
    },
  }).trim();
}
