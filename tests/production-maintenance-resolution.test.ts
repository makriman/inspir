import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reserveD1ReleaseBudget } from "../scripts/cloudflare/d1-release-budget-ledger";
import { finalizeLocalTranslationRepairResolution } from "../scripts/cloudflare/resolve-production-maintenance";

test("local translation resolution is bound to exact successful production evidence", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-maint-resolution-"));
  const directory = path.join(backupDir, "cloudflare");
  fs.mkdirSync(directory);
  const repairRunId = "11111111-1111-4111-8111-111111111111";
  const runId = `2026-07-13T01-17-15-574Z-${repairRunId}`;
  const candidateVersionId = "22222222-2222-4222-8222-222222222222";
  const maintenanceVersionId = "33333333-3333-4333-8333-333333333333";
  const bookmark = "00000df8-0000000c-000050a7-243506b76489d7cf5139c60ec0fb1b8d";
  const evidenceCreatedAt = "2026-07-13T01:18:30.227Z";
  const sourceFingerprintSha256 = "b".repeat(64);
  const operationId = `seo-cta-translation-repair:${"1".repeat(64)}`;
  const evidencePath = path.join(
    directory,
    `d1-translation-repair-prewrite-${runId}.json`,
  );
  const releasePreflightPath = path.join(
    directory,
    `d1-translation-repair-release-preflight-${runId}.json`,
  );
  const markerPath = path.join(directory, "d1-translation-repair-unresolved.json");
  try {
    const budgetReservation = reserveD1ReleaseBudget({
      backupDir,
      operationId,
      operation: "Remote SEO translation repair",
      candidateVersionId,
      sourceFingerprint: { sha256: sourceFingerprintSha256, fileCount: 1 },
      phase: "maximum",
      rowsRead: 2_500_000,
      rowsWritten: 50_000,
      observedUsage: {
        databaseCount: 1,
        queryGroups: 0,
        rowsRead: 0,
        rowsWritten: 0,
        executions: 0,
        windowMinutes: 78,
      },
      now: new Date("2026-07-13T01:17:15.586Z"),
    });
    writePrivateJson(path.join(directory, "production-maintenance-resolution.json"), {
      kind: "production-maintenance-resolution-v1",
      createdAt: "2026-07-13T01:24:00.960Z",
      ok: true,
      repairRunId,
      candidateVersionId,
      maintenanceVersionId,
      activeVersionBefore: maintenanceVersionId,
      activeVersionAfter: candidateVersionId,
      responseRecoveredByReadback: false,
      markerCleared: true,
      exclusionReleased: true,
    });
    writePrivateJson(releasePreflightPath, {
      kind: "d1-translation-repair-release-preflight",
      runId,
      createdAt: "2026-07-13T01:17:15.574Z",
      candidateVersionId,
      activeVersionId: candidateVersionId,
      gitHead: "a".repeat(40),
      gitUpstream: "a".repeat(40),
      sourceFingerprint: {
        sha256: sourceFingerprintSha256,
        fileCount: 1,
        files: [{ file: "test.ts", bytes: 1, sha256: "c".repeat(64) }],
      },
      workerSourceSha256: "d".repeat(64),
      wranglerConfigSha256: "e".repeat(64),
      assetManifest: {},
      safetyChecks: {},
      candidateProbe: {
        versionId: candidateVersionId,
        maintenance: false,
        openNext: false,
      },
      workerDeployReportPath: path.join(directory, "worker-deploy-report.json"),
      workerDeployEvidence: {},
    });
    writePrivateJson(evidencePath, {
      kind: "d1-translation-repair-prewrite-evidence",
      runId,
      createdAt: evidenceCreatedAt,
      database: "inspirlearning-prod",
      candidateVersionId,
      maintenanceVersionId,
      releasePreflightEvidencePath: releasePreflightPath,
      timeTravelBookmark: bookmark,
      automaticRestoreAllowed: false,
      recoveryPreference: "reviewed-forward-correction",
      destructiveRestoreSupported: false,
      exportPerformed: false,
      exportReason: "Cloudflare documents that D1 export blocks database requests.",
      atomicSqlSha256: "f".repeat(64),
      atomicSqlBytes: 1,
      atomicSqlStatements: 1,
      largestStatementBytes: 1,
      projectedBilledRowReads: 1,
      projectedBilledRowWrites: 1,
      d1ReleaseBudget: {
        ledgerPath: budgetReservation.ledgerPath,
        utcDay: budgetReservation.utcDay,
        operationId: budgetReservation.reservation.operationId,
        revision: budgetReservation.revision,
        phase: budgetReservation.reservation.phase,
        rowsRead: budgetReservation.reservation.rowsRead,
        rowsWritten: budgetReservation.reservation.rowsWritten,
      },
      maintenance: {
        active: true,
        healthStatus: 200,
        mutationStatus: 503,
        mutationCode: "write_freeze_active",
        delivery: "native-maintenance-worker",
        runtime: "cloudflare-workers",
        openNext: false,
        maintenance: true,
        versionId: maintenanceVersionId,
      },
    });
    writePrivateJson(markerPath, {
      kind: "d1-translation-repair-unresolved",
      runId,
      createdAt: evidenceCreatedAt,
      evidencePath,
      candidateVersionId,
      maintenanceVersionId,
      timeTravelBookmark: bookmark,
      automaticRestoreAllowed: false,
    });

    assert.throws(
      () =>
        finalizeLocalTranslationRepairResolution({
          backupDir,
          repairRunId,
          activeVersionId: candidateVersionId,
          productionMaintenanceStateAbsent: true,
          candidateUnfrozen: true,
          reviewedForwardCorrectionConfirmed: false,
        }),
      /requires reviewed correction/,
    );
    assert.equal(fs.existsSync(markerPath), true);

    const prewrite = readJsonRecord(evidencePath);
    delete prewrite.atomicSqlSha256;
    writePrivateJson(evidencePath, prewrite);
    assert.throws(
      () =>
        finalizeLocalTranslationRepairResolution({
          backupDir,
          repairRunId,
          activeVersionId: candidateVersionId,
          productionMaintenanceStateAbsent: true,
          candidateUnfrozen: true,
          reviewedForwardCorrectionConfirmed: true,
        }),
      /prewrite evidence is incomplete or invalid/,
    );
    prewrite.atomicSqlSha256 = "f".repeat(64);
    writePrivateJson(evidencePath, prewrite);

    const resolutionPath = path.join(directory, "production-maintenance-resolution.json");
    const resolution = readJsonRecord(resolutionPath);
    resolution.error = "contradictory-success";
    writePrivateJson(resolutionPath, resolution);
    assert.throws(
      () =>
        finalizeLocalTranslationRepairResolution({
          backupDir,
          repairRunId,
          activeVersionId: candidateVersionId,
          productionMaintenanceStateAbsent: true,
          candidateUnfrozen: true,
          reviewedForwardCorrectionConfirmed: true,
        }),
      /Successful exact production maintenance resolution evidence is required/,
    );
    delete resolution.error;
    writePrivateJson(resolutionPath, resolution);

    const budget = prewrite.d1ReleaseBudget;
    assert.ok(isRecord(budget));
    const exactOperationId = budget.operationId;
    budget.operationId = `seo-cta-translation-repair:${"9".repeat(64)}`;
    writePrivateJson(evidencePath, prewrite);
    assert.throws(
      () =>
        finalizeLocalTranslationRepairResolution({
          backupDir,
          repairRunId,
          activeVersionId: candidateVersionId,
          productionMaintenanceStateAbsent: true,
          candidateUnfrozen: true,
          reviewedForwardCorrectionConfirmed: true,
        }),
      /does not contain the exact prewrite reservation/,
    );
    budget.operationId = exactOperationId;

    const exactRevision = budget.revision;
    assert.ok(typeof exactRevision === "number");
    budget.revision = exactRevision + 1;
    writePrivateJson(evidencePath, prewrite);
    assert.throws(
      () =>
        finalizeLocalTranslationRepairResolution({
          backupDir,
          repairRunId,
          activeVersionId: candidateVersionId,
          productionMaintenanceStateAbsent: true,
          candidateUnfrozen: true,
          reviewedForwardCorrectionConfirmed: true,
        }),
      /ledger identity or revision is invalid/,
    );
    budget.revision = exactRevision;

    const marker = readJsonRecord(markerPath);
    const exactUtcDay = budget.utcDay;
    const exactLedgerPath = budget.ledgerPath;
    budget.utcDay = "2026-02-30";
    budget.ledgerPath = path.join(directory, "d1-release-budget-ledger-2026-02-30.json");
    writePrivateJson(evidencePath, prewrite);
    assert.throws(
      () =>
        finalizeLocalTranslationRepairResolution({
          backupDir,
          repairRunId,
          activeVersionId: candidateVersionId,
          productionMaintenanceStateAbsent: true,
          candidateUnfrozen: true,
          reviewedForwardCorrectionConfirmed: true,
        }),
      /prewrite evidence is incomplete or invalid/,
    );
    budget.utcDay = exactUtcDay;
    budget.ledgerPath = path.join(directory, "d1-release-budget-ledger-2026-07-14.json");
    writePrivateJson(evidencePath, prewrite);
    assert.throws(
      () =>
        finalizeLocalTranslationRepairResolution({
          backupDir,
          repairRunId,
          activeVersionId: candidateVersionId,
          productionMaintenanceStateAbsent: true,
          candidateUnfrozen: true,
          reviewedForwardCorrectionConfirmed: true,
        }),
      /prewrite evidence is incomplete or invalid/,
    );
    budget.ledgerPath = exactLedgerPath;

    prewrite.createdAt = "2026-07-15T00:00:00.001Z";
    marker.createdAt = prewrite.createdAt;
    writePrivateJson(evidencePath, prewrite);
    writePrivateJson(markerPath, marker);
    assert.throws(
      () =>
        finalizeLocalTranslationRepairResolution({
          backupDir,
          repairRunId,
          activeVersionId: candidateVersionId,
          productionMaintenanceStateAbsent: true,
          candidateUnfrozen: true,
          reviewedForwardCorrectionConfirmed: true,
        }),
      /prewrite evidence is incomplete or invalid/,
    );
    prewrite.createdAt = evidenceCreatedAt;
    marker.createdAt = evidenceCreatedAt;
    writePrivateJson(evidencePath, prewrite);
    writePrivateJson(markerPath, marker);

    const result = finalizeLocalTranslationRepairResolution({
      backupDir,
      repairRunId,
      activeVersionId: candidateVersionId,
      productionMaintenanceStateAbsent: true,
      candidateUnfrozen: true,
      reviewedForwardCorrectionConfirmed: true,
      now: new Date("2026-07-13T01:25:00.000Z"),
    });
    assert.equal(result.kind, "d1-translation-repair-resolved-v2");
    assert.equal(result.exactVerificationPassed, false);
    assert.equal(result.reviewedForwardCorrectionConfirmed, true);
    assert.equal(result.exactCandidateRestored, true);
    assert.equal(fs.existsSync(markerPath), false);
    const resolvedPath = path.join(directory, `d1-translation-repair-resolved-${runId}.json`);
    assert.equal(fs.statSync(resolvedPath).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(resolvedPath, "utf8")), result);
    assert.deepEqual(
      finalizeLocalTranslationRepairResolution({
        backupDir,
        repairRunId,
        activeVersionId: candidateVersionId,
        productionMaintenanceStateAbsent: true,
        candidateUnfrozen: true,
        reviewedForwardCorrectionConfirmed: true,
        now: new Date("2026-07-13T01:26:00.000Z"),
      }),
      result,
    );

    prewrite.createdAt = "2026-07-14T00:00:00.001Z";
    marker.createdAt = prewrite.createdAt;
    writePrivateJson(evidencePath, prewrite);
    writePrivateJson(markerPath, marker);
    assert.deepEqual(
      finalizeLocalTranslationRepairResolution({
        backupDir,
        repairRunId,
        activeVersionId: candidateVersionId,
        productionMaintenanceStateAbsent: true,
        candidateUnfrozen: true,
        reviewedForwardCorrectionConfirmed: true,
        now: new Date("2026-07-14T00:01:00.000Z"),
      }),
      result,
    );
    assert.equal(fs.existsSync(markerPath), false);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

function writePrivateJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function readJsonRecord(file: string) {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(isRecord(value));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
