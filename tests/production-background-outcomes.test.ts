import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createPublicBackgroundProbe,
  evaluateProductionBackgroundTail,
  tailHasReadinessProbe,
} from "../scripts/cloudflare/verify-production-background-outcomes";

const version = "11111111-1111-4111-8111-111111111111";
const correlationId = "22222222-2222-4222-8222-222222222222";
const scheduledTime = Date.parse("2026-07-13T03:00:00.000Z");

test("background Queue evidence requires one exact stale probe below 8ms", () => {
  const record = queueRecord();
  const accepted = evaluateProductionBackgroundTail(JSON.stringify(record), {
    mode: "queue",
    expectedVersion: version,
    correlationId,
    captureStartedAt: scheduledTime - 1_000,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.matchedEvents, 1);
  assert.equal(accepted.cpuTimeMs, 7.999);

  const atLimit = queueRecord();
  atLimit.cpuTime = 8;
  assert.ok(queueEvaluation(atLimit).problems.includes("cpu>=8"));

  const wrongBatch = queueRecord();
  wrongBatch.event.batchSize = 2;
  assert.ok(queueEvaluation(wrongBatch).problems.includes("queue-batch-size"));

  const wrongVersion = queueRecord();
  wrongVersion.scriptVersion.id = "33333333-3333-4333-8333-333333333333";
  assert.ok(queueEvaluation(wrongVersion).problems.includes("wrong-version"));

  const failed = queueRecord();
  failed.logs.push(log({
    event: "native_memory_queue_failed",
    type: "memory.post_turn.v2",
    userId: correlationId,
  }));
  assert.ok(queueEvaluation(failed).problems.includes("failure-log"));

  const missingCpu = queueRecord();
  missingCpu.cpuTime = Number.NaN;
  assert.ok(queueEvaluation(missingCpu).problems.includes("missing-or-negative-cpu"));

  const stale = queueRecord();
  stale.eventTimestamp = scheduledTime - 2_000;
  assert.ok(queueEvaluation(stale).problems.includes("stale-event-timestamp"));

  const duplicate = `${JSON.stringify(record)}\n${JSON.stringify(record)}`;
  assert.ok(evaluateProductionBackgroundTail(duplicate, {
    mode: "queue",
    expectedVersion: version,
    correlationId,
    captureStartedAt: scheduledTime - 1_000,
  }).problems.includes("matched-events=2"));
});

test("scheduled evidence requires the real daily cron, exact UTC occurrence, and clean logs", () => {
  const accepted = evaluateProductionBackgroundTail(JSON.stringify(scheduledRecord()), {
    mode: "scheduled",
    expectedVersion: version,
    expectedScheduledDay: "2026-07-13",
    captureStartedAt: scheduledTime - 1_000,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.cpuTimeMs, 2.5);

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

  const hybrid = scheduledRecord() as unknown as Record<string, unknown>;
  hybrid.event = {
    cron: "0 3 * * *",
    scheduledTime,
    queue: "wrong",
    request: { url: "https://inspirlearning.com/api/health" },
  };
  assert.equal(evaluateProductionBackgroundTail(JSON.stringify(hybrid), {
    mode: "scheduled",
    expectedVersion: version,
    expectedScheduledDay: "2026-07-13",
    captureStartedAt: scheduledTime - 1_000,
  }).matchedEvents, 0);

  const fetchLookalike = scheduledRecord() as unknown as Record<string, unknown>;
  fetchLookalike.event = { request: { url: "https://inspirlearning.com/api/health" } };
  assert.equal(evaluateProductionBackgroundTail(JSON.stringify(fetchLookalike), {
    mode: "scheduled",
    expectedVersion: version,
    expectedScheduledDay: "2026-07-13",
    captureStartedAt: scheduledTime - 1_000,
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
  assert.equal(tailHasReadinessProbe(JSON.stringify(record), "other", version), false);
  record.scriptVersion.id = "33333333-3333-4333-8333-333333333333";
  assert.equal(tailHasReadinessProbe(JSON.stringify(record), probe, version), false);
});

test("background production tail is version-only and the Queue probe is guaranteed stale", () => {
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
  assert.match(verifier, /assertSoleActiveVersion\(wrangler, expectedVersion\)/);

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
  return evaluateProductionBackgroundTail(JSON.stringify(record), {
    mode: "queue",
    expectedVersion: version,
    correlationId,
    captureStartedAt: scheduledTime - 1_000,
  });
}

function scheduledEvaluation(record: ReturnType<typeof scheduledRecord>) {
  return evaluateProductionBackgroundTail(JSON.stringify(record), {
    mode: "scheduled",
    expectedVersion: version,
    expectedScheduledDay: "2026-07-13",
    captureStartedAt: scheduledTime - 1_000,
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

function queueRecord() {
  return {
    ...commonRecord(),
    event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
    logs: [log({
      event: "native_memory_queue_processed",
      type: "memory.post_turn.v2",
      userId: correlationId,
      messageId: "queue-message",
      attempts: 1,
      outcome: "stale_job",
    })],
  };
}

function scheduledRecord() {
  return {
    ...commonRecord(),
    cpuTime: 2.5,
    event: { cron: "0 3 * * *", scheduledTime },
    logs: [log({
      event: "native_memory_scheduled_enqueued",
      due: 0,
      queued: 0,
      failed: 0,
      skipped: null,
      cron: "0 3 * * *",
    })],
  };
}

function log(value: Record<string, unknown>) {
  return {
    timestamp: scheduledTime,
    level: "log",
    message: [JSON.stringify(value)],
  };
}
