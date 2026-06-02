import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicSeeds, type TopicSeed } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";

type TopicCategoryProfile = {
  description: string;
  bestFor: string;
  searchIntents: string[];
};

const categoryProfiles: Record<string, TopicCategoryProfile> = {
  Foundations: {
    description:
      "Core AI tutoring modes for explanations, Socratic questions, shared work, and adaptive lessons.",
    bestFor: "Starting a new subject, repairing confusion, and turning curiosity into a clear first model.",
    searchIntents: ["AI tutor", "free AI learning app", "AI Socratic tutor", "learn anything with AI"],
  },
  Practice: {
    description:
      "Retrieval, feedback, homework hints, oral practice, and game-like study loops that make learners answer.",
    bestFor: "Checking understanding, getting unstuck, and building confidence through active practice.",
    searchIntents: ["AI homework helper", "AI quiz generator", "AI flashcard builder", "oral exam practice AI"],
  },
  STEM: {
    description:
      "Math, science, coding, data, and technical reasoning modes that slow problems down into learnable steps.",
    bestFor: "Working through equations, experiments, code, graphs, and technical concepts without answer dumping.",
    searchIntents: ["AI math tutor", "AI coding tutor", "science tutor AI", "data interpretation AI"],
  },
  Communication: {
    description:
      "Writing, language, presentations, public speaking, and note-making modes for clearer expression.",
    bestFor: "Planning, revising, explaining, speaking, and preserving the learner's own voice.",
    searchIntents: ["AI writing coach", "AI presentation coach", "language conversation AI", "summarize notes AI"],
  },
  Planning: {
    description:
      "Study planning, exam prep, projects, habits, careers, and motivation modes for turning learning into action.",
    bestFor: "Building realistic routines, preparing for deadlines, and choosing the next concrete move.",
    searchIntents: ["AI study planner", "AI exam prep planner", "career explorer AI", "project planning tutor"],
  },
  Thinking: {
    description:
      "Research, source criticism, metacognition, systems thinking, and decision support for sharper judgment.",
    bestFor: "Making claims precise, checking evidence, finding assumptions, and improving reasoning quality.",
    searchIntents: ["AI research assistant", "source credibility checker", "critical thinking AI", "decision coach AI"],
  },
  Immersion: {
    description:
      "Historical worlds, persona conversations, case simulations, and roleplay for learning through situation.",
    bestFor: "Exploring context, practicing conversations, and making abstract ideas feel concrete.",
    searchIntents: ["talk to historical figure AI", "AI time travel", "roleplay practice AI", "case study simulator AI"],
  },
  Argument: {
    description:
      "Debate modes that help learners make claims, face counterarguments, and improve reasoning under pressure.",
    bestFor: "Testing a position, seeing both sides, and learning what makes an argument stronger.",
    searchIntents: ["AI debate partner", "debate any topic AI", "argument practice AI", "critical thinking debate"],
  },
  Humanities: {
    description:
      "History, civics, geography, economics, philosophy, and ethics modes for context-rich understanding.",
    bestFor: "Connecting events, ideas, institutions, places, values, and tradeoffs.",
    searchIntents: ["history tutor AI", "philosophy tutor AI", "civics tutor AI", "economics simulator AI"],
  },
  Creativity: {
    description:
      "Story, art, music, and brainstorming modes that turn creative work into a guided learning process.",
    bestFor: "Generating ideas, interpreting art, hearing structure in music, and making concepts memorable.",
    searchIntents: ["creative writing tutor AI", "art appreciation AI", "music theory tutor AI", "brainstorming AI"],
  },
};

