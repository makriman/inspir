import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
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
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { getCachedSiteTranslationEntries, getSiteTranslationNamespaces } from "@/lib/i18n/site-translations";
import { getRequestLanguage, getRequestPathname } from "@/lib/i18n/request-locale";
import { createTranslationLookup, normalizeTranslationText } from "@/lib/i18n/translation-lookup";
import { defaultLanguage } from "@/lib/content/languages";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import { formatMediumDate } from "@/lib/utils/dates";
import {
  faqPageJsonLd,
  itemListJsonLd,
  videoObjectJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const pageMetadata: Metadata = {
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

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/");
}

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
    title: "Clear privacy boundaries",
    text: "You can try public learning modes freely. Saved chats, accounts, admin tools, and user data stay private.",
  },
  {
    icon: LibraryBig,
    title: "Helpful learning map",
    text: "Guides, paths, subjects, and prompts connect to the next useful place to practise.",
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

type PriorityTopic = (typeof topicSeeds)[number];
type SubjectPageSummary = ReturnType<typeof getSubjectPages>[number];
type LandingPost = ReturnType<typeof getBlogPosts>[number];
type ProofStats = readonly (readonly [string, string])[];

export default function LandingPage() {
  const priorityTopics = priorityTopicSlugs
    .map((slug) => topicSeeds.find((topic) => topic.slug === slug))
    .filter((topic): topic is (typeof topicSeeds)[number] => Boolean(topic));
  const subjectPages = getSubjectPages();
  const posts = getBlogPosts();
  const featuredPosts = posts.slice(0, 6);
  const proofStats = [
    [`${topicSeeds.length}`, "public AI learning modes"],
    [`${posts.length}`, "learning guides and practice loops"],
    [`${subjectPages.length}`, "subject hubs mapped to learner needs"],
  ] as const;
  const jsonLd = buildLandingJsonLd(subjectPages, posts);

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader hero />
      <LandingHero />
      <LandingImpactBand proofStats={proofStats} />
      <TrustSignalsSection />
      <MissionStorySection />
      <LearningProcessSection />
      <ModeCardsSection />
      <PublicModesSection priorityTopics={priorityTopics} />
      <SubjectHubsSection subjectPages={subjectPages} />
      <LearningPathsSection />
      <ContentEngineSection posts={posts} />
      <BlogHighlightsSection featuredPosts={featuredPosts} />
      <SchoolsSection />
      <FaqSection />
      <GithubSection />
      <MarketingFooter />
    </main>
  );
}

function buildLandingJsonLd(subjectPages: SubjectPageSummary[], posts: LandingPost[]) {
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
      id: "learning-guide-library",
      name: "inspir AI learning guide library",
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

  return jsonLd;
}

async function LandingHero() {
  const t = await getLandingTranslator();
  return (
    <section className="marketing-hero" aria-labelledby="home-title">
      <div className="marketing-hero-content">
        <span className="marketing-kicker">{t("Free public AI learning platform")}</span>
        <h1 id="home-title">{t("Free AI learning for everyone.")}</h1>
        <p>
          {t(
            "inspir turns curiosity, homework, revision, and big questions into guided AI learning sessions that explain, ask back, and help you practise.",
          )}
        </p>
        <div className="marketing-hero-actions">
          <Link href="/chat/learn-anything" className="marketing-primary-cta">
            {t("Start learning")}
            <Sparkles size={18} />
          </Link>
          <Link href="/mission" className="marketing-secondary-cta">
            {t("Read the mission")}
          </Link>
        </div>
        <nav className="marketing-hero-routes" aria-label="Fast learning routes">
          {homepageHeroRoutes.map((route) => (
            <Link key={route.href} href={route.href}>
              <span>{t(route.eyebrow)}</span>
              <strong>{t(route.title)}</strong>
            </Link>
          ))}
        </nav>
      </div>
      <MarketingHeroVideo chapters={homepageFilm.chapters} transcript={homepageFilm.transcript} />
    </section>
  );
}

async function getLandingTranslator() {
  const [language, pathname] = await Promise.all([getRequestLanguage(), getRequestPathname()]);
  if (language === defaultLanguage) return (value: string) => value;
  const entries = await getCachedSiteTranslationEntries(language, getSiteTranslationNamespaces(pathname));
  const lookup = createTranslationLookup(entries);
  return (value: string) => {
    const normalized = normalizeTranslationText(value);
    if (!normalized) return value;
    const translated = lookup.translate(normalized);
    if (!translated || translated === normalized) return value;
    return translated;
  };
}

function LandingImpactBand({ proofStats }: { proofStats: ProofStats }) {
  return (
    <section className="marketing-band marketing-impact-band">
      <div className="marketing-section-copy is-centered">
        <span>Useful from the first click</span>
        <h2>Built for curiosity, practice, and access.</h2>
        <p>
          The public site is structured like a learning map: live modes for immediate help, subject hubs for learner
          questions, and guides that turn reading into action.
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
  );
}

function TrustSignalsSection() {
  return (
    <section className="marketing-band is-trust-signals" aria-labelledby="trust-signals-title">
      <div className="marketing-section-copy">
        <span>Designed for confidence</span>
        <h2 id="trust-signals-title">A public learning site people can understand quickly.</h2>
        <p>
          Every non-app page now has a job: build trust, explain the learning route, and send learners toward a useful
          next action without hiding the important details.
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
  );
}

