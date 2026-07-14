import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  HISTORICAL_DATA_CONTINUITY_POLICY,
} from "../scripts/cloudflare/historical-data-continuity-policy";
import {
  evaluateHistoricalDataContinuity,
  readRecoveredHistoricalHmacSecretFromFile,
} from "../scripts/cloudflare/verify-historical-data-continuity";
import {
  HISTORICAL_BILLED_READ_LIMIT,
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  HISTORICAL_DATA_LEGACY_BILLED_READ_LIMIT,
  HISTORICAL_DATA_LEGACY_PRESERVATION_KIND,
  HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
  HISTORICAL_DATA_PRESERVATION_KIND,
  HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
  HISTORICAL_DATASET_NAMES,
  historicalDataBudgetOperationId,
  historicalDataHmacKeyId,
  type HistoricalDataBaselineReport,
  type HistoricalDataLegacyBaselineReport,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import type { SourceFingerprint } from "../scripts/cloudflare/source-fingerprint";

const retainedSecret = "historical-continuity-retained-secret-32-bytes";
const predecessorTime = "2026-07-13T01:10:08.863Z";
const successorTime = "2026-07-14T00:10:08.863Z";

test("recovered HMAC input rejects extended ACLs despite mode 0600", {
  skip: process.platform !== "darwin",
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-recovered-hmac-acl-"));
  const file = path.join(root, "recovered-key");
  const secret = "ab".repeat(32);
  fs.writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  try {
    assert.equal(readRecoveredHistoricalHmacSecretFromFile(file), secret);
    const acl = spawnSync(
      "/bin/chmod",
      ["+a", "everyone allow read", file],
      { encoding: "utf8", timeout: 5_000 },
    );
    assert.equal(acl.status, 0);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(
      () => readRecoveredHistoricalHmacSecretFromFile(file),
      /without ACLs/,
    );
  } finally {
    spawnSync("/bin/chmod", ["-N", file], { timeout: 5_000 });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rollover continuity preserves counts, columns, and HMAC sentinels across source changes", () => {
  const predecessor = legacyBaseline("predecessor", predecessorTime, "2026-07-13", retainedSecret);
  const successor = baseline("successor", successorTime, "2026-07-14", retainedSecret);
  successor.datasets.users.rowCount += 1;
  successor.datasets.users.columns.push({
    name: "additive_column",
    type: "text",
    notNull: 0,
    primaryKey: 0,
  });

  const result = evaluateHistoricalDataContinuity({
    predecessor,
    successor,
    hmacSecret: retainedSecret,
    requiredSuccessorUtcDay: "2026-07-14",
    maximumGapMs: 24 * 60 * 60 * 1_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.sameHmacKey, true);
  assert.deepEqual(result.problems, []);
  assert.ok(HISTORICAL_DATASET_NAMES.every((name) =>
    result.datasets[name].countsPreserved &&
    result.datasets[name].columnsPreserved &&
    result.datasets[name].sentinelsPreserved
  ));
  assert.deepEqual(result.operationalDatasets.memory_vector_cleanup_outbox, {
    lifecycle: "mutable-drainable-outbox",
    predecessorEvidence: "not-captured-by-pinned-v1-baseline",
    successorRows: 0,
    successorSchemaPresent: true,
    successorEmptyBeforeFirstActivation: true,
    rowPreservationRequired: false,
  });
});

test("rollover continuity rejects count, schema, sentinel, HMAC, day, and time drift", () => {
  const scenarios: Array<{
    name: string;
    mutate: (
      predecessor: HistoricalDataLegacyBaselineReport,
      successor: HistoricalDataBaselineReport,
    ) => void;
    expected: RegExp;
  }> = [
    {
      name: "count loss",
      mutate: (_predecessor, successor) => {
        successor.datasets.chats.rowCount = 0;
      },
      expected: /chats row count decreased/,
    },
    {
      name: "schema loss",
      mutate: (_predecessor, successor) => {
        successor.datasets.messages.columns[0] = {
          name: "id",
          type: "integer",
          notNull: 1,
          primaryKey: 1,
        };
      },
      expected: /messages lost or changed a predecessor column/,
    },
    {
      name: "sentinel replacement",
      mutate: (_predecessor, successor) => {
        successor.datasets.user_memories.sentinels = ["f".repeat(64)];
      },
      expected: /user_memories lost a predecessor identity sentinel/,
    },
    {
      name: "wrong HMAC",
      mutate: (_predecessor, successor) => {
        successor.hmacKeyId = historicalDataHmacKeyId("different-continuity-secret-with-32-bytes");
      },
      expected: /retained HMAC key/,
    },
    {
      name: "wrong day",
      mutate: (_predecessor, successor) => {
        successor.utcDay = "2026-07-15";
      },
      expected: /required UTC day/,
    },
    {
      name: "overlong gap",
      mutate: (_predecessor, successor) => {
        successor.createdAt = "2026-07-14T01:10:08.864Z";
      },
      expected: /too long/,
    },
    {
      name: "incomplete first-release outbox schema",
      mutate: (_predecessor, successor) => {
        successor.operationalDatasets.memory_vector_cleanup_outbox.columns =
          successor.operationalDatasets.memory_vector_cleanup_outbox.columns.filter(
            (column) => column.name !== "write_token",
          );
      },
      expected: /schema is absent from the successor baseline/,
    },
    {
      name: "nonempty first-release outbox",
      mutate: (_predecessor, successor) => {
        successor.operationalDatasets.memory_vector_cleanup_outbox.rowCount = 1;
      },
      expected: /not empty before the first 0016 Worker activation/,
    },
  ];

  for (const scenario of scenarios) {
    const predecessor = legacyBaseline("predecessor", predecessorTime, "2026-07-13", retainedSecret);
    const successor = baseline("successor", successorTime, "2026-07-14", retainedSecret);
    scenario.mutate(predecessor, successor);
    const result = evaluateHistoricalDataContinuity({
      predecessor,
      successor,
      hmacSecret: retainedSecret,
      requiredSuccessorUtcDay: "2026-07-14",
      maximumGapMs: 24 * 60 * 60 * 1_000,
    });
    assert.equal(result.ok, false, scenario.name);
    assert.match(result.problems.join("\n"), scenario.expected, scenario.name);
  }
});

test("one-release incident policy encodes the exact fail-closed budget projection", () => {
  const incident = HISTORICAL_DATA_CONTINUITY_POLICY;
  assert.equal(incident.predecessor.gitCommit, "054ecb541cacec420f09e535ed4b5e79c46d1dfe");
  assert.equal(
    incident.budgetBlock.projectedRowsRead,
    incident.budgetBlock.observedRowsRead +
      incident.budgetBlock.existingReservedRowsRead +
      incident.budgetBlock.requestedVerificationRowsRead,
  );
  assert.ok(incident.budgetBlock.projectedRowsRead > incident.budgetBlock.safeRowsReadLimit);
  assert.equal(incident.budgetBlock.d1SnapshotQueryExecuted, false);
  assert.equal(incident.successor.requiredUtcDay, "2026-07-14");
  assert.equal(incident.successor.maximumGapMs, 24 * 60 * 60 * 1_000);
});

function baseline(
  sourceLabel: string,
  createdAt: string,
  utcDay: string,
  secret: string,
): HistoricalDataBaselineReport {
  const sourceFingerprint = source(sourceLabel);
  const operationId = historicalDataBudgetOperationId("baseline", sourceFingerprint);
  return {
    kind: HISTORICAL_DATA_PRESERVATION_KIND,
    schemaVersion: 2,
    phase: "baseline",
    createdAt,
    utcDay,
    operationId,
    backupDir: "/private/continuity-fixture",
    database: "inspirlearning-prod",
    ok: true,
    privacy: "hmac-sha256-no-raw-identifiers",
    hmacKeyId: historicalDataHmacKeyId(secret),
    sourceFingerprint,
    rowsRead: 20,
    rowsWritten: 0,
    usage: {
      databaseCount: 1,
      queryGroups: 1,
      rowsRead: 20,
      rowsWritten: 0,
      executions: 1,
      windowMinutes: 1,
    },
    ledger: {
      ledgerPath: `/private/continuity-fixture/cloudflare/d1-release-budget-ledger-${utcDay}.json`,
      utcDay,
      revision: 1,
      idempotent: false,
      reservation: {
        operationId,
        operation: "Historical production data baseline capture",
        candidateVersionId: null,
        phase: "exact",
        rowsRead: 20,
        rowsWritten: 0,
        maximumRowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
        maximumRowsWritten: 0,
        createdAt,
        updatedAt: createdAt,
      },
      totals: { rowsRead: 20, rowsWritten: 0 },
      accountedUsage: { rowsRead: 40, rowsWritten: 0 },
    },
    limits: {
      coreRows: 350_000,
      supplementalRows: 125_000,
      operationalRows: 10_000,
      logicalSnapshotRowsRead: HISTORICAL_DATA_SNAPSHOT_MAX_ROWS_READ,
      logicalRowsReadLimit: HISTORICAL_BILLED_READ_LIMIT,
      maximumAutomaticReadAttempts:
        HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
      billableRowsReadReservation:
        HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      sentinelsPerDataset: 16,
    },
    datasets: datasets(),
    supplementalDatasets: supplementalDatasets(),
    operationalDatasets: {
      memory_vector_cleanup_outbox: operationalOutboxDataset(),
    },
  };
}

function legacyBaseline(
  sourceLabel: string,
  createdAt: string,
  utcDay: string,
  secret: string,
): HistoricalDataLegacyBaselineReport {
  const current = baseline(sourceLabel, createdAt, utcDay, secret);
  const {
    supplementalDatasets: _supplementalDatasets,
    operationalDatasets: _operationalDatasets,
    limits: _limits,
    ...core
  } = current;
  void _supplementalDatasets;
  void _operationalDatasets;
  void _limits;
  const operationId = `legacy-baseline:${sourceLabel}`;
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
        maximumRowsRead: HISTORICAL_DATA_LEGACY_BILLED_READ_LIMIT,
      },
    },
    limits: {
      coreRows: 350_000,
      billedReads: 750_000,
      sentinelsPerDataset: 16,
    },
  };
}

