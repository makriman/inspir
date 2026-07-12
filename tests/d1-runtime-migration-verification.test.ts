import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RUNTIME_MIGRATION_EVIDENCE_KIND,
  RUNTIME_MIGRATION_FILES,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
  RUNTIME_MIGRATION_VERIFICATION_SQL,
  evaluateRuntimeMigrationVerificationRows,
  loadRuntimeMigrationVerificationRows,
  verifyD1RuntimeMigrations,
  writeRuntimeMigrationVerificationReport,
} from "../scripts/cloudflare/verify-d1-runtime-migrations";
import { D1_DATABASE_NAME } from "../scripts/cloudflare/migration-config";

test("read-only verifier proves exact 0013-0015 schema and snapshot state", () => {
  const { backupDir, repoDir } = makeFixture();
  const calls: string[][] = [];
  const report = verifyD1RuntimeMigrations({
    backupDir,
    cwd: repoDir,
    nowMs: Date.parse("2026-07-11T20:00:00.000Z"),
    runner: (args) => {
      calls.push(args);
      return wranglerResult(validVerificationRows());
    },
  });

  assert.equal(report.kind, RUNTIME_MIGRATION_EVIDENCE_KIND);
  assert.equal(report.database, D1_DATABASE_NAME);
  assert.deepEqual(report.migrations, [...RUNTIME_MIGRATION_FILES]);
  assert.equal(report.ok, true);
  assert.equal(report.sourceFingerprintStable, true);
  assert.equal(report.rowsRead, 31);
  assert.equal(report.rowsWritten, 0);
  assert.deepEqual(
    report.checks.map((check) => check.id),
    [...RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS],
  );
  assert.ok(report.checks.every((check) => check.ok));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.slice(0, 5), [
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
  ]);
  assert.equal(calls[0]?.at(-1), RUNTIME_MIGRATION_VERIFICATION_SQL);
});

test("verification SQL is bounded, read-only, and inspects exact columns and index metadata", () => {
  assert.match(RUNTIME_MIGRATION_VERIFICATION_SQL, /pragma_table_info\('activity_runs'\)/);
  assert.match(RUNTIME_MIGRATION_VERIFICATION_SQL, /pragma_index_list\('activity_runs'\)/);
  assert.match(RUNTIME_MIGRATION_VERIFICATION_SQL, /pragma_index_list\('ops_events'\)/);
  assert.match(
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    /pragma_index_info\('activity_runs_completion_token_uidx'\)/,
  );
  assert.match(
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    /pragma_index_info\('activity_runs_completion_message_id_uidx'\)/,
  );
  assert.match(RUNTIME_MIGRATION_VERIFICATION_SQL, /native-admin-totals-v1/);
  assert.doesNotMatch(
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH)\b/i,
  );

  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/verify-d1-runtime-migrations.ts"),
    "utf8",
  );
  assert.match(source, /--confirm-production/);
  assert.doesNotMatch(source, /d1["',\s]+export|\bd1 export\b/i);
});

test("verifier fails closed for missing columns, altered index definitions, and invalid snapshots", () => {
  const mutations: Array<(rows: Array<Record<string, unknown>>) => void> = [
    (rows) => {
      rows.splice(rows.findIndex((row) => row.name === "completion_token"), 1);
    },
    (rows) => {
      const index = requiredRow(rows, "activity_runs_completion_token_uidx");
      index.index_sql =
        "CREATE UNIQUE INDEX activity_runs_completion_token_uidx ON activity_runs (completion_token)";
    },
    (rows) => {
      const index = requiredRow(rows, "activity_runs_completion_message_id_uidx");
      index.index_unique = 0;
    },
    (rows) => {
      const extraColumn: Record<string, unknown> = {
        ...requiredRow(rows, "ai_runs_created_idx"),
        index_seqno: 1,
      };
      extraColumn.index_column = "id";
      rows.push(extraColumn);
    },
    (rows) => {
      const snapshot = requiredRow(rows, "native-admin-totals-v1");
      snapshot.snapshot_users_type = "text";
    },
    (rows) => {
      const snapshot = requiredRow(rows, "native-admin-totals-v1");
      snapshot.snapshot_updated_at = 0;
    },
  ];

  for (const mutate of mutations) {
    const rows = validVerificationRows();
    mutate(rows);
    const checks = evaluateRuntimeMigrationVerificationRows(rows);
    assert.equal(checks.length, RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length);
    assert.ok(checks.some((check) => !check.ok));
  }
});

