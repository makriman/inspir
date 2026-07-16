import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertD1FreeDailyBudget,
  D1_FREE_SAFE_ROWS_READ_LIMIT,
  D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
  loadAccountD1DailyUsage,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
  d1ReleaseBudgetLedgerPath,
  readPrivateJsonNoFollow,
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
  type D1ReleaseBudgetReservationResult,
  type D1ReleaseSourceIdentity,
} from "./d1-release-budget-ledger";
import {
  D1_FREE_MAX_DATABASE_BYTES,
  D1_FREE_STORAGE_ADMISSION_CEILING_BYTES,
  D1_FREE_STORAGE_SAFETY_MARGIN_BYTES,
  readD1DatabaseStorageInfo,
  type D1DatabaseStorageInfo,
} from "./d1-free-storage-admission";
import {
  D1_RUNTIME_PRE_0016_VERIFICATION_BILLABLE_ROWS_READ,
} from "./d1-runtime-pre-0016-state";
import {
  cloudflareDir,
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  hasFlag,
  resolveBackupDir,
  runWrangler,
  type WranglerRunner,
} from "./migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import {
  assertProductionReleaseChildExclusion,
  canonicalProductionValidationLockOwner,
  parseStoredProductionValidationLockOwner,
  type ProductionValidationLockOwner,
} from "./production-validation-lock";

export const RUNTIME_MIGRATION_0017_FILE =
  "drizzle-d1/0017_users_normalized_email_lookup.sql" as const;
const RUNTIME_MIGRATION_0017_BUDGET_KIND =
  "d1-runtime-migration-0017-budget" as const;
export const RUNTIME_MIGRATION_0017_BUDGET_REPORT =
  "d1-runtime-migration-0017-budget.json" as const;
export const RUNTIME_MIGRATION_0017_OPERATION_ID =
  "d1-runtime-migration-0017" as const;
export const RUNTIME_MIGRATION_0017_OPERATION =
  "Production D1 runtime migration 0017" as const;
const RUNTIME_MIGRATION_0017_BUDGET_MAX_AGE_MS = 15 * 60 * 1_000;
export const RUNTIME_MIGRATION_0017_MAX_USERS = 16_000;
export const RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ = 125_000;
export const RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN = 50_000;
const RUNTIME_MIGRATION_0017_INDEX_BUILD_READS_PER_USER = 4;
const RUNTIME_MIGRATION_0017_INDEX_BUILD_WRITES_PER_USER = 3;
const RUNTIME_MIGRATION_0017_FIXED_DDL_ROWS_READ = 1_000;
const RUNTIME_MIGRATION_0017_FIXED_DDL_ROWS_WRITTEN = 16;
export const RUNTIME_MIGRATION_0017_VERIFICATION_LOGICAL_ROWS_READ_LIMIT =
  256 as const;
const RUNTIME_MIGRATION_0017_VERIFICATION_MAX_AUTOMATIC_ATTEMPTS =
  3 as const;
export const RUNTIME_MIGRATION_0017_VERIFICATION_BILLABLE_ROWS_READ =
  RUNTIME_MIGRATION_0017_VERIFICATION_LOGICAL_ROWS_READ_LIMIT *
  RUNTIME_MIGRATION_0017_VERIFICATION_MAX_AUTOMATIC_ATTEMPTS;
const RUNTIME_MIGRATION_0017_APPLY_VERIFICATION_CALLS = 2 as const;
export const RUNTIME_MIGRATION_0017_FIXED_STORAGE_RESERVE_BYTES = 4 * 1024 * 1024;
export const RUNTIME_MIGRATION_0017_INDEX_ENTRY_OVERHEAD_BYTES = 192;
const RUNTIME_MIGRATION_0017_MAX_USER_ID_UTF8_BYTES_PER_ROW = 512;
const RUNTIME_MIGRATION_0017_MAX_EMAIL_UTF8_BYTES_PER_ROW = 1_280;
export const RUNTIME_MIGRATION_0017_MAX_USER_ID_UTF8_BYTES =
  RUNTIME_MIGRATION_0017_MAX_USERS *
  RUNTIME_MIGRATION_0017_MAX_USER_ID_UTF8_BYTES_PER_ROW;
export const RUNTIME_MIGRATION_0017_MAX_EMAIL_UTF8_BYTES =
  RUNTIME_MIGRATION_0017_MAX_USERS *
  RUNTIME_MIGRATION_0017_MAX_EMAIL_UTF8_BYTES_PER_ROW;

const cardinalityLimit = RUNTIME_MIGRATION_0017_MAX_USERS + 1;
const maximumCardinalityOutputBytes = 1 * 1024 * 1024;

