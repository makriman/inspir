import type { Metadata } from "next";
import Link from "next/link";
import {
  Award,
  Globe2,
  Link2,
  Newspaper,
  Sparkles,
  UsersRound,
} from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import { metadataAlternates, siteName, siteUrl, socialImage } from "@/lib/seo/config";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  serializeJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const description =
  "Media notes, source links, citation facts, and official reference URLs for inspir, the free AI-powered learning platform.";

export const metadata: Metadata = {
  title: "Media And Press",
  description,
  alternates: metadataAlternates("/media"),
  openGraph: {
    title: "Media And Press | inspir",
    description,
    url: "/media",
    siteName,
    images: [
      socialImage({
        title: "Media And Press",
        eyebrow: "Press facts",
        description,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Media And Press | inspir",
    description,
    images: [
      socialImage({
        title: "Media And Press",
        eyebrow: "Press facts",
        description,
      }).url,
    ],
  },
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
    text: "Jury's Choice recognition from Amod Malviya at DeepHack for AI learning work.",
  },
  {
    icon: Newspaper,
    title: "Built since 2013",
    text: "From Facebook quizzes and offline events to applied AI learning infrastructure.",
  },
] as const;

const coverageLinks = [
  {
    href: "https://deccanbusiness.com/where-learning-becomes-universal-inspirs-vision-to-make-education-free-fun-and-accessible-for-everyone/",
    label: "Deccan Business coverage",
    text: "Coverage of inspir's vision for free, accessible education.",
  },
  {
    href: "https://dhunt.in/12OTez",
    label: "Dailyhunt coverage",
    text: "Syndicated coverage for wider consumer reach.",
  },
  {
    href: "https://nirantk.com/community/deephackdemos/",
    label: "DeepHack community page",
    text: "Community page connected to DeepHack recognition.",
  },
  {
    href: "https://inspir.uk",
    label: "inspir.uk next-generation buildout",
    text: "The wider international buildout connected to the inspir project.",
  },
] as const;

const officialLinks = [
  {
    href: "/mission",
    title: "Mission",
    text: "The public statement of why inspir exists and what learning access means.",
  },
  {
    href: "/topics",
    title: "Public AI learning modes",
    text: "A crawlable directory of every guest learning chat entrypoint.",
  },
  {
    href: "/blog",
    title: "AI learning blog",
    text: "More than 100 guides on tutoring, prompts, study loops, active recall, and modes.",
  },
  {
    href: "https://github.com/makriman/inspir",
    title: "Current GitHub repo",
    text: "The open-source rebuild for developers, educators, and contributors.",
  },
] as const;

const attributionFacts = [
  ["Name", "inspir"],
  ["Website", siteUrl],
  ["Category", "Free AI learning platform"],
  ["Founded", "2013"],
  ["Primary audience", "Learners, parents, teachers, schools, and self-taught builders"],
  ["Public entrypoint", "/chat/learn-anything"],
] as const;

export default function MediaPage() {
  const jsonLd = [
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Media", url: "/media" },
    ]),
    webPageJsonLd({
      path: "/media",
      name: "Media And Press | inspir",
      description,
      type: "AboutPage",
    }),
    itemListJsonLd({
      path: "/media",
      id: "official-links",
      name: "Official inspir reference links",
      items: officialLinks.map((link) => ({
        name: link.title,
        url: link.href,
        description: link.text,
      })),
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
      <MarketingHeader />
      <MarketingPageHero eyebrow="Media" title="A citeable public record for inspir.">
        Facts, source links, official URLs, and context for anyone writing about inspir&apos;s work
        in free AI learning, schools, and public education access.
      </MarketingPageHero>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Key facts</span>
          <h2>Useful reference points for coverage and partners.</h2>
          <p>
            These facts are written to be easy to cite while keeping the claim precise and
            connected to public pages people can verify.
          </p>
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

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>Official citation links</span>
          <h2>Reference these pages when writing about inspir.</h2>
          <p>
            These URLs are stable entrypoints for the mission, product surface, learning content,
            and open-source work.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {officialLinks.map((link) => {
            const external = link.href.startsWith("http");
            return (
              <Link
                key={link.href}
                href={link.href}
                className="marketing-topic-link"
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer" : undefined}
              >
                <span>{external ? "External" : "inspirlearning.com"}</span>
                <strong>{link.title}</strong>
                <p>{link.text}</p>
                <small>
                  Open reference
                  <ArrowUpRightIcon />
                </small>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="marketing-split-band">
        <div>
          <span className="marketing-kicker dark">Technical story</span>
          <h2>Applied AI learning work before the current AI wave.</h2>
          <p>
            inspir&apos;s work includes retrieval-based learning systems, NCERT content ingestion,
            structured prompting, custom LLM evaluation, and open-source engagement around RAG
            evaluation. The current platform lives at inspirlearning.com while the next generation
            is being built in public through inspir.uk and GitHub.
          </p>
          <div className="marketing-inline-actions">
            <ArrowLink href="/topics">Browse public modes</ArrowLink>
            <ArrowLink href="/blog/category/ai-tutor">AI tutor guides</ArrowLink>
          </div>
        </div>
        <div className="marketing-media-list">
          {coverageLinks.map((link) => (
            <ArrowLink key={link.href} href={link.href} external>
              {link.label}
            </ArrowLink>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Attribution</span>
          <h2>Short facts for articles, directories, and partner pages.</h2>
        </div>
        <div className="media-fact-table">
          {attributionFacts.map(([label, value]) => (
            <div key={label}>
              <strong>{label}</strong>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>For press and school partnership notes.</h2>
        <div className="marketing-inline-actions">
          <Link href="/mission" className="marketing-primary-cta is-dark">
            Read mission
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="mailto:schools@inspirlearning.com" external>
            schools@inspirlearning.com
          </ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}

function ArrowUpRightIcon() {
  return <Link2 size={14} />;
}
