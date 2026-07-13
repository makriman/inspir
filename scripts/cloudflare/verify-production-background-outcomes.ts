import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readCloudflareApiToken } from "./cloudflare-api-token";
import { writePrivateJsonDurably } from "./d1-release-budget-ledger";
import {
  CLOUDFLARE_ACCOUNT_ID,
  D1_DATABASE_NAME,
  MEMORY_POST_TURN_QUEUE_NAME,
  cloudflareDir,
  commandEnv,
  resolveBackupDir,
} from "./migration-config";

const workerName = "inspirlearning";
const cpuHeadroomExclusiveMs = 8;
const tailReadyTimeoutMs = 60_000;
const queueCaptureTimeoutMs = 60_000;
const scheduledCaptureTimeoutMs = 30 * 60_000;
const tailOutputLimitBytes = 16 * 1024 * 1024;
const workerVersionPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BackgroundOutcomeMode = "queue" | "scheduled";

export type BackgroundOutcomeEvaluation = {
  ok: boolean;
  mode: BackgroundOutcomeMode;
  expectedVersion: string;
  matchedEvents: number;
  cpuTimeMs: number | null;
  wallTimeMs: number | null;
  problems: string[];
};

type EvaluationInput = {
  mode: BackgroundOutcomeMode;
  expectedVersion: string;
  correlationId?: string;
  expectedScheduledDay?: string;
  captureStartedAt?: number;
};

type QueueProbe = {
  correlationId: string;
  userId: string;
  chatId: string;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Background outcome validation failed.");
    process.exitCode = 1;
  });
}

