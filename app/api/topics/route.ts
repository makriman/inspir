import { NextResponse } from "next/server";
import { getActiveTopics } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const topics = await getActiveTopics();
  return NextResponse.json({ topics });
}
