import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_EXCLUDED_OPERATIONAL_DATASET_NAMES,
  HISTORICAL_PRE_0016_IDENTITY_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES,
  HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
  HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
  HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT,
  HISTORICAL_PRE_0016_SNAPSHOT_SQL,
  captureHistoricalPre0016Snapshot,
  createHistoricalPre0016SnapshotPlan,
  type HistoricalPre0016SnapshotCapture,
} from "../scripts/cloudflare/historical-data-pre-0016-snapshot";
import {
  HISTORICAL_DATASET_NAMES,
  HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS,
  HISTORICAL_SCHEMA_COLUMN_LIMIT,
  HISTORICAL_SCHEMA_OBJECT_LIMIT,
  HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
  historicalGameResultsSchemaObjectResultRows,
} from "../scripts/cloudflare/verify-historical-data-preservation";
import {
  D1_DATABASE_NAME,
  stableStringify,
  type RunCommandOptions,
  type WranglerRunner,
} from "../scripts/cloudflare/migration-config";

const sourceIdentity = {
  sha256: "a".repeat(64),
  fileCount: 321,
};
const hmacSecret = "pre-0016-test-hmac-secret-at-least-32-bytes";

type TestD1Entry = {
  success: boolean;
  results: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
};

test("pre-0016 plan covers exactly the 21 protected datasets within the exact Free-plan bound", () => {
  assert.deepEqual(HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES, [
    ...HISTORICAL_DATASET_NAMES,
    ...HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
  ]);
  assert.equal(
    new Set(HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES).size,
    21,
  );
  assert.deepEqual(HISTORICAL_PRE_0016_EXCLUDED_OPERATIONAL_DATASET_NAMES, [
    "memory_vector_cleanup_outbox",
  ]);
  assert.doesNotMatch(
    HISTORICAL_PRE_0016_SNAPSHOT_SQL,
    /memory_vector_cleanup_outbox/,
  );

  const statements = snapshotStatements();
  assert.equal(statements.length, 62);
  assert.equal(HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT, 21);
  assert.equal(HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT, 19);
  assert.equal(HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT, 1);
  assert.equal(HISTORICAL_PRE_0016_IDENTITY_RESULT_SET_COUNT, 21);
  assert.equal(HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT, 62);

  const countStatements = statements.slice(
    0,
    HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT,
  );
  const countDatasets = countStatements.map((statement) => {
    const match = /^SELECT '([a-z0-9_]+)' AS dataset,/i.exec(statement);
    assert.ok(match?.[1]);
    return match[1];
  });
  assert.deepEqual(countDatasets, [
    ...HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES,
  ]);

  const schemaStart = HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT;
  const schemaObjectStart =
    schemaStart + HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT;
  const schemaTables = statements
    .slice(schemaStart, schemaObjectStart)
    .map((statement) => {
      const match = /^SELECT '([a-z0-9_]+)' AS table_name,/i.exec(statement);
      assert.ok(match?.[1]);
      return match[1];
    });
  assert.equal(schemaTables.length, 19);
  assert.equal(new Set(schemaTables).size, 19);

  const schemaObjectStatements = statements.slice(
    schemaObjectStart,
    schemaObjectStart + HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT,
  );
  assert.equal(schemaObjectStatements.length, 1);
  assert.match(schemaObjectStatements[0] ?? "", /\bFROM sqlite_master\b/i);
  assert.equal(
    requireFirstLimit(schemaObjectStatements[0] ?? ""),
    HISTORICAL_SCHEMA_OBJECT_LIMIT + 1,
  );

  const identityStart =
    schemaObjectStart + HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT;
  const identityStatements = statements.slice(identityStart);
  assert.equal(identityStatements.length, 21);
  for (const statement of statements) {
    assert.match(statement, /^SELECT\b/i);
    assert.doesNotMatch(
      statement,
      /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH)\b/i,
    );
  }

  const countScanMaximum = countStatements.reduce(
    (sum, statement) => sum + requireFirstLimit(statement),
    0,
  );
  const schemaScanMaximum =
    HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT *
    (HISTORICAL_SCHEMA_COLUMN_LIMIT + 1);
  const identityScanMaximum = identityStatements.reduce(
    (sum, statement, index) => {
      const limits = [...statement.matchAll(/\bLIMIT ([1-9][0-9]*)/gi)].map(
        (match) => Number(match[1]),
      );
      assert.ok(limits.length > 0);
      return (
        sum +
        (HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES[index] ===
        "profile_photo_pointers"
          ? Math.max(...limits)
          : 16)
      );
    },
    0,
  );
  assert.equal(
    countScanMaximum +
      schemaScanMaximum +
      HISTORICAL_SCHEMA_OBJECT_LIMIT +
      1 +
      identityScanMaximum,
    730_738,
  );
  assert.equal(HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ, 730_738);
  assert.equal(
    HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
    750_000,
  );
  assert.equal(
    HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
    3,
  );
  assert.equal(
    HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
    2_250_000,
  );
  assert.equal(
    HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT *
      HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
    HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  );
});

