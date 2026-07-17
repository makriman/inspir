import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET,
  applyHistoricalDataFresh0016Migration,
} from "./apply-historical-data-fresh-0016-migration";
import {
  MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
  loadRuntimeMigrationCardinalities,
  projectRuntimeMigrationUsage,
} from "./check-d1-runtime-migration-budget";
import {
  assertD1ReleaseBudgetReservation,
  reserveD1ReleaseBudget,
  type D1ReleaseBudgetReservationResult,
} from "./d1-release-budget-ledger";
import {
  loadAccountD1DailyUsage,
} from "./d1-free-budget";
import { assertGitReleaseIdentity } from "./git-release-identity";
import {
  assertHistoricalFresh0016LiveTopologyEvidence,
  createHistoricalFresh0016LiveTopologyEvidence,
  HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
  HISTORICAL_FRESH_0016_CUTOVER_MAXIMUM_GAP_MS,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
  HISTORICAL_FRESH_0016_CUTOVER_POST_RESET_WINDOW_MS,
  HISTORICAL_FRESH_0016_CUTOVER_PRE_RESET_WINDOW_MS,
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_PROJECTION_ROWS_READ_LIMIT,
  HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG,
  HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE,
  HISTORICAL_FRESH_0016_WORKERS_FREE_UTC_RESET_TIMING_MODE,
  type HistoricalFresh0016CutoverTimingMode,
  type HistoricalFresh0016LiveTopologyEvidence,
} from "./historical-data-fresh-0016-cutover-policy";
import {
  preauthorizeHistoricalFresh0016Day2Budget,
  readHistoricalFresh0016Day2BudgetEnvelope,
  type HistoricalFresh0016Day2BudgetEnvelopeHandle,
} from "./historical-data-fresh-0016-day2-budget";
import {
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES,
  HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
  historicalFresh0016MigrationBindingSchema,
  publishHistoricalFresh0016RenderedMigration,
} from "./historical-data-fresh-0016-migration";
import {
  readHistoricalFresh0016PredecessorPrerequisites,
  verifyHistoricalFresh0016PredecessorRuntimeGate,
} from "./historical-data-fresh-0016-prerequisites";
import {
  HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
  HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME,
  historicalFresh0016MigrationBudgetPreparedSchema,
  historicalFresh0016MigrationOperationId,
  readHistoricalFresh0016MigrationBudgetPrepared,
  writeHistoricalFresh0016MigrationBudgetPrepared,
  type HistoricalFresh0016MigrationBudgetPrepared,
} from "./historical-data-fresh-0016-migration-budget";
import {
  captureHistoricalFresh0016PredecessorReport,
  finalizeHistoricalFresh0016PredecessorPreparedCapture,
  historicalFresh0016PredecessorOperationId,
  parseHistoricalFresh0016PredecessorPreparedCapture,
  readHistoricalFresh0016PredecessorReport,
  writeHistoricalFresh0016PredecessorReport,
  HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
  type HistoricalFresh0016PredecessorReport,
} from "./historical-data-fresh-0016-predecessor";
import {
  HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES,
  acquireHistoricalFresh0016ResumeLease,
  canonicalHistoricalFresh0016Json,
  classifyHistoricalFresh0016State,
  createHistoricalFresh0016RunDirectory,
  historicalFresh0016JsonSha256,
  publishHistoricalFresh0016StateStage,
  validateHistoricalFresh0016RunDirectory,
  type HistoricalFresh0016JsonObject,
  type HistoricalFresh0016Owner,
  type HistoricalFresh0016SourceFingerprint,
  type HistoricalFresh0016StateClassification,
  type HistoricalFresh0016StateFileHandle,
  type HistoricalFresh0016StateStageEnvelope,
} from "./historical-data-fresh-0016-state";
import {
  HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME,
  captureHistoricalFresh0016SuccessorReport,
  finalizeHistoricalFresh0016SuccessorPreparedCapture,
  historicalFresh0016SuccessorOperationId,
  historicalFresh0016SuccessorPredecessorReportSha256,
  historicalFresh0016SuccessorProductionExclusionOwnerSha256,
  historicalFresh0016SuccessorRuntimeVerificationReportSha256,
  parseHistoricalFresh0016SuccessorPreparedCapture,
  readHistoricalFresh0016SuccessorReport,
  writeHistoricalFresh0016SuccessorReport,
  type HistoricalFresh0016SuccessorReport,
} from "./historical-data-fresh-0016-successor";
import {
  createHistoricalDataHmacKey,
  historicalDataHmacKeyId,
  readHistoricalDataHmacKey,
  type HistoricalDataHmacKey,
} from "./historical-data-hmac-key";
import {
  HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
  createHistoricalPre0016SnapshotPlan,
} from "./historical-data-pre-0016-snapshot";
import {
  RELEASE_BACKUP_DIR_ENV,
  runWrangler,
  type WranglerRunner,
} from "./migration-config";
import { createHistoricalDataWranglerRunner } from "./historical-data-wrangler-runner";
import {
  acquireProductionValidationExclusion,
  attestProductionValidationExclusion,
  canonicalProductionValidationLockOwner,
  parseProductionValidationLockBudget,
  parseProductionValidationLockOwner,
  releaseProductionValidationExclusion,
  verifyProductionValidationLock,
  type ProductionValidationExclusion,
} from "./production-validation-lock";
import {
  buildRepoSourceFingerprint,
  type SourceFingerprint,
} from "./source-fingerprint";
import {
  HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
} from "./verify-historical-data-preservation";
import {
  buildHistoricalFresh0016CutoverCompletionIntent,
  historicalFresh0016ClaimPayloadSchema,
  historicalFresh0016ManifestPayloadSchema,
  historicalFresh0016MigrationBudgetEvidenceSchema,
  historicalFresh0016MigrationCompletePayloadSchema,
  historicalFresh0016PredecessorAuthorizationPayloadSchema,
  historicalFresh0016PredecessorCompletePayloadSchema,
  historicalFresh0016RuntimeStagePayloadSchema,
  historicalFresh0016SuccessorAuthorizationPayloadSchema,
  historicalFresh0016SuccessorCompletePayloadSchema,
  verifyAndPublishHistoricalFresh0016CutoverComplete,
  HISTORICAL_FRESH_0016_CHAIN_CLAIM_KIND,
  HISTORICAL_FRESH_0016_MANIFEST_KIND,
  HISTORICAL_FRESH_0016_MIGRATION_BUDGET_KIND,
  HISTORICAL_FRESH_0016_PREDECESSOR_AUTHORIZATION_KIND,
  HISTORICAL_FRESH_0016_PREDECESSOR_COMPLETE_KIND,
  HISTORICAL_FRESH_0016_RUNTIME_STAGE_KIND,
  HISTORICAL_FRESH_0016_SUCCESSOR_AUTHORIZATION_KIND,
  HISTORICAL_FRESH_0016_SUCCESSOR_COMPLETE_KIND,
} from "./verify-historical-data-fresh-0016-cutover-chain";
import {
  historicalFresh0016RuntimeVerificationReportSchema,
  verifyHistoricalDataFresh0016Migration,
  type HistoricalFresh0016RuntimeVerificationReport,
} from "./verify-historical-data-fresh-0016-migration";
import {
  readWorkerCandidateUploadEvidence,
  workerCandidateUploadEvidencePath,
} from "./worker-candidate-release-evidence";

const policy = HISTORICAL_FRESH_0016_CUTOVER_POLICY;
const PRODUCTION_CONFIRMATION_FLAG = "--confirm-production" as const;

export type HistoricalFresh0016CutoverMode = "start" | "finish" | "status";

export type HistoricalFresh0016CutoverResult = Readonly<{
  mode: HistoricalFresh0016CutoverMode;
  runId: string;
  status: HistoricalFresh0016StateClassification["status"];
  currentStage: HistoricalFresh0016StateClassification["currentStage"];
  nextStage: HistoricalFresh0016StateClassification["nextStage"];
  d1ExecutionMayHaveStarted: boolean;
  automaticRetryAllowed: boolean;
  resumeLeaseAllowed: boolean;
  readbackResolutionAllowed: boolean;
  issueCodes: readonly string[];
  canonicalArtifactSha256?: string;
  privacy: "state-summary-only-no-secrets";
}>;

export type HistoricalFresh0016CutoverOptions = Readonly<{
  mode: HistoricalFresh0016CutoverMode;
  cwd?: string;
  backupDirectory: string;
  runId?: string;
  productionConfirmation?: string;
  lostKeyBoundaryConfirmation?: string;
  paidExpeditedConfirmation?: string;
  runner?: WranglerRunner;
  clock?: () => Date;
  owner?: HistoricalFresh0016Owner;
  ownerExitProbe?: (owner: HistoricalFresh0016Owner) => boolean;
  dependencies?: Partial<HistoricalFresh0016CoordinatorDependencies>;
}>;

export type HistoricalFresh0016CutoverCliOptions = Readonly<{
  mode: HistoricalFresh0016CutoverMode;
  cwd: string;
  backupDirectory: string;
  runId?: string;
  productionConfirmation?: typeof PRODUCTION_CONFIRMATION_FLAG;
  lostKeyBoundaryConfirmation?: typeof HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG;
  paidExpeditedConfirmation?: typeof HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG;
}>;

export type HistoricalFresh0016CoordinatorDependencies = Readonly<{
  assertGitIdentity: typeof assertGitReleaseIdentity;
  buildSourceFingerprint: typeof buildRepoSourceFingerprint;
  readCandidateUploadEvidence: (
    backupDirectory: string,
  ) => ReturnType<typeof readWorkerCandidateUploadEvidence>;
  observeLiveTopology: (input: Readonly<{
    runner: WranglerRunner;
    observedAt: Date;
    workerRelease: UploadedInactiveWorkerRelease;
  }>) => Readonly<{
    evidence: HistoricalFresh0016LiveTopologyEvidence;
    statusOutput: string;
  }>;
  createHmacKey: () => Promise<HistoricalDataHmacKey>;
  readHmacKey: (hmacKeyId: string) => Promise<HistoricalDataHmacKey>;
  createRunDirectory: typeof createHistoricalFresh0016RunDirectory;
  validateRunDirectory: typeof validateHistoricalFresh0016RunDirectory;
  classifyState: typeof classifyHistoricalFresh0016State;
  acquireResumeLease: typeof acquireHistoricalFresh0016ResumeLease;
  publishStage: typeof publishHistoricalFresh0016StateStage;
  loadDailyUsage: typeof loadAccountD1DailyUsage;
  reserveBudget: typeof reserveD1ReleaseBudget;
  assertBudget: typeof assertD1ReleaseBudgetReservation;
  preauthorizeDay2Budget: typeof preauthorizeHistoricalFresh0016Day2Budget;
  readDay2Budget: typeof readHistoricalFresh0016Day2BudgetEnvelope;
  readPredecessorPrerequisites:
    typeof readHistoricalFresh0016PredecessorPrerequisites;
  verifyPredecessorRuntimeGate:
    typeof verifyHistoricalFresh0016PredecessorRuntimeGate;
  capturePredecessor: typeof captureHistoricalFresh0016PredecessorReport;
  finalizePredecessor: typeof finalizeHistoricalFresh0016PredecessorPreparedCapture;
  writePredecessor: typeof writeHistoricalFresh0016PredecessorReport;
  readPredecessorIdentity: (input: Readonly<{
    backupDirectory: string;
    cutoverRunId: string;
    forbiddenPlaintext?: readonly string[];
  }>) => Readonly<{
    sha256: string;
    report: Readonly<{ hmacKeyId: string; utcDay: string }>;
  }>;
  readPredecessor: typeof readHistoricalFresh0016PredecessorReport;
  acquireExclusion: typeof acquireProductionValidationExclusion;
  attestExclusion: typeof attestProductionValidationExclusion;
  verifyLock: typeof verifyProductionValidationLock;
  releaseExclusion: typeof releaseProductionValidationExclusion;
  loadCardinalities: typeof loadRuntimeMigrationCardinalities;
  projectMigration: typeof projectRuntimeMigrationUsage;
  writePreparedBudget: typeof writeHistoricalFresh0016MigrationBudgetPrepared;
  readPreparedBudget: typeof readHistoricalFresh0016MigrationBudgetPrepared;
  publishRenderedMigration: typeof publishHistoricalFresh0016RenderedMigration;
  applyMigration: typeof applyHistoricalDataFresh0016Migration;
  verifyMigration: typeof verifyHistoricalDataFresh0016Migration;
  captureSuccessor: typeof captureHistoricalFresh0016SuccessorReport;
  finalizeSuccessor: typeof finalizeHistoricalFresh0016SuccessorPreparedCapture;
  writeSuccessor: typeof writeHistoricalFresh0016SuccessorReport;
  readSuccessor: typeof readHistoricalFresh0016SuccessorReport;
  buildCompletionIntent: typeof buildHistoricalFresh0016CutoverCompletionIntent;
  publishCanonicalCompletion: typeof verifyAndPublishHistoricalFresh0016CutoverComplete;
  afterBoundary: (boundary: HistoricalFresh0016CoordinatorBoundary) => void;
}>;

