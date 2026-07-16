import {
  D1_DATABASE_NAME,
  createHash,
  runWrangler,
  stableStringify,
  type WranglerRunner,
} from "./migration-config";
import type { D1ReleaseSourceIdentity } from "./d1-release-budget-ledger";
import {
  historicalDataHmacKeyId,
  requireHistoricalHmacSecret,
} from "./historical-data-hmac-key";
import {
  assertHistoricalGameResultsIdentity,
  HISTORICAL_DATASET_NAMES,
  HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS,
  HISTORICAL_PROTECTED_DATA_SNAPSHOT_CALCULATED_MAX_ROWS_READ,
  HISTORICAL_PROTECTED_DATA_SNAPSHOT_SQL,
  HISTORICAL_SCHEMA_COLUMN_LIMIT,
  HISTORICAL_SCHEMA_OBJECT_LIMIT,
  HISTORICAL_SCHEMA_OBJECT_SQL_MAX_BYTES,
  HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT,
  HISTORICAL_SENTINEL_LIMIT,
  HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
  historicalDataIdentityHmac,
  historicalDataSchemaHash,
  parseHistoricalGameResultsSchemaObjects,
  validateHistoricalProtectedDatasetEvidence,
  type HistoricalColumnIdentity,
  type HistoricalDatasetEvidence,
  type HistoricalDatasetName,
  type HistoricalSupplementalDatasetName,
  type HistoricalGameResultsSchemaObjects,
  type HistoricalIdentityValue,
} from "./verify-historical-data-preservation";
import { createHistoricalDataWranglerRunner } from "./historical-data-wrangler-runner";

export const HISTORICAL_PRE_0016_SNAPSHOT_KIND =
  "inspir-historical-data-pre-0016-snapshot-v1" as const;

export const HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES = Object.freeze([
  ...HISTORICAL_DATASET_NAMES,
  ...HISTORICAL_SUPPLEMENTAL_DATASET_NAMES,
] as const);

export const HISTORICAL_PRE_0016_EXCLUDED_OPERATIONAL_DATASET_NAMES =
  Object.freeze(["memory_vector_cleanup_outbox"] as const);

export type HistoricalPre0016ProtectedDatasetName =
  | HistoricalDatasetName
  | HistoricalSupplementalDatasetName;

export const HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT = 21;
export const HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT = 19;
export const HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT =
  HISTORICAL_DATA_SCHEMA_OBJECT_RESULT_SET_COUNT;
export const HISTORICAL_PRE_0016_IDENTITY_RESULT_SET_COUNT = 21;
export const HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT =
  HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT +
  HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT +
  HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT +
  HISTORICAL_PRE_0016_IDENTITY_RESULT_SET_COUNT;

export const HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ = 730_738;
export const HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT = 750_000;
export const HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS = 3;
export const HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION =
  2_250_000;
export const HISTORICAL_PRE_0016_SNAPSHOT_SQL =
  HISTORICAL_PROTECTED_DATA_SNAPSHOT_SQL;

if (
  HISTORICAL_PROTECTED_DATA_SNAPSHOT_CALCULATED_MAX_ROWS_READ !==
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ
) {
  throw new Error(
    `Pre-0016 historical snapshot bound changed: ${HISTORICAL_PROTECTED_DATA_SNAPSHOT_CALCULATED_MAX_ROWS_READ} !== ${HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ}.`,
  );
}
if (
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ >
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT
) {
  throw new Error(
    "Pre-0016 historical snapshot logical bound exceeds its logical cushion.",
  );
}
if (
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION !==
  HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT *
    HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS
) {
  throw new Error(
    "Pre-0016 historical snapshot automatic-retry reservation is inconsistent.",
  );
}

const snapshotSqlSha256 = createHash()
  .update(HISTORICAL_PRE_0016_SNAPSHOT_SQL)
  .digest("hex");