const RUNTIME_MIGRATION_0017_CARDINALITY_SQL = `
WITH bounded_users AS (
  SELECT id, email
  FROM users
  ORDER BY id
  LIMIT ${cardinalityLimit}
)
SELECT
  count(*) AS users,
  coalesce(sum(length(cast(id AS blob))), 0) AS id_utf8_bytes,
  coalesce(sum(length(cast(email AS blob))), 0) AS email_utf8_bytes
FROM bounded_users;
`.trim();

export type RuntimeMigration0017Cardinalities = Readonly<{
  users: number;
  idUtf8Bytes: number;
  emailUtf8Bytes: number;
}>;

export type RuntimeMigration0017CardinalityResult = Readonly<{
  cardinalities: RuntimeMigration0017Cardinalities;
  rowsRead: number;
  rowsWritten: 0;
  totalAttempts: 1;
}>;

export type RuntimeMigration0017Projection = Readonly<{
  rowsRead: number;
  rowsWritten: number;
  cardinalityRowsRead: number;
  writeAdmissionCardinalityRowsRead: number;
  pre0016RuntimeStateRowsRead: number;
  indexBuildRowsRead: number;
  indexBuildRowsWritten: number;
  fixedDdlRowsRead: number;
  fixedDdlRowsWritten: number;
  migration0017VerificationRowsRead: number;
}>;

export type RuntimeMigration0017StorageProjection = Readonly<{
  databaseName: typeof D1_DATABASE_NAME;
  databaseUuid: typeof D1_DATABASE_ID;
  currentTableCount: number;
  currentDatabaseBytes: number;
  users: number;
  idUtf8Bytes: number;
  emailUtf8Bytes: number;
  indexEntryOverheadBytes: number;
  plannedPersistentBytes: number;
  projectedGrowthBytes: number;
  fixedStorageReserveBytes: number;
  projectedFinalDatabaseBytes: number;
  freeDatabaseLimitBytes: typeof D1_FREE_MAX_DATABASE_BYTES;
  safetyMarginBytes: typeof D1_FREE_STORAGE_SAFETY_MARGIN_BYTES;
  admissionCeilingBytes: typeof D1_FREE_STORAGE_ADMISSION_CEILING_BYTES;
  admissible: boolean;
}>;

export type RuntimeMigration0017BudgetReport = Readonly<{
  kind: typeof RUNTIME_MIGRATION_0017_BUDGET_KIND;
  schemaVersion: 3;
  createdAt: string;
  utcDay: string;
  ok: true;
  exact: false;
  reservationPhase: "maximum";
  operation: typeof RUNTIME_MIGRATION_0017_OPERATION;
  operationId: typeof RUNTIME_MIGRATION_0017_OPERATION_ID;
  backupDir: string;
  database: {
    id: typeof D1_DATABASE_ID;
    name: typeof D1_DATABASE_NAME;
  };
  safeDailyLimits: {
    rowsRead: typeof D1_FREE_SAFE_ROWS_READ_LIMIT;
    rowsWritten: typeof D1_FREE_SAFE_ROWS_WRITTEN_LIMIT;
  };
  usage: D1DailyUsage;
  cardinalities: RuntimeMigration0017Cardinalities;
  projection: RuntimeMigration0017Projection;
  storage: RuntimeMigration0017StorageProjection;
  after: { rowsReadAfter: number; rowsWrittenAfter: number };
  sourceFingerprintBefore: SourceFingerprint;
  sourceFingerprint: SourceFingerprint;
  sourceFingerprintStable: true;
  productionExclusionOwner: string;
  ledger: D1ReleaseBudgetReservationResult;
}>;

export type RuntimeMigration0017BudgetEvidence = Readonly<{
  createdAt: string;
  utcDay: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  usage: D1DailyUsage;
  cardinalities: RuntimeMigration0017Cardinalities;
  projection: RuntimeMigration0017Projection;
  storage: RuntimeMigration0017StorageProjection;
  productionExclusionOwner: string;
  ledgerPath: string;
}>;

export type RuntimeMigration0017BudgetOptions = Readonly<{
  backupDir: string;
  exclusionOwner: ProductionValidationLockOwner;
  cwd?: string;
  runner?: WranglerRunner;
  clock?: () => Date;
  usageLoader?: (
    now: Date,
    runner: WranglerRunner,
    clock: () => Date,
  ) => D1DailyUsage;
  cardinalityLoader?: (runner: WranglerRunner) => RuntimeMigration0017CardinalityResult;
  storageLoader?: (runner: WranglerRunner) => D1DatabaseStorageInfo;
}>;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!hasFlag("--confirm-production")) {
    throw new Error("The production D1 migration 0017 budget check requires --confirm-production.");
  }
  const backupDir = resolveBackupDir();
  const exclusion = assertProductionReleaseChildExclusion(
    "apply-d1-runtime-migration-0017",
  );
  const report = runRuntimeMigration0017BudgetCheck({
    backupDir,
    exclusionOwner: exclusion.owner,
  });
  const reportPath = writeRuntimeMigration0017BudgetReport(backupDir, report);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}

