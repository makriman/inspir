import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertRuntimeMigration0017StorageAdmission,
  loadRuntimeMigration0017Cardinalities,
  projectRuntimeMigration0017MaximumStorage,
  readAndValidateRuntimeMigration0017BudgetEvidence,
  runRuntimeMigration0017BudgetCheck,
  RUNTIME_MIGRATION_0017_BUDGET_REPORT,
  RUNTIME_MIGRATION_0017_FILE,
  RUNTIME_MIGRATION_0017_MAX_EMAIL_UTF8_BYTES,
  RUNTIME_MIGRATION_0017_MAX_USER_ID_UTF8_BYTES,
  RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
  RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
  RUNTIME_MIGRATION_0017_MAX_USERS,
  RUNTIME_MIGRATION_0017_OPERATION,
  RUNTIME_MIGRATION_0017_OPERATION_ID,
  runtimeMigration0017BudgetReportPath,
  writeRuntimeMigration0017BudgetReport,
  type RuntimeMigration0017BudgetEvidence,
  type RuntimeMigration0017CardinalityResult,
  type RuntimeMigration0017StorageProjection,
} from "./check-d1-runtime-migration-0017-budget";
import {
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
  readPrivateJsonNoFollow,
  type D1ReleaseSourceIdentity,
} from "./d1-release-budget-ledger";
import {
  D1_RUNTIME_0016_ABSENT_CHECK_IDS,
  D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS,
  D1_RUNTIME_PRE_0016_STATE_MAX_ROWS_READ,
  verifyD1RuntimePre0016State,
  type D1RuntimePre0016StateProof,
} from "./d1-runtime-pre-0016-state";
import {
  RUNTIME_MIGRATION_VERIFICATION_LOGICAL_ROWS_READ_LIMIT,
} from "./verify-d1-runtime-migrations";
import {
  assertD1FreeDailyBudget,
  loadAccountD1DailyUsage,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  readD1DatabaseStorageInfo,
  type D1DatabaseStorageInfo,
} from "./d1-free-storage-admission";
import {
  cloudflareDir,
  createHash,
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  parseD1TimeTravelBookmark,
  resolveBackupDir,
  runWrangler,
  stableStringify,
  type WranglerRunner,
} from "./migration-config";
import {
  assertProductionReleaseChildExclusion,
  canonicalProductionValidationLockOwner,
  parseStoredProductionValidationLockOwner,
  PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV,
  PRODUCTION_RELEASE_OPERATION_ENV,
  PRODUCTION_VALIDATION_LOCK_KEY,
  type ProductionValidationExclusion,
  type ProductionValidationLockOwner,
} from "./production-validation-lock";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import {
  assertSameTemporarySqlFileAttestation,
  attestTemporarySqlFile,
  removeAttestedTemporarySqlFile,
  TemporarySqlFileIntegrityError,
  writeTemporarySqlFile,
  type TemporarySqlFileAttestation,
} from "./sync-site-translation-sources";
import {
  verifyD1RuntimeMigration0017,
  type RuntimeMigration0017State,
  type RuntimeMigration0017VerificationReport,
} from "./verify-d1-runtime-migration-0017";
import {
  readWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";

export const D1_RUNTIME_MIGRATION_0017_PREWRITE_KIND =
  "d1-runtime-migration-0017-prewrite" as const;
export const D1_RUNTIME_MIGRATION_0017_OUTCOME_KIND =
  "d1-runtime-migration-0017-apply-outcome" as const;
export const D1_RUNTIME_MIGRATION_0017_OUTCOME_REPORT =
  "d1-runtime-migration-0017-apply-outcome.json" as const;
export const D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_KIND =
  "d1-runtime-migration-0017-write-attempt" as const;
export const D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_REPORT =
  "d1-runtime-migration-0017-write-attempt.json" as const;
export const D1_RUNTIME_MIGRATION_0017_APPLY_VERIFICATION_REPORT =
  "d1-runtime-migration-0017-apply-verification.json" as const;
export const D1_RUNTIME_MIGRATION_0017_GUARD_TABLE =
  "__inspir_runtime_migration_0017_admission_guard" as const;

export type RuntimeMigration0017FileEvidence = Readonly<{
  file: typeof RUNTIME_MIGRATION_0017_FILE;
  bytes: number;
  sha256: string;
}>;

export type RuntimeMigration0017CandidateReleaseIdentity = Readonly<{
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
}>;

export type RuntimeMigration0017ApplyOutcome = Readonly<{
  kind: typeof D1_RUNTIME_MIGRATION_0017_OUTCOME_KIND;
  schemaVersion: 3;
  createdAt: string;
  backupDir: string;
  database: {
    id: typeof D1_DATABASE_ID;
    name: typeof D1_DATABASE_NAME;
  };
  ok: boolean;
  status: "verified" | "verified-after-ambiguous-response" | "already-applied" | "failed";
  sourceFingerprint: D1ReleaseSourceIdentity | null;
  utcDay: string | null;
  budgetReportPath: string;
  pre0016RuntimeStateProof: D1RuntimePre0016StateProof | null;
  applyVerificationEvidencePath: string | null;
  applyVerificationEvidenceSha256: string | null;
  preWriteEvidencePath: string | null;
  timeTravelBookmark: string | null;
  migrationFile: RuntimeMigration0017FileEvidence | null;
  guardedSqlFile: { bytes: number; sha256: string } | null;
  storageAtWrite: RuntimeMigration0017StorageProjection | null;
  cardinalitiesAtWrite: RuntimeMigration0017CardinalityResult["cardinalities"] | null;
  writeBoundaryUsage: D1DailyUsage | null;
  stateBefore: RuntimeMigration0017State | null;
  stateAfter: RuntimeMigration0017State | null;
  writeAttempted: boolean;
  responseConfirmed: boolean;
  recoveredByVerification: boolean;
  error?: string;
}>;

export type RuntimeMigration0017WriteAttemptMarker = Readonly<{
  kind: typeof D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_KIND;
  schemaVersion: 2;
  createdAt: string;
  backupDir: string;
  database: {
    id: typeof D1_DATABASE_ID;
    name: typeof D1_DATABASE_NAME;
  };
  operationId: typeof RUNTIME_MIGRATION_0017_OPERATION_ID;
  sourceFingerprint: D1ReleaseSourceIdentity;
  utcDay: string;
  budgetReportPath: string;
  ledger: {
    path: string;
    revision: number;
    reservation: ReturnType<typeof reserveD1ReleaseBudget>["reservation"] & {
      accountingParentOperationId: null;
    };
    reservationRetainedAtMaximum: true;
  };
  pre0016RuntimeStateProof: D1RuntimePre0016StateProof;
  preWriteEvidencePath: string;
  timeTravelBookmark: string;
  migrationFile: RuntimeMigration0017FileEvidence;
  guardedSqlFile: NonNullable<RuntimeMigration0017ApplyOutcome["guardedSqlFile"]>;
  guardedSqlAttestation: TemporarySqlFileAttestation;
  storageAtWrite: RuntimeMigration0017StorageProjection;
  cardinalitiesAtWrite: NonNullable<
    RuntimeMigration0017ApplyOutcome["cardinalitiesAtWrite"]
  >;
  writeBoundaryUsage: D1DailyUsage;
  productionExclusionOwner: string;
  wranglerArgs: readonly string[];
  stateBefore: "absent";
  writeAttempted: true;
  responseConfirmed: false;
  automaticRetryPermitted: false;
}>;

export type ApplyD1RuntimeMigration0017Options = Readonly<{
  confirmed?: boolean;
  backupDir: string;
  cwd?: string;
  runner?: WranglerRunner;
  clock?: () => Date;
  pre0016StateVerifier?: (options: {
    backupDir: string;
    cwd: string;
    nowMs: number;
    runner: WranglerRunner;
  }) => D1RuntimePre0016StateProof;
  migration0017Verifier?: (options: {
    backupDir: string;
    cwd: string;
    nowMs: number;
    runner: WranglerRunner;
  }) => RuntimeMigration0017VerificationReport;
  storageLoader?: (runner: WranglerRunner) => D1DatabaseStorageInfo;
  cardinalityLoader?: (runner: WranglerRunner) => RuntimeMigration0017CardinalityResult;
  usageLoader?: (
    now: Date,
    runner: WranglerRunner,
    clock: () => Date,
  ) => D1DailyUsage;
  exclusionLoader?: (runner: WranglerRunner) => ProductionValidationExclusion;
  releaseIdentityLoader?: (
    backupDir: string,
  ) => RuntimeMigration0017CandidateReleaseIdentity;
}>;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const backupDir = resolveBackupDir();
  assertRuntimeMigration0017ChildIdentityBeforeFirstD1({
    args: process.argv.slice(2),
    backupDir,
    cwd: process.cwd(),
  });
  assertProductionReleaseChildExclusion("apply-d1-runtime-migration-0017");
  const outcome = applyD1RuntimeMigration0017({
    confirmed: true,
    backupDir,
  });
  console.log(JSON.stringify(outcome, null, 2));
}

