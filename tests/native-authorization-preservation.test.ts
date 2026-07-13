import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  handleProtectedAiApiRequest,
  type ProtectedApiExecutionContext,
} from "../lib/free-runtime/protected-ai-api";
import {
  handleStateApiRequest,
  type StateApiEnv,
  type StateApiExecutionContext,
} from "../lib/free-runtime/state-api";
import { buildNativeSessionCookie } from "../lib/free-runtime/native-session";
import {
  deriveDisposableAdminValidationIdentity,
  disposableAdminCleanupFenceToken,
  disposableAdminTopicFixture,
  disposableAdminTopicOwnershipToken,
} from "../lib/free-runtime/disposable-admin-validation";

const AUTH_SECRET = "native-authorization-test-secret-that-is-long-enough";
const USER_A_ID = "11111111-1111-4111-8111-111111111111";
const USER_B_ID = "22222222-2222-4222-8222-222222222222";
const USER_A_EMAIL = "learner-a@example.test";
const TOPIC_ID = "33333333-3333-4333-8333-333333333333";
const CHAT_B_ID = "44444444-4444-4444-8444-444444444444";
const MESSAGE_B_ID = "55555555-5555-4555-8555-555555555555";
const MEMORY_B_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_A_TOKEN = "session-token-user-a-00000001";
const USER_B_CHAT_SECRET = "user-b-private-chat-content";
const USER_B_MEMORY_SECRET = "user-b-private-memory-content";
const VALIDATION_VERSION_ID = "88888888-8888-4888-8888-888888888888";
const VALIDATION_RUN_ID = "99999999-9999-4999-8999-999999999999";
const VALIDATION_SECRET = "production-validation-capability-secret-32-bytes";

type D1ExecutionMethod = "first" | "run" | "all" | "raw" | "batch" | "exec";

type D1Execution = {
  query: string;
  bindings: readonly unknown[];
  method: D1ExecutionMethod;
};

