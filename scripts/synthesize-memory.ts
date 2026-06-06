import { and, eq, inArray, type SQL } from "drizzle-orm";
import { synthesizeUserMemory } from "@/lib/ai/memory";
import { db, sql } from "@/lib/db/client";
import { chatMemoryTurns, userMemories, users, userMemorySettings } from "@/lib/db/schema";

type Args = {
  limit?: number;
  user?: string;
  dryRun: boolean;
  allUsers: boolean;
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const args = parseArgs(process.argv.slice(2));
  const candidates = await loadUsers(args);
  console.log(
    JSON.stringify({
      event: "memory_synthesis_start",
      users: candidates.length,
      user: args.user ?? null,
      limit: args.limit ?? null,
      dryRun: args.dryRun,
      allUsers: args.allUsers,
    }),
  );

  const stats = { completed: 0, skippedDryRun: 0, failed: 0 };
  for (const candidate of candidates) {
    if (args.dryRun) {
      stats.skippedDryRun += 1;
      continue;
    }
    try {
      await synthesizeUserMemory(candidate.id, "one_time_backfill");
      stats.completed += 1;
    } catch (error) {
      stats.failed += 1;
      console.error(
        JSON.stringify({
          event: "memory_synthesis_failed",
          userId: candidate.id,
          email: candidate.email,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  console.log(JSON.stringify({ event: "memory_synthesis_complete", ...stats }));
}

async function loadUsers(args: Args) {
  const candidateIds = args.allUsers ? [] : await loadUserIdsWithMemoryState();
  if (!args.allUsers && !candidateIds.length) return [];
  const filters: SQL[] = [];
  if (args.user) {
    filters.push(args.user.includes("@") ? eq(users.email, args.user) : eq(users.id, args.user));
  }
  if (!args.allUsers) filters.push(inArray(users.id, candidateIds));
  const baseQuery = db
    .select({
      id: users.id,
      email: users.email,
      enabled: userMemorySettings.enabled,
      savedMemoryEnabled: userMemorySettings.savedMemoryEnabled,
      dreamingEnabled: userMemorySettings.dreamingEnabled,
    })
    .from(users)
    .leftJoin(userMemorySettings, eq(userMemorySettings.userId, users.id));

  const rows = await (filters.length ? baseQuery.where(and(...filters)) : baseQuery)
    .orderBy(users.createdAt)
    .limit(args.limit ?? 100_000);

  return rows.filter(
    (row) =>
      row.enabled !== false &&
      row.savedMemoryEnabled !== false &&
      row.dreamingEnabled !== false,
  );
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, allUsers: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--all-users") {
      args.allUsers = true;
    } else if (arg === "--limit" && next) {
      args.limit = parsePositiveInteger(next, "--limit");
      index += 1;
    } else if (arg === "--user" && next) {
      args.user = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function loadUserIdsWithMemoryState() {
  const [memoryRows, turnRows] = await Promise.all([
    db
      .select({ userId: userMemories.userId })
      .from(userMemories)
      .where(eq(userMemories.status, "active")),
    db.select({ userId: chatMemoryTurns.userId }).from(chatMemoryTurns),
  ]);
  return [...new Set([...memoryRows.map((row) => row.userId), ...turnRows.map((row) => row.userId)])];
}

function parsePositiveInteger(value: string, label: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