const spotlightCopy: Record<string, { intent: string; reason: string }> = {
  "learn-anything": {
    intent: "Understand a topic from zero",
    reason: "Best first stop when a learner has a question and needs a simple model before practice.",
  },
  "socratic-instruction": {
    intent: "Reason through a hard idea",
    reason: "Questions expose assumptions and gaps, so the learner builds the answer instead of copying one.",
  },
  "homework-coach": {
    intent: "Get homework help without cheating",
    reason: "Hint-first coaching keeps the final work with the learner while still removing the block.",
  },
  "math-step-coach": {
    intent: "Solve math one step at a time",
    reason: "The coach checks each move, names the rule, and repairs slips before moving forward.",
  },
  "writing-coach": {
    intent: "Improve a draft without losing your voice",
    reason: "Feedback focuses on structure, clarity, evidence, and revision choices instead of ghostwriting.",
  },
  "flashcard-builder": {
    intent: "Turn study notes into active recall",
    reason: "Explanations become review cards so learners can test memory rather than reread passively.",
  },
  "quiz-me-on-trivia": {
    intent: "Generate a quick practice quiz",
    reason: "Ten focused questions give immediate feedback and a simple review path.",
  },
  "talk-to-a-historical-person": {
    intent: "Talk to a historical figure",
    reason: "Historical persona mode separates simulation from documented fact while making context memorable.",
  },
};

const spotlightSlugs = Object.keys(spotlightCopy);

export const topicDirectoryFaqs = [
  {
    question: "Are these real public pages or just app screens?",
    answer:
      "They are real public guest-mode entrypoints. Each mode has a canonical /chat/{topicSlug} URL, visible starter prompts, learning guidance, and structured data for search engines.",
  },
  {
    question: "Can a learner open a mode without an account?",
    answer:
      "Yes. Public mode URLs open directly in guest mode so a learner can start immediately, then create an account later if they want saved history or more usage.",
  },
  {
    question: "Which mode should I choose first?",
    answer:
      "Use Learn Anything for broad explanations, Socratic Instruction for reasoning, Homework Coach for hint-first help, Math Step Coach for equations, and Flashcard Builder or Quiz me on Trivia for recall practice.",
  },
] as const;

export function topicCategorySlug(category: string) {
  return category
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getCategoryProfile(category: string): TopicCategoryProfile {
  return (
    categoryProfiles[category] ?? {
      description: `${category} learning modes on inspir.`,
      bestFor: "Choosing the right public guest learning mode for the task at hand.",
      searchIntents: [`${category.toLowerCase()} AI tutor`, `${category.toLowerCase()} learning assistant`],
    }
  );
}

export function getTopicCategoryHubs() {
  const groups = new Map<string, TopicSeed[]>();

  for (const topic of topicSeeds) {
    const category = topic.metadata.category;
    groups.set(category, [...(groups.get(category) ?? []), topic]);
  }

  return Array.from(groups.entries()).map(([category, topics]) => {
    const profile = getCategoryProfile(category);
    const sortedTopics = topics.toSorted((a, b) => a.sortOrder - b.sortOrder);

    return {
      slug: topicCategorySlug(category),
      name: category,
      href: `/topics#${topicCategorySlug(category)}`,
      description: profile.description,
      bestFor: profile.bestFor,
      searchIntents: profile.searchIntents,
      modeCount: sortedTopics.length,
      topics: sortedTopics,
      featuredModes: sortedTopics.slice(0, 4).map((topic) => {
        const seo = getTopicSeo(topic);
        return {
          slug: topic.slug,
          name: topic.name,
          href: topicPath(topic.slug),
          description: seo.description,
          starterPrompts: topic.metadata.starters.slice(0, 2),
        };
      }),
    };
  });
}

export function getTopicSpotlightModes() {
  return spotlightSlugs
    .map((slug) => {
      const topic = topicSeeds.find((candidate) => candidate.slug === slug);
      if (!topic) return null;
      const seo = getTopicSeo(topic);
      const copy = spotlightCopy[slug];

      return {
        slug: topic.slug,
        name: topic.name,
        href: topicPath(topic.slug),
        category: topic.metadata.category,
        uiMode: topic.metadata.uiMode,
        description: seo.description,
        intent: copy.intent,
        reason: copy.reason,
        starterPrompts: topic.metadata.starters.slice(0, 2),
      };
    })
    .filter((mode): mode is NonNullable<typeof mode> => Boolean(mode));
}
