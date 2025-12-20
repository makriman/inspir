// Complete tools configuration for inspir platform
// 25 live tools + 41 coming soon tools = 66 total

export const tools = [
  // ===== LIVE TOOLS (25) =====
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
    id: 'study-streaks',
    name: 'Study Streaks',
    icon: '🔥',
    description: 'Track daily study activity and build consistent habits',
    category: 'Analytics',
    status: 'live',
    route: '/streaks',
    keywords: ['streak', 'habit', 'tracking', 'progress', 'daily', 'gamification']
  },
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

  // ===== COMING SOON TOOLS (41) =====

  // Active Learning (7 tools)
  {
    id: 'fill-blank-generator',
    name: 'Fill-in-the-Blank Generator',
    icon: '✍️',
    description: 'Generate fill-in-the-blank exercises automatically',
    category: 'Active Learning',
    status: 'live',
    route: '/worksheets/fill-blank-generator',
    keywords: ['fill', 'blank', 'exercise', 'practice']
  },
  {
    id: 'mcq-bank',
    name: 'Multiple Choice Question Bank',
    icon: '✅',
    description: 'Access thousands of practice MCQs organized by topic',
    category: 'Active Learning',
    status: 'live',
    route: '/worksheets/mcq-bank',
    keywords: ['mcq', 'multiple choice', 'questions', 'bank', 'practice']
  },
  {
    id: 'essay-question-generator',
    name: 'Essay Question Generator',
    icon: '📄',
    description: 'Generate thought-provoking essay questions for practice',
    category: 'Active Learning',
    status: 'live',
    route: '/worksheets/essay-question-generator',
    keywords: ['essay', 'question', 'writing', 'practice']
  },
  {
    id: 'vocabulary-builder',
    name: 'Vocabulary Builder',
    icon: '📖',
    description: 'Expand your vocabulary with contextual learning',
    category: 'Active Learning',
    status: 'live',
    route: '/worksheets/vocabulary-builder',
    keywords: ['vocabulary', 'words', 'language', 'learn']
  },
  {
    id: 'true-false-quiz',
    name: 'True/False Quiz Maker',
    icon: '✔️',
    description: 'Create true/false quizzes from any content',
    category: 'Active Learning',
    status: 'live',
    route: '/worksheets/true-false-quiz',
    keywords: ['true', 'false', 'quiz', 'binary']
  },
  {
    id: 'matching-game',
    name: 'Matching Game Generator',
    icon: '🎯',
    description: 'Turn your notes into interactive matching games',
    category: 'Active Learning',
    status: 'live',
    route: '/worksheets/matching-game',
    keywords: ['matching', 'game', 'interactive', 'pairs']
  },
  {
    id: 'diagram-labeling',
    name: 'Diagram Labeling Practice',
    icon: '🔬',
    description: 'Practice labeling diagrams for science and anatomy',
    category: 'Active Learning',
    status: 'live',
    route: '/worksheets/diagram-labeling',
    keywords: ['diagram', 'label', 'science', 'anatomy', 'visual']
  },

  // Focus & Productivity (9 tools)
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
    id: 'session-tracker',
    name: 'Study Session Tracker',
    icon: '📊',
    description: 'Track and analyze your study sessions over time',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/session-tracker',
    keywords: ['session', 'tracker', 'analytics', 'time']
  },
  {
    id: 'focus-mode',
    name: 'Focus Mode / Website Blocker',
    icon: '🚫',
    description: 'Block distracting websites during study sessions',
    category: 'Focus & Productivity',
    status: 'live',
    route: '/focus-mode',
    keywords: ['focus', 'blocker', 'distraction', 'productivity']
  },
  {
    id: 'task-timer',
    name: 'Task Timer',
    icon: '⌛',
    description: 'Time individual tasks and track completion',
    category: 'Focus & Productivity',
    status: 'coming-soon',
    route: null,
    keywords: ['task', 'timer', 'productivity', 'time tracking']
  },
  {
    id: 'break-reminder',
    name: 'Break Reminder',
    icon: '🔔',
    description: 'Get reminders to take healthy study breaks',
    category: 'Focus & Productivity',
    status: 'coming-soon',
    route: null,
    keywords: ['break', 'reminder', 'health', 'rest']
  },
  {
    id: 'deep-work',
    name: 'Deep Work Sessions',
    icon: '🧠',
    description: 'Structured deep work sessions for maximum productivity',
    category: 'Focus & Productivity',
    status: 'coming-soon',
    route: null,
    keywords: ['deep work', 'focus', 'productivity', 'concentration']
  },
  {
    id: 'group-timer',
    name: 'Group Study Timer',
    icon: '👥',
    description: 'Synchronized timers for group study sessions',
    category: 'Focus & Productivity',
    status: 'coming-soon',
    route: null,
    keywords: ['group', 'timer', 'study', 'sync', 'collaboration']
  },
  {
    id: 'focus-music',
    name: 'Music for Focus',
    icon: '🎵',
    description: 'Curated playlists designed to enhance concentration',
    category: 'Focus & Productivity',
    status: 'coming-soon',
    route: null,
    keywords: ['music', 'focus', 'concentration', 'playlist']
  },
  {
    id: 'ambient-sounds',
    name: 'Ambient Sounds Generator',
    icon: '🌧️',
    description: 'Generate ambient sounds for better focus',
    category: 'Focus & Productivity',
    status: 'coming-soon',
    route: null,
    keywords: ['ambient', 'sounds', 'white noise', 'focus']
  },

  // Gamification (8 tools)
  {
    id: 'daily-goals',
    name: 'Daily Study Goals',
    icon: '🎯',
    description: 'Set and track daily study goals',
    category: 'Gamification',
    status: 'coming-soon',
    route: null,
    keywords: ['goals', 'daily', 'targets', 'tracking']
  },
  {
    id: 'xp-leveling',
    name: 'XP & Leveling System',
    icon: '⭐',
    description: 'Earn XP and level up as you study',
    category: 'Gamification',
    status: 'coming-soon',
    route: null,
    keywords: ['xp', 'level', 'experience', 'gamification']
  },
  {
    id: 'badges',
    name: 'Badges & Achievements',
    icon: '🏆',
    description: 'Unlock badges for reaching milestones',
    category: 'Gamification',
    status: 'coming-soon',
    route: null,
    keywords: ['badge', 'achievement', 'unlock', 'reward']
  },
  {
    id: 'leaderboards',
    name: 'Leaderboards',
    icon: '📈',
    description: 'Compete with friends on study leaderboards',
    category: 'Gamification',
    status: 'coming-soon',
    route: null,
    keywords: ['leaderboard', 'compete', 'ranking', 'competition']
  },
  {
    id: 'challenges',
    name: 'Study Challenges',
    icon: '🎲',
    description: 'Join weekly study challenges and competitions',
    category: 'Gamification',
    status: 'coming-soon',
    route: null,
    keywords: ['challenge', 'competition', 'weekly', 'contest']
  },
  {
    id: 'progress-viz',
    name: 'Progress Visualization',
    icon: '📊',
    description: 'Visualize your study progress with beautiful charts',
    category: 'Gamification',
    status: 'coming-soon',
    route: null,
    keywords: ['progress', 'visualization', 'charts', 'graphs']
  },
  {
    id: 'milestones',
    name: 'Milestone Celebrations',
    icon: '🎉',
    description: 'Celebrate when you hit major study milestones',
    category: 'Gamification',
    status: 'coming-soon',
    route: null,
    keywords: ['milestone', 'celebration', 'achievement', 'reward']
  },
  {
    id: 'accountability',
    name: 'Accountability Partner',
    icon: '🤝',
    description: 'Partner with friends for mutual accountability',
    category: 'Gamification',
    status: 'coming-soon',
    route: null,
    keywords: ['accountability', 'partner', 'motivation', 'support']
  },

  // AI Writing & Help (10 tools)
  {
    id: 'essay-assistant',
    name: 'Essay Writing Assistant',
    icon: '✏️',
    description: 'Get AI help with essay structure and writing',
    category: 'AI Help',
    status: 'coming-soon',
    route: null,
    keywords: ['essay', 'writing', 'assistant', 'ai', 'help']
  },
  {
    id: 'grammar-checker',
    name: 'Grammar & Style Checker',
    icon: '✨',
    description: 'Check grammar, style, and improve your writing',
    category: 'AI Help',
    status: 'coming-soon',
    route: null,
    keywords: ['grammar', 'style', 'writing', 'check', 'improve']
  },
  {
    id: 'paraphrasing',
    name: 'Paraphrasing Tool',
    icon: '🔄',
    description: 'Rephrase text while maintaining meaning',
    category: 'AI Help',
    status: 'coming-soon',
    route: null,
    keywords: ['paraphrase', 'rephrase', 'rewrite', 'text']
  },
  {
    id: 'concept-explainer',
    name: 'Concept Explainer',
    icon: '💡',
    description: 'Get simple explanations for complex concepts',
    category: 'AI Help',
    status: 'coming-soon',
    route: null,
    keywords: ['concept', 'explain', 'simplify', 'understand']
  },
  {
    id: 'code-debugger',
    name: 'Code Debugger',
    icon: '💻',
    description: 'Debug code and get programming help',
    category: 'AI Help',
    status: 'coming-soon',
    route: null,
    keywords: ['code', 'debug', 'programming', 'fix', 'error']
  },
  {
    id: 'translator',
    name: 'Language Translator',
    icon: '🌐',
    description: 'Translate text between multiple languages',
    category: 'AI Help',
    status: 'coming-soon',
    route: null,
    keywords: ['translate', 'language', 'translation', 'multilingual']
  },
  {
    id: 'research-finder',
    name: 'Research Paper Finder',
    icon: '🔍',
    description: 'Find academic papers and research sources',
    category: 'AI Help',
    status: 'coming-soon',
    route: null,
    keywords: ['research', 'paper', 'academic', 'source', 'find']
  },

  // Organization (6 tools)
  {
    id: 'note-organizer',
    name: 'Note Organizer/Tagging',
    icon: '🏷️',
    description: 'Organize notes with tags and folders',
    category: 'Organization',
    status: 'coming-soon',
    route: null,
    keywords: ['organize', 'tags', 'folders', 'notes', 'categorize']
  },
  {
    id: 'study-planner',
    name: 'Study Planner/Calendar',
    icon: '📅',
    description: 'Plan your study schedule with an interactive calendar',
    category: 'Organization',
    status: 'coming-soon',
    route: null,
    keywords: ['planner', 'calendar', 'schedule', 'plan', 'organize']
  },
  {
    id: 'course-manager',
    name: 'Course Manager',
    icon: '📚',
    description: 'Manage all your courses and subjects in one place',
    category: 'Organization',
    status: 'coming-soon',
    route: null,
    keywords: ['course', 'manage', 'subject', 'organize', 'track']
  },
  {
    id: 'assignment-tracker',
    name: 'Assignment Tracker',
    icon: '📝',
    description: 'Track assignments, deadlines, and submissions',
    category: 'Organization',
    status: 'coming-soon',
    route: null,
    keywords: ['assignment', 'deadline', 'tracker', 'homework', 'due']
  },
  {
    id: 'gpa-tracker',
    name: 'GPA Tracker',
    icon: '📊',
    description: 'Track your GPA across semesters',
    category: 'Organization',
    status: 'coming-soon',
    route: null,
    keywords: ['gpa', 'tracker', 'grades', 'semester', 'average']
  },
  {
    id: 'schedule-builder',
    name: 'Study Schedule Builder',
    icon: '🗓️',
    description: 'Build optimized study schedules based on your needs',
    category: 'Organization',
    status: 'coming-soon',
    route: null,
    keywords: ['schedule', 'builder', 'plan', 'optimize', 'timetable']
  },

  // Visual Learning (3 tools)
  {
    id: 'infographic',
    name: 'Infographic Generator',
    icon: '📊',
    description: 'Turn data into beautiful infographics',
    category: 'Visual Learning',
    status: 'coming-soon',
    route: null,
    keywords: ['infographic', 'visual', 'data', 'chart', 'graphic']
  },
  {
    id: 'timeline',
    name: 'Timeline Creator',
    icon: '⏳',
    description: 'Create interactive timelines for history and events',
    category: 'Visual Learning',
    status: 'coming-soon',
    route: null,
    keywords: ['timeline', 'history', 'events', 'chronology', 'visual']
  },
  {
    id: 'diagram-maker',
    name: 'Diagram Maker',
    icon: '📐',
    description: 'Create diagrams and flowcharts easily',
    category: 'Visual Learning',
    status: 'coming-soon',
    route: null,
    keywords: ['diagram', 'flowchart', 'visual', 'create', 'draw']
  },

  // Social & Collaboration (5 tools)
  {
    id: 'study-groups',
    name: 'Study Groups/Rooms',
    icon: '🏠',
    description: 'Create or join virtual study groups',
    category: 'Social',
    status: 'coming-soon',
    route: null,
    keywords: ['group', 'room', 'study', 'collaborate', 'virtual']
  },
  {
    id: 'advanced-forum',
    name: 'Question Forum (Advanced)',
    icon: '❓',
    description: 'Advanced Q&A platform with voting and best answers',
    category: 'Social',
    status: 'coming-soon',
    route: null,
    keywords: ['forum', 'question', 'answer', 'community', 'vote']
  },
  {
    id: 'resource-sharing',
    name: 'Resource Sharing',
    icon: '📤',
    description: 'Share and discover study resources',
    category: 'Social',
    status: 'coming-soon',
    route: null,
    keywords: ['share', 'resource', 'materials', 'community', 'discover']
  },
  {
    id: 'peer-review',
    name: 'Peer Review',
    icon: '👀',
    description: 'Get feedback from peers on your work',
    category: 'Social',
    status: 'coming-soon',
    route: null,
    keywords: ['peer', 'review', 'feedback', 'critique', 'improve']
  },
  {
    id: 'study-buddy',
    name: 'Study Buddy Matching',
    icon: '🤝',
    description: 'Find study partners with similar goals',
    category: 'Social',
    status: 'coming-soon',
    route: null,
    keywords: ['buddy', 'partner', 'match', 'study', 'friend']
  },

  // Analytics (6 tools including habit tracker)
  {
    id: 'habit-tracker',
    name: 'Habit Tracker',
    icon: '✅',
    description: 'Track and build positive study habits',
    category: 'Analytics',
    status: 'coming-soon',
    route: null,
    keywords: ['habit', 'tracker', 'routine', 'consistency', 'build']
  },
  {
    id: 'progress-dashboard',
    name: 'Progress Dashboard',
    icon: '📊',
    description: 'Comprehensive dashboard of all your progress',
    category: 'Analytics',
    status: 'coming-soon',
    route: null,
    keywords: ['dashboard', 'progress', 'overview', 'analytics', 'stats']
  },
  {
    id: 'time-analytics',
    name: 'Study Time Analytics',
    icon: '⏱️',
    description: 'Detailed analytics on how you spend study time',
    category: 'Analytics',
    status: 'coming-soon',
    route: null,
    keywords: ['time', 'analytics', 'tracking', 'study', 'analysis']
  },
  {
    id: 'performance-tracking',
    name: 'Performance Tracking',
    icon: '📈',
    description: 'Track performance across all tools and subjects',
    category: 'Analytics',
    status: 'coming-soon',
    route: null,
    keywords: ['performance', 'tracking', 'progress', 'improvement', 'scores']
  },
  {
    id: 'strengths-weaknesses',
    name: 'Strengths/Weaknesses Analysis',
    icon: '🎯',
    description: 'AI-powered analysis of your strengths and weaknesses',
    category: 'Analytics',
    status: 'coming-soon',
    route: null,
    keywords: ['strength', 'weakness', 'analysis', 'improve', 'ai']
  },
  {
    id: 'weekly-reports',
    name: 'Weekly/Monthly Reports',
    icon: '📋',
    description: 'Automated progress reports delivered to your inbox',
    category: 'Analytics',
    status: 'coming-soon',
    route: null,
    keywords: ['report', 'weekly', 'monthly', 'progress', 'summary']
  }
];

