export const DEFAULT_GLOBAL_DAILY_CALL_LIMIT = 1_000;

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
