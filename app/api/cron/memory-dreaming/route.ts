import { NextRequest, NextResponse } from "next/server";
import { synthesizeUserMemory } from "@/lib/ai/memory";
import { listUsersDueForMemorySynthesis } from "@/lib/db/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");
  if (secret && auth !== `Bearer ${secret}` && querySecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 10) || 10, 25);
  const dueUsers = await listUsersDueForMemorySynthesis(limit);
  const stats = {
    due: dueUsers.length,
    completed: 0,
    failed: 0,
    errors: [] as Array<{ userId: string; error: string }>,
  };

  for (const row of dueUsers) {
    try {
      await synthesizeUserMemory(row.userId, "daily_cron");
      stats.completed += 1;
    } catch (error) {
      stats.failed += 1;
      stats.errors.push({
        userId: row.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json(stats);
}
