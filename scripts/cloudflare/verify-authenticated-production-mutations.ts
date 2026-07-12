import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getCuratedMainAppTranslationBundle } from "../../lib/i18n/main-app-curated";
import { buildStaticMainAppBundleAsset } from "../../lib/i18n/main-app-static-asset";
import { writePrivateJsonDurably } from "./d1-release-budget-ledger";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";

const workerName = "inspirlearning";
const defaultBaseUrl = "https://inspirlearning.com";
const tailSessionHeader = "x-inspir-tail-session";
const versionOverrideHeader = "Cloudflare-Workers-Version-Overrides";
const mutationProbeParameter = "authenticated_mutation_probe";
const tailWaitTimeoutMs = 45_000;
const tailOutputLimit = 16 * 1024 * 1024;
const requestTimeoutMs = 75_000;
const maximumResponseBytes = 768 * 1024;
const cleanupAttemptLimit = 3;
export const authenticatedMutationCpuThresholdMs = 8;
export const authenticatedMutationInventoryNames = [
  "users",
  "profile_photo_pointers",
  "accounts",
  "sessions",
  "verification_tokens",
  "rate_limit_windows",
  "admin_users",
  "product_events",
  "ops_events",
  "chats",
  "messages",
  "activity_runs",
  "ai_runs",
  "user_memory_settings",
  "user_memories",
  "chat_memory_summaries",
  "chat_memory_turns",
  "user_memory_profiles",
  "user_memory_summaries",
  "memory_synthesis_runs",
  "memory_source_feedback",
  "memory_events",
] as const;

export type AuthenticatedMutationTrace = {
  label: string;
  probe: string;
  requestKey: string;
  routeTemplate: string;
  method: string;
  status: number;
};

export type AuthenticatedMutationTailSample = {
  label: string;
  probe: string;
  requestKey: string;
  path: string;
  routeTemplate: string;
  method: string | null;
  status: number | null;
  outcome: string | null;
  cpuTimeMs: number | null;
  exceptionCount: number;
};

export type AuthenticatedMutationTailEvaluation = {
  ok: boolean;
  samples: AuthenticatedMutationTailSample[];
  problems: string[];
};

type MutationFetcher = typeof fetch;

type MutationFlowOptions = {
  baseUrl: string;
  expectedVersion: string;
  authSecret: string;
  runId: string;
  tailSessionToken: string;
  fetcher?: MutationFetcher;
  traceSink?: AuthenticatedMutationTrace[];
};

export type AuthenticatedMutationDisposableIdentity = {
  candidateVersionId: string;
  runId: string;
  userId: string;
  email: string;
};

type MutationRequestResult = {
  response: Response;
  text: string;
  value: unknown;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Authenticated mutation validation failed.");
    process.exitCode = 1;
  });
}

