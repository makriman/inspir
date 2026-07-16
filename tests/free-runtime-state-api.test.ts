import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import "./worker-crypto-test-shim";
import {
  buildBoundedMessageContentChunk,
  deriveAnonymousAnalyticsIdentity,
  deriveSignedInAnalyticsQuotaKey,
  extractNativeMemoryIntentAction,
  handleMemoryCronRequest,
  handleMemoryQueue,
  handleMemoryScheduled,
  handleStateApiRequest,
  isStateApiPath,
  knownNativeMemoryVectorIdsForText,
  MAX_QUEUED_ASSISTANT_MESSAGE_READ_CHARS,
  MAX_QUEUED_USER_MESSAGE_READ_CHARS,
  MAX_CHAT_REPLY_COUNT_SCAN,
  MAX_CHAT_SEARCH_CANDIDATES,
  MAX_CHAT_SEARCH_MESSAGE_CHARS,
  MAX_CHAT_SEARCH_MESSAGES_PER_CHAT,
  MAX_MEMORY_SUMMARY_MESSAGE_COUNT,
  MAX_RECENT_CHAT_RESULTS,
  MAX_RATE_LIMIT_PRUNE_ROWS,
  MAX_STALE_AI_RUN_REPAIRS,
  memoryIntentLexicons,
  parseChatMessagePageCursor,
  parseMemoryPageCursor,
  STATE_API_INCREMENTAL_CONTRACT_HEADER,
  STATE_API_INCREMENTAL_CONTRACT_VALUE,
  timingSafeCronBearerEquals,
  type StateApiEnv,
  type StateApiExecutionContext,
  usesIncrementalStateContract,
} from "../lib/free-runtime/state-api";
import { supportedLanguages, type SupportedLanguage } from "../lib/content/languages";
import {
  nativeMemoryVectorId,
  nativeMemoryVectorRevision,
} from "../lib/free-runtime/native-memory-vector";
import { buildNativeSessionCookie } from "../lib/free-runtime/native-session";

const localizedStudyMemoryRequests: Record<SupportedLanguage, string> = {
  English: "Remember the planets.",
  Hindi: "ग्रहों को याद रखें।",
  Spanish: "Recuerda los planetas.",
  French: "Rappelez-vous les planètes.",
  German: "Erinnere dich an die Planeten.",
  Italian: "Ricorda i pianeti.",
  Portuguese: "Lembre-se dos planetas.",
  Dutch: "Onthoud de planeten.",
  Russian: "Запомни планеты.",
  Ukrainian: "Запам'ятай планети.",
  Polish: "Zapamiętaj planety.",
  Romanian: "Amintește-ți planetele.",
  Czech: "Zapamatuj si planety.",
  Hungarian: "Emlékezz a bolygókra.",
  Greek: "Θυμήσου τους πλανήτες.",
  Turkish: "Gezegenleri hatırla.",
  Arabic: "تذكّر الكواكب.",
  Hebrew: "זכור את כוכבי הלכת.",
  Persian: "سیاره‌ها را به خاطر بسپار.",
  Urdu: "سیاروں کو یاد رکھیں۔",
  Bengali: "গ্রহগুলো মনে রাখুন।",
  Tamil: "கிரகங்களை நினைவில் கொள்ளுங்கள்.",
  Telugu: "గ్రహాలను గుర్తుంచుకోండి.",
  Marathi: "ग्रह लक्षात ठेवा.",
  Gujarati: "ગ્રહો યાદ રાખો.",
  Kannada: "ಗ್ರಹಗಳನ್ನು ನೆನಪಿಡಿ.",
  Malayalam: "ഗ്രഹങ്ങളെ ഓർക്കുക.",
  Punjabi: "ਗ੍ਰਹਿਆਂ ਨੂੰ ਯਾਦ ਰੱਖੋ।",
  Odia: "ଗ୍ରହଗୁଡ଼ିକୁ ମନେରଖ।",
  Assamese: "গ্ৰহবোৰ মনত ৰাখিব।",
  Nepali: "ग्रहहरू सम्झनुहोस्।",
  Sinhala: "ග්‍රහලෝක මතක තබා ගන්න.",
  Chinese: "记住行星。",
  Japanese: "惑星を覚えてください。",
  Korean: "행성을 기억해 주세요.",
  Vietnamese: "Hãy nhớ các hành tinh.",
  Thai: "จำดาวเคราะห์",
  Indonesian: "Ingat planet-planet.",
  Malay: "Ingat planet-planet.",
  Filipino: "Tandaan ang mga planeta.",
  Swahili: "Kumbuka sayari.",
  Afrikaans: "Onthou die planete.",
  Amharic: "ፕላኔቶችን አስታውስ።",
  Yoruba: "Rántí àwọn pílánẹ́ẹ̀tì.",
  Zulu: "Khumbula amaplanethi.",
  Hausa: "Ka tuna da duniyoyi.",
  Somali: "Xusuusnow meerayaasha.",
  Norwegian: "Husk planetene.",
  Swedish: "Kom ihåg planeterna.",
  Danish: "Husk planeterne.",
  Finnish: "Muista planeetat.",
  Icelandic: "Mundu pláneturnar.",
  Irish: "Cuimhnigh ar na pláinéid.",
  Welsh: "Cofiwch y planedau.",
  Catalan: "Recorda els planetes.",
  Basque: "Gogoratu planetak.",
  Galician: "Lembra os planetas.",
  Serbian: "Запамти планете.",
  Croatian: "Zapamti planete.",
  Bosnian: "Zapamti planete.",
  Bulgarian: "Запомни планетите.",
  Slovak: "Zapamätaj si planéty.",
  Slovenian: "Zapomni si planete.",
  Lithuanian: "Prisimink planetas.",
  Latvian: "Atceries planētas.",
  Estonian: "Pea planeete meeles.",
  Albanian: "Mbaji mend planetët.",
  Georgian: "დაიმახსოვრე პლანეტები.",
  Armenian: "Հիշիր մոլորակները։",
  Azerbaijani: "Planetləri xatırla.",
};

