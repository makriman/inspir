import { and, asc, desc, eq, ilike, inArray } from "drizzle-orm";
import { db, sql } from "./client";
import {
  chatMemorySummaries,
  memoryEvents,
  userMemories,
  userMemoryProfiles,
  userMemorySettings,
  type ChatMemorySummary,
  type UserMemory,
  type UserMemorySetting,
} from "./schema";

export type MemoryEventType =
  | "created"
  | "updated"
  | "deleted"
  | "cleared"
  | "used"
  | "skipped"
  | "summarized"
  | "profile_compiled"
  | "settings_updated";

export type MemorySearchResult = Pick<
  UserMemory,
  | "id"
  | "userId"
  | "kind"
  | "category"
  | "content"
  | "tags"
  | "confidence"
  | "salience"
  | "status"
  | "sourceChatId"
  | "sourceMessageId"
  | "createdAt"
  | "updatedAt"
> & {
  similarity?: number;
};

export type ChatSummarySearchResult = Pick<
  ChatMemorySummary,
  "chatId" | "userId" | "topicId" | "summary" | "topics" | "sourceMessageCount" | "lastMessageId" | "updatedAt"
> & {
  similarity?: number;
};

export async function ensureUserMemorySettings(userId: string): Promise<UserMemorySetting> {
  const [settings] = await db
    .insert(userMemorySettings)
    .values({ userId })
    .onConflictDoNothing()
    .returning();
  if (settings) return settings;

  const [existing] = await db
    .select()
    .from(userMemorySettings)
    .where(eq(userMemorySettings.userId, userId))
    .limit(1);
  if (existing) return existing;

  throw new Error("Could not load memory settings");
}

export async function updateUserMemorySettings(
  userId: string,
  input: {
    enabled?: boolean;
    captureScope?: string;
    retrievalMode?: string;
    noticeSeenAt?: Date | null;
  },
) {
  await ensureUserMemorySettings(userId);
  const patch = {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.captureScope !== undefined ? { captureScope: input.captureScope } : {}),
    ...(input.retrievalMode !== undefined ? { retrievalMode: input.retrievalMode } : {}),
    ...(input.noticeSeenAt !== undefined ? { noticeSeenAt: input.noticeSeenAt } : {}),
    updatedAt: new Date(),
  };
  const [settings] = await db
    .update(userMemorySettings)
    .set(patch)
    .where(eq(userMemorySettings.userId, userId))
    .returning();
  await insertMemoryEvent({
    userId,
    eventType: "settings_updated",
    metadata: input,
  });
  return settings;
}

export async function getMemoryDashboard(userId: string) {
  const [settings, memories, profiles] = await Promise.all([
    ensureUserMemorySettings(userId),
    db
      .select()
      .from(userMemories)
      .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active")))
      .orderBy(desc(userMemories.salience), desc(userMemories.updatedAt)),
    getUserMemoryProfiles(userId),
  ]);
  return { settings, memories, profiles };
}

export async function getActiveUserMemories(userId: string, limit = 100) {
  return db
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active")))
    .orderBy(desc(userMemories.salience), desc(userMemories.updatedAt))
    .limit(limit);
}

export async function getActiveMemoriesByCategory(userId: string, category: string, limit = 40) {
  return db
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active"), eq(userMemories.category, category)))
    .orderBy(desc(userMemories.salience), desc(userMemories.updatedAt))
    .limit(limit);
}

export async function createUserMemory(input: {
  userId: string;
  kind?: "explicit" | "auto";
  category: string;
  content: string;
  tags?: string[];
  confidence?: number;
  salience?: number;
  sourceChatId?: string | null;
  sourceMessageId?: string | null;
  embedding?: number[] | null;
}) {
  const [memory] = await db
    .insert(userMemories)
    .values({
      userId: input.userId,
      kind: input.kind ?? "auto",
      category: input.category,
      content: input.content,
      tags: input.tags ?? [],
      confidence: input.confidence ?? 70,
      salience: input.salience ?? 50,
      sourceChatId: input.sourceChatId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      embedding: input.embedding ?? null,
    })
    .returning();
  await insertMemoryEvent({
    userId: input.userId,
    memoryId: memory.id,
    chatId: input.sourceChatId,
    messageId: input.sourceMessageId,
    eventType: "created",
    metadata: { category: input.category, kind: input.kind ?? "auto" },
  });
  return memory;
}

