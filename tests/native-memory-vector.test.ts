import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_NATIVE_MEMORY_VECTOR_INPUTS,
  NATIVE_MEMORY_VECTOR_DIMENSIONS,
  NATIVE_MEMORY_VECTOR_MINIMUM_SIMILARITY,
  nativeMemoryVectorId,
  nativeMemoryVectorRevision,
  parseNativeMemoryVectorId,
  queryNativeMemoryVectorIds,
  upsertNativeMemoryVectors,
  type NativeMemoryVectorEnv,
} from "../lib/free-runtime/native-memory-vector";

const gatewayBaseUrl =
  "https://gateway.ai.cloudflare.com/v1/account/inspir/openai";

test("native memory vector writes batch bounded 512-dimensional embeddings with indexed ownership metadata", async () => {
  const memoryRowId = "11111111-1111-4111-8111-111111111111";
  const memoryRowRevision = 1_783_915_200_000;
  const upserts: VectorizeVector[][] = [];
  const budget = budgetDatabase({ callCount: 1 });
  const index = {
    async query() {
      return { matches: [], count: 0 };
    },
    async upsert(vectors: VectorizeVector[]) {
      upserts.push(vectors);
      return { ids: vectors.map((vector) => vector.id), count: vectors.length };
    },
  } satisfies NonNullable<NativeMemoryVectorEnv["MEMORY_VECTORIZE"]>;
  const requestedBodies: unknown[] = [];
  const expectedVectorIds = await Promise.all([
    nativeMemoryVectorRevision("The learner prefers visual examples.")
      .then((revision) => nativeMemoryVectorId(
        "user_memories",
        memoryRowId,
        revision,
        { rowRevision: memoryRowRevision },
      )),
    nativeMemoryVectorRevision("How can I revise fractions? Use retrieval practice.")
      .then((revision) => nativeMemoryVectorId("chat_memory_turns", "turn-1", revision)),
  ]);

  await withEmbeddingFetch(async (_input, init) => {
    const body = parseRequestBody(init?.body);
    requestedBodies.push(body);
    const inputs = isRecord(body) && Array.isArray(body.input) ? body.input : [];
    return Response.json({
      data: inputs.map((_value, indexPosition) => ({
        index: indexPosition,
        embedding: embedding(indexPosition + 1),
      })),
    });
  }, async () => {
    const indexed = await upsertNativeMemoryVectors(
      vectorEnv(budget.db, index),
      [
        {
          namespace: "user_memories",
          rowId: memoryRowId,
          userId: "user-1",
          text: "The learner prefers visual examples.",
          rowRevision: memoryRowRevision,
          chatId: "chat-1",
          topicId: "topic-1",
        },
        {
          namespace: "chat_memory_turns",
          rowId: "turn-1",
          userId: "user-1",
          text: "How can I revise fractions? Use retrieval practice.",
          chatId: "chat-2",
          topicId: "topic-2",
        },
      ],
    );

    assert.equal(indexed?.length, 2);
    assert.deepEqual(indexed?.map((entry) => entry.record.rowId), [memoryRowId, "turn-1"]);
    assert.equal(indexed?.some((entry) => "embedding" in entry), false);
  });

  assert.equal(budget.bindings.length, 1);
  assert.equal(upserts.length, 1);
  assert.equal(
    upserts[0]?.every((vector) => vector.values.length === NATIVE_MEMORY_VECTOR_DIMENSIONS),
    true,
  );
  assert.deepEqual(upserts[0]?.map((vector) => vector.id), expectedVectorIds);
  assert.equal(expectedVectorIds.every((vectorId) => (vectorId?.length ?? 65) <= 64), true);
  assert.deepEqual(upserts[0]?.map((vector) => vector.namespace), [
    "user_memories",
    "chat_memory_turns",
  ]);
  assert.equal(upserts[0]?.[0]?.metadata?.userId, "user-1");
  assert.equal(upserts[0]?.[0]?.metadata?.chatId, "chat-1");
  assert.equal(upserts[0]?.[0]?.metadata?.topicId, "topic-1");
  const request = requestedBodies[0];
  assert.ok(isRecord(request));
  assert.equal(request.dimensions, 512);
  assert.equal(request.model, "text-embedding-3-small");
  assert.ok(Array.isArray(request.input));
  assert.equal(request.input.length, 2);
});

