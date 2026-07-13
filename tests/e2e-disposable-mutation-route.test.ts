import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  E2E_DISPOSABLE_MUTATION_INVENTORY_SQL,
  E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES,
  handleMigrationE2EAuthRequest,
  type E2EDisposableMutationInventory,
  type MigrationE2EAuthEnv,
} from "../lib/free-runtime/account-api";

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
  assert.equal(cleanedBody.ok, true);
  assert.equal(cleanedBody.runtimeVersionId, "33333333-3333-4333-8333-333333333333");
  assert.deepEqual(cleanedBody.after, emptyInventory());
  assert.deepEqual(database.inventory, emptyInventory());
  assert.ok(database.cleanupQueries.length > 15);
  assert.ok(database.cleanupQueries.every((query) => /\bwhere\b/i.test(query)));
  assert.ok(
    database.cleanupQueries.slice(0, -1).every((query) => /verification_tokens/i.test(query)),
  );
  assert.match(database.cleanupQueries.at(-1) ?? "", /^delete from verification_tokens/);
  assert.ok(database.cleanupBindings.every((values) => !values.includes("historical-user-id")));

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
  assert.equal(database.inventory.sessions, 1);
  assert.equal(database.inventory.verification_tokens, 1);
  assert.ok(database.cleanupMarkerPresent);
  assert.ok(
    database.cleanupQueries.every((query) => !/^delete from memory_vector_cleanup_outbox\b/i.test(query)),
  );

  // Only the runtime Vectorize drain may remove this operational row after
  // its delayed absence checks. The hidden account route can then finalize
  // the still-authenticated deterministic identity on an exact retry.
  database.inventory.memory_vector_cleanup_outbox = 0;
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

test("inventory names cover every learner-owned native mutation table and pointer class", () => {
  assert.deepEqual([...E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES], [
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
    "memory_vector_cleanup_outbox",
  ]);
  assert.match(
    E2E_DISPOSABLE_MUTATION_INVENTORY_SQL,
    /from memory_vector_cleanup_outbox where owner_user_id = \?1/,
  );
  assert.doesNotMatch(
    E2E_DISPOSABLE_MUTATION_INVENTORY_SQL,
    /from memory_vector_cleanup_outbox(?! where owner_user_id = \?1)/,
  );
});

function mutationRequest(
  action: "create-disposable" | "cleanup-disposable" | "verify-disposable-cleanup",
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

class DisposableD1Database implements D1Database {
  readonly inventory = emptyInventory();
  readonly cleanupQueries: string[] = [];
  readonly cleanupBindings: unknown[][] = [];
  createBatches = 0;
  cleanupBatches = 0;
  leavePartialCleanup = false;
  cleanupMarkerPresent = false;
  disposableUserName: string | null = null;
  createdSessionExpiresAt: number | null = null;
  createdMarkerExpiresAt: number | null = null;

  constructor(initial: Partial<E2EDisposableMutationInventory> = {}) {
    Object.assign(this.inventory, initial);
  }

  prepare(query: string) {
    return new DisposableD1Statement(query, this);
  }

  renameDisposableUser(name: string) {
    assert.equal(this.inventory.users, 1);
    this.disposableUserName = name;
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]) {
    const typed = statements.filter(
      (statement): statement is DisposableD1Statement => statement instanceof DisposableD1Statement,
    );
    assert.equal(typed.length, statements.length);
    if (typed[0]?.query.includes("insert into users")) {
      this.createBatches += 1;
      if (this.inventory.users !== 0) throw new Error("simulated uniqueness collision");
      this.inventory.users = 1;
      this.inventory.user_memory_settings = 1;
      this.inventory.sessions = 1;
      this.inventory.verification_tokens = 1;
      this.cleanupMarkerPresent = true;
      this.disposableUserName = "Inspir mutation validation";
      const sessionExpiresAt = typed[2]?.boundValues[3];
      const markerExpiresAt = typed[3]?.boundValues[3];
      if (typeof sessionExpiresAt !== "number" || typeof markerExpiresAt !== "number") {
        throw new Error("Disposable session expiry fixture binding is invalid.");
      }
      this.createdSessionExpiresAt = sessionExpiresAt;
      this.createdMarkerExpiresAt = markerExpiresAt;
      const user = {
        id: requiredString(typed[0].boundValues[0]),
        name: "Inspir mutation validation",
        email: requiredString(typed[0].boundValues[1]),
        image: null,
      };
      return typed.map((_, index) => d1Result<T>(index === 0 ? [user] : []));
    }

    this.cleanupBatches += 1;
    for (const statement of typed) {
      this.cleanupQueries.push(statement.query);
      this.cleanupBindings.push(statement.boundValues);
    }
    const usersBefore = this.inventory.users;
    const profilePointersBefore = this.inventory.profile_photo_pointers;
    const userDelete = typed.find((statement) => /^delete from users\b/i.test(statement.query));
    const userDeleteMatches = Boolean(userDelete) && (
      !userDelete?.query.includes("name = 'Inspir mutation validation'") ||
      this.disposableUserName === "Inspir mutation validation"
    );
    if (userDelete) {
      this.inventory.accounts = 0;
      this.inventory.sessions = 0;
      this.inventory.verification_tokens = 0;
    } else {
      for (const name of E2E_DISPOSABLE_MUTATION_INVENTORY_NAMES) {
        if (this.leavePartialCleanup && name === "ai_runs") continue;
        if (
          name === "users" ||
          name === "profile_photo_pointers" ||
          name === "accounts" ||
          name === "sessions" ||
          name === "verification_tokens" ||
          name === "memory_vector_cleanup_outbox"
        ) continue;
        this.inventory[name] = 0;
      }
    }
    if (userDeleteMatches) {
      this.inventory.users = 0;
      this.inventory.profile_photo_pointers = 0;
      this.disposableUserName = null;
    } else {
      this.inventory.users = usersBefore;
      this.inventory.profile_photo_pointers = profilePointersBefore;
    }
    this.cleanupMarkerPresent = this.inventory.verification_tokens === 1;
    return typed.map(() => d1Result<T>());
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
      };
    }
    return null;
  }

  async run<T = Record<string, unknown>>() {
    return d1Result<T>();
  }

  async all<T = Record<string, unknown>>() {
    return d1Result<T>();
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }) {
    if (options?.columnNames) return [[]] as [string[], ...T[]];
    return [];
  }
}

function d1Result<T>(results: unknown[] = []): D1Result<T> {
  return {
    success: true,
    meta: {
      served_by: "disposable-route-test",
      duration: 0,
      changes: 1,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
