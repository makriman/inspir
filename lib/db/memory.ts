import { and, asc, desc, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { d1All, db } from "./client";
import { d1ContainsLikePattern } from "./like";
import {
  deleteMemoryVectors,
  queryMemoryVectors,
  upsertMemoryVector,
} from "./vectorize";
import {
  chatMemorySummaries,
  chatMemoryTurns,
  memoryEvents,
  memorySourceFeedback,
  memorySynthesisRuns,
  userMemories,
  userMemoryProfiles,
  userMemorySummaries,
  userMemorySettings,
  type ChatMemoryTurn,
  type MemorySourceFeedback,
  type UserMemorySummary,
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
  | "rag_used"
  | "summarized"
  | "turn_indexed"
  | "profile_compiled"
  | "settings_updated"
  | "synthesized"
  | "feedback";

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
  | "sourceType"
  | "sourceTurnIds"
  | "sourceMemoryIds"
  | "sourceChatId"
  | "sourceMessageId"
  | "validFrom"
  | "validUntil"
  | "freshnessStatus"
  | "pinned"
  | "doNotMention"
  | "createdAt"
  | "updatedAt"
> & {
  similarity?: number;
};

export type ChatTurnSearchResult = Pick<
  ChatMemoryTurn,
  | "id"
  | "userId"
  | "chatId"
  | "topicId"
  | "userMessageId"
  | "assistantMessageId"
  | "question"
  | "answerExcerpt"
  | "searchableText"
  | "topics"
  | "updatedAt"
> & {
  similarity?: number;
};

export type UserMemorySummarySection = NonNullable<UserMemorySummary["sections"]>[number];

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
    savedMemoryEnabled?: boolean;
    chatHistoryEnabled?: boolean;
    dreamingEnabled?: boolean;
    captureScope?: string;
    retrievalMode?: string;
    noticeSeenAt?: Date | null;
  },
) {
  await ensureUserMemorySettings(userId);
  const patch = {
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.savedMemoryEnabled !== undefined ? { savedMemoryEnabled: input.savedMemoryEnabled } : {}),
    ...(input.chatHistoryEnabled !== undefined ? { chatHistoryEnabled: input.chatHistoryEnabled } : {}),
    ...(input.dreamingEnabled !== undefined ? { dreamingEnabled: input.dreamingEnabled } : {}),
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
  if (input.chatHistoryEnabled === false) {
    const [priorMemoryRows, summaryRows, turnRows] = await Promise.all([
      db
        .select({ id: userMemories.id })
        .from(userMemories)
        .where(
          and(
            eq(userMemories.userId, userId),
            eq(userMemories.status, "active"),
            inArray(userMemories.sourceType, ["prior_chat", "synthesized"]),
          ),
        ),
      db.select({ id: chatMemorySummaries.chatId }).from(chatMemorySummaries).where(eq(chatMemorySummaries.userId, userId)),
      db.select({ id: chatMemoryTurns.id }).from(chatMemoryTurns).where(eq(chatMemoryTurns.userId, userId)),
    ]);
    await Promise.all([
      db
        .update(userMemories)
        .set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(userMemories.userId, userId),
            eq(userMemories.status, "active"),
            inArray(userMemories.sourceType, ["prior_chat", "synthesized"]),
          ),
        ),
      db.delete(userMemorySummaries).where(eq(userMemorySummaries.userId, userId)),
      db.delete(chatMemorySummaries).where(eq(chatMemorySummaries.userId, userId)),
      db.delete(chatMemoryTurns).where(eq(chatMemoryTurns.userId, userId)),
    ]);
    await Promise.all([
      deleteMemoryVectors(
        "user_memories",
        priorMemoryRows.map((row) => row.id),
      ),
      deleteMemoryVectors(
        "chat_memory_summaries",
        summaryRows.map((row) => row.id),
      ),
      deleteMemoryVectors(
        "chat_memory_turns",
        turnRows.map((row) => row.id),
      ),
    ]);
    await insertMemoryEvent({
      userId,
      eventType: "cleared",
      reason: "chat_history_memory_disabled",
    });
  }
  return settings;
}

