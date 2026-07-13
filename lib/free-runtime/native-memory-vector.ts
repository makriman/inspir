import { globalDailyCallLimitFromEnv } from "./global-ai-budget";

export const NATIVE_MEMORY_VECTOR_DIMENSIONS = 512;
export const MAX_NATIVE_MEMORY_VECTOR_INPUTS = 4;
export const MAX_NATIVE_MEMORY_VECTOR_TEXT_CHARS = 4_000;
export const NATIVE_MEMORY_VECTOR_MINIMUM_SIMILARITY = 0.72;
export const NATIVE_MEMORY_VECTOR_MARKER = "vectorize:512:v1";
export const NATIVE_MEMORY_VECTOR_REVISION_HEX_CHARS = 16;

const cloudflareGatewayHost = "gateway.ai.cloudflare.com";
const maxEmbeddingResponseBytes = 256 * 1_024;
const maxVectorIdBytes = 64;

const reserveGlobalProviderCallSql = `insert into llm_usage_daily_shards (day, shard, call_count, created_at, updated_at)
select ?1, 0, 1, ?2, ?2
where coalesce((select sum(call_count) from llm_usage_daily_shards where day = ?1), 0) < ?3
on conflict (day, shard) do update
  set call_count = llm_usage_daily_shards.call_count + 1,
      updated_at = excluded.updated_at
where coalesce((select sum(call_count) from llm_usage_daily_shards where day = ?1), 0) < ?3
returning call_count as callCount`;

export type NativeMemoryVectorNamespace = "user_memories" | "chat_memory_turns";

export type NativeMemoryVectorRecord = {
  namespace: NativeMemoryVectorNamespace;
  rowId: string;
  userId: string;
  text: string;
  /** Required for mutable user-memory rows; ignored for immutable chat turns. */
  rowRevision?: number;
  chatId?: string | null;
  topicId?: string | null;
};

export type NativeIndexedMemoryVector = {
  record: NativeMemoryVectorRecord;
  vectorId: string;
  marker: string;
};

export type NativeMemoryVectorMatch = {
  rowId: string;
  vectorId: string;
  marker: string;
  rowRevision?: number;
  score: number;
};

export type NativeMemoryVectorMatches = {
  memoryMatches: NativeMemoryVectorMatch[];
  turnMatches: NativeMemoryVectorMatch[];
};

type NativeMemoryBudgetStatement = {
  bind(...values: unknown[]): NativeMemoryBudgetStatement;
  first(): Promise<Record<string, unknown> | null>;
};

type NativeMemoryBudgetDatabase = {
  prepare(query: string): NativeMemoryBudgetStatement;
};

export type NativeMemoryVectorEnv = {
  DB: NativeMemoryBudgetDatabase;
  MEMORY_VECTORIZE?: Pick<CloudflareEnv["MEMORY_VECTORIZE"], "query" | "upsert">;
  CLOUDFLARE_AI_GATEWAY_BASE_URL?: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
  CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS?: string;
  OPENAI_EMBEDDING_MODEL?: string;
  LLM_GLOBAL_DAILY_CALL_LIMIT?: string;
};

type EmbeddingProviderSettings = {
  endpoint: string;
  headers: Headers;
  model: string;
};

/**
 * Embeds and upserts a tiny, bounded batch. The paid provider call is made
 * only after the shared global daily budget has been reserved. Callers keep
 * D1 authoritative and treat a null result as a recoverable derivative-index
 * miss.
 */
export async function upsertNativeMemoryVectors(
  env: NativeMemoryVectorEnv,
  candidates: readonly NativeMemoryVectorRecord[],
): Promise<NativeIndexedMemoryVector[] | null> {
  const revisionedRecords = await prepareNativeMemoryVectors(candidates);
  return upsertPreparedNativeMemoryVectors(env, revisionedRecords);
}

export async function prepareNativeMemoryVectors(
  candidates: readonly NativeMemoryVectorRecord[],
) {
  const records = normalizeVectorRecords(candidates);
  return (
    await Promise.all(records.map(async (record) => {
      const revision = await nativeMemoryVectorRevision(record.text);
      const vectorId = nativeMemoryVectorId(
        record.namespace,
        record.rowId,
        revision,
        record.namespace === "user_memories"
          ? { rowRevision: record.rowRevision }
          : undefined,
      );
      return vectorId
        ? { record, vectorId, marker: vectorId }
        : null;
    }))
  ).filter((record): record is NonNullable<typeof record> => record !== null);
}

