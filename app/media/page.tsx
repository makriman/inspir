import type { Metadata } from "next";
import { Award, Globe2, Newspaper, UsersRound } from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "Media | inspir",
  description:
    "Media notes, recognition, metrics, and source links for inspir, the free AI-powered learning platform.",
};

const highlights = [
  {
    icon: UsersRound,
    title: "1M+ learners",
    text: "Reached across the free public platform and partner school deployments.",
  },
  {
    icon: Globe2,
    title: "100+ countries",
    text: "A learner base that already extends beyond India into a wider international audience.",
  },
  {
    icon: Award,
    title: "DeepHack recognition",
    text: "Jury’s Choice recognition from Amod Malviya at DeepHack for AI learning work.",
  },
  {
    icon: Newspaper,
    title: "Built since 2013",
    text: "From Facebook quizzes and offline events to applied AI learning infrastructure.",
  },
] as const;

const links = [
  {
    href: "https://deccanbusiness.com/where-learning-becomes-universal-inspirs-vision-to-make-education-free-fun-and-accessible-for-everyone/",
    label: "Deccan Business coverage",
  },
  {
    href: "https://dhunt.in/12OTez",
    label: "Dailyhunt coverage",
  },
  {
    href: "https://nirantk.com/community/deephackdemos/",
    label: "DeepHack community page",
  },
  {
    href: "https://inspir.uk",
    label: "inspir.uk next-generation buildout",
  },
] as const;

export default function MediaPage() {
  return (
    <main className="marketing-site">
      <MarketingHeader />
      <MarketingPageHero eyebrow="Media" title="A long-running AI learning platform built for public value.">
        inspir is an AI-powered learning platform founded in 2013 with the mission of making
        quality education free, engaging, and broadly accessible.
      </MarketingPageHero>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Key facts</span>
          <h2>Useful reference points for coverage and partners.</h2>
        </div>
        <div className="marketing-card-grid">
          {highlights.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="marketing-card">
                <Icon size={24} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="marketing-split-band">
        <div>
          <span className="marketing-kicker dark">Technical story</span>
          <h2>Applied AI work before the current AI wave.</h2>
          <p>
            inspir’s work includes retrieval-based learning systems, NCERT content ingestion,
            structured prompting, custom LLM evaluation, and open-source engagement around RAG
            evaluation. The current platform lives at inspirlearning.com while the next generation
            is being built in public through inspir.uk and GitHub.
          </p>
        </div>
        <div className="marketing-media-list">
          {links.map((link) => (
            <ArrowLink key={link.href} href={link.href} external>
              {link.label}
            </ArrowLink>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>For press and school partnership notes.</h2>
        <div className="marketing-inline-actions">
          <ArrowLink href="mailto:schools@inspirlearning.com" external>
            schools@inspirlearning.com
          </ArrowLink>
          <ArrowLink href="https://github.com/makriman/inspir" external>
            Current GitHub repo
          </ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