function MissionStorySection() {
  return (
    <section className="marketing-story-split">
      <div className="marketing-story-media" aria-hidden="true">
        <video
          aria-label="inspir learning film preview"
          src="/media/inspir-learning-film.mp4"
          poster="/inspir-social-preview.png"
          muted
          autoPlay
          loop
          playsInline
          preload="metadata"
        />
      </div>
      <div className="marketing-story-copy">
        <span>Mission first</span>
        <h2>Not another answer box. A place to learn.</h2>
        <p>
          inspir began as quizzes and student communities, grew through schools and events, and now uses AI to make
          one-to-one learning more accessible.
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
  );
}

function LearningProcessSection() {
  return (
    <section className="marketing-band is-process" aria-labelledby="learning-process-title">
      <div className="marketing-section-copy">
        <span>How it works</span>
        <h2 id="learning-process-title">The site is a route, not a brochure.</h2>
        <p>
          Search pages, blog guides, prompts, and live modes are linked around a simple loop: ask, try, check, repair,
          and review.
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
  );
}

function ModeCardsSection() {
  return (
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
  );
}

function PublicModesSection({ priorityTopics }: { priorityTopics: PriorityTopic[] }) {
  return (
    <section className="marketing-band is-discovery">
      <div className="marketing-section-copy">
        <span>Public learning modes</span>
        <h2>Open the exact kind of help you came for.</h2>
        <p>
          Each mode opens as a public guest chat with its own purpose, examples, and learning flow, so learners can start
          with the right kind of support immediately.
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
  );
}

function SubjectHubsSection({ subjectPages }: { subjectPages: SubjectPageSummary[] }) {
  return (
    <section className="marketing-band is-topic-finder">
      <div className="marketing-section-copy">
        <span>AI tutors by subject</span>
        <h2>Start from the subject, then open the right learning mode.</h2>
        <p>
          Math, writing, coding, history, homework, and exam prep each need different help. Start from the subject,
          then move into the mode, prompt, guide, or review loop that fits.
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
  );
}

function LearningPathsSection() {
  return (
    <section className="marketing-band is-learning-paths">
      <div className="marketing-section-copy">
        <span>Popular paths</span>
        <h2>Start with the job you need done.</h2>
        <p>
          Learners need a sequence, not a pile of links. These paths connect modes into practical study loops for
          understanding, homework, exam prep, and exploration.
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
  );
}

function ContentEngineSection({ posts }: { posts: LandingPost[] }) {
  return (
    <section className="marketing-band is-guide-library" aria-labelledby="guide-library-title">
      <div className="marketing-section-copy">
        <span>Guide library</span>
        <h2 id="guide-library-title">A {posts.length}-guide library built for learning that turns into action.</h2>
        <p>
          The blog is organized around real study moments: getting unstuck, remembering more, writing better, preparing
          for exams, and exploring ideas with a patient tutor.
        </p>
      </div>
      <div className="marketing-card-grid">
        <article className="marketing-card">
          <LibraryBig size={24} />
          <h3>{posts.length} practical guides</h3>
          <p>Mode guides, prompt loops, study methods, and cornerstone articles for common learning moments.</p>
        </article>
        <article className="marketing-card">
          <Route size={24} />
          <h3>Topic clusters</h3>
          <p>Every article connects to categories, live modes, subject hubs, learning paths, and related guides.</p>
        </article>
        <article className="marketing-card">
          <Waypoints size={24} />
          <h3>Easy next steps</h3>
          <p>Each guide points to a mode, prompt, or review loop so reading can become practice.</p>
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
  );
}

function BlogHighlightsSection({ featuredPosts }: { featuredPosts: LandingPost[] }) {
  return (
    <section className="marketing-band">
      <div className="marketing-section-copy">
        <span>From the blog</span>
        <h2>Study loops, AI tutoring guides, and practical prompts.</h2>
        <p>The blog connects useful learning advice to live practice, so a guide can become a study session in one step.</p>
      </div>
      <div className="marketing-repo-grid">
        {featuredPosts.map((post) => (
          <Link key={post.slug} href={`/blog/${post.slug}`} className="marketing-repo-card blog-card">
            <time dateTime={post.date}>{formatMediumDate(post.date)}</time>
            <strong>{post.title}</strong>
            <span>{post.description}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function SchoolsSection() {
  return (
    <section className="marketing-split-band">
      <div>
        <span className="marketing-kicker dark">For schools and CSR partners</span>
        <h2>Custom AI learning spaces with data confidentiality.</h2>
        <p>
          Schools can offer white-labelled AI chat experiences tailored to their learners, including NCERT-aligned
          content and workflows, with usage funded by partner schools or CSR sponsorship.
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
  );
}

function FaqSection() {
  return (
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
  );
}

function GithubSection() {
  return (
    <section className="marketing-band is-github">
      <div className="marketing-section-copy">
        <span>Build with us</span>
        <h2>inspir is being built in public.</h2>
        <p>
          Contributions are welcome from engineers, educators, designers, students, and anyone who wants AI learning to
          be safer, clearer, more accessible, and more useful.
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
  );
}
