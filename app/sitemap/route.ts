import { buildSitemapXml } from "@/lib/seo/sitemap";

export const dynamic = "force-static";

export function GET() {
  return new Response(buildSitemapXml(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