export async function getMemoryDashboard(userId: string) {
  const [settings, memories, profiles, summary] = await Promise.all([
    ensureUserMemorySettings(userId),
    db
      .select()
      .from(userMemories)
      .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active")))
      .orderBy(desc(userMemories.salience), desc(userMemories.updatedAt)),
    getUserMemoryProfiles(userId),
    getUserMemorySummary(userId),
  ]);
  return { settings, memories, profiles, summary };
}

export async function getActiveUserMemories(userId: string, limit = 100) {
  return db
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active")))
    .orderBy(desc(userMemories.salience), desc(userMemories.updatedAt))
    .limit(limit);
}

export async function getUserMemory(userId: string, memoryId: string) {
  const [memory] = await db
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.id, memoryId)))
    .limit(1);
  return memory ?? null;
}

export async function getActiveMemoriesByCategory(userId: string, category: string, limit = 40) {
  return db
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active"), eq(userMemories.category, category)))
    .orderBy(desc(userMemories.salience), desc(userMemories.updatedAt))
    .limit(limit);
}

export async function findMemoriesBySourceMessage(userId: string, sourceMessageId: string) {
  return db
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.sourceMessageId, sourceMessageId)))
    .limit(20);
}

export async function createUserMemory(input: {
  userId: string;
  kind?: "explicit" | "auto";
  category: string;
  content: string;
  tags?: string[];
  confidence?: number;
  salience?: number;
  sourceType?: string;
  sourceTurnIds?: string[];
  sourceMemoryIds?: string[];
  sourceChatId?: string | null;
  sourceMessageId?: string | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  freshnessStatus?: string;
  pinned?: boolean;
  doNotMention?: boolean;
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
      sourceType: input.sourceType ?? sourceTypeFromKindAndTags(input.kind ?? "auto", input.tags ?? []),
      sourceTurnIds: input.sourceTurnIds ?? [],
      sourceMemoryIds: input.sourceMemoryIds ?? [],
      sourceChatId: input.sourceChatId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      freshnessStatus: input.freshnessStatus ?? "current",
      pinned: input.pinned ?? false,
      doNotMention: input.doNotMention ?? false,
      embedding: input.embedding ?? null,
    })
    .returning();
  await upsertMemoryVector({
    namespace: "user_memories",
    rowId: memory.id,
    embedding: input.embedding,
    userId: input.userId,
    chatId: input.sourceChatId,
  });
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
    sourceType: string;
    sourceTurnIds: string[];
    sourceMemoryIds: string[];
    validFrom: Date | null;
    validUntil: Date | null;
    freshnessStatus: string;
    pinned: boolean;
    doNotMention: boolean;
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
    if (input.status === "deleted" || input.deletedAt) {
      await deleteMemoryVectors("user_memories", [memoryId]);
    } else if (input.embedding !== undefined) {
      if (input.embedding) {
        await upsertMemoryVector({
          namespace: "user_memories",
          rowId: memory.id,
          embedding: input.embedding,
          userId,
          chatId: memory.sourceChatId,
        });
      } else {
        await deleteMemoryVectors("user_memories", [memoryId]);
      }
    }
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
  const [memoryRows, summaryRows, turnRows] = await Promise.all([
    db.select({ id: userMemories.id }).from(userMemories).where(eq(userMemories.userId, userId)),
    db.select({ id: chatMemorySummaries.chatId }).from(chatMemorySummaries).where(eq(chatMemorySummaries.userId, userId)),
    db.select({ id: chatMemoryTurns.id }).from(chatMemoryTurns).where(eq(chatMemoryTurns.userId, userId)),
  ]);
  await Promise.all([
    db
      .update(userMemories)
      .set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active"))),
    db.delete(userMemoryProfiles).where(eq(userMemoryProfiles.userId, userId)),
    db.delete(userMemorySummaries).where(eq(userMemorySummaries.userId, userId)),
    db.delete(chatMemorySummaries).where(eq(chatMemorySummaries.userId, userId)),
    db.delete(chatMemoryTurns).where(eq(chatMemoryTurns.userId, userId)),
  ]);
  await Promise.all([
    deleteMemoryVectors(
      "user_memories",
      memoryRows.map((row) => row.id),
    ),
    deleteMemoryVectors(
      "chat_memory_summaries",
      summaryRows.map((row) => row.id),
    ),
    deleteMemoryVectors(
      "chat_memory_turns",
      turnRows.map((row) => row.id),
    ),
  ]);
  await insertMemoryEvent({ userId, eventType: "cleared" });
}

