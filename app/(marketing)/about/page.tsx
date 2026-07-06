import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { ArrowUpRight, Sparkles } from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import { aboutFaqs, aboutProofPoints, aboutStoryLinks, aboutTimeline } from "@/lib/content/authority";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const pageMetadata: Metadata = {
  title: "About",
  description:
    "The story of inspir, from Facebook quizzes and student communities to a free AI learning platform built in public.",
  alternates: metadataAlternates("/about"),
  openGraph: {
    title: "About inspir",
    description:
      "The story of inspir, from public quizzes and student communities to free AI learning tools built in public.",
    url: "/about",
    siteName,
    images: [
      socialImage({
        title: "About inspir",
        eyebrow: "Story",
        description:
          "From quizzes and student communities to a free public AI learning platform built in public.",
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "About inspir",
    description:
      "The story of inspir, from public quizzes and student communities to free AI learning tools built in public.",
    images: [
      socialImage({
        title: "About inspir",
        eyebrow: "Story",
        description:
          "From quizzes and student communities to a free public AI learning platform built in public.",
      }).url,
    ],
  },
};

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/about");
}

export default function AboutPage() {
  const jsonLd = [
    webPageJsonLd({
      path: "/about",
      name: "About inspir",
      description:
        "The story of inspir, from public quizzes and student communities to free AI learning tools built in public.",
      type: "AboutPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "About", url: "/about" },
    ]),
    itemListJsonLd({
      path: "/about",
      id: "story-timeline",
      name: "inspir story timeline",
      items: aboutTimeline.map((item) => ({
        name: `${item.year}: ${item.title}`,
        url: `/about#${item.slug}`,
        description: item.text,
      })),
    }),
    itemListJsonLd({
      path: "/about",
      id: "proof-points",
      name: "inspir public proof points",
      items: aboutProofPoints.map((item) => ({
        name: item.title,
        url: "/about",
        description: item.text,
      })),
    }),
    itemListJsonLd({
      path: "/about",
      id: "story-reference-links",
      name: "inspir story reference links",
      items: aboutStoryLinks.map((link) => ({
        name: link.title,
        url: link.href,
        description: link.text,
      })),
    }),
    faqPageJsonLd({ path: "/about", questions: aboutFaqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero
        eyebrow="About inspir"
        title="Learning is for everyone, and AI should make that more true."
        visual="about"
      >
        inspir is a free AI learning platform shaped by more than a decade of quizzes,
        extracurricular learning, school networks, and applied AI experimentation.
      </MarketingPageHero>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Story</span>
          <h2>From a quiz page to a public AI learning companion.</h2>
          <p>
            The mission has stayed steady: make learning accessible, engaging, enjoyable,
            and useful for anyone with curiosity and an internet connection.
          </p>
        </div>
        <div className="marketing-timeline">
          {aboutTimeline.map((item) => (
            <article key={`${item.year}-${item.title}`} id={item.slug} className="marketing-timeline-item">
              <time>{item.year}</time>
              <div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band is-about-proof">
        <div className="marketing-section-copy">
          <span>What exists now</span>
          <h2>The story is visible in the product surface.</h2>
          <p>
            The strongest proof of the mission is not a claim on a page. It is the public
            learning surface: guest modes, study paths, long-form guides, and school pathways
            that connect back to real learner needs.
          </p>
        </div>
        <div className="marketing-card-grid">
          {aboutProofPoints.map((point) => (
            <article key={point.title} className="marketing-card">
              <Sparkles size={22} />
              <h3>{point.title}</h3>
              <p>{point.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-split-band">
        <div>
          <span className="marketing-kicker dark">Why it matters</span>
          <h2>A personal tutor should not be limited by geography or income.</h2>
          <p>
            inspir treats AI as an enabler, not the mission itself. The mission is better
            access to learning: clearer explanations, more practice, stronger curiosity,
            and a future where every child can reach a capable tutor for free or very low cost.
          </p>
        </div>
        <div className="marketing-media-list">
          <ArrowLink href="/mission">Read the mission</ArrowLink>
          <ArrowLink href="/schools">Schools and CSR</ArrowLink>
          <ArrowLink href="https://github.com/makriman/inspir" external>
            Contribute on GitHub
          </ArrowLink>
        </div>
      </section>

      <section className="marketing-band is-about-links">
        <div className="marketing-section-copy">
          <span>Reference links</span>
          <h2>Follow the story into live public pages.</h2>
          <p>
            These pages give learners, families, schools, and partners a clear path from the
            company story into the mission, the learning modes, the guide library, and school
            deployment notes.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {aboutStoryLinks.map((link) => (
            <Link key={link.href} href={link.href} className="marketing-topic-link">
              <span>Story reference</span>
              <strong>{link.title}</strong>
              <p>{link.text}</p>
              <small>
                Open page
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band is-about-faq">
        <div className="marketing-section-copy">
          <span>About FAQ</span>
          <h2>Fast context for learners, schools, and citations.</h2>
          <p>
            The short version: inspir grew from a learning community into a public AI learning
            product organized around active, mode-specific teaching.
          </p>
        </div>
        <div className="marketing-faq-list">
          {aboutFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Explore the public learning surface.</h2>
        <div className="marketing-inline-actions">
          <Link href="/chat/learn-anything" className="marketing-primary-cta is-dark">
            Start learning
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="/blog">Read the learning guides</ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
