import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  RUNTIME_MIGRATION_BUDGET_EVIDENCE_KIND,
  RUNTIME_MIGRATION_BUDGET_MAX_AGE_MS,
  RUNTIME_MIGRATION_BUDGET_OPERATION_ID,
  RUNTIME_MIGRATION_BUDGET_REPORT,
  RUNTIME_MIGRATION_FIXED_VERIFICATION_ROWS_READ,
  RUNTIME_MIGRATION_SNAPSHOT_READ_PASSES,
  projectRuntimeMigrationUsage,
  type RuntimeMigrationCardinalities,
  type RuntimeMigrationProjection,
} from "./check-d1-runtime-migration-budget";
import {
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
  d1ReleaseBudgetLedgerPath,
  readPrivateJsonNoFollow,
  writePrivateJsonDurably,
  type D1ReleaseBudgetReservationResult,
  type D1ReleaseSourceIdentity,
} from "./d1-release-budget-ledger";
import {
  D1_FREE_SAFE_ROWS_READ_LIMIT,
  D1_FREE_SAFE_ROWS_WRITTEN_LIMIT,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  cloudflareDir,
  createHash,
  D1_DATABASE_ID,
  D1_DATABASE_NAME,
  hasFlag,
  parseD1TimeTravelBookmark,
  resolveBackupDir,
  runWrangler,
  type WranglerRunner,
} from "./migration-config";
import { buildRepoSourceFingerprint, type SourceFingerprint } from "./source-fingerprint";
import { assertProductionReleaseChildExclusion } from "./production-validation-lock";
import {
  RUNTIME_MIGRATION_FILES,
  verifyD1RuntimeMigrations,
  type RuntimeMigrationVerificationCheck,
} from "./verify-d1-runtime-migrations";

export const D1_RUNTIME_MIGRATION_PREWRITE_EVIDENCE_KIND =
  "d1-runtime-migrations-0013-0016-prewrite" as const;
export const D1_RUNTIME_MIGRATION_OUTCOME_KIND =
  "d1-runtime-migrations-0013-0016-apply-outcome" as const;
export const D1_RUNTIME_MIGRATION_OUTCOME_REPORT =
  "d1-runtime-migrations-0013-0016-apply-outcome.json" as const;

type RuntimeMigrationId = "0013" | "0014" | "0015" | "0016";
type RuntimeMigrationGroupState = "absent" | "applied" | "partial";

export type RuntimeMigrationFileEvidence = {
  migration: RuntimeMigrationId;
  file: string;
  bytes: number;
  sha256: string;
};

export type RuntimeMigrationExactState = {
  groups: Record<RuntimeMigrationId, RuntimeMigrationGroupState>;
  validPrefix: boolean;
  partial: boolean;
  nextMigration: RuntimeMigrationId | null;
  rowsRead: number;
  rowsWritten: 0;
  checks: RuntimeMigrationVerificationCheck[];
};

export type RuntimeMigrationApplyAttempt = {
  migration: RuntimeMigrationId;
  file: string;
  responseConfirmed: boolean;
  recoveredByVerification: boolean;
  stateAfter: RuntimeMigrationExactState | null;
  transportError?: string;
};

export type RuntimeMigrationApplyOutcome = {
  kind: typeof D1_RUNTIME_MIGRATION_OUTCOME_KIND;
  schemaVersion: 1;
  createdAt: string;
  backupDir: string;
  database: {
    id: typeof D1_DATABASE_ID;
    name: typeof D1_DATABASE_NAME;
  };
  ok: boolean;
  status: "verified" | "already-applied" | "failed";
  sourceFingerprint: D1ReleaseSourceIdentity | null;
  utcDay: string | null;
  budgetReportPath: string;
  ledgerPath: string | null;
  preWriteEvidencePath: string | null;
  timeTravelBookmark: string | null;
  migrationFiles: RuntimeMigrationFileEvidence[];
  stateBefore: RuntimeMigrationExactState | null;
  stateAfter: RuntimeMigrationExactState | null;
  attempts: RuntimeMigrationApplyAttempt[];
  error?: string;
};

export type ApplyD1RuntimeMigrationsOptions = {
  confirmed?: boolean;
  backupDir: string;
  cwd?: string;
  runner?: WranglerRunner;
  clock?: () => Date;
};