function readRuntimeMigration0017CandidateReleaseIdentity(
  backupDir: string,
): RuntimeMigration0017CandidateReleaseIdentity {
  const upload = readWorkerCandidateUploadEvidence(
    workerCandidateUploadEvidencePath(path.resolve(backupDir)),
  );
  return Object.freeze({
    targetCandidateVersionId: upload.value.targetCandidateVersionId,
    serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
    uploadEvidenceSha256: upload.sha256,
    sourceFingerprint: Object.freeze({
      sha256: upload.value.artifacts.sourceFingerprintSha256,
      fileCount: upload.value.artifacts.sourceFingerprintFileCount,
    }),
  });
}

export function assertRuntimeMigration0017ChildIdentityBeforeFirstD1(
  input: Readonly<{
    args: readonly string[];
    backupDir: string;
    cwd: string;
    env?: NodeJS.ProcessEnv;
  }>,
  dependencies: {
    readReleaseIdentity?: typeof readRuntimeMigration0017CandidateReleaseIdentity;
    buildSourceFingerprint?: typeof buildRepoSourceFingerprint;
  } = {},
) {
  assertExactRuntimeMigration0017ChildArguments(input.args);
  const env = input.env ?? process.env;
  if (
    env[PRODUCTION_RELEASE_OPERATION_ENV] !==
      "apply-d1-runtime-migration-0017"
  ) {
    throw new Error(
      "Production migration 0017 child must run through its exact guarded release-operation wrapper.",
    );
  }
  const rawOwner = env[PRODUCTION_RELEASE_EXCLUSION_OWNER_ENV];
  if (!rawOwner) {
    throw new Error(
      "Production migration 0017 child omitted its guarded exclusion owner before first D1 access.",
    );
  }
  const owner = parseStoredProductionValidationLockOwner(rawOwner);
  const release = (
    dependencies.readReleaseIdentity ??
    readRuntimeMigration0017CandidateReleaseIdentity
  )(path.resolve(input.backupDir));
  const source = (
    dependencies.buildSourceFingerprint ?? buildRepoSourceFingerprint
  )(path.resolve(input.cwd));
  assertRuntimeMigration0017ReleaseIdentityMatchesSource(release, source);
  if (
    owner.candidateVersionId !== release.targetCandidateVersionId ||
    owner.sourceFingerprintSha256 !== source.sha256
  ) {
    throw new Error(
      "Production migration 0017 child exclusion owner does not match the canonical inactive candidate and source before first D1 access.",
    );
  }
  return Object.freeze({ owner, release, source });
}

function assertExactRuntimeMigration0017ChildArguments(args: readonly string[]) {
  if (args.length !== 1 || args[0] !== "--confirm-production") {
    throw new Error(
      "Production migration 0017 child accepts only the exact --confirm-production argument.",
    );
  }
}