export type HistoricalFresh0016CoordinatorBoundary =
  | "claim-published"
  | "predecessor-maximum-reserved"
  | "predecessor-authorized-published"
  | "predecessor-prepared-published"
  | "predecessor-report-published"
  | "predecessor-complete-published"
  | "production-exclusion-attested"
  | "day2-budget-envelope-published"
  | "migration-maximum-reserved"
  | "before-migration-cardinality"
  | "migration-budget-prepared-published"
  | "before-migration-exact"
  | "migration-exact-reserved"
  | "before-manifest"
  | "manifest-published"
  | "rendered-migration-published"
  | "migration-apply-returned"
  | "runtime-verification-published"
  | "successor-maximum-reserved"
  | "successor-authorized-published"
  | "successor-prepared-published"
  | "successor-report-published"
  | "successor-complete-published"
  | "cutover-complete-published"
  | "canonical-completion-published"
  | "production-exclusion-released";

const defaultDependencies: HistoricalFresh0016CoordinatorDependencies = {
  assertGitIdentity: assertGitReleaseIdentity,
  buildSourceFingerprint: buildRepoSourceFingerprint,
  readCandidateUploadEvidence: (backupDirectory) =>
    readWorkerCandidateUploadEvidence(
      workerCandidateUploadEvidencePath(backupDirectory),
    ),
  observeLiveTopology: ({ runner, observedAt, workerRelease }) => {
    const statusOutput = runner([
      "deployments",
      "status",
      "--name",
      "inspirlearning",
      "--json",
    ]);
    return {
      evidence: createHistoricalFresh0016LiveTopologyEvidence({
        observedAt,
        statusOutput,
        ...workerRelease,
      }),
      statusOutput,
    };
  },
  createHmacKey: () => createHistoricalDataHmacKey(),
  readHmacKey: (hmacKeyId) => readHistoricalDataHmacKey(hmacKeyId),
  createRunDirectory: createHistoricalFresh0016RunDirectory,
  validateRunDirectory: validateHistoricalFresh0016RunDirectory,
  classifyState: classifyHistoricalFresh0016State,
  acquireResumeLease: acquireHistoricalFresh0016ResumeLease,
  publishStage: publishHistoricalFresh0016StateStage,
  loadDailyUsage: loadAccountD1DailyUsage,
  reserveBudget: reserveD1ReleaseBudget,
  assertBudget: assertD1ReleaseBudgetReservation,
  preauthorizeDay2Budget: preauthorizeHistoricalFresh0016Day2Budget,
  readDay2Budget: readHistoricalFresh0016Day2BudgetEnvelope,
  readPredecessorPrerequisites:
    readHistoricalFresh0016PredecessorPrerequisites,
  verifyPredecessorRuntimeGate:
    verifyHistoricalFresh0016PredecessorRuntimeGate,
  capturePredecessor: captureHistoricalFresh0016PredecessorReport,
  finalizePredecessor: finalizeHistoricalFresh0016PredecessorPreparedCapture,
  writePredecessor: writeHistoricalFresh0016PredecessorReport,
  readPredecessorIdentity: (input) => {
    const artifact = readHistoricalFresh0016PredecessorReport(input);
    return {
      sha256: artifact.sha256,
      report: {
        hmacKeyId: artifact.report.hmacKeyId,
        utcDay: artifact.report.utcDay,
      },
    };
  },
  readPredecessor: readHistoricalFresh0016PredecessorReport,
  acquireExclusion: acquireProductionValidationExclusion,
  attestExclusion: attestProductionValidationExclusion,
  verifyLock: verifyProductionValidationLock,
  releaseExclusion: releaseProductionValidationExclusion,
  loadCardinalities: loadRuntimeMigrationCardinalities,
  projectMigration: projectRuntimeMigrationUsage,
  writePreparedBudget: writeHistoricalFresh0016MigrationBudgetPrepared,
  readPreparedBudget: readHistoricalFresh0016MigrationBudgetPrepared,
  publishRenderedMigration: publishHistoricalFresh0016RenderedMigration,
  applyMigration: applyHistoricalDataFresh0016Migration,
  verifyMigration: verifyHistoricalDataFresh0016Migration,
  captureSuccessor: captureHistoricalFresh0016SuccessorReport,
  finalizeSuccessor: finalizeHistoricalFresh0016SuccessorPreparedCapture,
  writeSuccessor: writeHistoricalFresh0016SuccessorReport,
  readSuccessor: readHistoricalFresh0016SuccessorReport,
  buildCompletionIntent: buildHistoricalFresh0016CutoverCompletionIntent,
  publishCanonicalCompletion:
    verifyAndPublishHistoricalFresh0016CutoverComplete,
  afterBoundary: () => undefined,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}

async function runCli() {
  const cli = parseHistoricalFresh0016CutoverCliArgs(process.argv.slice(2));
  const result = await runHistoricalDataFresh0016Cutover(cli);
  console.log(JSON.stringify(result, null, 2));
}