async function main() {
  if (!process.argv.includes("--confirm-production")) {
    throw new Error("Authenticated production mutation validation requires --confirm-production.");
  }
  if (process.env.REQUIRE_LIVE_AI !== "1") {
    throw new Error("Authenticated production mutation validation requires REQUIRE_LIVE_AI=1.");
  }
  const expectedVersion = requireUuid(
    getArg("--expected-version") ?? process.env.EXPECTED_WORKER_VERSION,
    "expected Worker version",
  );
  const runId = requireUuid(process.env.E2E_TEST_MUTATION_RUN_ID, "mutation run ID");
  const authSecret = requireSecret(process.env.E2E_TEST_AUTH_SECRET);
  const baseUrl = normalizeBaseUrl(
    getArg("--base-url") ?? process.env.PRODUCTION_BASE_URL ?? defaultBaseUrl,
  );
  const wrangler = path.resolve(process.cwd(), "node_modules/.bin/wrangler");
  requireActiveDeployment(wrangler, expectedVersion);

  const tailSessionToken = randomUUID();
  const tail = spawn(
    wrangler,
    [
      "tail",
      workerName,
      "--format",
      "json",
      "--version-id",
      expectedVersion,
      "--header",
      `${tailSessionHeader}:${tailSessionToken}`,
    ],
    { cwd: process.cwd(), env: commandEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const capture = captureTail(tail);
  const traces: AuthenticatedMutationTrace[] = [];
  try {
    await waitForTailReadiness({
      tail,
      output: capture.output,
      diagnostics: capture.diagnostics,
    });
    const flow = await runAuthenticatedProductionMutationFlow({
      baseUrl,
      expectedVersion,
      authSecret,
      runId,
      tailSessionToken,
      traceSink: traces,
    });
    await waitForTailProbes(tail, capture.output, traces.map((trace) => trace.probe));
    await stopTail(tail, capture.closed);
    const evaluation = evaluateAuthenticatedMutationTail(capture.output(), traces);
    const report = {
      kind: "authenticated-production-mutation-validation-v1",
      createdAt: new Date().toISOString(),
      ok: evaluation.ok && flow.cleanupVerified,
      workerName,
      expectedVersion,
      cpuThresholdExclusiveMs: authenticatedMutationCpuThresholdMs,
      requestCount: traces.length,
      traces,
      tail: evaluation,
      outcomes: {
        chatFinalized: flow.chatFinalized,
        profileMutationVerified: flow.profileMutationVerified,
        spanishActivityBundleVerified: flow.spanishActivityBundleVerified,
        legacyAnswerPersisted: flow.legacyAnswerPersisted,
        memoryCrudVerified: flow.memoryCrudVerified,
        quizCompleted: flow.quizCompleted,
        flashcardsCompleted: flow.flashcardsCompleted,
        savedQuizResultVerified: flow.savedQuizResultVerified,
        savedFlashcardResultVerified: flow.savedFlashcardResultVerified,
        cleanupVerified: flow.cleanupVerified,
        sharedGlobalAiBudgetCalls: 4,
      },
    };
    const reportPath = path.join(
      cloudflareDir(resolveBackupDir()),
      "authenticated-production-mutations-report.json",
    );
    writePrivateJsonDurably(reportPath, report, { replace: pathEntryExists(reportPath) });
    if (!report.ok) {
      throw new Error(
        `Authenticated mutation validation failed (${evaluation.problems.join("; ") || "cleanup residue"}).`,
      );
    }
    console.log(JSON.stringify({
      kind: report.kind,
      ok: report.ok,
      createdAt: report.createdAt,
      expectedVersion,
      requestCount: report.requestCount,
      maximumCpuTimeMs: Math.max(0, ...evaluation.samples.map((sample) => sample.cpuTimeMs ?? 0)),
      reportPath,
    }, null, 2));
  } finally {
    if (!hasChildExited(tail)) await stopTail(tail, capture.closed);
  }
}

export async function runAuthenticatedProductionMutationFlow(options: MutationFlowOptions) {
  const fetcher = options.fetcher ?? fetch;
  const traceSink = options.traceSink ?? [];
  const expectedIdentity = expectedAuthenticatedMutationDisposableIdentity(
    options.expectedVersion,
    options.runId,
  );
  let cookie = "";
  let requestIndex = 0;
  let primaryError: unknown = null;
  let cleanupError: unknown = null;
  let chatFinalized = false;
  let profileMutationVerified = false;
  let spanishActivityBundleVerified = false;
  let legacyAnswerPersisted = false;
  let memoryCrudVerified = false;
  let quizCompleted = false;
  let flashcardsCompleted = false;
  let savedQuizResultVerified = false;
  let savedFlashcardResultVerified = false;

  const request = async (
    label: string,
    pathname: string,
    init: RequestInit,
    expectedStatus = 200,
  ): Promise<MutationRequestResult> => {
    const url = new URL(pathname, options.baseUrl);
    const probe = createAuthenticatedMutationProbe(label, requestIndex);
    requestIndex += 1;
    url.searchParams.set(mutationProbeParameter, probe);
    const headers = new Headers(init.headers);
    headers.set("cache-control", "no-cache");
    headers.set(versionOverrideHeader, `${workerName}="${options.expectedVersion}"`);
    headers.set(tailSessionHeader, options.tailSessionToken);
    if (cookie) headers.set("cookie", cookie);
    const response = await fetcher(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs),
    });
    cookie = updatedSessionCookie(cookie, response.headers);
    const text = await readBoundedResponseText(response, maximumResponseBytes);
    traceSink.push({
      label,
      probe,
      requestKey: `${url.pathname}${url.search}`,
      routeTemplate: normalizeAuthenticatedMutationRoute(url.pathname),
      method: init.method ?? "GET",
      status: response.status,
    });
    if (response.status !== expectedStatus) {
      throw new Error(`${label} returned HTTP ${response.status}; expected ${expectedStatus}.`);
    }
    const value = parseJson(text);
    if (url.pathname === "/api/migration/e2e-auth") {
      assertAuthenticatedMutationRuntimeVersion(
        value,
        options.expectedVersion,
        `${label} response`,
      );
    }
    return { response, text, value };
  };

  const mutationBody = (action: string, userId?: string) => JSON.stringify({
    action,
    runId: options.runId,
    candidateVersionId: options.expectedVersion,
    ...(userId ? { userId } : {}),
  });

  try {
    spanishActivityBundleVerified = await verifySpanishActivityBundle(
      fetcher,
      options.baseUrl,
      options.expectedVersion,
    );
    const authenticated = await request(
      "create-disposable",
      "/api/migration/e2e-auth",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-migration-e2e-auth-secret": options.authSecret,
        },
        body: mutationBody("create-disposable"),
      },
    );
    const authenticationProof = assertAuthenticatedMutationResponseProof(
      authenticated.value,
      {
        candidateVersionId: options.expectedVersion,
        runId: options.runId,
        runtimeVersionId: options.expectedVersion,
      },
      "disposable authentication",
    );
    const auth = authenticationProof.payload;
    const user = requiredRecord(auth.user, "disposable user");
    if (
      user.id !== expectedIdentity.userId ||
      user.isAdmin !== false ||
      user.email !== expectedIdentity.email
    ) {
      throw new Error("Disposable authentication did not return a non-admin isolated user.");
    }

    const me = requiredRecord((await request("profile", "/api/me", { method: "GET" })).value, "profile");
    const meUser = requiredRecord(me.user, "profile user");
    if (meUser.id !== expectedIdentity.userId || meUser.score !== 0) {
      throw new Error("Disposable profile is not isolated at score zero.");
    }

    const disposableProfileName = "Inspir Production Validation";
    const disposableProfileLanguage = "Spanish";
    const patchedProfile = requiredRecord((await request("profile-update", "/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: disposableProfileName,
        preferredLanguage: disposableProfileLanguage,
      }),
    })).value, "updated profile");
    const patchedProfileUser = requiredRecord(patchedProfile.user, "updated profile user");
    if (
      patchedProfileUser.id !== expectedIdentity.userId ||
      patchedProfileUser.name !== disposableProfileName ||
      patchedProfileUser.preferredLanguage !== disposableProfileLanguage
    ) {
      throw new Error("Disposable profile mutation did not persist in its response.");
    }
    const profileReadback = requiredRecord((await request(
      "profile-after-update",
      "/api/me",
      { method: "GET" },
    )).value, "updated profile readback");
    const profileReadbackUser = requiredRecord(profileReadback.user, "updated profile readback user");
    profileMutationVerified =
      profileReadbackUser.id === expectedIdentity.userId &&
      profileReadbackUser.name === disposableProfileName &&
      profileReadbackUser.preferredLanguage === disposableProfileLanguage &&
      profileReadbackUser.profileImageHash === null;
    if (!profileMutationVerified) {
      throw new Error("Disposable profile mutation was not verified by an independent readback.");
    }

    const chatId = await createChat(request, "learn-anything", "chat-create");
    const streamedPrompt =
      "Explain why retrieval practice helps durable learning in two concise sentences.";
    const streamed = await request("chat-provider", "/api/chat", {
      method: "POST",
      headers: { accept: "text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({
        chatId,
        content: streamedPrompt,
      }),
    });
    if (!streamed.response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("Authenticated provider response did not stream SSE.");
    }
    const content = parseCompleteAuthenticatedOpenAiSse(streamed.text);
    const aiRunId = requireResponseUuid(streamed.response, "x-inspir-ai-run-id");
    const userMessageId = requireResponseUuid(streamed.response, "x-inspir-user-message-id");
    if (streamed.response.headers.get("x-inspir-chat-id") !== chatId || !content) {
      throw new Error("Authenticated provider stream metadata is incomplete.");
    }
    const finalized = requiredRecord((await request("chat-finalize", "/api/chat/finalize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ aiRunId, chatId, userMessageId, content }),
    })).value, "chat finalization");
    const assistantMessageId = requiredUuid(
      finalized.assistantMessageId,
      "finalized assistant message ID",
    );
    const streamDetail = requiredRecord((await request(
      "chat-stream-result",
      `/api/chats/${chatId}`,
      { method: "GET" },
    )).value, "streamed saved chat");
    const streamMessages = requiredArray(streamDetail.messages, "streamed saved messages");
    const exactUserReadback = streamMessages.some((value) => {
      const message = optionalRecord(value);
      return message?.id === userMessageId &&
        message.role === "user" &&
        message.content === streamedPrompt;
    });
    const exactAssistantReadback = streamMessages.some((value) => {
      const message = optionalRecord(value);
      return message?.id === assistantMessageId &&
        message.role === "assistant" &&
        message.content === content;
    });
    chatFinalized = finalized.ok === true && exactUserReadback && exactAssistantReadback;
    if (!chatFinalized) {
      throw new Error("Authenticated chat finalization did not survive exact message readback.");
    }

    const legacyPrompt = "Give one concise example of retrieval practice in a history lesson.";
    const legacy = await request("chat-legacy-provider", "/api/chat", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        chatId,
        content: legacyPrompt,
      }),
    });
    if (!legacy.response.headers.get("content-type")?.includes("text/plain") || !legacy.text.trim()) {
      throw new Error("Legacy authenticated provider response was not a persisted text answer.");
    }
    const legacyAiRunId = requireResponseUuid(legacy.response, "x-inspir-ai-run-id");
    const legacyUserMessageId = requireResponseUuid(
      legacy.response,
      "x-inspir-user-message-id",
    );
    const legacyAssistantMessageId = requireResponseUuid(
      legacy.response,
      "x-inspir-assistant-message-id",
    );
    const legacyDetail = requiredRecord((await request(
      "chat-legacy-result",
      `/api/chats/${chatId}`,
      { method: "GET" },
    )).value, "legacy saved chat");
    const legacyMessages = requiredArray(
      legacyDetail.messages,
      "legacy saved messages",
    );
    const legacyUserIndex = legacyMessages.findIndex((value) => {
      const message = optionalRecord(value);
      return message?.id === legacyUserMessageId &&
        message.role === "user" &&
        message.content === legacyPrompt;
    });
    const legacyAssistantIndex = legacyMessages.findIndex((value) => {
      const message = optionalRecord(value);
      return message?.id === legacyAssistantMessageId &&
        message.role === "assistant" &&
        message.content === legacy.text;
    });
    legacyAnswerPersisted =
      Boolean(legacyAiRunId) &&
      legacyUserIndex >= 0 &&
      legacyAssistantIndex === legacyUserIndex + 1;
    if (!legacyAnswerPersisted) {
      throw new Error("Legacy authenticated answer was not persisted before response completion.");
    }

    const memoryCreated = requiredRecord((await request("memory-create", "/api/memory", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-inspir-state-contract": "incremental-v2",
      },
      body: JSON.stringify({
        category: "preferences",
        content: "Use concise worked examples when explaining difficult ideas.",
      }),
    }, 201)).value, "created memory");
    const memory = requiredRecord(memoryCreated.memory, "created memory item");
    const memoryId = requiredUuid(memory.id, "created memory ID");
    const updatedMemoryContent = "Use concise worked examples and one retrieval question.";
    const memoryUpdated = requiredRecord((await request(
      "memory-update",
      `/api/memory/${memoryId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "preferences",
          content: updatedMemoryContent,
          tags: ["validation"],
          pinned: true,
          doNotMention: false,
        }),
      },
    )).value, "updated memory");
    if (requiredRecord(memoryUpdated.memory, "updated memory item").content !== updatedMemoryContent) {
      throw new Error("Disposable memory update did not persist.");
    }
    const memoryDashboard = requiredRecord((await request(
      "memory-list",
      "/api/memory",
      { method: "GET" },
    )).value, "memory dashboard");
    if (!requiredArray(memoryDashboard.memories, "memory dashboard items").some((value) => {
      const item = optionalRecord(value);
      return item?.id === memoryId && item.content === updatedMemoryContent;
    })) {
      throw new Error("Disposable memory CRUD was not visible in the saved-memory result.");
    }
    const memoryDeleted = requiredRecord((await request(
      "memory-delete",
      `/api/memory/${memoryId}`,
      { method: "DELETE" },
    )).value, "deleted memory");
    const memoryAfterDelete = requiredRecord((await request(
      "memory-after-delete",
      "/api/memory",
      { method: "GET" },
    )).value, "memory after delete");
    memoryCrudVerified = memoryDeleted.ok === true &&
      !requiredArray(memoryAfterDelete.memories, "memory items after delete")
        .some((value) => optionalRecord(value)?.id === memoryId);
    if (!memoryCrudVerified) throw new Error("Disposable memory CRUD did not complete cleanly.");

    const quizTopic = "El ciclo del agua";
    const quizChatId = await createChat(request, "quiz-me-on-trivia", "quiz-chat-create");
    let quizActivity = activityRun((await request("quiz-create", "/api/activities/quiz", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: quizChatId, topic: quizTopic }),
    })).value, "quiz");
    const quizId = requiredUuid(quizActivity.id, "quiz activity ID");
    for (let step = 0; step < 15; step += 1) {
      const state = requiredRecord(quizActivity.state, "quiz state");
      if (state.completed === true) break;
      quizActivity = activityRun((await request(
        `quiz-answer-${step}`,
        `/api/activities/quiz/${quizId}/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ answerIndex: 0 }),
        },
      )).value, "quiz");
    }
    const quizState = requiredRecord(quizActivity.state, "completed quiz state");
    quizCompleted = quizActivity.status === "completed" && quizState.completed === true;
    if (!quizCompleted) throw new Error("Quiz did not reach its complete result state.");
    savedQuizResultVerified = await verifySavedActivity(
      request,
      quizChatId,
      quizId,
      "quiz",
      "quiz-result",
      quizTopic,
    );

    const flashcardTopic = "La fotosíntesis";
    const flashcardSource = "Las plantas usan la energía de la luz para convertir dióxido de carbono y agua en glucosa y oxígeno.";
    const flashChatId = await createChat(request, "flashcard-builder", "flashcard-chat-create");
    let flashActivity = activityRun((await request("flashcard-create", "/api/activities/flashcards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: flashChatId,
        topic: flashcardTopic,
        source: flashcardSource,
      }),
    })).value, "flashcards");
    const flashId = requiredUuid(flashActivity.id, "flashcard activity ID");
    for (let step = 0; step < 20; step += 1) {
      const state = requiredRecord(flashActivity.state, "flashcard state");
      if (state.completed === true) break;
      flashActivity = activityRun((await request(
        `flashcard-reveal-${step}`,
        `/api/activities/flashcards/${flashId}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reveal" }),
        },
      )).value, "flashcards");
      flashActivity = activityRun((await request(
        `flashcard-rate-${step}`,
        `/api/activities/flashcards/${flashId}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "rate", rating: "known" }),
        },
      )).value, "flashcards");
    }
    const flashState = requiredRecord(flashActivity.state, "completed flashcard state");
    flashcardsCompleted = flashActivity.status === "completed" && flashState.completed === true;
    if (!flashcardsCompleted) throw new Error("Flashcards did not reach their complete result state.");
    savedFlashcardResultVerified = await verifySavedActivity(
      request,
      flashChatId,
      flashId,
      "flashcards",
      "flashcard-result",
      flashcardTopic,
      flashcardSource,
    );
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await cleanupDisposableMutationState({
        cleanup: async () => {
          const proof = cleanupProof(
            options.authSecret,
            options.expectedVersion,
            options.runId,
            expectedIdentity.userId,
          );
          const cleanup = await request("cleanup-disposable", "/api/migration/e2e-auth", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-migration-e2e-auth-secret": options.authSecret,
              "x-migration-e2e-cleanup-proof": proof,
            },
            body: mutationBody("cleanup-disposable", expectedIdentity.userId),
          });
          assertAuthenticatedMutationResponseProof(
            cleanup.value,
            {
              candidateVersionId: options.expectedVersion,
              runId: options.runId,
              runtimeVersionId: options.expectedVersion,
            },
            "disposable cleanup",
          );
        },
        inspect: async () => {
          const inspectedResponse = await request(
            "verify-disposable-cleanup",
            "/api/migration/e2e-auth",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-migration-e2e-auth-secret": options.authSecret,
              },
              body: mutationBody("verify-disposable-cleanup", expectedIdentity.userId),
            },
          );
          const inspected = assertAuthenticatedMutationResponseProof(
            inspectedResponse.value,
            {
              candidateVersionId: options.expectedVersion,
              runId: options.runId,
              runtimeVersionId: options.expectedVersion,
            },
            "cleanup verification",
          ).payload;
          const inventory = exactDisposableInventory(inspected.inventory);
          return { ok: inspected.ok === true && inventoryIsZero(inventory), inventory };
        },
      });
    } catch (error) {
      cleanupError = error;
    }
  }

  const failures = [primaryError, cleanupError].filter(
    (value): value is NonNullable<typeof value> => value !== null,
  );
  if (failures.length) {
    throw new AggregateError(failures, "Authenticated mutation flow did not complete safely.");
  }
  return {
    chatFinalized,
    profileMutationVerified,
    spanishActivityBundleVerified,
    legacyAnswerPersisted,
    memoryCrudVerified,
    quizCompleted,
    flashcardsCompleted,
    savedQuizResultVerified,
    savedFlashcardResultVerified,
    cleanupVerified: true,
  };
}

