import { getBlogPostTopic, getBlogPosts, type BlogCategory, type BlogPost } from "@/lib/content/blog";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";

export type BlogPillarCluster = {
  slug: string;
  title: string;
  description: string;
  audience: string;
  categoryHref: string;
  categoryLabel: string;
  modeHref: string;
  modeLabel: string;
  guideSlugs: string[];
};

export const blogHubFaqs = [
  {
    question: "How should I use the inspir blog?",
    answer:
      "Start with a pillar cluster that matches your learning job, read one guide, then open the linked public learning mode to turn the advice into practice.",
  },
  {
    question: "Are the articles connected to live AI learning tools?",
    answer:
      "Yes. The guide library links into public guest modes such as Learn Anything, Socratic Instruction, Homework Coach, Math Step Coach, quizzes, flashcards, and historical conversations.",
  },
  {
    question: "Why does inspir publish so many mode guides?",
    answer:
      "Each public mode has a different learning behavior, so every guide gives learners and search systems a clear explanation of when to use that mode, what to ask, and how to keep learning active.",
  },
] as const;

const topicSeedBySlug = new Map(topicSeeds.map((topic) => [topic.slug, topic]));

const blogPillarClusters: BlogPillarCluster[] = [
  {
    slug: "ai-tutor-fundamentals",
    title: "AI tutor fundamentals",
    description:
      "How to use AI for clear explanations, adaptive tutoring, Socratic questions, and better first steps.",
    audience: "Learners, parents, educators, and builders evaluating AI tutors.",
    categoryHref: "/blog/category/ai-tutor",
    categoryLabel: "AI tutor guides",
    modeHref: topicPath("learn-anything"),
    modeLabel: "Learn Anything",
    guideSlugs: [
      "ai-learning-companion-for-everyone",
      "ai-learn-anything-guide",
      "socratic-ai-tutor",
      "ai-socratic-instruction-guide",
      "ai-interactive-instruction-guide",
    ],
  },
  {
    slug: "study-with-ai-without-cheating",
    title: "Study with AI without cheating",
    description:
      "Hint-first homework help, step checks, ethical study habits, and revision that keeps the learner responsible.",
    audience: "Students who need help but still want the final work and understanding to be theirs.",
    categoryHref: "/blog/category/study-skills",
    categoryLabel: "Study skills guides",
    modeHref: topicPath("homework-coach"),
    modeLabel: "Homework Coach",
    guideSlugs: [
      "how-to-study-with-ai-without-cheating-yourself",
      "ai-homework-coach-guide",
      "homework-coach-prompts-and-study-loop",
      "ai-math-step-coach-guide",
      "math-step-coach-prompts-and-study-loop",
    ],
  },
  {
    slug: "active-recall-and-exam-prep",
    title: "Active recall and exam prep",
    description:
      "Turn explanations into quizzes, flashcards, retrieval practice, and realistic exam preparation loops.",
    audience: "Learners preparing for tests who need to remember, practise, and repair weak spots.",
    categoryHref: "/blog/category/practice",
    categoryLabel: "Practice guides",
    modeHref: topicPath("flashcard-builder"),
    modeLabel: "Flashcard Builder",
    guideSlugs: [
      "ai-flashcards-and-active-recall",
      "ai-flashcard-builder-guide",
      "flashcard-builder-prompts-and-study-loop",
      "ai-quiz-me-on-trivia-guide",
      "ai-exam-prep-planner-guide",
    ],
  },
  {
    slug: "history-ideas-and-debate",
    title: "History, ideas, and debate",
    description:
      "Use AI historical worlds, persona simulations, debate, philosophy, and evidence labels without confusing roleplay for sources.",
    audience: "Curious learners exploring history, humanities, argument, and big questions.",
    categoryHref: "/blog/category/humanities",
    categoryLabel: "Humanities guides",
    modeHref: topicPath("time-travel"),
    modeLabel: "Time travel",
    guideSlugs: [
      "talk-to-historical-figures-with-ai",
      "ai-time-travel-guide",
      "ai-talk-to-a-historical-person-guide",
      "ai-debate-any-topic-guide",
      "ai-philosophy-lab-guide",
    ],
  },
] as const;

export type BlogCategoryProfile = {
  title: string;
  description: string;
  audience: string;
  outcome: string;
  searchIntents: string[];
  workflows: Array<{ title: string; text: string; href: string }>;
};

