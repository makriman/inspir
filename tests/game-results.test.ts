import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { Chess } from "chess.js";
import {
  CHESS_ENGINE_ID,
  CHESS_ENGINE_VERSION,
  CHESS_INITIAL_FEN,
  CHESS_MAX_PLIES,
  applyChessMove,
  createChessState,
  legalChessActions,
  parseChessResultSubmissionState,
  parseChessState,
  type ChessMove,
  type ChessState,
} from "../lib/games/chess";
import {
  chooseChessOpponentAction,
  chooseChessOpponentTokenFromLegalMoves,
} from "../lib/games/chess-strategy";
import {
  applyConnectFourMove,
  createConnectFourState,
  legalConnectFourActions,
  type ConnectFourState,
} from "../lib/games/connect-four";
import { chooseConnectFourOpponentAction } from "../lib/games/connect-four-strategy";
import {
  GAME_RESULT_IMMUTABLE_CACHE_CONTROL,
  GAME_RESULT_NO_STORE_CACHE_CONTROL,
  immutableGameResultJson,
  noStoreGameResultJson,
  readBoundedGameResultJson,
} from "../lib/games/result-http";
import {
  MAX_GAME_RESULT_REQUEST_BYTES,
  buildPublicGameResult,
  localStrategyIds,
  publicGameResultSchema,
} from "../lib/games/results";
import {
  applyTicTacToeMove,
  createTicTacToeState,
  legalTicTacToeActions,
  type TicTacToeState,
} from "../lib/games/tic-tac-toe";
import { chooseTicTacToeOpponentAction } from "../lib/games/tic-tac-toe-strategy";

const resultId = "gr_0123456789abcdef0123456789abcdef";
const completedAt = new Date("2026-07-10T12:00:00.000Z");

test("completed game submissions are replayed into server-owned immutable snapshots", () => {
  const completed = completeTicTacToe();
  const built = buildPublicGameResult(
    { state: completed, startedAt: "2026-07-10T11:59:55.000Z" },
    { now: completedAt, resultId },
  );
  assert.equal(built.ok, true);
  if (!built.ok) throw new Error("Expected a completed game result.");

  assert.equal(built.result.id, resultId);
  assert.equal(built.result.gameSlug, "tic-tac-toe");
  assert.equal(built.result.opponent.kind, "deterministic-engine");
  assert.equal(built.result.opponent.engine.id, localStrategyIds["tic-tac-toe"]);
  assert.equal(built.result.startedAt, "2026-07-10T11:59:55.000Z");
  assert.equal(built.result.completedAt, completedAt.toISOString());
  assert.equal(built.result.createdAt, completedAt.toISOString());
  assert.equal(built.result.durationMs, 5_000);
  assert.deepEqual(built.result.replay.moves, built.result.state.history);
  assert.equal(publicGameResultSchema.safeParse(built.result).success, true);
});

test("all three strict engines can create complete deterministic result records", () => {
  const inputs = [completeTicTacToe(), completeConnectFour(), completeChess()] as const;
  const built = inputs.map((state, index) =>
    buildPublicGameResult(
      { state },
      {
        now: completedAt,
        resultId: `gr_${String(index + 1).padStart(32, "0")}`,
      },
    ),
  );
  assert.equal(built.every((result) => result.ok), true);
  assert.deepEqual(
    built.map((result) => (result.ok ? result.result.gameSlug : null)),
    ["tic-tac-toe", "connect-four", "chess"],
  );
  assert.deepEqual(
    built.map((result) => (result.ok ? result.result.opponent.engine.id : null)),
    [localStrategyIds["tic-tac-toe"], localStrategyIds["connect-four"], localStrategyIds.chess],
  );
});

