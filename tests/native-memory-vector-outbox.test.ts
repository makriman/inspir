import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  drainNativeMemoryVectorCleanupOutbox,
  handleMemoryQueue,
  handleMemoryScheduled,
  handleStateApiRequest,
  parseBoundedMemorySummarySections,
  persistNativeMemoryVectorsBestEffort,
  STATE_API_INCREMENTAL_CONTRACT_HEADER,
  STATE_API_INCREMENTAL_CONTRACT_VALUE,
  type NativeSummarySection,
  type StateApiEnv,
  type StateApiExecutionContext,
} from "../lib/free-runtime/state-api";
import {
  nativeMemoryVectorId,
  nativeMemoryVectorRevision,
} from "../lib/free-runtime/native-memory-vector";
import { buildNativeSessionCookie } from "../lib/free-runtime/native-session";

const AUTH_SECRET = "native-vector-outbox-test-secret-that-is-long-enough";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const MEMORY_ID = "22222222-2222-4222-8222-222222222222";
const TURN_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_TOKEN = "native-vector-outbox-session-token";
const VERIFY_DELAY_MS = 3 * 60_000;
const PREFERENCES_SUPPRESSION_BIT = 2;
const INTERACTION_SUPPRESSION_BIT = 128;
const GENERAL_SUPPRESSION_BIT = 256;
const ALL_SUPPRESSION_BITS = 511;

test("the native Queue consumer accepts the dependency-free global cleanup wake", async () => {
  const fixture = await createFixture();
  try {
    let acknowledged = false;
    let retried = false;
    const message = {
      id: "global-cleanup-wake",
      timestamp: new Date(),
      body: {
        type: "memory.vector_cleanup.v1",
        enqueuedAt: new Date().toISOString(),
        reason: "test_global_wake",
      },
      attempts: 1,
      ack() {
        acknowledged = true;
      },
      retry() {
        retried = true;
      },
    } satisfies Message<unknown>;
    await handleMemoryQueue(
      {
        messages: [message],
        queue: "native-vector-cleanup-test",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        ackAll() {},
        retryAll() {},
      },
      fixture.env,
      { waitUntil() {} },
    );
    assert.equal(acknowledged, true);
    assert.equal(retried, false);
  } finally {
    await fixture.dispose();
  }
});

test("Scheduled recovery drains a lost cleanup wake and preserves the async absence fence", async () => {
  const fixture = await createFixture();
  try {
    const scheduledTime = Date.now();
    const vectorId = "chat_memory_turns:scheduled-recovery";
    await fixture.database.prepare(
      `insert into memory_vector_cleanup_outbox (
         vector_id, reason, state, next_attempt_at, created_at, updated_at
       ) values (?1, 'lost_wake', 'cleanup_ready', ?2, ?2, ?2)`,
    ).bind(vectorId, scheduledTime - 1).run();
    const pending: Promise<unknown>[] = [];

    await handleMemoryScheduled(
      { scheduledTime, cron: "0 3 * * *", noRetry() {} },
      fixture.env,
      {
        waitUntil(promise) {
          pending.push(promise);
        },
      },
    );
    await Promise.all(pending);

    assert.equal(fixture.vectorize.deletedIds.flat().includes(vectorId), true);
    const outbox = await fixture.database.prepare(
      `select state, absence_count as absenceCount, next_attempt_at as nextAttemptAt
       from memory_vector_cleanup_outbox where vector_id = ?1`,
    ).bind(vectorId).first<{
      state: string;
      absenceCount: number;
      nextAttemptAt: number;
    }>();
    assert.equal(outbox?.state, "verifying_absence");
    assert.equal(outbox?.absenceCount, 0);
    assert.ok(outbox?.nextAttemptAt);
    assert.ok(outbox.nextAttemptAt >= scheduledTime + VERIFY_DELAY_MS);
    assert.ok(outbox.nextAttemptAt <= Date.now() + VERIFY_DELAY_MS);
    assert.deepEqual(fixture.queue.messages.map((message) => message.type), [
      "memory.vector_cleanup.v1",
      "memory.daily_synthesis.v1",
    ]);
  } finally {
    await fixture.dispose();
  }
});

test("an all-stale Scheduled cleanup stays below the Free-plan D1 query ceiling", async () => {
  const fixture = await createFixture();
  try {
    const now = Date.now() - 1_000;
    const setup: D1PreparedStatement[] = [];
    for (let index = 1; index <= 13; index += 1) {
      const rowId = `stale-turn-${index}`;
      const vectorId = `chat_memory_turns:${rowId}`;
      setup.push(
        fixture.database.prepare(
          `insert into chat_memory_turns (
             id, user_id, searchable_text, embedding, created_at, updated_at
           ) values (?1, ?2, ?3, ?4, ?5, ?5)`,
        ).bind(
          rowId,
          USER_ID,
          `Recovered stale turn ${index}`,
          JSON.stringify(vectorId),
          now,
        ),
        fixture.database.prepare(
          `insert into memory_vector_cleanup_outbox (
             vector_id, owner_user_id, source_namespace, source_row_id,
             write_token, reason, state, write_fence_expires_at,
             next_attempt_at, created_at, updated_at
           ) values (?1, ?2, 'chat_memory_turns', ?3, ?4,
                     'stale_write_test', 'write_pending', ?5, ?5, ?5, ?5)`,
        ).bind(
          vectorId,
          USER_ID,
          rowId,
          `stale-write-token-${index}`,
          now,
        ),
      );
    }
    await fixture.database.batch(setup);

    const countingDatabase = new CountingD1Database(fixture.database);
    const pending: Promise<unknown>[] = [];
    await handleMemoryScheduled(
      { scheduledTime: now + 1_000, cron: "0 3 * * *", noRetry() {} },
      { ...fixture.env, DB: countingDatabase },
      {
        waitUntil(promise) {
          pending.push(promise);
        },
      },
    );
    await Promise.all(pending);

    assert.equal(countingDatabase.statementCount, 46);
    assert.ok(countingDatabase.statementCount < 50);
    assert.deepEqual(countingDatabase.batchSizes, [39]);
    assert.equal(
      await scalar(fixture.database, "select count(*) as value from memory_vector_cleanup_outbox"),
      0,
    );
  } finally {
    await fixture.dispose();
  }
});

test("Miniflare D1 captures more than 2,000 exact turn cleanups before one atomic history deletion", async () => {
  const fixture = await createFixture();
  try {
    await fixture.database.prepare(
      `with recursive digit(n) as (
         values (0) union all select n + 1 from digit where n < 9
       ), numbered(n) as (
         select ones.n + tens.n * 10 + hundreds.n * 100 + thousands.n * 1000 + 1
         from digit ones cross join digit tens cross join digit hundreds cross join digit thousands
       )
       insert into chat_memory_turns (
         id, user_id, searchable_text, embedding, created_at, updated_at
       )
       select 'turn-' || n, ?1, 'bounded source ' || n,
              json_quote('t:turn-' || n || ':0123456789abcdef'), ?2, ?2
       from numbered where n <= 2101`,
    ).bind(USER_ID, fixture.now).run();

    const response = await fixture.request("/api/memory", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [STATE_API_INCREMENTAL_CONTRACT_HEADER]: STATE_API_INCREMENTAL_CONTRACT_VALUE,
      },
      body: JSON.stringify({ chatHistoryEnabled: false }),
    });
    assert.equal(response.status, 200);
    assert.equal(await scalar(fixture.database, "select count(*) as value from chat_memory_turns"), 0);
    assert.equal(
      await scalar(fixture.database, "select count(*) as value from memory_vector_cleanup_outbox"),
      4_202,
    );
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from memory_vector_cleanup_outbox where state = 'cleanup_ready'",
      ),
      4_202,
    );
    assert.deepEqual(fixture.queue.messages.map((message) => message.type), [
      "memory.vector_cleanup.v1",
      "memory.daily_synthesis.v1",
    ]);
    assert.equal("userId" in (fixture.queue.messages[0] ?? {}), false);
  } finally {
    await fixture.dispose();
  }
});

test("Miniflare D1 rolls cleanup capture and the domain mutation back together", async () => {
  const fixture = await createFixture();
  try {
    await fixture.database.batch([
      fixture.database.prepare(
         `insert into chat_memory_turns
           (id, user_id, searchable_text, embedding, created_at, updated_at)
         values ('turn-a', ?1, 'source a', json_quote('t:turn-a:0123456789abcdef'), ?2, ?2)`,
      ).bind(USER_ID, fixture.now),
      fixture.database.prepare(
         `insert into chat_memory_turns
           (id, user_id, searchable_text, embedding, created_at, updated_at)
         values ('turn-b', ?1, 'source b', json_quote('t:turn-b:0123456789abcdef'), ?2, ?2)`,
      ).bind(USER_ID, fixture.now),
    ]);
    await fixture.database.prepare(
      `create trigger reject_turn_delete before delete on chat_memory_turns
       begin select raise(abort, 'forced rollback'); end`,
    ).run();

    await assert.rejects(
      fixture.request("/api/memory", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          [STATE_API_INCREMENTAL_CONTRACT_HEADER]: STATE_API_INCREMENTAL_CONTRACT_VALUE,
        },
        body: JSON.stringify({ chatHistoryEnabled: false }),
      }),
      /forced rollback|D1_ERROR/,
    );
    assert.equal(await scalar(fixture.database, "select count(*) as value from chat_memory_turns"), 2);
    assert.equal(
      await scalar(fixture.database, "select count(*) as value from memory_vector_cleanup_outbox"),
      0,
    );
    assert.equal(
      await scalar(
        fixture.database,
        "select chat_history_enabled as value from user_memory_settings where user_id = ?1",
        USER_ID,
      ),
      1,
    );
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_events"), 0);
    assert.deepEqual(fixture.queue.messages, []);
  } finally {
    await fixture.dispose();
  }
});