test("native state router recognizes only its bounded API surface", () => {
  assert.equal(isStateApiPath("/api/chats"), true);
  assert.equal(isStateApiPath("/api/chats/123"), true);
  assert.equal(isStateApiPath("/api/memory/source-feedback"), true);
  assert.equal(isStateApiPath("/api/cron/memory-dreaming"), true);
  assert.equal(isStateApiPath("/api/analytics/events"), true);
  assert.equal(isStateApiPath("/api/admin"), false);
  assert.equal(isStateApiPath("/api/games"), false);
});

test("current memory mutations explicitly negotiate lean incremental responses", () => {
  const current = new Request("https://inspirlearning.com/api/memory", {
    headers: {
      [STATE_API_INCREMENTAL_CONTRACT_HEADER]: STATE_API_INCREMENTAL_CONTRACT_VALUE,
    },
  });
  const legacy = new Request("https://inspirlearning.com/api/memory");
  assert.equal(usesIncrementalStateContract(current), true);
  assert.equal(usesIncrementalStateContract(legacy), false);

  const client = fs.readFileSync(path.resolve("components/chat/ChatClient.tsx"), "utf8");
  assert.equal(client.match(/"x-inspir-state-contract": "incremental-v2"/g)?.length, 2);
  const runtime = fs.readFileSync(path.resolve("lib/free-runtime/state-api.ts"), "utf8");
  assert.match(runtime, /return jsonResponse\(\{ \.\.\.dashboard, \.\.\.incremental \}, 201, session\)/);
  assert.match(runtime, /return jsonResponse\(\{ \.\.\.dashboard, \.\.\.incremental \}, 200, session\)/);
});

test("every supported language has deterministic personal memory actions and a localized study negative", () => {
  assert.equal(Object.keys(memoryIntentLexicons).length, supportedLanguages.length);
  for (const language of supportedLanguages) {
    const lexicon = memoryIntentLexicons[language];
    const payload = "visual examples help me learn";
    assert.deepEqual(
      extractNativeMemoryIntentAction(`${lexicon.rememberPrefix} ${payload}`, language),
      { type: "create", category: "general", content: payload },
      `${language} remember`,
    );
    assert.deepEqual(
      extractNativeMemoryIntentAction(`${lexicon.preferencePrefix} ${payload}`, language),
      { type: "create", category: "preferences", content: payload },
      `${language} preference`,
    );
    assert.deepEqual(
      extractNativeMemoryIntentAction(`${lexicon.identityPrefix} Alexandra Memory`, language),
      { type: "create", category: "identity", content: "Alexandra Memory" },
      `${language} identity`,
    );
    assert.deepEqual(
      extractNativeMemoryIntentAction(`${lexicon.forgetPrefix} ${payload}`, language),
      { type: "forget", query: payload },
      `${language} forget`,
    );
    assert.equal(
      extractNativeMemoryIntentAction(localizedStudyMemoryRequests[language], language),
      null,
      `${language} study request`,
    );
  }
});

test("memory intent parsing is typo-tolerant in English and rejects unbounded or impersonal payloads", () => {
  assert.deepEqual(
    extractNativeMemoryIntentAction(
      "Can you rememebr that I learn best with diagrams?",
      "Malayalam",
    ),
    { type: "create", category: "general", content: "I learn best with diagrams?" },
  );
  assert.equal(extractNativeMemoryIntentAction("Remember the planets.", "English"), null);
  assert.equal(
    extractNativeMemoryIntentAction(`${memoryIntentLexicons.English.rememberPrefix} four`, "English"),
    null,
  );
  assert.equal(
    extractNativeMemoryIntentAction(
      `${memoryIntentLexicons.English.rememberPrefix} ${"x".repeat(601)}`,
      "English",
    ),
    null,
  );
});

test("native memory cron preserves the authenticated GET-only contract and bounded queue posture", async () => {
  const secret = "memory-cron-test-secret";
  const unauthorized = await handleMemoryCronRequest(
    new Request(`https://inspirlearning.com/api/cron/memory-dreaming?secret=${secret}`),
    testEnv({ CRON_SECRET: secret }),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("cache-control"), "private, no-store, max-age=0, must-revalidate");

  const wrongMethod = await handleMemoryCronRequest(
    new Request("https://inspirlearning.com/api/cron/memory-dreaming", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    }),
    testEnv({ CRON_SECRET: secret }),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "GET");

  const frozenDb = new EmptyD1Database();
  const frozen = await handleMemoryCronRequest(
    new Request("https://inspirlearning.com/api/cron/memory-dreaming", {
      headers: { authorization: `Bearer ${secret}` },
    }),
    testEnv({ DB: frozenDb, CRON_SECRET: secret, APP_WRITE_FREEZE: "1" }),
  );
  assert.equal(frozen.status, 503);
  assert.equal(frozen.headers.get("retry-after"), "300");
  assert.deepEqual(frozenDb.preparedQueries, []);

  const db = new EmptyD1Database();
  const response = await handleMemoryCronRequest(
    new Request("https://inspirlearning.com/api/cron/memory-dreaming?limit=999", {
      headers: { authorization: `Bearer ${secret}` },
    }),
    testEnv({ DB: db, CRON_SECRET: secret, MEMORY_POST_TURN_QUEUE: emptyMemoryQueue() }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    due: 0,
    queued: 0,
    failed: 0,
    skipped: null,
    rateLimitPrune: { pruned: 0, cappedAt: MAX_RATE_LIMIT_PRUNE_ROWS },
  });
  assert.equal(db.preparedQueries.length, 2);
  assert.match(db.preparedQueries[0] ?? "", /limit \?1/);
  assert.match(db.preparedQueries[1] ?? "", new RegExp(`limit ${MAX_RATE_LIMIT_PRUNE_ROWS}`));
});

