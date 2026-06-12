import { getBlogPosts } from "@/lib/content/blog";
import { homepageLearningPaths, learningPathHref, type HomepageLearningPath } from "@/lib/content/landing";
import { getPromptEntries } from "@/lib/content/prompt-library";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";

type LearningMapWorkflowSeed = {
  slug: string;
  title: string;
  kicker: string;
  description: string;
  audience: string;
  outcome: string;
  searchIntents: string[];
  pathSlug?: HomepageLearningPath["slug"];
  modeSlugs: string[];
  guideSlugs: string[];
  reviewLoop: string[];
};

const workflowSeeds: LearningMapWorkflowSeed[] = [
  {
    slug: "understand-anything",
    title: "Understand a hard topic",
    kicker: "First-principles learning",
    description:
      "Start with a simple explanation, pressure-test the idea with questions, then turn the weak spots into active recall.",
    audience: "Learners who are staring at a new subject and need the first clear foothold.",
    outcome:
      "A plain-language mental model, sharper questions, and review cards that make the idea easier to remember.",
    searchIntents: ["AI tutor for difficult concepts", "AI Socratic tutor", "AI flashcards for active recall"],
    pathSlug: "understand-a-hard-topic",
    modeSlugs: ["learn-anything", "socratic-instruction", "flashcard-builder"],
    guideSlugs: ["ai-learn-anything-guide", "socratic-ai-tutor", "ai-flashcards-and-active-recall"],
    reviewLoop: [
      "Explain the idea back in three sentences.",
      "Ask Socratic Instruction to find the weak link.",
      "Turn one hesitation into a flashcard.",
    ],
  },
  {
    slug: "homework-without-cheating",
    title: "AI homework help without cheating",
    kicker: "Hint-first support",
    description:
      "Use AI for the next hint, a step check, or draft feedback while keeping the final reasoning and voice yours.",
    audience: "Students who need help getting unstuck without turning the assignment into answer-copying.",
    outcome:
      "A smaller next step, a clearer mistake explanation, and a final answer the learner can actually defend.",
    searchIntents: ["AI homework help without cheating", "AI homework coach", "AI math step coach"],
    pathSlug: "get-unstuck-on-homework",
    modeSlugs: ["homework-coach", "math-step-coach", "writing-coach"],
    guideSlugs: [
      "how-to-study-with-ai-without-cheating-yourself",
      "ai-homework-coach-guide",
      "ai-math-step-coach-guide",
    ],
    reviewLoop: [
      "Name the exact stuck point before asking for help.",
      "Explain why the hint works before moving on.",
      "Save the corrected mistake as a checklist or flashcard.",
    ],
  },
  {
    slug: "exam-prep-active-recall",
    title: "Prepare for an exam with active recall",
    kicker: "Revision that tests memory",
    description:
      "Build a realistic study plan, quiz weak areas first, then convert mistakes into a repeatable review loop.",
    audience: "Learners with a syllabus, a deadline, and a need to study what actually matters.",
    outcome:
      "A plan that fits real life, quizzes that reveal weak areas, and review material built from errors.",
    searchIntents: ["AI exam prep plan", "AI study schedule", "AI quiz generator for exams"],
    pathSlug: "prepare-for-an-exam",
    modeSlugs: ["exam-prep-planner", "quiz-me-on-trivia", "flashcard-builder", "spaced-review"],
    guideSlugs: ["ai-exam-prep-planner-guide", "ai-quiz-me-on-trivia-guide", "ai-flashcard-builder-guide"],
    reviewLoop: [
      "Quiz before rereading.",
      "Repair the weakest concept with a simpler explanation.",
      "Schedule the next repetition while the miss is still fresh.",
    ],
  },
  {
    slug: "write-and-communicate",
    title: "Write and communicate clearly",
    kicker: "Feedback without losing your voice",
    description:
      "Plan, draft, read, speak, and defend ideas with feedback that improves the work without replacing the learner.",
    audience: "Students preparing essays, explanations, presentations, interviews, or oral exams.",
    outcome:
      "A clearer claim, better structure, stronger evidence, and practice saying the idea out loud.",
    searchIntents: ["AI writing feedback", "AI reading companion", "AI speaking practice"],
    modeSlugs: ["writing-coach", "reading-companion", "speaking-practice", "viva-practice"],
    guideSlugs: ["ai-writing-coach-guide", "ai-reading-companion-guide", "ai-speaking-practice-guide"],
    reviewLoop: [
      "Ask for one structural priority instead of a full rewrite.",
      "Read the response back and mark what sounds unlike you.",
      "Practice the final claim aloud until it feels owned.",
    ],
  },
  {
    slug: "learn-code-and-data",
    title: "Learn code, projects, and data",
    kicker: "Build to understand",
    description:
      "Use AI as a programming coach, project partner, data interpreter, and research helper while keeping the learner in the loop.",
    audience: "Beginners, builders, and self-taught learners who need small, testable next steps.",
    outcome:
      "A working next move, a clearer bug or concept, and a project path that teaches through doing.",
    searchIntents: ["AI code tutor", "learn programming with AI", "AI data interpreter"],
    modeSlugs: ["code-tutor", "data-interpreter", "project-coach", "research-assistant"],
    guideSlugs: ["ai-code-tutor-guide", "ai-data-interpreter-guide", "ai-project-coach-guide"],
    reviewLoop: [
      "Predict what the code or data should do before asking.",
      "Make one small change and test the result.",
      "Write the lesson learned before expanding the project.",
    ],
  },
  {
    slug: "history-ideas-and-debate",
    title: "Explore history, ideas, and debate",
    kicker: "Context before confidence",
    description:
      "Enter a historical context, interview a public figure from the past, and debate claims while keeping evidence labels visible.",
    audience: "Curious learners who want history and ideas to feel alive without confusing simulation for sources.",
    outcome:
      "A richer context, sharper questions, stronger counterarguments, and clearer evidence boundaries.",
    searchIntents: ["talk to historical figures AI", "AI history tutor", "AI debate practice"],
    pathSlug: "explore-history-and-ideas",
    modeSlugs: ["time-travel", "talk-to-a-historical-person", "debate-any-topic", "philosophy-lab"],
    guideSlugs: ["talk-to-historical-figures-with-ai", "ai-time-travel-guide", "ai-debate-any-topic-guide"],
    reviewLoop: [
      "Separate documented fact from plausible reconstruction.",
      "Ask what a different side would claim.",
      "Write the strongest claim and strongest counterclaim.",
    ],
  },
  {
    slug: "think-critically",
    title: "Think critically about sources and ideas",
    kicker: "Claims, evidence, assumptions",
    description:
      "Inspect sources, map concepts, find misconceptions, and turn research into a clearer argument.",
    audience: "Learners writing essays, reading complex material, or trying to judge whether a claim is well supported.",
    outcome:
      "A better evidence map, fewer hidden assumptions, and a cleaner explanation of what is known or uncertain.",
    searchIntents: ["AI source critic", "AI research assistant", "AI misconception checker"],
    modeSlugs: ["source-critic", "research-assistant", "misconception-doctor", "concept-map-builder"],
    guideSlugs: ["ai-source-critic-guide", "ai-research-assistant-guide", "ai-misconception-doctor-guide"],
    reviewLoop: [
      "Extract the claim before judging it.",
      "List what would change your mind.",
      "Map one misconception and the evidence that repairs it.",
    ],
  },
  {
    slug: "build-a-study-system",
    title: "Build a study system you can keep",
    kicker: "Plans, habits, reflection",
    description:
      "Turn vague motivation into a practical study plan, habit loop, review rhythm, and reflection habit.",
    audience: "Learners who do not just need one answer; they need a repeatable way to keep going.",
    outcome:
      "A realistic study routine, a smaller habit, and a reflective loop that catches drift early.",
    searchIntents: ["AI study plan builder", "AI habit coach", "AI motivation coach"],
    modeSlugs: ["study-plan-builder", "habit-coach", "motivation-coach", "mindset-reflection"],
    guideSlugs: ["ai-study-plan-builder-guide", "ai-habit-coach-guide", "ai-motivation-coach-guide"],
    reviewLoop: [
      "Choose the smallest useful session.",
      "Make the habit visible and easy to restart.",
      "Reflect on what blocked progress before changing the plan.",
    ],
  },
];

