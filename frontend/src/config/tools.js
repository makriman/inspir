// Complete tools configuration for inspir platform
// 66 live tools

export const tools = [
  // ===== LIVE TOOLS =====

  // Quiz & Tests
  {
    id: 'quiz-generator',
    name: 'Quiz Generator',
    icon: '📝',
    description: 'Upload PDFs or text to generate AI-powered quizzes instantly',
    category: 'Active Learning',
    status: 'live',
    route: '/quiz',
    keywords: ['quiz', 'test', 'practice', 'exam', 'questions', 'generate']
  },
  {
    id: 'practice-test-builder',
    name: 'Practice Test Builder',
    icon: '📋',
    description: 'Build custom practice tests from your study materials',
    category: 'Active Learning',
    status: 'live',
    route: '/practice-test-builder',
    keywords: ['practice', 'test', 'exam', 'builder', 'custom']
  },
  {
    id: 'flashcard-creator',
    name: 'Flashcard Creator',
    icon: '🎴',
    description: 'Create and study with AI-generated flashcards',
    category: 'Active Learning',
    status: 'live',
    route: '/flashcards',
    keywords: ['flashcard', 'memorize', 'study', 'cards', 'spaced repetition']
  },
  {
    id: 'fill-blank-generator',
    name: 'Fill-in-the-Blank Generator',
    icon: '✍️',
    description: 'Generate fill-in-the-blank exercises automatically',
    category: 'Active Learning',
    status: 'live',
    route: '/fill-blank',
    keywords: ['fill', 'blank', 'exercise', 'practice']
  },
  {
    id: 'mcq-bank',
    name: 'Multiple Choice Question Bank',
    icon: '✅',
    description: 'Generate unlimited MCQs from your study materials',
    category: 'Active Learning',
    status: 'live',
    route: '/mcq-bank',
    keywords: ['mcq', 'multiple choice', 'questions', 'bank', 'practice']
  },
  {
    id: 'true-false-quiz',
    name: 'True/False Quiz Maker',
    icon: '✔️',
    description: 'Create true/false quizzes from any content',
    category: 'Active Learning',
    status: 'live',
    route: '/true-false',
    keywords: ['true', 'false', 'quiz', 'binary']
  },
  {
    id: 'vocabulary-builder',
    name: 'Vocabulary Builder',
    icon: '📖',
    description: 'Expand your vocabulary with AI-powered learning',
    category: 'Active Learning',
    status: 'live',
    route: '/vocabulary',
    keywords: ['vocabulary', 'words', 'language', 'learn']
  },

  // Visual Learning
  {
    id: 'mind-map',
    name: 'Mind Map Creator',
    icon: '🧩',
    description: 'Create visual mind maps to organize ideas',
    category: 'Visual Learning',
    status: 'live',
    route: '/mind-map',
    keywords: ['mind map', 'visual', 'brainstorm', 'organize']
  },
  {
    id: 'concept-map',
    name: 'Concept Map Builder',
    icon: '🗺️',
    description: 'Build concept maps to connect related ideas',
    category: 'Visual Learning',
    status: 'live',
    route: '/concept-map',
    keywords: ['concept map', 'connect', 'relationship', 'visual']
  },

  // AI Help
  {
    id: 'doubt-solver',
    name: 'Doubt Solver',
    icon: '🤔',
    description: 'Get instant AI-powered help with your doubts and questions',
    category: 'AI Help',
    status: 'live',
    route: '/doubt',
    keywords: ['doubt', 'question', 'help', 'solve', 'problem', 'ai']
  },
  {
    id: 'text-summarizer',
    name: 'Text Summarizer',
    icon: '📑',
    description: 'Summarize long texts into key points',
    category: 'AI Help',
    status: 'live',
    route: '/text-summarizer',
    keywords: ['summarize', 'summary', 'condense', 'shorten']
  },
  {
    id: 'study-guide-gen',
    name: 'Study Guide Generator',
    icon: '📘',
    description: 'Generate comprehensive study guides from notes',
    category: 'AI Help',
    status: 'live',
    route: '/study-guide-gen',
    keywords: ['study guide', 'generate', 'notes', 'summary']
  },
  {
    id: 'math-solver',
    name: 'Math Problem Solver',
    icon: '🔢',
    description: 'Solve math problems with step-by-step solutions',
    category: 'AI Help',
    status: 'live',
    route: '/math-solver',
    keywords: ['math', 'solver', 'calculator', 'equation', 'solution']
  },
  {
    id: 'citation-generator',
    name: 'Citation Generator',
    icon: '📚',
    description: 'Generate citations in APA, MLA, Chicago, and Harvard styles',
    category: 'AI Help',
    status: 'live',
    route: '/citations',
    keywords: ['citation', 'reference', 'apa', 'mla', 'chicago', 'harvard', 'bibliography']
  },
  {
    id: 'essay-assistant',
    name: 'Essay Assistant',
    icon: '✍️',
    description: 'Get AI help with essay outlines, introductions, and conclusions',
    category: 'AI Help',
    status: 'live',
    route: '/essay-assistant',
    keywords: ['essay', 'writing', 'outline', 'introduction']
  },
  {
    id: 'grammar-checker',
    name: 'Grammar Checker',
    icon: '✓',
    description: 'Check and improve your grammar and writing',
    category: 'AI Help',
    status: 'live',
    route: '/grammar-checker',
    keywords: ['grammar', 'spelling', 'writing', 'check']
  },
  {
    id: 'paraphrasing',
    name: 'Paraphrasing Tool',
    icon: '🔄',
    description: 'Rewrite text in different styles',
    category: 'AI Help',
    status: 'live',
    route: '/paraphrasing',
    keywords: ['paraphrase', 'rewrite', 'rephrase']
  },
  {
    id: 'concept-explainer',
    name: 'Concept Explainer',
    icon: '💡',
    description: 'Understand any concept explained at your level',
    category: 'AI Help',
    status: 'live',
    route: '/concept-explainer',
    keywords: ['explain', 'concept', 'understand', 'learn']
  },
  {
    id: 'translator',
    name: 'Translator',
    icon: '🌍',
    description: 'Translate text to multiple languages',
    category: 'AI Help',
    status: 'live',
    route: '/translator',
    keywords: ['translate', 'language', 'foreign']
  },
  {
    id: 'research-finder',
    name: 'Research Finder',
    icon: '🔍',
    description: 'Find academic sources and research for any topic',
    category: 'AI Help',
    status: 'live',
    route: '/research-finder',
    keywords: ['research', 'sources', 'academic', 'find']
  },

  // Focus & Productivity
  {
    id: 'study-timer',
    name: 'Study Timer',
    icon: '⏱️',
    description: 'Focus-optimized Pomodoro timer with custom intervals',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/study-timer',
    keywords: ['timer', 'pomodoro', 'focus', 'productivity', 'session']
  },
  {
    id: 'custom-timer',
    name: 'Custom Study Timer',
    icon: '⏲️',
    description: 'Create personalized study session timers',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/custom-timer',
    keywords: ['timer', 'custom', 'session', 'personalized']
  },
  {
    id: 'task-timer',
    name: 'Task Timer',
    icon: '⌛',
    description: 'Time individual tasks and track completion',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/task-timer',
    keywords: ['task', 'timer', 'productivity', 'time tracking']
  },
  {
    id: 'break-reminder',
    name: 'Break Reminder',
    icon: '🔔',
    description: 'Get reminders to take healthy study breaks',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/break-reminder',
    keywords: ['break', 'reminder', 'health', 'rest']
  },
  {
    id: 'deep-work',
    name: 'Deep Work Sessions',
    icon: '🧠',
    description: 'Structured deep work sessions for maximum productivity',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/deep-work',
    keywords: ['deep work', 'focus', 'productivity', 'concentration']
  },
  {
    id: 'focus-mode',
    name: 'Focus Mode',
    icon: '🎯',
    description: 'Block distractions and stay focused',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/focus-mode',
    keywords: ['focus', 'blocker', 'distraction', 'productivity']
  },
  {
    id: 'focus-music',
    name: 'Focus Music',
    icon: '🎵',
    description: 'Background music for better concentration',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/focus-music',
    keywords: ['music', 'focus', 'concentration', 'background']
  },
  {
    id: 'ambient-sounds',
    name: 'Ambient Sounds',
    icon: '🌧️',
    description: 'Mix ambient sounds for the perfect study atmosphere',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/ambient-sounds',
    keywords: ['ambient', 'sounds', 'rain', 'nature', 'focus']
  },
  {
    id: 'group-timer',
    name: 'Group Study Timer',
    icon: '👥',
    description: 'Synchronized timers for group study sessions',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/group-timer',
    keywords: ['group', 'timer', 'study', 'sync', 'collaboration']
  },
  {
    id: 'session-tracker',
    name: 'Study Session Tracker',
    icon: '📊',
    description: 'Track and analyze your study sessions over time',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/session-tracker',
    keywords: ['session', 'tracker', 'analytics', 'time']
  },

  // Gamification
  {
    id: 'study-streaks',
    name: 'Study Streaks',
    icon: '🔥',
    description: 'Track daily study activity and build consistent habits',
    category: 'Gamification',
    status: 'live',
    route: '/streaks',
    keywords: ['streak', 'habit', 'tracking', 'progress', 'daily', 'gamification']
  },
  {
    id: 'daily-goals',
    name: 'Daily Goals',
    icon: '🎯',
    description: 'Set and track daily study goals',
    category: 'Gamification',
    status: 'live',
    route: '/daily-goals',
    keywords: ['goals', 'daily', 'targets', 'objectives']
  },
  {
    id: 'habit-tracker',
    name: 'Habit Tracker',
    icon: '📅',
    description: 'Build consistent study habits with tracking',
    category: 'Gamification',
    status: 'live',
    route: '/habit-tracker',
    keywords: ['habit', 'tracker', 'consistency', 'routine']
  },
  {
    id: 'xp-leveling',
    name: 'XP & Leveling',
    icon: '⭐',
    description: 'Earn XP and level up as you study',
    category: 'Gamification',
    status: 'live',
    route: '/xp-leveling',
    keywords: ['xp', 'experience', 'level', 'gamification']
  },
  {
    id: 'badges',
    name: 'Badges',
    icon: '🏅',
    description: 'Earn badges for achievements',
    category: 'Gamification',
    status: 'live',
    route: '/badges',
    keywords: ['badges', 'achievements', 'rewards']
  },
  {
    id: 'leaderboards',
    name: 'Leaderboards',
    icon: '🏆',
    description: 'Compete with other students',
    category: 'Gamification',
    status: 'live',
    route: '/leaderboards',
    keywords: ['leaderboard', 'ranking', 'compete']
  },
  {
    id: 'challenges',
    name: 'Challenges',
    icon: '⚔️',
    description: 'Complete challenges for rewards',
    category: 'Gamification',
    status: 'live',
    route: '/challenges',
    keywords: ['challenge', 'goals', 'rewards']
  },
  {
    id: 'milestones',
    name: 'Milestones',
    icon: '🏅',
    description: 'Track your learning journey milestones',
    category: 'Gamification',
    status: 'live',
    route: '/milestones',
    keywords: ['milestone', 'progress', 'journey']
  },

  // Organization
  {
    id: 'cornell-notes',
    name: 'Cornell Notes',
    icon: '📝',
    description: 'Take structured notes with the Cornell note-taking system',
    category: 'Organization',
    status: 'live',
    route: '/cornell-notes',
    keywords: ['notes', 'cornell', 'note-taking', 'organize', 'pdf', 'export']
  },
  {
    id: 'grade-calculator',
    name: 'Grade Calculator',
    icon: '🎓',
    description: 'Calculate grades, predict scores, and plan your semester',
    category: 'Organization',
    status: 'live',
    route: '/grade-calculator',
    keywords: ['grade', 'calculator', 'gpa', 'score', 'predict', 'semester']
  },
  {
    id: 'note-organizer',
    name: 'Note Organizer',
    icon: '📁',
    description: 'Organize notes into folders and categories',
    category: 'Organization',
    status: 'live',
    route: '/note-organizer',
    keywords: ['notes', 'organize', 'folders', 'categories']
  },
  {
    id: 'study-planner',
    name: 'Study Planner',
    icon: '📅',
    description: 'Plan and schedule your study sessions',
    category: 'Organization',
    status: 'live',
    route: '/study-planner',
    keywords: ['planner', 'schedule', 'calendar', 'organize']
  },
  {
    id: 'assignment-tracker',
    name: 'Assignment Tracker',
    icon: '📋',
    description: 'Track assignments with due dates and priorities',
    category: 'Organization',
    status: 'live',
    route: '/assignment-tracker',
    keywords: ['assignment', 'tracker', 'due date', 'homework']
  },
  {
    id: 'gpa-tracker',
    name: 'GPA Tracker',
    icon: '📊',
    description: 'Track and calculate your GPA',
    category: 'Organization',
    status: 'live',
    route: '/gpa-tracker',
    keywords: ['gpa', 'grades', 'tracker', 'academic']
  },
  {
    id: 'course-manager',
    name: 'Course Manager',
    icon: '📚',
    description: 'Manage your courses and schedules',
    category: 'Organization',
    status: 'live',
    route: '/course-manager',
    keywords: ['course', 'manage', 'schedule', 'class']
  },
  {
    id: 'schedule-builder',
    name: 'Schedule Builder',
    icon: '📆',
    description: 'Build your weekly study schedule',
    category: 'Organization',
    status: 'live',
    route: '/schedule-builder',
    keywords: ['schedule', 'builder', 'weekly', 'timetable']
  },

  // Analytics
  {
    id: 'progress-dashboard',
    name: 'Progress Dashboard',
    icon: '📈',
    description: 'View your study progress and statistics',
    category: 'Analytics',
    status: 'live',
    route: '/progress-dashboard',
    keywords: ['progress', 'dashboard', 'stats', 'analytics']
  },

  // Social
  {
    id: 'student-forum',
    name: 'Student Forum',
    icon: '💭',
    description: 'Connect with students, share resources, ask questions',
    category: 'Social',
    status: 'live',
    route: '/forum',
    keywords: ['forum', 'community', 'discussion', 'students', 'questions']
  },
  {
    id: 'study-groups',
    name: 'Study Groups',
    icon: '👥',
    description: 'Create and join study groups',
    category: 'Social',
    status: 'live',
    route: '/study-groups',
    keywords: ['groups', 'study', 'collaborate', 'team']
  },
  {
    id: 'resource-sharing',
    name: 'Resource Sharing',
    icon: '📤',
    description: 'Share and discover study resources',
    category: 'Social',
    status: 'live',
    route: '/resource-sharing',
    keywords: ['share', 'resources', 'materials', 'download']
  }
];

export const getToolsByCategory = () => {
  const categories = {};
  tools.forEach(tool => {
    if (!categories[tool.category]) {
      categories[tool.category] = [];
    }
    categories[tool.category].push(tool);
  });
  return categories;
};

export const getLiveTools = () => tools.filter(t => t.status === 'live');
export const getComingSoonTools = () => tools.filter(t => t.status === 'coming-soon');

export const searchTools = (query) => {
  const q = query.toLowerCase();
  return tools.filter(tool =>
    tool.name.toLowerCase().includes(q) ||
    tool.description.toLowerCase().includes(q) ||
    tool.keywords.some(k => k.toLowerCase().includes(q))
  );
};
