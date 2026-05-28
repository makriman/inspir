export const homepageLearningPaths = [
  {
    slug: "understand-a-hard-topic",
    title: "Understand a hard topic",
    seoTitle: "How to Understand a Hard Topic With AI",
    seoDescription:
      "A practical AI learning path for moving from confusion to clear explanation, Socratic questions, examples, and active recall.",
    description:
      "Move from a plain-language explanation into questions, examples, and memory practice.",
    audience: "Learners who feel stuck at the beginning of a new subject or need a simpler path into a difficult idea.",
    outcome:
      "Leave with a plain-language model, sharper questions, examples you can explain back, and recall cards for review.",
    links: [
      { label: "Start with Learn Anything", href: "/chat/learn-anything" },
      { label: "Use Socratic questions", href: "/chat/socratic-instruction" },
      { label: "Turn it into flashcards", href: "/chat/flashcard-builder" },
    ],
    steps: [
      {
        title: "Get the simple model first",
        text: "Ask for the topic in plain language, then request one analogy, one example, and one common misconception.",
        href: "/chat/learn-anything",
      },
      {
        title: "Test your reasoning",
        text: "Switch into questions so you can reveal assumptions and fill gaps instead of passively reading the answer.",
        href: "/chat/socratic-instruction",
      },
      {
        title: "Make the idea stick",
        text: "Convert the explanation into active recall cards, then revisit the cards after mistakes or hesitation.",
        href: "/chat/flashcard-builder",
      },
    ],
    proofPoints: ["Plain-language explanations", "Socratic checks", "Active recall review"],
    relatedBlogSlugs: [
      "ai-learn-anything-guide",
      "socratic-ai-tutor",
      "ai-flashcards-and-active-recall",
    ],
    faqs: [
      {
        question: "What should I ask first when a topic feels too hard?",
        answer:
          "Start by asking for a simple explanation, one everyday analogy, and the three ideas you need before the topic will make sense.",
      },
      {
        question: "Why use Socratic questions after an explanation?",
        answer:
          "Questions make you expose your own model of the topic, which is where confusion, false confidence, and missing prerequisites usually show up.",
      },
    ],
  },
  {
    slug: "get-unstuck-on-homework",
    title: "Get unstuck on homework",
    seoTitle: "AI Homework Help Without Copying Answers",
    seoDescription:
      "Use AI homework coaching for hints, step checks, math reasoning, and writing feedback while keeping the final work yours.",
    description:
      "Use hints, step checks, and writing feedback without turning the learning into answer copying.",
    audience: "Students who need a next step, a mistake check, or feedback without losing ownership of the assignment.",
    outcome:
      "Know what to try next, why a step works, where the mistake happened, and how to revise the final answer in your own voice.",
    links: [
      { label: "Try Homework Coach", href: "/chat/homework-coach" },
      { label: "Work through math steps", href: "/chat/math-step-coach" },
      { label: "Improve the draft", href: "/chat/writing-coach" },
    ],
    steps: [
      {
        title: "Ask for a hint, not the answer",
        text: "Paste the question and what you have tried, then ask for the smallest useful next step.",
        href: "/chat/homework-coach",
      },
      {
        title: "Check the reasoning line by line",
        text: "For math or logic, work one step at a time and ask why each move is allowed before moving on.",
        href: "/chat/math-step-coach",
      },
      {
        title: "Revise without losing your voice",
        text: "Use writing feedback for structure, clarity, and evidence while keeping the final draft recognizably yours.",
        href: "/chat/writing-coach",
      },
    ],
    proofPoints: ["Hint-first help", "Step checks", "Voice-preserving feedback"],
    relatedBlogSlugs: [
      "how-to-study-with-ai-without-cheating-yourself",
      "ai-homework-coach-guide",
      "ai-math-step-coach-guide",
    ],
    faqs: [
      {
        question: "Can AI homework help be ethical?",
        answer:
          "Yes, when it gives hints, checks reasoning, explains mistakes, and asks you to produce the final answer instead of writing it for you.",
      },
      {
        question: "What should I include in a homework prompt?",
        answer:
          "Include the question, what you already tried, where you got stuck, and whether you want a hint, a step check, or feedback.",
      },
    ],
  },
  {
    slug: "prepare-for-an-exam",
    title: "Prepare for an exam",
    seoTitle: "AI Exam Prep Plan With Quizzes and Active Recall",
    seoDescription:
      "Build an AI exam prep workflow with a realistic study plan, retrieval practice, quizzes, flashcards, and weak-area review.",
    description:
      "Plan the work, practise retrieval, and close weak spots with quizzes and active recall.",
    audience: "Learners who have limited time, a large syllabus, and need a realistic way to review without pretending everything matters equally.",
    outcome:
      "Get a study schedule, quiz yourself on weak areas, and turn misses into flashcards for repeated review.",
    links: [
      { label: "Build an exam plan", href: "/chat/exam-prep-planner" },
      { label: "Quiz yourself", href: "/chat/quiz-me-on-trivia" },
      { label: "Review with flashcards", href: "/chat/flashcard-builder" },
    ],
    steps: [
      {
        title: "Make the study plan realistic",
        text: "Use the exam date, syllabus, available time, and weak areas to create a plan that can survive real life.",
        href: "/chat/exam-prep-planner",
      },
      {
        title: "Practise retrieval before rereading",
        text: "Quiz yourself first so you can see what you actually remember and where confidence is misleading.",
        href: "/chat/quiz-me-on-trivia",
      },
      {
        title: "Turn misses into review loops",
        text: "Make flashcards from errors, hesitation, formulas, definitions, and concepts you could not explain clearly.",
        href: "/chat/flashcard-builder",
      },
    ],
    proofPoints: ["Realistic schedule", "Retrieval practice", "Weak-area loops"],
    relatedBlogSlugs: [
      "ai-exam-prep-planner-guide",
      "ai-flashcards-and-active-recall",
      "how-to-study-with-ai-without-cheating-yourself",
    ],
    faqs: [
      {
        question: "How early should I make an exam prep plan?",
        answer:
          "Start as soon as you know the exam date. If time is short, prioritize weak areas, past-paper style questions, and daily recall.",
      },
      {
        question: "Are quizzes better than rereading?",
        answer:
          "Quizzes usually reveal more because they test retrieval. Rereading can help after a quiz shows what needs repair.",
      },
    ],
  },
  {
    slug: "explore-history-and-ideas",
    title: "Explore history and ideas",
    seoTitle: "Explore History and Big Ideas With AI",
    seoDescription:
      "Use AI time travel, historical conversations, and debate practice to explore context, evidence, arguments, and perspectives.",
    description:
      "Step into historical context, compare arguments, and practise seeing an idea from more than one side.",
    audience: "Curious learners who want history and ideas to feel situated, debatable, and alive without losing track of evidence.",
    outcome:
      "Understand a historical context, question a perspective, compare claims, and separate simulation from documented fact.",
    links: [
      { label: "Travel through a period", href: "/chat/time-travel" },
      { label: "Talk to a historical person", href: "/chat/talk-to-a-historical-person" },
      { label: "Debate a claim", href: "/chat/debate-any-topic" },
    ],
    steps: [
      {
        title: "Enter the context",
        text: "Start with place, time, identity, constraints, and evidence labels so the scene does not become generic roleplay.",
        href: "/chat/time-travel",
      },
      {
        title: "Question a historical perspective",
        text: "Talk to a historical figure while keeping generated dialogue separate from documented quotation.",
        href: "/chat/talk-to-a-historical-person",
      },
      {
        title: "Compare the arguments",
        text: "Debate the claim from more than one side so you can notice assumptions, tradeoffs, and weak evidence.",
        href: "/chat/debate-any-topic",
      },
    ],
    proofPoints: ["Evidence-aware scenes", "Historical conversations", "Argument practice"],
    relatedBlogSlugs: [
      "talk-to-historical-figures-with-ai",
      "ai-time-travel-guide",
      "ai-debate-any-topic-guide",
    ],
    faqs: [
      {
        question: "Can I cite AI historical dialogue as a source?",
        answer:
          "No. Treat generated dialogue as a learning simulation. Cite real primary or secondary sources for factual claims.",
      },
      {
        question: "Why combine history with debate?",
        answer:
          "Debate helps you separate claims, evidence, values, and assumptions, which makes historical interpretation more precise.",
      },
    ],
  },
] as const;

