import {
  GAME_RESULT_SCHEMA_VERSION,
  GAME_STATE_SCHEMA_VERSION,
  gameSlugSchema,
  type GameSlug,
  type GameTerminalCode,
} from "./contracts";

export const TIC_TAC_TOE_ENGINE_ID = "inspir.tic-tac-toe" as const;
export const TIC_TAC_TOE_ENGINE_VERSION = "1.0.0" as const;
export const CONNECT_FOUR_ENGINE_ID = "inspir.connect-four" as const;
export const CONNECT_FOUR_ENGINE_VERSION = "1.0.0" as const;
export const CHESS_ENGINE_ID = "inspir.chess" as const;
export const CHESS_ENGINE_VERSION = "1.0.0" as const;

export type GameCatalogEntry = Readonly<{
  slug: GameSlug;
  routeSegment: GameSlug;
  engineId: string;
  engineVersion: string;
  stateSchemaVersion: typeof GAME_STATE_SCHEMA_VERSION;
  resultSchemaVersion: typeof GAME_RESULT_SCHEMA_VERSION;
  sideCodes: readonly string[];
  terminalCodes: readonly GameTerminalCode[];
}>;

export const gameCatalog = [
  {
    slug: "tic-tac-toe",
    routeSegment: "tic-tac-toe",
    engineId: TIC_TAC_TOE_ENGINE_ID,
    engineVersion: TIC_TAC_TOE_ENGINE_VERSION,
    stateSchemaVersion: GAME_STATE_SCHEMA_VERSION,
    resultSchemaVersion: GAME_RESULT_SCHEMA_VERSION,
    sideCodes: ["x", "o"],
    terminalCodes: ["tic-tac-toe:three-in-a-row", "tic-tac-toe:board-full"],
  },
  {
    slug: "connect-four",
    routeSegment: "connect-four",
    engineId: CONNECT_FOUR_ENGINE_ID,
    engineVersion: CONNECT_FOUR_ENGINE_VERSION,
    stateSchemaVersion: GAME_STATE_SCHEMA_VERSION,
    resultSchemaVersion: GAME_RESULT_SCHEMA_VERSION,
    sideCodes: ["red", "yellow"],
    terminalCodes: ["connect-four:four-in-a-row", "connect-four:board-full"],
  },
  {
    slug: "chess",
    routeSegment: "chess",
    engineId: CHESS_ENGINE_ID,
    engineVersion: CHESS_ENGINE_VERSION,
    stateSchemaVersion: GAME_STATE_SCHEMA_VERSION,
    resultSchemaVersion: GAME_RESULT_SCHEMA_VERSION,
    sideCodes: ["w", "b"],
    terminalCodes: [
      "chess:checkmate",
      "chess:stalemate",
      "chess:insufficient-material",
      "chess:threefold-repetition",
      "chess:fifty-move-rule",
      "chess:move-limit",
    ],
  },
] as const satisfies readonly GameCatalogEntry[];

export function isGameSlug(value: unknown): value is GameSlug {
  return gameSlugSchema.safeParse(value).success;
}

export function getGameCatalogEntry(slug: GameSlug): GameCatalogEntry {
  const entry = gameCatalog.find((candidate) => candidate.slug === slug);
  if (!entry) throw new Error(`Unknown game slug: ${slug}`);
  return entry;
}