export const learningMapSearchIntents = [
  "AI learning map",
  "AI study workflow",
  "best AI tutor workflow",
  "AI learning paths",
  "AI prompts for studying",
  "free AI tutor for homework and exams",
] as const;

export const learningMapFaqs = [
  {
    question: "What is the AI learning map?",
    answer:
      "It is a public map of inspir learning workflows that connects live guest modes, starter prompts, learning paths, and practical guides by the job a learner needs done.",
  },
  {
    question: "Should I start with a guide, a prompt, or a mode?",
    answer:
      "Start with the live mode if you need help now, use a prompt if you know the exact move you want, and read the guide when you want the full study loop and mistakes to avoid.",
  },
  {
    question: "Are these workflows free to try?",
    answer:
      "Yes. The linked public learning modes open in guest mode, so learners can try explanations, Socratic questions, homework coaching, quizzes, flashcards, and more without starting from a marketing page.",
  },
  {
    question: "How does this help a learner choose what to do next?",
    answer:
      "The map connects a learning goal to the right public mode, starter prompt, guide, and review loop, while private saved chats stay private.",
  },
] as const;

const topicSeedBySlug = new Map(topicSeeds.map((topic) => [topic.slug, topic]));
const learningPathBySlug = new Map(homepageLearningPaths.map((path) => [path.slug, path]));

export function getLearningMapWorkflows() {
  const posts = getBlogPosts();
  const prompts = getPromptEntries();
  const postsBySlug = new Map(posts.map((post) => [post.slug, post]));
  const promptsByTopicSlug = prompts.reduce<Map<string, typeof prompts>>((map, entry) => {
    const existing = map.get(entry.topicSlug) ?? [];
    existing.push(entry);
    map.set(entry.topicSlug, existing);
    return map;
  }, new Map());

  return workflowSeeds.map((workflow) => {
    const path = workflow.pathSlug ? learningPathBySlug.get(workflow.pathSlug) : undefined;
    const modes = workflow.modeSlugs.flatMap((slug) => {
      const topic = topicSeedBySlug.get(slug);
      if (!topic) return [];
        const seo = getTopicSeo(topic);

        return {
          slug: topic.slug,
          name: topic.name,
          href: topicPath(topic.slug),
          category: topic.metadata.category,
          uiMode: topic.metadata.uiMode,
          description: seo.description,
          starterPrompts: topic.metadata.starters.slice(0, 2),
        };
    });

    return {
      ...workflow,
      href: `/ai-learning-map#${workflow.slug}`,
      path: path
        ? {
            slug: path.slug,
            title: path.title,
            href: learningPathHref(path.slug),
            description: path.description,
          }
        : null,
      modes,
      prompts: workflow.modeSlugs.flatMap((slug) => promptsByTopicSlug.get(slug) ?? []),
      guides: workflow.guideSlugs.flatMap((slug) => {
        const post = postsBySlug.get(slug);
        if (!post) return [];
        return {
          slug: post.slug,
          title: post.title,
          href: `/blog/${post.slug}`,
          description: post.description,
        };
      }),
    };
  });
}

export type LearningMapWorkflow = ReturnType<typeof getLearningMapWorkflows>[number];