test("verifier rejects write metadata and source changes during the query", () => {
  assert.throws(
    () =>
      loadRuntimeMigrationVerificationRows(() =>
        JSON.stringify([
          {
            results: validVerificationRows(),
            meta: { rows_read: 31, rows_written: 1 },
          },
        ]),
      ),
    /unexpectedly wrote rows/,
  );

  const { backupDir, repoDir } = makeFixture();
  const report = verifyD1RuntimeMigrations({
    backupDir,
    cwd: repoDir,
    runner: () => {
      fs.writeFileSync(path.join(repoDir, "source.ts"), "export const changed = true;\n");
      return wranglerResult(validVerificationRows());
    },
  });
  assert.equal(report.sourceFingerprintStable, false);
  assert.equal(report.ok, false);
});

test("verification evidence is atomically written with owner-only permissions", () => {
  const { backupDir, repoDir } = makeFixture();
  const report = verifyD1RuntimeMigrations({
    backupDir,
    cwd: repoDir,
    runner: () => wranglerResult(validVerificationRows()),
  });
  const outputPath = writeRuntimeMigrationVerificationReport(report);

  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  const stored = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    ok?: boolean;
    sourceFingerprint?: { sha256?: string; fileCount?: number };
  };
  assert.equal(stored.ok, true);
  assert.equal(stored.sourceFingerprint?.sha256, report.sourceFingerprint.sha256);
  assert.equal(stored.sourceFingerprint?.fileCount, report.sourceFingerprint.fileCount);
  assert.deepEqual(
    fs.readdirSync(path.dirname(outputPath)).filter((file) => file.endsWith(".tmp")),
    [],
  );
});

test("CLI requires explicit production confirmation and package wiring exposes the verifier", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/cloudflare/verify-d1-runtime-migrations.ts"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /requires --confirm-production/);

  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts?.["cf:verify:d1-runtime-migrations"],
    "tsx scripts/cloudflare/verify-d1-runtime-migrations.ts",
  );
});

function validVerificationRows(): Array<Record<string, unknown>> {
  return [
    columnRow("completion_token"),
    columnRow("completion_message_id"),
    indexRow({
      name: "rate_limit_windows_reset_at_idx",
      tableName: "rate_limit_windows",
      columnName: "reset_at",
      sql: "CREATE INDEX rate_limit_windows_reset_at_idx ON rate_limit_windows (reset_at)",
      unique: 0,
      partial: 0,
    }),
    indexRow({
      name: "ai_runs_created_idx",
      tableName: "ai_runs",
      columnName: "created_at",
      sql: "CREATE INDEX ai_runs_created_idx ON ai_runs (created_at)",
      unique: 0,
      partial: 0,
    }),
    indexRow({
      name: "ops_events_user_id_idx",
      tableName: "ops_events",
      columnName: "user_id",
      sql: "CREATE INDEX ops_events_user_id_idx ON ops_events (user_id)",
      unique: 0,
      partial: 0,
    }),
    indexRow({
      name: "activity_runs_completion_token_uidx",
      tableName: "activity_runs",
      columnName: "completion_token",
      sql: "CREATE UNIQUE INDEX activity_runs_completion_token_uidx ON activity_runs (completion_token) WHERE completion_token IS NOT NULL",
      unique: 1,
      partial: 1,
    }),
    indexRow({
      name: "activity_runs_completion_message_id_uidx",
      tableName: "activity_runs",
      columnName: "completion_message_id",
      sql: "CREATE UNIQUE INDEX activity_runs_completion_message_id_uidx ON activity_runs (completion_message_id) WHERE completion_message_id IS NOT NULL",
      unique: 1,
      partial: 1,
    }),
    {
      kind: "admin-snapshot",
      name: "native-admin-totals-v1",
      table_name: "app_metadata",
      snapshot_json_valid: 1,
      snapshot_users_type: "integer",
      snapshot_users: 40_467,
      snapshot_chats_type: "integer",
      snapshot_chats: 1_240,
      snapshot_messages_type: "integer",
      snapshot_messages: 4_550,
      snapshot_ai_runs_type: "integer",
      snapshot_ai_runs: 500,
      snapshot_updated_at: 1_752_000_000_000,
    },
  ];
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

function wranglerResult(rows: Array<Record<string, unknown>>) {
  return JSON.stringify([
    {
      results: rows,
      meta: { rows_read: 31, rows_written: 0 },
    },
  ]);
}

function requiredRow(rows: Array<Record<string, unknown>>, name: string) {
  const row = rows.find((candidate) => candidate.name === name);
  assert.ok(row);
  return row;
}

function makeFixture() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-runtime-verifier-repo-"));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-d1-runtime-verifier-backup-"));
  runGit(repoDir, ["init"]);
  fs.writeFileSync(path.join(repoDir, "source.ts"), "export const original = true;\n");
  return { backupDir, repoDir };
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
