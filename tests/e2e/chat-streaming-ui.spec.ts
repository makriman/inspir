import { expect, test, type Page } from "@playwright/test";

const streamingText = `# Streaming stability check

This response arrives in many small chunks so the UI should not flash.

## Key ideas

- The page should stay pinned near the newest reply.
- The composer should not jump.
- Markdown should not re-layout violently.

| Metric | Expected |
| --- | --- |
| Scroll | Stable |
| Paint | Calm |

\`\`\`ts
export function stable() {
  return "smooth stream";
}
\`\`\`

Done.`;

const streamingChunks = chunkText(streamingText, 5);

type StreamingSample = {
  assistantBottom: number | null;
  assistantTop: number | null;
  bottomDelta: number | null;
  codeBlocks: number;
  composerTop: number | null;
  hasPendingAssistant: boolean;
  hasStrayThinking: boolean;
  isStreaming: boolean;
  pendingAssistantBottom: number | null;
  richBlockInnerSignature: string;
  richChildCount: number;
  richChildKeySignature: string;
  richChildSignature: string;
  richChildTagSignature: string;
  rowCount: number;
  rawFence: boolean;
  rawStreamLength: number;
  spacerHeight: number;
  tables: number;
  textLength: number;
};

test("guest chat streaming stays visually stable and formats rich markdown after completion", async ({ page }) => {
  await installGuestChatStream(page, streamingChunks);
  await page.goto("/chat");
  await page.waitForLoadState("networkidle").catch(() => {});

  await page.locator("textarea.inspir-composer-input").first().fill("Stream a formatted answer slowly.");
  await startStreamingProbe(page);
  await page.getByRole("button", { name: /send message/i }).last().click();

  await page.waitForFunction(() => {
    const rich = Array.from(document.querySelectorAll(".inspir-message-row.is-assistant .inspir-rich-content")).at(-1);
    return rich && !rich.classList.contains("is-streaming") && rich.querySelectorAll("pre code").length > 0;
  });
  await page.waitForTimeout(300);

  const diagnostics = await page.evaluate(() => {
    const viewport = document.querySelector(".inspir-message-scroll");
    const rich = Array.from(document.querySelectorAll(".inspir-message-row.is-assistant .inspir-rich-content")).at(-1);
    const samples =
      ((window as typeof window & { __chatStreamingSamples?: StreamingSample[] }).__chatStreamingSamples ?? []);
    const composerTops = samples
      .map((sample) => sample.composerTop)
      .filter((value): value is number => typeof value === "number");
    const streamingSamples = samples.filter((sample) => sample.isStreaming);
    const settledStreamingSamples = streamingSamples.filter((sample) => sample.textLength > 60);
    const messageSamples = samples.filter((sample) => sample.rowCount > 0);
    const pendingSamples = samples.filter((sample) => sample.hasPendingAssistant);
    const lastPending = pendingSamples.at(-1);
    const firstContent = samples.find((sample) => sample.textLength > 0);
    const richChildRemountDetails: Array<{
      from: string;
      textLength: number;
      to: string;
      childCount: number;
      fromTags: string;
      fromKeys: string;
      toTags: string;
      toKeys: string;
    }> = [];
    let richChildRemounts = 0;
    let richBlockTypeFlips = 0;
    let previousRawStreamLength = 0;
    let rawStreamLengthRegressions = 0;
    let emptyStreamingFramesAfterContent = 0;
    let previousRichSample: StreamingSample | null = null;
    for (const sample of streamingSamples) {
      if (sample.rawStreamLength < previousRawStreamLength) rawStreamLengthRegressions += 1;
      if (previousRawStreamLength > 0 && sample.textLength === 0) emptyStreamingFramesAfterContent += 1;
      previousRawStreamLength = Math.max(previousRawStreamLength, sample.rawStreamLength);
      if (sample.textLength === 0 || sample.richChildCount === 0) continue;
      if (
        previousRichSample &&
        previousRichSample.richChildCount === sample.richChildCount &&
        previousRichSample.richChildSignature !== sample.richChildSignature
      ) {
        richChildRemounts += 1;
        richChildRemountDetails.push({
          from: previousRichSample.richChildSignature,
          fromKeys: previousRichSample.richChildKeySignature,
          fromTags: previousRichSample.richChildTagSignature,
          textLength: sample.textLength,
          to: sample.richChildSignature,
          toKeys: sample.richChildKeySignature,
          toTags: sample.richChildTagSignature,
          childCount: sample.richChildCount,
        });
      }
      if (
        previousRichSample &&
        sample.textLength > 60 &&
        previousRichSample.richChildCount === sample.richChildCount &&
        previousRichSample.richChildKeySignature === sample.richChildKeySignature &&
        previousRichSample.richBlockInnerSignature !== sample.richBlockInnerSignature
      ) {
        richBlockTypeFlips += 1;
      }
      previousRichSample = sample;
    }

    return {
      atBottomDelta: viewport ? Math.round(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight) : null,
      codeBlocks: rich?.querySelectorAll("pre code").length ?? 0,
      composerDrift: composerTops.length > 0 ? Math.max(...composerTops) - Math.min(...composerTops) : 0,
      firstContentBottomShift:
        lastPending?.pendingAssistantBottom !== null &&
        lastPending?.pendingAssistantBottom !== undefined &&
        firstContent?.assistantBottom !== null &&
        firstContent?.assistantBottom !== undefined
          ? Math.abs(lastPending.pendingAssistantBottom - firstContent.assistantBottom)
          : null,
      maxStreamingBottomDelta: Math.max(...settledStreamingSamples.map((sample) => sample.bottomDelta ?? 0), 0),
      messageRowCounts: Array.from(new Set(messageSamples.map((sample) => sample.rowCount))),
      pendingSamples: pendingSamples.length,
      pendingWithContentFrames: samples.filter((sample) => sample.hasPendingAssistant && sample.textLength > 0).length,
      rawFenceDuringStreaming: streamingSamples.filter((sample) => sample.rawFence).length,
      emptyStreamingFramesAfterContent,
      richBlockTypeFlips,
      richChildRemountDetails,
      richChildRemounts,
      shadcnMessages: document.querySelectorAll('[data-slot="message"]').length,
      shadcnScroller: Boolean(document.querySelector('[data-slot="message-scroller"]')),
      strayThinkingFrames: samples.filter((sample) => sample.hasStrayThinking).length,
      streamingCodeBlocks: streamingSamples.filter((sample) => sample.codeBlocks > 0).length,
      streamingSamples: streamingSamples.length,
      streamingTables: streamingSamples.filter((sample) => sample.tables > 0).length,
      tables: rich?.querySelectorAll("table").length ?? 0,
      rawStreamLengthRegressions,
      textLength: rich?.textContent?.length ?? 0,
    };
  });

  expect(diagnostics.shadcnScroller).toBe(true);
  expect(diagnostics.shadcnMessages).toBeGreaterThanOrEqual(2);
  expect(diagnostics.messageRowCounts).toEqual([2]);
  expect(diagnostics.pendingSamples).toBeGreaterThan(4);
  expect(diagnostics.pendingWithContentFrames).toBe(0);
  expect(diagnostics.strayThinkingFrames).toBe(0);
  expect(diagnostics.firstContentBottomShift).not.toBeNull();
  expect(diagnostics.firstContentBottomShift).toBeLessThanOrEqual(2);
  expect(diagnostics.streamingSamples).toBeGreaterThan(0);
  expect(diagnostics.streamingCodeBlocks).toBeGreaterThan(0);
  expect(diagnostics.streamingTables).toBeGreaterThan(0);
  expect(diagnostics.rawFenceDuringStreaming).toBe(0);
  expect(diagnostics.rawStreamLengthRegressions).toBe(0);
  expect(diagnostics.emptyStreamingFramesAfterContent).toBe(0);
  expect(diagnostics.richBlockTypeFlips).toBe(0);
  expect(diagnostics.richChildRemounts, JSON.stringify(diagnostics.richChildRemountDetails)).toBe(0);
  expect(diagnostics.maxStreamingBottomDelta).toBeLessThanOrEqual(96);
  expect(diagnostics.composerDrift).toBeLessThanOrEqual(1);
  expect(diagnostics.atBottomDelta).toBeLessThanOrEqual(4);
  expect(diagnostics.textLength).toBeGreaterThan(200);
  expect(diagnostics.tables).toBe(1);
  expect(diagnostics.codeBlocks).toBe(1);
});