export async function findExistingMemoryByNormalized(userId: string, normalizedContent: string) {
  const rows = await getActiveUserMemories(userId, 250);
  return rows.find((memory) => normalizeMemoryContent(memory.content) === normalizedContent);
}

export async function findMatchingMemoriesByText(userId: string, text: string, limit = 20) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const searchPattern = d1ContainsLikePattern(trimmed);
  if (!searchPattern) return [];
  return db
    .select()
    .from(userMemories)
    .where(
      and(
        eq(userMemories.userId, userId),
        eq(userMemories.status, "active"),
        drizzleSql`lower(${userMemories.content}) like lower(${searchPattern}) escape '\\'`,
      ),
    )
    .orderBy(desc(userMemories.salience), desc(userMemories.updatedAt))
    .limit(limit);
}

export async function deleteMatchingChatMemoryTurnsByText(userId: string, text: string, limit = 50) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const searchPattern = d1ContainsLikePattern(trimmed);
  if (!searchPattern) return [];
  const matches = await db
    .select({ id: chatMemoryTurns.id })
    .from(chatMemoryTurns)
    .where(
      and(
        eq(chatMemoryTurns.userId, userId),
        drizzleSql`lower(${chatMemoryTurns.searchableText}) like lower(${searchPattern}) escape '\\'`,
      ),
    )
    .limit(limit);
  const ids = matches.map((match) => match.id);
  if (!ids.length) return [];
  await db.delete(chatMemoryTurns).where(and(eq(chatMemoryTurns.userId, userId), inArray(chatMemoryTurns.id, ids)));
  await deleteMemoryVectors("chat_memory_turns", ids);
  return ids;
}

export async function searchUserMemoriesByEmbedding(userId: string, embedding: number[], limit = 8) {
  const matches = await queryMemoryVectors({
    namespace: "user_memories",
    userId,
    embedding,
    topK: limit * 4,
  });
  const ids = matches.map((match) => match.rowId);
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.status, "active"), inArray(userMemories.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const results: MemorySearchResult[] = [];
  for (const match of matches) {
    const row = byId.get(match.rowId);
    if (!row || row.doNotMention || row.freshnessStatus === "expired") continue;
    results.push({ ...row, similarity: match.score });
    if (results.length >= limit) break;
  }
  return results;
}