export function runRuntimeMigration0017BudgetCheck(
  options: RuntimeMigration0017BudgetOptions,
): RuntimeMigration0017BudgetReport {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDir = path.resolve(options.backupDir);
  const runner = options.runner ?? runWrangler;
  const clock = options.clock ?? (() => new Date());
  const startedAt = validDate(clock(), "0017 budget check start");
  const utcDay = startedAt.toISOString().slice(0, 10);
  const sourceFingerprintBefore = buildRepoSourceFingerprint(cwd);
  const productionExclusionOwner = canonicalProductionValidationLockOwner(
    options.exclusionOwner,
  );
  const admittedExclusionOwner = parseStoredProductionValidationLockOwner(
    productionExclusionOwner,
  );
  if (admittedExclusionOwner.sourceFingerprintSha256 !== sourceFingerprintBefore.sha256) {
    throw new Error("D1 migration 0017 budget exclusion is bound to another source fingerprint.");
  }
  const usage = (options.usageLoader ?? loadAccountD1DailyUsage)(startedAt, runner, clock);

  const ledger = reserveD1ReleaseBudget({
    backupDir,
    operationId: RUNTIME_MIGRATION_0017_OPERATION_ID,
    operation: RUNTIME_MIGRATION_0017_OPERATION,
    sourceFingerprint: compactFingerprint(sourceFingerprintBefore),
    candidateVersionId: admittedExclusionOwner.candidateVersionId,
    phase: "maximum",
    rowsRead: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
    rowsWritten: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
    observedUsage: usage,
    now: startedAt,
    expectedUtcDay: utcDay,
  });

  assertD1FreeDailyBudget(usage, {
    operation: `${RUNTIME_MIGRATION_0017_OPERATION} bounded cardinality preflight`,
    rowsRead: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
    rowsWritten: 0,
  });
  const measured = (options.cardinalityLoader ?? loadRuntimeMigration0017Cardinalities)(runner);
  const projection = projectRuntimeMigration0017Usage(measured);
  const database = (options.storageLoader ?? readD1DatabaseStorageInfo)(runner);
  const storage = projectRuntimeMigration0017MaximumStorage(database);
  assertRuntimeMigration0017StorageAdmission(storage);
  const after = assertD1FreeDailyBudget(usage, {
    operation: RUNTIME_MIGRATION_0017_OPERATION,
    rowsRead: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
    rowsWritten: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
  });
  assertSameFingerprint(sourceFingerprintBefore, buildRepoSourceFingerprint(cwd));
  const sourceFingerprint = buildRepoSourceFingerprint(cwd);
  assertSameFingerprint(sourceFingerprintBefore, sourceFingerprint);
  const completedAt = validDate(clock(), "0017 budget check completion");
  assertD1ReleaseBudgetUtcDay(utcDay, completedAt);
  return {
    kind: RUNTIME_MIGRATION_0017_BUDGET_KIND,
    schemaVersion: 3,
    createdAt: completedAt.toISOString(),
    utcDay,
    ok: true,
    exact: false,
    reservationPhase: "maximum",
    operation: RUNTIME_MIGRATION_0017_OPERATION,
    operationId: RUNTIME_MIGRATION_0017_OPERATION_ID,
    backupDir,
    database: { id: D1_DATABASE_ID, name: D1_DATABASE_NAME },
    safeDailyLimits: {
      rowsRead: D1_FREE_SAFE_ROWS_READ_LIMIT,
      rowsWritten: D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
    },
    usage,
    cardinalities: measured.cardinalities,
    projection,
    storage,
    after,
    sourceFingerprintBefore,
    sourceFingerprint,
    sourceFingerprintStable: true,
    productionExclusionOwner,
    ledger,
  };
}

