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

function executeSiteTranslationSourceSyncPlan(
  plan: SiteTranslationSourceSyncPlan,
  mode: SyncMode,
  runner: WranglerRunner = runWrangler,
) {
  if (!plan.sql || plan.statements === 0) return;
  const sqlPath = writeTemporarySqlFile(plan.sql, "site-translation-source-sync.sql");
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
  } finally {
    fs.rmSync(path.dirname(sqlPath), { recursive: true, force: true });
  }
}

export function writeTemporarySqlFile(sql: string, filename: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "inspir-site-translation-sources-"));
  fs.chmodSync(tmpDir, 0o700);
  const sqlPath = path.join(tmpDir, filename);
  fs.writeFileSync(sqlPath, sql, { mode: 0o600 });
  return sqlPath;
}

function manifestEntries() {
  return Object.entries(siteSourceManifest as Record<string, SourceManifestEntry>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
}

function readCurrentSnapshot(mode: SyncMode, runner: WranglerRunner) {
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
  });
  const sourceRows = resultSets[0];
  const sourceStringRows = resultSets[1];
  const translationHashRows = resultSets[2];
  if (!sourceRows || !sourceStringRows || !translationHashRows) {
    throw new Error("Wrangler D1 source snapshot is missing an expected result set.");
  }
  const snapshot = emptySnapshot();

  for (const [index, row] of sourceRows.entries()) {
    if (typeof row.namespace !== "string" || typeof row.source_hash !== "string") {
      throw new Error(`Wrangler D1 source snapshot row ${index + 1} has an invalid source contract.`);
    }
    snapshot.sources[row.namespace] = row.source_hash;
  }
  for (const [index, row] of sourceStringRows.entries()) {
    if (
      typeof row.namespace !== "string" ||
      typeof row.source_key !== "string" ||
      typeof row.source_text !== "string"
    ) {
      throw new Error(`Wrangler D1 source-string snapshot row ${index + 1} has an invalid contract.`);
    }
    snapshot.sourceStrings[row.namespace] ??= {};
    snapshot.sourceStrings[row.namespace][row.source_key] = row.source_text;
  }
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

function emptySnapshot(): SiteTranslationSourceSnapshot {
  return { sources: {}, sourceStrings: {} };
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
  options: { required?: boolean } = {},
) {
  const parsed = parseJsonFromOutput(output);
  if (!Array.isArray(parsed) || parsed.length !== 3) {
    throw new Error("Wrangler D1 source snapshot is missing billed read result sets.");
  }
  let total = 0;
  for (const [index, entry] of parsed.entries()) {
    if (!isRecord(entry) || !Array.isArray(entry.results)) {
      throw new Error(`Wrangler D1 source snapshot result set ${index + 1} is malformed.`);
    }
    const rowsRead = isRecord(entry.meta) ? entry.meta.rows_read : undefined;
    if (typeof rowsRead === "number" && Number.isSafeInteger(rowsRead) && rowsRead >= 0) {
      total += rowsRead;
      continue;
    }
    if (options.required) {
      throw new Error(
        `Wrangler D1 source snapshot result set ${index + 1} is missing billed rows_read metadata.`,
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
  writeFsyncedPrivateJson(evidencePath, evidence);
  return evidencePath;
}

function countSiteTranslationSourceSqlStatements(sql: string) {
  return countSqlStatements(sql, "site translation source");
}

function parseTranslationSourceHashGroup(
  row: Record<string, unknown>,
  index: number,
): TranslationSourceHashGroup {
  if (typeof row.namespace !== "string" || !row.namespace) {
    throw new Error(`Wrangler D1 translation hash group ${index + 1} has an invalid namespace.`);
  }
  if (typeof row.source_hash !== "string" || !row.source_hash) {
    throw new Error(`Wrangler D1 translation hash group ${index + 1} has an invalid source hash.`);
  }
  if (!Number.isSafeInteger(row.translation_rows) || Number(row.translation_rows) <= 0) {
    throw new Error(`Wrangler D1 translation hash group ${index + 1} has an invalid row count.`);
  }
  return {
    namespace: row.namespace,
    sourceHash: row.source_hash,
    rows: Number(row.translation_rows),
  };
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

function writeFsyncedPrivateJson(file: string, value: unknown) {
  const descriptor = fs.openSync(file, "w", 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
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
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
