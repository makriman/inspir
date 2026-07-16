import { topicSeeds, type TopicSeed } from "../content/topics";
import { globalDailyCallLimitFromEnv } from "./global-ai-budget";
import {
  acceptsOpenAiSse,
  readBoundedOpenAiChatCompletionText,
} from "./openai-chat-contract";

export const FREE_GUEST_CHAT_DELIVERY = "lean-api-worker";
export const MAX_FREE_GUEST_CHAT_BODY_BYTES = 20 * 1024;
export const MAX_FREE_GUEST_CHAT_HISTORY_MESSAGES = 12;
export const MAX_FREE_GUEST_CHAT_HISTORY_CHARACTERS = 12_000;
export const MAX_FREE_GUEST_LEGACY_RESPONSE_BYTES = 128 * 1_024;
export const MAX_FREE_GUEST_LEGACY_ASSISTANT_CHARACTERS = 12_000;

const guestSessionCookie = "inspir_guest_session";
const guestUsageCookie = "inspir_guest_messages_used";
const guestSessionCookieMaxAgeSeconds = 30 * 24 * 60 * 60;
const guestUsageCookieMaxAgeSeconds = 24 * 60 * 60;
const defaultWriteFreezeRetrySeconds = 300;
const defaultOpenAiBaseUrl = "https://api.openai.com/v1";
const cloudflareGatewayHost = "gateway.ai.cloudflare.com";
const strictPayloadKeys = ["topicId", "content", "preferredLanguage", "messages"] as const;
const strictMessageKeys = ["role", "content"] as const;
const truthyValues = new Set(["1", "true", "yes", "on"]);
export const FREE_GUEST_CHAT_SUPPORTED_LANGUAGES = [
  "English",
  "Hindi",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Dutch",
  "Russian",
  "Ukrainian",
  "Polish",
  "Romanian",
  "Czech",
  "Hungarian",
  "Greek",
  "Turkish",
  "Arabic",
  "Hebrew",
  "Persian",
  "Urdu",
  "Bengali",
  "Tamil",
  "Telugu",
  "Marathi",
  "Gujarati",
  "Kannada",
  "Malayalam",
  "Punjabi",
  "Odia",
  "Assamese",
  "Nepali",
  "Sinhala",
  "Chinese",
  "Japanese",
  "Korean",
  "Vietnamese",
  "Thai",
  "Indonesian",
  "Malay",
  "Filipino",
  "Swahili",
  "Afrikaans",
  "Amharic",
  "Yoruba",
  "Zulu",
  "Hausa",
  "Somali",
  "Norwegian",
  "Swedish",
  "Danish",
  "Finnish",
  "Icelandic",
  "Irish",
  "Welsh",
  "Catalan",
  "Basque",
  "Galician",
  "Serbian",
  "Croatian",
  "Bosnian",
  "Bulgarian",
  "Slovak",
  "Slovenian",
  "Lithuanian",
  "Latvian",
  "Estonian",
  "Albanian",
  "Georgian",
  "Armenian",
  "Azerbaijani",
] as const;
const supportedLanguageNames = new Set<string>(FREE_GUEST_CHAT_SUPPORTED_LANGUAGES);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const globalBudgetSql = `insert into llm_usage_daily_shards (day, shard, call_count, created_at, updated_at)
select ?, 0, 1, ?, ?
where coalesce((select sum(call_count) from llm_usage_daily_shards where day = ?), 0) < ?
on conflict (day, shard) do update
  set call_count = llm_usage_daily_shards.call_count + 1,
      updated_at = excluded.updated_at
where coalesce((select sum(call_count) from llm_usage_daily_shards where day = ?), 0) < ?
returning call_count as "callCount"`;

const threeGuestQuotaRows = `(?, ?, ?, 0),
    (?, ?, ?, 1),
    (?, ?, ?, 2)`;

type AdmissionSqlStatements = {
  classifyDenial: string;
  consumeGlobal: string;
  consumeGuests: string;
};

