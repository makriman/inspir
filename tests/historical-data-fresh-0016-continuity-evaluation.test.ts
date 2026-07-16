import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateHistoricalFresh0016Continuity,
  type HistoricalFresh0016PredecessorForContinuity,
  type HistoricalFresh0016SuccessorForContinuity,
} from "../scripts/cloudflare/historical-data-fresh-0016-continuity-evaluation";
import {
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
} from "../scripts/cloudflare/historical-data-fresh-0016-cutover-policy";
import { createHistoricalPre0016SnapshotPlan } from "../scripts/cloudflare/historical-data-pre-0016-snapshot";
import {
  HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS,
  historicalDataSchemaHash,
  type HistoricalDatasetEvidence,
  type HistoricalOperationalDatasetEvidence,
} from "../scripts/cloudflare/verify-historical-data-preservation";

const source = { sha256: "a".repeat(64), fileCount: 1_500 };
const hmacKeyId = "b".repeat(64);
const predecessorCreatedAt = "2026-07-14T23:45:00.000Z";
const successorCreatedAt = "2026-07-15T00:15:00.000Z";

test("fresh 0016 continuity proves all 21 protected datasets and an empty new outbox", () => {
  const predecessor = predecessorFixture();
  const successor = successorFixture();
  const evaluation = evaluateHistoricalFresh0016Continuity({
    predecessor,
    successor,
  });

  assert.equal(evaluation.ok, true);
  assert.equal(evaluation.sameSource, true);
  assert.equal(evaluation.sameHmacKey, true);
  assert.equal(evaluation.predecessorPlanMatchesSource, true);
  assert.equal(evaluation.gapMs, 30 * 60 * 1_000);
  assert.equal(evaluation.gapWithinPolicy, true);
  assert.equal(Object.keys(evaluation.datasets).length, 10);
  assert.equal(Object.keys(evaluation.supplementalDatasets).length, 11);
  assert.ok(
    Object.values(evaluation.datasets).every(decisionPassed),
  );
  assert.ok(
    Object.values(evaluation.supplementalDatasets).every(decisionPassed),
  );
  assert.deepEqual(evaluation.operationalOutbox, {
    successorRows: 0,
    schemaPresent: true,
    emptyBeforeActivation: true,
    predecessorRowPreservationRequired: false,
  });
  assert.deepEqual(evaluation.legacyInterval, {
    status: "identity-continuity-unverifiable-lost-key",
    proven: false,
  });
  assert.deepEqual(evaluation.problems, []);
});

test("fresh 0016 continuity fails every core and supplemental preservation dimension", () => {
  const predecessor = predecessorFixture();
  const base = successorFixture();
  const usersBefore = predecessor.datasets.users;
  const memoriesBefore = predecessor.supplementalDatasets.memory_events;
  const invalidUsers = {
    ...base.datasets.users,
    rowCount: usersBefore.rowCount - 1,
    schemaTable: "wrong_users",
    schemaSha256: "c".repeat(64),
    columns: [],
    sentinels: [],
  } satisfies HistoricalDatasetEvidence;
  const invalidMemoryEvents = {
    ...base.supplementalDatasets.memory_events,
    rowCount: memoriesBefore.rowCount - 1,
    columns: [],
    sentinels: [],
  } satisfies HistoricalDatasetEvidence;
  const successor: HistoricalFresh0016SuccessorForContinuity = {
    ...base,
    sourceFingerprint: { sha256: "d".repeat(64), fileCount: source.fileCount },
    hmacKeyId: "e".repeat(64),
    createdAt: new Date(
      Date.parse(predecessorCreatedAt) +
        HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor
          .maximumPredecessorToSuccessorGapMs +
        1,
    ).toISOString(),
    datasets: { ...base.datasets, users: invalidUsers },
    supplementalDatasets: {
      ...base.supplementalDatasets,
      memory_events: invalidMemoryEvents,
    },
    operationalDatasets: {
      memory_vector_cleanup_outbox: {
        ...base.operationalDatasets.memory_vector_cleanup_outbox,
        rowCount: 1,
        columns: [],
        schemaSha256: historicalDataSchemaHash([]),
      },
    },
  };
  const evaluation = evaluateHistoricalFresh0016Continuity({
    predecessor: {
      ...predecessor,
      snapshotPlanSha256: "f".repeat(64),
    },
    successor,
  });

  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.sameSource, false);
  assert.equal(evaluation.sameHmacKey, false);
  assert.equal(evaluation.predecessorPlanMatchesSource, false);
  assert.equal(evaluation.gapWithinPolicy, false);
  assert.equal(evaluation.datasets.users.countsPreserved, false);
  assert.equal(evaluation.datasets.users.schemaTablePreserved, false);
  assert.equal(evaluation.datasets.users.successorSchemaValid, false);
  assert.equal(evaluation.datasets.users.columnsPreserved, false);
  assert.equal(evaluation.datasets.users.sentinelsPreserved, false);
  assert.equal(
    evaluation.supplementalDatasets.memory_events.countsPreserved,
    false,
  );
  assert.equal(
    evaluation.supplementalDatasets.memory_events.columnsPreserved,
    false,
  );
  assert.equal(
    evaluation.supplementalDatasets.memory_events.sentinelsPreserved,
    false,
  );
  assert.equal(evaluation.operationalOutbox.schemaPresent, false);
  assert.equal(evaluation.operationalOutbox.emptyBeforeActivation, false);
  assert.ok(evaluation.problems.length >= 15);
});

