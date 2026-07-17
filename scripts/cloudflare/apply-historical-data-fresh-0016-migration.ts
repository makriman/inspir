import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  HISTORICAL_FRESH_0016_CUTOVER_POLICY,
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256,
} from "./historical-data-fresh-0016-cutover-policy";
import {
  canonicalHistoricalFresh0016DatabaseMarkerValue,
  createHistoricalFresh0016DatabaseMarker,
  HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
  historicalFresh0016MigrationBindingSchema,
  readHistoricalFresh0016RenderedMigration,
  type HistoricalFresh0016MigrationBinding,
} from "./historical-data-fresh-0016-migration";
import {
  acquireHistoricalFresh0016ReadbackResolution,
  canonicalHistoricalFresh0016Json,
  classifyHistoricalFresh0016State,
  HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES,
  historicalFresh0016JsonSha256,
  publishHistoricalFresh0016StateStage,
  validateHistoricalFresh0016RunDirectory,
  type HistoricalFresh0016Owner,
  HistoricalFresh0016StateError,
  type HistoricalFresh0016StateFileHandle,
  type HistoricalFresh0016StateStageEnvelope,
} from "./historical-data-fresh-0016-state";
import {
  D1_DATABASE_NAME,
  type WranglerRunner,
} from "./migration-config";
import {
  D1_RUNTIME_0016_ABSENT_CHECK_IDS,
  D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS,
  D1_RUNTIME_PRE_0016_STATE_MAX_ROWS_READ,
  D1_RUNTIME_PRE_0016_STATE_SQL,
} from "./d1-runtime-pre-0016-state";
import { createHistoricalDataWranglerRunner } from "./historical-data-wrangler-runner";
import { buildRepoSourceFingerprint } from "./source-fingerprint";
import {
  RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE,
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS,
  verifyD1RuntimeMigrations,
} from "./verify-d1-runtime-migrations";
import {
  HISTORICAL_FRESH_0016_POST_VERIFICATION_MAX_ROWS_READ,
  historicalFresh0016RuntimeVerificationReportSchema,
  verifyHistoricalDataFresh0016Migration,
} from "./verify-historical-data-fresh-0016-migration";

export const HISTORICAL_FRESH_0016_APPLY_AUTHORIZATION_KIND =
  "inspir-historical-data-fresh-0016-migration-authorization-v1" as const;
export const HISTORICAL_FRESH_0016_APPLY_COMPLETE_KIND =
  "inspir-historical-data-fresh-0016-migration-complete-v1" as const;
export const HISTORICAL_FRESH_0016_APPLY_OUTCOME_KIND =
  "inspir-historical-data-fresh-0016-migration-apply-outcome-v1" as const;
export const HISTORICAL_FRESH_0016_APPLY_READBACK_RESOLUTION_KIND =
  "inspir-historical-data-fresh-0016-apply-readback-resolution-v1" as const;
export const HISTORICAL_FRESH_0016_APPLY_STATE_MAX_ROWS_READ =
  D1_RUNTIME_PRE_0016_STATE_MAX_ROWS_READ;
export const HISTORICAL_FRESH_0016_APPLY_GENERIC_STATIC_ROWS_READ_PROJECTION =
  5_000 as const;
const HISTORICAL_FRESH_0016_APPLY_MAX_AUTOMATIC_READ_ATTEMPTS =
  3 as const;
// Coordinator reservation contract. The maximum path is:
// prestate + attempt 1/readback + explicitly authorized retry/readback +
// final exact verifier. Later-invocation recovery is read-only.
export const HISTORICAL_FRESH_0016_APPLY_CALL_BUDGET = Object.freeze({
  prestate: Object.freeze({
    staticReadOnlyCalls: 1,
    boundedProbeReadOnlyCalls: 1,
  }),
  perAttempt: Object.freeze({
    writeCapableCalls: 1,
    staticReadbackCalls: 1,
    boundedProbeReadbackCalls: 1,
  }),
  maximumSameInvocationAttempts: 2,
  finalExactVerification: Object.freeze({
    staticReadOnlyCalls: 1,
    boundedPostReadOnlyCalls: 1,
  }),
  maximumSameInvocation: Object.freeze({
    readOnlyCalls: 8,
    writeCapableCalls: 2,
    totalRunnerCalls: 10,
    projectedRowsRead:
      4 * HISTORICAL_FRESH_0016_APPLY_GENERIC_STATIC_ROWS_READ_PROJECTION +
      3 * HISTORICAL_FRESH_0016_APPLY_STATE_MAX_ROWS_READ +
      HISTORICAL_FRESH_0016_POST_VERIFICATION_MAX_ROWS_READ,
    billableRowsRead:
      HISTORICAL_FRESH_0016_APPLY_MAX_AUTOMATIC_READ_ATTEMPTS *
      (4 * HISTORICAL_FRESH_0016_APPLY_GENERIC_STATIC_ROWS_READ_PROJECTION +
        3 * HISTORICAL_FRESH_0016_APPLY_STATE_MAX_ROWS_READ +
        HISTORICAL_FRESH_0016_POST_VERIFICATION_MAX_ROWS_READ),
  }),
  laterInvocation: Object.freeze({
    exactAbsentReadOnlyCalls: 2,
    exactCommittedReadOnlyCalls: 4,
    writeCapableCalls: 0,
  }),
});

export const HISTORICAL_FRESH_0016_APPLY_STATE_SQL =
  D1_RUNTIME_PRE_0016_STATE_SQL;

const requiredPre0016AppliedCheckIds = D1_RUNTIME_PRE_0016_APPLIED_CHECK_IDS;
const required0016AbsentCheckIds = D1_RUNTIME_0016_ABSENT_CHECK_IDS;

const sha256Pattern = /^[a-f0-9]{64}$/;
const workerVersionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha256Schema = z.string().regex(sha256Pattern);
const positiveSafeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
  "Expected a positive safe integer.",
);
const nonNegativeSafeIntegerSchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value >= 0,
  "Expected a non-negative safe integer.",
);
const canonicalTimestampSchema = z.string().refine(
  (value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
  },
  "Expected a canonical ISO timestamp.",
);
const sourceFingerprintSchema = z
  .object({
    sha256: sha256Schema,
    fileCount: positiveSafeIntegerSchema,
  })
  .strict();
const ownerSchema = z
  .object({
    hostname: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
    pid: positiveSafeIntegerSchema,
  })
  .strict();

const preStateProofSchema = z
  .object({
    classification: z.literal("exact-pre-0016"),
    staticRowsRead: nonNegativeSafeIntegerSchema,
    probeRowsRead: nonNegativeSafeIntegerSchema.refine(
      (value) => value <= HISTORICAL_FRESH_0016_APPLY_STATE_MAX_ROWS_READ,
      "Pre-0016 probe exceeded its fixed read bound.",
    ),
    staticTotalAttempts: z.literal(1),
    probeTotalAttempts: z.literal(1),
    appliedCheckCount: z.literal(requiredPre0016AppliedCheckIds.length),
    absentCheckCount: z.literal(required0016AbsentCheckIds.length),
    schemaObjectsAbsent: z.literal(true),
    fixedMarkerAbsent: z.literal(true),
    freshMarkerAbsent: z.literal(true),
  })
  .strict();

