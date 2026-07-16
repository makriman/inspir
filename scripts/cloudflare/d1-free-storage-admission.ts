import {
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  type WranglerRunner,
} from "./migration-config";

export const D1_FREE_MAX_DATABASE_BYTES = 500_000_000;
export const D1_FREE_STORAGE_SAFETY_MARGIN_BYTES = 50_000_000;
export const D1_FREE_STORAGE_ADMISSION_CEILING_BYTES =
  D1_FREE_MAX_DATABASE_BYTES - D1_FREE_STORAGE_SAFETY_MARGIN_BYTES;
export const D1_MAX_ROW_BYTES = 2_000_000;

const maximumD1InfoOutputBytes = 1 * 1024 * 1024;
const sqliteRecordHeaderReserveBytes = 128;
const sqliteIndexEntryOverheadBytes = 64;
const fixedImportStorageReserveBytes = 16 * 1024 * 1024;
const storageGrowthOverheadNumerator = 3;
const storageGrowthOverheadDenominator = 2;
const d1DatabaseUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type D1DatabaseStorageInfo = Readonly<{
  databaseName: string;
  databaseUuid: string;
  databaseSizeBytes: number;
  tableCount: number;
}>;

export type D1TranslationStorageRow = Readonly<{
  namespace: string;
  language: string;
  sourceHash: string;
  payloadJson: string;
  model: string;
}>;

export type D1SourceStorageEntry = Readonly<{
  namespace: string;
  sourceHash: string;
  sourceStrings: Readonly<Record<string, string>>;
}>;

export type D1TranslationRowStorageMeasurement = Readonly<{
  rowBytes: number;
  indexBytes: number;
  persistentBytes: number;
}>;

export type D1StorageAdmissionProjection = Readonly<{
  databaseName: string;
  databaseUuid: string;
  currentTableCount: number;
  currentDatabaseBytes: number;
  plannedTranslationRows: number;
  plannedTranslationRowBytes: number;
  plannedTranslationIndexBytes: number;
  plannedSourceRows: number;
  plannedSourceRowAndIndexBytes: number;
  plannedSourceMaximumRowBytes: number;
  plannedPersistentBytes: number;
  projectedGrowthBytes: number;
  fixedImportReserveBytes: number;
  projectedFinalDatabaseBytes: number;
  freeDatabaseLimitBytes: number;
  safetyMarginBytes: number;
  admissionCeilingBytes: number;
  admissible: boolean;
}>;

export function d1DatabaseInfoArgs(databaseName = D1_DATABASE_NAME) {
  assertNonEmptyText(databaseName, "D1 database name");
  return ["d1", "info", databaseName, "--json"] as const;
}

export function readD1DatabaseStorageInfo(
  runner: WranglerRunner,
  databaseName = D1_DATABASE_NAME,
  databaseUuid = D1_DATABASE_ID,
): D1DatabaseStorageInfo {
  return parseD1DatabaseStorageInfo(
    runner([...d1DatabaseInfoArgs(databaseName)], {
      maxBuffer: maximumD1InfoOutputBytes,
    }),
    databaseName,
    databaseUuid,
  );
}

export function parseD1DatabaseStorageInfo(
  output: string,
  expectedDatabaseName = D1_DATABASE_NAME,
  expectedDatabaseUuid = D1_DATABASE_ID,
): D1DatabaseStorageInfo {
  if (Buffer.byteLength(output, "utf8") > maximumD1InfoOutputBytes) {
    throw new Error("Wrangler D1 info output exceeded its bounded parser limit.");
  }
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch {
    throw new Error("Wrangler D1 info did not return deterministic JSON.");
  }
  if (!isRecord(value)) {
    throw new Error("Wrangler D1 info returned a non-object payload.");
  }
  if (
    !d1DatabaseUuidPattern.test(expectedDatabaseUuid) ||
    expectedDatabaseUuid.toLowerCase() !== D1_DATABASE_ID
  ) {
    throw new Error("D1 storage admission requires the configured production database UUID.");
  }
  if (
    value.name !== expectedDatabaseName ||
    typeof value.uuid !== "string" ||
    !d1DatabaseUuidPattern.test(value.uuid) ||
    value.uuid.toLowerCase() !== expectedDatabaseUuid.toLowerCase() ||
    !isNonNegativeSafeInteger(value.database_size) ||
    !isNonNegativeSafeInteger(value.num_tables)
  ) {
    throw new Error("Wrangler D1 info returned malformed storage metadata.");
  }
  return {
    databaseName: value.name,
    databaseUuid: value.uuid.toLowerCase(),
    databaseSizeBytes: value.database_size,
    tableCount: value.num_tables,
  };
}