export function loadRuntimeMigration0017Cardinalities(
  runner: WranglerRunner = runWrangler,
): RuntimeMigration0017CardinalityResult {
  const output = runner(
    [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--remote",
      "--json",
      "--command",
      RUNTIME_MIGRATION_0017_CARDINALITY_SQL,
    ],
    { maxBuffer: maximumCardinalityOutputBytes },
  );
  const value = parseJsonArray(output, "D1 migration 0017 cardinality query");
  if (value.length !== 1) {
    throw new Error("D1 migration 0017 cardinality query returned an invalid result set.");
  }
  const result = requiredRecord(value[0], "D1 migration 0017 cardinality result");
  if (!Array.isArray(result.results) || result.results.length !== 1) {
    throw new Error("D1 migration 0017 cardinality query returned an invalid row count.");
  }
  const row = requiredRecord(result.results[0], "D1 migration 0017 cardinality row");
  const meta = requiredRecord(result.meta, "D1 migration 0017 cardinality metadata");
  const cardinalities = {
    users: nonNegativeInteger(row.users, "0017 user cardinality"),
    idUtf8Bytes: nonNegativeInteger(row.id_utf8_bytes, "0017 user ID bytes"),
    emailUtf8Bytes: nonNegativeInteger(row.email_utf8_bytes, "0017 email bytes"),
  };
  if (cardinalities.users > RUNTIME_MIGRATION_0017_MAX_USERS) {
    throw new Error(
      `D1 migration 0017 user cardinality exceeds its Free-plan safety cap: ${cardinalities.users} > ${RUNTIME_MIGRATION_0017_MAX_USERS}.`,
    );
  }
  if (cardinalities.users === 0 && (cardinalities.idUtf8Bytes !== 0 || cardinalities.emailUtf8Bytes !== 0)) {
    throw new Error("D1 migration 0017 cardinality bytes are inconsistent with an empty users table.");
  }
  const rowsRead = nonNegativeInteger(meta.rows_read, "0017 cardinality rows read");
  const rowsWritten = nonNegativeInteger(meta.rows_written, "0017 cardinality rows written");
  const totalAttempts = nonNegativeInteger(meta.total_attempts, "0017 cardinality attempts");
  if (rowsRead > cardinalityLimit) {
    throw new Error("D1 migration 0017 cardinality query exceeded its bounded logical read count.");
  }
  if (rowsWritten !== 0 || totalAttempts !== 1) {
    throw new Error("D1 migration 0017 cardinality query must be read-only in exactly one attempt.");
  }
  return { cardinalities, rowsRead, rowsWritten: 0, totalAttempts: 1 };
}

export function projectRuntimeMigration0017Usage(
  measured: RuntimeMigration0017CardinalityResult,
): RuntimeMigration0017Projection {
  if (measured.rowsWritten !== 0 || measured.totalAttempts !== 1) {
    throw new Error("D1 migration 0017 projection requires one read-only cardinality attempt.");
  }
  const users = boundedUsers(measured.cardinalities.users);
  const cardinalityRowsRead = boundedInteger(
    measured.rowsRead,
    0,
    cardinalityLimit,
    "0017 cardinality rows read",
  );
  const indexBuildRowsRead = safeMultiply(
    users,
    RUNTIME_MIGRATION_0017_INDEX_BUILD_READS_PER_USER,
    "0017 index-build rows read",
  );
  const indexBuildRowsWritten = safeMultiply(
    users,
    RUNTIME_MIGRATION_0017_INDEX_BUILD_WRITES_PER_USER,
    "0017 index-build rows written",
  );
  const rowsRead = safeSum([
    cardinalityRowsRead,
    cardinalityLimit,
    D1_RUNTIME_PRE_0016_VERIFICATION_BILLABLE_ROWS_READ,
    indexBuildRowsRead,
    RUNTIME_MIGRATION_0017_FIXED_DDL_ROWS_READ,
    RUNTIME_MIGRATION_0017_APPLY_VERIFICATION_CALLS *
      RUNTIME_MIGRATION_0017_VERIFICATION_BILLABLE_ROWS_READ,
  ]);
  const rowsWritten = safeSum([
    indexBuildRowsWritten,
    RUNTIME_MIGRATION_0017_FIXED_DDL_ROWS_WRITTEN,
  ]);
  if (
    rowsRead > RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ ||
    rowsWritten > RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN
  ) {
    throw new Error("D1 migration 0017 projection exceeds its pre-reserved Free-plan envelope.");
  }
  return {
    rowsRead,
    rowsWritten,
    cardinalityRowsRead,
    writeAdmissionCardinalityRowsRead: cardinalityLimit,
    pre0016RuntimeStateRowsRead:
      D1_RUNTIME_PRE_0016_VERIFICATION_BILLABLE_ROWS_READ,
    indexBuildRowsRead,
    indexBuildRowsWritten,
    fixedDdlRowsRead: RUNTIME_MIGRATION_0017_FIXED_DDL_ROWS_READ,
    fixedDdlRowsWritten: RUNTIME_MIGRATION_0017_FIXED_DDL_ROWS_WRITTEN,
    migration0017VerificationRowsRead:
      RUNTIME_MIGRATION_0017_APPLY_VERIFICATION_CALLS *
      RUNTIME_MIGRATION_0017_VERIFICATION_BILLABLE_ROWS_READ,
  };
}

