import { getBlogPosts } from "@/lib/content/blog";
import { getLearningMapWorkflows } from "@/lib/content/learning-map";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";

type ComparisonRow = {
  label: string;
  establishedOption: string;
  inspir: string;
};

type ComparisonUseCase = {
  title: string;
  text: string;
  href: string;
};

export type ComparisonPage = {
  slug: string;
  competitorName: string;
  eyebrow: string;
  title: string;
  seoTitle: string;
  description: string;
  shortAnswer: string;
  balancedPosition: string;
  searchIntents: string[];
  bestFor: string[];
  comparisonRows: ComparisonRow[];
  useCases: ComparisonUseCase[];
  relatedModeSlugs: string[];
  relatedGuideSlugs: string[];
  relatedWorkflowSlugs: string[];
  officialReferences: Array<{ title: string; href: string; text: string }>;
  faqs: Array<{ question: string; answer: string }>;
};

export const comparisonHubFaqs = [
  {
    question: "Are these pages saying inspir replaces every learning platform?",
    answer:
      "No. The comparison pages are written to show when inspir is a better first click for live AI tutoring, prompts, and guest learning modes, and when a structured curriculum or official course library may still be useful.",
  },
  {
    question: "Why make comparison pages at all?",
    answer:
      "Many learners search by comparing tools they already know. A clear comparison page helps them choose the right learning behavior without hiding the tradeoffs.",
  },
  {
    question: "Do the comparison pages include private user chats?",
    answer:
      "No. They link only to public pages, public guest modes, guides, prompts, and learning paths. Private saved chats stay outside discovery surfaces.",
  },
] as const;

export const comparisonHubSearchIntents = [
  "AI tutor alternatives",
  "Khan Academy alternative",
  "best AI learning app",
  "free AI tutor compared",
  "AI homework help alternative",
  "Socratic AI tutor alternative",
] as const;

