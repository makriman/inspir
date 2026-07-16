import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  NATIVE_SCHEDULED_CPU_HEADROOM_EXCLUSIVE_MS,
  NATIVE_SCHEDULED_CPU_LIMIT_MS,
  NATIVE_SCHEDULED_D1_QUERY_CEILING,
  NATIVE_SCHEDULED_D1_QUERY_LIMIT,
  NATIVE_SCHEDULED_MEMORY_USER_CAP,
  NATIVE_SCHEDULED_RESOURCE_CONTRACT,
  NATIVE_SCHEDULED_VECTOR_CLEANUP_DRAIN_CAP,
} from "../lib/free-runtime/state-api";
import {
  backgroundQueueSettlementQuietPeriodMs,
  backgroundScheduledSettlementQuietPeriodMs,
  captureTail,
  createPublicBackgroundProbe,
  evaluateProductionBackgroundTail,
  parseTailJsonStream,
  tailHasReadinessProbe,
  waitForBackgroundOutcome,
  withoutBenignIntentionalShutdownDiagnostics,
} from "../scripts/cloudflare/verify-production-background-outcomes";

const version = "11111111-1111-4111-8111-111111111111";
const correlationId = "22222222-2222-4222-8222-222222222222";
const scheduledTime = Date.parse("2026-07-13T03:00:00.000Z");
const localSuccessObservedAt = 10_000;

