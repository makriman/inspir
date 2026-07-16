import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HISTORICAL_FRESH_0016_POST_VERIFICATION_MAX_ROWS_READ,
  HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL,
  HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS,
  HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_KIND,
  HistoricalFresh0016RuntimeVerificationError,
  historicalFresh0016RuntimeVerificationReportSchema,
  verifyHistoricalDataFresh0016Migration,
  type HistoricalFresh0016RuntimeVerificationErrorCode,
  type VerifyHistoricalFresh0016MigrationOptions,
} from "../scripts/cloudflare/verify-historical-data-fresh-0016-migration";
import {
  canonicalHistoricalFresh0016DatabaseMarkerValue,
  createHistoricalFresh0016DatabaseMarker,
  historicalFresh0016RunDirectory,
  publishHistoricalFresh0016RenderedMigration,
  type HistoricalFresh0016MigrationBinding,
} from "../scripts/cloudflare/historical-data-fresh-0016-migration";
import {
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import { buildRepoSourceFingerprint } from "../scripts/cloudflare/source-fingerprint";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY,
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
  RUNTIME_MIGRATION_VERIFICATION_SQL,
} from "../scripts/cloudflare/verify-d1-runtime-migrations";

const runId = "123e4567-e89b-42d3-a456-426614174000";
const activeWorkerVersion = "223e4567-e89b-42d3-a456-426614174000";
const fixedUpdatedAt = 1_752_000_000_000;
const freshUpdatedAt = fixedUpdatedAt + 1;
const forbiddenRawValue = "private-user-id-that-must-never-be-in-runtime-evidence";

test("fresh-0016 verifier returns one immutable privacy-safe v2 report after both exact read-only proofs", () => {
  const fixture = createFixture();
  const calls: string[][] = [];
  try {
    const runner = successfulRunner(fixture, calls);
    const report = verifyHistoricalDataFresh0016Migration({
      ...fixture.options,
      runner,
      now: new Date("2026-07-14T00:10:00.000Z"),
    });

    assert.equal(report.kind, HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_KIND);
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.ok, true);
    assert.deepEqual(report.binding, fixture.binding);
    assert.equal(
      report.evidence.predecessorCompleteSha256,
      fixture.binding.predecessorCompleteSha256,
    );
    assert.equal(
      report.evidence.preWriteEvidenceSha256,
      fixture.options.preWriteEvidenceSha256,
    );
    assert.equal(
      report.evidence.migrationAuthorizationSha256,
      fixture.options.migrationAuthorizationSha256,
    );
    assert.equal(
      report.evidence.renderedMigrationSha256,
      fixture.options.renderedMigrationSha256,
    );
    assert.equal(
      report.evidence.productionExclusionOwnerSha256,
      fixture.options.productionExclusionOwnerSha256,
    );
    assert.equal(report.activeWorkerVersion, activeWorkerVersion);
    assert.equal(report.staticVerification.totalAttempts, 1);
    assert.equal(report.staticVerification.rowsWritten, 0);
    assert.equal(report.post0016Verification.totalAttempts, 1);
    assert.equal(report.post0016Verification.rowsWritten, 0);
    assert.equal(report.post0016Verification.cleanupOutboxRowCount, 0);
    assert.equal(
      report.post0016Verification.freshMarker.updatedAt,
      freshUpdatedAt,
    );
    assert.equal(
      report.post0016Verification.fixedMarker.updatedAt,
      fixedUpdatedAt,
    );
    assert.equal(report.totalRowsRead, 38);
    assert.equal(report.totalRowsWritten, 0);
    assert.deepEqual(
      report.checks.map((check) => check.id),
      [...HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS],
    );
    assert.ok(report.checks.every((check) => check.ok));
    assert.equal(
      historicalFresh0016RuntimeVerificationReportSchema.safeParse(report)
        .success,
      true,
    );
    assert.equal(Object.isFrozen(report), true);
    assert.equal(Object.isFrozen(report.binding), true);
    assert.equal(Object.isFrozen(report.checks), true);
    assert.equal(Object.isFrozen(report.checks[0]), true);
    assert.equal(
      Reflect.set(
        report.evidence,
        "migrationAuthorizationSha256",
        "0".repeat(64),
      ),
      false,
    );

    const persistedShape = JSON.stringify(report);
    assert.equal(persistedShape.includes(forbiddenRawValue), false);
    assert.equal(persistedShape.includes(fixture.freshMarkerValue), false);
    assert.equal(Object.hasOwn(report.post0016Verification.freshMarker, "value"), false);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.at(-1), RUNTIME_MIGRATION_VERIFICATION_SQL);
    assert.equal(calls[1]?.at(-1), HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL);
  } finally {
    fixture.cleanup();
  }
});