export function parseHistoricalFresh0016CutoverCliArgs(
  args: readonly string[],
): HistoricalFresh0016CutoverCliOptions {
  if (args.length === 0) {
    throw new Error("Expected exactly one mode: start, finish, or status.");
  }
  const mode = args[0];
  if (mode !== "start" && mode !== "finish" && mode !== "status") {
    throw new Error("Expected exactly one mode: start, finish, or status.");
  }
  let cwd = process.cwd();
  let backupDirectory: string | undefined;
  let runId: string | undefined;
  let productionConfirmation: typeof PRODUCTION_CONFIRMATION_FLAG | undefined;
  let lostKeyBoundaryConfirmation:
    | typeof HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG
    | undefined;
  let paidExpeditedConfirmation:
    | typeof HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG
    | undefined;
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (seen.has(token)) {
      throw new Error(`Duplicate fresh-0016 coordinator flag ${token}.`);
    }
    seen.add(token);
    if (token === PRODUCTION_CONFIRMATION_FLAG) {
      productionConfirmation = PRODUCTION_CONFIRMATION_FLAG;
      continue;
    }
    if (token === HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG) {
      lostKeyBoundaryConfirmation =
        HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG;
      continue;
    }
    if (
      token === HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG
    ) {
      paidExpeditedConfirmation =
        HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG;
      continue;
    }
    if (token !== "--cwd" && token !== "--backup" && token !== "--run-id") {
      throw new Error(`Unknown fresh-0016 coordinator flag ${token}.`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Fresh-0016 coordinator flag ${token} requires one value.`);
    }
    index += 1;
    if (token === "--cwd") cwd = path.resolve(value);
    if (token === "--backup") backupDirectory = path.resolve(value);
    if (token === "--run-id") runId = value;
  }
  cwd = path.resolve(cwd);
  const envBackupDirectory = process.env[RELEASE_BACKUP_DIR_ENV];
  const defaultBackupDirectory =
    backupDirectory ??
    (envBackupDirectory ? envBackupDirectory : path.join(cwd, "tmp", "cloudflare-reports"));
  const backup = path.resolve(defaultBackupDirectory);
  if (mode === "status") {
    if (!runId) throw new Error("Fresh-0016 status requires --run-id.");
    if (
      productionConfirmation ||
      lostKeyBoundaryConfirmation ||
      paidExpeditedConfirmation
    ) {
      throw new Error("Fresh-0016 status is read-only and rejects mutation confirmations.");
    }
    return { mode, cwd, backupDirectory: backup, runId };
  }
  if (
    productionConfirmation !== PRODUCTION_CONFIRMATION_FLAG ||
    lostKeyBoundaryConfirmation !==
      HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG
  ) {
    throw new Error(
      `Fresh-0016 ${mode} requires exact ${PRODUCTION_CONFIRMATION_FLAG} and ${HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG} confirmations.`,
    );
  }
  if (mode === "finish" && !runId) {
    throw new Error("Fresh-0016 finish requires --run-id.");
  }
  return {
    mode,
    cwd,
    backupDirectory: backup,
    ...(runId ? { runId } : {}),
    productionConfirmation,
    lostKeyBoundaryConfirmation,
    ...(paidExpeditedConfirmation ? { paidExpeditedConfirmation } : {}),
  };
}

export async function runHistoricalDataFresh0016Cutover(
  options: HistoricalFresh0016CutoverOptions,
): Promise<HistoricalFresh0016CutoverResult> {
  const dependencies: HistoricalFresh0016CoordinatorDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backupDirectory = path.resolve(options.backupDirectory);
  const runner = createHistoricalDataWranglerRunner(
    options.runner ?? runWrangler,
  );
  const clock = options.clock ?? (() => new Date());
  const owner = options.owner ?? { hostname: os.hostname(), pid: process.pid };
  const timingMode = cutoverTimingMode(options);
  if (options.mode === "status") {
    if (!options.runId) throw new Error("Fresh-0016 status requires a run ID.");
    if (
      options.productionConfirmation !== undefined ||
      options.lostKeyBoundaryConfirmation !== undefined ||
      options.paidExpeditedConfirmation !== undefined
    ) {
      throw new Error(
        "Fresh-0016 status is read-only and rejects mutation confirmations.",
      );
    }
    dependencies.validateRunDirectory({
      backupDirectory,
      runId: options.runId,
    });
    return sanitizedResult(
      options.mode,
      dependencies.classifyState({
        backupDirectory,
        runId: options.runId,
      }),
    );
  }
  assertMutationConfirmation(options);
  if (options.mode === "start") {
    return await runStart({
      cwd,
      backupDirectory,
      runId: options.runId,
      runner,
      clock,
      timingMode,
      owner,
      ownerExitProbe: options.ownerExitProbe,
      dependencies,
    });
  }
  if (!options.runId) throw new Error("Fresh-0016 finish requires a run ID.");
  return await runFinish({
    cwd,
    backupDirectory,
    runId: options.runId,
    runner,
    clock,
    timingMode,
    owner,
    ownerExitProbe: options.ownerExitProbe,
    dependencies,
  });
}

type CoordinatorContext = Readonly<{
  cwd: string;
  backupDirectory: string;
  runId: string;
  runner: WranglerRunner;
  clock: () => Date;
  timingMode: HistoricalFresh0016CutoverTimingMode;
  owner: HistoricalFresh0016Owner;
  ownerExitProbe?: (owner: HistoricalFresh0016Owner) => boolean;
  dependencies: HistoricalFresh0016CoordinatorDependencies;
}>;

type StartContext = Omit<CoordinatorContext, "runId"> &
  Readonly<{ runId?: string }>;

async function runStart(input: StartContext) {
  const startAt = readClock(input.clock, "start window");
  assertPredecessorTiming(startAt, input.timingMode);
  const release = assertReleaseIdentity(input);
  const startTopology = observeLiveTopology(input, release, startAt);
  const liveRuntimeState =
    input.dependencies.verifyPredecessorRuntimeGate({
      backupDirectory: input.backupDirectory,
      cwd: input.cwd,
      sourceFingerprint: release.source,
      ...release.workerRelease,
      liveDeploymentStatusOutput: startTopology.statusOutput,
      liveTopologyObservedAt: startAt,
      predecessorStartAt: startAt,
      runner: input.runner,
      clock: input.clock,
      usageLoader: input.dependencies.loadDailyUsage,
      reserveBudget: input.dependencies.reserveBudget,
    });
  const predecessorPrerequisites =
    input.dependencies.readPredecessorPrerequisites({
      backupDirectory: input.backupDirectory,
      sourceFingerprint: release.source,
      ...release.workerRelease,
      predecessorStartAt: startAt,
      timingMode: input.timingMode,
      liveRuntimeState,
    });
  let runId = input.runId;
  let hmac: HistoricalDataHmacKey;
  if (!runId) {
    hmac = validateHmacKey(await input.dependencies.createHmacKey());
    const paths = input.dependencies.createRunDirectory({
      backupDirectory: input.backupDirectory,
    });
    runId = path.basename(paths.runDirectory);
    const claim = historicalFresh0016ClaimPayloadSchema.parse({
      kind: HISTORICAL_FRESH_0016_CHAIN_CLAIM_KIND,
      schemaVersion: 2,
      releaseTimingMode: input.timingMode,
      operatorConfirmationFlag:
        HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG,
      lostKeyBoundaryAccepted: true,
      legacyIntervalContinuityProven: false,
      retroactiveContinuityClaimed: false,
      policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
      database: policy.database,
      sourceFingerprint: release.source,
      workerRelease: release.workerRelease,
      claimLiveTopology: liveRuntimeState.liveTopology,
      hmacKeyId: hmac.hmacKeyId,
      predecessorPrerequisites,
    });
    input.dependencies.publishStage({
      backupDirectory: input.backupDirectory,
      runId,
      stage: "claim",
      sourceFingerprint: release.source,
      payload: asJsonObject(claim),
      now: readClock(input.clock, "claim publication"),
      owner: input.owner,
    });
    input.dependencies.afterBoundary("claim-published");
  } else {
    input.dependencies.validateRunDirectory({
      backupDirectory: input.backupDirectory,
      runId,
    });
    const classification = requireHealthyState(
      input.dependencies.classifyState({
        backupDirectory: input.backupDirectory,
        runId,
      }),
    );
    const claimStage = requiredStage(classification, "claim");
    const claim = historicalFresh0016ClaimPayloadSchema.parse(
      claimStage.value.payload,
    );
    assertClaimReleaseIdentity(claim, release);
    assertClaimTimingMode(claim, input.timingMode);
    if (
      canonicalHistoricalFresh0016Json(claim.predecessorPrerequisites) !==
        canonicalHistoricalFresh0016Json(predecessorPrerequisites)
    ) {
      throw new Error(
        "Fresh-0016 predecessor prerequisite attestations changed after the durable claim.",
      );
    }
    hmac = validateHmacKey(
      await input.dependencies.readHmacKey(claim.hmacKeyId),
      claim.hmacKeyId,
    );
  }
  const context: CoordinatorContext = { ...input, runId };
  let classification = requireHealthyState(
    input.dependencies.classifyState({
      backupDirectory: input.backupDirectory,
      runId,
    }),
  );
  const claim = historicalFresh0016ClaimPayloadSchema.parse(
    requiredStage(classification, "claim").value.payload,
  );
  assertClaimReleaseIdentity(claim, release);
  assertClaimTimingMode(claim, context.timingMode);
  if (classification.currentStage === "predecessor-authorized") {
    throw unresolvedAuthorizationError("predecessor");
  }
  if (
    classification.currentStage !== "claim" &&
    classification.currentStage !== "predecessor-prepared" &&
    classification.currentStage !== "predecessor-complete"
  ) {
    throw new Error(
      `Fresh-0016 start cannot advance from ${classification.currentStage ?? "empty"}.`,
    );
  }
  classification = acquireStateOwnershipIfRequired(context, classification);
  if (classification.currentStage === "claim") {
    assertReleaseIdentity(context, claim);
    const startedAt = readClock(input.clock, "predecessor budget start");
    assertPredecessorTiming(startedAt, input.timingMode);
    const utcDay = startedAt.toISOString().slice(0, 10);
    const usage = input.dependencies.loadDailyUsage(
      startedAt,
      input.runner,
      input.clock,
    );
    const plan = createHistoricalPre0016SnapshotPlan(release.source);
    const predecessorTopology = observeLiveTopology(
      context,
      release,
      startedAt,
    );
    const operationId = historicalFresh0016PredecessorOperationId({
      cutoverRunId: runId,
      sourceFingerprint: release.source,
      ...release.workerRelease,
      captureLiveTopology: predecessorTopology.evidence,
      hmacKeyId: hmac.hmacKeyId,
      snapshotPlanSha256: plan.planSha256,
    });
    const maximum = input.dependencies.reserveBudget({
      backupDir: input.backupDirectory,
      operationId,
      operation: HISTORICAL_FRESH_0016_PREDECESSOR_OPERATION_NAME,
      sourceFingerprint: release.source,
      candidateVersionId: release.workerRelease.targetCandidateVersionId,
      phase: "maximum",
      rowsRead:
        HISTORICAL_PRE_0016_SNAPSHOT_BILLABLE_ROWS_READ_RESERVATION,
      rowsWritten: 0,
      observedUsage: usage,
      now: startedAt,
      expectedUtcDay: utcDay,
    });
    input.dependencies.afterBoundary("predecessor-maximum-reserved");
    assertReleaseIdentity(context, claim);
    const report = input.dependencies.capturePredecessor({
      cutoverRunId: runId,
      backupDirectory: input.backupDirectory,
      sourceFingerprint: release.source,
      ...release.workerRelease,
      captureLiveTopology: predecessorTopology.evidence,
      liveDeploymentStatusOutput: predecessorTopology.statusOutput,
      hmacSecret: hmac.secret,
      usage,
      maximumReservation: maximum,
      authorizeLastPreD1: (authorization) => {
        const authorizationPayload =
          historicalFresh0016PredecessorAuthorizationPayloadSchema.parse({
            kind: HISTORICAL_FRESH_0016_PREDECESSOR_AUTHORIZATION_KIND,
            schemaVersion: 2,
            claimStageSha256: requiredStage(
              input.dependencies.classifyState({
                backupDirectory: input.backupDirectory,
                runId,
              }),
              "claim",
            ).sha256,
            operationId: authorization.operationId,
            sourceFingerprint: authorization.sourceFingerprint,
            workerRelease: authorization.workerRelease,
            captureLiveTopology: authorization.captureLiveTopology,
            hmacKeyId: authorization.hmacKeyId,
            snapshotPlanSha256: authorization.snapshotPlanSha256,
            utcDay: authorization.utcDay,
            usage,
            maximumReservation: maximum,
            d1ExecutionMayHaveStarted: true,
          });
        const stage = input.dependencies.publishStage({
          backupDirectory: input.backupDirectory,
          runId,
          stage: "predecessor-authorized",
          sourceFingerprint: release.source,
          payload: asJsonObject(authorizationPayload),
          now: readClock(input.clock, "predecessor authorization"),
          owner: input.owner,
        });
        input.dependencies.afterBoundary("predecessor-authorized-published");
        return { authorizationStageSha256: stage.sha256 };
      },
      persistPreparedCapture: (prepared) => {
        input.dependencies.publishStage({
          backupDirectory: input.backupDirectory,
          runId,
          stage: "predecessor-prepared",
          sourceFingerprint: release.source,
          payload: asJsonObject(prepared),
          now: readClock(input.clock, "predecessor prepared publication"),
          owner: input.owner,
        });
        input.dependencies.afterBoundary("predecessor-prepared-published");
      },
      observeFinalizationTopology: () =>
        observeLiveTopology(
          context,
          release,
          readClock(input.clock, "predecessor final topology"),
        ),
      forbiddenPlaintext: [],
      runner: input.runner,
      clock: input.clock,
    });
    publishPredecessorCompletion(context, release, hmac, report);
  } else if (classification.currentStage === "predecessor-prepared") {
    const prepared = parseHistoricalFresh0016PredecessorPreparedCapture(
      requiredStage(classification, "predecessor-prepared").value.payload,
      { forbiddenPlaintext: [hmac.secret] },
    );
    const finalizationTopology = observeLiveTopology(
      context,
      release,
      readClock(input.clock, "resumed predecessor final topology"),
    );
    const report = input.dependencies.finalizePredecessor({
      preparedCapture: prepared,
      sourceFingerprint: release.source,
      ...release.workerRelease,
      finalizationLiveTopology: finalizationTopology.evidence,
      liveDeploymentStatusOutput: finalizationTopology.statusOutput,
      hmacSecret: hmac.secret,
      forbiddenPlaintext: [],
      clock: input.clock,
    });
    publishPredecessorCompletion(context, release, hmac, report);
  }
  const finalState = requireHealthyState(
    input.dependencies.classifyState({
      backupDirectory: input.backupDirectory,
      runId,
    }),
  );
  if (finalState.currentStage !== "predecessor-complete") {
    throw new Error("Fresh-0016 start did not durably reach predecessor-complete.");
  }
  return sanitizedResult("start", finalState);
}

function publishPredecessorCompletion(
  context: CoordinatorContext,
  release: ReleaseIdentity,
  hmac: HistoricalDataHmacKey,
  report: HistoricalFresh0016PredecessorReport,
) {
  const preparedStage = requiredStage(
    context.dependencies.classifyState({
      backupDirectory: context.backupDirectory,
      runId: context.runId,
    }),
    "predecessor-prepared",
  );
  const artifact = writeOrReadPredecessor(context, report, hmac.secret);
  context.dependencies.afterBoundary("predecessor-report-published");
  const payload = historicalFresh0016PredecessorCompletePayloadSchema.parse({
    kind: HISTORICAL_FRESH_0016_PREDECESSOR_COMPLETE_KIND,
    schemaVersion: 1,
    preparedStageSha256: preparedStage.sha256,
    reportCanonicalValueSha256: historicalFresh0016JsonSha256(
      artifact.report,
    ),
    reportFileSha256: artifact.sha256,
  });
  context.dependencies.publishStage({
    backupDirectory: context.backupDirectory,
    runId: context.runId,
    stage: "predecessor-complete",
    sourceFingerprint: release.source,
    payload: asJsonObject(payload),
    now: readClock(context.clock, "predecessor completion publication"),
    owner: context.owner,
  });
  context.dependencies.afterBoundary("predecessor-complete-published");
}

function writeOrReadPredecessor(
  context: CoordinatorContext,
  report: HistoricalFresh0016PredecessorReport,
  secret: string,
) {
  try {
    return context.dependencies.writePredecessor(report, {
      forbiddenPlaintext: [secret],
    });
  } catch (writeError) {
    try {
      const stored = context.dependencies.readPredecessor({
        backupDirectory: context.backupDirectory,
        cutoverRunId: context.runId,
        forbiddenPlaintext: [secret],
      });
      if (
        historicalFresh0016JsonSha256(stored.report) !==
        historicalFresh0016JsonSha256(report)
      ) {
        throw new Error("Stored predecessor report conflicts with finalized evidence.");
      }
      return stored;
    } catch (readError) {
      throw new AggregateError(
        [asError(writeError), asError(readError)],
        "Fresh-0016 predecessor report publication failed closed.",
      );
    }
  }
}

async function runFinish(context: CoordinatorContext) {
  const startedAt = readClock(context.clock, "finish window");
  const release = assertReleaseIdentity(context);
  context.dependencies.validateRunDirectory({
    backupDirectory: context.backupDirectory,
    runId: context.runId,
  });
  let classification = requireHealthyState(
    context.dependencies.classifyState({
      backupDirectory: context.backupDirectory,
      runId: context.runId,
    }),
  );
  const claimStage = requiredStage(classification, "claim");
  const claim = historicalFresh0016ClaimPayloadSchema.parse(
    claimStage.value.payload,
  );
  assertClaimReleaseIdentity(claim, release);
  assertClaimTimingMode(claim, context.timingMode);
  const livePrerequisites =
    context.dependencies.readPredecessorPrerequisites({
      backupDirectory: context.backupDirectory,
      sourceFingerprint: release.source,
      ...release.workerRelease,
      predecessorStartAt: new Date(
        claimStage.value.createdAt,
      ),
      timingMode: context.timingMode,
      liveRuntimeState: claim.predecessorPrerequisites.liveRuntimeState,
    });
  if (
    canonicalHistoricalFresh0016Json(livePrerequisites) !==
      canonicalHistoricalFresh0016Json(claim.predecessorPrerequisites)
  ) {
    throw new Error(
      "Fresh-0016 topic/translation/0017 prerequisite evidence changed after the predecessor claim.",
    );
  }
  const hmac = validateHmacKey(
    await context.dependencies.readHmacKey(claim.hmacKeyId),
    claim.hmacKeyId,
  );
  const predecessorIdentity = context.dependencies.readPredecessorIdentity({
    backupDirectory: context.backupDirectory,
    cutoverRunId: context.runId,
    forbiddenPlaintext: [hmac.secret],
  });
  requiredStage(classification, "predecessor-complete");
  if (classification.currentStage === "predecessor-authorized") {
    throw unresolvedAuthorizationError("predecessor");
  }
  if (classification.currentStage === "successor-authorized") {
    throw unresolvedAuthorizationError("successor");
  }
  if (classification.currentStage === "cutover-complete") {
    return completeAndRelease(context, release, claim, hmac);
  }
  assertSuccessorTiming(startedAt, context.timingMode);
  assertCutoverUtcDay(
    predecessorIdentity.report.utcDay,
    startedAt,
    context.timingMode,
  );
  assertCutoverGap(
    new Date(claimStage.value.createdAt),
    startedAt,
    context.timingMode,
  );
  classification = acquireStateOwnershipIfRequired(context, classification);

  let exclusion: ProductionValidationExclusion | undefined;
  let releaseOnFailure = false;
  try {
    if (classification.currentStage === "predecessor-complete") {
      let preparedHandle = preparedBudgetHandleFromClassification(
        context,
        classification,
      );
      let day2Budget = day2BudgetHandleFromClassification(
        context,
        classification,
        readClock(context.clock, "Day-2 budget envelope read"),
      );
      if (!day2Budget) {
        if (preparedHandle) {
          throw new Error(
            "Prepared migration evidence predates the required aggregate Day-2 envelope; start a new cutover run after the next UTC reset.",
          );
        }
        assertReleaseIdentity(context, claim);
        const envelopeStartedAt = readClock(
          context.clock,
          "Day-2 aggregate budget admission",
        );
        assertSuccessorTiming(envelopeStartedAt, context.timingMode);
        const initialObservedUsage = context.dependencies.loadDailyUsage(
          envelopeStartedAt,
          context.runner,
          context.clock,
        );
        const predecessorComplete = requiredStage(
          classification,
          "predecessor-complete",
        );
        const envelopeTopology = observeLiveTopology(
          context,
          release,
          envelopeStartedAt,
        );
        day2Budget = context.dependencies.preauthorizeDay2Budget({
          backupDirectory: context.backupDirectory,
          cutoverRunId: context.runId,
          now: envelopeStartedAt,
          predecessorCompleteStageSha256: predecessorComplete.sha256,
          predecessorReportSha256: predecessorIdentity.sha256,
          sourceFingerprint: release.source,
          ...release.workerRelease,
          liveTopology: envelopeTopology.evidence,
          liveDeploymentStatusOutput: envelopeTopology.statusOutput,
          initialObservedUsage,
        });
        context.dependencies.afterBoundary("day2-budget-envelope-published");
        classification = requireHealthyState(
          context.dependencies.classifyState({
            backupDirectory: context.backupDirectory,
            runId: context.runId,
          }),
        );
      }
      assertDay2BudgetBindings(
        day2Budget,
        context,
        release,
        predecessorIdentity.sha256,
        classification,
        readClock(context.clock, "Day-2 aggregate budget validation"),
      );
      if (!preparedHandle) {
        assertReleaseIdentity(context, claim);
        exclusion = context.dependencies.acquireExclusion({
          candidateVersionId: release.workerRelease.targetCandidateVersionId,
          sourceFingerprintSha256: release.source.sha256,
          runner: (args) => context.runner(args),
        });
        releaseOnFailure = true;
        exclusion = context.dependencies.attestExclusion(
          exclusion,
          (args) => context.runner(args),
        );
        context.dependencies.afterBoundary("production-exclusion-attested");
        assertExactExclusionIdentity(exclusion, release, startedAt);
        assertReleaseIdentity(context, claim);
        const budgetStartedAt = readClock(
          context.clock,
          "migration budget start",
        );
        assertSuccessorTiming(budgetStartedAt, context.timingMode);
        const utcDay = day2Budget.evidence.utcDay;
        if (budgetStartedAt.toISOString().slice(0, 10) !== utcDay) {
          throw new Error(
            "Fresh-0016 Day-2 work crossed its preauthorized UTC billing day.",
          );
        }
        const usage = day2Budget.evidence.initialObservedUsage;
        const ownerSha256 =
          historicalFresh0016SuccessorProductionExclusionOwnerSha256(
            exclusion.owner,
          );
        const migrationTopology = observeLiveTopology(
          context,
          release,
          budgetStartedAt,
        );
        const operationId = historicalFresh0016MigrationOperationId({
          cutoverRunId: context.runId,
          sourceFingerprint: release.source,
          ...release.workerRelease,
          liveTopology: migrationTopology.evidence,
          productionExclusionOwnerSha256: ownerSha256,
          utcDay,
        });
        const maximum = context.dependencies.reserveBudget({
          backupDir: context.backupDirectory,
          operationId,
          operation: HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME,
          sourceFingerprint: release.source,
          candidateVersionId: release.workerRelease.targetCandidateVersionId,
          accountingParentOperationId: day2Budget.evidence.operationId,
          phase: "maximum",
          rowsRead: HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
          rowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
          observedUsage: usage,
          now: budgetStartedAt,
          expectedUtcDay: utcDay,
        });
        context.dependencies.afterBoundary("migration-maximum-reserved");
        assertReleaseIdentity(context, claim);
        context.dependencies.afterBoundary("before-migration-cardinality");
        const cardinality = context.dependencies.loadCardinalities(
          context.runner,
        );
        if (cardinality.rowsWritten !== 0) {
          throw new Error("Fresh-0016 cardinality preflight was not read-only.");
        }
        const projection = context.dependencies.projectMigration(
          cardinality.cardinalities,
          cardinality.rowsRead,
        );
        if (
          projection.rowsRead >
          HISTORICAL_FRESH_0016_DAY2_MIGRATION_PROJECTION_ROWS_READ_LIMIT
        ) {
          throw new Error(
            `Fresh-0016 migration projection exceeds its aggregate-envelope allocation: ${projection.rowsRead} > ${HISTORICAL_FRESH_0016_DAY2_MIGRATION_PROJECTION_ROWS_READ_LIMIT}.`,
          );
        }
        assertReleaseIdentity(context, claim);
        const prepared =
          historicalFresh0016MigrationBudgetPreparedSchema.parse({
            kind: "inspir-historical-data-fresh-0016-migration-budget-prepared-v2",
            schemaVersion: 2,
            createdAt: readClock(
              context.clock,
              "prepared migration-budget publication",
            ).toISOString(),
            cutoverRunId: context.runId,
            utcDay,
            operationId,
            policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
            sourceFingerprint: release.source,
            database: policy.database,
            workerRelease: release.workerRelease,
            liveTopology: migrationTopology.evidence,
            day2BudgetEnvelope: {
              operationId: day2Budget.evidence.operationId,
              fileSha256: day2Budget.sha256,
              predecessorCompleteStageSha256:
                day2Budget.evidence.predecessorCompleteStageSha256,
            },
            productionExclusion: {
              owner: exclusion.owner,
              ownerSha256,
              lockBudget: exclusion.budget,
            },
            usage,
            maximum: {
              rowsRead:
                HISTORICAL_FRESH_0016_DAY2_MIGRATION_MAXIMUM_ROWS_READ,
              rowsWritten: MAXIMUM_PROJECTED_RUNTIME_MIGRATION_WRITES,
              ledger: maximum,
            },
            cardinalities: cardinality.cardinalities,
            cardinalityQuery: {
              rowsRead: cardinality.rowsRead,
              rowsWritten: 0,
              totalAttempts: 1,
              readOnly: true,
            },
            projection,
            applyEnvelope: migrationApplyEnvelope(),
            migrationSource: migrationSourceIdentity(),
            privacy: "counts-budget-and-release-identities-only",
          });
        preparedHandle = context.dependencies.writePreparedBudget({
          backupDirectory: context.backupDirectory,
          runId: context.runId,
          evidence: prepared,
          liveDeploymentStatusOutput: migrationTopology.statusOutput,
        });
        releaseOnFailure = false;
        context.dependencies.afterBoundary(
          "migration-budget-prepared-published",
        );
      }
      assertPreparedBudgetBindings(
        preparedHandle.evidence,
        context,
        release,
        readClock(context.clock, "prepared budget validation"),
      );
      context.dependencies.afterBoundary("before-migration-exact");
      const exact = refineOrReadExactMigrationBudget(
        context,
        release,
        preparedHandle.evidence,
      );
      context.dependencies.afterBoundary("migration-exact-reserved");
      const budgetEvidence = buildMigrationBudgetEvidence(
        context,
        preparedHandle.evidence,
        exact,
      );
      const budgetEvidenceSha256 = historicalFresh0016JsonSha256(
        budgetEvidence,
      );
      const predecessorComplete = requiredStage(
        classification,
        "predecessor-complete",
      );
      const manifest = historicalFresh0016ManifestPayloadSchema.parse({
        kind: HISTORICAL_FRESH_0016_MANIFEST_KIND,
        schemaVersion: 2,
        predecessorCompleteStageSha256: predecessorComplete.sha256,
        predecessorReportSha256: predecessorIdentity.sha256,
        predecessorEvidenceChainSha256: predecessorEvidenceChainSha256(
          classification,
        ),
        predecessorHmacKeyId: predecessorIdentity.report.hmacKeyId,
        successorSnapshotPlanSha256: policy.successor.snapshotPlanSha256,
        policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
        sourceFingerprint: release.source,
        database: policy.database,
        workerRelease: release.workerRelease,
        migrationLiveTopology: preparedHandle.evidence.liveTopology,
        productionExclusion: {
          owner: preparedHandle.evidence.productionExclusion.owner,
          ownerSha256:
            preparedHandle.evidence.productionExclusion.ownerSha256,
        },
        preWriteEvidenceSha256: budgetEvidenceSha256,
        migrationBudget: {
          evidence: budgetEvidence,
          evidenceSha256: budgetEvidenceSha256,
          preparedArtifactFileSha256: preparedHandle.sha256,
        },
        migrationSource: migrationSourceIdentity(),
      });
      context.dependencies.afterBoundary("before-manifest");
      context.dependencies.publishStage({
        backupDirectory: context.backupDirectory,
        runId: context.runId,
        stage: "manifest",
        sourceFingerprint: release.source,
        payload: asJsonObject(manifest),
        now: readClock(context.clock, "manifest publication"),
        owner: context.owner,
      });
      context.dependencies.afterBoundary("manifest-published");
      classification = requireHealthyState(
        context.dependencies.classifyState({
          backupDirectory: context.backupDirectory,
          runId: context.runId,
        }),
      );
    }

    const durableDay2Budget = context.dependencies.readDay2Budget({
      backupDirectory: context.backupDirectory,
      cutoverRunId: context.runId,
      now: readClock(context.clock, "post-manifest Day-2 budget validation"),
    });
    assertDay2BudgetBindings(
      durableDay2Budget,
      context,
      release,
      predecessorIdentity.sha256,
      classification,
      readClock(context.clock, "post-manifest Day-2 envelope binding"),
    );
    const preparedBudget = context.dependencies.readPreparedBudget({
      backupDirectory: context.backupDirectory,
      runId: context.runId,
    });
    const manifestStage = requiredStage(classification, "manifest");
    const manifest = historicalFresh0016ManifestPayloadSchema.parse(
      manifestStage.value.payload,
    );
    assertManifestPreparedBudgetBindings(
      manifest,
      preparedBudget,
      context,
      release,
      readClock(context.clock, "post-manifest lock check"),
    );
    exclusion = {
      owner: parseProductionValidationLockOwner(
        preparedBudget.evidence.productionExclusion.owner,
      ),
      budget: parseProductionValidationLockBudget(
        preparedBudget.evidence.productionExclusion.lockBudget,
      ),
      serverNowMs: readClock(context.clock, "lock verification preparation")
        .getTime(),
    };
    assertReleaseIdentity(context, claim);
    exclusion = context.dependencies.verifyLock({
      owner: exclusion.owner,
      budget: exclusion.budget,
      runner: (args) => context.runner(args),
    });
    assertExactExclusionIdentity(
      exclusion,
      release,
      readClock(context.clock, "verified production exclusion"),
    );

    const predecessor = context.dependencies.readPredecessor({
      backupDirectory: context.backupDirectory,
      cutoverRunId: context.runId,
      forbiddenPlaintext: [hmac.secret],
    });
    if (
      predecessor.sha256 !== predecessorIdentity.sha256 ||
      predecessor.report.hmacKeyId !== predecessorIdentity.report.hmacKeyId
    ) {
      throw new Error(
        "Fresh-0016 predecessor evidence changed after manifest publication.",
      );
    }

    classification = await advanceMigrationAndRuntime({
      context,
      release,
      claim,
      manifest,
      manifestStage,
      predecessor,
      preparedBudgetSha256: preparedBudget.sha256,
      classification,
    });
    if (classification.currentStage === "successor-authorized") {
      throw unresolvedAuthorizationError("successor");
    }
    classification = acquireStateOwnershipIfRequired(context, classification);
    classification = advanceSuccessor({
      context,
      release,
      claim,
      hmac,
      predecessor: predecessor.report,
      manifest,
      classification,
    });
    if (classification.currentStage !== "successor-complete") {
      throw new Error(
        `Fresh-0016 finish stopped unexpectedly at ${classification.currentStage ?? "empty"}.`,
      );
    }
    const completion = context.dependencies.buildCompletionIntent({
      cwd: context.cwd,
      backupDirectory: context.backupDirectory,
      cutoverRunId: context.runId,
      completedAt: readClock(context.clock, "cutover completion"),
      forbiddenPlaintext: [hmac.secret],
    });
    const completionPayload = {
      ...completion.payload,
      canonicalArtifactSha256: completion.artifactSha256,
    };
    context.dependencies.publishStage({
      backupDirectory: context.backupDirectory,
      runId: context.runId,
      stage: "cutover-complete",
      sourceFingerprint: release.source,
      payload: asJsonObject(completionPayload),
      now: new Date(completion.payload.completedAt),
      owner: context.owner,
    });
    context.dependencies.afterBoundary("cutover-complete-published");
    const canonical = context.dependencies.publishCanonicalCompletion({
      cwd: context.cwd,
      backupDirectory: context.backupDirectory,
      cutoverRunId: context.runId,
      forbiddenPlaintext: [hmac.secret],
    });
    context.dependencies.afterBoundary("canonical-completion-published");
    context.dependencies.releaseExclusion(
      exclusion,
      (args) => context.runner(args),
    );
    context.dependencies.afterBoundary("production-exclusion-released");
    const finalState = requireHealthyState(
      context.dependencies.classifyState({
        backupDirectory: context.backupDirectory,
        runId: context.runId,
      }),
    );
    return sanitizedResult("finish", finalState, canonical.sha256);
  } catch (error) {
    if (!releaseOnFailure || !exclusion) throw error;
    try {
      context.dependencies.releaseExclusion(
        exclusion,
        (args) => context.runner(args),
      );
    } catch (releaseError) {
      throw new AggregateError(
        [asError(error), asError(releaseError)],
        "Fresh-0016 finish failed before immutable budget preparation and exact exclusion release also failed.",
      );
    }
    throw error;
  }
}

async function advanceMigrationAndRuntime(input: Readonly<{
  context: CoordinatorContext;
  release: ReleaseIdentity;
  claim: ReturnType<typeof historicalFresh0016ClaimPayloadSchema.parse>;
  manifest: ReturnType<typeof historicalFresh0016ManifestPayloadSchema.parse>;
  manifestStage: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>;
  predecessor: ReturnType<HistoricalFresh0016CoordinatorDependencies["readPredecessor"]>;
  preparedBudgetSha256: string;
  classification: HistoricalFresh0016StateClassification;
}>) {
  let classification = input.classification;
  if (
    classification.currentStage !== "manifest" &&
    classification.currentStage !== "migration-authorized" &&
    classification.currentStage !== "migration-complete"
  ) {
    return classification;
  }
  const predecessorComplete = requiredStage(
    classification,
    "predecessor-complete",
  );
  const binding = historicalFresh0016MigrationBindingSchema.parse({
    cutoverRunId: input.context.runId,
    cutoverManifestSha256: input.manifestStage.value.payloadSha256,
    migrationBudgetPreparedArtifactFileSha256:
      input.preparedBudgetSha256,
    predecessorReportSha256: input.predecessor.sha256,
    predecessorCompleteSha256: predecessorComplete.sha256,
    predecessorEvidenceChainSha256:
      input.manifest.predecessorEvidenceChainSha256,
    predecessorHmacKeyId: input.predecessor.report.hmacKeyId,
    successorSnapshotPlanSha256: policy.successor.snapshotPlanSha256,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    sourceFingerprint: input.release.source,
    database: policy.database,
  });
  const rendered = input.context.dependencies.publishRenderedMigration({
    cwd: input.context.cwd,
    backupDir: input.context.backupDirectory,
    runDirectory: input.context.dependencies.validateRunDirectory({
      backupDirectory: input.context.backupDirectory,
      runId: input.context.runId,
    }).runDirectory,
    binding,
  });
  input.context.dependencies.afterBoundary("rendered-migration-published");
  let runtimeReport: HistoricalFresh0016RuntimeVerificationReport;
  if (
    classification.currentStage === "manifest" ||
    classification.currentStage === "migration-authorized"
  ) {
    assertReleaseIdentity(input.context, input.claim);
    const outcome = input.context.dependencies.applyMigration({
      binding,
      predecessorCompleteSha256: predecessorComplete.sha256,
      preWriteEvidenceSha256: input.manifest.preWriteEvidenceSha256,
      renderedMigrationSha256:
        rendered.evidence.renderedMigration.sha256,
      productionExclusionOwnerSha256:
        input.manifest.productionExclusion.ownerSha256,
      activeWorkerVersion:
        input.release.workerRelease.targetCandidateVersionId,
      sourceFingerprint: input.release.source,
      cwd: input.context.cwd,
      backupDirectory: input.context.backupDirectory,
      runDirectory: input.context.dependencies.validateRunDirectory({
        backupDirectory: input.context.backupDirectory,
        runId: input.context.runId,
      }).runDirectory,
      runner: input.context.runner,
      explicitSameInvocationRetry: true,
      stateOwner: input.context.owner,
      clock: input.context.clock,
      ownerExitProbe: input.context.ownerExitProbe,
    });
    input.context.dependencies.afterBoundary("migration-apply-returned");
    if (
      !outcome.ok ||
      outcome.stateAdvanceRequired ||
      !outcome.runtimeVerificationReport ||
      !outcome.migrationCompleteStageSha256
    ) {
      throw new Error(
        `Fresh-0016 migration requires reviewed readback at status ${outcome.status}; no retry was authorized.`,
      );
    }
    runtimeReport = historicalFresh0016RuntimeVerificationReportSchema.parse(
      outcome.runtimeVerificationReport,
    );
    classification = requireHealthyState(
      input.context.dependencies.classifyState({
        backupDirectory: input.context.backupDirectory,
        runId: input.context.runId,
      }),
    );
  } else {
    const migrationComplete =
      historicalFresh0016MigrationCompletePayloadSchema.parse(
        requiredStage(classification, "migration-complete").value.payload,
      );
    assertReleaseIdentity(input.context, input.claim);
    runtimeReport = historicalFresh0016RuntimeVerificationReportSchema.parse(
      input.context.dependencies.verifyMigration({
      binding,
      predecessorCompleteSha256: predecessorComplete.sha256,
      preWriteEvidenceSha256: input.manifest.preWriteEvidenceSha256,
      migrationAuthorizationSha256:
        migrationComplete.verifierMigrationAuthorizationSha256,
      renderedMigrationSha256:
        rendered.evidence.renderedMigration.sha256,
      productionExclusionOwnerSha256:
        input.manifest.productionExclusion.ownerSha256,
      activeWorkerVersion:
        input.release.workerRelease.targetCandidateVersionId,
      sourceFingerprint: input.release.source,
      cwd: input.context.cwd,
      backupDir: input.context.backupDirectory,
      runDirectory: input.context.dependencies.validateRunDirectory({
        backupDirectory: input.context.backupDirectory,
        runId: input.context.runId,
      }).runDirectory,
      runner: input.context.runner,
        now: readClock(
          input.context.clock,
          "runtime migration re-verification",
        ),
      }),
    );
  }
  if (classification.currentStage !== "migration-complete") {
    throw new Error(
      `Fresh-0016 migration did not durably reach migration-complete (current ${classification.currentStage ?? "empty"}).`,
    );
  }
  const migrationCompleteStage = requiredStage(
    classification,
    "migration-complete",
  );
  const migrationComplete =
    historicalFresh0016MigrationCompletePayloadSchema.parse(
      migrationCompleteStage.value.payload,
    );
  const canonicalValueSha256 = historicalFresh0016JsonSha256(runtimeReport);
  if (
    migrationComplete.runtimeVerificationReportSha256 !==
      canonicalValueSha256
  ) {
    throw new Error(
      "Fresh-0016 runtime verification disagrees with migration-complete evidence.",
    );
  }
  const runtimePayload = historicalFresh0016RuntimeStagePayloadSchema.parse({
    kind: HISTORICAL_FRESH_0016_RUNTIME_STAGE_KIND,
    schemaVersion: 1,
    migrationCompleteStageSha256: migrationCompleteStage.sha256,
    reportCanonicalValueSha256: canonicalValueSha256,
    reportCanonicalFileSha256:
      historicalFresh0016SuccessorRuntimeVerificationReportSha256(
        runtimeReport,
      ),
    report: runtimeReport,
  });
  input.context.dependencies.publishStage({
    backupDirectory: input.context.backupDirectory,
    runId: input.context.runId,
    stage: "runtime-verification",
    sourceFingerprint: input.release.source,
    payload: asJsonObject(runtimePayload),
    now: readClock(input.context.clock, "runtime verification publication"),
    owner: input.context.owner,
  });
  input.context.dependencies.afterBoundary("runtime-verification-published");
  return requireHealthyState(
    input.context.dependencies.classifyState({
      backupDirectory: input.context.backupDirectory,
      runId: input.context.runId,
    }),
  );
}

function advanceSuccessor(input: Readonly<{
  context: CoordinatorContext;
  release: ReleaseIdentity;
  claim: ReturnType<typeof historicalFresh0016ClaimPayloadSchema.parse>;
  hmac: HistoricalDataHmacKey;
  predecessor: HistoricalFresh0016PredecessorReport;
  manifest: ReturnType<typeof historicalFresh0016ManifestPayloadSchema.parse>;
  classification: HistoricalFresh0016StateClassification;
}>) {
  let classification = input.classification;
  if (classification.currentStage === "successor-complete") {
    return classification;
  }
  if (classification.currentStage === "successor-authorized") {
    throw unresolvedAuthorizationError("successor");
  }
  if (
    classification.currentStage !== "runtime-verification" &&
    classification.currentStage !== "successor-prepared"
  ) {
    throw new Error(
      `Fresh-0016 successor cannot advance from ${classification.currentStage ?? "empty"}.`,
    );
  }
  const runtimeStage = requiredStage(classification, "runtime-verification");
  const runtime = historicalFresh0016RuntimeStagePayloadSchema.parse(
    runtimeStage.value.payload,
  );
  if (classification.currentStage === "runtime-verification") {
    assertReleaseIdentity(input.context, input.claim);
    const captureStartedAt = readClock(
      input.context.clock,
      "successor budget start",
    );
    assertSuccessorTiming(captureStartedAt, input.context.timingMode);
    const usage = input.manifest.migrationBudget.evidence.usage;
    const accountingParentOperationId =
      input.manifest.migrationBudget.evidence.day2BudgetEnvelope.operationId;
    if (
      captureStartedAt.toISOString().slice(0, 10) !==
      input.manifest.migrationBudget.evidence.utcDay
    ) {
      throw new Error(
        "Fresh-0016 successor crossed its preauthorized Day-2 UTC billing day.",
      );
    }
    const successorTopology = observeLiveTopology(
      input.context,
      input.release,
      captureStartedAt,
    );
    const operationId = historicalFresh0016SuccessorOperationId({
      cutoverRunId: input.context.runId,
      sourceFingerprint: input.release.source,
      ...input.release.workerRelease,
      captureLiveTopology: successorTopology.evidence,
      hmacKeyId: input.hmac.hmacKeyId,
      predecessorReportSha256:
        historicalFresh0016SuccessorPredecessorReportSha256(
          input.predecessor,
          { forbiddenPlaintext: [input.hmac.secret] },
        ),
      runtimeVerificationStageSha256: runtimeStage.sha256,
      runtimeVerificationReportSha256:
        historicalFresh0016SuccessorRuntimeVerificationReportSha256(
          runtime.report,
        ),
      productionExclusionOwnerSha256:
        input.manifest.productionExclusion.ownerSha256,
    });
    const maximum = input.context.dependencies.reserveBudget({
      backupDir: input.context.backupDirectory,
      operationId,
      operation: HISTORICAL_FRESH_0016_SUCCESSOR_OPERATION_NAME,
      sourceFingerprint: input.release.source,
      candidateVersionId:
        input.release.workerRelease.targetCandidateVersionId,
      accountingParentOperationId,
      phase: "maximum",
      rowsRead: HISTORICAL_DATA_BILLABLE_READ_RESERVATION_LIMIT,
      rowsWritten: 0,
      observedUsage: usage,
      now: captureStartedAt,
      expectedUtcDay: captureStartedAt.toISOString().slice(0, 10),
    });
    input.context.dependencies.afterBoundary("successor-maximum-reserved");
    assertReleaseIdentity(input.context, input.claim);
    const report = input.context.dependencies.captureSuccessor({
      cutoverRunId: input.context.runId,
      backupDirectory: input.context.backupDirectory,
      ...input.release.workerRelease,
      captureLiveTopology: successorTopology.evidence,
      liveDeploymentStatusOutput: successorTopology.statusOutput,
      hmacSecret: input.hmac.secret,
      predecessor: input.predecessor,
      runtimeVerification: runtime.report,
      runtimeVerificationStageSha256: runtimeStage.sha256,
      productionExclusionOwner: input.manifest.productionExclusion.owner,
      usage,
      maximumReservation: maximum,
      accountingParentOperationId,
      authorizeLastPreD1: (authorization) => {
        const payload =
          historicalFresh0016SuccessorAuthorizationPayloadSchema.parse({
            kind: HISTORICAL_FRESH_0016_SUCCESSOR_AUTHORIZATION_KIND,
            schemaVersion: 2,
            runtimeVerificationStageSha256: runtimeStage.sha256,
            operationId: authorization.operationId,
            accountingParentOperationId:
              authorization.accountingParentOperationId,
            authorizationContextSha256:
              historicalFresh0016JsonSha256(authorization),
            sourceFingerprint: authorization.sourceFingerprint,
            workerRelease: authorization.workerRelease,
            captureLiveTopology: authorization.captureLiveTopology,
            hmacKeyId: authorization.hmacKeyId,
            predecessorReportSha256:
              authorization.predecessorReportSha256,
            runtimeVerificationReportSha256:
              authorization.runtimeVerificationReportSha256,
            productionExclusionOwnerSha256:
              authorization.productionExclusionOwnerSha256,
            utcDay: authorization.utcDay,
            usage,
            maximumReservation: maximum,
            d1ExecutionMayHaveStarted: true,
          });
        const stage = input.context.dependencies.publishStage({
          backupDirectory: input.context.backupDirectory,
          runId: input.context.runId,
          stage: "successor-authorized",
          sourceFingerprint: input.release.source,
          payload: asJsonObject(payload),
          now: readClock(
            input.context.clock,
            "successor authorization publication",
          ),
          owner: input.context.owner,
        });
        input.context.dependencies.afterBoundary(
          "successor-authorized-published",
        );
        return { authorizationStageSha256: stage.sha256 };
      },
      persistPreparedCapture: (prepared) => {
        input.context.dependencies.publishStage({
          backupDirectory: input.context.backupDirectory,
          runId: input.context.runId,
          stage: "successor-prepared",
          sourceFingerprint: input.release.source,
          payload: asJsonObject(prepared),
          now: readClock(
            input.context.clock,
            "successor prepared publication",
          ),
          owner: input.context.owner,
        });
        input.context.dependencies.afterBoundary(
          "successor-prepared-published",
        );
      },
      observeFinalizationTopology: () =>
        observeLiveTopology(
          input.context,
          input.release,
          readClock(input.context.clock, "successor final topology"),
        ),
      forbiddenPlaintext: [],
      runner: input.context.runner,
      clock: input.context.clock,
    });
    publishSuccessorCompletion(input, report);
  } else {
    const prepared = parseHistoricalFresh0016SuccessorPreparedCapture(
      requiredStage(classification, "successor-prepared").value.payload,
      { forbiddenPlaintext: [input.hmac.secret] },
    );
    const finalizationTopology = observeLiveTopology(
      input.context,
      input.release,
      readClock(input.context.clock, "resumed successor final topology"),
    );
    const report = input.context.dependencies.finalizeSuccessor({
      preparedCapture: prepared,
      sourceFingerprint: input.release.source,
      ...input.release.workerRelease,
      finalizationLiveTopology: finalizationTopology.evidence,
      liveDeploymentStatusOutput: finalizationTopology.statusOutput,
      productionExclusionOwner: input.manifest.productionExclusion.owner,
      forbiddenPlaintext: [input.hmac.secret],
      clock: input.context.clock,
    });
    publishSuccessorCompletion(input, report);
  }
  classification = requireHealthyState(
    input.context.dependencies.classifyState({
      backupDirectory: input.context.backupDirectory,
      runId: input.context.runId,
    }),
  );
  return classification;
}

function publishSuccessorCompletion(
  input: Readonly<{
    context: CoordinatorContext;
    release: ReleaseIdentity;
    hmac: HistoricalDataHmacKey;
  }>,
  report: HistoricalFresh0016SuccessorReport,
) {
  const preparedStage = requiredStage(
    input.context.dependencies.classifyState({
      backupDirectory: input.context.backupDirectory,
      runId: input.context.runId,
    }),
    "successor-prepared",
  );
  const artifact = writeOrReadSuccessor(input.context, report, input.hmac.secret);
  input.context.dependencies.afterBoundary("successor-report-published");
  const payload = historicalFresh0016SuccessorCompletePayloadSchema.parse({
    kind: HISTORICAL_FRESH_0016_SUCCESSOR_COMPLETE_KIND,
    schemaVersion: 1,
    preparedStageSha256: preparedStage.sha256,
    reportCanonicalValueSha256: historicalFresh0016JsonSha256(
      artifact.report,
    ),
    reportFileSha256: artifact.sha256,
  });
  input.context.dependencies.publishStage({
    backupDirectory: input.context.backupDirectory,
    runId: input.context.runId,
    stage: "successor-complete",
    sourceFingerprint: input.release.source,
    payload: asJsonObject(payload),
    now: readClock(input.context.clock, "successor completion publication"),
    owner: input.context.owner,
  });
  input.context.dependencies.afterBoundary("successor-complete-published");
}

function writeOrReadSuccessor(
  context: CoordinatorContext,
  report: HistoricalFresh0016SuccessorReport,
  secret: string,
) {
  try {
    return context.dependencies.writeSuccessor(report, {
      forbiddenPlaintext: [secret],
    });
  } catch (writeError) {
    try {
      const stored = context.dependencies.readSuccessor({
        backupDirectory: context.backupDirectory,
        cutoverRunId: context.runId,
        forbiddenPlaintext: [secret],
      });
      if (
        historicalFresh0016JsonSha256(stored.report) !==
        historicalFresh0016JsonSha256(report)
      ) {
        throw new Error("Stored successor report conflicts with finalized evidence.");
      }
      return stored;
    } catch (readError) {
      throw new AggregateError(
        [asError(writeError), asError(readError)],
        "Fresh-0016 successor report publication failed closed.",
      );
    }
  }
}

function preparedBudgetHandleFromClassification(
  context: CoordinatorContext,
  classification: HistoricalFresh0016StateClassification,
) {
  const exists = classification.auxiliaryFiles.some(
    (file) =>
      file.name ===
      HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES
        .migrationBudgetPrepared,
  );
  return exists
    ? context.dependencies.readPreparedBudget({
        backupDirectory: context.backupDirectory,
        runId: context.runId,
      })
    : undefined;
}

function day2BudgetHandleFromClassification(
  context: CoordinatorContext,
  classification: HistoricalFresh0016StateClassification,
  now: Date,
) {
  const exists = classification.auxiliaryFiles.some(
    (file) =>
      file.name ===
      HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.day2BudgetEnvelope,
  );
  return exists
    ? context.dependencies.readDay2Budget({
        backupDirectory: context.backupDirectory,
        cutoverRunId: context.runId,
        now,
      })
    : undefined;
}

function assertDay2BudgetBindings(
  envelope: HistoricalFresh0016Day2BudgetEnvelopeHandle,
  context: CoordinatorContext,
  release: ReleaseIdentity,
  predecessorReportSha256: string,
  classification: HistoricalFresh0016StateClassification,
  now: Date,
) {
  const predecessorComplete = requiredStage(
    classification,
    "predecessor-complete",
  );
  const evidence = envelope.evidence;
  if (
    evidence.cutoverRunId !== context.runId ||
    evidence.predecessorCompleteStageSha256 !== predecessorComplete.sha256 ||
    evidence.predecessorReportSha256 !== predecessorReportSha256 ||
    !sameSource(evidence.sourceFingerprint, release.source) ||
    canonicalHistoricalFresh0016Json(evidence.workerRelease) !==
      canonicalHistoricalFresh0016Json(release.workerRelease) ||
    evidence.utcDay !== now.toISOString().slice(0, 10) ||
    evidence.maximum.ledger.reservation.operationId !== evidence.operationId
  ) {
    throw new Error(
      "Fresh-0016 Day-2 envelope lost its exact run, predecessor, source, Worker, day, or ledger binding.",
    );
  }
}

function refineOrReadExactMigrationBudget(
  context: CoordinatorContext,
  release: ReleaseIdentity,
  prepared: HistoricalFresh0016MigrationBudgetPrepared,
) {
  const exactRowsRead = safeAdd(
    prepared.projection.rowsRead,
    prepared.applyEnvelope.projectedRowsRead,
    "fresh-0016 exact migration reads",
  );
  const common = {
    ledgerPath: prepared.maximum.ledger.ledgerPath,
    utcDay: prepared.utcDay,
    operationId: prepared.operationId,
    sourceFingerprint: release.source,
    candidateVersionId: release.workerRelease.targetCandidateVersionId,
    accountingParentOperationId: prepared.day2BudgetEnvelope.operationId,
    now: readClock(context.clock, "migration ledger resume"),
  } as const;
  try {
    return context.dependencies.assertBudget({
      ...common,
      phase: "exact",
      rowsRead: exactRowsRead,
      rowsWritten: prepared.projection.rowsWritten,
    });
  } catch (exactError) {
    let liveMaximum: D1ReleaseBudgetReservationResult;
    try {
      liveMaximum = context.dependencies.assertBudget({
        ...common,
        phase: "maximum",
        rowsRead: prepared.maximum.rowsRead,
        rowsWritten: prepared.maximum.rowsWritten,
      });
    } catch (maximumError) {
      throw new AggregateError(
        [asError(exactError), asError(maximumError)],
        "Prepared migration budget no longer matches a live maximum or exact ledger phase.",
      );
    }
    assertSameLedgerSnapshot(liveMaximum, prepared.maximum.ledger);
    return context.dependencies.reserveBudget({
      backupDir: context.backupDirectory,
      operationId: prepared.operationId,
      operation: HISTORICAL_FRESH_0016_MIGRATION_OPERATION_NAME,
      sourceFingerprint: release.source,
      candidateVersionId: release.workerRelease.targetCandidateVersionId,
      accountingParentOperationId: prepared.day2BudgetEnvelope.operationId,
      phase: "exact",
      rowsRead: exactRowsRead,
      rowsWritten: prepared.projection.rowsWritten,
      observedUsage: prepared.usage,
      now: readClock(context.clock, "migration exact reservation"),
      expectedUtcDay: prepared.utcDay,
    });
  }
}

function buildMigrationBudgetEvidence(
  context: CoordinatorContext,
  prepared: HistoricalFresh0016MigrationBudgetPrepared,
  exact: D1ReleaseBudgetReservationResult,
) {
  assertExactMigrationLedgerTransition(prepared, exact);
  return historicalFresh0016MigrationBudgetEvidenceSchema.parse({
    kind: HISTORICAL_FRESH_0016_MIGRATION_BUDGET_KIND,
    schemaVersion: 2,
    createdAt: readClock(
      context.clock,
      "migration budget evidence",
    ).toISOString(),
    cutoverRunId: prepared.cutoverRunId,
    utcDay: prepared.utcDay,
    operationId: prepared.operationId,
    policySha256: HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
    sourceFingerprint: prepared.sourceFingerprint,
    database: prepared.database,
    workerRelease: prepared.workerRelease,
    liveTopology: prepared.liveTopology,
    day2BudgetEnvelope: prepared.day2BudgetEnvelope,
    productionExclusionOwnerSha256:
      prepared.productionExclusion.ownerSha256,
    usage: prepared.usage,
    cardinalities: prepared.cardinalities,
    cardinalityQuery: prepared.cardinalityQuery,
    projection: prepared.projection,
    applyEnvelope: prepared.applyEnvelope,
    maximum: prepared.maximum,
    exact: {
      rowsRead: safeAdd(
        prepared.projection.rowsRead,
        prepared.applyEnvelope.projectedRowsRead,
        "fresh-0016 exact evidence reads",
      ),
      rowsWritten: prepared.projection.rowsWritten,
      ledger: exact,
    },
    migrationSource: prepared.migrationSource,
  });
}

function assertExactMigrationLedgerTransition(
  prepared: HistoricalFresh0016MigrationBudgetPrepared,
  exact: D1ReleaseBudgetReservationResult,
) {
  const maximum = prepared.maximum.ledger;
  const exactRowsRead = safeAdd(
    prepared.projection.rowsRead,
    prepared.applyEnvelope.projectedRowsRead,
    "fresh-0016 exact transition reads",
  );
  const releasedRowsRead = prepared.maximum.rowsRead - exactRowsRead;
  const releasedRowsWritten =
    prepared.maximum.rowsWritten - prepared.projection.rowsWritten;
  if (
    releasedRowsRead < 0 ||
    releasedRowsWritten < 0 ||
    maximum.ledgerPath !== exact.ledgerPath ||
    maximum.utcDay !== exact.utcDay ||
    maximum.reservation.operationId !== exact.reservation.operationId ||
    maximum.reservation.operation !== exact.reservation.operation ||
    maximum.reservation.candidateVersionId !==
      exact.reservation.candidateVersionId ||
    maximum.reservation.phase !== "maximum" ||
    exact.reservation.phase !== "exact" ||
    exact.reservation.rowsRead !== exactRowsRead ||
    exact.reservation.rowsWritten !== prepared.projection.rowsWritten ||
    exact.reservation.maximumRowsRead !== prepared.maximum.rowsRead ||
    exact.reservation.maximumRowsWritten !== prepared.maximum.rowsWritten ||
    maximum.reservation.createdAt !== exact.reservation.createdAt ||
    Date.parse(maximum.reservation.updatedAt) >
      Date.parse(exact.reservation.updatedAt) ||
    exact.revision <= maximum.revision ||
    maximum.totals.rowsRead !== exact.totals.rowsRead ||
    maximum.totals.rowsWritten !== exact.totals.rowsWritten ||
    maximum.accountedUsage.rowsRead !== exact.accountedUsage.rowsRead ||
    maximum.accountedUsage.rowsWritten !== exact.accountedUsage.rowsWritten
  ) {
    throw new Error(
      "Migration exact ledger is not the immutable prepared maximum's one-way refinement.",
    );
  }
}

function assertPreparedBudgetBindings(
  prepared: HistoricalFresh0016MigrationBudgetPrepared,
  context: CoordinatorContext,
  release: ReleaseIdentity,
  now: Date,
) {
  const day2Budget = context.dependencies.readDay2Budget({
    backupDirectory: context.backupDirectory,
    cutoverRunId: context.runId,
    now,
  });
  const owner = parseProductionValidationLockOwner(
    prepared.productionExclusion.owner,
  );
  const ownerSha256 = sha256(canonicalProductionValidationLockOwner(owner));
  const expectedOperationId = historicalFresh0016MigrationOperationId({
    cutoverRunId: context.runId,
    sourceFingerprint: release.source,
    ...release.workerRelease,
    liveTopology: prepared.liveTopology,
    productionExclusionOwnerSha256: ownerSha256,
    utcDay: prepared.utcDay,
  });
  if (
    prepared.cutoverRunId !== context.runId ||
    !sameSource(prepared.sourceFingerprint, release.source) ||
    canonicalHistoricalFresh0016Json(prepared.workerRelease) !==
      canonicalHistoricalFresh0016Json(release.workerRelease) ||
    prepared.policySha256 !== HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256 ||
    prepared.day2BudgetEnvelope.operationId !==
      day2Budget.evidence.operationId ||
    prepared.day2BudgetEnvelope.fileSha256 !== day2Budget.sha256 ||
    prepared.day2BudgetEnvelope.predecessorCompleteStageSha256 !==
      day2Budget.evidence.predecessorCompleteStageSha256 ||
    canonicalHistoricalFresh0016Json(prepared.usage) !==
      canonicalHistoricalFresh0016Json(
        day2Budget.evidence.initialObservedUsage,
      ) ||
    canonicalHistoricalFresh0016Json(prepared.database) !==
      canonicalHistoricalFresh0016Json(policy.database) ||
    prepared.operationId !== expectedOperationId ||
    prepared.productionExclusion.ownerSha256 !== ownerSha256 ||
    owner.candidateVersionId !==
      release.workerRelease.targetCandidateVersionId ||
    owner.sourceFingerprintSha256 !== release.source.sha256 ||
    owner.leaseExpiresAt <= now.getTime() ||
    prepared.utcDay !== now.toISOString().slice(0, 10) ||
    canonicalHistoricalFresh0016Json(prepared.migrationSource) !==
      canonicalHistoricalFresh0016Json(migrationSourceIdentity())
  ) {
    throw new Error(
      "Prepared migration-budget evidence lost its exact run, source, Worker, day, migration, or production-exclusion binding.",
    );
  }
  parseProductionValidationLockBudget(
    prepared.productionExclusion.lockBudget,
  );
}

function assertManifestPreparedBudgetBindings(
  manifest: ReturnType<typeof historicalFresh0016ManifestPayloadSchema.parse>,
  prepared: ReturnType<HistoricalFresh0016CoordinatorDependencies["readPreparedBudget"]>,
  context: CoordinatorContext,
  release: ReleaseIdentity,
  now: Date,
) {
  assertPreparedBudgetBindings(prepared.evidence, context, release, now);
  if (
    manifest.migrationBudget.preparedArtifactFileSha256 !== prepared.sha256 ||
    canonicalHistoricalFresh0016Json(
      manifest.migrationBudget.evidence.day2BudgetEnvelope,
    ) !==
      canonicalHistoricalFresh0016Json(
        prepared.evidence.day2BudgetEnvelope,
      ) ||
    manifest.productionExclusion.ownerSha256 !==
      prepared.evidence.productionExclusion.ownerSha256 ||
    canonicalHistoricalFresh0016Json(manifest.productionExclusion.owner) !==
      canonicalHistoricalFresh0016Json(
        prepared.evidence.productionExclusion.owner,
      ) ||
    !sameSource(manifest.sourceFingerprint, prepared.evidence.sourceFingerprint) ||
    canonicalHistoricalFresh0016Json(manifest.workerRelease) !==
      canonicalHistoricalFresh0016Json(prepared.evidence.workerRelease) ||
    canonicalHistoricalFresh0016Json(manifest.migrationLiveTopology) !==
      canonicalHistoricalFresh0016Json(prepared.evidence.liveTopology) ||
    canonicalHistoricalFresh0016Json(manifest.database) !==
      canonicalHistoricalFresh0016Json(prepared.evidence.database) ||
    canonicalHistoricalFresh0016Json(manifest.migrationSource) !==
      canonicalHistoricalFresh0016Json(prepared.evidence.migrationSource)
  ) {
    throw new Error(
      "Manifest does not cross-bind the exact immutable prepared migration budget.",
    );
  }
}

function assertSameLedgerSnapshot(
  live: D1ReleaseBudgetReservationResult,
  prepared: D1ReleaseBudgetReservationResult,
) {
  const normalize = (value: D1ReleaseBudgetReservationResult) => ({
    ledgerPath: value.ledgerPath,
    utcDay: value.utcDay,
    revision: value.revision,
    reservation: value.reservation,
    totals: value.totals,
    accountedUsage: value.accountedUsage,
  });
  if (
    canonicalHistoricalFresh0016Json(normalize(live)) !==
    canonicalHistoricalFresh0016Json(normalize(prepared))
  ) {
    throw new Error(
      "Live maximum migration ledger changed after immutable budget preparation.",
    );
  }
}

function predecessorEvidenceChainSha256(
  classification: HistoricalFresh0016StateClassification,
) {
  return historicalFresh0016JsonSha256({
    claim: requiredStage(classification, "claim").sha256,
    predecessorAuthorized: requiredStage(
      classification,
      "predecessor-authorized",
    ).sha256,
    predecessorPrepared: requiredStage(
      classification,
      "predecessor-prepared",
    ).sha256,
    predecessorComplete: requiredStage(
      classification,
      "predecessor-complete",
    ).sha256,
  });
}

function migrationApplyEnvelope() {
  return {
    projectedRowsRead:
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
        .projectedRowsRead,
    maximumReadOnlyCalls:
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
        .readOnlyCalls,
    maximumWriteCapableCalls:
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
        .writeCapableCalls,
    maximumTotalRunnerCalls:
      HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET.maximumSameInvocation
        .totalRunnerCalls,
  } as const;
}

function migrationSourceIdentity() {
  return {
    file: policy.migration0016.trackedFile,
    bytes: HISTORICAL_FRESH_0016_MIGRATION_SOURCE_BYTES,
    sha256: HISTORICAL_FRESH_0016_MIGRATION_SOURCE_SHA256,
  } as const;
}

function completeAndRelease(
  context: CoordinatorContext,
  release: ReleaseIdentity,
  claim: ReturnType<typeof historicalFresh0016ClaimPayloadSchema.parse>,
  hmac: HistoricalDataHmacKey,
) {
  assertReleaseIdentity(context, claim);
  const prepared = context.dependencies.readPreparedBudget({
    backupDirectory: context.backupDirectory,
    runId: context.runId,
  });
  const canonical = context.dependencies.publishCanonicalCompletion({
    cwd: context.cwd,
    backupDirectory: context.backupDirectory,
    cutoverRunId: context.runId,
    forbiddenPlaintext: [hmac.secret],
  });
  context.dependencies.afterBoundary("canonical-completion-published");
  const exclusion: ProductionValidationExclusion = {
    owner: parseProductionValidationLockOwner(
      prepared.evidence.productionExclusion.owner,
    ),
    budget: parseProductionValidationLockBudget(
      prepared.evidence.productionExclusion.lockBudget,
    ),
    serverNowMs: Date.now(),
  };
  assertExactExclusionIdentity(exclusion, release, undefined, true);
  context.dependencies.releaseExclusion(
    exclusion,
    (args) => context.runner(args),
  );
  context.dependencies.afterBoundary("production-exclusion-released");
  const classification = requireHealthyState(
    context.dependencies.classifyState({
      backupDirectory: context.backupDirectory,
      runId: context.runId,
    }),
  );
  return sanitizedResult("finish", classification, canonical.sha256);
}

type UploadedInactiveWorkerRelease = Readonly<{
  phase: "uploaded-inactive";
  targetCandidateVersionId: string;
  serviceBaselineVersionId: string;
  uploadEvidenceSha256: string;
}>;

type ReleaseIdentity = Readonly<{
  source: HistoricalFresh0016SourceFingerprint;
  workerRelease: UploadedInactiveWorkerRelease;
  uploadCreatedAt: string;
}>;

function assertReleaseIdentity(
  input: Pick<
    CoordinatorContext,
    "cwd" | "backupDirectory" | "dependencies"
  >,
  claim?: ReturnType<typeof historicalFresh0016ClaimPayloadSchema.parse>,
): ReleaseIdentity {
  input.dependencies.assertGitIdentity({ cwd: input.cwd });
  const source = compactSource(
    input.dependencies.buildSourceFingerprint(input.cwd),
  );
  const upload = input.dependencies.readCandidateUploadEvidence(
    input.backupDirectory,
  );
  if (
    upload.value.artifacts.sourceFingerprintSha256 !== source.sha256 ||
    upload.value.artifacts.sourceFingerprintFileCount !== source.fileCount ||
    upload.value.soleBaselineTopology.serviceBaselineVersionId !==
      upload.value.serviceBaselineVersionId ||
    upload.value.soleBaselineTopology.percentage !== 100 ||
    upload.value.soleBaselineTopology.observedVersions !== 1
  ) {
    throw new Error(
      "Fresh-0016 source does not match the canonical inactive Worker upload and sole serving baseline.",
    );
  }
  const release: ReleaseIdentity = {
    source,
    workerRelease: {
      phase: "uploaded-inactive",
      targetCandidateVersionId: upload.value.targetCandidateVersionId,
      serviceBaselineVersionId: upload.value.serviceBaselineVersionId,
      uploadEvidenceSha256: upload.sha256,
    },
    uploadCreatedAt: upload.value.createdAt,
  };
  if (claim) assertClaimReleaseIdentity(claim, release);
  return release;
}

function observeLiveTopology(
  input: Pick<CoordinatorContext, "runner" | "dependencies">,
  release: ReleaseIdentity,
  observedAt: Date,
) {
  const observation = input.dependencies.observeLiveTopology({
    runner: input.runner,
    observedAt,
    workerRelease: release.workerRelease,
  });
  const evidence = assertHistoricalFresh0016LiveTopologyEvidence({
    evidence: observation.evidence,
    boundaryAt: observedAt,
    statusOutput: observation.statusOutput,
    ...release.workerRelease,
  });
  if (Date.parse(evidence.observedAt) < Date.parse(release.uploadCreatedAt)) {
    throw new Error(
      "Fresh-0016 live topology cannot predate the canonical candidate upload.",
    );
  }
  return Object.freeze({
    evidence,
    statusOutput: observation.statusOutput,
  });
}

function assertClaimReleaseIdentity(
  claim: ReturnType<typeof historicalFresh0016ClaimPayloadSchema.parse>,
  release: ReleaseIdentity,
) {
  if (
    !sameSource(claim.sourceFingerprint, release.source) ||
    canonicalHistoricalFresh0016Json(claim.workerRelease) !==
      canonicalHistoricalFresh0016Json(release.workerRelease) ||
    canonicalHistoricalFresh0016Json(claim.database) !==
      canonicalHistoricalFresh0016Json(policy.database) ||
    claim.policySha256 !== HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256 ||
    !sameSource(
      claim.predecessorPrerequisites.sourceFingerprint,
      release.source,
    ) ||
    canonicalHistoricalFresh0016Json(
      claim.predecessorPrerequisites.workerRelease,
    ) !== canonicalHistoricalFresh0016Json(release.workerRelease) ||
    claim.lostKeyBoundaryAccepted !== true ||
    claim.legacyIntervalContinuityProven !== false ||
    claim.retroactiveContinuityClaimed !== false
  ) {
    throw new Error(
      "Fresh-0016 release source or sole 100%-traffic Worker changed from its claim.",
    );
  }
}

function assertExactExclusionIdentity(
  exclusion: ProductionValidationExclusion,
  release: ReleaseIdentity,
  now?: Date,
  allowExpired = false,
) {
  const owner = parseProductionValidationLockOwner(exclusion.owner);
  parseProductionValidationLockBudget(exclusion.budget);
  if (
    owner.candidateVersionId !==
      release.workerRelease.targetCandidateVersionId ||
    owner.sourceFingerprintSha256 !== release.source.sha256 ||
    (!allowExpired && now && owner.leaseExpiresAt <= now.getTime())
  ) {
    throw new Error(
      "Production exclusion does not bind the exact source, Worker, and live lease.",
    );
  }
}

function acquireStateOwnershipIfRequired(
  context: CoordinatorContext,
  classification: HistoricalFresh0016StateClassification,
) {
  const healthy = requireHealthyState(classification);
  if (
    healthy.currentStage === null ||
    healthy.currentStage === "cutover-complete" ||
    healthy.currentStage === "predecessor-authorized" ||
    healthy.currentStage === "migration-authorized" ||
    healthy.currentStage === "successor-authorized"
  ) {
    return healthy;
  }
  const controllingOwner = currentControllingOwner(healthy);
  if (!controllingOwner || sameOwner(controllingOwner, context.owner)) {
    return healthy;
  }
  context.dependencies.acquireResumeLease({
    backupDirectory: context.backupDirectory,
    runId: context.runId,
    now: readClock(context.clock, "resume lease"),
    owner: context.owner,
    ownerExitProbe: context.ownerExitProbe,
  });
  return requireHealthyState(
    context.dependencies.classifyState({
      backupDirectory: context.backupDirectory,
      runId: context.runId,
    }),
  );
}

function currentControllingOwner(
  classification: HistoricalFresh0016StateClassification,
) {
  if (!classification.currentStage) return undefined;
  const resolution = classification.readbackResolutions
    .filter((entry) => entry.value.stage === classification.currentStage)
    .at(-1);
  const lease = classification.resumeLeases
    .filter((entry) => entry.value.stage === classification.currentStage)
    .at(-1);
  return resolution?.value.owner ??
    lease?.value.owner ??
    classification.stages.at(-1)?.value.owner;
}

function requireHealthyState(
  classification: HistoricalFresh0016StateClassification,
) {
  if (
    classification.status === "broken" ||
    classification.status === "conflict" ||
    classification.status === "empty" ||
    classification.issues.length > 0
  ) {
    throw new Error(
      `Fresh-0016 state is ${classification.status} (${classification.issues
        .map((issue) => issue.code)
        .join(",") || "no durable claim"}).`,
    );
  }
  return classification;
}

function requiredStage(
  classification: HistoricalFresh0016StateClassification,
  stage: HistoricalFresh0016StateStageEnvelope["stage"],
) {
  const handle = classification.stages.find(
    (candidate) => candidate.value.stage === stage,
  );
  if (!handle) {
    throw new Error(`Fresh-0016 state is missing required ${stage} stage.`);
  }
  return handle;
}

function assertMutationConfirmation(
  options: HistoricalFresh0016CutoverOptions,
) {
  if (
    options.productionConfirmation !== PRODUCTION_CONFIRMATION_FLAG ||
    options.lostKeyBoundaryConfirmation !==
      HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG
  ) {
    throw new Error(
      `Fresh-0016 mutation requires exact ${PRODUCTION_CONFIRMATION_FLAG} and ${HISTORICAL_FRESH_0016_CUTOVER_CONFIRMATION_FLAG} confirmations.`,
    );
  }
  if (
    options.paidExpeditedConfirmation !== undefined &&
    options.paidExpeditedConfirmation !==
      HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG
  ) {
    throw new Error(
      `Fresh-0016 paid-expedited timing requires exact ${HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG} confirmation.`,
    );
  }
}

function cutoverTimingMode(
  options: Pick<HistoricalFresh0016CutoverOptions, "paidExpeditedConfirmation">,
): HistoricalFresh0016CutoverTimingMode {
  if (
    options.paidExpeditedConfirmation ===
    HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG
  ) {
    return HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE;
  }
  if (options.paidExpeditedConfirmation !== undefined) {
    throw new Error(
      `Fresh-0016 paid-expedited timing requires exact ${HISTORICAL_FRESH_0016_PAID_EXPEDITED_CUTOVER_CONFIRMATION_FLAG} confirmation.`,
    );
  }
  return HISTORICAL_FRESH_0016_WORKERS_FREE_UTC_RESET_TIMING_MODE;
}

function assertClaimTimingMode(
  claim: ReturnType<typeof historicalFresh0016ClaimPayloadSchema.parse>,
  expected: HistoricalFresh0016CutoverTimingMode,
) {
  const actual =
    claim.releaseTimingMode ??
    HISTORICAL_FRESH_0016_WORKERS_FREE_UTC_RESET_TIMING_MODE;
  if (actual !== expected) {
    throw new Error(
      "Fresh-0016 release timing mode changed after the durable claim.",
    );
  }
}

function assertPredecessorTiming(
  now: Date,
  timingMode: HistoricalFresh0016CutoverTimingMode,
) {
  if (timingMode === HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE) {
    return;
  }
  assertPreResetWindow(now);
}

function assertSuccessorTiming(
  now: Date,
  timingMode: HistoricalFresh0016CutoverTimingMode,
) {
  if (timingMode === HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE) {
    return;
  }
  assertPostResetWindow(now);
}

function assertCutoverUtcDay(
  predecessorUtcDay: string,
  finishAt: Date,
  timingMode: HistoricalFresh0016CutoverTimingMode,
) {
  if (timingMode !== HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE) {
    assertExactNextUtcDay(predecessorUtcDay, finishAt);
    return;
  }
  const predecessorDayStart = Date.parse(
    `${predecessorUtcDay}T00:00:00.000Z`,
  );
  const finishDayStart = Date.UTC(
    finishAt.getUTCFullYear(),
    finishAt.getUTCMonth(),
    finishAt.getUTCDate(),
  );
  const dayDelta = finishDayStart - predecessorDayStart;
  if (
    !Number.isFinite(predecessorDayStart) ||
    new Date(predecessorDayStart).toISOString().slice(0, 10) !==
      predecessorUtcDay ||
    (dayDelta !== 0 && dayDelta !== 24 * 60 * 60 * 1_000)
  ) {
    throw new Error(
      "Fresh-0016 paid-expedited finish must occur on the predecessor UTC day or the exact next UTC day.",
    );
  }
}

function assertCutoverGap(
  predecessorClaimCreatedAt: Date,
  finishAt: Date,
  timingMode: HistoricalFresh0016CutoverTimingMode,
) {
  if (timingMode !== HISTORICAL_FRESH_0016_PAID_EXPEDITED_TIMING_MODE) {
    return;
  }
  const gapMs = finishAt.getTime() - predecessorClaimCreatedAt.getTime();
  if (
    !Number.isFinite(predecessorClaimCreatedAt.getTime()) ||
    gapMs <= 0 ||
    gapMs > HISTORICAL_FRESH_0016_CUTOVER_MAXIMUM_GAP_MS
  ) {
    throw new Error(
      "Fresh-0016 paid-expedited finish exceeded the maximum predecessor-to-successor evidence gap.",
    );
  }
}

function assertPreResetWindow(now: Date) {
  const elapsed = utcDayElapsed(now);
  if (elapsed < 24 * 60 * 60 * 1_000 - HISTORICAL_FRESH_0016_CUTOVER_PRE_RESET_WINDOW_MS) {
    throw new Error(
      "Fresh-0016 start is allowed only in the final 30 minutes of a UTC billing day.",
    );
  }
}

function assertPostResetWindow(now: Date) {
  const elapsed = utcDayElapsed(now);
  if (elapsed > HISTORICAL_FRESH_0016_CUTOVER_POST_RESET_WINDOW_MS) {
    throw new Error(
      "Fresh-0016 finish is allowed only in the first 30 minutes of the next UTC billing day.",
    );
  }
}

function assertExactNextUtcDay(predecessorUtcDay: string, finishAt: Date) {
  const predecessorDayStart = Date.parse(
    `${predecessorUtcDay}T00:00:00.000Z`,
  );
  const finishDayStart = Date.UTC(
    finishAt.getUTCFullYear(),
    finishAt.getUTCMonth(),
    finishAt.getUTCDate(),
  );
  if (
    !Number.isFinite(predecessorDayStart) ||
    new Date(predecessorDayStart).toISOString().slice(0, 10) !==
      predecessorUtcDay ||
    finishDayStart - predecessorDayStart !== 24 * 60 * 60 * 1_000
  ) {
    throw new Error(
      "Fresh-0016 finish must occur on the exact next UTC day after the predecessor capture.",
    );
  }
}

function utcDayElapsed(now: Date) {
  return now.getTime() - Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
}

function readClock(clock: () => Date, label: string) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Fresh-0016 ${label} returned an invalid clock value.`);
  }
  return new Date(value.getTime());
}