const resultSetCounts = Object.freeze({
  counts: HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT,
  schemas: HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT,
  schemaObjects: HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT,
  identities: HISTORICAL_PRE_0016_IDENTITY_RESULT_SET_COUNT,
  total: HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT,
} as const);

const snapshotLimits = Object.freeze({
  logicalSnapshotRowsRead: HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ,
  logicalRowsReadLimit: HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ_LIMIT,
  maximumAutomaticReadAttempts:
    HISTORICAL_PRE_0016_SNAPSHOT_MAX_AUTOMATIC_READ_ATTEMPTS,
  billableRowsReadReservation:
    HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
} as const);

type HistoricalPre0016SnapshotPlanMaterial = Readonly<{
  kind: typeof HISTORICAL_PRE_0016_SNAPSHOT_KIND;
  schemaVersion: 1;
  boundary: "before-runtime-migration-0016";
  sourceIdentity: Readonly<D1ReleaseSourceIdentity>;
  protectedDatasets: typeof HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES;
  excludedOperationalDatasets:
    typeof HISTORICAL_PRE_0016_EXCLUDED_OPERATIONAL_DATASET_NAMES;
  snapshotSqlSha256: string;
  resultSetCounts: typeof resultSetCounts;
  limits: typeof snapshotLimits;
}>;

export type HistoricalPre0016SnapshotPlan =
  HistoricalPre0016SnapshotPlanMaterial &
  Readonly<{
    planSha256: string;
  }>;

export type HistoricalPre0016SnapshotCapture = Readonly<{
  plan: HistoricalPre0016SnapshotPlan;
  rowsRead: number;
  rowsWritten: 0;
  hmacKeyId: string;
  datasets: Readonly<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>;
  supplementalDatasets: Readonly<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >;
}>;

export type CaptureHistoricalPre0016SnapshotOptions = Readonly<{
  sourceIdentity: D1ReleaseSourceIdentity;
  hmacSecret: string;
  authorizeLastPreD1?: () => void;
  runner?: WranglerRunner;
}>;

type CompiledSnapshotPlan = Readonly<{
  statements: readonly string[];
  schemaTables: readonly string[];
}>;

type MeteredResultSet = Readonly<{
  rows: Array<Record<string, unknown>>;
  rowsRead: number;
}>;

const compiledSnapshotPlan = compileSnapshotPlan();

export function createHistoricalPre0016SnapshotPlan(
  sourceIdentity: D1ReleaseSourceIdentity,
): HistoricalPre0016SnapshotPlan {
  assertSourceIdentity(sourceIdentity);
  const immutableSourceIdentity = Object.freeze({
    sha256: sourceIdentity.sha256,
    fileCount: sourceIdentity.fileCount,
  });
  const material: HistoricalPre0016SnapshotPlanMaterial = Object.freeze({
    kind: HISTORICAL_PRE_0016_SNAPSHOT_KIND,
    schemaVersion: 1,
    boundary: "before-runtime-migration-0016",
    sourceIdentity: immutableSourceIdentity,
    protectedDatasets: HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES,
    excludedOperationalDatasets:
      HISTORICAL_PRE_0016_EXCLUDED_OPERATIONAL_DATASET_NAMES,
    snapshotSqlSha256,
    resultSetCounts,
    limits: snapshotLimits,
  });
  const planSha256 = createHash()
    .update(stableStringify(material))
    .digest("hex");
  return Object.freeze({ ...material, planSha256 });
}