test("native memory vector queries pre-filter both namespaces by user and return only bounded row IDs", async () => {
  const queries: VectorizeQueryOptions[] = [];
  const budget = budgetDatabase({ callCount: 9 });
  const index = {
    async query(_vector: VectorFloatArray | number[], options?: VectorizeQueryOptions) {
      queries.push(options ?? {});
      if (options?.namespace === "user_memories") {
        return {
          matches: [
            vectorMatch("m:memory-2:0123456789abcdef", 0.94),
            vectorMatch("chat_memory_turns:wrong-prefix", 0.92),
            vectorMatch("m:memory-2:0123456789abcdef", 0.90),
            vectorMatch("user_memories:memory-3", 0.89),
            vectorMatch(
              "user_memories:below-threshold",
              NATIVE_MEMORY_VECTOR_MINIMUM_SIMILARITY - 0.01,
            ),
          ],
          count: 4,
        };
      }
      return {
        matches: [
          vectorMatch("t:turn-7:fedcba9876543210", 0.91),
          vectorMatch("user_memories:wrong-prefix", 0.88),
        ],
        count: 2,
      };
    },
    async upsert(vectors: VectorizeVector[]) {
      return { ids: vectors.map((vector) => vector.id), count: vectors.length };
    },
  } satisfies NonNullable<NativeMemoryVectorEnv["MEMORY_VECTORIZE"]>;

  const matches = await withEmbeddingFetch(
    async () => Response.json({ data: [{ index: 0, embedding: embedding(7) }] }),
    () => queryNativeMemoryVectorIds(vectorEnv(budget.db, index), {
      userId: "user-1",
      message: "What did we discuss about fraction revision?",
    }),
  );

  assert.deepEqual(matches, {
    memoryMatches: [
      {
        rowId: "memory-2",
        vectorId: "m:memory-2:0123456789abcdef",
        marker: "m:memory-2:0123456789abcdef",
        score: 0.94,
      },
      {
        rowId: "memory-3",
        vectorId: "user_memories:memory-3",
        marker: "vectorize:512:v1",
        score: 0.89,
      },
    ],
    turnMatches: [{
      rowId: "turn-7",
      vectorId: "t:turn-7:fedcba9876543210",
      marker: "t:turn-7:fedcba9876543210",
      score: 0.91,
    }],
  });
  assert.equal(budget.bindings.length, 1);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.equal(query.topK, 20);
    assert.equal(query.returnMetadata, "none");
    assert.deepEqual(query.filter, { userId: "user-1" });
  }
  assert.deepEqual(queries.map((query) => query.namespace), [
    "user_memories",
    "chat_memory_turns",
  ]);
});

test("revisioned vector IDs retain 64-bit content identity within Vectorize limits", async () => {
  const rowId = "44444444-4444-4444-8444-444444444444";
  const rowRevision = 1_783_915_200_000;
  const revision = await nativeMemoryVectorRevision("A revision-bound memory value.");
  const turnId = nativeMemoryVectorId("chat_memory_turns", rowId, revision);
  const historicalMemoryId = nativeMemoryVectorId("user_memories", rowId, revision);
  const memoryId = nativeMemoryVectorId(
    "user_memories",
    rowId,
    revision,
    { rowRevision },
  );
  assert.equal(revision.length, 16);
  assert.equal(turnId, `t:${rowId}:${revision}`);
  assert.equal(historicalMemoryId, `m:${rowId}:${revision}`);
  assert.equal(
    memoryId,
    `m:${rowId.replaceAll("-", "")}:${rowRevision.toString(36)}:${revision}`,
  );
  assert.ok(turnId && new TextEncoder().encode(turnId).byteLength <= 64);
  assert.deepEqual(parseNativeMemoryVectorId("chat_memory_turns", turnId), {
    rowId,
    marker: turnId,
  });
  assert.equal(parseNativeMemoryVectorId("user_memories", turnId), null);
  assert.deepEqual(parseNativeMemoryVectorId("user_memories", memoryId ?? ""), {
    rowId,
    rowRevision,
    marker: memoryId,
  });
  assert.deepEqual(
    parseNativeMemoryVectorId("chat_memory_turns", `chat_memory_turns:${rowId}`),
    { rowId, marker: "vectorize:512:v1" },
  );
});