export const historicalFresh0016ApplyAuthorizationPayloadSchema = z
  .object({
    kind: z.literal(HISTORICAL_FRESH_0016_APPLY_AUTHORIZATION_KIND),
    schemaVersion: z.literal(1),
    binding: historicalFresh0016MigrationBindingSchema,
    manifestStageSha256: sha256Schema,
    predecessorCompleteStageSha256: sha256Schema,
    predecessorReportSha256: sha256Schema,
    preWriteEvidenceSha256: sha256Schema,
    renderedMigrationSha256: sha256Schema,
    productionExclusionOwnerSha256: sha256Schema,
    activeWorkerVersion: z.string().regex(workerVersionPattern),
    sourceFingerprint: sourceFingerprintSchema,
    preState: preStateProofSchema,
    attemptPlan: z
      .object({
        maximumAttempts: z.union([z.literal(1), z.literal(2)]),
        explicitSameInvocationRetryAuthorized: z.boolean(),
        retryPolicy: z.literal(
          "one-same-live-invocation-retry-after-exact-absence",
        ),
        laterInvocationPolicy: z.literal("readback-only-no-retry"),
      })
      .strict()
      .superRefine((plan, context) => {
        if (
          (plan.explicitSameInvocationRetryAuthorized &&
            plan.maximumAttempts !== 2) ||
          (!plan.explicitSameInvocationRetryAuthorized &&
            plan.maximumAttempts !== 1)
        ) {
          context.addIssue({
            code: "custom",
            message: "The migration attempt plan is internally inconsistent.",
          });
        }
      }),
    d1ExecutionMayHaveStarted: z.literal(true),
  })
  .strict();

const attemptSchema = z
  .object({
    attempt: z.union([z.literal(1), z.literal(2)]),
    startedAt: canonicalTimestampSchema,
    completedAt: canonicalTimestampSchema,
    responseConfirmed: z.boolean(),
    runnerOutcome: z.enum([
      "confirmed-success",
      "unconfirmed-response",
      "runner-failed",
    ]),
    readback: z.enum(["verified-committed", "verified-absent"]),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)) {
      context.addIssue({
        code: "custom",
        message: "The migration attempt completion predates its start.",
      });
    }
    if (
      attempt.responseConfirmed &&
      attempt.runnerOutcome !== "confirmed-success"
    ) {
      context.addIssue({
        code: "custom",
        message: "A confirmed response has an inconsistent runner outcome.",
      });
    }
    if (
      !attempt.responseConfirmed &&
      attempt.runnerOutcome === "confirmed-success"
    ) {
      context.addIssue({
        code: "custom",
        message: "An unconfirmed response has an inconsistent runner outcome.",
      });
    }
  });

const applyCompletePayloadSchema = z
  .object({
    kind: z.literal(HISTORICAL_FRESH_0016_APPLY_COMPLETE_KIND),
    schemaVersion: z.literal(1),
    bindingSha256: sha256Schema,
    migrationAuthorizedStageSha256: sha256Schema,
    verifierMigrationAuthorizationSha256: sha256Schema,
    runtimeVerificationReportSha256: sha256Schema,
    renderedMigrationSha256: sha256Schema,
    readbackResolutionSha256: sha256Schema.nullable(),
    status: z.enum([
      "verified",
      "verified-after-ambiguous-response",
      "verified-after-explicit-retry",
      "verified-after-unresolved-authorization",
    ]),
    attempts: z.array(attemptSchema).max(2),
    d1ExecutionVerified: z.literal(true),
  })
  .strict();

const applyReadbackResolutionEvidenceSchema = z
  .object({
    kind: z.literal(HISTORICAL_FRESH_0016_APPLY_READBACK_RESOLUTION_KIND),
    schemaVersion: z.literal(1),
    authorizationStageSha256: sha256Schema,
    bindingSha256: sha256Schema,
    runtimeVerificationReportSha256: sha256Schema,
    databaseState: z.literal("verified-committed"),
    staticRowsRead: nonNegativeSafeIntegerSchema,
    probeRowsRead: nonNegativeSafeIntegerSchema.refine(
      (value) => value <= HISTORICAL_FRESH_0016_APPLY_STATE_MAX_ROWS_READ,
      "Readback-resolution probe exceeded its fixed read bound.",
    ),
    staticTotalAttempts: z.literal(1),
    probeTotalAttempts: z.literal(1),
    readbackOnly: z.literal(true),
    d1RetryAuthorized: z.literal(false),
  })
  .strict();

export const historicalFresh0016ApplyOutcomeSchema = z
  .object({
    kind: z.literal(HISTORICAL_FRESH_0016_APPLY_OUTCOME_KIND),
    schemaVersion: z.literal(1),
    createdAt: canonicalTimestampSchema,
    completedAt: canonicalTimestampSchema,
    ok: z.boolean(),
    status: z.enum([
      "verified",
      "verified-after-ambiguous-response",
      "verified-after-explicit-retry",
      "verified-after-unresolved-authorization",
      "verified-absent",
      "verified-absent-readback-review-required",
      "verified-readback-state-advance-required",
    ]),
    binding: historicalFresh0016MigrationBindingSchema,
    sourceFingerprint: sourceFingerprintSchema,
    predecessorCompleteSha256: sha256Schema,
    preWriteEvidenceSha256: sha256Schema,
    renderedMigrationSha256: sha256Schema,
    productionExclusionOwnerSha256: sha256Schema,
    activeWorkerVersion: z.string().regex(workerVersionPattern),
    migrationAuthorizedStageSha256: sha256Schema,
    migrationCompleteStageSha256: sha256Schema.nullable(),
    readbackResolutionSha256: sha256Schema.nullable(),
    runtimeVerificationReportSha256: sha256Schema.nullable(),
    runtimeVerificationReport:
      historicalFresh0016RuntimeVerificationReportSchema.nullable(),
    attempts: z.array(attemptSchema).max(2),
    lastDatabaseState: z.enum(["verified-committed", "verified-absent"]),
    retry: z
      .object({
        explicitSameInvocationAuthorized: z.boolean(),
        maximumAttempts: z.union([z.literal(1), z.literal(2)]),
        attemptsUsed: z.union([z.literal(0), z.literal(1), z.literal(2)]),
        retryConsumed: z.boolean(),
        furtherRetryAllowed: z.literal(false),
        laterInvocationPolicy: z.literal("readback-only-no-retry"),
      })
      .strict(),
    stateAdvanceRequired: z.boolean(),
  })
  .strict()
  .superRefine((outcome, context) => {
    const success = outcome.status === "verified" ||
      outcome.status === "verified-after-ambiguous-response" ||
      outcome.status === "verified-after-explicit-retry" ||
      outcome.status === "verified-after-unresolved-authorization";
    if (outcome.ok !== success) {
      context.addIssue({
        code: "custom",
        message: "The apply outcome success status is inconsistent.",
      });
    }
    if (
      outcome.retry.attemptsUsed !== outcome.attempts.length ||
      outcome.retry.retryConsumed !== (outcome.attempts.length === 2)
    ) {
      context.addIssue({
        code: "custom",
        message: "The apply outcome attempt accounting is inconsistent.",
      });
    }
    if (
      success &&
      (outcome.migrationCompleteStageSha256 === null ||
        outcome.runtimeVerificationReportSha256 === null ||
        outcome.runtimeVerificationReport === null ||
        outcome.lastDatabaseState !== "verified-committed" ||
        outcome.stateAdvanceRequired)
    ) {
      context.addIssue({
        code: "custom",
        message: "A successful apply outcome lacks its immutable completion proof.",
      });
    }
    if (
      outcome.status === "verified-readback-state-advance-required" &&
      (!outcome.stateAdvanceRequired ||
        outcome.runtimeVerificationReport === null ||
        outcome.lastDatabaseState !== "verified-committed")
    ) {
      context.addIssue({
        code: "custom",
        message: "The readback-only outcome is internally inconsistent.",
      });
    }
    if (
      (outcome.status === "verified-absent" ||
        outcome.status === "verified-absent-readback-review-required") &&
      (outcome.lastDatabaseState !== "verified-absent" ||
        outcome.runtimeVerificationReport !== null ||
        outcome.migrationCompleteStageSha256 !== null ||
        !outcome.stateAdvanceRequired)
    ) {
      context.addIssue({
        code: "custom",
        message: "The verified-absent outcome is internally inconsistent.",
      });
    }
    if (
      outcome.status === "verified-after-unresolved-authorization" &&
      outcome.readbackResolutionSha256 === null
    ) {
      context.addIssue({
        code: "custom",
        message: "Recovered completion lacks its ownership-transfer proof.",
      });
    }
    if (
      outcome.status !== "verified-after-unresolved-authorization" &&
      outcome.readbackResolutionSha256 !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "A non-recovery outcome unexpectedly contains transfer proof.",
      });
    }
  });

