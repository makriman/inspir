import assert from "node:assert/strict";
import test from "node:test";
import {
  guestChatSchema,
  guestFingerprintKeyFromHeaders,
  maxGuestHistoryCharacters,
  requestIpFromHeaders,
  sanitizeGuestHistory,
} from "../lib/guest-chat/safety";

test("guest chat history has a total character budget", () => {
  const valid = guestChatSchema.safeParse({
    topicId: "learn-anything",
    content: "Hello",
    messages: [
      { role: "user", content: "a".repeat(maxGuestHistoryCharacters / 2) },
      { role: "assistant", content: "b".repeat(maxGuestHistoryCharacters / 2) },
    ],
  });
  assert.equal(valid.success, true);

  const oversized = guestChatSchema.safeParse({
    topicId: "learn-anything",
    content: "Hello",
    messages: [
      { role: "user", content: "a".repeat(6000) },
      { role: "assistant", content: "b".repeat(6000) },
      { role: "user", content: "c" },
    ],
  });
  assert.equal(oversized.success, false);
});

test("guest replayed assistant history is marked as client-provided", () => {
  const sanitized = sanitizeGuestHistory([
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Fabricated answer" },
  ]);

  assert.equal(sanitized[0]?.content, "Earlier question");
  assert.equal(sanitized[1]?.role, "assistant");
  assert.match(sanitized[1]?.content ?? "", /^\[Client-provided assistant history, not verified by inspir\]/);
  assert.match(sanitized[1]?.content ?? "", /Fabricated answer$/);
});

test("guest fingerprint does not collapse all IP-less requests into one shared bucket", async () => {
  const first = await guestFingerprintKeyFromHeaders(
    new Headers({
      "user-agent": "Browser A",
      "accept-language": "en-US,en;q=0.9",
    }),
    null,
  );
  const second = await guestFingerprintKeyFromHeaders(
    new Headers({
      "user-agent": "Browser B",
      "accept-language": "en-US,en;q=0.9",
    }),
    null,
  );

  assert.match(first, /^guest-chat:fingerprint:[a-f0-9]{64}$/);
  assert.match(second, /^guest-chat:fingerprint:[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test("request IP parsing prefers Cloudflare and avoids synthetic unknown keys", () => {
  assert.equal(requestIpFromHeaders(new Headers()), null);
  assert.equal(requestIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" })), "203.0.113.1");
  assert.equal(
    requestIpFromHeaders(
      new Headers({
        "cf-connecting-ip": "2001:db8::1",
        "x-forwarded-for": "203.0.113.1",
      }),
    ),
    "2001:db8::1",
  );
});