export function measureD1TranslationStorageRow(
  row: D1TranslationStorageRow,
): D1TranslationRowStorageMeasurement {
  assertNonEmptyText(row.namespace, "translation namespace");
  assertNonEmptyText(row.language, "translation language");
  assertNonEmptyText(row.sourceHash, "translation source hash");
  assertNonEmptyText(row.payloadJson, "translation payload JSON");
  assertNonEmptyText(row.model, "translation model");
  const rowBytes =
    utf8Bytes(row.namespace) +
    utf8Bytes(row.language) +
    utf8Bytes(row.sourceHash) +
    utf8Bytes(row.payloadJson) +
    utf8Bytes(row.model) +
    // created_at and updated_at are two SQLite INTEGER values. Reserve the
    // full eight bytes for each even though current epoch milliseconds need
    // fewer bytes in SQLite's record encoding.
    16 +
    sqliteRecordHeaderReserveBytes;
  if (rowBytes > D1_MAX_ROW_BYTES) {
    throw new Error(
      `D1 translation row exceeds the ${D1_MAX_ROW_BYTES}-byte row limit for ` +
        `${row.namespace}/${row.language}: ${rowBytes} bytes.`,
    );
  }
  const indexBytes =
    // SQLite stores the composite PRIMARY KEY in one auto-index and the
    // schema also owns app_translations_language_idx. Account for both exact
    // key payloads plus a conservative entry header/rowid reserve per index.
    utf8Bytes(row.namespace) +
    utf8Bytes(row.language) +
    sqliteIndexEntryOverheadBytes +
    utf8Bytes(row.language) +
    sqliteIndexEntryOverheadBytes;
  return { rowBytes, indexBytes, persistentBytes: rowBytes + indexBytes };
}

export function measureD1SourceSnapshotStorage(
  entries: readonly D1SourceStorageEntry[],
) {
  let rows = 0;
  let persistentBytes = 0;
  let maximumRowBytes = 0;
  const namespaces = new Set<string>();
  for (const entry of entries) {
    assertNonEmptyText(entry.namespace, "source namespace");
    assertNonEmptyText(entry.sourceHash, "source hash");
    if (namespaces.has(entry.namespace)) {
      throw new Error(`Duplicate D1 source namespace ${entry.namespace}.`);
    }
    namespaces.add(entry.namespace);
    rows += 1;
    const sourceRowBytes =
      utf8Bytes(entry.namespace) +
      utf8Bytes(entry.sourceHash) +
      8 +
      sqliteRecordHeaderReserveBytes;
    assertD1SourceRowSize(sourceRowBytes, `${entry.namespace} source manifest`);
    maximumRowBytes = Math.max(maximumRowBytes, sourceRowBytes);
    persistentBytes +=
      sourceRowBytes +
      utf8Bytes(entry.namespace) +
      sqliteIndexEntryOverheadBytes;
    for (const [key, sourceText] of Object.entries(entry.sourceStrings)) {
      assertNonEmptyText(key, `source key for ${entry.namespace}`);
      if (typeof sourceText !== "string") {
        throw new Error(`Source text for ${entry.namespace}/${key} is invalid.`);
      }
      rows += 1;
      const sourceStringRowBytes =
        utf8Bytes(entry.namespace) +
        utf8Bytes(key) +
        utf8Bytes(sourceText) +
        sqliteRecordHeaderReserveBytes;
      assertD1SourceRowSize(
        sourceStringRowBytes,
        `${entry.namespace}/${key} source string`,
      );
      maximumRowBytes = Math.max(maximumRowBytes, sourceStringRowBytes);
      persistentBytes +=
        sourceStringRowBytes +
        utf8Bytes(entry.namespace) +
        utf8Bytes(key) +
        sqliteIndexEntryOverheadBytes;
      assertNonNegativeSafeInteger(persistentBytes, "planned D1 source storage bytes");
    }
  }
  return { rows, persistentBytes, maximumRowBytes } as const;
}