function buildAdmissionSql(guestQuotaRows: string): AdmissionSqlStatements {
  const guestInputs = `guest_inputs(bucket, "key", quota_limit, ordinal) as (
    values ${guestQuotaRows}
  )`;
  return {
    consumeGlobal: `with ${guestInputs}
insert into llm_usage_daily_shards (day, shard, call_count, created_at, updated_at)
select ?, 0, 1, ?, ?
where coalesce((select sum(call_count) from llm_usage_daily_shards where day = ?), 0) < ?
  and not exists (
    select 1
    from guest_inputs as input
    join rate_limit_windows as existing on existing."key" = input."key"
    where existing.reset_at > ?
      and existing.count >= input.quota_limit
  )
on conflict (day, shard) do update
  set call_count = llm_usage_daily_shards.call_count + 1,
      updated_at = excluded.updated_at
where coalesce((select sum(call_count) from llm_usage_daily_shards where day = ?), 0) < ?
  and not exists (
    select 1
    from guest_inputs as input
    join rate_limit_windows as existing on existing."key" = input."key"
    where existing.reset_at > ?
      and existing.count >= input.quota_limit
  )
returning call_count as "callCount"`,
    consumeGuests: `with ${guestInputs}
insert into rate_limit_windows ("key", count, reset_at, created_at, updated_at)
select "key", 1, ?, ?, ?
from guest_inputs
where changes() = 1
on conflict ("key") do update
  set count = case
        when rate_limit_windows.reset_at <= ? then 1
        else rate_limit_windows.count + 1
      end,
      reset_at = case
        when rate_limit_windows.reset_at <= ? then excluded.reset_at
        else rate_limit_windows.reset_at
      end,
      updated_at = excluded.updated_at
returning "key", count`,
    classifyDenial: `with ${guestInputs}
select case
  when coalesce((select sum(call_count) from llm_usage_daily_shards where day = ?), 0) >= ?
    then 'global-ai-budget'
  else (
    select input.bucket
    from guest_inputs as input
    join rate_limit_windows as existing on existing."key" = input."key"
    where existing.reset_at > ?
      and existing.count >= input.quota_limit
    order by input.ordinal
    limit 1
  )
end as bucket`,
  };
}

const admissionSqlWithIp = buildAdmissionSql(threeGuestQuotaRows);

export type FreeGuestChatD1Row = {
  readonly bucket?: unknown;
  readonly callCount?: unknown;
  readonly count?: unknown;
  readonly key?: unknown;
};

export type FreeGuestChatD1Result = {
  readonly results: readonly FreeGuestChatD1Row[];
  readonly success: boolean;
};

export interface FreeGuestChatD1Statement {
  bind(...values: unknown[]): FreeGuestChatD1Statement;
  run(): Promise<FreeGuestChatD1Result>;
}

export interface FreeGuestChatD1Database {
  batch(statements: FreeGuestChatD1Statement[]): Promise<FreeGuestChatD1Result[]>;
  prepare(query: string): FreeGuestChatD1Statement;
}

/**
 * Narrow adapter contract for the native route. The Worker entry point supplies
 * its generated Cloudflare Env at the boundary instead of importing framework env helpers.
 */
export type FreeGuestChatEnv = {
  DB: FreeGuestChatD1Database;
  APP_WRITE_FREEZE?: string;
  APP_WRITE_FREEZE_RETRY_AFTER_SECONDS?: string;
  WRITE_FREEZE?: string;
  RATE_LIMIT_GUEST_SESSION_DAILY?: string;
  RATE_LIMIT_GUEST_FINGERPRINT_DAILY?: string;
  RATE_LIMIT_GUEST_IP_DAILY?: string;
  LLM_GLOBAL_DAILY_CALL_LIMIT?: string;
  CLOUDFLARE_AI_GATEWAY_BASE_URL?: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
  CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_FAST_MODEL?: string;
  OPENAI_REASONING_MODEL?: string;
  OPENAI_MODEL_REASONING?: string;
  OPENAI_STRUCTURED_MODEL?: string;
  OPENAI_MODEL_STRUCTURED?: string;
};

export type FreeGuestChatLogEntry = {
  event: string;
  severity: "warning" | "critical";
  posture?: "fail_open" | "fail_closed";
  bucket?: GuestQuotaBucket | "global-ai-budget";
  day?: string;
  reason?: string;
  status?: number;
};

export type FreeGuestChatRuntime = {
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  log?: (entry: FreeGuestChatLogEntry) => void;
  now?: () => Date;
  randomUUID?: () => string;
};

type GuestMessage = {
  role: "user" | "assistant";
  content: string;
};

type GuestChatPayload = {
  topicId: string;
  content: string;
  preferredLanguage?: string;
  messages: GuestMessage[];
};

type GuestQuotaBucket = "ip" | "fingerprint" | "session";

type GuestQuotaInput = {
  bucket: GuestQuotaBucket;
  key: string;
  limit: number;
};

type GuestAdmissionDecision =
  | { ok: true; sessionUsed: number }
  | {
      ok: false;
      bucket: GuestQuotaBucket | "global-ai-budget";
      unavailable: boolean;
    };

type GlobalBudgetDecision =
  | { ok: true }
  | { ok: false; unavailable: boolean };

type ProviderSettings = {
  endpoint: string;
  headers: Headers;
  provider: "cloudflare-ai-gateway" | "openai";
};

type ReadJsonResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; error: string };

type ParsePayloadResult =
  | { ok: true; value: GuestChatPayload }
  | { ok: false };

