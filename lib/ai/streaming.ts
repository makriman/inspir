export type LearningStreamFinishEvent = {
  text: string;
  finishReason: LearningFinishReason;
  totalUsage: LearningTokenUsage | null;
};

export type LearningFinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";

export type LearningTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type LearningTextStreamOptions = {
  failureBody?: unknown;
  failureStatus?: number;
  headers?: HeadersInit;
  onError?: (error: unknown) => Promise<void> | void;
  onFinish?: (event: LearningStreamFinishEvent) => Promise<void> | void;
  partialErrorText?: string;
  status?: number;
  statusText?: string;
};

type StreamTextLike = {
  fullStream: ReadableStream<unknown>;
};

const defaultFailureBody = { error: "The assistant could not answer right now." };
const defaultPartialErrorText = "\n\nI could not finish the answer right now. Please try again.";

export async function createLearningTextStreamResponse(
  result: StreamTextLike,
  options: LearningTextStreamOptions = {},
) {
  const reader = result.fullStream.getReader();
  const state = createStreamState();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const delta = readTextDelta(value, state);
      if (delta) return createStreamingResponse(reader, state, delta, options);

      if (state.error) {
        await options.onError?.(state.error);
        return createFailureResponse(options);
      }
    }

    const error = state.error ?? new Error("AI stream finished without assistant text.");
    await options.onError?.(error);
    return createFailureResponse(options);
  } catch (error) {
    await options.onError?.(error);
    return createFailureResponse(options);
  }
}

function createStreamingResponse(
  reader: ReadableStreamDefaultReader<unknown>,
  state: StreamState,
  initialText: string,
  options: LearningTextStreamOptions,
) {
  const encoder = new TextEncoder();
  let finalized = false;
  const finalizeError = async (error: unknown) => {
    if (finalized) return;
    finalized = true;
    await options.onError?.(error);
  };
  const finalizeFinish = async (event: LearningStreamFinishEvent) => {
    if (finalized) return;
    finalized = true;
    try {
      await options.onFinish?.(event);
    } catch (error) {
      await options.onError?.(error);
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(initialText));

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const delta = readTextDelta(value, state);
          if (delta) controller.enqueue(encoder.encode(delta));

          if (state.error) {
            controller.enqueue(encoder.encode(options.partialErrorText ?? defaultPartialErrorText));
            break;
          }
        }

        if (state.error || state.finishReason === "error" || state.text.trim().length === 0) {
          await finalizeError(state.error ?? new Error("AI stream ended without a completed answer."));
        } else {
          await finalizeFinish({
            text: state.text,
            finishReason: state.finishReason,
            totalUsage: state.totalUsage,
          });
        }

        controller.close();
      } catch (error) {
        await finalizeError(error);
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await finalizeError(normalizeCancellationReason(reason));
      await reader.cancel(reason).catch(() => {});
    },
  });

  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) headers.set("content-type", "text/plain; charset=utf-8");

  return new Response(stream, {
    status: options.status ?? 200,
    statusText: options.statusText,
    headers,
  });
}

function normalizeCancellationReason(reason: unknown) {
  if (reason instanceof Error) return reason;
  const suffix = typeof reason === "string" && reason.trim() ? `: ${reason}` : "";
  return new Error(`AI stream cancelled before completion${suffix}`);
}

function createFailureResponse(options: LearningTextStreamOptions) {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(options.failureBody ?? defaultFailureBody), {
    status: options.failureStatus ?? 500,
    headers,
  });
}

type StreamState = {
  error: unknown;
  finishReason: LearningFinishReason;
  text: string;
  totalUsage: LearningTokenUsage | null;
};

function createStreamState(): StreamState {
  return {
    error: null as unknown,
    finishReason: "other",
    text: "",
    totalUsage: null,
  };
}

function readTextDelta(part: unknown, state: StreamState) {
  if (!part || typeof part !== "object" || !("type" in part)) return "";
  const streamPart = part as Record<string, unknown>;

  if (streamPart.type === "text-delta" && typeof streamPart.text === "string") {
    state.text += streamPart.text;
    return streamPart.text;
  }
  if (streamPart.type === "error") {
    state.error = streamPart.error ?? new Error("AI stream failed.");
    return "";
  }
  if (streamPart.type === "finish") {
    state.finishReason = isFinishReason(streamPart.finishReason) ? streamPart.finishReason : "other";
    state.totalUsage = normalizeTokenUsage(streamPart.totalUsage);
  }
  return "";
}

function isFinishReason(value: unknown): value is LearningFinishReason {
  return (
    value === "stop" ||
    value === "length" ||
    value === "content-filter" ||
    value === "tool-calls" ||
    value === "error" ||
    value === "other"
  );
}

function normalizeTokenUsage(value: unknown): LearningTokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  return {
    inputTokens: typeof usage.inputTokens === "number" ? usage.inputTokens : undefined,
    outputTokens: typeof usage.outputTokens === "number" ? usage.outputTokens : undefined,
    totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : undefined,
  };
}
