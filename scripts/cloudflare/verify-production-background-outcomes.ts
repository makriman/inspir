import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
import { readCloudflareApiToken } from "./cloudflare-api-token";
import { writePrivateJsonDurably } from "./d1-release-budget-ledger";
import {
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  cloudflareDir,
  commandEnv,
  resolveBackupDir,
} from "./migration-config";

const workerName = "inspirlearning";
const cpuHeadroomExclusiveMs = 8;
const maxDailySynthesisUsers = 25;
const maxVectorCleanupDrainIds = 13;
const tailReadyTimeoutMs = 60_000;
const queueCaptureTimeoutMs = 2 * 60_000;
export const backgroundQueueSettlementQuietPeriodMs = 65_000;
export const backgroundScheduledSettlementQuietPeriodMs = 65_000;
const scheduledCaptureTimeoutMs = 30 * 60_000;
const tailOutputLimitBytes = 16 * 1024 * 1024;
const workerVersionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BackgroundOutcomeMode = "queue" | "scheduled";

export type BackgroundOutcomeEvaluation = {
  ok: boolean;
  fatal: boolean;
  settled: boolean;
  mode: BackgroundOutcomeMode;
  expectedVersion: string;
  matchedEvents: number;
  successfulEvents: number;
  lastEventTimestamp: number | null;
  cpuTimeMs: number | null;
  wallTimeMs: number | null;
  problems: string[];
};

type EvaluationInput = {
  mode: BackgroundOutcomeMode;
  expectedVersion: string;
  correlationId?: string;
  expectedScheduledDay?: string;
  observationEndedAt?: number;
  successObservedAt?: number;
  tailDiagnostics?: string;
  tailOutputClosed?: boolean;
};

type QueueProbe = {
  correlationId: string;
  userId: string;
  chatId: string;
};

type BackgroundOutcomeObservation = {
  evaluation: BackgroundOutcomeEvaluation;
  observationEndedAt: number;
  successObservedAt: number | null;
};

export type TailJsonStreamProblem = "tail-output-incomplete" | "tail-output-malformed";

export type TailJsonStreamResult = {
  records: unknown[];
  complete: boolean;
  consumedLength: number;
  problem: TailJsonStreamProblem | null;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Background outcome validation failed.");
    process.exitCode = 1;
  });
}