export async function cleanupDisposableMutationState(options: {
  cleanup: () => Promise<void>;
  inspect: () => Promise<{ ok: boolean; inventory: Record<string, unknown> }>;
  maximumAttempts?: number;
}) {
  const maximumAttempts = options.maximumAttempts ?? cleanupAttemptLimit;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 5) {
    throw new Error("Disposable cleanup attempt limit is invalid.");
  }
  let cleanupAttempts = 0;
  for (;;) {
    cleanupAttempts += 1;
    try {
      await options.cleanup();
    } catch {
      // Never retry a mutation based only on a transport error. The readback
      // below decides whether another cleanup transaction is authorized.
    }
    let readback: Awaited<ReturnType<typeof options.inspect>>;
    try {
      readback = await options.inspect();
    } catch {
      throw new Error("Disposable cleanup is indeterminate because authoritative readback failed.");
    }
    if (readback.ok && inventoryIsZero(readback.inventory)) {
      return { cleanupAttempts, inventory: readback.inventory };
    }
    if (cleanupAttempts >= maximumAttempts) {
      throw new Error("Disposable cleanup left nonzero production residue.");
    }
  }
}

export function evaluateAuthenticatedMutationTail(
  source: string,
  expected: readonly AuthenticatedMutationTrace[],
): AuthenticatedMutationTailEvaluation {
  const invocations = extractJsonObjects(source).flatMap((value) => {
    const record = optionalRecord(value);
    const event = optionalRecord(record?.event);
    const request = optionalRecord(event?.request);
    const response = optionalRecord(event?.response);
    if (typeof request?.url !== "string") return [];
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return [];
    }
    const exceptions = Array.isArray(record?.exceptions) ? record.exceptions : [];
    return [{
      probe: url.searchParams.get(mutationProbeParameter),
      requestKey: `${url.pathname}${url.search}`,
      path: url.pathname,
      routeTemplate: normalizeAuthenticatedMutationRoute(url.pathname),
      method: typeof request.method === "string" ? request.method : null,
      status: finiteNumber(response?.status),
      outcome: typeof record?.outcome === "string" ? record.outcome : null,
      cpuTimeMs: finiteNumber(record?.cpuTime),
      exceptionCount: exceptions.length,
    }];
  });
  const samples: AuthenticatedMutationTailSample[] = [];
  const problems: string[] = [];
  if (/exceededCpu|exceededMemory|Dummy queue is not implemented/i.test(source)) {
    problems.push("forbidden-resource-event");
  }
  for (const trace of expected) {
    const matches = invocations.filter((invocation) => invocation.probe === trace.probe);
    if (matches.length !== 1) {
      problems.push(`${trace.label}:tail-count=${matches.length}`);
      continue;
    }
    const invocation = matches[0];
    const sample: AuthenticatedMutationTailSample = {
      label: trace.label,
      ...invocation,
      probe: trace.probe,
    };
    samples.push(sample);
    if (invocation.routeTemplate !== trace.routeTemplate) problems.push(`${trace.label}:tail-route`);
    if (invocation.method !== trace.method) problems.push(`${trace.label}:tail-method`);
    if (invocation.status !== trace.status) problems.push(`${trace.label}:tail-status`);
    if (invocation.outcome !== "ok") problems.push(`${trace.label}:outcome`);
    if (invocation.exceptionCount !== 0) problems.push(`${trace.label}:exception`);
    if (invocation.cpuTimeMs === null) problems.push(`${trace.label}:missing-cpu`);
    else if (invocation.cpuTimeMs < 0) problems.push(`${trace.label}:cpu<0`);
    else if (invocation.cpuTimeMs >= authenticatedMutationCpuThresholdMs) {
      problems.push(`${trace.label}:cpu>=${authenticatedMutationCpuThresholdMs}`);
    }
  }
  return { ok: problems.length === 0, samples, problems };
}

