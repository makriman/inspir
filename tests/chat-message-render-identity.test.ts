import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getChatMessageRenderId,
  reconcilePersistedChatMessageId,
  type ChatMessage,
} from "../components/chat/chat-message-model";

test("persisting a streamed assistant message preserves its client render identity", () => {
  const temporaryMessage: ChatMessage = {
    id: "local-assistant-1",
    role: "assistant",
    content: "A streamed answer",
    createdAt: "2026-07-12T12:00:00.000Z",
  };
  const unrelatedMessage: ChatMessage = {
    id: "persisted-user-1",
    role: "user",
    content: "A question",
    createdAt: "2026-07-12T11:59:59.000Z",
  };

  const renderIdBeforePersistence = getChatMessageRenderId(temporaryMessage);
  const persistedMessage = reconcilePersistedChatMessageId(
    temporaryMessage,
    temporaryMessage.id,
    "persisted-assistant-1",
  );

  assert.equal(persistedMessage.id, "persisted-assistant-1");
  assert.equal(getChatMessageRenderId(persistedMessage), renderIdBeforePersistence);
  assert.equal(
    reconcilePersistedChatMessageId(unrelatedMessage, temporaryMessage.id, "persisted-assistant-1"),
    unrelatedMessage,
  );
});

test("the standard chat message list keys rows by stable client render identity", () => {
  const source = fs.readFileSync(
    path.resolve("components/chat/StandardChatWorkspace.tsx"),
    "utf8",
  );

  assert.match(source, /key=\{getChatMessageRenderId\(message\)\}/);
  assert.doesNotMatch(source, /key=\{message\.id\}/);
});