test("a foreign outbox owner collision aborts chat deletion with source and ownership unchanged", async () => {
  const fixture = await createFixture();
  try {
    const chatId = "44444444-4444-4444-8444-444444444444";
    const vectorId = `chat_memory_turns:${TURN_ID}`;
    await fixture.database.batch([
      fixture.database.prepare(
        "insert into chats (id, user_id) values (?1, ?2)",
      ).bind(chatId, USER_ID),
      fixture.database.prepare(
        `insert into chat_memory_turns (
           id, user_id, chat_id, searchable_text, embedding, created_at, updated_at
         ) values (?1, ?2, ?3, 'Foreign collision turn', null, ?4, ?4)`,
      ).bind(TURN_ID, USER_ID, chatId, fixture.now),
      fixture.database.prepare(
        `insert into memory_vector_cleanup_outbox (
           vector_id, owner_user_id, source_namespace, source_row_id,
           reason, state, next_attempt_at, created_at, updated_at
         ) values (?1, 'foreign-owner', 'chat_memory_turns', ?2,
                   'foreign_collision_fixture', 'cleanup_ready', ?3, ?3, ?3)`,
      ).bind(vectorId, TURN_ID, fixture.now),
    ]);
    const foreignOutboxBefore = await fixture.database.prepare(
      "select * from memory_vector_cleanup_outbox where vector_id = ?1",
    ).bind(vectorId).first<Record<string, unknown>>();
    assert.ok(foreignOutboxBefore);

    const response = await fixture.request(`/api/chats/${chatId}`, { method: "DELETE" });
    assert.equal(response.status, 500);
    assert.equal(
      await scalar(fixture.database, "select count(*) as value from chats where id = ?1", chatId),
      1,
    );
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from chat_memory_turns where id = ?1 and chat_id = ?2",
        TURN_ID,
        chatId,
      ),
      1,
    );
    const foreignOutboxAfter = await fixture.database.prepare(
      "select * from memory_vector_cleanup_outbox where vector_id = ?1",
    ).bind(vectorId).first<Record<string, unknown>>();
    assert.deepEqual(foreignOutboxAfter, foreignOutboxBefore);
    assert.deepEqual(fixture.queue.messages, []);
  } finally {
    await fixture.dispose();
  }
});

test("concurrent bounded drains claim disjoint rows and fence delayed Vectorize resurrection", async () => {
  const fixture = await createFixture();
  try {
    const now = fixture.now + 10_000;
    await fixture.database.prepare(
      `with recursive seq(n) as (
         values (1) union all select n + 1 from seq where n < 25
       )
       insert into memory_vector_cleanup_outbox (
         vector_id, reason, state, next_attempt_at, created_at, updated_at
       )
       select 'chat_memory_turns:claim-' || n, 'concurrent_claim',
              'cleanup_ready', ?1, ?1, ?1 from seq`,
    ).bind(now).run();

    const firstPass = await Promise.all([
      drainNativeMemoryVectorCleanupOutbox(fixture.env, now),
      drainNativeMemoryVectorCleanupOutbox(fixture.env, now),
    ]);
    assert.equal(firstPass.reduce((sum, result) => sum + result.claimed, 0), 25);
    assert.equal(firstPass.every((result) => result.claimed <= 20), true);
    assert.equal(new Set(fixture.vectorize.deletedIds.flat()).size, 25);
    assert.equal(fixture.vectorize.deletedIds.every((ids) => ids.length <= 20), true);
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from memory_vector_cleanup_outbox where state = 'verifying_absence'",
      ),
      25,
    );

    const tooEarly = await drainNativeMemoryVectorCleanupOutbox(
      fixture.env,
      now + VERIFY_DELAY_MS - 1,
    );
    assert.equal(tooEarly.claimed, 0);

    const resurrectedId = "chat_memory_turns:claim-1";
    fixture.vectorize.visibleIds.add(resurrectedId);
    await Promise.all([
      drainNativeMemoryVectorCleanupOutbox(fixture.env, now + VERIFY_DELAY_MS),
      drainNativeMemoryVectorCleanupOutbox(fixture.env, now + VERIFY_DELAY_MS),
    ]);
    assert.equal(
      fixture.vectorize.deletedIds.flat().filter((id) => id === resurrectedId).length,
      2,
    );
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from memory_vector_cleanup_outbox where absence_count = 1",
      ),
      24,
    );

    fixture.vectorize.visibleIds.delete(resurrectedId);
    await Promise.all([
      drainNativeMemoryVectorCleanupOutbox(fixture.env, now + VERIFY_DELAY_MS * 2),
      drainNativeMemoryVectorCleanupOutbox(fixture.env, now + VERIFY_DELAY_MS * 2),
    ]);
    assert.equal(
      await scalar(fixture.database, "select count(*) as value from memory_vector_cleanup_outbox"),
      1,
    );
    const stillFenced = await fixture.database.prepare(
      "select vector_id as vectorId, absence_count as absenceCount from memory_vector_cleanup_outbox",
    ).first<{ vectorId: string; absenceCount: number }>();
    assert.deepEqual(stillFenced, { vectorId: resurrectedId, absenceCount: 1 });

    await drainNativeMemoryVectorCleanupOutbox(fixture.env, now + VERIFY_DELAY_MS * 3);
    assert.equal(
      await scalar(fixture.database, "select count(*) as value from memory_vector_cleanup_outbox"),
      0,
    );
    assert.equal(fixture.vectorize.getRequests.every((ids) => ids.length <= 20), true);
  } finally {
    await fixture.dispose();
  }
});

test("a live cleanup lease cannot create a zero-delay duplicate wake chain", async () => {
  const fixture = await createFixture();
  const blockingVectorize = new BlockingDeleteVectorize();
  try {
    const now = fixture.now + 10_000;
    fixture.env.MEMORY_VECTORIZE = blockingVectorize;
    await fixture.database.prepare(
      `insert into memory_vector_cleanup_outbox (
         vector_id, reason, state, next_attempt_at, created_at, updated_at
       ) values ('chat_memory_turns:lease-crash', 'lease_crash',
                 'cleanup_ready', ?1, ?1, ?1)`,
    ).bind(now).run();

    const firstDrain = drainNativeMemoryVectorCleanupOutbox(fixture.env, now);
    await blockingVectorize.deleteStarted.promise;

    let acknowledged = false;
    let retryDelaySeconds: number | null = null;
    const duplicateMessage = {
      id: "lease-crash-retry",
      timestamp: new Date(now + 1),
      body: {
        type: "memory.vector_cleanup.v1",
        enqueuedAt: new Date(now + 1).toISOString(),
        reason: "lease_crash_retry",
      },
      attempts: 1,
      ack() {
        acknowledged = true;
      },
      retry(options?: { delaySeconds?: number }) {
        retryDelaySeconds = options?.delaySeconds ?? 0;
      },
    } satisfies Message<unknown>;
    await handleMemoryQueue(
      {
        messages: [duplicateMessage],
        queue: "native-vector-cleanup-test",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        ackAll() {},
        retryAll() {},
      },
      fixture.env,
      { waitUntil() {} },
    );
    assert.equal(acknowledged, false);
    assert.equal(retryDelaySeconds, 60);
    assert.deepEqual(fixture.queue.messages, []);
    const leased = await fixture.database.prepare(
      `select next_attempt_at as nextAttemptAt, lease_until as leaseUntil
       from memory_vector_cleanup_outbox where vector_id = 'chat_memory_turns:lease-crash'`,
    ).first<{ nextAttemptAt: number; leaseUntil: number }>();
    assert.ok(leased);
    assert.equal(leased.nextAttemptAt, leased.leaseUntil);
    assert.equal(leased.leaseUntil, now + 5 * 60_000);

    blockingVectorize.releaseDelete.resolve();
    await firstDrain;
  } finally {
    blockingVectorize.releaseDelete.resolve();
    await fixture.dispose();
  }
});

