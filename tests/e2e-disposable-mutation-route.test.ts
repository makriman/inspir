import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  E2E_DISPOSABLE_MUTATION_INVENTORY_SQL,
  E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES,
  handleMigrationE2EAuthRequest,
  type E2EDisposableMutationInventory,
  type MigrationE2EAuthEnv,
} from "../lib/free-runtime/account-api";
import {
  disposableAdminCleanupFenceToken,
  disposableAdminTopicFixture,
  disposableAdminTopicOwnershipToken,
} from "../lib/free-runtime/disposable-admin-validation";

const authSecret = "native-auth-secret-for-disposable-route-tests";
const capabilitySecret = "migration-capability-secret-at-least-32-bytes";
const adminEmail = "owner@example.com";
const candidateVersionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const clientIp = "203.0.113.42";

test("disposable route creates a new isolated user and atomically cleans its exact graph", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  assert.equal(created.status, 200);
  assert.match(created.headers.get("set-cookie") ?? "", /better-auth\.session_token=/);
  const createdBody = await jsonRecord(created);
  assert.equal(createdBody.runtimeVersionId, candidateVersionId);
  const identity = recordValue(createdBody.identity);
  const userId = requiredString(identity.userId);
  const email = requiredString(identity.email);
  assert.match(email, /^e2e-[a-f0-9-]+@inspirlearning\.invalid$/);
  assert.equal(recordValue(createdBody.user).isAdmin, false);
  assert.deepEqual(createdBody.before, emptyInventory());
  assert.equal(database.inventory.users, 1);
  assert.equal(database.inventory.sessions, 1);
  assert.equal(database.inventory.verification_tokens, 1);
  assert.equal(database.inventory.user_memory_settings, 1);
  const configuredExpiry = Number(env.E2E_TEST_AUTH_EXPIRES_AT);
  assert.ok(database.createdSessionExpiresAt);
  assert.ok(database.createdSessionExpiresAt <= configuredExpiry);
  assert.equal(database.createdMarkerExpiresAt, database.createdSessionExpiresAt);

  for (const name of [
    "chats",
    "messages",
    "activity_runs",
    "ai_runs",
    "rate_limit_windows",
    "product_events",
    "user_memories",
    "memory_events",
  ] as const) {
    database.inventory[name] = 1;
  }
  database.inventory.verification_tokens = 2;
  const proof = cleanupProof(userId);
  const cleaned = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": proof,
    }),
    {
      ...env,
      E2E_TEST_AUTH_EXPIRES_AT: "1",
      CF_VERSION_METADATA: { id: "33333333-3333-4333-8333-333333333333" },
    },
  );
  assert.equal(cleaned.status, 200);
  const cleanedBody = await jsonRecord(cleaned);
  assert.equal(cleanedBody.ok, false);
  assert.equal(cleanedBody.runtimeVersionId, "33333333-3333-4333-8333-333333333333");
  assert.equal(recordValue(cleanedBody.after).memory_vector_cleanup_outbox, 1);
  assert.equal(database.inventory.user_memories, 0);
  assert.equal(database.inventory.memory_vector_cleanup_outbox, 1);
  assert.equal(database.inventory.users, 1);
  assert.ok(database.cleanupQueries.length > 15);
  assert.ok(database.cleanupQueries.every((query) => /\bwhere\b/i.test(query)));
  assert.ok(
    database.cleanupQueries.slice(0, 2).every((query) => /verification_tokens/i.test(query)),
  );
  assert.match(database.cleanupQueries.at(-1) ?? "", /^delete from verification_tokens/);
  assert.ok(database.cleanupBindings.every((values) => !values.includes("historical-user-id")));

  database.inventory.memory_vector_cleanup_outbox = 0;
  const finalized = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": proof,
    }),
    {
      ...env,
      E2E_TEST_AUTH_EXPIRES_AT: "1",
      CF_VERSION_METADATA: { id: "33333333-3333-4333-8333-333333333333" },
    },
  );
  assert.equal((await jsonRecord(finalized)).ok, true);
  assert.deepEqual(database.inventory, emptyInventory());

  const verified = await handleMigrationE2EAuthRequest(
    mutationRequest("verify-disposable-cleanup", userId),
    {
      ...env,
      E2E_TEST_AUTH_EXPIRES_AT: "1",
      CF_VERSION_METADATA: { id: "33333333-3333-4333-8333-333333333333" },
    },
  );
  assert.equal(verified.status, 200);
  const verifiedBody = await jsonRecord(verified);
  assert.equal(verifiedBody.ok, true);
  assert.equal(verifiedBody.runtimeVersionId, "33333333-3333-4333-8333-333333333333");
});

test("disposable admin proof requires its exact session and immediately cleans an exact topic", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  assert.equal(created.status, 200);
  const createdBody = await jsonRecord(created);
  const identity = recordValue(createdBody.identity);
  const userId = requiredString(identity.userId);
  const cookie = requiredSessionCookie(created);

  const secretOnlyGrant = await handleMigrationE2EAuthRequest(
    mutationRequest("grant-disposable-admin", userId),
    env,
  );
  assert.equal(secretOnlyGrant.status, 401);
  assert.equal(database.inventory.admin_users, 0);

  const expiredGrant = await handleMigrationE2EAuthRequest(
    mutationRequest("grant-disposable-admin", userId, { cookie }),
    { ...env, E2E_TEST_AUTH_EXPIRES_AT: "1" },
  );
  assert.equal(expiredGrant.status, 404);
  assert.equal(database.inventory.admin_users, 0);

  const granted = await handleMigrationE2EAuthRequest(
    mutationRequest("grant-disposable-admin", userId, { cookie }),
    env,
  );
  assert.equal(granted.status, 200);
  const grantedBody = await jsonRecord(granted);
  assert.equal(grantedBody.ok, true);
  assert.equal(recordValue(grantedBody.before).admin_users, 0);
  assert.equal(recordValue(grantedBody.after).admin_users, 1);
  assert.deepEqual(recordValue(grantedBody.admin), {
    email: identity.email,
    addedByUserId: userId,
    addedByEmail: identity.email,
    createdAt: new Date(database.adminGrantedAt ?? 0).toISOString(),
    source: "database",
  });

  const fixture = disposableAdminTopicFixture({
    candidateVersionId,
    runId,
    userId,
    email: requiredString(identity.email),
  });
  database.installTopic({ ...fixture, description: `${fixture.description} mismatched` });
  const mismatched = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable-topic", userId, { cookie }),
    env,
  );
  assert.equal(mismatched.status, 409);
  assert.equal(database.inventory.topics, 1);
  assert.equal(database.topicDeleteQueries.length, 0);

  database.installTopic(fixture);
  const cleaned = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable-topic", userId, { cookie }),
    env,
  );
  assert.equal(cleaned.status, 200);
  const cleanedBody = await jsonRecord(cleaned);
  assert.equal(cleanedBody.ok, true);
  assert.deepEqual(cleanedBody.topic, {
    id: database.lastDeletedTopicId,
    slug: fixture.slug,
  });
  assert.equal(recordValue(cleanedBody.before).topics, 1);
  assert.equal(recordValue(cleanedBody.after).topics, 0);
  assert.equal(database.inventory.topics, 0);
  assert.equal(database.inventory.verification_tokens, 1);
  assert.equal(database.topicOwnershipMarkerPresent, false);
  assert.equal(database.topicDeleteQueries.length, 1);
  assert.match(database.topicDeleteQueries[0] ?? "", /where id = \?1[\s\S]*and name = \?3[\s\S]*and metadata = '\{\}'/);
  assert.match(database.topicDeleteQueries[0] ?? "", /not exists \(select 1 from chats[\s\S]*chat_memory_summaries[\s\S]*chat_memory_turns/);
  assert.deepEqual(database.topicDeleteBindings[0]?.slice(0, 7), [
    database.lastDeletedTopicId,
    fixture.slug,
    fixture.name,
    fixture.subText,
    fixture.description,
    fixture.inputboxText,
    fixture.systemPrompt,
  ]);
});

