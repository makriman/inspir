import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  HISTORICAL_DATA_CONTINUITY_POLICY,
  HISTORICAL_DATA_CONTINUITY_POLICY_SHA256,
} from "./historical-data-continuity-policy";
import {
  readD1ReleaseBudgetLedger,
  readPrivateJsonNoFollow,
  writePrivateJsonDurably,
} from "./d1-release-budget-ledger";
import { assertGitReleaseIdentity } from "./git-release-identity";
import {
  createHash,
  hasFlag,
  resolveBackupDir,
} from "./migration-config";
import {
  buildGitCommitSourceFingerprint,
  buildRepoSourceFingerprint,
  type SourceFingerprint,
} from "./source-fingerprint";
import {
  HISTORICAL_BILLED_READ_LIMIT,
  HISTORICAL_DATA_BASELINE_MAX_AGE_MS,
  HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
  HISTORICAL_DATA_VERIFICATION_RELATIVE_PATH,
  HISTORICAL_DATASET_NAMES,
  historicalDataHmacKeyId,
  historicalDataReportPath,
  parseHistoricalDataBaselineReport,
  readAndValidateHistoricalDataBaseline,
  type HistoricalDataBaselineReport,
  type HistoricalDatasetName,
} from "./verify-historical-data-preservation";

export const HISTORICAL_DATA_CONTINUITY_KIND =
  "inspir-historical-data-continuity-v1" as const;
export const HISTORICAL_DATA_CONTINUITY_ARCHIVE_KIND =
  "inspir-historical-data-continuity-archive-v1" as const;
export const HISTORICAL_DATA_CONTINUITY_REPORT_MAX_AGE_MS = 30 * 60 * 1_000;

const policy = HISTORICAL_DATA_CONTINUITY_POLICY;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const canonicalTimestampSchema = z.string().refine((value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}, "Expected a canonical timestamp.");
const sourceIdentitySchema = z.object({
  sha256: sha256Schema,
  fileCount: z.number().int().positive(),
}).strict();
const datasetDecisionSchema = z.object({
  predecessorRows: z.number().int().nonnegative(),
  successorRows: z.number().int().nonnegative(),
  countsPreserved: z.boolean(),
  columnsPreserved: z.boolean(),
  sentinelsPreserved: z.boolean(),
}).strict();
const datasetDecisionsSchema = z.record(
  z.enum(HISTORICAL_DATASET_NAMES),
  datasetDecisionSchema,
);

const archiveManifestSchema = z.object({
  kind: z.literal(HISTORICAL_DATA_CONTINUITY_ARCHIVE_KIND),
  schemaVersion: z.literal(1),
  createdAt: canonicalTimestampSchema,
  policyId: z.literal(policy.policyId),
  policySha256: z.literal(HISTORICAL_DATA_CONTINUITY_POLICY_SHA256),
  reason: z.literal(policy.reason),
  backupDir: z.string().min(1),
  archiveDir: z.string().min(1),
  predecessorGitCommit: z.literal(policy.predecessor.gitCommit),
  predecessorSource: z.object({
    sha256: z.literal(policy.predecessor.sourceSha256),
    fileCount: z.literal(policy.predecessor.sourceFileCount),
  }).strict(),
  baseline: z.object({
    sourcePath: z.string().min(1),
    archivePath: z.string().min(1),
    sha256: z.literal(policy.predecessor.baselineSha256),
    createdAt: z.literal(policy.predecessor.baselineCreatedAt),
    operationId: z.literal(policy.predecessor.baselineOperationId),
  }).strict(),
  ledger: z.object({
    sourcePath: z.string().min(1),
    archivePath: z.string().min(1),
    sha256: z.literal(policy.predecessor.ledgerSha256),
    revision: z.number().int().positive(),
  }).strict(),
  budgetBlock: z.object({
    observedRowsRead: z.literal(policy.budgetBlock.observedRowsRead),
    existingReservedRowsRead: z.literal(policy.budgetBlock.existingReservedRowsRead),
    requestedVerificationRowsRead: z.literal(policy.budgetBlock.requestedVerificationRowsRead),
    projectedRowsRead: z.literal(policy.budgetBlock.projectedRowsRead),
    safeRowsReadLimit: z.literal(policy.budgetBlock.safeRowsReadLimit),
    d1SnapshotQueryExecuted: z.literal(false),
  }).strict(),
  canonicalVerificationAbsent: z.literal(true),
  predecessorCommitFingerprintVerified: z.literal(true),
}).strict();