test("chess result validation uses one bounded replay and the playable 128-ply cap completes durably", () => {
  const completed = completeChessAtMoveLimit();
  assert.equal(completed.plyCount, CHESS_MAX_PLIES);
  assert.equal(completed.result?.terminalCode, "chess:move-limit");
  assert.deepEqual(applyChessMove(completed, "human", { token: "e1e2" }), {
    ok: false,
    state: completed,
    error: "game-complete",
  });

  let selectorCalls = 0;
  const replayed = parseChessResultSubmissionState(completed, (legalMoves) => {
    selectorCalls += 1;
    return chooseChessOpponentTokenFromLegalMoves(legalMoves);
  });
  assert.equal(replayed.success, true);
  assert.equal(
    selectorCalls,
    completed.history.filter((move) => move.actor === "opponent").length,
    "authoritative validation must invoke the opponent selector exactly once per opponent ply",
  );

  const iterations = 8;
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const built = buildPublicGameResult(
      { state: completed },
      {
        now: completedAt,
        resultId: `gr_${String(index + 100).padStart(32, "0")}`,
      },
    );
    assert.equal(built.ok, true);
  }
  const elapsedMs = performance.now() - started;
  assert.ok(
    elapsedMs < 3_000,
    `Eight worst-case 128-ply result validations took ${elapsedMs.toFixed(1)}ms (limit 3000ms).`,
  );
});

test("incomplete, structurally tampered, and non-strategy histories are rejected", () => {
  const incomplete = buildPublicGameResult(
    { state: createTicTacToeState() },
    { now: completedAt, resultId },
  );
  assert.deepEqual(incomplete, { ok: false, code: "incomplete-game" });

  const completed = completeTicTacToe();
  const tampered = buildPublicGameResult(
    { state: { ...completed, board: completed.board.map(() => null) } },
    { now: completedAt, resultId },
  );
  assert.deepEqual(tampered, { ok: false, code: "invalid-state" });

  const first = applyTicTacToeMove(createTicTacToeState(), "human", { index: 0 });
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("Expected legal human move.");
  const forgedOpponent = applyTicTacToeMove(first.state, "opponent", { index: 1 });
  assert.equal(forgedOpponent.ok, true);
  if (!forgedOpponent.ok) throw new Error("Expected legal but non-strategy opponent move.");
  assert.equal(forgedOpponent.state.result, null);
  const forged = buildPublicGameResult(
    { state: forgedOpponent.state },
    { now: completedAt, resultId },
  );
  assert.deepEqual(forged, { ok: false, code: "invalid-state" });
});

test("client outcome, provenance, unknown fields, and unsafe timestamps are never accepted", () => {
  const state = completeTicTacToe();
  const clientResult = buildPublicGameResult(
    {
      state,
      provenance: { kind: "model", model: "client-claim" },
    },
    { now: completedAt, resultId },
  );
  assert.deepEqual(clientResult, { ok: false, code: "invalid-request" });

  const future = buildPublicGameResult(
    { state, startedAt: "2026-07-10T12:00:00.001Z" },
    { now: completedAt, resultId },
  );
  assert.deepEqual(future, { ok: false, code: "invalid-started-at" });

  const tooOld = buildPublicGameResult(
    { state, startedAt: "2026-07-09T11:59:59.999Z" },
    { now: completedAt, resultId },
  );
  assert.deepEqual(tooOld, { ok: false, code: "invalid-started-at" });
});

test("request JSON is content-type checked and stream-bounded before validation", async () => {
  const wrongType = await readBoundedGameResultJson(
    new Request("https://example.test/api/games/results", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    }),
  );
  assert.deepEqual(wrongType, { ok: false, code: "invalid-content-type" });

  const oversized = await readBoundedGameResultJson(
    new Request("https://example.test/api/games/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "x".repeat(MAX_GAME_RESULT_REQUEST_BYTES) }),
    }),
  );
  assert.deepEqual(oversized, { ok: false, code: "payload-too-large" });

  const valid = await readBoundedGameResultJson(
    new Request("https://example.test/api/games/results", {
      method: "POST",
      headers: { "Content-Type": "application/problem+json; charset=utf-8" },
      body: JSON.stringify({ state: { gameSlug: "tic-tac-toe" } }),
    }),
  );
  assert.equal(valid.ok, true);
});