function datasets() {
  return {
    users: dataset("users"),
    accounts: dataset("accounts"),
    sessions: dataset("sessions"),
    chats: dataset("chats"),
    messages: dataset("messages"),
    admin_users: dataset("admin_users"),
    user_memories: dataset("user_memories"),
    activity_runs: dataset("activity_runs"),
    product_events: dataset("product_events"),
    profile_photo_pointers: dataset("profile_photo_pointers", "users"),
  } satisfies HistoricalDataBaselineReport["datasets"];
}

function supplementalDatasets() {
  return {
    ai_runs: dataset("ai_runs"),
    user_memory_graph_edges: dataset("user_memory_graph_edges", "user_memories"),
    user_memory_settings: dataset("user_memory_settings"),
    chat_memory_summaries: dataset("chat_memory_summaries"),
    chat_memory_turns: dataset("chat_memory_turns"),
    user_memory_profiles: dataset("user_memory_profiles"),
    user_memory_summaries: dataset("user_memory_summaries"),
    memory_synthesis_runs: dataset("memory_synthesis_runs"),
    memory_source_feedback: dataset("memory_source_feedback"),
    memory_events: dataset("memory_events"),
  } satisfies HistoricalDataBaselineReport["supplementalDatasets"];
}

function dataset(name: string, table = name) {
  const columns = [{ name: "id", type: "text", notNull: 1 as const, primaryKey: 1 }];
  return {
    rowCount: 1,
    schemaTable: table,
    schemaSha256: createHash("sha256")
      .update(`${columns[0].name}\0${columns[0].type}\0${columns[0].notNull}\0${columns[0].primaryKey}`)
      .digest("hex"),
    columns,
    sentinels: [createHash("sha256").update(`sentinel:${name}`).digest("hex")],
  };
}