test("background Queue evidence requires one exact stale probe below 8ms", () => {
  const record = queueRecord();
  const accepted = evaluateProductionBackgroundTail(JSON.stringify(record), {
    mode: "queue",
    expectedVersion: version,
    correlationId,
    successObservedAt: localSuccessObservedAt,
    observationEndedAt: localSuccessObservedAt + backgroundQueueSettlementQuietPeriodMs,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.fatal, false);
  assert.equal(accepted.settled, true);
  assert.equal(accepted.matchedEvents, 1);
  assert.equal(accepted.successfulEvents, 1);
  assert.equal(accepted.cpuTimeMs, 7.999);

  const tooEarly = queueSourceEvaluation(
    JSON.stringify(record),
    localSuccessObservedAt + backgroundQueueSettlementQuietPeriodMs - 1,
  );
  assert.equal(tooEarly.ok, false);
  assert.equal(tooEarly.fatal, false);
  assert.equal(tooEarly.settled, false);
  assert.ok(tooEarly.problems.includes("queue-observation-not-settled"));

  const atLimit = queueRecord();
  atLimit.cpuTime = 8;
  assert.ok(queueEvaluation(atLimit).problems.includes("cpu>=8"));

  const wrongBatch = queueRecord();
  wrongBatch.event.batchSize = 2;
  assert.ok(queueEvaluation(wrongBatch).problems.includes("queue-batch-size"));

  const wrongVersion = queueRecord();
  wrongVersion.scriptVersion.id = "33333333-3333-4333-8333-333333333333";
  assert.ok(queueEvaluation(wrongVersion).problems.includes("wrong-version"));

  const missingCpu = queueRecord();
  missingCpu.cpuTime = Number.NaN;
  assert.ok(queueEvaluation(missingCpu).problems.includes("missing-or-negative-cpu"));

  const negativeWallTime = queueRecord();
  negativeWallTime.wallTime = -1;
  assert.ok(queueEvaluation(negativeWallTime).problems.includes("missing-or-negative-wall-time"));
  const longButFiniteWallTime = queueRecord();
  longButFiniteWallTime.wallTime = 15 * 60_000;
  assert.equal(queueEvaluation(longButFiniteWallTime).ok, true);

  const uncapturedRetry = queueRecord({ attempts: 2 });
  const uncapturedRetryEvaluation = queueEvaluation(uncapturedRetry);
  assert.equal(uncapturedRetryEvaluation.fatal, true);
  assert.equal(uncapturedRetryEvaluation.successfulEvents, 0);
  assert.ok(uncapturedRetryEvaluation.problems.includes("malformed-stale-success-log"));

  const clockSkewed = queueRecord({ eventTimestamp: 1 });
  assert.equal(queueEvaluation(clockSkewed).ok, true);

  const duplicate = queueSourceEvaluation(`${JSON.stringify(record)}\n${JSON.stringify(record)}`);
  assert.equal(duplicate.matchedEvents, 2);
  assert.ok(duplicate.problems.includes("stale-success-log-count=2"));

  const failedAttempt = queueFailureRecord(scheduledTime, 1);
  const retrySuccess = queueRecord({ eventTimestamp: scheduledTime + 30_000, attempts: 2 });
  const failedThenSuccessful = queueSourceEvaluation(
    `${JSON.stringify(failedAttempt)}\n${JSON.stringify(retrySuccess)}`,
  );
  assert.equal(failedThenSuccessful.matchedEvents, 2);
  assert.equal(failedThenSuccessful.successfulEvents, 0);
  assert.equal(failedThenSuccessful.fatal, true);
  assert.ok(failedThenSuccessful.problems.includes("failure-log"));
  assert.ok(failedThenSuccessful.problems.includes("malformed-stale-success-log"));

  const cpuKilled = queueRecord({ eventTimestamp: scheduledTime, attempts: 1 });
  cpuKilled.outcome = "exceededCpu";
  cpuKilled.logs = [];
  const killedRetrySuccess = queueRecord({ eventTimestamp: scheduledTime + 60_000, attempts: 2 });
  const killedThenSuccessful = queueSourceEvaluation(
    `${JSON.stringify(cpuKilled)}\n${JSON.stringify(killedRetrySuccess)}`,
  );
  assert.equal(killedThenSuccessful.matchedEvents, 1);
  assert.equal(killedThenSuccessful.fatal, true);
  assert.ok(killedThenSuccessful.problems.includes("outcome"));

  const lateCpuKill = queueRecord({
    eventTimestamp: scheduledTime + 1_000,
    userId: "44444444-4444-4444-8444-444444444444",
  });
  lateCpuKill.outcome = "exceededCpu";
  lateCpuKill.logs = [];
  const finalCaptureWithLateFailure = queueSourceEvaluation(
    `${JSON.stringify(record)}\n${JSON.stringify(lateCpuKill)}`,
  );
  assert.equal(finalCaptureWithLateFailure.fatal, true);
  assert.ok(finalCaptureWithLateFailure.problems.includes("outcome"));

  const malformedCorrelation = queueRecord({ eventTimestamp: scheduledTime, attempts: 1 });
  malformedCorrelation.logs = [log({
    event: "native_memory_queue_processed",
    userId: correlationId,
    messageId: "queue-message",
    attempts: 1,
    outcome: "stale_job",
  })];
  const malformedThenSuccessful = queueSourceEvaluation(
    `${JSON.stringify(malformedCorrelation)}\n${JSON.stringify(retrySuccess)}`,
  );
  assert.equal(malformedThenSuccessful.fatal, true);
  assert.ok(malformedThenSuccessful.problems.includes("queue-attempt-correlation"));

  const unrelated = queueRecord({
    eventTimestamp: scheduledTime + 10_000,
    userId: "33333333-3333-4333-8333-333333333333",
  });
  const withUnrelatedHealthyTraffic = queueSourceEvaluation(
    `${JSON.stringify(record)}\n${JSON.stringify(unrelated)}`,
  );
  assert.equal(withUnrelatedHealthyTraffic.ok, true);
  assert.equal(withUnrelatedHealthyTraffic.matchedEvents, 1);

  const sampled = queueSourceEvaluation(JSON.stringify(record), undefined, "Tail sampled events");
  assert.equal(sampled.fatal, true);
  assert.ok(sampled.problems.includes("tail-capture-loss"));

  for (const eventType of ["overload-stop", "overload-future-state"]) {
    const overloadStopped = queueSourceEvaluation(
      `${JSON.stringify(record)}\n${JSON.stringify({ event: { type: eventType } })}`,
    );
    assert.equal(overloadStopped.fatal, true);
    assert.ok(overloadStopped.problems.includes("tail-capture-loss"));
  }

  const rawReconnect = queueSourceEvaluation(
    `${JSON.stringify(record)}\nTail connection lost. Reconnecting (attempt 1 of 5)...`,
  );
  assert.equal(rawReconnect.fatal, true);
  assert.ok(rawReconnect.problems.includes("tail-output-malformed"));

  const wordyApplicationRecord = {
    ...commonRecord(),
    event: {
      request: {
        method: "GET",
        url: "https://inspirlearning.com/api/health?q=overload+sampled+dropped+reconnect",
      },
      response: { status: 200 },
    },
    logs: [log({ note: "overload sampled dropped reconnect" })],
  };
  const wordyApplicationOutput = queueSourceEvaluation(
    `${JSON.stringify(record)}\n${JSON.stringify(wordyApplicationRecord)}`,
  );
  assert.equal(wordyApplicationOutput.ok, true);
  const unrelatedDiagnosticWords = queueSourceEvaluation(
    JSON.stringify(record),
    undefined,
    "Application note: overload sampled dropped reconnect",
  );
  assert.equal(unrelatedDiagnosticWords.ok, true);
});

test("an exited Tail cannot authorize an otherwise valid background observation", async () => {
  const exitedTail = spawn(process.execPath, ["-e", ""]);
  await once(exitedTail, "close");
  await assert.rejects(
    waitForBackgroundOutcome(
      exitedTail,
      () => JSON.stringify(queueRecord()),
      () => "",
      {
        mode: "queue",
        expectedVersion: version,
        correlationId,
      },
      1_000,
    ),
    /Wrangler tail exited before background evidence arrived/,
  );
});

test("intentional Tail shutdown filters only its exact benign diagnostic", () => {
  const filtered = withoutBenignIntentionalShutdownDiagnostics(
    "\u001b[2mStopping tail...\u001b[0m\nTail connection lost. Reconnecting (attempt 1 of 5)...\n",
  );
  assert.doesNotMatch(filtered, /Stopping tail/);
  assert.match(filtered, /Tail connection lost\. Reconnecting/);
  const finalEvaluation = queueSourceEvaluation(JSON.stringify(queueRecord()), undefined, filtered);
  assert.equal(finalEvaluation.fatal, true);
  assert.ok(finalEvaluation.problems.includes("tail-capture-loss"));
  assert.equal(withoutBenignIntentionalShutdownDiagnostics("Stopping tails..."), "Stopping tails...");
});

test("closed Tail JSON is lossless while a live trailing record may finish", () => {
  const completeRecord = JSON.stringify(queueRecord());
  const livePartialSource = `${completeRecord}\n{"event":{"queue":`;
  const livePartial = parseTailJsonStream(livePartialSource, false);
  assert.equal(livePartial.records.length, 1);
  assert.equal(livePartial.complete, false);
  assert.equal(livePartial.problem, null);

  const closedPartial = parseTailJsonStream(livePartialSource, true);
  assert.equal(closedPartial.problem, "tail-output-incomplete");
  const closedEvaluation = queueSourceEvaluation(livePartialSource);
  assert.equal(closedEvaluation.fatal, true);
  assert.ok(closedEvaluation.problems.includes("tail-output-incomplete"));

  for (const malformed of [
    `${completeRecord}\n{"bad":]}`,
    `${completeRecord}\nnot-json`,
    `${completeRecord}}`,
    `${completeRecord}\n[]`,
  ]) {
    const parsed = parseTailJsonStream(malformed, true);
    assert.equal(parsed.problem, "tail-output-malformed");
  }

  const complete = parseTailJsonStream(` \n${completeRecord}\n${completeRecord}\t`, true);
  assert.equal(complete.problem, null);
  assert.equal(complete.complete, true);
  assert.equal(complete.consumedLength, ` \n${completeRecord}\n${completeRecord}\t`.length);
  assert.equal(complete.records.length, 2);
});

test("Tail capture preserves a UTF-8 character split across stdout chunks", async () => {
  const program = [
    'const text = JSON.stringify({ event: { type: "note", message: "🙂" } }) + "\\n";',
    'const bytes = Buffer.from(text, "utf8");',
    'const emoji = Buffer.from("🙂", "utf8");',
    "const split = bytes.indexOf(emoji) + 2;",
    "process.stdout.write(bytes.subarray(0, split));",
    "setTimeout(() => process.stdout.write(bytes.subarray(split)), 10);",
  ].join("\n");
  const child = spawn(process.execPath, ["-e", program], { stdio: ["ignore", "pipe", "pipe"] });
  const capture = captureTail(child);
  await capture.closed;
  assert.match(capture.output(), /🙂/);
  const parsed = parseTailJsonStream(capture.output(), true);
  assert.equal(parsed.problem, null);
  assert.equal(parsed.records.length, 1);
});

test("scheduled evidence requires the real daily cron, exact UTC occurrence, and clean logs", () => {
  const accepted = evaluateProductionBackgroundTail(JSON.stringify(scheduledRecord()), {
    mode: "scheduled",
    expectedVersion: version,
    expectedScheduledDay: "2026-07-13",
    successObservedAt: localSuccessObservedAt,
    observationEndedAt: localSuccessObservedAt + backgroundScheduledSettlementQuietPeriodMs,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.settled, true);
  assert.equal(accepted.cpuTimeMs, 2.5);

  const tooEarly = scheduledSourceEvaluation(
    JSON.stringify(scheduledRecord()),
    localSuccessObservedAt + backgroundScheduledSettlementQuietPeriodMs - 1,
  );
  assert.equal(tooEarly.ok, false);
  assert.equal(tooEarly.fatal, false);
  assert.ok(tooEarly.problems.includes("scheduled-observation-not-settled"));

  const failedDuplicate = scheduledRecord();
  failedDuplicate.eventTimestamp += 1_000;
  failedDuplicate.outcome = "exceededCpu";
  failedDuplicate.cpuTime = 8;
  failedDuplicate.logs = [];
  const failedDuplicateThenSuccess = scheduledSourceEvaluation(
    `${JSON.stringify(failedDuplicate)}\n${JSON.stringify(scheduledRecord())}`,
  );
  assert.equal(failedDuplicateThenSuccess.matchedEvents, 1);
  assert.equal(failedDuplicateThenSuccess.successfulEvents, 1);
  assert.equal(failedDuplicateThenSuccess.fatal, true);
  assert.ok(failedDuplicateThenSuccess.problems.includes("outcome"));
  assert.ok(failedDuplicateThenSuccess.problems.includes("cpu>=8"));
  assert.ok(failedDuplicateThenSuccess.problems.includes("scheduled-success-log"));

  const malformedFailedDuplicate = {
    ...scheduledRecord(),
    eventTimestamp: scheduledTime + 2_000,
    outcome: "exception",
    logs: [],
    event: { cron: "0 3 * * *", scheduledTime, extra: "malformed" },
  };
  const malformedDuplicateThenSuccess = scheduledSourceEvaluation(
    `${JSON.stringify(scheduledRecord())}\n${JSON.stringify(malformedFailedDuplicate)}`,
  );
  assert.equal(malformedDuplicateThenSuccess.fatal, true);
  assert.ok(malformedDuplicateThenSuccess.problems.includes("scheduled-event-shape"));
  assert.ok(malformedDuplicateThenSuccess.problems.includes("scheduled-attempt-count=2"));
  assert.ok(malformedDuplicateThenSuccess.problems.includes("outcome"));

  const duplicateEnqueueSuccess = scheduledRecord();
  const duplicateEnqueueLog = duplicateEnqueueSuccess.logs.at(0);
  assert.ok(duplicateEnqueueLog);
  duplicateEnqueueSuccess.logs.push(duplicateEnqueueLog);
  assert.ok(
    scheduledEvaluation(duplicateEnqueueSuccess).problems.includes("scheduled-success-log"),
  );

  const extraEnqueueField = scheduledRecord();
  extraEnqueueField.logs[0] = scheduledEnqueueLog({ extra: true });
  assert.ok(
    scheduledEvaluation(extraEnqueueField).problems.includes("scheduled-success-log"),
  );

  const overEnqueueBound = scheduledRecord();
  overEnqueueBound.logs[0] = scheduledEnqueueLog({
    due: NATIVE_SCHEDULED_MEMORY_USER_CAP + 1,
    queued: NATIVE_SCHEDULED_MEMORY_USER_CAP + 1,
  });
  assert.ok(
    scheduledEvaluation(overEnqueueBound).problems.includes("scheduled-success-log"),
  );

  for (const [field, value] of [
    ["resourceContract", "wrong-contract"],
    ["cpuLimitMs", NATIVE_SCHEDULED_CPU_LIMIT_MS + 1],
    ["cpuHeadroomExclusiveMs", NATIVE_SCHEDULED_CPU_HEADROOM_EXCLUSIVE_MS + 1],
    ["d1QueryLimit", NATIVE_SCHEDULED_D1_QUERY_LIMIT + 1],
    ["d1QueryCeiling", NATIVE_SCHEDULED_D1_QUERY_CEILING - 1],
    ["dueCap", NATIVE_SCHEDULED_MEMORY_USER_CAP - 1],
    ["vectorCleanupDrainCap", NATIVE_SCHEDULED_VECTOR_CLEANUP_DRAIN_CAP - 1],
  ] as const) {
    const wrongContract = scheduledRecord();
    wrongContract.logs[0] = scheduledEnqueueLog({ [field]: value });
    assert.ok(
      scheduledEvaluation(wrongContract).problems.includes("scheduled-success-log"),
      field,
    );
  }

  const missingCleanupSuccess = scheduledRecord();
  missingCleanupSuccess.logs = missingCleanupSuccess.logs.slice(0, 1);
  assert.ok(
    scheduledEvaluation(missingCleanupSuccess).problems.includes(
      "scheduled-cleanup-success-log",
    ),
  );

  const duplicateCleanupSuccess = scheduledRecord();
  const duplicateCleanupLog = duplicateCleanupSuccess.logs.at(1);
  assert.ok(duplicateCleanupLog);
  duplicateCleanupSuccess.logs.push(duplicateCleanupLog);
  assert.ok(
    scheduledEvaluation(duplicateCleanupSuccess).problems.includes(
      "scheduled-cleanup-success-log",
    ),
  );

  const malformedCleanupSuccess = scheduledRecord();
  malformedCleanupSuccess.logs[1] = log({
    event: "native_memory_vector_cleanup_scheduled",
    claimed: 1,
    deleteRequested: 1,
    verifiedAbsent: 1,
    pending: 0,
    nextDelaySeconds: null,
  });
  assert.ok(
    scheduledEvaluation(malformedCleanupSuccess).problems.includes(
      "scheduled-cleanup-success-log",
    ),
  );

  const unaccountedClaim = scheduledRecord();
  unaccountedClaim.logs[1] = scheduledCleanupLog({
    claimed: 1,
    deleteRequested: 0,
    verifiedAbsent: 0,
    pending: 0,
    nextDelaySeconds: null,
  });
  assert.ok(
    scheduledEvaluation(unaccountedClaim).problems.includes(
      "scheduled-cleanup-success-log",
    ),
  );

  const leasedRemaining = scheduledRecord();
  leasedRemaining.logs[1] = scheduledCleanupLog({
    claimed: 0,
    deleteRequested: 0,
    verifiedAbsent: 0,
    pending: 1,
    nextDelaySeconds: null,
  });
  assert.equal(scheduledEvaluation(leasedRemaining).ok, true);

  const wrongTime = scheduledRecord();
  wrongTime.event.scheduledTime = Date.parse("2026-07-13T03:01:00.000Z");
  assert.ok(scheduledEvaluation(wrongTime).problems.includes("wrong-scheduled-time"));

  const wrongSeconds = scheduledRecord();
  wrongSeconds.event.scheduledTime = Date.parse("2026-07-13T03:00:59.000Z");
  assert.ok(scheduledEvaluation(wrongSeconds).problems.includes("wrong-scheduled-time"));

  const exception = scheduledRecord();
  exception.outcome = "exception";
  exception.exceptions = [{ name: "Error", message: "redacted", timestamp: scheduledTime }];
  const rejected = scheduledEvaluation(exception);
  assert.ok(rejected.problems.includes("outcome"));
  assert.ok(rejected.problems.includes("exceptions"));

  const caughtFailure = scheduledRecord();
  caughtFailure.logs.push(log({ event: "native_admin_totals_refresh_failed", error: "Error" }));
  assert.ok(scheduledEvaluation(caughtFailure).problems.includes("failure-log"));

  const cleanupFailure = scheduledRecord();
  cleanupFailure.logs.push(log({
    event: "native_memory_vector_cleanup_scheduled_failed",
    error: "Error",
  }));
  assert.ok(scheduledEvaluation(cleanupFailure).problems.includes("failure-log"));

  const skipped = scheduledRecord();
  skipped.logs = [log({
    event: "native_memory_scheduled_enqueued",
    due: 10,
    queued: 0,
    failed: 10,
    skipped: "missing_queue_binding",
    cron: "0 3 * * *",
  })];
  assert.equal(scheduledEvaluation(skipped).ok, false);

  const hybrid = {
    ...scheduledRecord(),
    event: {
      cron: "0 3 * * *",
      scheduledTime,
      queue: "wrong",
      request: { url: "https://inspirlearning.com/api/health" },
    },
  };
  const hybridEvaluation = evaluateProductionBackgroundTail(JSON.stringify(hybrid), {
    mode: "scheduled",
    expectedVersion: version,
    expectedScheduledDay: "2026-07-13",
  });
  assert.equal(hybridEvaluation.matchedEvents, 1);
  assert.ok(hybridEvaluation.problems.includes("scheduled-event-shape"));

  const fetchLookalike = {
    ...scheduledRecord(),
    event: { request: { url: "https://inspirlearning.com/api/health" } },
  };
  assert.equal(evaluateProductionBackgroundTail(JSON.stringify(fetchLookalike), {
    mode: "scheduled",
    expectedVersion: version,
    expectedScheduledDay: "2026-07-13",
  }).matchedEvents, 0);
});

test("JSON tail readiness requires one exact version-attributed health handshake", () => {
  const probe = createPublicBackgroundProbe("ready", 1_783_921_234_567, 42);
  assert.equal(probe, "inspir-background-ready-1783921234567-42");
  assert.doesNotMatch(probe, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
  const record = {
    ...commonRecord(),
    event: {
      request: {
        method: "GET",
        url: `https://inspirlearning.com/api/health?background_tail_ready=${probe}`,
      },
      response: { status: 200 },
    },
  };
  assert.equal(tailHasReadinessProbe(JSON.stringify(record), probe, version), true);
  assert.equal(
    tailHasReadinessProbe(`${JSON.stringify(record)}\n${JSON.stringify(record)}`, probe, version),
    false,
  );
  const atCpuLimit = { ...record, cpuTime: 8 };
  assert.equal(tailHasReadinessProbe(JSON.stringify(atCpuLimit), probe, version), false);
  assert.equal(tailHasReadinessProbe(`${JSON.stringify(record)}\n{`, probe, version, true), false);
  assert.equal(tailHasReadinessProbe(JSON.stringify(record), "other", version), false);
  record.scriptVersion.id = "33333333-3333-4333-8333-333333333333";
  assert.equal(tailHasReadinessProbe(JSON.stringify(record), probe, version), false);
});

test("background production lifecycle is pinned, settled, and re-evaluated after Tail shutdown", () => {
  assert.ok(backgroundQueueSettlementQuietPeriodMs > 30_000);
  assert.ok(backgroundScheduledSettlementQuietPeriodMs > 30_000);
  const verifier = fs.readFileSync(
    path.resolve("scripts/cloudflare/verify-production-background-outcomes.ts"),
    "utf8",
  );
  const tailArgs = verifier.slice(
    verifier.indexOf("const tail = spawn("),
    verifier.indexOf("const capture = captureTail", verifier.indexOf("const tail = spawn(")),
  );
  assert.match(tailArgs, /"tail", workerName, "--format", "json", "--version-id", expectedVersion/);
  assert.doesNotMatch(tailArgs, /--header|--method|--status|--sampling-rate|--search/);
  assert.match(verifier, /userId: probe\.userId/);
  assert.match(verifier, /chatId: probe\.chatId/);
  assert.match(verifier, /log\.outcome === "stale_job"/);
  assert.match(verifier, /assertQueueProbeAbsent\(wrangler, probe\)/);
  assert.ok(
    (verifier.match(/assertSoleActiveVersion\(wrangler, expectedVersion\);/g)?.length ?? 0) >= 3,
  );
  assert.match(verifier, /evaluateAt\(performance\.now\(\)\)/);
  assert.match(verifier, /observationEndedAt: observation\.observationEndedAt/);
  assert.match(verifier, /const tailDiagnostics = diagnostics\(\)/);
  assert.match(
    verifier,
    /if \(observation\.evaluation\.fatal \|\| observation\.evaluation\.settled\)/,
  );
  const waiter = verifier.slice(
    verifier.indexOf("async function waitForBackgroundOutcome"),
    verifier.indexOf("function readQueueId"),
  );
  assert.ok(waiter.indexOf("if (hasExited(tail))") < waiter.indexOf("return { ...observation"));
  assert.match(verifier, /capture\.beginIntentionalShutdown\(\)/);
  assert.match(verifier, /tailDiagnostics: capture\.diagnosticsForEvaluation\(\)/);
  const outcomeWaitIndex = verifier.indexOf("observation = await waitForBackgroundOutcome");
  const settledMarkerIndex = verifier.indexOf('"settled",', outcomeWaitIndex);
  const tailStopIndex = verifier.indexOf("await stopTail(tail, capture.closed)");
  assert.ok(outcomeWaitIndex >= 0 && settledMarkerIndex > outcomeWaitIndex);
  assert.ok(tailStopIndex > settledMarkerIndex);
  assert.match(verifier, /"ready",\s*true,/);
  assert.match(verifier, /"settled",\s*false,/);
  assert.match(verifier, /tailHasReadinessProbe\([\s\S]*settledLivenessProbe[\s\S]*true,/);
  const finalEvaluationIndex = verifier.indexOf(
    "evaluation = evaluateProductionBackgroundTail(",
    tailStopIndex,
  );
  assert.ok(
    finalEvaluationIndex > tailStopIndex,
  );
  assert.ok(
    verifier.lastIndexOf("assertSoleActiveVersion(wrangler, expectedVersion)") >
      finalEvaluationIndex,
  );
  assert.match(verifier, /withoutBenignIntentionalShutdownDiagnostics\(diagnostics\)/);
  assert.match(verifier, /trim\(\) !== "Stopping tail\.\.\."/);
  assert.match(verifier, /tailOutputClosed: hasExited\(tail\)/);
  assert.match(verifier, /waitForCompleteTailOutputCheckpoint\(tail, capture\.output\)/);
  assert.doesNotMatch(verifier, /eventTimestamp < captureStartedAt/);
  assert.match(verifier, /new StringDecoder\("utf8"\)/);
  const stopTailSource = verifier.slice(
    verifier.indexOf("async function stopTail"),
    verifier.indexOf("export function parseTailJsonStream"),
  );
  assert.match(stopTailSource, /\["SIGINT", "SIGTERM"\]/);
  assert.match(stopTailSource, /tail\.kill\("SIGKILL"\)/);
  assert.match(stopTailSource, /required SIGKILL; production proof is invalid/);

  const worker = fs.readFileSync(path.resolve("cloudflare-worker.ts"), "utf8");
  const scheduledHandler = worker.slice(
    worker.indexOf("async scheduled(controller, env, ctx)"),
    worker.indexOf("async queue(batch, env, ctx)"),
  );
  assert.ok(scheduledHandler.indexOf("controller.noRetry()") >= 0);
  assert.ok(
    scheduledHandler.indexOf("controller.noRetry()") <
      scheduledHandler.indexOf("handleMemoryScheduled(controller, env, ctx)"),
  );

  const runtime = fs.readFileSync(path.resolve("lib/free-runtime/state-api.ts"), "utf8");
  const postTurn = runtime.slice(
    runtime.indexOf("async function processNativePostTurn"),
    runtime.indexOf("async function synthesizeNativeUserMemory"),
  );
  assert.match(postTurn, /Promise\.all\(\[\s*env\.DB\.prepare/);
  assert.match(postTurn, /if \(!ownedChat \|\| !settings\) return "stale_job"/);
  assert.ok(
    postTurn.indexOf('return "stale_job"') < postTurn.indexOf("const messages = await env.DB.prepare"),
  );
});

function queueEvaluation(record: ReturnType<typeof queueRecord>) {
  return queueSourceEvaluation(JSON.stringify(record));
}

function queueSourceEvaluation(
  source: string,
  observationEndedAt = localSuccessObservedAt + backgroundQueueSettlementQuietPeriodMs,
  tailDiagnostics = "",
  tailOutputClosed = true,
) {
  return evaluateProductionBackgroundTail(source, {
    mode: "queue",
    expectedVersion: version,
    correlationId,
    successObservedAt: localSuccessObservedAt,
    observationEndedAt,
    tailDiagnostics,
    tailOutputClosed,
  });
}

function scheduledEvaluation(record: ReturnType<typeof scheduledRecord>) {
  return scheduledSourceEvaluation(JSON.stringify(record));
}

function scheduledSourceEvaluation(
  source: string,
  observationEndedAt = localSuccessObservedAt + backgroundScheduledSettlementQuietPeriodMs,
) {
  return evaluateProductionBackgroundTail(source, {
    mode: "scheduled",
    expectedVersion: version,
    expectedScheduledDay: "2026-07-13",
    successObservedAt: localSuccessObservedAt,
    observationEndedAt,
    tailOutputClosed: true,
  });
}

function commonRecord() {
  return {
    eventTimestamp: scheduledTime,
    scriptName: "inspirlearning",
    scriptVersion: { id: version },
    outcome: "ok",
    executionModel: "stateless",
    truncated: false,
    cpuTime: 7.999,
    wallTime: 12.5,
    logs: [] as Array<ReturnType<typeof log>>,
    exceptions: [] as Array<{ name: string; message: string; timestamp: number }>,
  };
}

function queueRecord(input: {
  eventTimestamp?: number;
  attempts?: number;
  userId?: string;
} = {}) {
  return {
    ...commonRecord(),
    eventTimestamp: input.eventTimestamp ?? scheduledTime,
    event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
    logs: [log({
      event: "native_memory_queue_processed",
      type: "memory.post_turn.v2",
      userId: input.userId ?? correlationId,
      messageId: "queue-message",
      attempts: input.attempts ?? 1,
      outcome: "stale_job",
    })],
  };
}

function queueFailureRecord(eventTimestamp: number, attempts: number) {
  return {
    ...commonRecord(),
    eventTimestamp,
    event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
    logs: [log({
      event: "native_memory_queue_failed",
      type: "memory.post_turn.v2",
      userId: correlationId,
      messageId: "queue-message",
      attempts,
      error: "TypeError",
    }, "warn")],
  };
}

function scheduledRecord() {
  return {
    ...commonRecord(),
    cpuTime: 2.5,
    event: { cron: "0 3 * * *", scheduledTime },
    logs: [
      scheduledEnqueueLog(),
      scheduledCleanupLog(),
    ],
  };
}

function scheduledEnqueueLog(overrides: Record<string, unknown> = {}) {
  return log({
    event: "native_memory_scheduled_enqueued",
    due: 0,
    queued: 0,
    failed: 0,
    skipped: null,
    cron: "0 3 * * *",
    resourceContract: NATIVE_SCHEDULED_RESOURCE_CONTRACT,
    cpuLimitMs: NATIVE_SCHEDULED_CPU_LIMIT_MS,
    cpuHeadroomExclusiveMs: NATIVE_SCHEDULED_CPU_HEADROOM_EXCLUSIVE_MS,
    d1QueryLimit: NATIVE_SCHEDULED_D1_QUERY_LIMIT,
    d1QueryCeiling: NATIVE_SCHEDULED_D1_QUERY_CEILING,
    dueCap: NATIVE_SCHEDULED_MEMORY_USER_CAP,
    vectorCleanupDrainCap: NATIVE_SCHEDULED_VECTOR_CLEANUP_DRAIN_CAP,
    ...overrides,
  });
}

function scheduledCleanupLog(overrides: Record<string, unknown> = {}) {
  return log({
    event: "native_memory_vector_cleanup_scheduled",
    claimed: 0,
    deleteRequested: 0,
    verifiedAbsent: 0,
    pending: 0,
    nextDelaySeconds: null,
    ...overrides,
  });
}

function log(value: Record<string, unknown>, level: "log" | "warn" = "log") {
  return {
    timestamp: scheduledTime,
    level,
    message: [JSON.stringify(value)],
  };
}