test("suppressive feedback retires direct sources, queues summary synthesis, and emits no false audit on CAS loss", async () => {
  const fixture = await createFixture();
  try {
    const memoryText = "I learn best with visual worked examples.";
    const memoryRevision = fixture.now - 1_000;
    const memoryVectorId = nativeMemoryVectorId(
      "user_memories",
      MEMORY_ID,
      await nativeMemoryVectorRevision(memoryText),
      { rowRevision: memoryRevision },
    );
    assert.ok(memoryVectorId);
    await insertMemory(
      fixture.database,
      memoryText,
      memoryRevision,
      JSON.stringify(memoryVectorId),
    );
    await insertDerivedMemorySnapshot(fixture.database, memoryRevision, [{
      id: "native-memory-general",
      title: "General",
      category: "general",
      summary: memoryText,
      sourceMemoryIds: [MEMORY_ID],
    }]);

    const memoryResponse = await fixture.request("/api/memory/source-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memoryId: MEMORY_ID, action: "dont_mention" }),
    });
    assert.equal(memoryResponse.status, 200);
    const suppressedMemory = await fixture.database.prepare(
      `select do_not_mention as doNotMention, embedding
       from user_memories where id = ?1`,
    ).bind(MEMORY_ID).first<{ doNotMention: number; embedding: string | null }>();
    assert.deepEqual(suppressedMemory, { doNotMention: 1, embedding: null });
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_summaries"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_profiles"), 0);
    assert.equal(await summarySuppressionMask(fixture.database), 0);
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from memory_vector_cleanup_outbox where state = 'cleanup_ready'",
      ),
      3,
    );
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from memory_vector_cleanup_outbox where state = 'cleanup_fenced'",
      ),
      0,
    );
    assert.deepEqual(fixture.queue.messages.map((message) => message.type), [
      "memory.vector_cleanup.v1",
      "memory.daily_synthesis.v1",
    ]);

    const turnText = "Question: How should I revise? Answer: Use worked examples.";
    const turnVectorId = nativeMemoryVectorId(
      "chat_memory_turns",
      TURN_ID,
      await nativeMemoryVectorRevision(turnText),
    );
    assert.ok(turnVectorId);
    await fixture.database.prepare(
      `insert into chat_memory_turns (
         id, user_id, searchable_text, embedding, created_at, updated_at
       ) values (?1, ?2, ?3, ?4, ?5, ?5)`,
    ).bind(TURN_ID, USER_ID, turnText, JSON.stringify(turnVectorId), fixture.now).run();
    const turnResponse = await fixture.request("/api/memory/source-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatTurnId: TURN_ID, action: "not_relevant" }),
    });
    assert.equal(turnResponse.status, 200);
    assert.equal(
      await scalar(fixture.database, "select count(*) as value from chat_memory_turns where id = ?1", TURN_ID),
      0,
    );
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_source_feedback"), 2);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_events"), 2);
    assert.deepEqual(fixture.queue.messages.map((message) => message.type), [
      "memory.vector_cleanup.v1",
      "memory.daily_synthesis.v1",
      "memory.vector_cleanup.v1",
      "memory.daily_synthesis.v1",
    ]);

    const raced = await createFixture();
    try {
      const racedRevision = raced.now - 1_000;
      const racedText = "I prefer diagrams for difficult concepts.";
      const racedVectorId = nativeMemoryVectorId(
        "user_memories",
        MEMORY_ID,
        await nativeMemoryVectorRevision(racedText),
        { rowRevision: racedRevision },
      );
      assert.ok(racedVectorId);
      await insertMemory(
        raced.database,
        racedText,
        racedRevision,
        JSON.stringify(racedVectorId),
      );
      const racingDatabase = new BeforeFirstBatchDatabase(raced.database, async () => {
        await raced.database.prepare(
          "update user_memories set updated_at = updated_at + 1 where id = ?1",
        ).bind(MEMORY_ID).run();
      });
      const response = await raced.request("/api/memory/source-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memoryId: MEMORY_ID, action: "dont_mention" }),
      }, racingDatabase);
      assert.equal(response.status, 409);
      assert.equal(await scalar(raced.database, "select count(*) as value from memory_source_feedback"), 0);
      assert.equal(await scalar(raced.database, "select count(*) as value from memory_events"), 0);
      assert.equal(await summarySuppressionMask(raced.database), 0);
      assert.equal(
        await scalar(raced.database, "select count(*) as value from memory_vector_cleanup_outbox"),
        0,
      );
      assert.deepEqual(raced.queue.messages, []);
    } finally {
      await raced.dispose();
    }
  } finally {
    await fixture.dispose();
  }
});

test("source generation prevents an in-flight synthesis from restoring a concurrently suppressed source", async () => {
  const fixture = await createFixture();
  try {
    const sourceText = "I need diagrams before symbolic explanations.";
    const sourceRevision = fixture.now - 1_000;
    await insertMemory(fixture.database, sourceText, sourceRevision, null);
    await insertDerivedMemorySnapshot(fixture.database, sourceRevision, [{
      id: "native-memory-general",
      title: "General",
      category: "general",
      summary: sourceText,
      sourceMemoryIds: [MEMORY_ID],
    }]);

    let interleaved = false;
    const racingDatabase = new BeforeFirstBatchDatabase(fixture.database, async () => {
      interleaved = true;
      const response = await fixture.request("/api/memory/source-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memoryId: MEMORY_ID, action: "dont_mention" }),
      });
      assert.equal(response.status, 200);
    });
    const delivery = await runDailySynthesis(
      fixture,
      racingDatabase,
      "source_generation_race",
    );

    assert.equal(interleaved, true);
    assert.deepEqual(delivery, { acknowledged: true, retryDelaySeconds: null });
    assert.equal(
      await scalar(
        fixture.database,
        "select do_not_mention as value from user_memories where id = ?1",
        MEMORY_ID,
      ),
      1,
    );
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_summaries"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_profiles"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_synthesis_runs"), 0);
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from memory_events where event_type = 'synthesized'",
      ),
      0,
    );
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_source_feedback"), 1);
    assert.equal(await summarySuppressionMask(fixture.database), 0);
  } finally {
    await fixture.dispose();
  }
});

test("summary-section suppression loses its CAS cleanly when a newer summary wins", async () => {
  const fixture = await createFixture();
  try {
    const sourceText = "Show me a worked example before asking me to practise.";
    const sourceRevision = fixture.now - 2_000;
    const vectorId = nativeMemoryVectorId(
      "user_memories",
      MEMORY_ID,
      await nativeMemoryVectorRevision(sourceText),
      { rowRevision: sourceRevision },
    );
    assert.ok(vectorId);
    await insertMemory(fixture.database, sourceText, sourceRevision, JSON.stringify(vectorId));
    const originalSections: NativeSummarySection[] = [{
      id: "native-memory-preferences",
      title: "Preferences",
      category: "preferences",
      summary: sourceText,
      sourceMemoryIds: [MEMORY_ID],
    }];
    await insertDerivedMemorySnapshot(fixture.database, sourceRevision, originalSections);

    const newerUpdatedAt = fixture.now + 60_000;
    const newerSections: NativeSummarySection[] = [{
      ...originalSections[0],
      summary: "A newer concurrent summary must survive unchanged.",
    }];
    const racingDatabase = new BeforeFirstBatchDatabase(fixture.database, async () => {
      await fixture.database.prepare(
        `update user_memory_summaries
         set summary = ?1, sections = ?2, version = version + 1,
             last_synthesized_at = ?3, updated_at = ?3
         where user_id = ?4`,
      ).bind(
        "Preferences: A newer concurrent summary must survive unchanged.",
        JSON.stringify(newerSections),
        newerUpdatedAt,
        USER_ID,
      ).run();
    });
    const response = await fixture.request("/api/memory/source-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summarySectionId: "native-memory-preferences",
        action: "dont_mention",
      }),
    }, racingDatabase);

    assert.equal(response.status, 409);
    const newerSummary = await fixture.database.prepare(
      `select summary, sections, updated_at as updatedAt
       from user_memory_summaries where user_id = ?1`,
    ).bind(USER_ID).first<{ summary: string; sections: string; updatedAt: number }>();
    assert.ok(newerSummary);
    assert.equal(newerSummary.updatedAt, newerUpdatedAt);
    assert.equal(
      newerSummary.summary,
      "Preferences: A newer concurrent summary must survive unchanged.",
    );
    assert.deepEqual(parseBoundedMemorySummarySections(newerSummary.sections), newerSections);
    const untouchedSource = await fixture.database.prepare(
      `select do_not_mention as doNotMention, embedding
       from user_memories where id = ?1`,
    ).bind(MEMORY_ID).first<{ doNotMention: number; embedding: string | null }>();
    assert.deepEqual(untouchedSource, {
      doNotMention: 0,
      embedding: JSON.stringify(vectorId),
    });
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_profiles"), 1);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_source_feedback"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_events"), 0);
    assert.equal(await summarySuppressionMask(fixture.database), 0);
    assert.equal(
      await scalar(fixture.database, "select count(*) as value from memory_vector_cleanup_outbox"),
      0,
    );
    assert.deepEqual(fixture.queue.messages, []);
  } finally {
    await fixture.dispose();
  }
});

test("direct-memory suppression loses cleanly to an exact-timestamp concurrent suppression", async () => {
  const fixture = await createFixture();
  const originalDateNow = Date.now;
  try {
    const sourceText = "Use the exact same successor timestamp for this direct-memory race.";
    const sourceRevision = fixture.now;
    const successorTimestamp = sourceRevision + 1;
    const vectorId = nativeMemoryVectorId(
      "user_memories",
      MEMORY_ID,
      await nativeMemoryVectorRevision(sourceText),
      { rowRevision: sourceRevision },
    );
    assert.ok(vectorId);
    await insertMemory(fixture.database, sourceText, sourceRevision, JSON.stringify(vectorId));
    await insertDerivedMemorySnapshot(fixture.database, sourceRevision, [{
      id: "native-memory-general",
      title: "General",
      category: "general",
      summary: sourceText,
      sourceMemoryIds: [MEMORY_ID],
    }]);
    Date.now = () => successorTimestamp;

    const racingDatabase = new BeforeFirstBatchDatabase(fixture.database, async () => {
      await fixture.database.prepare(
        `update user_memories
         set do_not_mention = 1, embedding = null, updated_at = ?1
         where id = ?2 and user_id = ?3`,
      ).bind(successorTimestamp, MEMORY_ID, USER_ID).run();
    });
    const response = await fixture.request("/api/memory/source-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ memoryId: MEMORY_ID, action: "dont_mention" }),
    }, racingDatabase);

    assert.equal(response.status, 409);
    const winningSource = await fixture.database.prepare(
      `select do_not_mention as doNotMention, embedding, updated_at as updatedAt
       from user_memories where id = ?1`,
    ).bind(MEMORY_ID).first<{
      doNotMention: number;
      embedding: string | null;
      updatedAt: number;
    }>();
    assert.deepEqual(winningSource, {
      doNotMention: 1,
      embedding: null,
      updatedAt: successorTimestamp,
    });
    assert.equal(await summarySuppressionMask(fixture.database), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_source_feedback"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_events"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_vector_cleanup_outbox"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_summaries"), 1);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_profiles"), 1);
    assert.deepEqual(fixture.queue.messages, []);
  } finally {
    Date.now = originalDateNow;
    await fixture.dispose();
  }
});