export async function handleFreeGuestChat(
  request: Request,
  env: FreeGuestChatEnv,
  runtime: FreeGuestChatRuntime = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse(
      { error: "Method not allowed" },
      405,
      new Headers({ allow: "POST" }),
    );
  }

  if (isWriteFreezeEnabled(env)) {
    return jsonResponse(
      {
        error: "The service is temporarily read-only while a migration is in progress.",
        code: "write_freeze_active",
        surface: "guest-chat",
      },
      503,
      new Headers({
        "retry-after": String(
          positiveIntegerFromEnv(
            env.APP_WRITE_FREEZE_RETRY_AFTER_SECONDS,
            defaultWriteFreezeRetrySeconds,
          ),
        ),
      }),
    );
  }

  const json = await readBoundedJson(request);
  if (!json.ok) return jsonResponse({ error: json.error }, json.status);

  const parsed = parseGuestChatPayload(json.value);
  if (!parsed.ok) return jsonResponse({ error: "Invalid chat request" }, 400);

  const topic = findGuestTopic(parsed.value.topicId);
  if (!topic) {
    return jsonResponse({ error: "Topic not available for guest chat" }, 404);
  }

  const ip = requestIp(request);
  if (!ip) {
    emitLog(runtime, {
      event: "guest_chat_trusted_ip_unavailable",
      severity: "critical",
      posture: "fail_closed",
      reason: "missing_or_invalid_cf_connecting_ip",
    });
    return jsonResponse(
      {
        error: "Guest chat is temporarily unavailable.",
        code: "guest_identity_unavailable",
      },
      503,
    );
  }

  const useOpenAiSse = acceptsOpenAiSse(request);
  const provider = providerSettings(env, useOpenAiSse);
  if (!provider) {
    emitLog(runtime, {
      event: "guest_chat_provider_unavailable",
      severity: "critical",
      reason: "invalid_or_missing_configuration",
    });
    return jsonResponse(
      { error: "The assistant could not answer right now." },
      503,
    );
  }

  const now = runtime.now?.() ?? new Date();
  const day = utcDay(now);
  const resetAtMs = nextUtcDayMs(now);
  const retryAfterSeconds = secondsUntil(resetAtMs, now.getTime());
  const sessionLimit = nonNegativeIntegerFromEnv(env.RATE_LIMIT_GUEST_SESSION_DAILY, 10);
  const sessionCookie = readCookie(request.headers, guestSessionCookie);
  const sessionId = validSessionId(sessionCookie)
    ? sessionCookie.toLowerCase()
    : (runtime.randomUUID?.() ?? crypto.randomUUID());
  const cookieUsage = boundedCookieUsage(
    readCookie(request.headers, guestUsageCookie),
    sessionLimit,
  );
  const [ipHash, fingerprintHash] = await Promise.all([
    sha256Hex(`ip:${ip}`),
    guestFingerprintHash(request.headers, ip),
  ]);
  const guestQuotas: GuestQuotaInput[] = [
    {
      bucket: "session",
      key: `guest-chat:session:${sessionId}`,
      limit: sessionLimit,
    },
    {
      bucket: "fingerprint",
      key: `guest-chat:fingerprint:${fingerprintHash}`,
      limit: nonNegativeIntegerFromEnv(env.RATE_LIMIT_GUEST_FINGERPRINT_DAILY, 10),
    },
    {
      bucket: "ip",
      key: `guest-chat:ip:${ipHash}`,
      limit: nonNegativeIntegerFromEnv(env.RATE_LIMIT_GUEST_IP_DAILY, 150),
    },
  ];

  const admission = await consumeGuestAdmission(
    env,
    guestQuotas,
    now,
    day,
    resetAtMs,
    cookieUsage,
    runtime,
  );
  if (!admission.ok) {
    if (admission.bucket === "global-ai-budget") {
      const headers = guestUsageHeaders(cookieUsage, sessionLimit);
      headers.set("retry-after", String(retryAfterSeconds));
      headers.set("x-guest-rate-limit-bucket", "global-ai-budget");
      return jsonResponse(
        {
          error: admission.unavailable
            ? "Daily AI usage verification is temporarily unavailable"
            : "Daily AI usage limit reached",
          bucket: "global-ai-budget",
        },
        admission.unavailable ? 503 : 429,
        headers,
      );
    }
    emitLog(runtime, {
      event: "guest_quota_denied",
      severity: "warning",
      bucket: admission.bucket,
      day,
    });
    return guestLimitResponse(
      "Guest message limit reached",
      admission.bucket,
      admission.bucket === "session" ? sessionLimit : cookieUsage,
      sessionLimit,
      retryAfterSeconds,
    );
  }

  const guestHeaders = guestUsageHeaders(admission.sessionUsed, sessionLimit);
  appendGuestCookies(guestHeaders, sessionId, admission.sessionUsed);

  const language = normalizePreferredLanguage(parsed.value.preferredLanguage);
  const model = modelForTopic(env, topic);
  const providerBody = buildProviderBody(
    parsed.value,
    topic,
    language,
    model,
    useOpenAiSse,
  );
  let providerResponse: Response;
  try {
    providerResponse = await (runtime.fetch ?? fetch)(provider.endpoint, {
      method: "POST",
      headers: provider.headers,
      body: JSON.stringify(providerBody),
      // workerd implements `manual`, not `error`. Keeping redirects manual also
      // prevents the authenticated Gateway headers from following to another host.
      redirect: "manual",
      signal: request.signal,
    });
  } catch (error) {
    emitLog(runtime, {
      event: "guest_chat_provider_fetch_failed",
      severity: "warning",
      reason: safeErrorName(error),
    });
    return jsonResponse(
      { error: "The assistant could not answer right now." },
      502,
      guestHeaders,
    );
  }

  if (!providerResponse.ok) {
    await cancelBody(providerResponse.body);
    emitLog(runtime, {
      event: "guest_chat_provider_rejected",
      severity: "warning",
      status: providerResponse.status,
      reason: provider.provider,
    });
    return jsonResponse(
      { error: "The assistant could not answer right now." },
      502,
      guestHeaders,
    );
  }

  const contentType = providerResponse.headers.get("content-type")?.toLowerCase() ?? "";
  if (useOpenAiSse && (!providerResponse.body || !contentType.startsWith("text/event-stream"))) {
    await cancelBody(providerResponse.body);
    emitLog(runtime, {
      event: "guest_chat_provider_invalid_stream",
      severity: "warning",
      reason: provider.provider,
    });
    return jsonResponse(
      { error: "The assistant could not answer right now." },
      502,
      guestHeaders,
    );
  }

  const responseHeaders = new Headers(guestHeaders);
  if (useOpenAiSse) {
    responseHeaders.set("content-type", providerResponse.headers.get("content-type") ?? "text/event-stream; charset=utf-8");
    responseHeaders.set("x-accel-buffering", "no");
    return new Response(providerResponse.body, {
      status: 200,
      headers: responseHeaders,
    });
  }

  if (!contentType.startsWith("application/json")) {
    await cancelBody(providerResponse.body);
    return jsonResponse(
      { error: "The assistant could not answer right now." },
      502,
      guestHeaders,
    );
  }
  const assistantText = await readBoundedOpenAiChatCompletionText(providerResponse, {
    maxBytes: MAX_FREE_GUEST_LEGACY_RESPONSE_BYTES,
    maxCharacters: MAX_FREE_GUEST_LEGACY_ASSISTANT_CHARACTERS,
  });
  if (!assistantText) {
    return jsonResponse(
      { error: "The assistant could not answer right now." },
      502,
      guestHeaders,
    );
  }
  responseHeaders.set("content-type", "text/plain; charset=utf-8");
  return new Response(assistantText, { status: 200, headers: responseHeaders });
}