test("fresh 0016 continuity rejects game table or immutability-trigger identity drift", () => {
  const predecessor = predecessorFixture();
  const base = successorFixture();
  const successor: HistoricalFresh0016SuccessorForContinuity =
    structuredClone(base);
  const schemaObjects =
    successor.supplementalDatasets.game_results.schemaObjects;
  assert.ok(schemaObjects);
  assert.equal(
    Reflect.set(schemaObjects, "rejectUpdateTriggerSha256", "0".repeat(64)),
    true,
  );

  const evaluation = evaluateHistoricalFresh0016Continuity({
    predecessor,
    successor,
  });

  assert.equal(evaluation.ok, false);
  assert.equal(
    evaluation.supplementalDatasets.game_results.schemaObjectsPreserved,
    false,
  );
  assert.ok(
    evaluation.problems.includes(
      "game_results changed its protected schema-object identity.",
    ),
  );
});

function predecessorFixture(): HistoricalFresh0016PredecessorForContinuity {
  return {
    createdAt: predecessorCreatedAt,
    sourceFingerprint: source,
    hmacKeyId,
    snapshotPlanSha256: createHistoricalPre0016SnapshotPlan(source).planSha256,
    datasets: {
      users: dataset("users", "users", 100, "01"),
      accounts: dataset("accounts", "accounts", 80, "02"),
      sessions: dataset("sessions", "sessions", 20, "03"),
      chats: dataset("chats", "chats", 60, "04"),
      messages: dataset("messages", "messages", 90, "05"),
      admin_users: dataset("admin_users", "admin_users", 2, "06"),
      user_memories: dataset("user_memories", "user_memories", 30, "07"),
      activity_runs: dataset("activity_runs", "activity_runs", 10, "08"),
      product_events: dataset("product_events", "product_events", 40, "09"),
      profile_photo_pointers: dataset(
        "profile_photo_pointers",
        "users",
        5,
        "0a",
      ),
    },
    supplementalDatasets: {
      ai_runs: dataset("ai_runs", "ai_runs", 7, "11"),
      user_memory_graph_edges: dataset(
        "user_memory_graph_edges",
        "user_memories",
        30,
        "12",
      ),
      user_memory_settings: dataset(
        "user_memory_settings",
        "user_memory_settings",
        20,
        "13",
      ),
      chat_memory_summaries: dataset(
        "chat_memory_summaries",
        "chat_memory_summaries",
        9,
        "14",
      ),
      chat_memory_turns: dataset(
        "chat_memory_turns",
        "chat_memory_turns",
        11,
        "15",
      ),
      user_memory_profiles: dataset(
        "user_memory_profiles",
        "user_memory_profiles",
        4,
        "16",
      ),
      user_memory_summaries: dataset(
        "user_memory_summaries",
        "user_memory_summaries",
        4,
        "17",
      ),
      memory_synthesis_runs: dataset(
        "memory_synthesis_runs",
        "memory_synthesis_runs",
        3,
        "18",
      ),
      memory_source_feedback: dataset(
        "memory_source_feedback",
        "memory_source_feedback",
        3,
        "19",
      ),
      memory_events: dataset("memory_events", "memory_events", 3, "1a"),
      game_results: dataset("game_results", "game_results", 2, "1b"),
    },
  };
}

