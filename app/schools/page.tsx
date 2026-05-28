import type { Metadata } from "next";
import Link from "next/link";
import { BookMarked, LockKeyhole, School, Sparkles } from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  serializeJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

export const metadata: Metadata = {
  title: "Schools",
  description:
    "White-labelled AI learning experiences for schools, with custom workflows, data confidentiality, and NCERT-aligned options.",
  alternates: metadataAlternates("/schools"),
  openGraph: {
    title: "AI Learning For Schools | inspir",
    description:
      "White-labelled AI learning experiences for schools, with custom workflows, confidentiality, NCERT-aligned options, and CSR sponsorship paths.",
    url: "/schools",
    siteName,
    images: [
      socialImage({
        title: "AI Learning For Schools",
        eyebrow: "Schools",
        description:
          "Tailored AI learning experiences for school communities, curriculum needs, confidentiality, and funded access.",
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning For Schools | inspir",
    description:
      "White-labelled AI learning experiences for schools, with custom workflows, confidentiality, NCERT-aligned options, and CSR sponsorship paths.",
    images: [
      socialImage({
        title: "AI Learning For Schools",
        eyebrow: "Schools",
        description:
          "Tailored AI learning experiences for school communities, curriculum needs, confidentiality, and funded access.",
      }).url,
    ],
  },
};

const schoolFeatures = [
  {
    icon: School,
    title: "White-labelled AI chat",
    text: "A school-specific learning experience that feels like part of your own student ecosystem.",
  },
  {
    icon: LockKeyhole,
    title: "Data confidentiality",
    text: "Deployments are designed around confidentiality for school communities and student use.",
  },
  {
    icon: BookMarked,
    title: "NCERT-aligned options",
    text: "Custom content and workflows can be aligned to NCERT needs and school-specific priorities.",
  },
  {
    icon: Sparkles,
    title: "Funded access",
    text: "AI usage can be funded by partner schools or subsidised through CSR sponsorship.",
  },
] as const;

const schoolFaqs = [
  {
    question: "Can a school use inspir as a guest learning tool first?",
    answer:
      "Yes. The public guest modes let school leaders and teachers try the learning experience before discussing a tailored school deployment.",
  },
  {
    question: "Can inspir support school-specific content or curriculum needs?",
    answer:
      "School deployments can be adapted around custom content, workflows, and NCERT-aligned learning needs where appropriate.",
  },
  {
    question: "How can access be funded for learners?",
    answer:
      "Access can be funded by partner schools or supported through CSR sponsorship paths for communities that need subsidised AI learning.",
  },
] as const;

export default function SchoolsPage() {
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
        url: "/schools",
        description: feature.text,
      })),
    }),
    faqPageJsonLd({
      path: "/schools",
      questions: schoolFaqs,
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
      <MarketingPageHero eyebrow="For schools" title="Custom AI learning spaces for every school community.">
        inspir works with schools to offer tailored AI chat experiences for students, built around
        confidentiality, curriculum needs, and the practical realities of school deployment.
      </MarketingPageHero>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>What schools get</span>
          <h2>A free-to-access learning layer that can fit your institution.</h2>
          <p>
            The public inspir platform helps learners practise extracurricular activities and
            explore ideas. School deployments can be customised around each school’s content,
            workflows, and student context.
          </p>
        </div>
        <div className="marketing-card-grid">
          {schoolFeatures.map((feature) => {
            const Icon = feature.icon;
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

      <section className="marketing-cta-band">
        <h2>Try the platform, then talk to us about a school version.</h2>
        <div className="marketing-inline-actions">
          <Link href="/chat/learn-anything" className="marketing-primary-cta is-dark">
            Try platform
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
