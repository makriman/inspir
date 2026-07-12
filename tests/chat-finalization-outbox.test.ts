import assert from "node:assert/strict";
import test from "node:test";
import {
  appendBoundedAssistantText,
  CHAT_FINALIZATION_ATTEMPTS_PER_DRAIN,
  CHAT_FINALIZATION_DRAIN_MAX_ITEMS,
  CHAT_FINALIZATION_OUTBOX_MAX_BYTES_PER_ACCOUNT,
  CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_GLOBAL,
  CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_PER_ACCOUNT,
  CHAT_FINALIZATION_OUTBOX_TTL_MS,
  CHAT_FINALIZATION_RETRY_DELAY_MS,
  createPendingChatFinalization,
  emptyBoundedAssistantText,
  MAX_CHAT_FINALIZATION_REQUEST_BYTES,
  MAX_CLIENT_FINALIZED_ASSISTANT_CHARS,
  MAX_CLIENT_FINALIZED_ASSISTANT_UTF8_BYTES,
  postPendingChatFinalization,
  reconcilePendingChatFinalizationMessages,
  retainBoundedChatFinalizations,
  retryPendingChatFinalizations,
  type ChatFinalizationOutbox,
  type PendingChatFinalization,
} from "../components/chat/chat-finalization-outbox";
import { getChatMessageRenderId, type ChatMessage } from "../components/chat/chat-message-model";
import {
  MAX_CLIENT_FINALIZED_ASSISTANT_CHARS as SERVER_FINALIZED_ASSISTANT_CHARS,
  MAX_PROTECTED_API_BODY_BYTES,
} from "../lib/free-runtime/protected-ai-api";

const accountA = "account-a";
const accountB = "account-b";
const chatId = uuid(900);
const userMessageId = uuid(901);

test("assistant accumulation is Unicode-safe and stops at both server character and body-byte caps", () => {
  assert.equal(MAX_CLIENT_FINALIZED_ASSISTANT_CHARS, SERVER_FINALIZED_ASSISTANT_CHARS);
  assert.equal(MAX_CHAT_FINALIZATION_REQUEST_BYTES, MAX_PROTECTED_API_BODY_BYTES);
  const ascii = appendBoundedAssistantText(
    emptyBoundedAssistantText(),
    "a".repeat(MAX_CLIENT_FINALIZED_ASSISTANT_CHARS + 500),
  );
  assert.equal(ascii.text.length, MAX_CLIENT_FINALIZED_ASSISTANT_CHARS);
  assert.equal(ascii.codeUnits, MAX_CLIENT_FINALIZED_ASSISTANT_CHARS);
  assert.equal(ascii.reachedLimit, true);

  const splitSurrogate = appendBoundedAssistantText(
    emptyBoundedAssistantText(),
    `${"a".repeat(MAX_CLIENT_FINALIZED_ASSISTANT_CHARS - 1)}🙂tail`,
  );
  assert.equal(splitSurrogate.text, "a".repeat(MAX_CLIENT_FINALIZED_ASSISTANT_CHARS - 1));
  assert.equal(splitSurrogate.text.endsWith("\ud83d"), false);
  assert.equal(splitSurrogate.reachedLimit, true);

  const invalidSurrogate = appendBoundedAssistantText(emptyBoundedAssistantText(), "ok\ud83d");
  assert.equal(invalidSurrogate.text, "ok\ufffd");

  const emoji = appendBoundedAssistantText(emptyBoundedAssistantText(), "🙂".repeat(8_000));
  assert.ok(emoji.codeUnits <= MAX_CLIENT_FINALIZED_ASSISTANT_CHARS);
  assert.ok(emoji.utf8Bytes <= MAX_CLIENT_FINALIZED_ASSISTANT_UTF8_BYTES);
  assert.equal([...emoji.text].every((character) => character === "🙂"), true);
  assert.equal(emoji.reachedLimit, true);

  let chunked = emptyBoundedAssistantText();
  for (let index = 0; index < 20; index += 1) {
    chunked = appendBoundedAssistantText(chunked, "界".repeat(500));
  }
  assert.ok(chunked.codeUnits <= MAX_CLIENT_FINALIZED_ASSISTANT_CHARS);
  assert.ok(chunked.utf8Bytes <= MAX_CLIENT_FINALIZED_ASSISTANT_UTF8_BYTES);
  assert.equal(chunked.reachedLimit, true);
});