export async function updateUserMemory(
  userId: string,
  memoryId: string,
  input: Partial<{
    kind: "explicit" | "auto";
    category: string;
    content: string;
    tags: string[];
    confidence: number;
    salience: number;
    status: string;
    sourceChatId: string | null;
    sourceMessageId: string | null;
    embedding: number[] | null;
    supersededByMemoryId: string | null;
    lastUsedAt: Date | null;
    deletedAt: Date | null;
  }>,
) {
  const [memory] = await db
    .update(userMemories)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(userMemories.id, memoryId), eq(userMemories.userId, userId)))
    .returning();
  if (memory) {
    await insertMemoryEvent({
      userId,
      memoryId,
      eventType: input.status === "deleted" ? "deleted" : "updated",
      metadata: { fields: Object.keys(input) },
    });
  }
  return memory;
}

export async function deleteUserMemory(userId: string, memoryId: string) {
  return updateUserMemory(userId, memoryId, {
    status: "deleted",
    deletedAt: new Date(),
  });
}

export async function clearUserMemories(userId: string) {
  await db
    .update(userMemories)
    .set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active")));
  await db.delete(userMemoryProfiles).where(eq(userMemoryProfiles.userId, userId));
  await insertMemoryEvent({ userId, eventType: "cleared" });
}

export async function findExistingMemoryByNormalized(userId: string, normalizedContent: string) {
  const rows = await getActiveUserMemories(userId, 250);
  return rows.find((memory) => normalizeMemoryContent(memory.content) === normalizedContent);
}

export async function findMatchingMemoriesByText(userId: string, text: string, limit = 20) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return db
    .select()
    .from(userMemories)
    .where(
      and(
        eq(userMemories.userId, userId),
        eq(userMemories.status, "active"),
        ilike(userMemories.content, `%${trimmed.slice(0, 96)}%`),
      ),
    )
    .orderBy(desc(userMemories.salience), desc(userMemories.updatedAt))
    .limit(limit);
}

export async function searchUserMemoriesByEmbedding(userId: string, embedding: number[], limit = 8) {
  const vector = toPgVector(embedding);
  return sql<MemorySearchResult[]>`
    select
      id,
      user_id as "userId",
      kind,
      category,
      content,
      tags,
      confidence,
      salience,
      status,
      source_chat_id as "sourceChatId",
      source_message_id as "sourceMessageId",
      created_at as "createdAt",
      updated_at as "updatedAt",
      (1 - (embedding <=> ${vector}::vector))::float as similarity
    from user_memories
    where user_id = ${userId}
      and status = 'active'
      and embedding is not null
    order by embedding <=> ${vector}::vector
    limit ${limit}
  `;
}

export async function searchChatSummariesByEmbedding(userId: string, embedding: number[], limit = 4) {
  const vector = toPgVector(embedding);
  return sql<ChatSummarySearchResult[]>`
    select
      chat_id as "chatId",
      user_id as "userId",
      topic_id as "topicId",
      summary,
      topics,
      source_message_count as "sourceMessageCount",
      last_message_id as "lastMessageId",
      updated_at as "updatedAt",
      (1 - (embedding <=> ${vector}::vector))::float as similarity
    from chat_memory_summaries
    where user_id = ${userId}
      and embedding is not null
    order by embedding <=> ${vector}::vector
    limit ${limit}
  `;
}

export async function listRecentChatSummaries(userId: string, limit = 4) {
  return db
    .select()
    .from(chatMemorySummaries)
    .where(eq(chatMemorySummaries.userId, userId))
    .orderBy(desc(chatMemorySummaries.updatedAt))
    .limit(limit);
}

