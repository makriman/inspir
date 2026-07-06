import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("authenticated chat route proves ownership before spend and message writes", () => {
  const source = fs.readFileSync(path.resolve("app/api/chat/route.ts"), "utf8");

  const ownershipCheck = source.indexOf("const owned = await getOwnedChat(requestData.chatId, userId)");
  const quotaCheck = source.indexOf("const limit = await consumeAiQuota");
  const firstMessageWrite = source.indexOf("insertMessage({");

  assert.ok(ownershipCheck > -1, "chat route must fetch the chat through getOwnedChat");
  assert.ok(quotaCheck > ownershipCheck, "chat route must prove ownership before consuming quota/budget");
  assert.ok(firstMessageWrite > ownershipCheck, "chat route must prove ownership before writing messages");
  assert.match(source, /if \(!owned\) return NextResponse\.json\(\{ error: "Chat not found" \}, \{ status: 404 \}\);/);
});

test("guest chat response cache can hit before the global LLM budget is consumed", () => {
  const source = fs.readFileSync(path.resolve("app/api/guest-chat/route.ts"), "utf8");

  const cacheRead = source.indexOf("const cached = await getCachedLearningResponse(cacheRequest)");
  const cacheHitReturn = source.indexOf("cachedLearningResponseStream(cached.responseText)");
  const budgetCheck = source.indexOf("const budget = await consumeDailyLlmBudget()");
  const modelCall = source.indexOf("const result = await agent.stream");

  assert.ok(cacheRead > -1, "guest chat should read the app response cache");
  assert.ok(cacheHitReturn > cacheRead, "guest chat should return cached text from the cache-hit branch");
  assert.ok(budgetCheck > cacheHitReturn, "global LLM budget must not be consumed before cache hits return");
  assert.ok(modelCall > budgetCheck, "provider calls should still remain behind the global LLM budget");
});
