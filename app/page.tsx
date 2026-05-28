import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpenCheck,
  BrainCircuit,
  CircleDot,
  Code2,
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
} from "@/components/marketing/MarketingShell";
import { getBlogPosts } from "@/lib/content/blog";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";
import { getTopicSeo } from "@/lib/content/topic-seo";

export const metadata: Metadata = {
  title: "Free AI learning for everyone",
  description:
    "Revolutionize Your Learning Journey with Artificial intelligence. Learn, practise, debate, quiz, and explore with inspir.",
  alternates: { canonical: "/" },
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
  const featuredPosts = getBlogPosts().slice(0, 6);

  return (
    <main className="marketing-site">
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
        </div>
        <MarketingHeroVideo />
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

      <section className="marketing-band is-intro">
        <div className="marketing-section-copy">
          <span>Mission first</span>
          <h2>Learning should be free, fun, and useful.</h2>
          <p>
            inspir began as quizzes and student communities, grew through schools and events,
            and now uses AI to make one-to-one learning more accessible.
          </p>
        </div>
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
          <span>Public topic chats</span>
          <h2>Indexable learning modes people can land on directly.</h2>
          <p>
            Each mode opens as a public guest chat with its own purpose, examples, and learning
            flow, so learners can start from the exact help they searched for.
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
          <ArrowLink href="/blog">Read the learning guides</ArrowLink>
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>From the blog</span>
          <h2>Study loops, AI tutoring guides, and practical prompts.</h2>
          <p>
            The blog connects searchers to useful learning advice and then into the matching
            live mode.
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
