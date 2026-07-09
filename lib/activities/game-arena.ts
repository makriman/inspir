import { Chess } from "chess.js";
import { z } from "zod";
import { generateOpenAiJsonObject } from "@/lib/ai/openai-client";
import { resolveModelName, type ModelProfile } from "@/lib/ai/model-router";
import { hasOpenAiRuntimeCredentials } from "@/lib/ai/openai-provider";
import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";

const gameSlugSchema = z.enum(["tic-tac-toe", "connect-four", "chess"]);
const gameModelProfileSchema = z.enum(["fast", "reasoning"]);
const participantSchema = z.enum(["human", "model"]);
const winnerSchema = z.union([participantSchema, z.literal("draw")]);
const boardCellSchema = z.enum(["", "X", "O"]);
const chessPieceSchema = z.object({
  square: z.string(),
  type: z.enum(["p", "n", "b", "r", "q", "k"]),
  color: z.enum(["w", "b"]),
});

const legalActionSchema = z.object({
  token: z.string().min(1),
  label: z.string().min(1),
  index: z.number().int().min(0).optional(),
  column: z.number().int().min(0).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  san: z.string().optional(),
  piece: z.string().optional(),
  promotion: z.string().optional(),
});

const moveRecordSchema = z.object({
  id: z.string().min(1),
  player: participantSchema,
  action: z.string().min(1),
  label: z.string().min(1),
  note: z.string().max(240).optional(),
  createdAt: z.string().min(1),
});

