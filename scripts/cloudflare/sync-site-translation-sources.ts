import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { siteSourceManifest } from "@/lib/i18n/site-source-manifest";
import {
  assertD1FreeDailyBudget,
  loadAccountD1DailyUsage,
  type D1DailyUsage,
} from "./d1-free-budget";
import {
  assertD1ReleaseBudgetReservation,
  assertD1ReleaseBudgetUtcDay,
  reserveD1ReleaseBudget,
  writePrivateJsonDurably,
  type D1ReleaseBudgetReservationResult,
  type D1ReleaseSourceIdentity,
} from "./d1-release-budget-ledger";
import {
  cloudflareDir,
  createHash,
  D1_DATABASE_NAME,
  parseD1TimeTravelBookmark,
  resolveBackupDir,
  runWrangler,
  type WranglerRunner,
} from "./migration-config";
import { buildRepoSourceFingerprint } from "./source-fingerprint";
import { assertProductionReleaseChildExclusion } from "./production-validation-lock";

export type SourceManifestEntry = {
  sourceHash: string;
  sourceStrings: Record<string, string>;
};

type SyncMode = "local" | "remote";

export type SiteTranslationSourceSnapshot = {
  sources: Record<string, string>;
  sourceStrings: Record<string, Record<string, string>>;
};

export type TranslationSourceHashGroup = {
  namespace: string;
  sourceHash: string;
  rows: number;
};

type ImportVerification = "not-required" | "verified";

export type SiteTranslationSourceSyncPlan = {
  sql: string;
  rows: number;
  sourceStringCount: number;
  sha256: string;
  statements: number;
  logicalRowWrites: number;
  projectedBilledRowWrites: number;
  currentRowCount: number;
  translationRowCount: number;
  snapshotBilledRowReads: number;
  projectedBilledRowReads: number;
};

export type TemporarySqlFileAttestation = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
  file: Readonly<{
    device: number;
    inode: number;
    mode: number;
    links: number;
    owner: number;
    modifiedAtMs: number;
    changedAtMs: number;
  }>;
  directory: Readonly<{
    path: string;
    device: number;
    inode: number;
    mode: number;
    owner: number;
    modifiedAtMs: number;
    changedAtMs: number;
  }>;
}>;

export class TemporarySqlFileIntegrityError extends Error {
  readonly code = "TEMPORARY_SQL_FILE_INTEGRITY_FAILURE";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemporarySqlFileIntegrityError";
  }
}

export type SiteTranslationSourceSyncReport = {
  createdAt: string;
  backupDir: string;
  mode: SyncMode;
  database: string;
  rows: number;
  sourceStringCount: number;
  sha256: string;
  statements: number;
  logicalRowWrites: number;
  projectedBilledRowWrites: number;
  projectedBilledRowWriteLimit: number;
  projectedBilledRowReads: number;
  projectedBilledRowReadLimit: number;
  timeTravelVerified: boolean;
  timeTravelBookmark?: string;
  diagnosticEvidenceRequired: boolean;
  preWriteEvidencePath?: string;
  sourceReconciliationIncludedInMainRepair: true;
  importAttempted: boolean;
  importResponseConfirmed: boolean;
  importVerification: ImportVerification;
  responseRecoveredByVerification: boolean;
  verifiedRows: number;
  verifiedSourceStringCount: number;
  accountDailyUsage?: D1DailyUsage;
  d1ReleaseBudget?: {
    ledgerPath: string;
    utcDay: string;
    operationId: string;
    revision: number;
    phase: "maximum" | "exact";
    rowsRead: number;
    rowsWritten: number;
  };
  applied: boolean;
  ok: boolean;
};

// Keep at least half of the Workers Free daily D1 write allowance available for
// normal application traffic and unrelated release work. The factor below is
// conservative because D1 can count a table row and its primary-key index as
// separate writes.
export const MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES = 50_000;
export const MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS = 2_500_000;
const PROJECTED_BILLED_WRITES_PER_LOGICAL_ROW = 2;

export type SiteTranslationSourceSyncOptions = {
  confirmed?: boolean;
  now?: number;
  runner?: WranglerRunner;
  sources?: Array<[string, SourceManifestEntry]>;
  dailyUsage?: D1DailyUsage;
  clock?: () => Date;
  sourceFingerprintProvider?: () => D1ReleaseSourceIdentity;
};

if (isMainModule()) void main();