test("summary suppression loses cleanly to an exact-timestamp concurrent summary", async () => {
  const fixture = await createFixture();
  const originalDateNow = Date.now;
  try {
    const sourceText = "Keep the winner's exact-timestamp summary and source untouched.";
    const sourceRevision = fixture.now;
    const successorTimestamp = sourceRevision + 1;
    const vectorId = nativeMemoryVectorId(
      "user_memories",
      MEMORY_ID,
      await nativeMemoryVectorRevision(sourceText),
      { rowRevision: sourceRevision },
    );
    assert.ok(vectorId);
    await insertMemory(
      fixture.database,
      sourceText,
      sourceRevision,
      JSON.stringify(vectorId),
      "preferences",
    );
    const originalSection: NativeSummarySection = {
      id: "native-memory-preferences",
      title: "Preferences",
      category: "preferences",
      summary: sourceText,
      sourceMemoryIds: [MEMORY_ID],
    };
    await insertDerivedMemorySnapshot(fixture.database, sourceRevision, [originalSection]);
    const winningSections: NativeSummarySection[] = [{
      ...originalSection,
      summary: "The concurrent winner wrote this exact-timestamp summary.",
    }];
    Date.now = () => successorTimestamp;

    const racingDatabase = new BeforeFirstBatchDatabase(fixture.database, async () => {
      await fixture.database.prepare(
        `update user_memory_summaries
         set summary = ?1, sections = ?2, version = version + 1,
             last_synthesized_at = ?3, updated_at = ?3
         where user_id = ?4`,
      ).bind(
        "Preferences: The concurrent winner wrote this exact-timestamp summary.",
        JSON.stringify(winningSections),
        successorTimestamp,
        USER_ID,
      ).run();
    });
    const response = await fixture.request("/api/memory/source-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summarySectionId: "native-memory-preferences",
        action: "dont_mention",
      }),
    }, racingDatabase);

    assert.equal(response.status, 409);
    const winningSummary = await fixture.database.prepare(
      `select summary, sections, updated_at as updatedAt
       from user_memory_summaries where user_id = ?1`,
    ).bind(USER_ID).first<{ summary: string; sections: string; updatedAt: number }>();
    assert.ok(winningSummary);
    assert.equal(winningSummary.updatedAt, successorTimestamp);
    assert.equal(
      winningSummary.summary,
      "Preferences: The concurrent winner wrote this exact-timestamp summary.",
    );
    assert.deepEqual(
      parseBoundedMemorySummarySections(winningSummary.sections),
      winningSections,
    );
    const untouchedSource = await fixture.database.prepare(
      `select do_not_mention as doNotMention, embedding, updated_at as updatedAt
       from user_memories where id = ?1`,
    ).bind(MEMORY_ID).first<{
      doNotMention: number;
      embedding: string | null;
      updatedAt: number;
    }>();
    assert.deepEqual(untouchedSource, {
      doNotMention: 0,
      embedding: JSON.stringify(vectorId),
      updatedAt: sourceRevision,
    });
    assert.equal(await summarySuppressionMask(fixture.database), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_source_feedback"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_events"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_vector_cleanup_outbox"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_profiles"), 1);
    assert.deepEqual(fixture.queue.messages, []);
  } finally {
    Date.now = originalDateNow;
    await fixture.dispose();
  }
});

test("summary-only suppression survives derived invalidation and resynthesis", async () => {
  const fixture = await createFixture();
  try {
    const suppressedText = "Always use a visual outline for long explanations.";
    const sourceRevision = fixture.now - 1_000;
    await insertMemory(fixture.database, suppressedText, sourceRevision, null);
    await insertDerivedMemorySnapshot(fixture.database, sourceRevision, [{
      id: "native-memory-general",
      title: "General",
      category: "general",
      summary: suppressedText,
      sourceMemoryIds: [MEMORY_ID],
    }]);

    const suppression = await fixture.request("/api/memory/source-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summarySectionId: "native-memory-general",
        action: "dont_mention",
      }),
    });
    assert.equal(suppression.status, 200);
    assert.equal(await summarySuppressionMask(fixture.database), GENERAL_SUPPRESSION_BIT);
    assert.equal(
      await scalar(
        fixture.database,
        "select do_not_mention as value from user_memories where id = ?1",
        MEMORY_ID,
      ),
      1,
    );

    const laterText = "A later general memory must stay out of the suppressed summary category.";
    const creation = await fixture.request("/api/memory", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [STATE_API_INCREMENTAL_CONTRACT_HEADER]: STATE_API_INCREMENTAL_CONTRACT_VALUE,
      },
      body: JSON.stringify({ category: "general", content: laterText }),
    });
    assert.equal(creation.status, 201);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_summaries"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_profiles"), 0);
    assert.equal(await summarySuppressionMask(fixture.database), GENERAL_SUPPRESSION_BIT);

    const delivery = await runDailySynthesis(fixture, fixture.database, "suppression_rebuild");
    assert.deepEqual(delivery, { acknowledged: true, retryDelaySeconds: null });
    const rebuilt = await loadDerivedMemorySnapshot(fixture.database);
    const hiddenGeneral = rebuilt.sections.find(
      (section) => section.id === "native-memory-general",
    );
    assert.ok(hiddenGeneral);
    assert.equal(hiddenGeneral.doNotMention, true);
    assert.equal(rebuilt.summary.includes(laterText), false);
    assert.equal(rebuilt.summary.includes(suppressedText), false);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_profiles"), 0);
    assert.equal(
      await scalar(
        fixture.database,
        `select count(*) as value from memory_source_feedback
         where summary_section_id = 'native-memory-general'
           and action = 'dont_mention'`,
      ),
      1,
    );
  } finally {
    await fixture.dispose();
  }
});

test("clear all removes summary suppression tombstones before a same-category rebuild", async () => {
  const fixture = await createFixture();
  try {
    const suppressedText = "Never mention this old visual-outline preference again.";
    const sourceRevision = fixture.now - 1_000;
    await insertMemory(fixture.database, suppressedText, sourceRevision, null);
    await insertDerivedMemorySnapshot(fixture.database, sourceRevision, [{
      id: "native-memory-general",
      title: "General",
      category: "general",
      summary: suppressedText,
      sourceMemoryIds: [MEMORY_ID],
    }]);
    const suppression = await fixture.request("/api/memory/source-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summarySectionId: "native-memory-general",
        action: "dont_mention",
      }),
    });
    assert.equal(suppression.status, 200);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_source_feedback"), 1);
    assert.equal(await summarySuppressionMask(fixture.database), GENERAL_SUPPRESSION_BIT);

    const cleared = await fixture.request("/api/memory", { method: "DELETE" });
    assert.equal(cleared.status, 200);
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_source_feedback"), 0);
    assert.equal(await summarySuppressionMask(fixture.database), 0);
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from user_memories where status = 'active'",
      ),
      0,
    );

    const replacementText = "This new general preference should be visible after a full reset.";
    const creation = await fixture.request("/api/memory", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [STATE_API_INCREMENTAL_CONTRACT_HEADER]: STATE_API_INCREMENTAL_CONTRACT_VALUE,
      },
      body: JSON.stringify({ category: "general", content: replacementText }),
    });
    assert.equal(creation.status, 201);
    const delivery = await runDailySynthesis(fixture, fixture.database, "after_clear_all");
    assert.deepEqual(delivery, { acknowledged: true, retryDelaySeconds: null });

    const rebuilt = await loadDerivedMemorySnapshot(fixture.database);
    const canonicalGeneral = rebuilt.sections.find(
      (section) => section.id === "native-memory-general",
    );
    assert.ok(canonicalGeneral);
    assert.equal(canonicalGeneral.doNotMention, undefined);
    assert.equal(rebuilt.summary.includes(replacementText), true);
    assert.equal(rebuilt.summary.includes(suppressedText), false);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_profiles"), 1);
  } finally {
    await fixture.dispose();
  }
});

test("suppressing a memory-backed interaction section preserves unrelated chat turns", async () => {
  const fixture = await createFixture();
  try {
    const sourceText = "Keep explanations conversational and interactive.";
    const sourceRevision = fixture.now - 1_000;
    await insertMemory(
      fixture.database,
      sourceText,
      sourceRevision,
      null,
      "interaction",
    );
    await fixture.database.prepare(
      `insert into chat_memory_turns (
         id, user_id, question, answer_excerpt, searchable_text,
         topics, embedding, created_at, updated_at
       ) values (?1, ?2, 'An unrelated question', 'An unrelated answer',
                 'An unrelated question and answer', '[]', null, ?3, ?3)`,
    ).bind(TURN_ID, USER_ID, sourceRevision).run();
    await insertDerivedMemorySnapshot(fixture.database, sourceRevision, [{
      id: "native-memory-interaction",
      title: "Interaction",
      category: "interaction",
      summary: sourceText,
      sourceMemoryIds: [MEMORY_ID],
    }]);

    const suppression = await fixture.request("/api/memory/source-feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        summarySectionId: "native-memory-interaction",
        action: "dont_mention",
      }),
    });
    assert.equal(suppression.status, 200);
    assert.equal(await summarySuppressionMask(fixture.database), INTERACTION_SUPPRESSION_BIT);
    assert.equal(
      await scalar(
        fixture.database,
        "select do_not_mention as value from user_memories where id = ?1",
        MEMORY_ID,
      ),
      1,
    );
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from chat_memory_turns where id = ?1",
        TURN_ID,
      ),
      1,
    );
    assert.equal(
      await scalar(
        fixture.database,
        `select count(*) as value from memory_vector_cleanup_outbox
         where source_namespace = 'chat_memory_turns'`,
      ),
      0,
    );
  } finally {
    await fixture.dispose();
  }
});

