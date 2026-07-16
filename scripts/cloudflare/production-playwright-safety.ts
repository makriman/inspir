export function redactProductionPlaywrightOutput(
  source: string,
  sensitiveValues: readonly string[],
) {
  let redacted = source;
  const variants = new Set<string>();
  for (const value of sensitiveValues) {
    if (!value) continue;
    variants.add(value);
    variants.add(JSON.stringify(value).slice(1, -1));
    variants.add(encodeURIComponent(value));
  }
  for (const value of [...variants].sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(value).join("[REDACTED]");
  }
  return redacted.replace(
    /((?:__Secure-)?better-auth\.session_token(?:=|%3D|\s*:\s*))[A-Za-z0-9._~+/%=-]+/gi,
    "$1[REDACTED]",
  );
}

export function redactPlaywrightJsonEvidence(
  value: unknown,
  sensitiveValues: readonly string[],
): unknown {
  if (typeof value === "string") {
    return redactProductionPlaywrightOutput(value, sensitiveValues);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      redactPlaywrightJsonEvidence(entry, sensitiveValues),
    );
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      redactProductionPlaywrightOutput(key, sensitiveValues),
      redactPlaywrightJsonEvidence(entry, sensitiveValues),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
