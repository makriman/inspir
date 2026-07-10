import { MAX_GAME_RESULT_REQUEST_BYTES } from "./results";

export const GAME_RESULT_NO_STORE_CACHE_CONTROL = "private, no-store, max-age=0";
export const GAME_RESULT_IMMUTABLE_CACHE_CONTROL =
  "public, max-age=31536000, s-maxage=31536000, immutable";

export type BoundedJsonReadResult =
  | { ok: true; value: unknown; byteLength: number }
  | { ok: false; code: "invalid-content-type" | "invalid-json" | "payload-too-large" };

export async function readBoundedGameResultJson(
  request: Request,
  maxBytes = MAX_GAME_RESULT_REQUEST_BYTES,
): Promise<BoundedJsonReadResult> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return { ok: false, code: "invalid-content-type" };
  }

  const declaredLength = parseContentLength(request.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > maxBytes) {
    return { ok: false, code: "payload-too-large" };
  }
  if (!request.body) return { ok: false, code: "invalid-json" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let serialized = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return { ok: false, code: "payload-too-large" };
      }
      serialized += decoder.decode(chunk.value, { stream: true });
    }
    serialized += decoder.decode();
    return { ok: true, value: JSON.parse(serialized), byteLength };
  } catch {
    return { ok: false, code: "invalid-json" };
  } finally {
    reader.releaseLock();
  }
}

export function noStoreGameResultJson(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: gameResultHeaders(GAME_RESULT_NO_STORE_CACHE_CONTROL, extraHeaders),
  });
}

export function immutableGameResultJson(body: unknown, extraHeaders?: HeadersInit) {
  return Response.json(body, {
    status: 200,
    headers: gameResultHeaders(GAME_RESULT_IMMUTABLE_CACHE_CONTROL, extraHeaders),
  });
}

export function protectGameResultResponse(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of gameResultHeaders(GAME_RESULT_NO_STORE_CACHE_CONTROL)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function gameResultHeaders(cacheControl: string, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", cacheControl);
  headers.set("CDN-Cache-Control", cacheControl);
  headers.set("Cloudflare-CDN-Cache-Control", cacheControl);
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function isJsonContentType(value: string | null) {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
}

function parseContentLength(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
