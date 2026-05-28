export const homepageLearningPaths = [
  {
    title: "Understand a hard topic",
    description:
      "Move from a plain-language explanation into questions, examples, and memory practice.",
    links: [
      { label: "Start with Learn Anything", href: "/chat/learn-anything" },
      { label: "Use Socratic questions", href: "/chat/socratic-instruction" },
      { label: "Turn it into flashcards", href: "/chat/flashcard-builder" },
    ],
  },
  {
    title: "Get unstuck on homework",
    description:
      "Use hints, step checks, and writing feedback without turning the learning into answer copying.",
    links: [
      { label: "Try Homework Coach", href: "/chat/homework-coach" },
      { label: "Work through math steps", href: "/chat/math-step-coach" },
      { label: "Improve the draft", href: "/chat/writing-coach" },
    ],
  },
  {
    title: "Prepare for an exam",
    description:
      "Plan the work, practise retrieval, and close weak spots with quizzes and active recall.",
    links: [
      { label: "Build an exam plan", href: "/chat/exam-prep-planner" },
      { label: "Quiz yourself", href: "/chat/quiz-me-on-trivia" },
      { label: "Review with flashcards", href: "/chat/flashcard-builder" },
    ],
  },
  {
    title: "Explore history and ideas",
    description:
      "Step into historical context, compare arguments, and practise seeing an idea from more than one side.",
    links: [
      { label: "Travel through a period", href: "/chat/time-travel" },
      { label: "Talk to a historical person", href: "/chat/talk-to-a-historical-person" },
      { label: "Debate a claim", href: "/chat/debate-any-topic" },
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