test("mutable memory A to B to A revisions never reuse an exact Vectorize identity", async () => {
  const rowId = "77777777-7777-4777-8777-777777777777";
  const revisionA = await nativeMemoryVectorRevision("I prefer visual examples.");
  const revisionB = await nativeMemoryVectorRevision("I prefer concise written examples.");
  const firstA = nativeMemoryVectorId("user_memories", rowId, revisionA, { rowRevision: 100 });
  const middleB = nativeMemoryVectorId("user_memories", rowId, revisionB, { rowRevision: 101 });
  const secondA = nativeMemoryVectorId("user_memories", rowId, revisionA, { rowRevision: 102 });

  assert.ok(firstA);
  assert.ok(middleB);
  assert.ok(secondA);
  assert.equal(new Set([firstA, middleB, secondA]).size, 3);
  assert.notEqual(firstA, secondA);
  assert.deepEqual(parseNativeMemoryVectorId("user_memories", secondA), {
    rowId,
    rowRevision: 102,
    marker: secondA,
  });
});

test("native memory vector writes reserve exactly once and cap each provider batch", async () => {
  const upserts: VectorizeVector[][] = [];
  const budget = budgetDatabase({ callCount: 1 });
  const index = {
    async query() {
      return { matches: [], count: 0 };
    },
    async upsert(vectors: VectorizeVector[]) {
      upserts.push(vectors);
      return { ids: vectors.map((vector) => vector.id), count: vectors.length };
    },
  } satisfies NonNullable<NativeMemoryVectorEnv["MEMORY_VECTORIZE"]>;
  let providerInputCount = 0;

  await withEmbeddingFetch(async (_input, init) => {
    const body = parseRequestBody(init?.body);
    const inputs = isRecord(body) && Array.isArray(body.input) ? body.input : [];
    providerInputCount = inputs.length;
    return Response.json({
      data: inputs.map((_value, indexPosition) => ({
        index: indexPosition,
        embedding: embedding(indexPosition + 1),
      })),
    });
  }, () => upsertNativeMemoryVectors(
    vectorEnv(budget.db, index),
    Array.from({ length: MAX_NATIVE_MEMORY_VECTOR_INPUTS + 3 }, (_, indexPosition) => ({
      namespace: "user_memories" as const,
      rowId: `00000000-0000-4000-8000-${String(indexPosition).padStart(12, "0")}`,
      userId: "user-1",
      text: `Bounded memory candidate ${indexPosition}`,
      rowRevision: 1_000 + indexPosition,
    })),
  ));

  assert.equal(budget.bindings.length, 1);
  assert.equal(providerInputCount, MAX_NATIVE_MEMORY_VECTOR_INPUTS);
  assert.equal(upserts[0]?.length, MAX_NATIVE_MEMORY_VECTOR_INPUTS);
});

test("configured zero embedding budget performs no D1 reservation, fetch, or Vectorize work", async () => {
  let fetched = false;
  let queried = false;
  const budget = budgetDatabase({ callCount: 1 });
  const index = {
    async query() {
      queried = true;
      return { matches: [], count: 0 };
    },
    async upsert(vectors: VectorizeVector[]) {
      return { ids: vectors.map((vector) => vector.id), count: vectors.length };
    },
  } satisfies NonNullable<NativeMemoryVectorEnv["MEMORY_VECTORIZE"]>;
  const env = { ...vectorEnv(budget.db, index), LLM_GLOBAL_DAILY_CALL_LIMIT: "0" };

  const result = await withEmbeddingFetch(async () => {
    fetched = true;
    return Response.json({ data: [{ index: 0, embedding: embedding(1) }] });
  }, () => queryNativeMemoryVectorIds(env, {
    userId: "user-1",
    message: "Recall my revision plan.",
  }));

  assert.equal(result, null);
  assert.equal(budget.bindings.length, 0);
  assert.equal(fetched, false);
  assert.equal(queried, false);
});

