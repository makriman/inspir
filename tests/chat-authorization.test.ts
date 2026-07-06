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