const blogCategoryProfiles: Record<string, BlogCategoryProfile> = {
  "ai-tutor": {
    title: "AI tutor guides",
    description:
      "Guides for choosing, prompting, and learning with AI tutors that explain, question, coach, and adapt to the learner.",
    audience: "Learners, parents, educators, and builders comparing AI tutoring experiences.",
    outcome: "Move from AI tutor research into a live mode that teaches through explanation, questions, and practice.",
    searchIntents: ["AI tutor", "free AI tutor", "AI learning companion", "AI Socratic tutor"],
    workflows: [
      {
        title: "Start with a clear explanation",
        text: "Read a guide, then open Learn Anything to get a plain-language model of the topic.",
        href: topicPath("learn-anything"),
      },
      {
        title: "Check understanding with questions",
        text: "Use Socratic Instruction to uncover missing assumptions and shallow confidence.",
        href: topicPath("socratic-instruction"),
      },
      {
        title: "Turn the lesson into recall",
        text: "Use flashcards or quizzes so the article becomes a practice loop, not just advice.",
        href: topicPath("flashcard-builder"),
      },
    ],
  },
  "study-skills": {
    title: "AI study skills guides",
    description:
      "Study methods for using AI without answer-copying: hints, review loops, active recall, feedback, and self-explanation.",
    audience: "Students who want help while keeping the work and understanding genuinely theirs.",
    outcome: "Build a repeatable study workflow that gives support without replacing the learner.",
    searchIntents: ["study with AI", "AI homework help", "AI study skills", "AI without cheating"],
    workflows: [
      {
        title: "Ask for the smallest useful hint",
        text: "Use Homework Coach to move one step at a time instead of asking for the final answer.",
        href: topicPath("homework-coach"),
      },
      {
        title: "Explain the step back",
        text: "Use Socratic Instruction to make sure you can justify the next move in your own words.",
        href: topicPath("socratic-instruction"),
      },
      {
        title: "Review the weak spot later",
        text: "Turn misses and hesitation into flashcards for spaced review.",
        href: topicPath("flashcard-builder"),
      },
    ],
  },
  "ai-prompts": {
    title: "AI prompt guides for learning",
    description:
      "Prompt patterns for explanations, tutoring, roleplay, quizzes, feedback, planning, debate, and active recall.",
    audience: "Learners and educators who want better questions and more useful AI learning sessions.",
    outcome: "Copy the structure of strong prompts, then open the matching live mode and adapt it to the topic.",
    searchIntents: ["AI learning prompts", "AI tutor prompts", "ChatGPT study prompts", "homework prompt examples"],
    workflows: [
      {
        title: "Name the learning job",
        text: "Pick the mode that matches the task before writing a prompt.",
        href: "/topics",
      },
      {
        title: "Add context and constraints",
        text: "Include what you know, what you tried, what level you need, and what kind of help you want.",
        href: topicPath("homework-coach"),
      },
      {
        title: "Ask for a check",
        text: "End with a request for a question, misconception check, quiz, or next-step hint.",
        href: topicPath("socratic-instruction"),
      },
    ],
  },
  planning: {
    title: "AI planning guides for learning",
    description:
      "Planning guides for study schedules, exam prep, project breakdowns, goals, and realistic learning systems.",
    audience: "Learners with limited time, large goals, or a syllabus that needs structure.",
    outcome: "Turn a vague learning goal into a concrete plan with review, practice, and check-ins.",
    searchIntents: ["AI study plan", "AI exam planner", "AI learning planner", "study schedule with AI"],
    workflows: [
      {
        title: "Define the deadline and scope",
        text: "Use Exam Prep Planner with the date, syllabus, available time, and weak areas.",
        href: topicPath("exam-prep-planner"),
      },
      {
        title: "Block practice before review",
        text: "Schedule quizzes and recall before rereading so the plan reveals weak spots.",
        href: topicPath("quiz-me-on-trivia"),
      },
      {
        title: "Repair misses with flashcards",
        text: "Convert wrong answers and unclear definitions into active recall cards.",
        href: topicPath("flashcard-builder"),
      },
    ],
  },
  practice: {
    title: "AI practice and active recall guides",
    description:
      "Guides for quizzes, flashcards, retrieval practice, weak-area review, and making learning stick.",
    audience: "Learners preparing for tests or trying to remember ideas beyond the first explanation.",
    outcome: "Replace passive rereading with retrieval, feedback, correction, and spaced review.",
    searchIntents: ["AI flashcards", "AI quiz generator", "active recall AI", "retrieval practice with AI"],
    workflows: [
      {
        title: "Quiz before rereading",
        text: "Use Quiz Me On Trivia to reveal what you actually remember.",
        href: topicPath("quiz-me-on-trivia"),
      },
      {
        title: "Turn mistakes into cards",
        text: "Use Flashcard Builder to convert misses into focused recall prompts.",
        href: topicPath("flashcard-builder"),
      },
      {
        title: "Explain corrected answers",
        text: "Open Learn Anything when an answer needs a simpler model before review.",
        href: topicPath("learn-anything"),
      },
    ],
  },
  humanities: {
    title: "AI humanities guides",
    description:
      "Guides for history, literature, philosophy, debate, historical simulations, evidence labels, and perspective-taking.",
    audience: "Curious learners exploring context, arguments, people, texts, and ideas.",
    outcome: "Use AI simulations as learning scaffolds while keeping sources, evidence, and interpretation clear.",
    searchIntents: ["talk to historical figures AI", "AI history tutor", "AI philosophy tutor", "AI debate practice"],
    workflows: [
      {
        title: "Enter the context",
        text: "Use Time Travel with time, place, role, constraints, and evidence labels.",
        href: topicPath("time-travel"),
      },
      {
        title: "Question a perspective",
        text: "Use Historical Person mode while treating generated dialogue as simulation.",
        href: topicPath("talk-to-a-historical-person"),
      },
      {
        title: "Compare claims",
        text: "Use Debate Any Topic to separate evidence, values, and assumptions.",
        href: topicPath("debate-any-topic"),
      },
    ],
  },
  communication: {
    title: "AI communication guides",
    description:
      "Guides for writing, speaking, feedback, tone, structure, and explaining ideas more clearly.",
    audience: "Learners improving essays, presentations, messages, and public explanations.",
    outcome: "Use AI feedback to sharpen structure and clarity without losing your own voice.",
    searchIntents: ["AI writing coach", "AI presentation practice", "AI communication coach", "writing feedback AI"],
    workflows: [
      {
        title: "Improve the draft",
        text: "Use Writing Coach for structure, clarity, evidence, and revision priorities.",
        href: topicPath("writing-coach"),
      },
      {
        title: "Practise saying it",
        text: "Use Interview or debate modes to test whether the explanation survives questions.",
        href: topicPath("interview-practice"),
      },
      {
        title: "Make it teachable",
        text: "Use Learn Anything to turn a message into a simpler explanation and examples.",
        href: topicPath("learn-anything"),
      },
    ],
  },
  thinking: {
    title: "AI critical thinking guides",
    description:
      "Guides for reasoning, asking better questions, comparing claims, debugging assumptions, and thinking from multiple angles.",
    audience: "Learners who want sharper judgment instead of faster answer generation.",
    outcome: "Use AI to pressure-test your reasoning, surface assumptions, and improve decisions.",
    searchIntents: ["AI critical thinking tutor", "Socratic AI", "AI debate coach", "AI reasoning practice"],
    workflows: [
      {
        title: "Question the model",
        text: "Use Socratic Instruction to expose assumptions and weak links.",
        href: topicPath("socratic-instruction"),
      },
      {
        title: "Argue both sides",
        text: "Use Debate Any Topic to test claims against counterarguments.",
        href: topicPath("debate-any-topic"),
      },
      {
        title: "Summarize the tradeoff",
        text: "Use Learn Anything to convert the reasoning into a concise explanation.",
        href: topicPath("learn-anything"),
      },
    ],
  },
  creativity: {
    title: "AI creativity guides",
    description:
      "Guides for brainstorming, storytelling, creative practice, idea generation, and making playful learning productive.",
    audience: "Learners, writers, makers, and curious people who want ideas without losing direction.",
    outcome: "Generate ideas, shape them, test them, and turn creative curiosity into a useful next step.",
    searchIntents: ["AI creativity coach", "AI brainstorming prompts", "creative writing AI tutor", "AI idea generator"],
    workflows: [
      {
        title: "Generate options",
        text: "Use Brainstorm Ideas to create several routes before choosing one.",
        href: topicPath("brainstorm-ideas"),
      },
      {
        title: "Shape the work",
        text: "Use Writing Coach to improve structure, clarity, and voice.",
        href: topicPath("writing-coach"),
      },
      {
        title: "Explain the idea",
        text: "Use Learn Anything to clarify the concept and find examples.",
        href: topicPath("learn-anything"),
      },
    ],
  },
  foundations: {
    title: "AI learning foundations",
    description:
      "Foundational guides for explanations, tutoring behavior, study habits, prompt quality, and choosing the right learning mode.",
    audience: "New inspir users and learners building a better AI learning habit from the start.",
    outcome: "Understand the core patterns that make AI useful for learning without becoming passive.",
    searchIntents: ["how to learn with AI", "AI learning guide", "best AI tutor for students", "AI study companion"],
    workflows: [
      {
        title: "Open the default tutor",
        text: "Start with Learn Anything when you need orientation and a plain explanation.",
        href: topicPath("learn-anything"),
      },
      {
        title: "Choose a focused mode",
        text: "Use the topics directory to match the learning job to the right behavior.",
        href: "/topics",
      },
      {
        title: "Add practice",
        text: "Finish with a quiz, flashcard, or Socratic check so the session leaves a trace.",
        href: topicPath("quiz-me-on-trivia"),
      },
    ],
  },
  immersion: {
    title: "AI immersive learning guides",
    description:
      "Guides for time travel, roleplay, simulations, language practice, historical context, and experiential learning.",
    audience: "Learners who understand better when they can step into a scene, role, or simulated context.",
    outcome: "Use immersion for engagement while keeping learning goals, evidence, and reflection visible.",
    searchIntents: ["AI time travel", "AI learning simulation", "AI roleplay tutor", "immersive AI learning"],
    workflows: [
      {
        title: "Set the scene",
        text: "Use Time Travel with clear place, period, constraints, and learning goals.",
        href: topicPath("time-travel"),
      },
      {
        title: "Stay evidence-aware",
        text: "Use historical modes with labels for documented facts versus simulation.",
        href: topicPath("talk-to-a-historical-person"),
      },
      {
        title: "Reflect after the scene",
        text: "Use Socratic questions to extract what changed in your understanding.",
        href: topicPath("socratic-instruction"),
      },
    ],
  },
  stem: {
    title: "AI STEM guides",
    description:
      "Guides for maths, science, coding, step-by-step reasoning, debugging, and concept practice.",
    audience: "Learners working through technical subjects where one unclear step can block the rest.",
    outcome: "Use AI to slow down reasoning, check steps, debug mistakes, and practise concepts.",
    searchIntents: ["AI math tutor", "AI code tutor", "AI science tutor", "step by step math AI"],
    workflows: [
      {
        title: "Work one step at a time",
        text: "Use Math Step Coach to explain why each move is valid.",
        href: topicPath("math-step-coach"),
      },
      {
        title: "Debug the mistake",
        text: "Use Code Tutor or homework modes to isolate the exact point where reasoning breaks.",
        href: topicPath("code-tutor"),
      },
      {
        title: "Quiz the concept",
        text: "Use quizzes and flashcards to practise formulas, definitions, and problem types.",
        href: topicPath("quiz-me-on-trivia"),
      },
    ],
  },
  argument: {
    title: "AI argument and debate guides",
    description:
      "Guides for debate practice, argument maps, evidence checks, counterarguments, and clearer reasoning.",
    audience: "Learners preparing essays, discussions, debates, interviews, or decisions.",
    outcome: "Build arguments that can survive counterexamples, evidence checks, and opposing views.",
    searchIntents: ["AI debate coach", "AI argument practice", "counterargument generator", "Socratic debate AI"],
    workflows: [
      {
        title: "State the claim",
        text: "Use Debate Any Topic to define the position, burden of proof, and opposing view.",
        href: topicPath("debate-any-topic"),
      },
      {
        title: "Find the weak link",
        text: "Use Socratic Instruction to ask what would change your mind.",
        href: topicPath("socratic-instruction"),
      },
      {
        title: "Improve the final version",
        text: "Use Writing Coach to turn the argument into clearer structure.",
        href: topicPath("writing-coach"),
      },
    ],
  },
};