export function captureHistoricalPre0016Snapshot(
  options: CaptureHistoricalPre0016SnapshotOptions,
): HistoricalPre0016SnapshotCapture {
  const plan = createHistoricalPre0016SnapshotPlan(options.sourceIdentity);
  const hmacSecret = requireHistoricalHmacSecret(options.hmacSecret);
  const runner = createHistoricalDataWranglerRunner(
    options.runner ?? runWrangler,
  );
  options.authorizeLastPreD1?.();
  const output = runner(
    [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--remote",
      "--json",
      "--command",
      HISTORICAL_PRE_0016_SNAPSHOT_SQL,
    ],
    {
      env: {
        HISTORICAL_DATA_PRESERVATION_HMAC_SECRET: undefined,
        WRANGLER_WRITE_LOGS: "false",
      },
    },
  );
  const raw = parseJsonOutput(output);
  if (
    !Array.isArray(raw) ||
    raw.length !== HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT
  ) {
    throw new Error(
      "Pre-0016 historical snapshot returned an invalid result-set count.",
    );
  }

  // Meter every result before interpreting or exposing any snapshot data. A
  // missing, malformed, or retried result therefore cannot yield a partial
  // capture for a caller to refine into exact ledger usage or publish.
  const metered = raw.map(validateMeteredResultSet);
  const rowsRead = metered.reduce(
    (sum, result) => safeAddRows(sum, result.rowsRead),
    0,
  );
  if (rowsRead > HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ) {
    throw new Error(
      `Pre-0016 historical snapshot rows read exceed the proven logical bound: ${rowsRead} > ${HISTORICAL_PRE_0016_SNAPSHOT_LOGICAL_ROWS_READ}.`,
    );
  }

  const counts = parseDatasetCounts(metered);
  const schemas = parseSchemaResultSets(metered);
  const protectedEvidence = buildProtectedDatasetEvidence(
    metered,
    counts,
    schemas,
    parseHistoricalGameResultsSchemaObjects(
      metered[
        HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT +
          HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT
      ]?.rows ?? [],
    ),
    hmacSecret,
  );
  validateHistoricalProtectedDatasetEvidence(
    protectedEvidence.datasets,
    protectedEvidence.supplementalDatasets,
  );

  return Object.freeze({
    plan,
    rowsRead,
    rowsWritten: 0,
    hmacKeyId: historicalDataHmacKeyId(hmacSecret),
    datasets: protectedEvidence.datasets,
    supplementalDatasets: protectedEvidence.supplementalDatasets,
  });
}