test("pending finalizations validate exact identifiers and bounded request content", () => {
  const item = pending({ accountId: accountA, index: 1, now: 10_000, content: "A saved answer" });
  assert.equal(item.id, item.aiRunId);
  assert.equal(item.expiresAt, item.createdAt + CHAT_FINALIZATION_OUTBOX_TTL_MS);
  assert.ok(item.byteSize < MAX_CHAT_FINALIZATION_REQUEST_BYTES);

  assert.equal(
    createPendingChatFinalization(
      {
        accountId: accountA,
        aiRunId: uuid(2),
        chatId,
        userMessageId,
        temporaryMessageId: "local-assistant-2",
        content: "x".repeat(MAX_CLIENT_FINALIZED_ASSISTANT_CHARS + 1),
      },
      10_000,
    ),
    null,
  );
  assert.equal(
    createPendingChatFinalization(
      {
        accountId: accountA,
        aiRunId: "not-a-uuid",
        chatId,
        userMessageId,
        temporaryMessageId: "local-assistant-2",
        content: "answer",
      },
      10_000,
    ),
    null,
  );
});

test("retention enforces TTL plus per-account and global caps without crossing account scope", () => {
  const now = 10_000_000;
  const items = [
    ...Array.from({ length: 12 }, (_, index) =>
      pending({ accountId: accountA, index: index + 10, now: now + index }),
    ),
    ...Array.from({ length: 12 }, (_, index) =>
      pending({ accountId: accountB, index: index + 100, now: now + index }),
    ),
    pending({ accountId: "expired", index: 500, now: now - CHAT_FINALIZATION_OUTBOX_TTL_MS - 1 }),
  ];
  const retained = retainBoundedChatFinalizations(items, now + 100);
  assert.ok(retained.length <= CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_GLOBAL);
  assert.ok(
    retained.filter((item) => item.accountId === accountA).length <=
      CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_PER_ACCOUNT,
  );
  assert.ok(
    retained.filter((item) => item.accountId === accountB).length <=
      CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_PER_ACCOUNT,
  );
  assert.equal(retained.some((item) => item.accountId === "expired"), false);
  assert.equal(new Set(retained.map((item) => item.id)).size, retained.length);

  const byteHeavy = retainBoundedChatFinalizations(
    Array.from({ length: CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_PER_ACCOUNT }, (_, index) =>
      pending({
        accountId: "byte-heavy",
        index: 300 + index,
        now: now + index,
        content: "界".repeat(6_000),
      }),
    ),
    now + 100,
  );
  assert.ok(byteHeavy.length < CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_PER_ACCOUNT);
  assert.ok(
    byteHeavy.reduce((total, item) => total + item.byteSize, 0) <=
      CHAT_FINALIZATION_OUTBOX_MAX_BYTES_PER_ACCOUNT,
  );
});

test("bounded retry keeps failures, removes only authoritative success, and never touches another account", async () => {
  const now = 100_000;
  const outbox = new MemoryFinalizationOutbox();
  const itemA = pending({ accountId: accountA, index: 600, now });
  const itemB = pending({ accountId: accountB, index: 601, now });
  await outbox.enqueue(itemA, now);
  await outbox.enqueue(itemB, now);
  let posts = 0;
  const sleeps: number[] = [];
  const reconciled: Array<[string, string]> = [];
  const result = await retryPendingChatFinalizations({
    outbox,
    accountId: accountA,
    force: true,
    now: () => now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    post: async (item) => {
      assert.equal(item.accountId, accountA);
      posts += 1;
      if (posts === 1) throw new Error("offline");
      return uuid(700);
    },
    onSuccess(item, assistantMessageId) {
      reconciled.push([item.id, assistantMessageId]);
    },
  });

  assert.deepEqual(result, { attempted: 2, succeeded: 1, pending: 0 });
  assert.deepEqual(sleeps, [CHAT_FINALIZATION_RETRY_DELAY_MS]);
  assert.deepEqual(reconciled, [[itemA.id, uuid(700)]]);
  assert.equal(outbox.removeCalls, 1);
  assert.deepEqual((await outbox.list(accountA, now)).map((item) => item.id), []);
  assert.deepEqual((await outbox.list(accountB, now)).map((item) => item.id), [itemB.id]);
});

