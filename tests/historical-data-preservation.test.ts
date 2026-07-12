import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HISTORICAL_BILLED_READ_LIMIT,
  HISTORICAL_DATA_BASELINE_MAX_AGE_MS,
  HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
  HISTORICAL_DATA_IDENTITIES_SQL,
  HISTORICAL_DATA_SUMMARY_SQL,
  HISTORICAL_DATASET_NAMES,
  createHistoricalDataBaseline,
  historicalDataBudgetOperationId,
  readAndValidateHistoricalDataBaseline,
  verifyHistoricalDataPreservation,
  writeHistoricalDataReport,
  type HistoricalDatasetName,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import {
  readD1ReleaseBudgetLedger,
  reserveD1ReleaseBudget,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import type { D1DailyUsage } from "../scripts/cloudflare/d1-free-budget";
import type { WranglerRunner } from "../scripts/cloudflare/migration-config";
import type { SourceFingerprint } from "../scripts/cloudflare/source-fingerprint";

const secret = "preservation-test-secret-with-at-least-32-bytes";
const now = new Date("2026-07-11T12:00:00.000Z");
const emptyUsage: D1DailyUsage = {
  databaseCount: 1,
  queryGroups: 0,
  rowsRead: 0,
  rowsWritten: 0,
  executions: 0,
  windowMinutes: 721,
};

test("private baseline and verifier preserve HMAC sentinels while allowing concurrent inserts", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-ok-"));
  try {
    const source = makeSource("same source");
    const baselineFixture = databaseFixture();
    const baselineCalls: string[][] = [];
    const baseline = createHistoricalDataBaseline({
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      runner: fixtureRunner(baselineFixture, baselineCalls),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });

    assert.equal(baseline.ok, true);
    assert.equal(baseline.rowsWritten, 0);
    assert.equal(baseline.ledger.reservation.maximumRowsRead, HISTORICAL_BILLED_READ_LIMIT);
    assert.equal(baseline.ledger.reservation.phase, "exact");
    assert.equal(baselineCalls.length, 2);
    assert.equal(baselineCalls[0]?.at(-1), HISTORICAL_DATA_SUMMARY_SQL);
    assert.equal(baselineCalls[1]?.at(-1), HISTORICAL_DATA_IDENTITIES_SQL);

    const reportPath = writeHistoricalDataReport(backupDir, baseline);
    assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
    const serialized = fs.readFileSync(reportPath, "utf8");
    assert.doesNotMatch(serialized, /historical-user-id|private-session-token|owner@example\.com/);
    const loaded = readAndValidateHistoricalDataBaseline({
      backupDir,
      expectedSourceFingerprint: source,
      now,
    });
    assert.deepEqual(loaded, baseline);

    const after = databaseFixture();
    after.counts.users = 2;
    after.identities.users.push({ identity_1: "new-concurrent-user" });
    const verification = verifyHistoricalDataPreservation({
      baseline: loaded,
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      runner: fixtureRunner(after),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });
    assert.equal(verification.ok, true);
    assert.deepEqual(verification.problems, []);
    assert.notEqual(verification.operationId, baseline.operationId);
    assert.equal(
      verification.operationId,
      historicalDataBudgetOperationId("verification", {
        sha256: source.sha256,
        fileCount: source.fileCount,
      }),
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("verifier rejects count loss and a replaced stable identity sentinel", () => {
  for (const mutation of [
    (fixture: DatabaseFixture) => {
      fixture.counts.chats = 0;
      fixture.identities.chats = [];
    },
    (fixture: DatabaseFixture) => {
      fixture.identities.chats = [{ identity_1: "replacement-chat", identity_2: "historical-user-id" }];
    },
  ]) {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-loss-"));
    try {
      const source = makeSource("loss source");
      const baseline = createHistoricalDataBaseline({
        backupDir,
        hmacSecret: secret,
        sourceFingerprint: source,
        runner: fixtureRunner(databaseFixture()),
        usageLoader: () => emptyUsage,
        clock: () => now,
      });
      const current = databaseFixture();
      mutation(current);
      const verification = verifyHistoricalDataPreservation({
        baseline,
        backupDir,
        hmacSecret: secret,
        sourceFingerprint: source,
        runner: fixtureRunner(current),
        usageLoader: () => emptyUsage,
        clock: () => now,
      });
      assert.equal(verification.ok, false);
      assert.ok(verification.problems.some((problem) => /chats/.test(problem)));
    } finally {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  }
});

test("baseline refuses an empty or wrong production database", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-empty-"));
  try {
    const fixture = databaseFixture();
    for (const name of HISTORICAL_DATASET_NAMES) {
      fixture.counts[name] = 0;
      fixture.identities[name] = [];
    }
    assert.throws(
      () => createHistoricalDataBaseline({
        backupDir,
        hmacSecret: secret,
        sourceFingerprint: makeSource("empty database source"),
        runner: fixtureRunner(fixture),
        usageLoader: () => emptyUsage,
        clock: () => now,
      }),
      /empty or wrong production database: users has no rows/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("cumulative ledger overflow rejects baseline before its first D1 execute", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-budget-"));
  try {
    const source = makeSource("budget source");
    reserveD1ReleaseBudget({
      backupDir,
      operationId: "prior-release-operation",
      operation: "Prior release operation",
      sourceFingerprint: { sha256: source.sha256, fileCount: source.fileCount },
      phase: "exact",
      rowsRead: 3_300_000,
      rowsWritten: 0,
      observedUsage: emptyUsage,
      now,
    });
    const calls: string[][] = [];
    assert.throws(
      () => createHistoricalDataBaseline({
        backupDir,
        hmacSecret: secret,
        sourceFingerprint: source,
        runner: fixtureRunner(databaseFixture(), calls),
        usageLoader: () => emptyUsage,
        clock: () => now,
      }),
      /cumulative lag-safe Workers Free D1 daily budget/,
    );
    assert.equal(calls.length, 0, "budget rejection must precede d1 execute");
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("operation reservation is idempotent and UTC rollover fails closed", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-replay-"));
  try {
    const source = makeSource("replay source");
    const options = {
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      usageLoader: () => emptyUsage,
      clock: () => now,
    };
    const first = createHistoricalDataBaseline({ ...options, runner: fixtureRunner(databaseFixture()) });
    const replay = createHistoricalDataBaseline({ ...options, runner: fixtureRunner(databaseFixture()) });
    assert.equal(replay.operationId, first.operationId);
    const ledger = readD1ReleaseBudgetLedger(replay.ledger.ledgerPath);
    assert.equal(
      ledger.reservations.filter((reservation) => reservation.operationId === first.operationId).length,
      1,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }

  const rolloverDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-rollover-"));
  try {
    const times = [
      new Date("2026-07-11T23:59:59.000Z"),
      new Date("2026-07-12T00:00:00.000Z"),
    ];
    let clockIndex = 0;
    assert.throws(
      () => createHistoricalDataBaseline({
        backupDir: rolloverDir,
        hmacSecret: secret,
        sourceFingerprint: makeSource("rollover source"),
        runner: fixtureRunner(databaseFixture()),
        usageLoader: () => emptyUsage,
        clock: () => times[Math.min(clockIndex++, times.length - 1)] ?? times[0],
      }),
      /crossed the UTC billing-day boundary/,
    );
  } finally {
    fs.rmSync(rolloverDir, { recursive: true, force: true });
  }
});

test("strict reader rejects malformed, stale, source-drifted, broad, and symlink evidence", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-reader-"));
  try {
    const source = makeSource("reader source");
    const baseline = createHistoricalDataBaseline({
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      runner: fixtureRunner(databaseFixture()),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });
    const reportPath = writeHistoricalDataReport(backupDir, baseline);

    assert.throws(
      () => readAndValidateHistoricalDataBaseline({
        backupDir,
        expectedSourceFingerprint: source,
        now: new Date(now.getTime() + 31 * 60 * 1_000),
      }),
      /stale or from the future/,
    );
    assert.throws(
      () => readAndValidateHistoricalDataBaseline({
        backupDir,
        expectedSourceFingerprint: makeSource("different source"),
        now,
      }),
      /source fingerprint changed/,
    );

    const malformed = structuredClone(baseline);
    malformed.datasets.users.sentinels = [];
    fs.writeFileSync(reportPath, `${JSON.stringify(malformed)}\n`, { mode: 0o600 });
    fs.chmodSync(reportPath, 0o600);
    assert.throws(
      () => readAndValidateHistoricalDataBaseline({ backupDir, expectedSourceFingerprint: source, now }),
      /sentinels are incomplete/,
    );

    fs.writeFileSync(reportPath, `${JSON.stringify(baseline)}\n`, { mode: 0o600 });
    fs.chmodSync(reportPath, 0o640);
    assert.throws(
      () => readAndValidateHistoricalDataBaseline({ backupDir, expectedSourceFingerprint: source, now }),
      /mode-0600/,
    );
    fs.rmSync(reportPath);
    const target = path.join(backupDir, "real-baseline.json");
    fs.writeFileSync(target, `${JSON.stringify(baseline)}\n`, { mode: 0o600 });
    fs.symlinkSync(target, reportPath);
    assert.throws(
      () => readAndValidateHistoricalDataBaseline({ backupDir, expectedSourceFingerprint: source, now }),
      /mode-0600/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("final verification permits the guarded release window while preflight freshness stays strict", () => {
  assert.equal(HISTORICAL_DATA_BASELINE_MAX_AGE_MS, 30 * 60 * 1000);
  assert.equal(HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS, 12 * 60 * 60 * 1000);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-release-window-"));
  try {
    const source = makeSource("release-window source");
    const baseline = createHistoricalDataBaseline({
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      runner: fixtureRunner(databaseFixture()),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });
    writeHistoricalDataReport(backupDir, baseline);
    const verificationTime = new Date(now.getTime() + 31 * 60 * 1000);
    assert.throws(
      () => readAndValidateHistoricalDataBaseline({
        backupDir,
        expectedSourceFingerprint: source,
        now: verificationTime,
      }),
      /stale or from the future/,
    );
    const loaded = readAndValidateHistoricalDataBaseline({
      backupDir,
      expectedSourceFingerprint: source,
      now: verificationTime,
      maximumAgeMs: HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
    });
    const verification = verifyHistoricalDataPreservation({
      baseline: loaded,
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      runner: fixtureRunner(databaseFixture()),
      usageLoader: () => emptyUsage,
      clock: () => verificationTime,
      maximumBaselineAgeMs: HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
    });
    assert.equal(verification.ok, true);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("preservation SQL is bounded and read-only", () => {
  for (const sql of [HISTORICAL_DATA_SUMMARY_SQL, HISTORICAL_DATA_IDENTITIES_SQL]) {
    assert.doesNotMatch(
      sql,
      /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH)\b/i,
    );
  }
  assert.equal((HISTORICAL_DATA_IDENTITIES_SQL.match(/ORDER BY rowid LIMIT 16/g) ?? []).length, 10);
  assert.doesNotMatch(HISTORICAL_DATA_IDENTITIES_SQL, /LIMIT 1\d{3,}/);
  assert.match(HISTORICAL_DATA_SUMMARY_SQL, /profile_photo_pointers/);
});

type DatabaseFixture = {
  counts: Record<HistoricalDatasetName, number>;
  identities: Record<HistoricalDatasetName, Array<Record<string, unknown>>>;
};

function databaseFixture(): DatabaseFixture {
  return {
    counts: {
      users: 1,
      accounts: 1,
      sessions: 1,
      chats: 1,
      messages: 1,
      admin_users: 0,
      user_memories: 1,
      activity_runs: 0,
      product_events: 0,
      profile_photo_pointers: 0,
    },
    identities: {
      users: [{ identity_1: "historical-user-id" }],
      accounts: [{ identity_1: "account-id", identity_2: "historical-user-id" }],
      sessions: [{
        identity_1: "session-id",
        identity_2: "historical-user-id",
        identity_3: "private-session-token",
      }],
      chats: [{ identity_1: "chat-id", identity_2: "historical-user-id" }],
      messages: [{ identity_1: "message-id", identity_2: "chat-id" }],
      admin_users: [],
      user_memories: [{ identity_1: "memory-id", identity_2: "historical-user-id" }],
      activity_runs: [],
      product_events: [],
      profile_photo_pointers: [],
    },
  };
}

function fixtureRunner(
  fixture: DatabaseFixture,
  calls: string[][] = [],
): WranglerRunner {
  return (args) => {
    calls.push(args);
    const sql = args.at(-1);
    if (sql === HISTORICAL_DATA_SUMMARY_SQL) {
      const countRows = HISTORICAL_DATASET_NAMES.map((name) => ({
        dataset: name,
        row_count: fixture.counts[name],
      }));
      const schemaRows = schemaTableNames().map((table) => ({
        table_name: table,
        name: table === "admin_users" ? "email" : "id",
        type: "text",
        not_null: 1,
        primary_key: 1,
      }));
      return wranglerResult([
        { rows: countRows, rowsRead: countRows.length },
        { rows: schemaRows, rowsRead: schemaRows.length },
      ]);
    }
    if (sql === HISTORICAL_DATA_IDENTITIES_SQL) {
      return wranglerResult(HISTORICAL_DATASET_NAMES.map((name) => ({
        rows: fixture.identities[name],
        rowsRead: fixture.identities[name].length,
      })));
    }
    throw new Error("Unexpected D1 SQL in historical preservation fixture.");
  };
}

function wranglerResult(
  sets: Array<{ rows: Array<Record<string, unknown>>; rowsRead: number }>,
) {
  return JSON.stringify(sets.map((set) => ({
    success: true,
    results: set.rows,
    meta: { rows_read: set.rowsRead, rows_written: 0 },
  })));
}

function schemaTableNames() {
  return [
    "users",
    "accounts",
    "sessions",
    "chats",
    "messages",
    "admin_users",
    "user_memories",
    "activity_runs",
    "product_events",
  ] as const;
}

function makeSource(content: string): SourceFingerprint {
  const file = {
    file: "source.ts",
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