test("legacy summary IDs preserve their category suppression under the canonical synthesized ID", async () => {
  const legacySectionIds = ["preferences", "legacy-personalization-section"] as const;
  for (const legacySectionId of legacySectionIds) {
    const fixture = await createFixture();
    try {
      const suppressedText = `Legacy preference from ${legacySectionId}.`;
      const sourceRevision = fixture.now - 1_000;
      await insertMemory(
        fixture.database,
        suppressedText,
        sourceRevision,
        null,
        "preferences",
      );
      await insertDerivedMemorySnapshot(fixture.database, sourceRevision, [{
        id: legacySectionId,
        title: "Preferences",
        category: "preferences",
        summary: suppressedText,
        sourceMemoryIds: [MEMORY_ID],
      }]);

      const suppression = await fixture.request("/api/memory/source-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summarySectionId: legacySectionId, action: "dont_mention" }),
      });
      assert.equal(suppression.status, 200, legacySectionId);
      assert.equal(
        await summarySuppressionMask(fixture.database),
        PREFERENCES_SUPPRESSION_BIT,
        legacySectionId,
      );

      const laterText = `New preference after suppressing ${legacySectionId}.`;
      const creation = await fixture.request("/api/memory", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [STATE_API_INCREMENTAL_CONTRACT_HEADER]: STATE_API_INCREMENTAL_CONTRACT_VALUE,
        },
        body: JSON.stringify({ category: "preferences", content: laterText }),
      });
      assert.equal(creation.status, 201, legacySectionId);
      assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_summaries"), 0);

      const delivery = await runDailySynthesis(
        fixture,
        fixture.database,
        `legacy_${legacySectionId}`,
      );
      assert.deepEqual(
        delivery,
        { acknowledged: true, retryDelaySeconds: null },
        legacySectionId,
      );
      const rebuilt = await loadDerivedMemorySnapshot(fixture.database);
      const canonicalSection = rebuilt.sections.find(
        (section) => section.id === "native-memory-preferences",
      );
      assert.ok(canonicalSection, legacySectionId);
      assert.equal(canonicalSection.doNotMention, true, legacySectionId);
      assert.equal(rebuilt.summary.includes(laterText), false, legacySectionId);
      assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_profiles"), 0);
    } finally {
      await fixture.dispose();
    }
  }
});

test("synthesis uses the constant-size suppression mask without scanning thousands of feedback rows", async () => {
  const fixture = await createFixture();
  try {
    const hiddenPreference = "Keep this masked preference out of derived output.";
    await insertMemory(
      fixture.database,
      hiddenPreference,
      fixture.now - 1_000,
      null,
      "preferences",
    );
    const visibleGeneral = "This general memory should remain visible in the rebuilt summary.";
    const creation = await fixture.request("/api/memory", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [STATE_API_INCREMENTAL_CONTRACT_HEADER]: STATE_API_INCREMENTAL_CONTRACT_VALUE,
      },
      body: JSON.stringify({ category: "general", content: visibleGeneral }),
    });
    assert.equal(creation.status, 201);
    await fixture.database.prepare(
      `update user_memory_settings
       set summary_suppression_mask = ?1
       where user_id = ?2`,
    ).bind(PREFERENCES_SUPPRESSION_BIT, USER_ID).run();
    await fixture.database.prepare(
      `with recursive digit(n) as (
         values (0) union all select n + 1 from digit where n < 9
       ), numbered(n) as (
         select ones.n + tens.n * 10 + hundreds.n * 100 + thousands.n * 1000 + 1
         from digit ones cross join digit tens cross join digit hundreds cross join digit thousands
       )
       insert into memory_source_feedback (
         id, user_id, ai_run_id, memory_id, chat_turn_id,
         summary_section_id, action, note, created_at
       )
       select 'decoy-feedback-' || n, ?1, null, null, null,
              'legacy-decoy-' || n, 'dont_mention', null, ?2
       from numbered where n <= 3000`,
    ).bind(USER_ID, fixture.now).run();
    assert.equal(await scalar(fixture.database, "select count(*) as value from memory_source_feedback"), 3_000);

    const recordingDatabase = new RecordingSqlDatabase(fixture.database);
    const delivery = await runDailySynthesis(
      fixture,
      recordingDatabase,
      "constant_size_suppression_mask",
    );
    assert.deepEqual(delivery, { acknowledged: true, retryDelaySeconds: null });
    assert.deepEqual(
      recordingDatabase.queries.filter((query) => (
        /\bfrom\s+memory_source_feedback\b/i.test(query)
      )),
      [],
    );

    const rebuilt = await loadDerivedMemorySnapshot(fixture.database);
    const hiddenSection = rebuilt.sections.find(
      (section) => section.id === "native-memory-preferences",
    );
    const visibleSection = rebuilt.sections.find(
      (section) => section.id === "native-memory-general",
    );
    assert.ok(hiddenSection);
    assert.ok(visibleSection);
    assert.equal(hiddenSection.doNotMention, true);
    assert.equal(visibleSection.doNotMention, undefined);
    assert.equal(rebuilt.summary.includes(hiddenPreference), false);
    assert.equal(rebuilt.summary.includes(visibleGeneral), true);
    assert.equal(await summarySuppressionMask(fixture.database), PREFERENCES_SUPPRESSION_BIT);
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from user_memory_profiles where category = 'general'",
      ),
      1,
    );
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from user_memory_profiles where category = 'preferences'",
      ),
      0,
    );
  } finally {
    await fixture.dispose();
  }
});

test("destructive mutations fail closed without aborting on malformed legacy summary JSON", async () => {
  const malformedSections = [
    { label: "invalid JSON", value: "[{not-json" },
    { label: "valid primitive root", value: "true" },
    {
      label: "over-bound JSON array",
      value: JSON.stringify([{
        id: "legacy-general",
        title: "General",
        category: "general",
        summary: "x".repeat(32_100),
        doNotMention: true,
      }]),
    },
  ] as const;
  for (const malformed of malformedSections) {
    const fixture = await createFixture();
    try {
      await insertMemory(
        fixture.database,
        `Memory deleted with ${malformed.label}.`,
        fixture.now - 1_000,
        null,
      );
      await insertRawDerivedMemorySnapshot(
        fixture.database,
        fixture.now - 1_000,
        malformed.value,
      );

      const response = await fixture.request(`/api/memory/${MEMORY_ID}`, {
        method: "DELETE",
      });
      assert.equal(response.status, 200, malformed.label);
      assert.equal(
        await summarySuppressionMask(fixture.database),
        ALL_SUPPRESSION_BITS,
        malformed.label,
      );
      assert.equal(
        await scalar(fixture.database, "select count(*) as value from user_memory_summaries"),
        0,
        malformed.label,
      );
      assert.equal(
        await scalar(fixture.database, "select count(*) as value from user_memory_profiles"),
        0,
        malformed.label,
      );
      assert.equal(
        await scalar(
          fixture.database,
          "select count(*) as value from user_memories where status = 'active'",
        ),
        0,
        malformed.label,
      );
    } finally {
      await fixture.dispose();
    }
  }
});

test("destructive mutation safely ignores primitive entries in a valid legacy sections array", async () => {
  const fixture = await createFixture();
  try {
    await insertMemory(
      fixture.database,
      "Delete this source despite primitive legacy section entries.",
      fixture.now - 1_000,
      null,
    );
    await insertRawDerivedMemorySnapshot(
      fixture.database,
      fixture.now - 1_000,
      JSON.stringify([true, 7, "legacy", null]),
    );

    const response = await fixture.request(`/api/memory/${MEMORY_ID}`, {
      method: "DELETE",
    });
    assert.equal(response.status, 200);
    assert.equal(await summarySuppressionMask(fixture.database), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_summaries"), 0);
    assert.equal(await scalar(fixture.database, "select count(*) as value from user_memory_profiles"), 0);
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from user_memories where status = 'active'",
      ),
      0,
    );
  } finally {
    await fixture.dispose();
  }
});

