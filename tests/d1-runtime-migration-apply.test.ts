import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  D1_RUNTIME_MIGRATION_OUTCOME_REPORT,
  applyD1RuntimeMigrations,
} from "../scripts/cloudflare/apply-d1-runtime-migrations";
import {
  runRuntimeMigrationBudgetCheck,
  writeRuntimeMigrationBudgetReport,
} from "../scripts/cloudflare/check-d1-runtime-migration-budget";
import { D1_DATABASE_ID, D1_DATABASE_NAME, type WranglerRunner } from "../scripts/cloudflare/migration-config";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
  RUNTIME_MIGRATION_FILES,
} from "../scripts/cloudflare/verify-d1-runtime-migrations";

const clockValue = new Date("2026-07-12T12:00:00.000Z");
const bookmark = "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683";
const cardinalities = {
  users: 10,
  chats: 5,
  messages: 20,
  aiRuns: 2,
  rateLimitWindows: 3,
  opsEvents: 1,
  activityRuns: 4,
  userMemorySettings: 8,
  memorySourceFeedback: 3,
  suppressionBackfillUsers: 2,
};
const usage = {
  databaseCount: 1,
  queryGroups: 0,
  rowsRead: 0,
  rowsWritten: 0,
  executions: 0,
  windowMinutes: 721,
};

