import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  HISTORICAL_DATA_CONTINUITY_POLICY,
  HISTORICAL_DATA_CONTINUITY_POLICY_SHA256,
} from "./historical-data-continuity-policy";
import {
  parseD1ReleaseBudgetLedger,
  readD1ReleaseBudgetLedger,
  readPrivateJsonNoFollow,
  writePrivateJsonDurably,
} from "./d1-release-budget-ledger";
import { assertGitReleaseIdentity } from "./git-release-identity";
import {
  readHistoricalDataHmacKey,
  requireGeneratedHistoricalHmacSecret,
  storeHistoricalDataHmacKey,
} from "./historical-data-hmac-key";
import {
  acquireHistoricalSuccessorCaptureClaim,
  acquireHistoricalSuccessorCaptureResumeLease,
  authorizeHistoricalSuccessorCaptureScan,
  classifyHistoricalSuccessorCaptureState,
  completeHistoricalSuccessorCapture,
  finalizeHistoricalSuccessorScanAuthorizationPublication,
  prepareHistoricalSuccessorCapture,
  readHistoricalSuccessorCaptureResumeLeases,
  successorCaptureJsonSha256,
  type HistoricalSuccessorCaptureClaim,
  type HistoricalSuccessorCaptureExpectedIdentity,
  type HistoricalSuccessorCapturePrepared,
  type HistoricalSuccessorCaptureResumeLease,
  type HistoricalSuccessorCaptureScanAuthorization,
  type HistoricalSuccessorCaptureFileHandle,
} from "./historical-data-successor-capture-state";
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
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
  HISTORICAL_DATA_LEGACY_BILLED_READ_LIMIT,
  HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS,
  HISTORICAL_DATA_BASELINE_MAX_AGE_MS,
  HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
  HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
  HISTORICAL_DATA_VERIFICATION_RELATIVE_PATH,
  HISTORICAL_DATASET_NAMES,
  HISTORICAL_OPERATIONAL_DATASET_NAMES,
  createHistoricalDataBaseline,
  hasRequiredHistoricalMemoryVectorCleanupOutboxSchema,
  historicalDataBudgetOperationId,
  historicalDataHmacKeyId,
  historicalDataReportPath,
  parseHistoricalDataBaselineReport,
  parseHistoricalDataLegacyBaselineReportForContinuity,
  readAndValidateHistoricalDataBaseline,
  validateHistoricalDataBaselineValue,
  writeHistoricalDataReport,
  type HistoricalDataBaselineReport,
  type HistoricalDataLegacyBaselineReport,
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
const operationalDatasetDecisionSchema = z.object({
  lifecycle: z.literal("mutable-drainable-outbox"),
  predecessorEvidence: z.literal("not-captured-by-pinned-v1-baseline"),
  successorRows: z.number().int().nonnegative(),
  successorSchemaPresent: z.boolean(),
  successorEmptyBeforeFirstActivation: z.boolean(),
  rowPreservationRequired: z.literal(false),
}).strict();
const operationalDatasetDecisionsSchema = z.object({
  memory_vector_cleanup_outbox: operationalDatasetDecisionSchema,
}).strict();

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
  operationalDatasets: operationalDatasetDecisionsSchema,
  problems: z.array(z.string().min(1).max(1_000)).max(100),
}).strict();

export type HistoricalDataContinuityArchiveManifest = z.infer<typeof archiveManifestSchema>;
export type HistoricalDataContinuityReport = z.infer<typeof continuityReportSchema>;
export type HistoricalDataContinuityDatasetDecision = z.infer<typeof datasetDecisionSchema>;
export type HistoricalDataContinuityOperationalDatasetDecision = z.infer<
  typeof operationalDatasetDecisionSchema
>;
export type HistoricalDataContinuityPredecessorLoader = (
  backupDir: string,
) => HistoricalDataLegacyBaselineReport;

const activeSuccessorCaptureRunIds = new Set<string>();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Historical continuity failed.",
    );
    process.exitCode = 1;
  });
}