const continuityReportSchema = z.object({
  kind: z.literal(HISTORICAL_DATA_CONTINUITY_KIND),
  schemaVersion: z.literal(1),
  createdAt: canonicalTimestampSchema,
  backupDir: z.string().min(1),
  ok: z.boolean(),
  policyId: z.literal(policy.policyId),
  policySha256: z.literal(HISTORICAL_DATA_CONTINUITY_POLICY_SHA256),
  gitHead: z.string().regex(/^[a-f0-9]{40,64}$/),
  predecessor: z.object({
    source: z.object({
      sha256: z.literal(policy.predecessor.sourceSha256),
      fileCount: z.literal(policy.predecessor.sourceFileCount),
    }).strict(),
    baselineCreatedAt: z.literal(policy.predecessor.baselineCreatedAt),
    baselineOperationId: z.literal(policy.predecessor.baselineOperationId),
    baselineSha256: z.literal(policy.predecessor.baselineSha256),
    ledgerSha256: z.literal(policy.predecessor.ledgerSha256),
    archiveManifestSha256: sha256Schema,
  }).strict(),
  successor: z.object({
    source: sourceIdentitySchema,
    baselineCreatedAt: canonicalTimestampSchema,
    baselineOperationId: z.string().min(1),
    baselineSha256: sha256Schema,
    utcDay: z.literal(policy.successor.requiredUtcDay),
  }).strict(),
  sameHmacKey: z.boolean(),
  gapMs: z.number().int().positive(),
  datasets: datasetDecisionsSchema,
  problems: z.array(z.string().min(1).max(1_000)).max(100),
}).strict();

export type HistoricalDataContinuityArchiveManifest = z.infer<typeof archiveManifestSchema>;
export type HistoricalDataContinuityReport = z.infer<typeof continuityReportSchema>;
export type HistoricalDataContinuityDatasetDecision = z.infer<typeof datasetDecisionSchema>;
export type HistoricalDataContinuityPredecessorLoader = (
  backupDir: string,
) => HistoricalDataBaselineReport;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

