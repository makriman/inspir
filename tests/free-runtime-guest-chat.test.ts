import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE_GUEST_CHAT_DELIVERY,
  FREE_GUEST_CHAT_SUPPORTED_LANGUAGES,
  handleFreeGuestChat,
  MAX_FREE_GUEST_CHAT_BODY_BYTES,
  MAX_FREE_GUEST_CHAT_HISTORY_CHARACTERS,
  MAX_FREE_GUEST_LEGACY_ASSISTANT_CHARACTERS,
  MAX_FREE_GUEST_LEGACY_RESPONSE_BYTES,
  requestIpForGuestQuota,
  type FreeGuestChatD1Database,
  type FreeGuestChatD1Result,
  type FreeGuestChatD1Statement,
  type FreeGuestChatEnv,
  type FreeGuestChatLogEntry,
} from "../lib/free-runtime/guest-chat";
import { supportedLanguages } from "../lib/content/languages";

const fixedNow = new Date("2026-07-11T12:00:00.000Z");
const fixedSessionId = "018f47d2-3d75-7ca1-8c2d-9c60c3966c2d";
const ssePayload = [
  'data: {"choices":[{"delta":{"content":"Hello"}}]}',
  "",
  "data: [DONE]",
  "",
  "",
].join("\n");

function narrowGeneratedD1(db: D1Database): FreeGuestChatD1Database {
  return db;
}

void narrowGeneratedD1;

test("native guest chat language allowlist stays aligned with the product", () => {
  assert.deepEqual(FREE_GUEST_CHAT_SUPPORTED_LANGUAGES, supportedLanguages);
});

test("native guest chat rejects non-strict and oversized payloads before D1 or provider work", async () => {
  const database = createMockDatabase();
  let providerCalls = 0;
  const fetchImpl = async () => {
    providerCalls += 1;
    return sseResponse();
  };

  const extraKey = await handleFreeGuestChat(
    jsonRequest({
      topicId: "learn-anything",
      content: "Hello",
      unexpected: true,
    }),
    baseEnv(database.db),
    runtime(fetchImpl),
  );
  assert.equal(extraKey.status, 400);

  const extraMessageKey = await handleFreeGuestChat(
    jsonRequest({
      topicId: "learn-anything",
      content: "Hello",
      messages: [{ role: "user", content: "Earlier", trusted: true }],
    }),
    baseEnv(database.db),
    runtime(fetchImpl),
  );
  assert.equal(extraMessageKey.status, 400);

  const tooMuchHistory = await handleFreeGuestChat(
    jsonRequest({
      topicId: "learn-anything",
      content: "Hello",
      messages: [
        { role: "user", content: "a".repeat(MAX_FREE_GUEST_CHAT_HISTORY_CHARACTERS / 2) },
        { role: "assistant", content: "b".repeat(MAX_FREE_GUEST_CHAT_HISTORY_CHARACTERS / 2) },
        { role: "user", content: "c" },
      ],
    }),
    baseEnv(database.db),
    runtime(fetchImpl),
  );
  assert.equal(tooMuchHistory.status, 400);

  const tooManyMessages = await handleFreeGuestChat(
    jsonRequest({
      topicId: "learn-anything",
      content: "Hello",
      messages: Array.from({ length: 13 }, () => ({ role: "user", content: "Earlier" })),
    }),
    baseEnv(database.db),
    runtime(fetchImpl),
  );
  assert.equal(tooManyMessages.status, 400);

  const streamedOversize = await handleFreeGuestChat(
    new Request("https://inspirlearning.com/api/guest-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(MAX_FREE_GUEST_CHAT_BODY_BYTES + 1),
    }),
    baseEnv(database.db),
    runtime(fetchImpl),
  );
  assert.equal(streamedOversize.status, 413);
  assert.equal(database.batchRuns, 0);
  assert.equal(database.globalWrites, 0);
  assert.equal(providerCalls, 0);
});

test("native guest chat honors write freeze and rejects unknown topics", async () => {
  const database = createMockDatabase();
  const frozen = await handleFreeGuestChat(
    jsonRequest({ topicId: "learn-anything", content: "Hello" }),
    { ...baseEnv(database.db), APP_WRITE_FREEZE: "true" },
    runtime(async () => sseResponse()),
  );
  assert.equal(frozen.status, 503);
  assert.equal(frozen.headers.get("retry-after"), "300");
  assert.match(await frozen.text(), /write_freeze_active/);

  const unknown = await handleFreeGuestChat(
    jsonRequest({ topicId: "not-a-seeded-topic", content: "Start" }),
    baseEnv(database.db),
    runtime(async () => sseResponse()),
  );
  assert.equal(unknown.status, 404);
  assert.equal(database.batchRuns, 0);
  assert.equal(database.globalWrites, 0);
});

