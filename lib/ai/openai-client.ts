import { z, type ZodType } from "zod";
import { openAiProviderSettings } from "@/lib/ai/openai-provider";
import type { LearningFinishReason, LearningTokenUsage } from "@/lib/ai/streaming";

export type OpenAiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAiStreamPart =
  | { type: "text-delta"; text: string }
  | { type: "finish"; finishReason: LearningFinishReason; totalUsage: LearningTokenUsage | null }
  | { type: "error"; error: unknown };

type OpenAiChatStreamOptions = {
  maxOutputTokens?: number;
  messages: OpenAiChatMessage[];
  model: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  signal?: AbortSignal;
  temperature?: number;
};

type GenerateJsonObjectOptions<TSchema extends ZodType> = {
  abortSignal?: AbortSignal;
  maxRetries?: number;
  model: string;
  prompt: string;
  schema: TSchema;
  schemaName: string;
  system: string;
  temperature?: number;
};

type EmbedTextOptions = {
  abortSignal?: AbortSignal;
  dimensions?: number;
  model: string;
  value: string;
};

type OpenAiErrorBody = {
  error?: {
    message?: string;
    type?: string;
  };
};

const defaultBaseURL = "https://api.openai.com/v1";

export async function streamOpenAiChatCompletion(options: OpenAiChatStreamOptions) {
  const response = await openAiJsonFetch("chat/completions", {
    body: {
      model: options.model,
      messages: options.messages,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: options.maxOutputTokens,
      temperature: options.temperature,
      reasoning_effort: options.reasoningEffort,
    },
    signal: options.signal,
  });

  if (!response.body) throw new Error("OpenAI stream response did not include a body.");

  return {
    fullStream: createLearningEventStream(response.body),
  };
}

export async function generateOpenAiJsonObject<TSchema extends ZodType>(
  options: GenerateJsonObjectOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const schema = normalizeJsonSchema(z.toJSONSchema(options.schema));
  const messages = [
    {
      role: "system" as const,
      content: [
        options.system,
        "Return only a JSON object that validates against the requested schema.",
      ].join("\n"),
    },
    { role: "user" as const, content: options.prompt },
  ];
  const attempts = Math.max(0, options.maxRetries ?? 0) + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await openAiJsonFetch("chat/completions", {
        body: {
          model: options.model,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: sanitizeSchemaName(options.schemaName),
              strict: true,
              schema,
            },
          },
          max_completion_tokens: 2400,
          reasoning_effort: isOpenAiReasoningModel(options.model) ? "minimal" : undefined,
          temperature: isOpenAiReasoningModel(options.model) ? undefined : options.temperature,
        },
        signal: options.abortSignal,
      });
      return parseStructuredResponse(response, options.schema);
    } catch (error) {
      lastError = error;
    }

    try {
      const response = await openAiJsonFetch("chat/completions", {
        body: {
          model: options.model,
          messages: [
            {
              role: "system" as const,
              content: [
                options.system,
                "Return only JSON. Do not wrap it in markdown.",
                `JSON schema: ${JSON.stringify(schema)}`,
              ].join("\n"),
            },
            { role: "user" as const, content: options.prompt },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 2400,
          reasoning_effort: isOpenAiReasoningModel(options.model) ? "minimal" : undefined,
          temperature: isOpenAiReasoningModel(options.model) ? undefined : options.temperature,
        },
        signal: options.abortSignal,
      });
      return parseStructuredResponse(response, options.schema);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenAI structured generation failed.");
}

export async function embedOpenAiText(options: EmbedTextOptions) {
  const response = await openAiJsonFetch("embeddings", {
    body: {
      model: options.model,
      input: options.value,
      dimensions: options.dimensions,
    },
    signal: options.abortSignal,
  });
  const data = (await response.json()) as {
    data?: Array<{ embedding?: unknown }>;
  };
  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === "number")) {
    throw new Error("OpenAI embedding response did not include a numeric embedding.");
  }
  return embedding;
}