test("generic crash recovery deletes only the exact marker-guarded disposable topic", async () => {
  const exactDatabase = new DisposableD1Database();
  const exactEnv = disposableEnv(exactDatabase);
  const exactCreated = await handleMigrationE2EAuthRequest(
    mutationRequest("create-disposable"),
    exactEnv,
  );
  const exactIdentity = recordValue((await jsonRecord(exactCreated)).identity);
  const exactUserId = requiredString(exactIdentity.userId);
  const fixture = disposableAdminTopicFixture({
    candidateVersionId,
    runId,
    userId: exactUserId,
    email: requiredString(exactIdentity.email),
  });
  exactDatabase.installTopic(fixture);

  const recovered = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", exactUserId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(exactUserId),
    }),
    exactEnv,
  );
  assert.equal(recovered.status, 200);
  assert.equal((await jsonRecord(recovered)).ok, true);
  assert.equal(exactDatabase.inventory.topics, 0);
  assert.equal(exactDatabase.topicRow, null);
  assert.ok(exactDatabase.topicDeleteQueries.some((query) =>
    /delete from topics[\s\S]*id = \?1[\s\S]*slug = \?2[\s\S]*system_prompt = \?7[\s\S]*verification_tokens/.test(query)
  ));

  const mismatchedDatabase = new DisposableD1Database();
  const mismatchedEnv = disposableEnv(mismatchedDatabase);
  const mismatchedCreated = await handleMigrationE2EAuthRequest(
    mutationRequest("create-disposable"),
    mismatchedEnv,
  );
  const mismatchedIdentity = recordValue((await jsonRecord(mismatchedCreated)).identity);
  const mismatchedUserId = requiredString(mismatchedIdentity.userId);
  mismatchedDatabase.installTopic({
    ...fixture,
    systemPrompt: `${fixture.systemPrompt} modified`,
  });
  const refused = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", mismatchedUserId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(mismatchedUserId),
    }),
    mismatchedEnv,
  );
  assert.equal(refused.status, 200);
  const refusedBody = await jsonRecord(refused);
  assert.equal(refusedBody.ok, false);
  assert.equal(recordValue(refusedBody.after).topics, 1);
  assert.equal(mismatchedDatabase.inventory.topics, 1);
  assert.ok(mismatchedDatabase.topicRow);

  mismatchedDatabase.installTopic(fixture);
  const corrected = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", mismatchedUserId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(mismatchedUserId),
    }),
    mismatchedEnv,
  );
  assert.equal((await jsonRecord(corrected)).ok, true);
  assert.deepEqual(mismatchedDatabase.inventory, emptyInventory());
});

test("cleanup fences a topic commit after its initial read and removes it on the same call", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const identity = recordValue((await jsonRecord(created)).identity);
  const userId = requiredString(identity.userId);
  const fixture = disposableAdminTopicFixture({
    candidateVersionId,
    runId,
    userId,
    email: requiredString(identity.email),
  });
  database.commitTopicImmediatelyBeforeCleanupFence = fixture;

  const response = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal((await jsonRecord(response)).ok, true);
  assert.equal(database.topicRow, null);
  assert.equal(database.topicOwnershipMarkerPresent, false);
  assert.deepEqual(database.inventory, emptyInventory());
});

test("generic cleanup recovers an orphaned marker from marker-first topic creation", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const userId = requiredString(recordValue((await jsonRecord(created)).identity).userId);
  database.installOrphanTopicOwnershipMarker();

  const response = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal((await jsonRecord(response)).ok, true);
  assert.equal(database.topicRow, null);
  assert.equal(database.topicOwnershipMarkerPresent, false);
  assert.deepEqual(database.inventory, emptyInventory());
});

test("finalization re-sweeps late chat and analytics writes within the 50-query ceiling", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const createdBody = await jsonRecord(created);
  const identity = recordValue(createdBody.identity);
  const userId = requiredString(identity.userId);
  const cookie = requiredSessionCookie(created);
  database.installTopic(disposableAdminTopicFixture({
    candidateVersionId,
    runId,
    userId,
    email: requiredString(identity.email),
  }));
  database.commitImmediatelyBeforeFinalization = {
    chats: 1,
    product_events: 1,
    ops_events: 1,
    rate_limit_windows: 1,
  };
  database.executedD1Queries = 0;

  const response = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      cookie,
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal((await jsonRecord(response)).ok, true);
  assert.deepEqual(database.inventory, emptyInventory());
  assert.equal(database.orphanedChats, 0);
  assert.equal(database.orphanedProductEvents, 0);
  assert.equal(database.orphanedOpsEvents, 0);
  assert.equal(database.executedD1Queries, 35);
  assert.ok(database.executedD1Queries < 50);
  assert.deepEqual(database.cleanupBatchSizes, [2, 29]);

  const userDeleteIndex = database.cleanupQueries.findLastIndex((query) =>
    /^delete from users\b/i.test(query)
  );
  for (const pattern of [
    /^delete from chats\b/i,
    /^delete from product_events\b/i,
    /^delete from ops_events\b/i,
    /^delete from rate_limit_windows\b/i,
  ]) {
    const sweepIndex = database.cleanupQueries.findLastIndex((query) => pattern.test(query));
    assert.ok(sweepIndex >= 0 && sweepIndex < userDeleteIndex, String(pattern));
  }
});

test("a null vector source committed after the snapshot is captured by the one final batch", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const userId = requiredString(recordValue((await jsonRecord(created)).identity).userId);
  database.commitImmediatelyBeforeFinalization = { user_memories: 1 };

  const fenced = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal((await jsonRecord(fenced)).ok, false);
  assert.equal(database.inventory.user_memories, 0);
  assert.equal(database.inventory.memory_vector_cleanup_outbox, 1);
  assert.equal(database.inventory.users, 1);
  const finalBatchStart = database.cleanupQueries.findIndex((query) =>
    /^insert into memory_vector_cleanup_outbox\b/i.test(query)
  );
  assert.ok(finalBatchStart >= 0);
  assert.equal(
    database.cleanupQueries.slice(finalBatchStart, finalBatchStart + 5).every((query) =>
      /^insert into memory_vector_cleanup_outbox\b/i.test(query)
    ),
    true,
  );
  const firstOwnedDelete = database.cleanupQueries.findIndex((query, index) =>
    index > finalBatchStart && /^delete from memory_source_feedback\b/i.test(query)
  );
  assert.equal(firstOwnedDelete, finalBatchStart + 5);

  database.inventory.memory_vector_cleanup_outbox = 0;
  const recovered = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal((await jsonRecord(recovered)).ok, true);
});