export type HistoricalFresh0016ApplyAuthorizationPayload = z.infer<
  typeof historicalFresh0016ApplyAuthorizationPayloadSchema
>;
export type HistoricalFresh0016ApplyOutcome = z.infer<
  typeof historicalFresh0016ApplyOutcomeSchema
>;

export type ApplyHistoricalFresh0016MigrationOptions = Readonly<{
  binding: unknown;
  predecessorCompleteSha256: string;
  preWriteEvidenceSha256: string;
  renderedMigrationSha256: string;
  productionExclusionOwnerSha256: string;
  activeWorkerVersion: string;
  sourceFingerprint: {
    sha256: string;
    fileCount: number;
  };
  cwd: string;
  backupDirectory: string;
  runDirectory: string;
  runner: WranglerRunner;
  explicitSameInvocationRetry?: boolean;
  stateOwner?: HistoricalFresh0016Owner;
  clock?: () => Date;
  ownerExitProbe?: (owner: HistoricalFresh0016Owner) => boolean;
}>;

export type HistoricalFresh0016ApplyErrorCode =
  | "INPUT_INVALID"
  | "STATE_INVALID"
  | "PRESTATE_INVALID"
  | "ALREADY_APPLIED_FORBIDDEN"
  | "D1_STATE_INDETERMINATE"
  | "TERMINAL_PARTIAL_STATE"
  | "VERIFICATION_FAILED";

export class HistoricalFresh0016ApplyError extends Error {
  readonly code: HistoricalFresh0016ApplyErrorCode;

  constructor(code: HistoricalFresh0016ApplyErrorCode, message: string) {
    super(message);
    this.name = "HistoricalFresh0016ApplyError";
    this.code = code;
  }
}

type DatabaseStateClassification =
  | "exact-pre-0016"
  | "committed-candidate"
  | "partial-or-wrong";

type DatabaseStateProof = Readonly<{
  classification: DatabaseStateClassification;
  staticRowsRead: number;
  probeRowsRead: number;
  staticTotalAttempts: 1;
  probeTotalAttempts: 1;
}>;

type ApplyAttempt = z.infer<typeof attemptSchema>;

export function applyHistoricalDataFresh0016Migration(
  options: ApplyHistoricalFresh0016MigrationOptions,
): HistoricalFresh0016ApplyOutcome {
  const startedAt = clockDate(options.clock);
  const input = parseApplyInput(options);
  const binding = input.binding;
  const owner = input.stateOwner;
  const paths = validateHistoricalFresh0016RunDirectory({
    backupDirectory: input.backupDirectory,
    runId: binding.cutoverRunId,
  });
  if (paths.runDirectory !== input.runDirectory) {
    throw applyError(
      "STATE_INVALID",
      "The supplied run directory does not match the exact state-chain run.",
    );
  }

  const sourceBefore = currentSource(input.cwd);
  assertExactSource(sourceBefore, input.sourceFingerprint, binding);
  const rendered = readHistoricalFresh0016RenderedMigration({
    cwd: input.cwd,
    backupDir: input.backupDirectory,
    runDirectory: input.runDirectory,
    binding,
  });
  if (
    rendered.evidence.renderedMigration.sha256 !==
      input.renderedMigrationSha256
  ) {
    throw applyError(
      "INPUT_INVALID",
      "The rendered migration artifact does not match its exact apply binding.",
    );
  }

  const classification = classifyHistoricalFresh0016State({
    backupDirectory: input.backupDirectory,
    runId: binding.cutoverRunId,
  });
  assertStateChainBindings(classification, input);
  const currentStage = classification.stages.at(-1);
  if (!currentStage) {
    throw applyError("STATE_INVALID", "The fresh-0016 state chain is empty.");
  }

  if (currentStage.value.stage === "migration-authorized") {
    return recoverUnresolvedAuthorization({
      input,
      authorization: currentStage,
      startedAt,
    });
  }
  if (
    currentStage.value.stage !== "manifest" ||
    classification.status !== "in-progress" ||
    classification.nextStage !== "migration-authorized"
  ) {
    throw applyError(
      "STATE_INVALID",
      "Fresh-0016 apply requires the exact manifest tail and refuses already-completed or out-of-order state.",
    );
  }
  const controllingOwner = currentControllingOwner(
    classification,
    currentStage.value.stage,
  );
  if (!controllingOwner || !sameOwner(controllingOwner, owner)) {
    throw applyError(
      "STATE_INVALID",
      "The fresh-0016 apply process does not own the manifest state.",
    );
  }

  const preState = readExactDatabaseState(input, clockDate(options.clock));
  if (preState.classification === "committed-candidate") {
    throw applyError(
      "ALREADY_APPLIED_FORBIDDEN",
      "Fresh-0016 apply rejects every generic already-applied admission path.",
    );
  }
  if (preState.classification !== "exact-pre-0016") {
    throw applyError(
      "PRESTATE_INVALID",
      "D1 is not in the exact 0013-0015-applied, 0016-absent state.",
    );
  }
  assertExactSource(currentSource(input.cwd), input.sourceFingerprint, binding);
  const authorizationPayload = createAuthorizationPayload({
    input,
    manifestStageSha256: currentStage.sha256,
    preState,
  });
  const authorization = publishHistoricalFresh0016StateStage({
    backupDirectory: input.backupDirectory,
    runId: binding.cutoverRunId,
    stage: "migration-authorized",
    sourceFingerprint: input.sourceFingerprint,
    payload: authorizationPayload,
    now: clockDate(options.clock),
    owner,
  });
  assertExactSource(currentSource(input.cwd), input.sourceFingerprint, binding);

  return executeAuthorizedAttempts({
    input,
    authorization,
    authorizationPayload,
    startedAt,
  });
}

