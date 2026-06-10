import type { Metadata } from "next";
import { LocalizedLink as Link } from "@/components/i18n/LocalizedLink";
import { ArrowUpRight, BookOpenCheck, Library, Route } from "lucide-react";
import { MarketingFooter, MarketingHeader, MarketingPageHero } from "@/components/marketing/MarketingShell";
import { getBlogCategories, getBlogPosts } from "@/lib/content/blog";
import { blogHubFaqs, getBlogPillarClusters } from "@/lib/content/blog-directory";
import { topicSeeds } from "@/lib/content/topics";
import { localizeMarketingMetadata } from "@/lib/i18n/metadata";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { JsonLdScripts } from "@/components/seo/JsonLdScripts";
import { formatMediumDate } from "@/lib/utils/dates";
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  itemListJsonLd,
  webPageJsonLd,
} from "@/lib/seo/json-ld";

const corePostSlugs = new Set([
  "ai-learning-companion-for-everyone",
  "how-to-study-with-ai-without-cheating-yourself",
  "socratic-ai-tutor",
  "talk-to-historical-figures-with-ai",
  "ai-flashcards-and-active-recall",
]);

const blogDescription =
  "Explore 100+ AI learning guides, prompt loops, and study workflows for tutoring, active recall, homework help, writing feedback, coding, and exam prep.";