export async function upsertPreparedNativeMemoryVectors(
  env: NativeMemoryVectorEnv,
  revisionedRecords: readonly NativeIndexedMemoryVector[],
): Promise<NativeIndexedMemoryVector[] | null> {
  const index = env.MEMORY_VECTORIZE;
  const provider = embeddingProviderSettings(env);
  if (!index || !provider || revisionedRecords.length === 0) return null;
  if (!(await reserveGlobalProviderCall(env, "memory_vector_write"))) return null;

  try {
    const embeddings = await requestEmbeddingBatch(
      provider,
      revisionedRecords.map(({ record }) => record.text),
    );
    await index.upsert(
      revisionedRecords.map(({ record, vectorId }, indexPosition) => ({
        id: vectorId,
        namespace: record.namespace,
        values: embeddings[indexPosition] ?? [],
        metadata: {
          namespace: record.namespace,
          rowId: record.rowId,
          userId: record.userId,
          ...(record.chatId ? { chatId: record.chatId } : {}),
          ...(record.topicId ? { topicId: record.topicId } : {}),
        },
      })),
    );
    return [...revisionedRecords];
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "native_memory_vector_write_failed",
        count: revisionedRecords.length,
        error: errorName(error),
      }),
    );
    return null;
  }
}

/**
 * Queries the two historical memory namespaces with indexed user metadata.
 * D1 hydration must still re-check user ownership before any result reaches a
 * prompt; Vectorize metadata is only a pre-filter, never an authorization
 * boundary.
 */
export async function queryNativeMemoryVectorIds(
  env: NativeMemoryVectorEnv,
  input: {
    userId: string;
    message: string;
    includeMemories?: boolean;
    includeTurns?: boolean;
  },
): Promise<NativeMemoryVectorMatches | null> {
  const index = env.MEMORY_VECTORIZE;
  const provider = embeddingProviderSettings(env);
  const userId = boundedText(input.userId, 1, 120);
  const message = boundedText(input.message, 2, MAX_NATIVE_MEMORY_VECTOR_TEXT_CHARS);
  if (!index || !provider || !userId || !message) return null;
  if (!(await reserveGlobalProviderCall(env, "memory_vector_query"))) return null;

  try {
    const [embedding] = await requestEmbeddingBatch(provider, [message]);
    if (!embedding) throw new Error("Embedding response omitted the query vector");
    const [memoryMatches, turnMatches] = await Promise.all([
      input.includeMemories === false
        ? Promise.resolve({ matches: [], count: 0 })
        : index.query(embedding, {
            namespace: "user_memories",
            topK: 20,
            returnMetadata: "none",
            filter: { userId },
          }),
      input.includeTurns === false
        ? Promise.resolve({ matches: [], count: 0 })
        : index.query(embedding, {
            namespace: "chat_memory_turns",
            topK: 20,
            returnMetadata: "none",
            filter: { userId },
          }),
    ]);
    return {
      memoryMatches: vectorMatches("user_memories", memoryMatches.matches, 20),
      turnMatches: vectorMatches("chat_memory_turns", turnMatches.matches, 20),
    };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "native_memory_vector_query_failed",
        error: errorName(error),
      }),
    );
    return null;
  }
}

function normalizeVectorRecords(candidates: readonly NativeMemoryVectorRecord[]) {
  const records: NativeMemoryVectorRecord[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const rowId = boundedVectorRowId(candidate.rowId);
    const userId = boundedText(candidate.userId, 1, 120);
    const text = boundedText(candidate.text, 2, MAX_NATIVE_MEMORY_VECTOR_TEXT_CHARS);
    const rowRevision = candidate.namespace === "user_memories"
      ? positiveSafeInteger(candidate.rowRevision)
      : undefined;
    const chatId = optionalBoundedText(candidate.chatId, 120);
    const topicId = optionalBoundedText(candidate.topicId, 120);
    const identity = `${candidate.namespace}:${rowId ?? ""}`;
    if (
      !rowId ||
      !userId ||
      !text ||
      (candidate.namespace === "user_memories" && rowRevision === null) ||
      seen.has(identity)
    ) {
      continue;
    }
    seen.add(identity);
    records.push({
      namespace: candidate.namespace,
      rowId,
      userId,
      text,
      ...(rowRevision ? { rowRevision } : {}),
      ...(chatId ? { chatId } : {}),
      ...(topicId ? { topicId } : {}),
    });
    if (records.length >= MAX_NATIVE_MEMORY_VECTOR_INPUTS) break;
  }
  return records;
}

