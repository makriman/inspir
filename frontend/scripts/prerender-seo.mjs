import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { blogPosts } from '../src/seo/blogPosts.js';
import { siteConfig } from '../src/seo/siteConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.resolve(__dirname, '..', 'dist');
const baseIndexPath = path.join(distDir, 'index.html');

function toAbsoluteUrl(pathname) {
  return new URL(pathname, siteConfig.baseUrl).toString();
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function replaceOrInsertMeta(html, { name, property }, content) {
  if (!content) return html;
  const escaped = escapeHtml(content);

  if (name) {
    const re = new RegExp(`<meta\\s+name="${name}"\\s+content="[^"]*"\\s*/?>`, 'i');
    if (re.test(html)) return html.replace(re, `<meta name="${name}" content="${escaped}" />`);
    return html.replace('</head>', `  <meta name="${name}" content="${escaped}" />\n</head>`);
  }

  if (property) {
    const re = new RegExp(`<meta\\s+property="${property}"\\s+content="[^"]*"\\s*/?>`, 'i');
    if (re.test(html)) return html.replace(re, `<meta property="${property}" content="${escaped}" />`);
    return html.replace('</head>', `  <meta property="${property}" content="${escaped}" />\n</head>`);
  }

  return html;
}

function replaceCanonical(html, canonicalUrl) {
  const escaped = escapeHtml(canonicalUrl);
  const re = /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i;
  if (re.test(html)) return html.replace(re, `<link rel="canonical" href="${escaped}" />`);
  return html.replace('</head>', `  <link rel="canonical" href="${escaped}" />\n</head>`);
}

function replaceTitle(html, title) {
  const escaped = escapeHtml(title);
  const re = /<title>[^<]*<\/title>/i;
  if (re.test(html)) return html.replace(re, `<title>${escaped}</title>`);
  return html.replace('</head>', `  <title>${escaped}</title>\n</head>`);
}

function addJsonLd(html, jsonLd) {
  if (!jsonLd) return html;
  const blocks = Array.isArray(jsonLd) ? jsonLd : [jsonLd];
  const scripts = blocks
    .map((data) => `  <script type="application/ld+json">${JSON.stringify(data)}</script>`)
    .join('\n');
  return html.replace('</head>', `${scripts}\n</head>`);
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
      name: siteConfig.siteName,
      url: 'https://quiz.inspir.uk',
    },
    publisher: {
      '@type': 'Organization',
      name: siteConfig.siteName,
      url: 'https://quiz.inspir.uk',
      logo: {
        '@type': 'ImageObject',
        url: 'https://quiz.inspir.uk/favicon.svg',
      },
    },
  };
}

function faqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Is inspir free to use?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'inspir is free to use. You can generate quizzes as a guest, and you can create an account to save quizzes and track progress.',
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
        name: 'What can I generate a quiz from?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'You can type a topic, paste text, or upload supported note formats (such as TXT and DOCX). Uploading notes usually produces more targeted questions.',
        },
      },
    ],
  };
}