async function parseStructuredResponse<TSchema extends ZodType>(response: Response, schema: TSchema) {
  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI structured response did not include JSON content.");
  }
  const parsedJson = parseJsonPayload(content);
  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(`OpenAI structured response failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

function parseJsonPayload(content: string) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1]);
    throw new Error("OpenAI structured response was not valid JSON.");
  }
}

function createLearningEventStream(body: ReadableStream<Uint8Array>): ReadableStream<OpenAiStreamPart> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason: LearningFinishReason = "other";
  let totalUsage: LearningTokenUsage | null = null;

  return new ReadableStream<OpenAiStreamPart>({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          drainSseBuffer(buffer, (event, rest) => {
            buffer = rest;
            if (event === "[DONE]") return;
            const parsed = parseSseJson(event);
            if (!parsed) return;

            const usage = normalizeOpenAiUsage(parsed.usage);
            if (usage) totalUsage = usage;

            const choice = parsed.choices?.[0];
            const mappedFinishReason = normalizeOpenAiFinishReason(choice?.finish_reason);
            if (mappedFinishReason) finishReason = mappedFinishReason;

            const delta = choice?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              controller.enqueue({ type: "text-delta", text: delta });
            }
          });
        }

        const finalEvent = buffer.trim();
        if (finalEvent) {
          const dataLines = finalEvent
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim());
          for (const event of dataLines) {
            if (event === "[DONE]") continue;
            const parsed = parseSseJson(event);
            const usage = normalizeOpenAiUsage(parsed?.usage);
            if (usage) totalUsage = usage;
            const mappedFinishReason = normalizeOpenAiFinishReason(parsed?.choices?.[0]?.finish_reason);
            if (mappedFinishReason) finishReason = mappedFinishReason;
          }
        }

        controller.enqueue({ type: "finish", finishReason, totalUsage });
        controller.close();
      } catch (error) {
        controller.enqueue({ type: "error", error });
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
    },
  });
}

function drainSseBuffer(
  input: string,
  onEvent: (event: string, remainingBuffer: string) => void,
) {
  let cursor = input;
  while (true) {
    const separator = cursor.search(/\r?\n\r?\n/);
    if (separator === -1) {
      bufferRemainder(onEvent, cursor);
      return;
    }
    const rawEvent = cursor.slice(0, separator);
    const separatorLength = cursor.slice(separator).startsWith("\r\n\r\n") ? 4 : 2;
    cursor = cursor.slice(separator + separatorLength);
    const data = rawEvent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (data) onEvent(data, cursor);
  }
}

function bufferRemainder(
  onEvent: (event: string, remainingBuffer: string) => void,
  remainingBuffer: string,
) {
  onEvent("", remainingBuffer);
}

function parseSseJson(event: string) {
  if (!event) return null;
  try {
    return JSON.parse(event) as {
      choices?: Array<{
        delta?: { content?: unknown };
        finish_reason?: unknown;
      }>;
      usage?: unknown;
    };
  } catch {
    return null;
  }
}

function normalizeOpenAiFinishReason(value: unknown): LearningFinishReason | null {
  if (value === "stop") return "stop";
  if (value === "length") return "length";
  if (value === "content_filter") return "content-filter";
  if (value === "tool_calls") return "tool-calls";
  if (value === "error") return "error";
  if (value === "other") return "other";
  return null;
}

function normalizeOpenAiUsage(value: unknown): LearningTokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  const promptDetails =
    usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
      ? (usage.prompt_tokens_details as Record<string, unknown>)
      : null;
  const normalized: LearningTokenUsage = {};
  if (typeof promptDetails?.cached_tokens === "number") normalized.cachedInputTokens = promptDetails.cached_tokens;
  if (typeof usage.prompt_tokens === "number") normalized.inputTokens = usage.prompt_tokens;
  if (typeof usage.completion_tokens === "number") normalized.outputTokens = usage.completion_tokens;
  if (typeof usage.total_tokens === "number") normalized.totalTokens = usage.total_tokens;
  return normalized;
}

async function openAiJsonFetch(
  path: string,
  init: {
    body: Record<string, unknown>;
    signal?: AbortSignal;
  },
) {
  const settings = openAiProviderSettings();
  if (!settings.apiKey) throw new Error("OpenAI credentials are not configured.");
  const response = await fetch(openAiEndpoint(path, settings.baseURL), {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.apiKey}`,
      "content-type": "application/json",
      ...(settings.headers ?? {}),
    },
    body: JSON.stringify(stripUndefined(init.body)),
    signal: init.signal,
  });
  if (!response.ok) {
    throw new Error(await openAiErrorMessage(response));
  }
  return response;
}

async function openAiErrorMessage(response: Response) {
  let message = `OpenAI request failed with status ${response.status}`;
  try {
    const data = (await response.json()) as OpenAiErrorBody;
    if (data.error?.message) message = data.error.message;
    if (data.error?.type) message = `${message} (${data.error.type})`;
  } catch {
    const text = await response.text().catch(() => "");
    if (text.trim()) message = `${message}: ${text.slice(0, 500)}`;
  }
  return message;
}

function openAiEndpoint(path: string, baseURL = defaultBaseURL) {
  return `${baseURL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefined(entry)]),
  );
}

function normalizeJsonSchema(schema: unknown) {
  if (!schema || typeof schema !== "object") return schema;
  const rest = { ...(schema as Record<string, unknown>) };
  delete rest.$schema;
  return rest;
}

function sanitizeSchemaName(value: string) {
  const name = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return name || "structured_response";
}

function isOpenAiReasoningModel(model: string) {
  return (
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("o4-mini") ||
    (model.startsWith("gpt-5") && !model.startsWith("gpt-5-chat"))
  );
}
