import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryDailySynthesisQueueMessage,
  createMemoryPostTurnQueueMessage,
  dispatchMemoryPostTurn,
  enqueueDueMemorySynthesis,
  maxMemoryQueueMessageBytes,
  memoryQueueMessageByteLength,
  processMemoryQueueBatch,
  processMemoryPostTurnQueueBatch,
  type MemoryPostTurnQueueMessage,
  type MemoryQueueMessage,
} from "../lib/ai/memory-queue";

test("memory post-turn dispatcher sends JSON messages to Cloudflare Queues", async () => {
  const sent: Array<{ message: MemoryQueueMessage; contentType?: QueueContentType }> = [];
  const result = await dispatchMemoryPostTurn(sampleMessage(), {
    logger: silentLogger,
    queue: {
      async send(message, options) {
        sent.push({ message, contentType: options?.contentType });
        return queueSendResponse();
      },
    },
  });

  assert.equal(result, "queued");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.contentType, "json");
  assert.equal(sent[0]?.message.type, "memory.post_turn.v2");
});

test("memory post-turn queue messages stay below Cloudflare Queue payload limits", () => {
  const message = createMemoryPostTurnQueueMessage({
    aiRunId: "a".repeat(120),
    userId: "u".repeat(120),
    chatId: "c".repeat(120),
    topic: {
      id: "t".repeat(120),
      name: "Algebra ".repeat(30).slice(0, 240),
      slug: "algebra-".repeat(30).slice(0, 240),
    },
    userMessageId: "m".repeat(120),
    assistantMessageId: "a".repeat(120),
    contextMessageIds: Array.from({ length: 40 }, (_, index) => `ctx-${String(index).padStart(2, "0")}-${"x".repeat(112)}`),
  });

  assert.ok(memoryQueueMessageByteLength(message) < 128 * 1024);
  assert.ok(memoryQueueMessageByteLength(message) <= maxMemoryQueueMessageBytes);
});

test("memory daily synthesis enqueuer sends due users to Cloudflare Queues", async () => {
  const sent: Array<{ message: MemoryQueueMessage; contentType?: QueueContentType }> = [];
  const stats = await enqueueDueMemorySynthesis({} as CloudflareEnv, {
    logger: silentLogger,
    limit: 50,
    lister: async (limit) => {
      assert.equal(limit, 25);
      return [{ userId: "user-a" }, { userId: "user-b" }];
    },
    queue: {
      async send(message, options) {
        sent.push({ message, contentType: options?.contentType });
        return queueSendResponse();
      },
    },
    reason: "daily_cron",
  });

  assert.deepEqual(
    { due: stats.due, queued: stats.queued, failed: stats.failed, skipped: stats.skipped },
    { due: 2, queued: 2, failed: 0, skipped: null },
  );
  assert.deepEqual(
    sent.map((entry) => [
      entry.message.type,
      "userId" in entry.message ? entry.message.userId : null,
      entry.contentType,
    ]),
    [
      ["memory.daily_synthesis.v1", "user-a", "json"],
      ["memory.daily_synthesis.v1", "user-b", "json"],
    ],
  );
});

test("memory daily synthesis enqueuer respects write freeze", async () => {
  let listed = false;
  const stats = await enqueueDueMemorySynthesis({ APP_WRITE_FREEZE: "1" } as CloudflareEnv, {
    logger: silentLogger,
    lister: async () => {
      listed = true;
      return [{ userId: "user-a" }];
    },
    queue: {
      async send() {
        throw new Error("queue should not be called during write freeze");
      },
    },
  });

  assert.equal(listed, false);
  assert.deepEqual(
    { due: stats.due, queued: stats.queued, failed: stats.failed, skipped: stats.skipped },
    { due: 0, queued: 0, failed: 0, skipped: "write_freeze_active" },
  );
});

test("memory post-turn dispatcher drops noncritical memory work when no queue binding is available", async () => {
  const result = await dispatchMemoryPostTurn(sampleMessage(), {
    logger: silentLogger,
    queue: null,
  });

  assert.equal(result, "dropped");
});

test("memory post-turn dispatcher drops noncritical memory work when queue send fails", async () => {
  const warnings: unknown[] = [];
  const result = await dispatchMemoryPostTurn(sampleMessage(), {
    logger: {
      log() {},
      warn(...args: unknown[]) {
        warnings.push(args);
      },
    },
    queue: {
      async send() {
        throw new Error("queue unavailable");
      },
    },
  });

  assert.equal(result, "dropped");
  assert.equal(warnings.some((entry) => JSON.stringify(entry).includes("queue_send_failed")), true);
});