async function readBoundedJson(request: Request): Promise<ReadJsonResult> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
    return { ok: false, status: 415, error: "Chat requests must use JSON" };
  }

  const advertisedLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(advertisedLength) && advertisedLength > MAX_FREE_GUEST_CHAT_BODY_BYTES) {
    return { ok: false, status: 413, error: "Chat request is too large" };
  }
  if (!request.body) return { ok: false, status: 400, error: "Invalid chat request" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_FREE_GUEST_CHAT_BODY_BYTES) {
        try {
          await reader.cancel("guest_chat_body_too_large");
        } catch {
          // The body is already being discarded; cancellation failure is harmless.
        }
        return { ok: false, status: 413, error: "Chat request is too large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    try {
      await reader.cancel("invalid_guest_chat_body");
    } catch {
      // The stream may already be errored or closed.
    }
    return { ok: false, status: 400, error: "Invalid chat request" };
  } finally {
    reader.releaseLock();
  }

  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400, error: "Invalid chat request" };
  }
}

function parseGuestChatPayload(value: unknown): ParsePayloadResult {
  if (!isRecord(value) || !hasOnlyKeys(value, strictPayloadKeys)) return { ok: false };
  const topicId = boundedTrimmedString(value.topicId, 1, 120);
  const content = boundedTrimmedString(value.content, 1, 6_000);
  if (!topicId || !content) return { ok: false };

  let preferredLanguage: string | undefined;
  if (value.preferredLanguage !== undefined) {
    preferredLanguage = boundedTrimmedString(value.preferredLanguage, 1, 80) ?? undefined;
    if (!preferredLanguage) return { ok: false };
  }

  const rawMessages = value.messages ?? [];
  if (!Array.isArray(rawMessages) || rawMessages.length > MAX_FREE_GUEST_CHAT_HISTORY_MESSAGES) {
    return { ok: false };
  }
  const messages: GuestMessage[] = [];
  let historyCharacters = 0;
  for (const rawMessage of rawMessages) {
    if (!isRecord(rawMessage) || !hasOnlyKeys(rawMessage, strictMessageKeys)) return { ok: false };
    if (rawMessage.role !== "user" && rawMessage.role !== "assistant") return { ok: false };
    const messageContent = boundedTrimmedString(rawMessage.content, 1, 6_000);
    if (!messageContent) return { ok: false };
    historyCharacters += messageContent.length;
    if (historyCharacters > MAX_FREE_GUEST_CHAT_HISTORY_CHARACTERS) return { ok: false };
    messages.push({ role: rawMessage.role, content: messageContent });
  }

  return {
    ok: true,
    value: {
      topicId,
      content,
      ...(preferredLanguage ? { preferredLanguage } : {}),
      messages,
    },
  };
}

