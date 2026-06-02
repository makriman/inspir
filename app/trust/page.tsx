import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, LockKeyhole, School, Search, ShieldCheck, Sparkles } from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import {
  trustCrawlerPolicies,
  trustFaqs,
  trustPrinciples,
  trustReferenceLinks,
  trustSafeguards,
} from "@/lib/content/authority";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const description =
  "How inspir handles public guest learning pages, private saved chats, crawler access, learner safety, and school trust.";

export const metadata: Metadata = {
  title: "Trust And Safety",
  description,
  alternates: metadataAlternates("/trust"),
  openGraph: {
    title: "Trust And Safety | inspir",
    description,
    url: "/trust",
    siteName,
    images: [
      socialImage({
        title: "Trust And Safety",
        eyebrow: "Trust",
        description,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Trust And Safety | inspir",
    description,
    images: [
      socialImage({
        title: "Trust And Safety",
        eyebrow: "Trust",
        description,
      }).url,
    ],
  },
};

const principleIcons = [ShieldCheck, LockKeyhole, Sparkles, Search] as const;
const safeguardIcons = [Sparkles, LockKeyhole, Search, School] as const;

export default function TrustPage() {
  const jsonLd = [
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Trust and safety", url: "/trust" },
    ]),
    webPageJsonLd({
      path: "/trust",
      name: "Trust And Safety | inspir",
      description,
    }),
    itemListJsonLd({
      path: "/trust",
      id: "trust-principles",
      name: "inspir trust principles",
      items: trustPrinciples.map((principle) => ({
        name: principle.title,
        url: "/trust",
        description: principle.text,
      })),
    }),
    itemListJsonLd({
      path: "/trust",
      id: "trust-safeguards",
      name: "inspir public trust safeguards",
      items: trustSafeguards.map((safeguard) => ({
        name: safeguard.title,
        url: safeguard.href,
        description: safeguard.text,
      })),
    }),
    itemListJsonLd({
      path: "/trust",
      id: "crawler-policy",
      name: "inspir crawler and indexing policy",
      items: trustCrawlerPolicies.map((policy) => ({
        name: `${policy.name}: ${policy.status}`,
        url: "/trust#crawler-policy",
        description: policy.text,
      })),
    }),
    itemListJsonLd({
      path: "/trust",
      id: "trust-reference-links",
      name: "inspir trust reference links",
      items: trustReferenceLinks.map((link) => ({
        name: link.title,
        url: link.href,
        description: link.text,
      })),
    }),
    faqPageJsonLd({
      path: "/trust",
      questions: trustFaqs,
    }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="Trust and safety" title="Public learning should be discoverable without making private chats public.">
        inspir separates public guest learning pages from private saved conversations, so
        learners, schools, search engines, and AI answer engines can understand what is meant
        to be public.
      </MarketingPageHero>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Principles</span>
          <h2>Clear boundaries for a public AI learning platform.</h2>
          <p>
            The SEO system is designed to make useful public learning resources findable while
            keeping private user material, admin surfaces, and utility routes outside discovery.
          </p>
        </div>
        <div className="marketing-card-grid">
          {trustPrinciples.map((principle, index) => {
            const Icon = principleIcons[index] ?? ShieldCheck;
            return (
              <article key={principle.title} className="marketing-card">
                <Icon size={24} />
                <h3>{principle.title}</h3>
                <p>{principle.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>Safeguards</span>
          <h2>The practical trust layer behind guest mode.</h2>
          <p>
            These safeguards connect product behavior, private boundaries, crawler rules, and
            school deployment needs into one public explanation.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {trustSafeguards.map((safeguard, index) => {
            const Icon = safeguardIcons[index] ?? ShieldCheck;
            return (
              <Link key={safeguard.title} href={safeguard.href} className="marketing-topic-link">
                <span>
                  <Icon size={14} />
                  Trust safeguard
                </span>
                <strong>{safeguard.title}</strong>
                <p>{safeguard.text}</p>
                <small>
                  Open reference
                  <ArrowUpRight size={14} />
                </small>
              </Link>
            );
          })}
        </div>
      </section>

      <section id="crawler-policy" className="marketing-band">
        <div className="marketing-section-copy">
          <span>Crawler policy</span>
          <h2>Discovery is open where the content is public.</h2>
          <p>
            inspir supports search and AI retrieval for public learning pages. Training crawlers
            and private or operational surfaces are treated differently.
          </p>
        </div>
        <div className="marketing-card-grid">
          {trustCrawlerPolicies.map((policy) => (
            <article key={policy.name} className="learning-path-step">
              <span>{policy.status}</span>
              <h3>{policy.name}</h3>
              <p>{policy.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Reference files</span>
          <h2>The source links search systems and schools can inspect.</h2>
          <p>
            These public files explain what should be indexed, what should not, and where the
            formal policies live.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {trustReferenceLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.title}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>Questions</span>
          <h2>Trust questions for learners, schools, and crawlers.</h2>
        </div>
        <div className="marketing-faq-list">
          {trustFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Start from a public learning mode with clear boundaries.</h2>
        <div className="marketing-inline-actions">
          <Link href="/chat/learn-anything" className="marketing-primary-cta is-dark">
            Start learning
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="/topics">Browse every mode</ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