async function createChat(
  request: (
    label: string,
    pathname: string,
    init: RequestInit,
    expectedStatus?: number,
  ) => Promise<MutationRequestResult>,
  topicId: string,
  label: string,
) {
  const payload = requiredRecord((await request(label, "/api/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ topicId }),
  })).value, `${label} response`);
  return requiredUuid(payload.chatId, `${label} chat ID`);
}

function activityRun(value: unknown, expectedType: "quiz" | "flashcards") {
  const payload = requiredRecord(value, `${expectedType} response`);
  const activity = requiredRecord(payload.activityRun, `${expectedType} activity`);
  if (activity.type !== expectedType) throw new Error(`${expectedType} response has the wrong type.`);
  requiredUuid(activity.id, `${expectedType} activity ID`);
  requiredRecord(activity.state, `${expectedType} activity state`);
  return activity;
}

async function verifySavedActivity(
  request: (
    label: string,
    pathname: string,
    init: RequestInit,
    expectedStatus?: number,
  ) => Promise<MutationRequestResult>,
  chatId: string,
  activityId: string,
  activityType: "quiz" | "flashcards",
  label: string,
  expectedSpanishTopic: string,
  expectedSpanishSource?: string,
) {
  const detail = requiredRecord((await request(label, `/api/chats/${chatId}`, { method: "GET" })).value, label);
  const activity = requiredRecord(detail.activityRun, `${label} activity`);
  const state = requiredRecord(activity.state, `${label} state`);
  const messages = requiredArray(detail.messages, `${label} messages`);
  const completionMessage = messages.find((value) => {
    const message = optionalRecord(value);
    const metadata = optionalRecord(message?.metadata);
    return message?.role === "assistant" &&
      metadata?.activityRunId === activityId &&
      metadata.activityType === activityType &&
      metadata.event === "completed" &&
      metadata.displayKey === `activity.${activityType === "quiz" ? "quiz" : "flashcards"}.completed`;
  });
  const completion = optionalRecord(completionMessage);
  const completionMetadata = optionalRecord(completion?.metadata);
  const displayValues = requiredRecord(
    completionMetadata?.displayValues,
    `${label} completion display values`,
  );
  if (
    activity.id !== activityId ||
    activity.type !== activityType ||
    state.completed !== true ||
    !completionMessage
  ) {
    throw new Error(`${label} did not persist its complete result experience.`);
  }
  if (typeof completion?.content !== "string" || !/^✓ [0-9]+\/[0-9]+ · \S/u.test(completion.content)) {
    throw new Error(`${label} did not persist the intentional Spanish completion presentation.`);
  }
  if (/Quiz complete:|Flashcard deck complete:/i.test(completion.content)) {
    throw new Error(`${label} incorrectly persisted the English completion template for Spanish.`);
  }
  if (activityType === "quiz") {
    assertCompleteQuizResult(activity, state, displayValues, label);
  } else {
    assertCompleteFlashcardResult(activity, state, displayValues, label);
  }
  assertSpanishActivityResult(
    state,
    displayValues,
    activityType,
    expectedSpanishTopic,
    label,
    expectedSpanishSource,
  );
  return true;
}