async function consumeGuestAdmission(
  env: FreeGuestChatEnv,
  quotas: GuestQuotaInput[],
  now: Date,
  day: string,
  resetAtMs: number,
  cookieUsage: number,
  runtime: FreeGuestChatRuntime,
): Promise<GuestAdmissionDecision> {
  const globalLimit = globalDailyCallLimitFromEnv(env.LLM_GLOBAL_DAILY_CALL_LIMIT);
  if (globalLimit <= 0) {
    emitLog(runtime, {
      event: "llm_budget_denied",
      severity: "critical",
      posture: "fail_closed",
      bucket: "global-ai-budget",
      day,
      reason: "configured_zero",
    });
    return { ok: false, bucket: "global-ai-budget", unavailable: false };
  }

  const disabled = quotas.find((quota) => quota.limit <= 0);
  if (disabled) return { ok: false, bucket: disabled.bucket, unavailable: false };

  const admissionSql = admissionSqlForQuotaCount(quotas.length);
  if (!admissionSql) {
    return malformedGuestAdmission(runtime, day, "invalid_quota_count");
  }

  const nowMs = now.getTime();
  const quotaBindings = guestQuotaInputBindings(quotas);
  const sessionLimit = quotas.find((quota) => quota.bucket === "session")?.limit ?? 1;
  const fallbackSessionUsed = Math.min(cookieUsage + 1, sessionLimit);
  let batchResults: FreeGuestChatD1Result[];

  try {
    batchResults = await env.DB.batch([
      env.DB.prepare(admissionSql.consumeGlobal).bind(
        ...quotaBindings,
        day,
        nowMs,
        nowMs,
        day,
        globalLimit,
        nowMs,
        day,
        globalLimit,
        nowMs,
      ),
      env.DB.prepare(admissionSql.consumeGuests).bind(
        ...quotaBindings,
        resetAtMs,
        nowMs,
        nowMs,
        nowMs,
        nowMs,
      ),
      env.DB.prepare(admissionSql.classifyDenial).bind(
        ...quotaBindings,
        day,
        globalLimit,
        nowMs,
      ),
    ]);
  } catch (error) {
    emitLog(runtime, {
      event: "guest_quota_check_failed",
      severity: "warning",
      posture: "fail_open",
      reason: safeErrorName(error),
    });
    const fallbackBudget = await consumeGlobalBudget(env, now, day, runtime);
    return fallbackBudget.ok
      ? { ok: true, sessionUsed: fallbackSessionUsed }
      : {
          ok: false,
          bucket: "global-ai-budget",
          unavailable: fallbackBudget.unavailable,
        };
  }

  if (batchResults.length !== 3 || batchResults.some((result) => !result.success)) {
    return malformedGuestAdmission(runtime, day, "invalid_batch_result");
  }

  const globalResult = batchResults[0];
  const guestResult = batchResults[1];
  const classificationResult = batchResults[2];
  if (!globalResult || !guestResult || !classificationResult) {
    return malformedGuestAdmission(runtime, day, "missing_batch_result");
  }

  if (globalResult.results.length === 0 && guestResult.results.length === 0) {
    const bucket = classifiedAdmissionBucket(classificationResult, quotas);
    if (!bucket) return malformedGuestAdmission(runtime, day, "invalid_denial_classification");
    if (bucket === "global-ai-budget") {
      emitLog(runtime, {
        event: "llm_budget_denied",
        severity: "critical",
        posture: "fail_closed",
        bucket,
        day,
        reason: "daily_limit_reached",
      });
    }
    return { ok: false, bucket, unavailable: false };
  }

  const sessionUsed = admittedSessionCount(globalResult, guestResult, quotas);
  if (sessionUsed === null) {
    return malformedGuestAdmission(runtime, day, "invalid_admission_result");
  }
  return { ok: true, sessionUsed };
}

