import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpenCheck,
  BrainCircuit,
  CircleDot,
  Code2,
  CornerDownRight,
  GraduationCap,
  HeartHandshake,
  School,
  Sparkles,
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

const stats = [
  ["2013", "started as a public learning community"],
  ["1M+", "learners reached across the platform and partner schools"],
  ["100+", "countries represented across the learner base"],
] as const;

const modes = [
  {
    icon: BookOpenCheck,
    title: "Learn anything",
    text: "Clear explanations, examples, and next steps for whatever you are curious about.",
  },
  {
    icon: BrainCircuit,
    title: "Practise actively",
    text: "Quizzes, Socratic prompts, debate, role-play, and interactive instruction.",
  },
  {
    icon: GraduationCap,
    title: "Built for learners",
    text: "Short turns, simple language, and teaching logic shaped around understanding.",
  },
  {
    icon: HeartHandshake,
    title: "Open by design",
    text: "A public product and open-source rebuild welcoming educators, builders, and students.",
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
  const featuredPosts = getBlogPosts().slice(0, 6);
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
            inspir helps anyone learn and practise through patient AI conversations, quizzes,
            debates, role-play, and guided instruction.
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

      <section className="marketing-band is-film-notes" aria-labelledby="film-notes-title">
        <div className="marketing-section-copy">
          <span>Learning film</span>
          <h2 id="film-notes-title">A thirty-second promise: learning should open instantly.</h2>
          <p>{homepageFilm.transcript}</p>
        </div>
        <div className="marketing-film-chapter-grid">
          {homepageFilm.chapters.map((chapter, index) => (
            <article key={chapter.title} id={`learning-film-chapter-${index + 1}`}>
              <span>{new Date(chapter.start * 1000).toISOString().slice(14, 19)}</span>
              <strong>{chapter.title}</strong>
              <p>{chapter.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band marketing-impact-band">
        <div className="marketing-section-copy is-centered">
          <span>Globally useful</span>
          <h2>Built for curiosity, practice, and access.</h2>
          <p>
            The work began in public learning communities and continues as a free AI companion
            for students, parents, teachers, and self-taught learners.
          </p>
        </div>
        <dl className="marketing-hero-stats">
          {stats.map(([value, label]) => (
            <div key={value}>
              <dt>{value}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
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
              <CircleDot size={20} />
              Built from real learner behavior, not a generic chat box.
            </div>
            <div>
              <CircleDot size={20} />
              Supports extracurricular learning, academic practice, and curiosity.
            </div>
            <div>
              <CircleDot size={20} />
              Available publicly while schools can run confidential custom versions.
            </div>
          </div>
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
