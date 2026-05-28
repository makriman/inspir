export type TopicSeo = {
  title: string;
  description: string;
  who: string;
  whyDifferent: string;
  outcomes: string[];
  searchIntents: string[];
};

export type TopicSeoInput = {
  slug: string;
  name: string;
  description: string;
  subText: string;
  metadata: { category: string };
};

const topTopicSeo: Record<string, TopicSeo> = {
  "learn-anything": {
    title: "Learn Anything With a Free AI Tutor",
    description:
      "Ask any question and learn through clear explanations, examples, follow-up prompts, and patient AI tutoring.",
    who: "Curious learners, students, parents, and self-taught builders who want a friendly place to start.",
    whyDifferent:
      "Instead of dropping a long answer, inspir helps you choose a simpler foundation, a deeper route, or a practical example.",
    outcomes: ["Understand the core idea", "Get examples at your level", "Leave with a useful next question"],
    searchIntents: ["free AI tutor", "learn anything online", "AI learning companion"],
  },
  "socratic-instruction": {
    title: "Socratic AI Tutor For Deeper Understanding",
    description:
      "Learn through focused questions, hints, and reflection instead of passive answer reading.",
    who: "Learners who want to think through a topic, test assumptions, and build durable understanding.",
    whyDifferent:
      "The tutor asks one question at a time, waits for your reasoning, and synthesizes only after you have tried.",
    outcomes: ["Build a hypothesis", "Use hints before answers", "Turn confusion into a clearer model"],
    searchIntents: ["AI Socratic tutor", "Socratic learning app", "learn through questions"],
  },
  "homework-coach": {
    title: "AI Homework Coach With Hints, Not Answer Dumping",
    description:
      "Get unstuck on homework with ethical hints, examples, checks, and step-by-step coaching.",
    who: "Students who need help starting a problem, checking work, or understanding a mistake.",
    whyDifferent:
      "The coach supports your thinking without taking over the assignment, so the final work stays yours.",
    outcomes: ["Find the next step", "Understand the mistake", "Practice a similar problem"],
    searchIntents: ["AI homework helper", "homework hints", "homework coach"],
  },
  "math-step-coach": {
    title: "Math Step Coach For Solving Problems With Understanding",
    description:
      "Work through algebra, calculus, word problems, and math concepts one step at a time with an AI coach.",
    who: "Learners who want to see why each math step works, not just copy an answer.",
    whyDifferent:
      "The flow checks each step, points out slips, and connects procedures back to the concept.",
    outcomes: ["Choose a first move", "Check each step", "Explain why the method works"],
    searchIntents: ["AI math tutor", "step by step math help", "math problem coach"],
  },
  "writing-coach": {
    title: "AI Writing Coach For Essays, Stories, And Clearer Drafts",
    description:
      "Improve writing with planning, revision, structure, and feedback that keeps your voice intact.",
    who: "Learners writing essays, stories, emails, scholarship notes, or arguments.",
    whyDifferent:
      "The coach gives targeted revision priorities and before-after examples without replacing your voice.",
    outcomes: ["Clarify your point", "Improve structure", "Revise with a reason"],
    searchIntents: ["AI writing tutor", "essay feedback AI", "writing coach"],
  },
  "code-tutor": {
    title: "Code Tutor For Learning Programming By Building",
    description:
      "Understand code, debug errors, learn programming concepts, and build small projects step by step.",
    who: "Beginner and intermediate programmers who need explanations, debugging help, or project coaching.",
    whyDifferent:
      "The tutor asks what you expect code to do, then uses small examples and tests to make the behavior click.",
    outcomes: ["Explain the bug", "Understand the concept", "Try a small fix"],
    searchIntents: ["AI code tutor", "learn programming with AI", "debug code help"],
  },
  "quiz-me-on-trivia": {
    title: "Free AI Quiz Builder For Any Topic",
    description:
      "Generate a focused multiple-choice quiz on any subject and review explanations after each answer.",
    who: "Learners who want active recall, quick practice, and a score they can improve.",
    whyDifferent:
      "The quiz mode hides answers until you respond, then turns every miss into a review point.",
    outcomes: ["Practice retrieval", "Get instant feedback", "Review weak areas"],
    searchIntents: ["AI quiz generator", "free quiz maker", "quiz me on any topic"],
  },
  "flashcard-builder": {
    title: "AI Flashcard Builder For Active Recall",
    description:
      "Turn notes or topics into focused flashcards with hints, answers, examples, and common traps.",
    who: "Students preparing for exams, language learners, and anyone using retrieval practice.",
    whyDifferent:
      "Cards ask one thing at a time and include traps so review builds understanding, not just recognition.",
    outcomes: ["Create recall cards", "Reveal answers when ready", "Review misses sooner"],
    searchIntents: ["AI flashcard maker", "free flashcard builder", "active recall AI"],
  },
  "interactive-instruction": {
    title: "Interactive AI Tutor With Live Lesson Tools",
    description:
      "Learn by doing, comparing, repairing, and proving mastery with an AI tutor that turns your goal into an active lesson.",
    who: "Learners who want a guided lesson canvas with examples, checks, and active practice instead of a long chat answer.",
    whyDifferent:
      "The mode keeps the session interactive, moving between explanation, try-it steps, checks, and repairs.",
    outcomes: ["Set a learning goal", "Practise inside the lesson", "Repair weak spots"],
    searchIntents: ["interactive AI tutor", "AI lesson generator", "learn by doing with AI"],
  },
  "time-travel": {
    title: "AI Time Travel For Learning History",
    description:
      "Build a temporal passport, clear the travel advisory, and explore a historical world through scene, map, timeline, people, rules, inventory, and evidence.",
    who: "History learners who want a specific society, identity, and set of constraints rather than a generic period summary.",
    whyDifferent:
      "The journey stays anchored in state and evidence: what is known, what is reconstructed, what is speculative, and what your identity can realistically access.",
    outcomes: ["Create a passport", "Enter a world", "Inspect evidence"],
    searchIntents: ["AI history tutor", "time travel learning", "interactive history app"],
  },
  "talk-to-a-historical-person": {
    title: "Talk To Historical Figures With AI",
    description:
      "Ask questions, challenge ideas, and learn history through grounded conversations with public figures from the past.",
    who: "Learners who want to understand people, choices, and ideas in historical context.",
    whyDifferent:
      "The app separates in-character conversation from short context notes about records and uncertainty.",
    outcomes: ["Meet a figure", "Ask better questions", "Understand the era"],
    searchIntents: ["talk to historical figures AI", "AI history roleplay", "historical person chatbot"],
  },
  "debate-any-topic": {
    title: "AI Debate Coach For Sharper Arguments",
    description:
      "Debate any topic, get challenged, compare claims, and learn how to make stronger arguments.",
    who: "Students, debaters, writers, and curious learners who want stronger reasoning.",
    whyDifferent:
      "The coach pushes one strong counterargument at a time and tracks the claims that matter.",
    outcomes: ["Choose a side", "Answer counterarguments", "Strengthen weak claims"],
    searchIntents: ["AI debate coach", "debate any topic", "argument practice"],
  },
  "debate-with-a-personality": {
    title: "Debate With A Personality Using AI",
    description:
      "Practice argument by debating a public or fictional personality on a topic you choose.",
    who: "Learners who want lively debate practice with memorable voices and fair challenge.",
    whyDifferent:
      "The debate uses public style and worldview without pretending to know private beliefs.",
    outcomes: ["Set a topic", "Choose a personality", "Practice rebuttals"],
    searchIntents: ["AI debate personality", "debate with AI", "argument chatbot"],
  },
  "exam-prep-planner": {
    title: "AI Exam Prep Planner For Realistic Study Schedules",
    description:
      "Turn your syllabus, exam date, time, and weak areas into a practical study plan.",
    who: "Students who need a plan that balances revision, practice, confidence, and real life.",
    whyDifferent:
      "The planner prioritizes weak areas, adds review loops, and creates fallback plans for missed days.",
    outcomes: ["Prioritize topics", "Plan review", "Track risk areas"],
    searchIntents: ["AI study planner", "exam prep planner", "study schedule generator"],
  },
  "memory-palace": {
    title: "AI Memory Palace Builder For Study Recall",
    description:
      "Convert facts, speeches, lists, or sequences into memorable scenes that make recall easier during study and exams.",
    who: "Learners memorizing ordered ideas, vocabulary, speeches, formulas, or facts that need a stronger mental hook.",
    whyDifferent:
      "The mode designs vivid locations, paths, and retrieval cues instead of asking you to reread notes.",
    outcomes: ["Choose a route", "Place vivid cues", "Practise recall"],
    searchIntents: ["AI memory palace", "memory palace builder", "memorize with AI"],
  },
  "spaced-review": {
    title: "AI Spaced Review Coach For Long-Term Memory",
    description:
      "Plan quick review sessions, revisit weak ideas, and strengthen long-term memory with AI-guided spaced repetition.",
    who: "Learners who forget after reading and need a practical review rhythm for concepts, terms, or exam material.",
    whyDifferent:
      "The coach turns misses and hesitation into a review schedule rather than another passive summary.",
    outcomes: ["Pick review targets", "Schedule recall", "Repair misses"],
    searchIntents: ["AI spaced repetition", "spaced review coach", "AI memory review"],
  },
  "study-plan-builder": {
    title: "AI Study Plan Builder For Better Learning",
    description:
      "Create a realistic study plan around your time, energy, goals, weak spots, review loops, and practice schedule.",
    who: "Students and self-taught learners who need structure without turning the plan into an impossible checklist.",
    whyDifferent:
      "The builder balances ambition with review, practice, recovery days, and the next smallest useful action.",
    outcomes: ["Define the goal", "Schedule practice", "Build review loops"],
    searchIntents: ["AI study plan builder", "AI study schedule", "study planner with AI"],
  },
  "story-tutor": {
    title: "Story Tutor For Learning Through Narrative",
    description:
      "Turn concepts into stories, characters, conflicts, and memorable scenes that make difficult ideas easier to recall.",
    who: "Learners who remember ideas better through narrative, analogy, characters, and vivid examples.",
    whyDifferent:
      "The tutor translates abstract material into story structure while keeping the underlying concept visible.",
    outcomes: ["Choose the concept", "Build a story", "Explain the lesson"],
    searchIntents: ["AI story tutor", "learn through stories", "story based learning AI"],
  },
};

export function getTopicSeo(topic: TopicSeoInput): TopicSeo {
  const explicit = topTopicSeo[topic.slug];
  if (explicit) return explicit;

  const category = topic.metadata.category.toLowerCase();
  return {
    title: `${topic.name} AI Learning Mode`,
    description: topic.description,
    who: `Learners exploring ${category} topics who want practical guidance instead of a generic answer box.`,
    whyDifferent: `This mode is tuned for ${topic.name.toLowerCase()} with its own prompts, examples, and learning flow.`,
    outcomes: [topic.subText, "Start with example prompts", "Adapt the session to your goal"],
    searchIntents: [`${topic.name} AI tutor`, `${topic.name} learning app`, `AI ${category} coach`],
  };
}