type RuntimeMigrationBudgetEvidence = {
  createdAt: string;
  utcDay: string;
  backupDir: string;
  sourceFingerprint: D1ReleaseSourceIdentity;
  usage: D1DailyUsage;
  cardinalities: RuntimeMigrationCardinalities;
  projection: RuntimeMigrationProjection;
  ledgerPath: string;
};

const migrationIds = ["0013", "0014", "0015", "0016"] as const;
const migrationCheckIds: Record<RuntimeMigrationId, readonly string[]> = {
  "0013": [
    "0013-rate-limit-windows-index",
    "0013-ai-runs-index",
    "0013-ops-events-user-index",
  ],
  "0014": ["0014-admin-totals-snapshot"],
  "0015": [
    "0015-completion-token-column",
    "0015-completion-message-id-column",
    "0015-completion-token-unique-partial-index",
    "0015-completion-message-id-unique-partial-index",
  ],
  "0016": [
    "0016-memory-summary-suppression-mask-column",
    "0016-memory-vector-cleanup-outbox-columns",
    "0016-memory-vector-cleanup-outbox-checks",
    "0016-memory-vector-cleanup-outbox-due-index",
    "0016-completion-marker",
  ],
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!hasFlag("--confirm-production")) {
    throw new Error("Applying production D1 runtime migrations requires --confirm-production.");
  }
  assertProductionReleaseChildExclusion("apply-d1-runtime-migrations");
  const outcome = applyD1RuntimeMigrations({
    confirmed: true,
    backupDir: resolveBackupDir(),
  });
  console.log(JSON.stringify(outcome, null, 2));
}

