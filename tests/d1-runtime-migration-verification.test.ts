import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
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

test("read-only verifier proves exact 0013-0016 schema and snapshot state", () => {
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
  assert.equal(report.rowsRead, 33);
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
    /pragma_table_info\('memory_vector_cleanup_outbox'\)/,
  );
  assert.match(
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    /pragma_table_info\('user_memory_settings'\)/,
  );
  assert.match(
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    /pragma_index_list\('memory_vector_cleanup_outbox'\)/,
  );
  assert.match(
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    /pragma_index_info\('memory_vector_cleanup_outbox_due_idx'\)/,
  );
  assert.match(
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    /pragma_index_info\('activity_runs_completion_token_uidx'\)/,
  );
  assert.match(
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    /pragma_index_info\('activity_runs_completion_message_id_uidx'\)/,
  );
  assert.match(RUNTIME_MIGRATION_VERIFICATION_SQL, /native-admin-totals-v1/);
  assert.match(
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    new RegExp(RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY),
  );
  assert.doesNotMatch(
    RUNTIME_MIGRATION_VERIFICATION_SQL,
    /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH)\b/i,
  );
  assert.doesNotMatch(RUNTIME_MIGRATION_VERIFICATION_SQL, /\bUNION\b/i);

  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/verify-d1-runtime-migrations.ts"),
    "utf8",
  );
  assert.match(source, /--confirm-production/);
  assert.doesNotMatch(source, /d1["',\s]+export|\bd1 export\b/i);
});

test("0016 exact schema checks stay aligned with the tracked migration SQL", () => {
  const migration = fs.readFileSync(
    path.resolve("drizzle-d1/0016_memory_vector_cleanup_outbox.sql"),
    "utf8",
  );
  const statements = migration.split("--> statement-breakpoint");
  assert.equal(statements.length, 5);
  const settingsAlterSql = statements[0]?.trim();
  const tableSql = statements[1]?.trim().replace(
    "CREATE TABLE IF NOT EXISTS",
    "CREATE TABLE",
  );
  const indexSql = statements[2]?.trim().replace(
    "CREATE INDEX IF NOT EXISTS",
    "CREATE INDEX",
  );
  const backfillSql = statements[3]?.trim();
  const completionMarkerSql = statements[4]?.trim();
  assert.match(settingsAlterSql ?? "", /ADD COLUMN `summary_suppression_mask` integer DEFAULT 0 NOT NULL/);
  assert.match(
    settingsAlterSql ?? "",
    /CONSTRAINT `user_memory_settings_summary_suppression_mask_check`/,
  );
  assert.match(settingsAlterSql ?? "", /BETWEEN 0 AND 511/);
  assert.ok(tableSql);
  assert.ok(indexSql);
  assert.match(backfillSql ?? "", /INSERT INTO `user_memory_settings`/);
  assert.match(backfillSql ?? "", /ON CONFLICT\(`user_id`\) DO UPDATE/);
  assert.match(
    completionMarkerSql ?? "",
    new RegExp(RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY),
  );
  assert.match(
    completionMarkerSql ?? "",
    new RegExp(RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE),
  );
  const rows = validVerificationRows();
  requiredRow(rows, "memory_vector_cleanup_outbox").table_sql = tableSql;
  for (const row of rows.filter(
    (candidate) => candidate.name === "memory_vector_cleanup_outbox_due_idx",
  )) {
    row.index_sql = indexSql;
  }

  const checks = evaluateRuntimeMigrationVerificationRows(rows);
  assert.equal(
    checks.find((check) => check.id === "0016-memory-summary-suppression-mask-column")?.ok,
    true,
  );
  assert.equal(
    checks.find((check) => check.id === "0016-memory-vector-cleanup-outbox-columns")?.ok,
    true,
  );
  assert.equal(
    checks.find((check) => check.id === "0016-memory-vector-cleanup-outbox-checks")?.ok,
    true,
  );
  assert.equal(
    checks.find((check) => check.id === "0016-memory-vector-cleanup-outbox-due-index")?.ok,
    true,
  );
  assert.equal(
    checks.find((check) => check.id === "0016-completion-marker")?.ok,
    true,
  );
});

