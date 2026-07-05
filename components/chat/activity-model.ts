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
