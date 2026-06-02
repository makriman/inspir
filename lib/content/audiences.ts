import { getBlogPosts } from "@/lib/content/blog";
import { homepageLearningPaths, learningPathHref, type HomepageLearningPath } from "@/lib/content/landing";
import { getLearningMapWorkflows } from "@/lib/content/learning-map";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";

type AudienceJob = {
  title: string;
  text: string;
  href: string;
};

export type AudiencePage = {
  slug: string;
  role: string;
  eyebrow: string;
  title: string;
  seoTitle: string;
  description: string;
  summary: string;
  why: string;
  searchIntents: string[];
  jobs: AudienceJob[];
  modeSlugs: string[];
  guideSlugs: string[];
  workflowSlugs: string[];
  pathSlugs: Array<HomepageLearningPath["slug"]>;
  safeguards: string[];
  faqs: Array<{ question: string; answer: string }>;
};

export const audienceHubFaqs = [
  {
    question: "Who is inspir for?",
    answer:
      "inspir is for students, parents, teachers, and self-taught learners who need focused AI learning modes for explanations, questions, hints, quizzes, flashcards, feedback, and study planning.",
  },
  {
    question: "Are audience pages public and indexable?",
    answer:
      "Yes. Audience pages link only to public guest modes, guides, prompt starters, learning paths, and AI-readable discovery files. Private saved chats remain excluded.",
  },
  {
    question: "Why separate pages for different audiences?",
    answer:
      "A student, parent, teacher, and self-taught learner often search for the same AI tutor in different language. Separate pages make the right use cases and safety boundaries clearer.",
  },
] as const;

export const audienceHubSearchIntents = [
  "AI tutor for students",
  "AI tutor for parents",
  "AI tools for teachers",
  "free AI tutor for self study",
  "AI homework help for students",
  "AI learning companion for adults",
] as const;