export function getBlogCategoryProfile(category: BlogCategory): BlogCategoryProfile {
  return (
    blogCategoryProfiles[category.slug] ?? {
      title: `${category.name} AI learning guides`,
      description: `A focused collection of inspir guides about ${category.name.toLowerCase()}, with prompts, study workflows, and related public learning modes.`,
      audience: `Learners exploring ${category.name.toLowerCase()} with AI support.`,
      outcome: "Move from reading into active practice with a live public learning mode.",
      searchIntents: [`${category.name} AI guides`, `${category.name} AI learning`, `${category.name} prompts`],
      workflows: [
        {
          title: "Read one guide",
          text: "Start with the guide that best matches the learning job in front of you.",
          href: `/blog/category/${category.slug}`,
        },
        {
          title: "Open a related mode",
          text: "Move from advice into a public guest chat so the idea becomes practice.",
          href: "/topics",
        },
        {
          title: "Save the next review step",
          text: "Turn mistakes, questions, or summaries into flashcards or a follow-up prompt.",
          href: topicPath("flashcard-builder"),
        },
      ],
    }
  );
}

export function getBlogCategoryRelatedModes(category: BlogCategory, limit = 6) {
  const scores = new Map<
    string,
    { count: number; boost: number; topic: NonNullable<ReturnType<typeof getBlogPostTopic>> }
  >();
  const profile = getBlogCategoryProfile(category);

  for (const workflow of profile.workflows) {
    const slug = workflow.href.match(/^\/chat\/([^/?#]+)/)?.[1];
    const topic = slug ? topicSeedBySlug.get(slug) : undefined;
    if (!topic) continue;
    scores.set(topic.slug, { count: 0, boost: 100, topic });
  }

  for (const post of category.posts) {
    const topic = getBlogPostTopic(post);
    if (!topic) continue;
    const existing = scores.get(topic.slug);
    if (existing) {
      existing.count += 1;
    } else {
      scores.set(topic.slug, { count: 1, boost: 0, topic });
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.boost - a.boost || b.count - a.count || a.topic.name.localeCompare(b.topic.name))
    .slice(0, limit)
    .map(({ count, topic }) => ({
      slug: topic.slug,
      name: topic.name,
      href: topicPath(topic.slug),
      description: topic.subText,
      count: Math.max(count, 1),
    }));
}

export function getBlogCategoryFeaturedPosts(category: BlogCategory, limit = 6) {
  const postsBySlug = new Map(getBlogPosts().map((post) => [post.slug, post]));
  const selected: BlogPost[] = [];

  for (const cluster of blogPillarClusters) {
    if (cluster.categoryHref !== `/blog/category/${category.slug}`) continue;
    for (const slug of cluster.guideSlugs) {
      const post = postsBySlug.get(slug);
      if (!post) continue;
      selected.push(post);
      if (selected.length >= limit) return selected;
    }
  }

  for (const post of category.posts) {
    if (selected.length >= limit) break;
    if (!selected.some((item) => item.slug === post.slug)) selected.push(post);
  }

  return selected.slice(0, limit);
}

export function getBlogCategoryFaqs(category: BlogCategory) {
  const profile = getBlogCategoryProfile(category);

  return [
    {
      question: `What is the best way to use these ${category.name.toLowerCase()} guides?`,
      answer: `Start with one practical guide, then open a related public learning mode so the advice becomes practice. This category is designed for ${profile.audience.toLowerCase()}`,
    },
    {
      question: "Do these guides connect to live AI learning tools?",
      answer:
        "Yes. Category pages link into public guest modes, learning paths, and article clusters so learners can move from reading into tutoring, quizzes, flashcards, debate, planning, or feedback.",
    },
    {
      question: "Are these pages written only for search engines?",
      answer:
        "No. The category structure helps search engines understand the library, but each page is meant to help a learner choose a guide, open the right mode, and keep studying actively.",
    },
  ];
}

export function getBlogPillarClusters(posts: BlogPost[] = getBlogPosts()) {
  const postsBySlug = new Map(posts.map((post) => [post.slug, post]));

  return blogPillarClusters.map((cluster) => ({
    ...cluster,
    guides: cluster.guideSlugs
      .map((slug) => postsBySlug.get(slug))
      .filter((post): post is BlogPost => Boolean(post))
      .map((post) => {
        const topic = getBlogPostTopic(post);
        return {
          slug: post.slug,
          title: post.title,
          href: `/blog/${post.slug}`,
          description: post.description,
          date: post.date,
          relatedMode: topic ? { slug: topic.slug, name: topic.name, href: topicPath(topic.slug) } : null,
        };
      }),
  }));
}