function runCli() {
  if (!hasFlag("--confirm-production")) {
    throw new Error("Historical continuity requires --confirm-production.");
  }
  const archive = hasFlag("--archive-predecessor");
  const verify = hasFlag("--verify-rollover");
  if (archive === verify) {
    throw new Error("Choose exactly one of --archive-predecessor or --verify-rollover.");
  }
  const backupDir = resolveBackupDir();
  if (archive) {
    if (!hasFlag("--confirm-budget-blocked-rollover")) {
      throw new Error("Predecessor archival requires --confirm-budget-blocked-rollover.");
    }
    const manifest = archiveHistoricalDataContinuityPredecessor({ backupDir });
    console.log(JSON.stringify({
      kind: manifest.kind,
      createdAt: manifest.createdAt,
      policyId: manifest.policyId,
      archiveDir: manifest.archiveDir,
      canonicalVerificationAbsent: manifest.canonicalVerificationAbsent,
    }, null, 2));
    return;
  }
  const hmacSecret = process.env.HISTORICAL_DATA_PRESERVATION_HMAC_SECRET ?? "";
  const report = verifyHistoricalDataContinuityRollover({
    backupDir,
    cwd: process.cwd(),
    hmacSecret,
  });
  console.log(JSON.stringify({
    kind: report.kind,
    createdAt: report.createdAt,
    ok: report.ok,
    problemCount: report.problems.length,
    reportPath: historicalDataContinuityReportPath(backupDir),
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

export function archiveHistoricalDataContinuityPredecessor(options: {
  backupDir: string;
  cwd?: string;
  now?: Date;
}) {
  const backupDir = path.resolve(options.backupDir);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const now = options.now ?? new Date();
  assertValidClock(now, "archive");
  if (now.toISOString().slice(0, 10) !== policy.predecessor.baselineUtcDay) {
    throw new Error("The predecessor can only be archived on its original UTC ledger day.");
  }
  const baselineAge = now.getTime() - Date.parse(policy.predecessor.baselineCreatedAt);
  if (baselineAge < 0 || baselineAge > HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS) {
    throw new Error("The predecessor baseline is outside its guarded final-verification window.");
  }
  assertPolicyBudgetBlock();

  const baselinePath = historicalDataReportPath(backupDir, "baseline");
  const baselineBytes = readPrivateBytesNoFollow(baselinePath, 2 * 1024 * 1024);
  requireSha256(baselineBytes, policy.predecessor.baselineSha256, "predecessor baseline");
  const baseline = parseHistoricalDataBaselineReport(parseJsonBytes(baselineBytes, "predecessor baseline"));
  assertPolicyPredecessorBaseline(baseline, backupDir);

  const commitSource = buildGitCommitSourceFingerprint(policy.predecessor.gitCommit, cwd);
  requireSourceIdentity(commitSource, {
    sha256: policy.predecessor.sourceSha256,
    fileCount: policy.predecessor.sourceFileCount,
  }, "predecessor Git commit");

  const ledgerPath = path.join(backupDir, "cloudflare", policy.predecessor.ledgerFileName);
  const ledgerBytes = readPrivateBytesNoFollow(ledgerPath, 4 * 1024 * 1024);
  requireSha256(ledgerBytes, policy.predecessor.ledgerSha256, "predecessor ledger");
  const ledger = readD1ReleaseBudgetLedger(ledgerPath);
  assertArchivedBaselineReservation(baseline, ledger);
  if (ledger.totals.rowsRead !== policy.budgetBlock.existingReservedRowsRead) {
    throw new Error("The predecessor ledger no longer matches the budget-block incident.");
  }
  if (ledger.reservations.some((reservation) =>
    reservation.operation === "Historical production data preservation verification"
  )) {
    throw new Error("A predecessor preservation-verification reservation already exists.");
  }
  const verificationPath = path.join(backupDir, HISTORICAL_DATA_VERIFICATION_RELATIVE_PATH);
  if (pathEntryExists(verificationPath)) {
    throw new Error("Canonical predecessor verification evidence already exists; rollover fallback is forbidden.");
  }

  const archiveDir = historicalDataContinuityArchiveDir(backupDir);
  const manifestPath = historicalDataContinuityArchiveManifestPath(backupDir);
  if (pathEntryExists(manifestPath)) {
    return readAndValidateArchiveManifest(backupDir);
  }
  if (pathEntryExists(archiveDir)) {
    throw new Error("A partial historical continuity archive exists without a valid manifest.");
  }
  ensurePrivateDirectory(path.dirname(archiveDir));
  fs.mkdirSync(archiveDir, { mode: 0o700 });
  assertPrivateDirectory(archiveDir);
  fsyncDirectory(path.dirname(archiveDir));

  const archivedBaselinePath = path.join(archiveDir, policy.archivedBaselineFileName);
  const archivedLedgerPath = path.join(archiveDir, policy.archivedLedgerFileName);
  writePrivateBytesExclusive(archivedBaselinePath, baselineBytes);
  writePrivateBytesExclusive(archivedLedgerPath, ledgerBytes);
  requireSha256(
    readPrivateBytesNoFollow(archivedBaselinePath, 2 * 1024 * 1024),
    policy.predecessor.baselineSha256,
    "archived predecessor baseline",
  );
  requireSha256(
    readPrivateBytesNoFollow(archivedLedgerPath, 4 * 1024 * 1024),
    policy.predecessor.ledgerSha256,
    "archived predecessor ledger",
  );

  const manifest: HistoricalDataContinuityArchiveManifest = {
    kind: HISTORICAL_DATA_CONTINUITY_ARCHIVE_KIND,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    policyId: policy.policyId,
    policySha256: HISTORICAL_DATA_CONTINUITY_POLICY_SHA256,
    reason: policy.reason,
    backupDir,
    archiveDir,
    predecessorGitCommit: policy.predecessor.gitCommit,
    predecessorSource: {
      sha256: policy.predecessor.sourceSha256,
      fileCount: policy.predecessor.sourceFileCount,
    },
    baseline: {
      sourcePath: baselinePath,
      archivePath: archivedBaselinePath,
      sha256: policy.predecessor.baselineSha256,
      createdAt: policy.predecessor.baselineCreatedAt,
      operationId: policy.predecessor.baselineOperationId,
    },
    ledger: {
      sourcePath: ledgerPath,
      archivePath: archivedLedgerPath,
      sha256: policy.predecessor.ledgerSha256,
      revision: ledger.revision,
    },
    budgetBlock: { ...policy.budgetBlock },
    canonicalVerificationAbsent: true,
    predecessorCommitFingerprintVerified: true,
  };
  writePrivateJsonDurably(manifestPath, manifest, { replace: false });
  fsyncDirectory(archiveDir);
  return readAndValidateArchiveManifest(backupDir);
}

export function verifyHistoricalDataContinuityRollover(options: {
  backupDir: string;
  cwd: string;
  hmacSecret: string;
  now?: Date;
}) {
  const backupDir = path.resolve(options.backupDir);
  const cwd = path.resolve(options.cwd);
  const now = options.now ?? new Date();
  assertValidClock(now, "rollover verification");
  if (now.toISOString().slice(0, 10) !== policy.successor.requiredUtcDay) {
    throw new Error("Historical continuity successor verification must run on the exact required UTC day.");
  }
  const git = assertGitReleaseIdentity({ cwd });
  const currentSource = buildRepoSourceFingerprint(cwd);
  if (
    currentSource.sha256 === policy.predecessor.sourceSha256 ||
    currentSource.fileCount === 0
  ) {
    throw new Error("Historical continuity requires the new clean pushed successor source.");
  }
  const archiveManifest = readAndValidateArchiveManifest(backupDir);
  const predecessor = readArchivedPredecessorBaseline(backupDir);
  const successor = readAndValidateHistoricalDataBaseline({
    backupDir,
    cwd,
    expectedSourceFingerprint: currentSource,
    now,
    maximumAgeMs: HISTORICAL_DATA_BASELINE_MAX_AGE_MS,
  });
  const evaluation = evaluateHistoricalDataContinuity({
    predecessor,
    successor,
    hmacSecret: options.hmacSecret,
    requiredSuccessorUtcDay: policy.successor.requiredUtcDay,
    maximumGapMs: policy.successor.maximumGapMs,
  });
  const successorBaselinePath = historicalDataReportPath(backupDir, "baseline");
  const successorBaselineSha256 = sha256PrivateFile(successorBaselinePath, 2 * 1024 * 1024);
  const archiveManifestSha256 = sha256PrivateFile(
    historicalDataContinuityArchiveManifestPath(backupDir),
    512 * 1024,
  );
  const report: HistoricalDataContinuityReport = {
    kind: HISTORICAL_DATA_CONTINUITY_KIND,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    backupDir,
    ok: evaluation.ok,
    policyId: policy.policyId,
    policySha256: HISTORICAL_DATA_CONTINUITY_POLICY_SHA256,
    gitHead: git.head,
    predecessor: {
      source: archiveManifest.predecessorSource,
      baselineCreatedAt: policy.predecessor.baselineCreatedAt,
      baselineOperationId: policy.predecessor.baselineOperationId,
      baselineSha256: policy.predecessor.baselineSha256,
      ledgerSha256: policy.predecessor.ledgerSha256,
      archiveManifestSha256,
    },
    successor: {
      source: compactSource(currentSource),
      baselineCreatedAt: successor.createdAt,
      baselineOperationId: successor.operationId,
      baselineSha256: successorBaselineSha256,
      utcDay: policy.successor.requiredUtcDay,
    },
    sameHmacKey: evaluation.sameHmacKey,
    gapMs: evaluation.gapMs,
    datasets: evaluation.datasets,
    problems: evaluation.problems,
  };
  const reportPath = historicalDataContinuityReportPath(backupDir);
  writePrivateJsonDurably(reportPath, report, { replace: pathEntryExists(reportPath) });
  if (!report.ok) {
    throw new Error(`Historical data continuity failed; inspect ${reportPath}.`);
  }
  return report;
}

export function evaluateHistoricalDataContinuity(options: {
  predecessor: HistoricalDataBaselineReport;
  successor: HistoricalDataBaselineReport;
  hmacSecret: string;
  requiredSuccessorUtcDay: string;
  maximumGapMs: number;
}) {
  const problems: string[] = [];
  const expectedKeyId = historicalDataHmacKeyId(options.hmacSecret);
  const sameHmacKey =
    options.predecessor.hmacKeyId === expectedKeyId &&
    options.successor.hmacKeyId === expectedKeyId;
  if (!sameHmacKey) problems.push("The predecessor and successor do not use the retained HMAC key.");
  if (options.successor.utcDay !== options.requiredSuccessorUtcDay) {
    problems.push("The successor baseline was not captured on the required UTC day.");
  }
  const predecessorTime = Date.parse(options.predecessor.createdAt);
  const successorTime = Date.parse(options.successor.createdAt);
  const gapMs = successorTime - predecessorTime;
  if (
    !Number.isSafeInteger(options.maximumGapMs) ||
    options.maximumGapMs <= 0 ||
    !Number.isSafeInteger(gapMs) ||
    gapMs <= 0 ||
    gapMs > options.maximumGapMs
  ) {
    problems.push("The predecessor-to-successor continuity window is invalid or too long.");
  }
  const datasets = emptyDatasetDecisions();
  for (const name of HISTORICAL_DATASET_NAMES) {
    const before = options.predecessor.datasets[name];
    const after = options.successor.datasets[name];
    const decision = historicalDataContinuityDatasetDecision(before, after);
    datasets[name] = decision;
    if (!decision.countsPreserved) problems.push(`${name} row count decreased across the rollover.`);
    if (!decision.columnsPreserved) problems.push(`${name} lost or changed a predecessor column.`);
    if (!decision.sentinelsPreserved) problems.push(`${name} lost a predecessor identity sentinel.`);
  }
  return { ok: problems.length === 0, sameHmacKey, gapMs, datasets, problems };
}

export function readAndValidateHistoricalDataContinuityReport(options: {
  backupDir: string;
  cwd: string;
  expectedSourceFingerprint: SourceFingerprint;
  predecessorLoader?: HistoricalDataContinuityPredecessorLoader;
  now?: Date;
}) {
  const backupDir = path.resolve(options.backupDir);
  const cwd = path.resolve(options.cwd);
  const now = options.now ?? new Date();
  assertValidClock(now, "continuity report validation");
  const reportPath = historicalDataContinuityReportPath(backupDir);
  const report = continuityReportSchema.parse(
    readPrivateJsonNoFollow(reportPath, 2 * 1024 * 1024),
  );
  const ageMs = now.getTime() - Date.parse(report.createdAt);
  if (ageMs < 0 || ageMs > HISTORICAL_DATA_CONTINUITY_REPORT_MAX_AGE_MS) {
    throw new Error("Historical continuity report is stale or from the future.");
  }
  if (path.resolve(report.backupDir) !== backupDir) {
    throw new Error("Historical continuity report targets the wrong backup directory.");
  }
  if (!report.ok || report.problems.length || !report.sameHmacKey) {
    throw new Error("Historical continuity report is not a successful exact proof.");
  }
  const git = assertGitReleaseIdentity({ cwd });
  if (report.gitHead !== git.head) {
    throw new Error("Historical continuity report does not bind the current clean pushed Git HEAD.");
  }
  requireSourceIdentity(report.successor.source, compactSource(options.expectedSourceFingerprint), "continuity successor");
  const baselinePath = historicalDataReportPath(backupDir, "baseline");
  const baselineSha256 = sha256PrivateFile(baselinePath, 2 * 1024 * 1024);
  if (baselineSha256 !== report.successor.baselineSha256) {
    throw new Error("Historical continuity report does not bind the current successor baseline.");
  }
  const baseline = parseHistoricalDataBaselineReport(
    readPrivateJsonNoFollow(baselinePath, 2 * 1024 * 1024),
  );
  if (
    baseline.createdAt !== report.successor.baselineCreatedAt ||
    baseline.operationId !== report.successor.baselineOperationId
  ) {
    throw new Error("Historical continuity successor baseline identity changed.");
  }
  requireSourceIdentity(
    baseline.sourceFingerprint,
    report.successor.source,
    "continuity successor baseline",
  );
  const manifestSha256 = sha256PrivateFile(
    historicalDataContinuityArchiveManifestPath(backupDir),
    512 * 1024,
  );
  if (manifestSha256 !== report.predecessor.archiveManifestSha256) {
    throw new Error("Historical continuity predecessor archive manifest changed.");
  }
  const predecessor = options.predecessorLoader
    ? options.predecessorLoader(backupDir)
    : readArchivedPredecessorBaseline(backupDir);
  assertPolicyPredecessorBaseline(predecessor, backupDir);
  assertHistoricalDataContinuityReportDecisions({
    report,
    predecessor,
    successor: baseline,
  });
  return report;
}

export function assertHistoricalDataContinuityReportDecisions(options: {
  report: HistoricalDataContinuityReport;
  predecessor: HistoricalDataBaselineReport;
  successor: HistoricalDataBaselineReport;
}) {
  if (
    !options.report.sameHmacKey ||
    options.predecessor.hmacKeyId !== options.successor.hmacKeyId
  ) {
    throw new Error("Historical continuity report does not retain one HMAC key across both baselines.");
  }
  for (const name of HISTORICAL_DATASET_NAMES) {
    const before = options.predecessor.datasets[name];
    const after = options.successor.datasets[name];
    const expected = historicalDataContinuityDatasetDecision(before, after);
    const reported = options.report.datasets[name];
    if (
      reported.predecessorRows !== expected.predecessorRows ||
      reported.successorRows !== expected.successorRows ||
      reported.countsPreserved !== expected.countsPreserved ||
      reported.columnsPreserved !== expected.columnsPreserved ||
      reported.sentinelsPreserved !== expected.sentinelsPreserved ||
      !expected.countsPreserved ||
      !expected.columnsPreserved ||
      !expected.sentinelsPreserved
    ) {
      throw new Error(
        `Historical continuity ${name} dataset decision is failed or inconsistent with the immutable baselines.`,
      );
    }
  }
}

export function historicalDataContinuityReportPath(backupDir: string) {
  return path.join(path.resolve(backupDir), policy.continuityReportRelativePath);
}

export function historicalDataContinuityArchiveDir(backupDir: string) {
  return path.join(path.resolve(backupDir), policy.archiveRelativeDirectory);
}

export function historicalDataContinuityArchiveManifestPath(backupDir: string) {
  return path.join(
    historicalDataContinuityArchiveDir(backupDir),
    policy.archiveManifestFileName,
  );
}

function readAndValidateArchiveManifest(backupDir: string) {
  const resolvedBackupDir = path.resolve(backupDir);
  const manifestPath = historicalDataContinuityArchiveManifestPath(resolvedBackupDir);
  const manifest = archiveManifestSchema.parse(readPrivateJsonNoFollow(manifestPath, 512 * 1024));
  const archiveDir = historicalDataContinuityArchiveDir(resolvedBackupDir);
  if (
    path.resolve(manifest.backupDir) !== resolvedBackupDir ||
    path.resolve(manifest.archiveDir) !== archiveDir ||
    path.resolve(manifest.baseline.archivePath) !==
      path.join(archiveDir, policy.archivedBaselineFileName) ||
    path.resolve(manifest.ledger.archivePath) !==
      path.join(archiveDir, policy.archivedLedgerFileName)
  ) {
    throw new Error("Historical continuity archive paths do not match the incident policy.");
  }
  assertPrivateDirectory(archiveDir);
  requireSha256(
    readPrivateBytesNoFollow(manifest.baseline.archivePath, 2 * 1024 * 1024),
    policy.predecessor.baselineSha256,
    "archived predecessor baseline",
  );
  requireSha256(
    readPrivateBytesNoFollow(manifest.ledger.archivePath, 4 * 1024 * 1024),
    policy.predecessor.ledgerSha256,
    "archived predecessor ledger",
  );
  return manifest;
}

function readArchivedPredecessorBaseline(backupDir: string) {
  const manifest = readAndValidateArchiveManifest(backupDir);
  const bytes = readPrivateBytesNoFollow(manifest.baseline.archivePath, 2 * 1024 * 1024);
  const baseline = parseHistoricalDataBaselineReport(parseJsonBytes(bytes, "archived predecessor baseline"));
  assertPolicyPredecessorBaseline(baseline, path.resolve(backupDir));
  const ledger = readD1ReleaseBudgetLedger(manifest.ledger.archivePath);
  assertArchivedBaselineReservation(baseline, ledger);
  return baseline;
}

function assertPolicyPredecessorBaseline(
  baseline: HistoricalDataBaselineReport,
  backupDir: string,
) {
  requireSourceIdentity(baseline.sourceFingerprint, {
    sha256: policy.predecessor.sourceSha256,
    fileCount: policy.predecessor.sourceFileCount,
  }, "predecessor baseline");
  if (
    path.resolve(baseline.backupDir) !== backupDir ||
    baseline.createdAt !== policy.predecessor.baselineCreatedAt ||
    baseline.utcDay !== policy.predecessor.baselineUtcDay ||
    baseline.operationId !== policy.predecessor.baselineOperationId ||
    baseline.rowsWritten !== 0
  ) {
    throw new Error("The predecessor baseline does not match the one-release incident policy.");
  }
}

function assertArchivedBaselineReservation(
  baseline: HistoricalDataBaselineReport,
  ledger: ReturnType<typeof readD1ReleaseBudgetLedger>,
) {
  if (ledger.utcDay !== baseline.utcDay) {
    throw new Error("The archived predecessor ledger has the wrong UTC day.");
  }
  const matches = ledger.reservations.filter((reservation) =>
    reservation.operationId === baseline.operationId &&
    reservation.sourceFingerprint.sha256 === baseline.sourceFingerprint.sha256 &&
    reservation.sourceFingerprint.fileCount === baseline.sourceFingerprint.fileCount
  );
  const reservation = matches[0];
  if (
    matches.length !== 1 ||
    reservation?.operation !== "Historical production data baseline capture" ||
    reservation.phase !== "exact" ||
    reservation.rowsRead !== baseline.rowsRead ||
    reservation.rowsWritten !== 0
  ) {
    throw new Error("The archived ledger lacks the exact predecessor baseline reservation.");
  }
}

function assertPolicyBudgetBlock() {
  if (
    policy.budgetBlock.requestedVerificationRowsRead !== HISTORICAL_BILLED_READ_LIMIT ||
    policy.budgetBlock.projectedRowsRead !==
      policy.budgetBlock.observedRowsRead +
      policy.budgetBlock.existingReservedRowsRead +
      policy.budgetBlock.requestedVerificationRowsRead ||
    policy.budgetBlock.projectedRowsRead <= policy.budgetBlock.safeRowsReadLimit ||
    policy.budgetBlock.d1SnapshotQueryExecuted !== false
  ) {
    throw new Error("The tracked historical continuity budget-block policy is inconsistent.");
  }
}

function emptyDatasetDecisions() {
  const empty = (): HistoricalDataContinuityDatasetDecision => ({
    predecessorRows: 0,
    successorRows: 0,
    countsPreserved: false,
    columnsPreserved: false,
    sentinelsPreserved: false,
  });
  return {
    users: empty(),
    accounts: empty(),
    sessions: empty(),
    chats: empty(),
    messages: empty(),
    admin_users: empty(),
    user_memories: empty(),
    activity_runs: empty(),
    product_events: empty(),
    profile_photo_pointers: empty(),
  } satisfies Record<HistoricalDatasetName, HistoricalDataContinuityDatasetDecision>;
}

function historicalDataContinuityDatasetDecision(
  before: HistoricalDataBaselineReport["datasets"][HistoricalDatasetName],
  after: HistoricalDataBaselineReport["datasets"][HistoricalDatasetName],
): HistoricalDataContinuityDatasetDecision {
  const afterColumns = new Set(after.columns.map(columnIdentity));
  const afterSentinels = new Set(after.sentinels);
  return {
    predecessorRows: before.rowCount,
    successorRows: after.rowCount,
    countsPreserved: after.rowCount >= before.rowCount,
    columnsPreserved: before.columns.every((column) => afterColumns.has(columnIdentity(column))),
    sentinelsPreserved: before.sentinels.every((sentinel) => afterSentinels.has(sentinel)),
  };
}

function columnIdentity(column: {
  name: string;
  type: string;
  notNull: 0 | 1;
  primaryKey: number;
}) {
  return `${column.name}\0${column.type}\0${column.notNull}\0${column.primaryKey}`;
}

function compactSource(source: SourceFingerprint) {
  return { sha256: source.sha256, fileCount: source.fileCount };
}

function requireSourceIdentity(
  actual: { sha256: string; fileCount: number },
  expected: { sha256: string; fileCount: number },
  label: string,
) {
  if (actual.sha256 !== expected.sha256 || actual.fileCount !== expected.fileCount) {
    throw new Error(`Historical continuity ${label} source identity changed.`);
  }
}

function readPrivateBytesNoFollow(file: string, maximumBytes: number) {
  const absolute = path.resolve(file);
  let descriptor: number;
  try {
    descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    throw new Error(`Historical continuity evidence must be a regular owner-only mode-0600 file: ${absolute}.`);
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size <= 0 ||
      stat.size > maximumBytes ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      throw new Error(`Historical continuity evidence has invalid ownership, mode, type, or size: ${absolute}.`);
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (bytes.byteLength !== stat.size || after.size !== stat.size) {
      throw new Error(`Historical continuity evidence changed while being read: ${absolute}.`);
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function writePrivateBytesExclusive(file: string, bytes: Buffer) {
  const descriptor = fs.openSync(file, "wx", 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(path.dirname(file));
}

function sha256PrivateFile(file: string, maximumBytes: number) {
  return createHash().update(readPrivateBytesNoFollow(file, maximumBytes)).digest("hex");
}

function requireSha256(bytes: Buffer, expected: string, label: string) {
  const actual = createHash().update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`Historical continuity ${label} SHA-256 changed.`);
  }
}

function parseJsonBytes(bytes: Buffer, label: string): unknown {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return value;
  } catch {
    throw new Error(`Historical continuity ${label} is not valid JSON.`);
  }
}

function ensurePrivateDirectory(directory: string) {
  if (!pathEntryExists(directory)) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  assertPrivateDirectory(directory);
}

function assertPrivateDirectory(directory: string) {
  const stat = fs.lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  ) {
    throw new Error(`Historical continuity archive must be a real owner-only mode-0700 directory: ${directory}.`);
  }
}

function fsyncDirectory(directory: string) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertValidClock(value: Date, label: string) {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`Historical continuity requires a valid ${label} clock.`);
  }
}

function pathEntryExists(file: string) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