export const categories = [
  'All',
  'Active Learning',
  'Focus & Productivity',
  'Gamification',
  'AI Help',
  'Organization',
  'Visual Learning',
  'Social',
  'Analytics'
];

// Helper functions
export const getLiveTools = () => tools.filter(tool => tool.status === 'live');
export const getComingSoonTools = () => tools.filter(tool => tool.status === 'coming-soon');
export const getToolsByCategory = (category) => {
  if (category === 'All') return tools;
  return tools.filter(tool => tool.category === category);
};

export const searchTools = (query) => {
  if (!query || query.trim() === '') return tools;

  const lowerQuery = query.toLowerCase();
  return tools.filter(tool =>
    tool.name.toLowerCase().includes(lowerQuery) ||
    tool.description.toLowerCase().includes(lowerQuery) ||
    tool.keywords.some(keyword => keyword.toLowerCase().includes(lowerQuery)) ||
    tool.category.toLowerCase().includes(lowerQuery)
  ).sort((a, b) => {
    // Prioritize live tools
    if (a.status === 'live' && b.status !== 'live') return -1;
    if (a.status !== 'live' && b.status === 'live') return 1;

    // Then sort by name match
    const aNameMatch = a.name.toLowerCase().includes(lowerQuery);
    const bNameMatch = b.name.toLowerCase().includes(lowerQuery);
    if (aNameMatch && !bNameMatch) return -1;
    if (!aNameMatch && bNameMatch) return 1;

    return 0;
  });
};

export const getToolById = (id) => tools.find(tool => tool.id === id);
