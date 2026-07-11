import { getPublicSeededTopics } from "@/lib/content/public-topics";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = false;

export function GET() {
  return Response.json(
    { topics: getPublicSeededTopics() },
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
