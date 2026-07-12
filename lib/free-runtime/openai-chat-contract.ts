const OPENAI_SSE_MEDIA_TYPE = "text/event-stream";

export function acceptsOpenAiSse(request: Request) {
  const accept = request.headers.get("accept");
  if (!accept) return false;
  return accept.split(",").some((entry) => {
    const [rawMediaType, ...rawParameters] = entry.split(";");
    const mediaType = rawMediaType?.trim().toLowerCase();
    if (mediaType !== OPENAI_SSE_MEDIA_TYPE) return false;

    const qualityParameters = rawParameters
      .map((parameter) => parameter.split("=", 2).map((part) => part.trim()))
      .filter(([name]) => name?.toLowerCase() === "q");
    if (qualityParameters.length === 0) return true;
    return qualityParameters.every(([, value]) => {
      if (!value) return false;
      const quality = Number(value);
      return Number.isFinite(quality) && quality > 0 && quality <= 1;
    });
  });
}

export async function readBoundedOpenAiChatCompletionText(
  response: Response,
  limits: { maxBytes: number; maxCharacters: number },
) {
  const advertisedLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(advertisedLength) && advertisedLength > limits.maxBytes) {
    await cancelResponseBody(response.body, "legacy_chat_response_too_large");
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > limits.maxBytes) {
        await reader.cancel("legacy_chat_response_too_large").catch(() => undefined);
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    await reader.cancel("legacy_chat_response_invalid").catch(() => undefined);
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(parsed) || !Array.isArray(parsed.choices)) return null;
    const choice = parsed.choices[0];
    if (!isRecord(choice) || !isRecord(choice.message)) return null;
    const content = choice.message.content;
    if (
      typeof content !== "string" ||
      !content.trim() ||
      content.length > limits.maxCharacters
    ) {
      return null;
    }
    return content;
  } catch {
    return null;
  }
}

async function cancelResponseBody(
  body: ReadableStream<Uint8Array> | null,
  reason: string,
) {
  if (!body) return;
  await body.cancel(reason).catch(() => undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