test("signed user A cannot read or mutate user B saved chat, message, or memory", async () => {
  const fixture = await createAuthorizationFixture();
  try {
    const chatRead = await stateRequest(fixture, `/api/chats/${CHAT_B_ID}`);
    await assertPrivateNotFound(chatRead, "Not found", [USER_B_CHAT_SECRET]);
    assertExecutionSequence(fixture.database, [
      { table: "sessions", bindings: [SESSION_A_TOKEN] },
      { table: "chats", bindings: [CHAT_B_ID, USER_A_ID] },
    ]);

    fixture.database.clearExecutions();
    const messageRead = await stateRequest(
      fixture,
      `/api/chats/${CHAT_B_ID}/messages/${MESSAGE_B_ID}?offset=0`,
    );
    await assertPrivateNotFound(messageRead, "Not found", [USER_B_CHAT_SECRET]);
    assertExecutionSequence(fixture.database, [
      { table: "sessions", bindings: [SESSION_A_TOKEN] },
      { table: "messages", bindings: [CHAT_B_ID, USER_A_ID, MESSAGE_B_ID, 1] },
    ]);

    fixture.database.clearExecutions();
    const messageDelete = await stateRequest(
      fixture,
      `/api/chats/${CHAT_B_ID}/messages/${MESSAGE_B_ID}`,
      { method: "DELETE" },
    );
    assert.equal(messageDelete.status, 405);
    assert.equal(messageDelete.headers.get("allow"), "GET");
    assertExecutionSequence(fixture.database, [
      { table: "sessions", bindings: [SESSION_A_TOKEN] },
    ]);

    fixture.database.clearExecutions();
    const chatDelete = await stateRequest(fixture, `/api/chats/${CHAT_B_ID}`, {
      method: "DELETE",
    });
    await assertPrivateNotFound(chatDelete, "Not found", [USER_B_CHAT_SECRET]);
    assertExecutionSequence(fixture.database, [
      { table: "sessions", bindings: [SESSION_A_TOKEN] },
      { table: "chats", bindings: [CHAT_B_ID, USER_A_ID] },
    ]);
    assertNoExecutedMutation(fixture.database.executions);

    fixture.database.clearExecutions();
    const memoryPatch = await stateRequest(fixture, `/api/memory/${MEMORY_B_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "user A must never replace user B memory" }),
    });
    await assertPrivateNotFound(memoryPatch, "Memory not found", [USER_B_MEMORY_SECRET]);
    assertExecutionSequence(fixture.database, [
      { table: "sessions", bindings: [SESSION_A_TOKEN] },
      { table: "user_memories", bindings: [MEMORY_B_ID, USER_A_ID] },
    ]);
    assertNoExecutedMutation(fixture.database.executions);

    fixture.database.clearExecutions();
    const memoryDelete = await stateRequest(fixture, `/api/memory/${MEMORY_B_ID}`, {
      method: "DELETE",
    });
    await assertPrivateNotFound(memoryDelete, "Memory not found", [USER_B_MEMORY_SECRET]);
    assertExecutionSequence(fixture.database, [
      { table: "sessions", bindings: [SESSION_A_TOKEN] },
      { table: "user_memories", bindings: [MEMORY_B_ID, USER_A_ID] },
    ]);
    assertNoExecutedMutation(fixture.database.executions);

    const preservedChat = await fixture.rawDatabase
      .prepare("select user_id as userId from chats where id = ?1")
      .bind(CHAT_B_ID)
      .first<{ userId: string }>();
    const preservedMessage = await fixture.rawDatabase
      .prepare("select content from messages where id = ?1 and chat_id = ?2")
      .bind(MESSAGE_B_ID, CHAT_B_ID)
      .first<{ content: string }>();
    const preservedMemory = await fixture.rawDatabase
      .prepare("select user_id as userId, content, status from user_memories where id = ?1")
      .bind(MEMORY_B_ID)
      .first<{ userId: string; content: string; status: string }>();
    assert.deepEqual(preservedChat, { userId: USER_B_ID });
    assert.deepEqual(preservedMessage, { content: USER_B_CHAT_SECRET });
    assert.deepEqual(preservedMemory, {
      userId: USER_B_ID,
      content: USER_B_MEMORY_SECRET,
      status: "active",
    });
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("valid non-admin session receives 403 before native admin data reads or writes", async () => {
  const fixture = await createAuthorizationFixture();
  try {
    const requests = [
      new Request("https://inspirlearning.com/api/admin/dashboard?days=90", {
        headers: { cookie: fixture.cookie },
      }),
      new Request("https://inspirlearning.com/api/admin/users", {
        method: "POST",
        headers: { cookie: fixture.cookie, "content-type": "application/json" },
        body: JSON.stringify({ email: "attacker-added-admin@example.test" }),
      }),
      new Request("https://inspirlearning.com/api/admin/users?email=existing-admin@example.test", {
        method: "DELETE",
        headers: { cookie: fixture.cookie },
      }),
      new Request("https://inspirlearning.com/api/admin/topics", {
        method: "POST",
        headers: { cookie: fixture.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized topic",
          subText: "Must never be parsed or stored",
          description: "Must never be parsed or stored",
          inputboxText: "Must never be parsed or stored",
          systemPrompt: "Must never be parsed or stored",
        }),
      }),
    ] as const;

    for (const request of requests) {
      fixture.database.clearExecutions();
      const response = await handleProtectedAiApiRequest(
        request,
        fixture.cloudflareEnv,
        protectedContext(),
      );
      assert.ok(response);
      assert.equal(response.status, 403, request.url);
      assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0, must-revalidate");
      assert.equal(response.headers.get("x-inspir-delivery"), "lean-api-worker");
      const body: unknown = await response.json();
      assert.deepEqual(body, { error: "Forbidden" });

      assert.equal(fixture.database.executions.length, 2, request.url);
      const [sessionLookup, adminMembershipLookup] = fixture.database.executions;
      assert.ok(sessionLookup);
      assert.ok(adminMembershipLookup);
      assert.equal(sessionLookup.method, "first");
      assert.match(normalizeSql(sessionLookup.query), / from sessions s /);
      assert.deepEqual(sessionLookup.bindings.slice(0, 1), [SESSION_A_TOKEN]);
      assert.equal(adminMembershipLookup.method, "first");
      assert.match(normalizeSql(adminMembershipLookup.query), /^select email from admin_users /);
      assert.deepEqual(adminMembershipLookup.bindings, [USER_A_EMAIL]);
      assertNoAdminPayloadQuery(fixture.database.executions);
    }

    const unauthorizedAdmin = await fixture.rawDatabase
      .prepare("select email from admin_users where email = ?1")
      .bind("attacker-added-admin@example.test")
      .first<{ email: string }>();
    const preservedAdmin = await fixture.rawDatabase
      .prepare("select email from admin_users where email = ?1")
      .bind("existing-admin@example.test")
      .first<{ email: string }>();
    const unauthorizedTopic = await fixture.rawDatabase
      .prepare("select id from topics where slug = 'unauthorized-topic'")
      .first<{ id: string }>();
    assert.equal(unauthorizedAdmin, null);
    assert.deepEqual(preservedAdmin, { email: "existing-admin@example.test" });
    assert.equal(unauthorizedTopic, null);
  } finally {
    await fixture.miniflare.dispose();
  }
});

test("ordinary admins remain unrestricted while disposable validation admins are capability-bound", async () => {
  const fixture = await createAuthorizationFixture();
  try {
    const now = Date.now();
    await fixture.rawDatabase.prepare(
      `insert into admin_users (email, added_by_user_id, added_by_email, created_at)
       values (?1, ?2, ?1, ?3)`,
    ).bind(USER_A_EMAIL, USER_A_ID, now).run();

    const ordinaryAdmin = await handleProtectedAiApiRequest(
      new Request("https://inspirlearning.com/api/admin/users", {
        method: "POST",
        headers: { cookie: fixture.cookie, "content-type": "application/json" },
        body: JSON.stringify({ email: "ordinary-added-admin@example.test" }),
      }),
      fixture.cloudflareEnv,
      protectedContext(),
    );
    assert.equal(ordinaryAdmin?.status, 200);
    const ordinaryTopic = await handleProtectedAiApiRequest(
      new Request("https://inspirlearning.com/api/admin/topics", {
        method: "POST",
        headers: { cookie: fixture.cookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Ordinary admin topic",
          subText: "Ordinary subtext",
          description: "Ordinary description",
          inputboxText: "Ordinary input",
          systemPrompt: "Ordinary system prompt",
        }),
      }),
      fixture.cloudflareEnv,
      protectedContext(),
    );
    assert.equal(ordinaryTopic?.status, 200);

    const identity = await deriveDisposableAdminValidationIdentity(
      VALIDATION_VERSION_ID,
      VALIDATION_RUN_ID,
    );
    assert.ok(identity);
    const validationToken = "session-token-disposable-validation-admin";
    const expiresAt = now + 60 * 60 * 1_000;
    await fixture.rawDatabase.batch([
      fixture.rawDatabase.prepare(
        `insert into users (id, name, email, email_verified, image, created_at, updated_at)
         values (?1, 'Disposable validation', ?2, 1, null, ?3, ?3)`,
      ).bind(identity.userId, identity.email, now),
      fixture.rawDatabase.prepare(
        `insert into sessions
           (id, session_token, user_id, expires, created_at, updated_at, ip_address, user_agent)
         values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?1, ?2, ?3, ?4, ?4, null, 'validation-test')`,
      ).bind(validationToken, identity.userId, expiresAt, now),
      fixture.rawDatabase.prepare(
        `insert into admin_users (email, added_by_user_id, added_by_email, created_at)
         values (?1, ?2, ?1, ?3)`,
      ).bind(identity.email, identity.userId, now),
      fixture.rawDatabase.prepare(
        `insert into verification_tokens (id, identifier, token, expires, created_at, updated_at)
         values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ?1, ?2, ?3, ?4, ?4)`,
      ).bind(identity.email, identity.markerToken, expiresAt, now),
    ]);
    const validationCookie = (await buildNativeSessionCookie(
      validationToken,
      AUTH_SECRET,
      "https://inspirlearning.com/api/admin/users",
      expiresAt,
    )).split(";", 1)[0];
    assert.ok(validationCookie);
    const validationBindings = {
      versionId: VALIDATION_VERSION_ID,
      secret: VALIDATION_SECRET,
      runId: VALIDATION_RUN_ID,
      expiresAt: String(expiresAt),
    };
    const validationEnv = new AuthorizationTestCloudflareEnv(
      fixture.database,
      validationBindings,
    );

    const arbitraryRequests = [
      new Request("https://inspirlearning.com/api/admin/dashboard", {
        headers: { cookie: validationCookie },
      }),
      new Request("https://inspirlearning.com/api/admin/users", {
        method: "POST",
        headers: { cookie: validationCookie, "content-type": "application/json" },
        body: JSON.stringify({ email: "validation-attacker@example.test" }),
      }),
      new Request("https://inspirlearning.com/api/admin/users?email=existing-admin@example.test", {
        method: "DELETE",
        headers: { cookie: validationCookie },
      }),
      new Request("https://inspirlearning.com/api/admin/topics", {
        method: "POST",
        headers: { cookie: validationCookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: "Arbitrary validation topic",
          subText: "Forbidden",
          description: "Forbidden",
          inputboxText: "Forbidden",
          systemPrompt: "Forbidden",
        }),
      }),
    ];
    for (const request of arbitraryRequests) {
      const response = await handleProtectedAiApiRequest(
        request,
        validationEnv,
        protectedContext(),
      );
      assert.equal(response?.status, 403, request.url);
      assert.deepEqual(await response?.json(), { error: "Forbidden" });
    }

    const exactSelf = await handleProtectedAiApiRequest(
      new Request("https://inspirlearning.com/api/admin/users", {
        method: "POST",
        headers: { cookie: validationCookie, "content-type": "application/json" },
        body: JSON.stringify({ email: identity.email }),
      }),
      validationEnv,
      protectedContext(),
    );
    assert.equal(exactSelf?.status, 200);

    const topicFixture = disposableAdminTopicFixture(identity);
    const ownershipCollisionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await fixture.rawDatabase.prepare(
      `insert into verification_tokens (id, identifier, token, expires, created_at, updated_at)
       values (?1, ?2, ?3, ?4, ?5, ?5)`,
    ).bind(
      ownershipCollisionId,
      identity.email,
      disposableAdminTopicOwnershipToken(identity),
      expiresAt,
      now,
    ).run();
    const collidedTopic = await handleProtectedAiApiRequest(
      new Request("https://inspirlearning.com/api/admin/topics", {
        method: "POST",
        headers: { cookie: validationCookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: topicFixture.name,
          subText: topicFixture.subText,
          description: topicFixture.description,
          inputboxText: topicFixture.inputboxText,
          systemPrompt: topicFixture.systemPrompt,
        }),
      }),
      validationEnv,
      protectedContext(),
    );
    assert.equal(collidedTopic?.status, 409);
    assert.deepEqual(await collidedTopic?.json(), {
      error: "Disposable validation authority is unavailable.",
    });
    const topicResidueAfterCollision = await fixture.rawDatabase.prepare(
      "select count(*) as count from topics where slug = ?1",
    ).bind(topicFixture.slug).first<{ count: number }>();
    assert.deepEqual(topicResidueAfterCollision, { count: 0 });
    await fixture.rawDatabase.prepare(
      "delete from verification_tokens where id = ?1",
    ).bind(ownershipCollisionId).run();

    const exactTopic = await handleProtectedAiApiRequest(
      new Request("https://inspirlearning.com/api/admin/topics", {
        method: "POST",
        headers: { cookie: validationCookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: topicFixture.name,
          subText: topicFixture.subText,
          description: topicFixture.description,
          inputboxText: topicFixture.inputboxText,
          systemPrompt: topicFixture.systemPrompt,
        }),
      }),
      validationEnv,
      protectedContext(),
    );
    assert.equal(exactTopic?.status, 200);
    const exactTopicBody: unknown = await exactTopic?.json();
    assert.ok(isRecord(exactTopicBody) && isRecord(exactTopicBody.topic));
    const exactTopicId = exactTopicBody.topic.id;
    assert.equal(typeof exactTopicId, "string");
    const ownershipMarker = await fixture.rawDatabase.prepare(
      `select identifier, token from verification_tokens where id = ?1`,
    ).bind(exactTopicId).first<{ identifier: string; token: string }>();
    assert.deepEqual(ownershipMarker, {
      identifier: identity.email,
      token: disposableAdminTopicOwnershipToken(identity),
    });

    const exactSelfDelete = await handleProtectedAiApiRequest(
      new Request(
        `https://inspirlearning.com/api/admin/users?email=${encodeURIComponent(identity.email)}`,
        { method: "DELETE", headers: { cookie: validationCookie } },
      ),
      validationEnv,
      protectedContext(),
    );
    assert.equal(exactSelfDelete?.status, 200);
    await fixture.rawDatabase.prepare(
      `insert into admin_users (email, added_by_user_id, added_by_email, created_at)
       values (?1, ?2, ?1, ?3)`,
    ).bind(identity.email, identity.userId, Date.now()).run();

    const operationsBeforeFence = await fixture.rawDatabase.prepare(
      "select count(*) as count from ops_events where user_id = ?1",
    ).bind(identity.userId).first<{ count: number }>();
    await fixture.rawDatabase.batch([
      fixture.rawDatabase.prepare("delete from topics where id = ?1").bind(exactTopicId),
      fixture.rawDatabase.prepare(
        "delete from verification_tokens where id = ?1 and token = ?2",
      ).bind(exactTopicId, disposableAdminTopicOwnershipToken(identity)),
      fixture.rawDatabase.prepare(
        `update verification_tokens
         set token = ?3, expires = 1, updated_at = ?4
         where identifier = ?1 and token = ?2`,
      ).bind(
        identity.email,
        identity.markerToken,
        disposableAdminCleanupFenceToken(identity),
        Date.now(),
      ),
    ]);

    const fencedRequests = [
      new Request("https://inspirlearning.com/api/admin/users", {
        method: "POST",
        headers: { cookie: validationCookie, "content-type": "application/json" },
        body: JSON.stringify({ email: identity.email }),
      }),
      new Request(
        `https://inspirlearning.com/api/admin/users?email=${encodeURIComponent(identity.email)}`,
        { method: "DELETE", headers: { cookie: validationCookie } },
      ),
      new Request("https://inspirlearning.com/api/admin/topics", {
        method: "POST",
        headers: { cookie: validationCookie, "content-type": "application/json" },
        body: JSON.stringify({
          name: topicFixture.name,
          subText: topicFixture.subText,
          description: topicFixture.description,
          inputboxText: topicFixture.inputboxText,
          systemPrompt: topicFixture.systemPrompt,
        }),
      }),
    ];
    for (const request of fencedRequests) {
      const response = await handleProtectedAiApiRequest(
        request,
        validationEnv,
        protectedContext(),
      );
      assert.equal(response?.status, 409, request.url);
    }
    const operationsAfterFence = await fixture.rawDatabase.prepare(
      "select count(*) as count from ops_events where user_id = ?1",
    ).bind(identity.userId).first<{ count: number }>();
    const topicsAfterFence = await fixture.rawDatabase.prepare(
      "select count(*) as count from topics where slug = ?1",
    ).bind(topicFixture.slug).first<{ count: number }>();
    const ownershipAfterFence = await fixture.rawDatabase.prepare(
      "select count(*) as count from verification_tokens where token = ?1",
    ).bind(disposableAdminTopicOwnershipToken(identity)).first<{ count: number }>();
    assert.deepEqual(operationsAfterFence, operationsBeforeFence);
    assert.deepEqual(topicsAfterFence, { count: 0 });
    assert.deepEqual(ownershipAfterFence, { count: 0 });

    const failClosedBindings = [
      { ...validationBindings, expiresAt: "1" },
      { ...validationBindings, versionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      { versionId: VALIDATION_VERSION_ID, runId: VALIDATION_RUN_ID, expiresAt: String(expiresAt) },
    ];
    for (const bindings of failClosedBindings) {
      const response = await handleProtectedAiApiRequest(
        new Request(
          `https://inspirlearning.com/api/admin/users?email=${encodeURIComponent(identity.email)}`,
          { method: "DELETE", headers: { cookie: validationCookie } },
        ),
        new AuthorizationTestCloudflareEnv(fixture.database, bindings),
        protectedContext(),
      );
      assert.equal(response?.status, 403);
    }

    const preservedExistingAdmin = await fixture.rawDatabase.prepare(
      "select email from admin_users where email = 'existing-admin@example.test'",
    ).first<{ email: string }>();
    const forbiddenAdmin = await fixture.rawDatabase.prepare(
      "select email from admin_users where email = 'validation-attacker@example.test'",
    ).first<{ email: string }>();
    const forbiddenTopic = await fixture.rawDatabase.prepare(
      "select id from topics where slug = 'arbitrary-validation-topic'",
    ).first<{ id: string }>();
    assert.deepEqual(preservedExistingAdmin, { email: "existing-admin@example.test" });
    assert.equal(forbiddenAdmin, null);
    assert.equal(forbiddenTopic, null);
  } finally {
    await fixture.miniflare.dispose();
  }
});

