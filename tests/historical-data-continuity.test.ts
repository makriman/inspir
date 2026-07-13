import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  HISTORICAL_DATA_CONTINUITY_POLICY,
} from "../scripts/cloudflare/historical-data-continuity-policy";
import {
  evaluateHistoricalDataContinuity,
} from "../scripts/cloudflare/verify-historical-data-continuity";
import {
  HISTORICAL_DATA_PRESERVATION_KIND,
  HISTORICAL_DATASET_NAMES,
  historicalDataBudgetOperationId,
  historicalDataHmacKeyId,
  type HistoricalDataBaselineReport,
  type HistoricalDatasetName,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import type { SourceFingerprint } from "../scripts/cloudflare/source-fingerprint";

const retainedSecret = "historical-continuity-retained-secret-32-bytes";
const predecessorTime = "2026-07-13T01:10:08.863Z";
const successorTime = "2026-07-14T00:10:08.863Z";

test("rollover continuity preserves counts, columns, and HMAC sentinels across source changes", () => {
  const predecessor = baseline("predecessor", predecessorTime, "2026-07-13", retainedSecret);
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
});

test("rollover continuity rejects count, schema, sentinel, HMAC, day, and time drift", () => {
  const scenarios: Array<{
    name: string;
    mutate: (predecessor: HistoricalDataBaselineReport, successor: HistoricalDataBaselineReport) => void;
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
  ];

  for (const scenario of scenarios) {
    const predecessor = baseline("predecessor", predecessorTime, "2026-07-13", retainedSecret);
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
    schemaVersion: 1,
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
        maximumRowsRead: 750_000,
        maximumRowsWritten: 0,
        createdAt,
        updatedAt: createdAt,
      },
      totals: { rowsRead: 20, rowsWritten: 0 },
      accountedUsage: { rowsRead: 40, rowsWritten: 0 },
    },
    limits: {
      coreRows: 350_000,
      billedReads: 750_000,
      sentinelsPerDataset: 16,
    },
    datasets: datasets(),
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

function dataset(name: HistoricalDatasetName, table = name) {
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