function compileSnapshotPlan(): CompiledSnapshotPlan {
  if (
    Buffer.byteLength(HISTORICAL_PRE_0016_SNAPSHOT_SQL, "utf8") > 100_000 ||
    !HISTORICAL_PRE_0016_SNAPSHOT_SQL.trimEnd().endsWith(";")
  ) {
    throw new Error("Pre-0016 historical snapshot SQL is invalid or too large.");
  }
  const parts = HISTORICAL_PRE_0016_SNAPSHOT_SQL.split(";");
  const trailing = parts.pop();
  const statements = parts.map((statement) => statement.trim());
  if (
    trailing?.trim() !== "" ||
    statements.length !== HISTORICAL_PRE_0016_SNAPSHOT_RESULT_SET_COUNT
  ) {
    throw new Error(
      "Pre-0016 historical snapshot SQL has an invalid statement count.",
    );
  }
  for (const statement of statements) {
    if (
      !/^SELECT\b/i.test(statement) ||
      /\b(?:UNION|INTERSECT|EXCEPT)\b/i.test(statement) ||
      /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i.test(
        statement,
      )
    ) {
      throw new Error(
        "Pre-0016 historical snapshot SQL must contain only simple read-only SELECT statements.",
      );
    }
  }
  if (/memory_vector_cleanup_outbox/.test(HISTORICAL_PRE_0016_SNAPSHOT_SQL)) {
    throw new Error(
      "Pre-0016 historical snapshot SQL must exclude the operational cleanup outbox.",
    );
  }

  const countStatements = statements.slice(
    0,
    HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT,
  );
  if (
    HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS.length !==
    HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT
  ) {
    throw new Error(
      "Pre-0016 historical snapshot canonical dataset plan is incomplete.",
    );
  }
  countStatements.forEach((statement, index) => {
    const datasetMatch =
      /^SELECT '([a-z0-9_]+)' AS dataset, count\(\*\) AS row_count\b/i.exec(
        statement,
      );
    const limitMatch = /\bLIMIT ([1-9][0-9]*)\)/i.exec(statement);
    const spec = HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS[index];
    if (
      !datasetMatch ||
      !limitMatch ||
      !spec ||
      datasetMatch[1] !== spec.name ||
      spec.name !== HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES[index]
    ) {
      throw new Error(
        "Pre-0016 historical snapshot count plan is incomplete or out of order.",
      );
    }
    const scanLimit = Number(limitMatch[1]);
    if (
      !Number.isSafeInteger(scanLimit) ||
      scanLimit !== spec.cap + 1
    ) {
      throw new Error(
        "Pre-0016 historical snapshot count plan has an invalid scan limit.",
      );
    }
  });

  const schemaStart = HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT;
  const schemaObjectStart =
    schemaStart + HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT;
  const identityStart =
    schemaObjectStart + HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT;
  const expectedSchemaTables = [
    ...new Set(
      HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS.map((spec) => spec.table),
    ),
  ];
  const schemaTables = statements
    .slice(schemaStart, schemaObjectStart)
    .map((statement) => {
      const match = /^SELECT '([a-z0-9_]+)' AS table_name,/i.exec(statement);
      if (!match?.[1]) {
        throw new Error(
          "Pre-0016 historical snapshot schema plan is incomplete.",
        );
      }
      return match[1];
    });
  if (
    new Set(schemaTables).size !== schemaTables.length ||
    stableStringify(schemaTables) !== stableStringify(expectedSchemaTables)
  ) {
    throw new Error(
      "Pre-0016 historical snapshot schema plan is incomplete or out of order.",
    );
  }

  const schemaObjectStatements = statements.slice(
    schemaObjectStart,
    identityStart,
  );
  const schemaObjectStatement = schemaObjectStatements[0] ?? "";
  if (
    schemaObjectStatements.length !==
      HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT ||
    !/\bFROM sqlite_master\b/i.test(schemaObjectStatement) ||
    !new RegExp(`\\bLIMIT ${HISTORICAL_SCHEMA_OBJECT_LIMIT + 1}$`, "i").test(
      schemaObjectStatement,
    ) ||
    !schemaObjectStatement.includes(
      `<= ${HISTORICAL_SCHEMA_OBJECT_SQL_MAX_BYTES}`,
    )
  ) {
    throw new Error(
      "Pre-0016 historical snapshot schema-object plan is not exactly bounded.",
    );
  }

  const identityStatements = statements.slice(identityStart);
  if (
    identityStatements.length !== HISTORICAL_PRE_0016_IDENTITY_RESULT_SET_COUNT ||
    identityStatements.some(
      (statement, index) =>
        statement !==
        HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS[index]?.identitySql.slice(
          0,
          -1,
        ),
    )
  ) {
    throw new Error(
      "Pre-0016 historical snapshot identity plan is incomplete or out of order.",
    );
  }

  return Object.freeze({
    statements: Object.freeze(statements),
    schemaTables: Object.freeze(schemaTables),
  });
}

