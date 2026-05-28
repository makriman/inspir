import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MarketingFooter, MarketingHeader, MarketingPageHero } from "@/components/marketing/MarketingShell";
import { getBlogCategories, getBlogPosts } from "@/lib/content/blog";
import { metadataAlternates, siteName, socialImage } from "@/lib/seo/config";
import { breadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/json-ld";

const corePostSlugs = new Set([
  "ai-learning-companion-for-everyone",
  "how-to-study-with-ai-without-cheating-yourself",
  "socratic-ai-tutor",
  "talk-to-historical-figures-with-ai",
  "ai-flashcards-and-active-recall",
]);

export const metadata: Metadata = {
  title: "AI Learning Blog",
  description:
    "Practical notes on AI tutoring, active recall, Socratic learning, study skills, and accessible education.",
  alternates: metadataAlternates("/blog"),
  openGraph: {
    title: "AI Learning Blog | inspir",
    description:
      "Practical notes on AI tutoring, active recall, Socratic learning, study skills, and accessible education.",
    url: "/blog",
    siteName,
    images: [
      socialImage({
        title: "AI Learning Blog",
        eyebrow: "Guides",
        description: "Practical notes on AI tutoring, active recall, Socratic learning, and study skills.",
      }),
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning Blog | inspir",
    description:
      "Practical notes on AI tutoring, active recall, Socratic learning, study skills, and accessible education.",
    images: [
      socialImage({
        title: "AI Learning Blog",
        eyebrow: "Guides",
        description: "Practical notes on AI tutoring, active recall, Socratic learning, and study skills.",
      }).url,
    ],
  },
};

export default function BlogIndexPage() {
  const posts = getBlogPosts();
  const categories = getBlogCategories().slice(0, 12);
  const corePosts = posts.filter((post) => corePostSlugs.has(post.slug));
  const topicPosts = posts.filter((post) => !corePostSlugs.has(post.slug));
  const jsonLd = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Blog", url: "/blog" },
  ]);

  return (
    <main className="marketing-site">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <MarketingHeader />
      <MarketingPageHero eyebrow="Blog" title="Better ways to learn with AI.">
        Notes on tutoring, memory, active practice, historical roleplay, and making learning
        more accessible without making learners passive.
      </MarketingPageHero>

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
              <time dateTime={post.date}>{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(post.date))}</time>
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
                {new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(post.date))}
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
