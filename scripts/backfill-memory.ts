import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { processMemoryAfterTurn, detectMemoryIntent } from "@/lib/ai/memory";
import { db, sql } from "@/lib/db/client";
import { insertMemoryEvent } from "@/lib/db/memory";
import { chatMemoryTurns, chats, messages, topics, users } from "@/lib/db/schema";

type Args = {
  batchSize: number;
  chatId?: string;
  dryRun: boolean;
  includeMemoryLookupTurns: boolean;
  limit?: number;
  user?: string;
};

type ChatRow = {
  id: string;
  userId: string;
  userEmail: string;
  topicId: string;
  topicName: string;
  topicSlug: string;
};

type MessageRow = {
  id: string;
  chatId: string;
  role: string;
  content: string;
  createdAt: Date;
};

type CandidateTurn = {
  chat: ChatRow;
  userMessage: MessageRow;
  assistantMessage: MessageRow;
  contextMessages: MessageRow[];
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required.");

  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const chatsToBackfill = await loadChats(args);
  const existingUserMessageIds = await loadExistingIndexedUserMessageIds();
  const candidates = await loadCandidateTurns(chatsToBackfill, existingUserMessageIds, args);

  console.log(
    JSON.stringify({
      event: "memory_backfill_start",
      dryRun: args.dryRun,
      signedInChats: chatsToBackfill.length,
      candidateTurns: candidates.length,
      batchSize: args.batchSize,
      limit: args.limit ?? null,
      user: args.user ?? null,
      chatId: args.chatId ?? null,
      includeMemoryLookupTurns: args.includeMemoryLookupTurns,
    }),
  );

  const stats = {
    processed: 0,
    skippedLookup: 0,
    skippedDryRun: 0,
    failed: 0,
  };

  for (let index = 0; index < candidates.length; index += args.batchSize) {
    const batch = candidates.slice(index, index + args.batchSize);
    for (const candidate of batch) {
      const intent = detectMemoryIntent(candidate.userMessage.content);
      if (intent === "ask_about_memory" && !args.includeMemoryLookupTurns) {
        stats.skippedLookup += 1;
        if (!args.dryRun) {
          await insertMemoryEvent({
            userId: candidate.chat.userId,
            chatId: candidate.chat.id,
            messageId: candidate.userMessage.id,
            eventType: "skipped",
            reason: "historical_memory_lookup_turn",
            metadata: { assistantMessageId: candidate.assistantMessage.id },
          });
        }
        continue;
      }

      if (args.dryRun) {
        stats.skippedDryRun += 1;
        continue;
      }

      try {
        await processMemoryAfterTurn({
          userId: candidate.chat.userId,
          chatId: candidate.chat.id,
          topic: {
            id: candidate.chat.topicId,
            name: candidate.chat.topicName,
            slug: candidate.chat.topicSlug,
          },
          userMessage: toPersistedMessage(candidate.userMessage),
          assistantMessage: toPersistedMessage(candidate.assistantMessage),
          contextMessages: candidate.contextMessages.map(toPersistedMessage),
        });
        stats.processed += 1;
      } catch (error) {
        stats.failed += 1;
        console.error(
          JSON.stringify({
            event: "memory_backfill_turn_failed",
            userId: candidate.chat.userId,
            chatId: candidate.chat.id,
            userMessageId: candidate.userMessage.id,
            assistantMessageId: candidate.assistantMessage.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }

    console.log(
      JSON.stringify({
        event: "memory_backfill_progress",
        completedCandidates: Math.min(index + batch.length, candidates.length),
        totalCandidates: candidates.length,
        ...stats,
      }),
    );
  }

  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    JSON.stringify({
      event: "memory_backfill_complete",
      durationSeconds,
      ...stats,
    }),
  );
}

async function loadChats(args: Args): Promise<ChatRow[]> {
  const [fallbackTopic] = await db.select().from(topics).orderBy(asc(topics.sortOrder), asc(topics.name)).limit(1);
  if (!fallbackTopic) throw new Error("At least one topic is required before memory backfill.");

  const filters = [isNotNull(chats.userId)];
  if (args.chatId) filters.push(eq(chats.id, args.chatId));
  if (args.user) {
    if (args.user.includes("@")) filters.push(eq(users.email, args.user));
    else filters.push(eq(chats.userId, args.user));
  }

  const rows = await db
    .select({
      id: chats.id,
      userId: chats.userId,
      userEmail: users.email,
      topicId: topics.id,
      topicName: topics.name,
      topicSlug: topics.slug,
      topicNameSnapshot: chats.topicNameSnapshot,
    })
    .from(chats)
    .innerJoin(users, eq(users.id, chats.userId))
    .leftJoin(topics, eq(topics.id, chats.topicId))
    .where(and(...filters))
    .orderBy(asc(chats.createdAt), asc(chats.id));

  return rows
    .filter((row): row is typeof row & { userId: string; userEmail: string } => Boolean(row.userId && row.userEmail))
    .map((row) => ({
      id: row.id,
      userId: row.userId,
      userEmail: row.userEmail,
      topicId: row.topicId ?? fallbackTopic.id,
      topicName: row.topicName ?? row.topicNameSnapshot ?? fallbackTopic.name,
      topicSlug: row.topicSlug ?? fallbackTopic.slug,
    }));
}

async function loadExistingIndexedUserMessageIds() {
  const rows = await db.select({ userMessageId: chatMemoryTurns.userMessageId }).from(chatMemoryTurns);
  return new Set(rows.map((row) => row.userMessageId));
}

async function loadCandidateTurns(
  chatRows: ChatRow[],
  existingUserMessageIds: Set<string>,
  args: Args,
): Promise<CandidateTurn[]> {
  const chatById = new Map(chatRows.map((chat) => [chat.id, chat]));
  const chatIds = [...chatById.keys()];
  const candidates: CandidateTurn[] = [];
  for (let index = 0; index < chatIds.length; index += 100) {
    const batchIds = chatIds.slice(index, index + 100);
    const messageRows = await db
      .select({
        id: messages.id,
        chatId: messages.chatId,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(inArray(messages.chatId, batchIds))
      .orderBy(asc(messages.chatId), asc(messages.createdAt), asc(messages.id));

    const grouped = new Map<string, MessageRow[]>();
    for (const message of messageRows) {
      const list = grouped.get(message.chatId) ?? [];
      list.push(message);
      grouped.set(message.chatId, list);
    }

    for (const [chatId, chatMessages] of grouped) {
      const chat = chatById.get(chatId);
      if (!chat) continue;
      candidates.push(...buildChatCandidates(chat, chatMessages, existingUserMessageIds));
    }
  }

  const sorted = candidates.sort((left, right) => {
    const userCompare = left.chat.userId.localeCompare(right.chat.userId);
    if (userCompare !== 0) return userCompare;
    return left.userMessage.createdAt.getTime() - right.userMessage.createdAt.getTime();
  });
  return typeof args.limit === "number" ? sorted.slice(0, args.limit) : sorted;
}

function buildChatCandidates(
  chat: ChatRow,
  chatMessages: MessageRow[],
  existingUserMessageIds: Set<string>,
): CandidateTurn[] {
  const candidates: CandidateTurn[] = [];
  let pendingUser: MessageRow | null = null;
  let pendingContext: MessageRow[] = [];
  const priorMessages: MessageRow[] = [];

  for (const message of chatMessages) {
    if (message.role === "user") {
      pendingUser = message;
      pendingContext = priorMessages.slice(-12);
      priorMessages.push(message);
      continue;
    }

    if (message.role === "assistant" && pendingUser) {
      if (!existingUserMessageIds.has(pendingUser.id)) {
        candidates.push({
          chat,
          userMessage: pendingUser,
          assistantMessage: message,
          contextMessages: pendingContext,
        });
      }
      pendingUser = null;
    }

    priorMessages.push(message);
  }

  return candidates;
}

function toPersistedMessage(message: MessageRow) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
  };
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    batchSize: 10,
    dryRun: false,
    includeMemoryLookupTurns: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--include-memory-lookup-turns") {
      args.includeMemoryLookupTurns = true;
    } else if (arg === "--limit" && next) {
      args.limit = parsePositiveInteger(next, "--limit");
      index += 1;
    } else if (arg === "--batch-size" && next) {
      args.batchSize = parsePositiveInteger(next, "--batch-size");
      index += 1;
    } else if (arg === "--user" && next) {
      args.user = next;
      index += 1;
    } else if (arg === "--chat" && next) {
      args.chatId = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
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