const staticPages = [
  {
    pathname: '/',
    title: siteConfig.defaultTitle,
    description:
      'Generate AI quizzes from any topic or your notes. Study with active recall using inspir.',
    ogType: 'website',
  },
  {
    pathname: '/quiz',
    title: 'Create a Quiz',
    description:
      'Create a quiz from any topic or upload your notes. Get a mix of multiple choice and open-ended questions designed for active recall.',
    ogType: 'website',
  },
  {
    pathname: '/how-it-works',
    title: 'How It Works',
    description:
      'See how inspir turns a topic or your notes into a quiz in seconds — and why retrieval practice improves retention.',
    ogType: 'website',
  },
  {
    pathname: '/use-cases',
    title: 'Use Cases',
    description:
      'Real ways students, teachers, and self-learners use inspir for exam prep, lessons, active recall, and long-term retention.',
    ogType: 'website',
  },
  {
    pathname: '/faq',
    title: 'FAQ',
    description: 'Answers to common questions about inspir, quiz generation, uploading notes, accounts, and sharing.',
    ogType: 'website',
    jsonLd: faqJsonLd(),
  },
  {
    pathname: '/about',
    title: 'About',
    description:
      'Why inspir exists: make active recall and good self-testing effortless for students, teachers, and lifelong learners.',
    ogType: 'website',
  },
  {
    pathname: '/blog',
    title: 'Blog',
    description:
      'Evidence-based study strategies, learning science, and practical guides for active recall, exam prep, and studying from notes.',
    ogType: 'website',
  },
  {
    pathname: '/study-timer',
    title: 'Study Timer',
    description: 'A simple Pomodoro study timer to stay focused and build better study sessions with active recall.',
    ogType: 'website',
  },
  {
    pathname: '/grade-calculator',
    title: 'Grade Calculator',
    description: 'Calculate grades, run what-if scenarios, and plan what you need to score to hit your target.',
    ogType: 'website',
  },
  {
    pathname: '/citations',
    title: 'Citation Generator',
    description: 'Generate citations in common formats and keep your sources organized while you write.',
    ogType: 'website',
  },
  {
    pathname: '/cornell-notes',
    title: 'Cornell Notes',
    description: 'Create Cornell-style notes to review faster and turn summaries into cue-based recall prompts.',
    ogType: 'website',
  },
  {
    pathname: '/streaks',
    title: 'Study Streaks',
    description: 'Build consistent habits with study streak tracking and motivation.',
    ogType: 'website',
  },
  {
    pathname: '/doubt',
    title: 'AI Doubt Solver',
    description: 'Ask questions, upload a problem, and get step-by-step explanations to unblock your learning.',
    ogType: 'website',
  },
  {
    pathname: '/forum',
    title: 'Student Forum',
    description: 'Discuss study strategies, ask questions, and learn with others in the inspir community.',
    ogType: 'website',
  },
  { pathname: '/privacy', title: 'Privacy Policy', description: 'How inspir handles data and privacy.', ogType: 'website' },
  { pathname: '/terms', title: 'Terms of Service', description: 'Terms and conditions for using inspir.', ogType: 'website' },
];

const blogPages = blogPosts.map((post) => ({
  pathname: `/blog/${post.slug}`,
  title: post.title,
  description: post.description,
  ogType: 'article',
  jsonLd: articleJsonLd(post),
}));

const pages = [...staticPages, ...blogPages];

function buildTitle(pageTitle) {
  if (!pageTitle) return siteConfig.defaultTitle;
  if (pageTitle === siteConfig.defaultTitle) return pageTitle;
  return siteConfig.titleTemplate.replace('%s', pageTitle);
}

function normalizePathname(pathname) {
  if (!pathname.startsWith('/')) return `/${pathname}`;
  return pathname;
}

function distHtmlPathForRoute(pathname) {
  const clean = normalizePathname(pathname);
  if (clean === '/') return baseIndexPath;
  return path.join(distDir, clean, 'index.html');
}

async function ensureDirForFile(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function main() {
  const baseHtml = await fs.readFile(baseIndexPath, 'utf8');

  await Promise.all(
    pages.map(async (page) => {
      const canonicalUrl = toAbsoluteUrl(page.pathname);
      const title = buildTitle(page.title);
      const description = page.description || siteConfig.defaultDescription;
      const imageUrl = toAbsoluteUrl(siteConfig.defaultImagePath);

      let html = baseHtml;
      html = replaceTitle(html, title);
      html = replaceOrInsertMeta(html, { name: 'title' }, title);
      html = replaceOrInsertMeta(html, { name: 'description' }, description);
      html = replaceCanonical(html, canonicalUrl);

      html = replaceOrInsertMeta(html, { property: 'og:type' }, page.ogType || 'website');
      html = replaceOrInsertMeta(html, { property: 'og:url' }, canonicalUrl);
      html = replaceOrInsertMeta(html, { property: 'og:title' }, title);
      html = replaceOrInsertMeta(html, { property: 'og:description' }, description);
      html = replaceOrInsertMeta(html, { property: 'og:image' }, imageUrl);

      html = replaceOrInsertMeta(html, { name: 'twitter:card' }, 'summary_large_image');
      html = replaceOrInsertMeta(html, { name: 'twitter:url' }, canonicalUrl);
      html = replaceOrInsertMeta(html, { name: 'twitter:title' }, title);
      html = replaceOrInsertMeta(html, { name: 'twitter:description' }, description);
      html = replaceOrInsertMeta(html, { name: 'twitter:image' }, imageUrl);

      html = addJsonLd(html, page.jsonLd);

      const outPath = distHtmlPathForRoute(page.pathname);
      await ensureDirForFile(outPath);
      await fs.writeFile(outPath, html, 'utf8');
    })
  );

  // Ensure /blog/ serves /blog/index.html (static hosting friendly)
  await ensureDirForFile(path.join(distDir, 'blog', 'index.html'));
}

main().catch((error) => {
  console.error('[prerender-seo] Failed:', error);
  process.exitCode = 1;
});