test("a vector source is fenced into the outbox before deletion and retains retry authority", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const userId = requiredString(recordValue((await jsonRecord(created)).identity).userId);
  database.inventory.user_memories = 1;
  database.executedD1Queries = 0;

  const fenced = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal((await jsonRecord(fenced)).ok, false);
  assert.equal(database.inventory.user_memories, 0);
  assert.equal(database.inventory.memory_vector_cleanup_outbox, 1);
  assert.equal(database.inventory.users, 1);
  assert.equal(database.inventory.sessions, 0);
  assert.ok(database.cleanupMarkerPresent);
  assert.equal(database.cleanupMarkerFenced, true);
  const outboxInserts = database.cleanupQueries.filter((query) =>
    /^insert into memory_vector_cleanup_outbox\b/i.test(query)
  );
  assert.equal(outboxInserts.length, 5);
  assert.ok(outboxInserts.every((query) => /from (?:user_memories|chat_memory_turns|chat_memory_summaries)/.test(query)));
  assert.ok(database.executedD1Queries < 50);

  database.inventory.memory_vector_cleanup_outbox = 0;
  const recovered = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal((await jsonRecord(recovered)).ok, true);
  assert.deepEqual(database.inventory, emptyInventory());
});

test("real D1 cleanup captures null, legacy, and finalized exact vector identities", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default {}",
    d1Databases: { DB: `disposable-cleanup-${crypto.randomUUID()}` },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    await applyD1Migrations(database);
    const env = disposableEnv(database);
    const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
    assert.equal(created.status, 200);
    const userId = requiredString(recordValue((await jsonRecord(created)).identity).userId);
    const memoryId = "77777777-7777-4777-8777-777777777777";
    const nullMemoryId = "88888888-8888-4888-8888-888888888888";
    const pendingMemoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const exactVectorId = `m:${"a".repeat(32)}`;
    const pendingMemoryVectorId = `m:${"b".repeat(32)}`;
    const chatId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const userMessageId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const assistantMessageId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const turnId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const pendingTurnVectorId = `t:${"c".repeat(32)}`;
    const now = Date.now();
    await database.prepare(
      `insert into user_memories (
         id, user_id, content, tags, source_turn_ids, source_memory_ids,
         embedding, created_at, updated_at
       ) values (?1, ?2, 'Vector-backed validation memory', '[]', '[]', '[]', ?3, ?4, ?4)`,
    ).bind(memoryId, userId, JSON.stringify(exactVectorId), now).run();
    await database.prepare(
      `insert into user_memories (
         id, user_id, content, tags, source_turn_ids, source_memory_ids,
         embedding, created_at, updated_at
       ) values (?1, ?2, 'Null-vector validation memory', '[]', '[]', '[]', null, ?3, ?3)`,
    ).bind(nullMemoryId, userId, now).run();
    await database.prepare(
      `insert into user_memories (
         id, user_id, content, tags, source_turn_ids, source_memory_ids,
         embedding, created_at, updated_at
       ) values (?1, ?2, 'Pending-vector validation memory', '[]', '[]', '[]', ?3, ?4, ?4)`,
    ).bind(pendingMemoryId, userId, JSON.stringify(`p:${pendingMemoryVectorId}`), now).run();
    await database.prepare(
      `insert into chats (
         id, user_id, user_email_snapshot, title, is_archived, created_at, updated_at
       ) values (?1, ?2, null, 'Pending-vector chat', 0, ?3, ?3)`,
    ).bind(chatId, userId, now).run();
    await database.batch([
      database.prepare(
        `insert into messages (id, chat_id, role, content, metadata, created_at)
         values (?1, ?2, 'user', 'Pending turn question', '{}', ?3)`,
      ).bind(userMessageId, chatId, now),
      database.prepare(
        `insert into messages (id, chat_id, role, content, metadata, created_at)
         values (?1, ?2, 'assistant', 'Pending turn answer', '{}', ?3)`,
      ).bind(assistantMessageId, chatId, now),
    ]);
    await database.prepare(
      `insert into chat_memory_turns (
         id, user_id, chat_id, user_message_id, assistant_message_id,
         question, answer_excerpt, searchable_text, topics, embedding,
         created_at, updated_at
       ) values (?1, ?2, ?3, ?4, ?5,
                 'Pending turn question', 'Pending turn answer',
                 'Pending turn question Pending turn answer', '[]', ?6, ?7, ?7)`,
    ).bind(
      turnId,
      userId,
      chatId,
      userMessageId,
      assistantMessageId,
      JSON.stringify(`p:${pendingTurnVectorId}`),
      now,
    ).run();

    const fenced = await handleMigrationE2EAuthRequest(
      mutationRequest("cleanup-disposable", userId, {
        "x-migration-e2e-cleanup-proof": cleanupProof(userId),
      }),
      env,
    );
    assert.equal(fenced.status, 200);
    assert.equal((await jsonRecord(fenced)).ok, false);
    const sourceCount = await database.prepare(
      "select count(*) as count from user_memories where user_id = ?1",
    ).bind(userId).first<{ count: number }>();
    assert.deepEqual(sourceCount, { count: 0 });
    const outbox = await database.prepare(
      `select vector_id as vectorId, owner_user_id as ownerUserId, state,
              write_fence_expires_at as writeFenceExpiresAt
       from memory_vector_cleanup_outbox where owner_user_id = ?1 order by vector_id`,
    ).bind(userId).all<{
      vectorId: string;
      ownerUserId: string;
      state: string;
      writeFenceExpiresAt: number | null;
    }>();
    const captured = new Map(outbox.results.map((row) => [row.vectorId, row]));
    assert.deepEqual(new Set(captured.keys()), new Set([
      exactVectorId,
      pendingMemoryVectorId,
      pendingTurnVectorId,
      `user_memories:${memoryId}`,
      `user_memories:${nullMemoryId}`,
      `user_memories:${pendingMemoryId}`,
      `chat_memory_turns:${turnId}`,
    ]));
    for (const vectorId of [pendingMemoryVectorId, pendingTurnVectorId]) {
      assert.equal(captured.get(vectorId)?.state, "cleanup_fenced", vectorId);
      assert.ok(captured.get(vectorId)?.writeFenceExpiresAt, vectorId);
    }
    for (const vectorId of [
      exactVectorId,
      `user_memories:${memoryId}`,
      `user_memories:${nullMemoryId}`,
      `user_memories:${pendingMemoryId}`,
      `chat_memory_turns:${turnId}`,
    ]) {
      assert.equal(captured.get(vectorId)?.state, "cleanup_ready", vectorId);
      assert.equal(captured.get(vectorId)?.ownerUserId, userId, vectorId);
    }

    await database.prepare(
      "delete from memory_vector_cleanup_outbox where owner_user_id = ?1",
    ).bind(userId).run();
    const recovered = await handleMigrationE2EAuthRequest(
      mutationRequest("cleanup-disposable", userId, {
        "x-migration-e2e-cleanup-proof": cleanupProof(userId),
      }),
      env,
    );
    assert.equal((await jsonRecord(recovered)).ok, true);
  } finally {
    await miniflare.dispose();
  }
});

