/**
 * Missing-var daily caps for the Workers Free native runtime.
 *
 * Each number matches `vars` in `wrangler.jsonc`. A missing or unparsable
 * binding must not admit more work than production. A present numeric var is
 * honored as written, including a tighter operator override.
 */
export const FREE_TIER_QUOTA_FALLBACKS = {
  RATE_LIMIT_USER_CHAT_DAILY: 20,
  RATE_LIMIT_GUEST_SESSION_DAILY: 10,
  RATE_LIMIT_GUEST_FINGERPRINT_DAILY: 10,
  RATE_LIMIT_GUEST_IP_DAILY: 150,
  RATE_LIMIT_ACTIVITY_DAILY: 10,
  RATE_LIMIT_MEMORY_DAILY: 20,
  LLM_GLOBAL_DAILY_CALL_LIMIT: 1_000,
} as const;

export type FreeTierQuotaFallbackName = keyof typeof FREE_TIER_QUOTA_FALLBACKS;

export function freeTierDailyCapFromEnv(
  value: string | undefined,
  name: FreeTierQuotaFallbackName,
) {
  const fallback = FREE_TIER_QUOTA_FALLBACKS[name];
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}