function validateMeteredResultSet(
  entry: unknown,
  index: number,
): MeteredResultSet {
  if (!isRecord(entry) || entry.success !== true || !Array.isArray(entry.results)) {
    throw new Error(
      `Pre-0016 historical snapshot D1 result set ${index + 1} failed.`,
    );
  }
  if (!entry.results.every(isRecord)) {
    throw new Error(
      `Pre-0016 historical snapshot D1 result set ${index + 1} has malformed rows.`,
    );
  }
  const meta = isRecord(entry.meta) ? entry.meta : null;
  const rowsRead = nonnegativeInteger(meta?.rows_read);
  const rowsWritten = nonnegativeInteger(meta?.rows_written);
  const totalAttempts = nonnegativeInteger(meta?.total_attempts);
  if (rowsRead === null || rowsWritten === null) {
    throw new Error(
      `Pre-0016 historical snapshot D1 result set ${index + 1} lacks exact billing metadata.`,
    );
  }
  if (totalAttempts === null || totalAttempts < 1) {
    throw new Error(
      `Pre-0016 historical snapshot D1 result set ${index + 1} lacks valid automatic-attempt metadata.`,
    );
  }
  if (totalAttempts !== 1) {
    throw new Error(
      `Pre-0016 historical snapshot D1 result set ${index + 1} used ${totalAttempts} automatic attempts; the maximum billable-read reservation must remain unresolved and no capture may be published.`,
    );
  }
  if (rowsWritten !== 0) {
    throw new Error(
      `Pre-0016 historical snapshot D1 result set ${index + 1} unexpectedly wrote rows.`,
    );
  }
  return { rows: entry.results, rowsRead };
}

function parseDatasetCounts(
  resultSets: readonly MeteredResultSet[],
): Readonly<Record<HistoricalPre0016ProtectedDatasetName, number>> {
  const counts: Partial<
    Record<HistoricalPre0016ProtectedDatasetName, number>
  > = {};
  for (
    let index = 0;
    index < HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT;
    index += 1
  ) {
    const rows = resultSets[index]?.rows;
    const expectedDataset =
      HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES[index];
    const spec = HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS[index];
    if (
      !rows ||
      !expectedDataset ||
      !spec ||
      spec.name !== expectedDataset ||
      rows.length !== 1
    ) {
      throw new Error(
        "Pre-0016 historical snapshot count result cardinality is invalid.",
      );
    }
    const row = rows[0];
    if (
      !row ||
      !hasExactKeys(row, ["dataset", "row_count"]) ||
      row.dataset !== expectedDataset
    ) {
      throw new Error(
        "Pre-0016 historical snapshot count result order or shape is invalid.",
      );
    }
    const count = nonnegativeInteger(row.row_count);
    if (count === null || count > spec.cap) {
      throw new Error(
        `Pre-0016 historical snapshot ${expectedDataset} count exceeds its bounded plan.`,
      );
    }
    counts[expectedDataset] = count;
  }
  assertCompleteDatasetCounts(counts);
  return Object.freeze({ ...counts });
}

function parseSchemaResultSets(
  resultSets: readonly MeteredResultSet[],
): Readonly<Record<string, HistoricalColumnIdentity[]>> {
  const schemaStart = HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT;
  const schemas: Record<string, HistoricalColumnIdentity[]> = {};
  for (const [offset, expectedTable] of compiledSnapshotPlan.schemaTables.entries()) {
    const rows = resultSets[schemaStart + offset]?.rows;
    if (
      !rows ||
      rows.length === 0 ||
      rows.length > HISTORICAL_SCHEMA_COLUMN_LIMIT
    ) {
      throw new Error(
        "Pre-0016 historical snapshot schema result cardinality is invalid.",
      );
    }
    const columnNames = new Set<string>();
    const columns: HistoricalColumnIdentity[] = [];
    for (const row of rows) {
      const notNull = row.not_null === 0 || row.not_null === 1
        ? row.not_null
        : null;
      const primaryKey = nonnegativeInteger(row.primary_key);
      if (
        !hasExactKeys(row, [
          "table_name",
          "name",
          "type",
          "not_null",
          "primary_key",
        ]) ||
        row.table_name !== expectedTable ||
        typeof row.name !== "string" ||
        row.name.length === 0 ||
        typeof row.type !== "string" ||
        notNull === null ||
        primaryKey === null ||
        columnNames.has(row.name)
      ) {
        throw new Error(
          "Pre-0016 historical snapshot schema result order or shape is invalid.",
        );
      }
      columnNames.add(row.name);
      columns.push({
        name: row.name,
        type: row.type.toLowerCase(),
        notNull,
        primaryKey,
      });
    }
    schemas[expectedTable] = columns;
  }
  return Object.freeze(schemas);
}

