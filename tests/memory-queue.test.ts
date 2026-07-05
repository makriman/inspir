import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryPostTurnQueueMessage,
  dispatchMemoryPostTurn,
  processMemoryPostTurnQueueBatch,
  type MemoryPostTurnQueueMessage,
} from "../lib/ai/memory-queue";

test("memory post-turn dispatcher sends JSON messages to Cloudflare Queues", async () => {
  const sent: Array<{ message: MemoryPostTurnQueueMessage; contentType?: QueueContentType }> = [];
  const result = await dispatchMemoryPostTurn(sampleMessage(), {
    logger: silentLogger,
    queue: {
      async send(message, options) {
        sent.push({ message, contentType: options?.contentType });
        return queueSendResponse();
      },
    },
    fallback: async () => {
      throw new Error("fallback should not run when queue send succeeds");
    },
  });

  assert.equal(result, "queued");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.contentType, "json");
  assert.equal(sent[0]?.message.type, "memory.post_turn.v1");
});

test("memory post-turn dispatcher falls back when no queue binding is available", async () => {
  let fallbackCalls = 0;
  const result = await dispatchMemoryPostTurn(sampleMessage(), {
    logger: silentLogger,
    queue: null,
    fallback: async () => {
      fallbackCalls += 1;
    },
  });

  assert.equal(result, "processed-inline");
  assert.equal(fallbackCalls, 1);
});

test("memory queue consumer acks invalid messages and successful jobs", async () => {
  const invalid = fakeMessage({ bad: true });
  const valid = fakeMessage(sampleMessage());
  const processed: string[] = [];

  await processMemoryPostTurnQueueBatch(fakeBatch([invalid, valid]), {} as CloudflareEnv, {
    logger: silentLogger,
    processor: async (input) => {
      processed.push(input.assistantMessage.id);
    },
  });

  assert.equal(invalid.acked, true);
  assert.equal(invalid.retried, false);
  assert.equal(valid.acked, true);
  assert.equal(valid.retried, false);
  assert.deepEqual(processed, ["assistant-message"]);
});

test("memory queue consumer retries failed jobs without acknowledging them", async () => {
  const failed = fakeMessage(sampleMessage(), { attempts: 2 });

  await processMemoryPostTurnQueueBatch(fakeBatch([failed]), {} as CloudflareEnv, {
    logger: silentLogger,
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
  });
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