export function buildRuntimeMigration0017GuardedSql(input: {
  migrationSql: string;
  exclusionOwner: ProductionValidationLockOwner;
}) {
  const canonicalMigrationSql = input.migrationSql.trim();
  const expectedMigrationSql = [
    "CREATE INDEX IF NOT EXISTS `users_normalized_email_lookup_idx`",
    "ON `users` (lower(`email`), `id`, `email`);",
  ].join("\n");
  if (canonicalMigrationSql !== expectedMigrationSql) {
    throw new Error("D1 migration 0017 guarded SQL requires the exact canonical index source.");
  }
  if (/\b(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(canonicalMigrationSql)) {
    throw new Error("D1 migration 0017 must let Wrangler/D1 own the SQL-file transaction.");
  }
  const owner = canonicalProductionValidationLockOwner(input.exclusionOwner);
  const quotedOwner = sqlText(owner);
  const quotedLockKey = sqlText(PRODUCTION_VALIDATION_LOCK_KEY);
  // Current D1 import guidance requires removing explicit BEGIN/COMMIT because
  // Wrangler/D1 already owns the file transaction. The guard and index are one
  // file so a failed CHECK/NOT NULL statement aborts the index operation rather
  // than leaving a check/apply race.
  return [
    `CREATE TABLE \`${D1_RUNTIME_MIGRATION_0017_GUARD_TABLE}\` (`,
    "  `singleton` integer PRIMARY KEY NOT NULL CHECK (`singleton` = 1),",
    `  \`users\` integer NOT NULL CHECK (\`users\` BETWEEN 0 AND ${RUNTIME_MIGRATION_0017_MAX_USERS}),`,
    `  \`id_utf8_bytes\` integer NOT NULL CHECK (\`id_utf8_bytes\` BETWEEN 0 AND ${RUNTIME_MIGRATION_0017_MAX_USER_ID_UTF8_BYTES}),`,
    `  \`email_utf8_bytes\` integer NOT NULL CHECK (\`email_utf8_bytes\` BETWEEN 0 AND ${RUNTIME_MIGRATION_0017_MAX_EMAIL_UTF8_BYTES}),`,
    "  `existing_index_rows` integer NOT NULL CHECK (`existing_index_rows` = 0),",
    `  \`exclusion_owner\` text NOT NULL CHECK (\`exclusion_owner\` = ${quotedOwner})`,
    ");",
    `INSERT INTO \`${D1_RUNTIME_MIGRATION_0017_GUARD_TABLE}\` (`,
    "  `singleton`, `users`, `id_utf8_bytes`, `email_utf8_bytes`, `existing_index_rows`, `exclusion_owner`",
    ")",
    "SELECT",
    "  1,",
    "  count(*),",
    "  coalesce(sum(length(cast(`id` AS blob))), 0),",
    "  coalesce(sum(length(cast(`email` AS blob))), 0),",
    "  (SELECT count(*) FROM `sqlite_schema` WHERE `type` = 'index' AND `name` = 'users_normalized_email_lookup_idx'),",
    "  (",
    "    SELECT `value`",
    "    FROM `app_metadata`",
    `    WHERE \`key\` = ${quotedLockKey}`,
    `      AND \`value\` = ${quotedOwner}`,
    "      AND json_extract(`value`, '$.leaseExpiresAt') >",
    "        cast(unixepoch('subsec') * 1000 AS integer)",
    "    LIMIT 1",
    "  )",
    "FROM (",
    "  SELECT `id`, `email`",
    "  FROM `users`",
    "  ORDER BY `id`",
    `  LIMIT ${RUNTIME_MIGRATION_0017_MAX_USERS + 1}`,
    ") AS `bounded_users`;",
    canonicalMigrationSql,
    `DROP TABLE \`${D1_RUNTIME_MIGRATION_0017_GUARD_TABLE}\`;`,
    "",
  ].join("\n");
}

function assertRuntimeMigration0017GuardCardinalities(
  current: RuntimeMigration0017CardinalityResult,
) {
  if (
    current.rowsWritten !== 0 ||
    current.totalAttempts !== 1 ||
    current.cardinalities.users > RUNTIME_MIGRATION_0017_MAX_USERS ||
    current.cardinalities.idUtf8Bytes > RUNTIME_MIGRATION_0017_MAX_USER_ID_UTF8_BYTES ||
    current.cardinalities.emailUtf8Bytes > RUNTIME_MIGRATION_0017_MAX_EMAIL_UTF8_BYTES
  ) {
    throw new Error(
      "D1 migration 0017 user state exceeds the fixed atomic admission envelope.",
    );
  }
}

function assertSameProductionExclusion(
  expected: ProductionValidationLockOwner,
  actual: ProductionValidationLockOwner,
) {
  if (
    canonicalProductionValidationLockOwner(expected) !==
      canonicalProductionValidationLockOwner(actual)
  ) {
    throw new Error("D1 migration 0017 production exclusion changed before final admission.");
  }
}

function assertRuntimeMigration0017ReleaseIdentityMatchesSource(
  release: RuntimeMigration0017CandidateReleaseIdentity,
  source: Pick<SourceFingerprint, "sha256" | "fileCount">,
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      release.targetCandidateVersionId,
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      release.serviceBaselineVersionId,
    ) ||
    release.targetCandidateVersionId === release.serviceBaselineVersionId ||
    !/^[a-f0-9]{64}$/.test(release.uploadEvidenceSha256) ||
    !/^[a-f0-9]{64}$/.test(release.sourceFingerprint.sha256) ||
    !Number.isSafeInteger(release.sourceFingerprint.fileCount) ||
    release.sourceFingerprint.fileCount < 1 ||
    release.sourceFingerprint.sha256 !== source.sha256 ||
    release.sourceFingerprint.fileCount !== source.fileCount
  ) {
    throw new Error(
      "D1 migration 0017 canonical inactive upload identity does not match the exact current source.",
    );
  }
}

function assertRuntimeMigration0017ExclusionMatchesRelease(
  exclusion: ProductionValidationExclusion,
  release: RuntimeMigration0017CandidateReleaseIdentity,
  source: Pick<SourceFingerprint, "sha256" | "fileCount">,
  boundary: string,
) {
  canonicalProductionValidationLockOwner(exclusion.owner);
  if (
    exclusion.owner.candidateVersionId !== release.targetCandidateVersionId ||
    exclusion.owner.sourceFingerprintSha256 !== source.sha256
  ) {
    throw new Error(
      `D1 migration 0017 exclusion owner drifted from the canonical inactive candidate at ${boundary}.`,
    );
  }
}

function assertSameRuntimeMigration0017ReleaseIdentity(
  expected: RuntimeMigration0017CandidateReleaseIdentity,
  actual: RuntimeMigration0017CandidateReleaseIdentity,
) {
  if (
    expected.targetCandidateVersionId !== actual.targetCandidateVersionId ||
    expected.serviceBaselineVersionId !== actual.serviceBaselineVersionId ||
    expected.uploadEvidenceSha256 !== actual.uploadEvidenceSha256 ||
    expected.sourceFingerprint.sha256 !== actual.sourceFingerprint.sha256 ||
    expected.sourceFingerprint.fileCount !== actual.sourceFingerprint.fileCount
  ) {
    throw new Error(
      "D1 migration 0017 canonical inactive upload identity changed before final write admission.",
    );
  }
}