test("a destructive mutation invalidates the writer token and honors the stale-writer fence", async () => {
  const fixture = await createFixture();
  try {
    const text = "I prefer visual examples for algebra.";
    const rowRevision = fixture.now - 1_000;
    const exactId = nativeMemoryVectorId(
      "user_memories",
      MEMORY_ID,
      await nativeMemoryVectorRevision(text),
      { rowRevision },
    );
    assert.ok(exactId);
    const writeToken = "44444444-4444-4444-8444-444444444444";
    await insertMemory(fixture.database, text, rowRevision, JSON.stringify(`p:${exactId}`));
    await fixture.database.prepare(
      `insert into memory_vector_cleanup_outbox (
         vector_id, owner_user_id, source_namespace, source_row_id,
         source_row_revision, write_token, reason, state,
         write_fence_expires_at, next_attempt_at, created_at, updated_at
       ) values (?1, ?2, 'user_memories', ?3, ?4, ?5,
                 'vector_write_intent', 'write_pending', ?6, ?6, ?7, ?7)`,
    ).bind(
      exactId,
      USER_ID,
      MEMORY_ID,
      rowRevision,
      writeToken,
      fixture.now + 15 * 60_000,
      fixture.now,
    ).run();

    const response = await fixture.request(`/api/memory/${MEMORY_ID}`, { method: "DELETE" });
    assert.equal(response.status, 200);
    const fenced = await fixture.database.prepare(
      `select state, write_token as writeToken,
              write_fence_expires_at as writeFenceExpiresAt
       from memory_vector_cleanup_outbox where vector_id = ?1`,
    ).bind(exactId).first<{
      state: string;
      writeToken: string | null;
      writeFenceExpiresAt: number;
    }>();
    assert.equal(fenced?.state, "cleanup_fenced");
    assert.equal(fenced?.writeToken, null);
    assert.ok(fenced?.writeFenceExpiresAt);
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from user_memories where id = ?1 and status = 'active'",
        MEMORY_ID,
      ),
      0,
    );
    const repeatedDelete = await fixture.request(`/api/memory/${MEMORY_ID}`, { method: "DELETE" });
    assert.equal(repeatedDelete.status, 404);

    await drainNativeMemoryVectorCleanupOutbox(
      fixture.env,
      fenced?.writeFenceExpiresAt ?? fixture.now + 15 * 60_000,
    );
    assert.equal(fixture.vectorize.deletedIds.flat().includes(exactId), false);
    await drainNativeMemoryVectorCleanupOutbox(
      fixture.env,
      (fenced?.writeFenceExpiresAt ?? fixture.now + 15 * 60_000) + 1,
    );
    assert.equal(fixture.vectorize.deletedIds.flat().includes(exactId), true);
  } finally {
    await fixture.dispose();
  }
});

test("the durable write intent and p marker commit before a remote upsert can race deletion", async () => {
  const fixture = await createFixture();
  const originalFetch = globalThis.fetch;
  try {
    const text = "I prefer diagrams when learning geometry.";
    const rowRevision = fixture.now - 1_000;
    await insertMemory(fixture.database, text, rowRevision, null);
    const blockingVectorize = new BlockingVectorize();
    fixture.env.MEMORY_VECTORIZE = blockingVectorize;
    fixture.env.CLOUDFLARE_AI_GATEWAY_BASE_URL =
      "https://gateway.ai.cloudflare.com/v1/account/inspir/openai";
    fixture.env.CLOUDFLARE_AI_GATEWAY_TOKEN = "gateway-token";
    fixture.env.CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS = "inspir";
    fixture.env.LLM_GLOBAL_DAILY_CALL_LIMIT = "100";
    globalThis.fetch = async () => Response.json({
      data: [{
        index: 0,
        embedding: Array.from({ length: 512 }, (_, index) => index / 10_000),
      }],
    });

    const write = persistNativeMemoryVectorsBestEffort(fixture.env, [{
      namespace: "user_memories",
      rowId: MEMORY_ID,
      rowRevision,
      userId: USER_ID,
      text,
    }]);
    await blockingVectorize.upsertStarted.promise;

    const pendingSource = await fixture.database.prepare(
      "select embedding from user_memories where id = ?1",
    ).bind(MEMORY_ID).first<{ embedding: string | null }>();
    assert.ok(pendingSource?.embedding);
    assert.match(JSON.parse(pendingSource.embedding), /^p:m:/);
    const pendingIntent = await fixture.database.prepare(
      `select vector_id as vectorId, state, write_token as writeToken
       from memory_vector_cleanup_outbox where source_row_id = ?1`,
    ).bind(MEMORY_ID).first<{ vectorId: string; state: string; writeToken: string | null }>();
    assert.equal(pendingIntent?.state, "write_pending");
    assert.ok(pendingIntent?.writeToken);

    const deletion = await fixture.request(`/api/memory/${MEMORY_ID}`, { method: "DELETE" });
    assert.equal(deletion.status, 200);
    blockingVectorize.releaseUpsert.resolve();
    await write;

    const recovered = await fixture.database.prepare(
      `select state, write_token as writeToken,
              write_fence_expires_at as writeFenceExpiresAt
       from memory_vector_cleanup_outbox where vector_id = ?1`,
    ).bind(pendingIntent?.vectorId).first<{
      state: string;
      writeToken: string | null;
      writeFenceExpiresAt: number;
    }>();
    assert.equal(recovered?.state, "cleanup_fenced");
    assert.equal(recovered?.writeToken, null);
    assert.ok(recovered?.writeFenceExpiresAt);
    assert.equal(
      await scalar(
        fixture.database,
        "select count(*) as value from user_memories where id = ?1 and embedding is not null",
        MEMORY_ID,
      ),
      0,
    );

    assert.equal(
      blockingVectorize.deletedIds.flat().includes(pendingIntent?.vectorId ?? ""),
      false,
    );
    await drainNativeMemoryVectorCleanupOutbox(
      fixture.env,
      recovered?.writeFenceExpiresAt ?? Date.now() + 15 * 60_000,
    );
    assert.equal(
      blockingVectorize.deletedIds.flat().includes(pendingIntent?.vectorId ?? ""),
      false,
    );
    await drainNativeMemoryVectorCleanupOutbox(
      fixture.env,
      (recovered?.writeFenceExpiresAt ?? Date.now() + 15 * 60_000) + 1,
    );
    assert.equal(
      blockingVectorize.deletedIds.flat().includes(pendingIntent?.vectorId ?? ""),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await fixture.dispose();
  }
});

test("real PATCH and indexing cycles give A to B to A three distinct exact identities", async () => {
  const fixture = await createFixture();
  const originalFetch = globalThis.fetch;
  try {
    const textA = "I learn algebra best with visual worked examples.";
    const textB = "I learn algebra best by explaining each step aloud.";
    const revisionA1 = fixture.now - 1_000;
    const idA1 = nativeMemoryVectorId(
      "user_memories",
      MEMORY_ID,
      await nativeMemoryVectorRevision(textA),
      { rowRevision: revisionA1 },
    );
    assert.ok(idA1);
    await insertMemory(fixture.database, textA, revisionA1, JSON.stringify(idA1));
    fixture.env.CLOUDFLARE_AI_GATEWAY_BASE_URL =
      "https://gateway.ai.cloudflare.com/v1/account/inspir/openai";
    fixture.env.CLOUDFLARE_AI_GATEWAY_TOKEN = "gateway-token";
    fixture.env.CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS = "inspir";
    fixture.env.LLM_GLOBAL_DAILY_CALL_LIMIT = "100";
    globalThis.fetch = async () => Response.json({
      data: [{
        index: 0,
        embedding: Array.from({ length: 512 }, (_, index) => index / 10_000),
      }],
    });

    const toB = await fixture.request(`/api/memory/${MEMORY_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: textB }),
    });
    assert.equal(toB.status, 200);
    const rowB = await currentMemoryVectorSource(fixture.database);
    assert.ok(rowB.updatedAt > revisionA1);
    await persistNativeMemoryVectorsBestEffort(fixture.env, [{
      namespace: "user_memories",
      rowId: MEMORY_ID,
      rowRevision: rowB.updatedAt,
      userId: USER_ID,
      text: textB,
    }]);
    const idB = nativeMemoryVectorId(
      "user_memories",
      MEMORY_ID,
      await nativeMemoryVectorRevision(textB),
      { rowRevision: rowB.updatedAt },
    );
    assert.ok(idB);
    assert.equal((await currentMemoryVectorSource(fixture.database)).embedding, JSON.stringify(idB));

    const backToA = await fixture.request(`/api/memory/${MEMORY_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: textA }),
    });
    assert.equal(backToA.status, 200);
    const rowA3 = await currentMemoryVectorSource(fixture.database);
    assert.ok(rowA3.updatedAt > rowB.updatedAt);
    await persistNativeMemoryVectorsBestEffort(fixture.env, [{
      namespace: "user_memories",
      rowId: MEMORY_ID,
      rowRevision: rowA3.updatedAt,
      userId: USER_ID,
      text: textA,
    }]);
    const idA3 = nativeMemoryVectorId(
      "user_memories",
      MEMORY_ID,
      await nativeMemoryVectorRevision(textA),
      { rowRevision: rowA3.updatedAt },
    );
    assert.ok(idA3);

    assert.equal(new Set([idA1, idB, idA3]).size, 3);
    assert.equal((await currentMemoryVectorSource(fixture.database)).embedding, JSON.stringify(idA3));
    const captured = await fixture.database.prepare(
      `select vector_id as vectorId, state
       from memory_vector_cleanup_outbox
       where vector_id in (?1, ?2)
       order by vector_id`,
    ).bind(idA1, idB).all<{ vectorId: string; state: string }>();
    assert.deepEqual(
      new Set(captured.results.map((row) => row.vectorId)),
      new Set([idA1, idB]),
    );
    assert.equal(captured.results.every((row) => row.state === "cleanup_ready"), true);
    assert.equal(fixture.vectorize.upsertedIds.flat().includes(idB), true);
    assert.equal(fixture.vectorize.upsertedIds.flat().includes(idA3), true);
  } finally {
    globalThis.fetch = originalFetch;
    await fixture.dispose();
  }
});