function operationalOutboxDataset() {
  const columns = [
    { name: "vector_id", type: "text", notNull: 1 as const, primaryKey: 1 },
    { name: "absence_count", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "attempt_count", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "created_at", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "last_attempt_at", type: "integer", notNull: 0 as const, primaryKey: 0 },
    { name: "last_error", type: "text", notNull: 0 as const, primaryKey: 0 },
    { name: "lease_token", type: "text", notNull: 0 as const, primaryKey: 0 },
    { name: "lease_until", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "next_attempt_at", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "owner_user_id", type: "text", notNull: 0 as const, primaryKey: 0 },
    { name: "reason", type: "text", notNull: 1 as const, primaryKey: 0 },
    { name: "source_namespace", type: "text", notNull: 0 as const, primaryKey: 0 },
    { name: "source_row_id", type: "text", notNull: 0 as const, primaryKey: 0 },
    { name: "source_row_revision", type: "integer", notNull: 0 as const, primaryKey: 0 },
    { name: "state", type: "text", notNull: 1 as const, primaryKey: 0 },
    { name: "updated_at", type: "integer", notNull: 1 as const, primaryKey: 0 },
    { name: "write_fence_expires_at", type: "integer", notNull: 0 as const, primaryKey: 0 },
    { name: "write_token", type: "text", notNull: 0 as const, primaryKey: 0 },
  ];
  return {
    lifecycle: "mutable-drainable-outbox" as const,
    rowCount: 0,
    schemaTable: "memory_vector_cleanup_outbox" as const,
    schemaSha256: createHash("sha256")
      .update(JSON.stringify(columns.map((column) =>
        `${column.name}\0${column.type}\0${column.notNull}\0${column.primaryKey}`
      )))
      .digest("hex"),
    columns,
  };
}

function source(label: string): SourceFingerprint {
  const content = `source:${label}`;
  const file = {
    file: "source.ts",
    bytes: Buffer.byteLength(content),
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