function main() {
  const mode: SyncMode = process.argv.includes("--remote") ? "remote" : "local";
  const confirmed = process.argv.includes("--confirm-production");
  if (mode === "remote") {
    if (!confirmed) {
      throw new Error("Remote site translation source synchronization requires --confirm-production.");
    }
    assertProductionReleaseChildExclusion("sync-site-translation-sources");
  }
  const backupDir = resolveBackupDir();
  const report = syncSiteTranslationSources(mode, backupDir, { confirmed });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function syncSiteTranslationSources(
  mode: SyncMode = "local",
  backupDir = resolveBackupDir(),
  options: SiteTranslationSourceSyncOptions = {},
) {
  if (mode === "remote" && !options.confirmed) {
    throw new Error("Remote site translation source synchronization requires --confirm-production.");
  }

  const runner = options.runner ?? runWrangler;
  const sources = options.sources ?? manifestEntries();
  const clock = sourceSyncClock(options);
  const startedAt = readSourceSyncClock(clock, "source-sync start");
  const now = startedAt.getTime();
  const accountDailyUsage =
    mode === "remote" ? options.dailyUsage ?? loadAccountD1DailyUsage(startedAt) : undefined;
  const sourceFingerprintProvider =
    options.sourceFingerprintProvider ?? defaultSourceFingerprintProvider;
  const sourceFingerprint =
    mode === "remote" ? sourceFingerprintProvider() : undefined;
  const sourceManifestSha256 = sourceManifestHash(sources);
  const operationId = sourceFingerprint
    ? siteTranslationSourceSyncOperationId({
        sourceFingerprint,
        sourceManifestSha256,
      })
    : undefined;
  let budgetReservation: D1ReleaseBudgetReservationResult | undefined;
  if (mode === "remote") {
    if (!accountDailyUsage || !sourceFingerprint || !operationId) {
      throw new Error("Remote source synchronization is missing its source-bound budget identity.");
    }
    assertD1FreeDailyBudget(accountDailyUsage, {
      operation: "Remote site translation source synchronization preflight",
      rowsRead: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
      rowsWritten: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    });
    budgetReservation = reserveD1ReleaseBudget({
      backupDir,
      operationId,
      operation: "Remote site translation source synchronization",
      sourceFingerprint,
      phase: "maximum",
      rowsRead: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
      rowsWritten: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
      observedUsage: accountDailyUsage,
      now: startedAt,
    });
  }
  const before = readCurrentSnapshot(mode, runner);
  const plan = buildSiteTranslationSourceSyncPlan(
    sources,
    before.snapshot,
    now,
    before.billedRowReads,
    before.translationRowCount,
  );
  assertSourceSyncWriteBudget(plan);
  assertSourceSyncReadBudget(plan);
  if (accountDailyUsage) {
    assertD1FreeDailyBudget(accountDailyUsage, {
      operation: "Remote site translation source synchronization",
      rowsRead: plan.projectedBilledRowReads,
      rowsWritten: plan.projectedBilledRowWrites,
    });
  }

  const mutationRequired = plan.statements > 0;
  if (mode === "remote") {
    if (!accountDailyUsage || !budgetReservation || !sourceFingerprint || !operationId) {
      throw new Error("Remote source synchronization lost its D1 budget reservation.");
    }
    const completedReplay =
      !mutationRequired && budgetReservation.reservation.phase === "exact";
    if (!completedReplay) {
      budgetReservation = reserveD1ReleaseBudget({
        backupDir,
        operationId,
        operation: "Remote site translation source synchronization",
        sourceFingerprint,
        phase: "exact",
        rowsRead: plan.projectedBilledRowReads,
        rowsWritten: plan.projectedBilledRowWrites,
        observedUsage: accountDailyUsage,
        now: readSourceSyncClock(clock, "source-sync exact reservation"),
        expectedUtcDay: budgetReservation.utcDay,
      });
    }
  }
  if (mode === "remote" && mutationRequired) {
    assertStandaloneSourceOnlyMutationSafe(before, sources);
  }

  let timeTravelBookmark: string | undefined;
  let preWriteEvidencePath: string | undefined;
  if (mode === "remote" && mutationRequired) {
    timeTravelBookmark = parseD1TimeTravelBookmark(
      runner(["d1", "time-travel", "info", D1_DATABASE_NAME, "--json"]),
    );
    preWriteEvidencePath = writeSiteTranslationSourcePreWriteDiagnosticEvidence({
      backupDir,
      bookmark: timeTravelBookmark,
      sql: plan.sql,
      plan,
      now,
      d1ReleaseBudget: budgetReservation,
    });
  }

  let importAttempted = false;
  let importResponseConfirmed = false;
  let importTransportError: unknown;
  if (mutationRequired) {
    if (mode === "remote") {
      if (!accountDailyUsage || !sourceFingerprint || !operationId || !budgetReservation) {
        throw new Error("Remote source synchronization reached a write without D1 budget evidence.");
      }
      const liveSourceFingerprint = sourceFingerprintProvider();
      assertSameSourceSyncFingerprint(sourceFingerprint, liveSourceFingerprint);
      const liveOperationId = siteTranslationSourceSyncOperationId({
        sourceFingerprint: liveSourceFingerprint,
        sourceManifestSha256: sourceManifestHash(sources),
      });
      if (liveOperationId !== operationId) {
        throw new Error("Remote source synchronization plan drifted before its D1 write.");
      }
      budgetReservation = assertD1ReleaseBudgetReservation({
        ledgerPath: budgetReservation.ledgerPath,
        utcDay: budgetReservation.utcDay,
        operationId,
        sourceFingerprint: liveSourceFingerprint,
        phase: "exact",
        rowsRead: plan.projectedBilledRowReads,
        rowsWritten: plan.projectedBilledRowWrites,
        now: readSourceSyncClock(clock, "source-sync pre-write ledger validation"),
      });
      assertD1ReleaseBudgetUtcDay(
        budgetReservation.utcDay,
        readSourceSyncClock(clock, "source-sync final pre-write UTC day"),
      );
    }
    importAttempted = true;
    try {
      executeSiteTranslationSourceSyncPlan(plan, mode, runner);
      importResponseConfirmed = true;
    } catch (error) {
      if (error instanceof TemporarySqlFileIntegrityError) throw error;
      // Wrangler can lose its final poll response after D1 commits. Exact
      // verification below, not the transport response, decides success.
      importTransportError = error;
    }
  }

  let after = before;
  if (mutationRequired) {
    try {
      after = readCurrentSnapshot(mode, runner);
    } catch (verificationError) {
      throw new AggregateError(
        [importTransportError, verificationError].filter(
          (error): error is NonNullable<unknown> => error !== undefined,
        ),
        "Site translation source synchronization outcome is indeterminate; no success report was written. Use the fsynced Time Travel diagnostic evidence to prepare a reviewed forward correction.",
      );
    }
  }

  let verification: ReturnType<typeof verifySiteTranslationSourceSnapshot>;
  try {
    verification = verifySiteTranslationSourceSnapshot(after.snapshot, sources);
    if (mutationRequired) {
      verifyTranslationHashGroupsUnchanged(
        before.translationHashGroups,
        after.translationHashGroups,
      );
    }
  } catch (verificationError) {
    throw new AggregateError(
      [importTransportError, verificationError].filter(
        (error): error is NonNullable<unknown> => error !== undefined,
      ),
      "Site translation source synchronization failed exact verification. Destructive whole-database restore is unsupported on Free; use a reviewed forward correction.",
    );
  }

  const importVerification: ImportVerification = mutationRequired ? "verified" : "not-required";

  const report: SiteTranslationSourceSyncReport = {
    createdAt: startedAt.toISOString(),
    backupDir,
    mode,
    database: D1_DATABASE_NAME,
    rows: plan.rows,
    sourceStringCount: plan.sourceStringCount,
    sha256: plan.sha256,
    statements: plan.statements,
    logicalRowWrites: plan.logicalRowWrites,
    projectedBilledRowWrites: plan.projectedBilledRowWrites,
    projectedBilledRowWriteLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    projectedBilledRowReads: plan.projectedBilledRowReads,
    projectedBilledRowReadLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
    timeTravelVerified: Boolean(timeTravelBookmark),
    timeTravelBookmark,
    diagnosticEvidenceRequired: mode === "remote" && mutationRequired,
    preWriteEvidencePath,
    sourceReconciliationIncludedInMainRepair: true,
    importAttempted,
    importResponseConfirmed,
    importVerification,
    responseRecoveredByVerification: importAttempted && !importResponseConfirmed,
    verifiedRows: verification.rows,
    verifiedSourceStringCount: verification.sourceStringCount,
    accountDailyUsage,
    d1ReleaseBudget: budgetReservation
      ? {
          ledgerPath: budgetReservation.ledgerPath,
          utcDay: budgetReservation.utcDay,
          operationId: budgetReservation.reservation.operationId,
          revision: budgetReservation.revision,
          phase: budgetReservation.reservation.phase,
          rowsRead: budgetReservation.reservation.rowsRead,
          rowsWritten: budgetReservation.reservation.rowsWritten,
        }
      : undefined,
    applied: mutationRequired,
    ok: plan.rows > 0 && verification.rows === plan.rows,
  };
  writeReport(report, backupDir);
  return report;
}

export function planSiteTranslationSourceSync(
  mode: SyncMode,
  runner: WranglerRunner = runWrangler,
): SiteTranslationSourceSyncPlan {
  const current = readCurrentSnapshot(mode, runner);
  return buildSiteTranslationSourceSyncPlan(
    manifestEntries(),
    current.snapshot,
    Date.now(),
    current.billedRowReads,
    current.translationRowCount,
  );
}

export function buildSiteTranslationSourceSyncPlan(
  sources: Array<[string, SourceManifestEntry]> = manifestEntries(),
  current: SiteTranslationSourceSnapshot = emptySnapshot(),
  updatedAt = Date.now(),
  snapshotBilledRowReads = currentSnapshotRowCount(current),
  translationRowCount = 0,
): SiteTranslationSourceSyncPlan {
  const statements: string[] = [];
  let logicalRowWrites = 0;
  const desiredNamespaces = new Set(sources.map(([namespace]) => namespace));

  for (const [namespace, entry] of sources) {
    if (current.sources[namespace] !== entry.sourceHash) {
      statements.push(
        [
          "INSERT INTO app_translation_sources (namespace, source_hash, updated_at) VALUES (",
          sqlString(namespace),
          ", ",
          sqlString(entry.sourceHash),
          ", ",
          String(updatedAt),
          ") ON CONFLICT(namespace) DO UPDATE SET source_hash = excluded.source_hash, updated_at = excluded.updated_at",
          " WHERE app_translation_sources.source_hash <> excluded.source_hash;",
        ].join(""),
      );
      logicalRowWrites += 1;
    }

    const currentStrings = current.sourceStrings[namespace] ?? {};
    for (const [key, value] of Object.entries(entry.sourceStrings)) {
      if (currentStrings[key] === value) continue;
      statements.push(
        [
          "INSERT INTO app_translation_source_strings (namespace, source_key, source_text) VALUES (",
          sqlString(namespace),
          ", ",
          sqlString(key),
          ", ",
          sqlString(value),
          ") ON CONFLICT(namespace, source_key) DO UPDATE SET source_text = excluded.source_text",
          " WHERE app_translation_source_strings.source_text <> excluded.source_text;",
        ].join(""),
      );
      logicalRowWrites += 1;
    }

    const desiredKeys = new Set(Object.keys(entry.sourceStrings));
    for (const key of Object.keys(currentStrings)) {
      if (desiredKeys.has(key)) continue;
      statements.push(
        "DELETE FROM app_translation_source_strings WHERE namespace = " +
          sqlString(namespace) +
          " AND source_key = " +
          sqlString(key) +
          ";",
      );
      logicalRowWrites += 1;
    }
  }

  for (const namespace of Object.keys(current.sources)) {
    if (desiredNamespaces.has(namespace)) continue;
    statements.push(
      "DELETE FROM app_translation_sources WHERE namespace = " + sqlString(namespace) + ";",
    );
    logicalRowWrites += 1 + Object.keys(current.sourceStrings[namespace] ?? {}).length;
  }

  const sourceStringCount = sources.reduce(
    (sum, [, entry]) => sum + Object.keys(entry.sourceStrings).length,
    0,
  );
  const currentRowCount = currentSnapshotRowCount(current);
  const projectedBilledRowReads =
    snapshotBilledRowReads +
    currentRowCount * 3 +
    translationRowCount * 2 +
    (sources.length + sourceStringCount) * 2 +
    statements.length * 2 +
    1_000;

  return {
    sql: statements.length ? "PRAGMA foreign_keys = ON;\n" + statements.join("\n") + "\n" : "",
    rows: sources.length,
    sourceStringCount,
    sha256: sourceManifestHash(sources),
    statements: statements.length,
    logicalRowWrites,
    projectedBilledRowWrites: logicalRowWrites * PROJECTED_BILLED_WRITES_PER_LOGICAL_ROW,
    currentRowCount,
    translationRowCount,
    snapshotBilledRowReads,
    projectedBilledRowReads,
  };
}

export function assertSourceSyncWriteBudget(plan: SiteTranslationSourceSyncPlan) {
  if (
    !Number.isSafeInteger(plan.projectedBilledRowWrites) ||
    plan.projectedBilledRowWrites < 0
  ) {
    throw new Error("Projected D1 source-sync writes must be a non-negative safe integer.");
  }
  if (plan.projectedBilledRowWrites > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES) {
    throw new Error(
      "Projected D1 source-sync writes exceed the Workers Free safety budget: " +
        plan.projectedBilledRowWrites +
        " > " +
        MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES +
      ".",
    );
  }
  return plan.projectedBilledRowWrites;
}

export function assertSourceSyncReadBudget(plan: SiteTranslationSourceSyncPlan) {
  if (
    !Number.isSafeInteger(plan.projectedBilledRowReads) ||
    plan.projectedBilledRowReads < 0
  ) {
    throw new Error("Projected D1 source-sync reads must be a non-negative safe integer.");
  }
  if (plan.projectedBilledRowReads > MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS) {
    throw new Error(
      "Projected D1 source-sync reads exceed the Workers Free safety budget: " +
        plan.projectedBilledRowReads +
        " > " +
        MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS +
        ".",
    );
  }
  return plan.projectedBilledRowReads;
}

export function executeSiteTranslationSourceSyncPlan(
  plan: SiteTranslationSourceSyncPlan,
  mode: SyncMode,
  runner: WranglerRunner = runWrangler,
) {
  if (!plan.sql || plan.statements === 0) return;
  const sqlPath = writeTemporarySqlFile(plan.sql, "site-translation-source-sync.sql");
  const before = attestTemporarySqlFile(sqlPath, plan.sql);
  let runnerError: unknown;
  try {
    runner(
      [
        "d1",
        "execute",
        D1_DATABASE_NAME,
        mode === "remote" ? "--remote" : "--local",
        "--file",
        sqlPath,
        "--yes",
      ],
      { maxBuffer: 128 * 1024 * 1024 },
    );
  } catch (error) {
    runnerError = error;
  }

  let after: TemporarySqlFileAttestation;
  try {
    // Wrangler receives only a path, so an inode cannot be pinned across its
    // child process. Reopening O_NOFOLLOW immediately on both sides of that
    // synchronous call is the narrowest portable attestation boundary.
    after = attestTemporarySqlFile(sqlPath, plan.sql);
    assertSameTemporarySqlFileAttestation(before, after);
  } catch (error) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL file changed while Wrangler could consume it; exact database verification is required before any retry.",
      {
        cause:
          runnerError === undefined
            ? error
            : new AggregateError(
                [runnerError, error],
                "Wrangler and temporary SQL attestation both failed.",
              ),
      },
    );
  }

  try {
    removeAttestedTemporarySqlFile(after, plan.sql);
  } catch (error) {
    throw new TemporarySqlFileIntegrityError(
      "The attested temporary SQL file could not be removed through its exact private-file identity.",
      {
        cause:
          runnerError === undefined
            ? error
            : new AggregateError(
                [runnerError, error],
                "Wrangler and temporary SQL cleanup both failed.",
              ),
      },
    );
  }

  if (runnerError !== undefined) throw runnerError;
}

