import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
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
import {
  mediaAttributionFacts,
  mediaCitationSnippets,
  mediaCoverageLinks,
  mediaFaqs,
  mediaLinkingTargets,
  mediaHighlights,
  mediaOfficialLinks,
  mediaStoryAngles,
} from "@/lib/content/authority";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const description =
  "Media notes, source links, citation facts, and official reference URLs for inspir, the free AI-powered learning platform.";

const pageMetadata: Metadata = {
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

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/media");
}

const highlightIcons = [UsersRound, Globe2, Award, Newspaper] as const;

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
      items: mediaOfficialLinks.map((link) => ({
        name: link.title,
        url: link.href,
        description: link.text,
      })),
    }),
    itemListJsonLd({
      path: "/media",
      id: "coverage-links",
      name: "External coverage and reference links",
      items: mediaCoverageLinks.map((link) => ({
        name: link.label,
        url: link.href,
        description: link.text,
      })),
    }),
    itemListJsonLd({
      path: "/media",
      id: "story-angles",
      name: "inspir media story angles",
      items: mediaStoryAngles.map((angle) => ({
        name: angle.title,
        url: angle.href,
        description: angle.text,
      })),
    }),
    itemListJsonLd({
      path: "/media",
      id: "linking-targets",
      name: "Recommended inspir citation targets",
      items: mediaLinkingTargets.map((target) => ({
        name: `${target.title}: ${target.anchorText}`,
        url: target.href,
        description: target.text,
      })),
    }),
    itemListJsonLd({
      path: "/media",
      id: "citation-snippets",
      name: "Suggested inspir citation snippets",
      items: mediaCitationSnippets.map((snippet) => ({
        name: snippet.title,
        url: snippet.href,
        description: snippet.text,
      })),
    }),
    faqPageJsonLd({ path: "/media", questions: mediaFaqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
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
          {mediaHighlights.map((item, index) => {
            const Icon = highlightIcons[index] ?? Sparkles;
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

      <section className="marketing-band is-media-angles">
        <div className="marketing-section-copy">
          <span>Story angles</span>
          <h2>Coverage ideas that link back to real public pages.</h2>
          <p>
            These angles are written for journalists, directory editors, school partners, and
            readers who need a useful summary plus a verifiable URL.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {mediaStoryAngles.map((angle) => (
            <Link key={angle.href} href={angle.href} className="marketing-topic-link">
              <span>Coverage angle</span>
              <strong>{angle.title}</strong>
              <p>{angle.text}</p>
              <small>
                Open source page
                <ArrowUpRightIcon />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>Official citation links</span>
          <h2>Reference these pages when writing about inspir.</h2>
          <p>
            These URLs are stable entrypoints for the mission, product, learning content,
            and open-source work.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {mediaOfficialLinks.map((link) => {
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
          {mediaCoverageLinks.map((link) => (
            <ArrowLink key={link.href} href={link.href} external>
              {link.label}
            </ArrowLink>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Citation guide</span>
          <h2>Recommended pages and wording for references.</h2>
          <p>
            These suggestions help articles, directories, and school notes point people
            to the most useful public page for the context.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {mediaLinkingTargets.map((target) => (
            <Link key={target.href} href={target.href} className="marketing-topic-link">
              <span>Suggested anchor: {target.anchorText}</span>
              <strong>{target.title}</strong>
              <p>{target.text}</p>
              <small>
                Open target
                <ArrowUpRightIcon />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>Citation copy</span>
          <h2>Short descriptions writers can reuse with attribution.</h2>
          <p>
            These snippets keep citations accurate, linkable, and aligned with the public
            product people can inspect.
          </p>
        </div>
        <div className="marketing-card-grid">
          {mediaCitationSnippets.map((snippet) => (
            <article key={snippet.title} className="marketing-card">
              <Link2 size={22} />
              <h3>{snippet.title}</h3>
              <p>{snippet.text}</p>
              <ArrowLink href={snippet.href}>Source page</ArrowLink>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Attribution</span>
          <h2>Short facts for articles, directories, and partner pages.</h2>
        </div>
        <div className="media-fact-table">
          {mediaAttributionFacts.map(([label, value]) => (
            <div key={label}>
              <strong>{label}</strong>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="marketing-band is-media-faq">
        <div className="marketing-section-copy">
          <span>Media FAQ</span>
          <h2>Short answers for citations, directories, and AI summaries.</h2>
          <p>
            Use these facts when describing inspir in articles, partner pages, education
            directories, school notes, and AI-generated summaries.
          </p>
        </div>
        <div className="marketing-faq-list">
          {mediaFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
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
