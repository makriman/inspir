import { sql } from "@/lib/db/client";

const oneDayMs = 24 * 60 * 60 * 1000;

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

type DbTimestamp = Date | string;

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

export async function checkRateLimit(key: string, limit: number, windowMs: number) {
  return consumeFixedWindowQuota(key, limit, windowMs);
}

export async function consumeFixedWindowQuota(
  key: string,
  limit: number,
  windowMs: number,
  now = new Date(),
): Promise<RateLimitResult> {
  const resetAt = new Date(now.getTime() + windowMs);
  const resetAtSql = sqlTimestamp(resetAt);
  if (limit <= 0) return rateLimitResult(false, limit, 0, resetAt, now);

  try {
    return await sql.begin(async (tx) => {
      const rows = await tx<Array<{ count: number; resetAt: DbTimestamp }>>`
        select count, reset_at as "resetAt"
        from rate_limit_windows
        where "key" = ${key}
        for update
      `;
      const existing = rows[0];

      if (!existing || new Date(existing.resetAt).getTime() <= now.getTime()) {
        const inserted = await tx<Array<{ count: number; resetAt: DbTimestamp }>>`
          insert into rate_limit_windows ("key", count, reset_at, updated_at)
          values (${key}, 1, ${resetAtSql}, now())
          on conflict ("key") do update
            set count = 1,
                reset_at = excluded.reset_at,
                updated_at = now()
          returning count, reset_at as "resetAt"
        `;
        return rateLimitResult(true, limit, limit - inserted[0].count, inserted[0].resetAt, now);
      }

      if (existing.count >= limit) {
        return rateLimitResult(false, limit, 0, existing.resetAt, now);
      }

      const updated = await tx<Array<{ count: number; resetAt: DbTimestamp }>>`
        update rate_limit_windows
        set count = count + 1,
            updated_at = now()
        where "key" = ${key}
        returning count, reset_at as "resetAt"
      `;
      return rateLimitResult(true, limit, limit - updated[0].count, updated[0].resetAt, now);
    });
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
    const result = await sql.begin(async (tx) => {
      const rows = await tx<Array<{ callCount: number }>>`
        select call_count as "callCount"
        from llm_usage_daily
        where day = ${day}
        for update
      `;
      const existing = rows[0];
      if (!existing) {
        const inserted = await tx<Array<{ callCount: number }>>`
          insert into llm_usage_daily (day, call_count, updated_at)
          values (${day}, 1, now())
          returning call_count as "callCount"
        `;
        return rateLimitResult(true, limit, limit - inserted[0].callCount, resetAt, now);
      }
      if (existing.callCount >= limit) {
        return rateLimitResult(false, limit, 0, resetAt, now);
      }
      const updated = await tx<Array<{ callCount: number }>>`
        update llm_usage_daily
        set call_count = call_count + 1,
            updated_at = now()
        where day = ${day}
        returning call_count as "callCount"
      `;
      return rateLimitResult(true, limit, limit - updated[0].callCount, resetAt, now);
    });
    return { ...result, day };
  } catch (error) {
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
  return value.toISOString();
}

function quotaUnavailableResult(limit: number, resetAt: Date, now: Date) {
  return rateLimitResult(true, limit, Math.max(0, limit - 1), resetAt, now);
}

async function pruneExpiredRateLimits() {
  if (Math.random() > 0.01) return;
  try {
    await sql`
      delete from rate_limit_windows
      where reset_at < now() - interval '2 days'
    `;
  } catch {
    // Best-effort table hygiene; request quota decisions must not depend on it.
  }
}