export function writeTemporarySqlFile(sql: string, filename: string) {
  assertSafeTemporarySqlFilename(filename);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-site-translation-sources-"));
  const sqlPath = path.join(tmpDir, filename);
  const bytes = Buffer.from(sql, "utf8");
  let descriptor: number | undefined;
  try {
    fs.chmodSync(tmpDir, 0o700);
    const directory = attestPrivateTemporarySqlDirectory(tmpDir);
    descriptor = fs.openSync(
      sqlPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    fs.fchmodSync(descriptor, 0o600);
    const before = fs.fstatSync(descriptor);
    assertPrivateTemporarySqlFileStat(before, 0, "new temporary SQL file");
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assertPrivateTemporarySqlFileStat(
      after,
      bytes.byteLength,
      "written temporary SQL file",
    );
    if (!sameFileIdentity(before, after)) {
      throw new TemporarySqlFileIntegrityError(
        "The temporary SQL inode changed during its exclusive durable write.",
      );
    }
    fs.closeSync(descriptor);
    descriptor = undefined;
    fsyncTemporarySqlDirectory(tmpDir, directory);
    const attestation = attestTemporarySqlFile(sqlPath, sql);
    if (
      attestation.file.device !== after.dev ||
      attestation.file.inode !== after.ino ||
      attestation.directory.device !== directory.device ||
      attestation.directory.inode !== directory.inode
    ) {
      throw new TemporarySqlFileIntegrityError(
        "The temporary SQL path changed before its durable readback completed.",
      );
    }
    return sqlPath;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original integrity failure.
      }
    }
    removeTemporarySqlDirectoryBestEffort(tmpDir, sqlPath);
    if (error instanceof TemporarySqlFileIntegrityError) throw error;
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL file could not be created exclusively and durably.",
      { cause: error },
    );
  }
}