test("native memory cron authorization fails closed without Workers timingSafeEqual", async () => {
  const digestOnlySubtle = {
    digest: crypto.subtle.digest.bind(crypto.subtle),
  };
  assert.equal(
    await timingSafeCronBearerEquals(
      "Bearer memory-cron-test-secret",
      "memory-cron-test-secret",
      digestOnlySubtle,
    ),
    false,
  );
});

test("private saved-state routes fail closed without a verified server session", async () => {
  const response = await handleStateApiRequest(
    new Request("https://inspirlearning.com/api/chats"),
    testEnv(),
    testContext(),
  );

  assert.ok(response);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0, must-revalidate");
  assert.equal(response.headers.get("cdn-cache-control"), "private, no-store");
  assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("x-inspir-delivery"), "lean-api-worker");
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("chat deletion cannot reach D1 without a verified session", async () => {
  const db = new EmptyD1Database();
  const response = await handleStateApiRequest(
    new Request("https://inspirlearning.com/api/chats/11111111-1111-4111-8111-111111111111", {
      method: "DELETE",
    }),
    testEnv({ DB: db }),
    testContext(),
  );

  assert.ok(response);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.deepEqual(db.preparedQueries, []);
});

test("native analytics drops untrusted anonymous events without touching D1", async () => {
  const pending: Promise<unknown>[] = [];
  const db = new EmptyD1Database();
  const response = await handleStateApiRequest(
    new Request("https://inspirlearning.com/api/analytics/events", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "state-api-test" },
      body: JSON.stringify({ name: "page_view", route: "/en/chat?secret=discarded" }),
    }),
    testEnv({ DB: db }),
    {
      waitUntil(promise) {
        pending.push(promise);
      },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, recorded: false });
  assert.equal(pending.length, 0);
  assert.deepEqual(db.preparedQueries, []);
  await Promise.all(pending);
});

test("anonymous analytics sampling is secret-keyed, server-derived, and stable", async () => {
  const secret = "state-api-test-secret-that-is-long-enough";
  const now = Date.UTC(2026, 6, 11, 12);
  let sampled: Awaited<ReturnType<typeof deriveAnonymousAnalyticsIdentity>> = null;
  let sampledIp = "";
  for (let suffix = 1; suffix <= 512; suffix += 1) {
    sampledIp = `203.0.113.${suffix % 255}`;
    sampled = await deriveAnonymousAnalyticsIdentity(
      new Request("https://inspirlearning.com/api/analytics/events", {
        headers: { "cf-connecting-ip": sampledIp, "user-agent": `resettable-${suffix}` },
      }),
      secret,
      now,
    );
    if (sampled?.sampled) break;
  }
  assert.ok(sampled?.sampled, "expected a deterministic sampled IP within the bounded fixture range");
  assert.doesNotMatch(sampled.quotaKey, new RegExp(sampledIp.replaceAll(".", "\\.")));
  const changedClientState = await deriveAnonymousAnalyticsIdentity(
    new Request("https://inspirlearning.com/api/analytics/events", {
      headers: { "cf-connecting-ip": sampledIp, "user-agent": "different-client-state" },
    }),
    secret,
    now,
  );
  assert.deepEqual(changedClientState, sampled);
  assert.equal(
    await deriveAnonymousAnalyticsIdentity(
      new Request("https://inspirlearning.com/api/analytics/events"),
      secret,
      now,
    ),
    null,
  );
});

test("signed-in analytics quota keys are stable HMAC identities without persistent hourly rows", async () => {
  const secret = "state-api-test-secret-that-is-long-enough";
  const userId = "private-user-id-123";
  const first = await deriveSignedInAnalyticsQuotaKey(userId, secret);
  const repeated = await deriveSignedInAnalyticsQuotaKey(userId, secret);

  assert.ok(first);
  assert.equal(repeated, first);
  assert.equal(first.includes(userId), false);
  assert.match(first, /^analytics:signed:[a-f0-9]{32}$/);
});