type AuthorizationFixture = {
  miniflare: Miniflare;
  rawDatabase: D1Database;
  database: TracingD1Database;
  cloudflareEnv: CloudflareEnv;
  stateEnv: StateApiEnv;
  cookie: string;
};

async function createAuthorizationFixture(): Promise<AuthorizationFixture> {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default {}",
    d1Databases: { DB: `native-authorization-${crypto.randomUUID()}` },
  });
  try {
    const rawDatabase = await miniflare.getD1Database("DB");
    const schemaStatements = AUTHORIZATION_SCHEMA_SQL
      .split(";")
      .map((query) => query.trim())
      .filter(Boolean)
      .map((query) => rawDatabase.prepare(query));
    await rawDatabase.batch(schemaStatements);
    const now = Date.now();
    await rawDatabase.batch([
      rawDatabase.prepare(
        `insert into users (id, name, email, email_verified, image, created_at, updated_at)
         values (?1, ?2, ?3, 1, null, ?4, ?4)`,
      ).bind(USER_A_ID, "Learner A", USER_A_EMAIL, now),
      rawDatabase.prepare(
        `insert into users (id, name, email, email_verified, image, created_at, updated_at)
         values (?1, ?2, ?3, 1, null, ?4, ?4)`,
      ).bind(USER_B_ID, "Learner B", "learner-b@example.test", now),
      rawDatabase.prepare(
        `insert into sessions
           (id, session_token, user_id, expires, created_at, updated_at, ip_address, user_agent)
         values (?1, ?2, ?3, ?4, ?5, ?5, null, 'authorization-test')`,
      ).bind(
        "77777777-7777-4777-8777-777777777777",
        SESSION_A_TOKEN,
        USER_A_ID,
        now + 60 * 60 * 1_000,
        now,
      ),
      rawDatabase.prepare(
        `insert into topics
           (id, slug, name, sub_text, description, inputbox_text, system_prompt,
            icon_url, sort_order, status, metadata, created_at, updated_at)
         values (?1, 'private-topic', 'Private topic', '', '', '', '', null, 1, 'active', '{}', ?2, ?2)`,
      ).bind(TOPIC_ID, now),
      rawDatabase.prepare(
        `insert into chats
           (id, user_id, user_email_snapshot, topic_id, topic_name_snapshot,
            title, is_archived, created_at, updated_at)
         values (?1, ?2, 'learner-b@example.test', ?3, 'Private topic',
                 'User B private chat', 0, ?4, ?4)`,
      ).bind(CHAT_B_ID, USER_B_ID, TOPIC_ID, now),
      rawDatabase.prepare(
        `insert into messages (id, chat_id, role, content, metadata, created_at)
         values (?1, ?2, 'user', ?3, '{}', ?4)`,
      ).bind(MESSAGE_B_ID, CHAT_B_ID, USER_B_CHAT_SECRET, now),
      rawDatabase.prepare(
        `insert into user_memories (
           id, user_id, kind, category, content, tags, confidence, salience,
           status, source_type, source_turn_ids, source_memory_ids, source_chat_id,
           source_message_id, embedding, valid_from, valid_until, freshness_status,
           pinned, do_not_mention, created_at, updated_at, last_used_at, deleted_at
         ) values (
           ?1, ?2, 'explicit', 'general', ?3, '[]', 100, 95,
           'active', 'manual', '[]', '[]', ?4, ?5, null, null, null, 'current',
           1, 0, ?6, ?6, null, null
         )`,
      ).bind(MEMORY_B_ID, USER_B_ID, USER_B_MEMORY_SECRET, CHAT_B_ID, MESSAGE_B_ID, now),
      rawDatabase.prepare(
        `insert into admin_users (email, added_by_user_id, added_by_email, created_at)
         values ('existing-admin@example.test', ?1, 'owner@example.test', ?2)`,
      ).bind(USER_B_ID, now),
    ]);

    const database = new TracingD1Database(rawDatabase);
    const cloudflareEnv = new AuthorizationTestCloudflareEnv(database);
    const cookie = (await buildNativeSessionCookie(
      SESSION_A_TOKEN,
      AUTH_SECRET,
      "https://inspirlearning.com/api/chats",
      now + 60 * 60 * 1_000,
    )).split(";", 1)[0];
    assert.ok(cookie);
    return {
      miniflare,
      rawDatabase,
      database,
      cloudflareEnv,
      stateEnv: cloudflareEnv,
      cookie,
    };
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
}