export function projectD1FreeStorageAdmission(input: {
  database: D1DatabaseStorageInfo;
  translationRows: readonly D1TranslationStorageRow[];
  sourceEntries: readonly D1SourceStorageEntry[];
}): D1StorageAdmissionProjection {
  assertD1DatabaseStorageInfo(input.database);
  const translationMeasurements = input.translationRows.map(
    measureD1TranslationStorageRow,
  );
  const plannedTranslationRowBytes = translationMeasurements.reduce(
    (total, measurement) => total + measurement.rowBytes,
    0,
  );
  const plannedTranslationIndexBytes = translationMeasurements.reduce(
    (total, measurement) => total + measurement.indexBytes,
    0,
  );
  const sources = measureD1SourceSnapshotStorage(input.sourceEntries);
  const plannedPersistentBytes =
    plannedTranslationRowBytes +
    plannedTranslationIndexBytes +
    sources.persistentBytes;
  assertNonNegativeSafeInteger(plannedPersistentBytes, "planned D1 persistent bytes");
  const projectedGrowthBytes =
    Math.ceil(
      (plannedPersistentBytes * storageGrowthOverheadNumerator) /
        storageGrowthOverheadDenominator,
    ) + fixedImportStorageReserveBytes;
  assertNonNegativeSafeInteger(projectedGrowthBytes, "projected D1 storage growth");
  const projectedFinalDatabaseBytes =
    input.database.databaseSizeBytes + projectedGrowthBytes;
  assertNonNegativeSafeInteger(projectedFinalDatabaseBytes, "projected final D1 size");
  const admissible =
    projectedFinalDatabaseBytes <= D1_FREE_STORAGE_ADMISSION_CEILING_BYTES;
  return {
    databaseName: input.database.databaseName,
    databaseUuid: input.database.databaseUuid,
    currentTableCount: input.database.tableCount,
    currentDatabaseBytes: input.database.databaseSizeBytes,
    plannedTranslationRows: input.translationRows.length,
    plannedTranslationRowBytes,
    plannedTranslationIndexBytes,
    plannedSourceRows: sources.rows,
    plannedSourceRowAndIndexBytes: sources.persistentBytes,
    plannedSourceMaximumRowBytes: sources.maximumRowBytes,
    plannedPersistentBytes,
    projectedGrowthBytes,
    fixedImportReserveBytes: fixedImportStorageReserveBytes,
    projectedFinalDatabaseBytes,
    freeDatabaseLimitBytes: D1_FREE_MAX_DATABASE_BYTES,
    safetyMarginBytes: D1_FREE_STORAGE_SAFETY_MARGIN_BYTES,
    admissionCeilingBytes: D1_FREE_STORAGE_ADMISSION_CEILING_BYTES,
    admissible,
  };
}

function assertD1SourceRowSize(rowBytes: number, label: string) {
  if (rowBytes > D1_MAX_ROW_BYTES) {
    throw new Error(
      `D1 source row exceeds the ${D1_MAX_ROW_BYTES}-byte row limit for ${label}: ` +
        `${rowBytes} bytes.`,
    );
  }
}

export function assertD1FreeStorageAdmission(
  projection: D1StorageAdmissionProjection,
) {
  if (!projection.admissible) {
    throw new Error(
      "Projected D1 database size exceeds the Workers Free storage safety ceiling: " +
        `${projection.projectedFinalDatabaseBytes} > ${projection.admissionCeilingBytes} bytes ` +
        `(the ${projection.freeDatabaseLimitBytes}-byte platform limit retains a ` +
        `${projection.safetyMarginBytes}-byte safety margin).`,
    );
  }
  return projection;
}

function assertD1DatabaseStorageInfo(
  database: D1DatabaseStorageInfo,
) {
  if (
    typeof database.databaseName !== "string" ||
    database.databaseName !== D1_DATABASE_NAME ||
    typeof database.databaseUuid !== "string" ||
    database.databaseUuid.toLowerCase() !== D1_DATABASE_ID ||
    !isNonNegativeSafeInteger(database.databaseSizeBytes) ||
    !isNonNegativeSafeInteger(database.tableCount)
  ) {
    throw new Error(
      "D1 storage admission metadata does not identify the configured production database.",
    );
  }
  return database;
}

function utf8Bytes(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function assertNonEmptyText(value: string, label: string): asserts value is string {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new Error(`${label} must be non-empty text without NUL bytes.`);
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function assertNonNegativeSafeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
