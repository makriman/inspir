import { getBlogPosts } from "@/lib/content/blog";
import { homepageLearningPaths, learningPathHref, type HomepageLearningPath } from "@/lib/content/landing";
import { getLearningMapWorkflows } from "@/lib/content/learning-map";
import { getPromptEntries } from "@/lib/content/prompt-library";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";

type SubjectJob = {
  title: string;
  text: string;
  href: string;
};

export type SubjectPage = {
  slug: string;
  subjectArea: string;
  eyebrow: string;
  title: string;
  seoTitle: string;
  description: string;
  summary: string;
  why: string;
  searchIntents: string[];
  jobs: SubjectJob[];
  modeSlugs: string[];
  guideSlugs: string[];
  workflowSlugs: string[];
  pathSlugs: Array<HomepageLearningPath["slug"]>;
  reviewLoop: string[];
  faqs: Array<{ question: string; answer: string }>;
};

export const subjectHubFaqs = [
  {
    question: "What are inspir subject hubs?",
    answer:
      "Subject hubs organize public AI learning modes by learning intent, such as math, writing, coding, history, homework, and exam prep. Each hub links to live guest modes, prompt starters, guides, workflows, and review loops.",
  },
  {
    question: "Are subject hubs indexable?",
    answer:
      "Yes. Subject hubs are public pages built for learners, Google, and AI answer engines. They expose only public learning guidance and public guest-mode URLs, not private saved chats.",
  },
  {
    question: "How are these different from a generic AI chatbot page?",
    answer:
      "Each subject hub names the learning job, recommends the right focused modes, and shows how to finish with evidence of understanding instead of passive answer-copying.",
  },
] as const;

export const subjectHubSearchIntents = [
  "AI math tutor",
  "AI writing tutor",
  "AI code tutor",
  "AI history tutor",
  "AI homework helper",
  "AI exam prep planner",
  "free AI tutor by subject",
] as const;

