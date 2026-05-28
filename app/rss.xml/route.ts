import { getBlogPosts } from "@/lib/content/blog";
import { buildRssFeed } from "@/lib/seo/rss";

export async function GET() {
  return new Response(buildRssFeed(getBlogPosts()), {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