export function projectRuntimeMigration0017Storage(
  cardinalities: RuntimeMigration0017Cardinalities,
  database: D1DatabaseStorageInfo,
): RuntimeMigration0017StorageProjection {
  const users = boundedUsers(cardinalities.users);
  const idUtf8Bytes = nonNegativeInteger(cardinalities.idUtf8Bytes, "0017 user ID bytes");
  const emailUtf8Bytes = nonNegativeInteger(cardinalities.emailUtf8Bytes, "0017 email bytes");
  if (
    database.databaseName !== D1_DATABASE_NAME ||
    database.databaseUuid !== D1_DATABASE_ID ||
    !Number.isSafeInteger(database.databaseSizeBytes) ||
    database.databaseSizeBytes < 0 ||
    !Number.isSafeInteger(database.tableCount) ||
    database.tableCount < 0
  ) {
    throw new Error("D1 migration 0017 storage metadata identifies the wrong production database.");
  }
  const plannedPersistentBytes = safeSum([
    idUtf8Bytes,
    safeMultiply(emailUtf8Bytes, 2, "0017 normalized and original email bytes"),
    safeMultiply(users, RUNTIME_MIGRATION_0017_INDEX_ENTRY_OVERHEAD_BYTES, "0017 index entry overhead"),
  ]);
  const projectedGrowthBytes = safeSum([
    safeMultiply(plannedPersistentBytes, 2, "0017 transient index-build storage reserve"),
    RUNTIME_MIGRATION_0017_FIXED_STORAGE_RESERVE_BYTES,
  ]);
  const projectedFinalDatabaseBytes = safeSum([
    database.databaseSizeBytes,
    projectedGrowthBytes,
  ]);
  return {
    databaseName: D1_DATABASE_NAME,
    databaseUuid: D1_DATABASE_ID,
    currentTableCount: database.tableCount,
    currentDatabaseBytes: database.databaseSizeBytes,
    users,
    idUtf8Bytes,
    emailUtf8Bytes,
    indexEntryOverheadBytes: RUNTIME_MIGRATION_0017_INDEX_ENTRY_OVERHEAD_BYTES,
    plannedPersistentBytes,
    projectedGrowthBytes,
    fixedStorageReserveBytes: RUNTIME_MIGRATION_0017_FIXED_STORAGE_RESERVE_BYTES,
    projectedFinalDatabaseBytes,
    freeDatabaseLimitBytes: D1_FREE_MAX_DATABASE_BYTES,
    safetyMarginBytes: D1_FREE_STORAGE_SAFETY_MARGIN_BYTES,
    admissionCeilingBytes: D1_FREE_STORAGE_ADMISSION_CEILING_BYTES,
    admissible: projectedFinalDatabaseBytes <= D1_FREE_STORAGE_ADMISSION_CEILING_BYTES,
  };
}

export function projectRuntimeMigration0017MaximumStorage(
  database: D1DatabaseStorageInfo,
) {
  return projectRuntimeMigration0017Storage(
    {
      users: RUNTIME_MIGRATION_0017_MAX_USERS,
      idUtf8Bytes: RUNTIME_MIGRATION_0017_MAX_USER_ID_UTF8_BYTES,
      emailUtf8Bytes: RUNTIME_MIGRATION_0017_MAX_EMAIL_UTF8_BYTES,
    },
    database,
  );
}

export function assertRuntimeMigration0017StorageAdmission(
  projection: RuntimeMigration0017StorageProjection,
) {
  if (!projection.admissible) {
    throw new Error(
      `D1 migration 0017 would exceed the Free storage safety ceiling: ${projection.projectedFinalDatabaseBytes} > ${projection.admissionCeilingBytes} bytes.`,
    );
  }
  return projection;
}

export function writeRuntimeMigration0017BudgetReport(
  backupDir: string,
  report: RuntimeMigration0017BudgetReport,
) {
  const reportPath = runtimeMigration0017BudgetReportPath(backupDir);
  writePrivateJsonDurably(reportPath, report, { replace: fs.existsSync(reportPath) });
  return reportPath;
}

export function runtimeMigration0017BudgetReportPath(backupDir: string) {
  return path.join(
    cloudflareDir(path.resolve(backupDir)),
    RUNTIME_MIGRATION_0017_BUDGET_REPORT,
  );
}