const comparisonPages: ComparisonPage[] = [
  {
    slug: "khan-academy-alternative",
    competitorName: "Khan Academy",
    eyebrow: "Khan Academy alternative",
    title: "A Khan Academy alternative for live AI learning moments.",
    seoTitle: "Khan Academy Alternative for Live AI Tutoring",
    description:
      "Use inspir when you want a free public AI learning mode that can explain, question, quiz, coach homework, build flashcards, and adapt to the exact thing you are stuck on.",
    shortAnswer:
      "Khan Academy is excellent for structured lessons and practice. inspir is built for the moment a learner needs a live, promptable AI mode that can respond to their exact question, draft, problem, argument, or study plan.",
    balancedPosition:
      "This is not a claim that learners should abandon Khan Academy. For many topics, a trusted lesson library and a live AI learning mode work best together: learn the foundation, then use inspir to ask questions, repair confusion, practise recall, or get unstuck.",
    searchIntents: [
      "Khan Academy alternative",
      "AI tutor like Khan Academy",
      "free AI tutor alternative",
      "Khan Academy AI tutor alternative",
      "AI homework coach alternative",
      "Socratic AI tutor for students",
    ],
    bestFor: [
      "Learners who have a specific question and need help now.",
      "Students who want hints or step checks without answer-copying.",
      "People who learn better through conversation, questions, quizzes, and flashcards.",
      "Teachers or parents evaluating focused AI learning behaviors before a school deployment.",
    ],
    comparisonRows: [
      {
        label: "Learning shape",
        establishedOption:
          "Khan Academy is built around a broad library of lessons, practice, standards-aligned content, and mastery support.",
        inspir:
          "inspir is built around public guest AI modes: Socratic questions, homework hints, math steps, writing feedback, quizzes, flashcards, and study planning.",
      },
      {
        label: "Best first click",
        establishedOption:
          "Use a structured lesson when you know the course area and want a sequenced explanation or practice set.",
        inspir:
          "Use a live mode when you know the exact point of confusion and want the next explanation, question, hint, or review loop.",
      },
      {
        label: "Interaction style",
        establishedOption:
          "A learner often moves through prepared videos, articles, exercises, and dashboards.",
        inspir:
          "A learner starts inside a mode-specific chat and can ask for a simpler model, a harder question, a quiz, a flashcard deck, or a critique.",
      },
      {
        label: "Homework behavior",
        establishedOption:
          "Structured practice helps build foundations before and after homework.",
        inspir:
          "Homework Coach and Math Step Coach are tuned for hint-first support, step checks, and ownership of the final answer.",
      },
      {
        label: "Search landing pages",
        establishedOption:
          "A course library is strongest when the search query matches a known skill, topic, or standard.",
        inspir:
          "Public topic URLs let searches such as AI Socratic tutor, AI homework coach, AI flashcard builder, and talk to historical figures AI land directly in the matching mode.",
      },
      {
        label: "How to combine them",
        establishedOption:
          "Use the lesson library to learn the official sequence and practise core skills.",
        inspir:
          "Use inspir to turn confusion into questions, examples, retrieval practice, writing feedback, debate, and a personal study plan.",
      },
    ],
    useCases: [
      {
        title: "I watched a lesson but still do not get it.",
        text: "Open Learn Anything, ask for the prerequisite ideas, then switch into Socratic Instruction to test your model.",
        href: "/chat/learn-anything",
      },
      {
        title: "I need homework help without cheating.",
        text: "Paste the question, what you tried, and the stuck point. Ask for the smallest useful hint, not the final answer.",
        href: "/chat/homework-coach",
      },
      {
        title: "I need to remember this for an exam.",
        text: "Turn the explanation into quiz questions, flashcards, and a review schedule based on what you miss.",
        href: "/chat/flashcard-builder",
      },
      {
        title: "I want history to feel alive but still evidence-aware.",
        text: "Use Time Travel or Historical Person mode, while keeping generated dialogue separate from documented sources.",
        href: "/chat/time-travel",
      },
    ],
    relatedModeSlugs: [
      "learn-anything",
      "socratic-instruction",
      "homework-coach",
      "math-step-coach",
      "quiz-me-on-trivia",
      "flashcard-builder",
      "exam-prep-planner",
      "talk-to-a-historical-person",
    ],
    relatedGuideSlugs: [
      "ai-learning-companion-for-everyone",
      "ai-learn-anything-guide",
      "socratic-ai-tutor",
      "how-to-study-with-ai-without-cheating-yourself",
      "ai-homework-coach-guide",
      "ai-flashcards-and-active-recall",
    ],
    relatedWorkflowSlugs: ["understand-anything", "homework-without-cheating", "exam-prep-active-recall"],
    officialReferences: [
      {
        title: "Khan Academy about page",
        href: "https://www.khanacademy.org/about",
        text: "Official mission and subject coverage reference.",
      },
      {
        title: "Khanmigo official page",
        href: "https://www.khanacademy.org/khan-labs",
        text: "Official Khan Academy page for its AI-powered tutor and teaching assistant.",
      },
    ],
    faqs: [
      {
        question: "Is inspir a replacement for Khan Academy?",
        answer:
          "Not across every learning need. Khan Academy is useful for structured lessons and practice. inspir is useful when a learner needs live AI help, Socratic questions, hints, quizzes, flashcards, feedback, or a study workflow around the exact thing they are working on.",
      },
      {
        question: "When should I use inspir first?",
        answer:
          "Use inspir first when your search is about an action: explain this simply, ask me Socratic questions, give me a homework hint, check my math step, quiz me, build flashcards, debate this topic, or help me plan revision.",
      },
      {
        question: "Can I use inspir alongside Khan Academy?",
        answer:
          "Yes. A good workflow is to learn the foundation from a trusted lesson source, then use inspir to ask follow-up questions, practise recall, repair misconceptions, and plan what to review next.",
      },
      {
        question: "Does this comparison include private user chats?",
        answer:
          "No. The comparison links only to public guest-mode entrypoints, guides, prompt libraries, and learning paths. Private saved conversations are not used as source content.",
      },
    ],
  },
];

const topicSeedBySlug = new Map(topicSeeds.map((topic) => [topic.slug, topic]));

export function comparisonPath(slug: string) {
  return `/compare/${slug}`;
}

export function getComparisonPages() {
  return comparisonPages;
}

export function getComparisonPage(slug: string) {
  return comparisonPages.find((page) => page.slug === slug);
}

export function getComparisonPageResources(page: ComparisonPage) {
  const posts = getBlogPosts();
  const workflows = getLearningMapWorkflows();
  const postsBySlug = new Map(posts.map((post) => [post.slug, post]));
  const workflowsBySlug = new Map(workflows.map((workflow) => [workflow.slug, workflow]));

  return {
    modes: page.relatedModeSlugs.flatMap((slug) => {
      const topic = topicSeedBySlug.get(slug);
      if (!topic) return [];
        const seo = getTopicSeo(topic);
        return {
          slug: topic.slug,
          name: topic.name,
          href: topicPath(topic.slug),
          description: seo.description,
          category: topic.metadata.category,
          starters: topic.metadata.starters.slice(0, 2),
        };
    }),
    guides: page.relatedGuideSlugs.flatMap((slug) => {
      const post = postsBySlug.get(slug);
      if (!post) return [];
      return {
        slug: post.slug,
        title: post.title,
        href: `/blog/${post.slug}`,
        description: post.description,
      };
    }),
    workflows: page.relatedWorkflowSlugs.flatMap((slug) => {
      const workflow = workflowsBySlug.get(slug);
      if (!workflow) return [];
      return {
        slug: workflow.slug,
        title: workflow.title,
        href: workflow.href,
        description: workflow.description,
      };
    }),
  };
}
