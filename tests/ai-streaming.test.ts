import assert from "node:assert/strict";
import test from "node:test";
import type { LearningTokenUsage } from "../lib/ai/streaming";
import { createLearningTextStreamResponse } from "../lib/ai/streaming";

const usage: LearningTokenUsage = {
  inputTokens: 3,
  outputTokens: 2,
  totalTokens: 5,
};

function streamFromParts(parts: unknown[]) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function hangingStreamAfterFirstDelta() {
  return new ReadableStream<unknown>({
    start(controller) {
      controller.enqueue({ type: "text-delta", id: "answer", text: "Hel", providerMetadata: undefined });
    },
  });
}

test("learning text stream response returns text and finish metadata", async () => {
  let finishedText = "";
  let totalTokens = 0;
  let errorCalled = false;
  const response = await createLearningTextStreamResponse(
    {
      fullStream: streamFromParts([
        { type: "start" },
        { type: "text-delta", id: "answer", text: "Hel", providerMetadata: undefined },
        { type: "text-delta", id: "answer", text: "lo", providerMetadata: undefined },
        {
          type: "finish",
          finishReason: "stop",
          rawFinishReason: "stop",
          totalUsage: usage,
        },
      ]),
    },
    {
      onError() {
        errorCalled = true;
      },
      onFinish(event) {
        finishedText = event.text;
        totalTokens = event.totalUsage?.totalTokens ?? 0;
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await response.text(), "Hello");
  assert.equal(finishedText, "Hello");
  assert.equal(totalTokens, 5);
  assert.equal(errorCalled, false);
});

test("learning text stream response fails before returning an empty successful stream", async () => {
  let capturedError: unknown;
  let finishCalled = false;
  const response = await createLearningTextStreamResponse(
    {
      fullStream: streamFromParts([
        { type: "start" },
        { type: "error", error: new Error("provider quota exhausted") },
        {
          type: "finish",
          finishReason: "error",
          rawFinishReason: "error",
          totalUsage: usage,
        },
      ]),
    },
    {
      headers: { "x-test": "kept" },
      onError(error) {
        capturedError = error;
      },
      onFinish() {
        finishCalled = true;
      },
    },
  );

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("x-test"), "kept");
  assert.deepEqual(await response.json(), { error: "The assistant could not answer right now." });
  assert.ok(capturedError instanceof Error);
  assert.equal(finishCalled, false);
});

test("learning text stream response marks cancellation as an error once", async () => {
  let errorCount = 0;
  let capturedError: unknown;
  let finishCalled = false;
  const response = await createLearningTextStreamResponse(
    { fullStream: hangingStreamAfterFirstDelta() },
    {
      onError(error) {
        errorCount += 1;
        capturedError = error;
      },
      onFinish() {
        finishCalled = true;
      },
    },
  );

  const reader = response.body?.getReader();
  assert.ok(reader);
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), "Hel");
  await reader.cancel("client disconnected");

  assert.equal(errorCount, 1);
  assert.ok(capturedError instanceof Error);
  assert.match(capturedError.message, /cancelled before completion/);
  assert.equal(finishCalled, false);
});
