import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getCuratedMainAppTranslationBundle } from "../lib/i18n/main-app-curated";
import { buildStaticMainAppBundleAsset } from "../lib/i18n/main-app-static-asset";
import {
  authenticatedOutboxDrainMaximumAttempts,
  authenticatedOutboxDrainRetryDelayMs,
  authenticatedMutationCpuThresholdMs,
  authenticatedMutationInventoryNames,
  authenticatedTurnVectorId,
  assertAuthenticatedMutationDisposableIdentity,
  assertAuthenticatedMutationResponseProof,
  assertCompleteFlashcardResult,
  assertCompleteQuizResult,
  cleanupDisposableMutationState,
  createAuthenticatedMutationProbe,
  evaluateAuthenticatedMemoryQueueTail,
  evaluateAuthenticatedMutationTail,
  evaluateAuthenticatedSemanticRetrievalTail,
  expectedAuthenticatedMutationDisposableIdentity,
  exactDisposableInventory,
  hasSpanishLanguageSignal,
  isPredominantlySpanishText,
  normalizeAuthenticatedMutationRoute,
  parseCompleteAuthenticatedOpenAiSse,
  parseAuthenticatedMemoryRecoveryEvidence,
  runAuthenticatedProductionMutationFlow,
  runAuthenticatedMemoryRecoveryCleanup,
  resolveAuthenticatedMemoryRecoveryVersion,
  vectorAbsenceVerificationSpacingMs,
  vectorCleanupMinimumSettleMs,
  vectorStateTimeoutMs,
  wranglerTailDiagnosticIsConnected,
  type AuthenticatedMutationTrace,
} from "../scripts/cloudflare/verify-authenticated-production-mutations";

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

test("tail evaluator requires one exact ok CPU sample below 8ms for every mutation request", () => {
  const traces: AuthenticatedMutationTrace[] = [
    {
      label: "chat-finalize",
      probe: "inspir-mutation-one",
      requestKey: "/api/chat/finalize?authenticated_mutation_probe=one",
      routeTemplate: "/api/chat/finalize",
      method: "POST",
      status: 200,
    },
    {
      label: "quiz-result",
      probe: "inspir-mutation-two",
      requestKey: "/api/chats/11111111-1111-4111-8111-111111111111?authenticated_mutation_probe=two",
      routeTemplate: "/api/chats/:uuid",
      method: "GET",
      status: 200,
    },
  ];
  const source = [
    tailRecord(traces[0], 7.999),
    tailRecord(traces[1], 1.25, "/api/chats/REDACTED"),
  ].map((record) => JSON.stringify(record)).join("\n");
  const accepted = evaluateAuthenticatedMutationTail(source, traces);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.samples.length, 2);
  assert.equal(accepted.samples[1]?.routeTemplate, "/api/chats/:uuid");
  assert.equal(authenticatedMutationCpuThresholdMs, 8);

  const atLimit = evaluateAuthenticatedMutationTail(
    [tailRecord(traces[0], 8), tailRecord(traces[1], 1)]
      .map((record) => JSON.stringify(record))
      .join("\n"),
    traces,
  );
  assert.equal(atLimit.ok, false);
  assert.ok(atLimit.problems.includes("chat-finalize:cpu>=8"));

  const negative = evaluateAuthenticatedMutationTail(
    [tailRecord(traces[0], -0.001), tailRecord(traces[1], 1, "/api/chats/REDACTED")]
      .map((record) => JSON.stringify(record))
      .join("\n"),
    traces,
  );
  assert.equal(negative.ok, false);
  assert.ok(negative.problems.includes("chat-finalize:cpu<0"));

  const missing = evaluateAuthenticatedMutationTail(
    JSON.stringify(tailRecord(traces[0], 1)),
    traces,
  );
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.includes("quiz-result:tail-count=0"));

  const exceptional = tailRecord(traces[0], 1);
  exceptional.outcome = "exception";
  exceptional.exceptions = [{ message: "redacted" }];
  const rejected = evaluateAuthenticatedMutationTail(
    [exceptional, tailRecord(traces[1], 1)].map((record) => JSON.stringify(record)).join("\n"),
    traces,
  );
  assert.equal(rejected.ok, false);
  assert.ok(rejected.problems.includes("chat-finalize:outcome"));
  assert.ok(rejected.problems.includes("chat-finalize:exception"));

  const resourceEvent = evaluateAuthenticatedMutationTail(
    `${source}\n${JSON.stringify({ logs: ["exceededMemory"] })}`,
    traces,
  );
  assert.equal(resourceEvent.ok, false);
  assert.ok(resourceEvent.problems.includes("forbidden-resource-event"));
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
    captureStartedAt: 1_000,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.matchedEvents, 1);
  assert.equal(accepted.indexedVectorCount, 1);

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

  const atLimit = structuredClone(acceptedRecord);
  atLimit.cpuTime = 8;
  assert.ok(evaluateAuthenticatedMemoryQueueTail(JSON.stringify(atLimit), {
    authenticatedValidationVersionId,
    userId,
  }).problems.includes("cpu>=8"));
});