export function readAndValidateRuntimeMigration0017BudgetEvidence(input: {
  backupDir: string;
  currentSource: D1ReleaseSourceIdentity;
  currentExclusionOwner: ProductionValidationLockOwner;
  now: Date;
}): RuntimeMigration0017BudgetEvidence {
  const backupDir = path.resolve(input.backupDir);
  const reportPath = runtimeMigration0017BudgetReportPath(backupDir);
  const report = requiredRecord(
    readPrivateJsonNoFollow(reportPath),
    "D1 migration 0017 budget evidence",
  );
  if (
    report.kind !== RUNTIME_MIGRATION_0017_BUDGET_KIND ||
    report.schemaVersion !== 3 ||
    report.ok !== true ||
    report.exact !== false ||
    report.reservationPhase !== "maximum" ||
    report.operation !== RUNTIME_MIGRATION_0017_OPERATION ||
    report.operationId !== RUNTIME_MIGRATION_0017_OPERATION_ID
  ) {
    throw new Error("D1 migration 0017 budget evidence is not a successful maximum report.");
  }
  const createdAt = requiredIsoTimestamp(report.createdAt, "0017 budget creation timestamp");
  const ageMs = input.now.getTime() - Date.parse(createdAt);
  if (ageMs < -30_000 || ageMs > RUNTIME_MIGRATION_0017_BUDGET_MAX_AGE_MS) {
    throw new Error("D1 migration 0017 budget evidence is stale or future-dated.");
  }
  const utcDay = requiredUtcDay(report.utcDay);
  assertD1ReleaseBudgetUtcDay(utcDay, input.now);
  if (createdAt.slice(0, 10) !== utcDay) {
    throw new Error("D1 migration 0017 budget evidence crosses its UTC billing day.");
  }
  if (path.resolve(requiredString(report.backupDir, "0017 budget backup directory")) !== backupDir) {
    throw new Error("D1 migration 0017 budget evidence belongs to another backup directory.");
  }
  const database = requiredRecord(report.database, "0017 budget database");
  const limits = requiredRecord(report.safeDailyLimits, "0017 budget daily limits");
  if (
    database.id !== D1_DATABASE_ID ||
    database.name !== D1_DATABASE_NAME ||
    limits.rowsRead !== D1_FREE_SAFE_ROWS_READ_LIMIT ||
    limits.rowsWritten !== D1_FREE_SAFE_ROWS_WRITTEN_LIMIT ||
    report.sourceFingerprintStable !== true
  ) {
    throw new Error("D1 migration 0017 budget evidence has the wrong database, limits, or source state.");
  }
  const sourceBefore = parseSourceIdentity(report.sourceFingerprintBefore);
  const sourceFingerprint = parseSourceIdentity(report.sourceFingerprint);
  assertSameSourceIdentity(sourceBefore, sourceFingerprint);
  assertSameSourceIdentity(sourceFingerprint, input.currentSource);
  const productionExclusionOwner = requiredCanonicalExclusionOwner(
    report.productionExclusionOwner,
  );
  const currentProductionExclusionOwner = canonicalProductionValidationLockOwner(
    input.currentExclusionOwner,
  );
  const currentExclusionOwner = parseStoredProductionValidationLockOwner(
    currentProductionExclusionOwner,
  );
  if (
    productionExclusionOwner !== currentProductionExclusionOwner
  ) {
    throw new Error("D1 migration 0017 budget evidence belongs to another production exclusion.");
  }
  const usage = parseDailyUsage(report.usage);
  const cardinalities = parseCardinalities(report.cardinalities);
  const projection = parseProjection(report.projection);
  const storage = parseStorageProjection(report.storage);
  const recomputedProjection = projectRuntimeMigration0017Usage({
    cardinalities,
    rowsRead: projection.cardinalityRowsRead,
    rowsWritten: 0,
    totalAttempts: 1,
  });
  const recomputedStorage = projectRuntimeMigration0017MaximumStorage({
    databaseName: storage.databaseName,
    databaseUuid: storage.databaseUuid,
    databaseSizeBytes: storage.currentDatabaseBytes,
    tableCount: storage.currentTableCount,
  });
  if (
    JSON.stringify(recomputedProjection) !== JSON.stringify(projection) ||
    JSON.stringify(recomputedStorage) !== JSON.stringify(storage)
  ) {
    throw new Error("D1 migration 0017 budget projection is not reproducible.");
  }
  assertRuntimeMigration0017StorageAdmission(storage);
  const after = requiredRecord(report.after, "0017 projected daily usage");
  if (
    after.rowsReadAfter !== usage.rowsRead + RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ ||
    after.rowsWrittenAfter !== usage.rowsWritten + RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN
  ) {
    throw new Error("D1 migration 0017 projected daily usage is inconsistent.");
  }
  const ledger = requiredRecord(report.ledger, "0017 budget ledger evidence");
  const ledgerPath = path.resolve(requiredString(ledger.ledgerPath, "0017 ledger path"));
  if (ledgerPath !== d1ReleaseBudgetLedgerPath(backupDir, utcDay)) {
    throw new Error("D1 migration 0017 budget evidence points to the wrong ledger.");
  }
  assertD1ReleaseBudgetReservation({
    ledgerPath,
    utcDay,
    operationId: RUNTIME_MIGRATION_0017_OPERATION_ID,
    sourceFingerprint,
    candidateVersionId: currentExclusionOwner.candidateVersionId,
    phase: "maximum",
    rowsRead: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
    rowsWritten: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
    now: input.now,
  });
  return {
    createdAt,
    utcDay,
    sourceFingerprint,
    usage,
    cardinalities,
    projection,
    storage,
    productionExclusionOwner,
    ledgerPath,
  };
}