test("quiz and flashcard seeds degrade to conversational guest streams", async () => {
  for (const topicId of ["quiz-me-on-trivia", "flashcard-builder"]) {
    const database = createMockDatabase();
    let providerBody: unknown;
    const response = await handleFreeGuestChat(
      jsonRequest({ topicId, content: "Start a conversational practice round" }),
      baseEnv(database.db),
      runtime(async (_input, init) => {
        providerBody = JSON.parse(String(init?.body));
        return sseResponse();
      }),
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
    assert.equal(await response.text(), ssePayload);
    assert.equal(database.batchRuns, 1);
    assert.equal(database.guestWrites, 3);
    assert.equal(database.globalWrites, 1);
    assert.ok(isRecord(providerBody));
    assert.ok(Array.isArray(providerBody.messages));
    const system = providerBody.messages[0];
    assert.ok(isRecord(system));
    assert.match(String(system.content), new RegExp(`\\(${topicId}\\)`));
  }
});

test("legacy guest clients receive bounded plain text without token-chunk SSE parsing", async () => {
  const database = createMockDatabase();
  let providerBody: unknown;
  let providerAccept = "";
  const response = await handleFreeGuestChat(
    jsonRequest(
      { topicId: "learn-anything", content: "Explain gravity" },
      { accept: "*/*" },
    ),
    baseEnv(database.db),
    runtime(async (_input, init) => {
      providerBody = JSON.parse(String(init?.body));
      providerAccept = new Headers(init?.headers).get("accept") ?? "";
      return Response.json({
        choices: [{ message: { content: "Gravity attracts masses." } }],
      });
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await response.text(), "Gravity attracts masses.");
  assert.equal(providerAccept, "application/json");
  assert.ok(isRecord(providerBody));
  assert.equal(providerBody.stream, false);
  assert.equal("stream_options" in providerBody, false);
  assert.equal(MAX_FREE_GUEST_LEGACY_RESPONSE_BYTES, 128 * 1_024);
  assert.equal(MAX_FREE_GUEST_LEGACY_ASSISTANT_CHARACTERS, 12_000);
});

test("legacy guest provider JSON fails closed when malformed or oversized", async () => {
  const malformedDatabase = createMockDatabase();
  const malformed = await handleFreeGuestChat(
    jsonRequest(
      { topicId: "learn-anything", content: "Explain gravity" },
      { accept: "*/*" },
    ),
    baseEnv(malformedDatabase.db),
    runtime(async () =>
      new Response('{"choices":[', {
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  assert.equal(malformed.status, 502);

  const oversizedDatabase = createMockDatabase();
  const oversized = await handleFreeGuestChat(
    jsonRequest(
      { topicId: "learn-anything", content: "Explain gravity" },
      { accept: "*/*" },
    ),
    baseEnv(oversizedDatabase.db),
    runtime(async () =>
      Response.json({
        choices: [{ message: { content: "x".repeat(MAX_FREE_GUEST_LEGACY_RESPONSE_BYTES) } }],
      }),
    ),
  );
  assert.equal(oversized.status, 502);
});

test("a thrown admission batch rolls back and guest quotas fail open behind a fresh global reservation", async () => {
  const database = createMockDatabase({ batchError: new Error("D1 batch failed") });
  const logs: FreeGuestChatLogEntry[] = [];
  let providerCalls = 0;
  const response = await handleFreeGuestChat(
    jsonRequest({ topicId: "learn-anything", content: "Explain gravity" }),
    baseEnv(database.db),
    runtime(async () => {
      providerCalls += 1;
      return sseResponse();
    }, logs),
  );

  assert.equal(response.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(response.headers.get("x-guest-messages-used"), "1");
  assert.equal(database.batchRuns, 1);
  assert.equal(database.guestWrites, 0);
  assert.equal(database.fallbackGlobalRuns, 1);
  assert.equal(database.globalWrites, 1);
  assert.deepEqual(
    logs.find((entry) => entry.event === "guest_quota_check_failed"),
    {
      event: "guest_quota_check_failed",
      severity: "warning",
      posture: "fail_open",
      reason: "Error",
    },
  );
});

test("every guest bucket denial atomically writes neither guest nor global counters", async () => {
  for (const bucket of ["session", "fingerprint", "ip"] as const) {
    const database = createMockDatabase({ deniedGuestBucket: bucket });
    let providerCalls = 0;
    const response = await handleFreeGuestChat(
      jsonRequest({ topicId: "learn-anything", content: "Explain gravity" }),
      baseEnv(database.db),
      runtime(async () => {
        providerCalls += 1;
        return sseResponse();
      }),
    );

    assert.equal(response.status, 429);
    assert.equal(response.headers.get("x-guest-rate-limit-bucket"), bucket);
    assert.equal(response.headers.get("x-guest-messages-used"), bucket === "session" ? "10" : "0");
    assert.equal(response.headers.get("x-guest-messages-limit"), "10");
    assert.equal(database.batchRuns, 1);
    assert.equal(database.guestWrites, 0);
    assert.equal(database.globalWrites, 0);
    assert.equal(providerCalls, 0);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(await response.text(), /Guest message limit reached/);
  }
});

test("stable guest quota keys reset after expiry without creating daily rows", async () => {
  const database = createMockDatabase();
  const env = {
    ...baseEnv(database.db),
    RATE_LIMIT_GUEST_SESSION_DAILY: "1",
    RATE_LIMIT_GUEST_FINGERPRINT_DAILY: "1",
    RATE_LIMIT_GUEST_IP_DAILY: "1",
  };
  const fetchImpl = async () => sseResponse();
  const request = () =>
    jsonRequest(
      { topicId: "learn-anything", content: "Explain gravity" },
      { cookie: `inspir_guest_session=${fixedSessionId}` },
    );

  const first = await handleFreeGuestChat(request(), env, runtime(fetchImpl, [], fixedNow));
  const sameDay = await handleFreeGuestChat(
    request(),
    env,
    runtime(fetchImpl, [], new Date("2026-07-11T13:00:00.000Z")),
  );
  const nextDay = await handleFreeGuestChat(
    request(),
    env,
    runtime(fetchImpl, [], new Date("2026-07-12T00:01:00.000Z")),
  );

  assert.equal(first.status, 200);
  assert.equal(sameDay.status, 429);
  assert.equal(sameDay.headers.get("x-guest-rate-limit-bucket"), "session");
  assert.equal(nextDay.status, 200);
  assert.equal(database.batchRuns, 3);
  assert.equal(database.guestWrites, 6);
  assert.equal(database.globalWrites, 2);
  assert.equal(database.guestWindows.size, 3);
  assert.match(
    database.preparedStatements.find((statement) => statement.query.includes("where changes() = 1"))?.query ?? "",
    /when rate_limit_windows\.reset_at <= \? then 1/,
  );
  for (const window of database.guestWindows.values()) {
    assert.deepEqual(window, {
      count: 1,
      resetAt: Date.parse("2026-07-13T00:00:00.000Z"),
    });
  }
});

test("global D1 budget failures fail closed without contacting the provider", async () => {
  const database = createMockDatabase({
    batchError: new Error("D1 batch unavailable"),
    globalError: new Error("D1 unavailable"),
  });
  const logs: FreeGuestChatLogEntry[] = [];
  let providerCalls = 0;
  const response = await handleFreeGuestChat(
    jsonRequest({ topicId: "learn-anything", content: "Explain gravity" }),
    baseEnv(database.db),
    runtime(async () => {
      providerCalls += 1;
      return sseResponse();
    }, logs),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-guest-rate-limit-bucket"), "global-ai-budget");
  assert.equal(providerCalls, 0);
  assert.equal(database.guestWrites, 0);
  assert.equal(database.globalWrites, 0);
  assert.deepEqual(
    logs.find((entry) => entry.event === "llm_budget_check_failed"),
    {
      event: "llm_budget_check_failed",
      severity: "critical",
      posture: "fail_closed",
      bucket: "global-ai-budget",
      day: "2026-07-11",
      reason: "Error",
    },
  );
});

test("guest AI admission defaults only when the global limit is absent and denies malformed limits", async () => {
  const defaultDatabase = createMockDatabase();
  const defaultEnv = baseEnv(defaultDatabase.db);
  delete defaultEnv.LLM_GLOBAL_DAILY_CALL_LIMIT;
  let defaultProviderCalls = 0;
  const defaultResponse = await handleFreeGuestChat(
    jsonRequest({ topicId: "learn-anything", content: "Explain gravity" }),
    defaultEnv,
    runtime(async () => {
      defaultProviderCalls += 1;
      return sseResponse();
    }),
  );
  assert.equal(defaultResponse.status, 200);
  assert.equal(defaultProviderCalls, 1);
  assert.equal(defaultDatabase.globalWrites, 1);

  const invalidLimits = ["", "invalid", "-1", "1.5", "1e3", "9007199254740992"];
  for (const limit of invalidLimits) {
    const database = createMockDatabase();
    let providerCalls = 0;
    const response = await handleFreeGuestChat(
      jsonRequest({ topicId: "learn-anything", content: "Explain gravity" }),
      { ...baseEnv(database.db), LLM_GLOBAL_DAILY_CALL_LIMIT: limit },
      runtime(async () => {
        providerCalls += 1;
        return sseResponse();
      }),
    );
    assert.equal(response.status, 429, limit);
    assert.equal(response.headers.get("x-guest-rate-limit-bucket"), "global-ai-budget", limit);
    assert.equal(database.batchRuns, 0, limit);
    assert.equal(database.globalWrites, 0, limit);
    assert.equal(providerCalls, 0, limit);
  }
});

test("a thrown batch cannot bypass an exhausted fallback global budget", async () => {
  const database = createMockDatabase({
    batchError: new Error("Guest admission statement failed"),
    globalDenied: true,
  });
  let providerCalls = 0;
  const response = await handleFreeGuestChat(
    jsonRequest({ topicId: "learn-anything", content: "Explain gravity" }),
    baseEnv(database.db),
    runtime(async () => {
      providerCalls += 1;
      return sseResponse();
    }),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("x-guest-rate-limit-bucket"), "global-ai-budget");
  assert.equal(database.fallbackGlobalRuns, 1);
  assert.equal(database.guestWrites, 0);
  assert.equal(database.globalWrites, 0);
  assert.equal(providerCalls, 0);
});

test("malformed admission results fail closed without a second reservation", async () => {
  const database = createMockDatabase({ malformedBatch: true });
  const logs: FreeGuestChatLogEntry[] = [];
  let providerCalls = 0;
  const response = await handleFreeGuestChat(
    jsonRequest({ topicId: "learn-anything", content: "Explain gravity" }),
    baseEnv(database.db),
    runtime(async () => {
      providerCalls += 1;
      return sseResponse();
    }, logs),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-guest-rate-limit-bucket"), "global-ai-budget");
  assert.equal(database.batchRuns, 1);
  assert.equal(database.fallbackGlobalRuns, 0);
  assert.equal(database.guestWrites, 0);
  assert.equal(database.globalWrites, 0);
  assert.equal(providerCalls, 0);
  assert.deepEqual(
    logs.find((entry) => entry.event === "llm_budget_check_failed"),
    {
      event: "llm_budget_check_failed",
      severity: "critical",
      posture: "fail_closed",
      bucket: "global-ai-budget",
      day: "2026-07-11",
      reason: "invalid_admission_result",
    },
  );
});

test("an exhausted global daily budget returns 429 and never starts an AI request", async () => {
  const database = createMockDatabase({ globalDenied: true });
  let providerCalls = 0;
  const response = await handleFreeGuestChat(
    jsonRequest({ topicId: "learn-anything", content: "Explain gravity" }),
    baseEnv(database.db),
    runtime(async () => {
      providerCalls += 1;
      return sseResponse();
    }),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("x-guest-rate-limit-bucket"), "global-ai-budget");
  assert.equal(providerCalls, 0);
  assert.equal(database.batchRuns, 1);
  assert.equal(database.guestWrites, 0);
  assert.equal(database.globalWrites, 0);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("success sets secure cookies, builds a localized compact prompt, and passes SSE through", async () => {
  const database = createMockDatabase({ guestCounts: { session: 4 } });
  let providerUrl = "";
  let providerInit: RequestInit | undefined;
  const response = await handleFreeGuestChat(
    jsonRequest(
      {
        topicId: "learn-anything",
        content: "Now explain momentum",
        preferredLanguage: "Spanish",
        messages: [
          { role: "user", content: "Earlier question" },
          { role: "assistant", content: "Earlier answer" },
        ],
      },
      {
        cookie: `inspir_guest_session=${fixedSessionId}; inspir_guest_messages_used=3`,
      },
    ),
    baseEnv(database.db),
    runtime(async (input, init) => {
      providerUrl = String(input);
      providerInit = init;
      return sseResponse();
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("x-inspir-delivery"), FREE_GUEST_CHAT_DELIVERY);
  assert.equal(response.headers.get("x-guest-messages-used"), "4");
  assert.equal(response.headers.get("x-guest-messages-limit"), "10");
  assert.equal(response.headers.get("x-guest-messages-remaining"), "6");
  assert.equal(database.batchRuns, 1);
  assert.equal(database.guestWrites, 3);
  assert.equal(database.globalWrites, 1);
  const quotaKeys = database.lastGuestQuotaKeys;
  assert.equal(quotaKeys[0], `guest-chat:session:${fixedSessionId}`);
  assert.match(quotaKeys[1] ?? "", /^guest-chat:fingerprint:[a-f0-9]{64}$/);
  assert.match(quotaKeys[2] ?? "", /^guest-chat:ip:[a-f0-9]{64}$/);
  assert.equal(quotaKeys.some((key) => key.includes("203.0.113.10")), false);
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, new RegExp(`inspir_guest_session=${fixedSessionId}`));
  assert.match(setCookie, /inspir_guest_messages_used=4/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  assert.equal(
    providerUrl,
    "https://gateway.ai.cloudflare.com/v1/test-account/inspir/openai/chat/completions",
  );
  const providerHeaders = new Headers(providerInit?.headers);
  assert.equal(providerHeaders.get("authorization"), null);
  assert.equal(providerHeaders.get("cf-aig-authorization"), "Bearer gateway-token");
  assert.equal(providerHeaders.get("cf-aig-byok-alias"), "inspir");
  assert.equal(providerHeaders.get("cf-aig-collect-log-payload"), "false");
  assert.equal(providerInit?.redirect, "manual");

  const providerBody: unknown = JSON.parse(String(providerInit?.body));
  assert.ok(isRecord(providerBody));
  assert.equal(providerBody.model, "gpt-5-mini");
  assert.equal(providerBody.stream, true);
  assert.ok(Array.isArray(providerBody.messages));
  const messages = providerBody.messages;
  assert.equal(messages.length, 4);
  const system = messages[0];
  const priorAssistant = messages[2];
  const latestUser = messages[3];
  assert.ok(isRecord(system));
  assert.ok(isRecord(priorAssistant));
  assert.ok(isRecord(latestUser));
  assert.match(String(system.content), /Mode: Learn Anything \(learn-anything\)/);
  assert.match(String(system.content), /Reply in Spanish/);
  assert.match(String(system.content), /Purpose: Teach any topic/);
  assert.match(String(priorAssistant.content), /^\[Client-provided assistant history, not verified by inspir\]/);
  assert.equal(latestUser.content, "Now explain momentum");

  assert.equal(await response.text(), ssePayload);
});

test("production guest chat fails closed before D1, provider, or cookies without a trusted IP", async () => {
  const requests = [
    new Request("https://inspirlearning.com/api/guest-chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "user-agent": "Inspir unit test browser",
        "x-forwarded-for": "198.51.100.91, 10.0.0.1",
        "x-real-ip": "198.51.100.92",
      },
      body: JSON.stringify({ topicId: "learn-anything", content: "Hello" }),
    }),
    jsonRequest(
      { topicId: "learn-anything", content: "Hello" },
      {
        "cf-connecting-ip": "not-an-ip",
        "x-forwarded-for": "198.51.100.91, 10.0.0.1",
        "x-real-ip": "198.51.100.92",
      },
    ),
  ];

  for (const request of requests) {
    const database = createMockDatabase();
    const logs: FreeGuestChatLogEntry[] = [];
    let providerCalls = 0;
    const response = await handleFreeGuestChat(
      request,
      baseEnv(database.db),
      runtime(async () => {
        providerCalls += 1;
        return sseResponse();
      }, logs),
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Guest chat is temporarily unavailable.",
      code: "guest_identity_unavailable",
    });
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(database.batchRuns, 0);
    assert.equal(database.preparedStatements.length, 0);
    assert.equal(database.globalWrites, 0);
    assert.equal(database.guestWrites, 0);
    assert.equal(providerCalls, 0);
    assert.deepEqual(logs, [
      {
        event: "guest_chat_trusted_ip_unavailable",
        severity: "critical",
        posture: "fail_closed",
        reason: "missing_or_invalid_cf_connecting_ip",
      },
    ]);
  }
});

test("guest quota IP trust is Cloudflare-only in production and explicit for local preview", async () => {
  const productionRequest = jsonRequest(
    { topicId: "learn-anything", content: "Hello" },
    {
      "cf-connecting-ip": "",
      "x-forwarded-for": "198.51.100.91, 10.0.0.1",
      "x-real-ip": "198.51.100.92",
    },
  );
  assert.equal(requestIpForGuestQuota(productionRequest), null);

  const localRequest = jsonRequest(
    { topicId: "learn-anything", content: "Hello" },
    {
      "cf-connecting-ip": "",
      "x-forwarded-for": "198.51.100.091, 10.0.0.1",
      "x-real-ip": "198.51.100.92",
    },
    "http://127.0.0.1:8787/api/guest-chat",
  );
  assert.equal(requestIpForGuestQuota(localRequest), "198.51.100.91");

  const database = createMockDatabase();
  const response = await handleFreeGuestChat(
    localRequest,
    baseEnv(database.db),
    runtime(async () => sseResponse()),
  );
  assert.equal(response.status, 200);
  assert.equal(database.lastGuestQuotaKeys.length, 3);
  assert.match(database.lastGuestQuotaKeys[2] ?? "", /^guest-chat:ip:[a-f0-9]{64}$/);
});

test("client cancellation propagates directly to the provider SSE stream", async () => {
  const database = createMockDatabase();
  let cancellationReason: unknown;
  const providerStream = new ReadableStream<Uint8Array>({
    cancel(reason) {
      cancellationReason = reason;
    },
  });
  const response = await handleFreeGuestChat(
    jsonRequest({ topicId: "learn-anything", content: "Hello" }),
    baseEnv(database.db),
    runtime(async () =>
      new Response(providerStream, {
        headers: { "content-type": "text/event-stream; charset=utf-8" },
      }),
    ),
  );

  assert.ok(response.body);
  await response.body.cancel("client-disconnected");
  assert.equal(cancellationReason, "client-disconnected");
});

test("invalid languages normalize to English and direct OpenAI remains supported", async () => {
  const database = createMockDatabase();
  let providerUrl = "";
  let providerBody: unknown;
  let providerAuthorization: string | null = null;
  const env = baseEnv(database.db);
  delete env.CLOUDFLARE_AI_GATEWAY_BASE_URL;
  delete env.CLOUDFLARE_AI_GATEWAY_TOKEN;
  delete env.CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS;
  env.OPENAI_API_KEY = "openai-token";

  const response = await handleFreeGuestChat(
    jsonRequest({
      topicId: "learn-anything",
      content: "Hello",
      preferredLanguage: "Not a supported language",
    }),
    env,
    runtime(async (input, init) => {
      providerUrl = String(input);
      providerAuthorization = new Headers(init?.headers).get("authorization");
      providerBody = JSON.parse(String(init?.body));
      return sseResponse();
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(providerUrl, "https://api.openai.com/v1/chat/completions");
  assert.equal(providerAuthorization, "Bearer openai-token");
  assert.ok(isRecord(providerBody));
  assert.ok(Array.isArray(providerBody.messages));
  const system = providerBody.messages[0];
  assert.ok(isRecord(system));
  assert.match(String(system.content), /Reply in English/);
});

test("Gateway configuration fails closed without an explicit BYOK alias", async () => {
  const database = createMockDatabase();
  const env = baseEnv(database.db);
  delete env.CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS;
  let providerCalls = 0;

  const response = await handleFreeGuestChat(
    jsonRequest({ topicId: "learn-anything", content: "Hello" }),
    env,
    runtime(async () => {
      providerCalls += 1;
      return sseResponse();
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(providerCalls, 0);
  assert.equal(database.batchRuns, 0);
  assert.equal(database.guestWrites, 0);
  assert.equal(database.globalWrites, 0);
});

test("provider errors are generic and never expose the upstream body", async () => {
  const database = createMockDatabase();
  const response = await handleFreeGuestChat(
    jsonRequest({ topicId: "learn-anything", content: "Hello" }),
    baseEnv(database.db),
    runtime(async () =>
      Response.json(
        { error: { message: "provider secret diagnostic" } },
        { status: 401 },
      ),
    ),
  );

  assert.equal(response.status, 502);
  const body = await response.text();
  assert.match(body, /assistant could not answer/i);
  assert.doesNotMatch(body, /provider secret diagnostic/);
});

type TestGuestQuotaBucket = "fingerprint" | "ip" | "session";

type MockDatabaseOptions = {
  batchError?: Error;
  deniedGuestBucket?: TestGuestQuotaBucket;
  globalDenied?: boolean;
  globalError?: Error;
  guestCounts?: Partial<Record<TestGuestQuotaBucket, number>>;
  malformedBatch?: boolean;
};

function createMockDatabase(options: MockDatabaseOptions = {}) {
  type PreparedStatement = { query: string; bindings: unknown[] };
  type MockGuestQuota = {
    bucket: TestGuestQuotaBucket;
    key: string;
    limit: number;
  };

  const preparedStatements: PreparedStatement[] = [];
  const statementData = new Map<FreeGuestChatD1Statement, PreparedStatement>();
  const guestWindows = new Map<string, { count: number; resetAt: number }>();
  const globalCounts = new Map<string, number>();
  const state = {
    batchRuns: 0,
    fallbackGlobalRuns: 0,
    guestWrites: 0,
    globalWrites: 0,
    guestWindows,
    globalCounts,
    lastGuestQuotaKeys: [] as string[],
    preparedStatements,
  };
  const db: FreeGuestChatD1Database = {
    prepare(query) {
      const prepared: { query: string; bindings: unknown[] } = { query, bindings: [] };
      state.preparedStatements.push(prepared);
      const statement: FreeGuestChatD1Statement = {
        bind(...values) {
          prepared.bindings = values;
          return statement;
        },
        async run() {
          if (!query.includes("llm_usage_daily_shards")) {
            throw new Error("Unexpected standalone D1 statement");
          }
          state.fallbackGlobalRuns += 1;
          if (options.globalError) throw options.globalError;
          const day = stringBinding(prepared.bindings[0]);
          const limit = numberBinding(prepared.bindings[4]);
          const current = state.globalCounts.get(day) ?? 0;
          if (options.globalDenied || current >= limit) return d1Result([]);
          const next = current + 1;
          state.globalCounts.set(day, next);
          state.globalWrites += 1;
          return d1Result([{ callCount: next }]);
        },
      };
      statementData.set(statement, prepared);
      return statement;
    },
    async batch(statements) {
      state.batchRuns += 1;
      if (options.batchError) throw options.batchError;
      if (statements.length !== 3) throw new Error("Expected three admission statements");

      const globalPrepared = requiredPreparedStatement(statementData, statements[0]);
      const guestPrepared = requiredPreparedStatement(statementData, statements[1]);
      const classificationPrepared = requiredPreparedStatement(statementData, statements[2]);
      if (
        !globalPrepared.query.includes("llm_usage_daily_shards") ||
        !guestPrepared.query.includes("where changes() = 1") ||
        !classificationPrepared.query.includes("end as bucket")
      ) {
        throw new Error("Unexpected admission batch shape");
      }

      const quotaBindingCount = guestPrepared.bindings.length - 5;
      if (quotaBindingCount !== 9) {
        throw new Error("Unexpected guest quota binding count");
      }
      const quotas: MockGuestQuota[] = [];
      for (let offset = 0; offset < quotaBindingCount; offset += 3) {
        quotas.push({
          bucket: guestQuotaBucket(guestPrepared.bindings[offset]),
          key: stringBinding(guestPrepared.bindings[offset + 1]),
          limit: numberBinding(guestPrepared.bindings[offset + 2]),
        });
      }
      state.lastGuestQuotaKeys = quotas.map((quota) => quota.key);

      if (options.malformedBatch) {
        return [
          d1Result([{ callCount: "invalid" }]),
          d1Result(quotas.map((quota) => ({ key: quota.key, count: 1 }))),
          d1Result([{ bucket: null }]),
        ];
      }

      const day = stringBinding(globalPrepared.bindings[quotaBindingCount]);
      const now = numberBinding(globalPrepared.bindings[quotaBindingCount + 1]);
      const globalLimit = numberBinding(globalPrepared.bindings[quotaBindingCount + 4]);
      const resetAt = numberBinding(guestPrepared.bindings[quotaBindingCount]);
      const globalCount = state.globalCounts.get(day) ?? 0;
      const exhaustedGuest = quotas.find((quota) => {
        const existing = state.guestWindows.get(quota.key);
        return existing !== undefined && existing.resetAt > now && existing.count >= quota.limit;
      });
      const deniedBucket =
        options.globalDenied || globalCount >= globalLimit
          ? "global-ai-budget"
          : (options.deniedGuestBucket ?? exhaustedGuest?.bucket);

      if (deniedBucket) {
        return [
          d1Result([]),
          d1Result([]),
          d1Result([{ bucket: deniedBucket }]),
        ];
      }

      const nextGlobalCount = globalCount + 1;
      state.globalCounts.set(day, nextGlobalCount);
      state.globalWrites += 1;
      const guestRows: Array<{ key: string; count: number }> = [];
      for (const quota of quotas) {
        const existing = state.guestWindows.get(quota.key);
        const calculatedCount = !existing || existing.resetAt <= now ? 1 : existing.count + 1;
        const count = options.guestCounts?.[quota.bucket] ?? calculatedCount;
        state.guestWindows.set(quota.key, {
          count,
          resetAt: !existing || existing.resetAt <= now ? resetAt : existing.resetAt,
        });
        state.guestWrites += 1;
        guestRows.push({ key: quota.key, count });
      }

      return [
        d1Result([{ callCount: nextGlobalCount }]),
        d1Result(guestRows),
        d1Result([{ bucket: null }]),
      ];
    },
  };
  return {
    db,
    get batchRuns() {
      return state.batchRuns;
    },
    get fallbackGlobalRuns() {
      return state.fallbackGlobalRuns;
    },
    get guestWrites() {
      return state.guestWrites;
    },
    get globalWrites() {
      return state.globalWrites;
    },
    get guestWindows() {
      return state.guestWindows;
    },
    get lastGuestQuotaKeys() {
      return state.lastGuestQuotaKeys;
    },
    get preparedStatements() {
      return state.preparedStatements;
    },
  };
}

function requiredPreparedStatement(
  statements: Map<FreeGuestChatD1Statement, { query: string; bindings: unknown[] }>,
  statement: FreeGuestChatD1Statement | undefined,
) {
  const prepared = statement ? statements.get(statement) : undefined;
  if (!prepared) throw new Error("Unknown prepared statement");
  return prepared;
}

function guestQuotaBucket(value: unknown): TestGuestQuotaBucket {
  if (value === "session" || value === "fingerprint" || value === "ip") return value;
  throw new Error("Expected a guest quota bucket");
}

function stringBinding(value: unknown) {
  if (typeof value !== "string") throw new Error("Expected a string D1 binding");
  return value;
}

function numberBinding(value: unknown) {
  if (typeof value !== "number") throw new Error("Expected a numeric D1 binding");
  return value;
}

function d1Result(results: FreeGuestChatD1Result["results"]): FreeGuestChatD1Result {
  return { success: true, results };
}

function baseEnv(db: FreeGuestChatD1Database): FreeGuestChatEnv {
  return {
    DB: db,
    APP_WRITE_FREEZE: "0",
    RATE_LIMIT_GUEST_SESSION_DAILY: "10",
    RATE_LIMIT_GUEST_FINGERPRINT_DAILY: "10",
    RATE_LIMIT_GUEST_IP_DAILY: "150",
    LLM_GLOBAL_DAILY_CALL_LIMIT: "1000",
    CLOUDFLARE_AI_GATEWAY_BASE_URL:
      "https://gateway.ai.cloudflare.com/v1/test-account/inspir/openai",
    CLOUDFLARE_AI_GATEWAY_TOKEN: "gateway-token",
    CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS: "inspir",
    OPENAI_MODEL: "gpt-5-mini",
    OPENAI_FAST_MODEL: "gpt-5-mini",
    OPENAI_REASONING_MODEL: "gpt-5-mini",
    OPENAI_STRUCTURED_MODEL: "gpt-5-mini",
  };
}

function jsonRequest(
  body: unknown,
  headers: Record<string, string> = {},
  url = "https://inspirlearning.com/api/guest-chat",
) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      "cf-connecting-ip": "203.0.113.10",
      "user-agent": "Inspir unit test browser",
      "accept-language": "en-GB,en;q=0.9",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function runtime(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  logs: FreeGuestChatLogEntry[] = [],
  now = fixedNow,
) {
  return {
    fetch: fetchImpl,
    log(entry: FreeGuestChatLogEntry) {
      logs.push(entry);
    },
    now: () => now,
    randomUUID: () => fixedSessionId,
  };
}

function sseResponse() {
  return new Response(ssePayload, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
