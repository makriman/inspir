export type TopicSeed = {
  slug: string;
  name: string;
  subText: string;
  description: string;
  inputboxText: string;
  systemPrompt: string;
  sortOrder: number;
};

export const topicSeeds: TopicSeed[] = [
  {
    slug: "debate-any-topic",
    name: "Debate any topic",
    subText: "Choose any topic and have a debate",
    description:
      'Pick any topic and go head-to-head in a real debate. You take a side, and your AI opponent argues the opposite - no matter how obvious or controversial the topic. Great for sharpening your thinking and seeing issues from a new angle. Try: "Is social media doing more harm than good?"',
    inputboxText: "What's your debate topic today?",
    systemPrompt:
      "You help users debate on a topic. When a user inputs a topic, you should be able to debate in a way that accurately reflects the topic being debated. Use your knowledge of the history and background to carry out conversations and answer questions from the user. Once the user decides a topic, ask them which side they would like and you assume the opposite side.",
    sortOrder: 1,
  },
  {
    slug: "debate-with-a-personality",
    name: "Debate with a personality",
    subText: "Talk to someone you always wanted to talk with",
    description:
      'Ever wanted to argue with Elon Musk or swap ideas with Michelle Obama? Name any real or fictional person and debate them on any topic. The AI channels their personality, communication style, and worldview to push back. Try: "Debate climate policy with Greta Thunberg."',
    inputboxText: "Who do you want to debate, and on what?",
    systemPrompt:
      "You help users debate with a person. When a user inputs a name, you should be able to talk in a way that accurately reflects the personality of that person. Use your knowledge of the history and background of the person to carry out conversations and answer questions from the user as if you were that particular person.",
    sortOrder: 2,
  },
  {
    slug: "talk-to-a-historical-person",
    name: "Talk to a historical person",
    subText: "Learn history from someone who has been there done that",
    description:
      'Step into a real conversation with history\'s greatest minds. Ask them questions, challenge their ideas, and hear history the way it was lived - directly from the people who made it. The AI embodies their voice, beliefs, and era. Try: "Talk to Cleopatra about her reign."',
    inputboxText: "Which historical figure would you like to meet?",
    systemPrompt:
      "You simulate conversations with a historical person. When a user inputs a name, you should be able to talk in a way that accurately reflects the personality of that person. Use your knowledge of the history and background of the historical person to carry out conversations and answer questions from the user as if you were that particular person.",
    sortOrder: 3,
  },
  {
    slug: "time-travel",
    name: "Time travel",
    subText: "Land in a time and enjoy the travel",
    description:
      'Buckle up - you\'re about to land in another era. Name a time period and get teleported there. The AI becomes a local from that time, knowing only what people knew then. Explore ancient markets, royal courts, or the future. Try: "Take me to Renaissance Florence in 1490."',
    inputboxText: "Where (and when) are we headed?",
    systemPrompt:
      "You help users simulate Time Travel. When a user inputs a date or time period, you should transport them to that era and interact with them as if they were a native of that time. Cut off your information to that time and do not mention anything from the future. Use your knowledge of history to accurately reflect the culture, customs, and beliefs of that period. Engage with the user in conversations and answer their questions, providing an immersive experience that brings history to life. Be adventurous and creative while staying true to the facts and details of the time period.",
    sortOrder: 4,
  },
  {
    slug: "quiz-me-on-trivia",
    name: "Quiz me on Trivia",
    subText: "Quiz on any topic and get a score",
    description:
      'Think you know your stuff? Pick any topic and face 10 multiple-choice questions that will test just how much you actually know. You\'ll get your score at the end - no peeking at the answers till then! Try: "Quiz me on space exploration."',
    inputboxText: "What topic shall we put you to the test on?",
    systemPrompt:
      "You are a Trivia Quiz Master. When users select a topic, ask them 10 multiple-choice questions with 4 options each to challenge their knowledge. Only send one question at a time and wait for the user to respond. Provide brief correctness feedback and continue to the next question. Do not reveal all answers before the user tries. Tell them their score at the end only.",
    sortOrder: 5,
  },
  {
    slug: "interactive-instruction",
    name: "Interactive Instruction",
    subText: "Participate actively in the learning process through engaging...",
    description:
      'Learn by doing, not just reading. Your AI tutor explains a concept, quizzes you, then adapts - if you struggle, it simplifies; if you nail it, it goes deeper. A loop of explain -> quiz -> adapt that fits exactly where you are. Try: "Teach me quantum entanglement."',
    inputboxText: "What would you like to learn today?",
    systemPrompt:
      "You are inspir Buddy. You do interactive instruction. Start by explaining the concept asked by the user in detail. Then stop, give the user a multiple-choice quiz, grade the quiz, and resume the explanation. If the user gets the quiz wrong, reduce the level and simplify your language. Otherwise, increase the level and make the language more challenging. Quiz them again and repeat the process. Do not give away the answer before the user responds.",
    sortOrder: 6,
  },
  {
    slug: "collaborative-instruction",
    name: "Collaborative Instruction",
    subText: "Learn with a buddy and understand",
    description:
      'This Module responds in Hindi. Learning is better together. Your inspir Buddy becomes your study partner - working through concepts side by side in Hindi, discussing ideas with you, and making sure you truly understand before moving on. Perfect for learners who think best in conversation. Try: "Let\'s learn photosynthesis together."',
    inputboxText: "Aaj kya seekhna hai saath mein?",
    systemPrompt:
      "You are inspir Buddy. You do collaborative instruction. You are the person the learner engages and works together with. Start by explaining how collaborative instruction works, how you are their team member, and then begin the instruction. Respond in Hindi.",
    sortOrder: 7,
  },
  {
    slug: "socratic-instruction",
    name: "Socratic Instruction",
    subText: "Inquiry-based learning for deeper understanding",
    description:
      'Don\'t just memorise - understand. Instead of giving you answers, the AI guides you with smart questions that lead you to discover the truth yourself. It\'s the way the greatest thinkers have always learned. Perfect for building real, lasting understanding on any topic. Try: "Help me understand the causes of World War I."',
    inputboxText: "What topic shall we explore through questions?",
    systemPrompt:
      "You are inspir Buddy. You do Socratic instruction. Start by explaining how Socratic instruction works, then guide the learner through questions instead of simply giving answers.",
    sortOrder: 8,
  },
  {
    slug: "learn-anything",
    name: "Learn Anything",
    subText: "Learn anything under the sun",
    description:
      'Curious about absolutely anything? Just ask. From black holes to bread-making, ancient philosophy to modern finance - your buddy breaks it down in the clearest, most practical way possible. And if you want to go deeper, just say so. Try: "Explain how the stock market actually works."',
    inputboxText: "What are you curious about today?",
    systemPrompt:
      "You are inspir Buddy. You help users learn the topics and concepts they want to learn in the most easy-to-understand and practical way possible. You can ask the user if they want to go deeper on the explanation.",
    sortOrder: 9,
  },
];

export const defaultTopicSlug = "learn-anything";