function validateHmacKey(
  value: HistoricalDataHmacKey,
  expectedHmacKeyId?: string,
) {
  const actual = historicalDataHmacKeyId(value.secret);
  if (
    value.hmacKeyId !== actual ||
    (expectedHmacKeyId !== undefined && actual !== expectedHmacKeyId)
  ) {
    throw new Error("Historical-data HMAC Keychain readback identity changed.");
  }
  return value;
}

function unresolvedAuthorizationError(
  phase: "predecessor" | "successor",
) {
  return new Error(
    `Fresh-0016 ${phase} authorization is unresolved. Automatic D1 retry and coordinator readback resolution are forbidden; retain evidence for reviewed recovery.`,
  );
}

function sanitizedResult(
  mode: HistoricalFresh0016CutoverMode,
  classification: HistoricalFresh0016StateClassification,
  canonicalArtifactSha256?: string,
): HistoricalFresh0016CutoverResult {
  return Object.freeze({
    mode,
    runId: classification.runId,
    status: classification.status,
    currentStage: classification.currentStage,
    nextStage: classification.nextStage,
    d1ExecutionMayHaveStarted: classification.d1ExecutionMayHaveStarted,
    automaticRetryAllowed: classification.automaticRetryAllowed,
    resumeLeaseAllowed: classification.resumeLeaseAllowed,
    readbackResolutionAllowed: classification.readbackResolutionAllowed,
    issueCodes: Object.freeze(
      classification.issues.map((issue) => issue.code),
    ),
    ...(canonicalArtifactSha256 ? { canonicalArtifactSha256 } : {}),
    privacy: "state-summary-only-no-secrets",
  });
}

function compactSource(
  source: SourceFingerprint,
): HistoricalFresh0016SourceFingerprint {
  return { sha256: source.sha256, fileCount: source.fileCount };
}

function sameSource(
  left: HistoricalFresh0016SourceFingerprint,
  right: HistoricalFresh0016SourceFingerprint,
) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function sameOwner(
  left: HistoricalFresh0016Owner,
  right: HistoricalFresh0016Owner,
) {
  return left.hostname === right.hostname && left.pid === right.pid;
}

function asJsonObject(value: unknown): HistoricalFresh0016JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalHistoricalFresh0016Json(value));
  } catch {
    throw new Error("Fresh-0016 stage payload is not canonical JSON.");
  }
  if (!isJsonObject(parsed)) {
    throw new Error("Fresh-0016 stage payload must be a plain JSON object.");
  }
  return parsed;
}

function isJsonObject(value: unknown): value is HistoricalFresh0016JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(
  value: unknown,
): value is HistoricalFresh0016JsonObject[string] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function safeAdd(left: number, right: number, label: string) {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`Fresh-0016 ${label} exceeded safe integer bounds.`);
  }
  return result;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error("Unknown fresh-0016 failure.");
}
