import type { Topic } from "@/lib/db/schema";
import { d1First, d1Run } from "@/lib/db/client";
import { normalizeLanguage } from "@/lib/content/languages";
import { buildTopicSystemPrompt } from "@/lib/ai/prompts";
import { readRuntimeEnv } from "@/lib/runtime/cloudflare";
import { recordOpsEvent, recordProductEvent, type EventProperties } from "@/lib/observability/events";
import type { LearningFinishReason, LearningTokenUsage } from "@/lib/ai/streaming";

const responseCachePolicyVersion = "2026-07-public-starter-v1";
export const responseCacheScope = "guest-chat-public-starter";
const responseCacheSurface = "guest-chat";
const defaultResponseCacheTtlSeconds = 30 * 24 * 60 * 60;
const defaultMaxResponseCacheBytes = 120_000;

type CacheableTopic = Pick<Topic, "id" | "slug" | "name" | "systemPrompt" | "metadata">;

export type ResponseCacheRequest = {
  cacheKey: string;
  language: string;
  model: string;
  modelParams: Record<string, unknown>;
  promptHash: string;
  questionHash: string;
  scope: typeof responseCacheScope;
  surface: typeof responseCacheSurface;
  topicId: string;
  topicSlug: string;
};

export type CachedLearningResponse = {
  cacheKey: string;
  completionTokens: number | null;
  promptTokens: number | null;
  responseText: string;
  totalTokens: number | null;
};

export type CacheEventName =
  | "ai_cache_hit"
  | "ai_cache_miss"
  | "ai_cache_store"
  | "ai_cache_bypass"
  | "ai_cache_reject";

export function isGuestStarterCacheCandidate(messages: Array<unknown>) {
  return messages.length === 0;
}

export async function buildGuestStarterResponseCacheRequest(input: {
  content: string;
  model: string;
  modelParams: Record<string, unknown>;
  preferredLanguage?: string;
  topic: CacheableTopic;
}): Promise<ResponseCacheRequest> {
  const language = normalizeLanguage(input.preferredLanguage);
  const normalizedQuestion = normalizeCacheQuestion(input.content);
  const [promptHash, questionHash] = await Promise.all([
    sha256Hex(buildTopicSystemPrompt(input.topic, language)),
    sha256Hex(normalizedQuestion),
  ]);
  const keyPayload = {
    cacheVersion: responseCachePolicyVersion,
    language,
    model: input.model,
    modelParams: stablePlainObject(input.modelParams),
    promptHash,
    questionHash,
    scope: responseCacheScope,
    surface: responseCacheSurface,
    topicId: input.topic.id,
    topicSlug: input.topic.slug,
  };
  const cacheKey = await sha256Hex(stableStringify(keyPayload));
  return {
    cacheKey,
    language,
    model: input.model,
    modelParams: keyPayload.modelParams,
    promptHash,
    questionHash,
    scope: responseCacheScope,
    surface: responseCacheSurface,
    topicId: input.topic.id,
    topicSlug: input.topic.slug,
  };
}

export async function getCachedLearningResponse(
  request: Pick<ResponseCacheRequest, "cacheKey">,
  now = new Date(),
): Promise<CachedLearningResponse | null> {
  if (!responseCacheEnabled()) return null;
  try {
    const row = await d1First<{
      cacheKey: string;
      completionTokens: number | null;
      promptTokens: number | null;
      responseText: string;
      totalTokens: number | null;
    }>(
      `select
         cache_key as "cacheKey",
         response_text as "responseText",
         prompt_tokens as "promptTokens",
         completion_tokens as "completionTokens",
         total_tokens as "totalTokens"
       from ai_response_cache
       where cache_key = ?
         and status = 'active'
         and expires_at > ?
       limit 1`,
      request.cacheKey,
      now.getTime(),
    );
    if (!row?.responseText) return null;
    return row;
  } catch (error) {
    await recordCacheOpsFailure("ai_cache_read_failed", error, { cacheKeyPrefix: safeKeyPrefix(request.cacheKey) });
    return null;
  }
}

export async function recordCachedLearningResponseHit(cacheKey: string, now = new Date()) {
  try {
    await d1Run(
      `update ai_response_cache
       set hit_count = hit_count + 1,
           last_hit_at = ?,
           updated_at = ?
       where cache_key = ?`,
      now.getTime(),
      now.getTime(),
      cacheKey,
    );
  } catch (error) {
    await recordCacheOpsFailure("ai_cache_hit_record_failed", error, { cacheKeyPrefix: safeKeyPrefix(cacheKey) });
  }
}