async function runCli() {
  if (!hasFlag("--confirm-production")) {
    throw new Error("Historical continuity requires --confirm-production.");
  }
  const archive = hasFlag("--archive-predecessor");
  const capture = hasFlag("--capture-successor");
  const verify = hasFlag("--verify-rollover");
  const escrow = hasFlag("--escrow-recovered-predecessor-key");
  const resumePreScanRunId = hasFlag("--resume-successor-pre-scan-run")
    ? requireCliArgument("--resume-successor-pre-scan-run")
    : undefined;
  if (
    [archive, capture, verify, escrow].filter(Boolean).length !==
    1
  ) {
    throw new Error(
      "Choose exactly one of --archive-predecessor, --escrow-recovered-predecessor-key, --capture-successor, or --verify-rollover.",
    );
  }
  if (resumePreScanRunId && !capture) {
    throw new Error(
      "--resume-successor-pre-scan-run is valid only with --capture-successor.",
    );
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
  if (capture) {
    if (!hasFlag("--confirm-budget-blocked-rollover")) {
      throw new Error("Successor capture requires --confirm-budget-blocked-rollover.");
    }
    const result = await captureHistoricalDataContinuitySuccessor({
      backupDir,
      cwd: process.cwd(),
      resumePreScanRunId,
    });
    const report = result.report;
    console.log(JSON.stringify({
      kind: report.kind,
      phase: report.phase,
      ok: report.ok,
      createdAt: report.createdAt,
      utcDay: report.utcDay,
      operationId: report.operationId,
      replayed: result.replayed,
      reportPath: historicalDataReportPath(backupDir, "baseline"),
    }, null, 2));
    return;
  }
  if (escrow) {
    if (!hasFlag("--confirm-budget-blocked-rollover")) {
      throw new Error("Recovered predecessor-key escrow requires --confirm-budget-blocked-rollover.");
    }
    const predecessor = readArchivedPredecessorBaseline(backupDir);
    const stored = await storeHistoricalDataHmacKey(
      readRecoveredHistoricalHmacSecretFromFile(
        requireCliArgument("--recovered-key-file"),
      ),
      predecessor.hmacKeyId,
    );
    console.log(JSON.stringify({
      kind: "inspir-historical-data-hmac-keychain-escrow-v1",
      ok: true,
      hmacKeyId: stored.hmacKeyId,
    }, null, 2));
    return;
  }
  const predecessor = readArchivedPredecessorBaseline(backupDir);
  const hmacSecret = (await readHistoricalDataHmacKey(predecessor.hmacKeyId)).secret;
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

export type HistoricalDataContinuitySuccessorCaptureDependencies = Readonly<{
  clock?: () => Date;
  hmacKeyLoader?: typeof readHistoricalDataHmacKey;
  baselineCreator?: typeof createHistoricalDataBaseline;
  reportWriter?: typeof writeHistoricalDataReport;
}>;

export type HistoricalDataContinuitySuccessorCaptureResult = Readonly<{
  report: HistoricalDataBaselineReport;
  replayed: boolean;
}>;

export async function captureHistoricalDataContinuitySuccessor(
  options: {
    backupDir: string;
    cwd: string;
    resumePreScanRunId?: string;
    dependencies?: HistoricalDataContinuitySuccessorCaptureDependencies;
  },
): Promise<HistoricalDataContinuitySuccessorCaptureResult> {
  const backupDir = path.resolve(options.backupDir);
  const cwd = path.resolve(options.cwd);
  const dependencies = options.dependencies ?? {};
  const clock = dependencies.clock ?? (() => new Date());
  const hmacKeyLoader = dependencies.hmacKeyLoader ?? readHistoricalDataHmacKey;
  const baselineCreator = dependencies.baselineCreator ?? createHistoricalDataBaseline;
  const reportWriter = dependencies.reportWriter ?? writeHistoricalDataReport;

  const startedAt = readSuccessorCaptureClock(clock, "coordinator start");
  const source = assertSuccessorCaptureSource(cwd);
  const archiveManifest = readAndValidateArchiveManifest(backupDir);
  const predecessor = readArchivedPredecessorBaseline(backupDir);
  const expected = historicalSuccessorCaptureExpectedIdentity({
    backupDir,
    source,
    predecessor,
    archiveManifestSha256: sha256PrivateFile(
      historicalDataContinuityArchiveManifestPath(backupDir),
      512 * 1024,
    ),
  });
  const stateDirectory = archiveManifest.archiveDir;
  const existingState = classifyHistoricalSuccessorCaptureState({
    stateDirectory,
    expected,
  });
  if (
    options.resumePreScanRunId &&
    existingState.status !== "claimed-pre-scan" &&
    existingState.status !== "scan-authorization-publication-interrupted"
  ) {
    throw new Error(
      "Historical successor pre-scan resume requires the exact retained pre-scan claim and no later marker.",
    );
  }
  const replayed = existingState.status === "claimed-pre-scan" ||
      existingState.status === "scan-authorization-publication-interrupted"
    ? undefined
    : finalizeOrReplayHistoricalSuccessorCapture({
        state: existingState,
        stateDirectory,
        expected,
        predecessor,
        source,
        backupDir,
        cwd,
        clock,
        reportWriter,
      });
  if (replayed) return { report: replayed, replayed: true };

  // Durable prepared/complete evidence may be finalized just after the scan
  // window without another D1 read. Only a genuinely fresh capture must start
  // inside the exact policy window.
  assertSuccessorCaptureWindow(startedAt);
  assertCanonicalPredecessorBeforeSuccessorCapture(backupDir);
  const claim = existingState.status === "claimed-pre-scan" ||
      existingState.status === "scan-authorization-publication-interrupted"
    ? requireHistoricalSuccessorPreScanResume({
        state: existingState,
        requestedRunId: options.resumePreScanRunId,
      })
    : acquireHistoricalSuccessorCaptureClaim({
        stateDirectory,
        backupDir,
        policyId: expected.policyId,
        policySha256: expected.policySha256,
        archiveManifestSha256: expected.archiveManifestSha256,
        predecessorBaselineSha256: expected.predecessorBaselineSha256,
        predecessorHmacKeyId: expected.predecessorHmacKeyId,
        source: expected.source,
        operationId: expected.operationId,
        utcDay: expected.utcDay,
        windowEndsAt: expected.windowEndsAt,
        now: startedAt,
      });
  let interruptedAuthorization =
    existingState.status === "scan-authorization-publication-interrupted"
      ? existingState.scanAuthorized
      : undefined;
  if (activeSuccessorCaptureRunIds.has(claim.value.runId)) {
    throw new Error(
      `Historical successor pre-scan run ${claim.value.runId} is already active in this process.`,
    );
  }
  activeSuccessorCaptureRunIds.add(claim.value.runId);

  try {
  const resumeLease =
    existingState.status === "claimed-pre-scan" ||
    existingState.status === "scan-authorization-publication-interrupted"
      ? acquireHistoricalSuccessorResumeOwnership({
          stateDirectory,
          claim,
          now: startedAt,
        })
      : undefined;
  let hmacKey: Awaited<ReturnType<typeof hmacKeyLoader>>;
  let report: HistoricalDataBaselineReport;
  let scanAuthorized:
    | HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>
    | undefined;
  let authorization: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>;
  try {
    // Close the canonical-baseline TOCTOU after acquiring the exclusive claim.
    assertCanonicalPredecessorBeforeSuccessorCapture(backupDir);
    hmacKey = await hmacKeyLoader(predecessor.hmacKeyId);
    if (
      hmacKey.hmacKeyId !== predecessor.hmacKeyId ||
      historicalDataHmacKeyId(hmacKey.secret) !== predecessor.hmacKeyId
    ) {
      throw new Error(
        "The retained historical-data HMAC failed exact successor-capture validation.",
      );
    }

    report = baselineCreator({
      backupDir,
      cwd,
      hmacSecret: hmacKey.secret,
      clock,
      allowProvenPreSnapshotReservationReplay: resumeLease !== undefined,
      beforeSnapshot: (context) => {
        const authorizationAt = readSuccessorCaptureClock(
          clock,
          "scan authorization",
        );
        assertSuccessorCaptureWindow(authorizationAt);
        assertSuccessorCaptureWindow(context.startedAt);
        const sourceAtAuthorization = assertSuccessorCaptureSource(cwd);
        requireSourceIdentity(
          sourceAtAuthorization,
          expected.source,
          "scan-authorization",
        );
        if (
          context.backupDir !== backupDir ||
          context.utcDay !== expected.utcDay ||
          context.operationId !== expected.operationId ||
          context.sourceFingerprint.sha256 !== expected.source.sha256 ||
          context.sourceFingerprint.fileCount !== expected.source.fileCount ||
          context.maximumRowsRead !== expected.maximumRowsRead ||
          context.maximumAutomaticReadAttempts !==
            HISTORICAL_DATA_MAX_AUTOMATIC_READ_ATTEMPTS ||
          context.maximumBillableRowsRead !==
            HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT
        ) {
          throw new Error(
            "Historical continuity scan authorization does not match its exact claim.",
          );
        }
        // Bind the last pre-D1 cut to the same canonical predecessor bytes that
        // were archived and claimed. This callback returns directly into the
        // snapshot runner, so no asynchronous gap follows this check.
        assertCanonicalPredecessorBeforeSuccessorCapture(backupDir);
        if (interruptedAuthorization) {
          scanAuthorized =
            finalizeHistoricalSuccessorScanAuthorizationPublication({
              stateDirectory,
              claim,
              resumeLease: requireHistoricalSuccessorResumeLease(resumeLease),
              scanAuthorized: interruptedAuthorization,
            });
          interruptedAuthorization = undefined;
        } else {
          scanAuthorized = authorizeHistoricalSuccessorCaptureScan({
            stateDirectory,
            claim,
            resumeLease,
            snapshotPlanSha256: expected.snapshotPlanSha256,
            maximumRowsRead: expected.maximumRowsRead,
            now: authorizationAt,
          });
        }
      },
    });
    authorization = requireSuccessorScanAuthorization(scanAuthorized);
  } catch (error) {
    const failedState = classifyHistoricalSuccessorCaptureState({
      stateDirectory,
      expected,
    });
    if (
      (failedState.status === "claimed-pre-scan" ||
        failedState.status === "scan-authorization-publication-interrupted") &&
      failedState.claim.value.runId === claim.value.runId
    ) {
      const detail = error instanceof Error
        ? error.message
        : "Historical successor capture failed before D1 scan.";
      throw new Error(
        `${detail} The immutable pre-scan claim is retained; resume only with --resume-successor-pre-scan-run ${claim.value.runId}.`,
        { cause: error },
      );
    }
    throw error;
  }
  const preparedAt = readSuccessorCaptureClock(clock, "prepared evidence");
  const sourceAfterCapture = assertSuccessorCaptureSource(cwd);
  requireSourceIdentity(sourceAfterCapture, expected.source, "post-capture");
  const validatedReport = validateSuccessorCaptureReport({
    value: report,
    backupDir,
    cwd,
    source,
    predecessor,
    expected,
    now: preparedAt,
  });
  const prepared = prepareHistoricalSuccessorCapture({
    stateDirectory,
    claim,
    scanAuthorized: authorization,
    report: validatedReport,
    forbiddenPlaintextValues: [hmacKey.secret],
    now: preparedAt,
  });
  const reportPath = reportWriter(backupDir, validatedReport);
  const expectedReportPath = historicalDataReportPath(backupDir, "baseline");
  if (path.resolve(reportPath) !== expectedReportPath) {
    throw new Error("Historical continuity promoted the successor to the wrong baseline path.");
  }
  const promotedAt = readSuccessorCaptureClock(clock, "baseline promotion");
  const promoted = validateCanonicalSuccessorCaptureReport({
    backupDir,
    cwd,
    source,
    predecessor,
    expected,
    now: promotedAt,
  });
  const sourceAfterPromotion = assertSuccessorCaptureSource(cwd);
  requireSourceIdentity(sourceAfterPromotion, expected.source, "post-promotion");
  completeHistoricalSuccessorCapture({
    stateDirectory,
    claim,
    scanAuthorized: authorization,
    prepared,
    canonicalBaselinePath: expectedReportPath,
    now: readSuccessorCaptureClock(clock, "completion evidence"),
  });
  const finalSource = assertSuccessorCaptureSource(cwd);
  requireSourceIdentity(finalSource, expected.source, "completed successor");
  return { report: promoted, replayed: false };
  } finally {
    activeSuccessorCaptureRunIds.delete(claim.value.runId);
  }
}

function finalizeOrReplayHistoricalSuccessorCapture(options: {
  state: ReturnType<typeof classifyHistoricalSuccessorCaptureState>;
  stateDirectory: string;
  expected: HistoricalSuccessorCaptureExpectedIdentity;
  predecessor: HistoricalDataLegacyBaselineReport;
  source: SourceFingerprint;
  backupDir: string;
  cwd: string;
  clock: () => Date;
  reportWriter: typeof writeHistoricalDataReport;
}) {
  const requireCurrentSource = (label: string) => {
    const current = assertSuccessorCaptureSource(options.cwd);
    requireSourceIdentity(current, options.source, label);
  };
  const validateCanonical = () => validateCanonicalSuccessorCaptureReport({
    backupDir: options.backupDir,
    cwd: options.cwd,
    source: options.source,
    predecessor: options.predecessor,
    expected: options.expected,
    now: readSuccessorCaptureClock(options.clock, "successor replay"),
    maximumAgeMs: HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
  });
  if (options.state.status === "empty") return undefined;
  if (options.state.status === "claimed-pre-scan") {
    throw new Error(
      "Historical successor capture has an unresolved pre-scan claim; reviewed recovery is required before retrying.",
    );
  }
  if (options.state.status === "scan-authorization-publication-interrupted") {
    throw new Error(
      "Historical successor scan authorization publication was interrupted before D1; exact-run resume is required.",
    );
  }
  if (options.state.status === "scan-authorized-unresolved") {
    throw new Error(
      "Historical successor capture may already have consumed its D1 scan; automatic rescan is forbidden.",
    );
  }
  if (options.state.status === "complete") {
    requireCompleteBaselinePath(options.state.complete.value.canonicalBaselinePath, options.backupDir);
    const report = validateCanonical();
    requireCurrentSource("completed successor replay");
    return report;
  }
  if (options.state.status === "complete-retained-claim") {
    requireCompleteBaselinePath(options.state.complete.value.canonicalBaselinePath, options.backupDir);
    const report = validateCanonical();
    requireCurrentSource("retained-claim successor replay");
    return report;
  }

  requireCurrentSource("prepared successor replay");
  const preparedReport = validateSuccessorCaptureReport({
    value: options.state.prepared.value.report,
    backupDir: options.backupDir,
    cwd: options.cwd,
    source: options.source,
    predecessor: options.predecessor,
    expected: options.expected,
    now: readSuccessorCaptureClock(options.clock, "prepared replay"),
    maximumAgeMs: HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
  });
  promotePreparedSuccessorCapture({
    prepared: options.state.prepared.value,
    report: preparedReport,
    backupDir: options.backupDir,
    cwd: options.cwd,
    source: options.source,
    predecessor: options.predecessor,
    expected: options.expected,
    now: readSuccessorCaptureClock(options.clock, "prepared promotion"),
    maximumAgeMs: HISTORICAL_DATA_FINAL_VERIFICATION_MAX_AGE_MS,
    reportWriter: options.reportWriter,
  });
  requireCurrentSource("post-promotion successor replay");
  const promoted = validateCanonical();
  requireCurrentSource("pre-completion successor replay");
  completeHistoricalSuccessorCapture({
    stateDirectory: options.stateDirectory,
    claim: options.state.claim,
    scanAuthorized: options.state.scanAuthorized,
    prepared: options.state.prepared,
    canonicalBaselinePath: historicalDataReportPath(options.backupDir, "baseline"),
    now: readSuccessorCaptureClock(options.clock, "prepared completion"),
  });
  requireCurrentSource("retained-claim prepared successor replay");
  return promoted;
}

function promotePreparedSuccessorCapture(options: {
  prepared: HistoricalSuccessorCapturePrepared;
  report: HistoricalDataBaselineReport;
  backupDir: string;
  cwd: string;
  source: SourceFingerprint;
  predecessor: HistoricalDataLegacyBaselineReport;
  expected: HistoricalSuccessorCaptureExpectedIdentity;
  now: Date;
  maximumAgeMs: number;
  reportWriter: typeof writeHistoricalDataReport;
}) {
  const baselinePath = historicalDataReportPath(options.backupDir, "baseline");
  const baselineBytes = readPrivateBytesNoFollow(baselinePath, 2 * 1024 * 1024);
  const baselineSha256 = createHash().update(baselineBytes).digest("hex");
  if (baselineSha256 === policy.predecessor.baselineSha256) {
    const written = options.reportWriter(options.backupDir, options.report);
    if (path.resolve(written) !== baselinePath) {
      throw new Error("Prepared successor capture promoted to the wrong baseline path.");
    }
    return;
  }
  const existing = validateSuccessorCaptureReport({
    value: parseJsonBytes(baselineBytes, "promoted successor baseline"),
    backupDir: options.backupDir,
    cwd: options.cwd,
    source: options.source,
    predecessor: options.predecessor,
    expected: options.expected,
    now: options.now,
    maximumAgeMs: options.maximumAgeMs,
  });
  if (
    successorCaptureJsonSha256(existing) !== options.prepared.reportSha256 ||
    successorCaptureJsonSha256(existing) !== successorCaptureJsonSha256(options.report)
  ) {
    throw new Error("Canonical successor baseline diverges from the prepared report.");
  }
}

function validateCanonicalSuccessorCaptureReport(options: {
  backupDir: string;
  cwd: string;
  source: SourceFingerprint;
  predecessor: HistoricalDataLegacyBaselineReport;
  expected: HistoricalSuccessorCaptureExpectedIdentity;
  now: Date;
  maximumAgeMs?: number;
}) {
  const report = readAndValidateHistoricalDataBaseline({
    backupDir: options.backupDir,
    cwd: options.cwd,
    expectedSourceFingerprint: options.source,
    now: options.now,
    maximumAgeMs: options.maximumAgeMs ?? HISTORICAL_DATA_BASELINE_MAX_AGE_MS,
  });
  return requireExactSuccessorCaptureReport(report, options);
}

function validateSuccessorCaptureReport(options: {
  value: unknown;
  backupDir: string;
  cwd: string;
  source: SourceFingerprint;
  predecessor: HistoricalDataLegacyBaselineReport;
  expected: HistoricalSuccessorCaptureExpectedIdentity;
  now: Date;
  maximumAgeMs?: number;
}) {
  const report = validateHistoricalDataBaselineValue(options.value, {
    backupDir: options.backupDir,
    cwd: options.cwd,
    expectedSourceFingerprint: options.source,
    now: options.now,
    maximumAgeMs: options.maximumAgeMs ?? HISTORICAL_DATA_BASELINE_MAX_AGE_MS,
  });
  return requireExactSuccessorCaptureReport(report, options);
}

function requireExactSuccessorCaptureReport(
  report: HistoricalDataBaselineReport,
  options: {
    backupDir: string;
    predecessor: HistoricalDataLegacyBaselineReport;
    expected: HistoricalSuccessorCaptureExpectedIdentity;
  },
) {
  assertSuccessorCaptureWindow(new Date(report.createdAt));
  if (
    path.resolve(report.backupDir) !== path.resolve(options.backupDir) ||
    report.utcDay !== options.expected.utcDay ||
    report.operationId !== options.expected.operationId ||
    report.hmacKeyId !== options.predecessor.hmacKeyId ||
    report.sourceFingerprint.sha256 !== options.expected.source.sha256 ||
    report.sourceFingerprint.fileCount !== options.expected.source.fileCount ||
    report.rowsWritten !== 0
  ) {
    throw new Error("Historical successor baseline does not match its exact capture claim.");
  }
  return report;
}

function historicalSuccessorCaptureExpectedIdentity(options: {
  backupDir: string;
  source: SourceFingerprint;
  predecessor: HistoricalDataLegacyBaselineReport;
  archiveManifestSha256: string;
}): HistoricalSuccessorCaptureExpectedIdentity {
  return {
    backupDir: path.resolve(options.backupDir),
    policyId: policy.policyId,
    policySha256: HISTORICAL_DATA_CONTINUITY_POLICY_SHA256,
    archiveManifestSha256: options.archiveManifestSha256,
    predecessorBaselineSha256: policy.predecessor.baselineSha256,
    predecessorHmacKeyId: options.predecessor.hmacKeyId,
    source: compactSource(options.source),
    operationId: historicalDataBudgetOperationId(
      "baseline",
      compactSource(options.source),
    ),
    utcDay: policy.successor.requiredUtcDay,
    windowEndsAt: new Date(
      Date.parse(policy.predecessor.baselineCreatedAt) +
        policy.successor.maximumGapMs,
    ).toISOString(),
    snapshotPlanSha256: HISTORICAL_DATA_SNAPSHOT_PLAN_SHA256,
    maximumRowsRead: HISTORICAL_BILLED_READ_LIMIT,
  };
}

function assertCanonicalPredecessorBeforeSuccessorCapture(backupDir: string) {
  const baselinePath = historicalDataReportPath(backupDir, "baseline");
  const baselineBytes = readPrivateBytesNoFollow(baselinePath, 2 * 1024 * 1024);
  requireSha256(
    baselineBytes,
    policy.predecessor.baselineSha256,
    "canonical predecessor baseline",
  );
}

function requireHistoricalSuccessorPreScanResume(options: {
  state: Extract<
    ReturnType<typeof classifyHistoricalSuccessorCaptureState>,
    {
      status:
        | "claimed-pre-scan"
        | "scan-authorization-publication-interrupted";
    }
  >;
  requestedRunId: string | undefined;
}) {
  const runId = options.state.claim.value.runId;
  if (!options.requestedRunId) {
    throw new Error(
      `Historical successor capture has immutable pre-scan claim ${runId}; resume it explicitly with --resume-successor-pre-scan-run ${runId}.`,
    );
  }
  if (options.requestedRunId !== runId) {
    throw new Error(
      "Historical successor pre-scan resume run ID does not match the exact retained claim.",
    );
  }
  return options.state.claim;
}

function acquireHistoricalSuccessorResumeOwnership(options: {
  stateDirectory: string;
  claim: HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureClaim>;
  now: Date;
}) {
  const leases = readHistoricalSuccessorCaptureResumeLeases(
    options.stateDirectory,
  );
  const latest = leases.at(-1);
  assertHistoricalSuccessorResumeOwnerAvailable(
    latest?.value.owner ?? options.claim.value.owner,
  );
  return acquireHistoricalSuccessorCaptureResumeLease({
    stateDirectory: options.stateDirectory,
    claim: options.claim,
    expectedLatestLease: latest,
    now: options.now,
  });
}

function assertHistoricalSuccessorResumeOwnerAvailable(owner: {
  hostname: string;
  pid: number;
}) {
  if (owner.hostname !== os.hostname()) {
    throw new Error(
      "Historical successor resume cannot prove the latest owner state on another host.",
    );
  }
  if (owner.pid === process.pid) return;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (readErrorCode(error) === "ESRCH") return;
    throw new Error(
      "Historical successor resume could not prove that its latest owner exited.",
    );
  }
  throw new Error(
    "Historical successor resume refuses while the latest lease owner process is still running.",
  );
}

function requireHistoricalSuccessorResumeLease(
  value:
    | HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureResumeLease>
    | undefined,
) {
  if (!value) {
    throw new Error(
      "Historical successor interrupted authorization requires an exact resume lease.",
    );
  }
  return value;
}

function readErrorCode(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
  ) {
    return value.code;
  }
  return undefined;
}

