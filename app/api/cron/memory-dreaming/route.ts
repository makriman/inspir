import { NextRequest, NextResponse } from "next/server";
import { synthesizeUserMemory } from "@/lib/ai/memory";
import { listUsersDueForMemorySynthesis } from "@/lib/db/memory";
import { writeFreezeResponse } from "@/lib/migration/write-freeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  if (!secret || !(await timingSafeBearerEquals(auth, secret))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const freeze = writeFreezeResponse("cron-memory-dreaming");
  if (freeze) return freeze;

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

async function timingSafeBearerEquals(auth: string | null, secret: string) {
  const encoder = new TextEncoder();
  const actual = encoder.encode(auth ?? "");
  const expected = encoder.encode(`Bearer ${secret}`);
  const length = Math.max(actual.length, expected.length, 1);
  const actualPadded = new Uint8Array(length);
  const expectedPadded = new Uint8Array(length);
  actualPadded.set(actual.subarray(0, length));
  expectedPadded.set(expected.subarray(0, length));

  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", actualPadded),
    crypto.subtle.digest("SHA-256", expectedPadded),
  ]);

  return actual.length === expected.length && timingSafeBytesEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash));
}

function timingSafeBytesEqual(left: Uint8Array, right: Uint8Array) {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}