export async function storeCachedLearningResponse(input: {
  request: ResponseCacheRequest;
  responseText: string;
  finishReason: LearningFinishReason;
  totalUsage: LearningTokenUsage | null;
  now?: Date;
}) {
  if (!responseCacheEnabled()) return { stored: false, reason: "disabled" };
  if (input.finishReason !== "stop") return { stored: false, reason: "finish_reason" };
  if (!input.responseText.trim()) return { stored: false, reason: "empty_response" };

  const responseBytes = new TextEncoder().encode(input.responseText).byteLength;
  const maxBytes = responseCacheMaxBytes();
  if (responseBytes > maxBytes) return { stored: false, reason: "response_too_large" };

  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + responseCacheTtlSeconds() * 1000);
  try {
    await d1Run(
      `insert into ai_response_cache (
         cache_key,
         scope,
         surface,
         topic_id,
         topic_slug,
         language,
         model,
         model_params,
         prompt_hash,
         question_hash,
         response_text,
         prompt_tokens,
         completion_tokens,
         total_tokens,
         cached_prompt_tokens,
         hit_count,
         expires_at,
         status,
         metadata,
         created_at,
         updated_at
       )
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, ?)
       on conflict(cache_key) do update set
         response_text = excluded.response_text,
         prompt_tokens = excluded.prompt_tokens,
         completion_tokens = excluded.completion_tokens,
         total_tokens = excluded.total_tokens,
         cached_prompt_tokens = excluded.cached_prompt_tokens,
         expires_at = excluded.expires_at,
         status = 'active',
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      input.request.cacheKey,
      input.request.scope,
      input.request.surface,
      input.request.topicId,
      input.request.topicSlug,
      input.request.language,
      input.request.model,
      JSON.stringify(input.request.modelParams),
      input.request.promptHash,
      input.request.questionHash,
      input.responseText,
      input.totalUsage?.inputTokens ?? null,
      input.totalUsage?.outputTokens ?? null,
      input.totalUsage?.totalTokens ?? null,
      input.totalUsage?.cachedInputTokens ?? null,
      expiresAt.getTime(),
      JSON.stringify({
        policyVersion: responseCachePolicyVersion,
        responseBytes,
        ttlSeconds: responseCacheTtlSeconds(),
      }),
      now.getTime(),
      now.getTime(),
    );
    return { stored: true, reason: "stored" };
  } catch (error) {
    await recordCacheOpsFailure("ai_cache_store_failed", error, {
      cacheKeyPrefix: safeKeyPrefix(input.request.cacheKey),
      topicSlug: input.request.topicSlug,
    });
    return { stored: false, reason: "store_failed" };
  }
}

export function cachedLearningResponseStream(text: string) {
  const chunks = chunkTextForReplay(text);
  let index = 0;
  return new ReadableStream<unknown>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk) {
        index += 1;
        controller.enqueue({ type: "text-delta", text: chunk });
        return;
      }
      controller.enqueue({
        type: "finish",
        finishReason: "stop",
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      });
      controller.close();
    },
  });
}

export function cacheDiagnosticHeaders(status: "hit" | "miss" | "bypass", reason: string) {
  return {
    "x-inspir-cache": status,
    "x-inspir-cache-reason": sanitizeHeaderValue(reason),
  };
}

export async function recordAiCacheProductEvent(input: {
  name: CacheEventName;
  properties?: EventProperties;
  route?: string | null;
  sessionId?: string | null;
}) {
  await recordProductEvent({
    name: input.name,
    route: input.route ?? "/api/guest-chat",
    sessionId: input.sessionId ?? null,
    properties: input.properties,
  });
}

export function responseCacheTtlSeconds() {
  return numberFromRuntimeEnv("AI_RESPONSE_CACHE_TTL_SECONDS", defaultResponseCacheTtlSeconds, {
    max: defaultResponseCacheTtlSeconds,
    min: 60,
  });
}

function responseCacheMaxBytes() {
  return numberFromRuntimeEnv("AI_RESPONSE_CACHE_MAX_RESPONSE_BYTES", defaultMaxResponseCacheBytes, {
    max: 900_000,
    min: 1024,
  });
}

function responseCacheEnabled() {
  return readRuntimeEnv("AI_RESPONSE_CACHE_ENABLED") !== "0";
}

function normalizeCacheQuestion(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .toLocaleLowerCase("en-US");
}

function stablePlainObject(value: Record<string, unknown>) {
  return JSON.parse(stableStringify(value)) as Record<string, unknown>;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function chunkTextForReplay(text: string) {
  const chunks: string[] = [];
  const chunkSize = numberFromRuntimeEnv("AI_RESPONSE_CACHE_REPLAY_CHARS", 72, { max: 240, min: 24 });
  for (let cursor = 0; cursor < text.length; cursor += chunkSize) {
    chunks.push(text.slice(cursor, cursor + chunkSize));
  }
  return chunks.length ? chunks : [text];
}

function numberFromRuntimeEnv(name: string, fallback: number, bounds: { max: number; min: number }) {
  const value = Number(readRuntimeEnv(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(bounds.min, Math.min(bounds.max, Math.floor(value)));
}

async function recordCacheOpsFailure(eventName: string, error: unknown, metadata: EventProperties) {
  await recordOpsEvent({
    eventName,
    severity: "warning",
    surface: "ai-response-cache",
    message: error instanceof Error ? error.message : "AI response cache operation failed.",
    metadata,
  });
}

function safeKeyPrefix(cacheKey: string) {
  return cacheKey.slice(0, 12);
}

function sanitizeHeaderValue(value: string) {
  return value.replace(/[^\w.-]+/g, "-").slice(0, 80) || "none";
}
