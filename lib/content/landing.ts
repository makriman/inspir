export const homepageHeroRoutes = [
  {
    eyebrow: "Ask anything",
    title: "Learn Anything",
    href: "/chat/learn-anything",
  },
  {
    eyebrow: "Think deeper",
    title: "Socratic tutor",
    href: "/chat/socratic-instruction",
  },
  {
    eyebrow: "Get unstuck",
    title: "Homework Coach",
    href: "/chat/homework-coach",
  },
] as const;

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
    searchIntents: [
      "how to understand a hard topic with AI",
      "AI tutor for difficult concepts",
      "AI Socratic tutor",
      "AI flashcards for active recall",
    ],
    examplePrompts: [
      {
        title: "Start from first principles",
        text: "Explain this topic in plain language. Name the three prerequisite ideas I need, one analogy, and one common misconception.",
        href: "/chat/learn-anything",
      },
      {
        title: "Check my model",
        text: "Ask me five Socratic questions about this topic. After each answer, tell me what assumption I used and what to test next.",
        href: "/chat/socratic-instruction",
      },
      {
        title: "Make it stick",
        text: "Turn the explanation into active recall cards with one conceptual card, one example card, and one misconception card.",
        href: "/chat/flashcard-builder",
      },
    ],
    avoid: [
      "Do not ask for a complete summary before you know the prerequisite ideas.",
      "Do not stop after the first explanation; make yourself answer questions about it.",
      "Do not make flashcards from sentences you still cannot explain in your own words.",
    ],
    reviewLoop: [
      {
        title: "Explain it back",
        text: "Write a three-sentence explanation without looking, then ask the Socratic mode to find the weak link.",
        href: "/chat/socratic-instruction",
      },
      {
        title: "Create a tiny quiz",
        text: "Ask for five questions that mix definitions, examples, and transfer problems.",
        href: "/chat/quiz-me-on-trivia",
      },
      {
        title: "Repair one miss",
        text: "Turn the hardest missed question into a flashcard and review it later.",
        href: "/chat/flashcard-builder",
      },
    ],
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
    searchIntents: [
      "AI homework help without cheating",
      "AI homework coach",
      "AI math step coach",
      "AI writing feedback for students",
    ],
    examplePrompts: [
      {
        title: "Ask for a hint",
        text: "Here is the question and what I tried. Give me the smallest useful hint, not the final answer.",
        href: "/chat/homework-coach",
      },
      {
        title: "Check one step",
        text: "Check this step in my working. If it is wrong, explain the mistake and give me one next move.",
        href: "/chat/math-step-coach",
      },
      {
        title: "Revise my draft",
        text: "Give feedback on structure, clarity, and evidence. Keep my voice and do not rewrite the whole answer.",
        href: "/chat/writing-coach",
      },
    ],
    avoid: [
      "Do not paste an assignment and ask for the finished response.",
      "Do not skip showing what you already tried; the useful help depends on that context.",
      "Do not accept a revised paragraph until you can explain why the revision is better.",
    ],
    reviewLoop: [
      {
        title: "State the stuck point",
        text: "Write exactly where you got stuck before asking for help.",
        href: "/chat/homework-coach",
      },
      {
        title: "Explain the next step",
        text: "After each hint, explain why the step works before continuing.",
        href: "/chat/socratic-instruction",
      },
      {
        title: "Save the mistake",
        text: "Turn the corrected mistake into a flashcard or short checklist for later.",
        href: "/chat/flashcard-builder",
      },
    ],
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
    searchIntents: [
      "AI exam prep plan",
      "AI study schedule",
      "AI quiz generator for exams",
      "AI flashcards for revision",
    ],
    examplePrompts: [
      {
        title: "Build the plan",
        text: "My exam is on this date. Here is the syllabus, my weak areas, and my available time. Make a realistic plan with daily recall.",
        href: "/chat/exam-prep-planner",
      },
      {
        title: "Quiz weak areas",
        text: "Quiz me on these topics one question at a time. After each answer, explain the gap and increase difficulty slowly.",
        href: "/chat/quiz-me-on-trivia",
      },
      {
        title: "Convert misses",
        text: "Turn these missed questions into flashcards grouped by concept, formula, definition, and example.",
        href: "/chat/flashcard-builder",
      },
    ],
    avoid: [
      "Do not make a plan that assumes every topic needs equal time.",
      "Do not reread notes before testing what you can already recall.",
      "Do not ignore hesitation; uncertainty is a useful signal for review.",
    ],
    reviewLoop: [
      {
        title: "Test before review",
        text: "Start each session with a quick quiz before rereading.",
        href: "/chat/quiz-me-on-trivia",
      },
      {
        title: "Repair the weak spot",
        text: "Ask for a simpler explanation of the weakest concept.",
        href: "/chat/learn-anything",
      },
      {
        title: "Schedule the next repetition",
        text: "Make flashcards from errors and revisit them after a delay.",
        href: "/chat/flashcard-builder",
      },
    ],
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
    searchIntents: [
      "AI time travel learning",
      "talk to historical figures AI",
      "AI debate practice",
      "AI history tutor",
    ],
    examplePrompts: [
      {
        title: "Enter a period",
        text: "Place me in this time and location. Label documented facts separately from plausible simulation and ask what I notice.",
        href: "/chat/time-travel",
      },
      {
        title: "Question a figure",
        text: "Let me interview this historical person. Keep answers evidence-aware and mark uncertainty clearly.",
        href: "/chat/talk-to-a-historical-person",
      },
      {
        title: "Debate the claim",
        text: "Debate this historical or philosophical claim from both sides. Separate evidence, assumptions, and values.",
        href: "/chat/debate-any-topic",
      },
    ],
    avoid: [
      "Do not treat generated dialogue as a real quote or primary source.",
      "Do not let roleplay replace dates, context, documents, or evidence labels.",
      "Do not debate only the side you already agree with.",
    ],
    reviewLoop: [
      {
        title: "Summarize the context",
        text: "After the simulation, summarize the setting, constraints, and evidence.",
        href: "/chat/time-travel",
      },
      {
        title: "Separate fact from invention",
        text: "Ask the historical mode to label what is documented, inferred, or simulated.",
        href: "/chat/talk-to-a-historical-person",
      },
      {
        title: "Test the argument",
        text: "Use debate to compare the strongest claim and strongest counterclaim.",
        href: "/chat/debate-any-topic",
      },
    ],
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

