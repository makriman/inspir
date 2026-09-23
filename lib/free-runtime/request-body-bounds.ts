/**
 * Workers Free rejects `limits.cpu_ms` and enforces a 10 ms request ceiling.
 * Chat handlers use these checks to refuse an oversized body before JSON.parse
 * or any other request-path work. Product payload limits stay in the callers.
 */

export const MAX_CHAT_JSON_DEPTH = 6;
export const MAX_CHAT_JSON_CONTAINERS = 40;

const declaredLengthDigits = /^[0-9]{1,8}$/;
const oversizedDigitRun = /^[0-9]{9,}$/;

/**
 * Canonical Content-Length only. A missing or non-numeric header returns null
 * so the caller still enforces the stream cap. A digit run past 8 characters
 * is already larger than any chat body on this Worker.
 */
export function declaredContentLength(header: string | null): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (oversizedDigitRun.test(value)) return Number.POSITIVE_INFINITY;
  if (!declaredLengthDigits.test(value)) return null;
  return Number(value);
}

export function contentLengthOverLimit(header: string | null, maxBytes: number) {
  const advertised = declaredContentLength(header);
  return advertised !== null && advertised > maxBytes;
}

export async function discardIfDeclaredBodyExceeds(request: Request, maxBytes: number) {
  if (!contentLengthOverLimit(request.headers.get("content-length"), maxBytes)) return false;
  await cancelUnreadBody(request.body, "declared_body_too_large");
  return true;
}

export async function cancelUnreadBody(
  body: ReadableStream<Uint8Array> | null,
  reason: string,
) {
  if (!body) return;
  await body.cancel(reason).catch(() => undefined);
}

/**
 * Linear scan so a nested or very wide JSON document never reaches JSON.parse.
 * Braces inside strings do not count. Chat payloads are a flat object, or one
 * object containing a short messages array.
 */
export function chatJsonWithinCpuBounds(text: string) {
  let depth = 0;
  let containers = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      containers += 1;
      if (depth > MAX_CHAT_JSON_DEPTH || containers > MAX_CHAT_JSON_CONTAINERS) return false;
      continue;
    }
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !inString;
}