async function main() {
  if (!process.argv.includes("--confirm-production")) {
    throw new Error("Production background outcome validation requires --confirm-production.");
  }
  const mode = readMode();
  const expectedVersion = requireWorkerVersion(getArg("--expected-version"));
  const expectedScheduledDay = mode === "scheduled"
    ? requireUtcDay(getArg("--scheduled-day") ?? new Date().toISOString().slice(0, 10))
    : undefined;
  const wrangler = path.resolve(process.cwd(), "node_modules/.bin/wrangler");
  assertSoleActiveVersion(wrangler, expectedVersion);
  const captureStartedAt = Date.now();
  const tail = spawn(
    wrangler,
    ["tail", workerName, "--format", "json", "--version-id", expectedVersion],
    { cwd: process.cwd(), env: commandEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const capture = captureTail(tail);
  let outcomeCaptureStartedAt = captureStartedAt;
  let outcomeCaptureOutputOffset = 0;
  let correlationId: string | undefined;
  let initialLivenessProbe: string | undefined;
  let settledLivenessProbe: string | undefined;
  let queuePushAttempted = false;
  let observation: BackgroundOutcomeObservation | null = null;
  let evaluation: BackgroundOutcomeEvaluation | null = null;
  let operationError: unknown;
  let shutdownError: unknown;
  let unexpectedTailExit = false;
  try {
    initialLivenessProbe = await waitForTailHealthProbe(
      tail,
      capture.output,
      expectedVersion,
      "ready",
      true,
    );
    if (mode === "queue") {
      assertSoleActiveVersion(wrangler, expectedVersion);
      const probe = buildQueueProbe();
      correlationId = probe.userId;
      assertQueueProbeAbsent(wrangler, probe);
      const queueId = readQueueId(wrangler);
      outcomeCaptureStartedAt = Date.now();
      outcomeCaptureOutputOffset = await waitForCompleteTailOutputCheckpoint(tail, capture.output);
      queuePushAttempted = true;
      await pushStaleQueueProbe(queueId, probe);
    }
    observation = await waitForBackgroundOutcome(
      tail,
      () => capture.output().slice(outcomeCaptureOutputOffset),
      capture.diagnostics,
      {
        mode,
        expectedVersion,
        ...(correlationId ? { correlationId } : {}),
        ...(expectedScheduledDay ? { expectedScheduledDay } : {}),
      },
      mode === "queue" ? queueCaptureTimeoutMs : scheduledCaptureTimeoutMs,
    );
    evaluation = observation.evaluation;
    if (evaluation.ok) {
      settledLivenessProbe = await waitForTailHealthProbe(
        tail,
        capture.output,
        expectedVersion,
        "settled",
        false,
      );
    }
    assertSoleActiveVersion(wrangler, expectedVersion);
  } catch (error) {
    operationError = error;
  } finally {
    if (hasExited(tail)) {
      unexpectedTailExit = true;
    } else {
      capture.beginIntentionalShutdown();
      try {
        const stoppedIntentionally = await stopTail(tail, capture.closed);
        if (!stoppedIntentionally) {
          unexpectedTailExit = true;
          capture.cancelIntentionalShutdown();
        }
      } catch (error) {
        shutdownError = error;
      }
    }
  }
  if (observation) {
    try {
      evaluation = evaluateProductionBackgroundTail(
        capture.output().slice(outcomeCaptureOutputOffset),
        {
          mode,
          expectedVersion,
          ...(correlationId ? { correlationId } : {}),
          ...(expectedScheduledDay ? { expectedScheduledDay } : {}),
          observationEndedAt: observation.observationEndedAt,
          ...(observation.successObservedAt === null
            ? {}
            : { successObservedAt: observation.successObservedAt }),
          tailDiagnostics: capture.diagnosticsForEvaluation(),
          tailOutputClosed: hasExited(tail),
        },
      );
      if (
        !settledLivenessProbe ||
        !tailHasReadinessProbe(
          capture.output(),
          settledLivenessProbe,
          expectedVersion,
          true,
        )
      ) {
        throw new Error("The settled Tail liveness marker was missing or malformed after shutdown.");
      }
      assertSoleActiveVersion(wrangler, expectedVersion);
    } catch (error) {
      if (!operationError) operationError = error;
    }
  }
  let tailOutputBytes = 0;
  let tailOutputBounded = true;
  try {
    tailOutputBytes = Buffer.byteLength(capture.output());
  } catch {
    tailOutputBounded = false;
  }
  const result = evaluation ?? {
    ok: false,
    fatal: true,
    settled: false,
    mode,
    expectedVersion,
    matchedEvents: 0,
    successfulEvents: 0,
    lastEventTimestamp: null,
    cpuTimeMs: null,
    wallTimeMs: null,
    problems: ["missing-evaluation"],
  } satisfies BackgroundOutcomeEvaluation;
  const failureKinds = [
    ...(operationError ? ["operation"] : []),
    ...(shutdownError ? ["tail-shutdown"] : []),
    ...(unexpectedTailExit ? ["unexpected-tail-exit"] : []),
    ...(!tailOutputBounded ? ["tail-output-overflow"] : []),
  ];
  const report = {
    kind: "production-background-outcome-validation-v1",
    createdAt: new Date().toISOString(),
    ...result,
    ok: result.ok && failureKinds.length === 0,
    queue: mode === "queue" ? MEMORY_POST_TURN_QUEUE_NAME : undefined,
    cron: mode === "scheduled" ? "0 3 * * *" : undefined,
    expectedScheduledDay,
    correlationId,
    initialLivenessProbe,
    settledLivenessProbe,
    queuePushAttempted,
    captureStartedAt,
    outcomeCaptureStartedAt,
    outcomeCaptureOutputOffset,
    cpuThresholdExclusiveMs: cpuHeadroomExclusiveMs,
    tailOutputBytes,
    tailOutputBounded,
    tailOutputClosed: hasExited(tail),
    tailDiagnosticsBytes: Buffer.byteLength(capture.diagnostics()),
    evaluatedTailDiagnosticsBytes: Buffer.byteLength(capture.diagnosticsForEvaluation()),
    finalEvaluationPerformed: observation !== null,
    successObservedAt: observation?.successObservedAt ?? null,
    failureKinds,
  };
  const reportPath = path.join(
    cloudflareDir(resolveBackupDir()),
    `production-${mode}-outcome-report.json`,
  );
  writePrivateJsonDurably(reportPath, report, { replace: pathEntryExists(reportPath) });
  if (!report.ok) {
    throw new Error(
      `Production ${mode} outcome validation failed; inspect the private report at ${reportPath}.`,
    );
  }
  console.log(JSON.stringify({
    kind: report.kind,
    ok: report.ok,
    mode,
    expectedVersion,
    cpuTimeMs: report.cpuTimeMs,
    reportPath,
  }, null, 2));
}

export function evaluateProductionBackgroundTail(
  source: string,
  input: EvaluationInput,
): BackgroundOutcomeEvaluation {
  const parsed = parseTailJsonStream(source, input.tailOutputClosed === true);
  if (input.mode === "queue") return evaluateProductionQueueTail(parsed, input);
  return evaluateProductionScheduledTail(parsed, input);
}

function evaluateProductionScheduledTail(
  parsed: TailJsonStreamResult,
  input: EvaluationInput,
): BackgroundOutcomeEvaluation {
  const fatalProblems = new Set<string>();
  if (parsed.problem) fatalProblems.add(parsed.problem);
  if (backgroundTailCaptureHasLoss(parsed.records, input.tailDiagnostics ?? "")) {
    fatalProblems.add("tail-capture-loss");
  }
  const records = parsed.records.flatMap((value) => {
    const record = asRecord(value);
    const event = asRecord(record?.event);
    if (!record || !event || event.cron !== "0 3 * * *") return [];
    const eventTimestamp = nonNegativeSafeInteger(record.eventTimestamp);
    return [{ record, event, eventTimestamp }];
  });
  if (records.length > 1) fatalProblems.add(`scheduled-attempt-count=${records.length}`);
  let matchedEvents = 0;
  let successfulEvents = 0;
  const cpuTimes: number[] = [];
  const wallTimes: number[] = [];
  const eventTimestamps: number[] = [];
  for (const { record, event, eventTimestamp } of records) {
    let recordValid = true;
    const addRecordProblem = (problem: string) => {
      fatalProblems.add(problem);
      recordValid = false;
    };
    const scriptVersion = asRecord(record.scriptVersion);
    const cpuTimeMs = finiteNumber(record.cpuTime);
    const wallTimeMs = finiteNumber(record.wallTime);
    const scheduledTime = finiteNumber(event.scheduledTime);
    const enqueueSuccess = scheduledLogMatches(record.logs);
    const cleanupSuccess = scheduledCleanupLogMatches(record.logs);

    if (!exactBackgroundEventKind(event, "scheduled")) {
      addRecordProblem("scheduled-event-shape");
    }
    if (record.scriptName !== workerName) addRecordProblem("wrong-script");
    if (scriptVersion?.id !== input.expectedVersion) addRecordProblem("wrong-version");
    if (record.outcome !== "ok") addRecordProblem("outcome");
    if (record.truncated !== false) addRecordProblem("truncated");
    if (!Array.isArray(record.exceptions) || record.exceptions.length !== 0) {
      addRecordProblem("exceptions");
    }
    if (cpuTimeMs === null || cpuTimeMs < 0) {
      addRecordProblem("missing-or-negative-cpu");
    } else {
      cpuTimes.push(cpuTimeMs);
      if (cpuTimeMs >= cpuHeadroomExclusiveMs) addRecordProblem("cpu>=8");
    }
    if (wallTimeMs === null || wallTimeMs < 0) {
      addRecordProblem("missing-or-negative-wall-time");
    } else {
      wallTimes.push(wallTimeMs);
    }
    if (eventTimestamp === null) addRecordProblem("stale-event-timestamp");
    else eventTimestamps.push(eventTimestamp);
    if (
      scheduledTime === null ||
      !input.expectedScheduledDay ||
      !scheduledTimeMatchesUtcDay(scheduledTime, input.expectedScheduledDay)
    ) {
      addRecordProblem("wrong-scheduled-time");
    }
    if (
      scheduledTime !== null &&
      (eventTimestamp === null ||
        eventTimestamp < scheduledTime ||
        eventTimestamp > scheduledTime + 15 * 60_000)
    ) {
      addRecordProblem("scheduled-event-window");
    }
    if (!enqueueSuccess) addRecordProblem("scheduled-success-log");
    if (!cleanupSuccess) addRecordProblem("scheduled-cleanup-success-log");
    if (forbiddenBackgroundLog(record.logs)) addRecordProblem("failure-log");

    if (enqueueSuccess && cleanupSuccess) {
      matchedEvents += 1;
      if (recordValid) successfulEvents += 1;
    }
  }
  if (matchedEvents > 1) fatalProblems.add(`matched-events=${matchedEvents}`);

  const lastEventTimestamp = eventTimestamps.length > 0
    ? Math.max(...eventTimestamps)
    : null;
  const observationEndedAt = nonNegativeNumber(input.observationEndedAt);
  if (input.observationEndedAt !== undefined && observationEndedAt === null) {
    fatalProblems.add("invalid-observation-end");
  }
  const successObservedAt = nonNegativeNumber(input.successObservedAt);
  if (input.successObservedAt !== undefined && successObservedAt === null) {
    fatalProblems.add("invalid-success-observation");
  }
  if (
    observationEndedAt !== null &&
    successObservedAt !== null &&
    observationEndedAt < successObservedAt
  ) {
    fatalProblems.add("invalid-local-observation-window");
  }
  const fatal = fatalProblems.size > 0;
  const settled = !fatal &&
    matchedEvents === 1 &&
    successfulEvents === 1 &&
    successObservedAt !== null &&
    observationEndedAt !== null &&
    observationEndedAt - successObservedAt >= backgroundScheduledSettlementQuietPeriodMs;
  const problemList = [...fatalProblems];
  if (matchedEvents === 0) problemList.push("matched-events=0");
  if (!settled && !fatal) problemList.push("scheduled-observation-not-settled");

  return {
    ok: settled && problemList.length === 0,
    fatal,
    settled,
    mode: "scheduled",
    expectedVersion: input.expectedVersion,
    matchedEvents,
    successfulEvents,
    lastEventTimestamp,
    cpuTimeMs: cpuTimes.length > 0 ? Math.max(...cpuTimes) : null,
    wallTimeMs: wallTimes.length > 0 ? Math.max(...wallTimes) : null,
    problems: problemList,
  };
}

function evaluateProductionQueueTail(
  parsed: TailJsonStreamResult,
  input: EvaluationInput,
): BackgroundOutcomeEvaluation {
  const fatalProblems = new Set<string>();
  const correlationId = input.correlationId ?? "";
  if (!correlationId) fatalProblems.add("missing-queue-correlation-id");
  if (parsed.problem) fatalProblems.add(parsed.problem);
  if (backgroundTailCaptureHasLoss(parsed.records, input.tailDiagnostics ?? "")) {
    fatalProblems.add("tail-capture-loss");
  }

  const queueRecords: Array<{
    record: Record<string, unknown>;
    event: Record<string, unknown>;
    eventTimestamp: number | null;
    logs: Record<string, unknown>[];
  }> = [];
  for (const value of parsed.records) {
    const record = asRecord(value);
    const event = asRecord(record?.event);
    if (!record || !event || event.queue !== MEMORY_POST_TURN_QUEUE_NAME) continue;
    const logs = structuredLogRecords(record.logs);
    const eventTimestamp = nonNegativeSafeInteger(record.eventTimestamp);
    if (eventTimestamp === null) fatalProblems.add("invalid-event-timestamp");
    queueRecords.push({ record, event, eventTimestamp, logs });
  }

  let successfulEvents = 0;
  let matchedEvents = 0;
  const cpuTimes: number[] = [];
  const wallTimes: number[] = [];
  const probeEventTimestamps: number[] = [];
  for (const { record, event, eventTimestamp, logs } of queueRecords) {
    const scriptVersion = asRecord(record.scriptVersion);
    const cpuTimeMs = finiteNumber(record.cpuTime);
    const wallTimeMs = finiteNumber(record.wallTime);
    const probeLogs = queueProbeLogs(logs, correlationId);
    const terminals = queueProbeTerminalLogs(logs, correlationId);
    const successes = terminals.filter((log) => log.event === "native_memory_queue_processed");
    const failures = terminals.filter((log) => log.event === "native_memory_queue_failed");

    if (!hasExactRecordKeys(event, ["batchSize", "queue"])) {
      fatalProblems.add("queue-event-shape");
    }
    if (event.batchSize !== 1) fatalProblems.add("queue-batch-size");
    if (record.scriptName !== workerName) fatalProblems.add("wrong-script");
    if (scriptVersion?.id !== input.expectedVersion) fatalProblems.add("wrong-version");
    if (record.outcome !== "ok") fatalProblems.add("outcome");
    if (record.truncated !== false) fatalProblems.add("truncated");
    if (!Array.isArray(record.exceptions) || record.exceptions.length !== 0) {
      fatalProblems.add("exceptions");
    }
    if (cpuTimeMs === null || cpuTimeMs < 0) {
      fatalProblems.add("missing-or-negative-cpu");
    } else {
      cpuTimes.push(cpuTimeMs);
      if (cpuTimeMs >= cpuHeadroomExclusiveMs) fatalProblems.add("cpu>=8");
    }
    if (wallTimeMs === null || wallTimeMs < 0) {
      fatalProblems.add("missing-or-negative-wall-time");
    } else {
      wallTimes.push(wallTimeMs);
    }
    if (forbiddenBackgroundLog(record.logs)) fatalProblems.add("failure-log");

    if (probeLogs.length === 0) continue;
    matchedEvents += 1;
    if (eventTimestamp !== null) probeEventTimestamps.push(eventTimestamp);
    if (probeLogs.length !== terminals.length) fatalProblems.add("queue-attempt-correlation");
    if (terminals.length === 0) fatalProblems.add("queue-attempt-correlation");
    else if (terminals.length !== 1) {
      fatalProblems.add(`queue-terminal-log-count=${terminals.length}`);
    }
    if (successes.length === 1) {
      if (validQueueProbeSuccessLog(successes[0], correlationId)) successfulEvents += 1;
      else fatalProblems.add("malformed-stale-success-log");
    }
    if (failures.length > 0) {
      fatalProblems.add("failure-log");
      if (failures.some((log) => !validQueueProbeFailureLog(log, correlationId))) {
        fatalProblems.add("malformed-queue-failure-log");
      }
    }
  }

  if (matchedEvents > 0 && successfulEvents !== 1) {
    fatalProblems.add(`stale-success-log-count=${successfulEvents}`);
  }
  const lastEventTimestamp = probeEventTimestamps.length > 0
    ? Math.max(...probeEventTimestamps)
    : null;
  const observationEndedAt = nonNegativeNumber(input.observationEndedAt);
  if (input.observationEndedAt !== undefined && observationEndedAt === null) {
    fatalProblems.add("invalid-observation-end");
  }
  const successObservedAt = nonNegativeNumber(input.successObservedAt);
  if (input.successObservedAt !== undefined && successObservedAt === null) {
    fatalProblems.add("invalid-success-observation");
  }
  if (
    observationEndedAt !== null &&
    successObservedAt !== null &&
    observationEndedAt < successObservedAt
  ) {
    fatalProblems.add("invalid-local-observation-window");
  }
  const fatal = fatalProblems.size > 0;
  const settled = !fatal &&
    successfulEvents === 1 &&
    successObservedAt !== null &&
    observationEndedAt !== null &&
    observationEndedAt - successObservedAt >= backgroundQueueSettlementQuietPeriodMs;
  const problems = [...fatalProblems];
  if (matchedEvents === 0) problems.push("matched-events=0");
  if (matchedEvents === 0 && successfulEvents === 0) {
    problems.push("stale-success-log-count=0");
  }
  if (!settled && !fatal) problems.push("queue-observation-not-settled");

  return {
    ok: settled && problems.length === 0,
    fatal,
    settled,
    mode: "queue",
    expectedVersion: input.expectedVersion,
    matchedEvents,
    successfulEvents,
    lastEventTimestamp,
    cpuTimeMs: cpuTimes.length > 0 ? Math.max(...cpuTimes) : null,
    wallTimeMs: wallTimes.length > 0 ? Math.max(...wallTimes) : null,
    problems,
  };
}

function queueProbeLogs(logs: readonly Record<string, unknown>[], correlationId: string) {
  if (!correlationId) return [];
  return logs.filter((log) => log.userId === correlationId);
}

function queueProbeTerminalLogs(logs: readonly Record<string, unknown>[], correlationId: string) {
  if (!correlationId) return [];
  return logs.filter((log) =>
    log.type === "memory.post_turn.v2" &&
    log.userId === correlationId &&
    (log.event === "native_memory_queue_processed" || log.event === "native_memory_queue_failed")
  );
}

function validQueueProbeSuccessLog(log: Record<string, unknown>, correlationId: string) {
  return hasExactRecordKeys(
    log,
    ["attempts", "event", "messageId", "outcome", "type", "userId"],
  ) &&
    log.event === "native_memory_queue_processed" &&
    log.type === "memory.post_turn.v2" &&
    log.userId === correlationId &&
    log.outcome === "stale_job" &&
    isNonEmptyString(log.messageId) &&
    log.attempts === 1;
}

function validQueueProbeFailureLog(log: Record<string, unknown>, correlationId: string) {
  return hasExactRecordKeys(
    log,
    ["attempts", "error", "event", "messageId", "type", "userId"],
  ) &&
    log.event === "native_memory_queue_failed" &&
    log.type === "memory.post_turn.v2" &&
    log.userId === correlationId &&
    isNonEmptyString(log.messageId) &&
    positiveSafeInteger(log.attempts) &&
    isNonEmptyString(log.error);
}

function backgroundTailCaptureHasLoss(records: readonly unknown[], diagnostics: string) {
  const controlEventLoss = records.some((value) => {
    const event = asRecord(asRecord(value)?.event);
    return typeof event?.type === "string" &&
      /^(?:overload|sampling|sampled|dropped)(?:$|[-_:.])/i.test(event.type);
  });
  const diagnosticLoss = diagnostics
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) =>
      /^Tail connection lost: the Worker did not respond to a keep-alive ping within \d+ms\.$/i.test(
        line,
      ) ||
      /^Tail connection lost\. Reconnecting \(attempt \d+ of \d+\)(?: in \d+(?:\.\d+)?s)?\.\.\.$/i.test(
        line,
      ) ||
      /^Unable to reconnect to the tail for .+ after \d+ attempts\./i.test(line) ||
      /^Tail: reconnect attempt failed:/i.test(line) ||
      /^Tail (?:event )?(?:sampling|sampled|dropped)(?: events?)?(?: detected)?[.!]?$/i.test(
        line,
      )
    );
  return controlEventLoss || diagnosticLoss;
}