test("POST-style responses fail closed from caches and safe public GETs are immutable", async () => {
  const noStore = noStoreGameResultJson({ error: "invalid" }, 400);
  assert.equal(noStore.headers.get("Cache-Control"), GAME_RESULT_NO_STORE_CACHE_CONTROL);
  assert.equal(noStore.headers.get("CDN-Cache-Control"), GAME_RESULT_NO_STORE_CACHE_CONTROL);
  assert.equal(noStore.headers.get("Cloudflare-CDN-Cache-Control"), GAME_RESULT_NO_STORE_CACHE_CONTROL);
  assert.equal(noStore.headers.get("X-Content-Type-Options"), "nosniff");

  const immutable = immutableGameResultJson({ result: { id: resultId } });
  assert.equal(immutable.headers.get("Cache-Control"), GAME_RESULT_IMMUTABLE_CACHE_CONTROL);
  assert.equal(immutable.headers.get("CDN-Cache-Control"), GAME_RESULT_IMMUTABLE_CACHE_CONTROL);
  assert.equal(immutable.headers.get("Cloudflare-CDN-Cache-Control"), GAME_RESULT_IMMUTABLE_CACHE_CONTROL);
  assert.deepEqual(await immutable.json(), { result: { id: resultId } });
});

test("D1 and route contracts keep public snapshots immutable, non-personal, and bounded", () => {
  const migration = fs.readFileSync("drizzle-d1/0012_immutable_game_results.sql", "utf8");
  const schema = fs.readFileSync("lib/db/schema.ts", "utf8");
  const postRoute = fs.readFileSync("app/api/games/results/route.ts", "utf8");
  const getRoute = fs.readFileSync("app/api/games/results/[resultId]/route.ts", "utf8");
  const repository = fs.readFileSync("lib/games/result-repository.ts", "utf8");
  const results = fs.readFileSync("lib/games/results.ts", "utf8");
  const rateLimit = fs.readFileSync("lib/games/result-rate-limit.ts", "utf8");
  const packageJson = fs.readFileSync("package.json", "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS `game_results`/);
  assert.match(migration, /CHECK \(`schema_version` = 1\)/);
  assert.match(migration, /CHECK \(`ply_count` >= 0 AND `ply_count` <= 128\)/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS `game_results_reject_update`/);
  assert.doesNotMatch(migration, /reject_delete/);
  assert.match(schema, /export const gameResults = sqliteTable\("game_results"/);
  assert.match(schema, /payload: jsonText<PublicGameResult>/);
  assert.match(repository, /db\.insert\(gameResults\)/);
  assert.doesNotMatch(repository, /\.update\(|\.delete\(/);

  assert.ok(
    postRoute.indexOf("const quota = await consumeGameResultGuestQuota") <
      postRoute.indexOf("const body = await readBoundedGameResultJson"),
  );
  assert.ok(
    postRoute.indexOf("const body = await readBoundedGameResultJson") <
      postRoute.indexOf("const built = buildPublicGameResult"),
  );
  assert.match(postRoute, /writeFreezeResponse\("game-results"\)/);
  assert.match(postRoute, /Public writes are intentional/);
  assert.doesNotMatch(postRoute, /requireSession/);
  assert.match(getRoute, /Public read is intentional/);
  assert.match(getRoute, /immutableGameResultJson/);
  assert.match(rateLimit, /headers\.get\("cf-connecting-ip"\)/);
  assert.match(rateLimit, /process\.env\.NODE_ENV === "production" \? null/);
  assert.match(rateLimit, /game_result_authoritative_ip_missing/);
  assert.match(rateLimit, /sha256Hex\(`ip:\$\{ip\}`\)/);
  assert.match(rateLimit, /consumeFixedWindowQuotaOrThrow/);
  assert.match(rateLimit, /game_result_quota_unavailable/);
  assert.match(results, /state: chessStateSnapshotSchema/);
  assert.doesNotMatch(results, /chessStateSchema/);
  assert.doesNotMatch(repository, /gameResultIdSchema\.safeParse/);
  assert.doesNotMatch(repository, /publicGameResultSchema\.parse\(value\)/);
  assert.match(packageJson, /"cf:d1:apply-game-results"/);
});

function completeTicTacToe(): TicTacToeState {
  let state = createTicTacToeState();
  for (let turn = 0; turn < 9 && !state.result; turn += 1) {
    const actor = state.activeActor;
    if (!actor) break;
    const action =
      actor === "opponent" ? chooseTicTacToeOpponentAction(state) : legalTicTacToeActions(state)[0] ?? null;
    if (!action) throw new Error("Tic-tac-toe strategy did not return a legal action.");
    const applied = applyTicTacToeMove(state, actor, action);
    if (!applied.ok) throw new Error(`Tic-tac-toe completion failed: ${applied.error}`);
    state = applied.state;
  }
  if (!state.result) throw new Error("Tic-tac-toe did not complete.");
  return state;
}

function completeConnectFour(): ConnectFourState {
  let state = createConnectFourState();
  for (let turn = 0; turn < 42 && !state.result; turn += 1) {
    const actor = state.activeActor;
    if (!actor) break;
    const action =
      actor === "opponent" ? chooseConnectFourOpponentAction(state) : legalConnectFourActions(state)[0] ?? null;
    if (!action) throw new Error("Connect-four strategy did not return a legal action.");
    const applied = applyConnectFourMove(state, actor, action);
    if (!applied.ok) throw new Error(`Connect-four completion failed: ${applied.error}`);
    state = applied.state;
  }
  if (!state.result) throw new Error("Connect four did not complete.");
  return state;
}

function completeChess(): ChessState {
  let state = createChessState();
  for (let turn = 0; turn < 128 && !state.result; turn += 1) {
    const actor = state.activeActor;
    if (!actor) break;
    const action =
      actor === "opponent"
        ? chooseChessOpponentAction(state)
        : [...legalChessActions(state)].sort((left, right) => left.token.localeCompare(right.token))[0] ?? null;
    if (!action) throw new Error("Chess strategy did not return a legal action.");
    const applied = applyChessMove(state, actor, { token: action.token });
    if (!applied.ok) throw new Error(`Chess completion failed: ${applied.error}`);
    state = applied.state;
  }
  if (!state.result) throw new Error("Chess did not complete within the result API bound.");
  return state;
}

function completeChessAtMoveLimit(): ChessState {
  const chess = new Chess(CHESS_INITIAL_FEN);
  const history: ChessMove[] = [];
  let randomState = 5;

  for (let ply = 1; ply <= CHESS_MAX_PLIES; ply += 1) {
    assert.equal(chess.isGameOver(), false, `Seeded chess game ended before ply ${ply}.`);
    const legalMoves = chess.moves({ verbose: true });
    const actor = chess.turn() === "w" ? "human" : "opponent";
    let token: string | null;
    if (actor === "opponent") {
      token = chooseChessOpponentTokenFromLegalMoves(legalMoves);
    } else {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
      token = legalMoves[randomState % legalMoves.length]?.lan ?? null;
    }
    const selected = legalMoves.find((move) => move.lan === token);
    if (!selected) throw new Error(`Seeded chess game has no selected move at ply ${ply}.`);
    const moved = chess.move(selected.san);
    const promotion =
      moved.promotion === "n" ||
      moved.promotion === "b" ||
      moved.promotion === "r" ||
      moved.promotion === "q"
        ? moved.promotion
        : undefined;
    history.push({
      ply,
      actor,
      color: moved.color,
      token: moved.lan,
      san: moved.san,
      from: moved.from,
      to: moved.to,
      piece: moved.piece,
      ...(moved.captured ? { captured: moved.captured } : {}),
      ...(promotion ? { promotion } : {}),
    });
  }
  assert.equal(chess.isGameOver(), false, "Seeded position should complete only because of the arena cap.");

  const parsed = parseChessState({
    schemaVersion: 1,
    gameSlug: "chess",
    engineId: CHESS_ENGINE_ID,
    engineVersion: CHESS_ENGINE_VERSION,
    initialFen: CHESS_INITIAL_FEN,
    fen: chess.fen(),
    humanColor: "w",
    opponentColor: "b",
    activeActor: null,
    plyCount: CHESS_MAX_PLIES,
    history,
    result: {
      gameSlug: "chess",
      engineVersion: CHESS_ENGINE_VERSION,
      winner: "draw",
      outcome: "draw",
      terminalCode: "chess:move-limit",
      plyCount: CHESS_MAX_PLIES,
      finalFen: chess.fen(),
    },
  });
  if (!parsed.success) throw new Error(`Seeded move-limit state is invalid: ${parsed.error.message}`);
  return parsed.data;
}