const subjectPages: SubjectPage[] = [
  {
    slug: "math",
    subjectArea: "Mathematics",
    eyebrow: "Math",
    title: "AI math tutoring that works one step at a time.",
    seoTitle: "AI Math Tutor",
    description:
      "Use inspir for step-by-step math help, homework hints, Socratic reasoning, quizzes, flashcards, and exam prep without answer-copying.",
    summary:
      "Math help is strongest when the learner can see the next move, explain why it works, and catch the mistake before it repeats.",
    why:
      "A generic answer can make a worksheet look finished while leaving the misconception untouched. The math route links hints, step checks, Socratic questions, quizzes, and flashcards into one learning loop.",
    searchIntents: [
      "AI math tutor",
      "step by step math help",
      "AI math homework helper",
      "math problem coach",
      "AI algebra tutor",
      "AI calculus help",
    ],
    jobs: [
      {
        title: "Check one step before the whole answer",
        text: "Paste the step you tried and ask whether the reasoning is valid before asking for the next move.",
        href: "/chat/math-step-coach",
      },
      {
        title: "Get a hint without losing ownership",
        text: "Use Homework Coach to narrow the stuck point, then explain the next line in your own words.",
        href: "/chat/homework-coach",
      },
      {
        title: "Turn a mistake into practice",
        text: "Use Quiz and Flashcards after the explanation so the same error becomes easier to spot.",
        href: "/chat/flashcard-builder",
      },
    ],
    modeSlugs: [
      "math-step-coach",
      "homework-coach",
      "socratic-instruction",
      "quiz-me-on-trivia",
      "flashcard-builder",
      "exam-prep-planner",
    ],
    guideSlugs: [
      "ai-math-step-coach-guide",
      "ai-homework-coach-guide",
      "socratic-ai-tutor",
      "ai-quiz-me-on-trivia-guide",
      "ai-flashcard-builder-guide",
      "ai-exam-prep-planner-guide",
    ],
    workflowSlugs: ["homework-without-cheating", "understand-anything", "exam-prep-active-recall"],
    pathSlugs: ["get-unstuck-on-homework", "understand-a-hard-topic", "prepare-for-an-exam"],
    reviewLoop: [
      "Name the exact operation, theorem, or step that feels uncertain.",
      "Ask for the smallest hint or a check on your attempted step.",
      "Explain the repaired reasoning back before moving on.",
      "Create one quiz question or flashcard from the mistake.",
    ],
    faqs: [
      {
        question: "Can inspir solve math problems step by step?",
        answer:
          "The Math Step Coach is built for step checks, hints, and reasoning. It is most useful when you share what you tried and ask it to help you understand the next step.",
      },
      {
        question: "Is this an AI math homework helper?",
        answer:
          "Yes, but the recommended workflow is hint-first. Use it to understand the method, check your work, and review errors instead of copying a final answer.",
      },
      {
        question: "What should I open first for math?",
        answer:
          "Start with Math Step Coach for equations or worked solutions, Homework Coach for assignments, and Flashcard Builder when you need to remember formulas or mistake patterns.",
      },
    ],
  },
  {
    slug: "writing",
    subjectArea: "Writing and communication",
    eyebrow: "Writing",
    title: "AI writing feedback that keeps your voice intact.",
    seoTitle: "AI Writing Tutor",
    description:
      "Use inspir for essay feedback, reading support, speaking practice, source critique, and revision loops that improve structure without replacing the learner's voice.",
    summary:
      "Good writing help should sharpen the claim, evidence, structure, and clarity while leaving the final words and judgment with the learner.",
    why:
      "The writing route keeps feedback specific. It favors revision priorities, explain-back, reading comprehension, source checks, and speaking practice over a full rewrite.",
    searchIntents: [
      "AI writing tutor",
      "AI essay feedback",
      "AI writing coach",
      "AI reading companion",
      "AI speaking practice",
      "AI source critic",
    ],
    jobs: [
      {
        title: "Improve an essay without outsourcing it",
        text: "Ask for the one highest-impact revision priority, then rewrite the paragraph yourself.",
        href: "/chat/writing-coach",
      },
      {
        title: "Read a hard text more actively",
        text: "Use Reading Companion to summarize, question, and explain the passage before citing it.",
        href: "/chat/reading-companion",
      },
      {
        title: "Practice saying the idea clearly",
        text: "Use Speaking Practice or Viva Practice to defend a claim out loud and find weak spots.",
        href: "/chat/speaking-practice",
      },
    ],
    modeSlugs: [
      "writing-coach",
      "reading-companion",
      "speaking-practice",
      "viva-practice",
      "source-critic",
      "concept-map-builder",
    ],
    guideSlugs: [
      "ai-writing-coach-guide",
      "ai-reading-companion-guide",
      "ai-speaking-practice-guide",
      "ai-viva-practice-guide",
      "ai-source-critic-guide",
      "ai-research-assistant-guide",
    ],
    workflowSlugs: ["write-and-communicate", "think-critically", "understand-anything"],
    pathSlugs: ["understand-a-hard-topic", "prepare-for-an-exam"],
    reviewLoop: [
      "State the reader, claim, and assignment goal before asking for feedback.",
      "Ask for one revision priority, not a finished replacement.",
      "Rewrite in your own words and ask what improved or weakened.",
      "Use source critique or speaking practice to test whether the argument holds.",
    ],
    faqs: [
      {
        question: "Will inspir rewrite my essay for me?",
        answer:
          "The better use is feedback, structure, evidence checks, and revision coaching. You can ask it to preserve your voice and avoid replacing the work.",
      },
      {
        question: "Can it help with reading comprehension?",
        answer:
          "Yes. Reading Companion can simplify passages, ask questions, explain vocabulary, and help you identify the main claim and supporting evidence.",
      },
      {
        question: "What is the best writing workflow?",
        answer:
          "Start with a draft or outline, ask for one priority, revise yourself, then use speaking or source critique to check whether the idea is clear and defensible.",
      },
    ],
  },
  {
    slug: "coding",
    subjectArea: "Coding and data",
    eyebrow: "Coding",
    title: "AI code tutoring for people who want to build and understand.",
    seoTitle: "AI Code Tutor",
    description:
      "Learn programming, debug concepts, plan projects, interpret data, and research technical questions with public AI modes that keep the learner in the loop.",
    summary:
      "Coding help should leave you able to predict, test, and explain the code instead of pasting mystery snippets.",
    why:
      "The coding route connects code tutoring, project coaching, data interpretation, research, and concept mapping so learning happens through small testable steps.",
    searchIntents: [
      "AI code tutor",
      "learn programming with AI",
      "AI programming tutor",
      "AI project coach",
      "AI data interpreter",
      "AI coding help for beginners",
    ],
    jobs: [
      {
        title: "Understand a programming concept",
        text: "Ask Code Tutor for the simplest mental model, one example, and one thing beginners often misunderstand.",
        href: "/chat/code-tutor",
      },
      {
        title: "Build a project in smaller moves",
        text: "Use Project Coach to turn a vague idea into the next testable feature or learning checkpoint.",
        href: "/chat/project-coach",
      },
      {
        title: "Interpret data without hand-waving",
        text: "Use Data Interpreter to ask what the data says, what it does not say, and what to check next.",
        href: "/chat/data-interpreter",
      },
    ],
    modeSlugs: [
      "code-tutor",
      "project-coach",
      "data-interpreter",
      "research-assistant",
      "concept-map-builder",
      "study-plan-builder",
    ],
    guideSlugs: [
      "ai-code-tutor-guide",
      "ai-project-coach-guide",
      "ai-data-interpreter-guide",
      "ai-research-assistant-guide",
      "ai-concept-map-builder-guide",
      "ai-study-plan-builder-guide",
    ],
    workflowSlugs: ["learn-code-and-data", "think-critically", "build-a-study-system"],
    pathSlugs: ["understand-a-hard-topic", "prepare-for-an-exam"],
    reviewLoop: [
      "Predict what the code or data should do before asking for help.",
      "Ask for the smallest explanation or next experiment.",
      "Run or reason through the change yourself.",
      "Write down the principle learned before expanding the project.",
    ],
    faqs: [
      {
        question: "Can inspir teach programming from scratch?",
        answer:
          "Yes. Code Tutor can explain concepts, walk through examples, ask you to predict behavior, and help you practice without turning learning into copy-paste.",
      },
      {
        question: "Can it debug my code?",
        answer:
          "Use it for debugging as a learning exercise: share the symptom, your expectation, and what you already tried, then ask for the next diagnostic step.",
      },
      {
        question: "What should builders open first?",
        answer:
          "Use Code Tutor for concepts, Project Coach for product ideas, Data Interpreter for datasets, and Study Plan Builder for a learning roadmap.",
      },
    ],
  },
  {
    slug: "history",
    subjectArea: "History and ideas",
    eyebrow: "History",
    title: "AI history learning that makes context feel alive.",
    seoTitle: "AI History Tutor",
    description:
      "Explore history, public figures, causes, debates, philosophy, and source critique with AI learning modes that separate evidence from simulation.",
    summary:
      "History becomes easier to remember when learners can enter the context, ask better questions, compare causes, and keep source boundaries clear.",
    why:
      "The history route gives learners the liveliness of role-play and debate while preserving the warning that simulations are not primary sources.",
    searchIntents: [
      "AI history tutor",
      "talk to historical figures AI",
      "AI time travel learning",
      "AI debate practice",
      "history cause and effect tutor",
      "AI philosophy tutor",
    ],
    jobs: [
      {
        title: "Enter a historical moment",
        text: "Use Time Travel to understand the setting, constraints, beliefs, and pressures before judging the outcome.",
        href: "/chat/time-travel",
      },
      {
        title: "Interview a historical figure carefully",
        text: "Use the historical person mode for perspective-taking, then verify claims with source critique.",
        href: "/chat/talk-to-a-historical-person",
      },
      {
        title: "Debate causes and consequences",
        text: "Use debate and cause-effect modes to compare explanations and write a stronger argument.",
        href: "/chat/history-cause-and-effect",
      },
    ],
    modeSlugs: [
      "time-travel",
      "talk-to-a-historical-person",
      "history-cause-and-effect",
      "debate-any-topic",
      "philosophy-lab",
      "source-critic",
    ],
    guideSlugs: [
      "talk-to-historical-figures-with-ai",
      "ai-time-travel-guide",
      "ai-talk-to-a-historical-person-guide",
      "ai-history-cause-and-effect-guide",
      "ai-debate-any-topic-guide",
      "ai-source-critic-guide",
    ],
    workflowSlugs: ["history-ideas-and-debate", "think-critically", "understand-anything"],
    pathSlugs: ["explore-history-and-ideas", "understand-a-hard-topic"],
    reviewLoop: [
      "Separate documented fact from plausible reconstruction.",
      "Ask what a different side, class, era, or source might say.",
      "Use source critique for any claim you might cite.",
      "End by writing the strongest claim and strongest counterclaim.",
    ],
    faqs: [
      {
        question: "Can I talk to historical figures with inspir?",
        answer:
          "Yes. The historical person mode is a learning simulation for perspective and questioning. It should not be cited as an authenticated quotation.",
      },
      {
        question: "Can inspir help with history essays?",
        answer:
          "Yes. Use Time Travel for context, History Cause and Effect for argument structure, Debate for counterarguments, and Source Critic for evidence boundaries.",
      },
      {
        question: "How do I avoid treating AI history as a source?",
        answer:
          "Use the simulations to generate questions and context, then verify important claims with primary or trusted secondary sources.",
      },
    ],
  },
  {
    slug: "exam-prep",
    subjectArea: "Exam preparation",
    eyebrow: "Exam prep",
    title: "AI exam prep that turns stress into a study loop.",
    seoTitle: "AI Exam Prep Planner",
    description:
      "Plan exam revision, generate quizzes, build flashcards, schedule spaced review, and keep motivation realistic with focused AI learning modes.",
    summary:
      "Exam prep works best when the plan is realistic, weak areas are visible, and every mistake turns into the next review action.",
    why:
      "The exam route links planning, quizzes, flashcards, spaced review, and motivation so learners do not confuse rereading with readiness.",
    searchIntents: [
      "AI exam prep planner",
      "AI study schedule",
      "AI quiz generator for exams",
      "AI flashcards for revision",
      "AI spaced repetition",
      "AI study plan builder",
    ],
    jobs: [
      {
        title: "Build a revision plan that fits real life",
        text: "Use Exam Prep Planner to split a syllabus into sessions, practice, rest, and review checkpoints.",
        href: "/chat/exam-prep-planner",
      },
      {
        title: "Find weak areas before rereading",
        text: "Use Quiz mode to test recall first, then repair only the topics that need attention.",
        href: "/chat/quiz-me-on-trivia",
      },
      {
        title: "Make mistakes come back at the right time",
        text: "Use Flashcards and Spaced Review to turn misses into repeatable memory work.",
        href: "/chat/spaced-review",
      },
    ],
    modeSlugs: [
      "exam-prep-planner",
      "quiz-me-on-trivia",
      "flashcard-builder",
      "spaced-review",
      "study-plan-builder",
      "motivation-coach",
    ],
    guideSlugs: [
      "ai-exam-prep-planner-guide",
      "ai-quiz-me-on-trivia-guide",
      "ai-flashcard-builder-guide",
      "ai-study-plan-builder-guide",
      "ai-motivation-coach-guide",
      "ai-flashcards-and-active-recall",
    ],
    workflowSlugs: ["exam-prep-active-recall", "build-a-study-system", "understand-anything"],
    pathSlugs: ["prepare-for-an-exam", "understand-a-hard-topic"],
    reviewLoop: [
      "List the exam, date, topics, and confidence level.",
      "Quiz before rereading so weak areas become visible.",
      "Repair one weak concept with an explanation or worked example.",
      "Convert the miss into a card and schedule the next repetition.",
    ],
    faqs: [
      {
        question: "Can inspir make an exam study plan?",
        answer:
          "Yes. Exam Prep Planner can turn your topics, date, and available time into a practical revision sequence with practice and review.",
      },
      {
        question: "Are quizzes and flashcards included?",
        answer:
          "Yes. Quiz, Flashcard Builder, and Spaced Review are public modes designed for active recall and mistake repair.",
      },
      {
        question: "What is the best first step for exam prep?",
        answer:
          "Start with a short diagnostic quiz or topic confidence list, then build a plan around the areas that create the most uncertainty.",
      },
    ],
  },
  {
    slug: "homework",
    subjectArea: "Homework support",
    eyebrow: "Homework",
    title: "AI homework help that keeps the learning honest.",
    seoTitle: "AI Homework Helper",
    description:
      "Use inspir for homework hints, math step checks, writing feedback, source critique, Socratic questions, and flashcards without exposing private chats.",
    summary:
      "The best homework help reduces friction without removing the student's responsibility to reason, explain, and revise.",
    why:
      "The homework route makes the contract visible: ask for a hint, check a step, improve a draft, critique a source, then prove the learning with review.",
    searchIntents: [
      "AI homework helper",
      "AI homework help without cheating",
      "AI homework coach",
      "AI math homework helper",
      "AI essay feedback for homework",
      "free AI homework tutor",
    ],
    jobs: [
      {
        title: "Get unstuck without copying",
        text: "Share the assignment, what you tried, and the stuck point. Ask for the smallest useful hint.",
        href: "/chat/homework-coach",
      },
      {
        title: "Check math or writing work",
        text: "Use Math Step Coach for reasoning checks and Writing Coach for revision priorities.",
        href: "/chat/math-step-coach",
      },
      {
        title: "Make the homework useful tomorrow",
        text: "Turn the confusion into a flashcard, quiz question, or explain-back prompt before leaving.",
        href: "/chat/flashcard-builder",
      },
    ],
    modeSlugs: [
      "homework-coach",
      "math-step-coach",
      "writing-coach",
      "socratic-instruction",
      "source-critic",
      "flashcard-builder",
    ],
    guideSlugs: [
      "how-to-study-with-ai-without-cheating-yourself",
      "ai-homework-coach-guide",
      "ai-math-step-coach-guide",
      "ai-writing-coach-guide",
      "socratic-ai-tutor",
      "ai-flashcards-and-active-recall",
    ],
    workflowSlugs: ["homework-without-cheating", "understand-anything", "think-critically"],
    pathSlugs: ["get-unstuck-on-homework", "understand-a-hard-topic"],
    reviewLoop: [
      "Write what the assignment asks and what you tried.",
      "Ask for a hint, question, or step check before the answer.",
      "Explain the next move back in your own words.",
      "Save the final mistake or insight as review material.",
    ],
    faqs: [
      {
        question: "Can inspir help with homework without cheating?",
        answer:
          "Yes. The recommended use is hints, explanations, step checks, feedback, and review prompts rather than final answers you cannot explain.",
      },
      {
        question: "Can students land directly on homework help?",
        answer:
          "Yes. The public Homework Coach is available at /chat/homework-coach, and this subject hub links to the supporting modes and guides.",
      },
      {
        question: "Does inspir expose private homework chats to Google?",
        answer:
          "No. Public subject pages and guest mode entrypoints are indexable, but private saved chats are excluded from discovery files.",
      },
    ],
  },
];

const topicSeedBySlug = new Map(topicSeeds.map((topic) => [topic.slug, topic]));
const learningPathBySlug = new Map(homepageLearningPaths.map((path) => [path.slug, path]));

export function subjectPath(slug: string) {
  return `/subjects/${slug}`;
}

export function getSubjectPages() {
  return subjectPages;
}

export function getSubjectPage(slug: string) {
  return subjectPages.find((page) => page.slug === slug);
}

export function getSubjectPageResources(page: SubjectPage) {
  const posts = getBlogPosts();
  const workflows = getLearningMapWorkflows();
  const prompts = getPromptEntries();
  const postsBySlug = new Map(posts.map((post) => [post.slug, post]));
  const workflowsBySlug = new Map(workflows.map((workflow) => [workflow.slug, workflow]));
  const promptsByTopicSlug = new Map(prompts.map((entry) => [entry.topicSlug, entry]));

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
    prompts: page.modeSlugs.flatMap((slug) => {
      const entry = promptsByTopicSlug.get(slug);
      if (!entry) return [];
      return {
        id: entry.id,
        prompt: entry.prompt,
        topicName: entry.topicName,
        topicSlug: entry.topicSlug,
        href: entry.href,
        description: entry.description,
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
