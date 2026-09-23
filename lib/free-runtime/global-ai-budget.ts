import { FREE_TIER_QUOTA_FALLBACKS } from "./free-tier-quota-fallbacks";

export const DEFAULT_GLOBAL_DAILY_CALL_LIMIT = FREE_TIER_QUOTA_FALLBACKS.LLM_GLOBAL_DAILY_CALL_LIMIT;

export function parseConfiguredGlobalDailyCallLimit(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function globalDailyCallLimitFromEnv(value: string | undefined) {
  if (value === undefined) return DEFAULT_GLOBAL_DAILY_CALL_LIMIT;
  return parseConfiguredGlobalDailyCallLimit(value) ?? 0;
}