async function stateRequest(
  fixture: AuthorizationFixture,
  pathname: string,
  init?: RequestInit,
) {
  const headers = new Headers(init?.headers);
  headers.set("cookie", fixture.cookie);
  const response = await handleStateApiRequest(
    new Request(`https://inspirlearning.com${pathname}`, { ...init, headers }),
    fixture.stateEnv,
    stateContext(),
  );
  assert.ok(response);
  return response;
}

async function assertPrivateNotFound(
  response: Response,
  message: string,
  forbiddenContents: readonly string[],
) {
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0, must-revalidate");
  assert.equal(response.headers.get("x-inspir-delivery"), "lean-api-worker");
  const body = await response.text();
  assert.equal(body, JSON.stringify({ error: message }));
  for (const content of forbiddenContents) assert.equal(body.includes(content), false);
}

function assertExecutionSequence(
  database: TracingD1Database,
  expected: readonly { table: string; bindings: readonly unknown[] }[],
) {
  assert.equal(database.executions.length, expected.length);
  for (const [index, expectation] of expected.entries()) {
    const execution = database.executions[index];
    assert.ok(execution);
    assert.equal(execution.method, "first");
    assert.match(normalizeSql(execution.query), new RegExp(`\\b${expectation.table}\\b`));
    assert.deepEqual(execution.bindings.slice(0, expectation.bindings.length), expectation.bindings);
  }
}

