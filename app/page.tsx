import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  Code2,
  CornerDownRight,
  GraduationCap,
  HeartHandshake,
  LibraryBig,
  Route,
  School,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingHeroVideo,
  missionImages,
} from "@/components/marketing/MarketingShell";
import { getBlogPosts } from "@/lib/content/blog";
import {
  homepageFaqs,
  homepageFilm,
  homepageHeroRoutes,
  homepageLearningPaths,
  learningPathHref,
} from "@/lib/content/landing";
import { getSubjectPages, subjectPath } from "@/lib/content/subjects";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import {
  faqPageJsonLd,
  itemListJsonLd,
  serializeJsonLd,
  videoObjectJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

export const metadata: Metadata = {
  title: "Free AI learning for everyone",
  description:
    "Learn with a free AI tutor for explanations, Socratic questions, homework coaching, quizzes, flashcards, debate, writing feedback, coding help, and study planning.",
  alternates: metadataAlternates("/"),
  openGraph: {
    title: "Free AI learning for everyone | inspir",
    description:
      "A free public AI learning companion for tutoring, practice, quizzes, flashcards, debate, writing feedback, coding help, and study planning.",
    url: "/",
    siteName,
    images: [
      socialImage({
        title: "Free AI learning for everyone",
        eyebrow: "Start learning",
        description:
          "Explanations, Socratic tutoring, homework coaching, quizzes, flashcards, writing, code, debate, and study planning.",
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free AI learning for everyone | inspir",
    description:
      "A free public AI learning companion for tutoring, practice, quizzes, flashcards, debate, writing feedback, coding help, and study planning.",
    images: [
      socialImage({
        title: "Free AI learning for everyone",
        eyebrow: "Start learning",
        description:
          "Explanations, Socratic tutoring, homework coaching, quizzes, flashcards, writing, code, debate, and study planning.",
      }).url,
    ],
  },
};

const modes = [
  {
    icon: BookOpenCheck,
    title: "Clear explanations",
    text: "Start from the thing you do not understand and get a plain-language model, examples, and next steps.",
  },
  {
    icon: BrainCircuit,
    title: "Active practice",
    text: "Move into Socratic questions, quizzes, flashcards, debate, role-play, and guided instruction.",
  },
  {
    icon: GraduationCap,
    title: "Learner-first support",
    text: "Ask for hints, checks, feedback, and study plans that keep the thinking with the learner.",
  },
  {
    icon: HeartHandshake,
    title: "Open by design",
    text: "Use public guest modes for free, then explore the open-source work and school deployment paths.",
  },
] as const;

const trustSignals = [
  {
    icon: Sparkles,
    title: "Free guest learning",
    text: "Open a mode and start immediately, with no account needed for the public guest experience.",
  },
  {
    icon: ShieldCheck,
    title: "Trust boundaries",
    text: "Public learning pages are crawlable; private saved chats, accounts, admin tools, and user data are not discovery surfaces.",
  },
  {
    icon: LibraryBig,
    title: "Citable content engine",
    text: "Every guide, path, subject hub, and prompt route is connected so learners and AI systems can understand the map.",
  },
  {
    icon: Waypoints,
    title: "Action after reading",
    text: "Pages are designed to move people from explanation into a live mode, prompt, quiz, or review loop.",
  },
] as const;

const learningJourney = [
  {
    step: "01",
    title: "Ask the real question",
    text: "Start with a topic, assignment, draft, exam, or idea in the mode that fits the job.",
    href: "/chat/learn-anything",
  },
  {
    step: "02",
    title: "Do something with it",
    text: "Answer a check question, try a step, debate a claim, revise a draft, or build recall cards.",
    href: "/ai-learning-map",
  },
  {
    step: "03",
    title: "Keep the route alive",
    text: "Use the linked guide, prompt, subject hub, or learning path to review the weak spot later.",
    href: "/blog",
  },
] as const;

const repos = [
  {
    href: "https://github.com/makriman/inspir",
    title: "makriman/inspir",
    text: "The current inspirlearning.com rebuild.",
  },
  {
    href: "https://github.com/makriman/ai-study-platform",
    title: "makriman/ai-study-platform",
    text: "The next-generation AI study platform.",
  },
  {
    href: "https://github.com/makriman/inspir-platform",
    title: "makriman/inspir-platform",
    text: "The broader open-source inspir platform.",
  },
] as const;

const priorityTopicSlugs = [
  "learn-anything",
  "socratic-instruction",
  "homework-coach",
  "math-step-coach",
  "writing-coach",
  "code-tutor",
  "quiz-me-on-trivia",
  "flashcard-builder",
  "time-travel",
  "talk-to-a-historical-person",
  "debate-any-topic",
  "exam-prep-planner",
] as const;

export default function LandingPage() {
  const priorityTopics = priorityTopicSlugs
    .map((slug) => topicSeeds.find((topic) => topic.slug === slug))
    .filter((topic): topic is (typeof topicSeeds)[number] => Boolean(topic));
  const subjectPages = getSubjectPages();
  const posts = getBlogPosts();
  const featuredPosts = posts.slice(0, 6);
  const proofStats = [
    [`${topicSeeds.length}`, "public AI learning modes"],
    [`${posts.length}`, "guides in the crawlable content engine"],
    [`${subjectPages.length}`, "subject hubs mapped to learner intent"],
  ] as const;
  const jsonLd = [
    webPageJsonLd({
      path: "/",
      name: "Free AI learning for everyone | inspir",
      description:
        "A free public AI learning companion for tutoring, practice, quizzes, flashcards, debate, writing feedback, coding help, and study planning.",
    }),
    videoObjectJsonLd({
      path: "/",
      name: homepageFilm.title,
      description: homepageFilm.description,
      thumbnailUrl: homepageFilm.thumbnailUrl,
      contentUrl: homepageFilm.contentUrl,
      duration: homepageFilm.duration,
      uploadDate: homepageFilm.uploadDate,
      transcript: homepageFilm.transcript,
      clips: homepageFilm.chapters,
    }),
    itemListJsonLd({
      path: "/",
      id: "learning-paths",
      name: "Popular AI learning paths",
      items: homepageLearningPaths.map((path) => ({
        name: path.title,
        url: learningPathHref(path.slug),
        description: path.description,
      })),
    }),
    itemListJsonLd({
      path: "/",
      id: "subject-hubs",
      name: "AI tutors by subject",
      items: subjectPages.map((page) => ({
        name: page.seoTitle,
        url: subjectPath(page.slug),
        description: page.description,
      })),
    }),
    itemListJsonLd({
      path: "/",
      id: "content-engine",
      name: "inspir AI learning content engine",
      items: posts.map((post) => ({
        name: post.title,
        url: `/blog/${post.slug}`,
        description: post.description,
      })),
    }),
    faqPageJsonLd({
      path: "/",
      questions: homepageFaqs,
    }),
  ];

  return (
    <main className="marketing-site">
      {jsonLd.map((entry, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(entry) }}
        />
      ))}
      <MarketingHeader hero />
      <section className="marketing-hero" aria-labelledby="landing-title">
        <div className="marketing-hero-content">
          <span className="marketing-kicker">Free public AI learning platform</span>
          <h1 id="landing-title">Free AI learning for everyone.</h1>
          <p>
            inspir turns curiosity, homework, revision, and big questions into guided AI learning
            sessions that explain, ask back, and help you practise.
          </p>
          <div className="marketing-hero-actions">
            <Link href="/chat/learn-anything" className="marketing-primary-cta">
              Start learning
              <Sparkles size={18} />
            </Link>
            <Link href="/mission" className="marketing-secondary-cta">
              Read the mission
            </Link>
          </div>
          <nav className="marketing-hero-routes" aria-label="Fast learning routes">
            {homepageHeroRoutes.map((route) => (
              <Link key={route.href} href={route.href}>
                <span>{route.eyebrow}</span>
                <strong>{route.title}</strong>
              </Link>
            ))}
          </nav>
        </div>
        <MarketingHeroVideo chapters={homepageFilm.chapters} transcript={homepageFilm.transcript} />
      </section>

      <section className="marketing-band marketing-impact-band">
        <div className="marketing-section-copy is-centered">
          <span>Useful from the first click</span>
          <h2>Built for curiosity, practice, and access.</h2>
          <p>
            The public site is structured like a learning map: live modes for immediate help,
            subject hubs for search intent, and guides that turn reading into action.
          </p>
        </div>
        <dl className="marketing-hero-stats">
          {proofStats.map(([value, label]) => (
            <div key={value}>
              <dt>{value}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="marketing-band is-trust-signals" aria-labelledby="trust-signals-title">
        <div className="marketing-section-copy">
          <span>Designed for confidence</span>
          <h2 id="trust-signals-title">A public learning site people can understand quickly.</h2>
          <p>
            Every non-app page now has a job: build trust, explain the learning route, and send
            learners toward a useful next action without hiding the important details.
          </p>
        </div>
        <div className="marketing-card-grid">
          {trustSignals.map((signal) => {
            const Icon = signal.icon;
            return (
              <article key={signal.title} className="marketing-card">
                <Icon size={24} />
                <h3>{signal.title}</h3>
                <p>{signal.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="marketing-story-split">
        <div className="marketing-story-media">
          <Image
            src={missionImages[1]}
            alt="A student learning at a chalkboard"
            width={1100}
            height={720}
          />
        </div>
        <div className="marketing-story-copy">
          <span>Mission first</span>
          <h2>Not another answer box. A place to learn.</h2>
          <p>
            inspir began as quizzes and student communities, grew through schools and events,
            and now uses AI to make one-to-one learning more accessible.
          </p>
          <div className="marketing-proof-grid">
            <div>
              <CheckCircle2 size={20} />
              Built from real learner behavior, not a generic chat box.
            </div>
            <div>
              <CheckCircle2 size={20} />
              Supports extracurricular learning, academic practice, and curiosity.
            </div>
            <div>
              <CheckCircle2 size={20} />
              Available publicly while schools can run confidential custom versions.
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-band is-process" aria-labelledby="learning-process-title">
        <div className="marketing-section-copy">
          <span>How it works</span>
          <h2 id="learning-process-title">The site is a route, not a brochure.</h2>
          <p>
            Search pages, blog guides, prompts, and live modes are linked around a simple loop:
            ask, try, check, repair, and review.
          </p>
        </div>
        <div className="learning-path-step-grid">
          {learningJourney.map((step) => (
            <article key={step.step} className="learning-path-step">
              <span>{step.step}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <Link href={step.href}>
                Continue
                <ArrowUpRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>What you can do</span>
          <h2>Learn by talking, testing, debating, and exploring.</h2>
        </div>
        <div className="marketing-card-grid">
          {modes.map((mode) => {
            const Icon = mode.icon;
            return (
              <article key={mode.title} className="marketing-card">
                <Icon size={24} />
                <h3>{mode.title}</h3>
                <p>{mode.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>Public learning modes</span>
          <h2>Open the exact kind of help you came for.</h2>
          <p>
            Each mode opens as a public guest chat with its own purpose, examples, and learning
            flow, so learners can start with the right kind of support immediately.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {priorityTopics.map((topic) => {
            const seo = getTopicSeo(topic);
            return (
              <Link key={topic.slug} href={topicPath(topic.slug)} className="marketing-topic-link">
                <span>{topic.metadata.category}</span>
                <strong>{topic.name}</strong>
                <p>{seo.description}</p>
              </Link>
            );
          })}
        </div>
        <div className="marketing-inline-actions">
          <ArrowLink href="/chat/learn-anything">Open guest chat</ArrowLink>
          <ArrowLink href="/topics">Browse every mode</ArrowLink>
        </div>
      </section>

      <section className="marketing-band is-topic-finder">
        <div className="marketing-section-copy">
          <span>AI tutors by subject</span>
          <h2>Start from the subject, then open the right learning mode.</h2>
          <p>
            Math, writing, coding, history, homework, and exam prep each need different behavior.
            These public subject hubs connect the search intent to live modes, prompts, guides,
            and review loops.
          </p>
        </div>
        <div className="marketing-mode-finder-grid">
          {subjectPages.map((page) => (
            <Link key={page.slug} href={subjectPath(page.slug)} className="marketing-mode-finder-card">
              <span>{page.eyebrow}</span>
              <strong>{page.seoTitle}</strong>
              <p>{page.description}</p>
              <small>
                Open subject hub
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
        <div className="marketing-inline-actions">
          <ArrowLink href="/subjects">Browse subjects</ArrowLink>
          <ArrowLink href="/ai-learning-map">Open the learning map</ArrowLink>
        </div>
      </section>

      <section className="marketing-band is-learning-paths">
        <div className="marketing-section-copy">
          <span>Popular paths</span>
          <h2>Start with the job you need done.</h2>
          <p>
            Search engines see pages. Learners need sequences. These paths connect the public
            modes into practical study loops for understanding, homework, exam prep, and exploration.
          </p>
        </div>
        <div className="marketing-path-grid">
          {homepageLearningPaths.map((path) => (
            <article key={path.title} className="marketing-path-card">
              <h3>{path.title}</h3>
              <p>{path.description}</p>
              <div>
                <Link href={learningPathHref(path.slug)}>
                  <ArrowUpRight size={15} />
                  Open the path
                </Link>
                {path.links.map((link) => (
                  <Link key={link.href} href={link.href}>
                    <CornerDownRight size={15} />
                    {link.label}
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band is-content-engine" aria-labelledby="content-engine-title">
        <div className="marketing-section-copy">
          <span>Content engine</span>
          <h2 id="content-engine-title">
            A {posts.length}-guide library built for learners, links, and AI discovery.
          </h2>
          <p>
            The blog is organized around pillar clusters, category hubs, related modes, prompt
            routes, structured data, and an AI-readable index so each guide can be understood
            and recommended in context.
          </p>
        </div>
        <div className="marketing-card-grid">
          <article className="marketing-card">
            <LibraryBig size={24} />
            <h3>{posts.length} practical guides</h3>
            <p>Mode guides, prompt loops, study methods, and cornerstone articles for high-intent searches.</p>
          </article>
          <article className="marketing-card">
            <Route size={24} />
            <h3>Topic clusters</h3>
            <p>Every article connects to categories, live modes, subject hubs, learning paths, and related guides.</p>
          </article>
          <article className="marketing-card">
            <Waypoints size={24} />
            <h3>AI-readable map</h3>
            <p>LLMs, crawlers, and learners can follow the sitemap, RSS feed, llms.txt, and JSON content index.</p>
          </article>
          <article className="marketing-card">
            <BookOpenCheck size={24} />
            <h3>Built to be used</h3>
            <p>Each guide ends with practice plans, routes, and links into the exact learning mode that fits.</p>
          </article>
        </div>
        <div className="marketing-inline-actions">
          <ArrowLink href="/blog">Explore the guide library</ArrowLink>
          <ArrowLink href="/ai-content-index.json">Open the content index</ArrowLink>
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>From the blog</span>
          <h2>Study loops, AI tutoring guides, and practical prompts.</h2>
          <p>
            The blog connects useful learning advice to live practice, so a guide can become
            a study session in one step.
          </p>
        </div>
        <div className="marketing-repo-grid">
          {featuredPosts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="marketing-repo-card blog-card">
              <time dateTime={post.date}>
                {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(post.date))}
              </time>
              <strong>{post.title}</strong>
              <span>{post.description}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-split-band">
        <div>
          <span className="marketing-kicker dark">For schools and CSR partners</span>
          <h2>Custom AI learning spaces with data confidentiality.</h2>
          <p>
            Schools can offer white-labelled AI chat experiences tailored to their learners,
            including NCERT-aligned content and workflows, with usage funded by partner schools
            or CSR sponsorship.
          </p>
          <div className="marketing-inline-actions">
            <ArrowLink href="/schools">Explore schools</ArrowLink>
            <ArrowLink href="mailto:schools@inspirlearning.com" external>
              schools@inspirlearning.com
            </ArrowLink>
          </div>
        </div>
        <div className="marketing-school-panel" aria-hidden="true">
          <School size={34} />
          <strong>White-labelled school AI</strong>
          <span>School-specific workflows</span>
          <span>NCERT-aligned options</span>
          <span>Confidential deployments</span>
        </div>
      </section>

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>Quick answers</span>
          <h2>What learners usually ask before they start.</h2>
        </div>
        <div className="marketing-faq-list">
          {homepageFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-band is-github">
        <div className="marketing-section-copy">
          <span>Build with us</span>
          <h2>inspir is being built in public.</h2>
          <p>
            Contributions are welcome from engineers, educators, designers, students, and anyone
            who wants AI learning to be safer, clearer, more accessible, and more useful.
          </p>
        </div>
        <div className="marketing-repo-grid">
          {repos.map((repo) => (
            <a key={repo.href} href={repo.href} target="_blank" rel="noreferrer" className="marketing-repo-card">
              <Code2 size={22} />
              <strong>{repo.title}</strong>
              <span>{repo.text}</span>
            </a>
          ))}
        </div>
        <div className="marketing-contribute-row">
          <span>Good first areas:</span>
          <p>accessibility, prompts, tests, safer AI behavior, learner flows, and UI polish.</p>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