function assertSpanishActivityResult(
  state: Record<string, unknown>,
  displayValues: Record<string, unknown>,
  activityType: "quiz" | "flashcards",
  expectedTopic: string,
  label: string,
  expectedSource?: string,
) {
  if (
    state.topic !== expectedTopic ||
    displayValues.topic !== expectedTopic
  ) {
    throw new Error(`${label} did not preserve its Spanish topic and completion content.`);
  }
  if (activityType === "quiz") {
    const localized = requiredArray(state.questions, `${label} Spanish questions`).filter((value) => {
      const question = optionalRecord(value);
      return isPredominantlySpanishText(
        `${String(question?.prompt ?? "")} ${String(question?.explanation ?? "")}`,
        [expectedTopic],
      );
    }).length;
    if (localized < 8) throw new Error(`${label} did not return a predominantly Spanish quiz.`);
    return;
  }
  if (!expectedSource || state.source !== expectedSource) {
    throw new Error(`${label} did not preserve its Spanish source notes.`);
  }
  const localized = requiredArray(state.cards, `${label} Spanish cards`).filter((value) => {
    const card = optionalRecord(value);
    return isPredominantlySpanishText(
      `${String(card?.front ?? "")} ${String(card?.back ?? "")} ${String(card?.hint ?? "")}`,
      [expectedTopic, expectedSource],
    );
  }).length;
  if (localized < 10) throw new Error(`${label} did not return a predominantly Spanish deck.`);
}

export function hasSpanishLanguageSignal(value: string) {
  const normalized = value.normalize("NFC").toLocaleLowerCase("es");
  if (/[áéíóúñü¿¡]/u.test(normalized)) return true;
  const tokens = normalized.match(/[a-z]+/g) ?? [];
  const distinctive = new Set([
    "agua", "ciclo", "completado", "conocidas", "correcta", "fotosintesis", "mazo",
    "pregunta", "puntuacion", "respuesta", "sabidas", "tarjeta",
  ]);
  if (tokens.some((token) => distinctive.has(token))) return true;
  const markers = new Set(["el", "la", "los", "las", "de", "del", "que", "para", "una", "un", "por", "con", "es", "en"]);
  return tokens.filter((token) => markers.has(token)).length >= 2;
}

