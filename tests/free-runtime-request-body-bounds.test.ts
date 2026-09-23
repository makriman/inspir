import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CHAT_JSON_CONTAINERS,
  MAX_CHAT_JSON_DEPTH,
  chatJsonWithinCpuBounds,
  contentLengthOverLimit,
  declaredContentLength,
  discardIfDeclaredBodyExceeds,
} from "../lib/free-runtime/request-body-bounds";

test("declared content-length rejects only canonical oversized values", () => {
  assert.equal(declaredContentLength(null), null);
  assert.equal(declaredContentLength("20480"), 20_480);
  assert.equal(declaredContentLength(" 20481 "), 20_481);
  assert.equal(declaredContentLength("1e6"), null);
  assert.equal(declaredContentLength("20_481"), null);
  assert.equal(declaredContentLength("-1"), null);
  assert.equal(declaredContentLength("0000000020481"), Number.POSITIVE_INFINITY);
  assert.equal(contentLengthOverLimit("20480", 20 * 1024), false);
  assert.equal(contentLengthOverLimit("20481", 20 * 1024), true);
  assert.equal(contentLengthOverLimit(null, 20 * 1024), false);
  assert.equal(contentLengthOverLimit("nope", 20 * 1024), false);
});

test("chat JSON bounds reject deep and wide documents before parse", () => {
  assert.equal(chatJsonWithinCpuBounds('{"chatId":"abc","content":"hello {world}"}'), true);
  const messages = Array.from({ length: 12 }, () => ({ role: "user", content: "Earlier {note}" }));
  assert.equal(
    chatJsonWithinCpuBounds(JSON.stringify({
      topicId: "learn-anything",
      content: "Hello",
      messages,
    })),
    true,
  );
  assert.equal(
    chatJsonWithinCpuBounds(`${"[".repeat(MAX_CHAT_JSON_DEPTH + 1)}${"]".repeat(MAX_CHAT_JSON_DEPTH + 1)}`),
    false,
  );
  assert.equal(
    chatJsonWithinCpuBounds(JSON.stringify(Array.from({ length: MAX_CHAT_JSON_CONTAINERS + 1 }, () => ({})))),
    false,
  );
  assert.equal(chatJsonWithinCpuBounds('{"open":'), false);
});

test("an oversized declared length cancels the unread body", async () => {
  let cancelled = false;
  let pulled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled = true;
      controller.enqueue(new Uint8Array([123]));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://inspirlearning.com/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": "99999999",
    },
    body,
    ...{ duplex: "half" },
  });
  assert.equal(await discardIfDeclaredBodyExceeds(request, 20 * 1024), true);
  assert.equal(cancelled, true);
  assert.equal(pulled, false);
  assert.equal(
    await discardIfDeclaredBodyExceeds(
      new Request("https://inspirlearning.com/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "32" },
        body: "{}",
      }),
      20 * 1024,
    ),
    false,
  );
});
