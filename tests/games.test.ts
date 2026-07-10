import assert from "node:assert/strict";
import test from "node:test";
import {
  CHESS_ENGINE_ID,
  CHESS_ENGINE_VERSION,
  CONNECT_FOUR_ENGINE_ID,
  CONNECT_FOUR_ENGINE_VERSION,
  gameCatalog,
  getGameCatalogEntry,
  isGameSlug,
  TIC_TAC_TOE_ENGINE_ID,
  TIC_TAC_TOE_ENGINE_VERSION,
} from "../lib/games/catalog";
import {
  GAME_RESULT_SCHEMA_VERSION,
  gameResultSnapshotSchema,
  type GameActor,
} from "../lib/games/contracts";
import {
  applyTicTacToeMove,
  createTicTacToeState,
  legalTicTacToeActions,
  parseTicTacToeState,
  type TicTacToeMark,
  type TicTacToeState,
} from "../lib/games/tic-tac-toe";
import {
  applyConnectFourMove,
  createConnectFourState,
  legalConnectFourActions,
  parseConnectFourState,
  type ConnectFourDisc,
  type ConnectFourState,
} from "../lib/games/connect-four";
import {
  applyChessMove,
  CHESS_INITIAL_FEN,
  createChessState,
  legalChessActions,
  parseChessState,
  type ChessColor,
  type ChessState,
} from "../lib/games/chess";
import { isCompletedGameState, type GameState } from "../lib/games";

test("game catalog exposes three stable, non-localized engine contracts", () => {
  assert.deepEqual(
    gameCatalog.map((game) => game.slug),
    ["tic-tac-toe", "connect-four", "chess"],
  );
  assert.equal(new Set(gameCatalog.map((game) => game.engineId)).size, 3);
  assert.equal(getGameCatalogEntry("chess").engineId, CHESS_ENGINE_ID);
  assert.equal(getGameCatalogEntry("chess").engineVersion, CHESS_ENGINE_VERSION);
  assert.equal(getGameCatalogEntry("connect-four").engineVersion, CONNECT_FOUR_ENGINE_VERSION);
  assert.equal(isGameSlug("tic-tac-toe"), true);
  assert.equal(isGameSlug("snake"), false);
  assert.equal(isGameSlug(null), false);

  const states: readonly GameState[] = [
    createTicTacToeState(),
    createConnectFourState(),
    createChessState(),
  ];
  assert.deepEqual(states.map((state) => state.gameSlug), ["tic-tac-toe", "connect-four", "chess"]);
  assert.equal(states.every((state) => !isCompletedGameState(state)), true);
});

test("result snapshots enforce game, outcome, version, and opponent provenance", () => {
  const deterministic = {
    schemaVersion: GAME_RESULT_SCHEMA_VERSION,
    gameSlug: "tic-tac-toe",
    engineId: TIC_TAC_TOE_ENGINE_ID,
    engineVersion: TIC_TAC_TOE_ENGINE_VERSION,
    winner: "human",
    outcome: "win",
    terminalCode: "tic-tac-toe:three-in-a-row",
    plyCount: 5,
    provenance: {
      rulesEngine: { id: TIC_TAC_TOE_ENGINE_ID, version: TIC_TAC_TOE_ENGINE_VERSION },
      opponent: {
        kind: "deterministic-engine",
        engine: { id: "inspir.tic-tac-toe.opponent", version: "1.0.0" },
      },
    },
  } as const;
  assert.equal(gameResultSnapshotSchema.safeParse(deterministic).success, true);

  const model = {
    ...deterministic,
    provenance: {
      ...deterministic.provenance,
      opponent: {
        kind: "model",
        provider: "openai",
        model: "gpt-example",
        modelVersion: "2026-07-10",
        responseId: "response-1",
      },
    },
  } as const;
  assert.equal(gameResultSnapshotSchema.safeParse(model).success, true);

  const fallback = {
    ...deterministic,
    provenance: {
      ...deterministic.provenance,
      opponent: {
        kind: "deterministic-fallback",
        intendedProvider: "openai",
        intendedModel: "gpt-example",
        intendedModelVersion: "2026-07-10",
        fallbackEngine: { id: "inspir.tic-tac-toe.fallback", version: "1.0.0" },
        reason: "timeout",
      },
    },
  } as const;
  assert.equal(gameResultSnapshotSchema.safeParse(fallback).success, true);

  assert.equal(
    gameResultSnapshotSchema.safeParse({ ...deterministic, outcome: "loss" }).success,
    false,
  );
  assert.equal(
    gameResultSnapshotSchema.safeParse({ ...deterministic, terminalCode: "chess:checkmate" }).success,
    false,
  );
  assert.equal(
    gameResultSnapshotSchema.safeParse({
      ...deterministic,
      provenance: {
        ...deterministic.provenance,
        rulesEngine: { id: TIC_TAC_TOE_ENGINE_ID, version: "different" },
      },
    }).success,
    false,
  );
  assert.equal(
    gameResultSnapshotSchema.safeParse({
      ...deterministic,
      provenance: {
        ...deterministic.provenance,
        rulesEngine: { id: "different", version: TIC_TAC_TOE_ENGINE_VERSION },
      },
    }).success,
    false,
  );
});

