import { getBlogPosts } from "@/lib/content/blog";
import { topicSeeds } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";
import { absoluteUrl, siteDescription, siteName, siteUrl } from "@/lib/seo/config";

export const dynamic = "force-static";

export function GET() {
  const lines = [
    `# ${siteName}`,
    "",
    siteDescription,
    "",
    "## Core pages",
    `- Home: ${siteUrl}`,
    `- Mission: ${absoluteUrl("/mission")}`,
    `- Schools: ${absoluteUrl("/schools")}`,
    `- Media: ${absoluteUrl("/media")}`,
    `- About: ${absoluteUrl("/about")}`,
    `- Blog: ${absoluteUrl("/blog")}`,
    "",
    "## Public AI learning modes",
    ...topicSeeds.map((topic) => `- ${topic.name}: ${absoluteUrl(topicPath(topic.slug))}`),
    "",
    "## Blog posts",
    ...getBlogPosts().map((post) => `- ${post.title}: ${absoluteUrl(`/blog/${post.slug}`)}`),
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
