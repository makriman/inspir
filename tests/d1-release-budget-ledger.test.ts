import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertD1ReleaseBudgetReservation,
  d1ReleaseBudgetLedgerPath,
  readD1ReleaseBudgetLedger,
  readPrivateJsonNoFollow,
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
} from "../scripts/cloudflare/d1-release-budget-ledger";

const source = { sha256: "a".repeat(64), fileCount: 12 };
const nextSource = { sha256: "b".repeat(64), fileCount: 13 };
const day = new Date("2026-07-12T12:00:00.000Z");
const emptyUsage = {
  databaseCount: 1,
  queryGroups: 0,
  rowsRead: 100,
  rowsWritten: 10,
  executions: 0,
  windowMinutes: 721,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rewriteLedgerAsLegacyV1(ledgerPath: string) {
  const ledger = readD1ReleaseBudgetLedger(ledgerPath);
  const legacySource = ledger.reservations[0]?.sourceFingerprint;
  assert.ok(legacySource);
  const reservations = ledger.reservations.map((reservation) => {
    const {
      sourceFingerprint,
      ...legacyReservation
    } = reservation;
    assert.deepEqual(sourceFingerprint, legacySource);
    return legacyReservation;
  });
  writePrivateJsonDurably(
    ledgerPath,
    {
      ...ledger,
      schemaVersion: 1,
      sourceFingerprint: legacySource,
      reservations,
    },
    { replace: true },
  );
}

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
      exact.reservation,
    );
    assert.equal(Object.hasOwn(exact.reservation, "sourceFingerprint"), false);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("D1 release ledger lazily upgrades v1 and keeps same-ID reservations source-bound", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-ledger-v1-"));
  try {
    const legacyMaximum = reserveD1ReleaseBudget({
      backupDir,
      operationId: "constant-runtime-operation",
      operation: "Constant runtime operation",
      sourceFingerprint: source,
      phase: "maximum",
      rowsRead: 1_000,
      rowsWritten: 100,
      observedUsage: emptyUsage,
      now: day,
    });
    rewriteLedgerAsLegacyV1(legacyMaximum.ledgerPath);
    const legacyBytes = fs.readFileSync(legacyMaximum.ledgerPath, "utf8");

    const normalized = readD1ReleaseBudgetLedger(legacyMaximum.ledgerPath);
    assert.equal(normalized.schemaVersion, 3);
    assert.deepEqual(normalized.reservations[0]?.sourceFingerprint, source);
    assert.equal(fs.readFileSync(legacyMaximum.ledgerPath, "utf8"), legacyBytes);

    const legacyReplay = reserveD1ReleaseBudget({
      backupDir,
      operationId: "constant-runtime-operation",
      operation: "Constant runtime operation",
      sourceFingerprint: source,
      phase: "maximum",
      rowsRead: 1_000,
      rowsWritten: 100,
      observedUsage: emptyUsage,
      now: new Date("2026-07-12T12:01:00.000Z"),
      expectedUtcDay: legacyMaximum.utcDay,
    });
    assert.equal(legacyReplay.idempotent, true);
    assert.equal(legacyReplay.revision, legacyMaximum.revision);
    assert.equal(fs.readFileSync(legacyMaximum.ledgerPath, "utf8"), legacyBytes);

    const nextExact = reserveD1ReleaseBudget({
      backupDir,
      operationId: "constant-runtime-operation",
      operation: "Constant runtime operation",
      sourceFingerprint: nextSource,
      phase: "exact",
      rowsRead: 300,
      rowsWritten: 30,
      observedUsage: emptyUsage,
      now: new Date("2026-07-12T12:02:00.000Z"),
      expectedUtcDay: legacyMaximum.utcDay,
    });
    assert.deepEqual(nextExact.totals, { rowsRead: 1_300, rowsWritten: 130 });
    assert.equal(nextExact.revision, legacyMaximum.revision + 1);
    assert.equal(Object.hasOwn(nextExact.reservation, "sourceFingerprint"), false);

    const rawV3 = readPrivateJsonNoFollow(legacyMaximum.ledgerPath);
    assert.ok(isRecord(rawV3));
    assert.equal(rawV3.schemaVersion, 3);
    assert.equal(Object.hasOwn(rawV3, "sourceFingerprint"), false);

    const refinedLegacy = reserveD1ReleaseBudget({
      backupDir,
      operationId: "constant-runtime-operation",
      operation: "Constant runtime operation",
      sourceFingerprint: source,
      phase: "exact",
      rowsRead: 400,
      rowsWritten: 40,
      observedUsage: emptyUsage,
      now: new Date("2026-07-12T12:03:00.000Z"),
      expectedUtcDay: legacyMaximum.utcDay,
    });
    assert.deepEqual(refinedLegacy.totals, { rowsRead: 700, rowsWritten: 70 });
    assert.equal(refinedLegacy.reservation.maximumRowsRead, 1_000);
    assert.equal(
      assertD1ReleaseBudgetReservation({
        ledgerPath: refinedLegacy.ledgerPath,
        utcDay: refinedLegacy.utcDay,
        operationId: "constant-runtime-operation",
        sourceFingerprint: nextSource,
        phase: "exact",
        rowsRead: 300,
        rowsWritten: 30,
        now: new Date("2026-07-12T12:04:00.000Z"),
      }).reservation.rowsRead,
      300,
    );

    const canonicalBytes = fs.readFileSync(refinedLegacy.ledgerPath, "utf8");
    const canonicalReplay = reserveD1ReleaseBudget({
      backupDir,
      operationId: "constant-runtime-operation",
      operation: "Constant runtime operation",
      sourceFingerprint: source,
      phase: "exact",
      rowsRead: 400,
      rowsWritten: 40,
      observedUsage: emptyUsage,
      now: new Date("2026-07-12T12:05:00.000Z"),
      expectedUtcDay: legacyMaximum.utcDay,
    });
    assert.equal(canonicalReplay.idempotent, true);
    assert.equal(canonicalReplay.revision, refinedLegacy.revision);
    assert.equal(fs.readFileSync(refinedLegacy.ledgerPath, "utf8"), canonicalBytes);

    const tampered = readD1ReleaseBudgetLedger(refinedLegacy.ledgerPath);
    assert.equal(tampered.reservations.length, 2);
    tampered.reservations[1]!.sourceFingerprint = {
      ...tampered.reservations[0]!.sourceFingerprint,
    };
    writePrivateJsonDurably(refinedLegacy.ledgerPath, tampered, { replace: true });
    assert.throws(
      () => readD1ReleaseBudgetLedger(refinedLegacy.ledgerPath),
      /duplicate operation-and-source identities/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("D1 release ledger counts one aggregate envelope, freezes delayed Insights for children, and refines only after child proof", () => {
  const backupDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "inspir-d1-ledger-envelope-"),
  );
  const candidateVersionId = "11111111-1111-1111-1111-111111111111";
  try {
    const parent = reserveD1ReleaseBudget({
      backupDir,
      operationId: "day2-envelope",
      operation: "Day-2 aggregate envelope",
      sourceFingerprint: source,
      candidateVersionId,
      phase: "maximum",
      rowsRead: 3_900_000,
      rowsWritten: 70_192,
      observedUsage: {
        ...emptyUsage,
        rowsRead: 100_000,
        rowsWritten: 5_000,
      },
      now: day,
    });
    const childMaximum = reserveD1ReleaseBudget({
      backupDir,
      operationId: "day2-migration-child",
      operation: "Day-2 migration child",
      sourceFingerprint: source,
      candidateVersionId,
      accountingParentOperationId: parent.reservation.operationId,
      phase: "maximum",
      rowsRead: 866_373,
      rowsWritten: 50_000,
      // Insights has caught up with work already protected by the envelope.
      // Child evidence must not merge this delayed observation into totals.
      observedUsage: {
        ...emptyUsage,
        rowsRead: 3_000_000,
        rowsWritten: 60_000,
      },
      now: new Date("2026-07-12T12:01:00.000Z"),
      expectedUtcDay: parent.utcDay,
    });
    assert.deepEqual(childMaximum.totals, {
      rowsRead: 3_900_000,
      rowsWritten: 70_192,
    });
    assert.deepEqual(childMaximum.accountedUsage, {
      rowsRead: 4_000_000,
      rowsWritten: 75_192,
    });
    assert.throws(
      () =>
        reserveD1ReleaseBudget({
          backupDir,
          operationId: parent.reservation.operationId,
          operation: "Day-2 aggregate envelope",
          sourceFingerprint: source,
          candidateVersionId,
          phase: "exact",
          rowsRead: 800_000,
          rowsWritten: 50_000,
          observedUsage: emptyUsage,
          now: new Date("2026-07-12T12:02:00.000Z"),
          expectedUtcDay: parent.utcDay,
        }),
      /child remains maximum/,
    );
    const childExact = reserveD1ReleaseBudget({
      backupDir,
      operationId: "day2-migration-child",
      operation: "Day-2 migration child",
      sourceFingerprint: source,
      candidateVersionId,
      accountingParentOperationId: parent.reservation.operationId,
      phase: "exact",
      rowsRead: 500_000,
      rowsWritten: 40_000,
      observedUsage: emptyUsage,
      now: new Date("2026-07-12T12:03:00.000Z"),
      expectedUtcDay: parent.utcDay,
    });
    assert.deepEqual(childExact.totals, childMaximum.totals);
    const refined = reserveD1ReleaseBudget({
      backupDir,
      operationId: parent.reservation.operationId,
      operation: "Day-2 aggregate envelope",
      sourceFingerprint: source,
      candidateVersionId,
      phase: "exact",
      rowsRead: 500_000,
      rowsWritten: 40_000,
      observedUsage: emptyUsage,
      now: new Date("2026-07-12T12:04:00.000Z"),
      expectedUtcDay: parent.utcDay,
    });
    assert.deepEqual(refined.totals, {
      rowsRead: 500_000,
      rowsWritten: 40_000,
    });
    assert.throws(
      () =>
        reserveD1ReleaseBudget({
          backupDir,
          operationId: "day2-final-child",
          operation: "Day-2 final child",
          sourceFingerprint: source,
          candidateVersionId,
          accountingParentOperationId: parent.reservation.operationId,
          phase: "maximum",
          rowsRead: 1,
          rowsWritten: 0,
          observedUsage: emptyUsage,
          now: new Date("2026-07-12T12:05:00.000Z"),
          expectedUtcDay: parent.utcDay,
        }),
      /live top-level maximum envelope/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("D1 release ledger rejects cumulative multi-source overflow, same-source reuse, and UTC rollover", () => {
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
          operationId: "first-release",
          operation: "First release",
          sourceFingerprint: nextSource,
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
          operationId: "first-release",
          operation: "Renamed first release",
          sourceFingerprint: source,
          phase: "exact",
          rowsRead: 2_000_000,
          rowsWritten: 20_000,
          observedUsage: emptyUsage,
          now: new Date("2026-07-12T12:12:00.000Z"),
          expectedUtcDay: initial.utcDay,
        }),
      /operation ID was reused/,
    );
    assert.throws(
      () =>
        assertD1ReleaseBudgetReservation({
          ledgerPath: initial.ledgerPath,
          utcDay: initial.utcDay,
          operationId: "first-release",
          sourceFingerprint: nextSource,
          phase: "exact",
          rowsRead: 2_000_000,
          rowsWritten: 20_000,
          now: new Date("2026-07-12T12:13:00.000Z"),
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

test("D1 release ledger nofollow reader rejects broad permissions, hardlinks, and symlinks", () => {
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
    const hardlink = path.join(path.dirname(reservation.ledgerPath), "ledger-hardlink.json");
    fs.linkSync(reservation.ledgerPath, hardlink);
    assert.throws(
      () => readD1ReleaseBudgetLedger(reservation.ledgerPath),
      /mode-0600/,
    );
    fs.unlinkSync(hardlink);
    const symlink = path.join(path.dirname(reservation.ledgerPath), "ledger-link.json");
    fs.symlinkSync(reservation.ledgerPath, symlink);
    assert.throws(() => readD1ReleaseBudgetLedger(symlink), /mode-0600/);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("durable private JSON publication preserves collision and symlink targets", async (t) => {
  for (const kind of ["regular", "symlink"] as const) {
    await t.test(kind, () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), `inspir-private-json-${kind}-`),
      );
      const target = path.join(directory, "target.json");
      const publication = path.join(directory, "publication.json");
      const original = '{"existing":true}\n';
      fs.writeFileSync(target, original, { mode: 0o600 });
      if (kind === "symlink") {
        fs.symlinkSync(target, publication);
      } else {
        fs.writeFileSync(publication, original, { mode: 0o600 });
      }
      try {
        assert.throws(
          () =>
            writePrivateJsonDurably(publication, { replacement: true }, {
              replace: false,
            }),
          /new non-symlink path/,
        );
        assert.equal(fs.readFileSync(target, "utf8"), original);
        if (kind === "regular") {
          assert.equal(fs.readFileSync(publication, "utf8"), original);
        } else {
          assert.equal(fs.lstatSync(publication).isSymbolicLink(), true);
        }
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
