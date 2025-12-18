// Content hub architecture for internal linking and SEO
export const contentHubs = {
  'active-learning': {
    name: 'Active Learning',
    pillarSlug: 'science-active-recall',
    posts: [
      'active-recall-learning',
      'spaced-repetition-schedule',
      'science-active-recall',
      'effective-study-quizzes',
      'vs-traditional-flashcards',
    ],
    relatedTools: ['/quiz', '/doubt', '/study-timer'],
  },
  'exam-prep': {
    name: 'Exam Preparation',
    pillarSlug: 'students-exam-prep',
    posts: [
      'students-exam-prep',
      'finals-study-plan',
      'certification-exam-prep',
      'quiz-yourself-quickly',
      'medical-students-guide',
      'law-school-study',
    ],
    relatedTools: ['/quiz', '/cornell-notes', '/study-timer'],
  },
  'study-systems': {
    name: 'Study Systems',
    pillarSlug: 'ai-study-toolkit',
    posts: [
      'ai-study-toolkit',
      'study-streaks-habits',
      'study-smarter-notes',
      'self-directed-learning',
      'pomodoro-active-recall',
    ],
    relatedTools: ['/streaks', '/study-timer', '/cornell-notes'],
  },
  'tools-methods': {
    name: 'Study Tools & Methods',
    pillarSlug: 'cornell-notes-method',
    posts: [
      'cornell-notes-method',
      'pomodoro-active-recall',
      'quiz-yourself-quickly',
      'study-from-notes-ai-quiz',
      'ai-study-doubt-solver',
    ],
    relatedTools: ['/cornell-notes', '/study-timer', '/doubt'],
  },
  'professional-learning': {
    name: 'Professional Learning',
    pillarSlug: 'professional-training',
    posts: [
      'professional-training',
      'corporate-training',
      'certification-exam-prep',
      'self-directed-learning',
    ],
    relatedTools: ['/quiz', '/citations', '/study-timer'],
  },
  'teaching': {
    name: 'For Teachers',
    pillarSlug: 'teachers-lesson-plans',
    posts: [
      'teachers-lesson-plans',
      'better-mcq-questions',
      'homeschool-assessments',
      'study-groups-collaboration',
    ],
    relatedTools: ['/quiz', '/forum'],
  },
  'specialized': {
    name: 'Specialized Study',
    pillarSlug: 'medical-students-guide',
    posts: [
      'medical-students-guide',
      'law-school-study',
      'language-learning',
      'research-paper-quizzes',
      'textbook-quizzes',
    ],
    relatedTools: ['/quiz', '/doubt', '/cornell-notes'],
  },
};

// Get related posts for a given blog slug
export function getRelatedPosts(currentSlug, limit = 3) {
  // Find hub containing current post
  const hub = Object.values(contentHubs).find((h) =>
    h.posts.includes(currentSlug)
  );

  if (!hub) {
    // If not in a hub, return empty array
    return [];
  }

  // Return other posts from same hub
  return hub.posts
    .filter((slug) => slug !== currentSlug)
    .slice(0, limit);
}

// Get hub for a given post
export function getPostHub(slug) {
  const hubEntry = Object.entries(contentHubs).find(([_, hub]) =>
    hub.posts.includes(slug)
  );
  return hubEntry ? hubEntry[1] : null;
}

// Get all posts in a hub
export function getHubPosts(hubKey) {
  return contentHubs[hubKey]?.posts || [];
}
