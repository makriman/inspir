import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptsOpenAiSse,
  readBoundedOpenAiChatCompletionText,
} from "../lib/free-runtime/openai-chat-contract";

test("current clients must explicitly negotiate OpenAI SSE", () => {
  assert.equal(
    acceptsOpenAiSse(
      new Request("https://inspirlearning.com/api/chat", {
        headers: { accept: "application/json, text/event-stream; q=1" },
      }),
    ),
    true,
  );
  assert.equal(
    acceptsOpenAiSse(
      new Request("https://inspirlearning.com/api/chat", { headers: { accept: "*/*" } }),
    ),
    false,
  );
  assert.equal(
    acceptsOpenAiSse(
      new Request("https://inspirlearning.com/api/chat", {
        headers: { accept: "text/event-stream;q=0, */*;q=1" },
      }),
    ),
    false,
  );
  assert.equal(
    acceptsOpenAiSse(
      new Request("https://inspirlearning.com/api/chat", {
        headers: { accept: "text/*, application/*" },
      }),
    ),
    false,
  );
  assert.equal(acceptsOpenAiSse(new Request("https://inspirlearning.com/api/chat")), false);
});

test("legacy non-streaming completions are bounded before JSON parsing", async () => {
  const valid = await readBoundedOpenAiChatCompletionText(
    completionResponse("A bounded plain-text answer."),
    { maxBytes: 1_024, maxCharacters: 100 },
  );
  assert.equal(valid, "A bounded plain-text answer.");

  const tooManyCharacters = await readBoundedOpenAiChatCompletionText(
    completionResponse("x".repeat(101)),
    { maxBytes: 1_024, maxCharacters: 100 },
  );
  assert.equal(tooManyCharacters, null);

  const tooManyBytes = await readBoundedOpenAiChatCompletionText(
    completionResponse("界".repeat(100)),
    { maxBytes: 100, maxCharacters: 1_000 },
  );
  assert.equal(tooManyBytes, null);

  const invalid = await readBoundedOpenAiChatCompletionText(
    new Response('{"choices":[]}', { headers: { "content-type": "application/json" } }),
    { maxBytes: 1_024, maxCharacters: 100 },
  );
  assert.equal(invalid, null);

  const malformed = await readBoundedOpenAiChatCompletionText(
    new Response('{"choices":[', { headers: { "content-type": "application/json" } }),
    { maxBytes: 1_024, maxCharacters: 100 },
  );
  assert.equal(malformed, null);

  const advertisedOversize = await readBoundedOpenAiChatCompletionText(
    new Response('{"choices":[]}', {
      headers: { "content-length": "2048", "content-type": "application/json" },
    }),
    { maxBytes: 1_024, maxCharacters: 100 },
  );
  assert.equal(advertisedOversize, null);
});

function completionResponse(content: string) {
  return Response.json({ choices: [{ message: { content } }] });
}
