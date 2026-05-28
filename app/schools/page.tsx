import type { Metadata } from "next";
import Link from "next/link";
import { BookMarked, LockKeyhole, School, Sparkles } from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "Schools",
  description:
    "White-labelled AI learning experiences for schools, with custom workflows, data confidentiality, and NCERT-aligned options.",
  alternates: { canonical: "/schools" },
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

export default function SchoolsPage() {
  return (
    <main className="marketing-site">
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