function admissionSqlForQuotaCount(quotaCount: number) {
  if (quotaCount === 3) return admissionSqlWithIp;
  return null;
}

function guestQuotaInputBindings(quotas: readonly GuestQuotaInput[]) {
  const bindings: Array<string | number> = [];
  for (const quota of quotas) {
    bindings.push(quota.bucket, quota.key, quota.limit);
  }
  return bindings;
}

function classifiedAdmissionBucket(
  result: FreeGuestChatD1Result,
  quotas: readonly GuestQuotaInput[],
) {
  if (result.results.length !== 1) return null;
  const bucket = result.results[0]?.bucket;
  if (bucket === "global-ai-budget") return bucket;
  for (const quota of quotas) {
    if (quota.bucket === bucket) return quota.bucket;
  }
  return null;
}

function admittedSessionCount(
  globalResult: FreeGuestChatD1Result,
  guestResult: FreeGuestChatD1Result,
  quotas: readonly GuestQuotaInput[],
) {
  if (
    globalResult.results.length !== 1 ||
    positiveInteger(globalResult.results[0]?.callCount) === null ||
    guestResult.results.length !== quotas.length
  ) {
    return null;
  }

  const expectedQuotas = new Map(quotas.map((quota) => [quota.key, quota]));
  const counts = new Map<string, number>();
  for (const row of guestResult.results) {
    if (typeof row.key !== "string" || counts.has(row.key)) return null;
    const quota = expectedQuotas.get(row.key);
    const count = positiveInteger(row.count);
    if (!quota || count === null || count > quota.limit) return null;
    counts.set(row.key, count);
  }

  const sessionQuota = quotas.find((quota) => quota.bucket === "session");
  return sessionQuota ? (counts.get(sessionQuota.key) ?? null) : null;
}

function malformedGuestAdmission(
  runtime: FreeGuestChatRuntime,
  day: string,
  reason: string,
): GuestAdmissionDecision {
  emitLog(runtime, {
    event: "llm_budget_check_failed",
    severity: "critical",
    posture: "fail_closed",
    bucket: "global-ai-budget",
    day,
    reason,
  });
  return { ok: false, bucket: "global-ai-budget", unavailable: true };
}

async function consumeGlobalBudget(
  env: FreeGuestChatEnv,
  now: Date,
  day: string,
  runtime: FreeGuestChatRuntime,
): Promise<GlobalBudgetDecision> {
  const limit = globalDailyCallLimitFromEnv(env.LLM_GLOBAL_DAILY_CALL_LIMIT);
  if (limit <= 0) {
    emitLog(runtime, {
      event: "llm_budget_denied",
      severity: "critical",
      posture: "fail_closed",
      bucket: "global-ai-budget",
      day,
      reason: "configured_zero",
    });
    return { ok: false, unavailable: false };
  }

  try {
    const nowMs = now.getTime();
    const result = await env.DB.prepare(globalBudgetSql)
      .bind(day, nowMs, nowMs, day, limit, day, limit)
      .run();
    if (!result.success) throw new Error("Global budget query failed");
    const row = result.results[0];
    if (!row) {
      emitLog(runtime, {
        event: "llm_budget_denied",
        severity: "critical",
        posture: "fail_closed",
        bucket: "global-ai-budget",
        day,
        reason: "daily_limit_reached",
      });
      return { ok: false, unavailable: false };
    }
    if (positiveInteger(row.callCount) === null) throw new Error("Invalid global budget result");
    return { ok: true };
  } catch (error) {
    emitLog(runtime, {
      event: "llm_budget_check_failed",
      severity: "critical",
      posture: "fail_closed",
      bucket: "global-ai-budget",
      day,
      reason: safeErrorName(error),
    });
    return { ok: false, unavailable: true };
  }
}

function buildProviderBody(
  payload: GuestChatPayload,
  topic: TopicSeed,
  language: string,
  model: string,
  stream: boolean,
) {
  const profile = topic.metadata.modelProfile;
  const reasoningModel = isReasoningModel(model);
  return {
    model,
    messages: [
      { role: "system" as const, content: compactTopicPrompt(topic, language) },
      ...payload.messages.map((message) => ({
        role: message.role,
        content:
          message.role === "assistant"
            ? `[Client-provided assistant history, not verified by inspir]\n${message.content}`
            : message.content,
      })),
      { role: "user" as const, content: payload.content },
    ],
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    max_completion_tokens: profile === "reasoning" ? 3_200 : 2_400,
    ...(reasoningModel
      ? { reasoning_effort: profile === "reasoning" ? ("low" as const) : ("minimal" as const) }
      : { temperature: profile === "structured" ? 0.35 : profile === "reasoning" ? 0.55 : 0.7 }),
  };
}