export function applyD1RuntimeMigrations(
  options: ApplyD1RuntimeMigrationsOptions,
): RuntimeMigrationApplyOutcome {
  if (!options.confirmed) {
    throw new Error("Applying production D1 runtime migrations requires --confirm-production.");
  }
  const backupDir = path.resolve(options.backupDir);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const runner = options.runner ?? runWrangler;
  const clock = options.clock ?? (() => new Date());
  const budgetReportPath = path.join(cloudflareDir(backupDir), RUNTIME_MIGRATION_BUDGET_REPORT);
  const outcomePath = runtimeMigrationApplyOutcomePath(backupDir);
  const attempts: RuntimeMigrationApplyAttempt[] = [];
  let sourceFingerprint: D1ReleaseSourceIdentity | null = null;
  let budget: RuntimeMigrationBudgetEvidence | undefined;
  let preWriteEvidencePath: string | null = null;
  let timeTravelBookmark: string | null = null;
  let migrationFiles: RuntimeMigrationFileEvidence[] = [];
  let stateBefore: RuntimeMigrationExactState | null = null;
  let stateAfter: RuntimeMigrationExactState | null = null;

  try {
    const startedAt = validClockValue(clock(), "migration start");
    const currentSource = buildRepoSourceFingerprint(cwd);
    sourceFingerprint = compactFingerprint(currentSource);
    budget = readRuntimeMigrationBudgetEvidence({
      budgetReportPath,
      backupDir,
      currentSource: sourceFingerprint,
      now: startedAt,
    });
    assertLiveMigrationBudgetReservation(budget, startedAt);
    migrationFiles = buildRuntimeMigrationFileEvidence(cwd);
    stateBefore = readRuntimeMigrationExactState({ backupDir, cwd, runner, now: startedAt });
    stateAfter = stateBefore;
    assertStableSourceFingerprint(currentSource, buildRepoSourceFingerprint(cwd));
    if (stateBefore.partial || !stateBefore.validPrefix) {
      throw new Error(
        "Production D1 runtime migrations are in a partial or out-of-order state; refusing every write until an operator reviews exact read-only state.",
      );
    }

    if (stateBefore.nextMigration === null) {
      const outcome = buildOutcome({
        createdAt: validClockValue(clock(), "already-applied outcome").toISOString(),
        backupDir,
        ok: true,
        status: "already-applied",
        sourceFingerprint,
        utcDay: budget.utcDay,
        budgetReportPath,
        ledgerPath: budget.ledgerPath,
        preWriteEvidencePath,
        timeTravelBookmark,
        migrationFiles,
        stateBefore,
        stateAfter,
        attempts,
      });
      writeOutcome(outcomePath, outcome);
      return outcome;
    }

    timeTravelBookmark = parseD1TimeTravelBookmark(
      runner(["d1", "time-travel", "info", D1_DATABASE_NAME, "--json"]),
    );
    const evidenceClock = validClockValue(clock(), "pre-write evidence");
    assertD1ReleaseBudgetUtcDay(budget.utcDay, evidenceClock);
    const liveBudgetReservation = assertLiveMigrationBudgetReservation(budget, evidenceClock);
    const sourceBeforeEvidence = buildRepoSourceFingerprint(cwd);
    assertStableSourceFingerprint(currentSource, sourceBeforeEvidence);
    assertStableMigrationFiles(migrationFiles, buildRuntimeMigrationFileEvidence(cwd));
    preWriteEvidencePath = writeRuntimeMigrationPreWriteDiagnosticEvidence({
      backupDir,
      createdAt: evidenceClock.toISOString(),
      bookmark: timeTravelBookmark,
      sourceFingerprint: currentSource,
      budget,
      liveBudgetReservation,
      migrationFiles,
      stateBefore,
    });

    const firstMigrationIndex = migrationIds.indexOf(stateBefore.nextMigration);
    if (firstMigrationIndex < 0) {
      throw new Error("Exact runtime migration state did not identify a valid next migration.");
    }
    for (const migration of migrationIds.slice(firstMigrationIndex)) {
      // 0016 is the first migration after the lost predecessor-HMAC incident.
      // It must be executed only by the fresh-cutover coordinator, which
      // appends the immutable run marker to the tracked file and preserves
      // every protected dataset on both sides of the transaction. Keeping this
      // guard at the final write boundary lets the legacy wrapper finish an
      // earlier additive migration but makes raw 0016 impossible.
      if (migration === "0016") {
        throw new Error(
          "Generic runtime migration application refuses raw 0016; use the fresh-0016 cutover coordinator so the migration and preservation evidence share one immutable run marker.",
        );
      }
      const beforeWrite = validClockValue(clock(), `${migration} write admission`);
      assertLiveMigrationBudgetReservation(budget, beforeWrite);
      assertStableSourceFingerprint(currentSource, buildRepoSourceFingerprint(cwd));
      assertStableMigrationFiles(migrationFiles, buildRuntimeMigrationFileEvidence(cwd));
      const fileEvidence = requiredMigrationFile(migrationFiles, migration);
      let transportError: unknown;
      try {
        runner([
          "d1",
          "execute",
          D1_DATABASE_NAME,
          "--remote",
          "--file",
          path.join(cwd, fileEvidence.file),
          "--yes",
          "--json",
        ]);
      } catch (error) {
        transportError = error;
      }

      let verifiedState: RuntimeMigrationExactState;
      try {
        verifiedState = readRuntimeMigrationExactState({
          backupDir,
          cwd,
          runner,
          now: validClockValue(clock(), `${migration} recovery verification`),
        });
      } catch (verificationError) {
        attempts.push({
          migration,
          file: fileEvidence.file,
          responseConfirmed: transportError === undefined,
          recoveredByVerification: false,
          stateAfter: null,
          ...(transportError === undefined
            ? {}
            : { transportError: boundedError(transportError) }),
        });
        throw new AggregateError(
          [transportError, verificationError].filter(
            (error): error is NonNullable<unknown> => error !== undefined,
          ),
          `${migration} response or state is indeterminate; it was not retried. Use the fsynced Time Travel diagnostic evidence to prepare a reviewed forward correction.`,
        );
      }
      stateAfter = verifiedState;
      const recoveredByVerification = transportError !== undefined &&
        verifiedState.groups[migration] === "applied" &&
        verifiedState.validPrefix;
      attempts.push({
        migration,
        file: fileEvidence.file,
        responseConfirmed: transportError === undefined,
        recoveredByVerification,
        stateAfter: verifiedState,
        ...(transportError === undefined
          ? {}
          : { transportError: boundedError(transportError) }),
      });

      if (verifiedState.partial || !verifiedState.validPrefix) {
        throw new Error(
          `${migration} left a partial or out-of-order D1 state; refusing every further write and refusing automatic restore.`,
        );
      }
      if (verifiedState.groups[migration] !== "applied") {
        const ambiguity = transportError === undefined ? "did not exact-verify" : "had an ambiguous response";
        throw new Error(
          `${migration} ${ambiguity} and remained unapplied; it was not retried automatically. Rerun only after reviewing exact read-only state and the fsynced bookmark.`,
        );
      }
      if (
        transportError !== undefined &&
        migration === "0015" &&
        !recoveredByVerification
      ) {
        throw new Error(
          `Ambiguous ${migration} was not exact-verified and must never be blindly retried.`,
        );
      }
    }

    if (!stateAfter || stateAfter.nextMigration !== null || stateAfter.partial || !stateAfter.validPrefix) {
      throw new Error("Runtime migrations finished without exact complete-state verification.");
    }
    const outcomeClock = validClockValue(clock(), "successful migration outcome");
    assertD1ReleaseBudgetUtcDay(budget.utcDay, outcomeClock);
    assertStableSourceFingerprint(currentSource, buildRepoSourceFingerprint(cwd));
    const outcome = buildOutcome({
      createdAt: outcomeClock.toISOString(),
      backupDir,
      ok: true,
      status: "verified",
      sourceFingerprint,
      utcDay: budget.utcDay,
      budgetReportPath,
      ledgerPath: budget.ledgerPath,
      preWriteEvidencePath,
      timeTravelBookmark,
      migrationFiles,
      stateBefore,
      stateAfter,
      attempts,
    });
    writeOutcome(outcomePath, outcome);
    return outcome;
  } catch (error) {
    const failure = buildOutcome({
      createdAt: safeClockIso(clock),
      backupDir,
      ok: false,
      status: "failed",
      sourceFingerprint,
      utcDay: budget?.utcDay ?? null,
      budgetReportPath,
      ledgerPath: budget?.ledgerPath ?? null,
      preWriteEvidencePath,
      timeTravelBookmark,
      migrationFiles,
      stateBefore,
      stateAfter,
      attempts,
      error: boundedError(error),
    });
    try {
      writeOutcome(outcomePath, failure);
    } catch (outcomeError) {
      throw new AggregateError(
        [error, outcomeError],
        "D1 runtime migration failed and its final outcome evidence could not be persisted.",
      );
    }
    throw new Error(
      `D1 runtime migration stopped safely: ${boundedError(error)} Final outcome evidence: ${outcomePath}`,
      { cause: error },
    );
  }
}

