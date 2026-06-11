import { NextRequest, NextResponse } from "next/server";
import { synthesizeUserMemory } from "@/lib/ai/memory";
import { listUsersDueForMemorySynthesis } from "@/lib/db/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
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

  const batchSize = 3;
  for (let index = 0; index < dueUsers.length; index += batchSize) {
    const batch = dueUsers.slice(index, index + batchSize);
    const results = await Promise.allSettled(batch.map((row) => synthesizeUserMemory(row.userId, "daily_cron")));
    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled") {
        stats.completed += 1;
        return;
      }
      stats.failed += 1;
      stats.errors.push({
        userId: batch[resultIndex].userId,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    });
  }

  return NextResponse.json(stats);
}