export async function waitForBackgroundOutcome(
  tail: ChildProcess,
  output: () => string,
  diagnostics: () => string,
  input: EvaluationInput,
  timeoutMs: number,
) {
  const startedAt = performance.now();
  let successObservedAt: number | undefined;
  const evaluateAt = (observationEndedAt: number) => {
    const source = output();
    const tailDiagnostics = diagnostics();
    let evaluation = evaluateProductionBackgroundTail(source, {
      ...input,
      observationEndedAt,
      ...(successObservedAt === undefined ? {} : { successObservedAt }),
      tailDiagnostics,
    });
    if (
      successObservedAt === undefined &&
      evaluation.successfulEvents === 1
    ) {
      successObservedAt = observationEndedAt;
      evaluation = evaluateProductionBackgroundTail(source, {
        ...input,
        observationEndedAt,
        successObservedAt,
        tailDiagnostics,
      });
    }
    return { evaluation, observationEndedAt };
  };
  while (performance.now() - startedAt < timeoutMs) {
    const observation = evaluateAt(performance.now());
    if (hasExited(tail)) throw new Error("Wrangler tail exited before background evidence arrived.");
    if (observation.evaluation.fatal || observation.evaluation.settled) {
      return { ...observation, successObservedAt: successObservedAt ?? null };
    }
    await delay(1_000);
  }
  const observation = evaluateAt(performance.now());
  if (hasExited(tail)) throw new Error("Wrangler tail exited before background evidence arrived.");
  return { ...observation, successObservedAt: successObservedAt ?? null };
}