function requiredCanonicalExclusionOwner(value: unknown) {
  const owner = parseStoredProductionValidationLockOwner(value);
  return canonicalProductionValidationLockOwner(owner);
}

function parseCardinalities(value: unknown): RuntimeMigration0017Cardinalities {
  const record = requiredRecord(value, "0017 cardinalities");
  return {
    users: boundedUsers(record.users),
    idUtf8Bytes: nonNegativeInteger(record.idUtf8Bytes, "0017 user ID bytes"),
    emailUtf8Bytes: nonNegativeInteger(record.emailUtf8Bytes, "0017 email bytes"),
  };
}

function parseProjection(value: unknown): RuntimeMigration0017Projection {
  const record = requiredRecord(value, "0017 row projection");
  return {
    rowsRead: nonNegativeInteger(record.rowsRead, "0017 projected rows read"),
    rowsWritten: nonNegativeInteger(record.rowsWritten, "0017 projected rows written"),
    cardinalityRowsRead: nonNegativeInteger(record.cardinalityRowsRead, "0017 cardinality rows read"),
    writeAdmissionCardinalityRowsRead: nonNegativeInteger(record.writeAdmissionCardinalityRowsRead, "0017 write-admission cardinality rows read"),
    pre0016RuntimeStateRowsRead: nonNegativeInteger(record.pre0016RuntimeStateRowsRead, "pre-0016 runtime-state rows read"),
    indexBuildRowsRead: nonNegativeInteger(record.indexBuildRowsRead, "0017 index rows read"),
    indexBuildRowsWritten: nonNegativeInteger(record.indexBuildRowsWritten, "0017 index rows written"),
    fixedDdlRowsRead: nonNegativeInteger(record.fixedDdlRowsRead, "0017 DDL rows read"),
    fixedDdlRowsWritten: nonNegativeInteger(record.fixedDdlRowsWritten, "0017 DDL rows written"),
    migration0017VerificationRowsRead: nonNegativeInteger(record.migration0017VerificationRowsRead, "0017 verification rows read"),
  };
}

function parseStorageProjection(value: unknown): RuntimeMigration0017StorageProjection {
  const record = requiredRecord(value, "0017 storage projection");
  return {
    databaseName: requiredExact(record.databaseName, D1_DATABASE_NAME, "0017 storage database name"),
    databaseUuid: requiredExact(record.databaseUuid, D1_DATABASE_ID, "0017 storage database UUID"),
    currentTableCount: nonNegativeInteger(record.currentTableCount, "0017 table count"),
    currentDatabaseBytes: nonNegativeInteger(record.currentDatabaseBytes, "0017 current database bytes"),
    users: boundedUsers(record.users),
    idUtf8Bytes: nonNegativeInteger(record.idUtf8Bytes, "0017 storage user ID bytes"),
    emailUtf8Bytes: nonNegativeInteger(record.emailUtf8Bytes, "0017 storage email bytes"),
    indexEntryOverheadBytes: requiredInteger(record.indexEntryOverheadBytes, RUNTIME_MIGRATION_0017_INDEX_ENTRY_OVERHEAD_BYTES, "0017 index overhead"),
    plannedPersistentBytes: nonNegativeInteger(record.plannedPersistentBytes, "0017 persistent bytes"),
    projectedGrowthBytes: nonNegativeInteger(record.projectedGrowthBytes, "0017 projected growth"),
    fixedStorageReserveBytes: requiredInteger(record.fixedStorageReserveBytes, RUNTIME_MIGRATION_0017_FIXED_STORAGE_RESERVE_BYTES, "0017 fixed storage reserve"),
    projectedFinalDatabaseBytes: nonNegativeInteger(record.projectedFinalDatabaseBytes, "0017 final database bytes"),
    freeDatabaseLimitBytes: requiredInteger(record.freeDatabaseLimitBytes, D1_FREE_MAX_DATABASE_BYTES, "D1 Free storage limit"),
    safetyMarginBytes: requiredInteger(record.safetyMarginBytes, D1_FREE_STORAGE_SAFETY_MARGIN_BYTES, "D1 storage safety margin"),
    admissionCeilingBytes: requiredInteger(record.admissionCeilingBytes, D1_FREE_STORAGE_ADMISSION_CEILING_BYTES, "D1 storage admission ceiling"),
    admissible: record.admissible === true,
  };
}