function executeAuthorizedAttempts(input: {
  input: ParsedApplyInput;
  authorization: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>;
  authorizationPayload: HistoricalFresh0016ApplyAuthorizationPayload;
  startedAt: Date;
}): HistoricalFresh0016ApplyOutcome {
  const attempts: ApplyAttempt[] = [];
  const maximumAttempts = input.authorizationPayload.attemptPlan.maximumAttempts;
  for (let attemptNumber = 1; attemptNumber <= maximumAttempts; attemptNumber += 1) {
    const attemptStartedAt = clockDate(input.input.clock);
    let runnerOutput: string | null = null;
    let runnerFailed = false;
    try {
      runnerOutput = runWithExactSource(input.input, [
        "d1",
        "execute",
        D1_DATABASE_NAME,
        "--remote",
        "--file",
        path.join(
          input.input.runDirectory,
          HISTORICAL_FRESH_0016_RENDERED_MIGRATION_FILE_NAME,
        ),
        "--yes",
        "--json",
      ]);
    } catch {
      runnerFailed = true;
    }
    assertExactSource(
      currentSource(input.input.cwd),
      input.input.sourceFingerprint,
      input.input.binding,
    );
    const responseConfirmed = runnerOutput !== null &&
      isConfirmedFileExecutionResponse(runnerOutput);
    const runnerOutcome = runnerFailed
      ? "runner-failed"
      : responseConfirmed
        ? "confirmed-success"
        : "unconfirmed-response";
    const state = readExactDatabaseState(
      input.input,
      clockDate(input.input.clock),
    );
    assertExactSource(
      currentSource(input.input.cwd),
      input.input.sourceFingerprint,
      input.input.binding,
    );
    if (state.classification === "partial-or-wrong") {
      throw applyError(
        "TERMINAL_PARTIAL_STATE",
        "Fresh-0016 execution left a partial schema or wrong marker and is terminal for automatic action.",
      );
    }
    const readback = state.classification === "committed-candidate"
      ? "verified-committed"
      : "verified-absent";
    const completedAt = clockDate(input.input.clock);
    const attempt = parseSchema(attemptSchema, {
      attempt: attemptNumber,
      startedAt: attemptStartedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      responseConfirmed,
      runnerOutcome,
      readback,
    }, "fresh-0016 migration attempt");
    attempts.push(attempt);

    if (readback === "verified-committed") {
      const status = attemptNumber === 2
        ? "verified-after-explicit-retry"
        : responseConfirmed
          ? "verified"
          : "verified-after-ambiguous-response";
      return verifyAndComplete({
        input: input.input,
        authorization: input.authorization,
        authorizationPayload: input.authorizationPayload,
        attempts,
        status,
        startedAt: input.startedAt,
      });
    }
    if (attemptNumber < maximumAttempts) continue;
    return buildOutcome({
      input: input.input,
      authorization: input.authorization,
      authorizationPayload: input.authorizationPayload,
      attempts,
      status: "verified-absent",
      startedAt: input.startedAt,
      completedAt,
      migrationCompleteStageSha256: null,
      readbackResolutionSha256: null,
      runtimeVerificationReport: null,
      runtimeVerificationReportSha256: null,
      lastDatabaseState: "verified-absent",
      stateAdvanceRequired: true,
    });
  }
  throw applyError(
    "D1_STATE_INDETERMINATE",
    "Fresh-0016 attempt planning reached an impossible state.",
  );
}

function recoverUnresolvedAuthorization(input: {
  input: ParsedApplyInput;
  authorization: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>;
  startedAt: Date;
}): HistoricalFresh0016ApplyOutcome {
  const payload = parseSchema(
    historicalFresh0016ApplyAuthorizationPayloadSchema,
    input.authorization.value.payload,
    "stored fresh-0016 migration authorization",
  );
  assertAuthorizationMatchesInput(payload, input.input);
  const state = readExactDatabaseState(
    input.input,
    clockDate(input.input.clock),
  );
  assertExactSource(
    currentSource(input.input.cwd),
    input.input.sourceFingerprint,
    input.input.binding,
  );
  if (state.classification === "partial-or-wrong") {
    throw applyError(
      "TERMINAL_PARTIAL_STATE",
      "The unresolved fresh-0016 authorization has a partial schema or wrong marker.",
    );
  }
  if (state.classification === "exact-pre-0016") {
    return buildOutcome({
      input: input.input,
      authorization: input.authorization,
      authorizationPayload: payload,
      attempts: [],
      status: "verified-absent-readback-review-required",
      startedAt: input.startedAt,
      completedAt: clockDate(input.input.clock),
      migrationCompleteStageSha256: null,
      readbackResolutionSha256: null,
      runtimeVerificationReport: null,
      runtimeVerificationReportSha256: null,
      lastDatabaseState: "verified-absent",
      stateAdvanceRequired: true,
    });
  }
  const report = exactFreshVerification(input.input, input.authorization.sha256);
  const reportSha256 = historicalFresh0016JsonSha256(report);
  const evidence = parseSchema(applyReadbackResolutionEvidenceSchema, {
    kind: HISTORICAL_FRESH_0016_APPLY_READBACK_RESOLUTION_KIND,
    schemaVersion: 1,
    authorizationStageSha256: input.authorization.sha256,
    bindingSha256: historicalFresh0016JsonSha256(input.input.binding),
    runtimeVerificationReportSha256: reportSha256,
    databaseState: "verified-committed",
    staticRowsRead: state.staticRowsRead,
    probeRowsRead: state.probeRowsRead,
    staticTotalAttempts: 1,
    probeTotalAttempts: 1,
    readbackOnly: true,
    d1RetryAuthorized: false,
  }, "fresh-0016 apply readback-resolution evidence");
  let resolution;
  try {
    resolution = acquireHistoricalFresh0016ReadbackResolution({
      backupDirectory: input.input.backupDirectory,
      runId: input.input.binding.cutoverRunId,
      evidence,
      now: clockDate(input.input.clock),
      owner: input.input.stateOwner,
      ownerExitProbe: input.input.ownerExitProbe,
    });
  } catch (error) {
    if (
      !(error instanceof HistoricalFresh0016StateError) ||
      (error.code !== "STATE_OWNER_ACTIVE" &&
        error.code !== "STATE_RESUME_FORBIDDEN")
    ) {
      throw applyError(
        "STATE_INVALID",
        "The exact committed readback could not acquire a safe append-only resolution transfer.",
      );
    }
    return buildOutcome({
      input: input.input,
      authorization: input.authorization,
      authorizationPayload: payload,
      attempts: [],
      status: "verified-readback-state-advance-required",
      startedAt: input.startedAt,
      completedAt: clockDate(input.input.clock),
      migrationCompleteStageSha256: null,
      readbackResolutionSha256: null,
      runtimeVerificationReport: report,
      runtimeVerificationReportSha256: reportSha256,
      lastDatabaseState: "verified-committed",
      stateAdvanceRequired: true,
    });
  }
  if (
    resolution.value.stageSha256 !== input.authorization.sha256 ||
    resolution.value.evidenceSha256 !== historicalFresh0016JsonSha256(evidence) ||
    canonicalHistoricalFresh0016Json(resolution.value.evidence) !==
      canonicalHistoricalFresh0016Json(evidence) ||
    resolution.value.readbackOnly !== true ||
    resolution.value.d1RetryAuthorized !== false ||
    !sameOwner(resolution.value.owner, input.input.stateOwner) ||
    sameOwner(resolution.value.previousOwner, input.input.stateOwner)
  ) {
    throw applyError(
      "STATE_INVALID",
      "The readback-resolution transfer does not bind the exact authorization and verification evidence.",
    );
  }
  return publishVerifiedCompletion({
    input: input.input,
    authorization: input.authorization,
    authorizationPayload: payload,
    attempts: [],
    status: "verified-after-unresolved-authorization",
    startedAt: input.startedAt,
    report,
    readbackResolutionSha256: resolution.sha256,
  });
}

