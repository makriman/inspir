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
import { RUNTIME_MIGRATION_FILES } from "../scripts/cloudflare/verify-d1-runtime-migrations";

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
};
const usage = {
  databaseCount: 1,
  queryGroups: 0,
  rowsRead: 0,
  rowsWritten: 0,
  executions: 0,
  windowMinutes: 721,
};

test("migration wrapper durably captures diagnostic evidence before applying 0013-0015 in order", () => {
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
      ["0013", "0014", "0015"],
    );
    assert.ok(outcome.attempts.every((attempt) => attempt.responseConfirmed));
    assert.equal(outcome.stateAfter?.nextMigration, null);
    assert.ok(outcome.preWriteEvidencePath);
    const evidence = readJson(outcome.preWriteEvidencePath);
    assert.equal(evidence.kind, "d1-runtime-migrations-0013-0015-prewrite");
    assert.deepEqual(evidence.database, { id: D1_DATABASE_ID, name: D1_DATABASE_NAME });
    assert.equal(evidence.timeTravelBookmark, bookmark);
    assert.ok(Array.isArray(evidence.migrationFiles));
    assert.equal(evidence.migrationFiles.length, 3);
    const projection = requiredRecordValue(evidence.projection);
    assert.equal(
      projection.rowsRead,
      fixture.report.projection.rowsRead,
    );
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
  return rows;
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