test("migration wrapper durably captures diagnostic evidence before applying 0013-0016 in order", () => {
  const fixture = makeReleaseFixture();
  let appliedThrough = 0;
  const migrationCalls: string[] = [];
  let evidenceObservedBeforeFirstWrite = false;
  const runner: WranglerRunner = (args) => {
    if (args[1] === "time-travel") return JSON.stringify({ bookmark });
    if (args[1] === "execute" && args.includes("--command")) {
      return verificationOutput(verificationRows(appliedThrough));
    }
    if (args[1] === "execute" && args.includes("--file")) {
      const file = path.basename(requiredArg(args, "--file"));
      migrationCalls.push(file);
      const evidenceFiles = preWriteEvidenceFiles(fixture.backupDir);
      evidenceObservedBeforeFirstWrite = evidenceObservedBeforeFirstWrite || evidenceFiles.length === 1;
      assert.equal(evidenceFiles.length, 1);
      assert.equal(fs.statSync(evidenceFiles[0]).mode & 0o777, 0o600);
      assert.equal(file, path.basename(RUNTIME_MIGRATION_FILES[appliedThrough]));
      appliedThrough += 1;
      return JSON.stringify([{ success: true }]);
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    const outcome = applyD1RuntimeMigrations({
      confirmed: true,
      backupDir: fixture.backupDir,
      cwd: fixture.repoDir,
      runner,
      clock: () => clockValue,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.status, "verified");
    assert.equal(evidenceObservedBeforeFirstWrite, true);
    assert.deepEqual(
      migrationCalls,
      RUNTIME_MIGRATION_FILES.map((file) => path.basename(file)),
    );
    assert.deepEqual(
      outcome.attempts.map((attempt) => attempt.migration),
      ["0013", "0014", "0015", "0016"],
    );
    assert.ok(outcome.attempts.every((attempt) => attempt.responseConfirmed));
    assert.equal(outcome.stateAfter?.nextMigration, null);
    assert.ok(outcome.preWriteEvidencePath);
    const evidence = readJson(outcome.preWriteEvidencePath);
    assert.equal(evidence.kind, "d1-runtime-migrations-0013-0016-prewrite");
    assert.deepEqual(evidence.database, { id: D1_DATABASE_ID, name: D1_DATABASE_NAME });
    assert.equal(evidence.timeTravelBookmark, bookmark);
    assert.ok(Array.isArray(evidence.migrationFiles));
    assert.equal(evidence.migrationFiles.length, 4);
    const projection = requiredRecordValue(evidence.projection);
    assert.equal(
      projection.rowsRead,
      fixture.report.projection.rowsRead,
    );
    assert.equal(projection.suppressionBackfillRowsRead, 20);
    assert.equal(projection.suppressionBackfillRowsWritten, 4);
    assert.equal(evidence.recoveryPreference, "reviewed-forward-correction");
    assert.equal(evidence.destructiveRestoreSupported, false);
    assert.equal(Object.hasOwn(evidence, "restoreCommand"), false);
    assert.equal(Object.hasOwn(evidence, "restoreCommandStdin"), false);
    const outcomePath = path.join(
      fixture.backupDir,
      "cloudflare",
      D1_RUNTIME_MIGRATION_OUTCOME_REPORT,
    );
    assert.equal(fs.statSync(outcomePath).mode & 0o777, 0o600);
    assert.equal(readJson(outcomePath).ok, true);

    const durableWriter = fs.readFileSync(
      path.resolve("scripts/cloudflare/d1-release-budget-ledger.ts"),
      "utf8",
    );
    assert.match(durableWriter, /fs\.fsyncSync\(descriptor\)/);
    assert.match(durableWriter, /fs\.renameSync\(temporary, absolute\)/);
    assert.match(durableWriter, /fsyncDirectory\(directory\)/);
  } finally {
    cleanupFixture(fixture);
  }
});

test("ambiguous 0015 is never retried and successful exact read-only state recovers it", () => {
  const fixture = makeReleaseFixture();
  let appliedThrough = 0;
  let migration0015Calls = 0;
  const runner: WranglerRunner = (args) => {
    if (args[1] === "time-travel") return JSON.stringify({ bookmark });
    if (args[1] === "execute" && args.includes("--command")) {
      return verificationOutput(verificationRows(appliedThrough));
    }
    if (args[1] === "execute" && args.includes("--file")) {
      const file = path.basename(requiredArg(args, "--file"));
      if (file.startsWith("0013_")) appliedThrough = 1;
      else if (file.startsWith("0014_")) appliedThrough = 2;
      else if (file.startsWith("0015_")) {
        migration0015Calls += 1;
        appliedThrough = 3;
        throw new Error("simulated transport loss after 0015 committed");
      } else if (file.startsWith("0016_")) {
        appliedThrough = 4;
      } else {
        throw new Error(`Unexpected migration file: ${file}`);
      }
      return JSON.stringify([{ success: true }]);
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    const outcome = applyD1RuntimeMigrations({
      confirmed: true,
      backupDir: fixture.backupDir,
      cwd: fixture.repoDir,
      runner,
      clock: () => clockValue,
    });
    assert.equal(outcome.ok, true);
    assert.equal(migration0015Calls, 1);
    const attempt = outcome.attempts.find((entry) => entry.migration === "0015");
    assert.ok(attempt);
    assert.equal(attempt.responseConfirmed, false);
    assert.equal(attempt.recoveredByVerification, true);
    assert.match(attempt.transportError ?? "", /transport loss/);
    assert.ok(attempt.stateAfter);
    assert.equal(attempt.stateAfter.groups["0015"], "applied");
  } finally {
    cleanupFixture(fixture);
  }
});

test("ambiguous unapplied 0016 stops after one attempt instead of retrying blindly", () => {
  const fixture = makeReleaseFixture();
  let appliedThrough = 0;
  let migration0016Calls = 0;
  const runner: WranglerRunner = (args) => {
    if (args[1] === "time-travel") return JSON.stringify({ bookmark });
    if (args[1] === "execute" && args.includes("--command")) {
      return verificationOutput(verificationRows(appliedThrough));
    }
    if (args[1] === "execute" && args.includes("--file")) {
      const file = path.basename(requiredArg(args, "--file"));
      if (file.startsWith("0013_")) appliedThrough = 1;
      else if (file.startsWith("0014_")) appliedThrough = 2;
      else if (file.startsWith("0015_")) appliedThrough = 3;
      else if (file.startsWith("0016_")) {
        migration0016Calls += 1;
        throw new Error("simulated transport loss before 0016 commit");
      }
      return JSON.stringify([{ success: true }]);
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    assert.throws(
      () =>
        applyD1RuntimeMigrations({
          confirmed: true,
          backupDir: fixture.backupDir,
          cwd: fixture.repoDir,
          runner,
          clock: () => clockValue,
        }),
      /0016 had an ambiguous response and remained unapplied; it was not retried automatically/,
    );
    assert.equal(migration0016Calls, 1);
    const outcome = readJson(
      path.join(fixture.backupDir, "cloudflare", D1_RUNTIME_MIGRATION_OUTCOME_REPORT),
    );
    assert.equal(outcome.ok, false);
    assert.ok(Array.isArray(outcome.attempts));
    const attempt = outcome.attempts.find(
      (entry) => isRecord(entry) && entry.migration === "0016",
    );
    assert.ok(attempt);
    assert.ok(isRecord(attempt));
    assert.equal(attempt.responseConfirmed, false);
    assert.equal(attempt.recoveredByVerification, false);
  } finally {
    cleanupFixture(fixture);
  }
});

test("ambiguous unapplied 0015 stops after one attempt instead of retrying blindly", () => {
  const fixture = makeReleaseFixture();
  let appliedThrough = 0;
  let migration0015Calls = 0;
  const runner: WranglerRunner = (args) => {
    if (args[1] === "time-travel") return JSON.stringify({ bookmark });
    if (args[1] === "execute" && args.includes("--command")) {
      return verificationOutput(verificationRows(appliedThrough));
    }
    if (args[1] === "execute" && args.includes("--file")) {
      const file = path.basename(requiredArg(args, "--file"));
      if (file.startsWith("0013_")) appliedThrough = 1;
      else if (file.startsWith("0014_")) appliedThrough = 2;
      else if (file.startsWith("0015_")) {
        migration0015Calls += 1;
        throw new Error("simulated transport loss before 0015 commit");
      }
      return JSON.stringify([{ success: true }]);
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    assert.throws(
      () =>
        applyD1RuntimeMigrations({
          confirmed: true,
          backupDir: fixture.backupDir,
          cwd: fixture.repoDir,
          runner,
          clock: () => clockValue,
        }),
      /remained unapplied; it was not retried automatically/,
    );
    assert.equal(migration0015Calls, 1);
    const outcome = readJson(
      path.join(
        fixture.backupDir,
        "cloudflare",
        D1_RUNTIME_MIGRATION_OUTCOME_REPORT,
      ),
    );
    assert.equal(outcome.ok, false);
    assert.ok(Array.isArray(outcome.attempts));
    const attempt = outcome.attempts.find(
      (entry) => isRecord(entry) && entry.migration === "0015",
    );
    assert.ok(attempt);
    assert.ok(isRecord(attempt));
    assert.equal(attempt.responseConfirmed, false);
    assert.equal(attempt.recoveredByVerification, false);
  } finally {
    cleanupFixture(fixture);
  }
});

test("partial pre-existing state refuses bookmarks and every migration write", () => {
  const fixture = makeReleaseFixture();
  let timeTravelCalls = 0;
  let migrationCalls = 0;
  const runner: WranglerRunner = (args) => {
    if (args[1] === "time-travel") {
      timeTravelCalls += 1;
      return JSON.stringify({ bookmark });
    }
    if (args[1] === "execute" && args.includes("--file")) {
      migrationCalls += 1;
      return JSON.stringify([{ success: true }]);
    }
    if (args[1] === "execute" && args.includes("--command")) {
      return verificationOutput([rateLimitIndexRow()]);
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    assert.throws(
      () =>
        applyD1RuntimeMigrations({
          confirmed: true,
          backupDir: fixture.backupDir,
          cwd: fixture.repoDir,
          runner,
          clock: () => clockValue,
        }),
      /partial or out-of-order state/,
    );
    assert.equal(timeTravelCalls, 0);
    assert.equal(migrationCalls, 0);
    assert.deepEqual(preWriteEvidenceFiles(fixture.backupDir), []);
    const outcome = readJson(
      path.join(
        fixture.backupDir,
        "cloudflare",
        D1_RUNTIME_MIGRATION_OUTCOME_REPORT,
      ),
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, "failed");
    assert.match(String(outcome.error), /partial or out-of-order state/);
  } finally {
    cleanupFixture(fixture);
  }
});

test("0016 is partial until its completion marker exact-verifies", () => {
  const fixture = makeReleaseFixture();
  let timeTravelCalls = 0;
  const runner: WranglerRunner = (args) => {
    if (args[1] === "time-travel") {
      timeTravelCalls += 1;
      return JSON.stringify({ bookmark });
    }
    if (args[1] === "execute" && args.includes("--command")) {
      return verificationOutput(
        verificationRows(4).filter((row) => row.kind !== "migration-marker"),
      );
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    assert.throws(
      () =>
        applyD1RuntimeMigrations({
          confirmed: true,
          backupDir: fixture.backupDir,
          cwd: fixture.repoDir,
          runner,
          clock: () => clockValue,
        }),
      /partial or out-of-order state/,
    );
    assert.equal(timeTravelCalls, 0);
    const outcome = readJson(
      path.join(fixture.backupDir, "cloudflare", D1_RUNTIME_MIGRATION_OUTCOME_REPORT),
    );
    assert.equal(outcome.ok, false);
    assert.ok(isRecord(outcome.stateBefore));
    assert.ok(isRecord(outcome.stateBefore.groups));
    assert.equal(outcome.stateBefore.groups["0016"], "partial");
  } finally {
    cleanupFixture(fixture);
  }
});

test("migration wrapper requires explicit production confirmation before any runner call", () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-apply-confirm-"));
  let calls = 0;
  try {
    assert.throws(
      () =>
        applyD1RuntimeMigrations({
          backupDir,
          runner: () => {
            calls += 1;
            return "";
          },
        }),
      /requires --confirm-production/,
    );
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test("budget evidence parser round-trips a nonzero 0016 suppression backfill projection", () => {
  const fixture = makeReleaseFixture();
  const runner: WranglerRunner = (args) => {
    if (args[1] === "execute" && args.includes("--command")) {
      return verificationOutput(verificationRows(4));
    }
    throw new Error(`Unexpected fake Wrangler command: ${args.join(" ")}`);
  };

  try {
    assert.deepEqual(
      {
        reads: fixture.report.projection.suppressionBackfillRowsRead,
        writes: fixture.report.projection.suppressionBackfillRowsWritten,
      },
      { reads: 20, writes: 4 },
    );
    const outcome = applyD1RuntimeMigrations({
      confirmed: true,
      backupDir: fixture.backupDir,
      cwd: fixture.repoDir,
      runner,
      clock: () => clockValue,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.status, "already-applied");
    assert.deepEqual(outcome.attempts, []);
    assert.equal(outcome.stateBefore?.groups["0016"], "applied");
  } finally {
    cleanupFixture(fixture);
  }
});

function makeReleaseFixture() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-apply-repo-"));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-apply-backup-"));
  const git = spawnSync("git", ["init"], { cwd: repoDir, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  fs.writeFileSync(path.join(repoDir, "source.ts"), "export const release = true;\n");
  for (const file of RUNTIME_MIGRATION_FILES) {
    const target = path.join(repoDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fs.readFileSync(path.resolve(file)));
  }
  const report = runRuntimeMigrationBudgetCheck({
    backupDir,
    cwd: repoDir,
    clock: () => clockValue,
    usageLoader: () => usage,
    cardinalityLoader: () => ({
      cardinalities,
      rowsRead: 44,
      rowsWritten: 0,
    }),
  });
  writeRuntimeMigrationBudgetReport(backupDir, report);
  return { repoDir, backupDir, report };
}

function cleanupFixture(fixture: { repoDir: string; backupDir: string }) {
  fs.rmSync(fixture.repoDir, { recursive: true, force: true });
  fs.rmSync(fixture.backupDir, { recursive: true, force: true });
}

function preWriteEvidenceFiles(backupDir: string) {
  const directory = path.join(backupDir, "cloudflare");
  return fs
    .readdirSync(directory)
    .filter((file) => file.startsWith("d1-runtime-migrations-prewrite-"))
    .map((file) => path.join(directory, file));
}

function verificationRows(appliedThrough: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  if (appliedThrough >= 1) rows.push(rateLimitIndexRow(), aiRunsIndexRow(), opsEventsIndexRow());
  if (appliedThrough >= 2) rows.push(adminSnapshotRow());
  if (appliedThrough >= 3) {
    rows.push(
      columnRow("completion_token"),
      columnRow("completion_message_id"),
      activityIndexRow({
        name: "activity_runs_completion_token_uidx",
        column: "completion_token",
      }),
      activityIndexRow({
        name: "activity_runs_completion_message_id_uidx",
        column: "completion_message_id",
      }),
    );
  }
  if (appliedThrough >= 4) {
    rows.push(
      {
        kind: "memory-settings-column",
        name: "summary_suppression_mask",
        table_name: "user_memory_settings",
        column_type: "INTEGER",
        column_not_null: 1,
        column_default: "0",
        column_primary_key: 0,
        table_sql: `CREATE TABLE user_memory_settings (
          user_id text PRIMARY KEY NOT NULL,
          summary_suppression_mask integer DEFAULT 0 NOT NULL
            CONSTRAINT user_memory_settings_summary_suppression_mask_check
            CHECK (summary_suppression_mask BETWEEN 0 AND 511)
        )`,
      },
      ...outboxRows(),
      {
        kind: "migration-marker",
        name: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
        table_name: "app_metadata",
        table_sql: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
        snapshot_updated_at: 1_752_000_000_000,
      },
    );
  }
  return rows;
}

function outboxRows(): Array<Record<string, unknown>> {
  const columnSpecs = [
    ["vector_id", "TEXT", 1, null, 1],
    ["owner_user_id", "TEXT", 0, null, 0],
    ["source_namespace", "TEXT", 0, null, 0],
    ["source_row_id", "TEXT", 0, null, 0],
    ["source_row_revision", "INTEGER", 0, null, 0],
    ["write_token", "TEXT", 0, null, 0],
    ["reason", "TEXT", 1, null, 0],
    ["state", "TEXT", 1, "'cleanup_ready'", 0],
    ["write_fence_expires_at", "INTEGER", 0, null, 0],
    ["absence_count", "INTEGER", 1, "0", 0],
    ["attempt_count", "INTEGER", 1, "0", 0],
    ["lease_token", "TEXT", 0, null, 0],
    ["lease_until", "INTEGER", 1, "0", 0],
    ["next_attempt_at", "INTEGER", 1, null, 0],
    ["last_attempt_at", "INTEGER", 0, null, 0],
    ["last_error", "TEXT", 0, null, 0],
    ["created_at", "INTEGER", 1, null, 0],
    ["updated_at", "INTEGER", 1, null, 0],
  ] as const;
  const tableSql = `CREATE TABLE memory_vector_cleanup_outbox (
    vector_id text PRIMARY KEY NOT NULL CHECK (length(vector_id) BETWEEN 1 AND 64 AND vector_id NOT GLOB '*[^A-Za-z0-9:._-]*'),
    owner_user_id text CHECK (owner_user_id IS NULL OR length(owner_user_id) BETWEEN 1 AND 120),
    source_namespace text CHECK (source_namespace IS NULL OR source_namespace IN ('user_memories', 'chat_memory_turns')),
    source_row_id text CHECK (source_row_id IS NULL OR length(source_row_id) BETWEEN 1 AND 120),
    source_row_revision integer CHECK (source_row_revision IS NULL OR source_row_revision BETWEEN 1 AND 9007199254740991),
    write_token text CHECK (write_token IS NULL OR length(write_token) BETWEEN 1 AND 120),
    reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 80),
    state text DEFAULT 'cleanup_ready' NOT NULL CHECK (state IN ('write_pending', 'cleanup_fenced', 'cleanup_ready', 'verifying_absence')),
    write_fence_expires_at integer CHECK (write_fence_expires_at IS NULL OR write_fence_expires_at >= 0),
    absence_count integer DEFAULT 0 NOT NULL CHECK (absence_count >= 0 AND absence_count <= 2),
    attempt_count integer DEFAULT 0 NOT NULL CHECK (attempt_count >= 0),
    lease_token text CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 1 AND 120),
    lease_until integer DEFAULT 0 NOT NULL CHECK (lease_until >= 0),
    next_attempt_at integer NOT NULL CHECK (next_attempt_at >= 0),
    last_attempt_at integer CHECK (last_attempt_at IS NULL OR last_attempt_at >= 0),
    last_error text CHECK (last_error IS NULL OR length(last_error) <= 160),
    created_at integer NOT NULL CHECK (created_at >= 0),
    updated_at integer NOT NULL CHECK (updated_at >= 0)
  )`;
  const indexSql =
    "CREATE INDEX memory_vector_cleanup_outbox_due_idx ON memory_vector_cleanup_outbox (next_attempt_at, created_at, vector_id)";
  return [
    ...columnSpecs.map(([name, type, notNull, defaultValue, primaryKey]) => ({
      kind: "outbox-column",
      name,
      table_name: "memory_vector_cleanup_outbox",
      column_type: type,
      column_not_null: notNull,
      column_default: defaultValue,
      column_primary_key: primaryKey,
    })),
    {
      kind: "outbox-table",
      name: "memory_vector_cleanup_outbox",
      table_name: "memory_vector_cleanup_outbox",
      table_sql: tableSql,
      custom_index_count: 1,
    },
    ...["next_attempt_at", "created_at", "vector_id"].map((columnName, index) => ({
      kind: "index",
      name: "memory_vector_cleanup_outbox_due_idx",
      table_name: "memory_vector_cleanup_outbox",
      index_sql: indexSql,
      index_unique: 0,
      index_origin: "c",
      index_partial: 0,
      index_seqno: index,
      index_column: columnName,
    })),
  ];
}

function rateLimitIndexRow() {
  return indexRow({
    name: "rate_limit_windows_reset_at_idx",
    tableName: "rate_limit_windows",
    columnName: "reset_at",
    sql: "CREATE INDEX rate_limit_windows_reset_at_idx ON rate_limit_windows (reset_at)",
    unique: 0,
    partial: 0,
  });
}

function aiRunsIndexRow() {
  return indexRow({
    name: "ai_runs_created_idx",
    tableName: "ai_runs",
    columnName: "created_at",
    sql: "CREATE INDEX ai_runs_created_idx ON ai_runs (created_at)",
    unique: 0,
    partial: 0,
  });
}

function opsEventsIndexRow() {
  return indexRow({
    name: "ops_events_user_id_idx",
    tableName: "ops_events",
    columnName: "user_id",
    sql: "CREATE INDEX ops_events_user_id_idx ON ops_events (user_id)",
    unique: 0,
    partial: 0,
  });
}

function activityIndexRow(input: { name: string; column: string }) {
  return indexRow({
    name: input.name,
    tableName: "activity_runs",
    columnName: input.column,
    sql: `CREATE UNIQUE INDEX ${input.name} ON activity_runs (${input.column}) WHERE ${input.column} IS NOT NULL`,
    unique: 1,
    partial: 1,
  });
}

function indexRow(input: {
  name: string;
  tableName: string;
  columnName: string;
  sql: string;
  unique: 0 | 1;
  partial: 0 | 1;
}): Record<string, unknown> {
  return {
    kind: "index",
    name: input.name,
    table_name: input.tableName,
    index_sql: input.sql,
    index_unique: input.unique,
    index_origin: "c",
    index_partial: input.partial,
    index_seqno: 0,
    index_column: input.columnName,
  };
}

function columnRow(name: string): Record<string, unknown> {
  return {
    kind: "activity-column",
    name,
    table_name: "activity_runs",
    column_type: "TEXT",
    column_not_null: 0,
    column_default: null,
    column_primary_key: 0,
  };
}

function adminSnapshotRow(): Record<string, unknown> {
  return {
    kind: "admin-snapshot",
    name: "native-admin-totals-v1",
    table_name: "app_metadata",
    snapshot_json_valid: 1,
    snapshot_users_type: "integer",
    snapshot_users: 10,
    snapshot_chats_type: "integer",
    snapshot_chats: 5,
    snapshot_messages_type: "integer",
    snapshot_messages: 20,
    snapshot_ai_runs_type: "integer",
    snapshot_ai_runs: 2,
    snapshot_updated_at: clockValue.getTime(),
  };
}

function verificationOutput(rows: Array<Record<string, unknown>>) {
  return JSON.stringify([
    {
      success: true,
      results: rows,
      meta: { rows_read: 31, rows_written: 0 },
    },
  ]);
}

function requiredArg(args: string[], name: string) {
  const index = args.indexOf(name);
  assert.ok(index >= 0);
  const value = args[index + 1];
  assert.ok(value);
  return value;
}

function readJson(file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(isRecord(value));
  return value;
}

function requiredRecordValue(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