function verifyAndComplete(input: {
  input: ParsedApplyInput;
  authorization: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>;
  authorizationPayload: HistoricalFresh0016ApplyAuthorizationPayload;
  attempts: ApplyAttempt[];
  status:
    | "verified"
    | "verified-after-ambiguous-response"
    | "verified-after-explicit-retry";
  startedAt: Date;
}) {
  const report = exactFreshVerification(
    input.input,
    input.authorization.sha256,
  );
  return publishVerifiedCompletion({
    ...input,
    report,
    readbackResolutionSha256: null,
  });
}

function publishVerifiedCompletion(input: {
  input: ParsedApplyInput;
  authorization: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>;
  authorizationPayload: HistoricalFresh0016ApplyAuthorizationPayload;
  attempts: ApplyAttempt[];
  status:
    | "verified"
    | "verified-after-ambiguous-response"
    | "verified-after-explicit-retry"
    | "verified-after-unresolved-authorization";
  startedAt: Date;
  report: z.infer<typeof historicalFresh0016RuntimeVerificationReportSchema>;
  readbackResolutionSha256: string | null;
}) {
  const reportSha256 = historicalFresh0016JsonSha256(input.report);
  const completePayload = parseSchema(applyCompletePayloadSchema, {
    kind: HISTORICAL_FRESH_0016_APPLY_COMPLETE_KIND,
    schemaVersion: 1,
    bindingSha256: historicalFresh0016JsonSha256(input.input.binding),
    migrationAuthorizedStageSha256: input.authorization.sha256,
    verifierMigrationAuthorizationSha256: input.authorization.sha256,
    runtimeVerificationReportSha256: reportSha256,
    renderedMigrationSha256: input.input.renderedMigrationSha256,
    readbackResolutionSha256: input.readbackResolutionSha256,
    status: input.status,
    attempts: input.attempts,
    d1ExecutionVerified: true,
  }, "fresh-0016 migration-complete payload");
  assertExactSource(
    currentSource(input.input.cwd),
    input.input.sourceFingerprint,
    input.input.binding,
  );
  const complete = publishHistoricalFresh0016StateStage({
    backupDirectory: input.input.backupDirectory,
    runId: input.input.binding.cutoverRunId,
    stage: "migration-complete",
    sourceFingerprint: input.input.sourceFingerprint,
    payload: completePayload,
    now: clockDate(input.input.clock),
    owner: input.input.stateOwner,
  });
  return buildOutcome({
    input: input.input,
    authorization: input.authorization,
    authorizationPayload: input.authorizationPayload,
    attempts: input.attempts,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: clockDate(input.input.clock),
    migrationCompleteStageSha256: complete.sha256,
    readbackResolutionSha256: input.readbackResolutionSha256,
    runtimeVerificationReport: input.report,
    runtimeVerificationReportSha256: reportSha256,
    lastDatabaseState: "verified-committed",
    stateAdvanceRequired: false,
  });
}

function exactFreshVerification(
  input: ParsedApplyInput,
  migrationAuthorizedSha256: string,
) {
  try {
    const report = verifyHistoricalDataFresh0016Migration({
      binding: input.binding,
      predecessorCompleteSha256: input.predecessorCompleteSha256,
      preWriteEvidenceSha256: input.preWriteEvidenceSha256,
      migrationAuthorizationSha256: migrationAuthorizedSha256,
      renderedMigrationSha256: input.renderedMigrationSha256,
      productionExclusionOwnerSha256:
        input.productionExclusionOwnerSha256,
      activeWorkerVersion: input.activeWorkerVersion,
      sourceFingerprint: input.sourceFingerprint,
      cwd: input.cwd,
      backupDir: input.backupDirectory,
      runDirectory: input.runDirectory,
      runner: (args, runnerOptions) =>
        runWithExactSource(input, args, runnerOptions),
      now: clockDate(input.clock),
    });
    assertExactSource(
      currentSource(input.cwd),
      input.sourceFingerprint,
      input.binding,
    );
    return parseSchema(
      historicalFresh0016RuntimeVerificationReportSchema,
      report,
      "fresh-0016 exact runtime verification report",
    );
  } catch (error) {
    if (
      error instanceof HistoricalFresh0016ApplyError &&
      error.code === "INPUT_INVALID"
    ) {
      throw error;
    }
    throw applyError(
      "VERIFICATION_FAILED",
      "The provisional fresh-0016 execution did not pass exact runtime readback.",
    );
  }
}

function readExactDatabaseState(
  input: ParsedApplyInput,
  now: Date,
): DatabaseStateProof {
  let staticReport;
  let probe;
  try {
    const strictRunner: WranglerRunner = (args, runnerOptions) => {
      const output = runWithExactSource(input, args, runnerOptions);
      assertSuccessfulReadOnlyResult(output, "runtime migration state query");
      return output;
    };
    staticReport = verifyD1RuntimeMigrations({
      backupDir: input.backupDirectory,
      cwd: input.cwd,
      nowMs: now.getTime(),
      runner: strictRunner,
    });
    const probeOutput = runWithExactSource(input, [
      "d1",
      "execute",
      D1_DATABASE_NAME,
      "--remote",
      "--json",
      "--command",
      HISTORICAL_FRESH_0016_APPLY_STATE_SQL,
    ]);
    probe = parseApplyStateProbe(probeOutput);
  } catch (error) {
    if (
      error instanceof HistoricalFresh0016ApplyError &&
      error.code === "INPUT_INVALID"
    ) {
      throw error;
    }
    throw applyError(
      "D1_STATE_INDETERMINATE",
      "The exact read-only fresh-0016 database state could not be determined.",
    );
  }
  assertStaticReportMetadata(staticReport, input.sourceFingerprint);
  const checkStates = new Map(
    staticReport.checks.map((check) => [check.id, check.ok]),
  );
  const priorApplied = requiredPre0016AppliedCheckIds.every(
    (id) => checkStates.get(id) === true,
  );
  const migrationAbsent = required0016AbsentCheckIds.every(
    (id) => checkStates.get(id) === false,
  );
  const allApplied = RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.every(
    (id) => checkStates.get(id) === true,
  );
  let classification: DatabaseStateClassification = "partial-or-wrong";
  if (priorApplied && migrationAbsent && isExactAbsentProbe(probe)) {
    classification = "exact-pre-0016";
  } else if (
    allApplied &&
    isExactCommittedProbe(probe, input.binding)
  ) {
    classification = "committed-candidate";
  }
  return Object.freeze({
    classification,
    staticRowsRead: staticReport.rowsRead,
    probeRowsRead: probe.rowsRead,
    staticTotalAttempts: 1,
    probeTotalAttempts: 1,
  });
}