type StateQueue = NonNullable<StateApiEnv["MEMORY_POST_TURN_QUEUE"]>;
type StateQueueBody = Parameters<StateQueue["send"]>[0];
type StateVectorize = CloudflareEnv["MEMORY_VECTORIZE"];

class RecordingQueue implements StateQueue {
  readonly messages: StateQueueBody[] = [];

  async send(message: StateQueueBody) {
    this.messages.push(message);
    return queueSendResponse();
  }

  async sendBatch(messages: Iterable<MessageSendRequest<StateQueueBody>>) {
    for (const message of messages) this.messages.push(message.body);
    return queueSendResponse();
  }
}

class RecordingVectorize implements StateVectorize {
  readonly deletedIds: string[][] = [];
  readonly getRequests: string[][] = [];
  readonly upsertedIds: string[][] = [];
  readonly visibleIds = new Set<string>();

  async describe(): Promise<VectorizeIndexDetails> {
    return {
      id: "native-vector-outbox-test",
      name: "native-vector-outbox-test",
      config: { dimensions: 512, metric: "cosine" },
      vectorsCount: this.visibleIds.size,
    };
  }

  async query(): Promise<VectorizeMatches> {
    return { matches: [], count: 0 };
  }

  async insert(vectors: VectorizeVector[]): Promise<VectorizeVectorMutation> {
    return { ids: vectors.map((vector) => vector.id), count: vectors.length };
  }

  async upsert(vectors: VectorizeVector[]): Promise<VectorizeVectorMutation> {
    this.upsertedIds.push(vectors.map((vector) => vector.id));
    return { ids: vectors.map((vector) => vector.id), count: vectors.length };
  }

  async deleteByIds(ids: string[]): Promise<VectorizeVectorMutation> {
    this.deletedIds.push([...ids]);
    return { ids: [...ids], count: ids.length };
  }

  async getByIds(ids: string[]): Promise<VectorizeVector[]> {
    this.getRequests.push([...ids]);
    return ids
      .filter((id) => this.visibleIds.has(id))
      .map((id) => ({ id, values: [] }));
  }
}

class BlockingVectorize extends RecordingVectorize {
  readonly upsertStarted = deferred();
  readonly releaseUpsert = deferred();

  override async upsert(vectors: VectorizeVector[]): Promise<VectorizeVectorMutation> {
    this.upsertStarted.resolve();
    await this.releaseUpsert.promise;
    for (const vector of vectors) this.visibleIds.add(vector.id);
    return { ids: vectors.map((vector) => vector.id), count: vectors.length };
  }
}

class BlockingDeleteVectorize extends RecordingVectorize {
  readonly deleteStarted = deferred();
  readonly releaseDelete = deferred();

  override async deleteByIds(ids: string[]): Promise<VectorizeVectorMutation> {
    this.deleteStarted.resolve();
    await this.releaseDelete.promise;
    return super.deleteByIds(ids);
  }
}

class BeforeFirstBatchDatabase implements D1Database {
  private invoked = false;

  constructor(
    private readonly inner: D1Database,
    private readonly beforeBatch: () => Promise<void>,
  ) {}

  prepare(query: string) {
    return this.inner.prepare(query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    if (!this.invoked) {
      this.invoked = true;
      await this.beforeBatch();
    }
    return this.inner.batch<T>(statements);
  }

  exec(query: string) {
    return this.inner.exec(query);
  }

  withSession(constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint) {
    return this.inner.withSession(constraintOrBookmark);
  }

  dump() {
    return this.inner.dump();
  }
}

class CountingD1Database implements D1Database {
  readonly batchSizes: number[] = [];
  private executedStatements = 0;

  constructor(private readonly inner: D1Database) {}

  get statementCount() {
    return this.executedStatements;
  }

  prepare(query: string) {
    return new CountingD1Statement(
      this.inner.prepare(query),
      () => {
        this.executedStatements += 1;
      },
    );
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    const counted = requireCountingStatements(statements);
    this.batchSizes.push(counted.length);
    this.executedStatements += counted.length;
    return this.inner.batch<T>(counted.map((statement) => statement.innerStatement));
  }

  exec(query: string) {
    this.executedStatements += 1;
    return this.inner.exec(query);
  }

  withSession(constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint) {
    return this.inner.withSession(constraintOrBookmark);
  }

  dump() {
    return this.inner.dump();
  }
}

class CountingD1Statement implements D1PreparedStatement {
  constructor(
    private inner: D1PreparedStatement,
    private readonly recordExecution: () => void,
  ) {}

  get innerStatement() {
    return this.inner;
  }

  bind(...values: unknown[]) {
    this.inner = this.inner.bind(...values);
    return this;
  }

  first<T = unknown>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(colName?: string) {
    this.recordExecution();
    return colName === undefined ? this.inner.first<T>() : this.inner.first<T>(colName);
  }

  run<T = Record<string, unknown>>() {
    this.recordExecution();
    return this.inner.run<T>();
  }

  all<T = Record<string, unknown>>() {
    this.recordExecution();
    return this.inner.all<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }) {
    this.recordExecution();
    return options?.columnNames
      ? this.inner.raw<T>({ columnNames: true })
      : this.inner.raw<T>();
  }
}

function requireCountingStatements(statements: readonly D1PreparedStatement[]) {
  const counted: CountingD1Statement[] = [];
  for (const statement of statements) {
    if (!(statement instanceof CountingD1Statement)) {
      throw new Error("D1 query-ceiling test received an uncounted statement");
    }
    counted.push(statement);
  }
  return counted;
}

class RecordingSqlDatabase implements D1Database {
  readonly queries: string[] = [];

  constructor(private readonly inner: D1Database) {}

  prepare(query: string) {
    this.queries.push(query);
    return this.inner.prepare(query);
  }

  batch<T = unknown>(statements: D1PreparedStatement[]) {
    return this.inner.batch<T>(statements);
  }

  exec(query: string) {
    this.queries.push(query);
    return this.inner.exec(query);
  }

  withSession(constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint) {
    return this.inner.withSession(constraintOrBookmark);
  }

  dump() {
    return this.inner.dump();
  }
}

type Fixture = {
  miniflare: Miniflare;
  database: D1Database;
  now: number;
  queue: RecordingQueue;
  vectorize: RecordingVectorize;
  env: StateApiEnv;
  request(pathname: string, init?: RequestInit, database?: D1Database): Promise<Response>;
  dispose(): Promise<void>;
};

async function createFixture(): Promise<Fixture> {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default {}",
    d1Databases: { DB: `native-vector-outbox-${crypto.randomUUID()}` },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    await database.batch(
      BASE_SCHEMA_SQL.split(";")
        .map((statement) => statement.trim())
        .filter(Boolean)
        .map((statement) => database.prepare(statement)),
    );
    const migrationStatements = fs.readFileSync(
      path.resolve("drizzle-d1/0016_memory_vector_cleanup_outbox.sql"),
      "utf8",
    ).split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => database.prepare(statement));
    await database.batch(migrationStatements);
    const now = Date.now();
    await database.batch([
      database.prepare(
        `insert into users (
           id, name, email, email_verified, image, preferred_language, created_at, updated_at
         ) values (?1, 'Outbox learner', 'outbox@example.test', 1, null, 'English', ?2, ?2)`,
      ).bind(USER_ID, now),
      database.prepare(
        `insert into sessions (
           id, session_token, user_id, expires, created_at, updated_at, ip_address, user_agent
         ) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?1, ?2, ?3, ?4, ?4, null, 'outbox-test')`,
      ).bind(SESSION_TOKEN, USER_ID, now + 60 * 60_000, now),
      database.prepare(
        `insert into user_memory_settings (
           user_id, enabled, saved_memory_enabled, chat_history_enabled,
           dreaming_enabled, capture_scope, retrieval_mode, notice_seen_at,
           summary_suppression_mask, created_at, updated_at
         ) values (?1, 1, 1, 1, 1, 'broad', 'need_based', null, 0, ?2, ?2)`,
      ).bind(USER_ID, now),
    ]);
    const cookie = (await buildNativeSessionCookie(
      SESSION_TOKEN,
      AUTH_SECRET,
      "https://inspirlearning.com/api/memory",
      now + 60 * 60_000,
    )).split(";", 1)[0];
    assert.ok(cookie);
    const queue = new RecordingQueue();
    const vectorize = new RecordingVectorize();
    const env: StateApiEnv = {
      DB: database,
      AUTH_SECRET,
      ADMIN_EMAILS: "",
      MEMORY_POST_TURN_QUEUE: queue,
      MEMORY_VECTORIZE: vectorize,
    };
    return {
      miniflare,
      database,
      now,
      queue,
      vectorize,
      env,
      async request(pathname, init, overrideDatabase) {
        const headers = new Headers(init?.headers);
        headers.set("cookie", cookie);
        const pending: Promise<unknown>[] = [];
        const response = await handleStateApiRequest(
          new Request(`https://inspirlearning.com${pathname}`, { ...init, headers }),
          { ...env, DB: overrideDatabase ?? database },
          {
            waitUntil(promise) {
              pending.push(promise);
            },
          } satisfies StateApiExecutionContext,
        );
        assert.ok(response);
        await Promise.all(pending);
        return response;
      },
      dispose: () => miniflare.dispose(),
    };
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
}

