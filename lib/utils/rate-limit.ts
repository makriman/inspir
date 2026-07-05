import { d1All, d1First, d1Run } from "@/lib/db/client";

const oneDayMs = 24 * 60 * 60 * 1000;
const defaultLlmBudgetShardCount = 16;
const maxLlmBudgetShardCount = 128;

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

export type LlmBudgetResult = RateLimitResult & {
  day: string;
};

type DbTimestamp = Date | number | string;

export const quotaDefaults = {
  userChatDaily: 150,
  guestSessionDaily: 10,
  guestIpDaily: 150,
  activityDaily: 150,
  memoryDaily: 60,
  llmGlobalDaily: 1000,
  memoryPostTurnSynthesisThreshold: 3,
} as const;

export function numberFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export function normalizeLlmBudgetShardCount(value: number) {
  if (!Number.isFinite(value)) return defaultLlmBudgetShardCount;
  return Math.min(maxLlmBudgetShardCount, Math.max(1, Math.floor(value)));
}

export function llmBudgetShardCountFromEnv() {
  return normalizeLlmBudgetShardCount(
    numberFromEnv("LLM_GLOBAL_DAILY_SHARDS", defaultLlmBudgetShardCount),
  );
}

export function dailyLimitReset(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function utcDayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function safeQuotaKeyPart(value: string, maxLength = 160) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w:./@-]/g, "_")
    .slice(0, maxLength);
}

