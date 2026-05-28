import type { BlogPost } from "@/lib/content/blog";
import { absoluteUrl, siteDescription, siteName, socialImage } from "@/lib/seo/config";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatRssDate(value: string) {
  return new Date(value).toUTCString();
}

function itemXml(post: BlogPost) {
  const url = absoluteUrl(`/blog/${post.slug}`);
  const date = formatRssDate(post.updated ?? post.date);
  const categories = post.tags
    .map((tag) => `    <category>${escapeXml(tag)}</category>`)
    .join("\n");

  return `  <item>
    <title>${escapeXml(post.title)}</title>
    <link>${url}</link>
    <guid isPermaLink="true">${url}</guid>
    <description>${escapeXml(post.description)}</description>
    <pubDate>${date}</pubDate>
${categories}
  </item>`;
}

export function buildRssFeed(posts: BlogPost[]) {
  const sortedPosts = [...posts].sort((a, b) => b.date.localeCompare(a.date));
  const lastBuildDate = formatRssDate(sortedPosts[0]?.updated ?? sortedPosts[0]?.date ?? new Date().toISOString());

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeXml(`${siteName} AI Learning Blog`)}</title>
  <link>${absoluteUrl("/blog")}</link>
  <atom:link href="${absoluteUrl("/rss.xml")}" rel="self" type="application/rss+xml" />
  <description>${escapeXml(siteDescription)}</description>
  <language>en-us</language>
  <lastBuildDate>${lastBuildDate}</lastBuildDate>
  <image>
    <url>${escapeXml(socialImage({ title: "AI Learning Blog", eyebrow: "Guides" }).url)}</url>
    <title>${escapeXml(`${siteName} AI Learning Blog`)}</title>
    <link>${absoluteUrl("/blog")}</link>
  </image>
${sortedPosts.map(itemXml).join("\n")}
</channel>
</rss>`;
}
