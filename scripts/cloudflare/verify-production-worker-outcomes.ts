import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultLanguage, languageConfigs, supportedLanguages } from "../../lib/content/languages";
import {
  applyChessMove,
  createChessState,
  legalChessActions,
  type ChessState,
} from "../../lib/games/chess";
import { chooseChessOpponentAction } from "../../lib/games/chess-strategy";
import {
  applyConnectFourMove,
  createConnectFourState,
  legalConnectFourActions,
  type ConnectFourState,
} from "../../lib/games/connect-four";
import { chooseConnectFourOpponentAction } from "../../lib/games/connect-four-strategy";
import {
  applyTicTacToeMove,
  createTicTacToeState,
  legalTicTacToeActions,
  type TicTacToeState,
} from "../../lib/games/tic-tac-toe";
import { chooseTicTacToeOpponentAction } from "../../lib/games/tic-tac-toe-strategy";
import { cloudflareDir, commandEnv, resolveBackupDir } from "./migration-config";

const workerName = "inspirlearning";
const defaultBaseUrl = "https://inspirlearning.com";
const tailStartupMs = 5_000;
const tailDrainMs = 8_000;
const minimumCapturedInvocations = 10;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main() {
  if (!process.argv.includes("--confirm-production")) {
    throw new Error("Production Worker outcome verification requires --confirm-production.");
  }
  const expectedVersion = requireWorkerVersion(getArg("--expected-version") ?? process.env.EXPECTED_WORKER_VERSION);
  const baseUrl = normalizeBaseUrl(getArg("--base-url") ?? process.env.PRODUCTION_BASE_URL ?? defaultBaseUrl);
  const reportPath = path.join(
    cloudflareDir(resolveBackupDir()),
    "production-worker-outcomes-report.json",
  );
  const wrangler = path.resolve(process.cwd(), "node_modules/.bin/wrangler");
  const tail = spawn(
    wrangler,
    ["tail", workerName, "--format", "json", "--version-id", expectedVersion],
    { cwd: process.cwd(), env: commandEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  const capture = captureOutput(tail);

  try {
    await delay(tailStartupMs);
    if (tail.exitCode !== null) throw new Error(`Wrangler tail exited before the soak (${tail.exitCode}).`);

    const requests = await runResourceSoak(baseUrl, expectedVersion);
    await delay(tailDrainMs);
    await stopTail(tail);

    const records = extractJsonObjects(capture.output()).map(objectRecord).filter(isRecord);
    const outcomes = records
      .map((record) => (typeof record.outcome === "string" ? record.outcome : null))
      .filter((outcome): outcome is string => outcome !== null);
    const outcomeCounts = Object.fromEntries(
      Array.from(new Set(outcomes)).sort().map((outcome) => [outcome, outcomes.filter((value) => value === outcome).length]),
    );
    const nonOkOutcomes = outcomes.filter((outcome) => outcome !== "ok");
    const exceptionCount = records.reduce(
      (total, record) => total + (Array.isArray(record.exceptions) ? record.exceptions.length : 0),
      0,
    );
    const nonOkInvocations = records
      .filter(
        (record) =>
          record.outcome !== "ok" || (Array.isArray(record.exceptions) && record.exceptions.length > 0),
      )
      .slice(0, 50)
      .map(summarizeInvocation);
    const forbiddenLogPatterns = [
      /Dummy queue is not implemented/i,
      /exceededCpu/i,
      /exceededMemory/i,
    ];
    const logText = records.map((record) => JSON.stringify(record.logs ?? [])).join("\n");
    const forbiddenLogs = forbiddenLogPatterns
      .filter((pattern) => pattern.test(logText))
      .map((pattern) => pattern.source);
    const failedRequests = requests.filter((request) => !request.ok);
    const ok =
      outcomes.length >= minimumCapturedInvocations &&
      nonOkOutcomes.length === 0 &&
      exceptionCount === 0 &&
      forbiddenLogs.length === 0 &&
      failedRequests.length === 0;
    const report = {
      createdAt: new Date().toISOString(),
      ok,
      workerName,
      expectedVersion,
      baseUrl,
      requestCount: requests.length,
      failedRequests,
      capturedInvocations: outcomes.length,
      minimumCapturedInvocations,
      outcomeCounts,
      nonOkOutcomes,
      nonOkInvocations,
      exceptionCount,
      forbiddenLogs,
      tailExitCode: tail.exitCode,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    if (tail.exitCode === null) await stopTail(tail);
  }
}

async function runResourceSoak(baseUrl: string, expectedVersion: string) {
  const nonce = crypto.randomUUID();
  const localeRoutes = supportedLanguages
    .filter((language) => language !== defaultLanguage)
    .map((language) => `/${languageConfigs[language].prefix}`);
  const routes = [
    ...Array.from({ length: 12 }, (_, index) => `/api/health?resource_soak=${nonce}-${index}`),
    "/api/cache-health",
    `/api/auth/get-session?resource_soak=${nonce}`,
    "/games",
    "/games/tic-tac-toe",
    "/games/connect-four",
    "/games/chess",
    ...localeRoutes.map((route) => `${route}?resource_soak=${nonce}`),
  ];
  const results: Array<{ route: string; method: "GET" | "POST"; status: number; ok: boolean }> = [];
  for (let index = 0; index < routes.length; index += 8) {
    const batch = routes.slice(index, index + 8);
    results.push(
      ...(await Promise.all(
        batch.map(async (route) => {
          const headers = new Headers({
            "cache-control": "no-cache",
            "x-inspir-resource-soak": nonce,
            "Cloudflare-Workers-Version-Overrides": `${workerName}="${expectedVersion}"`,
          });
          const response = await fetch(new URL(route, baseUrl), {
            headers,
            redirect: "manual",
            signal: AbortSignal.timeout(30_000),
          });
          return { route, method: "GET" as const, status: response.status, ok: response.status < 500 };
        }),
      )),
    );
  }

  const completedGames = [
    { slug: "tic-tac-toe", state: completedStrategyTicTacToeState() },
    { slug: "connect-four", state: completedStrategyConnectFourState() },
    { slug: "chess", state: completedStrategyChessState() },
  ] as const;
  for (const game of completedGames) {
    const route = "/api/games/results";
    const response = await fetch(new URL(route, baseUrl), {
      method: "POST",
      headers: {
        "cache-control": "no-cache",
        "content-type": "application/json",
        "user-agent": `inspir-worker-outcome-${game.slug}-${nonce}`,
        "x-inspir-resource-soak": nonce,
        "Cloudflare-Workers-Version-Overrides": `${workerName}="${expectedVersion}"`,
      },
      body: JSON.stringify({
        state: game.state,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    results.push({
      route: `${route} (${game.slug})`,
      method: "POST",
      status: response.status,
      ok: response.status === 201,
    });
  }
  return results;
}

function completedStrategyTicTacToeState(): TicTacToeState {
  let state = createTicTacToeState("x");
  while (!state.result) {
    const action =
      state.activeActor === "opponent"
        ? chooseTicTacToeOpponentAction(state)
        : legalTicTacToeActions(state)[0] ?? null;
    if (!action || !state.activeActor) throw new Error("Could not build Tic-Tac-Toe outcome-soak state.");
    const applied = applyTicTacToeMove(state, state.activeActor, action);
    if (!applied.ok) throw new Error(`Tic-Tac-Toe outcome-soak move failed: ${applied.error}`);
    state = applied.state;
  }
  return state;
}

function completedStrategyConnectFourState(): ConnectFourState {
  let state = createConnectFourState("red");
  while (!state.result) {
    const action =
      state.activeActor === "opponent"
        ? chooseConnectFourOpponentAction(state)
        : legalConnectFourActions(state)[0] ?? null;
    if (!action || !state.activeActor) throw new Error("Could not build Connect Four outcome-soak state.");
    const applied = applyConnectFourMove(state, state.activeActor, action);
    if (!applied.ok) throw new Error(`Connect Four outcome-soak move failed: ${applied.error}`);
    state = applied.state;
  }
  return state;
}

export function completedStrategyChessState(): ChessState {
  let state = createChessState({ humanColor: "w" });
  while (!state.result) {
    const action =
      state.activeActor === "opponent"
        ? chooseChessOpponentAction(state)
        : [...legalChessActions(state)].sort((left, right) => left.token.localeCompare(right.token))[0] ?? null;
    if (!action || !state.activeActor) throw new Error("Could not build Chess outcome-soak state.");
    const applied = applyChessMove(state, state.activeActor, { token: action.token });
    if (!applied.ok) throw new Error(`Chess outcome-soak move failed: ${applied.error}`);
    state = applied.state;
  }
  return state;
}

function captureOutput(child: ChildProcess) {
  let output = "";
  const append = (chunk: Buffer | string) => {
    if (output.length < 16 * 1024 * 1024) output += chunk.toString();
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return { output: () => output };
}

async function stopTail(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGINT");
  const graceful = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
  if (!graceful && child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([exited, delay(5_000)]);
  }
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
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          parsed.push(JSON.parse(source.slice(start, index + 1)) as unknown);
        } catch {
          // Wrangler status text can contain braces; only complete JSON events count.
        }
        start = -1;
      }
    }
  }
  return parsed;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}

function summarizeInvocation(record: Record<string, unknown>) {
  const event = objectRecord(record.event);
  const request = objectRecord(event?.request);
  const response = objectRecord(event?.response);
  const exceptions = Array.isArray(record.exceptions) ? record.exceptions.map(objectRecord).filter(isRecord) : [];
  return {
    outcome: typeof record.outcome === "string" ? record.outcome : null,
    cpuTimeMs: finiteNumber(record.cpuTime),
    wallTimeMs: finiteNumber(record.wallTime),
    method: typeof request?.method === "string" ? request.method : null,
    path: safePathname(request?.url),
    status: finiteNumber(response?.status),
    exceptions: exceptions
      .map((exception) => (typeof exception.message === "string" ? exception.message : null))
      .filter((message): message is string => message !== null),
  };
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safePathname(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function requireWorkerVersion(value: string | undefined) {
  const version = value?.trim() ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(version)) {
    throw new Error("Worker outcome verification requires --expected-version <Worker version UUID>.");
  }
  return version;
}

function normalizeBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
