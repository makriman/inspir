import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { isWriteFreezeEnabled } from "@/lib/migration/write-freeze";
import { getChatMessagesByIds } from "../db/queries";
import { listUsersDueForMemorySynthesis } from "../db/memory";
import { runWithRuntimeCloudflareEnv } from "../runtime/cloudflare";
import { processMemoryAfterTurn, synthesizeUserMemory } from "./memory";
import type {
  MemoryVectorCleanupQueueMessage as MemoryVectorCleanupQueueContract,
} from "../free-runtime/memory-queue-contract";

export const maxMemoryQueueMessageBytes = 120 * 1024;

const persistedMessageSchema = z.object({
  id: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(40),
  content: z.string().max(120_000),
});

const memoryTopicSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  slug: z.string().trim().min(1).max(240),
});

const memoryPostTurnQueueMessageV1Schema = z.object({
  type: z.literal("memory.post_turn.v1"),
  enqueuedAt: z.string().datetime(),
  aiRunId: z.string().trim().min(1).max(120),
  userId: z.string().trim().min(1).max(120),
  chatId: z.string().trim().min(1).max(120),
  topic: memoryTopicSchema,
  userMessage: persistedMessageSchema,
  assistantMessage: persistedMessageSchema,
  contextMessages: z.array(persistedMessageSchema).max(40),
});

const messageIdSchema = z.string().trim().min(1).max(120);

const memoryPostTurnQueueMessageV2Schema = z.object({
  type: z.literal("memory.post_turn.v2"),
  enqueuedAt: z.string().datetime(),
  aiRunId: z.string().trim().min(1).max(120),
  userId: z.string().trim().min(1).max(120),
  chatId: z.string().trim().min(1).max(120),
  topic: memoryTopicSchema,
  userMessageId: messageIdSchema,
  assistantMessageId: messageIdSchema,
  contextMessageIds: z.array(messageIdSchema).max(40),
});

const memoryDailySynthesisQueueMessageSchema = z.object({
  type: z.literal("memory.daily_synthesis.v1"),
  enqueuedAt: z.string().datetime(),
  userId: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(80),
});

const memoryVectorCleanupQueueMessageSchema = z.object({
  type: z.literal("memory.vector_cleanup.v1"),
  enqueuedAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(80),
});

const memoryQueueMessageSchema = z.discriminatedUnion("type", [
  memoryPostTurnQueueMessageV1Schema,
  memoryPostTurnQueueMessageV2Schema,
  memoryDailySynthesisQueueMessageSchema,
  memoryVectorCleanupQueueMessageSchema,
]);

export type MemoryPostTurnQueueMessageV1 = z.infer<typeof memoryPostTurnQueueMessageV1Schema>;
export type MemoryPostTurnQueueMessage = z.infer<typeof memoryPostTurnQueueMessageV2Schema>;
export type MemoryDailySynthesisQueueMessage = z.infer<typeof memoryDailySynthesisQueueMessageSchema>;
export type MemoryVectorCleanupQueueMessage =
  z.infer<typeof memoryVectorCleanupQueueMessageSchema> & MemoryVectorCleanupQueueContract;
export type MemoryQueueMessage = z.infer<typeof memoryQueueMessageSchema>;
export type MemoryPostTurnDispatchResult = "queued" | "dropped";

type QueueProducer = Pick<Queue<MemoryQueueMessage>, "send">;

type Logger = Pick<typeof console, "log" | "warn">;
type MemoryProcessorInput = Parameters<typeof processMemoryAfterTurn>[0];
type MemoryProcessor = (input: MemoryProcessorInput) => Promise<void>;
type PostTurnRehydrator = (message: MemoryPostTurnQueueMessage) => Promise<MemoryProcessorInput>;
type DailySynthesizer = (userId: string, reason: string) => Promise<unknown>;
type DueUserLister = (limit: number) => Promise<Array<{ userId: string }>>;

