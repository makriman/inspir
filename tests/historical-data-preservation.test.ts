import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  HISTORICAL_BILLED_READ_LIMIT,
  HISTORICAL_DATA_LEGACY_PRESERVATION_KIND,
  HISTORICAL_DATA_COUNT_RESULT_SET_COUNT,
  HISTORICAL_DATA_BASELINE_MAX_AGE_MS,
  HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
  HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT,
  HISTORICAL_DATA_IDENTITIES_SQL,
  HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT,
  HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT,
  HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
  HISTORICAL_DATA_SNAPSHOT_SQL,
  HISTORICAL_DATA_SUMMARY_SQL,
  HISTORICAL_DATASET_NAMES,
  HISTORICAL_OPERATIONAL_DATASET_NAMES,
  HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
  createHistoricalDataBaseline,
  historicalDataBudgetOperationId,
  parseHistoricalDataBaselineReport,
  parseHistoricalDataLegacyBaselineReportForContinuity,
  readAndValidateHistoricalDataBaseline,
  verifyHistoricalDataPreservation,
  writeHistoricalDataReport,
  type HistoricalDataBaselineReport,
  type HistoricalDatasetName,
  type HistoricalDataLegacyBaselineReport,
  type HistoricalOperationalDatasetName,
  type HistoricalSupplementalDatasetName,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import {
  readD1ReleaseBudgetLedger,
  reserveD1ReleaseBudget,
} from "../scripts/cloudflare/d1-release-budget-ledger";
import type { D1DailyUsage } from "../scripts/cloudflare/d1-free-budget";
import {
  stableStringify,
  type WranglerRunner,
} from "../scripts/cloudflare/migration-config";
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
    const baselineCalls: WranglerCall[] = [];
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
    assert.equal(baselineCalls.length, 1);
    assert.equal(baselineCalls[0]?.args.at(-1), HISTORICAL_DATA_SNAPSHOT_SQL);
    assert.deepEqual(baselineCalls[0]?.options, {
      env: {
        HISTORICAL_DATA_PRESERVATION_HMAC_SECRET: undefined,
        WRANGLER_WRITE_LOGS: "false",
      },
    });
    assert.equal(baseline.rowsRead, 68);
    assert.deepEqual(
      Object.keys(baseline.supplementalDatasets).sort(),
      [...HISTORICAL_SUPPLEMENTAL_DATASET_NAMES].sort(),
    );
    const {
      supplementalDatasets: _omittedSupplementalDatasets,
      ...downgradedCurrentBaseline
    } = structuredClone(baseline);
    void _omittedSupplementalDatasets;
    assert.throws(
      () => parseHistoricalDataBaselineReport(downgradedCurrentBaseline),
      /supplementalDatasets|invalid_type/,
      "a V2 baseline cannot be downgraded by stripping supplemental evidence",
    );
    const legacyTenDatasetBaseline = legacyBaselineFixture(baseline);
    assert.deepEqual(
      parseHistoricalDataLegacyBaselineReportForContinuity(
        legacyTenDatasetBaseline,
        {
          sourceSha256: legacyTenDatasetBaseline.sourceFingerprint.sha256,
          sourceFileCount: legacyTenDatasetBaseline.sourceFingerprint.fileCount,
          createdAt: legacyTenDatasetBaseline.createdAt,
          utcDay: legacyTenDatasetBaseline.utcDay,
          operationId: legacyTenDatasetBaseline.operationId,
        },
      ),
      legacyTenDatasetBaseline,
      "the isolated V1 parser retains the immutable predecessor format",
    );

    const reportPath = writeHistoricalDataReport(backupDir, baseline);
    assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
    const serialized = fs.readFileSync(reportPath, "utf8");
    assert.doesNotMatch(
      serialized,
      /historical-user-id|private-session-token|owner@example\.com|memory-turn-id|user-message-id|assistant-message-id|memory-feedback-id|memory-event-id/,
    );
    fs.writeFileSync(reportPath, `${JSON.stringify(legacyTenDatasetBaseline)}\n`, { mode: 0o600 });
    fs.chmodSync(reportPath, 0o600);
    assert.throws(
      () => readAndValidateHistoricalDataBaseline({
        backupDir,
        expectedSourceFingerprint: source,
        now,
      }),
      /inspir-historical-data-preservation-v2|Invalid input/,
      "the direct reader accepts V2 only",
    );
    fs.writeFileSync(reportPath, serialized, { mode: 0o600 });
    fs.chmodSync(reportPath, 0o600);
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