const audiencePages: AudiencePage[] = [
  {
    slug: "students",
    role: "student",
    eyebrow: "For students",
    title: "A free AI tutor for students who want to understand, not copy.",
    seoTitle: "Free AI Tutor for Students",
    description:
      "Use inspir as a free AI tutor for students: homework hints, Socratic questions, math step checks, writing feedback, quizzes, flashcards, and exam prep.",
    summary:
      "Students need fast help, but the help still has to leave the thinking in their hands. inspir routes common study moments into focused public modes instead of one generic answer box.",
    why:
      "The strongest student workflow is not answer-copying. It is a loop: explain the stuck point, ask one better question, get a hint, try again, then review the miss.",
    searchIntents: [
      "AI tutor for students",
      "free AI tutor for students",
      "AI homework help for students",
      "AI math help for students",
      "AI study planner for students",
      "AI flashcards for students",
    ],
    jobs: [
      {
        title: "Get homework help without copying",
        text: "Paste the question, what you tried, and the stuck point. Ask for the smallest useful hint, not the final answer.",
        href: "/chat/homework-coach",
      },
      {
        title: "Understand a topic before the test",
        text: "Start with a simple explanation, then ask Socratic questions until you can explain it back.",
        href: "/chat/learn-anything",
      },
      {
        title: "Turn mistakes into review",
        text: "Use quizzes and flashcards to make missed questions visible and repeatable.",
        href: "/chat/flashcard-builder",
      },
      {
        title: "Improve writing without losing your voice",
        text: "Ask for structure, evidence, and clarity feedback while keeping the final draft yours.",
        href: "/chat/writing-coach",
      },
    ],
    modeSlugs: [
      "learn-anything",
      "homework-coach",
      "math-step-coach",
      "socratic-instruction",
      "writing-coach",
      "quiz-me-on-trivia",
      "flashcard-builder",
      "exam-prep-planner",
    ],
    guideSlugs: [
      "how-to-study-with-ai-without-cheating-yourself",
      "ai-homework-coach-guide",
      "ai-math-step-coach-guide",
      "socratic-ai-tutor",
      "ai-flashcards-and-active-recall",
      "ai-exam-prep-planner-guide",
    ],
    workflowSlugs: ["homework-without-cheating", "understand-anything", "exam-prep-active-recall"],
    pathSlugs: ["get-unstuck-on-homework", "understand-a-hard-topic", "prepare-for-an-exam"],
    safeguards: [
      "Ask for hints, checks, and feedback before asking for a finished answer.",
      "Explain every accepted step back in your own words.",
      "Turn confusion into a quiz or flashcard before moving on.",
    ],
    faqs: [
      {
        question: "Can students use inspir without signing in?",
        answer:
          "Yes. Public guest modes such as Learn Anything, Homework Coach, Socratic Instruction, quizzes, flashcards, and writing feedback open directly.",
      },
      {
        question: "How can students avoid cheating with AI?",
        answer:
          "Use AI for hints, explanations, mistake checks, and review loops. Do not ask it to produce a final answer you cannot explain.",
      },
      {
        question: "What should a student try first?",
        answer:
          "Start with Learn Anything for a simple explanation, Homework Coach for a stuck assignment, or Flashcard Builder when the goal is review.",
      },
    ],
  },
  {
    slug: "parents",
    role: "parent",
    eyebrow: "For parents",
    title: "AI learning help parents can try before they trust.",
    seoTitle: "AI Tutor for Parents and Families",
    description:
      "A parent-friendly guide to inspir's public AI learning modes for homework hints, explanation, study routines, flashcards, and safer learning conversations.",
    summary:
      "Parents are often trying to help without taking over. inspir gives families public modes that make learning behavior visible: hints, questions, explain-back, review, and study planning.",
    why:
      "A good family AI workflow should make the learner more independent, not more dependent. Parents can use public pages to see what each mode is meant to do before a child starts.",
    searchIntents: [
      "AI tutor for parents",
      "AI homework help for my child",
      "free AI tutor for kids",
      "AI study help for families",
      "safe AI learning tool for students",
      "AI flashcards for children",
    ],
    jobs: [
      {
        title: "Help a child get unstuck",
        text: "Use Homework Coach to ask for a hint, then ask the learner to explain the next move.",
        href: "/chat/homework-coach",
      },
      {
        title: "Make confusion easier to talk about",
        text: "Use Learn Anything to get a simpler model, prerequisite ideas, and examples at the right level.",
        href: "/chat/learn-anything",
      },
      {
        title: "Build a calmer study habit",
        text: "Use Study Plan Builder or Habit Coach to make small sessions and restarts visible.",
        href: "/chat/study-plan-builder",
      },
      {
        title: "Check understanding without hovering",
        text: "Use quizzes, flashcards, and Socratic questions so the learner shows what they understand.",
        href: "/chat/socratic-instruction",
      },
    ],
    modeSlugs: [
      "learn-anything",
      "homework-coach",
      "socratic-instruction",
      "quiz-me-on-trivia",
      "flashcard-builder",
      "study-plan-builder",
      "habit-coach",
      "motivation-coach",
    ],
    guideSlugs: [
      "ai-learning-companion-for-everyone",
      "how-to-study-with-ai-without-cheating-yourself",
      "ai-homework-coach-guide",
      "ai-study-plan-builder-guide",
      "ai-habit-coach-guide",
      "ai-motivation-coach-guide",
    ],
    workflowSlugs: ["understand-anything", "homework-without-cheating", "build-a-study-system"],
    pathSlugs: ["understand-a-hard-topic", "get-unstuck-on-homework", "prepare-for-an-exam"],
    safeguards: [
      "Use public mode descriptions to choose the behavior before a session starts.",
      "Ask the learner to explain what changed after each hint.",
      "Keep private saved conversations out of public discovery and citation surfaces.",
    ],
    faqs: [
      {
        question: "Can parents try inspir before recommending it?",
        answer:
          "Yes. The public guest modes and audience pages are designed so parents can inspect the learning behavior before relying on it.",
      },
      {
        question: "Does inspir publish a child's private chats?",
        answer:
          "No. Public pages are indexable, but private saved chats are not included in the sitemap, llms files, or AI content index.",
      },
      {
        question: "What is the best parent-supervised workflow?",
        answer:
          "Ask for a hint, have the learner explain the next step, then use a quiz or flashcard to check whether the idea stuck.",
      },
    ],
  },
  {
    slug: "teachers",
    role: "teacher",
    eyebrow: "For teachers",
    title: "AI learning modes for teachers who need focused behavior.",
    seoTitle: "AI Learning Tools for Teachers",
    description:
      "Explore public AI learning modes teachers can use to evaluate Socratic tutoring, quizzes, flashcards, writing feedback, source critique, and classroom-ready study workflows.",
    summary:
      "Teachers need more than a generic chatbot. They need predictable learning behaviors: ask questions, check reasoning, generate practice, preserve student voice, and make misconceptions visible.",
    why:
      "inspir's public modes let teachers evaluate the product through real learning flows before considering a school deployment or a tailored classroom pathway.",
    searchIntents: [
      "AI tools for teachers",
      "AI tutor for teachers",
      "AI Socratic tutor for classroom",
      "AI quiz generator for teachers",
      "AI writing feedback for students",
      "AI homework coach for teachers",
    ],
    jobs: [
      {
        title: "Evaluate a mode before using it with learners",
        text: "Open a public mode, test the student behavior, and inspect whether it asks, hints, quizzes, or critiques appropriately.",
        href: "/topics",
      },
      {
        title: "Create practice without leaking answers",
        text: "Use quiz and flashcard modes for active recall, then route missed items into review.",
        href: "/chat/quiz-me-on-trivia",
      },
      {
        title: "Support writing while preserving voice",
        text: "Use Writing Coach for feedback on structure, clarity, evidence, and revision priorities.",
        href: "/chat/writing-coach",
      },
      {
        title: "Move from public testing to school deployment",
        text: "Use the school page to explore custom workflows, confidentiality needs, and rollout steps.",
        href: "/schools",
      },
    ],
    modeSlugs: [
      "socratic-instruction",
      "quiz-me-on-trivia",
      "flashcard-builder",
      "writing-coach",
      "source-critic",
      "misconception-doctor",
      "concept-map-builder",
      "exam-prep-planner",
    ],
    guideSlugs: [
      "socratic-ai-tutor",
      "ai-quiz-me-on-trivia-guide",
      "ai-flashcard-builder-guide",
      "ai-writing-coach-guide",
      "ai-source-critic-guide",
      "ai-misconception-doctor-guide",
    ],
    workflowSlugs: ["understand-anything", "exam-prep-active-recall", "think-critically"],
    pathSlugs: ["understand-a-hard-topic", "prepare-for-an-exam", "get-unstuck-on-homework"],
    safeguards: [
      "Public pages show product behavior, not private student work.",
      "Use hint-first and explain-back workflows for homework support.",
      "Move school-specific privacy, access, and deployment questions to the schools pathway.",
    ],
    faqs: [
      {
        question: "Can teachers try inspir without a school rollout?",
        answer:
          "Yes. Public guest modes let teachers test learning behavior before discussing a custom deployment.",
      },
      {
        question: "How is this different from giving students a generic chatbot?",
        answer:
          "inspir is organized into focused modes such as Socratic tutoring, homework hints, quizzes, flashcards, writing feedback, source critique, and study planning.",
      },
      {
        question: "Where should a school team go next?",
        answer:
          "Start with the public modes, then use the schools page to review deployment steps, use cases, and trust boundaries.",
      },
    ],
  },
  {
    slug: "self-taught-learners",
    role: "self-taught learner",
    eyebrow: "For self-taught learners",
    title: "A free AI learning companion for people teaching themselves.",
    seoTitle: "AI Tutor for Self-Taught Learners",
    description:
      "Use inspir to learn anything independently with explanations, code tutoring, project coaching, research help, concept maps, study plans, and habit support.",
    summary:
      "Self-taught learners need momentum and structure. inspir helps turn curiosity into a path: explain, build, test, review, and keep going.",
    why:
      "The self-study challenge is not just finding information. It is choosing the next right action and knowing whether the idea actually stuck.",
    searchIntents: [
      "AI tutor for self study",
      "AI learning companion for adults",
      "learn anything with AI",
      "AI code tutor for beginners",
      "AI project coach",
      "AI study plan builder",
    ],
    jobs: [
      {
        title: "Start a topic from first principles",
        text: "Ask for prerequisites, a simple model, examples, and a common misconception.",
        href: "/chat/learn-anything",
      },
      {
        title: "Learn by building",
        text: "Use Code Tutor or Project Coach to turn a vague goal into a small testable next step.",
        href: "/chat/project-coach",
      },
      {
        title: "Research without losing the thread",
        text: "Use Research Assistant, Source Critic, and Concept Map Builder to organize claims and evidence.",
        href: "/chat/research-assistant",
      },
      {
        title: "Make the habit survivable",
        text: "Use Study Plan Builder and Habit Coach to build a routine that can restart after missed days.",
        href: "/chat/study-plan-builder",
      },
    ],
    modeSlugs: [
      "learn-anything",
      "code-tutor",
      "data-interpreter",
      "project-coach",
      "research-assistant",
      "concept-map-builder",
      "study-plan-builder",
      "habit-coach",
    ],
    guideSlugs: [
      "ai-learn-anything-guide",
      "ai-code-tutor-guide",
      "ai-data-interpreter-guide",
      "ai-project-coach-guide",
      "ai-research-assistant-guide",
      "ai-study-plan-builder-guide",
    ],
    workflowSlugs: ["understand-anything", "learn-code-and-data", "think-critically", "build-a-study-system"],
    pathSlugs: ["understand-a-hard-topic", "prepare-for-an-exam", "explore-history-and-ideas"],
    safeguards: [
      "Do not confuse a fast answer with mastery.",
      "Make every learning session end with a test, artifact, or review step.",
      "Use source critique for claims you might cite or act on.",
    ],
    faqs: [
      {
        question: "Can inspir help adults and self-taught learners?",
        answer:
          "Yes. Public modes work for school topics, professional skills, coding, research, projects, and personal study routines.",
      },
      {
        question: "What should a self-taught learner ask first?",
        answer:
          "Ask for the prerequisite ideas, a plain-language model, one example, one practice task, and one way to test understanding.",
      },
      {
        question: "How do I avoid drifting between topics?",
        answer:
          "Use Study Plan Builder to choose a small goal, then use quizzes, flashcards, project steps, or concept maps to prove progress.",
      },
    ],
  },
];