export async function searchChatMemoryTurnsByEmbedding(
  userId: string,
  embedding: number[],
  currentChatId: string,
  limit = 6,
) {
  const matches = await queryMemoryVectors({
    namespace: "chat_memory_turns",
    userId,
    embedding,
    topK: limit * 4,
    excludeChatId: currentChatId,
  });
  const ids = matches.map((match) => match.rowId);
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(chatMemoryTurns)
    .where(and(eq(chatMemoryTurns.userId, userId), inArray(chatMemoryTurns.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const results: ChatTurnSearchResult[] = [];
  for (const match of matches) {
    const row = byId.get(match.rowId);
    if (!row || row.chatId === currentChatId) continue;
    results.push({ ...row, similarity: match.score });
    if (results.length >= limit) break;
  }
  return results;
}

export async function searchChatMemoryTurnsByText(userId: string, query: string, currentChatId: string, limit = 6) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const terms = lexicalTerms(trimmed);
  if (!terms.length) return [];
  const turns = await db
    .select()
    .from(chatMemoryTurns)
    .where(eq(chatMemoryTurns.userId, userId))
    .orderBy(desc(chatMemoryTurns.updatedAt))
    .limit(200);

  const rankedTurns = [];
  for (const turn of turns) {
    if (turn.chatId === currentChatId) continue;
    const haystack = `${turn.question} ${turn.answerExcerpt} ${turn.searchableText} ${(turn.topics ?? []).join(" ")}`.toLowerCase();
    const overlap = terms.filter((term) => haystack.includes(term)).length;
    if (!overlap) continue;
    rankedTurns.push({ ...turn, similarity: overlap / terms.length });
  }

  return rankedTurns.sort((left, right) => right.similarity - left.similarity).slice(0, limit);
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
  if (input.embedding) {
    await upsertMemoryVector({
      namespace: "chat_memory_summaries",
      rowId: summary.chatId,
      embedding: input.embedding,
      userId: input.userId,
      chatId: input.chatId,
      topicId: input.topicId,
    });
  } else {
    await deleteMemoryVectors("chat_memory_summaries", [summary.chatId]);
  }
  await insertMemoryEvent({
    userId: input.userId,
    chatId: input.chatId,
    messageId: input.lastMessageId,
    eventType: "summarized",
    metadata: { topicId: input.topicId, sourceMessageCount: input.sourceMessageCount },
  });
  return summary;
}

export async function upsertChatMemoryTurn(input: {
  userId: string;
  chatId: string;
  topicId?: string | null;
  userMessageId: string;
  assistantMessageId: string;
  question: string;
  answerExcerpt: string;
  searchableText: string;
  topics?: string[];
  embedding?: number[] | null;
}) {
  const [turn] = await db
    .insert(chatMemoryTurns)
    .values({
      userId: input.userId,
      chatId: input.chatId,
      topicId: input.topicId ?? null,
      userMessageId: input.userMessageId,
      assistantMessageId: input.assistantMessageId,
      question: input.question,
      answerExcerpt: input.answerExcerpt,
      searchableText: input.searchableText,
      topics: input.topics ?? [],
      embedding: input.embedding ?? null,
    })
    .onConflictDoUpdate({
      target: chatMemoryTurns.userMessageId,
      set: {
        assistantMessageId: input.assistantMessageId,
        question: input.question,
        answerExcerpt: input.answerExcerpt,
        searchableText: input.searchableText,
        topics: input.topics ?? [],
        embedding: input.embedding ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (input.embedding) {
    await upsertMemoryVector({
      namespace: "chat_memory_turns",
      rowId: turn.id,
      embedding: input.embedding,
      userId: input.userId,
      chatId: input.chatId,
      topicId: input.topicId,
    });
  } else {
    await deleteMemoryVectors("chat_memory_turns", [turn.id]);
  }
  await insertMemoryEvent({
    userId: input.userId,
    chatId: input.chatId,
    messageId: input.assistantMessageId,
    eventType: "turn_indexed",
    metadata: { chatTurnId: turn.id, topicId: input.topicId },
  });
  return turn;
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

export async function getUserMemorySummary(userId: string) {
  const [summary] = await db
    .select()
    .from(userMemorySummaries)
    .where(eq(userMemorySummaries.userId, userId))
    .limit(1);
  return summary ?? null;
}

export async function upsertUserMemorySummary(input: {
  userId: string;
  summary: string;
  sections: UserMemorySummarySection[];
  sourceMemoryIds?: string[];
  sourceTurnIds?: string[];
  version?: number;
}) {
  const [summary] = await db
    .insert(userMemorySummaries)
    .values({
      userId: input.userId,
      summary: input.summary,
      sections: input.sections,
      sourceMemoryIds: input.sourceMemoryIds ?? [],
      sourceTurnIds: input.sourceTurnIds ?? [],
      version: input.version ?? 1,
      lastSynthesizedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userMemorySummaries.userId,
      set: {
        summary: input.summary,
        sections: input.sections,
        sourceMemoryIds: input.sourceMemoryIds ?? [],
        sourceTurnIds: input.sourceTurnIds ?? [],
        version: input.version ?? 1,
        lastSynthesizedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();

  await insertMemoryEvent({
    userId: input.userId,
    eventType: "synthesized",
    metadata: {
      sectionCount: input.sections.length,
      sourceMemoryIds: input.sourceMemoryIds ?? [],
      sourceTurnIds: input.sourceTurnIds ?? [],
    },
  });
  return summary;
}

export async function createMemorySynthesisRun(input: {
  userId: string;
  reason: string;
  inputCounts?: Record<string, unknown>;
}) {
  const [run] = await db
    .insert(memorySynthesisRuns)
    .values({
      userId: input.userId,
      reason: input.reason,
      inputCounts: input.inputCounts ?? {},
    })
    .returning();
  return run;
}

export async function finishMemorySynthesisRun(
  runId: string,
  input: {
    status: "completed" | "failed" | "skipped";
    outputCounts?: Record<string, unknown>;
    error?: string | null;
  },
) {
  const [run] = await db
    .update(memorySynthesisRuns)
    .set({
      status: input.status,
      outputCounts: input.outputCounts ?? {},
      error: input.error ?? null,
      finishedAt: new Date(),
    })
    .where(eq(memorySynthesisRuns.id, runId))
    .returning();
  return run;
}

export async function listUsersDueForMemorySynthesis(limit = 10) {
  return d1All<{ userId: string }>(
    `select distinct settings.user_id as "userId"
     from user_memory_settings settings
     left join user_memory_summaries summaries on summaries.user_id = settings.user_id
     where settings.enabled = 1
       and settings.saved_memory_enabled = 1
       and settings.dreaming_enabled = 1
       and (
         summaries.user_id is null
         or exists (
           select 1 from user_memories memories
           where memories.user_id = settings.user_id
             and memories.status = 'active'
             and memories.updated_at > summaries.last_synthesized_at
         )
         or (
           settings.chat_history_enabled = 1
           and exists (
             select 1 from chat_memory_turns turns
             where turns.user_id = settings.user_id
               and turns.updated_at > summaries.last_synthesized_at
           )
         )
       )
     order by settings.user_id
     limit ?`,
    limit,
  );
}

export async function getRecentChatMemoryTurnsForUser(userId: string, limit = 80) {
  return db
    .select()
    .from(chatMemoryTurns)
    .where(eq(chatMemoryTurns.userId, userId))
    .orderBy(desc(chatMemoryTurns.updatedAt))
    .limit(limit);
}

export async function getChatMemoryTurnsByIds(userId: string, turnIds: string[]) {
  const ids = [...new Set(turnIds)].filter(Boolean);
  if (!ids.length) return [];
  return db
    .select()
    .from(chatMemoryTurns)
    .where(and(eq(chatMemoryTurns.userId, userId), inArray(chatMemoryTurns.id, ids)))
    .orderBy(desc(chatMemoryTurns.updatedAt));
}

export async function getUserMemoriesByIds(userId: string, memoryIds: string[]) {
  const ids = [...new Set(memoryIds)].filter(Boolean);
  if (!ids.length) return [];
  return db
    .select()
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), inArray(userMemories.id, ids)))
    .orderBy(desc(userMemories.salience), desc(userMemories.updatedAt));
}

export async function insertMemorySourceFeedback(input: {
  userId: string;
  aiRunId?: string | null;
  memoryId?: string | null;
  chatTurnId?: string | null;
  summarySectionId?: string | null;
  action: MemorySourceFeedback["action"];
  note?: string | null;
}) {
  const [feedback] = await db
    .insert(memorySourceFeedback)
    .values({
      userId: input.userId,
      aiRunId: input.aiRunId ?? null,
      memoryId: input.memoryId ?? null,
      chatTurnId: input.chatTurnId ?? null,
      summarySectionId: input.summarySectionId ?? null,
      action: input.action,
      note: input.note ?? null,
    })
    .returning();
  await insertMemoryEvent({
    userId: input.userId,
    memoryId: input.memoryId,
    eventType: "feedback",
    metadata: {
      aiRunId: input.aiRunId ?? null,
      chatTurnId: input.chatTurnId ?? null,
      summarySectionId: input.summarySectionId ?? null,
      action: input.action,
    },
  });
  return feedback;
}

export async function getRecentMemorySourceFeedback(userId: string, limit = 120) {
  return db
    .select()
    .from(memorySourceFeedback)
    .where(eq(memorySourceFeedback.userId, userId))
    .orderBy(desc(memorySourceFeedback.createdAt))
    .limit(limit);
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

export async function markChatTurnsUsed(input: {
  userId: string;
  turnIds: string[];
  chatId?: string | null;
  messageId?: string | null;
  reason?: string;
}) {
  const ids = [...new Set(input.turnIds)].filter(Boolean);
  if (!ids.length) return;
  await Promise.all(
    ids.map((turnId) =>
      insertMemoryEvent({
        userId: input.userId,
        chatId: input.chatId,
        messageId: input.messageId,
        eventType: "rag_used",
        reason: input.reason,
        metadata: { chatTurnId: turnId },
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
    savedMemoryEnabled: settings.savedMemoryEnabled,
    chatHistoryEnabled: settings.chatHistoryEnabled,
    dreamingEnabled: settings.dreamingEnabled,
    captureScope: settings.captureScope,
    retrievalMode: settings.retrievalMode,
    noticeSeenAt: settings.noticeSeenAt,
  };
}

export function normalizeMemoryContent(content: string) {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

export const memoryUseMetadata = (input: {
  used: boolean;
  gateReason?: string;
  memoryIds?: string[];
  profileCategories?: string[];
  chatSummaryIds?: string[];
  chatTurnIds?: string[];
  summarySectionIds?: string[];
  sources?: Array<Record<string, unknown>>;
  memoryIntent?: string;
}) => ({
  used: input.used,
  gateReason: input.gateReason,
  memoryIds: input.memoryIds ?? [],
  profileCategories: input.profileCategories ?? [],
  chatSummaryIds: input.chatSummaryIds ?? [],
  chatTurnIds: input.chatTurnIds ?? [],
  summarySectionIds: input.summarySectionIds ?? [],
  sources: input.sources ?? [],
  memoryIntent: input.memoryIntent,
});

export function lexicalMemoryRank(query: string, memories: MemorySearchResult[], limit = 5) {
  const terms = new Set(lexicalTerms(query));
  return memories
    .map((memory) => {
      const haystack = `${memory.category} ${memory.content} ${(memory.tags ?? []).join(" ")}`.toLowerCase();
      const overlap = [...terms].filter((term) => haystack.includes(term)).length;
      const sourceBoost = memory.sourceType === "manual" || memory.kind === "explicit" ? 25 : 0;
      const pinnedBoost = memory.pinned ? 25 : 0;
      const stalePenalty = memory.freshnessStatus === "stale" ? 20 : 0;
      const score = overlap * 10 + memory.salience + sourceBoost + pinnedBoost - stalePenalty;
      return { ...memory, similarity: overlap ? score / 100 : undefined };
    })
    .filter(
      (memory) =>
        memory.similarity !== undefined &&
        !memory.doNotMention &&
        memory.status === "active" &&
        memory.freshnessStatus !== "expired",
    )
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit);
}

function lexicalTerms(query: string) {
  const stopWords = new Set([
    "about",
    "again",
    "before",
    "could",
    "did",
    "does",
    "for",
    "from",
    "have",
    "history",
    "previous",
    "that",
    "the",
    "what",
    "when",
    "where",
    "which",
    "with",
    "you",
  ]);
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2 && !stopWords.has(term)),
    ),
  ];
}

function sourceTypeFromKindAndTags(kind: string, tags: string[]) {
  if (tags.includes("manual")) return "manual";
  if (tags.includes("prior_chat") || tags.includes("chat_history")) return "prior_chat";
  if (kind === "explicit") return "explicit";
  return "auto";
}