function readQueueId(wrangler: string) {
  const result = spawnSync(
    wrangler,
    ["queues", "info", MEMORY_POST_TURN_QUEUE_NAME],
    {
      cwd: process.cwd(),
      env: commandEnv(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (result.status !== 0) throw new Error("Could not resolve the production Queue ID.");
  const match = /^Queue ID:\s*([a-f0-9]{32})\s*$/im.exec(`${result.stdout}${result.stderr}`);
  if (!match?.[1]) throw new Error("Wrangler returned an invalid production Queue ID.");
  return match[1];
}

function buildQueueProbe(): QueueProbe {
  const nonce = randomUUID();
  return {
    correlationId: `inspir-background-cpu-probe:${nonce}`,
    userId: `inspir-background-cpu-probe-user:${nonce}`,
    chatId: `inspir-background-cpu-probe-chat:${nonce}`,
  };
}

function exactBackgroundEventKind(
  event: Record<string, unknown>,
  mode: BackgroundOutcomeMode,
) {
  const keys = Object.keys(event).sort();
  return mode === "queue"
    ? keys.length === 2 && keys[0] === "batchSize" && keys[1] === "queue"
    : keys.length === 2 && keys[0] === "cron" && keys[1] === "scheduledTime";
}

function hasExactRecordKeys(record: Record<string, unknown>, names: readonly string[]) {
  const actual = Object.keys(record).sort();
  const expected = [...names].sort();
  return actual.length === expected.length &&
    actual.every((name, index) => name === expected[index]);
}

function assertQueueProbeAbsent(wrangler: string, probe: QueueProbe) {
  const sql = [
    "SELECT",
    `  (SELECT COUNT(*) FROM users WHERE id = '${probe.userId}') AS users,`,
    `  (SELECT COUNT(*) FROM chats WHERE id = '${probe.chatId}') AS chats;`,
  ].join("\n");
  const result = spawnSync(
    wrangler,
    ["d1", "execute", D1_DATABASE_NAME, "--remote", "--json", "--command", sql],
    {
      cwd: process.cwd(),
      env: commandEnv(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (result.status !== 0) throw new Error("Could not prove Queue probe identifiers absent.");
  const parsed = parseJsonArray(result.stdout);
  const entry = asRecord(parsed[0]);
  const meta = asRecord(entry?.meta);
  const rows = Array.isArray(entry?.results) ? entry.results : [];
  const row = rows.length === 1 ? asRecord(rows[0]) : null;
  if (
    parsed.length !== 1 ||
    entry?.success !== true ||
    meta?.rows_written !== 0 ||
    row?.users !== 0 ||
    row.chats !== 0
  ) {
    throw new Error("Queue probe identifiers were present or their absence was indeterminate.");
  }
}

function parseJsonArray(output: string) {
  let value: unknown;
  try {
    value = JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error("Wrangler returned invalid JSON.");
  }
  if (!Array.isArray(value)) throw new Error("Wrangler returned a non-array JSON result.");
  return value;
}

function assertSoleActiveVersion(wrangler: string, expectedVersion: string) {
  const result = spawnSync(
    wrangler,
    ["deployments", "status", "--name", workerName, "--json"],
    {
      cwd: process.cwd(),
      env: commandEnv(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (result.status !== 0) throw new Error("Could not read the active Worker deployment.");
  let value: unknown;
  try {
    value = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error("Active Worker deployment output was invalid.");
  }
  const deployment = asRecord(value);
  const versions = Array.isArray(deployment?.versions) ? deployment.versions : [];
  const active = versions.length === 1 ? asRecord(versions[0]) : null;
  if (active?.version_id !== expectedVersion || active.percentage !== 100) {
    throw new Error("Background validation requires the expected Worker alone at 100% traffic.");
  }
}

async function pushStaleQueueProbe(queueId: string, probe: QueueProbe) {
  const credential = readCloudflareApiToken();
  const token = credential.token;
  if (credential.error || token.length < 20 || token.length > 2048) {
    throw new Error("Production Queue validation requires a valid Cloudflare API token.");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/queues/${queueId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        body: {
          type: "memory.post_turn.v2",
          enqueuedAt: new Date().toISOString(),
          aiRunId: probe.correlationId,
          userId: probe.userId,
          chatId: probe.chatId,
          topic: { id: "production-cpu-probe", name: "Production CPU probe", slug: "production-cpu-probe" },
          userMessageId: `${probe.correlationId}:user`,
          assistantMessageId: `${probe.correlationId}:assistant`,
          contextMessageIds: [],
        },
        content_type: "json",
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await readBoundedText(response, 64 * 1024);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Cloudflare Queue push returned invalid JSON.");
  }
  const record = asRecord(value);
  if (!response.ok || record?.success !== true) {
    throw new Error(`Cloudflare Queue push failed with HTTP ${response.status}.`);
  }
}

function scheduledLogMatches(logs: unknown) {
  const matches = structuredLogRecords(logs).filter(
    (log) => log.event === "native_memory_scheduled_enqueued",
  );
  if (matches.length !== 1) return false;
  const log = matches[0];
  if (
    !log ||
    !hasExactRecordKeys(log, ["cron", "due", "event", "failed", "queued", "skipped"])
  ) {
    return false;
  }
  const due = nonNegativeSafeInteger(log.due);
  return due !== null &&
    due <= maxDailySynthesisUsers &&
    log.queued === due &&
    log.failed === 0 &&
    log.skipped === null &&
    log.cron === "0 3 * * *";
}

function scheduledCleanupLogMatches(logs: unknown) {
  const matches = structuredLogRecords(logs).filter(
    (log) => log.event === "native_memory_vector_cleanup_scheduled",
  );
  if (matches.length !== 1) return false;
  const log = matches[0];
  if (
    !log ||
    !hasExactRecordKeys(log, [
      "claimed",
      "deleteRequested",
      "event",
      "nextDelaySeconds",
      "pending",
      "verifiedAbsent",
    ])
  ) {
    return false;
  }
  const claimed = nonNegativeSafeInteger(log.claimed);
  const deleteRequested = nonNegativeSafeInteger(log.deleteRequested);
  const verifiedAbsent = nonNegativeSafeInteger(log.verifiedAbsent);
  const pending = nonNegativeSafeInteger(log.pending);
  const nextDelaySeconds = nonNegativeSafeInteger(log.nextDelaySeconds);
  if (
    claimed === null ||
    deleteRequested === null ||
    verifiedAbsent === null ||
    pending === null ||
    claimed > maxVectorCleanupDrainIds ||
    pending > 1
  ) {
    return false;
  }
  if (pending === 0) {
    return log.nextDelaySeconds === null &&
      deleteRequested === 0 &&
      claimed === verifiedAbsent;
  }
  return deleteRequested + verifiedAbsent <= claimed &&
    (log.nextDelaySeconds === null || nextDelaySeconds !== null);
}

function forbiddenBackgroundLog(logs: unknown) {
  const warningLevel = Array.isArray(logs) && logs.some((value) => {
    const log = asRecord(value);
    const level = typeof log?.level === "string"
      ? log.level
      : typeof log?.logLevel === "string"
      ? log.logLevel
      : "";
    return /^(?:warn|warning|error|critical)$/i.test(level);
  });
  const serialized = JSON.stringify(logs ?? null);
  return warningLevel ||
    /exceededCpu|exceededMemory|native_memory_queue_failed|native_memory_vector_cleanup_scheduled_failed|native_rate_limit_cleanup_failed|native_admin_totals_refresh_failed|native_stale_ai_run_cleanup_failed/i.test(
      serialized,
    );
}

function structuredLogRecords(logs: unknown) {
  if (!Array.isArray(logs)) return [];
  const records: Record<string, unknown>[] = [];
  for (const entry of logs) {
    const log = asRecord(entry);
    const messages = Array.isArray(log?.message) ? log.message : [log?.message];
    for (const message of messages) {
      if (typeof message !== "string" || message.length > 32 * 1024) continue;
      try {
        const parsed = asRecord(JSON.parse(message) as unknown);
        if (parsed) records.push(parsed);
      } catch {
        // Only structured application logs can correlate background work.
      }
    }
  }
  return records;
}

function scheduledTimeMatchesUtcDay(value: number, expectedDay: string) {
  if (!Number.isSafeInteger(value) || value < 0) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === expectedDay &&
    date.getUTCHours() === 3 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
}

export function captureTail(tail: ChildProcess) {
  let output = "";
  let diagnostics = "";
  let intentionalShutdownStarted = false;
  let overflowed = false;
  let capturedBytes = 0;
  let outputFlushed = false;
  let diagnosticsFlushed = false;
  const outputDecoder = new StringDecoder("utf8");
  const diagnosticsDecoder = new StringDecoder("utf8");
  const appendText = (target: "output" | "diagnostics", text: string) => {
    if (target === "output") output += text;
    else diagnostics += text;
  };
  const append = (target: "output" | "diagnostics", chunk: Buffer | string) => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    if (capturedBytes + bytes.byteLength > tailOutputLimitBytes) {
      overflowed = true;
      return;
    }
    capturedBytes += bytes.byteLength;
    appendText(
      target,
      target === "output" ? outputDecoder.write(bytes) : diagnosticsDecoder.write(bytes),
    );
  };
  const flush = (target: "output" | "diagnostics") => {
    if (target === "output") {
      if (outputFlushed) return;
      outputFlushed = true;
      appendText(target, outputDecoder.end());
      return;
    }
    if (diagnosticsFlushed) return;
    diagnosticsFlushed = true;
    appendText(target, diagnosticsDecoder.end());
  };
  tail.stdout?.on("data", (chunk: Buffer | string) => append("output", chunk));
  tail.stderr?.on("data", (chunk: Buffer | string) => append("diagnostics", chunk));
  tail.stdout?.on("end", () => flush("output"));
  tail.stderr?.on("end", () => flush("diagnostics"));
  const closed = new Promise<void>((resolve) => {
    tail.once("close", () => {
      flush("output");
      flush("diagnostics");
      resolve();
    });
  });
  return {
    output: () => {
      if (overflowed) throw new Error("Wrangler tail output exceeded its bounded capture size.");
      return output;
    },
    diagnostics: () => diagnostics,
    diagnosticsForEvaluation: () => intentionalShutdownStarted
      ? withoutBenignIntentionalShutdownDiagnostics(diagnostics)
      : diagnostics,
    beginIntentionalShutdown: () => {
      intentionalShutdownStarted = true;
    },
    cancelIntentionalShutdown: () => {
      intentionalShutdownStarted = false;
    },
    closed,
  };
}

export function withoutBenignIntentionalShutdownDiagnostics(diagnostics: string) {
  return diagnostics
    .split(/\r?\n/)
    .filter((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trim() !== "Stopping tail...")
    .join("\n");
}

async function waitForTailHealthProbe(
  tail: ChildProcess,
  output: () => string,
  expectedVersion: string,
  label: string,
  retryMissedMarker: boolean,
) {
  const startedAt = performance.now();
  let attempt = 0;
  while (performance.now() - startedAt < tailReadyTimeoutMs) {
    attempt += 1;
    const probe = createPublicBackgroundProbe(`${label}-${attempt}`);
    if (hasExited(tail)) throw new Error("Wrangler tail exited before its health marker.");
    const url = new URL("/api/health", "https://inspirlearning.com");
    url.searchParams.set("background_tail_ready", probe);
    const response = await fetch(url, {
      headers: {
        "cache-control": "no-cache",
        "Cloudflare-Workers-Version-Overrides": `${workerName}="${expectedVersion}"`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (response.status !== 200) {
      throw new Error(`Background Tail health marker returned HTTP ${response.status}.`);
    }
    const markerStartedAt = performance.now();
    const markerTimeoutMs = retryMissedMarker
      ? Math.min(2_000, tailReadyTimeoutMs - (markerStartedAt - startedAt))
      : tailReadyTimeoutMs - (markerStartedAt - startedAt);
    while (performance.now() - markerStartedAt < markerTimeoutMs) {
      if (tailHasReadinessProbe(output(), probe, expectedVersion)) {
        if (hasExited(tail)) throw new Error("Wrangler tail exited after its health marker.");
        return probe;
      }
      if (hasExited(tail)) throw new Error("Wrangler tail exited before its health marker arrived.");
      await delay(250);
    }
    if (!retryMissedMarker) break;
  }
  throw new Error("Wrangler Tail did not capture its health marker before the bounded timeout.");
}

export function createPublicBackgroundProbe(label: string, now = Date.now(), pid = process.pid) {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);
  if (!safeLabel || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(pid) || pid < 0) {
    throw new Error("Background tail probe identity is invalid.");
  }
  return `inspir-background-${safeLabel}-${now}-${pid}`;
}

export function tailHasReadinessProbe(
  source: string,
  probe: string,
  expectedVersion: string,
  closed = false,
) {
  const parsed = parseTailJsonStream(source, closed);
  if (parsed.problem) return false;
  const matches = parsed.records.filter((value) => {
    const record = asRecord(value);
    const event = asRecord(record?.event);
    const request = asRecord(event?.request);
    const response = asRecord(event?.response);
    const scriptVersion = asRecord(record?.scriptVersion);
    const cpuTimeMs = finiteNumber(record?.cpuTime);
    const wallTimeMs = finiteNumber(record?.wallTime);
    if (
      record?.outcome !== "ok" ||
      record.scriptName !== workerName ||
      scriptVersion?.id !== expectedVersion ||
      record.truncated !== false ||
      !Array.isArray(record.exceptions) ||
      record.exceptions.length !== 0 ||
      cpuTimeMs === null ||
      cpuTimeMs < 0 ||
      cpuTimeMs >= cpuHeadroomExclusiveMs ||
      wallTimeMs === null ||
      wallTimeMs < 0 ||
      nonNegativeSafeInteger(record.eventTimestamp) === null ||
      forbiddenBackgroundLog(record.logs) ||
      request?.method !== "GET" ||
      response?.status !== 200 ||
      typeof request.url !== "string"
    ) {
      return false;
    }
    try {
      const url = new URL(request.url);
      return url.pathname === "/api/health" && url.searchParams.get("background_tail_ready") === probe;
    } catch {
      return false;
    }
  });
  return matches.length === 1;
}

async function stopTail(tail: ChildProcess, closed: Promise<void>) {
  if (hasExited(tail)) return false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    if (!tail.kill(signal)) {
      if (hasExited(tail)) return false;
      throw new Error(`Wrangler tail rejected ${signal}.`);
    }
    if (await resolvesWithin(closed, 5_000)) return true;
  }
  const forced = tail.kill("SIGKILL");
  if (forced) await resolvesWithin(closed, 5_000);
  throw new Error("Wrangler Tail required SIGKILL; production proof is invalid.");
}

export function parseTailJsonStream(source: string, closed: boolean): TailJsonStreamResult {
  const records: unknown[] = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
    if (index === source.length) {
      return { records, complete: true, consumedLength: source.length, problem: null };
    }
    if (source[index] !== "{") {
      return {
        records,
        complete: false,
        consumedLength: index,
        problem: "tail-output-malformed",
      };
    }
    const start = index;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let end = -1;
    for (; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth < 0) {
          return {
            records,
            complete: false,
            consumedLength: start,
            problem: "tail-output-malformed",
          };
        }
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end < 0) {
      return {
        records,
        complete: false,
        consumedLength: start,
        problem: closed ? "tail-output-incomplete" : null,
      };
    }
    try {
      const value = JSON.parse(source.slice(start, end)) as unknown;
      if (!asRecord(value)) throw new Error("Tail record was not an object.");
      records.push(value);
    } catch {
      return {
        records,
        complete: false,
        consumedLength: start,
        problem: "tail-output-malformed",
      };
    }
    index = end;
  }
  return { records, complete: true, consumedLength: source.length, problem: null };
}

async function waitForCompleteTailOutputCheckpoint(
  tail: ChildProcess,
  output: () => string,
) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 5_000) {
    const source = output();
    const parsed = parseTailJsonStream(source, false);
    if (parsed.problem) throw new Error("Wrangler Tail output was malformed before Queue publish.");
    if (parsed.complete && parsed.consumedLength === source.length) return source.length;
    if (hasExited(tail)) throw new Error("Wrangler Tail exited before the Queue checkpoint.");
    await delay(25);
  }
  throw new Error("Wrangler Tail never reached a complete JSON boundary before Queue publish.");
}

async function readBoundedText(response: Response, maximumBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("Cloudflare API response was too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function readMode(): BackgroundOutcomeMode {
  const queue = process.argv.includes("--queue");
  const scheduled = process.argv.includes("--scheduled");
  if (queue === scheduled) throw new Error("Choose exactly one of --queue or --scheduled.");
  return queue ? "queue" : "scheduled";
}

function requireWorkerVersion(value: string | undefined) {
  if (!value || !workerVersionPattern.test(value)) {
    throw new Error("Background outcome validation requires an exact Worker version UUID.");
  }
  return value.toLowerCase();
}

function requireUtcDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Scheduled outcome validation requires a valid UTC day.");
  }
  return value;
}

function getArg(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function nonNegativeSafeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pathEntryExists(file: string) {
  return fs.existsSync(file);
}

function hasExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function resolvesWithin(promise: Promise<unknown>, milliseconds: number) {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), milliseconds);
    void promise.then(() => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}