test("tic-tac-toe starts with X, validates turns, and rejects occupied squares", () => {
  const state = createTicTacToeState("o");
  assert.equal(state.engineVersion, TIC_TAC_TOE_ENGINE_VERSION);
  assert.equal(state.activeActor, "opponent");
  assert.equal(legalTicTacToeActions(state).length, 9);

  const wrongActor = applyTicTacToeMove(state, "human", { index: 4 });
  assert.deepEqual(wrongActor, { ok: false, state, error: "not-your-turn" });

  const first = applyTicTacToeMove(state, "opponent", { index: 4 });
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("Expected legal tic-tac-toe move.");
  assert.equal(first.state.board[4], "x");
  assert.equal(first.state.activeActor, "human");

  const occupied = applyTicTacToeMove(first.state, "human", { index: 4 });
  assert.equal(occupied.ok, false);
  if (occupied.ok) throw new Error("Expected occupied square rejection.");
  assert.equal(occupied.error, "illegal-move");
});

test("tic-tac-toe records exact human and opponent wins", () => {
  const humanWin = playTicTacToe([0, 3, 1, 4, 2], "x");
  assert.equal(humanWin.result?.winner, "human");
  assert.equal(humanWin.result?.outcome, "win");
  assert.equal(humanWin.result?.terminalCode, "tic-tac-toe:three-in-a-row");
  assert.deepEqual(humanWin.result?.winningCells, [0, 1, 2]);
  assert.equal(legalTicTacToeActions(humanWin).length, 0);

  const afterComplete = applyTicTacToeMove(humanWin, "human", { index: 8 });
  assert.equal(afterComplete.ok, false);
  if (afterComplete.ok) throw new Error("Expected completed game rejection.");
  assert.equal(afterComplete.error, "game-complete");

  const opponentWin = playTicTacToe([0, 3, 1, 4, 2], "o");
  assert.equal(opponentWin.result?.winner, "opponent");
  assert.equal(opponentWin.result?.outcome, "loss");
});

