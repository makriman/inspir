import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertD1ReleaseBudgetReservation,
  d1ReleaseBudgetLedgerPath,
  readD1ReleaseBudgetLedger,
  reserveD1ReleaseBudget,
} from "../scripts/cloudflare/d1-release-budget-ledger";

const source = { sha256: "a".repeat(64), fileCount: 12 };
const day = new Date("2026-07-12T12:00:00.000Z");
const emptyUsage = {
  databaseCount: 1,
  queryGroups: 0,
  rowsRead: 100,
  rowsWritten: 10,
  executions: 0,
  windowMinutes: 721,
};

test("D1 release ledger atomically refines one operation and keeps cumulative lag-safe totals", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-ledger-"));
  try {
    const maximum = reserveD1ReleaseBudget({
      backupDir,
      operationId: "release-operation-one",
      operation: "Release operation one",
      sourceFingerprint: source,
      phase: "maximum",
      rowsRead: 1_000,
      rowsWritten: 100,
      observedUsage: emptyUsage,
      now: day,
    });
    assert.equal(maximum.idempotent, false);
    assert.equal(maximum.accountedUsage.rowsRead, 1_100);
    assert.equal(maximum.accountedUsage.rowsWritten, 110);

    const exact = reserveD1ReleaseBudget({
      backupDir,
      operationId: "release-operation-one",
      operation: "Release operation one",
      sourceFingerprint: source,
      phase: "exact",
      rowsRead: 400,
      rowsWritten: 40,
      observedUsage: emptyUsage,
      now: new Date("2026-07-12T12:01:00.000Z"),
      expectedUtcDay: maximum.utcDay,
    });
    assert.equal(exact.reservation.phase, "exact");
    assert.equal(exact.reservation.maximumRowsRead, 1_000);
    assert.equal(exact.reservation.rowsRead, 400);

    const replay = reserveD1ReleaseBudget({
      backupDir,
      operationId: "release-operation-one",
      operation: "Release operation one",
      sourceFingerprint: source,
      phase: "exact",
      rowsRead: 400,
      rowsWritten: 40,
      observedUsage: { ...emptyUsage, rowsRead: 50, rowsWritten: 5 },
      now: new Date("2026-07-12T12:02:00.000Z"),
      expectedUtcDay: maximum.utcDay,
    });
    assert.equal(replay.idempotent, true);
    assert.equal(replay.revision, exact.revision);

    const second = reserveD1ReleaseBudget({
      backupDir,
      operationId: "release-operation-two",
      operation: "Release operation two",
      sourceFingerprint: source,
      phase: "exact",
      rowsRead: 300,
      rowsWritten: 30,
      observedUsage: { ...emptyUsage, rowsRead: 50, rowsWritten: 5 },
      now: new Date("2026-07-12T12:03:00.000Z"),
      expectedUtcDay: maximum.utcDay,
    });
    assert.deepEqual(second.totals, { rowsRead: 700, rowsWritten: 70 });
    // Lower/lagging Insights never reduce the first observed usage floor.
    assert.deepEqual(second.accountedUsage, { rowsRead: 800, rowsWritten: 80 });

    const ledger = readD1ReleaseBudgetLedger(second.ledgerPath);
    assert.equal(ledger.observedUsageFloor.rowsRead, 100);
    assert.equal(ledger.reservations.length, 2);
    assert.equal(fs.statSync(second.ledgerPath).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(`${second.ledgerPath}.lock`), false);
    assert.deepEqual(
      fs.readdirSync(path.dirname(second.ledgerPath)).filter((file) => file.endsWith(".tmp")),
      [],
    );
    assert.deepEqual(
      assertD1ReleaseBudgetReservation({
        ledgerPath: second.ledgerPath,
        utcDay: second.utcDay,
        operationId: "release-operation-one",
        sourceFingerprint: source,
        phase: "exact",
        rowsRead: 400,
        rowsWritten: 40,
        now: new Date("2026-07-12T23:59:59.999Z"),
      }).reservation,
      ledger.reservations.find((reservation) => reservation.operationId === "release-operation-one"),
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("D1 release ledger rejects cumulative overflow, source drift, operation reuse, and UTC rollover", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-ledger-fail-"));
  try {
    const initial = reserveD1ReleaseBudget({
      backupDir,
      operationId: "first-release",
      operation: "First release",
      sourceFingerprint: source,
      phase: "exact",
      rowsRead: 2_000_000,
      rowsWritten: 20_000,
      observedUsage: {
        ...emptyUsage,
        rowsRead: 1_000_000,
        rowsWritten: 30_000,
      },
      now: day,
    });
    assert.throws(
      () =>
        reserveD1ReleaseBudget({
          backupDir,
          operationId: "second-release",
          operation: "Second release",
          sourceFingerprint: source,
          phase: "exact",
          rowsRead: 1_100_000,
          rowsWritten: 10_001,
          observedUsage: {
            ...emptyUsage,
            rowsRead: 100,
            rowsWritten: 10,
          },
          now: new Date("2026-07-12T12:10:00.000Z"),
          expectedUtcDay: initial.utcDay,
        }),
      /cumulative lag-safe Workers Free D1 daily budget/,
    );
    assert.throws(
      () =>
        reserveD1ReleaseBudget({
          backupDir,
          operationId: "first-release",
          operation: "First release",
          sourceFingerprint: source,
          phase: "exact",
          rowsRead: 1_999_999,
          rowsWritten: 20_000,
          observedUsage: emptyUsage,
          now: new Date("2026-07-12T12:11:00.000Z"),
          expectedUtcDay: initial.utcDay,
        }),
      /cannot be changed or widened/,
    );
    assert.throws(
      () =>
        reserveD1ReleaseBudget({
          backupDir,
          operationId: "different-source",
          operation: "Different source",
          sourceFingerprint: { sha256: "b".repeat(64), fileCount: 12 },
          phase: "exact",
          rowsRead: 1,
          rowsWritten: 1,
          observedUsage: emptyUsage,
          now: new Date("2026-07-12T12:12:00.000Z"),
          expectedUtcDay: initial.utcDay,
        }),
      /different source fingerprint/,
    );
    assert.throws(
      () =>
        reserveD1ReleaseBudget({
          backupDir,
          operationId: "after-midnight",
          operation: "After midnight",
          sourceFingerprint: source,
          phase: "exact",
          rowsRead: 1,
          rowsWritten: 1,
          observedUsage: emptyUsage,
          now: new Date("2026-07-13T00:00:00.000Z"),
          expectedUtcDay: initial.utcDay,
        }),
      /crossed the UTC billing-day boundary/,
    );
    assert.equal(
      fs.existsSync(d1ReleaseBudgetLedgerPath(backupDir, "2026-07-13")),
      false,
    );
    const stored = readD1ReleaseBudgetLedger(initial.ledgerPath);
    assert.equal(stored.reservations.length, 1);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("D1 release ledger nofollow reader rejects broad permissions and symlinks", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-ledger-read-"));
  try {
    const reservation = reserveD1ReleaseBudget({
      backupDir,
      operationId: "strict-read",
      operation: "Strict read",
      sourceFingerprint: source,
      phase: "exact",
      rowsRead: 1,
      rowsWritten: 1,
      observedUsage: emptyUsage,
      now: day,
    });
    fs.chmodSync(reservation.ledgerPath, 0o640);
    assert.throws(
      () => readD1ReleaseBudgetLedger(reservation.ledgerPath),
      /mode-0600/,
    );
    fs.chmodSync(reservation.ledgerPath, 0o600);
    const symlink = path.join(path.dirname(reservation.ledgerPath), "ledger-link.json");
    fs.symlinkSync(reservation.ledgerPath, symlink);
    assert.throws(() => readD1ReleaseBudgetLedger(symlink), /mode-0600/);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});
