import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import type { ActivityRun } from "@/lib/db/schema";
import { resolveModelName } from "@/lib/ai/model-router";

const flashcardRatingSchema = z.enum(["known", "again"]);

const flashcardSchema = z.object({
  id: z.string(),
  front: z.string().min(1),
  back: z.string().min(1),
  hint: z.string().min(1),
  example: z.string().min(1),
  trap: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1).max(3),
  isRevealed: z.boolean().optional(),
  rating: flashcardRatingSchema.optional(),
  reviewedAt: z.string().optional(),
});

export const flashcardStateSchema = z.object({
  topic: z.string().min(1),
  source: z.string().optional(),
  currentIndex: z.number().int().min(0).max(12),
  knownCount: z.number().int().min(0).max(12),
  reviewedCount: z.number().int().min(0).max(12),
  maxCards: z.literal(12),
  completed: z.boolean(),
  cards: z.array(flashcardSchema).length(12),
});

export type FlashcardState = z.infer<typeof flashcardStateSchema>;
export type FlashcardRating = z.infer<typeof flashcardRatingSchema>;

export type PublicFlashcardState = Omit<FlashcardState, "cards"> & {
  cards: Array<
    Omit<FlashcardState["cards"][number], "back" | "example" | "trap"> & {
      back?: string;
      example?: string;
      trap?: string;
    }
  >;
};

const generatedFlashcardsSchema = z.object({
  cards: z.array(
    z.object({
      front: z.string().min(1),
      back: z.string().min(1),
      hint: z.string().min(1),
      example: z.string().min(1),
      trap: z.string().min(1),
      tags: z.array(z.string().min(1)).min(1).max(3),
    }),
  ).length(12),
});

export async function generateFlashcards(topic: string, source?: string): Promise<FlashcardState> {
  if (!process.env.OPENAI_API_KEY) return fallbackFlashcards(topic, source);

  try {
    const result = await generateObject({
      model: openai(resolveModelName("structured")),
      schema: generatedFlashcardsSchema,
      system:
        "You are an expert learning designer. Build retrieval-practice flashcards that are specific, accurate, and useful. Fronts should ask one thing only. Backs should be concise but complete.",
      prompt: [
        `Create exactly 12 flashcards for: ${topic}.`,
        source ? `Use this source material as the priority context:\n${source}` : undefined,
        "Each card needs a front, back, hint, example, common trap, and 1-3 tags.",
        "Mix definitions, applications, contrasts, and mistake checks. Avoid vague cards like 'What is important about this topic?'",
      ]
        .filter(Boolean)
        .join("\n\n"),
      temperature: 0.35,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(35_000),
    });

    return {
      topic,
      source,
      currentIndex: 0,
      knownCount: 0,
      reviewedCount: 0,
      maxCards: 12,
      completed: false,
      cards: result.object.cards.map((card, index) => ({
        id: `card${index + 1}`,
        ...card,
      })),
    };
  } catch {
    return fallbackFlashcards(topic, source);
  }
}

export function reviewFlashcard(
  state: FlashcardState,
  input: { action: "reveal" } | { action: "rate"; rating: FlashcardRating },
) {
  const current = state.cards[state.currentIndex];
  if (!current || state.completed) return { state, changed: false };

  if (input.action === "reveal") {
    if (current.isRevealed) return { state, changed: false };
    const cards = state.cards.map((card, index) =>
      index === state.currentIndex ? { ...card, isRevealed: true } : card,
    );
    return { state: { ...state, cards }, changed: true };
  }

  const cards = state.cards.map((card, index) =>
    index === state.currentIndex
      ? {
          ...card,
          isRevealed: true,
          rating: input.rating,
          reviewedAt: new Date().toISOString(),
        }
      : card,
  );
  const reviewedCount = cards.filter((card) => card.rating !== undefined).length;
  const knownCount = cards.filter((card) => card.rating === "known").length;
  const completed = reviewedCount === cards.length;

  return {
    state: {
      ...state,
      cards,
      knownCount,
      reviewedCount,
      currentIndex: completed ? cards.length : Math.min(state.currentIndex + 1, cards.length - 1),
      completed,
    },
    changed: true,
  };
}

export function sanitizeFlashcardState(state: FlashcardState): PublicFlashcardState {
  return {
    topic: state.topic,
    source: state.source,
    currentIndex: state.currentIndex,
    knownCount: state.knownCount,
    reviewedCount: state.reviewedCount,
    maxCards: state.maxCards,
    completed: state.completed,
    cards: state.cards.map((card) => {
      const visible = card.isRevealed || card.rating !== undefined || state.completed;
      return {
        id: card.id,
        front: card.front,
        hint: card.hint,
        tags: card.tags,
        isRevealed: card.isRevealed,
        rating: card.rating,
        reviewedAt: card.reviewedAt,
        back: visible ? card.back : undefined,
        example: visible ? card.example : undefined,
        trap: visible ? card.trap : undefined,
      };
    }),
  };
}

export function parseFlashcardState(value: unknown) {
  return flashcardStateSchema.safeParse(value);
}

export function sanitizeFlashcardActivityRun(run: ActivityRun | undefined | null) {
  if (!run) return null;
  const parsed = parseFlashcardState(run.state);
  return {
    ...run,
    state: parsed.success ? sanitizeFlashcardState(parsed.data) : run.state,
  };
}

function fallbackFlashcards(topic: string, source?: string): FlashcardState {
  const fronts = [
    "What is the core idea?",
    "What is one key term?",
    "What is a common mistake?",
    "How would you explain it simply?",
    "What is one real example?",
    "What should you compare it with?",
    "What is the first step in solving it?",
    "What clue helps you recognize it?",
    "Why does it matter?",
    "What is a useful memory hook?",
    "What question checks understanding?",
    "What is the best review habit?",
  ];

  return {
    topic,
    source,
    currentIndex: 0,
    knownCount: 0,
    reviewedCount: 0,
    maxCards: 12,
    completed: false,
    cards: fronts.map((front, index) => ({
      id: `card${index + 1}`,
      front: `${front} (${topic})`,
      back: "Say the idea in your own words, then connect it to one example.",
      hint: "Think of the simplest explanation you could give a friend.",
      example: `For ${topic}, pick one concrete case and explain what changes or why it works.`,
      trap: "Do not memorize the wording without checking whether you can use the idea.",
      tags: ["review", "core"],
    })),
  };
}