function classifyRuntimeMigrationState(input: {
  checks: RuntimeMigrationVerificationCheck[];
  rowsRead: number;
  rowsWritten: number;
}): RuntimeMigrationExactState {
  if (!Number.isSafeInteger(input.rowsRead) || input.rowsRead < 0 || input.rowsWritten !== 0) {
    throw new Error("Runtime migration state verification must be read-only with valid metadata.");
  }
  const groups = Object.fromEntries(
    migrationIds.map((migration) => {
      const checks = migrationCheckIds[migration].map((id) => {
        const matches = input.checks.filter((check) => check.id === id);
        if (matches.length !== 1) {
          throw new Error(`Runtime migration state verification omitted exact check ${id}.`);
        }
        return matches[0];
      });
      const applied = checks.every((check) => check.ok);
      const absent = checks.every(
        (check) => !check.ok && check.detail.rows === 0,
      );
      const state: RuntimeMigrationGroupState = applied
        ? "applied"
        : absent
          ? "absent"
          : "partial";
      return [migration, state];
    }),
  );
  const typedGroups: RuntimeMigrationExactState["groups"] = {
    "0013": requiredGroupState(groups["0013"], "0013"),
    "0014": requiredGroupState(groups["0014"], "0014"),
    "0015": requiredGroupState(groups["0015"], "0015"),
    "0016": requiredGroupState(groups["0016"], "0016"),
  };
  const sequence = migrationIds.map((migration) => typedGroups[migration]);
  const firstAbsent = sequence.indexOf("absent");
  const validPrefix =
    !sequence.includes("partial") &&
    sequence.every((state, index) =>
      firstAbsent === -1 ? state === "applied" : index < firstAbsent ? state === "applied" : state === "absent",
    );
  return {
    groups: typedGroups,
    validPrefix,
    partial: sequence.includes("partial") || !validPrefix,
    nextMigration: validPrefix && firstAbsent >= 0 ? migrationIds[firstAbsent] : null,
    rowsRead: input.rowsRead,
    rowsWritten: 0,
    checks: input.checks,
  };
}