function buildProtectedDatasetEvidence(
  resultSets: readonly MeteredResultSet[],
  counts: Readonly<Record<HistoricalPre0016ProtectedDatasetName, number>>,
  schemas: Readonly<Record<string, HistoricalColumnIdentity[]>>,
  schemaObjects: HistoricalGameResultsSchemaObjects,
  hmacSecret: string,
): Readonly<{
  datasets: Record<HistoricalDatasetName, HistoricalDatasetEvidence>;
  supplementalDatasets: Record<
    HistoricalSupplementalDatasetName,
    HistoricalDatasetEvidence
  >;
}> {
  const identityStart =
    HISTORICAL_PRE_0016_COUNT_RESULT_SET_COUNT +
    HISTORICAL_PRE_0016_SCHEMA_RESULT_SET_COUNT +
    HISTORICAL_PRE_0016_SCHEMA_OBJECT_RESULT_SET_COUNT;
  const datasets: Partial<
    Record<HistoricalDatasetName, HistoricalDatasetEvidence>
  > = {};
  const supplementalDatasets: Partial<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  > = {};
  for (
    let offset = 0;
    offset < HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS.length;
    offset += 1
  ) {
    const spec = HISTORICAL_PROTECTED_DATASET_SNAPSHOT_SPECS[offset];
    const rows = resultSets[identityStart + offset]?.rows;
    if (!spec || !rows) {
      throw new Error(
        "Pre-0016 historical snapshot identity result order is invalid.",
      );
    }
    const expectedRows = Math.min(counts[spec.name], HISTORICAL_SENTINEL_LIMIT);
    if (rows.length !== expectedRows) {
      throw new Error(
        `Pre-0016 historical snapshot ${spec.name} identity cardinality is invalid.`,
      );
    }
    const expectedKeys = Array.from(
      { length: spec.identityArity },
      (_, index) => `identity_${index + 1}`,
    );
    const identityHashes = new Set<string>();
    for (const row of rows) {
      if (!hasExactKeys(row, expectedKeys)) {
        throw new Error(
          `Pre-0016 historical snapshot ${spec.name} identity shape is invalid.`,
        );
      }
      const values: HistoricalIdentityValue[] = [];
      for (const key of expectedKeys) {
        const value = row[key];
        if (
          value !== null &&
          typeof value !== "string" &&
          !(typeof value === "number" && Number.isSafeInteger(value))
        ) {
          throw new Error(
            `Pre-0016 historical snapshot ${spec.name} identity contains an invalid value.`,
          );
        }
        values.push(value);
      }
      if (spec.name === "game_results") {
        assertHistoricalGameResultsIdentity(values);
      }
      const identityHash = historicalDataIdentityHmac(
        hmacSecret,
        spec.name,
        values,
      );
      if (identityHashes.has(identityHash)) {
        throw new Error(
          `Pre-0016 historical snapshot ${spec.name} contains duplicate stable identities.`,
        );
      }
      identityHashes.add(identityHash);
    }
    const schemaColumns = schemas[spec.table];
    if (!schemaColumns?.length) {
      throw new Error(
        `Pre-0016 historical snapshot schema is missing ${spec.table}.`,
      );
    }
    const columns = schemaColumns.map((column) => ({ ...column }));
    const sentinels = [...identityHashes];
    const evidence: HistoricalDatasetEvidence = {
      rowCount: counts[spec.name],
      schemaTable: spec.table,
      schemaSha256: historicalDataSchemaHash(columns),
      columns,
      sentinels,
      ...(spec.name === "game_results" ? { schemaObjects } : {}),
    };
    Object.freeze(columns);
    Object.freeze(sentinels);
    Object.freeze(evidence);
    if (isHistoricalCoreDatasetName(spec.name)) {
      datasets[spec.name] = evidence;
    } else if (isHistoricalSupplementalDatasetName(spec.name)) {
      supplementalDatasets[spec.name] = evidence;
    } else {
      throw new Error(
        "Pre-0016 historical snapshot canonical dataset plan is invalid.",
      );
    }
  }
  assertCompleteCoreDatasets(datasets);
  assertCompleteSupplementalDatasets(supplementalDatasets);
  return Object.freeze({
    datasets: Object.freeze({ ...datasets }),
    supplementalDatasets: Object.freeze({ ...supplementalDatasets }),
  });
}

