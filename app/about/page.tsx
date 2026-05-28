import type { Metadata } from "next";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "About",
  description:
    "The story of inspir, from Facebook quizzes and student communities to a free AI learning platform built in public.",
  alternates: { canonical: "/about" },
};

const timeline = [
  {
    year: "2013",
    title: "A learning community begins",
    text: "inspir started as a Facebook page publishing quizzes and building a habit of extracurricular learning.",
  },
  {
    year: "2014-2021",
    title: "Offline networks and student events",
    text: "The community expanded through schools, universities, competitions, extracurricular programmes, and learner communities.",
  },
  {
    year: "2022",
    title: "AI learning infrastructure",
    text: "The platform worked on curriculum ingestion, retrieval, structured learning flows, and early AI tutoring experiences.",
  },
  {
    year: "Late 2022",
    title: "Consumer AI launch",
    text: "inspir went live as a consumer-facing AI learning product within weeks of ChatGPT’s public release.",
  },
  {
    year: "2023-2025",
    title: "From inspir.app to inspirlearning.com",
    text: "After the inspir.app domain was sold to fund continued free access, the live product moved to inspirlearning.com.",
  },
  {
    year: "Now",
    title: "Built in public",
    text: "The next phase is open-source, contributor-friendly, and connected to the wider international buildout at inspir.uk.",
  },
] as const;

export default function AboutPage() {
  return (
    <main className="marketing-site">
      <MarketingHeader />
      <MarketingPageHero eyebrow="About inspir" title="Learning is for everyone, and AI should make that more true.">
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
          {timeline.map((item) => (
            <article key={`${item.year}-${item.title}`} className="marketing-timeline-item">
              <time>{item.year}</time>
              <div>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
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

      <MarketingFooter />
    </main>
  );
}
