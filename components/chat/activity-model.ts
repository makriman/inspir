export type ActivityRun = {
  id: string;
  chatId: string;
  type: string;
  status: string;
  state: Record<string, unknown>;
  score: number | null;
  maxScore: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt: string | Date | null;
};

export type ActivityRunResponse = {
  activityRun: ActivityRun | null;
};

export type PublicQuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  userAnswerIndex?: number;
  correctIndex?: number;
  explanation?: string;
  isCorrect?: boolean;
};

export type PublicQuizState = {
  topic: string;
  currentIndex: number;
  score: number;
  maxScore: 10;
  completed: boolean;
  questions: PublicQuizQuestion[];
};

export type PublicFlashcard = {
  id: string;
  front: string;
  back?: string;
  hint?: string;
  example?: string;
  trap?: string;
  tags?: string[];
  isRevealed?: boolean;
  rating?: "known" | "again";
  reviewedAt?: string;
};

export type PublicFlashcardState = {
  topic: string;
  source?: string;
  currentIndex: number;
  knownCount: number;
  reviewedCount: number;
  maxCards: 12;
  completed: boolean;
  cards: PublicFlashcard[];
};

export type PublicGameArenaLegalAction = {
  token: string;
  label: string;
  index?: number;
  column?: number;
  from?: string;
  to?: string;
  san?: string;
  piece?: string;
  promotion?: string;
};

export type PublicGameArenaMove = {
  id: string;
  player: "human" | "model";
  action: string;
  label: string;
  note?: string;
  createdAt: string;
};

export type PublicChessPiece = {
  square: string;
  type: "p" | "n" | "b" | "r" | "q" | "k";
  color: "w" | "b";
};

export type PublicGameArenaState = {
  topic: string;
  gameSlug: "tic-tac-toe" | "connect-four" | "chess";
  gameName: string;
  modelProfile: "fast" | "reasoning";
  modelName: string;
  humanSide: string;
  modelSide: string;
  humanMark: string;
  modelMark: string;
  activePlayer: "human" | "model" | null;
  currentIndex: number;
  moveNumber: number;
  completed: boolean;
  winner: "human" | "model" | "draw" | null;
  statusText: string;
  board?: Array<"" | "X" | "O">;
  chessFen?: string;
  chessBoard?: Array<Array<PublicChessPiece | null>>;
  legalActions: PublicGameArenaLegalAction[];
  moveHistory: PublicGameArenaMove[];
  createdAt: string;
  updatedAt: string;
};

export type MergeActivityStateAction<State> = Partial<State> | ((state: State) => Partial<State>);

export function mergeActivityState<State>(state: State, nextState: MergeActivityStateAction<State>) {
  const patch = typeof nextState === "function" ? nextState(state) : nextState;
  return { ...state, ...patch };
}

export function isQuizState(value: Record<string, unknown>): value is PublicQuizState {
  return (
    typeof value.topic === "string" &&
    Array.isArray(value.questions) &&
    typeof value.currentIndex === "number"
  );
}

export function isFlashcardState(value: Record<string, unknown>): value is PublicFlashcardState {
  return (
    typeof value.topic === "string" &&
    Array.isArray(value.cards) &&
    typeof value.currentIndex === "number" &&
    typeof value.reviewedCount === "number"
  );
}

export function isGameArenaState(value: Record<string, unknown>): value is PublicGameArenaState {
  return (
    typeof value.topic === "string" &&
    typeof value.gameSlug === "string" &&
    typeof value.gameName === "string" &&
    typeof value.currentIndex === "number" &&
    typeof value.moveNumber === "number" &&
    typeof value.completed === "boolean" &&
    Array.isArray(value.legalActions) &&
    Array.isArray(value.moveHistory)
  );
}