function runtimeMigrationApplyOutcomePath(backupDir: string) {
  return path.join(cloudflareDir(path.resolve(backupDir)), D1_RUNTIME_MIGRATION_OUTCOME_REPORT);
}

function readRuntimeMigrationBudgetEvidence(input: {
  budgetReportPath: string;
  backupDir: string;
  currentSource: D1ReleaseSourceIdentity;
  now: Date;
}): RuntimeMigrationBudgetEvidence {
  const value = readPrivateJsonNoFollow(input.budgetReportPath);
  const report = requiredRecord(value, "runtime migration budget evidence");
  if (
    report.kind !== RUNTIME_MIGRATION_BUDGET_EVIDENCE_KIND ||
    report.schemaVersion !== 1 ||
    report.ok !== true ||
    report.exact !== true ||
    report.operationId !== RUNTIME_MIGRATION_BUDGET_OPERATION_ID ||
    report.operation !== "Production D1 runtime migrations 0013-0016"
  ) {
    throw new Error("Runtime migration budget evidence is not an exact successful 0013-0016 report.");
  }
  const createdAt = requiredIsoTimestamp(report.createdAt, "budget evidence creation timestamp");
  const createdMs = Date.parse(createdAt);
  const ageMs = input.now.getTime() - createdMs;
  if (ageMs < -30_000 || ageMs > RUNTIME_MIGRATION_BUDGET_MAX_AGE_MS) {
    throw new Error("Runtime migration budget evidence is stale or future-dated.");
  }
  const utcDay = requiredUtcDay(report.utcDay);
  assertD1ReleaseBudgetUtcDay(utcDay, input.now);
  if (createdAt.slice(0, 10) !== utcDay) {
    throw new Error("Runtime migration budget evidence timestamp does not match its UTC day.");
  }
  if (path.resolve(requiredString(report.backupDir, "budget backup directory")) !== input.backupDir) {
    throw new Error("Runtime migration budget evidence belongs to a different backup directory.");
  }
  const database = requiredRecord(report.database, "budget database identity");
  if (database.id !== D1_DATABASE_ID || database.name !== D1_DATABASE_NAME) {
    throw new Error("Runtime migration budget evidence targets the wrong D1 database.");
  }
  const limits = requiredRecord(report.safeDailyLimits, "budget safe limits");
  if (
    limits.rowsRead !== D1_FREE_SAFE_ROWS_READ_LIMIT ||
    limits.rowsWritten !== D1_FREE_SAFE_ROWS_WRITTEN_LIMIT
  ) {
    throw new Error("Runtime migration budget evidence uses unexpected daily limits.");
  }
  if (report.sourceFingerprintStable !== true) {
    throw new Error("Runtime migration budget evidence did not prove stable source files.");
  }
  const sourceFingerprint = parseSourceIdentity(report.sourceFingerprint);
  const sourceBefore = parseSourceIdentity(report.sourceFingerprintBefore);
  assertSameSourceIdentity(sourceBefore, sourceFingerprint);
  assertSameSourceIdentity(sourceFingerprint, input.currentSource);
  const usage = parseDailyUsage(report.usage);
  const cardinalities = parseCardinalities(report.cardinalities);
  const projection = parseProjection(report.projection);
  const cardinalityRowsRead = projection.rowsRead -
    projection.indexedRows * 4 -
    projection.snapshotRows * RUNTIME_MIGRATION_SNAPSHOT_READ_PASSES -
    projection.suppressionBackfillRowsRead -
    projection.outboxSchemaRowsRead -
    projection.freshCutoverMarkerRowsRead -
    RUNTIME_MIGRATION_FIXED_VERIFICATION_ROWS_READ;
  if (!Number.isSafeInteger(cardinalityRowsRead) || cardinalityRowsRead < 0) {
    throw new Error("Runtime migration budget evidence has an impossible cardinality read count.");
  }
  const recomputed = projectRuntimeMigrationUsage(cardinalities, cardinalityRowsRead);
  if (JSON.stringify(recomputed) !== JSON.stringify(projection)) {
    throw new Error("Runtime migration budget evidence projection is not reproducible.");
  }
  const after = requiredRecord(report.after, "budget projected usage result");
  if (
    after.rowsReadAfter !== usage.rowsRead + projection.rowsRead ||
    after.rowsWrittenAfter !== usage.rowsWritten + projection.rowsWritten
  ) {
    throw new Error("Runtime migration budget evidence projected totals are inconsistent.");
  }
  const ledger = requiredRecord(report.ledger, "budget ledger evidence");
  const ledgerPath = path.resolve(requiredString(ledger.ledgerPath, "budget ledger path"));
  const expectedLedgerPath = d1ReleaseBudgetLedgerPath(input.backupDir, utcDay);
  if (ledgerPath !== expectedLedgerPath || ledger.utcDay !== utcDay) {
    throw new Error("Runtime migration budget evidence points to the wrong UTC-day ledger.");
  }
  const reservation = requiredRecord(ledger.reservation, "budget ledger reservation");
  if (
    reservation.operationId !== RUNTIME_MIGRATION_BUDGET_OPERATION_ID ||
    reservation.phase !== "exact" ||
    reservation.candidateVersionId !== null ||
    reservation.rowsRead !== projection.rowsRead ||
    reservation.rowsWritten !== projection.rowsWritten
  ) {
    throw new Error("Runtime migration budget evidence does not contain the exact ledger reservation.");
  }
  return {
    createdAt,
    utcDay,
    backupDir: input.backupDir,
    sourceFingerprint,
    usage,
    cardinalities,
    projection,
    ledgerPath,
  };
}