test("a foreign summary-vector collision retains its source, chat parent, user, and fence", async () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default {}",
    d1Databases: { DB: `disposable-collision-${crypto.randomUUID()}` },
  });
  try {
    const database = await miniflare.getD1Database("DB");
    await applyD1Migrations(database);
    const env = disposableEnv(database);
    const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
    const identity = recordValue((await jsonRecord(created)).identity);
    const userId = requiredString(identity.userId);
    const email = requiredString(identity.email);
    const chatId = "99999999-9999-4999-8999-999999999999";
    const vectorId = `chat_memory_summaries:${chatId}`;
    const now = Date.now();
    await database.prepare(
      `insert into chats (
         id, user_id, user_email_snapshot, title, is_archived, created_at, updated_at
       ) values (?1, ?2, ?3, 'Collision chat', 0, ?4, ?4)`,
    ).bind(chatId, userId, email, now).run();
    await database.prepare(
      `insert into chat_memory_summaries (
         chat_id, user_id, summary, topics, source_message_count,
         embedding, created_at, updated_at
       ) values (?1, ?2, 'Collision summary', '[]', 0, null, ?3, ?3)`,
    ).bind(chatId, userId, now).run();
    await database.prepare(
      `insert into memory_vector_cleanup_outbox (
         vector_id, owner_user_id, source_namespace, source_row_id,
         reason, state, next_attempt_at, created_at, updated_at
       ) values (?1, 'foreign-owner', null, ?2,
                 'foreign_collision_fixture', 'cleanup_ready', ?3, ?3, ?3)`,
    ).bind(vectorId, chatId, now).run();
    const foreignOutboxBefore = await database.prepare(
      "select * from memory_vector_cleanup_outbox where vector_id = ?1",
    ).bind(vectorId).first<Record<string, unknown>>();
    assert.ok(foreignOutboxBefore);

    const refused = await handleMigrationE2EAuthRequest(
      mutationRequest("cleanup-disposable", userId, {
        "x-migration-e2e-cleanup-proof": cleanupProof(userId),
      }),
      env,
    );
    assert.equal((await jsonRecord(refused)).ok, false);
    const retained = await database.prepare(
      `select
         (select count(*) from users where id = ?1) as users,
         (select count(*) from chats where id = ?2 and user_id = ?1) as chats,
         (select count(*) from chat_memory_summaries where chat_id = ?2 and user_id = ?1)
           as summaries,
         (select count(*) from memory_vector_cleanup_outbox
            where vector_id = ?3 and owner_user_id = 'foreign-owner'
              and source_namespace is null and source_row_id = ?2) as foreignOutbox,
         (select count(*) from memory_vector_cleanup_outbox where owner_user_id = ?1)
           as ownedOutbox,
         (select count(*) from verification_tokens
            where identifier = ?4
              and token like 'inspir-disposable-mutation-fenced-v1:%') as fences`,
    ).bind(userId, chatId, vectorId, email).first<{
      users: number;
      chats: number;
      summaries: number;
      foreignOutbox: number;
      ownedOutbox: number;
      fences: number;
    }>();
    assert.deepEqual(retained, {
      users: 1,
      chats: 1,
      summaries: 1,
      foreignOutbox: 1,
      ownedOutbox: 0,
      fences: 1,
    });
    const foreignOutboxAfter = await database.prepare(
      "select * from memory_vector_cleanup_outbox where vector_id = ?1",
    ).bind(vectorId).first<Record<string, unknown>>();
    assert.deepEqual(foreignOutboxAfter, foreignOutboxBefore);
  } finally {
    await miniflare.dispose();
  }
});

test("a late vector outbox row blocks finalization until an HMAC retry", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const userId = requiredString(recordValue((await jsonRecord(created)).identity).userId);
  database.commitImmediatelyBeforeFinalization = { memory_vector_cleanup_outbox: 1 };

  const fenced = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal((await jsonRecord(fenced)).ok, false);
  assert.equal(database.inventory.users, 1);
  assert.equal(database.inventory.sessions, 0);
  assert.equal(database.inventory.memory_vector_cleanup_outbox, 1);
  assert.ok(database.cleanupMarkerPresent);

  database.inventory.memory_vector_cleanup_outbox = 0;
  const recovered = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal((await jsonRecord(recovered)).ok, true);
  assert.deepEqual(database.inventory, emptyInventory());
});

test("an absent user with topic residue keeps its ownership and cleanup markers", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const identity = recordValue((await jsonRecord(created)).identity);
  const userId = requiredString(identity.userId);
  const fixture = disposableAdminTopicFixture({
    candidateVersionId,
    runId,
    userId,
    email: requiredString(identity.email),
  });
  database.installTopic({ ...fixture, description: `${fixture.description} changed` });
  database.inventory.users = 0;
  database.inventory.sessions = 0;
  database.cleanupMarkerFenced = true;

  const response = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  const body = await jsonRecord(response);
  assert.equal(body.ok, false);
  assert.equal(database.inventory.topics, 1);
  assert.equal(database.inventory.verification_tokens, 2);
  assert.equal(database.topicOwnershipMarkerPresent, true);
  assert.ok(database.cleanupMarkerPresent);
  const nonFenceDelete = database.cleanupQueries.find((query) =>
    /^delete from verification_tokens\b/i.test(query) && query.includes("token <> ?3")
  );
  assert.match(nonFenceDelete ?? "", /not exists \(\s*select 1 from topics/);
  assert.match(nonFenceDelete ?? "", /memory_vector_cleanup_outbox/);
});

test("disposable topic cleanup refuses every dependent data class and preserves recovery authority", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const identity = recordValue((await jsonRecord(created)).identity);
  const userId = requiredString(identity.userId);
  const cookie = requiredSessionCookie(created);
  const fixture = disposableAdminTopicFixture({
    candidateVersionId,
    runId,
    userId,
    email: requiredString(identity.email),
  });
  database.installTopic(fixture);

  for (const references of [
    { chats: 1 },
    { summaries: 1 },
    { turns: 1 },
    { cache: 1 },
  ]) {
    database.setTopicReferences(references);
    const response = await handleMigrationE2EAuthRequest(
      mutationRequest("cleanup-disposable-topic", userId, { cookie }),
      env,
    );
    assert.equal(response.status, 409);
    assert.match(await response.text(), /still referenced/);
    assert.ok(database.topicRow);
    assert.equal(database.topicOwnershipMarkerPresent, true);
    assert.equal(database.inventory.verification_tokens, 2);
  }

  const recovery = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal(recovery.status, 200);
  assert.equal((await jsonRecord(recovery)).ok, false);
  assert.equal(database.inventory.users, 1);
  assert.equal(database.inventory.topics, 1);
  assert.equal(database.topicOwnershipMarkerPresent, true);
});

test("disposable topic cleanup never follows a replacement UUID", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const identity = recordValue((await jsonRecord(created)).identity);
  const userId = requiredString(identity.userId);
  const cookie = requiredSessionCookie(created);
  const fixture = disposableAdminTopicFixture({
    candidateVersionId,
    runId,
    userId,
    email: requiredString(identity.email),
  });
  const ownedTopicId = "44444444-4444-4444-8444-444444444444";
  database.installTopic(fixture, ownedTopicId);
  database.replaceTopicIdWithoutMovingOwnership("66666666-6666-4666-8666-666666666666");

  const direct = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable-topic", userId, { cookie }),
    env,
  );
  assert.equal(direct.status, 409);
  assert.match(await direct.text(), /missing or mismatched/);

  const recovery = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal((await jsonRecord(recovery)).ok, false);
  assert.equal(database.topicRow?.id, "66666666-6666-4666-8666-666666666666");
  assert.equal(database.topicOwnershipTopicId, ownedTopicId);
  assert.equal(database.topicOwnershipMarkerPresent, true);
  assert.equal(database.inventory.users, 1);
});