function compactTopicPrompt(topic: TopicSeed, language: string) {
  return [
    "You are inspir Buddy, a warm, rigorous learning companion. Help the learner think in short, active turns; be accurate, humble, practical, and safe for young learners.",
    `Mode: ${topic.name} (${topic.slug}). Category: ${topic.metadata.category}.`,
    `Reply in ${language}. Keep that language unless the learner explicitly requests another language for that reply.`,
    "Stay in the selected mode, use clear Markdown only when useful, and end with one useful next action.",
    "Mode instructions:",
    topic.systemPrompt,
    "For graded work, coach understanding instead of producing a dishonest final submission. Never invent citations or claim live verification.",
  ].join("\n");
}

function providerSettings(env: FreeGuestChatEnv, stream: boolean): ProviderSettings | null {
  const gatewayBaseUrl = nonEmpty(env.CLOUDFLARE_AI_GATEWAY_BASE_URL);
  const gatewayToken = nonEmpty(env.CLOUDFLARE_AI_GATEWAY_TOKEN);
  const openAiKey = nonEmpty(env.OPENAI_API_KEY);

  if (gatewayBaseUrl) {
    const endpoint = chatCompletionsEndpoint(gatewayBaseUrl, cloudflareGatewayHost);
    const byokAlias = nonEmpty(env.CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS);
    if (!endpoint || !gatewayToken || !byokAlias) return null;
    const headers = gatewayProviderHeaders(gatewayToken, byokAlias, stream);
    return { endpoint, headers, provider: "cloudflare-ai-gateway" };
  }

  if (!openAiKey) return null;
  const endpoint = chatCompletionsEndpoint(
    nonEmpty(env.OPENAI_BASE_URL) ?? defaultOpenAiBaseUrl,
    "api.openai.com",
  );
  if (!endpoint) return null;
  return {
    endpoint,
    headers: providerHeaders(openAiKey, stream),
    provider: "openai",
  };
}

function providerHeaders(bearerToken: string, stream: boolean) {
  return new Headers({
    authorization: `Bearer ${bearerToken}`,
    "content-type": "application/json",
    accept: stream ? "text/event-stream" : "application/json",
  });
}

function gatewayProviderHeaders(gatewayToken: string, byokAlias: string, stream: boolean) {
  return new Headers({
    "cf-aig-authorization": `Bearer ${gatewayToken}`,
    "cf-aig-byok-alias": byokAlias,
    "cf-aig-collect-log-payload": "false",
    "content-type": "application/json",
    accept: stream ? "text/event-stream" : "application/json",
  });
}

function chatCompletionsEndpoint(baseUrl: string, requiredHost: string) {
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== requiredHost ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/chat/completions`;
    return url.toString();
  } catch {
    return null;
  }
}

function modelForTopic(env: FreeGuestChatEnv, topic: TopicSeed) {
  const fallback = nonEmpty(env.OPENAI_MODEL) ?? "gpt-4.1-mini";
  const fast = nonEmpty(env.OPENAI_FAST_MODEL) ?? fallback;
  if (topic.metadata.modelProfile === "reasoning") {
    return nonEmpty(env.OPENAI_REASONING_MODEL) ?? nonEmpty(env.OPENAI_MODEL_REASONING) ?? fast;
  }
  if (topic.metadata.modelProfile === "structured") {
    return nonEmpty(env.OPENAI_STRUCTURED_MODEL) ?? nonEmpty(env.OPENAI_MODEL_STRUCTURED) ?? fast;
  }
  return fast;
}

function findGuestTopic(topicId: string) {
  const normalized = topicId.trim().toLowerCase();
  return topicSeeds.find((topic) => topic.slug === normalized);
}

function isWriteFreezeEnabled(env: FreeGuestChatEnv) {
  return truthyValues.has((env.APP_WRITE_FREEZE ?? env.WRITE_FREEZE ?? "").trim().toLowerCase());
}

function guestUsageHeaders(used: number, limit: number) {
  return responseHeaders({
    "x-guest-messages-used": String(used),
    "x-guest-messages-limit": String(limit),
    "x-guest-messages-remaining": String(Math.max(0, limit - used)),
  });
}

function guestLimitResponse(
  error: string,
  bucket: GuestQuotaBucket,
  used: number,
  limit: number,
  retryAfterSeconds: number,
) {
  const headers = guestUsageHeaders(used, limit);
  headers.set("retry-after", String(retryAfterSeconds));
  headers.set("x-guest-rate-limit-bucket", bucket);
  return jsonResponse(
    { error, used, limit, bucket },
    429,
    headers,
  );
}

function jsonResponse(
  body: Readonly<Record<string, string | number | boolean>>,
  status: number,
  headers?: Headers,
) {
  const responseHeaderValues = responseHeaders(headers);
  responseHeaderValues.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: responseHeaderValues });
}

function responseHeaders(input?: Headers | Record<string, string>) {
  const headers = new Headers(input);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("vary", appendVary(headers.get("vary"), "Cookie"));
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-inspir-delivery", FREE_GUEST_CHAT_DELIVERY);
  return headers;
}

function appendGuestCookies(headers: Headers, sessionId: string, used: number) {
  headers.append(
    "set-cookie",
    serializeSecureCookie(guestSessionCookie, sessionId, guestSessionCookieMaxAgeSeconds),
  );
  headers.append(
    "set-cookie",
    serializeSecureCookie(guestUsageCookie, String(used), guestUsageCookieMaxAgeSeconds),
  );
}

function serializeSecureCookie(name: string, value: string, maxAgeSeconds: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; Secure; HttpOnly; SameSite=Lax`;
}