test("a delayed signed-in analytics write cannot survive account deletion", async () => {
  const secret = "state-api-test-secret-that-is-long-enough";
  const userId = "11111111-1111-4111-8111-111111111111";
  const token = "delayed-analytics-session-token";
  const now = Date.now();
  const database = new DelayedAnalyticsD1Database({
    token,
    userId,
    updatedAt: now,
    expiresAt: now + 60 * 60 * 1_000,
  });
  const cookie = await buildNativeSessionCookie(
    token,
    secret,
    "https://inspirlearning.com/api/analytics/events",
    database.expiresAt,
  );
  const pending: Promise<unknown>[] = [];
  const response = await handleStateApiRequest(
    new Request("https://inspirlearning.com/api/analytics/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookie.split(";", 1)[0],
        "user-agent": "delayed-analytics-test",
      },
      body: JSON.stringify({ name: "page_view", route: "/en/chat" }),
    }),
    testEnv({ DB: database, AUTH_SECRET: secret }),
    {
      waitUntil(promise) {
        pending.push(promise);
      },
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, recorded: true });
  assert.equal(pending.length, 1);
  await database.productRunEntered;
  database.deleteUserAndReleaseProductRun();
  await Promise.all(pending);
  assert.equal(database.productInsertAttempts, 1);
  assert.equal(database.productRows, 0);
});