test("bound disposable actions fail hidden when Worker version metadata is unavailable", async () => {
  const database = new DisposableD1Database();
  const response = await handleMigrationE2EAuthRequest(
    mutationRequest("create-disposable"),
    { ...disposableEnv(database), CF_VERSION_METADATA: undefined },
  );
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "");
  assert.equal(database.createBatches, 0);
});

test("disposable route rejects collisions, identity substitution, and an unauthenticated cleanup", async () => {
  const collisionDatabase = new DisposableD1Database({ users: 1 });
  const collision = await handleMigrationE2EAuthRequest(
    mutationRequest("create-disposable"),
    disposableEnv(collisionDatabase),
  );
  assert.equal(collision.status, 409);
  assert.equal(collisionDatabase.createBatches, 0);

  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const userId = requiredString(recordValue((await jsonRecord(created)).identity).userId);
  const substituted = await handleMigrationE2EAuthRequest(
    mutationRequest(
      "cleanup-disposable",
      "33333333-3333-4333-8333-333333333333",
      { "x-migration-e2e-cleanup-proof": cleanupProof(userId) },
    ),
    env,
  );
  assert.equal(substituted.status, 404);
  assert.equal(database.cleanupBatches, 0);

  const wrongProof = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": "0".repeat(64),
    }),
    env,
  );
  assert.equal(wrongProof.status, 401);
  assert.equal(database.cleanupBatches, 0);
  assert.equal(database.inventory.users, 1);

  const collisionGraph = new DisposableD1Database({ chats: 1, messages: 1 });
  const unmarkedCleanup = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    disposableEnv(collisionGraph),
  );
  assert.equal(unmarkedCleanup.status, 409);
  assert.equal(collisionGraph.cleanupBatches, 0);
  assert.equal(collisionGraph.inventory.chats, 1);
  assert.equal(collisionGraph.inventory.messages, 1);
});

test("partial cleanup is reported as residue and can be authoritatively retried", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const userId = requiredString(recordValue((await jsonRecord(created)).identity).userId);
  database.inventory.ai_runs = 1;
  database.leavePartialCleanup = true;
  const firstCleanup = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal(firstCleanup.status, 200);
  const firstBody = await jsonRecord(firstCleanup);
  assert.equal(firstBody.ok, false);
  assert.equal(recordValue(firstBody.after).ai_runs, 1);

  const readback = await handleMigrationE2EAuthRequest(
    mutationRequest("verify-disposable-cleanup", userId),
    env,
  );
  const readbackBody = await jsonRecord(readback);
  assert.equal(readbackBody.ok, false);
  assert.equal(recordValue(readbackBody.inventory).ai_runs, 1);

  database.leavePartialCleanup = false;
  const retry = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal((await jsonRecord(retry)).ok, true);
  assert.deepEqual(database.inventory, emptyInventory());
});

test("disposable identity survives until the owner-scoped vector outbox is drained", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const userId = requiredString(recordValue((await jsonRecord(created)).identity).userId);
  const cookie = requiredSessionCookie(created);
  database.inventory.chats = 1;
  database.inventory.messages = 1;
  database.inventory.chat_memory_turns = 1;
  database.inventory.memory_vector_cleanup_outbox = 1;

  const fenced = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  const fencedBody = await jsonRecord(fenced);
  assert.equal(fencedBody.ok, false);
  assert.equal(database.inventory.chats, 0);
  assert.equal(database.inventory.messages, 0);
  assert.equal(database.inventory.chat_memory_turns, 0);
  assert.equal(database.inventory.memory_vector_cleanup_outbox, 1);
  assert.equal(database.inventory.users, 1);
  assert.equal(database.inventory.sessions, 0);
  assert.equal(database.inventory.verification_tokens, 1);
  assert.ok(database.cleanupMarkerPresent);
  assert.equal(database.cleanupMarkerFenced, true);
  assert.ok(
    database.cleanupQueries.every((query) => !/^delete from memory_vector_cleanup_outbox\b/i.test(query)),
  );

  // Only the runtime Vectorize drain may remove this operational row after
  // its delayed absence checks. The hidden account route can then finalize
  // the fenced deterministic identity through an HMAC-authorized retry.
  database.inventory.memory_vector_cleanup_outbox = 0;
  const refusedGrant = await handleMigrationE2EAuthRequest(
    mutationRequest("grant-disposable-admin", userId, { cookie }),
    env,
  );
  assert.equal(refusedGrant.status, 401);
  assert.equal(database.inventory.admin_users, 0);
  const finalized = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal((await jsonRecord(finalized)).ok, true);
  assert.deepEqual(database.inventory, emptyInventory());
});

test("disposable cleanup refuses profile-photo pointers so it cannot orphan an R2 object", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const userId = requiredString(recordValue((await jsonRecord(created)).identity).userId);
  database.inventory.profile_photo_pointers = 1;

  const response = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal(response.status, 409);
  assert.match(await response.text(), /profile-photo residue requires external cleanup/);
  assert.equal(database.cleanupBatches, 0);
  assert.equal(database.inventory.users, 1);
  assert.equal(database.inventory.profile_photo_pointers, 1);
});

test("disposable cleanup follows immutable identity after a validated profile rename", async () => {
  const database = new DisposableD1Database();
  const env = disposableEnv(database);
  const created = await handleMigrationE2EAuthRequest(mutationRequest("create-disposable"), env);
  const userId = requiredString(recordValue((await jsonRecord(created)).identity).userId);
  database.renameDisposableUser("Inspir Production Validation");
  database.inventory.profile_photo_pointers = 1;

  const blocked = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal(blocked.status, 409);
  assert.match(await blocked.text(), /profile-photo residue requires external cleanup/);
  assert.equal(database.inventory.users, 1);
  assert.equal(database.inventory.profile_photo_pointers, 1);

  database.inventory.profile_photo_pointers = 0;
  const cleaned = await handleMigrationE2EAuthRequest(
    mutationRequest("cleanup-disposable", userId, {
      "x-migration-e2e-cleanup-proof": cleanupProof(userId),
    }),
    env,
  );
  assert.equal(cleaned.status, 200);
  assert.equal((await jsonRecord(cleaned)).ok, true);
  assert.deepEqual(database.inventory, emptyInventory());
  assert.equal(database.disposableUserName, null);
});

test("inventory names cover every learner-owned mutation table and disposable admin topic", () => {
  assert.deepEqual([...E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES], [
    "users",
    "profile_photo_pointers",
    "accounts",
    "sessions",
    "verification_tokens",
    "rate_limit_windows",
    "admin_users",
    "topics",
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
    "memory_vector_cleanup_outbox",
  ]);
  assert.match(
    E2E_DISPOSABLE_MUTATION_INVENTORY_SQL,
    /from memory_vector_cleanup_outbox where owner_user_id = \?1/,
  );
  assert.match(E2E_DISPOSABLE_MUTATION_INVENTORY_SQL, /from topics where slug = \?10 or id in/);
  assert.match(E2E_DISPOSABLE_MUTATION_INVENTORY_SQL, /token = \?11/);
  assert.match(E2E_DISPOSABLE_MUTATION_INVENTORY_SQL, /token in \(\?9, \?12\)/);
  assert.match(E2E_DISPOSABLE_MUTATION_INVENTORY_SQL, /fenced_cleanup_marker/);
  assert.doesNotMatch(
    E2E_DISPOSABLE_MUTATION_INVENTORY_SQL,
    /from memory_vector_cleanup_outbox(?! where owner_user_id = \?1)/,
  );
});