function successorFixture(): HistoricalFresh0016SuccessorForContinuity {
  const predecessor = predecessorFixture();
  return {
    createdAt: successorCreatedAt,
    sourceFingerprint: source,
    hmacKeyId,
    datasets: {
      users: successorDataset(predecessor.datasets.users),
      accounts: successorDataset(predecessor.datasets.accounts),
      sessions: successorDataset(predecessor.datasets.sessions),
      chats: successorDataset(predecessor.datasets.chats),
      messages: successorDataset(predecessor.datasets.messages),
      admin_users: successorDataset(predecessor.datasets.admin_users),
      user_memories: successorDataset(predecessor.datasets.user_memories),
      activity_runs: successorDataset(predecessor.datasets.activity_runs),
      product_events: successorDataset(predecessor.datasets.product_events),
      profile_photo_pointers: successorDataset(
        predecessor.datasets.profile_photo_pointers,
      ),
    },
    supplementalDatasets: {
      ai_runs: successorDataset(predecessor.supplementalDatasets.ai_runs),
      user_memory_graph_edges: successorDataset(
        predecessor.supplementalDatasets.user_memory_graph_edges,
      ),
      user_memory_settings: successorDataset(
        predecessor.supplementalDatasets.user_memory_settings,
      ),
      chat_memory_summaries: successorDataset(
        predecessor.supplementalDatasets.chat_memory_summaries,
      ),
      chat_memory_turns: successorDataset(
        predecessor.supplementalDatasets.chat_memory_turns,
      ),
      user_memory_profiles: successorDataset(
        predecessor.supplementalDatasets.user_memory_profiles,
      ),
      user_memory_summaries: successorDataset(
        predecessor.supplementalDatasets.user_memory_summaries,
      ),
      memory_synthesis_runs: successorDataset(
        predecessor.supplementalDatasets.memory_synthesis_runs,
      ),
      memory_source_feedback: successorDataset(
        predecessor.supplementalDatasets.memory_source_feedback,
      ),
      memory_events: successorDataset(
        predecessor.supplementalDatasets.memory_events,
      ),
      game_results: successorDataset(
        predecessor.supplementalDatasets.game_results,
      ),
    },
    operationalDatasets: {
      memory_vector_cleanup_outbox: validOutbox(),
    },
  };
}

function successorDataset(
  predecessor: HistoricalDatasetEvidence,
): HistoricalDatasetEvidence {
  const addedColumn = {
    name: "added_after_0016",
    type: "text",
    notNull: 0 as const,
    primaryKey: 0,
  };
  const columns = [...predecessor.columns, addedColumn];
  return {
    ...predecessor,
    rowCount: predecessor.rowCount + 1,
    columns,
    schemaSha256: historicalDataSchemaHash(columns),
    sentinels: [...predecessor.sentinels, "9".repeat(64)],
  };
}

function dataset(
  datasetName: string,
  schemaTable: string,
  rowCount: number,
  sentinelPrefix: string,
): HistoricalDatasetEvidence {
  const columns = [
    { name: `${datasetName}_id`, type: "text", notNull: 1 as const, primaryKey: 1 },
  ];
  return {
    rowCount,
    schemaTable,
    schemaSha256: historicalDataSchemaHash(columns),
    columns,
    sentinels: [sentinelPrefix.padEnd(64, "0")],
    ...(datasetName === "game_results"
      ? { schemaObjects: { ...HISTORICAL_GAME_RESULTS_SCHEMA_OBJECTS } }
      : {}),
  };
}

function validOutbox(): HistoricalOperationalDatasetEvidence {
  const columns = [
    column("vector_id", "text", 1, 1),
    column("owner_user_id", "text", 0),
    column("source_namespace", "text", 0),
    column("source_row_id", "text", 0),
    column("source_row_revision", "integer", 0),
    column("write_token", "text", 0),
    column("reason", "text", 1),
    column("state", "text", 1),
    column("write_fence_expires_at", "integer", 0),
    column("absence_count", "integer", 1),
    column("attempt_count", "integer", 1),
    column("lease_token", "text", 0),
    column("lease_until", "integer", 1),
    column("next_attempt_at", "integer", 1),
    column("last_attempt_at", "integer", 0),
    column("last_error", "text", 0),
    column("created_at", "integer", 1),
    column("updated_at", "integer", 1),
  ];
  return {
    lifecycle: "mutable-drainable-outbox",
    rowCount: 0,
    schemaTable: "memory_vector_cleanup_outbox",
    schemaSha256: historicalDataSchemaHash(columns),
    columns,
  };
}

function column(
  name: string,
  type: string,
  notNull: 0 | 1,
  primaryKey = 0,
) {
  return { name, type, notNull, primaryKey };
}

function decisionPassed(decision: {
  countsPreserved: boolean;
  schemaTablePreserved: boolean;
  predecessorSchemaValid: boolean;
  successorSchemaValid: boolean;
  columnsPreserved: boolean;
  schemaObjectsPreserved: boolean;
  sentinelsPreserved: boolean;
}) {
  return Object.values(decision).every((value) =>
    typeof value === "number" || value === true,
  );
}
