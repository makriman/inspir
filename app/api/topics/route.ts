import { NextResponse } from "next/server";
import { getPublicActiveTopics } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const topics = await getPublicActiveTopics();
  return NextResponse.json({ topics });
}