export function attestTemporarySqlFile(
  sqlPath: string,
  expectedSql: string,
): TemporarySqlFileAttestation {
  const absolutePath = path.resolve(sqlPath);
  const expectedBytes = Buffer.from(expectedSql, "utf8");
  const directory = attestPrivateTemporarySqlDirectory(path.dirname(absolutePath));
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolutePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL path must be a readable regular non-symlink file.",
      { cause: error },
    );
  }

  let before: fs.Stats;
  let after: fs.Stats;
  let bytes: Buffer;
  try {
    before = fs.fstatSync(descriptor);
    assertPrivateTemporarySqlFileStat(
      before,
      expectedBytes.byteLength,
      "temporary SQL file before readback",
    );
    bytes = fs.readFileSync(descriptor);
    after = fs.fstatSync(descriptor);
    assertPrivateTemporarySqlFileStat(
      after,
      expectedBytes.byteLength,
      "temporary SQL file after readback",
    );
  } catch (error) {
    if (error instanceof TemporarySqlFileIntegrityError) throw error;
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL file could not be read through its no-follow descriptor.",
      { cause: error },
    );
  } finally {
    fs.closeSync(descriptor);
  }

  if (!sameStableFile(before, after) || !bytes.equals(expectedBytes)) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL file changed during readback or does not match the exact expected bytes.",
    );
  }
  const named = readNamedTemporarySqlFileStat(absolutePath, expectedBytes.byteLength);
  if (!sameStableFile(after, named)) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL filename no longer identifies the no-follow file descriptor.",
    );
  }
  const directoryAfter = attestPrivateTemporarySqlDirectory(path.dirname(absolutePath));
  if (!sameDirectoryAttestation(directory, directoryAfter)) {
    throw new TemporarySqlFileIntegrityError(
      "The private temporary SQL directory changed during file attestation.",
    );
  }

  return Object.freeze({
    path: absolutePath,
    bytes: bytes.byteLength,
    sha256: createHash().update(bytes).digest("hex"),
    file: Object.freeze({
      device: after.dev,
      inode: after.ino,
      mode: after.mode & 0o777,
      links: after.nlink,
      owner: after.uid,
      modifiedAtMs: after.mtimeMs,
      changedAtMs: after.ctimeMs,
    }),
    directory: Object.freeze({ ...directoryAfter }),
  });
}

export function assertSameTemporarySqlFileAttestation(
  before: TemporarySqlFileAttestation,
  after: TemporarySqlFileAttestation,
) {
  if (
    before.path !== after.path ||
    before.bytes !== after.bytes ||
    before.sha256 !== after.sha256 ||
    before.file.device !== after.file.device ||
    before.file.inode !== after.file.inode ||
    before.file.mode !== after.file.mode ||
    before.file.links !== after.file.links ||
    before.file.owner !== after.file.owner ||
    before.file.modifiedAtMs !== after.file.modifiedAtMs ||
    before.file.changedAtMs !== after.file.changedAtMs ||
    !sameDirectoryAttestation(before.directory, after.directory)
  ) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL file or its private directory was replaced during Wrangler consumption.",
    );
  }
}

export function removeAttestedTemporarySqlFile(
  expected: TemporarySqlFileAttestation,
  expectedSql: string,
) {
  const current = attestTemporarySqlFile(expected.path, expectedSql);
  assertSameTemporarySqlFileAttestation(expected, current);
  fs.unlinkSync(expected.path);
  fsyncTemporarySqlDirectory(expected.directory.path, expected.directory);
  assertPathAbsent(expected.path, "temporary SQL file");
  fs.rmdirSync(expected.directory.path);
}

type TemporarySqlDirectoryAttestation = TemporarySqlFileAttestation["directory"];