function parseApplyStateProbe(output: string) {
  const result = assertSuccessfulReadOnlyResult(
    output,
    "fresh-0016 apply state probe",
  );
  const rowsRead = requiredNonNegativeInteger(
    result.meta.rows_read,
    "fresh-0016 apply probe rows read",
  );
  if (rowsRead > HISTORICAL_FRESH_0016_APPLY_STATE_MAX_ROWS_READ) {
    throw applyError(
      "D1_STATE_INDETERMINATE",
      "The fresh-0016 apply probe exceeded its fixed read bound.",
    );
  }
  if (!Array.isArray(result.results) || result.results.length !== 1) {
    throw applyError(
      "D1_STATE_INDETERMINATE",
      "The fresh-0016 apply probe returned the wrong row count.",
    );
  }
  if (result.resultSetCount !== 1) {
    throw applyError(
      "D1_STATE_INDETERMINATE",
      "The fresh-0016 apply probe returned the wrong result-set count.",
    );
  }
  const row = result.results[0];
  if (
    !isRecord(row) ||
    !hasExactKeys(row, [
      "fixed_marker_exists",
      "fixed_marker_updated_at",
      "fixed_marker_value",
      "fresh_marker_exists",
      "fresh_marker_updated_at",
      "fresh_marker_value",
      "outbox_index_exists",
      "outbox_table_exists",
      "summary_mask_column_exists",
    ])
  ) {
    throw applyError(
      "D1_STATE_INDETERMINATE",
      "The fresh-0016 apply probe row has an invalid exact schema.",
    );
  }
  return {
    rowsRead,
    summaryMaskColumnExists: requiredBit(
      row.summary_mask_column_exists,
      "summary-mask column existence",
    ),
    outboxTableExists: requiredBit(
      row.outbox_table_exists,
      "outbox table existence",
    ),
    outboxIndexExists: requiredBit(
      row.outbox_index_exists,
      "outbox index existence",
    ),
    fixedMarkerExists: requiredBit(
      row.fixed_marker_exists,
      "fixed marker existence",
    ),
    fixedMarkerValue: row.fixed_marker_value,
    fixedMarkerUpdatedAt: row.fixed_marker_updated_at,
    freshMarkerExists: requiredBit(
      row.fresh_marker_exists,
      "fresh marker existence",
    ),
    freshMarkerValue: row.fresh_marker_value,
    freshMarkerUpdatedAt: row.fresh_marker_updated_at,
  };
}

type ApplyStateProbe = ReturnType<typeof parseApplyStateProbe>;

function isExactAbsentProbe(probe: ApplyStateProbe) {
  return probe.summaryMaskColumnExists === 0 &&
    probe.outboxTableExists === 0 &&
    probe.outboxIndexExists === 0 &&
    probe.fixedMarkerExists === 0 &&
    probe.fixedMarkerValue === null &&
    probe.fixedMarkerUpdatedAt === null &&
    probe.freshMarkerExists === 0 &&
    probe.freshMarkerValue === null &&
    probe.freshMarkerUpdatedAt === null;
}

function isExactCommittedProbe(
  probe: ApplyStateProbe,
  binding: HistoricalFresh0016MigrationBinding,
) {
  if (
    probe.summaryMaskColumnExists !== 1 ||
    probe.outboxTableExists !== 1 ||
    probe.outboxIndexExists !== 1 ||
    probe.fixedMarkerExists !== 1 ||
    probe.fixedMarkerValue !== RUNTIME_MIGRATION_0016_COMPLETION_MARKER_VALUE ||
    probe.freshMarkerExists !== 1 ||
    typeof probe.fixedMarkerUpdatedAt !== "number" ||
    !Number.isSafeInteger(probe.fixedMarkerUpdatedAt) ||
    probe.fixedMarkerUpdatedAt < 1 ||
    typeof probe.freshMarkerUpdatedAt !== "number" ||
    !Number.isSafeInteger(probe.freshMarkerUpdatedAt) ||
    probe.freshMarkerUpdatedAt < probe.fixedMarkerUpdatedAt
  ) {
    return false;
  }
  try {
    const expected = canonicalHistoricalFresh0016DatabaseMarkerValue(
      createHistoricalFresh0016DatabaseMarker(binding),
    );
    return probe.freshMarkerValue === expected;
  } catch {
    return false;
  }
}

function createAuthorizationPayload(input: {
  input: ParsedApplyInput;
  manifestStageSha256: string;
  preState: DatabaseStateProof;
}): HistoricalFresh0016ApplyAuthorizationPayload {
  return parseSchema(historicalFresh0016ApplyAuthorizationPayloadSchema, {
    kind: HISTORICAL_FRESH_0016_APPLY_AUTHORIZATION_KIND,
    schemaVersion: 1,
    binding: input.input.binding,
    manifestStageSha256: input.manifestStageSha256,
    predecessorCompleteStageSha256:
      input.input.predecessorCompleteSha256,
    predecessorReportSha256:
      input.input.binding.predecessorReportSha256,
    preWriteEvidenceSha256: input.input.preWriteEvidenceSha256,
    renderedMigrationSha256: input.input.renderedMigrationSha256,
    productionExclusionOwnerSha256:
      input.input.productionExclusionOwnerSha256,
    activeWorkerVersion: input.input.activeWorkerVersion,
    sourceFingerprint: input.input.sourceFingerprint,
    preState: {
      classification: "exact-pre-0016",
      staticRowsRead: input.preState.staticRowsRead,
      probeRowsRead: input.preState.probeRowsRead,
      staticTotalAttempts: 1,
      probeTotalAttempts: 1,
      appliedCheckCount: requiredPre0016AppliedCheckIds.length,
      absentCheckCount: required0016AbsentCheckIds.length,
      schemaObjectsAbsent: true,
      fixedMarkerAbsent: true,
      freshMarkerAbsent: true,
    },
    attemptPlan: {
      maximumAttempts:
        input.input.explicitSameInvocationRetry ? 2 : 1,
      explicitSameInvocationRetryAuthorized:
        input.input.explicitSameInvocationRetry,
      retryPolicy:
        "one-same-live-invocation-retry-after-exact-absence",
      laterInvocationPolicy: "readback-only-no-retry",
    },
    d1ExecutionMayHaveStarted: true,
  }, "fresh-0016 migration authorization payload");
}

function assertAuthorizationMatchesInput(
  payload: HistoricalFresh0016ApplyAuthorizationPayload,
  input: ParsedApplyInput,
) {
  if (
    canonicalHistoricalFresh0016Json(payload.binding) !==
      canonicalHistoricalFresh0016Json(input.binding) ||
    payload.predecessorCompleteStageSha256 !==
      input.predecessorCompleteSha256 ||
    payload.predecessorReportSha256 !==
      input.binding.predecessorReportSha256 ||
    payload.preWriteEvidenceSha256 !== input.preWriteEvidenceSha256 ||
    payload.renderedMigrationSha256 !== input.renderedMigrationSha256 ||
    payload.productionExclusionOwnerSha256 !==
      input.productionExclusionOwnerSha256 ||
    payload.activeWorkerVersion !== input.activeWorkerVersion ||
    !sameSource(payload.sourceFingerprint, input.sourceFingerprint) ||
    payload.attemptPlan.explicitSameInvocationRetryAuthorized !==
      input.explicitSameInvocationRetry
  ) {
    throw applyError(
      "STATE_INVALID",
      "The stored migration authorization does not match the exact apply input.",
    );
  }
}

