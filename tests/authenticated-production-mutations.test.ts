import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getCuratedMainAppTranslationBundle } from "../lib/i18n/main-app-curated";
import { buildStaticMainAppBundleAsset } from "../lib/i18n/main-app-static-asset";
import { maxProfileImageBytes } from "../lib/profile/photo";
import {
  authenticatedCriticalResourceTraceRequirements,
  authenticatedOutboxDrainMaximumAttempts,
  authenticatedOutboxDrainRetryDelayMs,
  authenticatedQueueSettlementQuietPeriodMs,
  authenticatedTailHasReadinessProbe,
  authenticatedTailReadinessIsCapturedByEveryTail,
  authenticatedMutationCpuThresholdMs,
  authenticatedMutationInventoryNames,
  authenticatedTurnVectorId,
  assertAuthenticatedMutationDisposableIdentity,
  assertAuthenticatedMutationResponseProof,
  assertCompleteFlashcardResult,
  assertCompleteQuizResult,
  buildAuthenticatedProfilePhotoProbe,
  cleanupDisposableMutationState,
  captureAuthenticatedTail,
  createAuthenticatedTailReadinessProbe,
  createAuthenticatedMutationProbe,
  evaluateAuthenticatedMemoryQueueTail,
  evaluateAuthenticatedMemoryQueueResourceWindow,
  evaluateAuthenticatedMemoryVectorCleanupQueueTail,
  evaluateAuthenticatedCriticalResourceTail,
  evaluateAuthenticatedMutationTail,
  evaluateAuthenticatedSemanticRetrievalTail,
  expectedAuthenticatedMutationDisposableIdentity,
  exactDisposableInventory,
  hasSpanishLanguageSignal,
  isPredominantlySpanishText,
  normalizeAuthenticatedMutationRoute,
  parseAuthenticatedTailJsonStream,
  parseCompleteAuthenticatedOpenAiSse,
  parseAuthenticatedMemoryRecoveryEvidence,
  runAuthenticatedProductionMutationFlow,
  runAuthenticatedMemoryRecoveryCleanup,
  resolveAuthenticatedMemoryRecoveryVersion,
  vectorAbsenceVerificationSpacingMs,
  vectorCleanupMinimumSettleMs,
  vectorStateTimeoutMs,
  type AuthenticatedMutationTrace,
} from "../scripts/cloudflare/verify-authenticated-production-mutations";

const MUTATION_TAIL_VERSION_ID = "11111111-1111-4111-8111-111111111111";

test("disposable response proof requires the exact deterministic email, identity, and runtime", () => {
  const candidateVersionId = "11111111-1111-4111-8111-111111111111";
  const runId = "22222222-2222-4222-8222-222222222222";
  const runtimeVersionId = "33333333-3333-4333-8333-333333333333";
  const identity = expectedAuthenticatedMutationDisposableIdentity(candidateVersionId, runId);
  assert.equal(
    identity.email,
    "e2e-111111111111-22222222222242228222222222222222@inspirlearning.invalid",
  );
  assert.deepEqual(
    assertAuthenticatedMutationDisposableIdentity(identity, { candidateVersionId, runId }),
    identity,
  );
  assert.deepEqual(
    assertAuthenticatedMutationResponseProof(
      { ok: true, runtimeVersionId, identity },
      { candidateVersionId, runId, runtimeVersionId },
    ).identity,
    identity,
  );
  assert.throws(
    () => assertAuthenticatedMutationDisposableIdentity(
      { ...identity, email: "e2e-wrong@inspirlearning.invalid" },
      { candidateVersionId, runId },
    ),
    /wrong deterministic/,
  );
  assert.throws(
    () => assertAuthenticatedMutationDisposableIdentity(
      { ...identity, extra: "not-allowed" },
      { candidateVersionId, runId },
    ),
    /wrong exact contract/,
  );
  assert.throws(
    () => assertAuthenticatedMutationResponseProof(
      { ok: true, runtimeVersionId: candidateVersionId, identity },
      { candidateVersionId, runId, runtimeVersionId },
    ),
    /wrong runtime Worker version/,
  );
});

test("profile-photo CPU probe is one exact bounded valid WebP RIFF container", () => {
  const probe = buildAuthenticatedProfilePhotoProbe();
  assert.equal(probe.byteLength, maxProfileImageBytes);
  assert.equal(probe.bytes.byteLength, maxProfileImageBytes);
  assert.equal(Buffer.from(probe.bytes.subarray(0, 4)).toString("ascii"), "RIFF");
  assert.equal(Buffer.from(probe.bytes.subarray(8, 12)).toString("ascii"), "WEBP");
  assert.equal(new DataView(probe.bytes.buffer).getUint32(4, true), maxProfileImageBytes - 8);
  assert.equal(probe.mimeType, "image/webp");
  assert.match(probe.sha256, /^[0-9a-f]{64}$/);
});