export function isPredominantlySpanishText(
  value: string,
  excludedExactPhrases: readonly string[] = [],
) {
  let normalized = value.normalize("NFC").toLocaleLowerCase("es");
  for (const phrase of excludedExactPhrases) {
    const excluded = phrase.normalize("NFC").toLocaleLowerCase("es").trim();
    if (excluded) normalized = normalized.split(excluded).join(" ");
  }
  const tokens = normalized.match(/\p{L}+/gu) ?? [];
  if (tokens.length < 4) return false;
  const spanishMarkers = new Set([
    "al", "como", "con", "cuando", "cual", "cuál", "de", "del", "donde", "dónde",
    "el", "en", "es", "esta", "este", "la", "las", "lo", "los", "para", "pero",
    "por", "porque", "que", "qué", "se", "sin", "son", "su", "una", "y",
  ]);
  const englishMarkers = new Set([
    "a", "an", "and", "are", "because", "can", "does", "explain", "for", "happens",
    "how", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "what",
    "when", "where", "which", "why", "with", "without",
  ]);
  const spanishLexicalHits = tokens.filter((token) => spanishMarkers.has(token)).length;
  const englishLexicalHits = tokens.filter((token) => englishMarkers.has(token)).length;
  const spanishOrthographicHits = Math.min(3, normalized.match(/[áéíóúñü¿¡]/gu)?.length ?? 0);
  const spanishScore = spanishLexicalHits + spanishOrthographicHits;
  return spanishScore >= 3 && spanishScore >= englishLexicalHits + 1;
}