export type MemoryDailySynthesisEnqueueStats = {
  due: number;
  queued: number;
  failed: number;
  skipped: string | null;
  errors: Array<{ userId: string; error: string }>;
};

export function createMemoryPostTurnQueueMessage(
  input: Omit<MemoryPostTurnQueueMessage, "type" | "enqueuedAt">,
): MemoryPostTurnQueueMessage {
  return {
    type: "memory.post_turn.v2",
    enqueuedAt: new Date().toISOString(),
    ...input,
    contextMessageIds: input.contextMessageIds.slice(-40),
  };
}

export function createMemoryDailySynthesisQueueMessage(input: {
  userId: string;
  reason?: string;
}): MemoryDailySynthesisQueueMessage {
  return {
    type: "memory.daily_synthesis.v1",
    enqueuedAt: new Date().toISOString(),
    userId: input.userId,
    reason: input.reason ?? "daily_cron",
  };
}

export async function dispatchMemoryPostTurn(
  message: MemoryPostTurnQueueMessage,
  options: {
    logger?: Logger;
    queue?: QueueProducer | null;
  } = {},
): Promise<MemoryPostTurnDispatchResult> {
  const logger = options.logger ?? console;
  const queue = options.queue === undefined ? getMemoryQueueFromRequestContext() : options.queue;
  const messageBytes = memoryQueueMessageByteLength(message);
  let dropReason = "missing_queue_binding";

  if (messageBytes > maxMemoryQueueMessageBytes) {
    logger.warn("memory_post_turn_queue_message_too_large", {
      aiRunId: message.aiRunId,
      bytes: messageBytes,
      maxBytes: maxMemoryQueueMessageBytes,
    });
    return "dropped";
  }

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
      dropReason = "queue_send_failed";
      logger.warn("memory_post_turn_queue_send_failed", {
        aiRunId: message.aiRunId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.warn("memory_post_turn_dropped", { aiRunId: message.aiRunId, reason: dropReason });
  return "dropped";
}

export async function enqueueDueMemorySynthesis(
  env: Partial<CloudflareEnv>,
  options: {
    limit?: number;
    logger?: Logger;
    lister?: DueUserLister;
    queue?: QueueProducer | null;
    reason?: string;
  } = {},
): Promise<MemoryDailySynthesisEnqueueStats> {
  const logger = options.logger ?? console;
  const limit = normalizeMemorySynthesisCronLimit(options.limit ?? 25);
  const stats: MemoryDailySynthesisEnqueueStats = {
    due: 0,
    queued: 0,
    failed: 0,
    skipped: null,
    errors: [],
  };

  if (isWriteFreezeEnabled(env as Record<string, string | undefined>)) {
    stats.skipped = "write_freeze_active";
    logger.warn("memory_daily_synthesis_enqueue_skipped", { reason: stats.skipped });
    return stats;
  }

  return runWithRuntimeCloudflareEnv(env, async () => {
    const lister = options.lister ?? listUsersDueForMemorySynthesis;
    const dueUsers = await lister(limit);
    stats.due = dueUsers.length;
    const queue = options.queue === undefined ? env.MEMORY_POST_TURN_QUEUE ?? null : options.queue;

    if (!queue) {
      stats.failed = dueUsers.length;
      stats.skipped = "missing_queue_binding";
      logger.warn("memory_daily_synthesis_enqueue_skipped", { reason: stats.skipped, due: stats.due });
      return stats;
    }

    for (const user of dueUsers) {
      try {
        await queue.send(
          createMemoryDailySynthesisQueueMessage({
            userId: user.userId,
            reason: options.reason ?? "daily_cron",
          }),
          { contentType: "json" },
        );
        stats.queued += 1;
      } catch (error) {
        stats.failed += 1;
        stats.errors.push({
          userId: user.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.log(JSON.stringify({ event: "memory_daily_synthesis_enqueued", ...stats }));
    return stats;
  });
}

export async function processMemoryQueueBatch(
  batch: MessageBatch<unknown>,
  env: CloudflareEnv,
  options: {
    dailySynthesizer?: DailySynthesizer;
    logger?: Logger;
    postTurnRehydrator?: PostTurnRehydrator;
    processor?: MemoryProcessor;
  } = {},
) {
  const logger = options.logger ?? console;
  const dailySynthesizer = options.dailySynthesizer ?? synthesizeUserMemory;
  const postTurnRehydrator = options.postTurnRehydrator ?? rehydrateMemoryPostTurnQueueMessage;
  const processor = options.processor ?? processMemoryAfterTurn;

  await runWithRuntimeCloudflareEnv(env, async () => {
    for (const message of batch.messages) {
      const parsed = memoryQueueMessageSchema.safeParse(message.body);
      if (!parsed.success) {
        logger.warn("memory_queue_invalid_message", {
          messageId: message.id,
          issues: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message),
        });
        message.ack();
        continue;
      }

      try {
        if (parsed.data.type === "memory.post_turn.v1" || parsed.data.type === "memory.post_turn.v2") {
          const processorInput =
            parsed.data.type === "memory.post_turn.v1"
              ? {
                  userId: parsed.data.userId,
                  chatId: parsed.data.chatId,
                  topic: parsed.data.topic,
                  userMessage: parsed.data.userMessage,
                  assistantMessage: parsed.data.assistantMessage,
                  contextMessages: parsed.data.contextMessages,
                }
              : await postTurnRehydrator(parsed.data);
          await processor(processorInput);
        } else if (parsed.data.type === "memory.daily_synthesis.v1") {
          await dailySynthesizer(parsed.data.userId, parsed.data.reason);
        } else {
          throw new Error("Vector cleanup jobs require the native Queue runtime");
        }
        message.ack();
        logger.log(
          JSON.stringify({
            event: "memory_queue_message_processed",
            type: parsed.data.type,
            aiRunId: parsed.data.type === "memory.post_turn.v1" ? parsed.data.aiRunId : null,
            userId: "userId" in parsed.data ? parsed.data.userId : null,
            messageId: message.id,
            attempts: message.attempts,
          }),
        );
      } catch (error) {
        logger.warn("memory_queue_message_processing_failed", {
          type: parsed.data.type,
          aiRunId: parsed.data.type === "memory.post_turn.v1" ? parsed.data.aiRunId : null,
          userId: "userId" in parsed.data ? parsed.data.userId : null,
          messageId: message.id,
          attempts: message.attempts,
          error: error instanceof Error ? error.message : String(error),
        });
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      }
    }
  });
}

export const processMemoryPostTurnQueueBatch = processMemoryQueueBatch;

async function rehydrateMemoryPostTurnQueueMessage(message: MemoryPostTurnQueueMessage): Promise<MemoryProcessorInput> {
  const messageIds = [message.userMessageId, message.assistantMessageId, ...message.contextMessageIds];
  const rows = await getChatMessagesByIds(message.chatId, messageIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const userMessage = byId.get(message.userMessageId);
  const assistantMessage = byId.get(message.assistantMessageId);

  if (!userMessage || userMessage.role !== "user") {
    throw new Error(`Missing queued user message ${message.userMessageId}`);
  }
  if (!assistantMessage || assistantMessage.role !== "assistant") {
    throw new Error(`Missing queued assistant message ${message.assistantMessageId}`);
  }

  return {
    userId: message.userId,
    chatId: message.chatId,
    topic: message.topic,
    userMessage,
    assistantMessage,
    contextMessages: message.contextMessageIds.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    }),
  };
}

export function memoryQueueMessageByteLength(message: MemoryQueueMessage) {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
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

function normalizeMemorySynthesisCronLimit(value: number) {
  if (!Number.isFinite(value)) return 25;
  return Math.min(25, Math.max(1, Math.floor(value)));
}