test("tic-tac-toe identifies a full-board draw", () => {
  const state = playTicTacToe([0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(state.result?.winner, "draw");
  assert.equal(state.result?.terminalCode, "tic-tac-toe:board-full");
  assert.equal(state.result?.plyCount, 9);
  assert.equal(state.result?.winningCells, null);
});

test("tic-tac-toe parser rejects wrong board lengths and history mismatches", () => {
  const state = playTicTacToe([4]);
  assert.equal(parseTicTacToeState({ ...state, board: state.board.slice(0, 8) }).success, false);
  assert.equal(
    parseTicTacToeState({
      ...state,
      board: state.board.map(() => null),
    }).success,
    false,
  );

  const impossibleEarlyWin = {
    ...createTicTacToeState(),
    board: ["x", "x", "x", null, null, null, null, null, null],
    activeActor: null,
    plyCount: 3,
    history: [
      { ply: 1, actor: "human", mark: "x", index: 0 },
      { ply: 2, actor: "opponent", mark: "x", index: 1 },
      { ply: 3, actor: "human", mark: "x", index: 2 },
    ],
    result: null,
  };
  assert.equal(parseTicTacToeState(impossibleEarlyWin).success, false);
});

test("connect four applies gravity, validates turns, and rejects full columns", () => {
  let state = createConnectFourState("yellow");
  assert.equal(state.engineId, CONNECT_FOUR_ENGINE_ID);
  assert.equal(state.activeActor, "opponent");
  assert.equal(legalConnectFourActions(state).length, 7);

  const wrongActor = applyConnectFourMove(state, "human", { column: 3 });
  assert.equal(wrongActor.ok, false);
  if (wrongActor.ok) throw new Error("Expected wrong-turn rejection.");
  assert.equal(wrongActor.error, "not-your-turn");

  state = playConnectFour([0, 0, 0, 0, 0, 0], "yellow");
  assert.deepEqual(state.history.map((move) => move.row), [5, 4, 3, 2, 1, 0]);
  const full = applyConnectFourMove(state, activeActor(state), { column: 0 });
  assert.equal(full.ok, false);
  if (full.ok) throw new Error("Expected full-column rejection.");
  assert.equal(full.error, "illegal-move");
});

test("connect four detects horizontal, vertical, and diagonal wins", () => {
  const horizontal = playConnectFour([0, 0, 1, 1, 2, 2, 3]);
  assert.equal(horizontal.result?.winner, "human");
  assert.equal(horizontal.result?.terminalCode, "connect-four:four-in-a-row");
  assert.deepEqual(horizontal.result?.winningCells, [35, 36, 37, 38]);

  const vertical = playConnectFour([0, 1, 0, 1, 0, 1, 0]);
  assert.equal(vertical.result?.winner, "human");
  assert.deepEqual(vertical.result?.winningCells, [14, 21, 28, 35]);

  const diagonal = playConnectFour([0, 1, 1, 2, 3, 2, 2, 3, 4, 3, 3]);
  assert.equal(diagonal.result?.winner, "human");
  assert.deepEqual(diagonal.result?.winningCells, [35, 29, 23, 17]);

  const opponent = playConnectFour([0, 1, 0, 1, 2, 1, 2, 1]);
  assert.equal(opponent.result?.winner, "opponent");
  assert.equal(opponent.result?.outcome, "loss");
});

test("connect four identifies a legal 42-ply draw", () => {
  const sequence = [
    1, 6, 0, 6, 6, 4, 0, 1, 0, 1, 3, 3, 1, 2, 6, 1, 4, 6, 3, 3, 2, 5, 1, 6, 3, 5, 2, 2,
    3, 0, 0, 2, 0, 2, 4, 5, 5, 4, 5, 4, 4, 5,
  ];
  const state = playConnectFour(sequence);
  assert.equal(state.result?.winner, "draw");
  assert.equal(state.result?.terminalCode, "connect-four:board-full");
  assert.equal(state.result?.plyCount, 42);
  assert.equal(state.board.every((cell) => cell !== null), true);
});

test("connect four parser rejects wrong board lengths and floating history", () => {
  const state = createConnectFourState();
  assert.equal(parseConnectFourState({ ...state, board: state.board.slice(0, 41) }).success, false);
  const floatingHistory = [
    {
      ply: 1,
      actor: "human",
      disc: "red",
      column: 0,
      row: 0,
    },
  ];
  const floatingBoard = state.board.map((cell, index) => (index === 0 ? "red" : cell));
  assert.equal(
    parseConnectFourState({
      ...state,
      board: floatingBoard,
      activeActor: "opponent",
      plyCount: 1,
      history: floatingHistory,
    }).success,
    false,
  );
});

test("chess starts from an exact legal position and records legal moves", () => {
  const state = createChessState();
  assert.equal(state.fen, CHESS_INITIAL_FEN);
  assert.equal(state.activeActor, "human");
  assert.equal(legalChessActions(state).length, 20);
  assert.ok(legalChessActions(state).some((move) => move.token === "e2e4" && move.san === "e4"));

  const wrongActor = applyChessMove(state, "opponent", { token: "e2e4" });
  assert.equal(wrongActor.ok, false);
  if (wrongActor.ok) throw new Error("Expected wrong-turn rejection.");
  assert.equal(wrongActor.error, "not-your-turn");

  const illegal = applyChessMove(state, "human", { token: "e2e5" });
  assert.equal(illegal.ok, false);
  if (illegal.ok) throw new Error("Expected illegal chess move rejection.");
  assert.equal(illegal.error, "illegal-move");

  const moved = applyChessMove(state, "human", { token: "e2e4" });
  assert.equal(moved.ok, true);
  if (!moved.ok) throw new Error("Expected legal chess move.");
  assert.equal(moved.state.history[0]?.san, "e4");
  assert.equal(moved.state.activeActor, "opponent");
  assert.notEqual(moved.state.fen, CHESS_INITIAL_FEN);
  assert.equal(parseChessState(moved.state).success, true);

  const black = createChessState({ humanColor: "b" });
  assert.equal(black.activeActor, "opponent");
});

test("chess records exact human and opponent checkmates", () => {
  const foolsMate = playChess(["f2f3", "e7e5", "g2g4", "d8h4"]);
  assert.equal(foolsMate.result?.winner, "opponent");
  assert.equal(foolsMate.result?.outcome, "loss");
  assert.equal(foolsMate.result?.terminalCode, "chess:checkmate");
  assert.equal(legalChessActions(foolsMate).length, 0);

  const scholarsMate = playChess(["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"]);
  assert.equal(scholarsMate.result?.winner, "human");
  assert.equal(scholarsMate.result?.outcome, "win");
  assert.equal(scholarsMate.result?.terminalCode, "chess:checkmate");
});

test("chess distinguishes stalemate, insufficient material, fifty moves, and repetition", () => {
  const stalemate = createChessState({
    initialFen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1",
  });
  assert.equal(stalemate.result?.terminalCode, "chess:stalemate");

  const insufficient = createChessState({
    initialFen: "8/8/8/8/8/8/4K3/7k w - - 0 1",
  });
  assert.equal(insufficient.result?.terminalCode, "chess:insufficient-material");

  const fiftyMoves = createChessState({
    initialFen: "7k/8/8/8/8/8/R3K3/8 w - - 100 75",
  });
  assert.equal(fiftyMoves.result?.terminalCode, "chess:fifty-move-rule");

  const repetition = playChess([
    "g1f3",
    "g8f6",
    "f3g1",
    "f6g8",
    "g1f3",
    "g8f6",
    "f3g1",
    "f6g8",
  ]);
  assert.equal(repetition.result?.terminalCode, "chess:threefold-repetition");
  assert.equal(repetition.result?.winner, "draw");
});

test("chess supports promotion and rejects corrupt FEN/history snapshots", () => {
  const promotion = createChessState({
    initialFen: "7k/P7/8/8/8/8/7K/8 w - - 0 1",
  });
  assert.ok(legalChessActions(promotion).some((move) => move.token === "a7a8q" && move.promotion === "q"));
  const promoted = applyChessMove(promotion, "human", { token: "a7a8q" });
  assert.equal(promoted.ok, true);
  if (!promoted.ok) throw new Error("Expected legal promotion.");
  assert.equal(promoted.state.history[0]?.promotion, "q");

  assert.throws(() => createChessState({ initialFen: "not-a-fen" }));
  assert.equal(parseChessState({ ...createChessState(), initialFen: "not-a-fen" }).success, false);

  const moved = playChess(["e2e4"]);
  assert.equal(parseChessState({ ...moved, fen: CHESS_INITIAL_FEN }).success, false);
  assert.equal(
    parseChessState({
      ...moved,
      history: moved.history.map((move) => ({ ...move, token: "e2e3" })),
    }).success,
    false,
  );
});

function playTicTacToe(indices: readonly number[], humanMark: TicTacToeMark = "x") {
  let state = createTicTacToeState(humanMark);
  for (const index of indices) {
    const moved = applyTicTacToeMove(state, activeActor(state), { index });
    if (!moved.ok) assert.fail(`Tic-tac-toe move ${index} failed: ${moved.error}`);
    state = moved.state;
  }
  return state;
}

function playConnectFour(columns: readonly number[], humanDisc: ConnectFourDisc = "red") {
  let state = createConnectFourState(humanDisc);
  for (const column of columns) {
    const moved = applyConnectFourMove(state, activeActor(state), { column });
    if (!moved.ok) assert.fail(`Connect Four move ${column} failed: ${moved.error}`);
    state = moved.state;
  }
  return state;
}

function playChess(tokens: readonly string[], humanColor: ChessColor = "w") {
  let state = createChessState({ humanColor });
  for (const token of tokens) {
    const moved = applyChessMove(state, activeActor(state), { token });
    if (!moved.ok) assert.fail(`Chess move ${token} failed: ${moved.error}`);
    state = moved.state;
  }
  return state;
}

function activeActor(state: TicTacToeState | ConnectFourState | ChessState): GameActor {
  if (!state.activeActor) throw new Error("Expected an active game actor.");
  return state.activeActor;
}