async function insertMemory(
  database: D1Database,
  content: string,
  updatedAt: number,
  embedding: string | null,
  category = "general",
) {
  await database.prepare(
    `insert into user_memories (
       id, user_id, kind, category, content, tags, confidence, salience,
       status, source_type, source_turn_ids, source_memory_ids,
       embedding, freshness_status, pinned, do_not_mention,
       created_at, updated_at
     ) values (
       ?1, ?2, 'explicit', ?3, ?4, '[]', 100, 95,
       'active', 'manual', '[]', '[]', ?5, 'current', 1, 0, ?6, ?6
     )`,
  ).bind(MEMORY_ID, USER_ID, category, content, embedding, updatedAt).run();
}

async function insertDerivedMemorySnapshot(
  database: D1Database,
  updatedAt: number,
  sections: readonly NativeSummarySection[],
) {
  const visibleSections = sections.filter((section) => section.doNotMention !== true);
  const summary = visibleSections
    .map((section) => `${section.title}: ${section.summary}`)
    .join("\n");
  const sourceMemoryIds = [...new Set(
    sections.flatMap((section) => section.sourceMemoryIds ?? []),
  )];
  const sourceTurnIds = [...new Set(
    sections.flatMap((section) => section.sourceTurnIds ?? []),
  )];
  const statements: D1PreparedStatement[] = [
    database.prepare(
      `insert into user_memory_summaries (
         user_id, summary, sections, source_memory_ids, source_turn_ids,
         version, last_synthesized_at, created_at, updated_at
       ) values (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ?6)`,
    ).bind(
      USER_ID,
      summary,
      JSON.stringify(sections),
      JSON.stringify(sourceMemoryIds),
      JSON.stringify(sourceTurnIds),
      updatedAt,
    ),
  ];
  const profileSections = new Map<string, NativeSummarySection>();
  for (const section of visibleSections) {
    if (section.sourceMemoryIds?.length && !profileSections.has(section.category)) {
      profileSections.set(section.category, section);
    }
  }
  for (const section of profileSections.values()) {
    statements.push(
      database.prepare(
        `insert into user_memory_profiles (
           user_id, category, summary, source_memory_ids,
           last_compiled_at, created_at, updated_at
         ) values (?1, ?2, ?3, ?4, ?5, ?5, ?5)`,
      ).bind(
        USER_ID,
        section.category,
        section.summary,
        JSON.stringify(section.sourceMemoryIds ?? []),
        updatedAt,
      ),
    );
  }
  await database.batch(statements);
}

async function insertRawDerivedMemorySnapshot(
  database: D1Database,
  updatedAt: number,
  rawSections: string,
) {
  await database.batch([
    database.prepare(
      `insert into user_memory_summaries (
         user_id, summary, sections, source_memory_ids, source_turn_ids,
         version, last_synthesized_at, created_at, updated_at
       ) values (?1, 'Legacy derived summary', ?2, '[]', '[]', 1, ?3, ?3, ?3)`,
    ).bind(USER_ID, rawSections, updatedAt),
    database.prepare(
      `insert into user_memory_profiles (
         user_id, category, summary, source_memory_ids,
         last_compiled_at, created_at, updated_at
       ) values (?1, 'general', 'Legacy profile', '[]', ?2, ?2, ?2)`,
    ).bind(USER_ID, updatedAt),
  ]);
}

async function loadDerivedMemorySnapshot(database: D1Database) {
  const row = await database.prepare(
    `select summary, sections, updated_at as updatedAt
     from user_memory_summaries where user_id = ?1`,
  ).bind(USER_ID).first<{ summary: string; sections: string; updatedAt: number }>();
  assert.ok(row);
  const sections = parseBoundedMemorySummarySections(row.sections);
  assert.ok(sections);
  return { summary: row.summary, sections, updatedAt: row.updatedAt };
}

async function runDailySynthesis(
  fixture: Fixture,
  database: D1Database,
  reason: string,
) {
  let acknowledged = false;
  let retryDelaySeconds: number | null = null;
  const message = {
    id: `daily-synthesis-${reason}`,
    timestamp: new Date(),
    body: {
      type: "memory.daily_synthesis.v1",
      enqueuedAt: new Date().toISOString(),
      userId: USER_ID,
      reason,
    },
    attempts: 1,
    ack() {
      acknowledged = true;
    },
    retry(options?: { delaySeconds?: number }) {
      retryDelaySeconds = options?.delaySeconds ?? 0;
    },
  } satisfies Message<unknown>;
  await handleMemoryQueue(
    {
      messages: [message],
      queue: "native-memory-synthesis-test",
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      ackAll() {},
      retryAll() {},
    },
    { ...fixture.env, DB: database },
    { waitUntil() {} },
  );
  return { acknowledged, retryDelaySeconds };
}

async function currentMemoryVectorSource(database: D1Database) {
  const row = await database.prepare(
    `select content, embedding, updated_at as updatedAt
     from user_memories where id = ?1`,
  ).bind(MEMORY_ID).first<{
    content: string;
    embedding: string | null;
    updatedAt: number;
  }>();
  assert.ok(row);
  return row;
}

async function scalar(
  database: D1Database,
  query: string,
  ...bindings: unknown[]
) {
  const row = await database.prepare(query).bind(...bindings).first<{ value: number }>();
  assert.ok(row);
  return row.value;
}

function summarySuppressionMask(database: D1Database) {
  return scalar(
    database,
    `select summary_suppression_mask as value
     from user_memory_settings where user_id = ?1`,
    USER_ID,
  );
}

function queueSendResponse(): QueueSendResponse & QueueSendBatchResponse {
  return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const BASE_SCHEMA_SQL = `
create table users (
  id text primary key not null,
  name text,
  email text not null unique,
  email_verified integer not null,
  image text,
  preferred_language text not null,
  created_at integer not null,
  updated_at integer not null
);
create table sessions (
  id text primary key not null,
  session_token text not null unique,
  user_id text not null,
  expires integer not null,
  created_at integer not null,
  updated_at integer not null,
  ip_address text,
  user_agent text
);
create table llm_usage_daily_shards (
  day text not null,
  shard integer not null,
  call_count integer not null,
  created_at integer not null,
  updated_at integer not null,
  primary key (day, shard)
);
create table user_memory_settings (
  user_id text primary key not null,
  enabled integer not null,
  saved_memory_enabled integer not null,
  chat_history_enabled integer not null,
  dreaming_enabled integer not null,
  capture_scope text not null,
  retrieval_mode text not null,
  notice_seen_at integer,
  created_at integer not null,
  updated_at integer not null
);
create table user_memories (
  id text primary key not null,
  user_id text not null,
  kind text not null,
  category text not null,
  content text not null,
  tags text not null,
  confidence integer not null,
  salience integer not null,
  status text not null,
  source_type text not null,
  source_turn_ids text not null,
  source_memory_ids text not null,
  source_chat_id text,
  source_message_id text,
  embedding text,
  valid_from integer,
  valid_until integer,
  freshness_status text not null,
  pinned integer not null,
  do_not_mention integer not null,
  created_at integer not null,
  updated_at integer not null,
  last_used_at integer,
  deleted_at integer
);
create table user_memory_profiles (
  user_id text not null,
  category text not null,
  summary text not null,
  source_memory_ids text not null default '[]',
  last_compiled_at integer not null default 0,
  created_at integer not null default 0,
  updated_at integer not null default 0,
  primary key (user_id, category)
);
create table user_memory_summaries (
  user_id text primary key not null,
  summary text not null default '',
  sections text not null default '[]',
  source_memory_ids text not null default '[]',
  source_turn_ids text not null default '[]',
  version integer not null default 1,
  last_synthesized_at integer not null default 0,
  created_at integer not null default 0,
  updated_at integer not null default 0
);
create table chat_memory_summaries (
  chat_id text primary key not null,
  user_id text not null,
  summary text not null default '',
  topics text not null default '[]',
  source_message_count integer not null default 0,
  embedding text,
  created_at integer not null default 0,
  updated_at integer not null default 0
);
create table chat_memory_turns (
  id text primary key not null,
  user_id text not null,
  chat_id text,
  topic_id text,
  user_message_id text,
  assistant_message_id text,
  question text not null default '',
  answer_excerpt text not null default '',
  searchable_text text not null,
  topics text not null default '[]',
  embedding text,
  created_at integer not null,
  updated_at integer not null
);
create table memory_source_feedback (
  id text primary key not null,
  user_id text not null,
  ai_run_id text,
  memory_id text references user_memories(id) on delete set null,
  chat_turn_id text references chat_memory_turns(id) on delete set null,
  summary_section_id text,
  action text not null,
  note text,
  created_at integer not null
);
create table memory_events (
  id text primary key not null,
  user_id text not null,
  memory_id text,
  chat_id text,
  message_id text,
  event_type text not null,
  reason text,
  metadata text not null,
  created_at integer not null
);
create table memory_synthesis_runs (
  id text primary key not null,
  user_id text not null,
  reason text not null,
  status text not null,
  input_counts text not null,
  output_counts text not null,
  error text,
  started_at integer not null,
  finished_at integer,
  created_at integer not null
);
create table rate_limit_windows (
  "key" text primary key not null,
  count integer not null,
  reset_at integer not null,
  created_at integer not null,
  updated_at integer not null
);
create table app_metadata (
  "key" text primary key not null,
  value text not null,
  updated_at integer not null
);
create table chats (
  id text primary key not null,
  user_id text
);
create table messages (
  id text primary key not null,
  chat_id text not null
);
create table ai_runs (
  id text primary key not null,
  chat_id text not null,
  status text not null default 'completed',
  error text,
  completed_at integer,
  created_at integer not null default 0
);
`;