test("pre-0016 plan identity is deterministic, source-bound, and deeply immutable", () => {
  const mutableInput = { ...sourceIdentity };
  const plan = createHistoricalPre0016SnapshotPlan(mutableInput);
  mutableInput.fileCount += 1;
  const samePlan = createHistoricalPre0016SnapshotPlan(sourceIdentity);
  const otherSourcePlan = createHistoricalPre0016SnapshotPlan({
    sha256: "b".repeat(64),
    fileCount: sourceIdentity.fileCount,
  });

  assert.equal(plan.planSha256, samePlan.planSha256);
  assert.notEqual(plan.planSha256, otherSourcePlan.planSha256);
  assert.equal(plan.sourceIdentity.fileCount, sourceIdentity.fileCount);
  assert.equal(plan.sourceIdentity.sha256, sourceIdentity.sha256);
  assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
  const { planSha256, ...material } = plan;
  assert.equal(
    planSha256,
    createHash("sha256").update(stableStringify(material)).digest("hex"),
  );
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.sourceIdentity), true);
  assert.equal(Object.isFrozen(plan.protectedDatasets), true);
  assert.equal(Object.isFrozen(plan.excludedOperationalDatasets), true);
  assert.equal(Object.isFrozen(plan.resultSetCounts), true);
  assert.equal(Object.isFrozen(plan.limits), true);
  assert.equal(Reflect.set(plan.sourceIdentity, "fileCount", 999), false);

  assert.throws(
    () =>
      createHistoricalPre0016SnapshotPlan({
        sha256: "not-a-sha",
        fileCount: 1,
      }),
    /exact source SHA-256/,
  );
  assert.throws(
    () =>
      createHistoricalPre0016SnapshotPlan({
        sha256: sourceIdentity.sha256,
        fileCount: 0,
      }),
    /positive source file count/,
  );
});