test("chat message cursors round-trip stable created-at and id fields", () => {
  const cursor = "1783761600000:11111111-1111-4111-8111-111111111111";
  assert.deepEqual(parseChatMessagePageCursor(cursor), {
    createdAt: 1783761600000,
    id: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(parseChatMessagePageCursor("not-a-time:id"), null);
  assert.equal(parseChatMessagePageCursor("123:"), null);
});

test("saved message recovery chunks stay bounded and preserve Unicode offsets", () => {
  const first = buildBoundedMessageContentChunk(`${"🙂".repeat(8_000)}tail`, 0);
  assert.equal([...first.content].length, 8_000);
  assert.equal(first.content, "🙂".repeat(8_000));
  assert.deepEqual(
    { hasMore: first.hasMore, nextOffset: first.nextOffset },
    { hasMore: true, nextOffset: 8_000 },
  );

  const final = buildBoundedMessageContentChunk("tail", first.nextOffset ?? 0);
  assert.deepEqual(final, { content: "tail", hasMore: false, nextOffset: null });
});

test("saved message recovery is private before any D1 lookup", async () => {
  const db = new EmptyD1Database();
  const response = await handleStateApiRequest(
    new Request(
      "https://inspirlearning.com/api/chats/11111111-1111-4111-8111-111111111111/messages/22222222-2222-4222-8222-222222222222?offset=8000",
    ),
    testEnv({ DB: db }),
    testContext(),
  );

  assert.ok(response);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.deepEqual(db.preparedQueries, []);
});

test("memory page cursors round-trip bounded stable ordering fields", () => {
  const cursor = "95:1783761600000:11111111-1111-4111-8111-111111111111";
  assert.deepEqual(parseMemoryPageCursor(cursor), {
    salience: 95,
    updatedAt: 1783761600000,
    id: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(parseMemoryPageCursor("95:not-a-time:id"), null);
  assert.equal(parseMemoryPageCursor(`${"1".repeat(301)}`), null);
});

test("marker-null pre-read still captures the exact revision a concurrent attestation can commit", async () => {
  const rowId = "11111111-1111-4111-8111-111111111111";
  const rowRevision = 1_783_915_200_000;
  const authoritativeText = "I learn best with diagrams and worked examples.";
  const historicalMarker = nativeMemoryVectorId(
    "user_memories",
    rowId,
    await nativeMemoryVectorRevision(authoritativeText),
  );
  const concurrentMarker = nativeMemoryVectorId(
    "user_memories",
    rowId,
    await nativeMemoryVectorRevision(authoritativeText),
    { rowRevision },
  );
  assert.ok(historicalMarker);
  assert.ok(concurrentMarker);

  // The mutation read embedding=null before the background writer committed
  // this marker. Cleanup must nevertheless name that exact revision.
  const cleanupIds = await knownNativeMemoryVectorIdsForText(
    "user_memories",
    rowId,
    null,
    authoritativeText,
    rowRevision,
  );
  assert.deepEqual(cleanupIds, [
    `user_memories:${rowId}`,
    historicalMarker,
    concurrentMarker,
  ]);

  const interveningEditMarker = nativeMemoryVectorId(
    "user_memories",
    rowId,
    await nativeMemoryVectorRevision("I now prefer concise text explanations."),
    { rowRevision: rowRevision + 1 },
  );
  assert.notEqual(interveningEditMarker, concurrentMarker);
});

test("native queue drops invalid work and defers all writes during a freeze", async () => {
  let acknowledged = false;
  let retried = false;
  const invalidMessage = {
    id: "invalid-job",
    timestamp: new Date(),
    body: { bad: true },
    attempts: 1,
    retry() {
      retried = true;
    },
    ack() {
      acknowledged = true;
    },
  } satisfies Message<unknown>;
  const batch = queueBatch([invalidMessage]);

  await handleMemoryQueue(batch, testEnv(), testContext());
  assert.equal(acknowledged, true);
  assert.equal(retried, false);

  let retryDelay: number | undefined;
  const frozenBatch = {
    ...queueBatch([]),
    retryAll(options?: QueueRetryOptions) {
      retryDelay = options?.delaySeconds;
    },
  } satisfies MessageBatch<unknown>;
  await handleMemoryQueue(
    frozenBatch,
    testEnv({ APP_WRITE_FREEZE: "1", APP_WRITE_FREEZE_RETRY_AFTER_SECONDS: "75" }),
    testContext(),
  );
  assert.equal(retryDelay, 75);
});

test("native scheduled memory work also fails closed during a write freeze", async () => {
  await handleMemoryScheduled(
    {
      scheduledTime: Date.now(),
      cron: "0 3 * * *",
      noRetry() {},
    },
    testEnv({ APP_WRITE_FREEZE: "true" }),
    testContext(),
  );
});

test("daily scheduled maintenance refreshes bounded admin totals off the request path", async () => {
  const pending: Promise<unknown>[] = [];
  const db = new EmptyD1Database();
  await handleMemoryScheduled(
    {
      scheduledTime: 1_783_762_560_000,
      cron: "0 3 * * *",
      noRetry() {},
    },
    testEnv({ DB: db, MEMORY_POST_TURN_QUEUE: emptyMemoryQueue() }),
    {
      waitUntil(promise) {
        pending.push(promise);
      },
    },
  );

  assert.equal(pending.length, 3);
  await Promise.all(pending);
  assert.equal(db.preparedQueries.length, 4);
  assert.match(db.preparedQueries[0] ?? "", /from user_memory_settings/);
  assert.match(db.preparedQueries[1] ?? "", /delete from rate_limit_windows/);
  assert.match(db.preparedQueries[2] ?? "", /insert into app_metadata/);
  assert.match(db.preparedQueries[3] ?? "", /status = 'failed'[\s\S]*client_finalize_timeout/);
  assert.match(db.preparedQueries[3] ?? "", new RegExp(`limit ${MAX_STALE_AI_RUN_REPAIRS}`));
});

test("native state runtime excludes OpenNext and scopes every private data lookup", () => {
  const source = fs.readFileSync(path.resolve("lib/free-runtime/state-api.ts"), "utf8");
  const schema = fs.readFileSync(path.resolve("lib/db/schema.ts"), "utf8");
  const runtimeIndexMigration = fs.readFileSync(
    path.resolve("drizzle-d1/0013_runtime_query_indexes.sql"),
    "utf8",
  );
  const wrangler = JSON.parse(fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8")) as {
    queues?: { consumers?: Array<{ max_batch_size?: number }> };
  };
  assert.doesNotMatch(source, /next\/server|\.open-next|@opennextjs|from ["']zod["']/);
  assert.match(source, /handleStateApiRequest/);
  assert.match(source, /handleMemoryScheduled/);
  assert.match(source, /refreshNativeAdminTotals\(env\.DB, controller\.scheduledTime\)/);
  assert.match(source, /event: "native_admin_totals_refresh_failed"/);
  assert.match(source, /failStaleNativeAiRuns\(env, controller\.scheduledTime\)/);
  assert.match(source, /handleMemoryQueue/);
  assert.match(source, /return nativeAuthHmacBytes\(value, secret\)/);
  assert.doesNotMatch(source, /crypto\.subtle\.importKey/);
  assert.match(source, /substr\(users\.preferred_language, 1, 61\) as preferredLanguage/);
  assert.match(source, /extractNativeMemoryIntentAction\(userMessage\.content, settings\.preferredLanguage\)/);
  const postTurnSource = source.slice(
    source.indexOf("async function processNativePostTurn"),
    source.indexOf("async function synthesizeNativeUserMemory"),
  );
  assert.match(postTurnSource, /const turnId = existingTurn\?\.id \?\? job\.userMessageId/);
  assert.match(postTurnSource, /const memoryId = job\.userMessageId/);
  assert.equal(postTurnSource.match(/returning id, user_id as userId/g)?.length, 2);
  assert.match(postTurnSource, /confirmedTurn\?\.id === pendingTurnVector\.rowId/);
  assert.match(postTurnSource, /confirmedMemory\?\.id === pendingMemoryVector\.rowId/);
  assert.doesNotMatch(postTurnSource, /crypto\.randomUUID\(\)/);
  assert.match(postTurnSource, /embedding is null or embedding like '\"p:t:%\"/);
  assert.match(postTurnSource, /embedding is null or embedding like '\"p:m:%\"/);
  assert.match(postTurnSource, /substr\(searchable_text, 1, 4001\) as searchableText/);
  assert.match(postTurnSource, /substr\(content, 1, 4001\) as content/);
  assert.match(postTurnSource, /existingTurn && toBoolean\(existingTurn\.embeddingMissing\)/);
  assert.match(postTurnSource, /toBoolean\(existingMemory\.embeddingMissing\)/);
  assert.match(postTurnSource, /text: existingTurnVectorText/);
  assert.match(postTurnSource, /text: existingMemoryVectorText/);
  assert.match(
    postTurnSource,
    /if \(!statements\.length\) \{\s+if \(!vectorRecords\.length\) return "already_current";\s+await persistNativeMemoryVectorsBestEffort/,
  );
  assert.doesNotMatch(postTurnSource, /MEMORY_VECTORIZE\.query|\.query\(/);
  assert.match(
    postTurnSource,
    /chat_memory_summaries\.last_message_id is not excluded\.last_message_id/,
  );
  assert.equal(postTurnSource.match(/eventId: queuedMemoryEventId\(job\.userMessageId/g)?.length, 3);
  assert.match(source, /const nativeMemoryVectorMarkerSql = `case/);
  assert.match(source, /NATIVE_MEMORY_VECTOR_MARKER/);
  assert.doesNotMatch(source, /JSON\.stringify\(indexed\.embedding\)/);
  assert.doesNotMatch(source, /retainAttestedNativeMemoryVectors/);
  const vectorMarkerSource = source.slice(
    source.indexOf("export async function persistNativeMemoryVectorsBestEffort"),
    source.indexOf("async function repairNativeMemoryVectorsBestEffort"),
  );
  assert.match(vectorMarkerSource, /nativeVectorWriteIntentStatement/);
  assert.match(vectorMarkerSource, /nativePendingEmbeddingStatement/);
  assert.match(vectorMarkerSource, /nativeFinalizeEmbeddingStatement/);
  assert.match(vectorMarkerSource, /fenceUnfinalizedNativeVectorWrites/);
  assert.match(vectorMarkerSource, /state = 'write_pending'/);
  assert.match(vectorMarkerSource, /state in \('write_pending', 'cleanup_fenced'\)/);
  assert.equal(vectorMarkerSource.match(/JSON\.stringify\(indexed\.marker\)/g)?.length, 3);
  const memoryEventSource = source.slice(
    source.indexOf("type QueuedMemoryEventAction"),
    source.indexOf("function serializeChat"),
  );
  assert.match(memoryEventSource, /memory\.post_turn:\$\{action\}:\$\{messageId\}/);
  assert.match(memoryEventSource, /on conflict\(id\) do nothing/);
  assert.match(memoryEventSource, /input\.eventId \?\? crypto\.randomUUID\(\)/);
  assert.match(source, /on conflict\(chat_id\) do update set\s+topic_id = excluded\.topic_id,\s+summary = excluded\.summary,\s+topics = excluded\.topics/);
  assert.match(source, /where user_id = \?2\s+and id in \([\s\S]*?where user_id = \?2 and status = 'active'[\s\S]*?limit 10/);
  assert.match(source, /reason: "explicit_chat_forget_request"/);
  const cronHandler = source.slice(
    source.indexOf("export async function handleMemoryCronRequest"),
    source.indexOf("async function enqueueDueNativeMemorySynthesis"),
  );
  assert.match(cronHandler, /timingSafeCronBearerEquals/);
  assert.match(source, /timingSafeDigestEqual\(authorization \?\? "", `Bearer \$\{secret\}`, subtle\)/);
  assert.doesNotMatch(source, /function timingSafeBytesEqual|difference \|=/);
  assert.match(cronHandler, /reason: "manual_cron"/);
  assert.doesNotMatch(cronHandler, /synthesizeNativeUserMemory|MEMORY_VECTORIZE|fetch\(/);
  assert.match(source, /where c\.id = \?1 and c\.user_id = \?2/);
  assert.match(source, /where id = \?1 and user_id = \?2/);
  assert.match(source, /where a\.id = \?1 and c\.user_id = \?2/);
  assert.match(source, /where id = \?1 and user_id = \?2 limit 1/);
  assert.match(source, /select id from chats where id = \?1 and user_id = \?2 limit 1/);
  assert.match(source, /delete from chats\s+where id = \?1 and user_id = \?2\s+returning id/);
  assert.doesNotMatch(source, /delete from chats\s+where id = \?1\s+returning id/);
  assert.match(schema, /messages = sqliteTable\([\s\S]*?chats\.id, \{ onDelete: "cascade" \}/);
  assert.match(schema, /activityRuns = sqliteTable\([\s\S]*?chats\.id, \{ onDelete: "cascade" \}/);
  assert.match(schema, /aiRuns = sqliteTable\([\s\S]*?chats\.id, \{ onDelete: "cascade" \}/);
  assert.match(schema, /rate_limit_windows_reset_at_idx/);
  assert.match(schema, /ai_runs_created_idx/);
  assert.match(runtimeIndexMigration, /rate_limit_windows_reset_at_idx[^]*`reset_at`/);
  assert.match(runtimeIndexMigration, /ai_runs_created_idx[^]*`created_at`/);
  assert.match(source, /privateNoStoreHeaders/);
  assert.match(source, /export const NATIVE_SCHEDULED_MEMORY_USER_CAP = 25/);
  assert.match(
    source,
    /const maxDailySynthesisUsers = NATIVE_SCHEDULED_MEMORY_USER_CAP/,
  );
  assert.match(source, /const maxSavedChatMessages = 30/);
  assert.equal(MAX_RECENT_CHAT_RESULTS, 100);
  assert.equal(MAX_CHAT_SEARCH_CANDIDATES, 200);
  assert.equal(MAX_CHAT_SEARCH_MESSAGES_PER_CHAT, 40);
  assert.equal(MAX_CHAT_SEARCH_MESSAGE_CHARS, 2_000);
  assert.equal(MAX_CHAT_REPLY_COUNT_SCAN, 200);
  assert.equal(MAX_MEMORY_SUMMARY_MESSAGE_COUNT, 500);
  const recentChatsHandler = source.slice(
    source.indexOf("async function listChats"),
    source.indexOf("async function createChat"),
  );
  assert.match(recentChatsHandler, /with candidate_chats as materialized/);
  assert.match(
    recentChatsHandler,
    /limit \$\{pattern \? MAX_CHAT_SEARCH_CANDIDATES : MAX_RECENT_CHAT_RESULTS\}/,
  );
  assert.match(
    recentChatsHandler,
    /substr\(recent\.content, 1, \$\{MAX_CHAT_SEARCH_MESSAGE_CHARS\}\)[\s\S]*limit \$\{MAX_CHAT_SEARCH_MESSAGES_PER_CHAT\}/,
  );
  assert.match(
    recentChatsHandler,
    /from messages counted[\s\S]*limit \$\{MAX_CHAT_REPLY_COUNT_SCAN \+ 1\}/,
  );
  assert.doesNotMatch(
    recentChatsHandler,
    /select count\(\*\) from messages counted where counted\.chat_id = c\.id/,
  );
  assert.match(
    source,
    /source_message_count = min\([\s\S]*chat_memory_summaries\.source_message_count \+ 2,[\s\S]*\$\{MAX_MEMORY_SUMMARY_MESSAGE_COUNT\}/,
  );
  assert.match(
    source,
    /select count\(\*\) from \([\s\S]*select 1 from messages[\s\S]*limit \$\{MAX_MEMORY_SUMMARY_MESSAGE_COUNT\}/,
  );
  assert.doesNotMatch(
    source,
    /select count\(\*\) from messages where chat_id = excluded\.chat_id/,
  );
  assert.match(source, /const maxJsonColumnChars = 128 \* 1024/);
  assert.match(source, /const maxMemoryDashboardItems = 50/);
  assert.match(source, /memoryPage:/);
  assert.match(source, /anonymousAnalyticsSampleDivisor = 16/);
  assert.match(source, /anonymousAnalyticsHourlyLimit = 12/);
  assert.match(source, /signedInAnalyticsHourlyLimit = 60/);
  assert.match(source, /cf-connecting-ip/);
  assert.match(source, /when role = 'user' then \$\{MAX_QUEUED_USER_MESSAGE_READ_CHARS\}/);
  assert.match(source, /else \$\{MAX_QUEUED_ASSISTANT_MESSAGE_READ_CHARS\}/);
  assert.doesNotMatch(source, /substr\(content, 1, 120001\)/);
  const queueBatchSize = wrangler.queues?.consumers?.[0]?.max_batch_size;
  assert.equal(queueBatchSize, 1);
  assert.ok(
    queueBatchSize *
      (MAX_QUEUED_USER_MESSAGE_READ_CHARS + MAX_QUEUED_ASSISTANT_MESSAGE_READ_CHARS) <
      20_000,
  );
  assert.match(source, /substr\(m\.content, 1, \$\{maxSavedMessageChars \+ 1\}\) as content/);
  assert.match(source, /substr\(m\.metadata, 1, 2048\) as metadata/);
  assert.match(source, /substr\(a\.memory_context, 1, 4096\) as memoryContext/);
  assert.match(source, /messagePage:/);
  const messageContentHandler = source.slice(
    source.indexOf("async function handleOwnedMessageContent"),
    source.indexOf("async function deleteOwnedChat"),
  );
  assert.match(messageContentHandler, /select substr\(m\.content, \?4, \$\{maxSavedMessageChars \+ 1\}\) as content/);
  assert.match(messageContentHandler, /inner join chats c on c\.id = m\.chat_id/);
  assert.match(messageContentHandler, /where c\.id = \?1 and c\.user_id = \?2/);
  assert.match(messageContentHandler, /and m\.id = \?3 and m\.chat_id = \?1/);
  assert.doesNotMatch(messageContentHandler, /select\s+m\.content\b/i);
  assert.match(source, /memoryMetadata\.contentNextOffset = contentNextOffset/);
  assert.match(source, /\{ ok: true, memory: serializeMemory\(memory\) \}/);
  assert.match(source, /settings: serializeMemorySettings\(updatedSettings\)/);
  const updateMemorySource = source.slice(
    source.indexOf("async function updateMemoryItem"),
    source.indexOf("async function deleteMemoryItem"),
  );
  assert.match(updateMemorySource, /embedding = null/);
  assert.match(updateMemorySource, /scheduleVectorCleanupWake/);
  assert.match(updateMemorySource, /knownNativeMemoryCleanupEntriesForText/);
  assert.match(updateMemorySource, /existing\.cleanupVectorId \?\? existing\.vectorMarker[\s\S]*existing\.content/);
  assert.match(updateMemorySource, /vectorCleanupOutboxValueStatement/);
  assert.match(updateMemorySource, /and updated_at = \?12 and content = \?13/);
  assert.match(updateMemorySource, /onlyAfterChange: true/);
  assert.doesNotMatch(updateMemorySource, /existing\.embedding|nextEmbedding/);
  const memorySelectSource = source.slice(
    source.indexOf("function memorySelectSql"),
    source.indexOf("export async function persistNativeMemoryVectorsBestEffort"),
  );
  assert.match(memorySelectSource, /nativeMemoryVectorMarkerSql/);
  assert.match(memorySelectSource, /as vectorMarker/);
  assert.match(memorySelectSource, /as cleanupVectorId/);
  assert.match(memorySelectSource, /as vectorPending/);
  const deleteMemorySource = source.slice(
    source.indexOf("async function deleteMemoryItem"),
    source.indexOf("async function handleMemorySourceFeedback"),
  );
  assert.match(deleteMemorySource, /scheduleVectorCleanupWake/);
  assert.match(deleteMemorySource, /knownNativeMemoryCleanupEntriesForText/);
  assert.match(deleteMemorySource, /vectorCleanupOutboxValueStatement/);
  assert.match(deleteMemorySource, /and updated_at = \?4 and content = \?5/);
  assert.match(deleteMemorySource, /onlyAfterChange: true/);
});

function testEnv(overrides: Partial<StateApiEnv> = {}): StateApiEnv {
  return {
    DB: new EmptyD1Database(),
    AUTH_SECRET: "state-api-test-secret-that-is-long-enough",
    ADMIN_EMAILS: "",
    ...overrides,
  };
}

function testContext(): StateApiExecutionContext {
  return {
    waitUntil() {},
  };
}

function emptyMemoryQueue(): NonNullable<StateApiEnv["MEMORY_POST_TURN_QUEUE"]> {
  const metadata = { metrics: { backlogCount: 0, backlogBytes: 0 } };
  return {
    async send() {
      return { metadata };
    },
    async sendBatch() {
      return { metadata };
    },
  };
}

function queueBatch(messages: readonly Message<unknown>[]): MessageBatch<unknown> {
  return {
    messages,
    queue: "inspirlearning-memory-post-turn-test",
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    retryAll() {},
    ackAll() {},
  };
}

class EmptyD1Database implements D1Database {
  readonly preparedQueries: string[] = [];

  prepare(query: string) {
    this.preparedQueries.push(query);
    return new EmptyD1Statement(query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    return Promise.all(statements.map((statement) => statement.all<T>()));
  }

  async exec() {
    return { count: 0, duration: 0 };
  }

  withSession() {
    return new EmptyD1Session();
  }

  async dump() {
    return new ArrayBuffer(0);
  }
}

class DelayedAnalyticsD1Database extends EmptyD1Database {
  readonly token: string;
  readonly userId: string;
  readonly updatedAt: number;
  readonly expiresAt: number;
  userExists = true;
  productInsertAttempts = 0;
  productRows = 0;
  private resolveProductRunEntered: () => void = () => undefined;
  readonly productRunEntered = new Promise<void>((resolve) => {
    this.resolveProductRunEntered = resolve;
  });
  private resolveProductRunRelease: () => void = () => undefined;
  private readonly productRunRelease = new Promise<void>((resolve) => {
    this.resolveProductRunRelease = resolve;
  });

  constructor(input: {
    token: string;
    userId: string;
    updatedAt: number;
    expiresAt: number;
  }) {
    super();
    this.token = input.token;
    this.userId = input.userId;
    this.updatedAt = input.updatedAt;
    this.expiresAt = input.expiresAt;
  }

  prepare(query: string) {
    this.preparedQueries.push(query);
    return new DelayedAnalyticsD1Statement(query, this);
  }

  markProductRunEntered() {
    this.resolveProductRunEntered();
  }

  waitForProductRunRelease() {
    return this.productRunRelease;
  }

  deleteUserAndReleaseProductRun() {
    this.userExists = false;
    this.resolveProductRunRelease();
  }
}

class EmptyD1Session implements D1DatabaseSession {
  prepare(query: string) {
    return new EmptyD1Statement(query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    return Promise.all(statements.map((statement) => statement.all<T>()));
  }

  getBookmark() {
    return null;
  }
}

class EmptyD1Statement implements D1PreparedStatement {
  constructor(readonly query: string) {}

  bind() {
    return this;
  }

  first<T = unknown>(_colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first() {
    return null;
  }

  async run<T = Record<string, unknown>>() {
    return emptyD1Result<T>();
  }

  async all<T = Record<string, unknown>>() {
    return emptyD1Result<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }) {
    if (options?.columnNames) {
      const rows: [string[], ...T[]] = [[]];
      return rows;
    }
    const rows: T[] = [];
    return rows;
  }
}

class DelayedAnalyticsD1Statement extends EmptyD1Statement {
  private boundValues: unknown[] = [];

  constructor(query: string, private readonly database: DelayedAnalyticsD1Database) {
    super(query);
  }

  bind(...values: unknown[]) {
    this.boundValues = values;
    return this;
  }

  first<T = unknown>(_colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first() {
    if (this.query.includes("from sessions s")) {
      return {
        session_id: "delayed-analytics-session-id",
        session_token: this.database.token,
        user_id: this.database.userId,
        expires: this.database.expiresAt,
        session_created_at: this.database.updatedAt,
        session_updated_at: this.database.updatedAt,
        ip_address: null,
        user_agent: "delayed-analytics-test",
        user_name: "Delayed analytics learner",
        user_email: "delayed.analytics@example.com",
        user_email_verified: 1,
        user_image: null,
        user_created_at: this.database.updatedAt,
        user_updated_at: this.database.updatedAt,
      };
    }
    if (this.query.includes("insert into rate_limit_windows")) {
      assert.match(this.query, /where exists \(select 1 from users where id = \?5\)/);
      assert.match(this.query, /and exists \(select 1 from users where id = \?5\)/);
      assert.equal(this.boundValues[4], this.database.userId);
      return this.database.userExists ? { count: 1 } : null;
    }
    return null;
  }

  async run<T = Record<string, unknown>>() {
    if (!this.query.includes("insert into product_events")) return super.run<T>();
    this.database.productInsertAttempts += 1;
    this.database.markProductRunEntered();
    await this.database.waitForProductRunRelease();
    assert.match(
      this.query,
      /where \?3 is null or exists \(select 1 from users where id = \?3\)/,
    );
    assert.equal(this.boundValues[2], this.database.userId);
    if (this.database.userExists) this.database.productRows += 1;
    return emptyD1Result<T>();
  }
}

function emptyD1Result<T>(): D1Result<T> {
  return {
    success: true,
    meta: {
      served_by: "state-api-test",
      duration: 0,
      changes: 0,
      last_row_id: 0,
      changed_db: false,
      size_after: 0,
      rows_read: 0,
      rows_written: 0,
    },
    results: [],
  };
}
