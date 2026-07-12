import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getMessageContentNextOffset,
  type ChatMessage,
} from "../components/chat/chat-message-model";

test("saved-message continuation offsets accept only positive safe integers", () => {
  const message = (contentNextOffset: unknown): ChatMessage => ({
    id: "11111111-1111-4111-8111-111111111111",
    role: "assistant",
    content: "bounded content",
    createdAt: "2026-07-11T00:00:00.000Z",
    metadata: { contentNextOffset },
  });

  assert.equal(getMessageContentNextOffset(message(8_000)), 8_000);
  assert.equal(getMessageContentNextOffset(message(0)), null);
  assert.equal(getMessageContentNextOffset(message(8_000.5)), null);
  assert.equal(getMessageContentNextOffset(message("8000")), null);
});

test("saved-message recovery UI is bounded, append-only, and shared by non-standard workspaces", () => {
  const chatClient = fs.readFileSync(path.resolve("components/chat/ChatClient.tsx"), "utf8");
  const messageCard = fs.readFileSync(path.resolve("components/chat/MessageCard.tsx"), "utf8");
  const standardWorkspace = fs.readFileSync(
    path.resolve("components/chat/StandardChatWorkspace.tsx"),
    "utf8",
  );
  const compactTranscript = fs.readFileSync(
    path.resolve("components/chat/CompactTranscriptDetails.tsx"),
    "utf8",
  );

  assert.match(
    chatClient,
    /messageContentAbortControllersRef = useRef<Map<string, AbortController> \| null>\(null\)/,
  );
  assert.match(chatClient, /messageContentAbortControllersRef\.current = new Map<string, AbortController>\(\)/);
  assert.match(chatClient, /const messageContentAbortControllers = messageContentAbortControllersRef\.current/);
  assert.match(chatClient, /controllers\.size >= 4/);
  assert.match(chatClient, /\/messages\/\$\{encodeURIComponent\(messageId\)\}\?offset=\$\{offset\}/);
  assert.match(chatClient, /getMessageContentNextOffset\(currentMessage\) !== offset/);
  assert.match(chatClient, /content: `\$\{candidate\.content\}\$\{chunk\.content\}`/);
  assert.match(chatClient, /signal: controller\.signal/);
  assert.ok((chatClient.match(/\{transcriptDetails\}/g) ?? []).length >= 5);

  assert.match(messageCard, /navigator\.clipboard\.writeText\(message\.content\)/);
  assert.match(messageCard, /getMessageContentNextOffset\(message\)/);
  assert.match(messageCard, /continueLabel/);
  assert.match(standardWorkspace, /onContinueContent=\{onContinueMessageContent\}/);

  const translatedSources = [...compactTranscript.matchAll(/t\("([^"]+)"\)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(new Set(translatedSources), new Set(["Past chats", "Continue"]));
  assert.match(compactTranscript, /<details>/);
  assert.match(compactTranscript, /<MessageCard/);
  assert.match(compactTranscript, /onLoadOlderMessages/);
});

test("chat finalization is durable, bounded, account-scoped, and cancellation-aware", () => {
  const chatClient = fs.readFileSync(path.resolve("components/chat/ChatClient.tsx"), "utf8");
  const outbox = fs.readFileSync(
    path.resolve("components/chat/chat-finalization-outbox.ts"),
    "utf8",
  );
  const loadChatStart = chatClient.indexOf("async function loadChat");
  const loadChatEnd = chatClient.indexOf("async function resetChat", loadChatStart);
  const loadChat = chatClient.slice(loadChatStart, loadChatEnd);

  assert.match(chatClient, /createBrowserChatFinalizationOutbox\(window\.indexedDB\)/);
  assert.match(chatClient, /await outbox\.enqueue\(pendingFinalization\)/);
  assert.match(chatClient, /onlyId: pendingFinalization\.id/);
  assert.match(chatClient, /window\.addEventListener\("online", handleOnline\)/);
  assert.match(chatClient, /window\.removeEventListener\("online", handleOnline\)/);
  assert.match(chatClient, /appendBoundedAssistantText\(boundedAssistantText, addition\)/);
  assert.match(chatClient, /void reader\.cancel\("assistant_response_limit_reached"\)/);
  assert.match(chatClient, /controller\.abort\("assistant_response_limit_reached"\)/);
  assert.match(chatClient, /reconcilePendingChatFinalizationMessages/);

  assert.match(outbox, /const outboxDatabaseName = "inspir-chat-finalization-v1"/);
  assert.match(outbox, /CHAT_FINALIZATION_OUTBOX_MAX_ITEMS_PER_ACCOUNT = 8/);
  assert.match(outbox, /CHAT_FINALIZATION_OUTBOX_TTL_MS = 2 \* 60 \* 60 \* 1_000/);
  assert.match(outbox, /CHAT_FINALIZATION_DRAIN_MAX_ITEMS = 4/);
  assert.match(outbox, /CHAT_FINALIZATION_ATTEMPTS_PER_DRAIN = 2/);
  assert.match(outbox, /input\.currentAccountId !== input\.pending\.accountId/);
  assert.match(outbox, /input\.currentChatId !== input\.pending\.chatId/);
  assert.match(outbox, /messageAiRunId\.toLowerCase\(\) !== input\.pending\.aiRunId/);
  assert.match(outbox, /reconcilePersistedChatMessageId/);
  assert.doesNotMatch(outbox, /localStorage|sessionStorage|setInterval/);
  assert.match(outbox, /removeAfterSuccess\(item\.id, input\.accountId\)/);
  assert.match(outbox, /value\.ok !== true/);

  assert.ok(loadChatStart >= 0 && loadChatEnd > loadChatStart);
  assert.match(loadChat, /readActiveChatLoadResponse/);
  assert.match(loadChat, /\(\) => requestSeqRef\.current === requestId/);
  assert.match(chatClient, /return isActive\(\) \? parseChatLoadResponse\(value, expectedChatId\) : null/);
});