function mutationRequest(
  action:
    | "create-disposable"
    | "cleanup-disposable"
    | "verify-disposable-cleanup"
    | "grant-disposable-admin"
    | "cleanup-disposable-topic",
  userId?: string,
  extraHeaders: Record<string, string> = {},
) {
  return new Request("https://inspirlearning.com/api/migration/e2e-auth", {
    method: "POST",
    headers: {
      "cf-connecting-ip": clientIp,
      "content-type": "application/json",
      "x-migration-e2e-auth-secret": capabilitySecret,
      ...extraHeaders,
    },
    body: JSON.stringify({
      action,
      runId,
      candidateVersionId,
      ...(userId ? { userId } : {}),
    }),
  });
}

function requiredSessionCookie(response: Response) {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Expected a session cookie.");
  return cookie;
}

function disposableEnv(database: D1Database): MigrationE2EAuthEnv {
  return {
    DB: database,
    AUTH_SECRET: authSecret,
    ADMIN_EMAILS: adminEmail,
    APP_WRITE_FREEZE: "0",
    APP_WRITE_FREEZE_RETRY_AFTER_SECONDS: "300",
    E2E_TEST_AUTH_SECRET: capabilitySecret,
    E2E_TEST_AUTH_EMAIL: adminEmail,
    E2E_TEST_MUTATION_RUN_ID: runId,
    E2E_TEST_AUTH_EXPIRES_AT: String(Date.now() + 60 * 60 * 1_000),
    CF_VERSION_METADATA: { id: candidateVersionId },
  };
}

function cleanupProof(userId: string) {
  return createHmac("sha256", capabilitySecret)
    .update(`disposable-cleanup-v1\0${candidateVersionId}\0${runId}\0${userId}`)
    .digest("hex");
}

function emptyInventory(): E2EDisposableMutationInventory {
  return {
    users: 0,
    profile_photo_pointers: 0,
    accounts: 0,
    sessions: 0,
    verification_tokens: 0,
    rate_limit_windows: 0,
    admin_users: 0,
    topics: 0,
    product_events: 0,
    ops_events: 0,
    chats: 0,
    messages: 0,
    activity_runs: 0,
    ai_runs: 0,
    user_memory_settings: 0,
    user_memories: 0,
    chat_memory_summaries: 0,
    chat_memory_turns: 0,
    user_memory_profiles: 0,
    user_memory_summaries: 0,
    memory_synthesis_runs: 0,
    memory_source_feedback: 0,
    memory_events: 0,
    memory_vector_cleanup_outbox: 0,
  };
}