test("verifier preserves the complete saved-memory and AI-run graph", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-memory-loss-"));
  try {
    const source = makeSource("memory graph source");
    const baseline = createHistoricalDataBaseline({
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      runner: fixtureRunner(databaseFixture()),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });
    const current = databaseFixture();
    current.counts.chat_memory_turns = 0;
    current.identities.chat_memory_turns = [];
    const memoryEventIdentity = current.identities.memory_events[0];
    assert.ok(memoryEventIdentity);
    memoryEventIdentity.identity_1 = "replacement-memory-event";
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
    assert.ok(verification.problems.some((problem) => /chat_memory_turns row count decreased/.test(problem)));
    assert.ok(verification.problems.some((problem) => /memory_events is missing/.test(problem)));
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("V2 parsing requires every supplemental dataset", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-v2-required-"));
  try {
    const baseline = createHistoricalDataBaseline({
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: makeSource("required supplemental source"),
      runner: fixtureRunner(databaseFixture()),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });
    for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
      const incomplete = structuredClone(baseline);
      Reflect.deleteProperty(incomplete.supplementalDatasets, name);
      assert.throws(
        () => parseHistoricalDataBaselineReport(incomplete),
        new RegExp(name),
      );
    }
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("V2 parsing requires explicit operational outbox evidence", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-v2-outbox-"));
  try {
    const baseline = createHistoricalDataBaseline({
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: makeSource("required operational outbox source"),
      runner: fixtureRunner(databaseFixture()),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });
    const incomplete = structuredClone(baseline);
    Reflect.deleteProperty(
      incomplete.operationalDatasets,
      "memory_vector_cleanup_outbox",
    );
    assert.throws(
      () => parseHistoricalDataBaselineReport(incomplete),
      /memory_vector_cleanup_outbox|Invalid input/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("operational outbox rows may drain while its schema remains protected", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-outbox-drain-"));
  try {
    const source = makeSource("mutable operational outbox source");
    const before = databaseFixture();
    before.counts.memory_vector_cleanup_outbox = 2;
    const baseline = createHistoricalDataBaseline({
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      runner: fixtureRunner(before),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });
    assert.equal(
      baseline.operationalDatasets.memory_vector_cleanup_outbox.rowCount,
      2,
    );
    const after = databaseFixture();
    after.counts.memory_vector_cleanup_outbox = 0;
    const verification = verifyHistoricalDataPreservation({
      baseline,
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      runner: fixtureRunner(after),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });
    assert.equal(verification.ok, true);
    assert.equal(
      verification.operationalDatasets.memory_vector_cleanup_outbox.rowCount,
      0,
    );
    assert.doesNotMatch(verification.problems.join("\n"), /outbox.*row count/i);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("operational outbox capture rejects a missing required 0016 column", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-outbox-schema-"));
  try {
    assert.throws(
      () => createHistoricalDataBaseline({
        backupDir,
        hmacSecret: secret,
        sourceFingerprint: makeSource("invalid operational outbox schema"),
        runner: fixtureRunner(databaseFixture(), [], (sets) => {
          const outboxSchemaIndex =
            HISTORICAL_DATA_COUNT_RESULT_SET_COUNT +
            HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT -
            1;
          const outboxSchema = sets[outboxSchemaIndex];
          assert.ok(outboxSchema);
          outboxSchema.rows = outboxSchema.rows.filter(
            (row) => row.name !== "write_token",
          );
        }),
        usageLoader: () => emptyUsage,
        clock: () => now,
      }),
      /missing required operational column write_token/,
    );
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("every supplemental dataset rejects count loss and sentinel replacement", () => {
  for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
    for (const mode of ["count", "sentinel"] as const) {
      const backupDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `inspir-history-${mode}-${name}-`),
      );
      try {
        const source = makeSource(`${mode} ${name} preservation source`);
        const baseline = createHistoricalDataBaseline({
          backupDir,
          hmacSecret: secret,
          sourceFingerprint: source,
          runner: fixtureRunner(databaseFixture()),
          usageLoader: () => emptyUsage,
          clock: () => now,
        });
        const changed = databaseFixture();
        if (mode === "count") {
          changed.counts[name] = 0;
          changed.identities[name] = [];
        } else {
          const identity = changed.identities[name][0];
          assert.ok(identity);
          identity.identity_1 = `replacement-${name}`;
        }
        const verify = () => verifyHistoricalDataPreservation({
          baseline,
          backupDir,
          hmacSecret: secret,
          sourceFingerprint: source,
          runner: fixtureRunner(changed),
          usageLoader: () => emptyUsage,
          clock: () => now,
        });
        if (mode === "count" && name === "user_memory_graph_edges") {
          assert.throws(verify, /user-memory graph evidence does not match/);
          continue;
        }
        const report = verify();
        assert.equal(report.ok, false, `${name} ${mode} loss must fail`);
        assert.ok(
          report.problems.some((problem) => problem.includes(
            mode === "count" ? `${name} row count decreased` : `${name} is missing`,
          )),
          `${name} ${mode} loss must be named`,
        );
      } finally {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    }
  }
});

test("same-row memory graph edge rewiring is detected", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-edge-rewire-"));
  try {
    const source = makeSource("memory edge source");
    const baseline = createHistoricalDataBaseline({
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      runner: fixtureRunner(databaseFixture()),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });
    const rewired = databaseFixture();
    const mutations = [
      ["user_memory_graph_edges", "identity_5", "different-chat-id"],
      ["chat_memory_turns", "identity_5", "different-user-message-id"],
      ["memory_source_feedback", "identity_4", "different-memory-id"],
      ["memory_events", "identity_4", "different-event-chat-id"],
    ] as const;
    for (const [dataset, field, value] of mutations) {
      const identity = rewired.identities[dataset][0];
      assert.ok(identity);
      identity[field] = value;
    }
    const report = verifyHistoricalDataPreservation({
      baseline,
      backupDir,
      hmacSecret: secret,
      sourceFingerprint: source,
      runner: fixtureRunner(rewired),
      usageLoader: () => emptyUsage,
      clock: () => now,
    });
    assert.equal(report.ok, false);
    for (const [dataset] of mutations) {
      assert.ok(
        report.problems.some((problem) => problem.includes(`${dataset} is missing`)),
        `${dataset} edge rewiring must be named`,
      );
    }
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
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
    for (const name of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
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
    const calls: WranglerCall[] = [];
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
  assert.equal(HISTORICAL_DATA_COUNT_RESULT_SET_COUNT, 21);
  assert.equal(HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT, 19);
  assert.equal(HISTORICAL_DATA_IDENTITY_RESULT_SET_COUNT, 20);
  assert.equal(HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT, 60);
  assert.equal(HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ, 690_209);
  assert.ok(HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ <= HISTORICAL_BILLED_READ_LIMIT);
  const statements = HISTORICAL_DATA_SNAPSHOT_SQL
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(statements.length, HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT);
  for (const [index, statement] of statements.entries()) {
    assert.match(statement, /^SELECT\b/i);
    const nestedCountOrProfileIdentity: boolean =
      index < HISTORICAL_DATA_COUNT_RESULT_SET_COUNT ||
      statement.includes("bounded_rowid");
    assert.equal(
      (statement.match(/\bSELECT\b/gi) ?? []).length,
      nestedCountOrProfileIdentity ? 2 : 1,
    );
    assert.doesNotMatch(statement, /\b(?:UNION|INTERSECT|EXCEPT)\b/i);
    assert.doesNotMatch(
      statement,
      /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i,
    );
  }
  assert.doesNotMatch(HISTORICAL_DATA_SNAPSHOT_SQL, /\bUNION\b/i);
  assert.equal((HISTORICAL_DATA_IDENTITIES_SQL.match(/ORDER BY rowid LIMIT 16/g) ?? []).length, 19);
  assert.equal(
    (HISTORICAL_DATA_SUMMARY_SQL.match(/AS row_count FROM \(SELECT/g) ?? []).length,
    21,
  );
  assert.match(HISTORICAL_DATA_IDENTITIES_SQL, /bounded_rowid[\s\S]*LIMIT 100001/);
  assert.match(HISTORICAL_DATA_SUMMARY_SQL, /profile_photo_pointers/);
  assert.match(HISTORICAL_DATA_SUMMARY_SQL, /chat_memory_turns/);
  assert.match(HISTORICAL_DATA_SUMMARY_SQL, /memory_source_feedback/);
  assert.match(HISTORICAL_DATA_SUMMARY_SQL, /memory_vector_cleanup_outbox/);
});

test("snapshot result partitions and billing metadata fail closed", () => {
  const cases: Array<{
    name: string;
    mutate: (sets: FixtureResultSet[]) => void;
    pattern: RegExp;
  }> = [
    {
      name: "written rows",
      mutate: (sets) => {
        const set = sets[0];
        if (set) set.rowsWritten = 1;
      },
      pattern: /unexpectedly wrote rows/,
    },
    {
      name: "billing overflow",
      mutate: (sets) => {
        const first = sets[0];
        const second = sets[1];
        if (first) first.rowsRead = Number.MAX_SAFE_INTEGER;
        if (second) second.rowsRead = 1;
      },
      pattern: /metadata overflowed/,
    },
    {
      name: "missing billing metadata",
      mutate: (sets) => {
        const set = sets[0];
        if (set) set.rowsRead = Number.NaN;
      },
      pattern: /lacks billing metadata/,
    },
    {
      name: "swapped count results",
      mutate: (sets) => {
        const first = sets[0];
        const second = sets[1];
        if (first && second) [first.rows, second.rows] = [second.rows, first.rows];
      },
      pattern: /count result order or shape is invalid/,
    },
    {
      name: "extra identity field",
      mutate: (sets) => {
        const firstIdentity = sets[
          HISTORICAL_DATA_COUNT_RESULT_SET_COUNT + HISTORICAL_DATA_SCHEMA_RESULT_SET_COUNT
        ];
        const row = firstIdentity?.rows[0];
        if (row) row.raw_identifier = "must-never-be-accepted";
      },
      pattern: /users identity shape is invalid/,
    },
    {
      name: "missing result set",
      mutate: (sets) => {
        sets.pop();
      },
      pattern: /unexpected result-set count/,
    },
  ];

  for (const fixtureCase of cases) {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-malformed-"));
    try {
      assert.throws(
        () => createHistoricalDataBaseline({
          backupDir,
          hmacSecret: secret,
          sourceFingerprint: makeSource(`malformed ${fixtureCase.name}`),
          runner: fixtureRunner(databaseFixture(), [], fixtureCase.mutate),
          usageLoader: () => emptyUsage,
          clock: () => now,
        }),
        fixtureCase.pattern,
      );
    } finally {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  }
});

test("snapshot accepts its exact proven read bound and rejects one row beyond it", () => {
  for (const overage of [0, 1] as const) {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-history-read-bound-"));
    try {
      const run = () => createHistoricalDataBaseline({
        backupDir,
        hmacSecret: secret,
        sourceFingerprint: makeSource(`snapshot bound ${overage}`),
        runner: fixtureRunner(databaseFixture(), [], (sets) => {
          const billed = sets.reduce((sum, set) => sum + set.rowsRead, 0);
          const first = sets[0];
          assert.ok(first);
          first.rowsRead += HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ + overage - billed;
        }),
        usageLoader: () => emptyUsage,
        clock: () => now,
      });
      if (overage === 0) {
        assert.equal(run().rowsRead, HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ);
      } else {
        assert.throws(run, /exceed the proven V2 snapshot bound/);
      }
    } finally {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  }
});

test("generated snapshot SQL executes on D1 and oversized sparse users scans stop at cap plus one", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default {}",
    d1Databases: { DB: `historical-snapshot-${crypto.randomUUID()}` },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    const schemaStatements = HISTORICAL_SNAPSHOT_TEST_SCHEMA_SQL
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => database.prepare(statement));
    await database.batch(schemaStatements);
    const statements = HISTORICAL_DATA_SNAPSHOT_SQL
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    assert.equal(statements.length, HISTORICAL_DATA_SNAPSHOT_RESULT_SET_COUNT);
    for (const statement of statements) {
      await database.prepare(statement).all();
    }

    await database.prepare(
      `with recursive generated(value) as (
         select 1
         union all
         select value + 1 from generated where value < 100002
       )
       insert into users (
         id, profile_image_r2_key, profile_image_hash, profile_image_r2_etag
       )
       select
         printf('user-%06d', value),
         case when value = 100002 then 'outside-bounded-scan' else null end,
         null,
         null
       from generated;`,
    ).run();
    const countStatements = HISTORICAL_DATA_SUMMARY_SQL
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    const usersCount = await database.prepare(countStatements[0] ?? "").first<{
      row_count: number;
    }>();
    const profileCount = await database.prepare(countStatements[9] ?? "").first<{
      row_count: number;
    }>();
    const profileIdentityStatement = HISTORICAL_DATA_IDENTITIES_SQL
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)[9];
    assert.equal(usersCount?.row_count, 100_001);
    assert.equal(profileCount?.row_count, 0);
    assert.ok(profileIdentityStatement);
    const profileIdentities = await database.prepare(profileIdentityStatement).all();
    assert.deepEqual(profileIdentities.results, []);
  } finally {
    await miniflare.dispose();
  }
});

type HistoricalProtectedFixtureDatasetName =
  | HistoricalDatasetName
  | HistoricalSupplementalDatasetName;
type HistoricalFixtureDatasetName =
  | HistoricalProtectedFixtureDatasetName
  | HistoricalOperationalDatasetName;

type DatabaseFixture = {
  counts: Record<HistoricalFixtureDatasetName, number>;
  identities: Record<
    HistoricalProtectedFixtureDatasetName,
    Array<Record<string, unknown>>
  >;
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
      ai_runs: 1,
      user_memory_graph_edges: 1,
      user_memory_settings: 1,
      chat_memory_summaries: 1,
      chat_memory_turns: 1,
      user_memory_profiles: 1,
      user_memory_summaries: 1,
      memory_synthesis_runs: 1,
      memory_source_feedback: 1,
      memory_events: 1,
      memory_vector_cleanup_outbox: 0,
    },
    identities: {
      users: [{ identity_1: "historical-user-id" }],
      accounts: [{
        identity_1: "provider",
        identity_2: "provider-account-id",
        identity_3: "historical-user-id",
      }],
      sessions: [{
        identity_1: "private-session-token",
        identity_2: "historical-user-id",
      }],
      chats: [{ identity_1: "chat-id", identity_2: "historical-user-id" }],
      messages: [{ identity_1: "message-id", identity_2: "chat-id" }],
      admin_users: [],
      user_memories: [{ identity_1: "memory-id", identity_2: "historical-user-id" }],
      activity_runs: [],
      product_events: [],
      profile_photo_pointers: [],
      ai_runs: [{
        identity_1: "ai-run-id",
        identity_2: "chat-id",
        identity_3: "user-message-id",
      }],
      user_memory_graph_edges: [{
        identity_1: "memory-id",
        identity_2: "historical-user-id",
        identity_3: '["memory-turn-id"]',
        identity_4: "[]",
        identity_5: "chat-id",
        identity_6: "user-message-id",
        identity_7: "",
      }],
      user_memory_settings: [{ identity_1: "historical-user-id" }],
      chat_memory_summaries: [{ identity_1: "chat-id", identity_2: "historical-user-id" }],
      chat_memory_turns: [{
        identity_1: "memory-turn-id",
        identity_2: "historical-user-id",
        identity_3: "chat-id",
        identity_4: "topic-id",
        identity_5: "user-message-id",
        identity_6: "assistant-message-id",
      }],
      user_memory_profiles: [{ identity_1: "historical-user-id", identity_2: "goals" }],
      user_memory_summaries: [{ identity_1: "historical-user-id" }],
      memory_synthesis_runs: [{ identity_1: "synthesis-run-id", identity_2: "historical-user-id" }],
      memory_source_feedback: [{
        identity_1: "memory-feedback-id",
        identity_2: "historical-user-id",
        identity_3: "ai-run-id",
        identity_4: "memory-id",
        identity_5: "memory-turn-id",
        identity_6: "summary-section-id",
      }],
      memory_events: [{
        identity_1: "memory-event-id",
        identity_2: "historical-user-id",
        identity_3: "memory-id",
        identity_4: "chat-id",
        identity_5: "message-id",
      }],
    },
  };
}

function fixtureRunner(
  fixture: DatabaseFixture,
  calls: WranglerCall[] = [],
  mutate?: (sets: FixtureResultSet[]) => void,
): WranglerRunner {
  return (args, options) => {
    calls.push({ args, options });
    const sql = args.at(-1);
    if (sql === HISTORICAL_DATA_SNAPSHOT_SQL) {
      const datasetNames = [
        ...HISTORICAL_DATASET_NAMES,
        ...HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
        ...HISTORICAL_OPERATIONAL_DATASET_NAMES,
      ] as const;
      const protectedDatasetNames = [
        ...HISTORICAL_DATASET_NAMES,
        ...HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
      ] as const;
      const countSets = datasetNames.map((name) => ({
        rows: [{ dataset: name, row_count: fixture.counts[name] }],
        rowsRead: fixture.counts[name],
      }));
      const schemaSets = schemaTableNames().map((table) => {
        const rows = table === "memory_vector_cleanup_outbox"
          ? memoryVectorCleanupOutboxSchemaRows()
          : [{
              table_name: table,
              name: table === "admin_users" ? "email" : "id",
              type: "text",
              not_null: 1,
              primary_key: 1,
            }];
        return { rows, rowsRead: rows.length };
      });
      const identitySets = protectedDatasetNames.map((name) => ({
        rows: fixture.identities[name],
        rowsRead: fixture.identities[name].length,
      }));
      const sets: FixtureResultSet[] = [...countSets, ...schemaSets, ...identitySets];
      mutate?.(sets);
      return wranglerResult(sets);
    }
    throw new Error("Unexpected D1 SQL in historical preservation fixture.");
  };
}

type WranglerCall = {
  args: string[];
  options: Parameters<WranglerRunner>[1];
};

type FixtureResultSet = {
  rows: Array<Record<string, unknown>>;
  rowsRead: number;
  rowsWritten?: number;
};

function wranglerResult(
  sets: FixtureResultSet[],
) {
  return JSON.stringify(sets.map((set) => ({
    success: true,
    results: set.rows,
    meta: { rows_read: set.rowsRead, rows_written: set.rowsWritten ?? 0 },
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
    "ai_runs",
    "user_memory_settings",
    "chat_memory_summaries",
    "chat_memory_turns",
    "user_memory_profiles",
    "user_memory_summaries",
    "memory_synthesis_runs",
    "memory_source_feedback",
    "memory_events",
    "memory_vector_cleanup_outbox",
  ] as const;
}

function memoryVectorCleanupOutboxSchemaRows() {
  const columns = [
    ["vector_id", "text", 1, 1],
    ["absence_count", "integer", 1, 0],
    ["attempt_count", "integer", 1, 0],
    ["created_at", "integer", 1, 0],
    ["last_attempt_at", "integer", 0, 0],
    ["last_error", "text", 0, 0],
    ["lease_token", "text", 0, 0],
    ["lease_until", "integer", 1, 0],
    ["next_attempt_at", "integer", 1, 0],
    ["owner_user_id", "text", 0, 0],
    ["reason", "text", 1, 0],
    ["source_namespace", "text", 0, 0],
    ["source_row_id", "text", 0, 0],
    ["source_row_revision", "integer", 0, 0],
    ["state", "text", 1, 0],
    ["updated_at", "integer", 1, 0],
    ["write_fence_expires_at", "integer", 0, 0],
    ["write_token", "text", 0, 0],
  ] as const;
  return columns.map(([name, type, notNull, primaryKey]) => ({
    table_name: "memory_vector_cleanup_outbox",
    name,
    type,
    not_null: notNull,
    primary_key: primaryKey,
  }));
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

function legacyBaselineFixture(
  baseline: HistoricalDataBaselineReport,
): HistoricalDataLegacyBaselineReport {
  const sourceIdentity = {
    sha256: baseline.sourceFingerprint.sha256,
    fileCount: baseline.sourceFingerprint.fileCount,
  };
  const operationBinding = createHash("sha256")
    .update(stableStringify({
      kind: HISTORICAL_DATA_LEGACY_PRESERVATION_KIND,
      phase: "baseline",
      sourceFingerprint: sourceIdentity,
    }))
    .digest("hex");
  const operationId = `historical-data-preservation-baseline:${operationBinding}`;
  const {
    supplementalDatasets: _supplementalDatasets,
    operationalDatasets: _operationalDatasets,
    limits: _limits,
    ...core
  } = structuredClone(baseline);
  void _supplementalDatasets;
  void _operationalDatasets;
  void _limits;
  return {
    ...core,
    kind: HISTORICAL_DATA_LEGACY_PRESERVATION_KIND,
    schemaVersion: 1,
    operationId,
    ledger: {
      ...core.ledger,
      reservation: {
        ...core.ledger.reservation,
        operationId,
      },
    },
    limits: {
      coreRows: baseline.limits.coreRows,
      billedReads: baseline.limits.billedReads,
      sentinelsPerDataset: baseline.limits.sentinelsPerDataset,
    },
  };
}

const HISTORICAL_SNAPSHOT_TEST_SCHEMA_SQL = `
  create table users (
    id text primary key,
    profile_image_r2_key text,
    profile_image_hash text,
    profile_image_r2_etag text
  );
  create table accounts (provider text, provider_account_id text, user_id text);
  create table sessions (session_token text, user_id text);
  create table chats (id text, user_id text);
  create table messages (id text, chat_id text);
  create table admin_users (email text);
  create table user_memories (
    id text,
    user_id text,
    source_turn_ids text,
    source_memory_ids text,
    source_chat_id text,
    source_message_id text,
    superseded_by_memory_id text
  );
  create table activity_runs (id text, chat_id text);
  create table product_events (id text, user_id text);
  create table ai_runs (id text, chat_id text, user_message_id text);
  create table user_memory_settings (user_id text);
  create table chat_memory_summaries (chat_id text, user_id text);
  create table chat_memory_turns (
    id text,
    user_id text,
    chat_id text,
    topic_id text,
    user_message_id text,
    assistant_message_id text
  );
  create table user_memory_profiles (user_id text, category text);
  create table user_memory_summaries (user_id text);
  create table memory_synthesis_runs (id text, user_id text);
  create table memory_source_feedback (
    id text,
    user_id text,
    ai_run_id text,
    memory_id text,
    chat_turn_id text,
    summary_section_id text
  );
  create table memory_events (
    id text,
    user_id text,
    memory_id text,
    chat_id text,
    message_id text
  );
  create table memory_vector_cleanup_outbox (
    vector_id text primary key not null,
    owner_user_id text,
    source_namespace text,
    source_row_id text,
    source_row_revision integer,
    write_token text,
    reason text not null,
    state text not null,
    write_fence_expires_at integer,
    absence_count integer not null,
    attempt_count integer not null,
    lease_token text,
    lease_until integer not null,
    next_attempt_at integer not null,
    last_attempt_at integer,
    last_error text,
    created_at integer not null,
    updated_at integer not null
  );
`;