async function reserveGlobalProviderCall(
  env: Pick<NativeMemoryVectorEnv, "DB" | "LLM_GLOBAL_DAILY_CALL_LIMIT">,
  reason: "memory_vector_query" | "memory_vector_write",
) {
  const limit = globalDailyCallLimitFromEnv(env.LLM_GLOBAL_DAILY_CALL_LIMIT);
  if (limit <= 0) {
    console.error(
      JSON.stringify({ event: "llm_budget_denied", reason, posture: "fail_closed" }),
    );
    return false;
  }

  const now = new Date();
  const nowMs = now.getTime();
  try {
    const reservation = await env.DB.prepare(reserveGlobalProviderCallSql)
      .bind(now.toISOString().slice(0, 10), nowMs, limit)
      .first();
    if (reservation && positiveInteger(reservation.callCount) !== null) return true;
    console.error(
      JSON.stringify({ event: "llm_budget_denied", reason, posture: "fail_closed" }),
    );
    return false;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "llm_budget_check_failed",
        reason,
        posture: "fail_closed",
        error: errorName(error),
      }),
    );
    return false;
  }
}

async function requestEmbeddingBatch(
  provider: EmbeddingProviderSettings,
  values: readonly string[],
) {
  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: provider.headers,
    body: JSON.stringify({
      model: provider.model,
      input: values,
      dimensions: NATIVE_MEMORY_VECTOR_DIMENSIONS,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await cancelBody(response.body, "native_memory_embedding_upstream_rejected");
    throw new Error(`Embedding provider returned ${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    await cancelBody(response.body, "native_memory_embedding_invalid_content_type");
    throw new Error("Embedding provider did not return JSON");
  }
  const bytes = await readBoundedBody(response.body, maxEmbeddingResponseBytes);
  const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length !== values.length) {
    throw new Error("Embedding provider returned the wrong result count");
  }

  const embeddings: Array<number[] | undefined> = new Array(values.length);
  for (const candidate of payload.data) {
    if (!isRecord(candidate) || !integerInRange(candidate.index, 0, values.length - 1)) {
      throw new Error("Embedding provider returned an invalid result index");
    }
    if (embeddings[candidate.index]) {
      throw new Error("Embedding provider returned a duplicate result index");
    }
    if (
      !Array.isArray(candidate.embedding) ||
      candidate.embedding.length !== NATIVE_MEMORY_VECTOR_DIMENSIONS ||
      !candidate.embedding.every((value) => typeof value === "number" && Number.isFinite(value))
    ) {
      throw new Error("Embedding provider returned an invalid vector");
    }
    embeddings[candidate.index] = candidate.embedding;
  }
  if (embeddings.some((embedding) => !embedding)) {
    throw new Error("Embedding provider omitted a vector");
  }
  return embeddings.map((embedding) => embedding ?? []);
}

function embeddingProviderSettings(env: NativeMemoryVectorEnv): EmbeddingProviderSettings | null {
  const gatewayBaseUrl = nonEmpty(env.CLOUDFLARE_AI_GATEWAY_BASE_URL);
  const gatewayToken = nonEmpty(env.CLOUDFLARE_AI_GATEWAY_TOKEN);
  const byokAlias = nonEmpty(env.CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS);
  const model = nonEmpty(env.OPENAI_EMBEDDING_MODEL) ?? "text-embedding-3-small";
  if (!gatewayBaseUrl || !gatewayToken || !byokAlias) return null;
  const endpoint = embeddingEndpoint(gatewayBaseUrl);
  if (!endpoint) return null;
  try {
    return {
      endpoint,
      model,
      headers: new Headers({
        "cf-aig-authorization": `Bearer ${gatewayToken}`,
        "cf-aig-byok-alias": byokAlias,
        "cf-aig-collect-log-payload": "false",
        "content-type": "application/json",
        accept: "application/json",
      }),
    };
  } catch {
    return null;
  }
}

function embeddingEndpoint(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== cloudflareGatewayHost ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/embeddings`;
    return url.toString();
  } catch {
    return null;
  }
}

function vectorMatches(
  namespace: NativeMemoryVectorNamespace,
  matches: readonly VectorizeMatch[],
  limit: number,
) {
  const accepted: NativeMemoryVectorMatch[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const parsed = parseNativeMemoryVectorId(namespace, match.id);
    if (
      !parsed ||
      seen.has(match.id) ||
      !Number.isFinite(match.score) ||
      match.score < NATIVE_MEMORY_VECTOR_MINIMUM_SIMILARITY
    ) {
      continue;
    }
    seen.add(match.id);
    accepted.push({ ...parsed, vectorId: match.id, score: match.score });
    if (accepted.length >= limit) break;
  }
  return accepted;
}

export async function nativeMemoryVectorRevision(text: string) {
  const normalized = boundedText(text, 2, MAX_NATIVE_MEMORY_VECTOR_TEXT_CHARS);
  if (!normalized) throw new Error("Native memory vector revision input is invalid");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)),
  );
  return [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, NATIVE_MEMORY_VECTOR_REVISION_HEX_CHARS);
}