test("pre-0016 capture returns one immutable result only after every result set validates", () => {
  const entries = validD1Entries();
  let invalidSecretRunnerCalls = 0;
  assert.throws(
    () =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity,
        hmacSecret: "too-short",
        runner: () => {
          invalidSecretRunnerCalls += 1;
          return JSON.stringify(entries);
        },
      }),
    /32 to 512 UTF-8 bytes/,
  );
  assert.equal(invalidSecretRunnerCalls, 0);
  let observedArgs: string[] | undefined;
  let observedOptions: RunCommandOptions | undefined;
  const capture = captureHistoricalPre0016Snapshot({
    sourceIdentity,
    hmacSecret,
    runner: jsonRunner(entries, (args, options) => {
      observedArgs = args;
      observedOptions = options;
    }),
  });

  assert.deepEqual(observedArgs, [
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--json",
    "--command",
    HISTORICAL_PRE_0016_SNAPSHOT_SQL,
  ]);
  assert.deepEqual(observedOptions, {
    env: {
      HISTORICAL_DATA_PRESERVATION_HMAC_SECRET: undefined,
      WRANGLER_LOG_SANITIZE: "true",
      WRANGLER_WRITE_LOGS: "false",
    },
  });
  assert.equal(capture.rowsRead, 63);
  assert.equal(capture.rowsWritten, 0);
  assert.match(capture.hmacKeyId, /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(capture.datasets).length, 10);
  assert.equal(Object.keys(capture.supplementalDatasets).length, 11);
  assert.equal(Object.hasOwn(capture, "resultSets"), false);
  assert.equal(Object.hasOwn(capture, "datasetCounts"), false);
  assert.equal(capture.datasets.users.rowCount, 1);
  assert.equal(capture.datasets.sessions.rowCount, 1);
  assert.equal(capture.datasets.accounts.sentinels.length, 1);
  assert.match(capture.datasets.accounts.sentinels[0] ?? "", /^[a-f0-9]{64}$/);
  assert.equal(
    capture.supplementalDatasets.user_memory_graph_edges.rowCount,
    capture.datasets.user_memories.rowCount,
  );
  assert.equal(
    capture.supplementalDatasets.user_memory_graph_edges.schemaSha256,
    capture.datasets.user_memories.schemaSha256,
  );
  const serialized = JSON.stringify(capture);
  assert.doesNotMatch(
    serialized,
    /private-user-id|private-account-id|private-session-token|private-chat-id|private-message-id|private-memory-id|private-game-result|pre-0016-test-hmac-secret/,
  );
  assert.equal(Object.isFrozen(capture), true);
  assert.equal(Object.isFrozen(capture.datasets), true);
  assert.equal(Object.isFrozen(capture.datasets.users), true);
  assert.equal(Object.isFrozen(capture.datasets.users.columns), true);
  assert.equal(Object.isFrozen(capture.datasets.users.sentinels), true);
});

test("missing, invalid, or retried metadata cannot return a partial pre-0016 capture", () => {
  const cases: ReadonlyArray<{
    label: string;
    mutate: (entry: TestD1Entry) => void;
    expected: RegExp;
  }> = [
    {
      label: "missing meta",
      mutate: (entry) => {
        delete entry.meta;
      },
      expected: /lacks exact billing metadata/,
    },
    {
      label: "missing attempts",
      mutate: (entry) => {
        const meta = requireMeta(entry);
        delete meta.total_attempts;
      },
      expected: /lacks valid automatic-attempt metadata/,
    },
    {
      label: "string attempts",
      mutate: (entry) => {
        requireMeta(entry).total_attempts = "1";
      },
      expected: /lacks valid automatic-attempt metadata/,
    },
    {
      label: "fractional attempts",
      mutate: (entry) => {
        requireMeta(entry).total_attempts = 1.5;
      },
      expected: /lacks valid automatic-attempt metadata/,
    },
    {
      label: "zero attempts",
      mutate: (entry) => {
        requireMeta(entry).total_attempts = 0;
      },
      expected: /lacks valid automatic-attempt metadata/,
    },
    {
      label: "automatic retry",
      mutate: (entry) => {
        requireMeta(entry).total_attempts = 2;
      },
      expected: /maximum billable-read reservation must remain unresolved/,
    },
    {
      label: "maximum automatic retry",
      mutate: (entry) => {
        requireMeta(entry).total_attempts = 3;
      },
      expected: /maximum billable-read reservation must remain unresolved/,
    },
    {
      label: "invalid rows read",
      mutate: (entry) => {
        requireMeta(entry).rows_read = -1;
      },
      expected: /lacks exact billing metadata/,
    },
    {
      label: "invalid rows written",
      mutate: (entry) => {
        requireMeta(entry).rows_written = "0";
      },
      expected: /lacks exact billing metadata/,
    },
  ];

  for (const scenario of cases) {
    const entries = validD1Entries();
    const last = entries.at(-1);
    assert.ok(last);
    scenario.mutate(last);
    let capture: HistoricalPre0016SnapshotCapture | undefined;
    assert.throws(
      () => {
        capture = captureHistoricalPre0016Snapshot({
          sourceIdentity,
          hmacSecret,
          runner: jsonRunner(entries),
        });
      },
      scenario.expected,
      scenario.label,
    );
    assert.equal(
      capture,
      undefined,
      `${scenario.label} must not expose a capture for report publication or exact ledger refinement`,
    );
  }
});