const gameArenaStateSchema = z.object({
  topic: z.string().min(1),
  gameSlug: gameSlugSchema,
  gameName: z.string().min(1),
  modelProfile: gameModelProfileSchema,
  modelName: z.string().min(1),
  humanSide: z.string().min(1),
  modelSide: z.string().min(1),
  humanMark: z.string().min(1),
  modelMark: z.string().min(1),
  activePlayer: participantSchema.nullable(),
  currentIndex: z.number().int().min(0).max(240),
  moveNumber: z.number().int().min(0).max(240),
  completed: z.boolean(),
  winner: winnerSchema.nullable(),
  statusText: z.string().min(1),
  board: z.array(boardCellSchema).optional(),
  chessFen: z.string().optional(),
  chessBoard: z.array(z.array(chessPieceSchema.nullable())).optional(),
  legalActions: z.array(legalActionSchema),
  moveHistory: z.array(moveRecordSchema).max(240),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const generatedMoveSchema = z.object({
  action: z.string().min(1),
  note: z.string().min(1).max(180),
});

export type GameSlug = z.infer<typeof gameSlugSchema>;
export type GameModelProfile = z.infer<typeof gameModelProfileSchema>;
export type GameArenaParticipant = z.infer<typeof participantSchema>;
export type GameArenaWinner = z.infer<typeof winnerSchema>;
export type GameArenaLegalAction = z.infer<typeof legalActionSchema>;
export type GameArenaState = z.infer<typeof gameArenaStateSchema>;
export type PublicGameArenaState = GameArenaState;

type ApplyMoveResult =
  | { ok: true; state: GameArenaState; action: GameArenaLegalAction }
  | { ok: false; state: GameArenaState; error: string };

type GameCatalogItem = {
  slug: GameSlug;
  name: string;
  shortName: string;
  description: string;
  sides: readonly [string, string];
};

export const gameArenaActivityType = "game-arena";
export const gameArenaTopicSlug = "ai-game-arena";

export const gameArenaCatalog: readonly GameCatalogItem[] = [
  {
    slug: "chess",
    name: "Chess",
    shortName: "Chess",
    description: "Play a legal chess game against an OpenAI opponent.",
    sides: ["White", "Black"],
  },
  {
    slug: "connect-four",
    name: "Connect Four",
    shortName: "Connect 4",
    description: "Drop discs and race the model to four in a row.",
    sides: ["Red", "Yellow"],
  },
  {
    slug: "tic-tac-toe",
    name: "Tic-Tac-Toe",
    shortName: "Tic-Tac-Toe",
    description: "A quick perfect-information game for testing tactics.",
    sides: ["X", "O"],
  },
] as const;

export const gameArenaModelOptions: ReadonlyArray<{
  profile: GameModelProfile;
  label: string;
  description: string;
}> = [
  { profile: "fast", label: "GPT-5 mini", description: "Quick tactical replies" },
  { profile: "reasoning", label: "GPT-5", description: "Slower, stronger play" },
] as const;

export function createGameArenaState(input: {
  gameSlug: GameSlug;
  humanSide?: string | null;
  modelProfile?: GameModelProfile | null;
}) {
  const game = getGameArenaCatalogItem(input.gameSlug);
  const modelProfile = input.modelProfile ?? "fast";
  const humanSide = normalizeSide(input.humanSide, game.sides);
  const modelSide = game.sides.find((side) => side !== humanSide) ?? game.sides[1];
  const now = new Date().toISOString();
  const state: GameArenaState = {
    topic: game.name,
    gameSlug: game.slug,
    gameName: game.name,
    modelProfile,
    modelName: resolveModelName(modelProfileToRouterProfile(modelProfile)),
    humanSide,
    modelSide,
    humanMark: sideMark(game.slug, humanSide),
    modelMark: sideMark(game.slug, modelSide),
    activePlayer: firstParticipantForSide(game.slug, humanSide),
    currentIndex: 0,
    moveNumber: 0,
    completed: false,
    winner: null,
    statusText: "",
    board: game.slug === "chess" ? undefined : initialBoard(game.slug),
    chessFen: game.slug === "chess" ? new Chess().fen() : undefined,
    chessBoard: undefined,
    legalActions: [],
    moveHistory: [],
    createdAt: now,
    updatedAt: now,
  };
  return deriveGameArenaState(state);
}

export function parseGameArenaState(value: unknown) {
  return gameArenaStateSchema.safeParse(value);
}

export function sanitizeGameArenaState(state: GameArenaState): PublicGameArenaState {
  return deriveGameArenaState(state);
}

export function applyHumanGameMove(state: GameArenaState, actionToken: string): ApplyMoveResult {
  if (state.completed) return { ok: false, state: deriveGameArenaState(state), error: "This match is already complete." };
  if (state.activePlayer !== "human") {
    return { ok: false, state: deriveGameArenaState(state), error: "It is not your turn yet." };
  }
  return applyGameMove(state, "human", actionToken);
}

export async function applyModelGameMove(
  state: GameArenaState,
  options: { preferredLanguage?: string | null } = {},
): Promise<ApplyMoveResult> {
  const current = deriveGameArenaState(state);
  if (current.completed) return { ok: false, state: current, error: "This match is already complete." };
  if (current.activePlayer !== "model") return { ok: false, state: current, error: "It is not the model's turn." };

  const selected = await chooseModelAction(current, options);
  return applyGameMove(current, "model", selected.token, selected.note);
}

export function gameArenaScore(state: GameArenaState) {
  if (!state.completed) return { score: null, maxScore: 1 };
  if (state.winner === "human") return { score: 1, maxScore: 1 };
  if (state.winner === "draw") return { score: 0, maxScore: 1 };
  return { score: 0, maxScore: 1 };
}

function applyGameMove(
  inputState: GameArenaState,
  player: GameArenaParticipant,
  actionToken: string,
  note?: string,
): ApplyMoveResult {
  const state = deriveGameArenaState(inputState);
  const action = state.legalActions.find((candidate) => candidate.token === actionToken);
  if (!action) return { ok: false, state, error: "That move is not legal in the current position." };

  const now = new Date().toISOString();
  const moved =
    state.gameSlug === "chess"
      ? applyChessMove(state, action)
      : applyBoardMove(state, player, action);
  if (!moved.ok) return moved;

  const next = deriveGameArenaState({
    ...moved.state,
    currentIndex: state.currentIndex + 1,
    moveNumber: state.moveNumber + 1,
    moveHistory: [
      ...state.moveHistory,
      {
        id: `m${state.moveNumber + 1}`,
        player,
        action: action.token,
        label: action.label,
        ...(note ? { note } : {}),
        createdAt: now,
      },
    ],
    updatedAt: now,
  });
  return { ok: true, state: next, action };
}

function applyBoardMove(
  state: GameArenaState,
  player: GameArenaParticipant,
  action: GameArenaLegalAction,
): ApplyMoveResult {
  const board = state.board;
  if (!board) return { ok: false, state, error: "Board state is missing." };
  const mark = player === "human" ? state.humanMark : state.modelMark;
  if (mark !== "X" && mark !== "O") return { ok: false, state, error: "Board mark is invalid." };

  if (state.gameSlug === "tic-tac-toe") {
    if (action.index === undefined || board[action.index] !== "") {
      return { ok: false, state, error: "That square is not legal." };
    }
    const nextBoard = board.map((cell, index) => (index === action.index ? mark : cell));
    return { ok: true, state: { ...state, board: nextBoard }, action };
  }

  if (action.column === undefined) return { ok: false, state, error: "That column is not legal." };
  for (let row = 5; row >= 0; row -= 1) {
    const index = row * 7 + action.column;
    if (board[index] === "") {
      const nextBoard = board.map((cell, cellIndex) => (cellIndex === index ? mark : cell));
      return { ok: true, state: { ...state, board: nextBoard }, action };
    }
  }
  return { ok: false, state, error: "That column is full." };
}

function applyChessMove(state: GameArenaState, action: GameArenaLegalAction): ApplyMoveResult {
  const chess = chessFromState(state);
  if (!action.from || !action.to) return { ok: false, state, error: "Chess move is missing squares." };
  chess.move({ from: action.from, to: action.to, promotion: action.promotion });
  return { ok: true, state: { ...state, chessFen: chess.fen() }, action };
}

function deriveGameArenaState(input: GameArenaState): GameArenaState {
  if (input.gameSlug === "chess") return deriveChessState(input);
  return deriveBoardState(input);
}

function deriveBoardState(input: GameArenaState): GameArenaState {
  const board = input.board ?? initialBoard(input.gameSlug);
  const winner = evaluateBoard(input.gameSlug, board, input.humanMark, input.modelMark);
  const completed = winner !== null;
  const activePlayer = completed ? null : nextBoardParticipant(input);
  return {
    ...input,
    board,
    chessFen: undefined,
    chessBoard: undefined,
    completed,
    winner,
    activePlayer,
    legalActions: completed ? [] : boardLegalActions(input.gameSlug, board),
    statusText: statusText({ ...input, completed, winner, activePlayer }),
  };
}

function deriveChessState(input: GameArenaState): GameArenaState {
  const chess = chessFromState(input);
  const winner = chessWinner(chess, input);
  const completed = winner !== null;
  const activePlayer = completed ? null : chessTurnParticipant(chess, input);
  return {
    ...input,
    board: undefined,
    chessFen: chess.fen(),
    chessBoard: chess.board(),
    completed,
    winner,
    activePlayer,
    legalActions: completed ? [] : chessLegalActions(chess),
    statusText: statusText({ ...input, completed, winner, activePlayer }),
  };
}

function statusText(state: Pick<GameArenaState, "completed" | "winner" | "activePlayer">) {
  if (state.completed) {
    if (state.winner === "human") return "You won the match.";
    if (state.winner === "model") return "The model won the match.";
    return "The match ended in a draw.";
  }
  return state.activePlayer === "human" ? "Your move." : "OpenAI is choosing a move.";
}

function nextBoardParticipant(state: GameArenaState): GameArenaParticipant {
  const humanStarts = firstParticipantForSide(state.gameSlug, state.humanSide) === "human";
  const humanTurn = humanStarts ? state.moveNumber % 2 === 0 : state.moveNumber % 2 === 1;
  return humanTurn ? "human" : "model";
}

function chessTurnParticipant(chess: Chess, state: GameArenaState): GameArenaParticipant {
  const humanColor = state.humanSide === "White" ? "w" : "b";
  return chess.turn() === humanColor ? "human" : "model";
}

function chessWinner(chess: Chess, state: GameArenaState): GameArenaWinner | null {
  if (chess.isCheckmate()) {
    return chessTurnParticipant(chess, state) === "human" ? "model" : "human";
  }
  if (chess.isDraw() || chess.isStalemate() || chess.isInsufficientMaterial() || chess.isThreefoldRepetition()) {
    return "draw";
  }
  return null;
}

function evaluateBoard(
  gameSlug: GameSlug,
  board: readonly string[],
  humanMark: string,
  modelMark: string,
): GameArenaWinner | null {
  const lines = gameSlug === "tic-tac-toe" ? ticTacToeLines : connectFourLines;
  for (const line of lines) {
    const values = line.map((index) => board[index]);
    if (values.every((value) => value === humanMark)) return "human";
    if (values.every((value) => value === modelMark)) return "model";
  }
  return board.every((cell) => cell !== "") ? "draw" : null;
}

function boardLegalActions(gameSlug: GameSlug, board: readonly string[]): GameArenaLegalAction[] {
  if (gameSlug === "tic-tac-toe") {
    return board.flatMap((cell, index) =>
      cell === ""
        ? [{
            token: String(index),
            label: ticTacToeSquareLabel(index),
            index,
          }]
        : [],
    );
  }

  return Array.from({ length: 7 }, (_, column) => column).flatMap((column) =>
    board[column] === ""
      ? [{
          token: String(column),
          label: `Column ${column + 1}`,
          column,
        }]
      : [],
  );
}

function chessLegalActions(chess: Chess): GameArenaLegalAction[] {
  return chess.moves({ verbose: true }).map((move) => ({
    token: move.lan,
    label: move.san,
    from: move.from,
    to: move.to,
    san: move.san,
    piece: move.piece,
    ...(move.promotion ? { promotion: move.promotion } : {}),
  }));
}

async function chooseModelAction(
  state: GameArenaState,
  options: { preferredLanguage?: string | null },
): Promise<GameArenaLegalAction & { note?: string }> {
  if (!hasOpenAiRuntimeCredentials()) return fallbackModelAction(state);

  try {
    const legalActions = state.legalActions;
    const language = normalizeLanguage(options.preferredLanguage ?? defaultLanguage);
    const object = await generateOpenAiJsonObject({
      model: state.modelName,
      schemaName: "game_arena_move",
      schema: generatedMoveSchema,
      system: [
        "You are playing a legal turn-based game against a learner inside inspir.",
        "Choose exactly one action from the legal action list. Do not invent moves.",
        "Prefer strong, legal play, but keep the short note encouraging and educational.",
        `Write the note in ${language}.`,
      ].join("\n"),
      prompt: [
        `Game: ${state.gameName}`,
        `You are ${state.modelSide}. The learner is ${state.humanSide}.`,
        `Position:\n${positionForPrompt(state)}`,
        `Legal actions:\n${legalActions.map((action) => `- ${action.token}: ${action.label}`).join("\n")}`,
        "Return the chosen action token and a short note about the idea behind the move.",
      ].join("\n\n"),
      temperature: state.modelProfile === "reasoning" ? 0.25 : 0.35,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(30_000),
    });
    const selected = legalActions.find((action) => action.token === object.action);
    if (selected) return { ...selected, note: object.note };
    return fallbackModelAction(state);
  } catch {
    return fallbackModelAction(state);
  }
}

function fallbackModelAction(state: GameArenaState): GameArenaLegalAction & { note?: string } {
  if (state.gameSlug === "tic-tac-toe" || state.gameSlug === "connect-four") {
    const tactical = tacticalBoardAction(state);
    if (tactical) return { ...tactical, note: "I picked a tactical move from the current threats." };
  }

  if (state.gameSlug === "chess") {
    const tactical = tacticalChessAction(state);
    if (tactical) return { ...tactical, note: "I chose a legal move with the strongest immediate tactic available." };
  }

  return {
    ...state.legalActions[0],
    note: "I chose the first legal move so the match can continue.",
  };
}

function tacticalBoardAction(state: GameArenaState): GameArenaLegalAction | null {
  const board = state.board;
  if (!board) return null;
  const ordered = orderedBoardActions(state);
  for (const mark of [state.modelMark, state.humanMark]) {
    const winningAction = ordered.find((action) => {
      const next = applyBoardActionForSearch(state.gameSlug, board, action, mark);
      return next ? evaluateBoard(state.gameSlug, next, state.humanMark, state.modelMark) !== null : false;
    });
    if (winningAction) return winningAction;
  }
  return ordered[0] ?? null;
}

function orderedBoardActions(state: GameArenaState): GameArenaLegalAction[] {
  if (state.gameSlug === "tic-tac-toe") {
    const preference = [4, 0, 2, 6, 8, 1, 3, 5, 7];
    return [...state.legalActions].sort(
      (a, b) => preference.indexOf(a.index ?? -1) - preference.indexOf(b.index ?? -1),
    );
  }
  const preference = [3, 2, 4, 1, 5, 0, 6];
  return [...state.legalActions].sort(
    (a, b) => preference.indexOf(a.column ?? -1) - preference.indexOf(b.column ?? -1),
  );
}

function applyBoardActionForSearch(
  gameSlug: GameSlug,
  board: readonly string[],
  action: GameArenaLegalAction,
  mark: string,
) {
  if (mark !== "X" && mark !== "O") return null;
  if (gameSlug === "tic-tac-toe") {
    if (action.index === undefined || board[action.index] !== "") return null;
    return board.map((cell, index) => (index === action.index ? mark : cell));
  }
  if (action.column === undefined) return null;
  for (let row = 5; row >= 0; row -= 1) {
    const index = row * 7 + action.column;
    if (board[index] === "") return board.map((cell, cellIndex) => (cellIndex === index ? mark : cell));
  }
  return null;
}

function tacticalChessAction(state: GameArenaState): GameArenaLegalAction | null {
  const legalActions = state.legalActions;
  let best: { action: GameArenaLegalAction; score: number } | null = null;

  for (const action of legalActions) {
    if (!action.from || !action.to) continue;
    const chess = chessFromState(state);
    const move = chess.move({ from: action.from, to: action.to, promotion: action.promotion });
    let score = 0;
    if (chess.isCheckmate()) score += 10_000;
    if (chess.isCheck()) score += 300;
    if (move.isCapture()) score += 100 + pieceValue(move.captured);
    if (move.isPromotion()) score += 700;
    score += centerBonus(action.to);
    if (!best || score > best.score) best = { action, score };
  }

  return best?.action ?? legalActions[0] ?? null;
}

function positionForPrompt(state: GameArenaState) {
  if (state.gameSlug === "chess") {
    return [
      `FEN: ${state.chessFen}`,
      state.chessBoard
        ?.map((row) =>
          row
            .map((piece) => {
              if (!piece) return ".";
              return piece.color === "w" ? piece.type.toUpperCase() : piece.type;
            })
            .join(" "),
        )
        .join("\n"),
    ]
      .filter(Boolean)
      .join("\n");
  }

  const width = state.gameSlug === "tic-tac-toe" ? 3 : 7;
  return (state.board ?? [])
    .map((cell) => cell || ".")
    .reduce<string[]>((rows, cell, index) => {
      if (index % width === 0) rows.push(cell);
      else rows[rows.length - 1] = `${rows[rows.length - 1]} ${cell}`;
      return rows;
    }, [])
    .join("\n");
}

function chessFromState(state: GameArenaState) {
  return new Chess(state.chessFen);
}

function getGameArenaCatalogItem(slug: GameSlug) {
  return gameArenaCatalog.find((game) => game.slug === slug) ?? gameArenaCatalog[0];
}

function normalizeSide(side: string | null | undefined, sides: readonly [string, string]) {
  return sides.find((candidate) => candidate.toLowerCase() === side?.trim().toLowerCase()) ?? sides[0];
}

function sideMark(gameSlug: GameSlug, side: string) {
  if (gameSlug === "chess") return side === "White" ? "w" : "b";
  if (gameSlug === "connect-four") return side === "Red" ? "X" : "O";
  return side;
}

function firstParticipantForSide(gameSlug: GameSlug, humanSide: string): GameArenaParticipant {
  if (gameSlug === "chess") return humanSide === "White" ? "human" : "model";
  if (gameSlug === "connect-four") return humanSide === "Red" ? "human" : "model";
  return humanSide === "X" ? "human" : "model";
}

function modelProfileToRouterProfile(profile: GameModelProfile): ModelProfile {
  return profile === "reasoning" ? "reasoning" : "fast";
}

function initialBoard(gameSlug: GameSlug) {
  return Array<string>(gameSlug === "tic-tac-toe" ? 9 : 42).fill("") as Array<"" | "X" | "O">;
}

function ticTacToeSquareLabel(index: number) {
  const labels = [
    "Top left",
    "Top middle",
    "Top right",
    "Middle left",
    "Center",
    "Middle right",
    "Bottom left",
    "Bottom middle",
    "Bottom right",
  ];
  return labels[index] ?? `Square ${index + 1}`;
}

function pieceValue(piece: string | undefined) {
  if (piece === "q") return 9;
  if (piece === "r") return 5;
  if (piece === "b" || piece === "n") return 3;
  if (piece === "p") return 1;
  return 0;
}

function centerBonus(square: string | undefined) {
  if (!square) return 0;
  if (["d4", "e4", "d5", "e5"].includes(square)) return 20;
  if (["c3", "d3", "e3", "f3", "c4", "f4", "c5", "f5", "c6", "d6", "e6", "f6"].includes(square)) return 8;
  return 0;
}

const ticTacToeLines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

const connectFourLines = (() => {
  const lines: number[][] = [];
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const start = row * 7 + column;
      if (column <= 3) lines.push([start, start + 1, start + 2, start + 3]);
      if (row <= 2) lines.push([start, start + 7, start + 14, start + 21]);
      if (row <= 2 && column <= 3) lines.push([start, start + 8, start + 16, start + 24]);
      if (row >= 3 && column <= 3) lines.push([start, start - 6, start - 12, start - 18]);
    }
  }
  return lines;
})();
