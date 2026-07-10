import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { BookMarked, LockKeyhole, School, Sparkles } from "lucide-react";
import {
  ArrowLink,
  MarketingFooterWithChrome,
  MarketingHeaderWithChrome,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import {
  schoolDeploymentSteps,
  schoolFaqs,
  schoolFeatures,
  schoolSearchIntents,
  schoolUseCases,
} from "@/lib/content/authority";
import type { SupportedLanguage } from "@/lib/content/languages";
import { getStaticMarketingChrome } from "@/lib/i18n/marketing-chrome";
import { localizeMarketingMetadataForLanguage } from "@/lib/i18n/metadata";
import { localizeStaticSiteHref } from "@/lib/i18n/static-availability";
import { siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const pageMetadata: Metadata = {
  title: "AI Tutor For Schools",
  description:
    "White-labelled AI tutoring for schools, with guest learning modes, custom workflows, confidentiality planning, NCERT-aligned options, and funded access paths.",
  openGraph: {
    title: "AI Learning For Schools | inspir",
    description:
      "White-labelled AI tutoring for schools, with guest learning modes, custom workflows, confidentiality planning, NCERT-aligned options, and CSR sponsorship paths.",
    url: "/schools",
    siteName,
    images: [
      socialImage({
        title: "AI Learning For Schools",
        eyebrow: "Schools",
        description:
          "Tailored AI learning experiences for school communities, curriculum needs, confidentiality planning, and funded access.",
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning For Schools | inspir",
    description:
      "White-labelled AI tutoring for schools, with guest learning modes, custom workflows, confidentiality planning, NCERT-aligned options, and CSR sponsorship paths.",
    images: [
      socialImage({
        title: "AI Learning For Schools",
        eyebrow: "Schools",
        description:
          "Tailored AI learning experiences for school communities, curriculum needs, confidentiality planning, and funded access.",
      }).url,
    ],
  },
};

export function generateSchoolsMetadata(language: SupportedLanguage) {
  return localizeMarketingMetadataForLanguage(pageMetadata, "/schools", language);
}

const featureIcons = [School, LockKeyhole, BookMarked, Sparkles] as const;

export async function SchoolsPageContent({
  language,
  pathname,
}: {
  language: SupportedLanguage;
  pathname: string;
}) {
  const chrome = await getStaticMarketingChrome(pathname, language);
  const { hrefLanguage } = chrome;
  const jsonLd = [
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Schools", url: "/schools" },
    ]),
    webPageJsonLd({
      path: "/schools",
      name: "AI Learning For Schools | inspir",
      description:
        "White-labelled AI learning experiences for schools, with custom workflows, confidentiality, NCERT-aligned options, and CSR sponsorship paths.",
    }),
    itemListJsonLd({
      path: "/schools",
      id: "school-features",
      name: "inspir school deployment features",
      items: schoolFeatures.map((feature) => ({
        name: feature.title,
        url: feature.href,
        description: feature.text,
      })),
    }),
    itemListJsonLd({
      path: "/schools",
      id: "school-deployment-steps",
      name: "inspir school deployment path",
      items: schoolDeploymentSteps.map((step) => ({
        name: `${step.step}: ${step.title}`,
        url: step.href,
        description: step.text,
      })),
    }),
    itemListJsonLd({
      path: "/schools",
      id: "school-use-cases",
      name: "inspir school AI learning use cases",
      items: schoolUseCases.map((useCase) => ({
        name: useCase.title,
        url: useCase.href,
        description: useCase.text,
      })),
    }),
    itemListJsonLd({
      path: "/schools",
      id: "school-common-questions",
      name: "AI learning questions for schools",
      items: schoolSearchIntents.map((intent) => ({
        name: intent,
        url: "/schools",
      })),
    }),
    faqPageJsonLd({
      path: "/schools",
      questions: schoolFaqs,
    }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} path="/schools" language={language} />
      <MarketingHeaderWithChrome chrome={chrome} />
      <MarketingPageHero
        eyebrow="For schools"
        title="Custom AI learning spaces for every school community."
        visual="schools"
        chrome={chrome}
      >
        inspir works with schools to offer tailored AI chat experiences for students, built around
        confidentiality, curriculum needs, and the practical realities of school deployment.
      </MarketingPageHero>

      <section id="school-features" className="marketing-band">
        <div className="marketing-section-copy">
          <span>What schools get</span>
          <h2>A free-to-access AI tutor layer that can fit your institution.</h2>
          <p>
            The public inspir platform helps learners practise extracurricular activities and
            explore ideas. School deployments can be customised around each school’s content,
            workflows, and student context.
          </p>
        </div>
        <div className="marketing-card-grid">
          {schoolFeatures.map((feature, index) => {
            const Icon = featureIcons[index] ?? School;
            return (
              <article key={feature.title} className="marketing-card">
                <Icon size={24} />
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="school-deployment" className="marketing-band">
        <div className="marketing-section-copy">
          <span>Deployment path</span>
          <h2>Start with public guest mode, then shape the school version around real needs.</h2>
          <p>
            This gives school leaders a low-friction way to evaluate the learning experience before
            committing to content work, staff workflows, or funded access.
          </p>
        </div>
        <div className="marketing-card-grid">
          {schoolDeploymentSteps.map((step) => (
            <article key={step.slug} className="learning-path-step">
              <span>{step.step}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <Link href={localizeStaticSiteHref(step.href, hrefLanguage)}>Explore step</Link>
            </article>
          ))}
        </div>
      </section>

      <section id="school-use-cases" className="marketing-band">
        <div className="marketing-section-copy">
          <span>Who it helps</span>
          <h2>One AI learning system, several school jobs.</h2>
          <p>
            Students need direct support, teachers need focused learning behavior, leaders need
            responsible deployment paths, and partners need clear ways to fund access.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {schoolUseCases.map((useCase) => (
            <Link key={useCase.title} href={localizeStaticSiteHref(useCase.href, hrefLanguage)} className="marketing-topic-link">
              <span>Use case</span>
              <strong>{useCase.title}</strong>
              <p>{useCase.text}</p>
              <small>Open related resource</small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-split-band">
        <div>
          <span className="marketing-kicker dark">Distribution that started offline</span>
          <h2>Built through real school and university networks.</h2>
          <p>
            inspir’s go-to-market grew from an existing offline network of schools and
            universities that had already engaged with extracurricular programmes and student
            events. That network helped inspir reach more than one million users across the
            free platform and partner schools.
          </p>
        </div>
        <div className="marketing-school-panel">
          <strong>For school leaders</strong>
          <span>Student AI chat</span>
          <span>Custom content</span>
          <span>CSR sponsorship paths</span>
          <span>No forms required</span>
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Common questions</span>
          <h2>Simple paths from public guest mode to school deployment.</h2>
          <p>
            Schools can start by trying the public modes, then move toward a tailored version
            when they need custom workflows, content alignment, or funded access.
          </p>
        </div>
        <div className="marketing-faq-list">
          {schoolFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="school-contact" className="marketing-cta-band">
        <h2>Try the platform, then talk to us about a school version.</h2>
        <div className="marketing-inline-actions">
          <a href="mailto:schools@inspirlearning.com" className="marketing-primary-cta is-dark">
            schools@inspirlearning.com
            <Sparkles size={18} />
          </a>
          <ArrowLink href="/topics" hrefLanguage={hrefLanguage}>Try public modes</ArrowLink>
        </div>
      </section>

      <MarketingFooterWithChrome chrome={chrome} />
    </main>
  );
}