export const homepageFaqs = [
  {
    question: "Is inspir free to use?",
    answer:
      "Yes. The public guest learning modes are designed for free access, so learners can start without needing a school deployment or paid account.",
  },
  {
    question: "Can I use inspir without signing in?",
    answer:
      "Yes. Public topic chats such as Learn Anything, Socratic Instruction, Homework Coach, quizzes, and flashcards open directly in guest mode.",
  },
  {
    question: "How is inspir different from a generic AI chatbot?",
    answer:
      "inspir is organized around learning modes with specific teaching shapes: hints, Socratic questions, quizzes, active recall, role-play, debate, writing feedback, and study planning.",
  },
  {
    question: "Can inspir help with homework without encouraging cheating?",
    answer:
      "The homework and Socratic modes are designed around hints, reasoning, step checks, and learner explanations instead of simply handing over finished answers.",
  },
  {
    question: "Does inspir support schools?",
    answer:
      "Yes. Schools can use the public product first, then discuss custom AI learning spaces with school-specific workflows, confidentiality, and funded access options.",
  },
] as const;

export type HomepageLearningPath = (typeof homepageLearningPaths)[number];

export function learningPathHref(slug: string) {
  return `/learn/${slug}`;
}

export function getLearningPath(slug: string) {
  return homepageLearningPaths.find((path) => path.slug === slug);
}