async function verifySpanishActivityBundle(
  fetcher: MutationFetcher,
  baseUrl: string,
  expectedVersion: string,
) {
  const bundle = getCuratedMainAppTranslationBundle("Spanish");
  if (!bundle) throw new Error("The curated Spanish main-app bundle is unavailable.");
  for (const key of [
    "activity.quiz.review.score",
    "activity.quiz.review.userAnswer",
    "activity.quiz.review.correctAnswer",
    "activity.flashcards.review.complete",
    "activity.flashcards.stat.known",
  ] as const) {
    const source = bundle.sourceStrings[key];
    const translated = bundle.strings[key];
    if (
      typeof source !== "string" ||
      typeof translated !== "string" ||
      translated === source ||
      !hasSpanishLanguageSignal(translated)
    ) {
      throw new Error(`Spanish activity bundle key ${key} is not independently localized.`);
    }
  }
  const asset = buildStaticMainAppBundleAsset("es", bundle);
  const response = await fetcher(new URL(asset.publicPath, baseUrl), {
    method: "GET",
    headers: {
      [versionOverrideHeader]: `${workerName}="${expectedVersion}"`,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await readBoundedResponseText(response, maximumResponseBytes);
  if (
    response.status !== 200 ||
    response.headers.get("x-inspir-delivery") !== "static-assets" ||
    !response.headers.get("content-type")?.includes("application/json") ||
    body !== asset.serialized
  ) {
    throw new Error("Production did not serve the exact reviewed Spanish activity bundle.");
  }
  return true;
}

export function assertCompleteQuizResult(
  activity: Record<string, unknown>,
  state: Record<string, unknown>,
  displayValues: Record<string, unknown>,
  label: string,
) {
  const score = requiredIntegerInRange(state.score, 0, 10, `${label} score`);
  const maxScore = requiredIntegerInRange(state.maxScore, 1, 10, `${label} max score`);
  const questions = requiredArray(state.questions, `${label} questions`);
  if (questions.length !== maxScore || maxScore !== 10) {
    throw new Error(`${label} did not preserve its full ten-question result.`);
  }
  for (const [index, value] of questions.entries()) {
    const question = requiredRecord(value, `${label} question ${index}`);
    requiredNonEmptyString(question.id, `${label} question ${index} ID`);
    requiredNonEmptyString(question.prompt, `${label} question ${index} prompt`);
    const options = requiredArray(question.options, `${label} question ${index} options`);
    if (options.length !== 4 || options.some((option) => !isNonEmptyString(option))) {
      throw new Error(`${label} question ${index} omitted a complete option set.`);
    }
    const correctIndex = requiredIntegerInRange(
      question.correctIndex,
      0,
      3,
      `${label} question ${index} correct answer`,
    );
    requiredNonEmptyString(question.explanation, `${label} question ${index} explanation`);
    const userAnswerIndex = requiredIntegerInRange(
      question.userAnswerIndex,
      0,
      3,
      `${label} question ${index} learner answer`,
    );
    if (question.isCorrect !== (userAnswerIndex === correctIndex)) {
      throw new Error(`${label} question ${index} has inconsistent correctness feedback.`);
    }
  }
  if (
    activity.score !== score ||
    activity.maxScore !== maxScore ||
    displayValues.score !== score ||
    displayValues.maxScore !== maxScore ||
    !isNonEmptyString(displayValues.topic)
  ) {
    throw new Error(`${label} result summary does not match its structured quiz state.`);
  }
}

export function assertCompleteFlashcardResult(
  activity: Record<string, unknown>,
  state: Record<string, unknown>,
  displayValues: Record<string, unknown>,
  label: string,
) {
  const knownCount = requiredIntegerInRange(state.knownCount, 0, 12, `${label} known count`);
  const reviewedCount = requiredIntegerInRange(
    state.reviewedCount,
    0,
    12,
    `${label} reviewed count`,
  );
  const maxCards = requiredIntegerInRange(state.maxCards, 1, 12, `${label} max cards`);
  const cards = requiredArray(state.cards, `${label} cards`);
  if (
    cards.length !== maxCards ||
    maxCards !== 12 ||
    reviewedCount !== maxCards ||
    knownCount !== maxCards
  ) {
    throw new Error(`${label} did not preserve its full reviewed deck result.`);
  }
  for (const [index, value] of cards.entries()) {
    const card = requiredRecord(value, `${label} card ${index}`);
    for (const field of ["id", "front", "back", "hint", "example", "trap"] as const) {
      requiredNonEmptyString(card[field], `${label} card ${index} ${field}`);
    }
    const tags = requiredArray(card.tags, `${label} card ${index} tags`);
    if (!tags.length || tags.some((tag) => !isNonEmptyString(tag))) {
      throw new Error(`${label} card ${index} omitted its result tags.`);
    }
    if (
      card.isRevealed !== true ||
      card.rating !== "known" ||
      !isNonEmptyString(card.reviewedAt)
    ) {
      throw new Error(`${label} card ${index} omitted its revealed review result.`);
    }
  }
  if (
    activity.score !== knownCount ||
    activity.maxScore !== maxCards ||
    displayValues.knownCount !== knownCount ||
    displayValues.maxCards !== maxCards ||
    !isNonEmptyString(displayValues.topic)
  ) {
    throw new Error(`${label} result summary does not match its structured flashcard state.`);
  }
}

function requiredIntegerInRange(value: unknown, minimum: number, maximum: number, label: string) {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < minimum || value > maximum) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function requiredNonEmptyString(value: unknown, label: string) {
  if (!isNonEmptyString(value)) throw new Error(`${label} is malformed.`);
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseCompleteAuthenticatedOpenAiSse(source: string) {
  const chunks: string[] = [];
  let terminalSeen = false;
  for (const line of source.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:") && line.slice(6).trim() === "error") {
      throw new Error("Authenticated provider stream contained an error event.");
    }
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (terminalSeen) {
      throw new Error("Authenticated provider stream continued after its terminal event.");
    }
    if (data === "[DONE]") {
      terminalSeen = true;
      continue;
    }
    const value = parseJson(data);
    const record = optionalRecord(value);
    if (!record || record.error !== undefined) {
      throw new Error("Authenticated provider stream contained a malformed or error frame.");
    }
    const choices = Array.isArray(record?.choices) ? record.choices : [];
    if (!Array.isArray(record.choices)) {
      throw new Error("Authenticated provider stream frame omitted choices.");
    }
    const choice = optionalRecord(choices[0]);
    const delta = optionalRecord(choice?.delta);
    if (typeof delta?.content === "string") chunks.push(delta.content);
  }
  if (!terminalSeen) {
    throw new Error("Authenticated provider stream ended without a terminal event.");
  }
  const content = chunks.join("").trim();
  if (!content) throw new Error("Authenticated provider stream contained no assistant text.");
  return content;
}

function requireResponseUuid(response: Response, name: string) {
  return requiredUuid(response.headers.get(name), name);
}

function cleanupProof(secret: string, candidateVersionId: string, runId: string, userId: string) {
  return createHmac("sha256", secret)
    .update(`disposable-cleanup-v1\0${candidateVersionId}\0${runId}\0${userId}`)
    .digest("hex");
}

function disposableUserId(candidateVersionId: string, runId: string) {
  const bytes = createHash("sha256")
    .update(`inspir-disposable-mutation-v1\0${candidateVersionId}\0${runId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function expectedAuthenticatedMutationDisposableIdentity(
  candidateVersionId: string,
  runId: string,
): AuthenticatedMutationDisposableIdentity {
  const exactCandidateVersionId = requireUuid(
    candidateVersionId,
    "candidate Worker version",
  );
  const exactRunId = requireUuid(runId, "mutation run ID");
  const candidateSlug = exactCandidateVersionId.replaceAll("-", "").slice(0, 12);
  const runSlug = exactRunId.replaceAll("-", "");
  return {
    candidateVersionId: exactCandidateVersionId,
    runId: exactRunId,
    userId: disposableUserId(exactCandidateVersionId, exactRunId),
    email: `e2e-${candidateSlug}-${runSlug}@inspirlearning.invalid`,
  };
}

export function assertAuthenticatedMutationDisposableIdentity(
  value: unknown,
  expected: Pick<AuthenticatedMutationDisposableIdentity, "candidateVersionId" | "runId">,
  label = "disposable identity",
): AuthenticatedMutationDisposableIdentity {
  const identity = requiredRecord(value, label);
  if (!hasExactRecordKeys(identity, ["candidateVersionId", "email", "runId", "userId"])) {
    throw new Error(`${label} has the wrong exact contract.`);
  }
  const deterministic = expectedAuthenticatedMutationDisposableIdentity(
    expected.candidateVersionId,
    expected.runId,
  );
  if (
    identity.candidateVersionId !== deterministic.candidateVersionId ||
    identity.runId !== deterministic.runId ||
    identity.userId !== deterministic.userId ||
    identity.email !== deterministic.email
  ) {
    throw new Error(`${label} has the wrong deterministic candidate/run identity.`);
  }
  return deterministic;
}

function assertAuthenticatedMutationRuntimeVersion(
  value: unknown,
  expectedRuntimeVersion: string,
  label = "migration authentication response",
) {
  const payload = requiredRecord(value, label);
  const runtimeVersionId = requireUuid(expectedRuntimeVersion, "runtime Worker version");
  if (payload.runtimeVersionId !== runtimeVersionId) {
    throw new Error(`${label} came from the wrong runtime Worker version.`);
  }
  return payload;
}

export function assertAuthenticatedMutationResponseProof(
  value: unknown,
  expected: {
    candidateVersionId: string;
    runId: string;
    runtimeVersionId: string;
  },
  label = "disposable migration authentication response",
) {
  const payload = assertAuthenticatedMutationRuntimeVersion(
    value,
    expected.runtimeVersionId,
    label,
  );
  const identity = assertAuthenticatedMutationDisposableIdentity(
    payload.identity,
    expected,
    `${label} identity`,
  );
  return { payload, identity };
}

function hasExactRecordKeys(record: Record<string, unknown>, names: readonly string[]) {
  const actual = Object.keys(record).sort();
  const expected = [...names].sort();
  return actual.length === expected.length &&
    actual.every((name, index) => name === expected[index]);
}

function inventoryIsZero(inventory: Record<string, unknown>) {
  const exact = exactDisposableInventory(inventory);
  return authenticatedMutationInventoryNames.every((name) => exact[name] === 0);
}

export function exactDisposableInventory(value: unknown): Record<string, number> {
  const inventory = requiredRecord(value, "cleanup inventory");
  const actualNames = Object.keys(inventory).sort();
  const expectedNames = [...authenticatedMutationInventoryNames].sort();
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error("Cleanup inventory omitted or added a protected residue class.");
  }
  const exact: Record<string, number> = {};
  for (const name of authenticatedMutationInventoryNames) {
    const count = inventory[name];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Cleanup inventory ${name} is not a non-negative safe integer.`);
    }
    exact[name] = count;
  }
  return exact;
}

async function readBoundedResponseText(response: Response, maximumBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Authenticated mutation response exceeded its byte limit.");
    }
    chunks.push(result.value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function updatedSessionCookie(current: string, headers: Headers) {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return current;
  const match = setCookie.match(/(?:^|,\s*)((?:__Secure-)?better-auth\.session_token)=([^;,\s]+)/i);
  if (!match?.[1] || !match[2]) return current;
  return `${match[1]}=${match[2]}`;
}

async function waitForTailReadiness(input: {
  tail: ChildProcess;
  output: () => string;
  diagnostics: () => string;
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < tailWaitTimeoutMs) {
    if (wranglerTailDiagnosticIsConnected(`${input.output()}\n${input.diagnostics()}`)) return;
    if (hasChildExited(input.tail)) throw new Error("Wrangler tail exited before mutation readiness.");
    await delay(100);
  }
  throw new Error("Wrangler tail did not report a connected mutation-validation session.");
}

async function waitForTailProbes(tail: ChildProcess, output: () => string, probes: readonly string[]) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < tailWaitTimeoutMs) {
    const captured = new Set(tailRequestProbes(output()));
    if (probes.every((probe) => captured.has(probe))) return;
    if (hasChildExited(tail)) throw new Error("Wrangler tail exited before mutation evidence completed.");
    await delay(750);
  }
  throw new Error("Wrangler tail did not capture every authenticated mutation request.");
}

