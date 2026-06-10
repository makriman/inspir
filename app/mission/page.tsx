import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import {
  BookOpenCheck,
  BrainCircuit,
  Globe2,
  HeartHandshake,
  Sparkles,
  UsersRound,
} from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import { authorityReferenceLinks, missionFaqs, missionPrinciples } from "@/lib/content/authority";
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
  title: "Mission",
  description:
    "inspir's mission is to make learning accessible, engaging, enjoyable, and useful for everyone through free public AI learning tools.",
  alternates: metadataAlternates("/mission"),
  openGraph: {
    title: "Mission | inspir",
    description:
      "Learning should be free, fun, useful, and available to anyone with curiosity.",
    url: "/mission",
    siteName,
    images: [
      socialImage({
        title: "Learning is for everyone",
        eyebrow: "Mission",
        description: "Free, useful, engaging AI learning tools for anyone with curiosity.",
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Mission | inspir",
    description:
      "Learning should be free, fun, useful, and available to anyone with curiosity.",
    images: [
      socialImage({
        title: "Learning is for everyone",
        eyebrow: "Mission",
        description: "Free, useful, engaging AI learning tools for anyone with curiosity.",
      }).url,
    ],
  },
};

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/mission");
}

const principles = [
  {
    icon: HeartHandshake,
    title: "Access first",
    text: "A capable learning companion should not depend on geography, family income, or whether a learner already knows the right person to ask.",
  },
  {
    icon: BookOpenCheck,
    title: "Understanding over answers",
    text: "The platform is designed to help people reason, practise, remember, and explain ideas back instead of collecting finished answers.",
  },
  {
    icon: BrainCircuit,
    title: "AI with a learning shape",
    text: "Different jobs need different modes: Socratic questions, homework hints, flashcards, debate, history roleplay, writing critique, and more.",
  },
  {
    icon: Globe2,
    title: "Built for scale",
    text: "The public product gives anyone a place to start while school and partner deployments can adapt the experience for local needs.",
  },
] as const;

const proof = [
  "Started as public quizzes and student communities in 2013.",
  "Reached learners across the free platform and partner schools.",
  "Now rebuilt as open, guest-friendly AI learning entrypoints.",
] as const;

export default function MissionPage() {
  const jsonLd = [
    webPageJsonLd({
      path: "/mission",
      name: "Mission | inspir",
      description:
        "inspir's mission is to make learning accessible, engaging, enjoyable, and useful through free public AI learning tools and school-ready learning spaces.",
      type: "AboutPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Mission", url: "/mission" },
    ]),
    itemListJsonLd({
      path: "/mission",
      id: "mission-principles",
      name: "inspir mission principles",
      items: missionPrinciples.map((principle) => ({
        name: principle.title,
        url: "/mission",
        description: principle.text,
      })),
    }),
    itemListJsonLd({
      path: "/mission",
      id: "authority-reference-links",
      name: "inspir public authority reference links",
      items: authorityReferenceLinks.map((link) => ({
        name: link.title,
        url: link.href,
        description: link.text,
      })),
    }),
    faqPageJsonLd({ path: "/mission", questions: missionFaqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="Mission" title="Learning is for everyone.">
        inspir exists to make learning accessible, engaging, enjoyable, and useful for anyone
        with curiosity, whether they are a student, parent, teacher, or self-taught learner.
      </MarketingPageHero>

      <section className="marketing-band marketing-impact-band">
        <div className="mission-manifesto">
          <span>What we believe</span>
          <h2>Quality learning should feel available, human, and alive.</h2>
          <p>
            The goal is not to make people passive in front of AI. The goal is to give every
            learner a patient first place to ask, practise, get feedback, try again, and build
            confidence.
          </p>
        </div>
      </section>

      <section className="marketing-band is-intro">
        <div className="marketing-section-copy">
          <span>Why now</span>
          <h2>AI can make one-to-one learning dramatically more available.</h2>
          <p>
            Private tutoring is powerful, but it is unevenly distributed. inspir uses AI to
            widen access while keeping the learner active: hints before answers, questions
            before lectures, and practice after explanation.
          </p>
          <div className="marketing-inline-actions">
            <ArrowLink href="/topics">Browse learning modes</ArrowLink>
            <ArrowLink href="/blog/how-to-study-with-ai-without-cheating-yourself">
              Study with AI well
            </ArrowLink>
          </div>
        </div>
        <div className="marketing-proof-grid">
          {proof.map((item) => (
            <div key={item}>
              <Sparkles size={20} />
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Principles</span>
          <h2>The product should teach, not just answer.</h2>
          <p>
            Every public mode is a doorway into a different learning behavior, so the format
            can match the job instead of forcing every learner into one generic chat box.
          </p>
        </div>
        <div className="marketing-card-grid">
          {principles.map((principle) => {
            const Icon = principle.icon;
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

      <section className="marketing-band is-mission-authority">
        <div className="marketing-section-copy">
          <span>Public evidence</span>
          <h2>The mission is connected to real product surfaces.</h2>
          <p>
            These pages make the story easier to verify, cite, crawl, and use: public modes,
            learning paths, long-form guides, school deployment notes, media facts, and the
            company background.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {authorityReferenceLinks.map((link) => (
            <Link key={link.href} href={link.href} className="marketing-topic-link">
              <span>Reference page</span>
              <strong>{link.title}</strong>
              <p>{link.text}</p>
              <small>
                Open reference
                <Sparkles size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-split-band">
        <div>
          <span className="marketing-kicker dark">Public value</span>
          <h2>Free guest learning, with paths for schools and partners.</h2>
          <p>
            The public product stays easy to try: learners can land directly on a learning mode
            and begin as a guest. Schools and CSR partners can support tailored deployments
            when communities need confidentiality, curriculum alignment, or subsidised access.
          </p>
          <div className="marketing-inline-actions">
            <ArrowLink href="/schools">Schools and CSR</ArrowLink>
            <ArrowLink href="/media">Media notes</ArrowLink>
          </div>
        </div>
        <div className="marketing-school-panel" aria-hidden="true">
          <UsersRound size={34} />
          <strong>Built around real learners</strong>
          <span>Guest mode for public access</span>
          <span>Mode-specific learning flows</span>
          <span>School deployment paths</span>
        </div>
      </section>

      <section className="marketing-band is-mission-faq">
        <div className="marketing-section-copy">
          <span>Mission FAQ</span>
          <h2>Clear answers for learners, schools, and search systems.</h2>
          <p>
            The public product, the school pathway, and the content library should all point
            back to the same principle: learning should stay active, accessible, and useful.
          </p>
        </div>
        <div className="marketing-faq-list">
          {missionFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Start with the public learning companion.</h2>
        <div className="marketing-inline-actions">
          <Link href="/chat/learn-anything" className="marketing-primary-cta is-dark">
            Start learning
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="/topics">See every mode</ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