function attestPrivateTemporarySqlDirectory(
  directoryPath: string,
): TemporarySqlDirectoryAttestation {
  const absolutePath = path.resolve(directoryPath);
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolutePath,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL directory must be a real owner-only directory.",
      { cause: error },
    );
  }
  let descriptorStat: fs.Stats;
  try {
    descriptorStat = fs.fstatSync(descriptor);
    assertPrivateTemporarySqlDirectoryStat(descriptorStat);
  } finally {
    fs.closeSync(descriptor);
  }
  let namedStat: fs.Stats;
  try {
    namedStat = fs.lstatSync(absolutePath);
  } catch (error) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL directory could not be inspected by name.",
      { cause: error },
    );
  }
  assertPrivateTemporarySqlDirectoryStat(namedStat);
  if (!sameStableDirectory(descriptorStat, namedStat)) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL directory name no longer identifies its no-follow descriptor.",
    );
  }
  return Object.freeze({
    path: absolutePath,
    device: descriptorStat.dev,
    inode: descriptorStat.ino,
    mode: descriptorStat.mode & 0o777,
    owner: descriptorStat.uid,
    modifiedAtMs: descriptorStat.mtimeMs,
    changedAtMs: descriptorStat.ctimeMs,
  });
}

function assertPrivateTemporarySqlFileStat(
  stat: fs.Stats,
  expectedBytes: number,
  label: string,
) {
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size !== expectedBytes ||
    !ownedByCurrentUser(stat)
  ) {
    throw new TemporarySqlFileIntegrityError(
      `The ${label} has unsafe type, links, mode, ownership, or byte length.`,
    );
  }
}

function assertPrivateTemporarySqlDirectoryStat(stat: fs.Stats) {
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    !ownedByCurrentUser(stat)
  ) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL directory has unsafe type, mode, or ownership.",
    );
  }
}

function readNamedTemporarySqlFileStat(sqlPath: string, expectedBytes: number) {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(sqlPath);
  } catch (error) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL file could not be inspected by name.",
      { cause: error },
    );
  }
  assertPrivateTemporarySqlFileStat(stat, expectedBytes, "named temporary SQL file");
  return stat;
}

