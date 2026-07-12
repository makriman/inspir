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
