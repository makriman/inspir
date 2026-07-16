import type { D1ReleaseSourceIdentity } from "./d1-release-budget-ledger";
import {
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "./historical-data-fresh-0016-cutover-policy";
import { createHistoricalPre0016SnapshotPlan } from "./historical-data-pre-0016-snapshot";
import {
  hasRequiredHistoricalMemoryVectorCleanupOutboxSchema,
  historicalDataSchemaHash,
  type HistoricalDatasetEvidence,
  type HistoricalDatasetName,
  type HistoricalOperationalDatasetEvidence,
  type HistoricalSupplementalDatasetName,
} from "./verify-historical-data-preservation";

export type HistoricalFresh0016PredecessorForContinuity = Readonly<{
  createdAt: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  hmacKeyId: string;
  snapshotPlanSha256: string;
  datasets: Readonly<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>;
  supplementalDatasets: Readonly<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >;
}>;

export type HistoricalFresh0016DatasetDecision = Readonly<{
  predecessorRows: number;
  successorRows: number;
  countsPreserved: boolean;
  schemaTablePreserved: boolean;
  predecessorSchemaValid: boolean;
  successorSchemaValid: boolean;
  columnsPreserved: boolean;
  schemaObjectsPreserved: boolean;
  sentinelsPreserved: boolean;
}>;

export type HistoricalFresh0016SuccessorForContinuity = Readonly<{
  createdAt: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  hmacKeyId: string;
  datasets: Readonly<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>;
  supplementalDatasets: Readonly<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >;
  operationalDatasets: Readonly<{
    memory_vector_cleanup_outbox: HistoricalOperationalDatasetEvidence;
  }>;
}>;

export type HistoricalFresh0016ContinuityEvaluation = Readonly<{
  ok: boolean;
  policyId: typeof HISTORICAL_FRESH_0016_CUTOVER_POLICY.policyId;
  policySha256: typeof HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256;
  legacyInterval: Readonly<{
    status: typeof HISTORICAL_FRESH_0016_CUTOVER_POLICY.legacyInterval.status;
    proven: false;
  }>;
  sameSource: boolean;
  sameHmacKey: boolean;
  predecessorPlanMatchesSource: boolean;
  gapMs: number;
  gapWithinPolicy: boolean;
  datasets: Readonly<
    Record<HistoricalDatasetName, HistoricalFresh0016DatasetDecision>
  >;
  supplementalDatasets: Readonly<
    Record<
      HistoricalSupplementalDatasetName,
      HistoricalFresh0016DatasetDecision
    >
  >;
  operationalOutbox: Readonly<{
    successorRows: number;
    schemaPresent: boolean;
    emptyBeforeActivation: boolean;
    predecessorRowPreservationRequired: false;
  }>;
  problems: readonly string[];
}>;

export function evaluateHistoricalFresh0016Continuity(input: {
  predecessor: HistoricalFresh0016PredecessorForContinuity;
  successor: HistoricalFresh0016SuccessorForContinuity;
}): HistoricalFresh0016ContinuityEvaluation {
  const { predecessor, successor } = input;
  const problems: string[] = [];
  const sameSource =
    predecessor.sourceFingerprint.sha256 === successor.sourceFingerprint.sha256 &&
    predecessor.sourceFingerprint.fileCount === successor.sourceFingerprint.fileCount;
  if (!sameSource) {
    problems.push("The predecessor and successor do not bind the same release source.");
  }
  const sameHmacKey = predecessor.hmacKeyId === successor.hmacKeyId;
  if (!sameHmacKey) {
    problems.push("The predecessor and successor do not use the same fresh HMAC key.");
  }
  const expectedPredecessorPlan = createHistoricalPre0016SnapshotPlan(
    predecessor.sourceFingerprint,
  );
  const predecessorPlanMatchesSource =
    predecessor.snapshotPlanSha256 === expectedPredecessorPlan.planSha256;
  if (!predecessorPlanMatchesSource) {
    problems.push("The predecessor snapshot plan does not bind its exact source.");
  }

  const predecessorMs = Date.parse(predecessor.createdAt);
  const successorMs = Date.parse(successor.createdAt);
  const gapMs = successorMs - predecessorMs;
  const gapWithinPolicy =
    Number.isSafeInteger(gapMs) &&
    gapMs > 0 &&
    gapMs <=
      HISTORICAL_FRESH_0016_CUTOVER_POLICY.successor
        .maximumPredecessorToSuccessorGapMs;
  if (!gapWithinPolicy) {
    problems.push("The fresh predecessor-to-successor capture gap is invalid or too long.");
  }

  const datasets = mapCoreDatasetDecisions(
    predecessor.datasets,
    successor.datasets,
    problems,
  );
  const supplementalDatasets = mapSupplementalDatasetDecisions(
    predecessor.supplementalDatasets,
    successor.supplementalDatasets,
    problems,
  );

  const successorOutbox =
    successor.operationalDatasets.memory_vector_cleanup_outbox;
  const operationalOutbox = Object.freeze({
    successorRows: successorOutbox.rowCount,
    schemaPresent:
      hasRequiredHistoricalMemoryVectorCleanupOutboxSchema(successorOutbox),
    emptyBeforeActivation: successorOutbox.rowCount === 0,
    predecessorRowPreservationRequired: false as const,
  });
  if (!operationalOutbox.schemaPresent) {
    problems.push("The new memory cleanup outbox schema is incomplete.");
  }
  if (!operationalOutbox.emptyBeforeActivation) {
    problems.push("The new memory cleanup outbox was not empty before activation.");
  }

  return Object.freeze({
    ok: problems.length === 0,
    policyId: HISTORICAL_FRESH_0016_CUTOVER_POLICY.policyId,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    legacyInterval: Object.freeze({
      status: HISTORICAL_FRESH_0016_CUTOVER_POLICY.legacyInterval.status,
      proven: false as const,
    }),
    sameSource,
    sameHmacKey,
    predecessorPlanMatchesSource,
    gapMs,
    gapWithinPolicy,
    datasets,
    supplementalDatasets,
    operationalOutbox,
    problems: Object.freeze(problems),
  });
}

function mapCoreDatasetDecisions(
  predecessor: Readonly<
    Record<HistoricalDatasetName, HistoricalDatasetEvidence>
  >,
  successor: Readonly<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>,
  problems: string[],
): Readonly<Record<HistoricalDatasetName, HistoricalFresh0016DatasetDecision>> {
  return Object.freeze({
    users: datasetDecisionWithProblems(
      "users",
      predecessor.users,
      successor.users,
      problems,
    ),
    accounts: datasetDecisionWithProblems(
      "accounts",
      predecessor.accounts,
      successor.accounts,
      problems,
    ),
    sessions: datasetDecisionWithProblems(
      "sessions",
      predecessor.sessions,
      successor.sessions,
      problems,
    ),
    chats: datasetDecisionWithProblems(
      "chats",
      predecessor.chats,
      successor.chats,
      problems,
    ),
    messages: datasetDecisionWithProblems(
      "messages",
      predecessor.messages,
      successor.messages,
      problems,
    ),
    admin_users: datasetDecisionWithProblems(
      "admin_users",
      predecessor.admin_users,
      successor.admin_users,
      problems,
    ),
    user_memories: datasetDecisionWithProblems(
      "user_memories",
      predecessor.user_memories,
      successor.user_memories,
      problems,
    ),
    activity_runs: datasetDecisionWithProblems(
      "activity_runs",
      predecessor.activity_runs,
      successor.activity_runs,
      problems,
    ),
    product_events: datasetDecisionWithProblems(
      "product_events",
      predecessor.product_events,
      successor.product_events,
      problems,
    ),
    profile_photo_pointers: datasetDecisionWithProblems(
      "profile_photo_pointers",
      predecessor.profile_photo_pointers,
      successor.profile_photo_pointers,
      problems,
    ),
  });
}

function mapSupplementalDatasetDecisions(
  predecessor: Readonly<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >,
  successor: Readonly<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >,
  problems: string[],
): Readonly<
  Record<HistoricalSupplementalDatasetName, HistoricalFresh0016DatasetDecision>
> {
  return Object.freeze({
    ai_runs: datasetDecisionWithProblems(
      "ai_runs",
      predecessor.ai_runs,
      successor.ai_runs,
      problems,
    ),
    user_memory_graph_edges: datasetDecisionWithProblems(
      "user_memory_graph_edges",
      predecessor.user_memory_graph_edges,
      successor.user_memory_graph_edges,
      problems,
    ),
    user_memory_settings: datasetDecisionWithProblems(
      "user_memory_settings",
      predecessor.user_memory_settings,
      successor.user_memory_settings,
      problems,
    ),
    chat_memory_summaries: datasetDecisionWithProblems(
      "chat_memory_summaries",
      predecessor.chat_memory_summaries,
      successor.chat_memory_summaries,
      problems,
    ),
    chat_memory_turns: datasetDecisionWithProblems(
      "chat_memory_turns",
      predecessor.chat_memory_turns,
      successor.chat_memory_turns,
      problems,
    ),
    user_memory_profiles: datasetDecisionWithProblems(
      "user_memory_profiles",
      predecessor.user_memory_profiles,
      successor.user_memory_profiles,
      problems,
    ),
    user_memory_summaries: datasetDecisionWithProblems(
      "user_memory_summaries",
      predecessor.user_memory_summaries,
      successor.user_memory_summaries,
      problems,
    ),
    memory_synthesis_runs: datasetDecisionWithProblems(
      "memory_synthesis_runs",
      predecessor.memory_synthesis_runs,
      successor.memory_synthesis_runs,
      problems,
    ),
    memory_source_feedback: datasetDecisionWithProblems(
      "memory_source_feedback",
      predecessor.memory_source_feedback,
      successor.memory_source_feedback,
      problems,
    ),
    memory_events: datasetDecisionWithProblems(
      "memory_events",
      predecessor.memory_events,
      successor.memory_events,
      problems,
    ),
    game_results: datasetDecisionWithProblems(
      "game_results",
      predecessor.game_results,
      successor.game_results,
      problems,
    ),
  });
}

function datasetDecisionWithProblems(
  name: HistoricalDatasetName | HistoricalSupplementalDatasetName,
  predecessor: HistoricalDatasetEvidence,
  successor: HistoricalDatasetEvidence,
  problems: string[],
): HistoricalFresh0016DatasetDecision {
  const decision = datasetDecision(predecessor, successor);
  if (!decision.countsPreserved) {
    problems.push(`${name} row count decreased across fresh 0016.`);
  }
  if (!decision.schemaTablePreserved) {
    problems.push(`${name} changed its protected schema table.`);
  }
  if (!decision.predecessorSchemaValid || !decision.successorSchemaValid) {
    problems.push(`${name} contains an invalid schema identity hash.`);
  }
  if (!decision.columnsPreserved) {
    problems.push(`${name} lost or changed a predecessor column.`);
  }
  if (!decision.schemaObjectsPreserved) {
    problems.push(`${name} changed its protected schema-object identity.`);
  }
  if (!decision.sentinelsPreserved) {
    problems.push(`${name} lost a predecessor identity sentinel.`);
  }
  return decision;
}

function datasetDecision(
  predecessor: HistoricalDatasetEvidence,
  successor: HistoricalDatasetEvidence,
): HistoricalFresh0016DatasetDecision {
  const successorColumns = new Set(successor.columns.map(columnIdentity));
  const successorSentinels = new Set(successor.sentinels);
  return Object.freeze({
    predecessorRows: predecessor.rowCount,
    successorRows: successor.rowCount,
    countsPreserved: successor.rowCount >= predecessor.rowCount,
    schemaTablePreserved:
      successor.schemaTable === predecessor.schemaTable,
    predecessorSchemaValid:
      predecessor.schemaSha256 === historicalDataSchemaHash(predecessor.columns),
    successorSchemaValid:
      successor.schemaSha256 === historicalDataSchemaHash(successor.columns),
    columnsPreserved: predecessor.columns.every((column) =>
      successorColumns.has(columnIdentity(column)),
    ),
    schemaObjectsPreserved:
      schemaObjectsEqual(predecessor.schemaObjects, successor.schemaObjects),
    sentinelsPreserved: predecessor.sentinels.every((sentinel) =>
      successorSentinels.has(sentinel),
    ),
  });
}

function schemaObjectsEqual(
  predecessor: HistoricalDatasetEvidence["schemaObjects"],
  successor: HistoricalDatasetEvidence["schemaObjects"],
) {
  if (predecessor === undefined || successor === undefined) {
    return predecessor === successor;
  }
  return predecessor.tableSha256 === successor.tableSha256 &&
    predecessor.rejectUpdateTriggerSha256 ===
      successor.rejectUpdateTriggerSha256 &&
    predecessor.combinedSha256 === successor.combinedSha256;
}

function columnIdentity(column: {
  name: string;
  type: string;
  notNull: 0 | 1;
  primaryKey: number;
}) {
  return `${column.name}\u0000${column.type}\u0000${column.notNull}\u0000${column.primaryKey}`;
}