export const homepageFilm = {
  title: "inspir: You can Learn Anything",
  description:
    "A short film introducing inspir's belief that learning should be free, accessible, and alive.",
  contentUrl: "/media/inspir-hero-learning-loop.webm",
  captionUrl: "/media/inspir-hero-learning-loop.en.vtt",
  chaptersUrl: "/media/inspir-hero-learning-loop.chapters.vtt",
  thumbnailUrl: "/media/inspir-hero-learning-studio.jpg",
  duration: "PT31S",
  uploadDate: "2026-05-28",
  transcript:
    "inspir exists for the moment a learner wants to understand something and needs a patient place to begin. The film introduces the product as a free public learning companion for curiosity, practice, and access.",
  chapters: [
    {
      title: "Curiosity starts here",
      start: 0,
      end: 7,
      text: "The opening frames set up learning as something anyone should be able to start immediately.",
    },
    {
      title: "A tutor for the first question",
      start: 7,
      end: 15,
      text: "The film shifts from inspiration into the practical promise: a patient AI learning companion.",
    },
    {
      title: "Practice, not answer-copying",
      start: 15,
      end: 23,
      text: "The middle section frames inspir around understanding, hints, quizzes, and active learning loops.",
    },
    {
      title: "Learning for everyone",
      start: 23,
      end: 31,
      text: "The closing beat returns to the mission: public access, schools, and a more open way to learn.",
    },
  ],
} as const;

export type HomepageLearningPath = (typeof homepageLearningPaths)[number];
export type HomepageFilmChapter = (typeof homepageFilm.chapters)[number];

export function learningPathHref(slug: string) {
  return `/learn/${slug}`;
}

export function getLearningPath(slug: string) {
  return homepageLearningPaths.find((path) => path.slug === slug);
}
