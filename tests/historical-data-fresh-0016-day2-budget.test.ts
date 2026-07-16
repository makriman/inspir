import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readD1ReleaseBudgetLedger,
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import {
  createHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
  HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ,
  HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import {
  RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
  RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
  RUNTIME_MIGRATION_0017_OPERATION,
  RUNTIME_MIGRATION_0017_OPERATION_ID,
} from "../scripts/cloudflare/check-d1-runtime-migration-0017-budget";
import {
  HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ,
  HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_OPERATION,
} from "../scripts/cloudflare/historical-data-fresh-0016-prerequisites";
import {
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
} from "../scripts/cloudflare/historical-data-fresh-0016-migration-budget";
import {
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
} from "../scripts/cloudflare/historical-data-pre-0016-snapshot";
import {
  HISTORICAL_FRESH_0016_DAY2_BUDGET_OPERATION_NAME,
  preauthorizeHistoricalFresh0016Day2Budget,
  readHistoricalFresh0016Day2BudgetEnvelope,
  refineHistoricalFresh0016Day2BudgetAfterFinalProof,
} from "../scripts/cloudflare/historical-data-fresh-0016-day2-budget";
import {
  createHistoricalFresh0016RunDirectory,
  historicalFresh0016JsonSha256,
  publishHistoricalFresh0016StateStage,
} from "../scripts/cloudflare/historical-data-fresh-0016-state";
import {
  HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS,
  HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS,
  historicalDataBudgetOperationId,
  historicalDataSchemaHash,
  parseHistoricalDataVerificationReport,
  validateHistoricalDataFresh0016FinalVerificationReport,
  type HistoricalColumnIdentity,
  type HistoricalDataVerificationReport,
  type HistoricalDatasetEvidence,
  type HistoricalDatasetName,
  type HistoricalOperationalDatasetEvidence,
  type HistoricalOperationalDatasetName,
  type HistoricalFresh0016FinalLiveTopology,
  type HistoricalSupplementalDatasetName,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import { D1_DATABASE_NAME } from "../scripts/cloudflare/migration-config";
import {
  buildWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
  workerReleaseMessageSha256,
  writeWorkerCandidateEvidence,
} from "../scripts/cloudflare/worker-candidate-release-evidence";

const runId = "11111111-1111-4111-8111-111111111111";
const targetCandidateVersionId = "22222222-2222-4222-8222-222222222222";
const serviceBaselineVersionId = "33333333-3333-4333-8333-333333333333";
const baselineStatusOutput = JSON.stringify({
  id: "44444444-4444-4444-8444-444444444444",
  versions: [{ version_id: serviceBaselineVersionId, percentage: 100 }],
});
const fullSourceFingerprint = sourceFixture();
const sourceFingerprint = {
  sha256: fullSourceFingerprint.sha256,
  fileCount: fullSourceFingerprint.fileCount,
} as const;
const owner = { hostname: "day2-budget-test", pid: 42 } as const;
const usage = {
  databaseCount: 1,
  queryGroups: 1,
  rowsRead: 99_964,
  rowsWritten: 5_000,
  executions: 1,
  windowMinutes: 10,
} as const;

test("fresh-0016 preauthorizes one Day-2 parent, accounts children beneath it, and refines only after durable final proof", () => {
  const rawBackupDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-fresh-day2-budget-"),
  );
  const backupDirectory = fs.realpathSync.native(rawBackupDirectory);
  fs.chmodSync(backupDirectory, 0o700);
  try {
    const paths = createHistoricalFresh0016RunDirectory({
      backupDirectory,
      runId,
    });
    fs.chmodSync(path.join(backupDirectory, "cloudflare"), 0o700);
    fs.chmodSync(path.dirname(paths.runDirectory), 0o700);
    fs.chmodSync(paths.runDirectory, 0o700);
    const upload = writeUploadEvidence(backupDirectory);
    const workerRelease = {
      phase: "uploaded-inactive" as const,
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256: upload.sha256,
    };
    const stageTimes = [
      "2026-07-14T23:55:00.000Z",
      "2026-07-14T23:56:00.000Z",
      "2026-07-14T23:57:00.000Z",
      "2026-07-14T23:58:00.000Z",
    ] as const;
    const stages = [
      "claim",
      "predecessor-authorized",
      "predecessor-prepared",
      "predecessor-complete",
    ] as const;
    let predecessorCompleteSha256 = "";
    for (const [index, stage] of stages.entries()) {
      const handle = publishHistoricalFresh0016StateStage({
        backupDirectory,
        runId,
        stage,
        sourceFingerprint,
        payload: { fixture: stage },
        now: new Date(stageTimes[index]!),
        owner,
      });
      if (stage === "predecessor-complete") {
        predecessorCompleteSha256 = handle.sha256;
      }
    }
    const envelope = preauthorizeHistoricalFresh0016Day2Budget({
      backupDirectory,
      cutoverRunId: runId,
      now: new Date("2026-07-15T00:05:00.000Z"),
      predecessorCompleteStageSha256: predecessorCompleteSha256,
      predecessorReportSha256: "b".repeat(64),
      sourceFingerprint,
      ...workerRelease,
      liveTopology: liveTopology(
        upload.sha256,
        "2026-07-15T00:04:30.000Z",
      ),
      liveDeploymentStatusOutput: baselineStatusOutput,
      initialObservedUsage: usage,
    });
    assert.equal(envelope.evidence.maximum.rowsRead, 3_900_036);
    assert.equal(
      envelope.evidence.maximum.ledger.reservation.operation,
      HISTORICAL_FRESH_0016_DAY2_BUDGET_OPERATION_NAME,
    );

    const childSpecs = [
      {
        operationId: `historical-fresh-0016-migration:${"c".repeat(64)}`,
        operation: "Historical fresh-0016 runtime migration",
        maximumRowsRead: 1_000,
        exactRowsRead: 100,
        maximumRowsWritten: 50,
        exactRowsWritten: 10,
      },
      {
        operationId: `historical-fresh-0016-successor:${"d".repeat(64)}`,
        operation: "Fresh 0016 post-migration historical successor capture",
        maximumRowsRead: 2_000,
        exactRowsRead: 200,
        maximumRowsWritten: 0,
        exactRowsWritten: 0,
      },
      {
        operationId: historicalDataBudgetOperationId(
          "verification",
          sourceFingerprint,
        ),
        operation: "Historical production data preservation verification",
        maximumRowsRead: 2_250_000,
        exactRowsRead: 300,
        maximumRowsWritten: 0,
        exactRowsWritten: 0,
      },
    ] as const;
    let verificationLedger: ReturnType<typeof reserveD1ReleaseBudget> | undefined;
    for (const [index, child] of childSpecs.entries()) {
      reserveD1ReleaseBudget({
        backupDir: backupDirectory,
        operationId: child.operationId,
        operation: child.operation,
        sourceFingerprint,
        candidateVersionId: targetCandidateVersionId,
        accountingParentOperationId: envelope.evidence.operationId,
        phase: "maximum",
        rowsRead: child.maximumRowsRead,
        rowsWritten: child.maximumRowsWritten,
        observedUsage: { ...usage, rowsRead: 3_000_000 },
        now: new Date(`2026-07-15T00:${10 + index * 2}:00.000Z`),
        expectedUtcDay: envelope.evidence.utcDay,
      });
      const exactLedger = reserveD1ReleaseBudget({
        backupDir: backupDirectory,
        operationId: child.operationId,
        operation: child.operation,
        sourceFingerprint,
        candidateVersionId: targetCandidateVersionId,
        accountingParentOperationId: envelope.evidence.operationId,
        phase: "exact",
        rowsRead: child.exactRowsRead,
        rowsWritten: child.exactRowsWritten,
        observedUsage: usage,
        now: new Date(`2026-07-15T00:${11 + index * 2}:00.000Z`),
        expectedUtcDay: envelope.evidence.utcDay,
      });
      if (index === 2) verificationLedger = exactLedger;
    }
    assert.ok(verificationLedger);
    const beforeProof = readD1ReleaseBudgetLedger(
      envelope.evidence.maximum.ledger.ledgerPath,
    );
    assert.deepEqual(beforeProof.totals, {
      rowsRead: 3_900_036,
      rowsWritten: 70_192,
    });

    const protectedEvidence = protectedDatasetEvidence();
    const baselineEvidence: NonNullable<
      HistoricalDataVerificationReport["baselineEvidence"]
    > = {
      kind: "fresh-0016-canonical-successor",
      cutoverRunId: runId,
      policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      canonicalArtifactSha256: "f".repeat(64),
      successorReportSha256: "1".repeat(64),
    };
    const finalProof = {
      kind: "inspir-historical-data-preservation-v2",
      schemaVersion: 2,
      phase: "verification",
      createdAt: "2026-07-15T00:19:45.000Z",
      ok: true,
      utcDay: envelope.evidence.utcDay,
      operationId: childSpecs[2].operationId,
      backupDir: path.resolve(backupDirectory),
      database: D1_DATABASE_NAME,
      privacy: "hmac-sha256-no-raw-identifiers",
      hmacKeyId: "2".repeat(64),
      sourceFingerprint: fullSourceFingerprint,
      baselineCreatedAt: "2026-07-15T00:07:00.000Z",
      baselineEvidence,
      rowsRead: childSpecs[2].exactRowsRead,
      rowsWritten: 0,
      usage,
      ledger: verificationLedger,
      problems: [],
      datasets: protectedEvidence.datasets,
      supplementalDatasets: protectedEvidence.supplementalDatasets,
      operationalDatasets: protectedEvidence.operationalDatasets,
    };
    const baseline = {
      createdAt: finalProof.baselineCreatedAt,
      hmacKeyId: finalProof.hmacKeyId,
      sourceFingerprint: fullSourceFingerprint,
      datasets: protectedEvidence.datasets,
      supplementalDatasets: protectedEvidence.supplementalDatasets,
      operationalDatasets: protectedEvidence.operationalDatasets,
      baselineEvidence,
    };
    const finalVerificationDay2Binding = {
      ...envelope.evidence,
      finalVerificationLiveTopology: finalActiveTopology(
        upload.sha256,
        "2026-07-15T00:19:30.000Z",
      ),
    };
    const validate = (
      value: unknown,
      day2Budget = finalVerificationDay2Binding,
    ) =>
      validateHistoricalDataFresh0016FinalVerificationReport({
        value,
        backupDir: backupDirectory,
        baseline,
        day2Budget,
        now: new Date("2026-07-15T00:20:00.000Z"),
      });
    assert.deepEqual(validate(finalProof), finalProof);
    assert.deepEqual(validate(finalProof), finalProof, "valid replay is idempotent");
    assert.throws(
      () => parseHistoricalDataVerificationReport({
        kind: finalProof.kind,
        schemaVersion: 2,
        phase: "verification",
        ok: true,
      }),
      /invalid or inconsistent/,
      "a minimal forged object is never a complete final proof",
    );
    const adversarialReports: Array<readonly [string, unknown]> = [
      ["changed sentinel", mutate(finalProof, (copy) => {
        copy.datasets.users.sentinels[0] = "3".repeat(64);
      })],
      ["changed schema", mutate(finalProof, (copy) => {
        copy.datasets.users.schemaSha256 = "4".repeat(64);
      })],
      ["changed HMAC", mutate(finalProof, (copy) => {
        copy.hmacKeyId = "5".repeat(64);
      })],
      ["changed baseline hash", mutate(finalProof, (copy) => {
        copy.baselineEvidence.canonicalArtifactSha256 = "6".repeat(64);
      })],
      ["wrong ledger", mutate(finalProof, (copy) => {
        copy.ledger.ledgerPath = path.join(backupDirectory, "wrong-ledger.json");
      })],
      ["wrong operation", mutate(finalProof, (copy) => {
        copy.operationId = `historical-data-preservation-verification:${"7".repeat(64)}`;
      })],
      ["wrong candidate", mutate(finalProof, (copy) => {
        copy.ledger.reservation.candidateVersionId =
          "33333333-3333-4333-8333-333333333333";
      })],
      ["wrong source", mutate(finalProof, (copy) => {
        copy.sourceFingerprint.files[0].sha256 = "8".repeat(64);
      })],
      ["wrong day", mutate(finalProof, (copy) => {
        copy.utcDay = "2026-07-16";
      })],
      ["raw root field", { ...finalProof, rawIdentifier: "private-user-id" }],
      ["raw nested field", mutate(finalProof, (copy) => {
        Object.assign(copy.datasets.users, {
          rawIdentifier: "private-user-id",
        });
      })],
      ["ok inconsistency", { ...finalProof, ok: false }],
      ["failed report", { ...finalProof, ok: false, problems: ["failed"] }],
    ];
    for (const [label, adversarial] of adversarialReports) {
      assert.throws(
        () => validate(adversarial),
        /invalid or inconsistent/,
        label,
      );
    }
    assert.throws(
      () => validate(finalProof, {
        ...finalVerificationDay2Binding,
        operationId: `historical-fresh-0016-day2-budget:${"9".repeat(64)}`,
      }),
      /invalid or inconsistent/,
      "wrong accounting parent",
    );
    assert.throws(
      () => validate(finalProof, {
        ...finalVerificationDay2Binding,
        finalVerificationLiveTopology: finalActiveTopology(
          upload.sha256,
          "2026-07-15T00:19:50.000Z",
        ),
      }),
      /invalid or inconsistent/,
      "the final proof cannot predate its candidate-active topology observation",
    );
    for (const [label, activationCreatedAt] of [
      ["equal Day-2 activation", envelope.evidence.liveTopology.observedAt],
      ["pre-Day-2 activation", "2026-07-15T00:04:29.000Z"],
    ] as const) {
      assert.throws(
        () => validate(finalProof, {
          ...finalVerificationDay2Binding,
          finalVerificationLiveTopology: finalActiveTopology(
            upload.sha256,
            "2026-07-15T00:19:30.000Z",
            activationCreatedAt,
          ),
        }),
        /invalid or inconsistent/,
        label,
      );
    }
    const baselineOnlyFinalBinding = structuredClone(
      finalVerificationDay2Binding,
    );
    Object.defineProperty(
      baselineOnlyFinalBinding,
      "finalVerificationLiveTopology",
      {
        value: envelope.evidence.liveTopology,
        enumerable: true,
      },
    );
    assert.throws(
      () => validate(finalProof, baselineOnlyFinalBinding),
      /invalid or inconsistent/,
      "the final verifier rejects the former baseline-only topology shape",
    );
    const finalProofPath = path.join(
      path.dirname(envelope.evidence.maximum.ledger.ledgerPath),
      "historical-data-preservation-verification.json",
    );
    const forgedProof = {
      kind: finalProof.kind,
      schemaVersion: 2,
      phase: "verification",
      ok: true,
      utcDay: envelope.evidence.utcDay,
      operationId: childSpecs[2].operationId,
    };
    writePrivateJsonDurably(finalProofPath, forgedProof, { replace: false });
    assert.throws(
      () => refineHistoricalFresh0016Day2BudgetAfterFinalProof({
        envelope,
        finalProofPath,
        finalProofCanonicalValueSha256:
          historicalFresh0016JsonSha256(forgedProof),
        now: new Date("2026-07-15T00:25:00.000Z"),
      }),
      /invalid or inconsistent/,
      "the exported refiner rejects an alternate caller's minimal proof",
    );
    writePrivateJsonDurably(finalProofPath, finalProof, { replace: true });
    const refined = refineHistoricalFresh0016Day2BudgetAfterFinalProof({
      envelope,
      finalProofPath,
      finalProofCanonicalValueSha256:
        historicalFresh0016JsonSha256(finalProof),
      now: new Date("2026-07-15T00:30:00.000Z"),
    });
    assert.equal(refined.reservation.phase, "exact");
    assert.deepEqual(refined.totals, {
      rowsRead: 44_512,
      rowsWritten: 20_202,
    });
    const replayedRefinement = refineHistoricalFresh0016Day2BudgetAfterFinalProof({
      envelope,
      finalProofPath,
      finalProofCanonicalValueSha256:
        historicalFresh0016JsonSha256(finalProof),
      now: new Date("2026-07-15T00:30:30.000Z"),
    });
    assert.equal(replayedRefinement.idempotent, true);
    assert.throws(
      () =>
        readHistoricalFresh0016Day2BudgetEnvelope({
          backupDirectory,
          cutoverRunId: runId,
          now: new Date("2026-07-15T00:31:00.000Z"),
        }),
      /exact release evidence/,
    );
    assert.equal(
      readHistoricalFresh0016Day2BudgetEnvelope({
        backupDirectory,
        cutoverRunId: runId,
        now: new Date("2026-07-15T00:31:00.000Z"),
        allowRefined: true,
      }).evidence.operationId,
      envelope.evidence.operationId,
    );
    assert.equal(fs.statSync(paths.auxiliaryFiles.day2BudgetEnvelope).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(backupDirectory, { recursive: true, force: true });
  }
});

test("0017 earlier-day, predecessor, and fresh-0016 Day-2 reservations execute across UTC ledgers without overlap", () => {
  const backupDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-fresh-cross-operation-ledger-"),
  );
  fs.chmodSync(backupDirectory, 0o700);
  const observed = {
    databaseCount: 1,
    queryGroups: 0,
    rowsRead: 0,
    rowsWritten: 0,
    executions: 0,
    windowMinutes: 5,
  } as const;
  try {
    const migration0017 = reserveD1ReleaseBudget({
      backupDir: backupDirectory,
      operationId: RUNTIME_MIGRATION_0017_OPERATION_ID,
      operation: RUNTIME_MIGRATION_0017_OPERATION,
      sourceFingerprint,
      candidateVersionId: targetCandidateVersionId,
      phase: "maximum",
      rowsRead: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
      rowsWritten: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
      observedUsage: observed,
      now: new Date("2026-07-13T18:00:00.000Z"),
      expectedUtcDay: "2026-07-13",
    });
    const migration0017Ledger = readD1ReleaseBudgetLedger(
      migration0017.ledgerPath,
    );
    assert.deepEqual(migration0017Ledger.totals, {
      rowsRead: 125_000,
      rowsWritten: 50_000,
    });
    assert.equal(
      migration0017Ledger.reservations[0]?.accountingParentOperationId,
      null,
    );

    const gate = reserveD1ReleaseBudget({
      backupDir: backupDirectory,
      operationId: `historical-fresh-0016-predecessor-runtime-gate:${"a".repeat(64)}`,
      operation: HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_OPERATION,
      sourceFingerprint,
      candidateVersionId: targetCandidateVersionId,
      phase: "maximum",
      rowsRead:
        HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ,
      rowsWritten: 0,
      observedUsage: observed,
      now: new Date("2026-07-14T23:40:00.000Z"),
      expectedUtcDay: "2026-07-14",
    });
    reserveD1ReleaseBudget({
      backupDir: backupDirectory,
      operationId: `historical-fresh-0016-predecessor:${"b".repeat(64)}`,
      operation: "Fresh-0016 predecessor snapshot",
      sourceFingerprint,
      candidateVersionId: targetCandidateVersionId,
      phase: "maximum",
      rowsRead: HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
      rowsWritten: 0,
      observedUsage: observed,
      now: new Date("2026-07-14T23:45:00.000Z"),
      expectedUtcDay: "2026-07-14",
    });
    assert.deepEqual(readD1ReleaseBudgetLedger(gate.ledgerPath).totals, {
      rowsRead:
        HISTORICAL_FRESH_0016_PREDECESSOR_RUNTIME_GATE_MAXIMUM_ROWS_READ +
        HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
      rowsWritten: 0,
    });

    const parentOperationId =
      `historical-fresh-0016-day2-budget:${"c".repeat(64)}`;
    const parent = reserveD1ReleaseBudget({
      backupDir: backupDirectory,
      operationId: parentOperationId,
      operation: HISTORICAL_FRESH_0016_DAY2_BUDGET_OPERATION_NAME,
      sourceFingerprint,
      candidateVersionId: targetCandidateVersionId,
      phase: "maximum",
      rowsRead: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ,
      rowsWritten: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
      observedUsage: {
        ...observed,
        rowsRead: 99_964,
        rowsWritten: 5_000,
      },
      now: new Date("2026-07-15T00:05:00.000Z"),
      expectedUtcDay: "2026-07-15",
    });
    assert.throws(
      () => reserveD1ReleaseBudget({
        backupDir: backupDirectory,
        operationId: RUNTIME_MIGRATION_0017_OPERATION_ID,
        operation: RUNTIME_MIGRATION_0017_OPERATION,
        sourceFingerprint,
        candidateVersionId: targetCandidateVersionId,
        phase: "maximum",
        rowsRead: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
        rowsWritten: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
        observedUsage: observed,
        now: new Date("2026-07-15T00:06:00.000Z"),
        expectedUtcDay: "2026-07-15",
      }),
      /cumulative rows read|daily budget/i,
    );
    assert.deepEqual(readD1ReleaseBudgetLedger(parent.ledgerPath).totals, {
      rowsRead: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_READ,
      rowsWritten: HISTORICAL_FRESH_0016_DAY2_AGGREGATE_ROWS_WRITTEN,
    });

    const children = [
      {
        operationId: `historical-fresh-0016-migration:${"d".repeat(64)}`,
        maximumRowsRead:
          HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
        maximumRowsWritten: 50_000,
        exactRowsRead: 1_000,
        exactRowsWritten: 100,
      },
      {
        operationId: `historical-fresh-0016-successor:${"e".repeat(64)}`,
        maximumRowsRead: 750_000,
        maximumRowsWritten: 0,
        exactRowsRead: 1_000,
        exactRowsWritten: 0,
      },
      {
        operationId: `historical-data-preservation-verification:${"f".repeat(64)}`,
        maximumRowsRead: 2_250_000,
        maximumRowsWritten: 0,
        exactRowsRead: 1_000,
        exactRowsWritten: 0,
      },
    ] as const;
    for (const [index, child] of children.entries()) {
      reserveD1ReleaseBudget({
        backupDir: backupDirectory,
        operationId: child.operationId,
        operation: `Day-2 child ${index + 1}`,
        sourceFingerprint,
        candidateVersionId: targetCandidateVersionId,
        accountingParentOperationId: parentOperationId,
        phase: "maximum",
        rowsRead: child.maximumRowsRead,
        rowsWritten: child.maximumRowsWritten,
        observedUsage: observed,
        now: new Date(`2026-07-15T00:${10 + index * 2}:00.000Z`),
        expectedUtcDay: "2026-07-15",
      });
      reserveD1ReleaseBudget({
        backupDir: backupDirectory,
        operationId: child.operationId,
        operation: `Day-2 child ${index + 1}`,
        sourceFingerprint,
        candidateVersionId: targetCandidateVersionId,
        accountingParentOperationId: parentOperationId,
        phase: "exact",
        rowsRead: child.exactRowsRead,
        rowsWritten: child.exactRowsWritten,
        observedUsage: observed,
        now: new Date(`2026-07-15T00:${11 + index * 2}:00.000Z`),
        expectedUtcDay: "2026-07-15",
      });
    }
    const fixedRowsRead =
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.day2Budget.allocations
        .standaloneRuntimeVerificationBillableRowsRead +
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.day2Budget.allocations
        .runtimeMigration0017VerificationBillableRowsRead +
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.day2Budget.allocations
        .productionLockRowsRead +
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.day2Budget.allocations
        .postdeployAuthorizationRowsRead;
    const fixedRowsWritten =
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.day2Budget.allocations
        .productionLockRowsWritten +
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.day2Budget.allocations
        .postdeployAuthorizationRowsWritten;
    const refined = reserveD1ReleaseBudget({
      backupDir: backupDirectory,
      operationId: parentOperationId,
      operation: HISTORICAL_FRESH_0016_DAY2_BUDGET_OPERATION_NAME,
      sourceFingerprint,
      candidateVersionId: targetCandidateVersionId,
      phase: "exact",
      rowsRead: 3_000 + fixedRowsRead,
      rowsWritten: 100 + fixedRowsWritten,
      observedUsage: observed,
      now: new Date("2026-07-15T00:20:00.000Z"),
      expectedUtcDay: "2026-07-15",
    });
    assert.equal(refined.reservation.phase, "exact");
    assert.ok(
      refined.accountedUsage.rowsRead <= 4_000_000 &&
        refined.accountedUsage.rowsWritten <= 80_000,
    );
    assert.throws(
      () => reserveD1ReleaseBudget({
        backupDir: backupDirectory,
        operationId: `utc-rollover:${"1".repeat(64)}`,
        operation: "UTC rollover probe",
        sourceFingerprint,
        phase: "maximum",
        rowsRead: 1,
        rowsWritten: 0,
        observedUsage: observed,
        now: new Date("2026-07-16T00:00:00.000Z"),
        expectedUtcDay: "2026-07-15",
      }),
      /UTC billing-day/i,
    );
    assert.notEqual(migration0017.ledgerPath, gate.ledgerPath);
    assert.notEqual(gate.ledgerPath, parent.ledgerPath);
  } finally {
    fs.rmSync(backupDirectory, { recursive: true, force: true });
  }
});

function sourceFixture() {
  const content = "strict final proof fixture";
  const file = {
    file: "tests/final-proof-fixture.txt",
    bytes: Buffer.byteLength(content, "utf8"),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
  return {
    sha256: createHash("sha256")
      .update(`${file.file}\0${file.bytes}\0${file.sha256}\n`)
      .digest("hex"),
    fileCount: 1,
    files: [file],
  };
}

function liveTopology(
  uploadEvidenceSha256: string,
  observedAt: string,
) {
  return createHistoricalFresh0016LiveTopologyEvidence({
    observedAt: new Date(observedAt),
    statusOutput: baselineStatusOutput,
    targetCandidateVersionId,
    serviceBaselineVersionId,
    uploadEvidenceSha256,
  });
}

function finalActiveTopology(
  uploadEvidenceSha256: string,
  observedAt: string,
  activationCreatedAt = "2026-07-15T00:19:00.000Z",
): HistoricalFresh0016FinalLiveTopology {
  const deploymentId = "55555555-5555-4555-8555-555555555555";
  return {
    kind: "inspir-historical-fresh-0016-final-active-worker-topology-v1",
    schemaVersion: 1,
    observedAt,
    authoritativeSource: "wrangler-deployments-status-json",
    statusOutputSha256: "4".repeat(64),
    workerRelease: {
      phase: "uploaded-inactive",
      targetCandidateVersionId,
      serviceBaselineVersionId,
      uploadEvidenceSha256,
    },
    activationEvidence: {
      sha256: "5".repeat(64),
      createdAt: activationCreatedAt,
      deploymentId,
      stagedEvidenceSha256: "6".repeat(64),
      preActivationSealSha256: "7".repeat(64),
    },
    topology: {
      deploymentId,
      targetCandidateVersionId,
      candidatePercentage: 100,
      observedVersions: 1,
    },
    serviceBaseline: {
      versionId: serviceBaselineVersionId,
      state: "absent",
      percentage: 0,
    },
  };
}

function writeUploadEvidence(backupDirectory: string) {
  const releaseMessageSha256 = workerReleaseMessageSha256(
    "fresh-0016 Day-2 budget fixture",
  );
  const evidence = buildWorkerCandidateUploadEvidence({
    createdAt: "2026-07-14T23:50:00.000Z",
    targetCandidateVersionId,
    serviceBaselineVersionId,
    expectedReleaseTag: "fresh-0016-day2-budget-fixture",
    expectedReleaseMessageSha256: releaseMessageSha256,
    uploadCommandEvidenceSha256: "1".repeat(64),
    workerDeployPreparationSha256: "2".repeat(64),
    git: {
      head: "c".repeat(40),
      upstream: "c".repeat(40),
      upstreamRef: "origin/main",
    },
    artifacts: {
      sourceFingerprintSha256: sourceFingerprint.sha256,
      sourceFingerprintFileCount: sourceFingerprint.fileCount,
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
      timestamp: "2026-07-14T23:49:00.000Z",
    },
    versionView: {
      versionId: targetCandidateVersionId,
      createdAt: "2026-07-14T23:48:00.000Z",
      source: "fixture",
      releaseTag: "fresh-0016-day2-budget-fixture",
      releaseMessageSha256,
      resourceConfigSha256: "3".repeat(64),
    },
    soleBaselineTopology: {
      deploymentId: "77777777-7777-4777-8777-777777777777",
      serviceBaselineVersionId,
      percentage: 100,
      observedVersions: 1,
    },
  });
  return writeWorkerCandidateEvidence(
    workerCandidateUploadEvidencePath(backupDirectory),
    evidence,
  );
}

function mutate<T>(value: T, action: (copy: T) => void) {
  const copy = structuredClone(value);
  action(copy);
  return copy;
}

function protectedDatasetEvidence(): Readonly<{
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>;
  supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  >;
  operationalDatasets: Record<
    HistoricalOperationalDatasetName,
    HistoricalOperationalDatasetEvidence
  >;
}> {
  const userMemories = datasetEvidence("user_memories", 1);
  const datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence> = {
    users: datasetEvidence("users", 1),
    accounts: datasetEvidence("accounts", 1),
    sessions: datasetEvidence("sessions", 0),
    chats: datasetEvidence("chats", 1),
    messages: datasetEvidence("messages", 1),
    admin_users: datasetEvidence("admin_users", 0),
    user_memories: userMemories,
    activity_runs: datasetEvidence("activity_runs", 0),
    product_events: datasetEvidence("product_events", 0),
    profile_photo_pointers: datasetEvidence("users", 0),
  };
  const gameColumns = HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS.map(
    (column) => ({ ...column }),
  );
  const supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  > = {
    ai_runs: datasetEvidence("ai_runs", 0),
    user_memory_graph_edges: structuredClone(userMemories),
    user_memory_settings: datasetEvidence("user_memory_settings", 0),
    chat_memory_summaries: datasetEvidence("chat_memory_summaries", 0),
    chat_memory_turns: datasetEvidence("chat_memory_turns", 0),
    user_memory_profiles: datasetEvidence("user_memory_profiles", 0),
    user_memory_summaries: datasetEvidence("user_memory_summaries", 0),
    memory_synthesis_runs: datasetEvidence("memory_synthesis_runs", 0),
    memory_source_feedback: datasetEvidence("memory_source_feedback", 0),
    memory_events: datasetEvidence("memory_events", 0),
    game_results: {
      rowCount: 0,
      schemaTable: "game_results",
      schemaSha256: historicalDataSchemaHash(gameColumns),
      columns: gameColumns,
      sentinels: [],
      schemaObjects: { ...HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS },
    },
  };
  const outboxColumns: HistoricalColumnIdentity[] = [
    { name: "vector_id", type: "text", notNull: 1, primaryKey: 1 },
    { name: "absence_count", type: "integer", notNull: 1, primaryKey: 0 },
    { name: "attempt_count", type: "integer", notNull: 1, primaryKey: 0 },
    { name: "created_at", type: "integer", notNull: 1, primaryKey: 0 },
    { name: "last_attempt_at", type: "integer", notNull: 0, primaryKey: 0 },
    { name: "last_error", type: "text", notNull: 0, primaryKey: 0 },
    { name: "lease_token", type: "text", notNull: 0, primaryKey: 0 },
    { name: "lease_until", type: "integer", notNull: 1, primaryKey: 0 },
    { name: "next_attempt_at", type: "integer", notNull: 1, primaryKey: 0 },
    { name: "owner_user_id", type: "text", notNull: 0, primaryKey: 0 },
    { name: "reason", type: "text", notNull: 1, primaryKey: 0 },
    { name: "source_namespace", type: "text", notNull: 0, primaryKey: 0 },
    { name: "source_row_id", type: "text", notNull: 0, primaryKey: 0 },
    { name: "source_row_revision", type: "integer", notNull: 0, primaryKey: 0 },
    { name: "state", type: "text", notNull: 1, primaryKey: 0 },
    { name: "updated_at", type: "integer", notNull: 1, primaryKey: 0 },
    { name: "write_fence_expires_at", type: "integer", notNull: 0, primaryKey: 0 },
    { name: "write_token", type: "text", notNull: 0, primaryKey: 0 },
  ];
  return {
    datasets,
    supplementalDatasets,
    operationalDatasets: {
      memory_vector_cleanup_outbox: {
        lifecycle: "mutable-drainable-outbox",
        rowCount: 0,
        schemaTable: "memory_vector_cleanup_outbox",
        schemaSha256: historicalDataSchemaHash(outboxColumns),
        columns: outboxColumns,
      },
    },
  };
}

function datasetEvidence(
  schemaTable: string,
  rowCount: 0 | 1,
): HistoricalDatasetEvidence {
  const columns: HistoricalColumnIdentity[] = [
    { name: "id", type: "text", notNull: 1, primaryKey: 1 },
  ];
  return {
    rowCount,
    schemaTable,
    schemaSha256: historicalDataSchemaHash(columns),
    columns,
    sentinels: rowCount === 0 ? [] : ["a".repeat(64)],
  };
}
