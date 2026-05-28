import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MarketingFooter, MarketingHeader, MarketingPageHero } from "@/components/marketing/MarketingShell";
import { getBlogPosts } from "@/lib/content/blog";
import { defaultSocialImage, siteName } from "@/lib/seo/config";
import { breadcrumbJsonLd, serializeJsonLd } from "@/lib/seo/json-ld";

export const metadata: Metadata = {
  title: "AI Learning Blog",
  description:
    "Practical notes on AI tutoring, active recall, Socratic learning, study skills, and accessible education.",
  alternates: { canonical: "/blog" },
  openGraph: {
    title: "AI Learning Blog | inspir",
    description:
      "Practical notes on AI tutoring, active recall, Socratic learning, study skills, and accessible education.",
    url: "/blog",
    siteName,
    images: [defaultSocialImage],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Learning Blog | inspir",
    description:
      "Practical notes on AI tutoring, active recall, Socratic learning, study skills, and accessible education.",
    images: [defaultSocialImage.url],
  },
};

export default function BlogIndexPage() {
  const posts = getBlogPosts();
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

      <section className="marketing-band">
        <div className="marketing-section-copy">
          <span>Latest guides</span>
          <h2>Practical learning ideas, not hype.</h2>
          <p>
            Each article is written to help learners, parents, educators, and builders use AI
            for understanding, practice, and confidence.
          </p>
        </div>
        <div className="marketing-repo-grid">
          {posts.map((post) => (
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