function requireSuccessorScanAuthorization(
  value:
    | HistoricalSuccessorCaptureFileHandle<HistoricalSuccessorCaptureScanAuthorization>
    | undefined,
) {
  if (!value) {
    throw new Error(
      "Historical successor capture returned without durable scan authorization.",
    );
  }
  return value;
}

function requireCompleteBaselinePath(value: string, backupDir: string) {
  if (path.resolve(value) !== historicalDataReportPath(backupDir, "baseline")) {
    throw new Error("Historical successor completion references the wrong baseline path.");
  }
}

function readSuccessorCaptureClock(clock: () => Date, label: string) {
  const value = clock();
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`Historical successor capture requires a valid ${label} clock.`);
  }
  return new Date(value);
}

export function readRecoveredHistoricalHmacSecretFromFile(file: string) {
  const absolute = path.resolve(file);
  if (
    !path.isAbsolute(file) ||
    path.normalize(file) !== file ||
    /[\u0000-\u001f\u007f]/.test(file)
  ) {
    throw new Error("Recovered predecessor-key input requires a normalized absolute file path.");
  }
  let descriptor: number;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
  } catch {
    throw new Error(
      "Recovered predecessor-key input must be a nofollow owner-only mode-0600 file without ACLs.",
    );
  }
  try {
    const inputStat = fs.fstatSync(descriptor);
    if (
      !inputStat.isFile() ||
      (inputStat.mode & 0o777) !== 0o600 ||
      inputStat.size <= 0 ||
      inputStat.size > 66 ||
      (typeof process.getuid === "function" && inputStat.uid !== process.getuid())
    ) {
      throw new Error(
        "Recovered predecessor-key input must be a nofollow owner-only mode-0600 file without ACLs.",
      );
    }
    assertRecoveredKeyFileHasNoExtendedAcl(absolute, descriptor, inputStat);
    const input = Buffer.alloc(inputStat.size);
    try {
      const bytesRead = fs.readSync(
        descriptor,
        input,
        0,
        input.byteLength,
        0,
      );
      if (bytesRead !== input.byteLength) {
        throw new Error("Recovered predecessor-key input changed while being read.");
      }
      const after = fs.fstatSync(descriptor);
      if (
        after.dev !== inputStat.dev ||
        after.ino !== inputStat.ino ||
        after.size !== inputStat.size
      ) {
        throw new Error("Recovered predecessor-key input changed while being read.");
      }
      const text = input.toString("utf8");
      const secret = text.endsWith("\r\n")
        ? text.slice(0, -2)
        : text.endsWith("\n")
          ? text.slice(0, -1)
          : text;
      return requireGeneratedHistoricalHmacSecret(secret);
    } finally {
      input.fill(0);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertRecoveredKeyFileHasNoExtendedAcl(
  file: string,
  descriptor: number,
  descriptorStat: fs.Stats,
) {
  if (process.platform !== "darwin") {
    throw new Error("Recovered predecessor-key escrow requires macOS ACL verification.");
  }
  const result = spawnSync("/bin/ls", ["-lde", file], {
    cwd: "/",
    encoding: "utf8",
    env: {
      LANG: "C",
      LC_ALL: "C",
      NODE_ENV: process.env.NODE_ENV,
      PATH: "/usr/bin:/bin",
    },
    maxBuffer: 8 * 1024,
    timeout: 5_000,
  });
  const permissions = result.stdout
    ?.split(/\r?\n/, 1)[0]
    ?.trimStart()
    .split(/\s+/, 1)[0];
  const pathStat = fs.lstatSync(file);
  const after = fs.fstatSync(descriptor);
  if (
    result.status !== 0 ||
    result.signal !== null ||
    permissions !== "-rw-------" ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    pathStat.dev !== descriptorStat.dev ||
    pathStat.ino !== descriptorStat.ino ||
    after.dev !== descriptorStat.dev ||
    after.ino !== descriptorStat.ino ||
    (typeof process.getuid === "function" && pathStat.uid !== process.getuid())
  ) {
    throw new Error(
      "Recovered predecessor-key input must be a nofollow owner-only mode-0600 file without ACLs.",
    );
  }
}

function requireCliArgument(name: string) {
  const indexes = process.argv.reduce<number[]>((matches, value, index) => {
    if (value === name) matches.push(index);
    return matches;
  }, []);
  if (indexes.length !== 1) {
    throw new Error(`Historical continuity requires exactly one ${name} argument.`);
  }
  const value = process.argv[indexes[0]! + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Historical continuity requires a value for ${name}.`);
  }
  return value;
}

function assertSuccessorCaptureWindow(now: Date) {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("Historical continuity successor capture requires a valid clock.");
  }
  const requiredDay = policy.successor.requiredUtcDay;
  const earliest = Date.parse(`${requiredDay}T00:00:00.000Z`);
  const latest = Date.parse(policy.predecessor.baselineCreatedAt) +
    policy.successor.maximumGapMs;
  if (now.getTime() < earliest || now.getTime() > latest) {
    throw new Error("Historical continuity successor capture is outside its exact UTC window.");
  }
}

function assertSuccessorCaptureSource(cwd: string) {
  const resolvedCwd = path.resolve(cwd);
  assertGitReleaseIdentity({ cwd: resolvedCwd });
  const source = buildRepoSourceFingerprint(resolvedCwd);
  if (
    source.sha256 === policy.predecessor.sourceSha256 ||
    source.fileCount === 0
  ) {
    throw new Error("Historical continuity successor capture requires the clean pushed successor source.");
  }
  return source;
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
  const baseline = parsePolicyPredecessorBaseline(
    parseJsonBytes(baselineBytes, "predecessor baseline"),
  );
  assertPolicyPredecessorBaseline(baseline, backupDir);

  const commitSource = buildGitCommitSourceFingerprint(policy.predecessor.gitCommit, cwd);
  requireSourceIdentity(commitSource, {
    sha256: policy.predecessor.sourceSha256,
    fileCount: policy.predecessor.sourceFileCount,
  }, "predecessor Git commit");

  const ledgerPath = path.join(backupDir, "cloudflare", policy.predecessor.ledgerFileName);
  const ledgerBytes = readPrivateBytesNoFollow(ledgerPath, 4 * 1024 * 1024);
  requireSha256(ledgerBytes, policy.predecessor.ledgerSha256, "predecessor ledger");
  const ledger = parseD1ReleaseBudgetLedger(
    parseJsonBytes(ledgerBytes, "predecessor ledger"),
  );
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
  const successorEvidence = readSuccessorBaselineEvidence(backupDir);
  const successor = validateHistoricalDataBaselineValue(successorEvidence.value, {
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
      baselineSha256: successorEvidence.sha256,
      utcDay: policy.successor.requiredUtcDay,
    },
    sameHmacKey: evaluation.sameHmacKey,
    gapMs: evaluation.gapMs,
    datasets: evaluation.datasets,
    operationalDatasets: evaluation.operationalDatasets,
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
  predecessor: HistoricalDataLegacyBaselineReport;
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
  const operationalDatasets = {
    memory_vector_cleanup_outbox: historicalDataContinuityOperationalDatasetDecision(
      options.successor,
    ),
  } satisfies Record<
    (typeof HISTORICAL_OPERATIONAL_DATASET_NAMES)[number],
    HistoricalDataContinuityOperationalDatasetDecision
  >;
  const outbox = operationalDatasets.memory_vector_cleanup_outbox;
  if (!outbox.successorSchemaPresent) {
    problems.push("memory_vector_cleanup_outbox schema is absent from the successor baseline.");
  }
  if (!outbox.successorEmptyBeforeFirstActivation) {
    problems.push(
      "memory_vector_cleanup_outbox was not empty before the first 0016 Worker activation.",
    );
  }
  return {
    ok: problems.length === 0,
    sameHmacKey,
    gapMs,
    datasets,
    operationalDatasets,
    problems,
  };
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
  const successorEvidence = readSuccessorBaselineEvidence(backupDir);
  if (successorEvidence.sha256 !== report.successor.baselineSha256) {
    throw new Error("Historical continuity report does not bind the current successor baseline.");
  }
  const baseline = parseHistoricalDataBaselineReport(successorEvidence.value);
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
  predecessor: HistoricalDataLegacyBaselineReport;
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
  const expectedOutbox = historicalDataContinuityOperationalDatasetDecision(
    options.successor,
  );
  const reportedOutbox =
    options.report.operationalDatasets.memory_vector_cleanup_outbox;
  if (
    reportedOutbox.lifecycle !== expectedOutbox.lifecycle ||
    reportedOutbox.predecessorEvidence !== expectedOutbox.predecessorEvidence ||
    reportedOutbox.successorRows !== expectedOutbox.successorRows ||
    reportedOutbox.successorSchemaPresent !== expectedOutbox.successorSchemaPresent ||
    reportedOutbox.successorEmptyBeforeFirstActivation !==
      expectedOutbox.successorEmptyBeforeFirstActivation ||
    reportedOutbox.rowPreservationRequired !== false ||
    !expectedOutbox.successorSchemaPresent ||
    !expectedOutbox.successorEmptyBeforeFirstActivation
  ) {
    throw new Error(
      "Historical continuity operational outbox decision is failed or inconsistent with the successor baseline.",
    );
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
  requireSha256(bytes, policy.predecessor.baselineSha256, "archived predecessor baseline");
  const baseline = parsePolicyPredecessorBaseline(
    parseJsonBytes(bytes, "archived predecessor baseline"),
  );
  assertPolicyPredecessorBaseline(baseline, path.resolve(backupDir));
  const ledgerBytes = readPrivateBytesNoFollow(manifest.ledger.archivePath, 4 * 1024 * 1024);
  requireSha256(ledgerBytes, policy.predecessor.ledgerSha256, "archived predecessor ledger");
  const ledger = parseD1ReleaseBudgetLedger(
    parseJsonBytes(ledgerBytes, "archived predecessor ledger"),
  );
  assertArchivedBaselineReservation(baseline, ledger);
  return baseline;
}

function assertPolicyPredecessorBaseline(
  baseline: HistoricalDataLegacyBaselineReport,
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

function parsePolicyPredecessorBaseline(value: unknown) {
  return parseHistoricalDataLegacyBaselineReportForContinuity(value, {
    sourceSha256: policy.predecessor.sourceSha256,
    sourceFileCount: policy.predecessor.sourceFileCount,
    createdAt: policy.predecessor.baselineCreatedAt,
    utcDay: policy.predecessor.baselineUtcDay,
    operationId: policy.predecessor.baselineOperationId,
  });
}

function assertArchivedBaselineReservation(
  baseline: HistoricalDataLegacyBaselineReport,
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
    policy.budgetBlock.requestedVerificationRowsRead !== HISTORICAL_DATA_LEGACY_BILLED_READ_LIMIT ||
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

function historicalDataContinuityOperationalDatasetDecision(
  successor: HistoricalDataBaselineReport,
): HistoricalDataContinuityOperationalDatasetDecision {
  const outbox = successor.operationalDatasets.memory_vector_cleanup_outbox;
  return {
    lifecycle: "mutable-drainable-outbox",
    predecessorEvidence: "not-captured-by-pinned-v1-baseline",
    successorRows: outbox.rowCount,
    successorSchemaPresent:
      hasRequiredHistoricalMemoryVectorCleanupOutboxSchema(outbox),
    successorEmptyBeforeFirstActivation: outbox.rowCount === 0,
    rowPreservationRequired: false,
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

function readSuccessorBaselineEvidence(backupDir: string) {
  const baselinePath = historicalDataReportPath(backupDir, "baseline");
  const bytes = readPrivateBytesNoFollow(baselinePath, 2 * 1024 * 1024);
  return {
    value: parseJsonBytes(bytes, "successor baseline"),
    sha256: createHash().update(bytes).digest("hex"),
  };
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