export function nativeMemoryVectorId(
  namespace: NativeMemoryVectorNamespace,
  rowId: string,
  revision?: string,
  options: { rowRevision?: number } = {},
) {
  const boundedRowId = boundedVectorRowId(rowId);
  const boundedRevision = revision && /^[0-9a-f]{16}$/.test(revision) ? revision : null;
  if (!boundedRowId || (revision !== undefined && !boundedRevision)) return null;
  const revisionedPrefix = namespace === "user_memories" ? "m" : "t";
  let vectorId = `${namespace}:${boundedRowId}`;
  if (boundedRevision && namespace === "chat_memory_turns") {
    vectorId = `${revisionedPrefix}:${boundedRowId}:${boundedRevision}`;
  } else if (boundedRevision && options.rowRevision === undefined) {
    // Historical content-only user-memory v2 identity. New writes always pass
    // rowRevision, but retaining this constructor keeps exact cleanup of
    // already-deployed v2 rows possible.
    vectorId = `${revisionedPrefix}:${boundedRowId}:${boundedRevision}`;
  } else if (boundedRevision) {
    const rowRevision = positiveSafeInteger(options.rowRevision);
    const compactRowId = compactUuid(boundedRowId);
    if (!rowRevision || !compactRowId) return null;
    vectorId = `${revisionedPrefix}:${compactRowId}:${rowRevision.toString(36)}:${boundedRevision}`;
  }
  return new TextEncoder().encode(vectorId).byteLength <= maxVectorIdBytes ? vectorId : null;
}

export function parseNativeMemoryVectorId(
  namespace: NativeMemoryVectorNamespace,
  vectorId: string,
): Pick<NativeMemoryVectorMatch, "rowId" | "marker" | "rowRevision"> | null {
  const revisionedPrefix = namespace === "user_memories" ? "m:" : "t:";
  if (vectorId.startsWith(revisionedPrefix)) {
    if (new TextEncoder().encode(vectorId).byteLength > maxVectorIdBytes) return null;
    const identity = vectorId.slice(revisionedPrefix.length);
    if (namespace === "user_memories") {
      const mutable = identity.match(/^([0-9a-fA-F]{32}):([0-9a-z]+):([0-9a-f]{16})$/);
      const rowId = mutable?.[1] ? expandCompactUuid(mutable[1]) : null;
      const rowRevision = mutable?.[2] ? base36SafeInteger(mutable[2]) : null;
      if (rowId && rowRevision) return { rowId, rowRevision, marker: vectorId };
    }
    const revisioned = identity.match(/^([a-zA-Z0-9._-]+):([0-9a-f]{16})$/);
    const rowId = revisioned?.[1] ? boundedVectorRowId(revisioned[1]) : null;
    return rowId ? { rowId, marker: vectorId } : null;
  }
  const prefix = `${namespace}:`;
  if (!vectorId.startsWith(prefix) || new TextEncoder().encode(vectorId).byteLength > maxVectorIdBytes) {
    return null;
  }
  const rowId = boundedVectorRowId(vectorId.slice(prefix.length));
  return rowId ? { rowId, marker: NATIVE_MEMORY_VECTOR_MARKER } : null;
}

export function nativeMemoryPendingVectorMarker(vectorId: string) {
  if (
    !parseNativeMemoryVectorId("user_memories", vectorId) &&
    !parseNativeMemoryVectorId("chat_memory_turns", vectorId)
  ) {
    return null;
  }
  return `p:${vectorId}`;
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!body) throw new Error("Embedding provider omitted its response body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("native_memory_embedding_response_too_large").catch(() => undefined);
        throw new Error("Embedding provider response exceeded its byte limit");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function cancelBody(body: ReadableStream<Uint8Array> | null, reason: string) {
  if (!body) return;
  await body.cancel(reason).catch(() => undefined);
}

function boundedVectorRowId(value: unknown) {
  const rowId = boundedText(value, 1, 120);
  return rowId && /^[a-zA-Z0-9._-]+$/.test(rowId) ? rowId : null;
}

function compactUuid(rowId: string) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(rowId)
    ? rowId.replaceAll("-", "")
    : null;
}

function expandCompactUuid(value: string) {
  const rowId = `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  return boundedVectorRowId(rowId);
}

function base36SafeInteger(value: string) {
  if (!/^[0-9a-z]{1,10}$/.test(value)) return null;
  const parsed = Number.parseInt(value, 36);
  return positiveSafeInteger(parsed)?.toString(36) === value ? parsed : null;
}

function optionalBoundedText(value: string | null | undefined, max: number) {
  if (value === undefined || value === null) return null;
  return boundedText(value, 1, max);
}

function boundedText(value: unknown, min: number, max: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= min && normalized.length <= max ? normalized : null;
}

function nonEmpty(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function positiveSafeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function integerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}