function tailRequestProbes(source: string) {
  return extractJsonObjects(source).flatMap((value) => {
    const record = optionalRecord(value);
    const request = optionalRecord(optionalRecord(record?.event)?.request);
    if (typeof request?.url !== "string") return [];
    try {
      const url = new URL(request.url);
      const probe = url.searchParams.get(mutationProbeParameter);
      return probe ? [probe] : [];
    } catch {
      return [];
    }
  });
}

export function wranglerTailDiagnosticIsConnected(source: string) {
  const normalized = source.replace(/\u001b\[[0-9;]*m/g, "");
  return /(?:^|\r?\n)Connected to [^\r\n]+, waiting for logs\.\.\.(?:\r?\n|$)/.test(normalized);
}

export function normalizeAuthenticatedMutationRoute(pathname: string) {
  const normalized = pathname.split("/").map((segment) =>
    segment === "REDACTED" || uuidPattern().test(segment) ? ":uuid" : segment
  ).join("/");
  return normalized || "/";
}

export function createAuthenticatedMutationProbe(label: string, requestIndex: number) {
  if (!Number.isSafeInteger(requestIndex) || requestIndex < 0) {
    throw new Error("Authenticated mutation probe index is invalid.");
  }
  return `inspir-mutation-${Date.now()}-${process.pid}-${requestIndex}-${safeProbeLabel(label)}`;
}

function captureTail(child: ChildProcess) {
  let output = "";
  let diagnostics = "";
  let truncated = false;
  const closed = Promise.all([
    streamClosed(child.stdout, (value) => {
      if (Buffer.byteLength(output) + Buffer.byteLength(value) > tailOutputLimit) truncated = true;
      else output += value;
    }),
    streamClosed(child.stderr, (value) => {
      if (Buffer.byteLength(diagnostics) + Buffer.byteLength(value) <= tailOutputLimit) diagnostics += value;
    }),
  ]);
  return {
    output: () => {
      if (truncated) throw new Error("Wrangler tail output exceeded its bounded capture size.");
      return output;
    },
    diagnostics: () => diagnostics,
    closed,
  };
}

function streamClosed(
  stream: NodeJS.ReadableStream | null,
  append: (value: string) => void,
) {
  if (!stream) return Promise.resolve();
  stream.setEncoding("utf8");
  stream.on("data", append);
  return new Promise<void>((resolve) => {
    stream.once("close", resolve);
    stream.once("end", resolve);
  });
}

async function stopTail(child: ChildProcess, closed: Promise<unknown>) {
  if (!hasChildExited(child)) child.kill("SIGINT");
  if (await resolvesWithin(closed, 5_000)) return;
  if (!hasChildExited(child)) child.kill("SIGTERM");
  if (await resolvesWithin(closed, 5_000)) return;
  if (!hasChildExited(child)) child.kill("SIGKILL");
  if (!await resolvesWithin(closed, 5_000)) throw new Error("Wrangler tail did not stop cleanly.");
}

function extractJsonObjects(source: string) {
  const values: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const value = parseJson(source.slice(start, index + 1));
        if (value !== null) values.push(value);
        start = -1;
      }
    }
  }
  return values;
}

function requireActiveDeployment(wrangler: string, expectedVersion: string) {
  const result = spawnSync(
    wrangler,
    ["deployments", "status", "--name", workerName, "--json"],
    { cwd: process.cwd(), env: commandEnv(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error("Could not verify the active production Worker version.");
  const value = parseJson(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  const deployment = optionalRecord(value) ??
    extractJsonObjects(`${result.stdout ?? ""}${result.stderr ?? ""}`)
      .map(optionalRecord)
      .find((entry) => Array.isArray(entry?.versions));
  const versions = Array.isArray(deployment?.versions) ? deployment.versions : [];
  const active = versions.flatMap((entry) => {
    const version = optionalRecord(entry);
    return typeof version?.version_id === "string" && version.percentage === 100
      ? [version.version_id]
      : [];
  });
  if (active.length !== 1 || active[0] !== expectedVersion) {
    throw new Error("Authenticated mutation validation is not pinned to the sole active Worker version.");
  }
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Authenticated mutation validation requires a clean HTTPS base URL.");
  }
  return url.origin;
}

function requireSecret(value: string | undefined) {
  const bytes = value ? Buffer.byteLength(value, "utf8") : 0;
  if (!value || bytes < 32 || bytes > 512) {
    throw new Error("E2E_TEST_AUTH_SECRET must contain 32 to 512 UTF-8 bytes.");
  }
  return value;
}

function requireUuid(value: string | undefined, label: string) {
  if (!value || !uuidPattern().test(value) || value !== value.toLowerCase()) {
    throw new Error(`Authenticated mutation validation requires an exact lowercase ${label} UUID.`);
  }
  return value;
}

function requiredUuid(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is missing.`);
  return requireUuid(value, label);
}

function uuidPattern() {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`${label} is malformed.`);
  return record;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function requiredArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeProbeLabel(value: string) {
  const safe = value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe || safe.length > 80) throw new Error("Authenticated mutation probe label is invalid.");
  return safe;
}

function hasChildExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
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

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