test("pre-0016 capture enforces canonical V2 protected-data invariants", () => {
  const emptyAccounts = validD1Entries();
  const accountsIndex = protectedDatasetIndex("accounts");
  setCount(emptyAccounts, accountsIndex, 0);
  setIdentityRows(emptyAccounts, accountsIndex, []);
  assert.throws(
    () =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity,
        hmacSecret,
        runner: jsonRunner(emptyAccounts),
      }),
    /refuses an empty or wrong production database: accounts has no rows/,
  );

  const mismatchedGraph = validD1Entries();
  const graphIndex = protectedDatasetIndex("user_memory_graph_edges");
  setCount(mismatchedGraph, graphIndex, 0);
  setIdentityRows(mismatchedGraph, graphIndex, []);
  assert.throws(
    () =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity,
        hmacSecret,
        runner: jsonRunner(mismatchedGraph),
      }),
    /user-memory graph evidence does not match user_memories/,
  );

  const excessivePhotoPointers = validD1Entries();
  const photoIndex = protectedDatasetIndex("profile_photo_pointers");
  setCount(excessivePhotoPointers, photoIndex, 2);
  setIdentityRows(excessivePhotoPointers, photoIndex, [
    {
      identity_1: "private-user-id",
      identity_2: "private-r2-key-one",
      identity_3: "private-image-hash-one",
      identity_4: "private-etag-one",
    },
    {
      identity_1: "private-other-user-id",
      identity_2: "private-r2-key-two",
      identity_3: "private-image-hash-two",
      identity_4: "private-etag-two",
    },
  ]);
  assert.throws(
    () =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity,
        hmacSecret,
        runner: jsonRunner(excessivePhotoPointers),
      }),
    /profile-photo pointers exceed the users dataset/,
  );
});

test("pre-0016 capture fails closed on writes, logical-bound excess, or malformed result sets", () => {
  const written = validD1Entries();
  requireMeta(written[0]).rows_written = 1;
  assert.throws(
    () =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity,
        hmacSecret,
        runner: jsonRunner(written),
      }),
    /unexpectedly wrote rows/,
  );

  const oversized = validD1Entries();
  for (const entry of oversized) requireMeta(entry).rows_read = 0;
  requireMeta(oversized[0]).rows_read =
    HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ + 1;
  assert.throws(
    () =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity,
        hmacSecret,
        runner: jsonRunner(oversized),
      }),
    /exceed the proven logical bound/,
  );

  const missing = validD1Entries();
  missing.pop();
  assert.throws(
    () =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity,
        hmacSecret,
        runner: jsonRunner(missing),
      }),
    /invalid result-set count/,
  );

  const capExceeded = validD1Entries();
  const firstCount = capExceeded[0]?.results[0];
  assert.ok(firstCount);
  firstCount.row_count = requireFirstLimit(snapshotStatements()[0] ?? "");
  assert.throws(
    () =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity,
        hmacSecret,
        runner: jsonRunner(capExceeded),
      }),
    /users count exceeds its bounded plan/,
  );

  const malformedSchema = validD1Entries();
  const firstSchema =
    malformedSchema[HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT]?.results[0];
  assert.ok(firstSchema);
  firstSchema.unexpected = true;
  assert.throws(
    () =>
      captureHistoricalPre0016Snapshot({
        sourceIdentity,
        hmacSecret,
        runner: jsonRunner(malformedSchema),
      }),
    /schema result order or shape is invalid/,
  );
});