function assertSourceIdentity(
  sourceIdentity: D1ReleaseSourceIdentity,
): asserts sourceIdentity is D1ReleaseSourceIdentity {
  if (!/^[a-f0-9]{64}$/.test(sourceIdentity.sha256)) {
    throw new Error(
      "Pre-0016 historical snapshot requires an exact source SHA-256.",
    );
  }
  if (
    !Number.isSafeInteger(sourceIdentity.fileCount) ||
    sourceIdentity.fileCount <= 0
  ) {
    throw new Error(
      "Pre-0016 historical snapshot requires a positive source file count.",
    );
  }
}

function assertCompleteDatasetCounts(
  counts: Partial<Record<HistoricalPre0016ProtectedDatasetName, number>>,
): asserts counts is Record<HistoricalPre0016ProtectedDatasetName, number> {
  for (const dataset of HISTORICAL_PRE_0016_PROTECTED_DATASET_NAMES) {
    if (counts[dataset] === undefined) {
      throw new Error(
        `Pre-0016 historical snapshot count result omitted ${dataset}.`,
      );
    }
  }
}

function assertCompleteCoreDatasets(
  datasets: Partial<Record<HistoricalDatasetName, HistoricalDatasetEvidence>>,
): asserts datasets is Record<HistoricalDatasetName, HistoricalDatasetEvidence> {
  for (const dataset of HISTORICAL_DATASET_NAMES) {
    if (!datasets[dataset]) {
      throw new Error(
        `Pre-0016 historical snapshot evidence omitted ${dataset}.`,
      );
    }
  }
}

function assertCompleteSupplementalDatasets(
  datasets: Partial<
    Record<HistoricalSupplementalDatasetName, HistoricalDatasetEvidence>
  >,
): asserts datasets is Record<
  HistoricalSupplementalDatasetName,
  HistoricalDatasetEvidence
> {
  for (const dataset of HISTORICAL_SUPPLEMENTAL_DATASET_NAMES) {
    if (!datasets[dataset]) {
      throw new Error(
        `Pre-0016 historical snapshot evidence omitted ${dataset}.`,
      );
    }
  }
}

function isHistoricalCoreDatasetName(
  value: HistoricalPre0016ProtectedDatasetName,
): value is HistoricalDatasetName {
  return HISTORICAL_DATASET_NAMES.some((name) => name === value);
}

function isHistoricalSupplementalDatasetName(
  value: HistoricalPre0016ProtectedDatasetName,
): value is HistoricalSupplementalDatasetName {
  return HISTORICAL_SUPPLEMENTAL_DATASET_NAMES.some(
    (name) => name === value,
  );
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first < 0 || last <= first) {
      throw new Error(
        "Pre-0016 historical snapshot could not parse Wrangler JSON.",
      );
    }
    try {
      return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
    } catch {
      throw new Error(
        "Pre-0016 historical snapshot could not parse Wrangler JSON.",
      );
    }
  }
}

function safeAddRows(current: number, addition: number) {
  if (current > Number.MAX_SAFE_INTEGER - addition) {
    throw new Error("Pre-0016 historical snapshot rows-read metadata overflowed.");
  }
  return current + addition;
}

function hasExactKeys(
  row: Record<string, unknown>,
  expected: readonly string[],
) {
  const actual = Object.keys(row).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
