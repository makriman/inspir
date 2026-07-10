import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 5;

export function GET() {
  const generatedAt = new Date().toISOString();
  return NextResponse.json(
    { ok: true, generatedAt },
    {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=5, stale-while-revalidate=30",
        "X-Inspir-Cache-Generated-At": generatedAt,
      },
    },
  );
}