function parseDailyUsage(value: unknown): D1DailyUsage {
  const record = requiredRecord(value, "0017 daily usage");
  const usage = {
    databaseCount: positiveInteger(record.databaseCount, "D1 database count"),
    queryGroups: nonNegativeInteger(record.queryGroups, "D1 query groups"),
    rowsRead: nonNegativeInteger(record.rowsRead, "D1 rows read"),
    rowsWritten: nonNegativeInteger(record.rowsWritten, "D1 rows written"),
    executions: nonNegativeInteger(record.executions, "D1 executions"),
    windowMinutes: positiveInteger(record.windowMinutes, "D1 usage window"),
  };
  if (usage.windowMinutes > 1_440) throw new Error("D1 usage window exceeds one UTC day.");
  return usage;
}

function parseSourceIdentity(value: unknown): D1ReleaseSourceIdentity {
  const record = requiredRecord(value, "0017 source fingerprint");
  const sha256 = requiredString(record.sha256, "0017 source SHA-256");
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("0017 source SHA-256 is invalid.");
  return { sha256, fileCount: positiveInteger(record.fileCount, "0017 source file count") };
}

function compactFingerprint(value: SourceFingerprint): D1ReleaseSourceIdentity {
  return { sha256: value.sha256, fileCount: value.fileCount };
}

function assertSameFingerprint(left: SourceFingerprint, right: SourceFingerprint) {
  assertSameSourceIdentity(compactFingerprint(left), compactFingerprint(right));
}

function assertSameSourceIdentity(
  left: D1ReleaseSourceIdentity,
  right: D1ReleaseSourceIdentity,
) {
  if (left.sha256 !== right.sha256 || left.fileCount !== right.fileCount) {
    throw new Error("D1 migration 0017 source fingerprint changed.");
  }
}

function parseJsonArray(output: string, label: string): unknown[] {
  if (Buffer.byteLength(output, "utf8") > maximumCardinalityOutputBytes) {
    throw new Error(`${label} exceeded its bounded output size.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error(`${label} did not return deterministic JSON.`);
  }
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array payload.`);
  return value;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new Error(`${label} must be non-empty text.`);
  }
  return value;
}

function requiredExact<T extends string>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new Error(`${label} is invalid.`);
  return expected;
}

function requiredInteger<T extends number>(value: unknown, expected: T, label: string): T {
  const parsed = nonNegativeInteger(value, label);
  if (parsed !== expected) throw new Error(`${label} is invalid.`);
  return expected;
}

function nonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string) {
  const parsed = nonNegativeInteger(value, label);
  if (parsed === 0) throw new Error(`${label} must be positive.`);
  return parsed;
}

function boundedUsers(value: unknown) {
  return boundedInteger(value, 0, RUNTIME_MIGRATION_0017_MAX_USERS, "0017 users");
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string) {
  const parsed = nonNegativeInteger(value, label);
  if (parsed < minimum || parsed > maximum) {
    throw new Error(`${label} is outside its bounded range.`);
  }
  return parsed;
}

function safeMultiply(left: number, right: number, label: string) {
  const product = left * right;
  if (!Number.isSafeInteger(product) || product < 0) throw new Error(`${label} overflowed.`);
  return product;
}

function safeSum(values: readonly number[]) {
  return values.reduce((total, value) => {
    const next = total + value;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error("0017 projection overflowed.");
    return next;
  }, 0);
}

function requiredIsoTimestamp(value: unknown, label: string) {
  const timestamp = requiredString(value, label);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new Error(`${label} must be a canonical ISO timestamp.`);
  }
  return timestamp;
}

function requiredUtcDay(value: unknown) {
  const day = requiredString(value, "0017 UTC day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("0017 UTC day is invalid.");
  return day;
}

function validDate(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