function assertLiveMigrationBudgetReservation(
  budget: RuntimeMigrationBudgetEvidence,
  now: Date,
) {
  assertD1ReleaseBudgetUtcDay(budget.utcDay, now);
  const ageMs = now.getTime() - Date.parse(budget.createdAt);
  if (ageMs < -30_000 || ageMs > RUNTIME_MIGRATION_BUDGET_MAX_AGE_MS) {
    throw new Error("Runtime migration budget evidence expired before D1 write admission.");
  }
  return assertD1ReleaseBudgetReservation({
    ledgerPath: budget.ledgerPath,
    utcDay: budget.utcDay,
    operationId: RUNTIME_MIGRATION_BUDGET_OPERATION_ID,
    sourceFingerprint: budget.sourceFingerprint,
    phase: "exact",
    rowsRead: budget.projection.rowsRead,
    rowsWritten: budget.projection.rowsWritten,
    now,
  });
}

function readRuntimeMigrationExactState(input: {
  backupDir: string;
  cwd: string;
  runner: WranglerRunner;
  now: Date;
}) {
  const report = verifyD1RuntimeMigrations({
    backupDir: input.backupDir,
    cwd: input.cwd,
    nowMs: input.now.getTime(),
    runner: input.runner,
  });
  if (!report.sourceFingerprintStable || report.rowsWritten !== 0) {
    throw new Error("Runtime migration state verification was not source-stable and read-only.");
  }
  return classifyRuntimeMigrationState({
    checks: report.checks,
    rowsRead: report.rowsRead,
    rowsWritten: report.rowsWritten,
  });
}

function buildRuntimeMigrationFileEvidence(cwd: string): RuntimeMigrationFileEvidence[] {
  return RUNTIME_MIGRATION_FILES.map((file, index) => {
    const absolute = path.join(cwd, file);
    let descriptor: number;
    try {
      descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch {
      throw new Error(`Runtime migration file must be a regular non-symlink file: ${file}.`);
    }
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size <= 0 || stat.size > 1024 * 1024) {
        throw new Error(`Runtime migration file has invalid size or type: ${file}.`);
      }
      const content = fs.readFileSync(descriptor);
      return {
        migration: migrationIds[index],
        file,
        bytes: content.byteLength,
        sha256: createHash().update(content).digest("hex"),
      };
    } finally {
      fs.closeSync(descriptor);
    }
  });
}