function validD1Entries(): TestD1Entry[] {
  const statements = snapshotStatements();
  const schemaStart = HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT;
  const schemaObjectStart =
    schemaStart + HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT;
  const identityStart =
    schemaObjectStart + HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT;
  const rawIdentities: Readonly<
    Partial<
      Record<
        (typeof HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES)[number],
        readonly (string | number | null)[]
      >
    >
  > = {
    users: ["private-user-id"],
    accounts: ["private-provider", "private-account-id", "private-user-id"],
    sessions: ["private-session-token", "private-user-id"],
    chats: ["private-chat-id", "private-user-id"],
    messages: ["private-message-id", "private-chat-id"],
    user_memories: ["private-memory-id", "private-user-id"],
    user_memory_graph_edges: [
      "private-memory-id",
      "private-user-id",
      "private-turn-ids",
      "private-memory-ids",
      "private-chat-id",
      "private-message-id",
      "private-superseding-memory-id",
    ],
    game_results: [
      "private-game-result",
      1,
      "chess",
      "engine",
      "1",
      "checkmate",
      "human",
      "win",
      42,
      '{"moves":[]}',
      1,
      2,
      1,
      2,
    ],
  };
  return statements.map((statement, index) => {
    let results: Array<Record<string, unknown>>;
    if (index < schemaStart) {
      const dataset = /^SELECT '([a-z0-9_]+)' AS dataset,/i.exec(statement)?.[1];
      assert.ok(dataset);
      const protectedDataset = HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES[index];
      assert.equal(dataset, protectedDataset);
      results = [{
        dataset,
        row_count: protectedDataset && rawIdentities[protectedDataset] ? 1 : 0,
      }];
    } else if (index < schemaObjectStart) {
      const table = /^SELECT '([a-z0-9_]+)' AS table_name,/i.exec(statement)?.[1];
      assert.ok(table);
      results = table === "game_results"
        ? HISTORICAL_GAME_RESULTS_REQUIRED_COLUMNS.map((column) => ({
            table_name: table,
            name: column.name,
            type: column.type,
            not_null: column.notNull,
            primary_key: column.primaryKey,
          }))
        : [{
          table_name: table,
          name: "id",
          type: "text",
          not_null: 1,
          primary_key: 1,
        }];
    } else if (index < identityStart) {
      results = historicalGameResultsSchemaObjectResultRows();
    } else {
      const identityIndex = index - identityStart;
      const dataset =
        HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES[identityIndex];
      assert.ok(dataset);
      const values = rawIdentities[dataset];
      if (!values) {
        results = [];
      } else {
        const keys = [
          ...statement.matchAll(/\bAS identity_([1-9]|1[0-4])\b/gi),
        ].map((match) => `identity_${match[1]}`);
        assert.equal(keys.length, values.length);
        results = [Object.fromEntries(
          keys.map((key, keyIndex) => [key, values[keyIndex]]),
        )];
      }
    }
    return {
      success: true,
      results,
      meta: {
        rows_read: results.length,
        rows_written: 0,
        total_attempts: 1,
      },
    };
  });
}

function jsonRunner(
  entries: readonly TestD1Entry[],
  observe?: (args: string[], options: RunCommandOptions) => void,
): WranglerRunner {
  return (args, options = {}) => {
    observe?.(args, options);
    return JSON.stringify(entries);
  };
}

function snapshotStatements() {
  const parts = HISTORICAL_PRE_0016_SNAPSHOT_SQL.split(";");
  assert.equal(parts.pop()?.trim(), "");
  return parts.map((statement) => statement.trim());
}

function requireFirstLimit(statement: string) {
  const value = Number(/\bLIMIT ([1-9][0-9]*)/i.exec(statement)?.[1]);
  assert.equal(Number.isSafeInteger(value), true);
  assert.ok(value > 0);
  return value;
}

function requireMeta(entry: TestD1Entry | undefined) {
  assert.ok(entry?.meta);
  return entry.meta;
}

function protectedDatasetIndex(
  dataset: (typeof HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES)[number],
) {
  const index = HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES.indexOf(dataset);
  assert.notEqual(index, -1);
  return index;
}

function setCount(entries: TestD1Entry[], datasetIndex: number, count: number) {
  const row = entries[datasetIndex]?.results[0];
  assert.ok(row);
  row.row_count = count;
}

function setIdentityRows(
  entries: TestD1Entry[],
  datasetIndex: number,
  rows: Array<Record<string, unknown>>,
) {
  const identityStart =
    HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT +
    HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT +
    HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT;
  const entry = entries[identityStart + datasetIndex];
  assert.ok(entry);
  entry.results = rows;
}