function chunkText(text: string, size: number) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

async function installGuestChatStream(page: Page, chunks: string[]) {
  await page.addInitScript(({ chunks: streamChunks }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (!url.endsWith("/api/guest-chat")) return originalFetch(input, init);

      const encoder = new TextEncoder();
      let index = 0;
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              const send = () => {
                if (index >= streamChunks.length) {
                  controller.close();
                  return;
                }
                controller.enqueue(encoder.encode(streamChunks[index++]));
                window.setTimeout(send, 55);
              };
              window.setTimeout(send, 550);
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "x-guest-messages-limit": "10",
              "x-guest-messages-used": "1",
            },
          },
        ),
      );
    };
  }, { chunks });
}

async function startStreamingProbe(page: Page) {
  await page.evaluate(() => {
    const streamWindow = window as typeof window & {
      __chatNextNodeId?: number;
      __chatNodeIds?: WeakMap<Element, number>;
      __chatStreamingSamples?: StreamingSample[];
    };
    streamWindow.__chatStreamingSamples = [];
    streamWindow.__chatNodeIds = new WeakMap();
    streamWindow.__chatNextNodeId = 1;
    const startedAt = performance.now();

    const nodeId = (element: Element) => {
      const existing = streamWindow.__chatNodeIds?.get(element);
      if (existing) return existing;
      const next = streamWindow.__chatNextNodeId ?? 1;
      streamWindow.__chatNextNodeId = next + 1;
      streamWindow.__chatNodeIds?.set(element, next);
      return next;
    };

    const recordFrame = () => {
      const viewport = document.querySelector(".inspir-message-scroll");
      const assistant = Array.from(document.querySelectorAll(".inspir-message-row.is-assistant")).at(-1);
      const composer = document.querySelector(".inspir-composer");
      const pending = assistant?.querySelector(".inspir-pending-assistant");
      const rich = assistant?.querySelector(".inspir-rich-content");
      const richChildren = rich ? Array.from(rich.children) : [];
      const richBlockInnerSignature = richChildren
        .map((child) => child.firstElementChild?.tagName.toLowerCase() ?? "")
        .join(",");
      const assistantRect = assistant?.getBoundingClientRect();
      const pendingRect = pending?.getBoundingClientRect();
      const spacer = document.querySelector<HTMLElement>(".inspir-message-stack > [data-message-scroller-spacer]");

      streamWindow.__chatStreamingSamples?.push({
        assistantBottom: assistantRect ? Math.round(assistantRect.bottom) : null,
        assistantTop: assistantRect ? Math.round(assistantRect.top) : null,
        bottomDelta: viewport ? Math.round(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight) : null,
        codeBlocks: rich?.querySelectorAll("pre code").length ?? 0,
        composerTop: composer?.getBoundingClientRect().top ?? null,
        hasPendingAssistant: Boolean(pending),
        hasStrayThinking: Boolean(document.querySelector(".inspir-thinking")),
        isStreaming: Boolean(rich?.classList.contains("is-streaming")),
        pendingAssistantBottom: pendingRect ? Math.round(assistantRect?.bottom ?? pendingRect.bottom) : null,
        richBlockInnerSignature,
        richChildCount: richChildren.length,
        richChildKeySignature: richChildren
          .map((child) => child.getAttribute("data-stream-block") ?? "")
          .join(","),
        richChildSignature: richChildren.map(nodeId).join(","),
        richChildTagSignature: richChildren.map((child) => child.tagName.toLowerCase()).join(","),
        rowCount: document.querySelectorAll(".inspir-message-row").length,
        rawFence: rich?.textContent?.includes("```") ?? false,
        rawStreamLength: Number(rich?.getAttribute("data-content-length") ?? 0),
        spacerHeight: spacer ? Math.round(spacer.getBoundingClientRect().height) : 0,
        tables: rich?.querySelectorAll("table").length ?? 0,
        textLength: rich?.textContent?.length ?? 0,
      });

      if (performance.now() - startedAt < 8000) requestAnimationFrame(recordFrame);
    };

    requestAnimationFrame(recordFrame);
  });
}