test("outbox success reconciles only the matching account, chat, temporary row, and AI run", () => {
  const item = pending({ accountId: accountA, index: 750, now: 150_000 });
  const temporary: ChatMessage = {
    id: item.temporaryMessageId,
    role: "assistant",
    content: item.content,
    createdAt: "2026-07-12T12:00:00.000Z",
    metadata: { aiRunId: item.aiRunId },
  };
  const renderId = getChatMessageRenderId(temporary);
  const reconciled = reconcilePendingChatFinalizationMessages({
    currentAccountId: accountA,
    currentChatId: item.chatId,
    messages: [temporary],
    pending: item,
    persistedAssistantMessageId: uuid(751),
  });
  assert.ok(reconciled);
  const persisted = reconciled[0];
  assert.ok(persisted);
  assert.equal(persisted.id, uuid(751));
  assert.equal(getChatMessageRenderId(persisted), renderId);

  assert.equal(
    reconcilePendingChatFinalizationMessages({
      currentAccountId: accountB,
      currentChatId: item.chatId,
      messages: [temporary],
      pending: item,
      persistedAssistantMessageId: uuid(751),
    }),
    null,
  );
  assert.equal(
    reconcilePendingChatFinalizationMessages({
      currentAccountId: accountA,
      currentChatId: uuid(752),
      messages: [temporary],
      pending: item,
      persistedAssistantMessageId: uuid(751),
    }),
    null,
  );
  assert.equal(
    reconcilePendingChatFinalizationMessages({
      currentAccountId: accountA,
      currentChatId: item.chatId,
      messages: [{ ...temporary, metadata: { aiRunId: uuid(753) } }],
      pending: item,
      persistedAssistantMessageId: uuid(751),
    }),
    null,
  );
});

test("failed drains are finite and retain every pending record for a later trigger", async () => {
  const now = 200_000;
  const outbox = new MemoryFinalizationOutbox();
  for (let index = 0; index < CHAT_FINALIZATION_DRAIN_MAX_ITEMS + 2; index += 1) {
    await outbox.enqueue(pending({ accountId: accountA, index: 800 + index, now: now + index }), now);
  }
  const result = await retryPendingChatFinalizations({
    outbox,
    accountId: accountA,
    force: true,
    now: () => now + 10,
    sleep: async () => undefined,
    post: async () => {
      throw new Error("still offline");
    },
  });
  assert.equal(
    result.attempted,
    CHAT_FINALIZATION_DRAIN_MAX_ITEMS * CHAT_FINALIZATION_ATTEMPTS_PER_DRAIN,
  );
  assert.equal(result.succeeded, 0);
  assert.equal(result.pending, CHAT_FINALIZATION_DRAIN_MAX_ITEMS + 2);
  assert.equal(outbox.removeCalls, 0);
  assert.ok((await outbox.list(accountA, now + 10)).some((item) => item.attempts === 2));
});

test("HTTP finalization resolves only an authoritative bounded success payload", async () => {
  const item = pending({ accountId: accountA, index: 950, now: 300_000 });
  let requestBody = "";
  const assistantMessageId = await postPendingChatFinalization(
    item,
    async (_input, init) => {
      requestBody = typeof init?.body === "string" ? init.body : "";
      return Response.json({ ok: true, assistantMessageId: uuid(951) });
    },
  );
  assert.equal(assistantMessageId, uuid(951));
  assert.ok(new TextEncoder().encode(requestBody).byteLength <= MAX_CHAT_FINALIZATION_REQUEST_BYTES);
  const parsed: unknown = JSON.parse(requestBody);
  assert.deepEqual(parsed, {
    aiRunId: item.aiRunId,
    chatId: item.chatId,
    userMessageId: item.userMessageId,
    content: item.content,
  });

  await assert.rejects(
    postPendingChatFinalization(item, async () => Response.json({ assistantMessageId: uuid(952) })),
    /could not be saved/,
  );
  await assert.rejects(
    postPendingChatFinalization(
      item,
      async () => Response.json({ ok: true, assistantMessageId: "not-a-uuid" }),
    ),
    /could not be saved/,
  );
});

class MemoryFinalizationOutbox implements ChatFinalizationOutbox {
  private items: PendingChatFinalization[] = [];
  removeCalls = 0;

  async enqueue(item: PendingChatFinalization, now = Date.now()) {
    this.items = retainBoundedChatFinalizations([...this.items, item], now);
  }

  async list(accountId: string, now = Date.now()) {
    this.items = retainBoundedChatFinalizations(this.items, now);
    return this.items.filter((item) => item.accountId === accountId);
  }

  async recordFailure(id: string, accountId: string, attempts: number, nextAttemptAt: number) {
    this.items = this.items.map((item) =>
      item.id === id && item.accountId === accountId
        ? { ...item, attempts, nextAttemptAt }
        : item,
    );
  }

  async removeAfterSuccess(id: string, accountId: string) {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id || item.accountId !== accountId);
    if (this.items.length !== before) this.removeCalls += 1;
  }
}

function pending(input: {
  accountId: string;
  index: number;
  now: number;
  content?: string;
}) {
  const item = createPendingChatFinalization(
    {
      accountId: input.accountId,
      aiRunId: uuid(input.index),
      chatId,
      userMessageId,
      temporaryMessageId: `local-assistant-${input.index}`,
      content: input.content ?? `Answer ${input.index}`,
    },
    input.now,
  );
  assert.ok(item);
  return item;
}

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}