test("memory queue consumer rehydrates v2 post-turn jobs", async () => {
  const invalid = fakeMessage({ bad: true });
  const valid = fakeMessage(sampleMessage());
  const processed: string[] = [];
  const rehydrated: string[] = [];

  await processMemoryPostTurnQueueBatch(fakeBatch([invalid, valid]), {} as CloudflareEnv, {
    logger: silentLogger,
    postTurnRehydrator: async (message) => {
      rehydrated.push(message.assistantMessageId);
      return sampleProcessorInput(message);
    },
    processor: async (input) => {
      processed.push(input.assistantMessage.id);
    },
  });

  assert.equal(invalid.acked, true);
  assert.equal(invalid.retried, false);
  assert.equal(valid.acked, true);
  assert.equal(valid.retried, false);
  assert.deepEqual(rehydrated, ["assistant-message"]);
  assert.deepEqual(processed, ["assistant-message"]);
});

test("memory queue consumer still accepts in-flight v1 post-turn jobs", async () => {
  const valid = fakeMessage(sampleV1Message());
  const processed: string[] = [];

  await processMemoryPostTurnQueueBatch(fakeBatch([valid]), {} as CloudflareEnv, {
    logger: silentLogger,
    processor: async (input) => {
      processed.push(input.assistantMessage.content);
    },
  });

  assert.equal(valid.acked, true);
  assert.equal(valid.retried, false);
  assert.deepEqual(processed, ["Got it. I will use visual examples."]);
});

test("memory queue consumer processes daily synthesis jobs", async () => {
  const daily = fakeMessage(createMemoryDailySynthesisQueueMessage({ userId: "user-a", reason: "daily_cron" }));
  const synthesized: Array<{ userId: string; reason: string }> = [];

  await processMemoryQueueBatch(fakeBatch([daily]), {} as CloudflareEnv, {
    dailySynthesizer: async (userId, reason) => {
      synthesized.push({ userId, reason });
    },
    logger: silentLogger,
    processor: async () => {
      throw new Error("post-turn processor should not run for daily synthesis jobs");
    },
  });

  assert.equal(daily.acked, true);
  assert.equal(daily.retried, false);
  assert.deepEqual(synthesized, [{ userId: "user-a", reason: "daily_cron" }]);
});

test("memory queue consumer retries failed jobs without acknowledging them", async () => {
  const failed = fakeMessage(sampleMessage(), { attempts: 2 });

  await processMemoryPostTurnQueueBatch(fakeBatch([failed]), {} as CloudflareEnv, {
    logger: silentLogger,
    postTurnRehydrator: async (message) => sampleProcessorInput(message),
    processor: async () => {
      throw new Error("temporary failure");
    },
  });

  assert.equal(failed.acked, false);
  assert.equal(failed.retried, true);
  assert.deepEqual(failed.retryOptions, { delaySeconds: 60 });
});

const silentLogger = {
  log() {},
  warn() {},
};

function sampleMessage() {
  return createMemoryPostTurnQueueMessage({
    aiRunId: "ai-run",
    userId: "user",
    chatId: "chat",
    topic: {
      id: "topic",
      name: "Algebra",
      slug: "algebra",
    },
    userMessageId: "user-message",
    assistantMessageId: "assistant-message",
    contextMessageIds: ["context-message"],
  });
}

function sampleProcessorInput(message: MemoryPostTurnQueueMessage) {
  return {
    userId: message.userId,
    chatId: message.chatId,
    topic: message.topic,
    userMessage: {
      id: message.userMessageId,
      role: "user",
      content: "Please remember I prefer visual examples.",
    },
    assistantMessage: {
      id: message.assistantMessageId,
      role: "assistant",
      content: "Got it. I will use visual examples.",
    },
    contextMessages: [
      {
        id: "context-message",
        role: "user",
        content: "I like diagrams.",
      },
    ],
  };
}

function sampleV1Message() {
  return {
    type: "memory.post_turn.v1",
    enqueuedAt: new Date().toISOString(),
    aiRunId: "ai-run",
    userId: "user",
    chatId: "chat",
    topic: {
      id: "topic",
      name: "Algebra",
      slug: "algebra",
    },
    userMessage: {
      id: "user-message",
      role: "user",
      content: "Please remember I prefer visual examples.",
    },
    assistantMessage: {
      id: "assistant-message",
      role: "assistant",
      content: "Got it. I will use visual examples.",
    },
    contextMessages: [],
  };
}

function fakeBatch(messages: Array<FakeMessage<unknown>>) {
  return {
    messages,
    queue: "inspirlearning-memory-post-turn-prod",
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    ackAll() {},
    retryAll() {},
  } as MessageBatch<unknown>;
}

type FakeMessage<Body> = Message<Body> & {
  acked: boolean;
  retried: boolean;
  retryOptions: QueueRetryOptions | null;
};

function fakeMessage<Body>(body: Body, options: { attempts?: number } = {}): FakeMessage<Body> {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    body,
    attempts: options.attempts ?? 1,
    acked: false,
    retried: false,
    retryOptions: null,
    ack() {
      this.acked = true;
    },
    retry(retryOptions) {
      this.retried = true;
      this.retryOptions = retryOptions ?? null;
    },
  };
}

function queueSendResponse(): QueueSendResponse {
  return {
    metadata: {
      metrics: {
        backlogCount: 0,
        backlogBytes: 0,
      },
    },
  };
}
