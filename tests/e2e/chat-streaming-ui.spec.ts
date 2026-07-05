import { expect, test, type Page } from "@playwright/test";

const streamingChunks = [
  "# Streaming stability check\n\n",
  "This response arrives in many small chunks so the UI should not flash.\n\n",
  "## Key ideas\n\n",
  "- The page should stay pinned near the newest reply.\n",
  "- The composer should not jump.\n",
  "- Markdown should not re-layout violently.\n\n",
  "| Metric | Expected |\n| --- | --- |\n",
  "| Scroll | Stable |\n| Paint | Calm |\n\n",
  "```ts\n",
  "export function stable() {\n",
  "  return \"smooth stream\";\n",
  "}\n",
  "```\n\nDone.",
];

type StreamingSample = {
  bottomDelta: number | null;
  codeBlocks: number;
  composerTop: number | null;
  isStreaming: boolean;
  textLength: number;
};

test("guest chat streaming stays visually stable and formats rich markdown after completion", async ({ page }) => {
  await installGuestChatStream(page, streamingChunks);
  await page.goto("/chat");
  await page.waitForLoadState("networkidle").catch(() => {});

  await page.locator("textarea.bubble-composer-input").first().fill("Stream a formatted answer slowly.");
  await startStreamingProbe(page);
  await page.getByRole("button", { name: /send message/i }).last().click();

  await page.waitForFunction(() => {
    const rich = Array.from(document.querySelectorAll(".bubble-message-row.is-assistant .bubble-rich-content")).at(-1);
    return rich && !rich.classList.contains("is-streaming") && rich.querySelectorAll("pre code").length > 0;
  });
  await page.waitForTimeout(300);

  const diagnostics = await page.evaluate(() => {
    const viewport = document.querySelector(".bubble-message-scroll");
    const rich = Array.from(document.querySelectorAll(".bubble-message-row.is-assistant .bubble-rich-content")).at(-1);
    const samples =
      ((window as typeof window & { __chatStreamingSamples?: StreamingSample[] }).__chatStreamingSamples ?? []);
    const composerTops = samples
      .map((sample) => sample.composerTop)
      .filter((value): value is number => typeof value === "number");
    const streamingSamples = samples.filter((sample) => sample.isStreaming);

    return {
      atBottomDelta: viewport ? Math.round(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight) : null,
      codeBlocks: rich?.querySelectorAll("pre code").length ?? 0,
      composerDrift: composerTops.length > 0 ? Math.max(...composerTops) - Math.min(...composerTops) : 0,
      richCodeDuringStreaming: streamingSamples.filter((sample) => sample.codeBlocks > 0).length,
      shadcnMessages: document.querySelectorAll('[data-slot="message"]').length,
      shadcnScroller: Boolean(document.querySelector('[data-slot="message-scroller"]')),
      streamingSamples: streamingSamples.length,
      tables: rich?.querySelectorAll("table").length ?? 0,
      textLength: rich?.textContent?.length ?? 0,
    };
  });

  expect(diagnostics.shadcnScroller).toBe(true);
  expect(diagnostics.shadcnMessages).toBeGreaterThanOrEqual(2);
  expect(diagnostics.streamingSamples).toBeGreaterThan(0);
  expect(diagnostics.richCodeDuringStreaming).toBe(0);
  expect(diagnostics.composerDrift).toBeLessThanOrEqual(1);
  expect(diagnostics.atBottomDelta).toBeLessThanOrEqual(4);
  expect(diagnostics.textLength).toBeGreaterThan(200);
  expect(diagnostics.tables).toBe(1);
  expect(diagnostics.codeBlocks).toBe(1);
});

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
              window.setTimeout(send, 30);
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
    const streamWindow = window as typeof window & { __chatStreamingSamples?: StreamingSample[] };
    streamWindow.__chatStreamingSamples = [];
    const startedAt = performance.now();

    const recordFrame = () => {
      const viewport = document.querySelector(".bubble-message-scroll");
      const assistant = Array.from(document.querySelectorAll(".bubble-message-row.is-assistant")).at(-1);
      const composer = document.querySelector(".bubble-composer");
      const rich = assistant?.querySelector(".bubble-rich-content");

      streamWindow.__chatStreamingSamples?.push({
        bottomDelta: viewport ? Math.round(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight) : null,
        codeBlocks: rich?.querySelectorAll("pre code").length ?? 0,
        composerTop: composer?.getBoundingClientRect().top ?? null,
        isStreaming: Boolean(rich?.classList.contains("is-streaming")),
        textLength: rich?.textContent?.length ?? 0,
      });

      if (performance.now() - startedAt < 1900) requestAnimationFrame(recordFrame);
    };

    requestAnimationFrame(recordFrame);
  });
}