test("0016 backfills bounded feedback-only suppression masks without scanning summary JSON", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      create table users (
        id text primary key not null,
        created_at integer not null,
        updated_at integer not null
      );
      create table user_memory_settings (
        user_id text primary key not null,
        enabled integer default 1 not null,
        saved_memory_enabled integer default 1 not null,
        chat_history_enabled integer default 1 not null,
        dreaming_enabled integer default 1 not null,
        capture_scope text default 'broad' not null,
        retrieval_mode text default 'need_based' not null,
        notice_seen_at integer,
        created_at integer not null,
        updated_at integer not null
      );
      create table memory_source_feedback (
        id text primary key not null,
        user_id text not null,
        summary_section_id text,
        action text not null,
        created_at integer not null
      );
      create table user_memory_summaries (
        user_id text primary key not null,
        sections text not null
      );
      create table app_metadata (
        key text primary key not null,
        value text not null,
        updated_at integer not null
      );
      insert into users (id, created_at, updated_at) values
        ('feedback-user', 100, 200),
        ('feedback-no-settings', 100, 200),
        ('arbitrary-user', 100, 200),
        ('primitive-user', 100, 200),
        ('malformed-user', 100, 200);
      insert into user_memory_settings (user_id, created_at, updated_at) values
        ('feedback-user', 100, 200),
        ('primitive-user', 100, 200),
        ('malformed-user', 100, 200);
      insert into memory_source_feedback (
        id, user_id, summary_section_id, action, created_at
      ) values
        (
          'feedback-row', 'feedback-user', 'native-memory-preferences',
          'dont_mention', 150
        ),
        (
          'feedback-row-no-settings', 'feedback-no-settings', 'goals',
          'not_relevant', 150
        );
      insert into user_memory_summaries (user_id, sections) values
        (
          'arbitrary-user',
          '[{"id":"legacy-arbitrary","title":"Goals","category":"goals","summary":"Hidden","doNotMention":true}]'
        ),
        ('primitive-user', '["legacy-primitive"]'),
        ('malformed-user', 'not-json');
    `);
    const migration = fs.readFileSync(
      path.resolve("drizzle-d1/0016_memory_vector_cleanup_outbox.sql"),
      "utf8",
    );
    assert.doesNotMatch(migration, /json_each|FROM `user_memory_summaries`/);
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));

    const rows = database.prepare(
      `select user_id as userId, summary_suppression_mask as mask,
              enabled, capture_scope as captureScope
       from user_memory_settings order by user_id`,
    ).all().map(parseSummarySettingsRow);
    assert.deepEqual(rows.map((row) => ({ ...row })), [
      { userId: "feedback-no-settings", mask: 16, enabled: 1, captureScope: "broad" },
      { userId: "feedback-user", mask: 2, enabled: 1, captureScope: "broad" },
      { userId: "malformed-user", mask: 0, enabled: 1, captureScope: "broad" },
      { userId: "primitive-user", mask: 0, enabled: 1, captureScope: "broad" },
    ]);
    assert.throws(
      () => database.exec("update user_memory_settings set summary_suppression_mask = 512"),
      /constraint/i,
    );
    const marker: unknown = database.prepare(
      `select key, value, updated_at as updatedAt
       from app_metadata where key = ?`,
    ).get(RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY);
    assert.ok(isRecord(marker));
    assert.equal(marker.key, RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY);
    assert.equal(marker.value, RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE);
    assert.equal(typeof marker.updatedAt, "number");
    assert.ok(Number(marker.updatedAt) > 0);
  } finally {
    database.close();
  }
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
    (rows) => {
      rows.splice(rows.findIndex((row) => row.name === "summary_suppression_mask"), 1);
    },
    (rows) => {
      const settings = requiredRow(rows, "summary_suppression_mask");
      settings.table_sql = String(settings.table_sql).replace(
        "BETWEEN 0 AND 511",
        "BETWEEN 0 AND 512",
      );
    },
    (rows) => {
      rows.splice(
        rows.findIndex(
          (row) => row.name === RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
        ),
        1,
      );
    },
    (rows) => {
      requiredRow(rows, RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY).table_sql =
        "wrong-marker-value";
    },
    (rows) => {
      rows.splice(rows.findIndex((row) => row.name === "source_row_revision"), 1);
    },
    (rows) => {
      const table = requiredRow(rows, "memory_vector_cleanup_outbox");
      table.table_sql = String(table.table_sql).replace(
        "'verifying_absence'",
        "'verified_absence'",
      );
    },
    (rows) => {
      const table = requiredRow(rows, "memory_vector_cleanup_outbox");
      table.custom_index_count = 2;
    },
    (rows) => {
      const dueColumn = rows.find(
        (row) => row.name === "memory_vector_cleanup_outbox_due_idx" && row.index_seqno === 1,
      );
      assert.ok(dueColumn);
      dueColumn.index_column = "updated_at";
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

test("verifier rejects writes, missing/retried attempt metadata, and source changes", () => {
  assert.throws(
    () =>
      loadRuntimeMigrationVerificationRows(() =>
        JSON.stringify([
          {
            results: validVerificationRows(),
            meta: { rows_read: 33, rows_written: 1, total_attempts: 1 },
          },
        ]),
      ),
    /unexpectedly wrote rows/,
  );
  for (const totalAttempts of [undefined, "1", 0, 2, 3]) {
    assert.throws(
      () =>
        loadRuntimeMigrationVerificationRows(() =>
          JSON.stringify([
            {
              results: validVerificationRows(),
              meta: {
                rows_read: 33,
                rows_written: 0,
                ...(totalAttempts === undefined
                  ? {}
                  : { total_attempts: totalAttempts }),
              },
            },
          ]),
        ),
      totalAttempts === 0 || totalAttempts === 2 || totalAttempts === 3
        ? /exactly one automatic attempt/
        : /verification total attempts/,
    );
  }

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
    "tsx scripts/cloudflare/run-trust-bound-production-command.ts cf:verify:d1-runtime-migrations",
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
    {
      kind: "migration-marker",
      name: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
      table_name: "app_metadata",
      table_sql: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
      snapshot_updated_at: 1_752_000_000_000,
    },
    ...outboxRows(),
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
      meta: { rows_read: 33, rows_written: 0, total_attempts: 1 },
    },
  ]);
}

function requiredRow(rows: Array<Record<string, unknown>>, name: string) {
  const row = rows.find((candidate) => candidate.name === name);
  assert.ok(row);
  return row;
}

function parseSummarySettingsRow(value: unknown, index: number) {
  if (
    !isRecord(value) ||
    typeof value.userId !== "string" ||
    typeof value.mask !== "number" ||
    typeof value.enabled !== "number" ||
    typeof value.captureScope !== "string"
  ) {
    throw new Error(`Invalid summary settings row at index ${index}.`);
  }
  return {
    userId: value.userId,
    mask: value.mask,
    enabled: value.enabled,
    captureScope: value.captureScope,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
