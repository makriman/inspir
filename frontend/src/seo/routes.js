import { matchPath } from 'react-router-dom';
import { blogPostBySlug } from './blogPosts';

function faqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Is InspirQuiz free to use?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'InspirQuiz is free to use. You can generate quizzes as a guest, and you can create a free account to save quizzes and track progress.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do I need an account to create a quiz?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'No. You can generate quizzes as a guest. An account is only needed for features that require saving, history, or personalization.',
        },
      },
      {
        '@type': 'Question',
        name: 'What can I upload?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'You can paste text or upload supported note formats (such as TXT and DOCX) to generate more targeted questions from your material.',
        },
      },
      {
        '@type': 'Question',
        name: 'How many questions are generated?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'A standard InspirQuiz quiz contains 10 questions: a mix of multiple choice and open-ended questions designed to test understanding.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I share a quiz with friends or classmates?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. You can generate a shareable link so others can take the same quiz from any device.',
        },
      },
    ],
  };
}

function articleJsonLd({ slug, title, description, lastModified }) {
  const url = `https://quiz.inspir.uk/blog/${slug}`;
  const imageUrl = 'https://quiz.inspir.uk/og-image.jpg';

  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    headline: title,
    description,
    image: [imageUrl],
    dateModified: lastModified,
    author: {
      '@type': 'Organization',
      name: 'InspirQuiz',
      url: 'https://quiz.inspir.uk',
    },
    publisher: {
      '@type': 'Organization',
      name: 'InspirQuiz',
      url: 'https://quiz.inspir.uk',
      logo: {
        '@type': 'ImageObject',
        url: 'https://quiz.inspir.uk/favicon.svg',
      },
    },
  };
}

const STATIC_ROUTES = [
  {
    pattern: '/',
    title: 'Quiz Me On Anything - AI Quiz Generator',
    description:
      'Generate thought‑provoking AI quizzes from any topic or your own notes. Study with active recall and learn faster with InspirQuiz.',
    canonicalPath: '/',
    robots: 'index, follow',
  },
  {
    pattern: '/how-it-works',
    title: 'How It Works',
    description:
      'See how InspirQuiz turns a topic or your notes into a quiz in seconds — and why thought‑provoking questions improve retention.',
    canonicalPath: '/how-it-works',
  },
  {
    pattern: '/quiz',
    title: 'Create a Quiz',
    description:
      'Create a quiz from any topic or upload your notes. Get a mix of multiple choice and open-ended questions designed for active recall.',
    canonicalPath: '/quiz',
  },
  {
    pattern: '/use-cases',
    title: 'Use Cases',
    description:
      'Real ways students, teachers, and self-learners use InspirQuiz for exam prep, lessons, active recall, and long-term retention.',
    canonicalPath: '/use-cases',
  },
  {
    pattern: '/faq',
    title: 'FAQ',
    description: 'Answers to common questions about InspirQuiz, quiz generation, uploading notes, accounts, and sharing.',
    canonicalPath: '/faq',
    jsonLd: faqJsonLd(),
  },
  {
    pattern: '/about',
    title: 'About',
    description:
      'Why InspirQuiz exists: make active recall and good self-testing effortless for students, teachers, and lifelong learners.',
    canonicalPath: '/about',
  },
  {
    pattern: '/blog',
    title: 'Blog',
    description:
      'Evidence-based study strategies, learning science, and practical guides for active recall, exam prep, and studying from notes.',
    canonicalPath: '/blog',
  },
  {
    pattern: '/study-timer',
    title: 'Study Timer',
    description:
      'A simple Pomodoro study timer to stay focused. Pair it with quizzes for active recall sessions that actually build memory.',
    canonicalPath: '/study-timer',
  },
  {
    pattern: '/grade-calculator',
    title: 'Grade Calculator',
    description:
      'Quickly calculate your grades and track performance across assignments. Plan what you need to score to hit your target grade.',
    canonicalPath: '/grade-calculator',
  },
  {
    pattern: '/citations',
    title: 'Citation Generator',
    description:
      'Generate citations in common formats, organize sources, and keep your writing workflow clean without losing track of references.',
    canonicalPath: '/citations',
  },
  {
    pattern: '/cornell-notes',
    title: 'Cornell Notes',
    description:
      'Generate Cornell-style notes from your content to review faster, study actively, and turn summaries into cue-based recall.',
    canonicalPath: '/cornell-notes',
  },
  {
    pattern: '/streaks',
    title: 'Study Streaks',
    description:
      'Build consistent habits with study streak tracking. Make your routine visible and stay motivated across weeks and semesters.',
    canonicalPath: '/streaks',
  },
  {
    pattern: '/doubt',
    title: 'AI Doubt Solver',
    description:
      'Ask questions, upload a problem, and get step-by-step explanations. Use the doubt solver to unblock your learning fast.',
    canonicalPath: '/doubt',
  },
  {
    pattern: '/forum',
    title: 'Student Forum',
    description:
      'Discuss study strategies, ask questions, and learn with others. The InspirQuiz forum is built for students and self-learners.',
    canonicalPath: '/forum',
  },
  { pattern: '/privacy', title: 'Privacy Policy', description: 'How InspirQuiz handles data and privacy.', canonicalPath: '/privacy' },
  { pattern: '/terms', title: 'Terms of Service', description: 'Terms and conditions for using InspirQuiz.', canonicalPath: '/terms' },
  {
    pattern: '/auth',
    title: 'Sign In',
    description: 'Sign in or create an account to save quizzes, track progress, and access personalized features.',
    canonicalPath: '/auth',
    robots: 'noindex, nofollow',
  },
  { pattern: '/dashboard', title: 'Dashboard', canonicalPath: '/dashboard', robots: 'noindex, nofollow' },
  { pattern: '/history', title: 'Quiz History', canonicalPath: '/history', robots: 'noindex, nofollow' },
  { pattern: '/results', title: 'Quiz Results', canonicalPath: '/results', robots: 'noindex, nofollow' },
  { pattern: '/quiz/:quizId/attempts', title: 'Quiz Attempts', robots: 'noindex, nofollow' },
  { pattern: '/quiz/:quizId/review', title: 'Quiz Review', robots: 'noindex, nofollow' },
  { pattern: '/shared/:shareToken', title: 'Shared Quiz', robots: 'noindex, nofollow' },
  { pattern: '/doubt/shared/:shareToken', title: 'Shared Doubt', robots: 'noindex, nofollow' },
];

export function resolveRouteSeo(pathname) {
  const blogMatch = matchPath({ path: '/blog/:slug' }, pathname);
  if (blogMatch?.params?.slug) {
    const post = blogPostBySlug[blogMatch.params.slug];
    if (post) {
      return {
        title: post.title,
        description: post.description,
        canonicalPath: `/blog/${post.slug}`,
        ogType: 'article',
        jsonLd: articleJsonLd(post),
      };
    }
  }

  for (const route of STATIC_ROUTES) {
    const match = matchPath({ path: route.pattern, end: true }, pathname);
    if (match) return route;
  }

  return {
    title: 'Page Not Found',
    description: 'This page does not exist. Explore InspirQuiz to generate quizzes and study smarter with active recall.',
    canonicalPath: pathname,
    robots: 'noindex, follow',
  };
}
