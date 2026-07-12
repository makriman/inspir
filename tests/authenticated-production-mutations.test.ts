import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { getCuratedMainAppTranslationBundle } from "../lib/i18n/main-app-curated";
import { buildStaticMainAppBundleAsset } from "../lib/i18n/main-app-static-asset";
import {
  authenticatedMutationCpuThresholdMs,
  authenticatedMutationInventoryNames,
  assertAuthenticatedMutationDisposableIdentity,
  assertAuthenticatedMutationResponseProof,
  assertCompleteFlashcardResult,
  assertCompleteQuizResult,
  cleanupDisposableMutationState,
  createAuthenticatedMutationProbe,
  evaluateAuthenticatedMutationTail,
  expectedAuthenticatedMutationDisposableIdentity,
  exactDisposableInventory,
  hasSpanishLanguageSignal,
  isPredominantlySpanishText,
  normalizeAuthenticatedMutationRoute,
  parseCompleteAuthenticatedOpenAiSse,
  runAuthenticatedProductionMutationFlow,
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

test("disposable cleanup inventory requires the independent exact 22-key schema", () => {
  assert.equal(authenticatedMutationInventoryNames.length, 22);
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
  assert.match(
    stateSource,
    /patch\.content !== undefined && !isDisposableValidationSession\(session\)/,
  );
  assert.match(
    stateSource,
    /if \(!isDisposableValidationSession\(session\)\) \{\s*scheduleVectorCleanup\(ctx, env, \{ memories: \[memoryId\]/,
  );
  assert.match(protectedSource, /if \(input\.skipQueue\) return/);
  assert.match(stateSource, /function isDisposableValidationSession/);
  assert.equal((stateSource.match(/!isDisposableValidationSession\(session\)/g) ?? []).length, 5);
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

function emptyDisposableInventory(): Record<string, number> {
  return Object.fromEntries(authenticatedMutationInventoryNames.map((name) => [name, 0]));
}