test("semantic recall evidence requires a hydrated prior turn in the exact HTTP invocation", () => {
  const authenticatedValidationVersionId = "11111111-1111-4111-8111-111111111111";
  const trace: AuthenticatedMutationTrace = {
    label: "chat-semantic-recall-provider",
    probe: "inspir-mutation-semantic-recall",
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

test("mutation Tail readiness uses only Wrangler diagnostics and public probes survive URL redaction", () => {
  assert.equal(
    wranglerTailDiagnosticIsConnected("Connected to inspirlearning, waiting for logs...\n"),
    true,
  );
  assert.equal(
    wranglerTailDiagnosticIsConnected("\u001b[32mConnected to inspirlearning, waiting for logs...\u001b[0m\n"),
    true,
  );
  assert.equal(wranglerTailDiagnosticIsConnected("Creating tail...\n"), false);
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

test("disposable cleanup inventory requires the independent exact 23-key schema", () => {
  assert.equal(authenticatedMutationInventoryNames.length, 23);
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
  assert.match(source, /"profile-update", "\/api\/me"/);
  assert.match(source, /profile-after-update/);
  assert.match(source, /profileImageHash === null/);
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
  assert.doesNotMatch(source, /mutation_tail_ready/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:authSecret|cookie|userId)/);

  const protectedSource = fs.readFileSync(
    path.resolve("lib/free-runtime/protected-ai-api.ts"),
    "utf8",
  );
  assert.match(protectedSource, /skipQueue: session\.user\.email\?\.endsWith\("@inspirlearning\.invalid"\) === true/);
  const stateSource = fs.readFileSync(
    path.resolve("lib/free-runtime/state-api.ts"),
    "utf8",
  );
  const updateMemorySource = stateSource.slice(
    stateSource.indexOf("async function updateMemoryItem"),
    stateSource.indexOf("async function deleteMemoryItem"),
  );
  assert.match(updateMemorySource, /embedding = null/);
  assert.match(updateMemorySource, /const outboxStatements = isDisposableValidationSession\(session\)/);
  assert.match(updateMemorySource, /if \(!isDisposableValidationSession\(session\)\)/);
  assert.match(updateMemorySource, /scheduleVectorCleanupWake/);
  assert.doesNotMatch(updateMemorySource, /deleteNativeMemoryVectorsBestEffort/);
  assert.match(protectedSource, /if \(input\.skipQueue\) return/);
  assert.match(stateSource, /function isDisposableValidationSession/);
  assert.equal((stateSource.match(/!isDisposableValidationSession\(session\)/g) ?? []).length, 3);

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

function tailRecord(
  trace: AuthenticatedMutationTrace,
  cpuTime: number,
  pathname = new URL(trace.requestKey, "https://inspirlearning.com").pathname,
) {
  const url = new URL(trace.requestKey, "https://inspirlearning.com");
  url.pathname = pathname;
  url.searchParams.set("authenticated_mutation_probe", trace.probe);
  return {
    outcome: "ok",
    cpuTime,
    exceptions: [] as Array<{ message: string }>,
    event: {
      request: {
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
  return { level, message: [JSON.stringify(message)] };
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
      }),
    ],
  };
}

function emptyDisposableInventory(): Record<string, number> {
  return Object.fromEntries(authenticatedMutationInventoryNames.map((name) => [name, 0]));
}