test("critical high-cost route matrix is independently mandatory and exact-version below 8ms", () => {
  const traces: AuthenticatedMutationTrace[] = authenticatedCriticalResourceTraceRequirements.map(
    (requirement, index) => {
      const probe = `inspir-critical-resource-${index}`;
      return {
        label: requirement.label,
        probe,
        origin: "https://inspirlearning.com",
        requestKey: `${requirement.routeTemplate}?authenticated_mutation_probe=${probe}`,
        routeTemplate: requirement.routeTemplate,
        method: requirement.method,
        status: requirement.status,
      };
    },
  );
  const acceptedTail = evaluateAuthenticatedMutationTail(
    traces.map((trace) => JSON.stringify(tailRecord(trace, 7.999))).join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(acceptedTail.ok, true);
  const accepted = evaluateAuthenticatedCriticalResourceTail(
    traces,
    acceptedTail.samples,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.requiredRouteCount, authenticatedCriticalResourceTraceRequirements.length);

  const missing = evaluateAuthenticatedCriticalResourceTail(
    traces.slice(1),
    acceptedTail.samples.slice(1),
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.includes("profile-photo-upload:required-trace-count=0"));

  const wrongVersionRecords = traces.map((trace, index) => {
    const record = tailRecord(trace, 1);
    if (index === 0) record.scriptVersion.id = "22222222-2222-4222-8222-222222222222";
    return JSON.stringify(record);
  }).join("\n");
  const wrongVersionTail = evaluateAuthenticatedMutationTail(
    wrongVersionRecords,
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  const wrongVersion = evaluateAuthenticatedCriticalResourceTail(
    traces,
    wrongVersionTail.samples,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(wrongVersion.ok, false);
  assert.ok(wrongVersion.problems.includes("profile-photo-upload:tail-version"));

  const atCpuBoundaryTail = evaluateAuthenticatedMutationTail(
    traces.map((trace, index) => JSON.stringify(tailRecord(trace, index === 0 ? 8 : 1))).join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  const atCpuBoundary = evaluateAuthenticatedCriticalResourceTail(
    traces,
    atCpuBoundaryTail.samples,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(atCpuBoundary.ok, false);
  assert.ok(atCpuBoundary.problems.includes("profile-photo-upload:tail-cpu>=8"));
});

test("tail evaluator requires one exact ok CPU sample below 8ms for every mutation request", () => {
  const traces: AuthenticatedMutationTrace[] = [
    {
      label: "chat-finalize",
      probe: "inspir-mutation-one",
      origin: "https://inspirlearning.com",
      requestKey: "/api/chat/finalize?authenticated_mutation_probe=inspir-mutation-one",
      routeTemplate: "/api/chat/finalize",
      method: "POST",
      status: 200,
    },
    {
      label: "quiz-result",
      probe: "inspir-mutation-two",
      origin: "https://inspirlearning.com",
      requestKey: "/api/chats/11111111-1111-4111-8111-111111111111?authenticated_mutation_probe=inspir-mutation-two",
      routeTemplate: "/api/chats/:uuid",
      method: "GET",
      status: 200,
    },
  ];
  const source = [
    tailRecord(traces[0], 7.999),
    tailRecord(traces[1], 1.25, "/api/chats/REDACTED"),
  ].map((record) => JSON.stringify(record)).join("\n");
  const accepted = evaluateAuthenticatedMutationTail(source, traces, MUTATION_TAIL_VERSION_ID);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.samples.length, 2);
  assert.equal(accepted.samples[1]?.routeTemplate, "/api/chats/:uuid");
  assert.equal(authenticatedMutationCpuThresholdMs, 8);

  const atLimit = evaluateAuthenticatedMutationTail(
    [tailRecord(traces[0], 8), tailRecord(traces[1], 1)]
      .map((record) => JSON.stringify(record))
      .join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(atLimit.ok, false);
  assert.ok(atLimit.problems.includes("chat-finalize:cpu>=8"));

  const negative = evaluateAuthenticatedMutationTail(
    [tailRecord(traces[0], -0.001), tailRecord(traces[1], 1, "/api/chats/REDACTED")]
      .map((record) => JSON.stringify(record))
      .join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(negative.ok, false);
  assert.ok(negative.problems.includes("chat-finalize:cpu<0"));

  const missing = evaluateAuthenticatedMutationTail(
    JSON.stringify(tailRecord(traces[0], 1)),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.includes("quiz-result:tail-count=0"));

  const exceptional = tailRecord(traces[0], 1);
  exceptional.outcome = "exception";
  exceptional.exceptions = [{ message: "redacted" }];
  const rejected = evaluateAuthenticatedMutationTail(
    [exceptional, tailRecord(traces[1], 1)].map((record) => JSON.stringify(record)).join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(rejected.ok, false);
  assert.ok(rejected.problems.includes("chat-finalize:outcome"));
  assert.ok(rejected.problems.includes("chat-finalize:exception"));

  const missingExceptions = Object.fromEntries(
    Object.entries(tailRecord(traces[0], 1)).filter(([key]) => key !== "exceptions"),
  );
  const missingExceptionsEvaluation = evaluateAuthenticatedMutationTail(
    [missingExceptions, tailRecord(traces[1], 1)]
      .map((record) => JSON.stringify(record))
      .join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.ok(missingExceptionsEvaluation.problems.includes("chat-finalize:exception"));

  const resourceEvent = evaluateAuthenticatedMutationTail(
    `${source}\n${JSON.stringify({ outcome: "exceededMemory", logs: [] })}`,
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(resourceEvent.ok, false);
  assert.ok(resourceEvent.problems.includes("forbidden-resource-event"));

  const applicationWords = evaluateAuthenticatedMutationTail(
    `${source}\n${JSON.stringify({
      outcome: "ok",
      event: { request: { url: "https://inspirlearning.com/note?q=exceededMemory" } },
      logs: [{
        level: "log",
        message: ["exceededCpu overload sampled dropped"],
        timestamp: 1_783_921_234_567,
      }],
    })}`,
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.equal(applicationWords.ok, true);

  const wrongVersion = tailRecord(traces[0], 1);
  wrongVersion.scriptVersion.id = "22222222-2222-4222-8222-222222222222";
  const wrongVersionEvaluation = evaluateAuthenticatedMutationTail(
    [wrongVersion, tailRecord(traces[1], 1)].map((record) => JSON.stringify(record)).join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.ok(wrongVersionEvaluation.problems.includes("chat-finalize:version"));

  const wrongScript = tailRecord(traces[0], 1);
  wrongScript.scriptName = "other-worker";
  const wrongScriptEvaluation = evaluateAuthenticatedMutationTail(
    [wrongScript, tailRecord(traces[1], 1)]
      .map((record) => JSON.stringify(record))
      .join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.ok(wrongScriptEvaluation.problems.includes("chat-finalize:script"));

  const truncated = tailRecord(traces[0], 1);
  truncated.truncated = true;
  const truncatedEvaluation = evaluateAuthenticatedMutationTail(
    [truncated, tailRecord(traces[1], 1)].map((record) => JSON.stringify(record)).join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.ok(truncatedEvaluation.problems.includes("chat-finalize:truncated"));

  const warned = tailRecord(traces[0], 1);
  warned.logs.push({
    level: "warn",
    message: ["validation warning"],
    timestamp: 1_783_921_234_567,
  });
  const warnedEvaluation = evaluateAuthenticatedMutationTail(
    [warned, tailRecord(traces[1], 1)].map((record) => JSON.stringify(record)).join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.ok(warnedEvaluation.problems.includes("chat-finalize:warning-or-error-log"));

  const invalidLogs = { ...tailRecord(traces[0], 1), logs: null };
  const invalidLogsEvaluation = evaluateAuthenticatedMutationTail(
    [invalidLogs, tailRecord(traces[1], 1)].map((record) => JSON.stringify(record)).join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.ok(invalidLogsEvaluation.problems.includes("chat-finalize:log-shape"));

  const invalidWallTime = { ...tailRecord(traces[0], 1), wallTime: -1 };
  const invalidWallTimeEvaluation = evaluateAuthenticatedMutationTail(
    [invalidWallTime, tailRecord(traces[1], 1)]
      .map((record) => JSON.stringify(record))
      .join("\n"),
    traces,
    MUTATION_TAIL_VERSION_ID,
  );
  assert.ok(
    invalidWallTimeEvaluation.problems.includes("chat-finalize:missing-or-negative-wall-time"),
  );

  for (const [url, expectedProblem] of [
    [
      "http://inspirlearning.com/api/chats/11111111-1111-4111-8111-111111111111?authenticated_mutation_probe=inspir-mutation-two",
      "quiz-result:tail-origin",
    ],
    [
      "https://evil.example/api/chats/11111111-1111-4111-8111-111111111111?authenticated_mutation_probe=inspir-mutation-two",
      "quiz-result:tail-origin",
    ],
    [
      "https://inspirlearning.com/api/chats/22222222-2222-4222-8222-222222222222?authenticated_mutation_probe=inspir-mutation-two",
      "quiz-result:tail-request-key",
    ],
  ] as const) {
    const variant = structuredClone(tailRecord(traces[1], 1));
    variant.event.request.url = url;
    const evaluation = evaluateAuthenticatedMutationTail(
      [tailRecord(traces[0], 1), variant]
        .map((record) => JSON.stringify(record))
        .join("\n"),
      traces,
      MUTATION_TAIL_VERSION_ID,
    );
    assert.ok(evaluation.problems.includes(expectedProblem));
  }

  const queryTrace: AuthenticatedMutationTrace = {
    label: "query-bound",
    probe: "inspir-mutation-query-bound",
    origin: "https://inspirlearning.com",
    requestKey:
      "/api/chat/finalize?mode=full&authenticated_mutation_probe=inspir-mutation-query-bound",
    routeTemplate: "/api/chat/finalize",
    method: "POST",
    status: 200,
  };
  assert.equal(
    evaluateAuthenticatedMutationTail(
      JSON.stringify(tailRecord(queryTrace, 1)),
      [queryTrace],
      MUTATION_TAIL_VERSION_ID,
    ).ok,
    true,
  );
  for (const mode of [null, "changed"] as const) {
    const variant = structuredClone(tailRecord(queryTrace, 1));
    const url = new URL(variant.event.request.url);
    if (mode === null) url.searchParams.delete("mode");
    else url.searchParams.set("mode", mode);
    variant.event.request.url = url.href;
    assert.ok(evaluateAuthenticatedMutationTail(
      JSON.stringify(variant),
      [queryTrace],
      MUTATION_TAIL_VERSION_ID,
    ).problems.includes("query-bound:tail-request-key"));
  }
});

test("stored-memory Queue evidence requires one authenticated-version invocation with indexed vectors", () => {
  const authenticatedValidationVersionId = "11111111-1111-4111-8111-111111111111";
  const userId = "22222222-2222-4222-8222-222222222222";
  const acceptedRecord = storedMemoryQueueTailRecord({
    authenticatedValidationVersionId,
    userId,
    cpuTimeMs: 7.999,
    indexedVectorCount: 1,
  });
  const accepted = evaluateAuthenticatedMemoryQueueTail(JSON.stringify(acceptedRecord), {
    authenticatedValidationVersionId,
    userId,
    successObservedAt: 1_000,
    observationEndedAt: 1_000 + authenticatedQueueSettlementQuietPeriodMs,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.matchedEvents, 1);
  assert.equal(accepted.indexedVectorCount, 1);
  assert.ok(authenticatedQueueSettlementQuietPeriodMs >= 65_000);

  const tooEarly = evaluateAuthenticatedMemoryQueueTail(JSON.stringify(acceptedRecord), {
    authenticatedValidationVersionId,
    userId,
    successObservedAt: 1_000,
    observationEndedAt: 1_000 + authenticatedQueueSettlementQuietPeriodMs - 1,
  });
  assert.equal(tooEarly.ok, false);
  assert.equal(tooEarly.fatal, false);
  assert.ok(tooEarly.problems.includes("queue-observation-not-settled"));

  const wrongBatch = structuredClone(acceptedRecord);
  wrongBatch.event.batchSize = 2;
  assert.ok(evaluateAuthenticatedMemoryQueueTail(JSON.stringify(wrongBatch), {
    authenticatedValidationVersionId,
    userId,
  }).problems.includes("queue-batch-size"));

  const warned = structuredClone(acceptedRecord);
  warned.logs.push(tailStructuredLog("warn", {
    event: "native_memory_vector_write_failed",
    error: "TypeError",
  }));
  assert.ok(evaluateAuthenticatedMemoryQueueTail(JSON.stringify(warned), {
    authenticatedValidationVersionId,
    userId,
  }).problems.includes("failure-log"));

  const duplicate = `${JSON.stringify(acceptedRecord)}\n${JSON.stringify(acceptedRecord)}`;
  assert.ok(evaluateAuthenticatedMemoryQueueTail(duplicate, {
    authenticatedValidationVersionId,
    userId,
  }).problems.includes("matched-events=2"));

  const conflictingTerminal = structuredClone(acceptedRecord);
  conflictingTerminal.logs.push(tailStructuredLog("log", {
    event: "native_memory_queue_processed",
    type: "memory.post_turn.v2",
    userId,
    messageId: "queue-message-id",
    attempts: 1,
    outcome: "stale_job",
  }));
  assert.ok(evaluateAuthenticatedMemoryQueueTail(JSON.stringify(conflictingTerminal), {
    authenticatedValidationVersionId,
    userId,
  }).problems.includes("stored-log-count=2"));

  const atLimit = structuredClone(acceptedRecord);
  atLimit.cpuTime = 8;
  assert.ok(evaluateAuthenticatedMemoryQueueTail(JSON.stringify(atLimit), {
    authenticatedValidationVersionId,
    userId,
  }).problems.includes("cpu>=8"));

  const missingQueue = structuredClone(acceptedRecord);
  delete (missingQueue.event as Partial<typeof missingQueue.event>).queue;
  const missingQueueEvaluation = evaluateAuthenticatedMemoryQueueTail(
    JSON.stringify(missingQueue),
    {
      authenticatedValidationVersionId,
      userId,
      successObservedAt: 1_000,
      observationEndedAt: 1_000 + authenticatedQueueSettlementQuietPeriodMs,
    },
  );
  assert.equal(missingQueueEvaluation.matchedEvents, 1);
  assert.ok(missingQueueEvaluation.problems.includes("queue-event-shape"));
  assert.ok(missingQueueEvaluation.problems.includes("queue-name"));
});

test("Vectorize cleanup Queue evidence requires a reason-bound settled chain without capture loss", () => {
  const authenticatedValidationVersionId = "11111111-1111-4111-8111-111111111111";
  const reason = "e2e-cleanup-22222222222242228222222222222222-1";
  const eventTimestampBase = 1_783_921_234_000;
  const settledWindow = {
    successObservedAt: 1_000,
    observationEndedAt: 1_000 + authenticatedQueueSettlementQuietPeriodMs,
  };
  const processed = vectorCleanupQueueTailRecord({
    authenticatedValidationVersionId,
    cpuTimeMs: 7.999,
    eventTimestamp: eventTimestampBase + 1_000,
    reason,
    terminal: "processed",
    pending: 0,
  });
  const accepted = evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    JSON.stringify(processed),
    { authenticatedValidationVersionId, reason, ...settledWindow },
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.fatal, false);
  assert.equal(accepted.settled, true);
  assert.equal(accepted.matchedEvents, 1);
  assert.equal(accepted.processedEvents, 1);
  assert.equal(accepted.maximumCpuTimeMs, 7.999);
  assert.equal(accepted.samples[0]?.reason, reason);
  assert.equal(accepted.samples[0]?.pending, 0);

  const wrongVersion = structuredClone(processed);
  wrongVersion.scriptVersion.id = "33333333-3333-4333-8333-333333333333";
  assert.ok(evaluateAuthenticatedMemoryVectorCleanupQueueTail(JSON.stringify(wrongVersion), {
    authenticatedValidationVersionId,
    reason,
    ...settledWindow,
  }).problems.includes("wrong-authenticated-validation-version"));

  const atCpuLimit = structuredClone(processed);
  atCpuLimit.cpuTime = 8;
  assert.ok(evaluateAuthenticatedMemoryVectorCleanupQueueTail(JSON.stringify(atCpuLimit), {
    authenticatedValidationVersionId,
    reason,
    ...settledWindow,
  }).problems.includes("cpu>=8"));

  const wrongReason = evaluateAuthenticatedMemoryVectorCleanupQueueTail(JSON.stringify(processed), {
    authenticatedValidationVersionId,
    reason: `${reason}-wrong`,
    ...settledWindow,
  });
  assert.equal(wrongReason.matchedEvents, 0);
  assert.equal(wrongReason.settled, false);
  assert.equal(wrongReason.fatal, false);

  const deferred = vectorCleanupQueueTailRecord({
    authenticatedValidationVersionId,
    cpuTimeMs: 2.5,
    eventTimestamp: eventTimestampBase + 2_000,
    reason,
    terminal: "deferred",
  });
  const deferredOnly = evaluateAuthenticatedMemoryVectorCleanupQueueTail(JSON.stringify(deferred), {
    authenticatedValidationVersionId,
    reason,
    ...settledWindow,
  });
  assert.equal(deferredOnly.ok, false);
  assert.equal(deferredOnly.fatal, false);
  assert.equal(deferredOnly.settled, false);
  assert.ok(deferredOnly.problems.includes("cleanup-chain-not-settled"));

  const deferredThenSettled = evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    `${JSON.stringify(deferred)}\n${JSON.stringify(vectorCleanupQueueTailRecord({
      authenticatedValidationVersionId,
      cpuTimeMs: 2.25,
      eventTimestamp: eventTimestampBase + 3_000,
      reason,
      terminal: "processed",
      pending: 0,
      attempts: 2,
    }))}`,
    { authenticatedValidationVersionId, reason, ...settledWindow },
  );
  assert.equal(deferredThenSettled.ok, true);
  assert.equal(deferredThenSettled.deferredEvents, 1);

  const pending = vectorCleanupQueueTailRecord({
    authenticatedValidationVersionId,
    cpuTimeMs: 2,
    eventTimestamp: eventTimestampBase + 4_000,
    reason,
    terminal: "processed",
    pending: 1,
  });
  const continuedThenSettled = evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    `${JSON.stringify(pending)}\n${JSON.stringify(vectorCleanupQueueTailRecord({
      authenticatedValidationVersionId,
      cpuTimeMs: 2,
      eventTimestamp: eventTimestampBase + 5_000,
      reason,
      terminal: "processed",
      pending: 0,
      messageId: "cleanup-continuation-message-id",
    }))}`,
    { authenticatedValidationVersionId, reason, ...settledWindow },
  );
  assert.equal(continuedThenSettled.ok, true);
  assert.equal(continuedThenSettled.processedEvents, 2);

  const cpuKilled = vectorCleanupQueueTailRecord({
    authenticatedValidationVersionId,
    cpuTimeMs: 7.5,
    eventTimestamp: eventTimestampBase + 6_000,
    reason,
    terminal: "none",
    outcome: "exceededCpu",
  });
  const killedThenSuccessful = evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    `${JSON.stringify(cpuKilled)}\n${JSON.stringify(vectorCleanupQueueTailRecord({
      authenticatedValidationVersionId,
      cpuTimeMs: 2,
      eventTimestamp: eventTimestampBase + 7_000,
      reason,
      terminal: "processed",
      pending: 0,
      attempts: 2,
    }))}`,
    { authenticatedValidationVersionId, reason, ...settledWindow },
  );
  assert.equal(killedThenSuccessful.ok, false);
  assert.equal(killedThenSuccessful.fatal, true);
  assert.ok(killedThenSuccessful.problems.includes("outcome"));
  assert.ok(killedThenSuccessful.problems.includes("cleanup-terminal-log-count=0"));

  const failedThenSuccessful = evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    `${JSON.stringify(vectorCleanupQueueTailRecord({
      authenticatedValidationVersionId,
      cpuTimeMs: 2,
      eventTimestamp: eventTimestampBase + 8_000,
      reason,
      terminal: "failed",
    }))}\n${JSON.stringify(vectorCleanupQueueTailRecord({
      authenticatedValidationVersionId,
      cpuTimeMs: 2,
      eventTimestamp: eventTimestampBase + 9_000,
      reason,
      terminal: "processed",
      pending: 0,
      attempts: 2,
    }))}`,
    { authenticatedValidationVersionId, reason, ...settledWindow },
  );
  assert.equal(failedThenSuccessful.ok, false);
  assert.ok(failedThenSuccessful.problems.includes("failure-log"));

  const malformed = structuredClone(processed);
  const terminal = JSON.parse(malformed.logs[1]?.message[0] ?? "null") as Record<string, unknown>;
  terminal.outcome = {
    claimed: 1,
    deleteRequested: 1,
    verifiedAbsent: 1,
    pending: 0,
    nextDelaySeconds: null,
  };
  malformed.logs[1] = tailStructuredLog("log", terminal);
  assert.ok(evaluateAuthenticatedMemoryVectorCleanupQueueTail(JSON.stringify(malformed), {
    authenticatedValidationVersionId,
    reason,
    ...settledWindow,
  }).problems.includes("malformed-cleanup-processed-log"));

  const missingStart = vectorCleanupQueueTailRecord({
    authenticatedValidationVersionId,
    cpuTimeMs: 2,
    eventTimestamp: eventTimestampBase + 10_000,
    reason,
    terminal: "processed",
    pending: 0,
    includeStart: false,
  });
  assert.ok(evaluateAuthenticatedMemoryVectorCleanupQueueTail(JSON.stringify(missingStart), {
    authenticatedValidationVersionId,
    reason,
    ...settledWindow,
  }).problems.includes("cleanup-start-log-count=0"));

  const overload = JSON.stringify({
    event: { type: "overload", message: "Tail overloaded; events were dropped." },
  });
  assert.ok(evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    `${JSON.stringify(processed)}\n${overload}`,
    { authenticatedValidationVersionId, reason, ...settledWindow },
  ).problems.includes("tail-capture-loss"));
  assert.ok(evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    JSON.stringify(processed),
    {
      authenticatedValidationVersionId,
      reason,
      ...settledWindow,
      tailDiagnostics: "Tail is sampling events",
    },
  ).problems.includes("tail-capture-loss"));
  assert.ok(evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    JSON.stringify(processed),
    {
      authenticatedValidationVersionId,
      reason,
      ...settledWindow,
      tailDiagnostics: "Tail connection lost. Reconnecting (attempt 1 of 3)",
    },
  ).problems.includes("tail-capture-loss"));

  const secondsTimestamp = structuredClone(processed);
  secondsTimestamp.eventTimestamp = 1_783_921_235;
  const secondsEvaluation = evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    JSON.stringify(secondsTimestamp),
    { authenticatedValidationVersionId, reason, ...settledWindow },
  );
  assert.equal(secondsEvaluation.matchedEvents, 1);
  assert.equal(secondsEvaluation.settled, true);
});

test("authenticated Queue windows are offset-scoped, resource-complete, and liveness-bound", () => {
  const authenticatedValidationVersionId = MUTATION_TAIL_VERSION_ID;
  const userId = "22222222-2222-4222-8222-222222222222";
  const reason = "e2e-cleanup-22222222222242228222222222222222-1";
  const successObservedAt = 1_000;
  const observationEndedAt = successObservedAt + authenticatedQueueSettlementQuietPeriodMs;
  const prefix = `${JSON.stringify(authenticatedReadinessTailRecord({
    expectedVersion: authenticatedValidationVersionId,
    probe: "inspir-auth-tail-ready-1783921234567-42",
  }))}\n`;
  const stored = storedMemoryQueueTailRecord({
    authenticatedValidationVersionId,
    userId,
    cpuTimeMs: 2,
    indexedVectorCount: 1,
  });
  const settledProbe = "inspir-auth-tail-ready-1783921234568-42";
  const settledMarker = authenticatedReadinessTailRecord({
    expectedVersion: authenticatedValidationVersionId,
    probe: settledProbe,
  });
  const source = `${prefix}${JSON.stringify(stored)}\n${JSON.stringify(settledMarker)}`;
  const accepted = evaluateAuthenticatedMemoryQueueTail(source, {
    authenticatedValidationVersionId,
    userId,
    captureOutputOffset: prefix.length,
    successObservedAt,
    observationEndedAt,
    settledLivenessProbe: settledProbe,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.captureOutputOffset, prefix.length);
  assert.equal(accepted.settledLivenessProbe, settledProbe);

  const missingMarker = evaluateAuthenticatedMemoryQueueTail(
    `${prefix}${JSON.stringify(stored)}`,
    {
      authenticatedValidationVersionId,
      userId,
      captureOutputOffset: prefix.length,
      successObservedAt,
      observationEndedAt,
      settledLivenessProbe: settledProbe,
    },
  );
  assert.ok(missingMarker.problems.includes("settled-liveness-marker"));

  const queueLikeWithoutName = {
    scriptName: "inspirlearning",
    scriptVersion: { id: authenticatedValidationVersionId },
    outcome: "ok",
    truncated: false,
    cpuTime: 1,
    wallTime: 2,
    eventTimestamp: 1_783_921_234_999,
    exceptions: [] as Array<{ message: string }>,
    event: { batchSize: 1 },
    logs: [] as Array<{ level: string; message: string[]; timestamp: number }>,
  };
  const resourceOnly = evaluateAuthenticatedMemoryQueueResourceWindow(
    `${prefix}${JSON.stringify(queueLikeWithoutName)}`,
    {
      authenticatedValidationVersionId,
      captureOutputOffset: prefix.length,
    },
  );
  assert.equal(resourceOnly.matchedEvents, 1);
  assert.ok(resourceOnly.problems.includes("queue-event-shape"));
  assert.ok(resourceOnly.problems.includes("queue-name"));
  for (const queue of [null, "other-queue", 42]) {
    const wrongQueue = evaluateAuthenticatedMemoryQueueResourceWindow(
      JSON.stringify({
        ...queueLikeWithoutName,
        event: { queue, batchSize: 1 },
      }),
      { authenticatedValidationVersionId },
    );
    assert.equal(wrongQueue.matchedEvents, 1);
    assert.ok(wrongQueue.problems.includes("queue-name"));
  }

  const overloadPrefix = `${JSON.stringify({ event: { type: "overload-stop" } })}\n`;
  const fullCaptureLoss = evaluateAuthenticatedMemoryQueueResourceWindow(
    `${overloadPrefix}${JSON.stringify({
      ...queueLikeWithoutName,
      event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
    })}`,
    {
      authenticatedValidationVersionId,
      captureOutputOffset: overloadPrefix.length,
    },
  );
  assert.equal(fullCaptureLoss.matchedEvents, 1);
  assert.ok(fullCaptureLoss.problems.includes("tail-capture-loss"));

  const unclassifiableResourceFailure = evaluateAuthenticatedMemoryQueueResourceWindow(
    `${JSON.stringify({
      ...queueLikeWithoutName,
      event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
    })}\n${JSON.stringify({
      scriptName: "inspirlearning",
      scriptVersion: { id: authenticatedValidationVersionId },
      outcome: "exceededCpu",
      truncated: false,
      cpuTime: 8,
      eventTimestamp: 1_783_921_235_000,
      exceptions: [] as Array<{ message: string }>,
      event: {},
      logs: [] as Array<{ level: string; message: string[] }>,
    })}`,
    { authenticatedValidationVersionId },
  );
  assert.equal(unclassifiableResourceFailure.ok, false);
  assert.ok(unclassifiableResourceFailure.problems.includes("outcome"));
  assert.ok(unclassifiableResourceFailure.problems.includes("cpu>=8"));
  const healthyButUnclassified = evaluateAuthenticatedMemoryQueueResourceWindow(
    `${JSON.stringify({
      ...queueLikeWithoutName,
      event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
    })}\n${JSON.stringify({
      scriptName: "inspirlearning",
      scriptVersion: { id: authenticatedValidationVersionId },
      outcome: "ok",
      truncated: false,
      cpuTime: 1,
      eventTimestamp: 1_783_921_235_000,
      exceptions: [] as Array<{ message: string }>,
      event: {},
      logs: [] as Array<{ level: string; message: string[] }>,
    })}`,
    { authenticatedValidationVersionId },
  );
  assert.equal(healthyButUnclassified.ok, false);
  assert.ok(healthyButUnclassified.problems.includes("unclassified-invocation"));
  const healthyOtherHandlers = evaluateAuthenticatedMemoryQueueResourceWindow(
    [
      {
        ...queueLikeWithoutName,
        event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
      },
      {
        ...queueLikeWithoutName,
        event: authenticatedFetchTailEvent(),
      },
      {
        ...queueLikeWithoutName,
        event: { cron: "0 3 * * *", scheduledTime: 1_783_900_800_000 },
      },
    ].map((record) => JSON.stringify(record)).join("\n"),
    { authenticatedValidationVersionId },
  );
  assert.equal(healthyOtherHandlers.ok, true);
  assert.equal(healthyOtherHandlers.matchedEvents, 1);
  for (const event of [
    authenticatedFetchTailEvent(),
    { cron: "0 3 * * *", scheduledTime: 1_783_900_800_000 },
  ]) {
    for (const [mutation, expectedProblem] of [
      [{ eventTimestamp: null }, "invalid-event-timestamp"],
      [{ eventTimestamp: -1 }, "invalid-event-timestamp"],
      [{ wallTime: null }, "missing-or-negative-wall-time"],
      [{ wallTime: -1 }, "missing-or-negative-wall-time"],
      [{ logs: null }, "log-shape"],
    ] as const) {
      const incompleteResourceRecord = evaluateAuthenticatedMemoryQueueResourceWindow(
        `${JSON.stringify({
          ...queueLikeWithoutName,
          event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
        })}\n${JSON.stringify({ ...queueLikeWithoutName, event, ...mutation })}`,
        { authenticatedValidationVersionId },
      );
      assert.equal(incompleteResourceRecord.ok, false);
      assert.ok(incompleteResourceRecord.problems.includes(expectedProblem));
    }
  }
  for (const record of [
    {
      ...queueLikeWithoutName,
      scriptName: "other-worker",
      event: authenticatedFetchTailEvent(),
    },
    {
      ...queueLikeWithoutName,
      scriptVersion: { id: "33333333-3333-4333-8333-333333333333" },
      event: authenticatedFetchTailEvent(),
    },
    {
      ...queueLikeWithoutName,
      scriptName: null,
      scriptVersion: null,
      event: { cron: "0 3 * * *", scheduledTime: 1_783_900_800_000 },
    },
  ]) {
    const wrongHandlerIdentity = evaluateAuthenticatedMemoryQueueResourceWindow(
      `${JSON.stringify({
        ...queueLikeWithoutName,
        event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
      })}\n${JSON.stringify(record)}`,
      { authenticatedValidationVersionId },
    );
    assert.equal(wrongHandlerIdentity.ok, false);
    assert.ok(
      wrongHandlerIdentity.problems.includes("wrong-script") ||
        wrongHandlerIdentity.problems.includes("wrong-authenticated-validation-version"),
    );
  }
  for (const event of [
    { request: {} },
    { request: { method: 42, url: null } },
    { request: { method: "GET", url: "not-a-url" } },
    { request: { method: "get", url: "https://inspirlearning.com/" }, response: { status: 200 } },
    { request: { method: "GET", url: "/relative" }, response: { status: 200 } },
    { request: { method: "GET", url: "https://inspirlearning.com/" } },
    {
      request: { method: "GET", url: "https://inspirlearning.com/" },
      response: { status: "200" },
    },
    {
      request: { method: "GET", url: "https://inspirlearning.com/" },
      response: { status: 99 },
    },
    { cron: null },
    { scheduledTime: "bad" },
    { cron: "0 3 * * *" },
    { scheduledTime: 1_783_900_800_000 },
    { cron: "*/5 * * * *", scheduledTime: 1_783_900_800_000 },
    { cron: "0 3 * * *", scheduledTime: 1_783_900_800_000, extra: true },
  ]) {
    const malformedOtherHandler = evaluateAuthenticatedMemoryQueueResourceWindow(
      [
        {
          ...queueLikeWithoutName,
          event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
        },
        { ...queueLikeWithoutName, event },
      ].map((record) => JSON.stringify(record)).join("\n"),
      { authenticatedValidationVersionId },
    );
    assert.equal(malformedOtherHandler.ok, false);
    assert.ok(malformedOtherHandler.problems.includes("unclassified-invocation"));
  }
  const nestedFetchVariants = [
    {
      request: {
        cf: {},
        method: "GET",
        url: "https://inspirlearning.com/api/health",
      },
      response: { status: 200 },
    },
    {
      request: {
        cf: {},
        headers: null,
        method: "GET",
        url: "https://inspirlearning.com/api/health",
      },
      response: { status: 200 },
    },
    {
      request: {
        cf: {},
        headers: [],
        method: "GET",
        url: "https://inspirlearning.com/api/health",
      },
      response: { status: 200 },
    },
    {
      request: {
        cf: {},
        headers: { accept: 42 },
        method: "GET",
        url: "https://inspirlearning.com/api/health",
      },
      response: { status: 200 },
    },
    {
      request: {
        cf: {},
        headers: {},
        method: "GET",
        url: "https://inspirlearning.com/api/health",
        extra: true,
      },
      response: { status: 200 },
    },
    {
      request: {
        cf: {},
        headers: {},
        method: "GET",
        url: "https://inspirlearning.com/api/health",
      },
      response: { status: 200, extra: true },
    },
  ];
  for (const event of nestedFetchVariants) {
    const malformedNestedFetch = evaluateAuthenticatedMemoryQueueResourceWindow(
      [
        {
          ...queueLikeWithoutName,
          event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
        },
        { ...queueLikeWithoutName, event },
      ].map((record) => JSON.stringify(record)).join("\n"),
      { authenticatedValidationVersionId },
    );
    assert.equal(malformedNestedFetch.ok, false);
    assert.ok(malformedNestedFetch.problems.includes("unclassified-invocation"));
  }
  for (const event of [
    { request: {} },
    authenticatedFetchTailEvent("https://inspirlearning.com/"),
    { cron: "0 3 * * *", scheduledTime: 1_783_900_800_000 },
  ]) {
    const eventOnlyInvocation = evaluateAuthenticatedMemoryQueueResourceWindow(
      `${JSON.stringify({
        ...queueLikeWithoutName,
        event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
      })}\n${JSON.stringify({ event })}`,
      { authenticatedValidationVersionId },
    );
    assert.equal(eventOnlyInvocation.ok, false);
    assert.ok(eventOnlyInvocation.problems.includes("outcome"));
    assert.ok(eventOnlyInvocation.problems.includes("missing-or-negative-cpu"));
  }
  for (const event of [
    { mailFrom: "a@example.com", rcptTo: "b@example.com", rawSize: 1 },
    { rpcMethod: "x" },
    { consumedEvents: [] },
    { getWebSocketEvent: { webSocketEventType: "message" } },
  ]) {
    const unsupportedTrigger = evaluateAuthenticatedMemoryQueueResourceWindow(
      `${JSON.stringify({
        ...queueLikeWithoutName,
        event: { queue: "inspirlearning-memory-post-turn-prod", batchSize: 1 },
      })}\n${JSON.stringify({ event })}`,
      { authenticatedValidationVersionId },
    );
    assert.equal(unsupportedTrigger.ok, false);
    assert.ok(unsupportedTrigger.problems.includes("unclassified-invocation"));
  }
  for (const identity of [
    {},
    { scriptName: null },
    { scriptName: null, scriptVersion: null },
  ]) {
    const missingIdentityResourceFailure = evaluateAuthenticatedMemoryQueueResourceWindow(
      JSON.stringify({
        ...identity,
        outcome: "exceededCpu",
        truncated: false,
        cpuTime: 8,
        eventTimestamp: 1_783_921_235_000,
        exceptions: [] as Array<{ message: string }>,
        event: {},
        logs: [] as Array<{ level: string; message: string[] }>,
      }),
      { authenticatedValidationVersionId },
    );
    assert.equal(missingIdentityResourceFailure.ok, false);
    assert.ok(missingIdentityResourceFailure.problems.includes("outcome"));
    assert.ok(missingIdentityResourceFailure.problems.includes("cpu>=8"));
  }
  const unclassifiableBase = {
    scriptName: "inspirlearning",
    scriptVersion: { id: authenticatedValidationVersionId },
    outcome: "ok",
    truncated: false,
    cpuTime: 1 as number | undefined,
    eventTimestamp: 1_783_921_235_001,
    exceptions: [] as Array<{ message: string }>,
    event: {},
    logs: [] as Array<{ level: string; message: string[] }>,
  };
  for (const [mutation, expectedProblem] of [
    [{ cpuTime: undefined }, "missing-or-negative-cpu"],
    [{ cpuTime: -0.1 }, "missing-or-negative-cpu"],
    [{ truncated: true }, "truncated"],
    [{ exceptions: [{ message: "redacted" }] }, "exceptions"],
    [{
      logs: [{
        level: "warn",
        message: ["redacted"],
        timestamp: 1_783_921_234_567,
      }],
    }, "failure-log"],
  ] as const) {
    const evaluation = evaluateAuthenticatedMemoryQueueResourceWindow(
      JSON.stringify({ ...unclassifiableBase, ...mutation }),
      { authenticatedValidationVersionId },
    );
    assert.equal(evaluation.ok, false);
    assert.ok(evaluation.problems.includes(expectedProblem));
  }

  const cleanup = vectorCleanupQueueTailRecord({
    authenticatedValidationVersionId,
    cpuTimeMs: 2,
    eventTimestamp: 1_783_921_235_000,
    reason,
    terminal: "processed",
    pending: 0,
  });
  delete (cleanup.event as Partial<typeof cleanup.event>).queue;
  const missingCleanupQueue = evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    JSON.stringify(cleanup),
    { authenticatedValidationVersionId, reason, successObservedAt, observationEndedAt },
  );
  assert.equal(missingCleanupQueue.matchedEvents, 1);
  assert.ok(missingCleanupQueue.problems.includes("queue-event-shape"));
  assert.ok(missingCleanupQueue.problems.includes("queue-name"));
});

test("authenticated cleanup Queue evidence rejects retry and continuation discontinuities", () => {
  const authenticatedValidationVersionId = MUTATION_TAIL_VERSION_ID;
  const reason = "e2e-cleanup-22222222222242228222222222222222-1";
  const window = {
    successObservedAt: 1_000,
    observationEndedAt: 1_000 + authenticatedQueueSettlementQuietPeriodMs,
  };
  const deferred = vectorCleanupQueueTailRecord({
    authenticatedValidationVersionId,
    cpuTimeMs: 1,
    eventTimestamp: 1_783_921_235_001,
    reason,
    terminal: "deferred",
  });
  const skippedRetry = vectorCleanupQueueTailRecord({
    authenticatedValidationVersionId,
    cpuTimeMs: 1,
    eventTimestamp: 1_783_921_235_002,
    reason,
    terminal: "processed",
    pending: 0,
    attempts: 3,
  });
  const retryGap = evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    `${JSON.stringify(deferred)}\n${JSON.stringify(skippedRetry)}`,
    { authenticatedValidationVersionId, reason, ...window },
  );
  assert.ok(retryGap.problems.includes("cleanup-attempt-sequence"));
  assert.ok(retryGap.problems.includes("cleanup-retry-discontinuity"));

  const pending = vectorCleanupQueueTailRecord({
    authenticatedValidationVersionId,
    cpuTimeMs: 1,
    eventTimestamp: 1_783_921_235_003,
    reason,
    terminal: "processed",
    pending: 1,
  });
  const sameMessageContinuation = vectorCleanupQueueTailRecord({
    authenticatedValidationVersionId,
    cpuTimeMs: 1,
    eventTimestamp: 1_783_921_235_004,
    reason,
    terminal: "processed",
    pending: 0,
  });
  const continuationGap = evaluateAuthenticatedMemoryVectorCleanupQueueTail(
    `${JSON.stringify(pending)}\n${JSON.stringify(sameMessageContinuation)}`,
    { authenticatedValidationVersionId, reason, ...window },
  );
  assert.ok(continuationGap.problems.includes("cleanup-attempt-sequence"));
  assert.ok(continuationGap.problems.includes("cleanup-continuation-discontinuity"));
});

test("authenticated Tail uses lossless closed JSON framing and UTF-8-safe shared capture", async () => {
  const complete = JSON.stringify({ event: { type: "note", message: "🙂" } });
  const live = parseAuthenticatedTailJsonStream(`${complete}\n{"event":`, false);
  assert.equal(live.records.length, 1);
  assert.equal(live.problem, null);
  assert.equal(live.complete, false);
  assert.equal(
    parseAuthenticatedTailJsonStream(`${complete}\n{"event":`, true).problem,
    "tail-output-incomplete",
  );
  for (const malformed of [`${complete}\n[]`, `${complete}\nnot-json`, `${complete}}`]) {
    assert.equal(parseAuthenticatedTailJsonStream(malformed, true).problem, "tail-output-malformed");
  }

  const program = [
    'const text = JSON.stringify({ event: { type: "note", message: "🙂" } }) + "\\n";',
    'const bytes = Buffer.from(text, "utf8");',
    'const emoji = Buffer.from("🙂", "utf8");',
    "const split = bytes.indexOf(emoji) + 2;",
    "process.stdout.write(bytes.subarray(0, split));",
    "setTimeout(() => process.stdout.write(bytes.subarray(split)), 10);",
  ].join("\n");
  const child = spawn(process.execPath, ["-e", program], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = captureAuthenticatedTail(child);
  await capture.closed;
  assert.match(capture.output(), /🙂/);
  assert.equal(parseAuthenticatedTailJsonStream(capture.output(), true).problem, null);
});

test("authenticated Tail rejects malformed or ambiguous log entries on every acceptance path", () => {
  const trace: AuthenticatedMutationTrace = {
    label: "log-shape",
    probe: "inspir-mutation-log-shape",
    origin: "https://inspirlearning.com",
    requestKey: "/api/me?authenticated_mutation_probe=inspir-mutation-log-shape",
    routeTemplate: "/api/me",
    method: "GET",
    status: 200,
  };
  const userId = "22222222-2222-4222-8222-222222222222";
  const readinessProbe = "inspir-auth-tail-ready-1783921234567-42";
  const malformedLogs: unknown[][] = [
    [null],
    [42],
    [{}],
    [{ message: ["missing level"], timestamp: 1_783_921_235_000 }],
    [{ level: null, message: ["null level"], timestamp: 1_783_921_235_000 }],
    [{ level: "fatal", message: ["fatal"], timestamp: 1_783_921_235_000 }],
    [{ level: "mystery", message: ["unknown"], timestamp: 1_783_921_235_000 }],
    [{ level: "info", message: null, timestamp: 1_783_921_235_000 }],
    [{ level: "info", message: [42], timestamp: 1_783_921_235_000 }],
    [{ level: "info", message: ["bad timestamp"], timestamp: -1 }],
    [{
      level: "info",
      logLevel: "error",
      message: ["hidden error"],
      timestamp: 1_783_921_235_000,
    }],
  ];
  for (const logs of malformedLogs) {
    const mutation = evaluateAuthenticatedMutationTail(
      JSON.stringify({ ...tailRecord(trace, 1), logs }),
      [trace],
      MUTATION_TAIL_VERSION_ID,
    );
    assert.ok(mutation.problems.includes("log-shape:log-shape"));

    const resource = evaluateAuthenticatedMemoryQueueResourceWindow(
      `${JSON.stringify(storedMemoryQueueTailRecord({
        authenticatedValidationVersionId: MUTATION_TAIL_VERSION_ID,
        userId,
        cpuTimeMs: 1,
        indexedVectorCount: 1,
      }))}\n${JSON.stringify({ ...tailRecord(trace, 1), logs })}`,
      { authenticatedValidationVersionId: MUTATION_TAIL_VERSION_ID },
    );
    assert.ok(resource.problems.includes("log-shape"));

    const readiness = authenticatedTailHasReadinessProbe(
      JSON.stringify({
        ...authenticatedReadinessTailRecord({
          expectedVersion: MUTATION_TAIL_VERSION_ID,
          probe: readinessProbe,
        }),
        logs,
      }),
      readinessProbe,
      MUTATION_TAIL_VERSION_ID,
    );
    assert.equal(readiness, false);
  }
});

test("semantic recall evidence requires a hydrated prior turn in the exact HTTP invocation", () => {
  const authenticatedValidationVersionId = "11111111-1111-4111-8111-111111111111";
  const trace: AuthenticatedMutationTrace = {
    label: "chat-semantic-recall-provider",
    probe: "inspir-mutation-semantic-recall",
    origin: "https://inspirlearning.com",
    requestKey:
      "/api/chat?authenticated_mutation_probe=inspir-mutation-semantic-recall",
    routeTemplate: "/api/chat",
    method: "POST",
    status: 200,
  };
  const acceptedRecord = {
    ...tailRecord(trace, 2.5),
    scriptName: "inspirlearning",
    scriptVersion: { id: authenticatedValidationVersionId },
    truncated: false,
    logs: [tailStructuredLog("log", {
      event: "native_memory_vector_retrieval_completed",
      memoryMatches: 0,
      turnMatches: 1,
    })],
  };
  const accepted = evaluateAuthenticatedSemanticRetrievalTail(
    JSON.stringify(acceptedRecord),
    { authenticatedValidationVersionId, trace },
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.hydratedTurnCount, 1);

  const noHydratedTurn = structuredClone(acceptedRecord);
  noHydratedTurn.logs = [tailStructuredLog("log", {
    event: "native_memory_vector_retrieval_completed",
    memoryMatches: 0,
    turnMatches: 0,
  })];
  assert.ok(evaluateAuthenticatedSemanticRetrievalTail(
    JSON.stringify(noHydratedTurn),
    { authenticatedValidationVersionId, trace },
  ).problems.includes("semantic-hydrated-turn-count"));

  const malformedRetrieval = structuredClone(acceptedRecord);
  malformedRetrieval.logs = [tailStructuredLog("log", {
    event: "native_memory_vector_retrieval_completed",
    memoryMatches: 0,
    turnMatches: 1,
    extra: true,
  })];
  assert.ok(evaluateAuthenticatedSemanticRetrievalTail(
    JSON.stringify(malformedRetrieval),
    { authenticatedValidationVersionId, trace },
  ).problems.includes("semantic-retrieval-log-malformed"));

  const warned = structuredClone(acceptedRecord);
  warned.logs.push(tailStructuredLog("warn", {
    event: "native_memory_vector_query_failed",
    error: "TypeError",
  }));
  assert.ok(evaluateAuthenticatedSemanticRetrievalTail(
    JSON.stringify(warned),
    { authenticatedValidationVersionId, trace },
  ).problems.includes("semantic-failure-log"));
});

test("memory recovery evidence binds the deterministic turn before Queue publication", () => {
  const releaseCandidateVersionId = "11111111-1111-4111-8111-111111111111";
  const authenticatedValidationVersionId = "22222222-2222-4222-8222-222222222222";
  const runId = "33333333-3333-4333-8333-333333333333";
  const userId = expectedAuthenticatedMutationDisposableIdentity(
    authenticatedValidationVersionId,
    runId,
  ).userId;
  const userMessageId = "44444444-4444-4444-8444-444444444444";
  const turnVectorId = authenticatedTurnVectorId(
    userMessageId,
    "Remember this exact production validation prompt.",
    "This is the exact finalized validation answer.",
  );
  const value = {
    kind: "authenticated-production-memory-recovery-v2",
    createdAt: "2026-07-13T12:00:00.000Z",
    releaseCandidateVersionId,
    authenticatedValidationVersionId,
    runId,
    userId,
    sourceChatId: "55555555-5555-4555-8555-555555555555",
    userMessageId,
    turnVectorId,
    sourceFingerprintSha256: "a".repeat(64),
    immutableReleaseIdentitySha256: "b".repeat(64),
    queuePushPreparedAt: "2026-07-13T12:00:00.000Z",
  };
  assert.deepEqual(parseAuthenticatedMemoryRecoveryEvidence(value), value);
  assert.throws(
    () => parseAuthenticatedMemoryRecoveryEvidence({
      ...value,
      turnVectorId: "chat_memory_turns:wrong",
    }),
    /inconsistent bound identities/,
  );
  assert.throws(
    () => parseAuthenticatedMemoryRecoveryEvidence({ ...value, userId: value.sourceChatId }),
    /inconsistent bound identities/,
  );
});

test("interruption recovery cleans vectors before D1 and never finalizes after a D1 failure", async () => {
  assert.equal(vectorCleanupMinimumSettleMs, 3 * 60_000);
  assert.equal(vectorAbsenceVerificationSpacingMs, 3 * 60_000);
  assert.ok(vectorStateTimeoutMs >= 8 * 60_000);
  assert.equal(resolveAuthenticatedMemoryRecoveryVersion({
    manifestAuthenticatedVersionId: null,
    currentVersionId: "11111111-1111-4111-8111-111111111111",
    memoryRecoveryEvidenceExists: false,
  }), "11111111-1111-4111-8111-111111111111");
  assert.throws(() => resolveAuthenticatedMemoryRecoveryVersion({
    manifestAuthenticatedVersionId: null,
    currentVersionId: "11111111-1111-4111-8111-111111111111",
    memoryRecoveryEvidenceExists: true,
  }), /without its bound authenticated validation version/);
  assert.equal(resolveAuthenticatedMemoryRecoveryVersion({
    manifestAuthenticatedVersionId: "22222222-2222-4222-8222-222222222222",
    currentVersionId: "11111111-1111-4111-8111-111111111111",
    memoryRecoveryEvidenceExists: true,
  }), "22222222-2222-4222-8222-222222222222");

  const events: string[] = [];
  await runAuthenticatedMemoryRecoveryCleanup({
    preD1VectorCleanup: async () => {
      events.push("vector-pre");
    },
    authoritativeD1Cleanup: async () => {
      events.push("d1");
    },
    postD1VectorCleanup: async () => {
      events.push("vector-post-and-remove-evidence");
    },
  });
  assert.deepEqual(events, ["vector-pre", "d1", "vector-post-and-remove-evidence"]);

  events.length = 0;
  await assert.rejects(
    () => runAuthenticatedMemoryRecoveryCleanup({
      preD1VectorCleanup: async () => {
        events.push("vector-pre");
      },
      authoritativeD1Cleanup: async () => {
        events.push("d1-failed");
        throw new Error("simulated hidden cleanup failure");
      },
      postD1VectorCleanup: async () => {
        events.push("must-not-remove-evidence");
      },
    }),
    /simulated hidden cleanup failure/,
  );
  assert.deepEqual(events, ["vector-pre", "d1-failed"]);
  await assert.rejects(
    () => runAuthenticatedMemoryRecoveryCleanup({
      preD1VectorCleanup: async () => undefined,
      authoritativeD1Cleanup: async () => undefined,
    }),
    /requires both pre- and post-D1 vector cleanup/,
  );
});

test("both JSON tails require one exact-version public health readiness capture", () => {
  const expectedVersion = "11111111-1111-4111-8111-111111111111";
  const probe = createAuthenticatedTailReadinessProbe(1_783_921_234_567, 42);
  assert.equal(probe, "inspir-auth-tail-ready-1783921234567-42");
  assert.throws(
    () => createAuthenticatedTailReadinessProbe(Number.NaN, 42),
    /probe identity is invalid/,
  );
  const accepted = {
    eventTimestamp: 1_783_921_234_568,
    scriptName: "inspirlearning",
    scriptVersion: { id: expectedVersion },
    outcome: "ok",
    truncated: false,
    cpuTime: 1,
    wallTime: 2,
    exceptions: [] as Array<{ message: string }>,
    logs: [] as Array<{ level: string; message: string[] }>,
    event: {
      request: {
        cf: {},
        headers: {},
        method: "GET",
        url: `https://inspirlearning.com/api/health?authenticated_tail_ready=${probe}`,
      },
      response: { status: 200 },
    },
  };
  const acceptedSource = JSON.stringify(accepted);
  assert.equal(authenticatedTailHasReadinessProbe(acceptedSource, probe, expectedVersion), true);
  for (const origin of ["http://inspirlearning.com", "https://evil.example"]) {
    const wrongOrigin = structuredClone(accepted);
    const url = new URL(wrongOrigin.event.request.url);
    wrongOrigin.event.request.url = `${origin}${url.pathname}${url.search}`;
    assert.equal(
      authenticatedTailHasReadinessProbe(JSON.stringify(wrongOrigin), probe, expectedVersion),
      false,
    );
  }
  assert.equal(
    authenticatedTailHasReadinessProbe(
      `${acceptedSource}\n${acceptedSource}`,
      probe,
      expectedVersion,
    ),
    false,
  );
  assert.equal(
    authenticatedTailHasReadinessProbe(`${acceptedSource}\n{`, probe, expectedVersion, true),
    false,
  );
  assert.equal(
    authenticatedTailReadinessIsCapturedByEveryTail(
      [acceptedSource, acceptedSource],
      probe,
      expectedVersion,
    ),
    true,
  );
  assert.equal(
    authenticatedTailReadinessIsCapturedByEveryTail(
      [acceptedSource, "Connected to inspirlearning, waiting for logs...\n"],
      probe,
      expectedVersion,
    ),
    false,
  );
  assert.equal(
    authenticatedTailReadinessIsCapturedByEveryTail([], probe, expectedVersion),
    false,
  );

  const wrongVersion = structuredClone(accepted);
  wrongVersion.scriptVersion.id = "22222222-2222-4222-8222-222222222222";
  assert.equal(
    authenticatedTailHasReadinessProbe(JSON.stringify(wrongVersion), probe, expectedVersion),
    false,
  );
  const wrongStatus = structuredClone(accepted);
  wrongStatus.event.response.status = 503;
  assert.equal(
    authenticatedTailHasReadinessProbe(JSON.stringify(wrongStatus), probe, expectedVersion),
    false,
  );
  const extraQuery = structuredClone(accepted);
  extraQuery.event.request.url += "&lookalike=1";
  assert.equal(
    authenticatedTailHasReadinessProbe(JSON.stringify(extraQuery), probe, expectedVersion),
    false,
  );
  const exceptional = structuredClone(accepted);
  exceptional.exceptions = [{ message: "redacted" }];
  assert.equal(
    authenticatedTailHasReadinessProbe(JSON.stringify(exceptional), probe, expectedVersion),
    false,
  );
  const truncated = structuredClone(accepted);
  truncated.truncated = true;
  assert.equal(
    authenticatedTailHasReadinessProbe(JSON.stringify(truncated), probe, expectedVersion),
    false,
  );
  const failedOutcome = structuredClone(accepted);
  failedOutcome.outcome = "exception";
  assert.equal(
    authenticatedTailHasReadinessProbe(JSON.stringify(failedOutcome), probe, expectedVersion),
    false,
  );
  assert.equal(
    authenticatedTailHasReadinessProbe(
      JSON.stringify({ ...accepted, logs: null }),
      probe,
      expectedVersion,
    ),
    false,
  );
  assert.equal(
    authenticatedTailHasReadinessProbe(acceptedSource, `${probe}-wrong`, expectedVersion),
    false,
  );
});

test("public mutation probes survive URL redaction", () => {
  assert.equal(
    normalizeAuthenticatedMutationRoute("/api/activities/quiz/11111111-1111-4111-8111-111111111111/answer"),
    "/api/activities/quiz/:uuid/answer",
  );
  assert.equal(
    normalizeAuthenticatedMutationRoute("/api/activities/quiz/REDACTED/answer"),
    "/api/activities/quiz/:uuid/answer",
  );
  const probe = createAuthenticatedMutationProbe("chat-finalize", 3);
  assert.match(probe, /^inspir-mutation-\d+-\d+-3-chat-finalize$/);
  assert.doesNotMatch(probe, /^[0-9a-f]{32,}$/i);
});

test("authenticated mutation SSE requires a valid terminal event and rejects bad frames", () => {
  const complete = [
    'data: {"choices":[{"delta":{"content":"Complete"}}]}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");
  assert.equal(parseCompleteAuthenticatedOpenAiSse(complete), "Complete");
  assert.throws(
    () => parseCompleteAuthenticatedOpenAiSse(
      'data: {"choices":[{"delta":{"content":"Truncated"}}]}\n\n',
    ),
    /without a terminal event/,
  );
  assert.throws(
    () => parseCompleteAuthenticatedOpenAiSse("data: not-json\n\ndata: [DONE]\n\n"),
    /malformed or error frame/,
  );
  assert.throws(
    () => parseCompleteAuthenticatedOpenAiSse(
      'data: {"error":{"message":"redacted"}}\n\ndata: [DONE]\n\n',
    ),
    /malformed or error frame/,
  );
});

test("saved activity result validators require complete revealed quiz and flashcard shapes", () => {
  const quizQuestions = Array.from({ length: 10 }, (_, index) => ({
    id: `question-${index}`,
    prompt: `Pregunta ${index}`,
    options: ["A", "B", "C", "D"],
    correctIndex: 0,
    explanation: "Explicación completa",
    userAnswerIndex: 0,
    isCorrect: true,
  }));
  assert.doesNotThrow(() => assertCompleteQuizResult(
    { score: 10, maxScore: 10 },
    { score: 10, maxScore: 10, questions: quizQuestions },
    { topic: "El ciclo del agua", score: 10, maxScore: 10 },
    "quiz-result",
  ));
  assert.throws(() => assertCompleteQuizResult(
    { score: 10, maxScore: 10 },
    { score: 10, maxScore: 10, questions: quizQuestions.map((question, index) =>
      index === 0 ? { ...question, explanation: undefined } : question) },
    { topic: "El ciclo del agua", score: 10, maxScore: 10 },
    "quiz-result",
  ), /explanation is malformed/);

  const cards = Array.from({ length: 12 }, (_, index) => ({
    id: `card-${index}`,
    front: `Frente ${index}`,
    back: `Reverso ${index}`,
    hint: "Pista",
    example: "Ejemplo",
    trap: "Error común",
    tags: ["estudio"],
    isRevealed: true,
    rating: "known",
    reviewedAt: "2026-07-12T12:00:00.000Z",
  }));
  assert.doesNotThrow(() => assertCompleteFlashcardResult(
    { score: 12, maxScore: 12 },
    { knownCount: 12, reviewedCount: 12, maxCards: 12, cards },
    { topic: "Fotosíntesis", knownCount: 12, maxCards: 12 },
    "flashcard-result",
  ));
  assert.throws(() => assertCompleteFlashcardResult(
    { score: 12, maxScore: 12 },
    {
      knownCount: 12,
      reviewedCount: 12,
      maxCards: 12,
      cards: cards.map((card, index) => index === 0 ? { ...card, trap: "" } : card),
    },
    { topic: "Fotosíntesis", knownCount: 12, maxCards: 12 },
    "flashcard-result",
  ), /trap is malformed/);
});

test("Spanish activity validation rejects English-only result text", () => {
  assert.equal(hasSpanishLanguageSignal("El ciclo del agua explica por qué cambia el estado."), true);
  assert.equal(hasSpanishLanguageSignal("Mazo completado"), true);
  assert.equal(hasSpanishLanguageSignal("Conocidas"), true);
  assert.equal(hasSpanishLanguageSignal("The water cycle changes state."), false);
  assert.equal(
    isPredominantlySpanishText(
      "What happens in El ciclo del agua? Explain the answer in English.",
      ["El ciclo del agua"],
    ),
    false,
  );
  assert.equal(
    isPredominantlySpanishText(
      "What is fotosíntesis and why does it matter for plants?",
      ["La fotosíntesis"],
    ),
    false,
  );
  assert.equal(
    isPredominantlySpanishText(
      "¿Qué proceso convierte el agua líquida en vapor cuando recibe calor? La evaporación ocurre por la energía térmica.",
      ["El ciclo del agua"],
    ),
    true,
  );
});

test("cleanup retries a transaction only after authoritative nonzero residue readback", async () => {
  const events: string[] = [];
  let cleanupAttempt = 0;
  const result = await cleanupDisposableMutationState({
    cleanup: async () => {
      cleanupAttempt += 1;
      events.push(`cleanup-${cleanupAttempt}`);
      if (cleanupAttempt === 1) throw new Error("simulated lost response");
    },
    inspect: async () => {
      events.push(`inspect-${cleanupAttempt}`);
      return cleanupAttempt === 1
        ? { ok: false, inventory: { ...emptyDisposableInventory(), users: 1 } }
        : { ok: true, inventory: emptyDisposableInventory() };
    },
  });
  assert.equal(result.cleanupAttempts, 2);
  assert.deepEqual(events, ["cleanup-1", "inspect-1", "cleanup-2", "inspect-2"]);
});

test("cleanup fails indeterminate without blindly retrying after a readback failure", async () => {
  const events: string[] = [];
  await assert.rejects(
    () => cleanupDisposableMutationState({
      cleanup: async () => {
        events.push("cleanup");
        throw new Error("transport failure");
      },
      inspect: async () => {
        events.push("inspect");
        throw new Error("readback unavailable");
      },
    }),
    /indeterminate because authoritative readback failed/,
  );
  assert.deepEqual(events, ["cleanup", "inspect"]);
});

test("cleanup wakes and waits for owner-scoped vector outbox drain before final zero proof", async () => {
  assert.equal(authenticatedOutboxDrainRetryDelayMs, 30_000);
  assert.equal(authenticatedOutboxDrainMaximumAttempts, 60);
  const events: string[] = [];
  let vectorOutboxRows = 1;
  let identityRows = 1;
  const result = await cleanupDisposableMutationState({
    cleanup: async () => {
      events.push("cleanup");
      if (vectorOutboxRows === 0) identityRows = 0;
    },
    inspect: async () => {
      events.push("inspect");
      return {
        ok: vectorOutboxRows === 0 && identityRows === 0,
        inventory: {
          ...emptyDisposableInventory(),
          users: identityRows,
          memory_vector_cleanup_outbox: vectorOutboxRows,
        },
      };
    },
    outboxDrain: {
      wake: async () => {
        events.push("wake-global-cleanup");
      },
      maximumAttempts: 3,
      retryDelayMs: 1,
      wait: async () => {
        events.push("wait-for-runtime-absence-proof");
        vectorOutboxRows = 0;
      },
    },
  });
  assert.equal(result.cleanupAttempts, 2);
  assert.deepEqual(events, [
    "cleanup",
    "inspect",
    "wake-global-cleanup",
    "wait-for-runtime-absence-proof",
    "cleanup",
    "inspect",
  ]);
});

test("flow always invokes cleanup and authoritative zero readback when its first probe fails", async () => {
  const actions: string[] = [];
  const candidateVersionId = "11111111-1111-4111-8111-111111111111";
  const runId = "22222222-2222-4222-8222-222222222222";
  const identity = expectedAuthenticatedMutationDisposableIdentity(candidateVersionId, runId);
  const spanishBundle = getCuratedMainAppTranslationBundle("Spanish");
  assert.ok(spanishBundle);
  const spanishAsset = buildStaticMainAppBundleAsset("es", spanishBundle);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname === spanishAsset.publicPath) {
      actions.push("verify-spanish-activity-bundle");
      return new Response(spanishAsset.serialized, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-inspir-delivery": "static-assets",
        },
      });
    }
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null;
    const record = typeof body === "object" && body !== null && !Array.isArray(body)
      ? Object.fromEntries(Object.entries(body))
      : {};
    const action = typeof record.action === "string" ? record.action : "unknown";
    actions.push(action);
    if (action === "create-disposable") {
      return Response.json({ error: "simulated probe failure" }, { status: 500 });
    }
    if (action === "cleanup-disposable") {
      return Response.json({
        ok: true,
        runtimeVersionId: candidateVersionId,
        identity,
      });
    }
    if (action === "verify-disposable-cleanup") {
      return Response.json({
        ok: true,
        runtimeVersionId: candidateVersionId,
        identity,
        inventory: emptyDisposableInventory(),
      });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  };
  await assert.rejects(
    () => runAuthenticatedProductionMutationFlow({
      baseUrl: "https://inspirlearning.com",
      expectedVersion: candidateVersionId,
      authSecret: "mutation-flow-test-secret-at-least-32-bytes",
      runId,
      tailSessionToken: "tail-session-test-token",
      memoryHotPath: {
        publishPostTurnAndRequireStored: async () => {
          throw new Error("memory hot path should not run after the first probe fails");
        },
        requireKnownVectorPresent: async () => {
          throw new Error("memory hot path should not run after the first probe fails");
        },
        requireSemanticTurnHydrated: async () => {
          throw new Error("memory hot path should not run after the first probe fails");
        },
        requestVectorCleanupDrain: async () => undefined,
        requireKnownVectorAbsent: async () => {
          throw new Error("memory hot path should not run after the first probe fails");
        },
      },
      fetcher,
    }),
    /did not complete safely/,
  );
  assert.deepEqual(actions, [
    "verify-spanish-activity-bundle",
    "create-disposable",
    "cleanup-disposable",
    "verify-disposable-cleanup",
  ]);
});

test("disposable cleanup inventory requires the independent exact 24-key schema", () => {
  assert.equal(authenticatedMutationInventoryNames.length, 24);
  assert.deepEqual(exactDisposableInventory(emptyDisposableInventory()), emptyDisposableInventory());
  const omitted = emptyDisposableInventory();
  delete omitted.memory_events;
  assert.throws(() => exactDisposableInventory(omitted), /omitted or added/);
  assert.throws(
    () => exactDisposableInventory({ ...emptyDisposableInventory(), unexpected: 0 }),
    /omitted or added/,
  );
  assert.throws(
    () => exactDisposableInventory({ ...emptyDisposableInventory(), users: Number.MAX_SAFE_INTEGER + 1 }),
    /non-negative safe integer/,
  );
});

test("production mutation verifier covers chat provider/finalize, completed activities, and finally cleanup", () => {
  const source = fs.readFileSync(
    path.resolve("scripts/cloudflare/verify-authenticated-production-mutations.ts"),
    "utf8",
  );
  assert.match(source, /action: "create-disposable"|mutationBody\("create-disposable"\)/);
  assert.match(source, /mutationBody\("grant-disposable-admin"/);
  assert.match(source, /"admin-users-upsert",[\s\S]{0,80}"\/api\/admin\/users"/);
  assert.match(source, /"admin-topics-create",[\s\S]{0,80}"\/api\/admin\/topics"/);
  assert.match(source, /admin-topic-account-readback/);
  assert.match(source, /mutationBody\("cleanup-disposable-topic"/);
  assert.match(source, /"admin-users-delete"/);
  assert.match(source, /verify-admin-cleanup-inventory/);
  assert.match(source, /adminInventory\.admin_users === 0/);
  assert.match(source, /adminInventory\.topics === 0/);
  assert.match(source, /"profile-update", "\/api\/me"/);
  assert.match(source, /profile-after-update/);
  assert.match(source, /profileImageHash === null/);
  assert.match(source, /"profile-photo-upload",\s*"\/api\/me\/photo"/);
  assert.match(source, /"profile-photo-read",\s*"\/api\/me\/photo"/);
  assert.match(source, /"profile-photo-delete",\s*"\/api\/me\/photo"/);
  assert.match(source, /profilePhotoProbe\.byteLength !== maxProfileImageBytes/);
  assert.match(source, /createHash\("sha256"\)\.update\(profilePhotoRead\.bodyBytes\)/);
  assert.match(source, /"memory-source-feedback",\s*"\/api\/memory\/source-feedback"/);
  assert.match(source, /action: "dont_mention"/);
  assert.match(source, /"analytics-event",\s*"\/api\/analytics\/events"/);
  assert.match(source, /analyticsEvent\.recorded === true/);
  assert.match(source, /evaluateAuthenticatedCriticalResourceTail\(/);
  assert.match(source, /criticalResourceTail\.ok/);
  assert.match(source, /"chat-provider", "\/api\/chat"/);
  assert.match(source, /"chat-legacy-provider", "\/api\/chat"/);
  assert.match(source, /"x-inspir-assistant-message-id"/);
  assert.match(source, /legacyAssistantIndex === legacyUserIndex \+ 1/);
  assert.match(source, /chat-legacy-result/);
  assert.match(source, /"chat-finalize", "\/api\/chat\/finalize"/);
  assert.match(source, /chat-stream-result/);
  assert.match(source, /message\?\.id === assistantMessageId/);
  assert.match(source, /"memory-create", "\/api\/memory"/);
  assert.match(source, /memory-update/);
  assert.match(source, /memory-delete/);
  assert.match(source, /\/api\/activities\/quiz\/\$\{quizId\}\/answer/);
  assert.match(source, /\/api\/activities\/flashcards\/\$\{flashId\}\/review/);
  assert.match(source, /metadata\.event === "completed"/);
  assert.match(source, /displayValues/);
  assert.match(source, /intentional Spanish completion presentation/);
  assert.match(source, /verifySpanishActivityBundle/);
  assert.match(source, /El ciclo del agua/);
  assert.match(source, /La fotosíntesis/);
  assert.match(source, /assertCompleteQuizResult/);
  assert.match(source, /assertCompleteFlashcardResult/);
  assert.match(source, /finally \{[\s\S]*cleanupDisposableMutationState/);
  assert.match(source, /x-migration-e2e-cleanup-proof/);
  assert.match(source, /verify-disposable-cleanup/);
  assert.match(source, /cpuTimeMs < 0/);
  assert.match(source, /cpuTimeMs >= authenticatedMutationCpuThresholdMs/);
  assert.match(source, /evidenceVersionRole: "authenticated-validation-version"/);
  assert.match(source, /sharedGlobalAiBudgetCalls: 7/);
  assert.match(source, /type: "memory\.post_turn\.v2"/);
  assert.match(source, /knownTurnVectorId = authenticatedTurnVectorId\(/);
  assert.match(source, /chat-semantic-recall-provider/);
  assert.match(
    source,
    /const versionTail = spawn\([\s\S]{0,220}\["tail", workerName, "--format", "json", "--version-id", expectedVersion\]/,
  );
  const httpTailSpawn = source.slice(
    source.indexOf("const httpTail = spawn("),
    source.indexOf("const versionTail = spawn("),
  );
  assert.match(httpTailSpawn, /"--format",[\s\S]*"json"/);
  assert.match(httpTailSpawn, /"--version-id",[\s\S]*expectedVersion/);
  assert.match(httpTailSpawn, /"--header",[\s\S]*tailSessionHeader/);
  const readinessCallIndex = source.indexOf("await waitForTailReadiness({");
  const apiTokenIndex = source.indexOf("const apiToken = requireCloudflareApiToken()", readinessCallIndex);
  const readinessHelper = source.slice(
    source.indexOf("async function waitForTailReadiness("),
    source.indexOf("async function waitForTailProbes("),
  );
  assert.ok(readinessCallIndex >= 0);
  assert.ok(apiTokenIndex > readinessCallIndex);
  assert.match(readinessHelper, /tails\.length !== 2/);
  assert.match(readinessHelper, /new URL\("\/api\/health", input\.baseUrl\)/);
  assert.match(readinessHelper, /\[versionOverrideHeader\]: `\$\{workerName\}="\$\{input\.expectedVersion\}"`/);
  assert.match(readinessHelper, /\[tailSessionHeader\]: input\.tailSessionToken/);
  assert.match(readinessHelper, /healthVersion\.id !== input\.expectedVersion/);
  assert.match(readinessHelper, /authenticatedTailReadinessIsCapturedByEveryTail/);
  assert.doesNotMatch(source, /wranglerTailDiagnosticIsConnected/);
  assert.match(readinessHelper, /authenticatedTailCaptureHasLoss/);
  assert.doesNotMatch(readinessHelper, /waiting for logs|console\./);
  assert.match(readinessHelper, /const probe = createAuthenticatedTailReadinessProbe\(\)/);
  assert.match(readinessHelper, /input\.retryMissedMarker/);
  assert.match(readinessHelper, /if \(!input\.retryMissedMarker\) break/);
  assert.match(
    source,
    /Refusing hidden disposable D1 cleanup before owned source-chat deletion is proven/,
  );
  const publishHook = source.slice(
    source.indexOf("publishPostTurnAndRequireStored: async"),
    source.indexOf("requireKnownVectorPresent: async"),
  );
  assert.ok(publishHook.indexOf("writePrivateJsonDurably") >= 0);
  assert.ok(
    publishHook.indexOf("writePrivateJsonDurably") <
      publishHook.indexOf("pushAuthenticatedMemoryPostTurn"),
  );
  const flowFinally = source.slice(
    source.indexOf("} finally {", source.indexOf("runAuthenticatedProductionMutationFlow")),
    source.indexOf("const failures =", source.indexOf("runAuthenticatedProductionMutationFlow")),
  );
  assert.ok(
    flowFinally.indexOf("cleanup-profile-photo") <
      flowFinally.indexOf("cleanupDisposableMutationState"),
  );
  assert.ok(
    flowFinally.indexOf("delete-stored-memory-source-chat") <
      flowFinally.indexOf("requestVectorCleanupDrain"),
  );
  assert.ok(
    flowFinally.indexOf("requestVectorCleanupDrain") <
      flowFinally.indexOf("requireKnownVectorAbsent"),
  );
  assert.ok(
    flowFinally.indexOf("requireKnownVectorAbsent") <
      flowFinally.indexOf("cleanupDisposableMutationState"),
  );
  assert.match(source, /type: "memory\.vector_cleanup\.v1"/);
  assert.match(source, /memory_vector_cleanup_outbox/);
  const cleanupValidationStartIndex = source.indexOf("const cleanupValidationStartedAt = Date.now()");
  const mutationFlowIndex = source.indexOf("runAuthenticatedProductionMutationFlow({");
  const cleanupAggregateIndex = source.indexOf(
    "const cleanupAggregate = evaluateAuthenticatedMemoryQueueResourceWindow(",
  );
  const versionTailStopIndex = source.indexOf("await stopTail(versionTail, versionCapture.closed)");
  assert.ok(cleanupValidationStartIndex >= 0);
  assert.ok(cleanupValidationStartIndex < mutationFlowIndex);
  assert.ok(cleanupAggregateIndex > mutationFlowIndex);
  assert.ok(cleanupAggregateIndex > versionTailStopIndex);
  assert.match(source, /const cleanupReasonPrefix = `e2e-cleanup-/);
  assert.match(source, /cleanupWakeIndex \+= 1/);
  assert.match(source, /reason: entry\.reason/);
  assert.match(source, /tailDiagnostics: finalVersionTailDiagnostics/);
  assert.match(source, /authenticatedCleanupQueueSettlementTimeoutMs = 10 \* 60_000/);
  assert.match(source, /authenticatedQueueSettlementQuietPeriodMs =\s*backgroundQueueSettlementQuietPeriodMs/);
  assert.match(source, /waitForCompleteTailOutputCheckpoint\(/);
  assert.match(publishHook, /captureOutputOffset = await waitForCompleteTailOutputCheckpoint/);
  assert.ok(
    publishHook.indexOf("waitForCompleteTailOutputCheckpoint") <
      publishHook.indexOf("pushAuthenticatedMemoryPostTurn"),
  );
  const cleanupHook = source.slice(
    source.indexOf("requestVectorCleanupDrain: async"),
    source.indexOf("requireKnownVectorAbsent: async"),
  );
  assert.ok(
    cleanupHook.indexOf("waitForCompleteTailOutputCheckpoint") <
      cleanupHook.indexOf("pushAuthenticatedMemoryVectorCleanupWake"),
  );
  assert.match(source, /waitForSingleTailPostSettlementLiveness/);
  assert.match(source, /successObservedAt = observationEndedAt/);
  assert.match(source, /observationEndedAt - successObservedAt >= authenticatedQueueSettlementQuietPeriodMs/);
  assert.match(source, /settledLivenessProbe: hotPathEvidence\.queue\.settledLivenessProbe/);
  assert.match(source, /settledLivenessProbe: entry\.settledLivenessProbe/);
  assert.match(source, /tailOutputClosed: true/);
  assert.match(source, /diagnosticsForEvaluation\(\)/);
  assert.match(source, /captureAuthenticatedTail\(httpTail\)/);
  assert.match(source, /captureAuthenticatedTail\(versionTail\)/);
  assert.doesNotMatch(source, /function captureTail\(/);
  const stopTailSource = source.slice(
    source.indexOf("async function stopTail("),
    source.indexOf("function extractJsonObjects("),
  );
  assert.match(stopTailSource, /\["SIGINT", "SIGTERM"\]/);
  assert.match(stopTailSource, /child\.kill\("SIGKILL"\)/);
  assert.match(stopTailSource, /required SIGKILL; authenticated proof is invalid/);
  assert.match(source, /vectorCleanupQueueTail: cleanupAggregate/);
  assert.match(source, /cleanupAggregate\.ok/);
  assert.match(source, /cleanupAggregate\.maximumCpuTimeMs/);
  assert.doesNotMatch(source, /mutation_tail_ready/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:authSecret|cookie|userId)/);

  const protectedSource = fs.readFileSync(
    path.resolve("lib/free-runtime/protected-ai-api.ts"),
    "utf8",
  );
  assert.match(
    protectedSource,
    /const validationScope = session\.user\.email[\s\S]{0,260}resolveDisposableAdminValidationScope[\s\S]{0,260}skipQueue: validationScope\.kind !== "ordinary"/,
  );
  const stateSource = fs.readFileSync(
    path.resolve("lib/free-runtime/state-api.ts"),
    "utf8",
  );
  const updateMemorySource = stateSource.slice(
    stateSource.indexOf("async function updateMemoryItem"),
    stateSource.indexOf("async function deleteMemoryItem"),
  );
  assert.match(updateMemorySource, /embedding = null/);
  assert.match(
    updateMemorySource,
    /const suppressAutomaticQueue = await isDisposableValidationSession\(session, env\)/,
  );
  assert.match(updateMemorySource, /const outboxStatements = obsoleteVectors\.map/);
  assert.match(updateMemorySource, /if \(!suppressAutomaticQueue\) \{\s+scheduleMemorySynthesis/);
  assert.match(updateMemorySource, /scheduleVectorCleanupWake/);
  assert.doesNotMatch(updateMemorySource, /deleteNativeMemoryVectorsBestEffort/);
  assert.match(protectedSource, /if \(input\.skipQueue\) return/);
  assert.match(stateSource, /async function isDisposableValidationSession/);
  assert.match(stateSource, /resolveDisposableAdminValidationScope/);
  assert.match(stateSource, /event: "native_memory_vector_cleanup_started"/);
  assert.match(
    stateSource,
    /job\.type === "memory\.vector_cleanup\.v1" \? \{ reason: job\.reason \} : \{\}/,
  );
  assert.doesNotMatch(stateSource, /email\?\.endsWith\("@inspirlearning\.invalid"\)/);

  const wrapper = fs.readFileSync(
    path.resolve("scripts/cloudflare/run-authenticated-production-validation.ts"),
    "utf8",
  );
  assert.match(wrapper, /cf:verify:background-outcomes/);
  assert.match(wrapper, /"--queue"/);
  assert.match(wrapper, /realStoredQueueAndSemanticRetrieval: authenticatedVersion/);
  assert.match(wrapper, /staleJobQueueProbe: finalVersion/);
  assert.match(wrapper, /immutableSourceAndArtifactIdentityShared: true/);
  assert.match(wrapper, /runAuthenticatedMemoryRecoveryCleanup/);
  const finalVersionIndex = wrapper.indexOf("const finalVersion =");
  const staleQueueIndex = wrapper.indexOf('"cf:verify:background-outcomes"', finalVersionIndex);
  const finalSecretFreeIndex = wrapper.indexOf('"--secret-free"', staleQueueIndex);
  const finalLockReleaseIndex = wrapper.indexOf(
    "releaseActiveProductionValidationLock();",
    finalSecretFreeIndex,
  );
  assert.ok(finalVersionIndex >= 0);
  assert.ok(staleQueueIndex > finalVersionIndex);
  assert.ok(finalSecretFreeIndex > staleQueueIndex);
  assert.ok(finalLockReleaseIndex > finalSecretFreeIndex);
});

function authenticatedFetchTailEvent(
  url = "https://inspirlearning.com/api/health",
  method = "GET",
  status = 200,
) {
  return {
    request: { cf: {}, headers: {}, method, url },
    response: { status },
  };
}

function tailRecord(
  trace: AuthenticatedMutationTrace,
  cpuTime: number,
  pathname = new URL(trace.requestKey, "https://inspirlearning.com").pathname,
) {
  const url = new URL(trace.requestKey, "https://inspirlearning.com");
  url.pathname = pathname;
  url.searchParams.set("authenticated_mutation_probe", trace.probe);
  return {
    scriptName: "inspirlearning",
    scriptVersion: { id: MUTATION_TAIL_VERSION_ID },
    truncated: false,
    outcome: "ok",
    cpuTime,
    wallTime: Math.max(0, cpuTime),
    eventTimestamp: 1_783_921_234_567,
    exceptions: [] as Array<{ message: string }>,
    logs: [] as Array<{ level: string; message: string[]; timestamp: number }>,
    event: {
      request: {
        cf: {},
        headers: {},
        method: trace.method,
        url: url.href,
      },
      response: { status: trace.status },
    },
  };
}

function tailStructuredLog(
  level: "log" | "warn" | "error",
  message: Record<string, unknown>,
) {
  return {
    level,
    message: [JSON.stringify(message)],
    timestamp: 1_783_921_234_567,
  };
}

function storedMemoryQueueTailRecord(input: {
  authenticatedValidationVersionId: string;
  userId: string;
  cpuTimeMs: number;
  indexedVectorCount: number;
}) {
  const exceptions: Array<{ message: string }> = [];
  return {
    scriptName: "inspirlearning",
    scriptVersion: { id: input.authenticatedValidationVersionId },
    outcome: "ok",
    truncated: false,
    cpuTime: input.cpuTimeMs,
    wallTime: input.cpuTimeMs,
    eventTimestamp: 2_000,
    exceptions,
    event: {
      queue: "inspirlearning-memory-post-turn-prod",
      batchSize: 1,
    },
    logs: [
      tailStructuredLog("log", {
        event: "native_memory_queue_processed",
        type: "memory.post_turn.v2",
        userId: input.userId,
        messageId: "queue-message-id",
        attempts: 1,
        outcome: "stored",
      }),
      tailStructuredLog("log", {
        event: "native_memory_vectors_indexed",
        count: input.indexedVectorCount,
        superseded: 0,
      }),
    ],
  };
}

function vectorCleanupQueueTailRecord(input: {
  authenticatedValidationVersionId: string;
  cpuTimeMs: number;
  eventTimestamp: number;
  reason: string;
  terminal: "processed" | "deferred" | "failed" | "none";
  pending?: 0 | 1;
  messageId?: string;
  attempts?: number;
  includeStart?: boolean;
  outcome?: string;
}) {
  const exceptions: Array<{ message: string }> = [];
  const messageId = input.messageId ?? "cleanup-message-id";
  const attempts = input.attempts ?? 1;
  const pending = input.pending ?? 0;
  const terminal = input.terminal === "processed"
    ? {
        event: "native_memory_queue_processed",
        type: "memory.vector_cleanup.v1",
        userId: null,
        reason: input.reason,
        messageId,
        attempts,
        outcome: {
          claimed: 1,
          deleteRequested: 1,
          verifiedAbsent: 0,
          pending,
          nextDelaySeconds: pending === 1 ? 180 : null,
        },
      }
    : input.terminal === "deferred"
    ? {
        event: "native_memory_vector_cleanup_lease_deferred",
        type: "memory.vector_cleanup.v1",
        reason: input.reason,
        messageId,
        attempts,
        delaySeconds: 60,
      }
    : input.terminal === "failed"
    ? {
        event: "native_memory_queue_failed",
        type: "memory.vector_cleanup.v1",
        userId: null,
        reason: input.reason,
        messageId,
        attempts,
        error: "TypeError",
      }
    : null;
  const logs = input.includeStart === false
    ? []
    : [tailStructuredLog("log", {
        event: "native_memory_vector_cleanup_started",
        type: "memory.vector_cleanup.v1",
        reason: input.reason,
        messageId,
        attempts,
      })];
  if (terminal) {
    logs.push(tailStructuredLog(input.terminal === "failed" ? "warn" : "log", terminal));
  }
  return {
    scriptName: "inspirlearning",
    scriptVersion: { id: input.authenticatedValidationVersionId },
    outcome: input.outcome ?? "ok",
    truncated: false,
    cpuTime: input.cpuTimeMs,
    wallTime: input.cpuTimeMs,
    eventTimestamp: input.eventTimestamp,
    exceptions,
    event: {
      queue: "inspirlearning-memory-post-turn-prod",
      batchSize: 1,
    },
    logs,
  };
}

function authenticatedReadinessTailRecord(input: {
  expectedVersion: string;
  probe: string;
}) {
  return {
    scriptName: "inspirlearning",
    scriptVersion: { id: input.expectedVersion },
    outcome: "ok",
    truncated: false,
    cpuTime: 1,
    wallTime: 2,
    eventTimestamp: 1_783_921_234_567,
    exceptions: [] as Array<{ message: string }>,
    logs: [] as Array<{ level: string; message: string[] }>,
    event: {
      request: {
        cf: {},
        headers: {},
        method: "GET",
        url: `https://inspirlearning.com/api/health?authenticated_tail_ready=${input.probe}`,
      },
      response: { status: 200 },
    },
  };
}

function emptyDisposableInventory(): Record<string, number> {
  return Object.fromEntries(authenticatedMutationInventoryNames.map((name) => [name, 0]));
}
