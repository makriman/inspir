import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  BrainCircuit,
  CornerDownRight,
  Route,
  SearchCheck,
  Sparkles,
} from "lucide-react";
import {
  ArrowLink,
  MarketingFooter,
  MarketingHeader,
  MarketingPageHero,
} from "@/components/marketing/MarketingShell";
import {
  getLearningMapWorkflows,
  learningMapFaqs,
  learningMapSearchIntents,
} from "@/lib/content/learning-map";
import { absoluteUrl, metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const description =
  "A crawlable map of AI learning workflows that connects public guest modes, prompt starters, learning paths, and practical guides.";

export const metadata: Metadata = {
  title: "AI Learning Map",
  description,
  alternates: metadataAlternates("/ai-learning-map"),
  openGraph: {
    title: "AI Learning Map | inspir",
    description,
    url: "/ai-learning-map",
    siteName,
    images: [
      socialImage({
        title: "AI Learning Map",
        eyebrow: "Study workflows",
        description,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning Map | inspir",
    description,
    images: [
      socialImage({
        title: "AI Learning Map",
        eyebrow: "Study workflows",
        description,
      }).url,
    ],
  },
};

function workflowHowToJsonLd(workflows: ReturnType<typeof getLearningMapWorkflows>) {
  return workflows.map((workflow) => {
    const firstMode = workflow.modes[0];
    const firstPrompt = workflow.prompts[0];
    const firstGuide = workflow.guides[0];

    return {
      "@context": "https://schema.org",
      "@type": "HowTo",
      "@id": `${absoluteUrl("/ai-learning-map")}#${workflow.slug}-how-to`,
      name: workflow.title,
      description: workflow.description,
      step: [
        {
          "@type": "HowToStep",
          position: 1,
          name: "Choose the workflow",
          text: workflow.audience,
          url: absoluteUrl(`/ai-learning-map#${workflow.slug}`),
        },
        {
          "@type": "HowToStep",
          position: 2,
          name: "Open the live mode",
          text: firstMode?.description ?? workflow.description,
          url: absoluteUrl(firstMode?.href ?? "/topics"),
        },
        {
          "@type": "HowToStep",
          position: 3,
          name: "Use a prompt starter",
          text: firstPrompt?.prompt ?? workflow.outcome,
          url: absoluteUrl(firstPrompt?.href ?? "/prompts"),
        },
        {
          "@type": "HowToStep",
          position: 4,
          name: "Read a guide and review",
          text: workflow.reviewLoop.join(" "),
          url: absoluteUrl(firstGuide?.href ?? "/blog"),
        },
      ],
    };
  });
}

export default function AiLearningMapPage() {
  const workflows = getLearningMapWorkflows();
  const mappedModes = Array.from(
    new Map(
      workflows.flatMap((workflow) => workflow.modes.map((mode) => [mode.href, mode] as const)),
    ).values(),
  );
  const jsonLd = [
    webPageJsonLd({
      path: "/ai-learning-map",
      name: "AI Learning Map | inspir",
      description,
      type: "CollectionPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "AI learning map", url: "/ai-learning-map" },
    ]),
    itemListJsonLd({
      path: "/ai-learning-map",
      id: "learning-workflows",
      name: "AI learning workflows",
      items: workflows.map((workflow) => ({
        name: workflow.title,
        url: workflow.href,
        description: workflow.description,
      })),
    }),
    itemListJsonLd({
      path: "/ai-learning-map",
      id: "search-intents",
      name: "AI learning map search intents",
      items: learningMapSearchIntents.map((intent) => ({
        name: intent,
        url: "/ai-learning-map",
      })),
    }),
    itemListJsonLd({
      path: "/ai-learning-map",
      id: "mapped-public-modes",
      name: "Public AI learning modes in the learning map",
      items: mappedModes.map((mode) => ({
        name: mode.name,
        url: mode.href,
        description: mode.description,
      })),
    }),
    faqPageJsonLd({ path: "/ai-learning-map", questions: learningMapFaqs }),
    ...workflowHowToJsonLd(workflows),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="AI learning map" title="One map for modes, prompts, paths, and guides.">
        Pick the learning job first, then jump into the right public guest mode, starter
        prompt, study path, or guide without hunting through a generic chatbot.
      </MarketingPageHero>

      <section className="marketing-band is-topic-finder">
        <div className="marketing-section-copy">
          <span>{workflows.length} linked workflows</span>
          <h2>The fastest route from search intent to learning action.</h2>
          <p>
            Each map card connects a real learner need to live modes, prompt starters,
            deeper guides, and a review loop. People can use it. Crawlers can understand it.
          </p>
        </div>
        <div className="marketing-mode-finder-grid">
          {workflows.map((workflow) => (
            <Link key={workflow.slug} href={workflow.href} className="marketing-mode-finder-card">
              <span>{workflow.kicker}</span>
              <strong>{workflow.title}</strong>
              <p>{workflow.description}</p>
              <small>
                Open workflow
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Search intent</span>
          <h2>Built around the searches learners actually make.</h2>
          <p>
            The map is the connective tissue between AI tutor searches, homework help,
            study prompts, learning paths, and the public chat modes that answer those needs.
          </p>
        </div>
        <div className="learning-path-mode-list">
          {learningMapSearchIntents.map((intent) => (
            <Link key={intent} href="/ai-learning-map">
              {intent}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Workflow directory</span>
          <h2>Move from a goal to a live learning loop.</h2>
          <p>
            Every workflow below is hand-linked to public pages: a path when one exists,
            the best live modes, prompt starters, related guides, and a review rhythm.
          </p>
        </div>
        <div className="marketing-mode-directory">
          {workflows.map((workflow) => (
            <section
              key={workflow.slug}
              id={workflow.slug}
              className="marketing-mode-category"
              aria-labelledby={`workflow-${workflow.slug}`}
            >
              <div className="marketing-mode-category-header">
                <div>
                  <span>{workflow.kicker}</span>
                  <h3 id={`workflow-${workflow.slug}`}>{workflow.title}</h3>
                  <p>{workflow.description}</p>
                </div>
                <strong>{workflow.modes.length} modes</strong>
              </div>
              <div className="marketing-mode-category-summary">
                <div>
                  <BrainCircuit size={18} />
                  <span>{workflow.audience}</span>
                </div>
                <div>
                  <SearchCheck size={18} />
                  <span>{workflow.searchIntents.join(" | ")}</span>
                </div>
              </div>

              {workflow.path ? (
                <div className="learning-path-step-grid">
                  <article className="learning-path-step">
                    <span>
                      <Route size={16} />
                      Learning path
                    </span>
                    <h3>{workflow.path.title}</h3>
                    <p>{workflow.path.description}</p>
                    <Link href={workflow.path.href}>
                      Open path
                      <ArrowUpRight size={15} />
                    </Link>
                  </article>
                  <article className="learning-path-step">
                    <span>
                      <Sparkles size={16} />
                      Outcome
                    </span>
                    <h3>What this workflow should leave behind</h3>
                    <p>{workflow.outcome}</p>
                    <Link href={workflow.modes[0]?.href ?? "/topics"}>
                      Start the first mode
                      <ArrowUpRight size={15} />
                    </Link>
                  </article>
                </div>
              ) : (
                <div className="learning-path-step-grid">
                  <article className="learning-path-step">
                    <span>
                      <Sparkles size={16} />
                      Outcome
                    </span>
                    <h3>What this workflow should leave behind</h3>
                    <p>{workflow.outcome}</p>
                    <Link href={workflow.modes[0]?.href ?? "/topics"}>
                      Start the first mode
                      <ArrowUpRight size={15} />
                    </Link>
                  </article>
                </div>
              )}

              <div className="marketing-topic-grid">
                {workflow.modes.map((mode) => (
                  <Link key={mode.slug} href={mode.href} className="marketing-topic-link">
                    <span>{mode.uiMode.replaceAll("-", " ")}</span>
                    <strong>{mode.name}</strong>
                    <p>{mode.description}</p>
                    {mode.starterPrompts.length ? (
                      <ul>
                        {mode.starterPrompts.map((starter) => (
                          <li key={starter}>{starter}</li>
                        ))}
                      </ul>
                    ) : null}
                    <small>
                      Open mode
                      <ArrowUpRight size={14} />
                    </small>
                  </Link>
                ))}
                {workflow.prompts.slice(0, 4).map((prompt) => (
                  <Link key={prompt.id} href={prompt.href} className="marketing-topic-link">
                    <span>Prompt starter</span>
                    <strong>{prompt.topicName}</strong>
                    <p>{prompt.prompt}</p>
                    <small>
                      Use prompt
                      <ArrowUpRight size={14} />
                    </small>
                  </Link>
                ))}
                {workflow.guides.map((guide) => (
                  <Link key={guide.slug} href={guide.href} className="marketing-topic-link">
                    <span>Guide</span>
                    <strong>{guide.title}</strong>
                    <p>{guide.description}</p>
                    <small>
                      Read guide
                      <ArrowUpRight size={14} />
                    </small>
                  </Link>
                ))}
              </div>

              <div className="learning-path-step-grid">
                {workflow.reviewLoop.map((step, index) => (
                  <article key={step} className="learning-path-step">
                    <span>
                      <CornerDownRight size={16} />
                      Review {index + 1}
                    </span>
                    <h3>{step}</h3>
                    <p>
                      Keep the session active by ending with evidence of understanding,
                      not just a finished answer.
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="marketing-band is-home-faq">
        <div className="marketing-section-copy">
          <span>Learning map FAQ</span>
          <h2>A public map for learners and answer engines.</h2>
        </div>
        <div className="marketing-faq-list">
          {learningMapFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Start with the broadest learning mode.</h2>
        <div className="marketing-inline-actions">
          <Link href="/chat/learn-anything" className="marketing-primary-cta is-dark">
            Start learning
            <Sparkles size={18} />
          </Link>
          <ArrowLink href="/prompts">Browse prompts</ArrowLink>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