async function main() {
  if (!process.argv.includes("--confirm-production")) {
    throw new Error("Production background outcome validation requires --confirm-production.");
  }
  const mode = readMode();
  const expectedVersion = requireWorkerVersion(getArg("--expected-version"));
  const expectedScheduledDay = mode === "scheduled"
    ? requireUtcDay(getArg("--scheduled-day") ?? new Date().toISOString().slice(0, 10))
    : undefined;
  const wrangler = path.resolve(process.cwd(), "node_modules/.bin/wrangler");
  assertSoleActiveVersion(wrangler, expectedVersion);
  const captureStartedAt = Date.now();
  const tail = spawn(
    wrangler,
    ["tail", workerName, "--format", "json", "--version-id", expectedVersion],
    { cwd: process.cwd(), env: commandEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const capture = captureTail(tail);
  let correlationId: string | undefined;
  let queuePushAttempted = false;
  let evaluation: BackgroundOutcomeEvaluation | null = null;
  let operationError: unknown;
  let shutdownError: unknown;
  try {
    await waitForTailReadiness(tail, capture.output, expectedVersion);
    if (mode === "queue") {
      assertSoleActiveVersion(wrangler, expectedVersion);
      const probe = buildQueueProbe();
      correlationId = probe.userId;
      assertQueueProbeAbsent(wrangler, probe);
      const queueId = readQueueId(wrangler);
      queuePushAttempted = true;
      await pushStaleQueueProbe(queueId, probe);
    }
    evaluation = await waitForBackgroundOutcome(
      tail,
      capture.output,
      {
        mode,
        expectedVersion,
        ...(correlationId ? { correlationId } : {}),
        ...(expectedScheduledDay ? { expectedScheduledDay } : {}),
        captureStartedAt,
      },
      mode === "queue" ? queueCaptureTimeoutMs : scheduledCaptureTimeoutMs,
    );
    if (mode === "queue") assertSoleActiveVersion(wrangler, expectedVersion);
  } catch (error) {
    operationError = error;
  } finally {
    if (!hasExited(tail)) {
      try {
        await stopTail(tail, capture.closed);
      } catch (error) {
        shutdownError = error;
      }
    }
  }
  let tailOutputBytes = 0;
  let tailOutputBounded = true;
  try {
    tailOutputBytes = Buffer.byteLength(capture.output());
  } catch {
    tailOutputBounded = false;
  }
  const result = evaluation ?? {
    ok: false,
    mode,
    expectedVersion,
    matchedEvents: 0,
    cpuTimeMs: null,
    wallTimeMs: null,
    problems: ["missing-evaluation"],
  } satisfies BackgroundOutcomeEvaluation;
  const failureKinds = [
    ...(operationError ? ["operation"] : []),
    ...(shutdownError ? ["tail-shutdown"] : []),
    ...(!tailOutputBounded ? ["tail-output-overflow"] : []),
  ];
  const report = {
    kind: "production-background-outcome-validation-v1",
    createdAt: new Date().toISOString(),
    ...result,
    ok: result.ok && failureKinds.length === 0,
    queue: mode === "queue" ? MEMORY_POST_TURN_QUEUE_NAME : undefined,
    cron: mode === "scheduled" ? "0 3 * * *" : undefined,
    expectedScheduledDay,
    correlationId,
    queuePushAttempted,
    cpuThresholdExclusiveMs: cpuHeadroomExclusiveMs,
    tailOutputBytes,
    tailOutputBounded,
    tailDiagnosticsBytes: Buffer.byteLength(capture.diagnostics()),
    failureKinds,
  };
  const reportPath = path.join(
    cloudflareDir(resolveBackupDir()),
    `production-${mode}-outcome-report.json`,
  );
  writePrivateJsonDurably(reportPath, report, { replace: pathEntryExists(reportPath) });
  if (!report.ok) {
    throw new Error(
      `Production ${mode} outcome validation failed; inspect the private report at ${reportPath}.`,
    );
  }
  console.log(JSON.stringify({
    kind: report.kind,
    ok: report.ok,
    mode,
    expectedVersion,
    cpuTimeMs: report.cpuTimeMs,
    reportPath,
  }, null, 2));
}

export function evaluateProductionBackgroundTail(
  source: string,
  input: EvaluationInput,
): BackgroundOutcomeEvaluation {
  const problems: string[] = [];
  const records = extractJsonObjects(source).flatMap((value) => {
    const record = asRecord(value);
    const event = asRecord(record?.event);
    if (!record || !event || !exactBackgroundEventKind(event, input.mode)) return [];
    if (input.mode === "queue") {
      return event.queue === MEMORY_POST_TURN_QUEUE_NAME ? [{ record, event }] : [];
    }
    return event.cron === "0 3 * * *" ? [{ record, event }] : [];
  });
  const correlated = records.filter(({ record }) => {
    if (input.mode === "queue") {
      return queueLogMatches(record.logs, input.correlationId ?? "");
    }
    return scheduledLogMatches(record.logs);
  });
  if (correlated.length !== 1) problems.push(`matched-events=${correlated.length}`);
  const match = correlated.length === 1 ? correlated[0] : undefined;
  const record = match?.record;
  const event = match?.event;
  const scriptVersion = asRecord(record?.scriptVersion);
  const cpuTimeMs = finiteNumber(record?.cpuTime);
  const wallTimeMs = finiteNumber(record?.wallTime);
  const eventTimestamp = finiteNumber(record?.eventTimestamp);

  if (record) {
    if (record.scriptName !== workerName) problems.push("wrong-script");
    if (scriptVersion?.id !== input.expectedVersion) problems.push("wrong-version");
    if (record.outcome !== "ok") problems.push("outcome");
    if (record.truncated !== false) problems.push("truncated");
    if (!Array.isArray(record.exceptions) || record.exceptions.length !== 0) {
      problems.push("exceptions");
    }
    if (cpuTimeMs === null || cpuTimeMs < 0) problems.push("missing-or-negative-cpu");
    else if (cpuTimeMs >= cpuHeadroomExclusiveMs) problems.push("cpu>=8");
    if (wallTimeMs === null || wallTimeMs < 0) problems.push("missing-or-negative-wall-time");
    if (
      eventTimestamp === null ||
      (input.captureStartedAt !== undefined && eventTimestamp < input.captureStartedAt)
    ) {
      problems.push("stale-event-timestamp");
    }
    if (forbiddenBackgroundLog(record.logs)) problems.push("failure-log");
  }

  if (event && input.mode === "queue") {
    if (event.queue !== MEMORY_POST_TURN_QUEUE_NAME) problems.push("wrong-queue");
    if (event.batchSize !== 1) problems.push("queue-batch-size");
    if (!input.correlationId || !queueLogMatches(record?.logs, input.correlationId)) {
      problems.push("queue-correlation");
    }
  }
  if (event && input.mode === "scheduled") {
    const scheduledTime = finiteNumber(event.scheduledTime);
    if (event.cron !== "0 3 * * *") problems.push("wrong-cron");
    if (
      scheduledTime === null ||
      !input.expectedScheduledDay ||
      !scheduledTimeMatchesUtcDay(scheduledTime, input.expectedScheduledDay)
    ) {
      problems.push("wrong-scheduled-time");
    }
    if (
      scheduledTime !== null &&
      (eventTimestamp === null ||
        eventTimestamp < scheduledTime ||
        eventTimestamp > scheduledTime + 15 * 60_000)
    ) {
      problems.push("scheduled-event-window");
    }
    if (!scheduledLogMatches(record?.logs)) problems.push("scheduled-success-log");
  }

  return {
    ok: problems.length === 0,
    mode: input.mode,
    expectedVersion: input.expectedVersion,
    matchedEvents: correlated.length,
    cpuTimeMs,
    wallTimeMs,
    problems,
  };
}

async function waitForBackgroundOutcome(
  tail: ChildProcess,
  output: () => string,
  input: EvaluationInput,
  timeoutMs: number,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const evaluation = evaluateProductionBackgroundTail(output(), input);
    if (evaluation.matchedEvents > 0) {
      await delay(2_000);
      return evaluateProductionBackgroundTail(output(), input);
    }
    if (hasExited(tail)) throw new Error("Wrangler tail exited before background evidence arrived.");
    await delay(1_000);
  }
  return evaluateProductionBackgroundTail(output(), input);
}

function readQueueId(wrangler: string) {
  const result = spawnSync(
    wrangler,
    ["queues", "info", MEMORY_POST_TURN_QUEUE_NAME],
    {
      cwd: process.cwd(),
      env: commandEnv(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (result.status !== 0) throw new Error("Could not resolve the production Queue ID.");
  const match = /^Queue ID:\s*([a-f0-9]{32})\s*$/im.exec(`${result.stdout}${result.stderr}`);
  if (!match?.[1]) throw new Error("Wrangler returned an invalid production Queue ID.");
  return match[1];
}

function buildQueueProbe(): QueueProbe {
  const nonce = randomUUID();
  return {
    correlationId: `inspir-background-cpu-probe:${nonce}`,
    userId: `inspir-background-cpu-probe-user:${nonce}`,
    chatId: `inspir-background-cpu-probe-chat:${nonce}`,
  };
}

function exactBackgroundEventKind(
  event: Record<string, unknown>,
  mode: BackgroundOutcomeMode,
) {
  const keys = Object.keys(event).sort();
  return mode === "queue"
    ? keys.length === 2 && keys[0] === "batchSize" && keys[1] === "queue"
    : keys.length === 2 && keys[0] === "cron" && keys[1] === "scheduledTime";
}

function assertQueueProbeAbsent(wrangler: string, probe: QueueProbe) {
  const sql = [
    "SELECT",
    `  (SELECT COUNT(*) FROM users WHERE id = '${probe.userId}') AS users,`,
    `  (SELECT COUNT(*) FROM chats WHERE id = '${probe.chatId}') AS chats;`,
  ].join("\n");
  const result = spawnSync(
    wrangler,
    ["d1", "execute", D1_DATABASE_NAME, "--remote", "--json", "--command", sql],
    {
      cwd: process.cwd(),
      env: commandEnv(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (result.status !== 0) throw new Error("Could not prove Queue probe identifiers absent.");
  const parsed = parseJsonArray(result.stdout);
  const entry = asRecord(parsed[0]);
  const meta = asRecord(entry?.meta);
  const rows = Array.isArray(entry?.results) ? entry.results : [];
  const row = rows.length === 1 ? asRecord(rows[0]) : null;
  if (
    parsed.length !== 1 ||
    entry?.success !== true ||
    meta?.rows_written !== 0 ||
    row?.users !== 0 ||
    row.chats !== 0
  ) {
    throw new Error("Queue probe identifiers were present or their absence was indeterminate.");
  }
}

function parseJsonArray(output: string) {
  let value: unknown;
  try {
    value = JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error("Wrangler returned invalid JSON.");
  }
  if (!Array.isArray(value)) throw new Error("Wrangler returned a non-array JSON result.");
  return value;
}

function assertSoleActiveVersion(wrangler: string, expectedVersion: string) {
  const result = spawnSync(
    wrangler,
    ["deployments", "status", "--name", workerName, "--json"],
    {
      cwd: process.cwd(),
      env: commandEnv(),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
    },
  );
  if (result.status !== 0) throw new Error("Could not read the active Worker deployment.");
  let value: unknown;
  try {
    value = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error("Active Worker deployment output was invalid.");
  }
  const deployment = asRecord(value);
  const versions = Array.isArray(deployment?.versions) ? deployment.versions : [];
  const active = versions.length === 1 ? asRecord(versions[0]) : null;
  if (active?.version_id !== expectedVersion || active.percentage !== 100) {
    throw new Error("Background validation requires the expected Worker alone at 100% traffic.");
  }
}

async function pushStaleQueueProbe(queueId: string, probe: QueueProbe) {
  const credential = readCloudflareApiToken();
  const token = credential.token;
  if (credential.error || token.length < 20 || token.length > 2048) {
    throw new Error("Production Queue validation requires a valid Cloudflare API token.");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/queues/${queueId}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        body: {
          type: "memory.post_turn.v2",
          enqueuedAt: new Date().toISOString(),
          aiRunId: probe.correlationId,
          userId: probe.userId,
          chatId: probe.chatId,
          topic: { id: "production-cpu-probe", name: "Production CPU probe", slug: "production-cpu-probe" },
          userMessageId: `${probe.correlationId}:user`,
          assistantMessageId: `${probe.correlationId}:assistant`,
          contextMessageIds: [],
        },
        content_type: "json",
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await readBoundedText(response, 64 * 1024);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Cloudflare Queue push returned invalid JSON.");
  }
  const record = asRecord(value);
  if (!response.ok || record?.success !== true) {
    throw new Error(`Cloudflare Queue push failed with HTTP ${response.status}.`);
  }
}

function queueLogMatches(logs: unknown, correlationId: string) {
  if (!correlationId) return false;
  return structuredLogRecords(logs).some((log) =>
    log.event === "native_memory_queue_processed" &&
    log.type === "memory.post_turn.v2" &&
    log.userId === correlationId &&
    log.outcome === "stale_job"
  );
}

function scheduledLogMatches(logs: unknown) {
  return structuredLogRecords(logs).some((log) =>
    log.event === "native_memory_scheduled_enqueued" &&
    nonNegativeSafeInteger(log.due) !== null &&
    log.queued === log.due &&
    log.failed === 0 &&
    log.skipped === null &&
    log.cron === "0 3 * * *"
  );
}

function forbiddenBackgroundLog(logs: unknown) {
  const serialized = JSON.stringify(logs ?? null);
  return /exceededCpu|exceededMemory|native_memory_queue_failed|native_rate_limit_cleanup_failed|native_admin_totals_refresh_failed|native_stale_ai_run_cleanup_failed/i.test(
    serialized,
  );
}

function structuredLogRecords(logs: unknown) {
  if (!Array.isArray(logs)) return [];
  const records: Record<string, unknown>[] = [];
  for (const entry of logs) {
    const log = asRecord(entry);
    const messages = Array.isArray(log?.message) ? log.message : [log?.message];
    for (const message of messages) {
      if (typeof message !== "string" || message.length > 32 * 1024) continue;
      try {
        const parsed = asRecord(JSON.parse(message) as unknown);
        if (parsed) records.push(parsed);
      } catch {
        // Only structured application logs can correlate background work.
      }
    }
  }
  return records;
}

function scheduledTimeMatchesUtcDay(value: number, expectedDay: string) {
  if (!Number.isSafeInteger(value) || value < 0) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === expectedDay &&
    date.getUTCHours() === 3 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
}

function captureTail(tail: ChildProcess) {
  let output = "";
  let diagnostics = "";
  let overflowed = false;
  const append = (target: "output" | "diagnostics", chunk: Buffer | string) => {
    const text = chunk.toString();
    if (Buffer.byteLength(output) + Buffer.byteLength(diagnostics) + Buffer.byteLength(text) > tailOutputLimitBytes) {
      overflowed = true;
      return;
    }
    if (target === "output") output += text;
    else diagnostics += text;
  };
  tail.stdout?.on("data", (chunk: Buffer | string) => append("output", chunk));
  tail.stderr?.on("data", (chunk: Buffer | string) => append("diagnostics", chunk));
  const closed = new Promise<void>((resolve) => {
    tail.once("close", () => resolve());
  });
  return {
    output: () => {
      if (overflowed) throw new Error("Wrangler tail output exceeded its bounded capture size.");
      return output;
    },
    diagnostics: () => diagnostics,
    closed,
  };
}

async function waitForTailReadiness(
  tail: ChildProcess,
  output: () => string,
  expectedVersion: string,
) {
  const probe = createPublicBackgroundProbe("ready");
  const startedAt = Date.now();
  while (Date.now() - startedAt < tailReadyTimeoutMs) {
    if (hasExited(tail)) throw new Error("Wrangler tail exited before it became ready.");
    const url = new URL("/api/health", "https://inspirlearning.com");
    url.searchParams.set("background_tail_ready", probe);
    const response = await fetch(url, {
      headers: {
        "cache-control": "no-cache",
        "Cloudflare-Workers-Version-Overrides": `${workerName}="${expectedVersion}"`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    await response.body?.cancel();
    if (response.status !== 200) {
      throw new Error(`Background tail readiness health probe returned HTTP ${response.status}.`);
    }
    await delay(500);
    if (tailHasReadinessProbe(output(), probe, expectedVersion)) return;
  }
  throw new Error("Wrangler tail did not become ready before the bounded timeout.");
}

export function createPublicBackgroundProbe(label: string, now = Date.now(), pid = process.pid) {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 32);
  if (!safeLabel || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(pid) || pid < 0) {
    throw new Error("Background tail probe identity is invalid.");
  }
  return `inspir-background-${safeLabel}-${now}-${pid}`;
}

export function tailHasReadinessProbe(
  source: string,
  probe: string,
  expectedVersion: string,
) {
  return extractJsonObjects(source).some((value) => {
    const record = asRecord(value);
    const event = asRecord(record?.event);
    const request = asRecord(event?.request);
    const response = asRecord(event?.response);
    const scriptVersion = asRecord(record?.scriptVersion);
    if (
      record?.outcome !== "ok" ||
      record.scriptName !== workerName ||
      scriptVersion?.id !== expectedVersion ||
      request?.method !== "GET" ||
      response?.status !== 200 ||
      typeof request.url !== "string"
    ) {
      return false;
    }
    try {
      const url = new URL(request.url);
      return url.pathname === "/api/health" && url.searchParams.get("background_tail_ready") === probe;
    } catch {
      return false;
    }
  });
}

async function stopTail(tail: ChildProcess, closed: Promise<void>) {
  if (hasExited(tail)) return;
  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
    tail.kill(signal);
    if (await resolvesWithin(closed, 5_000)) return;
  }
  throw new Error("Wrangler tail did not stop cleanly.");
}

function extractJsonObjects(source: string) {
  const parsed: unknown[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          parsed.push(JSON.parse(source.slice(start, index + 1)) as unknown);
        } catch {
          // Wrangler diagnostics may contain braces; only valid JSON records count.
        }
        start = -1;
      }
    }
  }
  return parsed;
}

async function readBoundedText(response: Response, maximumBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("Cloudflare API response was too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function readMode(): BackgroundOutcomeMode {
  const queue = process.argv.includes("--queue");
  const scheduled = process.argv.includes("--scheduled");
  if (queue === scheduled) throw new Error("Choose exactly one of --queue or --scheduled.");
  return queue ? "queue" : "scheduled";
}

function requireWorkerVersion(value: string | undefined) {
  if (!value || !workerVersionPattern.test(value)) {
    throw new Error("Background outcome validation requires an exact Worker version UUID.");
  }
  return value.toLowerCase();
}

function requireUtcDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Scheduled outcome validation requires a valid UTC day.");
  }
  return value;
}

function getArg(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function nonNegativeSafeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pathEntryExists(file: string) {
  return fs.existsSync(file);
}

function hasExited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function resolvesWithin(promise: Promise<unknown>, milliseconds: number) {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), milliseconds);
    void promise.then(() => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}