function fsyncTemporarySqlDirectory(
  directoryPath: string,
  expected: TemporarySqlDirectoryAttestation,
) {
  const before = attestPrivateTemporarySqlDirectory(directoryPath);
  if (
    before.device !== expected.device ||
    before.inode !== expected.inode ||
    before.mode !== expected.mode ||
    before.owner !== expected.owner
  ) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL directory changed before durable synchronization.",
    );
  }
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      before.path,
      fs.constants.O_RDONLY |
        fs.constants.O_DIRECTORY |
        fs.constants.O_NOFOLLOW,
    );
  } catch (error) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL directory could not be opened for durable synchronization.",
      { cause: error },
    );
  }
  try {
    const stat = fs.fstatSync(descriptor);
    assertPrivateTemporarySqlDirectoryStat(stat);
    if (stat.dev !== expected.device || stat.ino !== expected.inode) {
      throw new TemporarySqlFileIntegrityError(
        "The temporary SQL directory changed before fsync.",
      );
    }
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertSafeTemporarySqlFilename(filename: string) {
  if (
    !filename ||
    filename === "." ||
    filename === ".." ||
    filename !== path.basename(filename) ||
    filename.includes("\0")
  ) {
    throw new TemporarySqlFileIntegrityError(
      "The temporary SQL filename must be a plain non-empty basename.",
    );
  }
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left: fs.Stats, right: fs.Stats) {
  return (
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function sameStableDirectory(left: fs.Stats, right: fs.Stats) {
  return (
    sameFileIdentity(left, right) &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function sameDirectoryAttestation(
  left: TemporarySqlDirectoryAttestation,
  right: TemporarySqlDirectoryAttestation,
) {
  return (
    left.path === right.path &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.owner === right.owner &&
    left.modifiedAtMs === right.modifiedAtMs &&
    left.changedAtMs === right.changedAtMs
  );
}

function ownedByCurrentUser(stat: fs.Stats) {
  return typeof process.getuid !== "function" || stat.uid === process.getuid();
}

function assertPathAbsent(file: string, label: string) {
  try {
    fs.lstatSync(file);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw new TemporarySqlFileIntegrityError(
      `The ${label} absence could not be verified after cleanup.`,
      { cause: error },
    );
  }
  throw new TemporarySqlFileIntegrityError(
    `The ${label} still exists after cleanup.`,
  );
}

function removeTemporarySqlDirectoryBestEffort(
  directoryPath: string,
  sqlPath: string,
) {
  try {
    const directory = fs.lstatSync(directoryPath);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      (directory.mode & 0o777) !== 0o700 ||
      !ownedByCurrentUser(directory)
    ) {
      return;
    }
    try {
      fs.unlinkSync(sqlPath);
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) return;
    }
    fs.rmdirSync(directoryPath);
  } catch {
    // The creation error remains authoritative. Never recurse through a path
    // whose exact file identity was not successfully attested.
  }
}

function manifestEntries() {
  return Object.entries(siteSourceManifest as Record<string, SourceManifestEntry>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
}

function readCurrentSnapshot(
  mode: SyncMode,
  runner: WranglerRunner,
  options: { requireSingleAttempt?: boolean } = {},
) {
  const sql = [
    "SELECT namespace, source_hash FROM app_translation_sources ORDER BY namespace;",
    "SELECT namespace, source_key, source_text FROM app_translation_source_strings ORDER BY namespace, source_key;",
    "SELECT namespace, source_hash, count(*) AS translation_rows FROM app_translations GROUP BY namespace, source_hash ORDER BY namespace, source_hash;",
  ].join("\n");
  const output = runner(
    [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      mode === "remote" ? "--remote" : "--local",
      "--json",
      "--command",
      sql,
    ],
    { maxBuffer: 128 * 1024 * 1024 },
  );
  const resultSets = parseD1SourceSnapshotResultSets(output);
  const billedRowReads = parseD1SourceSnapshotBilledRowReads(output, {
    required: mode === "remote",
    readOnly: mode === "remote" && options.requireSingleAttempt === true,
    requireSingleAttempt: options.requireSingleAttempt === true,
  });
  const sourceRows = resultSets[0];
  const sourceStringRows = resultSets[1];
  const translationHashRows = resultSets[2];
  if (!sourceRows || !sourceStringRows || !translationHashRows) {
    throw new Error("Wrangler D1 source snapshot is missing an expected result set.");
  }
  const sourcesByNamespace = new Map<string, string>();
  const sourceStringsByNamespace = new Map<string, Map<string, string>>();

  for (const [index, row] of sourceRows.entries()) {
    const namespace = parseSnapshotIdentity(
      row.namespace,
      `source row ${index + 1} namespace`,
    );
    const sourceHash = parseSnapshotIdentity(
      row.source_hash,
      `source row ${index + 1} source hash`,
    );
    if (sourcesByNamespace.has(namespace)) {
      throw new Error(
        `Wrangler D1 source snapshot contains duplicate namespace ${JSON.stringify(namespace)}.`,
      );
    }
    sourcesByNamespace.set(namespace, sourceHash);
  }
  for (const [index, row] of sourceStringRows.entries()) {
    const namespace = parseSnapshotIdentity(
      row.namespace,
      `source-string row ${index + 1} namespace`,
    );
    const sourceKey = parseSnapshotIdentity(
      row.source_key,
      `source-string row ${index + 1} source key`,
    );
    if (typeof row.source_text !== "string") {
      throw new Error(`Wrangler D1 source-string snapshot row ${index + 1} has an invalid contract.`);
    }
    let strings = sourceStringsByNamespace.get(namespace);
    if (!strings) {
      strings = new Map<string, string>();
      sourceStringsByNamespace.set(namespace, strings);
    }
    if (strings.has(sourceKey)) {
      throw new Error(
        "Wrangler D1 source-string snapshot contains duplicate identity " +
          `${JSON.stringify(namespace)}/${JSON.stringify(sourceKey)}.`,
      );
    }
    strings.set(sourceKey, row.source_text);
  }
  const snapshot: SiteTranslationSourceSnapshot = {
    sources: Object.fromEntries(sourcesByNamespace),
    sourceStrings: Object.fromEntries(
      Array.from(sourceStringsByNamespace, ([namespace, strings]) => [
        namespace,
        Object.fromEntries(strings),
      ]),
    ),
  };
  const translationHashGroups: TranslationSourceHashGroup[] = [];
  const seenTranslationGroups = new Set<string>();
  let translationRowCount = 0;
  for (const [index, row] of translationHashRows.entries()) {
    const group = parseTranslationSourceHashGroup(row, index);
    const identity = `${group.namespace}\u0000${group.sourceHash}`;
    if (seenTranslationGroups.has(identity)) {
      throw new Error(
        `Wrangler D1 source snapshot contains duplicate translation hash group ${group.namespace}.`,
      );
    }
    seenTranslationGroups.add(identity);
    translationRowCount += group.rows;
    if (!Number.isSafeInteger(translationRowCount)) {
      throw new Error("Wrangler D1 source snapshot translation row count exceeds a safe integer.");
    }
    translationHashGroups.push(group);
  }
  return { snapshot, billedRowReads, translationRowCount, translationHashGroups };
}

/**
 * Read-only source-catalog snapshot for a release wrapper that already owns
 * its production authority and budget. This does not grant remote authority
 * by itself and deliberately performs no mutation.
 */
export function readRemoteSiteTranslationSourceSnapshot(
  runner: WranglerRunner = runWrangler,
  options: { requireSingleAttempt?: boolean } = {},
) {
  return readCurrentSnapshot("remote", runner, options);
}

function emptySnapshot(): SiteTranslationSourceSnapshot {
  return {
    sources: Object.fromEntries([]),
    sourceStrings: Object.fromEntries([]),
  };
}

export function parseD1SourceSnapshotResultSets(output: string) {
  const parsed = parseJsonFromOutput(output);
  if (!Array.isArray(parsed)) {
    throw new Error("Wrangler D1 source snapshot did not return an array.");
  }
  if (parsed.length !== 3) {
    throw new Error(`Wrangler D1 source snapshot returned ${parsed.length} result sets; expected 3.`);
  }
  return parsed.map((entry, resultSetIndex) => {
    if (!isRecord(entry)) {
      throw new Error(`Wrangler D1 source snapshot result set ${resultSetIndex + 1} is malformed.`);
    }
    if (entry.success !== true) {
      throw new Error(`Wrangler D1 source snapshot result set ${resultSetIndex + 1} was unsuccessful.`);
    }
    if (!Array.isArray(entry.results)) {
      throw new Error(`Wrangler D1 source snapshot result set ${resultSetIndex + 1} has no row array.`);
    }
    return entry.results.map((row, rowIndex) => {
      if (!isRecord(row)) {
        throw new Error(
          `Wrangler D1 source snapshot result set ${resultSetIndex + 1} row ${rowIndex + 1} is malformed.`,
        );
      }
      return row;
    });
  });
}

export function parseD1SourceSnapshotBilledRowReads(
  output: string,
  options: {
    required?: boolean;
    readOnly?: boolean;
    requireSingleAttempt?: boolean;
  } = {},
) {
  const parsed = parseJsonFromOutput(output);
  if (!Array.isArray(parsed) || parsed.length !== 3) {
    throw new Error("Wrangler D1 source snapshot is missing billed read result sets.");
  }
  let total = 0;
  for (const [index, entry] of parsed.entries()) {
    if (
      !isRecord(entry) ||
      entry.success !== true ||
      !Array.isArray(entry.results)
    ) {
      throw new Error(`Wrangler D1 source snapshot result set ${index + 1} is malformed.`);
    }
    const meta = isRecord(entry.meta) ? entry.meta : undefined;
    const rowsRead = meta?.rows_read;
    const rowsWritten = meta?.rows_written;
    if (options.requireSingleAttempt && meta?.total_attempts !== 1) {
      throw new Error(
        `Wrangler D1 source snapshot result set ${index + 1} did not confirm exactly one billed attempt.`,
      );
    }
    if (
      options.readOnly &&
      (typeof rowsWritten !== "number" ||
        !Number.isSafeInteger(rowsWritten) ||
        rowsWritten !== 0)
    ) {
      throw new Error(
        `Wrangler D1 source snapshot result set ${index + 1} did not confirm zero billed writes.`,
      );
    }
    if (typeof rowsRead === "number" && Number.isSafeInteger(rowsRead) && rowsRead >= 0) {
      if (total > Number.MAX_SAFE_INTEGER - rowsRead) {
        throw new Error(
          "Wrangler D1 source snapshot billed rows_read total exceeds a safe integer.",
        );
      }
      total += rowsRead;
      continue;
    }
    if (options.required) {
      throw new Error(
        `Wrangler D1 source snapshot result set ${index + 1} is missing billed rows_read metadata.`,
      );
    }
    if (total > Number.MAX_SAFE_INTEGER - entry.results.length) {
      throw new Error(
        "Wrangler D1 source snapshot fallback row total exceeds a safe integer.",
      );
    }
    total += entry.results.length;
  }
  return total;
}

export function verifySiteTranslationSourceSnapshot(
  actual: SiteTranslationSourceSnapshot,
  sources: Array<[string, SourceManifestEntry]> = manifestEntries(),
) {
  const expectedNamespaces = new Set(sources.map(([namespace]) => namespace));
  const actualNamespaces = Object.keys(actual.sources);
  if (
    actualNamespaces.length !== sources.length ||
    actualNamespaces.some((namespace) => !expectedNamespaces.has(namespace))
  ) {
    throw new Error(
      `Site translation source namespace verification failed: ${actualNamespaces.length}/${sources.length}.`,
    );
  }

  let sourceStringCount = 0;
  for (const [namespace, expected] of sources) {
    if (actual.sources[namespace] !== expected.sourceHash) {
      throw new Error(`Site translation source hash verification failed for ${namespace}.`);
    }
    const actualStrings = actual.sourceStrings[namespace] ?? {};
    const expectedKeys = Object.keys(expected.sourceStrings);
    const actualKeys = Object.keys(actualStrings);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => !Object.hasOwn(expected.sourceStrings, key))
    ) {
      throw new Error(`Site translation source-string cardinality failed for ${namespace}.`);
    }
    for (const key of expectedKeys) {
      if (actualStrings[key] !== expected.sourceStrings[key]) {
        throw new Error(`Site translation source-string verification failed for ${namespace}/${key}.`);
      }
    }
    sourceStringCount += expectedKeys.length;
  }

  for (const namespace of Object.keys(actual.sourceStrings)) {
    if (!expectedNamespaces.has(namespace)) {
      throw new Error(`Site translation source verification found unexpected strings for ${namespace}.`);
    }
  }
  return { rows: sources.length, sourceStringCount };
}

function assertStandaloneSourceOnlyMutationSafe(
  before: {
    snapshot: SiteTranslationSourceSnapshot;
    translationHashGroups: readonly TranslationSourceHashGroup[];
  },
  sources: Array<[string, SourceManifestEntry]> = manifestEntries(),
) {
  const desired = new Map(sources);
  const changedNamespaces = changedSourceNamespaces(before.snapshot, sources);
  const unsafeGroups = before.translationHashGroups.filter((group) => {
    if (!changedNamespaces.has(group.namespace)) return false;
    return desired.get(group.namespace)?.sourceHash !== group.sourceHash;
  });
  if (unsafeGroups.length > 0) {
    const namespaces = Array.from(new Set(unsafeGroups.map((group) => group.namespace))).sort();
    throw new Error(
      "Standalone source synchronization would leave translation payloads stale for " +
        namespaces.join(", ") +
        ". Run cf:d1:repair-seo-translations instead; the main repair already reconciles source rows atomically with payloads.",
    );
  }
  return changedNamespaces;
}

function writeSiteTranslationSourcePreWriteDiagnosticEvidence(input: {
  backupDir: string;
  bookmark: string;
  sql: string;
  plan: SiteTranslationSourceSyncPlan;
  now?: number;
  d1ReleaseBudget: D1ReleaseBudgetReservationResult | undefined;
}) {
  if (!/^\S{8,}$/.test(input.bookmark)) {
    throw new Error("Source synchronization diagnostic evidence requires a valid Time Travel bookmark.");
  }
  if (!input.sql || input.plan.statements <= 0) {
    throw new Error("Source synchronization diagnostic evidence requires non-empty mutation SQL.");
  }
  assertSourceSyncWriteBudget(input.plan);
  assertSourceSyncReadBudget(input.plan);
  assertOperatorLocalEvidenceDirectory(input.backupDir);
  if (
    !input.d1ReleaseBudget ||
    input.d1ReleaseBudget.reservation.phase !== "exact" ||
    input.d1ReleaseBudget.reservation.rowsRead !== input.plan.projectedBilledRowReads ||
    input.d1ReleaseBudget.reservation.rowsWritten !== input.plan.projectedBilledRowWrites
  ) {
    throw new Error("Source synchronization diagnostic evidence requires an exact D1 budget reservation.");
  }

  const now = input.now ?? Date.now();
  const createdAt = new Date(now).toISOString();
  const evidence = {
    kind: "d1-site-translation-source-sync-prewrite-evidence",
    createdAt,
    database: D1_DATABASE_NAME,
    timeTravelBookmark: input.bookmark,
    timeTravelVerifiedAt: createdAt,
    recoveryPreference: "reviewed-forward-correction",
    destructiveRestoreSupported: false,
    exportPerformed: false,
    exportReason: "Cloudflare documents that D1 export blocks database requests.",
    sourceReconciliationIncludedInMainRepair: true,
    atomicSqlSha256: createHash().update(input.sql).digest("hex"),
    atomicSqlBytes: Buffer.byteLength(input.sql, "utf8"),
    atomicSqlStatements: countSiteTranslationSourceSqlStatements(input.sql),
    mutationStatements: input.plan.statements,
    sourceManifestSha256: input.plan.sha256,
    sourceNamespaces: input.plan.rows,
    sourceStrings: input.plan.sourceStringCount,
    currentSourceRows: input.plan.currentRowCount,
    translationRows: input.plan.translationRowCount,
    snapshotBilledRowReads: input.plan.snapshotBilledRowReads,
    logicalRowWrites: input.plan.logicalRowWrites,
    projectedBilledRowReads: input.plan.projectedBilledRowReads,
    projectedBilledRowReadLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_READS,
    projectedBilledRowWrites: input.plan.projectedBilledRowWrites,
    projectedBilledRowWriteLimit: MAX_PROJECTED_SOURCE_SYNC_BILLED_ROW_WRITES,
    d1ReleaseBudget: {
      ledgerPath: input.d1ReleaseBudget.ledgerPath,
      utcDay: input.d1ReleaseBudget.utcDay,
      operationId: input.d1ReleaseBudget.reservation.operationId,
      revision: input.d1ReleaseBudget.revision,
      rowsRead: input.d1ReleaseBudget.reservation.rowsRead,
      rowsWritten: input.d1ReleaseBudget.reservation.rowsWritten,
    },
  } as const;
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const evidencePath = path.join(
    cloudflareDir(input.backupDir),
    `site-translation-source-sync-prewrite-${timestamp}.json`,
  );
  writePrivateJsonDurably(evidencePath, evidence, { replace: false });
  return evidencePath;
}

function countSiteTranslationSourceSqlStatements(sql: string) {
  return countSqlStatements(sql, "site translation source");
}

function parseTranslationSourceHashGroup(
  row: Record<string, unknown>,
  index: number,
): TranslationSourceHashGroup {
  const namespace = parseSnapshotIdentity(
    row.namespace,
    `translation hash group ${index + 1} namespace`,
  );
  const sourceHash = parseSnapshotIdentity(
    row.source_hash,
    `translation hash group ${index + 1} source hash`,
  );
  if (!Number.isSafeInteger(row.translation_rows) || Number(row.translation_rows) <= 0) {
    throw new Error(`Wrangler D1 translation hash group ${index + 1} has an invalid row count.`);
  }
  return {
    namespace,
    sourceHash,
    rows: Number(row.translation_rows),
  };
}

function parseSnapshotIdentity(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(`Wrangler D1 ${label} must be a non-empty NUL-free string.`);
  }
  return value;
}

function changedSourceNamespaces(
  current: SiteTranslationSourceSnapshot,
  sources: Array<[string, SourceManifestEntry]>,
) {
  const changed = new Set<string>();
  const desiredNamespaces = new Set(sources.map(([namespace]) => namespace));
  for (const [namespace, entry] of sources) {
    if (current.sources[namespace] !== entry.sourceHash) changed.add(namespace);
    const currentStrings = current.sourceStrings[namespace] ?? {};
    const desiredKeys = Object.keys(entry.sourceStrings);
    if (
      Object.keys(currentStrings).length !== desiredKeys.length ||
      desiredKeys.some((key) => currentStrings[key] !== entry.sourceStrings[key])
    ) {
      changed.add(namespace);
    }
  }
  for (const namespace of Object.keys(current.sources)) {
    if (!desiredNamespaces.has(namespace)) changed.add(namespace);
  }
  return changed;
}

function verifyTranslationHashGroupsUnchanged(
  before: readonly TranslationSourceHashGroup[],
  after: readonly TranslationSourceHashGroup[],
) {
  const canonical = (groups: readonly TranslationSourceHashGroup[]) =>
    groups
      .map((group) => `${group.namespace}\u0000${group.sourceHash}\u0000${String(group.rows)}`)
      .sort();
  const expected = canonical(before);
  const actual = canonical(after);
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error("Site translation source verification found unexpected translation payload drift.");
  }
}