test("post-0016 SQL is one bounded read-only marker and outbox-emptiness proof", () => {
  assert.match(HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL, /^WITH fixed_marker AS/);
  assert.match(
    HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL,
    new RegExp(RUNTIME_MIGRATION_0016_COMPLETION_MARKER_KEY),
  );
  assert.match(
    HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL,
    new RegExp(
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
        .freshCutoverMarkerKey,
    ),
  );
  assert.match(
    HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL,
    /EXISTS \(\s*SELECT 1\s*FROM memory_vector_cleanup_outbox\s*LIMIT 1\s*\)/,
  );
  assert.equal(
    (HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL.match(/;/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(
    HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL,
    /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA|BEGIN|COMMIT|ROLLBACK)\b/i,
  );
});

test("binding, source, rendered artifact, and release hashes fail before any D1 query", () => {
  const fixture = createFixture();
  try {
    const noRunnerCalls = () => {
      throw new Error("runner must not be called");
    };
    assertVerificationError(
      () =>
        verifyHistoricalDataFresh0016Migration({
          ...fixture.options,
          predecessorCompleteSha256: "9".repeat(64),
          runner: noRunnerCalls,
        }),
      "INPUT_INVALID",
    );
    assertVerificationError(
      () =>
        verifyHistoricalDataFresh0016Migration({
          ...fixture.options,
          sourceFingerprint: {
            ...fixture.options.sourceFingerprint,
            sha256: "8".repeat(64),
          },
          runner: noRunnerCalls,
        }),
      "SOURCE_CHANGED",
    );
    assertVerificationError(
      () =>
        verifyHistoricalDataFresh0016Migration({
          ...fixture.options,
          renderedMigrationSha256: "7".repeat(64),
          runner: noRunnerCalls,
        }),
      "ARTIFACT_INVALID",
    );
    assertVerificationError(
      () =>
        verifyHistoricalDataFresh0016Migration({
          ...fixture.options,
          activeWorkerVersion: "not-a-worker-version",
          runner: noRunnerCalls,
        }),
      "INPUT_INVALID",
    );
    const wrongRunDirectory = path.join(path.dirname(fixture.runDirectory), runId.replace(/^1/, "3"));
    fs.mkdirSync(wrongRunDirectory, { mode: 0o700 });
    assertVerificationError(
      () =>
        verifyHistoricalDataFresh0016Migration({
          ...fixture.options,
          runDirectory: wrongRunDirectory,
          runner: noRunnerCalls,
        }),
      "ARTIFACT_INVALID",
    );
  } finally {
    fixture.cleanup();
  }
});

test("static verification requires explicit success, zero writes, one attempt, and every exact check", async (t) => {
  const mutations: Array<{
    name: string;
    result: () => Record<string, unknown>;
  }> = [
    {
      name: "missing success",
      result: () => staticResult({ success: undefined }),
    },
    {
      name: "false success",
      result: () => staticResult({ success: false }),
    },
    {
      name: "write metadata",
      result: () => staticResult({ rowsWritten: 1 }),
    },
    {
      name: "retried query",
      result: () => staticResult({ totalAttempts: 2 }),
    },
    {
      name: "failed exact schema check",
      result: () => {
        const rows = validStaticRows();
        rows.splice(
          rows.findIndex((row) => row.name === "completion_token"),
          1,
        );
        return staticResult({ rows });
      },
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const fixture = createFixture();
      let calls = 0;
      try {
        assertVerificationError(
          () =>
            verifyHistoricalDataFresh0016Migration({
              ...fixture.options,
              runner: () => {
                calls += 1;
                return JSON.stringify([mutation.result()]);
              },
            }),
          "STATIC_VERIFICATION_FAILED",
        );
        assert.equal(calls, 1);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("fresh marker proof rejects malformed, retried, wrong, stale, and nonempty results", async (t) => {
  const mutations: Array<{
    name: string;
    mutate: (fixture: Fixture, result: Record<string, unknown>) => void;
  }> = [
    {
      name: "missing success",
      mutate: (_fixture, result) => {
        Reflect.deleteProperty(result, "success");
      },
    },
    {
      name: "false success",
      mutate: (_fixture, result) => {
        result.success = false;
      },
    },
    {
      name: "write metadata",
      mutate: (_fixture, result) => {
        requiredMeta(result).rows_written = 1;
      },
    },
    {
      name: "retried query",
      mutate: (_fixture, result) => {
        requiredMeta(result).total_attempts = 2;
      },
    },
    {
      name: "string attempt metadata",
      mutate: (_fixture, result) => {
        requiredMeta(result).total_attempts = "1";
      },
    },
    {
      name: "read bound exceeded",
      mutate: (_fixture, result) => {
        requiredMeta(result).rows_read =
          HISTORICAL_FRESH_0016_POST_VERIFICATION_MAX_ROWS_READ + 1;
      },
    },
    {
      name: "missing marker row",
      mutate: (_fixture, result) => {
        result.results = [];
      },
    },
    {
      name: "extra row field",
      mutate: (_fixture, result) => {
        requiredFreshRow(result).raw_user_id = forbiddenRawValue;
      },
    },
    {
      name: "wrong fixed marker",
      mutate: (_fixture, result) => {
        requiredFreshRow(result).fixed_value = "wrong";
      },
    },
    {
      name: "zero fixed timestamp",
      mutate: (_fixture, result) => {
        requiredFreshRow(result).fixed_updated_at = 0;
      },
    },
    {
      name: "fresh marker predates fixed marker",
      mutate: (_fixture, result) => {
        requiredFreshRow(result).fresh_updated_at = fixedUpdatedAt - 1;
      },
    },
    {
      name: "noncanonical fresh marker",
      mutate: (fixture, result) => {
        requiredFreshRow(result).fresh_value = `${JSON.stringify(
          JSON.parse(fixture.freshMarkerValue) as unknown,
          null,
          2,
        )}\n`;
      },
    },
    {
      name: "different binding marker",
      mutate: (fixture, result) => {
        const differentMarker = createHistoricalFresh0016DatabaseMarker({
          ...fixture.binding,
          cutoverManifestSha256: "6".repeat(64),
        });
        requiredFreshRow(result).fresh_value =
          canonicalHistoricalFresh0016DatabaseMarkerValue(differentMarker);
      },
    },
    {
      name: "nonempty outbox",
      mutate: (_fixture, result) => {
        requiredFreshRow(result).outbox_has_rows = 1;
      },
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const fixture = createFixture();
      let calls = 0;
      try {
        const result = freshResult(fixture);
        mutation.mutate(fixture, result);
        assertVerificationError(
          () =>
            verifyHistoricalDataFresh0016Migration({
              ...fixture.options,
              runner: (args) => {
                calls += 1;
                return args.at(-1) === RUNTIME_MIGRATION_VERIFICATION_SQL
                  ? JSON.stringify([staticResult({})])
                  : JSON.stringify([result]);
              },
            }),
          "POST_VERIFICATION_FAILED",
        );
        assert.equal(calls, 2);
      } finally {
        fixture.cleanup();
      }
    });
  }
});

test("source mutation during the post-0016 read cannot yield a report", () => {
  const fixture = createFixture();
  try {
    assertVerificationError(
      () =>
        verifyHistoricalDataFresh0016Migration({
          ...fixture.options,
          runner: (args) => {
            if (args.at(-1) === RUNTIME_MIGRATION_VERIFICATION_SQL) {
              return JSON.stringify([staticResult({})]);
            }
            fs.writeFileSync(
              path.join(fixture.repoDir, "source.ts"),
              "export const sourceChangedDuringFreshVerification = true;\n",
            );
            return JSON.stringify([freshResult(fixture)]);
          },
        }),
      "SOURCE_CHANGED",
    );
  } finally {
    fixture.cleanup();
  }
});

type Fixture = ReturnType<typeof createFixture>;

function createFixture() {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "inspir-fresh-0016-runtime-")),
  );
  const repoDir = path.join(root, "repo");
  const backupDir = path.join(root, "backup");
  fs.mkdirSync(repoDir, { mode: 0o700 });
  fs.mkdirSync(backupDir, { mode: 0o700 });
  runGit(repoDir, ["init"]);
  fs.writeFileSync(
    path.join(repoDir, "source.ts"),
    "export const source = true;\n",
  );
  const migrationPath = path.join(
    repoDir,
    HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
  );
  fs.mkdirSync(path.dirname(migrationPath), { recursive: true });
  fs.copyFileSync(
    path.resolve(
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016.trackedFile,
    ),
    migrationPath,
  );
  const source = buildRepoSourceFingerprint(repoDir);
  const sourceFingerprint = {
    sha256: source.sha256,
    fileCount: source.fileCount,
  };
  const binding: HistoricalFresh0016MigrationBinding = {
    cutoverRunId: runId,
    cutoverManifestSha256: "a".repeat(64),
    migrationBudgetPreparedArtifactFileSha256: "9".repeat(64),
    predecessorReportSha256: "b".repeat(64),
    predecessorCompleteSha256: "c".repeat(64),
    predecessorEvidenceChainSha256: "d".repeat(64),
    predecessorHmacKeyId: "e".repeat(64),
    successorSnapshotPlanSha256:
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor.snapshotPlanSha256,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    sourceFingerprint,
    database: { ...HISTORICAL_FRESH_0016_CUTOVER_POLICY.database },
  };
  const runDirectory = historicalFresh0016RunDirectory({
    backupDir,
    cutoverRunId: runId,
  });
  fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(runDirectory, 0o700);
  const rendered = publishHistoricalFresh0016RenderedMigration({
    cwd: repoDir,
    backupDir,
    runDirectory,
    binding,
  });
  const freshMarkerValue =
    canonicalHistoricalFresh0016DatabaseMarkerValue(
      createHistoricalFresh0016DatabaseMarker(binding),
    );
  const options: Omit<VerifyHistoricalFresh0016MigrationOptions, "runner"> = {
    binding,
    predecessorCompleteSha256: binding.predecessorCompleteSha256,
    preWriteEvidenceSha256: "f".repeat(64),
    migrationAuthorizationSha256: "1".repeat(64),
    renderedMigrationSha256: rendered.evidence.renderedMigration.sha256,
    productionExclusionOwnerSha256: "2".repeat(64),
    activeWorkerVersion,
    sourceFingerprint,
    cwd: repoDir,
    backupDir,
    runDirectory,
  };
  return {
    root,
    repoDir,
    backupDir,
    runDirectory,
    binding,
    options,
    freshMarkerValue,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function successfulRunner(fixture: Fixture, calls: string[][]) {
  return (args: string[]) => {
    calls.push(args);
    if (args.at(-1) === RUNTIME_MIGRATION_VERIFICATION_SQL) {
      return JSON.stringify([staticResult({})]);
    }
    if (args.at(-1) === HISTORICAL_FRESH_0016_POST_VERIFICATION_SQL) {
      return JSON.stringify([freshResult(fixture)]);
    }
    throw new Error(`Unexpected Wrangler call: ${args.join(" ")}`);
  };
}

function staticResult(input: {
  success?: boolean;
  rows?: Array<Record<string, unknown>>;
  rowsWritten?: number;
  totalAttempts?: number;
}) {
  return {
    ...(input.success === undefined && Object.hasOwn(input, "success")
      ? {}
      : { success: input.success ?? true }),
    results: input.rows ?? validStaticRows(),
    meta: {
      rows_read: 33,
      rows_written: input.rowsWritten ?? 0,
      total_attempts: input.totalAttempts ?? 1,
    },
  };
}

function freshResult(fixture: Fixture): Record<string, unknown> {
  return {
    success: true,
    results: [
      {
        fixed_value: RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
        fixed_updated_at: fixedUpdatedAt,
        fresh_value: fixture.freshMarkerValue,
        fresh_updated_at: freshUpdatedAt,
        outbox_has_rows: 0,
      },
    ],
    meta: { rows_read: 5, rows_written: 0, total_attempts: 1 },
  };
}

function validStaticRows(): Array<Record<string, unknown>> {
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
      snapshot_updated_at: fixedUpdatedAt,
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
      snapshot_updated_at: fixedUpdatedAt,
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
    ...["next_attempt_at", "created_at", "vector_id"].map(
      (columnName, index) => ({
        kind: "index",
        name: "memory_vector_cleanup_outbox_due_idx",
        table_name: "memory_vector_cleanup_outbox",
        index_sql: indexSql,
        index_unique: 0,
        index_origin: "c",
        index_partial: 0,
        index_seqno: index,
        index_column: columnName,
      }),
    ),
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

function requiredMeta(result: Record<string, unknown>) {
  assert.ok(isRecord(result.meta));
  return result.meta;
}

function requiredFreshRow(result: Record<string, unknown>) {
  assert.ok(Array.isArray(result.results));
  assert.ok(isRecord(result.results[0]));
  return result.results[0];
}

function assertVerificationError(
  action: () => unknown,
  code: HistoricalFresh0016RuntimeVerificationErrorCode,
) {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof HistoricalFresh0016RuntimeVerificationError);
    assert.equal(error.code, code);
    return true;
  });
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

assert.equal(
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length + 6,
  HISTORICAL_FRESH_0016_RUNTIME_VERIFICATION_CHECK_IDS.length,
);