function assertNoPriorRuntimeMigration0017WriteAttempt(
  writeAttemptPath: string,
  outcomePath: string,
  applyVerificationPath: string,
) {
  if (fs.lstatSync(applyVerificationPath, { throwIfNoEntry: false })) {
    throw new Error(
      "D1 migration 0017 immutable apply-verification evidence already exists; refusing a possible retry.",
    );
  }
  const writeAttemptEntry = fs.lstatSync(writeAttemptPath, { throwIfNoEntry: false });
  if (writeAttemptEntry !== undefined) {
    let value: unknown;
    try {
      value = readPrivateJsonNoFollow(writeAttemptPath);
    } catch (cause) {
      throw new Error(
        "D1 migration 0017 prior write-attempt marker is unreadable or unsafe; refusing a possible retry.",
        { cause },
      );
    }
    if (
      !isRecord(value) ||
      value.kind !== D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_KIND ||
      (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
      value.writeAttempted !== true ||
      value.automaticRetryPermitted !== false
    ) {
      throw new Error(
        "D1 migration 0017 prior write-attempt marker is untrusted; refusing a possible retry.",
      );
    }
    throw new Error(
      "D1 migration 0017 already durably fenced a write attempt; exact verification or reviewed forward correction is required and the write will not be retried.",
    );
  }
  if (!fs.existsSync(outcomePath)) return;
  const value = readPrivateJsonNoFollow(outcomePath);
  if (!isRecord(value)) {
    throw new Error("D1 migration 0017 prior outcome is malformed; refusing a possible retry.");
  }
  const outcome = value;
  if (
    outcome.kind !== D1_RUNTIME_MIGRATION_0017_OUTCOME_KIND ||
    (outcome.schemaVersion !== 1 &&
      outcome.schemaVersion !== 2 &&
      outcome.schemaVersion !== 3) ||
    typeof outcome.writeAttempted !== "boolean"
  ) {
    throw new Error("D1 migration 0017 prior outcome is untrusted; refusing a possible retry.");
  }
  if (outcome.writeAttempted) {
    throw new Error(
      "D1 migration 0017 already recorded a write attempt; exact verification or reviewed forward correction is required and the write will not be retried.",
    );
  }
}

export function applyD1RuntimeMigration0017(
  options: ApplyD1RuntimeMigration0017Options,
): RuntimeMigration0017ApplyOutcome {
  if (!options.confirmed) {
    throw new Error("Applying production D1 migration 0017 requires --confirm-production.");
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDir = path.resolve(options.backupDir);
  const runner = options.runner ?? runWrangler;
  const clock = options.clock ?? (() => new Date());
  const pre0016StateVerifier =
    options.pre0016StateVerifier ?? verifyD1RuntimePre0016State;
  const migration0017Verifier = options.migration0017Verifier ?? verifyD1RuntimeMigration0017;
  const storageLoader = options.storageLoader ?? readD1DatabaseStorageInfo;
  const cardinalityLoader =
    options.cardinalityLoader ?? loadRuntimeMigration0017Cardinalities;
  const usageLoader = options.usageLoader ?? loadAccountD1DailyUsage;
  const releaseIdentityLoader =
    options.releaseIdentityLoader ??
    readRuntimeMigration0017CandidateReleaseIdentity;
  const exclusionLoader = options.exclusionLoader ?? ((activeRunner: WranglerRunner) =>
    assertProductionReleaseChildExclusion(
      "apply-d1-runtime-migration-0017",
      { runner: activeRunner },
    ));
  const budgetReportPath = runtimeMigration0017BudgetReportPath(backupDir);
  const outcomePath = runtimeMigration0017OutcomePath(backupDir);
  const writeAttemptPath = runtimeMigration0017WriteAttemptPath(backupDir);
  const applyVerificationPath =
    runtimeMigration0017ApplyVerificationPath(backupDir);
  let sourceFingerprint: D1ReleaseSourceIdentity | null = null;
  let budget: RuntimeMigration0017BudgetEvidence | null = null;
  let pre0016RuntimeStateProof: D1RuntimePre0016StateProof | null = null;
  let applyVerificationEvidencePath: string | null = null;
  let applyVerificationEvidenceSha256: string | null = null;
  let preWriteEvidencePath: string | null = null;
  let timeTravelBookmark: string | null = null;
  let migrationFile: RuntimeMigration0017FileEvidence | null = null;
  let guardedSqlFile: RuntimeMigration0017ApplyOutcome["guardedSqlFile"] = null;
  let guardedSqlPath: string | null = null;
  let guardedSql: string | null = null;
  let initialGuardedSqlAttestation: TemporarySqlFileAttestation | null = null;
  let storageAtWrite: RuntimeMigration0017StorageProjection | null = null;
  let cardinalitiesAtWrite: RuntimeMigration0017ApplyOutcome["cardinalitiesAtWrite"] = null;
  let writeBoundaryUsage: D1DailyUsage | null = null;
  let stateBefore: RuntimeMigration0017State | null = null;
  let stateAfter: RuntimeMigration0017State | null = null;
  let writeAttempted = false;
  let responseConfirmed = false;
  let recoveredByVerification = false;

  try {
    assertNoPriorRuntimeMigration0017WriteAttempt(
      writeAttemptPath,
      outcomePath,
      applyVerificationPath,
    );
    const startedAt = validDate(clock(), "0017 apply start");
    const fullSource = buildRepoSourceFingerprint(cwd);
    const initialReleaseIdentity = releaseIdentityLoader(backupDir);
    assertRuntimeMigration0017ReleaseIdentityMatchesSource(
      initialReleaseIdentity,
      fullSource,
    );
    const initialExclusion = exclusionLoader(runner);
    assertRuntimeMigration0017ExclusionMatchesRelease(
      initialExclusion,
      initialReleaseIdentity,
      fullSource,
      "initial admission",
    );
    sourceFingerprint = compactFingerprint(fullSource);
    const migrationSource = readRuntimeMigration0017Source(cwd);
    migrationFile = migrationSource.evidence;
    pre0016RuntimeStateProof = pre0016StateVerifier({
      backupDir,
      cwd,
      nowMs: startedAt.getTime(),
      runner,
    });
    assertExactPre0016RuntimeStateProof(
      pre0016RuntimeStateProof,
      sourceFingerprint,
    );
    const beforeReport = migration0017Verifier({
      backupDir,
      cwd,
      nowMs: validDate(clock(), "0017 pre-state verification").getTime(),
      runner,
    });
    assertReadOnlySourceBound0017Report(beforeReport, sourceFingerprint);
    stateBefore = beforeReport.state;
    stateAfter = beforeReport.state;
    if (stateBefore === "partial") {
      throw new Error(
        "D1 migration 0017 is partial or malformed; refusing every write until reviewed.",
      );
    }
    if (stateBefore === "applied") {
      const outcome = buildOutcome({
        createdAt: validDate(clock(), "0017 already-applied outcome").toISOString(),
        backupDir,
        ok: true,
        status: "already-applied",
        sourceFingerprint,
        utcDay: null,
        budgetReportPath,
        pre0016RuntimeStateProof,
        applyVerificationEvidencePath,
        applyVerificationEvidenceSha256,
        preWriteEvidencePath,
        timeTravelBookmark,
        migrationFile,
        guardedSqlFile,
        storageAtWrite,
        cardinalitiesAtWrite,
        writeBoundaryUsage,
        stateBefore,
        stateAfter,
        writeAttempted,
        responseConfirmed,
        recoveredByVerification,
      });
      writeOutcome(outcomePath, outcome);
      return outcome;
    }
    const budgetReport = runRuntimeMigration0017BudgetCheck({
      backupDir,
      cwd,
      runner,
      clock,
      usageLoader,
      cardinalityLoader,
      storageLoader,
      exclusionOwner: initialExclusion.owner,
    });
    writeRuntimeMigration0017BudgetReport(backupDir, budgetReport);
    budget = readAndValidateRuntimeMigration0017BudgetEvidence({
      backupDir,
      currentSource: sourceFingerprint,
      currentExclusionOwner: initialExclusion.owner,
      now: validDate(clock(), "0017 budget evidence readback"),
    });
    assertStableSource(fullSource, buildRepoSourceFingerprint(cwd));
    assertSameFileEvidence(migrationFile, readRuntimeMigration0017FileEvidence(cwd));
    guardedSql = buildRuntimeMigration0017GuardedSql({
      migrationSql: migrationSource.sql,
      exclusionOwner: initialExclusion.owner,
    });
    guardedSqlPath = writeTemporarySqlFile(
      guardedSql,
      "d1-runtime-migration-0017-guarded.sql",
    );
    initialGuardedSqlAttestation = attestTemporarySqlFile(guardedSqlPath, guardedSql);
    guardedSqlFile = {
      bytes: initialGuardedSqlAttestation.bytes,
      sha256: initialGuardedSqlAttestation.sha256,
    };
    timeTravelBookmark = parseD1TimeTravelBookmark(
      runner(["d1", "time-travel", "info", D1_DATABASE_NAME, "--json"]),
    );
    const measuredAtWrite = cardinalityLoader(runner);
    assertRuntimeMigration0017GuardCardinalities(measuredAtWrite);
    cardinalitiesAtWrite = measuredAtWrite.cardinalities;
    storageAtWrite = projectRuntimeMigration0017MaximumStorage(storageLoader(runner));
    assertRuntimeMigration0017StorageAdmission(storageAtWrite);

    const finalExclusion = exclusionLoader(runner);
    assertSameProductionExclusion(initialExclusion.owner, finalExclusion.owner);
    const writeAt = validDate(clock(), "0017 final account-usage admission");
    readAndValidateRuntimeMigration0017BudgetEvidence({
      backupDir,
      currentSource: sourceFingerprint,
      currentExclusionOwner: finalExclusion.owner,
      now: writeAt,
    });
    assertStableSource(fullSource, buildRepoSourceFingerprint(cwd));
    assertSameFileEvidence(migrationFile, readRuntimeMigration0017FileEvidence(cwd));
    writeBoundaryUsage = usageLoader(writeAt, runner, clock);
    const admittedAt = validDate(clock(), "0017 final account-usage admission completion");
    assertD1ReleaseBudgetUtcDay(budget.utcDay, admittedAt);
    assertD1FreeDailyBudget(writeBoundaryUsage, {
      operation: `${RUNTIME_MIGRATION_0017_OPERATION} final write boundary`,
      rowsRead: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
      rowsWritten: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
    });
    const finalLedger = reserveD1ReleaseBudget({
      backupDir,
      operationId: RUNTIME_MIGRATION_0017_OPERATION_ID,
      operation: RUNTIME_MIGRATION_0017_OPERATION,
      sourceFingerprint,
      candidateVersionId: finalExclusion.owner.candidateVersionId,
      phase: "maximum",
      rowsRead: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
      rowsWritten: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
      observedUsage: writeBoundaryUsage,
      now: admittedAt,
      expectedUtcDay: budget.utcDay,
    });
    assertD1ReleaseBudgetReservation({
      ledgerPath: finalLedger.ledgerPath,
      utcDay: budget.utcDay,
      operationId: RUNTIME_MIGRATION_0017_OPERATION_ID,
      sourceFingerprint,
      candidateVersionId: finalExclusion.owner.candidateVersionId,
      phase: "maximum",
      rowsRead: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ,
      rowsWritten: RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN,
      now: admittedAt,
    });
    const immediatelyBeforeWrite = attestTemporarySqlFile(guardedSqlPath, guardedSql);
    assertSameTemporarySqlFileAttestation(
      initialGuardedSqlAttestation,
      immediatelyBeforeWrite,
    );
    preWriteEvidencePath = writePreWriteEvidence({
      backupDir,
      createdAt: admittedAt.toISOString(),
      sourceFingerprint: fullSource,
      budget,
      pre0016RuntimeStateProof,
      migrationFile,
      guardedSqlFile,
      guardedSqlAttestation: immediatelyBeforeWrite,
      storageAtWrite,
      cardinalitiesAtWrite,
      writeBoundaryUsage,
      finalLedger,
      productionExclusionOwner: budget.productionExclusionOwner,
      timeTravelBookmark,
      stateBefore,
    });

    const finalReleaseIdentity = releaseIdentityLoader(backupDir);
    assertSameRuntimeMigration0017ReleaseIdentity(
      initialReleaseIdentity,
      finalReleaseIdentity,
    );
    assertRuntimeMigration0017ReleaseIdentityMatchesSource(
      finalReleaseIdentity,
      fullSource,
    );
    assertRuntimeMigration0017ExclusionMatchesRelease(
      finalExclusion,
      finalReleaseIdentity,
      fullSource,
      "final write admission",
    );
    const attemptGuardedSqlAttestation = attestTemporarySqlFile(guardedSqlPath, guardedSql);
    assertSameTemporarySqlFileAttestation(
      immediatelyBeforeWrite,
      attemptGuardedSqlAttestation,
    );
    const wranglerArgs = runtimeMigration0017WriteArgs(guardedSqlPath);
    writeRuntimeMigration0017WriteAttemptMarker({
      writeAttemptPath,
      createdAt: admittedAt.toISOString(),
      backupDir,
      sourceFingerprint,
      budget,
      budgetReportPath,
      finalLedger,
      pre0016RuntimeStateProof,
      preWriteEvidencePath,
      timeTravelBookmark,
      migrationFile,
      guardedSqlFile,
      guardedSqlAttestation: attemptGuardedSqlAttestation,
      storageAtWrite,
      cardinalitiesAtWrite,
      writeBoundaryUsage,
      productionExclusionOwner: budget.productionExclusionOwner,
      wranglerArgs,
      stateBefore,
    });

    let transportError: unknown;
    let fileIntegrityError: unknown;
    writeAttempted = true;
    try {
      runner(wranglerArgs);
      responseConfirmed = true;
    } catch (error) {
      transportError = error;
    }
    try {
      const immediatelyAfterWrite = attestTemporarySqlFile(guardedSqlPath, guardedSql);
      assertSameTemporarySqlFileAttestation(
        initialGuardedSqlAttestation,
        immediatelyAfterWrite,
      );
      removeAttestedTemporarySqlFile(immediatelyAfterWrite, guardedSql);
      guardedSqlPath = null;
      guardedSql = null;
      initialGuardedSqlAttestation = null;
    } catch (error) {
      fileIntegrityError = error;
    }

    let afterReport: RuntimeMigration0017VerificationReport;
    try {
      afterReport = migration0017Verifier({
        backupDir,
        cwd,
        nowMs: validDate(clock(), "0017 post-write verification").getTime(),
        runner,
      });
      assertReadOnlySourceBound0017Report(afterReport, sourceFingerprint);
    } catch (verificationError) {
      throw new AggregateError(
        [transportError, fileIntegrityError, verificationError].filter(
          (error): error is NonNullable<unknown> => error !== undefined,
        ),
        "D1 migration 0017 response or state is indeterminate; it was not retried.",
      );
    }
    stateAfter = afterReport.state;
    if (fileIntegrityError !== undefined) {
      throw new TemporarySqlFileIntegrityError(
        "D1 migration 0017 guarded SQL identity became indeterminate around its sole write attempt; it was not retried.",
        { cause: fileIntegrityError },
      );
    }
    recoveredByVerification = transportError !== undefined && afterReport.ok;
    if (!afterReport.ok || stateAfter !== "applied") {
      throw new Error(
        "D1 migration 0017 did not exact-verify after its single write attempt; it was not retried.",
      );
    }
    const outcomeAt = validDate(clock(), "0017 successful outcome");
    assertD1ReleaseBudgetUtcDay(budget.utcDay, outcomeAt);
    assertStableSource(fullSource, buildRepoSourceFingerprint(cwd));
    applyVerificationEvidenceSha256 = sha256CanonicalValue(afterReport);
    writePrivateJsonDurably(applyVerificationPath, afterReport, {
      replace: false,
    });
    applyVerificationEvidencePath = applyVerificationPath;
    const outcome = buildOutcome({
      createdAt: outcomeAt.toISOString(),
      backupDir,
      ok: true,
      status: recoveredByVerification
        ? "verified-after-ambiguous-response"
        : "verified",
      sourceFingerprint,
      utcDay: budget.utcDay,
      budgetReportPath,
      pre0016RuntimeStateProof,
      applyVerificationEvidencePath,
      applyVerificationEvidenceSha256,
      preWriteEvidencePath,
      timeTravelBookmark,
      migrationFile,
      guardedSqlFile,
      storageAtWrite,
      cardinalitiesAtWrite,
      writeBoundaryUsage,
      stateBefore,
      stateAfter,
      writeAttempted,
      responseConfirmed,
      recoveredByVerification,
    });
    writeOutcome(outcomePath, outcome);
    return outcome;
  } catch (caught) {
    let error: unknown = caught;
    if (
      !writeAttempted &&
      guardedSqlPath !== null &&
      guardedSql !== null &&
      initialGuardedSqlAttestation !== null
    ) {
      try {
        removeAttestedTemporarySqlFile(initialGuardedSqlAttestation, guardedSql);
        guardedSqlPath = null;
      } catch (cleanupError) {
        error = new AggregateError(
          [caught, cleanupError],
          "D1 migration 0017 prewrite failed and its exact guarded SQL cleanup also failed.",
        );
      }
    }
    const failure = buildOutcome({
      createdAt: safeClockIso(clock),
      backupDir,
      ok: false,
      status: "failed",
      sourceFingerprint,
      utcDay: budget?.utcDay ?? null,
      budgetReportPath,
      pre0016RuntimeStateProof,
      applyVerificationEvidencePath,
      applyVerificationEvidenceSha256,
      preWriteEvidencePath,
      timeTravelBookmark,
      migrationFile,
      guardedSqlFile,
      storageAtWrite,
      cardinalitiesAtWrite,
      writeBoundaryUsage,
      stateBefore,
      stateAfter,
      writeAttempted,
      responseConfirmed,
      recoveredByVerification,
      error: boundedError(error),
    });
    try {
      writeOutcome(outcomePath, failure);
    } catch (outcomeError) {
      throw new AggregateError(
        [error, outcomeError],
        "D1 migration 0017 failed and its final outcome could not be persisted.",
      );
    }
    throw new Error(
      `D1 migration 0017 stopped safely: ${boundedError(error)} Final outcome evidence: ${outcomePath}`,
      { cause: error },
    );
  }
}

function assertExactPre0016RuntimeStateProof(
  proof: D1RuntimePre0016StateProof,
  sourceFingerprint: D1ReleaseSourceIdentity,
) {
  if (
    proof.classification !== "exact-pre-0016" ||
    proof.sourceFingerprint.sha256 !== sourceFingerprint.sha256 ||
    proof.sourceFingerprint.fileCount !== sourceFingerprint.fileCount ||
    !Number.isSafeInteger(proof.staticRowsRead) ||
    proof.staticRowsRead < 0 ||
    proof.staticRowsRead > RUNTIME_MIGRATION_VERIFICATION_LOGICAL_ROWS_READ_LIMIT ||
    !Number.isSafeInteger(proof.probeRowsRead) ||
    proof.probeRowsRead < 0 ||
    proof.probeRowsRead > D1_RUNTIME_PRE_0016_STATE_MAX_ROWS_READ ||
    proof.staticTotalAttempts !== 1 ||
    proof.probeTotalAttempts !== 1 ||
    proof.appliedCheckCount !== D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS.length ||
    proof.absentCheckCount !== D1_RUNTIME_0016_ABSENT_CHECK_IDS.length ||
    proof.schemaObjectsAbsent !== true ||
    proof.fixedMarkerAbsent !== true ||
    proof.freshMarkerAbsent !== true
  ) {
    throw new Error(
      "D1 migration 0017 requires exact source-bound 0013-0015 applied and 0016 absent state.",
    );
  }
}

function assertReadOnlySourceBound0017Report(
  report: RuntimeMigration0017VerificationReport,
  sourceFingerprint: D1ReleaseSourceIdentity,
) {
  if (
    !report.sourceFingerprintStable ||
    report.sourceFingerprint.sha256 !== sourceFingerprint.sha256 ||
    report.sourceFingerprint.fileCount !== sourceFingerprint.fileCount ||
    report.rowsWritten !== 0 ||
    report.totalAttempts !== 1 ||
    report.checks.length !== 1 ||
    report.checks[0].detail.state !== report.state ||
    report.ok !== (report.state === "applied" && report.checks[0].ok)
  ) {
    throw new Error("D1 migration 0017 state verification was not exact, source-bound, and read-only.");
  }
}

function readRuntimeMigration0017FileEvidence(cwd: string): RuntimeMigration0017FileEvidence {
  return readRuntimeMigration0017Source(cwd).evidence;
}

function readRuntimeMigration0017Source(cwd: string) {
  const file = path.join(cwd, RUNTIME_MIGRATION_0017_FILE);
  let descriptor: number;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    throw new Error("D1 migration 0017 source must be a regular non-symlink file.");
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024) {
      throw new Error("D1 migration 0017 source has an invalid type or size.");
    }
    const content = fs.readFileSync(descriptor);
    return {
      sql: content.toString("utf8"),
      evidence: {
        file: RUNTIME_MIGRATION_0017_FILE,
        bytes: content.byteLength,
        sha256: createHash().update(content).digest("hex"),
      } satisfies RuntimeMigration0017FileEvidence,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSameFileEvidence(
  before: RuntimeMigration0017FileEvidence,
  after: RuntimeMigration0017FileEvidence,
) {
  if (
    before.file !== after.file ||
    before.bytes !== after.bytes ||
    before.sha256 !== after.sha256
  ) {
    throw new Error("D1 migration 0017 source changed after evidence capture.");
  }
}

function writePreWriteEvidence(input: {
  backupDir: string;
  createdAt: string;
  sourceFingerprint: SourceFingerprint;
  budget: RuntimeMigration0017BudgetEvidence;
  pre0016RuntimeStateProof: D1RuntimePre0016StateProof;
  migrationFile: RuntimeMigration0017FileEvidence;
  guardedSqlFile: NonNullable<RuntimeMigration0017ApplyOutcome["guardedSqlFile"]>;
  guardedSqlAttestation: TemporarySqlFileAttestation;
  storageAtWrite: RuntimeMigration0017StorageProjection;
  cardinalitiesAtWrite: NonNullable<RuntimeMigration0017ApplyOutcome["cardinalitiesAtWrite"]>;
  writeBoundaryUsage: D1DailyUsage;
  finalLedger: ReturnType<typeof reserveD1ReleaseBudget>;
  productionExclusionOwner: string;
  timeTravelBookmark: string;
  stateBefore: "absent";
}) {
  const evidence = {
    kind: D1_RUNTIME_MIGRATION_0017_PREWRITE_KIND,
    schemaVersion: 3,
    createdAt: input.createdAt,
    utcDay: input.budget.utcDay,
    backupDir: input.backupDir,
    database: { id: D1_DATABASE_ID, name: D1_DATABASE_NAME },
    operationId: RUNTIME_MIGRATION_0017_OPERATION_ID,
    sourceFingerprint: input.sourceFingerprint,
    pre0016RuntimeStateProof: input.pre0016RuntimeStateProof,
    budgetReport: RUNTIME_MIGRATION_0017_BUDGET_REPORT,
    ledgerPath: input.budget.ledgerPath,
    ledgerRevision: input.finalLedger.revision,
    ledgerReservation: input.finalLedger.reservation,
    reservationRetainedAtMaximum: input.finalLedger.reservation.phase === "maximum",
    projection: input.budget.projection,
    storageAtWrite: input.storageAtWrite,
    cardinalitiesAtWrite: input.cardinalitiesAtWrite,
    writeBoundaryUsage: input.writeBoundaryUsage,
    migrationFile: input.migrationFile,
    guardedSqlFile: input.guardedSqlFile,
    guardedSqlAttestation: input.guardedSqlAttestation,
    productionExclusionOwner: input.productionExclusionOwner,
    atomicAdmission: {
      guardTable: D1_RUNTIME_MIGRATION_0017_GUARD_TABLE,
      maximumUsers: RUNTIME_MIGRATION_0017_MAX_USERS,
      maximumIdUtf8Bytes: RUNTIME_MIGRATION_0017_MAX_USER_ID_UTF8_BYTES,
      maximumEmailUtf8Bytes: RUNTIME_MIGRATION_0017_MAX_EMAIL_UTF8_BYTES,
      boundedRowsRead: RUNTIME_MIGRATION_0017_MAX_USERS + 1,
      requiresIndexAbsent: true,
      requiresExactLiveExclusionOwner: true,
      wranglerOwnsFileTransaction: true,
      explicitTransactionControl: false,
    },
    stateBefore: input.stateBefore,
    timeTravelBookmark: input.timeTravelBookmark,
    recoveryPreference: "reviewed-forward-correction",
    automaticRetryPermitted: false,
    automaticRestorePermitted: false,
  } as const;
  const timestamp = input.createdAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(
    cloudflareDir(input.backupDir),
    `d1-runtime-migration-0017-prewrite-${timestamp}.json`,
  );
  writePrivateJsonDurably(evidencePath, evidence, { replace: false });
  return evidencePath;
}

export function runtimeMigration0017WriteAttemptPath(backupDir: string) {
  return path.join(
    cloudflareDir(backupDir),
    D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_REPORT,
  );
}

function runtimeMigration0017ApplyVerificationPath(backupDir: string) {
  return path.join(
    cloudflareDir(backupDir),
    D1_RUNTIME_MIGRATION_0017_APPLY_VERIFICATION_REPORT,
  );
}

function runtimeMigration0017WriteArgs(guardedSqlPath: string) {
  return [
    "d1",
    "execute",
    D1_DATABASE_NAME,
    "--remote",
    "--file",
    guardedSqlPath,
    "--yes",
    "--json",
  ];
}

function writeRuntimeMigration0017WriteAttemptMarker(input: {
  writeAttemptPath: string;
  createdAt: string;
  backupDir: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  budget: RuntimeMigration0017BudgetEvidence;
  budgetReportPath: string;
  finalLedger: ReturnType<typeof reserveD1ReleaseBudget>;
  pre0016RuntimeStateProof: D1RuntimePre0016StateProof;
  preWriteEvidencePath: string;
  timeTravelBookmark: string;
  migrationFile: RuntimeMigration0017FileEvidence;
  guardedSqlFile: NonNullable<RuntimeMigration0017ApplyOutcome["guardedSqlFile"]>;
  guardedSqlAttestation: TemporarySqlFileAttestation;
  storageAtWrite: RuntimeMigration0017StorageProjection;
  cardinalitiesAtWrite: NonNullable<
    RuntimeMigration0017ApplyOutcome["cardinalitiesAtWrite"]
  >;
  writeBoundaryUsage: D1DailyUsage;
  productionExclusionOwner: string;
  wranglerArgs: string[];
  stateBefore: "absent";
}) {
  const expectedPath = runtimeMigration0017WriteAttemptPath(input.backupDir);
  const expectedWranglerArgs = runtimeMigration0017WriteArgs(
    input.guardedSqlAttestation.path,
  );
  if (
    input.writeAttemptPath !== expectedPath ||
    JSON.stringify(input.wranglerArgs) !== JSON.stringify(expectedWranglerArgs) ||
    input.guardedSqlFile.bytes !== input.guardedSqlAttestation.bytes ||
    input.guardedSqlFile.sha256 !== input.guardedSqlAttestation.sha256 ||
    input.finalLedger.reservation.phase !== "maximum" ||
    input.finalLedger.reservation.rowsRead !==
      RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_READ ||
    input.finalLedger.reservation.rowsWritten !==
      RUNTIME_MIGRATION_0017_MAXIMUM_ROWS_WRITTEN
  ) {
    throw new Error(
      "D1 migration 0017 write-attempt marker inputs drifted from the admitted write boundary.",
    );
  }
  const marker: RuntimeMigration0017WriteAttemptMarker = {
    kind: D1_RUNTIME_MIGRATION_0017_WRITE_ATTEMPT_KIND,
    schemaVersion: 2,
    createdAt: input.createdAt,
    backupDir: input.backupDir,
    database: { id: D1_DATABASE_ID, name: D1_DATABASE_NAME },
    operationId: RUNTIME_MIGRATION_0017_OPERATION_ID,
    sourceFingerprint: input.sourceFingerprint,
    utcDay: input.budget.utcDay,
    budgetReportPath: input.budgetReportPath,
    ledger: {
      path: input.finalLedger.ledgerPath,
      revision: input.finalLedger.revision,
      reservation: {
        ...input.finalLedger.reservation,
        accountingParentOperationId: null,
      },
      reservationRetainedAtMaximum: true,
    },
    pre0016RuntimeStateProof: input.pre0016RuntimeStateProof,
    preWriteEvidencePath: input.preWriteEvidencePath,
    timeTravelBookmark: input.timeTravelBookmark,
    migrationFile: input.migrationFile,
    guardedSqlFile: input.guardedSqlFile,
    guardedSqlAttestation: input.guardedSqlAttestation,
    storageAtWrite: input.storageAtWrite,
    cardinalitiesAtWrite: input.cardinalitiesAtWrite,
    writeBoundaryUsage: input.writeBoundaryUsage,
    productionExclusionOwner: input.productionExclusionOwner,
    wranglerArgs: input.wranglerArgs,
    stateBefore: input.stateBefore,
    writeAttempted: true,
    responseConfirmed: false,
    automaticRetryPermitted: false,
  };
  writePrivateJsonDurably(input.writeAttemptPath, marker, { replace: false });
}

function runtimeMigration0017OutcomePath(backupDir: string) {
  return path.join(cloudflareDir(backupDir), D1_RUNTIME_MIGRATION_0017_OUTCOME_REPORT);
}

function buildOutcome(
  input: Omit<RuntimeMigration0017ApplyOutcome, "kind" | "schemaVersion" | "database">,
): RuntimeMigration0017ApplyOutcome {
  return {
    kind: D1_RUNTIME_MIGRATION_0017_OUTCOME_KIND,
    schemaVersion: 3,
    database: { id: D1_DATABASE_ID, name: D1_DATABASE_NAME },
    ...input,
  };
}

function writeOutcome(file: string, outcome: RuntimeMigration0017ApplyOutcome) {
  const exists = fs.existsSync(file);
  if (exists && !outcome.writeAttempted) {
    const prior = readPrivateJsonNoFollow(file);
    if (
      isRecord(prior) &&
      prior.kind === D1_RUNTIME_MIGRATION_0017_OUTCOME_KIND &&
      prior.writeAttempted === true
    ) {
      // A later prewrite refusal must never erase the durable no-retry fence
      // established by the earlier single write attempt.
      return;
    }
  }
  writePrivateJsonDurably(file, outcome, { replace: exists });
}

function compactFingerprint(value: SourceFingerprint): D1ReleaseSourceIdentity {
  return { sha256: value.sha256, fileCount: value.fileCount };
}

function assertStableSource(before: SourceFingerprint, after: SourceFingerprint) {
  if (before.sha256 !== after.sha256 || before.fileCount !== after.fileCount) {
    throw new Error("Source files changed during D1 migration 0017 admission.");
  }
}

function validDate(value: Date, label: string) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function safeClockIso(clock: () => Date) {
  try {
    return validDate(clock(), "0017 failure outcome clock").toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function boundedError(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function sha256CanonicalValue(value: unknown) {
  return createHash().update(stableStringify(value)).digest("hex");
}

function sqlText(value: string) {
  if (!value || value.includes("\0")) {
    throw new Error("D1 migration 0017 SQL guard received invalid text.");
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