function assertNoExecutedMutation(executions: readonly D1Execution[]) {
  for (const execution of executions) {
    assert.doesNotMatch(normalizeSql(execution.query), /^(?:insert|update|delete)\b/);
    assert.notEqual(execution.method, "batch");
    assert.notEqual(execution.method, "run");
  }
}

function assertNoAdminPayloadQuery(executions: readonly D1Execution[]) {
  const payloadQueries = executions.filter((execution) => {
    const query = normalizeSql(execution.query);
    return (
      /\b(?:ai_runs|product_events|ops_events|llm_usage_daily_shards|ai_response_cache|app_metadata|topics)\b/.test(query) ||
      /^(?:insert into|delete from) admin_users\b/.test(query)
    );
  });
  assert.deepEqual(payloadQueries, []);
}

function normalizeSql(query: string) {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stateContext(): StateApiExecutionContext {
  return { waitUntil() {} };
}

function protectedContext(): ProtectedApiExecutionContext {
  return { waitUntil() {} };
}

function unavailableBinding(name: string): never {
  throw new Error(`Authorization test unexpectedly accessed ${name}`);
}

type ValidationTestBindings = {
  versionId?: string;
  secret?: string;
  runId?: string;
  expiresAt?: string;
};

class AuthorizationTestCloudflareEnv implements CloudflareEnv {
  readonly AUTH_SECRET = AUTH_SECRET;
  readonly ADMIN_EMAILS = "";
  readonly APP_WRITE_FREEZE = "";

  constructor(
    readonly DB: TracingD1Database,
    private readonly validation?: ValidationTestBindings,
  ) {}

  get E2E_TEST_AUTH_SECRET() { return this.validation?.secret; }
  get E2E_TEST_MUTATION_RUN_ID() { return this.validation?.runId; }
  get E2E_TEST_AUTH_EXPIRES_AT() { return this.validation?.expiresAt; }

  get ASSETS(): CloudflareEnv["ASSETS"] { return unavailableBinding("ASSETS"); }
  get CF_VERSION_METADATA(): CloudflareEnv["CF_VERSION_METADATA"] {
    return this.validation?.versionId
      ? {
          id: this.validation.versionId,
          tag: "validation-test",
          timestamp: "1970-01-01T00:00:00.000Z",
        }
      : unavailableBinding("CF_VERSION_METADATA");
  }
  get MEMORY_VECTORIZE(): CloudflareEnv["MEMORY_VECTORIZE"] { return unavailableBinding("MEMORY_VECTORIZE"); }
  get MEMORY_POST_TURN_QUEUE(): CloudflareEnv["MEMORY_POST_TURN_QUEUE"] { return unavailableBinding("MEMORY_POST_TURN_QUEUE"); }
  get NEXT_CACHE_DO_QUEUE(): CloudflareEnv["NEXT_CACHE_DO_QUEUE"] { return unavailableBinding("NEXT_CACHE_DO_QUEUE"); }
  get PROFILE_IMAGES_R2_BUCKET(): CloudflareEnv["PROFILE_IMAGES_R2_BUCKET"] { return unavailableBinding("PROFILE_IMAGES_R2_BUCKET"); }
  get WORKER_SELF_REFERENCE(): CloudflareEnv["WORKER_SELF_REFERENCE"] { return unavailableBinding("WORKER_SELF_REFERENCE"); }
  get APP_URL(): string { return unavailableBinding("APP_URL"); }
  get AUTH_URL(): string { return unavailableBinding("AUTH_URL"); }
  get BETTER_AUTH_URL(): string { return unavailableBinding("BETTER_AUTH_URL"); }
  get CLOUDFLARE_AI_GATEWAY_BASE_URL(): string { return unavailableBinding("CLOUDFLARE_AI_GATEWAY_BASE_URL"); }
  get CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS(): string { return unavailableBinding("CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS"); }
  get OPENAI_MODEL(): string { return unavailableBinding("OPENAI_MODEL"); }
  get OPENAI_FAST_MODEL(): string { return unavailableBinding("OPENAI_FAST_MODEL"); }
  get OPENAI_REASONING_MODEL(): string { return unavailableBinding("OPENAI_REASONING_MODEL"); }
  get OPENAI_STRUCTURED_MODEL(): string { return unavailableBinding("OPENAI_STRUCTURED_MODEL"); }
  get OPENAI_EMBEDDING_MODEL(): string { return unavailableBinding("OPENAI_EMBEDDING_MODEL"); }
  get RATE_LIMIT_USER_CHAT_DAILY(): string { return unavailableBinding("RATE_LIMIT_USER_CHAT_DAILY"); }
  get RATE_LIMIT_GUEST_SESSION_DAILY(): string { return unavailableBinding("RATE_LIMIT_GUEST_SESSION_DAILY"); }
  get RATE_LIMIT_GUEST_FINGERPRINT_DAILY(): string { return unavailableBinding("RATE_LIMIT_GUEST_FINGERPRINT_DAILY"); }
  get RATE_LIMIT_GUEST_IP_DAILY(): string { return unavailableBinding("RATE_LIMIT_GUEST_IP_DAILY"); }
  get RATE_LIMIT_ACTIVITY_DAILY(): string { return unavailableBinding("RATE_LIMIT_ACTIVITY_DAILY"); }
  get RATE_LIMIT_MEMORY_DAILY(): string { return unavailableBinding("RATE_LIMIT_MEMORY_DAILY"); }
  get LLM_GLOBAL_DAILY_CALL_LIMIT(): string { return unavailableBinding("LLM_GLOBAL_DAILY_CALL_LIMIT"); }
  get MEMORY_POST_TURN_SYNTHESIS_THRESHOLD(): string { return unavailableBinding("MEMORY_POST_TURN_SYNTHESIS_THRESHOLD"); }
  get MEMORY_PROFILE_COMPILE_LIMIT(): string { return unavailableBinding("MEMORY_PROFILE_COMPILE_LIMIT"); }
  get OBSERVABILITY_INCIDENT_MODE(): string { return unavailableBinding("OBSERVABILITY_INCIDENT_MODE"); }
  get APP_WRITE_FREEZE_RETRY_AFTER_SECONDS(): string { return unavailableBinding("APP_WRITE_FREEZE_RETRY_AFTER_SECONDS"); }
  get CLOUDFLARE_AI_GATEWAY_TOKEN(): string { return unavailableBinding("CLOUDFLARE_AI_GATEWAY_TOKEN"); }
  get AUTH_GOOGLE_ID(): string { return unavailableBinding("AUTH_GOOGLE_ID"); }
  get AUTH_GOOGLE_SECRET(): string { return unavailableBinding("AUTH_GOOGLE_SECRET"); }
  get CRON_SECRET(): string { return unavailableBinding("CRON_SECRET"); }
}

class TracingD1Database implements D1Database {
  readonly executions: D1Execution[] = [];

  constructor(private readonly inner: D1Database) {}

  prepare(query: string) {
    return new TracingD1Statement(this.inner.prepare(query), query, this.executions);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    const traced = requireTracingStatements(statements);
    for (const statement of traced) statement.record("batch");
    return this.inner.batch<T>(traced.map((statement) => statement.innerStatement));
  }

  exec(query: string) {
    this.executions.push({ query, bindings: [], method: "exec" });
    return this.inner.exec(query);
  }

  withSession(constraintOrBookmark?: D1SessionBookmark | D1SessionConstraint) {
    return new TracingD1Session(this.inner.withSession(constraintOrBookmark), this.executions);
  }

  dump() {
    return this.inner.dump();
  }

  clearExecutions() {
    this.executions.length = 0;
  }
}

class TracingD1Session implements D1DatabaseSession {
  constructor(
    private readonly inner: D1DatabaseSession,
    private readonly executions: D1Execution[],
  ) {}

  prepare(query: string) {
    return new TracingD1Statement(this.inner.prepare(query), query, this.executions);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    const traced = requireTracingStatements(statements);
    for (const statement of traced) statement.record("batch");
    return this.inner.batch<T>(traced.map((statement) => statement.innerStatement));
  }

  getBookmark() {
    return this.inner.getBookmark();
  }
}

class TracingD1Statement implements D1PreparedStatement {
  private bindings: readonly unknown[] = [];

  constructor(
    private inner: D1PreparedStatement,
    readonly query: string,
    private readonly executions: D1Execution[],
  ) {}

  get innerStatement() {
    return this.inner;
  }

  bind(...values: unknown[]) {
    this.bindings = [...values];
    this.inner = this.inner.bind(...values);
    return this;
  }

  first<T = unknown>(colName: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  first<T = unknown>(colName?: string) {
    this.record("first");
    return colName === undefined ? this.inner.first<T>() : this.inner.first<T>(colName);
  }

  run<T = Record<string, unknown>>() {
    this.record("run");
    return this.inner.run<T>();
  }

  all<T = Record<string, unknown>>() {
    this.record("all");
    return this.inner.all<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }) {
    this.record("raw");
    return options?.columnNames
      ? this.inner.raw<T>({ columnNames: true })
      : this.inner.raw<T>();
  }

  record(method: D1ExecutionMethod) {
    this.executions.push({ query: this.query, bindings: [...this.bindings], method });
  }
}

function requireTracingStatements(statements: readonly D1PreparedStatement[]) {
  const traced: TracingD1Statement[] = [];
  for (const statement of statements) {
    if (!(statement instanceof TracingD1Statement)) {
      throw new Error("Authorization test received an untraced D1 statement");
    }
    traced.push(statement);
  }
  return traced;
}

const AUTHORIZATION_SCHEMA_SQL = `
create table users (
  id text primary key,
  name text,
  email text not null unique,
  email_verified integer not null,
  image text,
  created_at integer not null,
  updated_at integer not null
);
create table sessions (
  id text primary key,
  session_token text not null unique,
  user_id text not null,
  expires integer not null,
  created_at integer not null,
  updated_at integer not null,
  ip_address text,
  user_agent text
);
create table admin_users (
  email text primary key,
  added_by_user_id text,
  added_by_email text,
  created_at integer not null
);
create table verification_tokens (
  id text primary key,
  identifier text not null,
  token text not null,
  expires integer not null,
  created_at integer not null,
  updated_at integer not null
);
create table ops_events (
  id text primary key,
  event_name text not null,
  severity text not null,
  surface text,
  user_id text,
  message text,
  metadata text,
  created_at integer not null
);
create table topics (
  id text primary key,
  slug text not null unique,
  name text not null,
  sub_text text,
  description text,
  inputbox_text text,
  system_prompt text,
  icon_url text,
  sort_order integer not null,
  status text not null,
  metadata text,
  created_at integer not null,
  updated_at integer not null
);
create table chats (
  id text primary key,
  user_id text not null,
  user_email_snapshot text,
  topic_id text,
  topic_name_snapshot text,
  title text,
  is_archived integer not null,
  created_at integer not null,
  updated_at integer not null
);
create table messages (
  id text primary key,
  chat_id text not null,
  role text not null,
  content text not null,
  metadata text,
  created_at integer not null
);
create table activity_runs (
  id text primary key,
  chat_id text not null,
  type text not null,
  status text not null,
  state text,
  score integer,
  max_score integer,
  created_at integer not null,
  updated_at integer not null,
  completed_at integer
);
create table ai_runs (
  id text primary key,
  chat_id text not null,
  assistant_message_id text,
  memory_context text
);
create table user_memories (
  id text primary key,
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
`;