async function applyD1Migrations(database: D1Database) {
  const migrationFiles = fs.readdirSync(path.resolve("drizzle-d1"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const name of migrationFiles) {
    const statements = fs.readFileSync(path.resolve("drizzle-d1", name), "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => database.prepare(statement));
    if (statements.length) await database.batch(statements);
  }
}

class DisposableD1Database implements D1Database {
  readonly inventory = emptyInventory();
  readonly cleanupQueries: string[] = [];
  readonly cleanupBindings: unknown[][] = [];
  createBatches = 0;
  cleanupBatches = 0;
  readonly cleanupBatchSizes: number[] = [];
  executedD1Queries = 0;
  leavePartialCleanup = false;
  cleanupMarkerPresent = false;
  cleanupMarkerFenced = false;
  cleanupMarkerToken: string | null = null;
  disposableUserName: string | null = null;
  createdSessionExpiresAt: number | null = null;
  createdMarkerExpiresAt: number | null = null;
  sessionToken: string | null = null;
  disposableUserId: string | null = null;
  disposableEmail: string | null = null;
  disposableCreatedAt: number | null = null;
  adminGrantedAt: number | null = null;
  topicRow: DisposableTopicRow | null = null;
  topicOwnershipMarkerPresent = false;
  topicOwnershipTopicId: string | null = null;
  foreignVectorOwnerCollision = false;
  commitImmediatelyBeforeFinalization: Partial<E2EDisposableMutationInventory> | null = null;
  orphanedChats = 0;
  orphanedProductEvents = 0;
  orphanedOpsEvents = 0;
  commitTopicImmediatelyBeforeCleanupFence: ReturnType<
    typeof disposableAdminTopicFixture
  > | null = null;
  lastDeletedTopicId: string | null = null;
  readonly topicDeleteQueries: string[] = [];
  readonly topicDeleteBindings: unknown[][] = [];

  constructor(initial: Partial<E2EDisposableMutationInventory> = {}) {
    Object.assign(this.inventory, initial);
  }

  prepare(query: string) {
    return new DisposableD1Statement(query, this);
  }

  recordQuery(count = 1) {
    this.executedD1Queries += count;
  }

  renameDisposableUser(name: string) {
    assert.equal(this.inventory.users, 1);
    this.disposableUserName = name;
  }

  installTopic(
    fixture: ReturnType<typeof disposableAdminTopicFixture>,
    topicId = "44444444-4444-4444-8444-444444444444",
  ) {
    const now = Date.now();
    this.topicRow = {
      id: topicId,
      ...fixture,
      iconUrl: null,
      sortOrder: 100,
      status: "active",
      metadata: "{}",
      createdAt: now,
      updatedAt: now,
      chatReferences: 0,
      summaryReferences: 0,
      turnReferences: 0,
      cacheReferences: 0,
    };
    this.inventory.topics = 1;
    if (!this.topicOwnershipMarkerPresent) this.inventory.verification_tokens += 1;
    this.topicOwnershipMarkerPresent = true;
    this.topicOwnershipTopicId = topicId;
  }

  installOrphanTopicOwnershipMarker(
    topicId = "44444444-4444-4444-8444-444444444444",
  ) {
    assert.ok(this.cleanupMarkerPresent);
    this.topicRow = null;
    this.inventory.topics = 0;
    if (!this.topicOwnershipMarkerPresent) this.inventory.verification_tokens += 1;
    this.topicOwnershipMarkerPresent = true;
    this.topicOwnershipTopicId = topicId;
  }

  replaceTopicIdWithoutMovingOwnership(topicId: string) {
    if (!this.topicRow) throw new Error("A disposable topic fixture is required.");
    this.topicRow.id = topicId;
  }

  setTopicReferences(references: {
    chats?: number;
    summaries?: number;
    turns?: number;
    cache?: number;
  }) {
    if (!this.topicRow) throw new Error("A disposable topic fixture is required.");
    this.topicRow.chatReferences = references.chats ?? 0;
    this.topicRow.summaryReferences = references.summaries ?? 0;
    this.topicRow.turnReferences = references.turns ?? 0;
    this.topicRow.cacheReferences = references.cache ?? 0;
  }

  deleteExactTopic(query: string, boundValues: readonly unknown[]) {
    this.topicDeleteQueries.push(query);
    this.topicDeleteBindings.push([...boundValues]);
    const topic = this.topicRow;
    if (!topic) return false;
    const ownershipToken = this.disposableUserId && this.disposableEmail
      ? disposableAdminTopicOwnershipToken({
          candidateVersionId,
          runId,
          userId: this.disposableUserId,
          email: this.disposableEmail,
        })
      : null;
    const matches = topic.id === boundValues[0] &&
      topic.slug === boundValues[1] &&
      topic.name === boundValues[2] &&
      topic.subText === boundValues[3] &&
      topic.description === boundValues[4] &&
      topic.inputboxText === boundValues[5] &&
      topic.systemPrompt === boundValues[6] &&
      boundValues[7] === this.disposableEmail &&
      boundValues[8] === this.currentCleanupMarkerToken() &&
      boundValues[9] === ownershipToken &&
      this.topicOwnershipMarkerPresent &&
      this.topicOwnershipTopicId === topic.id &&
      topic.chatReferences === 0 &&
      topic.summaryReferences === 0 &&
      topic.turnReferences === 0 &&
      topic.cacheReferences === 0 &&
      this.cleanupMarkerPresent;
    if (matches) {
      this.lastDeletedTopicId = topic.id;
      this.topicRow = null;
      this.inventory.topics = 0;
    }
    return matches;
  }

  deleteTopicOwnershipMarker(boundValues: readonly unknown[]) {
    const topicId = boundValues[0];
    const topicSlug = boundValues[4];
    const topicStillExists = this.topicRow?.id === topicId || this.topicRow?.slug === topicSlug;
    const matches = this.topicOwnershipMarkerPresent &&
      this.topicOwnershipTopicId === topicId &&
      boundValues[1] === this.disposableEmail &&
      boundValues[3] === this.currentCleanupMarkerToken() &&
      this.cleanupMarkerPresent &&
      !topicStillExists;
    if (matches) {
      this.topicOwnershipMarkerPresent = false;
      this.topicOwnershipTopicId = null;
      this.inventory.verification_tokens -= 1;
    }
    return matches;
  }

  currentCleanupMarkerToken() {
    if (!this.cleanupMarkerToken) return null;
    return this.cleanupMarkerFenced
      ? disposableAdminCleanupFenceToken({ markerToken: this.cleanupMarkerToken })
      : this.cleanupMarkerToken;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    const typed = statements.filter(
      (statement): statement is DisposableD1Statement => statement instanceof DisposableD1Statement,
    );
    assert.equal(typed.length, statements.length);
    this.recordQuery(typed.length);
    if (typed[0]?.query.includes("insert into users")) {
      this.createBatches += 1;
      if (this.inventory.users !== 0) throw new Error("simulated uniqueness collision");
      this.inventory.users = 1;
      this.inventory.user_memory_settings = 1;
      this.inventory.sessions = 1;
      this.inventory.verification_tokens = 1;
      this.cleanupMarkerPresent = true;
      this.cleanupMarkerFenced = false;
      this.cleanupMarkerToken = requiredString(typed[3]?.boundValues[2]);
      this.disposableUserName = "Inspir mutation validation";
      const sessionExpiresAt = typed[2]?.boundValues[3];
      const markerExpiresAt = typed[3]?.boundValues[3];
      if (typeof sessionExpiresAt !== "number" || typeof markerExpiresAt !== "number") {
        throw new Error("Disposable session expiry fixture binding is invalid.");
      }
      this.createdSessionExpiresAt = sessionExpiresAt;
      this.createdMarkerExpiresAt = markerExpiresAt;
      this.sessionToken = requiredString(typed[2]?.boundValues[1]);
      this.disposableUserId = requiredString(typed[0].boundValues[0]);
      this.disposableEmail = requiredString(typed[0].boundValues[1]);
      this.disposableCreatedAt = requiredNumber(typed[0].boundValues[2]);
      const user = {
        id: requiredString(typed[0].boundValues[0]),
        name: "Inspir mutation validation",
        email: requiredString(typed[0].boundValues[1]),
        image: null,
      };
      return typed.map((_, index) => d1Result<T>(index === 0 ? [user] : []));
    }

    this.cleanupBatches += 1;
    this.cleanupBatchSizes.push(typed.length);
    const changes = typed.map(() => 1);
    for (const statement of typed) {
      this.cleanupQueries.push(statement.query);
      this.cleanupBindings.push(statement.boundValues);
    }

    const fenceIndex = typed.findIndex((statement) =>
      /^update verification_tokens\b/i.test(statement.query)
    );
    if (fenceIndex >= 0) {
      if (this.commitTopicImmediatelyBeforeCleanupFence) {
        this.installTopic(this.commitTopicImmediatelyBeforeCleanupFence);
        this.commitTopicImmediatelyBeforeCleanupFence = null;
      }
      const canFence = this.cleanupMarkerPresent && !this.cleanupMarkerFenced;
      this.cleanupMarkerFenced = canFence || this.cleanupMarkerFenced;
      changes[fenceIndex] = canFence ? 1 : 0;
      const sessionDeleteIndex = typed.findIndex((statement) =>
        /^delete from sessions\b/i.test(statement.query)
      );
      if (sessionDeleteIndex >= 0) {
        const deletedSessions = this.cleanupMarkerFenced ? this.inventory.sessions : 0;
        this.inventory.sessions = this.cleanupMarkerFenced ? 0 : this.inventory.sessions;
        changes[sessionDeleteIndex] = deletedSessions;
      }
      return typed.map((_, index) => d1Result<T>([], changes[index] ?? 0));
    }

    const userDelete = typed.find((statement) => /^delete from users\b/i.test(statement.query));
    if (userDelete && this.commitImmediatelyBeforeFinalization) {
      Object.assign(this.inventory, this.commitImmediatelyBeforeFinalization);
      this.commitImmediatelyBeforeFinalization = null;
    }
    const hasVectorCapture = typed.some((statement) =>
      /^insert into memory_vector_cleanup_outbox\b/i.test(statement.query)
    );
    const vectorSourceCount = this.inventory.user_memories +
      this.inventory.chat_memory_turns +
      this.inventory.chat_memory_summaries;
    const vectorCaptureReady = !(this.foreignVectorOwnerCollision && vectorSourceCount > 0);
    if (hasVectorCapture && vectorSourceCount > 0 && vectorCaptureReady) {
      this.inventory.memory_vector_cleanup_outbox = Math.max(
        1,
        this.inventory.memory_vector_cleanup_outbox,
      );
    }

    for (const [index, statement] of typed.entries()) {
      if (/^delete from topics\b/i.test(statement.query)) {
        changes[index] = this.deleteExactTopic(statement.query, statement.boundValues) ? 1 : 0;
      } else if (
        /^delete from verification_tokens\b/i.test(statement.query) &&
        statement.query.includes("where id = ?1 and identifier = ?2 and token = ?3")
      ) {
        changes[index] = this.deleteTopicOwnershipMarker(statement.boundValues) ? 1 : 0;
      }
    }

    if (vectorCaptureReady) {
      for (const name of E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES) {
        if (this.leavePartialCleanup && name === "ai_runs") continue;
        if (
          name === "users" ||
          name === "profile_photo_pointers" ||
          name === "accounts" ||
          name === "sessions" ||
          name === "verification_tokens" ||
          name === "topics" ||
          name === "memory_vector_cleanup_outbox"
        ) continue;
        this.inventory[name] = 0;
      }
    }

    const finalizationReady = this.cleanupMarkerPresent &&
      this.cleanupMarkerFenced &&
      this.inventory.users === 1 &&
      this.inventory.profile_photo_pointers === 0 &&
      this.inventory.topics === 0 &&
      this.inventory.memory_vector_cleanup_outbox === 0 &&
      E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES.every((name) => (
        name === "users" ||
        name === "accounts" ||
        name === "sessions" ||
        name === "verification_tokens" ||
        this.inventory[name] === 0
      ));
    const userDeleteMatches = Boolean(userDelete) && finalizationReady && (
      !userDelete?.query.includes("name = 'Inspir mutation validation'") ||
      this.disposableUserName === "Inspir mutation validation"
    );
    if (userDeleteMatches) {
      this.orphanedChats += this.inventory.chats;
      this.orphanedProductEvents += this.inventory.product_events;
      this.orphanedOpsEvents += this.inventory.ops_events;
      this.inventory.accounts = 0;
      this.inventory.sessions = 0;
      this.inventory.verification_tokens = 0;
      this.inventory.users = 0;
      this.inventory.profile_photo_pointers = 0;
      this.disposableUserName = null;
      this.sessionToken = null;
      this.disposableUserId = null;
      this.disposableEmail = null;
      this.disposableCreatedAt = null;
      this.topicOwnershipMarkerPresent = false;
      this.topicOwnershipTopicId = null;
      this.cleanupMarkerPresent = false;
      this.cleanupMarkerFenced = false;
      this.cleanupMarkerToken = null;
    }
    return typed.map((_, index) => d1Result<T>([], changes[index] ?? 0));
  }

  async exec() {
    return { count: 0, duration: 0 };
  }

  withSession() {
    return new DisposableD1Session(this);
  }

  async dump() {
    return new ArrayBuffer(0);
  }
}

type DisposableTopicRow = ReturnType<typeof disposableAdminTopicFixture> & {
  id: string;
  iconUrl: null;
  sortOrder: 100;
  status: "active";
  metadata: "{}";
  createdAt: number;
  updatedAt: number;
  chatReferences: number;
  summaryReferences: number;
  turnReferences: number;
  cacheReferences: number;
};

class DisposableD1Session implements D1DatabaseSession {
  constructor(private readonly database: DisposableD1Database) {}

  prepare(query: string) {
    return this.database.prepare(query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    return this.database.batch<T>(statements);
  }

  getBookmark() {
    return null;
  }
}

class DisposableD1Statement implements D1PreparedStatement {
  boundValues: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly database: DisposableD1Database,
  ) {}

  bind(...values: unknown[]) {
    this.boundValues = values;
    return this;
  }

  first<T = unknown>(_columnName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first() {
    this.database.recordQuery();
    if (this.query.startsWith("select\n  (select count(*) from users")) {
      const nameRestricted = this.query.includes("name = 'Inspir mutation validation'");
      const userIdentityVisible =
        !nameRestricted || this.database.disposableUserName === "Inspir mutation validation";
      return {
        ...this.database.inventory,
        users: userIdentityVisible ? this.database.inventory.users : 0,
        profile_photo_pointers: userIdentityVisible
          ? this.database.inventory.profile_photo_pointers
          : 0,
        cleanup_marker: this.database.cleanupMarkerPresent ? 1 : 0,
        active_cleanup_marker:
          this.database.cleanupMarkerPresent && !this.database.cleanupMarkerFenced ? 1 : 0,
        fenced_cleanup_marker:
          this.database.cleanupMarkerPresent && this.database.cleanupMarkerFenced ? 1 : 0,
        topic_ownership_marker: this.database.topicOwnershipMarkerPresent ? 1 : 0,
        topic_ownership_topic_id: this.database.topicOwnershipTopicId,
      };
    }
    if (this.query.includes("from sessions s") && this.query.includes("inner join users u")) {
      const token = this.boundValues[0];
      if (
        typeof token !== "string" ||
        token !== this.database.sessionToken ||
        this.database.inventory.sessions !== 1 ||
        !this.database.disposableUserId ||
        !this.database.disposableEmail ||
        !this.database.disposableCreatedAt ||
        !this.database.createdSessionExpiresAt
      ) {
        return null;
      }
      return {
        session_id: "55555555-5555-4555-8555-555555555555",
        session_token: token,
        user_id: this.database.disposableUserId,
        expires: this.database.createdSessionExpiresAt,
        session_created_at: this.database.disposableCreatedAt,
        session_updated_at: this.database.disposableCreatedAt,
        ip_address: clientIp,
        user_agent: null,
        user_name: this.database.disposableUserName,
        user_email: this.database.disposableEmail,
        user_email_verified: 1,
        user_image: null,
        user_created_at: this.database.disposableCreatedAt,
        user_updated_at: this.database.disposableCreatedAt,
      };
    }
    if (this.query.includes("insert into admin_users")) {
      const email = requiredString(this.boundValues[0]);
      const userId = requiredString(this.boundValues[1]);
      const createdAt = requiredNumber(this.boundValues[2]);
      if (
        email !== this.database.disposableEmail ||
        userId !== this.database.disposableUserId ||
        !this.database.cleanupMarkerPresent ||
        this.database.cleanupMarkerFenced ||
        this.database.inventory.admin_users !== 0
      ) {
        return null;
      }
      this.database.inventory.admin_users = 1;
      this.database.adminGrantedAt = createdAt;
      return {
        email,
        addedByUserId: userId,
        addedByEmail: email,
        createdAt,
      };
    }
    if (this.query.includes("from topics t where t.id = ?1 and t.slug = ?2 limit 1")) {
      const topic = this.database.topicRow;
      if (!topic) return null;
      return topic.id === this.boundValues[0] && topic.slug === this.boundValues[1]
        ? topic
        : null;
    }
    return null;
  }

  async run<T = Record<string, unknown>>() {
    this.database.recordQuery();
    if (/^update verification_tokens\b/i.test(this.query)) {
      this.database.cleanupQueries.push(this.query);
      this.database.cleanupBindings.push(this.boundValues);
      if (this.database.commitTopicImmediatelyBeforeCleanupFence) {
        this.database.installTopic(this.database.commitTopicImmediatelyBeforeCleanupFence);
        this.database.commitTopicImmediatelyBeforeCleanupFence = null;
      }
      const canFence = this.database.cleanupMarkerPresent && !this.database.cleanupMarkerFenced;
      this.database.cleanupMarkerFenced = canFence || this.database.cleanupMarkerFenced;
      return d1Result<T>([], canFence ? 1 : 0);
    }
    if (/^delete from topics\b/i.test(this.query)) {
      const matches = this.database.deleteExactTopic(this.query, this.boundValues);
      return d1Result<T>([], matches ? 1 : 0);
    }
    return d1Result<T>();
  }

  async all<T = Record<string, unknown>>() {
    this.database.recordQuery();
    return d1Result<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }) {
    if (options?.columnNames) return [[]] as [string[], ...T[]];
    return [];
  }
}

function d1Result<T>(results: unknown[] = [], changes = 1): D1Result<T> {
  return {
    success: true,
    meta: {
      served_by: "disposable-route-test",
      duration: 0,
      changes,
      last_row_id: 0,
      changed_db: true,
      size_after: 0,
      rows_read: 0,
      rows_written: 1,
    },
    results: results.filter((entry): entry is T => typeof entry === "object" && entry !== null),
  };
}

async function jsonRecord(response: Response) {
  return recordValue(await response.json());
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Expected a record response.");
  }
  return value;
}

function requiredString(value: unknown) {
  if (typeof value !== "string") throw new Error("Expected a string response field.");
  return value;
}

function requiredNumber(value: unknown) {
  if (typeof value !== "number") throw new Error("Expected a number binding.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