function writeRuntimeMigrationPreWriteDiagnosticEvidence(input: {
  backupDir: string;
  createdAt: string;
  bookmark: string;
  sourceFingerprint: SourceFingerprint;
  budget: RuntimeMigrationBudgetEvidence;
  liveBudgetReservation: D1ReleaseBudgetReservationResult;
  migrationFiles: RuntimeMigrationFileEvidence[];
  stateBefore: RuntimeMigrationExactState;
}) {
  const evidence = {
    kind: D1_RUNTIME_MIGRATION_PREWRITE_EVIDENCE_KIND,
    schemaVersion: 1,
    createdAt: input.createdAt,
    utcDay: input.budget.utcDay,
    backupDir: input.backupDir,
    database: { id: D1_DATABASE_ID, name: D1_DATABASE_NAME },
    sourceFingerprint: input.sourceFingerprint,
    migrationFiles: input.migrationFiles,
    projection: input.budget.projection,
    budgetReport: {
      kind: RUNTIME_MIGRATION_BUDGET_EVIDENCE_KIND,
      createdAt: input.budget.createdAt,
      operationId: RUNTIME_MIGRATION_BUDGET_OPERATION_ID,
      ledgerPath: input.budget.ledgerPath,
    },
    liveBudgetReservation: input.liveBudgetReservation,
    stateBefore: input.stateBefore,
    timeTravelBookmark: input.bookmark,
    timeTravelVerifiedAt: input.createdAt,
    recoveryPreference: "reviewed-forward-correction",
    destructiveRestoreSupported: false,
    automaticRestorePermitted: false,
  } as const;
  const timestamp = input.createdAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(
    cloudflareDir(input.backupDir),
    `d1-runtime-migrations-prewrite-${timestamp}.json`,
  );
  writePrivateJsonDurably(evidencePath, evidence, { replace: false });
  return evidencePath;
}

function writeOutcome(file: string, outcome: RuntimeMigrationApplyOutcome) {
  writePrivateJsonDurably(file, outcome, { replace: pathEntryExists(file) });
}

function buildOutcome(
  input: Omit<RuntimeMigrationApplyOutcome, "kind" | "schemaVersion" | "database">,
): RuntimeMigrationApplyOutcome {
  return {
    kind: D1_RUNTIME_MIGRATION_OUTCOME_KIND,
    schemaVersion: 1,
    database: { id: D1_DATABASE_ID, name: D1_DATABASE_NAME },
    ...input,
  };
}

function parseDailyUsage(value: unknown): D1DailyUsage {
  const usage = requiredRecord(value, "budget daily usage");
  const parsed = {
    databaseCount: positiveInteger(usage.databaseCount, "database count"),
    queryGroups: nonNegativeInteger(usage.queryGroups, "query groups"),
    rowsRead: nonNegativeInteger(usage.rowsRead, "rows read"),
    rowsWritten: nonNegativeInteger(usage.rowsWritten, "rows written"),
    executions: nonNegativeInteger(usage.executions, "executions"),
    windowMinutes: positiveInteger(usage.windowMinutes, "window minutes"),
  };
  if (parsed.windowMinutes > 1_440) throw new Error("Budget usage window exceeds one UTC day.");
  return parsed;
}

function parseCardinalities(value: unknown): RuntimeMigrationCardinalities {
  const record = requiredRecord(value, "runtime migration cardinalities");
  return {
    users: nonNegativeInteger(record.users, "users cardinality"),
    chats: nonNegativeInteger(record.chats, "chats cardinality"),
    messages: nonNegativeInteger(record.messages, "messages cardinality"),
    aiRuns: nonNegativeInteger(record.aiRuns, "AI runs cardinality"),
    rateLimitWindows: nonNegativeInteger(
      record.rateLimitWindows,
      "rate-limit windows cardinality",
    ),
    opsEvents: nonNegativeInteger(record.opsEvents, "ops events cardinality"),
    activityRuns: nonNegativeInteger(record.activityRuns, "activity runs cardinality"),
    userMemorySettings: nonNegativeInteger(
      record.userMemorySettings,
      "user memory settings cardinality",
    ),
    memorySourceFeedback: nonNegativeInteger(
      record.memorySourceFeedback,
      "memory source feedback cardinality",
    ),
    suppressionBackfillUsers: nonNegativeInteger(
      record.suppressionBackfillUsers,
      "suppression backfill users cardinality",
    ),
  };
}

