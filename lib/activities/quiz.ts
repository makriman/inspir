import { z } from "zod";
import type { ActivityRun } from "@/lib/db/schema";
import { generateOpenAiJsonObject } from "@/lib/ai/openai-client";
import { resolveModelName } from "@/lib/ai/model-router";
import { hasOpenAiRuntimeCredentials } from "@/lib/ai/openai-provider";
import { parseFlashcardState, sanitizeFlashcardState } from "@/lib/activities/flashcards";
import { gameArenaActivityType, parseGameArenaState, sanitizeGameArenaState } from "@/lib/activities/game-arena";
import { defaultLanguage, normalizeLanguage } from "@/lib/content/languages";

const quizQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
  userAnswerIndex: z.number().int().min(0).max(3).optional(),
  answeredAt: z.string().optional(),
});

const quizStateSchema = z.object({
  topic: z.string().min(1),
  currentIndex: z.number().int().min(0).max(10),
  score: z.number().int().min(0).max(10),
  maxScore: z.literal(10),
  completed: z.boolean(),
  questions: z.array(quizQuestionSchema).length(10),
});

export type QuizState = z.infer<typeof quizStateSchema>;

export type PublicQuizState = Omit<QuizState, "questions"> & {
  questions: Array<
    Omit<QuizState["questions"][number], "correctIndex" | "explanation"> & {
      correctIndex?: number;
      explanation?: string;
      isCorrect?: boolean;
    }
  >;
};

const generatedQuizSchema = z.object({
  questions: z.array(
    z.object({
      prompt: z.string().min(1),
      options: z.array(z.string().min(1)).length(4),
      correctIndex: z.number().int().min(0).max(3),
      explanation: z.string().min(1),
    }),
  ).length(10),
});

export async function generateQuiz(
  topic: string,
  options: { learnerAge?: number | null; preferredLanguage?: string | null } = {},
): Promise<QuizState> {
  if (!hasOpenAiRuntimeCredentials()) return fallbackQuiz(topic);

  try {
    const language = normalizeLanguage(options.preferredLanguage ?? defaultLanguage);
    const ageInstruction =
      typeof options.learnerAge === "number"
        ? `The learner is ${options.learnerAge} years old. Adapt content, examples, tone, and safety boundaries appropriately. Do not mention their age unless directly relevant or asked.`
        : undefined;
    const languageInstruction = `Write every learner-facing field in ${language}: question prompts, answer options, explanations, and topic wording.`;
    const object = await generateOpenAiJsonObject({
      model: resolveModelName("structured"),
      schemaName: "generated_quiz",
      schema: generatedQuizSchema,
      system: [
        "You are an expert quiz designer for a learner-first education app. Create fair multiple-choice questions. Do not include answer labels inside option text.",
        languageInstruction,
        ageInstruction,
      ]
        .filter(Boolean)
        .join("\n"),
      prompt: [
        `Create exactly 10 multiple-choice questions about: ${topic}.`,
        "Each question needs 4 plausible options, exactly one correct option, and a short explanation.",
        "Mix difficulty from easy to moderately challenging. Avoid obscure trivia unless the topic itself asks for it.",
      ].join("\n"),
      temperature: 0.35,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(35_000),
    });

    return {
      topic,
      currentIndex: 0,
      score: 0,
      maxScore: 10,
      completed: false,
      questions: object.questions.map((question, index) => ({
        id: `q${index + 1}`,
        ...question,
      })),
    };
  } catch {
    return fallbackQuiz(topic);
  }
}

export function answerQuizQuestion(state: QuizState, answerIndex: number) {
  const current = state.questions[state.currentIndex];
  if (!current || state.completed) {
    return { state, wasCorrect: false, changed: false };
  }
  if (current.userAnswerIndex !== undefined) {
    return { state, wasCorrect: current.userAnswerIndex === current.correctIndex, changed: false };
  }

  const wasCorrect = answerIndex === current.correctIndex;
  const questions = state.questions.map((question, index) =>
    index === state.currentIndex
      ? { ...question, userAnswerIndex: answerIndex, answeredAt: new Date().toISOString() }
      : question,
  );
  const score = questions.filter((question) => question.userAnswerIndex === question.correctIndex).length;
  const answeredCount = questions.filter((question) => question.userAnswerIndex !== undefined).length;
  const completed = answeredCount === questions.length;

  return {
    state: {
      ...state,
      questions,
      score,
      currentIndex: completed ? questions.length : Math.min(state.currentIndex + 1, questions.length - 1),
      completed,
    },
    wasCorrect,
    changed: true,
  };
}

export function sanitizeQuizState(state: QuizState): PublicQuizState {
  return {
    topic: state.topic,
    currentIndex: state.currentIndex,
    score: state.score,
    maxScore: state.maxScore,
    completed: state.completed,
    questions: state.questions.map((question) => {
      const answered = question.userAnswerIndex !== undefined;
      return {
        id: question.id,
        prompt: question.prompt,
        options: question.options,
        userAnswerIndex: question.userAnswerIndex,
        answeredAt: question.answeredAt,
        correctIndex: answered ? question.correctIndex : undefined,
        explanation: answered ? question.explanation : undefined,
        isCorrect: answered ? question.userAnswerIndex === question.correctIndex : undefined,
      };
    }),
  };
}

export function parseQuizState(value: unknown) {
  return quizStateSchema.safeParse(value);
}

export function sanitizeActivityRun(run: ActivityRun | undefined | null) {
  if (!run) return null;
  if (run.type === "flashcards") {
    const parsed = parseFlashcardState(run.state);
    return {
      ...run,
      state: parsed.success ? sanitizeFlashcardState(parsed.data) : run.state,
    };
  }
  if (run.type === gameArenaActivityType) {
    const parsed = parseGameArenaState(run.state);
    return {
      ...run,
      state: parsed.success ? sanitizeGameArenaState(parsed.data) : run.state,
    };
  }
  if (run.type !== "quiz") return run;
  const parsed = parseQuizState(run.state);
  return {
    ...run,
    state: parsed.success ? sanitizeQuizState(parsed.data) : run.state,
  };
}

function fallbackQuiz(topic: string): QuizState {
  const base = [
    "What is the best first step when learning this topic?",
    "Which habit helps understanding grow fastest?",
    "What should you do when an idea feels confusing?",
    "Which answer shows active recall?",
    "What is a useful way to check your understanding?",
    "Which strategy helps connect new ideas?",
    "What should a good learner do after a mistake?",
    "Which question is most useful for deeper learning?",
    "What makes an explanation strong?",
    "What is the best final step after a quiz?",
  ];
  return {
    topic,
    currentIndex: 0,
    score: 0,
    maxScore: 10,
    completed: false,
    questions: base.map((prompt, index) => ({
      id: `q${index + 1}`,
      prompt: `${prompt} (${topic})`,
      options: rotateOptions(
        [
        "Memorize without checking",
        "Explain it in your own words",
        "Skip anything difficult",
        "Only read the answer key",
        ],
        index,
      ),
      correctIndex: (1 - index + 4 * 10) % 4,
      explanation: "Explaining in your own words forces you to organize the idea and reveals gaps.",
    })),
  };
}

function rotateOptions(options: string[], offset: number) {
  const amount = offset % options.length;
  return [...options.slice(amount), ...options.slice(0, amount)];
}
