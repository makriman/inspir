import { getTopicCategoryHubs, topicCategorySlug } from "@/lib/content/topic-directory";
import { topicSeeds, type TopicSeed } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";

export const promptLibraryFaqs = [
  {
    question: "What is the best way to use these AI learning prompts?",
    answer:
      "Pick the learning job first, open the matching public mode, paste or adapt one starter prompt, then ask for a check, quiz, flashcard, or next-step review.",
  },
  {
    question: "Are these prompts just for ChatGPT?",
    answer:
      "They are written for inspir's public learning modes, but the patterns also show how to ask AI for better explanations, hints, questions, practice, and feedback.",
  },
  {
    question: "How are these prompts different from answer-copying?",
    answer:
      "The prompts are designed to start active learning loops: explanation, Socratic questioning, homework hints, quizzes, flashcards, critique, debate, planning, and review.",
  },
  {
    question: "Can schools use this prompt library?",
    answer:
      "Yes. Teachers and school leaders can use the public prompt library to evaluate learning behaviors before discussing a tailored school deployment.",
  },
] as const;

export const promptLibrarySearchIntents = [
  "AI tutor prompts",
  "AI study prompts",
  "ChatGPT prompts for learning",
  "AI homework help prompts",
  "AI Socratic tutor prompts",
  "AI flashcard prompts",
  "AI exam prep prompts",
  "AI writing feedback prompts",
] as const;

export function promptEntryId(topic: TopicSeed, index: number) {
  return `${topic.slug}-prompt-${index + 1}`;
}

export function getPromptEntries() {
  return topicSeeds.flatMap((topic) =>
    topic.metadata.starters.map((prompt, index) => ({
      id: promptEntryId(topic, index),
      prompt,
      topicSlug: topic.slug,
      topicName: topic.name,
      category: topic.metadata.category,
      href: topicPath(topic.slug),
      description: topic.subText,
      uiMode: topic.metadata.uiMode,
    })),
  );
}

export function getPromptCategoryHubs() {
  const entries = getPromptEntries();
  const categoryHubs = getTopicCategoryHubs();

  return categoryHubs.map((category) => {
    const prompts = entries.filter((entry) => topicCategorySlug(entry.category) === category.slug);

    return {
      slug: category.slug,
      name: category.name,
      href: `/prompts#${category.slug}`,
      description: category.description,
      bestFor: category.bestFor,
      searchIntents: category.searchIntents,
      promptCount: prompts.length,
      modeCount: category.modeCount,
      prompts,
      featuredPrompts: prompts.slice(0, 6),
    };
  });
}

export function getPromptSpotlightEntries() {
  const prioritySlugs = [
    "learn-anything",
    "socratic-instruction",
    "homework-coach",
    "math-step-coach",
    "writing-coach",
    "quiz-me-on-trivia",
    "flashcard-builder",
    "exam-prep-planner",
  ];
  const entries = getPromptEntries();

  return prioritySlugs
    .map((slug) => entries.find((entry) => entry.topicSlug === slug))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}