function parseProjection(value: unknown): RuntimeMigrationProjection {
  const record = requiredRecord(value, "runtime migration projection");
  return {
    rowsRead: nonNegativeInteger(record.rowsRead, "projected rows read"),
    rowsWritten: nonNegativeInteger(record.rowsWritten, "projected rows written"),
    indexedRows: nonNegativeInteger(record.indexedRows, "projected indexed rows"),
    runtimeIndexRows: nonNegativeInteger(
      record.runtimeIndexRows,
      "projected runtime index rows",
    ),
    activityPartialUniqueIndexRows: nonNegativeInteger(
      record.activityPartialUniqueIndexRows,
      "projected activity index rows",
    ),
    snapshotRows: nonNegativeInteger(record.snapshotRows, "projected snapshot rows"),
    suppressionBackfillRowsRead: nonNegativeInteger(
      record.suppressionBackfillRowsRead,
      "projected suppression backfill reads",
    ),
    suppressionBackfillRowsWritten: nonNegativeInteger(
      record.suppressionBackfillRowsWritten,
      "projected suppression backfill writes",
    ),
    outboxSchemaRowsRead: nonNegativeInteger(
      record.outboxSchemaRowsRead,
      "projected 0016 fixed reads",
    ),
    outboxSchemaRowsWritten: nonNegativeInteger(
      record.outboxSchemaRowsWritten,
      "projected 0016 fixed writes",
    ),
    freshCutoverMarkerRowsRead: nonNegativeInteger(
      record.freshCutoverMarkerRowsRead,
      "projected fresh 0016 marker reads",
    ),
    freshCutoverMarkerRowsWritten: nonNegativeInteger(
      record.freshCutoverMarkerRowsWritten,
      "projected fresh 0016 marker writes",
    ),
  };
}

function parseSourceIdentity(value: unknown): D1ReleaseSourceIdentity {
  const record = requiredRecord(value, "source fingerprint");
  const sha256 = requiredString(record.sha256, "source fingerprint SHA-256");
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid source fingerprint SHA-256.");
  return {
    sha256,
    fileCount: positiveInteger(record.fileCount, "source fingerprint file count"),
  };
}

function assertStableMigrationFiles(
  expected: RuntimeMigrationFileEvidence[],
  current: RuntimeMigrationFileEvidence[],
) {
  if (JSON.stringify(expected) !== JSON.stringify(current)) {
    throw new Error("Runtime migration files changed after release evidence was captured.");
  }
}

function requiredMigrationFile(
  files: RuntimeMigrationFileEvidence[],
  migration: RuntimeMigrationId,
) {
  const matches = files.filter((file) => file.migration === migration);
  if (matches.length !== 1) throw new Error(`Missing exact ${migration} migration file evidence.`);
  return matches[0];
}

function requiredGroupState(value: unknown, migration: RuntimeMigrationId) {
  if (value !== "absent" && value !== "applied" && value !== "partial") {
    throw new Error(`Invalid exact state for runtime migration ${migration}.`);
  }
  return value;
}

function assertStableSourceFingerprint(expected: SourceFingerprint, current: SourceFingerprint) {
  if (expected.sha256 !== current.sha256 || expected.fileCount !== current.fileCount) {
    throw new Error("Source fingerprint changed during production D1 runtime migration application.");
  }
}

function assertSameSourceIdentity(
  expected: D1ReleaseSourceIdentity,
  current: D1ReleaseSourceIdentity,
) {
  if (expected.sha256 !== current.sha256 || expected.fileCount !== current.fileCount) {
    throw new Error("Runtime migration release evidence is bound to a different source fingerprint.");
  }
}

function compactFingerprint(value: SourceFingerprint): D1ReleaseSourceIdentity {
  return { sha256: value.sha256, fileCount: value.fileCount };
}

function requiredUtcDay(value: unknown) {
  const day = requiredString(value, "budget UTC day");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Invalid budget UTC day.");
  return day;
}

function requiredIsoTimestamp(value: unknown, label: string) {
  const timestamp = requiredString(value, label);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error(`Invalid ${label}.`);
  }
  return timestamp;
}

function validClockValue(value: Date, label: string) {
  if (!Number.isFinite(value.getTime())) throw new Error(`Invalid ${label} clock value.`);
  return value;
}

function safeClockIso(clock: () => Date) {
  try {
    return validClockValue(clock(), "failure outcome").toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function boundedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 4_000);
}

function nonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string) {
  const integer = nonNegativeInteger(value, label);
  if (integer === 0) throw new Error(`Invalid ${label}.`);
  return integer;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${label}.`);
  return value;
}

function pathEntryExists(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