type ParsedApplyInput = ReturnType<typeof parseApplyInput>;

function parseApplyInput(options: ApplyHistoricalFresh0016MigrationOptions) {
  const inputSchema = z
    .object({
      binding: historicalFresh0016MigrationBindingSchema,
      predecessorCompleteSha256: sha256Schema,
      preWriteEvidenceSha256: sha256Schema,
      renderedMigrationSha256: sha256Schema,
      productionExclusionOwnerSha256: sha256Schema,
      activeWorkerVersion: z.string().regex(workerVersionPattern),
      sourceFingerprint: sourceFingerprintSchema,
      cwd: z.string().min(1).max(4_096),
      backupDirectory: z.string().min(1).max(4_096),
      runDirectory: z.string().min(1).max(4_096),
      explicitSameInvocationRetry: z.boolean(),
      stateOwner: ownerSchema,
    })
    .strict();
  const parsed = parseSchema(inputSchema, {
    binding: options.binding,
    predecessorCompleteSha256: options.predecessorCompleteSha256,
    preWriteEvidenceSha256: options.preWriteEvidenceSha256,
    renderedMigrationSha256: options.renderedMigrationSha256,
    productionExclusionOwnerSha256:
      options.productionExclusionOwnerSha256,
    activeWorkerVersion: options.activeWorkerVersion,
    sourceFingerprint: options.sourceFingerprint,
    cwd: options.cwd,
    backupDirectory: options.backupDirectory,
    runDirectory: options.runDirectory,
    explicitSameInvocationRetry:
      options.explicitSameInvocationRetry ?? false,
    stateOwner: options.stateOwner ?? currentOwner(),
  }, "fresh-0016 apply input");
  if (
    parsed.predecessorCompleteSha256 !==
      parsed.binding.predecessorCompleteSha256 ||
    !sameSource(parsed.sourceFingerprint, parsed.binding.sourceFingerprint)
  ) {
    throw applyError(
      "INPUT_INVALID",
      "The fresh-0016 apply input does not match its migration binding.",
    );
  }
  return {
    ...parsed,
    cwd: path.resolve(parsed.cwd),
    backupDirectory: path.resolve(parsed.backupDirectory),
    runDirectory: path.resolve(parsed.runDirectory),
    runner: createHistoricalDataWranglerRunner(options.runner),
    clock: options.clock,
    ownerExitProbe: options.ownerExitProbe,
  };
}

function assertStateChainBindings(
  classification: ReturnType<typeof classifyHistoricalFresh0016State>,
  input: ParsedApplyInput,
) {
  if (
    classification.status === "broken" ||
    classification.status === "conflict" ||
    classification.status === "empty" ||
    classification.status === "complete" ||
    classification.issues.length !== 0
  ) {
    throw applyError(
      "STATE_INVALID",
      "The fresh-0016 state chain is incomplete, conflicting, or broken.",
    );
  }
  const predecessorComplete = classification.stages.find(
    (stage) => stage.value.stage === "predecessor-complete",
  );
  const manifest = classification.stages.find(
    (stage) => stage.value.stage === "manifest",
  );
  const predecessorReport = classification.auxiliaryFiles.find(
    (file) =>
      file.name ===
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.predecessorReport,
  );
  const preparedMigrationBudget = classification.auxiliaryFiles.find(
    (file) =>
      file.name ===
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES
          .migrationBudgetPrepared,
  );
  const rendered = classification.auxiliaryFiles.find(
    (file) =>
      file.name ===
        HISTORICAL_FRESH_0016_STATE_AUXILIARY_FILE_NAMES.renderedMigration,
  );
  if (
    !predecessorComplete ||
    predecessorComplete.sha256 !== input.predecessorCompleteSha256 ||
    !manifest ||
    manifest.value.payloadSha256 !== input.binding.cutoverManifestSha256 ||
    !predecessorReport ||
    predecessorReport.sha256 !== input.binding.predecessorReportSha256 ||
    !preparedMigrationBudget ||
    preparedMigrationBudget.sha256 !==
      input.binding.migrationBudgetPreparedArtifactFileSha256 ||
    !rendered ||
    rendered.sha256 !== input.renderedMigrationSha256 ||
    !classification.stages.every((stage) =>
      sameSource(stage.value.sourceFingerprint, input.sourceFingerprint)
    )
  ) {
    throw applyError(
      "STATE_INVALID",
      "The fresh-0016 state chain does not bind the exact predecessor, manifest, rendered artifact, or source.",
    );
  }
}

function assertStaticReportMetadata(
  report: ReturnType<typeof verifyD1RuntimeMigrations>,
  source: { sha256: string; fileCount: number },
) {
  if (
    !report.sourceFingerprintStable ||
    report.rowsWritten !== 0 ||
    report.totalAttempts !== 1 ||
    report.checks.length !== RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length ||
    report.sourceFingerprintBefore.sha256 !== source.sha256 ||
    report.sourceFingerprintBefore.fileCount !== source.fileCount ||
    report.sourceFingerprint.sha256 !== source.sha256 ||
    report.sourceFingerprint.fileCount !== source.fileCount
  ) {
    throw applyError(
      "D1_STATE_INDETERMINATE",
      "The static migration state query was retried, wrote rows, or changed source.",
    );
  }
}

function currentControllingOwner(
  classification: ReturnType<typeof classifyHistoricalFresh0016State>,
  stage: string,
): HistoricalFresh0016Owner | undefined {
  const resolution = classification.readbackResolutions
    .filter((entry) => entry.value.stage === stage)
    .at(-1);
  const lease = classification.resumeLeases
    .filter((entry) => entry.value.stage === stage)
    .at(-1);
  return resolution?.value.owner ??
    lease?.value.owner ??
    classification.stages.at(-1)?.value.owner;
}

function assertSuccessfulReadOnlyResult(output: string, label: string) {
  const parsed = parseWranglerJson(output);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    !parsed.every(isRecord)
  ) {
    throw applyError(
      "D1_STATE_INDETERMINATE",
      `The ${label} omitted explicit successful read metadata.`,
    );
  }
  let rowsRead = 0;
  const results: unknown[] = [];
  for (const [index, entry] of parsed.entries()) {
    if (entry.success !== true || !isRecord(entry.meta)) {
      throw applyError(
        "D1_STATE_INDETERMINATE",
        `The ${label} omitted explicit successful read metadata.`,
      );
    }
    const entryRowsRead = requiredNonNegativeInteger(
      entry.meta.rows_read,
      `${label} result set ${index + 1} rows read`,
    );
    const rowsWritten = requiredNonNegativeInteger(
      entry.meta.rows_written,
      `${label} result set ${index + 1} rows written`,
    );
    const totalAttempts = requiredNonNegativeInteger(
      entry.meta.total_attempts,
      `${label} result set ${index + 1} total attempts`,
    );
    if (rowsWritten !== 0 || totalAttempts !== 1) {
      throw applyError(
        "D1_STATE_INDETERMINATE",
        `The ${label} was not one exact read-only attempt.`,
      );
    }
    if (!Array.isArray(entry.results)) {
      throw applyError(
        "D1_STATE_INDETERMINATE",
        `The ${label} returned invalid result rows.`,
      );
    }
    rowsRead += entryRowsRead;
    results.push(...entry.results);
  }
  return {
    resultSetCount: parsed.length,
    results,
    meta: {
      rows_read: rowsRead,
      rows_written: 0,
      total_attempts: 1,
    },
  };
}

