import { matchPath } from 'react-router-dom';
import { blogPostBySlug } from './blogPosts';

function faqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is inspir?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'inspir is an AI-powered study toolkit with quizzes, step-by-step explanations, Cornell notes, citations, focus tools, and progress tracking.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is inspir free?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'inspir is currently free to use. You can try tools as a guest and create an account to save work and access account-based features.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do I need an account?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'No. Guest mode is available for quick sessions. Create an account if you want saved items, history, or tools that require a signed-in session.',
        },
      },
      {
        '@type': 'Question',
        name: 'What can I generate a quiz from?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'You can type a topic, paste text, or upload supported note formats (such as TXT and DOCX). Uploading notes usually produces more targeted questions.',
        },
      },
      {
        '@type': 'Question',
        name: 'Can I share quizzes or explanations?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. inspir supports shareable links so you can send a quiz or a shared doubt/explanation to classmates or friends.',
        },
      },
      {
        '@type': 'Question',
        name: 'How accurate is the AI?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'AI can make mistakes. Use inspir as a study accelerator, not a single source of truth. When it matters, verify against your course materials or reputable sources.',
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
      name: 'inspir',
      url: 'https://quiz.inspir.uk',
    },
    publisher: {
      '@type': 'Organization',
      name: 'inspir',
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
    title: 'AI Study Toolkit for Students',
    description:
      'An AI-powered study toolkit: quizzes, step-by-step explanations, Cornell notes, citations, timers, streaks, and a student forum — in one place.',
    canonicalPath: '/',
    robots: 'index, follow',
  },
  {
    pattern: '/how-it-works',
    title: 'How It Works',
    description:
      'Learn the inspir workflow: focus → learn → test yourself → fix gaps. See how the toolkit supports active learning and better retention.',
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
      'Real workflows for students, teachers, and self-learners: exam prep, clarification, revision systems, writing, focus sessions, and progress tracking.',
    canonicalPath: '/use-cases',
  },
  {
    pattern: '/faq',
    title: 'FAQ',
    description: 'Answers to common questions about inspir: the study toolkit, pricing, accounts, sharing, AI accuracy, and privacy.',
    canonicalPath: '/faq',
    jsonLd: faqJsonLd(),
  },
  {
    pattern: '/about',
    title: 'About',
    description:
      'inspir started as a quiz generator. Now it’s an AI study toolkit built around active learning: practice, clarity, focus, and consistency.',
    canonicalPath: '/about',
  },
  {
    pattern: '/blog',
    title: 'Blog',
    description:
      'Evidence-based study strategies, learning science, and practical workflows for active learning with inspir.',
    canonicalPath: '/blog',
  },
  {
    pattern: '/study-timer',
    title: 'Study Timer',
    description:
      'A simple Pomodoro-style study timer to stay focused. Pair it with quizzes and explanations to build a repeatable learning loop.',
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
      'Discuss study strategies, ask questions, and learn with others. The inspir forum is built for students and self-learners.',
    canonicalPath: '/forum',
  },
  { pattern: '/privacy', title: 'Privacy Policy', description: 'How inspir handles data and privacy.', canonicalPath: '/privacy' },
  { pattern: '/terms', title: 'Terms of Service', description: 'Terms and conditions for using inspir.', canonicalPath: '/terms' },
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
  { pattern: '/chat', title: 'AI Chat', canonicalPath: '/chat', robots: 'noindex, nofollow' },
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
    description: 'This page does not exist. Explore inspir to build your study system with quizzes, explanations, focus tools, and more.',
    canonicalPath: pathname,
    robots: 'noindex, follow',
  };
}