const topicSeedBySlug = new Map(topicSeeds.map((topic) => [topic.slug, topic]));
const learningPathBySlug = new Map(homepageLearningPaths.map((path) => [path.slug, path]));

export function audiencePath(slug: string) {
  return `/for/${slug}`;
}

export function getAudiencePages() {
  return audiencePages;
}

export function getAudiencePage(slug: string) {
  return audiencePages.find((page) => page.slug === slug);
}

export function getAudiencePageResources(page: AudiencePage) {
  const posts = getBlogPosts();
  const workflows = getLearningMapWorkflows();
  const postsBySlug = new Map(posts.map((post) => [post.slug, post]));
  const workflowsBySlug = new Map(workflows.map((workflow) => [workflow.slug, workflow]));

  return {
    modes: page.modeSlugs.flatMap((slug) => {
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
    guides: page.guideSlugs.flatMap((slug) => {
      const post = postsBySlug.get(slug);
      if (!post) return [];
      return {
        slug: post.slug,
        title: post.title,
        href: `/blog/${post.slug}`,
        description: post.description,
      };
    }),
    workflows: page.workflowSlugs.flatMap((slug) => {
      const workflow = workflowsBySlug.get(slug);
      if (!workflow) return [];
      return {
        slug: workflow.slug,
        title: workflow.title,
        href: workflow.href,
        description: workflow.description,
      };
    }),
    paths: page.pathSlugs.flatMap((slug) => {
      const path = learningPathBySlug.get(slug);
      if (!path) return [];
      return {
        slug: path.slug,
        title: path.title,
        href: learningPathHref(path.slug),
        description: path.description,
      };
    }),
  };
}