test("malformed embedding budgets fail closed before D1, fetch, or Vectorize work", async () => {
  for (const limit of ["", "   ", "not-a-limit", "-1", "1.5", "1e3", "9007199254740992"]) {
    let fetched = false;
    let queried = false;
    const budget = budgetDatabase({ callCount: 1 });
    const index = {
      async query() {
        queried = true;
        return { matches: [], count: 0 };
      },
      async upsert(vectors: VectorizeVector[]) {
        return { ids: vectors.map((vector) => vector.id), count: vectors.length };
      },
    } satisfies NonNullable<NativeMemoryVectorEnv["MEMORY_VECTORIZE"]>;
    const env = {
      ...vectorEnv(budget.db, index),
      LLM_GLOBAL_DAILY_CALL_LIMIT: limit,
    };

    const result = await withEmbeddingFetch(async () => {
      fetched = true;
      return Response.json({ data: [{ index: 0, embedding: embedding(1) }] });
    }, () => queryNativeMemoryVectorIds(env, {
      userId: "user-1",
      message: "Recall my revision plan.",
    }));

    assert.equal(result, null, limit);
    assert.equal(budget.bindings.length, 0, limit);
    assert.equal(fetched, false, limit);
    assert.equal(queried, false, limit);
  }
});

test("embedding spend fails closed before fetch or Vectorize when the shared budget cannot be verified", async () => {
  let fetched = false;
  let queried = false;
  const budget = budgetDatabase(new Error("D1 unavailable"));
  const index = {
    async query() {
      queried = true;
      return { matches: [], count: 0 };
    },
    async upsert(vectors: VectorizeVector[]) {
      return { ids: vectors.map((vector) => vector.id), count: vectors.length };
    },
  } satisfies NonNullable<NativeMemoryVectorEnv["MEMORY_VECTORIZE"]>;

  const result = await withEmbeddingFetch(async () => {
    fetched = true;
    return Response.json({ data: [{ index: 0, embedding: embedding(1) }] });
  }, () => queryNativeMemoryVectorIds(vectorEnv(budget.db, index), {
    userId: "user-1",
    message: "Remember my revision goal.",
  }));

  assert.equal(result, null);
  assert.equal(fetched, false);
  assert.equal(queried, false);
});

test("malformed provider vectors never reach Vectorize", async () => {
  let upserted = false;
  const budget = budgetDatabase({ callCount: 2 });
  const index = {
    async query() {
      return { matches: [], count: 0 };
    },
    async upsert(vectors: VectorizeVector[]) {
      upserted = true;
      return { ids: vectors.map((vector) => vector.id), count: vectors.length };
    },
  } satisfies NonNullable<NativeMemoryVectorEnv["MEMORY_VECTORIZE"]>;

  const result = await withEmbeddingFetch(
    async () => Response.json({ data: [{ index: 0, embedding: [1, 2, 3] }] }),
    () => upsertNativeMemoryVectors(vectorEnv(budget.db, index), [{
      namespace: "user_memories",
      rowId: "66666666-6666-4666-8666-666666666666",
      userId: "user-1",
      text: "A durable fact about the learner.",
      rowRevision: 200,
    }]),
  );

  assert.equal(result, null);
  assert.equal(upserted, false);
});

function vectorEnv(
  db: NativeMemoryVectorEnv["DB"],
  index: NonNullable<NativeMemoryVectorEnv["MEMORY_VECTORIZE"]>,
): NativeMemoryVectorEnv {
  return {
    DB: db,
    MEMORY_VECTORIZE: index,
    CLOUDFLARE_AI_GATEWAY_BASE_URL: gatewayBaseUrl,
    CLOUDFLARE_AI_GATEWAY_TOKEN: "gateway-token",
    CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS: "inspir",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
    LLM_GLOBAL_DAILY_CALL_LIMIT: "1000",
  };
}

function budgetDatabase(result: Record<string, unknown> | Error) {
  const bindings: unknown[][] = [];
  const db: NativeMemoryVectorEnv["DB"] = {
    prepare(query: string) {
      assert.match(query, /llm_usage_daily_shards/);
      return {
        bind(...values: unknown[]) {
          bindings.push(values);
          return this;
        },
        async first() {
          if (result instanceof Error) throw result;
          return result;
        },
      };
    },
  };
  return { db, bindings };
}

async function withEmbeddingFetch<T>(
  implementation: typeof fetch,
  run: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  return typeof body === "string" ? JSON.parse(body) : null;
}

function embedding(seed: number) {
  return Array.from(
    { length: NATIVE_MEMORY_VECTOR_DIMENSIONS },
    (_, index) => (seed + index) / 10_000,
  );
}

function vectorMatch(id: string, score: number): VectorizeMatch {
  return { id, score };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