export async function consumeFixedWindowQuota(
  key: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<RateLimitResult> {
  const resetAt = new Date(now.getTime() + windowMs);
  if (limit <= 0) return rateLimitResult(false, limit, 0, resetAt, now);

  try {
    const updated = await d1All<{ count: number; resetAt: DbTimestamp }>(
      `insert into rate_limit_windows ("key", count, reset_at, created_at, updated_at)
       values (?, 1, ?, ?, ?)
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
       where rate_limit_windows.reset_at <= ?
          or rate_limit_windows.count < ?
       returning count, reset_at as "resetAt"`,
      key,
      resetAt.getTime(),
      now.getTime(),
      now.getTime(),
      now.getTime(),
      now.getTime(),
      now.getTime(),
      limit,
    );
    if (!updated.length) {
      const existing = await d1First<{ resetAt: DbTimestamp }>(
        'select reset_at as "resetAt" from rate_limit_windows where "key" = ?',
        key,
      );
      return rateLimitResult(false, limit, 0, existing?.resetAt ?? resetAt, now);
    }
    return rateLimitResult(true, limit, limit - updated[0].count, updated[0].resetAt, now);
  } catch (error) {
    console.error("rate_limit_check_failed", { key, error });
    return quotaUnavailableResult(limit, resetAt, now);
  } finally {
    void pruneExpiredRateLimits();
  }
}

export async function consumeDailyLlmBudget(
  limit = numberFromEnv("LLM_GLOBAL_DAILY_CALL_LIMIT", quotaDefaults.llmGlobalDaily),
  now = new Date(),
): Promise<LlmBudgetResult> {
  const day = utcDayKey(now);
  const resetAt = dailyLimitReset(now);
  if (limit <= 0) return { ...rateLimitResult(false, limit, 0, resetAt, now), day };

  try {
    const shardCount = llmBudgetShardCountFromEnv();
    const shard = randomLlmBudgetShard(shardCount);
    const rows = await d1All<{ shardCallCount: number }>(
      `insert into llm_usage_daily_shards (day, shard, call_count, created_at, updated_at)
       select ?, ?, 1, ?, ?
       where (
         coalesce((select sum(call_count) from llm_usage_daily_shards where day = ?), 0) +
         coalesce((select call_count from llm_usage_daily where day = ?), 0)
       ) < ?
       on conflict (day, shard) do update
         set call_count = llm_usage_daily_shards.call_count + 1,
             updated_at = excluded.updated_at
       where (
         coalesce((select sum(call_count) from llm_usage_daily_shards where day = ?), 0) +
         coalesce((select call_count from llm_usage_daily where day = ?), 0)
       ) < ?
       returning call_count as "shardCallCount"`,
      day,
      shard,
      now.getTime(),
      now.getTime(),
      day,
      day,
      limit,
      day,
      day,
      limit,
    );
    const total = await getDailyLlmCallTotal(day);
    if (!rows.length) return { ...rateLimitResult(false, limit, limit - total, resetAt, now), day };
    const result = rateLimitResult(true, limit, limit - total, resetAt, now);
    return { ...result, day };
  } catch (error) {
    if (isMissingLlmShardTableError(error)) {
      return consumeLegacyDailyLlmBudget(limit, now, day, resetAt);
    }
    console.error("llm_budget_check_failed", { day, error });
    return { ...quotaUnavailableResult(limit, resetAt, now), day };
  }
}

export async function consumeAiQuota(input: {
  key: string;
  limit: number;
  windowMs?: number;
}) {
  const quota = await consumeFixedWindowQuota(input.key, input.limit, input.windowMs ?? oneDayMs);
  if (!quota.ok) return { quota, budget: null };
  const budget = await consumeDailyLlmBudget();
  return { quota, budget };
}

function rateLimitResult(
  ok: boolean,
  limit: number,
  remaining: number,
  resetAt: DbTimestamp,
  now: Date,
): RateLimitResult {
  const resetDate = resetAt instanceof Date ? resetAt : new Date(resetAt);
  return {
    ok,
    limit,
    remaining: Math.max(0, remaining),
    resetAt: resetDate,
    retryAfterSeconds: Math.max(1, Math.ceil((resetDate.getTime() - now.getTime()) / 1000)),
  };
}

export function sqlTimestamp(value: Date) {
  return value.getTime();
}

function quotaUnavailableResult(limit: number, resetAt: Date, now: Date) {
  return rateLimitResult(true, limit, Math.max(0, limit - 1), resetAt, now);
}

async function consumeLegacyDailyLlmBudget(
  limit: number,
  now: Date,
  day = utcDayKey(now),
  resetAt = dailyLimitReset(now),
): Promise<LlmBudgetResult> {
  try {
    const rows = await d1All<{ callCount: number }>(
      `insert into llm_usage_daily (day, call_count, created_at, updated_at)
       values (?, 1, ?, ?)
       on conflict (day) do update
         set call_count = llm_usage_daily.call_count + 1,
             updated_at = excluded.updated_at
       where llm_usage_daily.call_count < ?
       returning call_count as "callCount"`,
      day,
      now.getTime(),
      now.getTime(),
      limit,
    );
    if (!rows.length) return { ...rateLimitResult(false, limit, 0, resetAt, now), day };
    const callCount = rows[0].callCount;
    const result = rateLimitResult(true, limit, limit - callCount, resetAt, now);
    return { ...result, day };
  } catch (error) {
    console.error("llm_budget_legacy_check_failed", { day, error });
    return { ...quotaUnavailableResult(limit, resetAt, now), day };
  }
}

async function getDailyLlmCallTotal(day: string) {
  const row = await d1First<{ total: number }>(
    `select
       coalesce((select sum(call_count) from llm_usage_daily_shards where day = ?), 0) +
       coalesce((select call_count from llm_usage_daily where day = ?), 0) as total`,
    day,
    day,
  );
  return Number(row?.total ?? 0);
}

function randomLlmBudgetShard(shardCount: number) {
  const normalized = normalizeLlmBudgetShardCount(shardCount);
  if (normalized === 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] ?? 0) % normalized;
}

function isMissingLlmShardTableError(error: unknown) {
  return /no such table:.*llm_usage_daily_shards/i.test(error instanceof Error ? error.message : String(error));
}

async function pruneExpiredRateLimits() {
  if (Math.random() > 0.01) return;
  try {
    await d1Run("delete from rate_limit_windows where reset_at < ?", Date.now() - 2 * oneDayMs);
  } catch {
    // Best-effort table hygiene; request quota decisions must not depend on it.
  }
}
