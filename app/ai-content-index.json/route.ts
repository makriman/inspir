import { buildAiContentIndex } from "@/lib/seo/ai-index";

export const dynamic = "force-static";

export function GET() {
  return Response.json(buildAiContentIndex(), {
    headers: {
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