function assertOperatorLocalEvidenceDirectory(backupDir: string) {
  const relative = path.relative(process.cwd(), path.resolve(backupDir));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
  const root = relative.split(path.sep)[0];
  if (!root || !new Set(["tmp", "backups", "inspirlearning-local-backups"]).has(root)) {
    throw new Error("D1 diagnostic evidence must be written outside the repository or under a gitignored report directory.");
  }
}

function countSqlStatements(sql: string, label: string) {
  let quote: "'" | '"' | "`" | "]" | undefined;
  let statementHasContent = false;
  let statements = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote || (quote === "]" && character === "]")) {
        const next = sql[index + 1];
        if (quote !== "]" && next === quote) {
          index += 1;
        } else if (quote === "]" && next === "]") {
          index += 1;
        } else {
          quote = undefined;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      statementHasContent = true;
      continue;
    }
    if (character === "[") {
      quote = "]";
      statementHasContent = true;
      continue;
    }
    if (character === ";") {
      if (statementHasContent) statements += 1;
      statementHasContent = false;
      continue;
    }
    if (!/\s/.test(character)) statementHasContent = true;
  }
  if (quote) throw new Error(`The ${label} SQL contains an unterminated quoted value.`);
  if (statementHasContent) statements += 1;
  return statements;
}

function parseJsonFromOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last <= first) {
      throw new Error("Could not parse Wrangler D1 source snapshot JSON.");
    }
    return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
  }
}

function siteTranslationSourceSyncOperationId(input: {
  sourceFingerprint: D1ReleaseSourceIdentity;
  sourceManifestSha256: string;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.sourceFingerprint.sha256)) {
    throw new Error("Source-sync budget identity requires an exact source fingerprint.");
  }
  if (
    !Number.isSafeInteger(input.sourceFingerprint.fileCount) ||
    input.sourceFingerprint.fileCount <= 0
  ) {
    throw new Error("Source-sync budget identity requires a positive source file count.");
  }
  if (!/^[a-f0-9]{64}$/.test(input.sourceManifestSha256)) {
    throw new Error("Source-sync budget identity requires an exact source-manifest hash.");
  }
  const binding = createHash()
    .update(
      JSON.stringify({
        kind: "site-translation-source-sync",
        sourceFingerprint: input.sourceFingerprint,
        sourceManifestSha256: input.sourceManifestSha256,
      }),
    )
    .digest("hex");
  return `site-translation-source-sync:${binding}`;
}

function sourceSyncClock(options: SiteTranslationSourceSyncOptions) {
  if (options.clock) return options.clock;
  if (options.now !== undefined) {
    const fixed = new Date(options.now);
    return () => new Date(fixed.getTime());
  }
  return () => new Date();
}

function readSourceSyncClock(clock: () => Date, label: string) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Remote ${label} clock is invalid.`);
  }
  return value;
}

function defaultSourceFingerprintProvider(): D1ReleaseSourceIdentity {
  const fingerprint = buildRepoSourceFingerprint();
  return { sha256: fingerprint.sha256, fileCount: fingerprint.fileCount };
}

function assertSameSourceSyncFingerprint(
  expected: D1ReleaseSourceIdentity,
  actual: D1ReleaseSourceIdentity,
) {
  if (
    actual.sha256 !== expected.sha256 ||
    actual.fileCount !== expected.fileCount
  ) {
    throw new Error("Remote source synchronization source fingerprint drifted before its D1 write.");
  }
}

function sourceManifestHash(sources: Array<[string, SourceManifestEntry]>) {
  return createHash()
    .update(
      JSON.stringify(
        sources.map(([namespace, entry]) => [namespace, entry.sourceHash, entry.sourceStrings]),
      ),
    )
    .digest("hex");
}

function currentSnapshotRowCount(snapshot: SiteTranslationSourceSnapshot) {
  return (
    Object.keys(snapshot.sources).length +
    Object.values(snapshot.sourceStrings).reduce(
      (sum, strings) => sum + Object.keys(strings).length,
      0,
    )
  );
}

function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function writeReport(report: SiteTranslationSourceSyncReport, backupDir: string) {
  const cfDir = cloudflareDir(backupDir);
  const file = path.join(cfDir, `site-translation-sources-${report.mode}.json`);
  writePrivateJsonDurably(file, report, { replace: fs.existsSync(file) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