const pageMetadata: Metadata = {
  title: "AI Learning Blog",
  description: blogDescription,
  alternates: metadataAlternates("/blog"),
  openGraph: {
    title: "AI Learning Blog | inspir",
    description: blogDescription,
    url: "/blog",
    siteName,
    images: [
      socialImage({
        title: "AI Learning Blog",
        eyebrow: "Guides",
        description: blogDescription,
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning Blog | inspir",
    description: blogDescription,
    images: [
      socialImage({
        title: "AI Learning Blog",
        eyebrow: "Guides",
        description: blogDescription,
      }).url,
    ],
  },
};

export function generateMetadata() {
  return localizeMarketingMetadata(pageMetadata, "/blog");
}

export default function BlogIndexPage() {
  const posts = getBlogPosts();
  const categories = getBlogCategories().slice(0, 12);
  const pillarClusters = getBlogPillarClusters(posts);
  const corePosts = posts.filter((post) => corePostSlugs.has(post.slug));
  const topicPosts = posts.filter((post) => !corePostSlugs.has(post.slug));
  const jsonLd = [
    webPageJsonLd({
      path: "/blog",
      name: "AI Learning Blog",
      description:
        "A crawlable guide library for AI tutoring, study skills, prompt loops, active recall, public learning modes, and practical AI-assisted learning.",
      type: "CollectionPage",
    }),
    breadcrumbJsonLd([
      { name: "Home", url: "/" },
      { name: "Blog", url: "/blog" },
    ]),
    itemListJsonLd({
      path: "/blog",
      id: "pillar-clusters",
      name: "AI learning blog pillar clusters",
      items: pillarClusters.map((cluster) => ({
        name: cluster.title,
        url: `/blog#${cluster.slug}`,
        description: cluster.description,
      })),
    }),
    itemListJsonLd({
      path: "/blog",
      id: "core-guides",
      name: "Core AI learning guides",
      items: corePosts.map((post) => ({
        name: post.title,
        url: `/blog/${post.slug}`,
        description: post.description,
      })),
    }),
    itemListJsonLd({
      path: "/blog",
      id: "complete-guide-library",
      name: "Complete AI learning guide library",
      items: posts.map((post) => ({
        name: post.title,
        url: `/blog/${post.slug}`,
        description: post.description,
      })),
    }),
    faqPageJsonLd({ path: "/blog", questions: blogHubFaqs }),
  ];

  return (
    <main className="marketing-site">
      <JsonLdScripts items={jsonLd} />
      <MarketingHeader />
      <MarketingPageHero eyebrow="Blog" title="Better ways to learn with AI.">
        {posts.length} guides for tutoring, memory, active practice, historical roleplay,
        homework help, writing feedback, coding, and learning without becoming passive.
      </MarketingPageHero>

      <section className="marketing-band is-blog-library">
        <div className="blog-hub-stats" aria-label="Blog library summary">
          <div>
            <Library size={20} />
            <strong>{posts.length} guides</strong>
            <span>Articles, mode guides, and prompt loops</span>
          </div>
          <div>
            <Route size={20} />
            <strong>{topicSeeds.length} live modes</strong>
            <span>Public guest chats linked from guides</span>
          </div>
          <div>
            <BookOpenCheck size={20} />
            <strong>{categories.length} themes</strong>
            <span>Topic clusters for search and browsing</span>
          </div>
        </div>
      </section>

      <section className="marketing-band is-blog-pillars">
        <div className="marketing-section-copy">
          <span>Pillar clusters</span>
          <h2>Start from a learning job, then move into practice.</h2>
          <p>
            These clusters keep the library useful for learners and legible for search:
            each theme connects cornerstone articles, a blog category, and a live learning mode.
          </p>
        </div>
        <div className="blog-pillar-grid">
          {pillarClusters.map((cluster) => (
            <article key={cluster.slug} id={cluster.slug} className="blog-pillar-card">
              <span>{cluster.audience}</span>
              <h3>{cluster.title}</h3>
              <p>{cluster.description}</p>
              <div className="blog-pillar-actions">
                <Link href={cluster.categoryHref}>
                  {cluster.categoryLabel}
                  <ArrowUpRight size={14} />
                </Link>
                <Link href={cluster.modeHref}>
                  Open {cluster.modeLabel}
                  <ArrowUpRight size={14} />
                </Link>
              </div>
              <div className="blog-pillar-guides">
                {cluster.guides.slice(0, 4).map((guide) => (
                  <Link key={guide.slug} href={guide.href}>
                    <strong>{guide.title}</strong>
                    <small>{guide.relatedMode ? guide.relatedMode.name : "Learning guide"}</small>
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-band is-discovery">
        <div className="marketing-section-copy">
          <span>Explore by theme</span>
          <h2>Find the right guide faster.</h2>
          <p>
            The blog is organized around study methods, prompt loops, and the public AI learning
            modes people can use immediately.
          </p>
        </div>
        <div className="blog-category-strip">
          {categories.map((category) => (
            <Link key={category.slug} href={`/blog/category/${category.slug}`} className="blog-category-chip">
              <strong>{category.name}</strong>
              <span>{category.count} articles</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Core guides</span>
          <h2>Practical learning ideas, not hype.</h2>
          <p>
            Each article is written to help learners, parents, educators, and builders use AI
            for understanding, practice, and confidence.
          </p>
        </div>
        <div className="marketing-repo-grid">
          {corePosts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="marketing-repo-card blog-card">
              <time dateTime={post.date}>{formatMediumDate(post.date)}</time>
              <strong>{post.title}</strong>
              <span>{post.description}</span>
              <small>
                Read article
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band is-topic-library">
        <div className="marketing-section-copy">
          <span>Topic library</span>
          <h2>Every public learning mode has guides and prompt loops.</h2>
          <p>
            These guides answer specific learning questions and link directly into the matching
            guest chat experience.
          </p>
        </div>
        <div className="marketing-topic-grid">
          {topicPosts.map((post) => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="marketing-topic-link blog-card">
              <time dateTime={post.date}>
                {formatMediumDate(post.date)}
              </time>
              <strong>{post.title}</strong>
              <p>{post.description}</p>
              <small>
                Read article
                <ArrowUpRight size={14} />
              </small>
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-band is-blog-faq">
        <div className="marketing-section-copy">
          <span>How to use the guide library</span>
          <h2>Read one thing, then do the next thing.</h2>
          <p>
            The blog should not be a dead end. Every cluster is designed to move a learner
            from advice into a mode, prompt loop, quiz, flashcard set, or revision habit.
          </p>
        </div>
        <div className="marketing-mode-faq-list">
          {blogHubFaqs.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="marketing-cta-band">
        <h2>Ready to try the learning modes?</h2>
        <Link href="/chat/learn-anything" className="marketing-primary-cta is-dark">
          Start learning
          <ArrowUpRight size={18} />
        </Link>
      </section>

      <MarketingFooter />
    </main>
  );
}
