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
const persistedAssistantMessageId = "00000000-0000-4000-8000-000000000003";

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
  scrollTop: number | null;
  spacerHeight: number;
  tables: number;
  textLength: number;
};

test("guest chat streaming stays visually stable and formats rich markdown after completion", async ({ page }) => {
  await installGuestChatStream(page, streamingChunks);
  await page.goto("/chat");
  const composer = page.locator("textarea.inspir-composer-input").first();
  await expect(composer).toBeVisible();
  await expect(composer).toBeEditable();
  await composer.fill("Stream a formatted answer slowly.");
  await expect(page.locator("button.inspir-send-button").last()).toBeEnabled();
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
    let previousScrollTop: number | null = null;
    let rawStreamLengthRegressions = 0;
    let maxScrollTopRegression = 0;
    let emptyStreamingFramesAfterContent = 0;
    let previousRichSample: StreamingSample | null = null;
    for (const sample of streamingSamples) {
      if (sample.rawStreamLength < previousRawStreamLength) rawStreamLengthRegressions += 1;
      if (previousScrollTop !== null && sample.scrollTop !== null && sample.scrollTop < previousScrollTop - 1) {
        maxScrollTopRegression = Math.max(maxScrollTopRegression, previousScrollTop - sample.scrollTop);
      }
      if (previousRawStreamLength > 0 && sample.textLength === 0) emptyStreamingFramesAfterContent += 1;
      previousRawStreamLength = Math.max(previousRawStreamLength, sample.rawStreamLength);
      if (sample.scrollTop !== null) previousScrollTop = sample.scrollTop;
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
      maxScrollTopRegression,
      maxSpacerHeight: Math.max(...streamingSamples.map((sample) => sample.spacerHeight), 0),
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
  expect(diagnostics.maxScrollTopRegression).toBe(0);
  expect(diagnostics.maxSpacerHeight).toBeLessThanOrEqual(2);
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

test("guest chat paints streamed text before a fast response completes", async ({ page }) => {
  await installGuestChatStream(page, streamingChunks, { chunkDelayMs: -1, initialDelayMs: 40 });
  await page.goto("/chat");
  const composer = page.locator("textarea.inspir-composer-input").first();
  await expect(composer).toBeVisible();
  await expect(composer).toBeEditable();
  await composer.fill("Stream a burst response.");
  await expect(page.locator("button.inspir-send-button").last()).toBeEnabled();
  await startStreamingProbe(page);
  await page.getByRole("button", { name: /send message/i }).last().click();

  await page.waitForFunction(() => {
    const rich = Array.from(document.querySelectorAll(".inspir-message-row.is-assistant .inspir-rich-content")).at(-1);
    return rich && !rich.classList.contains("is-streaming") && (rich.textContent?.length ?? 0) > 200;
  });
  await page.waitForTimeout(250);

  const diagnostics = await page.evaluate((expectedLength) => {
    const samples =
      ((window as typeof window & { __chatStreamingSamples?: StreamingSample[] }).__chatStreamingSamples ?? []);
    const streamingSamples = samples.filter((sample) => sample.isStreaming);
    const streamingWithText = streamingSamples.filter((sample) => sample.rawStreamLength > 0);
    const firstStreamingText = streamingWithText[0] ?? null;
    let previousScrollTop: number | null = null;
    let maxScrollTopRegression = 0;
    for (const sample of streamingSamples) {
      if (previousScrollTop !== null && sample.scrollTop !== null && sample.scrollTop < previousScrollTop - 1) {
        maxScrollTopRegression = Math.max(maxScrollTopRegression, previousScrollTop - sample.scrollTop);
      }
      if (sample.scrollTop !== null) previousScrollTop = sample.scrollTop;
    }

    return {
      firstStreamingRawLength: firstStreamingText?.rawStreamLength ?? 0,
      firstStreamingTextLength: firstStreamingText?.textLength ?? 0,
      maxScrollTopRegression,
      streamingFrames: streamingSamples.length,
      streamingFramesWithText: streamingWithText.length,
      uniqueStreamingLengths: new Set(streamingWithText.map((sample) => sample.rawStreamLength)).size,
      expectedLength,
    };
  }, streamingText.length);

  expect(diagnostics.streamingFrames).toBeGreaterThan(0);
  expect(diagnostics.streamingFramesWithText).toBeGreaterThan(0);
  expect(diagnostics.uniqueStreamingLengths).toBeGreaterThan(0);
  expect(diagnostics.firstStreamingRawLength).toBeGreaterThan(0);
  expect(diagnostics.firstStreamingRawLength).toBeLessThan(diagnostics.expectedLength);
  expect(diagnostics.firstStreamingTextLength).toBeLessThan(diagnostics.expectedLength);
  expect(diagnostics.maxScrollTopRegression).toBe(0);
});

test("authenticated chat keeps the streamed assistant DOM mounted when persistence replaces its ID", async ({ page }) => {
  await installAuthenticatedChatStream(page, ["Stable ", "authenticated ", "streamed ", "answer."]);
  await page.goto("/chat");

  const composer = page.locator("textarea.inspir-composer-input").first();
  await expect(composer).toBeVisible();
  await expect(composer).toBeEditable();
  await composer.fill("Keep this streamed answer mounted.");
  await page.getByRole("button", { name: /send message/i }).last().click();

  const assistantRow = page.locator(".inspir-message-row.is-assistant").last();
  const assistantContent = assistantRow.locator(".inspir-rich-content");
  await expect(assistantContent).toHaveClass(/is-streaming/);
  await expect(assistantContent).toContainText("Stable");
  await page.evaluate(() => {
    const identityWindow = window as typeof window & {
      __authenticatedAssistantMessageWrapper?: Element | null;
      __authenticatedAssistantRow?: Element | null;
    };
    identityWindow.__authenticatedAssistantRow = Array.from(
      document.querySelectorAll(".inspir-message-row.is-assistant"),
    ).at(-1);
    identityWindow.__authenticatedAssistantMessageWrapper =
      identityWindow.__authenticatedAssistantRow?.closest("[data-message-id]");
  });

  const persistedRow = page.locator(`[data-message-id="${persistedAssistantMessageId}"]`);
  await expect(persistedRow).toBeVisible();
  await expect(persistedRow.locator(".inspir-rich-content")).not.toHaveClass(/is-streaming/);
  const identity = await page.evaluate((persistedId) => {
    const identityWindow = window as typeof window & {
      __authenticatedAssistantMessageWrapper?: Element | null;
      __authenticatedAssistantRow?: Element | null;
    };
    const currentMessageWrapper = document.querySelector(`[data-message-id="${persistedId}"]`);
    const currentAssistantRow = currentMessageWrapper?.querySelector(".inspir-message-row.is-assistant");
    return {
      rowConnected: identityWindow.__authenticatedAssistantRow?.isConnected ?? false,
      rowPreserved: identityWindow.__authenticatedAssistantRow === currentAssistantRow,
      wrapperConnected: identityWindow.__authenticatedAssistantMessageWrapper?.isConnected ?? false,
      wrapperPreserved: identityWindow.__authenticatedAssistantMessageWrapper === currentMessageWrapper,
    };
  }, persistedAssistantMessageId);

  expect(identity).toEqual({
    rowConnected: true,
    rowPreserved: true,
    wrapperConnected: true,
    wrapperPreserved: true,
  });
});

test("localized auto-translation leaves streamed assistant tokens untouched", async ({ page }) => {
  await installGuestChatStream(page, ["Search"], { chunkDelayMs: 1_000, initialDelayMs: 100 });
  await page.goto("/hi/chat?topic=learn-anything");
  const composer = page.locator("textarea.inspir-composer-input");
  await expect(composer).toBeVisible();
  await expect(composer).toBeEditable();
  await composer.fill("Reply with one UI word.");
  await expect(page.locator("button.inspir-send-button")).toBeEnabled();
  await page.locator("button.inspir-send-button").click();

  const latestAssistantContent = page
    .locator(".inspir-message-row.is-assistant .inspir-rich-content")
    .last();
  await expect(latestAssistantContent).toHaveClass(/is-streaming/);
  await expect(latestAssistantContent).toHaveAttribute("data-no-auto-translate", "true");
  await expect(latestAssistantContent).toHaveText("Search");

  await expect(latestAssistantContent).not.toHaveClass(/is-streaming/, { timeout: 5_000 });
  await expect(latestAssistantContent).toHaveAttribute("data-no-auto-translate", "true");
  await expect(latestAssistantContent).toHaveText("Search");
});

function chunkText(text: string, size: number) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

async function installGuestChatStream(
  page: Page,
  chunks: string[],
  options: { chunkDelayMs?: number; initialDelayMs?: number } = {},
) {
  await page.addInitScript(({ chunks: streamChunks, chunkDelayMs, initialDelayMs }) => {
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
              if (chunkDelayMs < 0) {
                for (const chunk of streamChunks) controller.enqueue(encoder.encode(chunk));
                controller.close();
                return;
              }

              const send = () => {
                if (index >= streamChunks.length) {
                  controller.close();
                  return;
                }
                controller.enqueue(encoder.encode(streamChunks[index++]));
                window.setTimeout(send, chunkDelayMs);
              };
              window.setTimeout(send, initialDelayMs);
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
  }, { chunks, chunkDelayMs: options.chunkDelayMs ?? 55, initialDelayMs: options.initialDelayMs ?? 550 });
}

async function installAuthenticatedChatStream(page: Page, chunks: string[]) {
  await page.addInitScript(({ streamChunks, persistedMessageId }) => {
    const originalFetch = window.fetch.bind(window);
    const chatId = "00000000-0000-4000-8000-000000000001";
    const jsonResponse = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });

    window.fetch = (input, init) => {
      const rawUrl = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      const url = new URL(rawUrl, window.location.origin);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

      if (url.pathname.startsWith("/i18n/main-app/")) {
        const sourceHash = url.pathname.split("/").at(-1)?.split(".").at(1) ?? "";
        const sourceStrings: Record<string, string> = {};
        const strings: Record<string, string> = {};
        for (let index = 0; index < 1_000; index += 1) {
          const key = `browser-test-${index}`;
          sourceStrings[key] = key;
          strings[key] = key;
        }
        return Promise.resolve(jsonResponse({
          namespace: "main-app",
          language: "English",
          sourceHash,
          sourceStrings,
          strings,
        }));
      }
      if (url.pathname === "/api/me") {
        return Promise.resolve(jsonResponse({
          user: {
            id: "authenticated-streaming-user",
            name: "Authenticated learner",
            email: "learner@example.test",
            image: null,
            score: 0,
            preferredLanguage: "English",
            dateOfBirth: "2000-01-01",
            age: 26,
            createdAt: "2026-07-12T12:00:00.000Z",
            profileImageHash: null,
            isAdmin: false,
          },
        }));
      }
      if (url.pathname === "/api/account/topics") {
        return Promise.resolve(jsonResponse({ error: "Use public topics in this isolated browser test" }, 401));
      }
      if (url.pathname === "/api/chats" && method === "POST") {
        return Promise.resolve(jsonResponse({ chatId }));
      }
      if (url.pathname === "/api/chat" && method === "POST") {
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
                  window.setTimeout(send, 180);
                };
                window.setTimeout(send, 120);
              },
            }),
            {
              status: 200,
              headers: {
                "content-type": "text/plain; charset=utf-8",
                "x-inspir-ai-run-id": "00000000-0000-4000-8000-000000000002",
                "x-inspir-user-message-id": "00000000-0000-4000-8000-000000000004",
              },
            },
          ),
        );
      }
      if (url.pathname === "/api/chat/finalize" && method === "POST") {
        return new Promise((resolve) => {
          window.setTimeout(
            () => resolve(jsonResponse({ ok: true, assistantMessageId: persistedMessageId })),
            450,
          );
        });
      }

      return originalFetch(input, init);
    };
  }, { streamChunks: chunks, persistedMessageId: persistedAssistantMessageId });
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
        scrollTop: viewport ? Math.round(viewport.scrollTop) : null,
        spacerHeight: spacer ? Math.round(spacer.getBoundingClientRect().height) : 0,
        tables: rich?.querySelectorAll("table").length ?? 0,
        textLength: rich?.textContent?.length ?? 0,
      });

      if (performance.now() - startedAt < 8000) requestAnimationFrame(recordFrame);
    };

    requestAnimationFrame(recordFrame);
  });
}
