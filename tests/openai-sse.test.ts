import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenAiSseText } from "../components/chat/openai-sse";

test("OpenAI SSE text parser preserves partial events and extracts only deltas", () => {
  const first = parseOpenAiSseText(
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" wor',
  );
  assert.equal(first.text, "Hello");
  assert.match(first.remainder, /content/);

  const second = parseOpenAiSseText(`${first.remainder}ld"}}]}\n\ndata: [DONE]\n\n`);
  assert.equal(second.text, " world");
  assert.equal(second.remainder, "");
});

test("OpenAI SSE text parser drains a final unterminated event", () => {
  const result = parseOpenAiSseText('data: {"choices":[{"delta":{"content":"Done"}}]}', true);
  assert.deepEqual(result, { text: "Done", remainder: "" });
});