function isConfirmedFileExecutionResponse(output: string) {
  try {
    const parsed = parseWranglerJson(output);
    return Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((entry) => isRecord(entry) && entry.success === true);
  } catch {
    return false;
  }
}

function parseWranglerJson(output: string): unknown {
  const trimmed = output.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed;
  } catch {
    const first = trimmed.indexOf("[");
    const last = trimmed.lastIndexOf("]");
    if (first === -1 || last <= first) {
      throw applyError(
        "D1_STATE_INDETERMINATE",
        "Could not parse Wrangler fresh-0016 JSON.",
      );
    }
    try {
      const parsed: unknown = JSON.parse(trimmed.slice(first, last + 1));
      return parsed;
    } catch {
      throw applyError(
        "D1_STATE_INDETERMINATE",
        "Could not parse Wrangler fresh-0016 JSON.",
      );
    }
  }
}

function buildOutcome(input: {
  input: ParsedApplyInput;
  authorization: HistoricalFresh0016StateFileHandle<HistoricalFresh0016StateStageEnvelope>;
  authorizationPayload: HistoricalFresh0016ApplyAuthorizationPayload;
  attempts: ApplyAttempt[];
  status: HistoricalFresh0016ApplyOutcome["status"];
  startedAt: Date;
  completedAt: Date;
  migrationCompleteStageSha256: string | null;
  readbackResolutionSha256: string | null;
  runtimeVerificationReport:
    | z.infer<typeof historicalFresh0016RuntimeVerificationReportSchema>
    | null;
  runtimeVerificationReportSha256: string | null;
  lastDatabaseState: "verified-committed" | "verified-absent";
  stateAdvanceRequired: boolean;
}) {
  const outcome = parseSchema(historicalFresh0016ApplyOutcomeSchema, {
    kind: HISTORICAL_FRESH_0016_APPLY_OUTCOME_KIND,
    schemaVersion: 1,
    createdAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    ok: input.status === "verified" ||
      input.status === "verified-after-ambiguous-response" ||
      input.status === "verified-after-explicit-retry" ||
      input.status === "verified-after-unresolved-authorization",
    status: input.status,
    binding: input.input.binding,
    sourceFingerprint: input.input.sourceFingerprint,
    predecessorCompleteSha256: input.input.predecessorCompleteSha256,
    preWriteEvidenceSha256: input.input.preWriteEvidenceSha256,
    renderedMigrationSha256: input.input.renderedMigrationSha256,
    productionExclusionOwnerSha256:
      input.input.productionExclusionOwnerSha256,
    activeWorkerVersion: input.input.activeWorkerVersion,
    migrationAuthorizedStageSha256: input.authorization.sha256,
    migrationCompleteStageSha256: input.migrationCompleteStageSha256,
    readbackResolutionSha256: input.readbackResolutionSha256,
    runtimeVerificationReportSha256:
      input.runtimeVerificationReportSha256,
    runtimeVerificationReport: input.runtimeVerificationReport,
    attempts: input.attempts,
    lastDatabaseState: input.lastDatabaseState,
    retry: {
      explicitSameInvocationAuthorized:
        input.authorizationPayload.attemptPlan
          .explicitSameInvocationRetryAuthorized,
      maximumAttempts:
        input.authorizationPayload.attemptPlan.maximumAttempts,
      attemptsUsed: input.attempts.length,
      retryConsumed: input.attempts.length === 2,
      furtherRetryAllowed: false,
      laterInvocationPolicy: "readback-only-no-retry",
    },
    stateAdvanceRequired: input.stateAdvanceRequired,
  }, "fresh-0016 apply outcome");
  return deepFreeze(outcome);
}

function currentSource(cwd: string) {
  const source = buildRepoSourceFingerprint(cwd);
  return { sha256: source.sha256, fileCount: source.fileCount };
}

function runWithExactSource(
  input: ParsedApplyInput,
  args: string[],
  runnerOptions?: Parameters<WranglerRunner>[1],
) {
  assertExactSource(
    currentSource(input.cwd),
    input.sourceFingerprint,
    input.binding,
  );
  try {
    return input.runner(args, runnerOptions);
  } finally {
    assertExactSource(
      currentSource(input.cwd),
      input.sourceFingerprint,
      input.binding,
    );
  }
}

function assertExactSource(
  actual: { sha256: string; fileCount: number },
  expected: { sha256: string; fileCount: number },
  binding: HistoricalFresh0016MigrationBinding,
) {
  if (
    !sameSource(actual, expected) ||
    !sameSource(actual, binding.sourceFingerprint)
  ) {
    throw applyError(
      "INPUT_INVALID",
      "The source fingerprint does not match the exact fresh-0016 binding.",
    );
  }
}

function sameSource(
  left: { sha256: string; fileCount: number },
  right: { sha256: string; fileCount: number },
) {
  return left.sha256 === right.sha256 && left.fileCount === right.fileCount;
}

function sameOwner(
  left: HistoricalFresh0016Owner,
  right: HistoricalFresh0016Owner,
) {
  return left.hostname === right.hostname && left.pid === right.pid;
}

function currentOwner(): HistoricalFresh0016Owner {
  return { hostname: os.hostname(), pid: process.pid };
}

function requiredBit(value: unknown, label: string): 0 | 1 {
  if (value !== 0 && value !== 1) {
    throw applyError(
      "D1_STATE_INDETERMINATE",
      `The ${label} is not an exact SQLite boolean.`,
    );
  }
  return value;
}

function requiredNonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw applyError(
      "D1_STATE_INDETERMINATE",
      `The ${label} is not a non-negative safe integer.`,
    );
  }
  return value;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function clockDate(clock: (() => Date) | undefined) {
  const value = clock?.() ?? new Date();
  if (!Number.isFinite(value.getTime())) {
    throw applyError("INPUT_INVALID", "The fresh-0016 apply clock is invalid.");
  }
  return new Date(value.getTime());
}

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw applyError(
      "INPUT_INVALID",
      `The ${label} has an invalid or non-exact schema.`,
    );
  }
  return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const entry of Object.values(value)) deepFreeze(entry);
  Object.freeze(value);
  return value;
}

function applyError(code: HistoricalFresh0016ApplyErrorCode, message: string) {
  return new HistoricalFresh0016ApplyError(code, message);
}

// Keep the explicit pre/post partition pinned to the shared static verifier.
if (
  requiredPre0016AppliedCheckIds.length +
    required0016AbsentCheckIds.length !==
  RUNTIME_MIGRATION_VERIFICATION_CHECK_IDS.length ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY.migration0016
    .alreadyAppliedAdmissionPermitted !== false ||
  HISTORICAL_FRESH_0016_CUTOVER_POLICY_SHA256.length !== 64
) {
  throw new Error("Fresh-0016 apply invariants drifted from shared policy.");
}
