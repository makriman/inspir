import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { processMemoryAfterTurn } from "./memory";
import { runWithRuntimeCloudflareEnv } from "../runtime/cloudflare";

export const memoryPostTurnQueueName = "inspirlearning-memory-post-turn-prod";

const persistedMessageSchema = z.object({
  id: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(40),
  content: z.string().max(120_000),
});

const memoryPostTurnQueueMessageSchema = z.object({
  type: z.literal("memory.post_turn.v1"),
  enqueuedAt: z.string().datetime(),
  aiRunId: z.string().trim().min(1).max(120),
  userId: z.string().trim().min(1).max(120),
  chatId: z.string().trim().min(1).max(120),
  topic: z.object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(240),
    slug: z.string().trim().min(1).max(240),
  }),
  userMessage: persistedMessageSchema,
  assistantMessage: persistedMessageSchema,
  contextMessages: z.array(persistedMessageSchema).max(40),
});

export type MemoryPostTurnQueueMessage = z.infer<typeof memoryPostTurnQueueMessageSchema>;
export type MemoryPostTurnDispatchResult = "queued" | "processed-inline" | "dropped";

type QueueProducer = Pick<Queue<MemoryPostTurnQueueMessage>, "send">;

type Logger = Pick<typeof console, "log" | "warn">;
type MemoryProcessor = (input: Parameters<typeof processMemoryAfterTurn>[0]) => Promise<void>;

export function createMemoryPostTurnQueueMessage(
  input: Omit<MemoryPostTurnQueueMessage, "type" | "enqueuedAt">,
): MemoryPostTurnQueueMessage {
  return {
    type: "memory.post_turn.v1",
    enqueuedAt: new Date().toISOString(),
    ...input,
    contextMessages: input.contextMessages.slice(-40),
  };
}

export async function dispatchMemoryPostTurn(
  message: MemoryPostTurnQueueMessage,
  options: {
    fallback?: () => Promise<void>;
    logger?: Logger;
    queue?: QueueProducer | null;
  } = {},
): Promise<MemoryPostTurnDispatchResult> {
  const logger = options.logger ?? console;
  const queue = options.queue === undefined ? getMemoryQueueFromRequestContext() : options.queue;

  if (queue) {
    try {
      await queue.send(message, { contentType: "json" });
      logger.log(
        JSON.stringify({
          event: "memory_post_turn_queued",
          aiRunId: message.aiRunId,
          chatId: message.chatId,
          userId: message.userId,
        }),
      );
      return "queued";
    } catch (error) {
      logger.warn("memory_post_turn_queue_send_failed", {
        aiRunId: message.aiRunId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (options.fallback) {
    await options.fallback();
    return "processed-inline";
  }

  logger.warn("memory_post_turn_dropped", { aiRunId: message.aiRunId, reason: "missing_queue_binding" });
  return "dropped";
}

export async function processMemoryPostTurnQueueBatch(
  batch: MessageBatch<unknown>,
  env: CloudflareEnv,
  options: {
    logger?: Logger;
    processor?: MemoryProcessor;
  } = {},
) {
  const logger = options.logger ?? console;
  const processor = options.processor ?? processMemoryAfterTurn;

  await runWithRuntimeCloudflareEnv(env, async () => {
    for (const message of batch.messages) {
      const parsed = memoryPostTurnQueueMessageSchema.safeParse(message.body);
      if (!parsed.success) {
        logger.warn("memory_post_turn_invalid_message", {
          messageId: message.id,
          issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message),
        });
        message.ack();
        continue;
      }

      try {
        await processor({
          userId: parsed.data.userId,
          chatId: parsed.data.chatId,
          topic: parsed.data.topic,
          userMessage: parsed.data.userMessage,
          assistantMessage: parsed.data.assistantMessage,
          contextMessages: parsed.data.contextMessages,
        });
        message.ack();
        logger.log(
          JSON.stringify({
            event: "memory_post_turn_processed",
            aiRunId: parsed.data.aiRunId,
            messageId: message.id,
            attempts: message.attempts,
          }),
        );
      } catch (error) {
        logger.warn("memory_post_turn_processing_failed", {
          aiRunId: parsed.data.aiRunId,
          messageId: message.id,
          attempts: message.attempts,
          error: error instanceof Error ? error.message : String(error),
        });
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      }
    }
  });
}

function getMemoryQueueFromRequestContext() {
  try {
    return getCloudflareContext().env.MEMORY_POST_TURN_QUEUE ?? null;
  } catch {
    return null;
  }
}

function retryDelaySeconds(attempts: number) {
  return Math.min(15 * 60, Math.max(30, attempts * 30));
}