function readCookie(headers: Headers, name: string) {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue;
    return segment.slice(separator + 1).trim();
  }
  return undefined;
}

export function requestIpForGuestQuota(request: Request) {
  return requestIp(request);
}

function requestIp(request: Request) {
  const cloudflareIp = normalizedIpAddress(request.headers.get("cf-connecting-ip"));
  if (cloudflareIp) return cloudflareIp;

  // Cloudflare supplies and overwrites cf-connecting-ip at the production
  // boundary. Generic proxy headers remain client-controlled there. Local
  // preview has no Cloudflare boundary, so its loopback URL explicitly opts
  // into the first valid development-proxy address instead.
  if (!isLocalPreviewRequest(request)) return null;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0] ?? null;
  return normalizedIpAddress(forwarded) ?? normalizedIpAddress(request.headers.get("x-real-ip"));
}

function isLocalPreviewRequest(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function normalizedIpAddress(value: string | null) {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 64) return null;
  const ipv4Parts = candidate.split(".");
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  ) {
    return ipv4Parts.map((part) => String(Number(part))).join(".");
  }
  if (!candidate.includes(":") || !/^[0-9a-f:.]+$/i.test(candidate)) return null;
  try {
    return new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

async function guestFingerprintHash(headers: Headers, ip: string) {
  return sha256Hex(
    [
      `ip:${ip}`,
      `ua:${coarseHeader(headers.get("user-agent"), 160)}`,
      `al:${coarseHeader(headers.get("accept-language"), 80)}`,
      `platform:${coarseHeader(headers.get("sec-ch-ua-platform"), 40)}`,
    ].join("\n"),
  );
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function boundedTrimmedString(value: unknown, minLength: number, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) return null;
  return normalized;
}

function nonNegativeIntegerFromEnv(value: string | undefined, fallback: number) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function positiveIntegerFromEnv(value: string | undefined, fallback: number) {
  return Math.max(1, nonNegativeIntegerFromEnv(value, fallback));
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function boundedCookieUsage(value: string | undefined, limit: number) {
  const parsed = Number(value ?? "0");
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), Math.max(0, limit));
}

function validSessionId(value: string | undefined): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function nonEmpty(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizePreferredLanguage(value: string | undefined) {
  const normalized = value?.trim();
  return normalized && supportedLanguageNames.has(normalized) ? normalized : "English";
}

function utcDay(now: Date) {
  return now.toISOString().slice(0, 10);
}

function nextUtcDayMs(now: Date) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

function secondsUntil(targetMs: number, nowMs: number) {
  return Math.max(1, Math.ceil((targetMs - nowMs) / 1_000));
}

function coarseHeader(value: string | null, maxLength: number) {
  return (value ?? "unknown").trim().replace(/\s+/g, " ").slice(0, maxLength) || "unknown";
}

function isReasoningModel(model: string) {
  return (
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4-mini") ||
    (model.startsWith("gpt-5") && !model.startsWith("gpt-5-chat"))
  );
}

function appendVary(current: string | null, value: string) {
  if (!current) return value;
  const values = current.split(",").map((entry) => entry.trim());
  return values.some((entry) => entry.toLowerCase() === value.toLowerCase())
    ? current
    : `${current}, ${value}`;
}

async function cancelBody(body: ReadableStream<Uint8Array> | null) {
  if (!body) return;
  try {
    await body.cancel("guest_chat_upstream_rejected");
  } catch {
    // The upstream has already closed; there is nothing left to release.
  }
}

function safeErrorName(error: unknown) {
  return error instanceof Error ? error.name : "UnknownError";
}

function emitLog(runtime: FreeGuestChatRuntime, entry: FreeGuestChatLogEntry) {
  if (runtime.log) {
    runtime.log(entry);
    return;
  }
  const serialized = JSON.stringify(entry);
  if (entry.severity === "critical") console.error(serialized);
  else console.warn(serialized);
}