export async function upsertChatMemorySummary(input: {
  chatId: string;
  userId: string;
  topicId?: string | null;
  summary: string;
  topics?: string[];
  sourceMessageCount: number;
  lastMessageId?: string | null;
  embedding?: number[] | null;
}) {
  const [summary] = await db
    .insert(chatMemorySummaries)
    .values({
      chatId: input.chatId,
      userId: input.userId,
      topicId: input.topicId ?? null,
      summary: input.summary,
      topics: input.topics ?? [],
      sourceMessageCount: input.sourceMessageCount,
      lastMessageId: input.lastMessageId ?? null,
      embedding: input.embedding ?? null,
    })
    .onConflictDoUpdate({
      target: chatMemorySummaries.chatId,
      set: {
        topicId: input.topicId ?? null,
        summary: input.summary,
        topics: input.topics ?? [],
        sourceMessageCount: input.sourceMessageCount,
        lastMessageId: input.lastMessageId ?? null,
        embedding: input.embedding ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  await insertMemoryEvent({
    userId: input.userId,
    chatId: input.chatId,
    messageId: input.lastMessageId,
    eventType: "summarized",
    metadata: { topicId: input.topicId, sourceMessageCount: input.sourceMessageCount },
  });
  return summary;
}

export async function getUserMemoryProfiles(userId: string) {
  return db
    .select()
    .from(userMemoryProfiles)
    .where(eq(userMemoryProfiles.userId, userId))
    .orderBy(asc(userMemoryProfiles.category));
}

export async function upsertUserMemoryProfile(input: {
  userId: string;
  category: string;
  summary: string;
  sourceMemoryIds?: string[];
}) {
  const [profile] = await db
    .insert(userMemoryProfiles)
    .values({
      userId: input.userId,
      category: input.category,
      summary: input.summary,
      sourceMemoryIds: input.sourceMemoryIds ?? [],
      lastCompiledAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userMemoryProfiles.userId, userMemoryProfiles.category],
      set: {
        summary: input.summary,
        sourceMemoryIds: input.sourceMemoryIds ?? [],
        lastCompiledAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  await insertMemoryEvent({
    userId: input.userId,
    eventType: "profile_compiled",
    metadata: { category: input.category, sourceMemoryIds: input.sourceMemoryIds ?? [] },
  });
  return profile;
}

export async function deleteUserMemoryProfile(userId: string, category: string) {
  await db
    .delete(userMemoryProfiles)
    .where(and(eq(userMemoryProfiles.userId, userId), eq(userMemoryProfiles.category, category)));
}

export async function markMemoriesUsed(input: {
  userId: string;
  memoryIds: string[];
  chatId?: string | null;
  messageId?: string | null;
  reason?: string;
}) {
  const ids = [...new Set(input.memoryIds)].filter(Boolean);
  if (!ids.length) return;
  await db
    .update(userMemories)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(userMemories.userId, input.userId), inArray(userMemories.id, ids)));
  await Promise.all(
    ids.map((memoryId) =>
      insertMemoryEvent({
        userId: input.userId,
        memoryId,
        chatId: input.chatId,
        messageId: input.messageId,
        eventType: "used",
        reason: input.reason,
      }),
    ),
  );
}

export async function insertMemoryEvent(input: {
  userId: string;
  memoryId?: string | null;
  chatId?: string | null;
  messageId?: string | null;
  eventType: MemoryEventType;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(memoryEvents).values({
    userId: input.userId,
    memoryId: input.memoryId ?? null,
    chatId: input.chatId ?? null,
    messageId: input.messageId ?? null,
    eventType: input.eventType,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  });
}

export function serializeMemorySettings(settings: UserMemorySetting) {
  return {
    enabled: settings.enabled,
    captureScope: settings.captureScope,
    retrievalMode: settings.retrievalMode,
    noticeSeenAt: settings.noticeSeenAt,
  };
}

export function normalizeMemoryContent(content: string) {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

function toPgVector(embedding: number[]) {
  return `[${embedding.map((value) => (Number.isFinite(value) ? Number(value.toFixed(6)) : 0)).join(",")}]`;
}

export const memoryUseMetadata = (input: {
  used: boolean;
  gateReason?: string;
  memoryIds?: string[];
  profileCategories?: string[];
  chatSummaryIds?: string[];
}) => ({
  used: input.used,
  gateReason: input.gateReason,
  memoryIds: input.memoryIds ?? [],
  profileCategories: input.profileCategories ?? [],
  chatSummaryIds: input.chatSummaryIds ?? [],
});

export function lexicalMemoryRank(query: string, memories: MemorySearchResult[], limit = 5) {
  const terms = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 2),
  );
  return memories
    .map((memory) => {
      const haystack = `${memory.category} ${memory.content} ${(memory.tags ?? []).join(" ")}`.toLowerCase();
      const overlap = [...terms].filter((term) => haystack.includes(term)).length;
      const score = overlap * 10 + memory.salience + (memory.kind === "explicit" ? 25 : 0);
      return { ...memory, similarity: overlap ? score / 100 : undefined };
    })
    .filter((memory) => memory.similarity !== undefined)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit);
}
