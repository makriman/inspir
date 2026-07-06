import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, or, sql as drizzleSql } from "drizzle-orm";
import { d1All, db } from "./client";
import { d1ContainsLikePattern } from "./like";
import {
  activityRuns,
  adminUsers,
  aiRuns,
  appMetadata,
  appTranslationSourceStrings,
  appTranslationSources,
  appTranslations,
  llmUsageDailyShards,
  chats,
  messages,
  topics,
  users,
} from "./schema";
import type { Topic } from "./schema";
import { defaultTopicSlug, topicSeeds } from "@/lib/content/topics";
import { getVisibleMessageContent } from "@/lib/ai/visible-content";

const topicSeedMetadataKey = "topic_seed_hash";
let seedTopicsPromise: Promise<void> | null = null;

export type PublicTopic = Pick<
  Topic,
  "id" | "slug" | "name" | "subText" | "description" | "inputboxText" | "iconUrl" | "sortOrder" | "metadata"
>;

const publicMetadataKeys = new Set([
  "category",
  "uiMode",
  "modelProfile",
  "starters",
  "keywords",
  "source",
  "toolId",
]);

async function ensureSeedTopics() {
  seedTopicsPromise ??= syncSeedTopicsOnce().catch((error) => {
    seedTopicsPromise = null;
    throw error;
  });
  return seedTopicsPromise;
}

async function syncSeedTopicsOnce() {
  const seedHash = topicSeedHash();
  const [state] = await db
    .select({ value: appMetadata.value })
    .from(appMetadata)
    .where(eq(appMetadata.key, topicSeedMetadataKey))
    .limit(1);

  if (state?.value === seedHash) return;

  await Promise.all(
    topicSeeds.map((topic) =>
      db
        .insert(topics)
        .values({
          slug: topic.slug,
          name: topic.name,
          subText: topic.subText,
          description: topic.description,
          inputboxText: topic.inputboxText,
          systemPrompt: topic.systemPrompt,
          sortOrder: topic.sortOrder,
          metadata: topic.metadata,
          status: "active",
        })
        .onConflictDoNothing({ target: topics.slug }),
    ),
  );
  await db
    .insert(appMetadata)
    .values({ key: topicSeedMetadataKey, value: seedHash })
    .onConflictDoUpdate({
      target: appMetadata.key,
      set: { value: seedHash, updatedAt: new Date() },
    });
}

function topicSeedHash() {
  return createHash("sha256")
    .update(
      JSON.stringify(
        topicSeeds.map((topic) => ({
          slug: topic.slug,
          name: topic.name,
          subText: topic.subText,
          description: topic.description,
          inputboxText: topic.inputboxText,
          systemPrompt: topic.systemPrompt,
          sortOrder: topic.sortOrder,
          metadata: topic.metadata,
        })),
      ),
    )
    .digest("hex");
}

export function toPublicTopic(topic: Topic): PublicTopic {
  return {
    id: topic.id,
    slug: topic.slug,
    name: topic.name,
    subText: topic.subText,
    description: topic.description,
    inputboxText: topic.inputboxText,
    iconUrl: topic.iconUrl,
    sortOrder: topic.sortOrder,
    metadata: sanitizeTopicMetadata(topic.metadata),
  };
}

function sanitizeTopicMetadata(metadata: Record<string, unknown> | null | undefined) {
  const safe: Record<string, unknown> = {};
  if (!metadata || typeof metadata !== "object") return safe;
  for (const [key, value] of Object.entries(metadata)) {
    if (publicMetadataKeys.has(key)) safe[key] = value;
  }
  return safe;
}

function publicTopicSelect() {
  return {
    id: topics.id,
    slug: topics.slug,
    name: topics.name,
    subText: topics.subText,
    description: topics.description,
    inputboxText: topics.inputboxText,
    iconUrl: topics.iconUrl,
    sortOrder: topics.sortOrder,
    metadata: topics.metadata,
  };
}

export async function getActiveTopics() {
  await ensureSeedTopics();
  return db
    .select()
    .from(topics)
    .where(eq(topics.status, "active"))
    .orderBy(asc(topics.sortOrder), asc(topics.name));
}

export async function getPublicActiveTopics() {
  await ensureSeedTopics();
  const rows = await db
    .select(publicTopicSelect())
    .from(topics)
    .where(eq(topics.status, "active"))
    .orderBy(asc(topics.sortOrder), asc(topics.name));
  return rows.map((topic) => ({ ...topic, metadata: sanitizeTopicMetadata(topic.metadata) }));
}

export async function getDefaultTopic() {
  await ensureSeedTopics();
  const [topic] = await db.select().from(topics).where(eq(topics.slug, defaultTopicSlug)).limit(1);
  return topic;
}

export async function getTopicByIdOrSlug(topicIdentifier: string) {
  await ensureSeedTopics();
  const normalized = topicIdentifier.trim();
  if (!normalized) return null;
  const [topic] = await db
    .select()
    .from(topics)
    .where(or(eq(topics.id, normalized), eq(topics.slug, normalized.toLowerCase())))
    .limit(1);
  return topic ?? null;
}

export async function getUserById(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user;
}

export async function getUserProfileById(userId: string) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      score: users.score,
      preferredLanguage: users.preferredLanguage,
      dateOfBirth: users.dateOfBirth,
      createdAt: users.createdAt,
      profileImageHash: usableProfileImageHash(),
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user;
}

function usableProfileImageHash() {
  return drizzleSql<string | null>`case when ${users.profileImageHash} is not null and ${users.profileImageR2Key} is not null and ${users.profileImageMime} is not null then ${users.profileImageHash} else null end`;
}

export async function getUserLearningProfileById(userId: string) {
  const [user] = await db
    .select({
      preferredLanguage: users.preferredLanguage,
      dateOfBirth: users.dateOfBirth,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user;
}

export async function getUserPhotoById(userId: string) {
  const [user] = await db
    .select({
      profileImageMime: users.profileImageMime,
      profileImageHash: users.profileImageHash,
      profileImageR2Key: users.profileImageR2Key,
      profileImageR2Etag: users.profileImageR2Etag,
      profileImageSize: users.profileImageSize,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user;
}

export async function updateUserProfilePhoto(
  userId: string,
  input: {
    profileImageMime: string;
    profileImageHash: string;
    profileImageR2Key: string;
    profileImageR2Etag?: string | null;
    profileImageSize: number;
  },
) {
  const [user] = await db
    .update(users)
    .set({
      profileImageMime: input.profileImageMime,
      profileImageHash: input.profileImageHash,
      profileImageR2Key: input.profileImageR2Key,
      profileImageR2Etag: input.profileImageR2Etag ?? null,
      profileImageSize: input.profileImageSize,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({
      profileImageHash: users.profileImageHash,
    });
  return user;
}

export async function clearUserProfilePhoto(userId: string) {
  const [user] = await db
    .update(users)
    .set({
      profileImageMime: null,
      profileImageHash: null,
      profileImageR2Key: null,
      profileImageR2Etag: null,
      profileImageSize: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({
      profileImageHash: users.profileImageHash,
    });
  return user;
}

export async function updateUserProfile(
  userId: string,
  input: {
    name?: string;
    preferredLanguage?: string;
    dateOfBirth?: string | null;
    dateOfBirthSource?: string;
  },
) {
  const [user] = await db
    .update(users)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage } : {}),
      ...(input.dateOfBirth !== undefined ? { dateOfBirth: input.dateOfBirth } : {}),
      ...(input.dateOfBirth !== undefined
        ? { dateOfBirthSource: input.dateOfBirth ? input.dateOfBirthSource ?? "user" : null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  return user;
}

export async function getAdminUsers() {
  const rows = await db.select().from(adminUsers).orderBy(asc(adminUsers.email));
  return rows;
}

export async function addAdminUser(input: { email: string; addedByUserId: string; addedByEmail: string | null }) {
  const normalized = input.email.trim().toLowerCase();
  const [admin] = await db
    .insert(adminUsers)
    .values({
      email: normalized,
      addedByUserId: input.addedByUserId,
      addedByEmail: input.addedByEmail,
    })
    .onConflictDoUpdate({
      target: adminUsers.email,
      set: {
        addedByUserId: input.addedByUserId,
        addedByEmail: input.addedByEmail,
      },
    })
    .returning();
  return admin;
}

export async function removeAdminUser(email: string) {
  const normalized = email.trim().toLowerCase();
  await db.delete(adminUsers).where(eq(adminUsers.email, normalized));
}

export type AdminDashboardData = Awaited<ReturnType<typeof getAdminDashboardData>>;

export async function getAdminDashboardData(days = 14) {
  const since = Date.now() - Math.max(1, Math.min(days, 90)) * 24 * 60 * 60 * 1000;
  const [aiDaily, productDaily, topRoutes, opsRecent, quotaEvents, llmUsage, totals] = await Promise.all([
    d1All<{
      day: string;
      runs: number;
      completed: number;
      failed: number;
      tokens: number;
      promptTokens: number;
      completionTokens: number;
    }>(
      `select
         date(created_at / 1000, 'unixepoch') as day,
         count(*) as runs,
         sum(case when status = 'completed' then 1 else 0 end) as completed,
         sum(case when status = 'failed' then 1 else 0 end) as failed,
         coalesce(sum(total_tokens), 0) as tokens,
         coalesce(sum(prompt_tokens), 0) as promptTokens,
         coalesce(sum(completion_tokens), 0) as completionTokens
       from ai_runs
       where created_at >= ?
       group by day
       order by day desc`,
      since,
    ),
    d1All<{ day: string; events: number; users: number }>(
      `select
         date(created_at / 1000, 'unixepoch') as day,
         count(*) as events,
         count(distinct user_id) as users
       from product_events
       where created_at >= ?
       group by day
       order by day desc`,
      since,
    ),
    d1All<{ route: string; views: number; users: number }>(
      `select
         coalesce(route, '/') as route,
         count(*) as views,
         count(distinct user_id) as users
       from product_events
       where created_at >= ?
         and name = 'page_view'
       group by coalesce(route, '/')
       order by views desc
       limit 10`,
      since,
    ),
    d1All<{
      eventName: string;
      severity: string;
      surface: string | null;
      message: string | null;
      createdAt: number;
    }>(
      `select
         event_name as eventName,
         severity,
         surface,
         message,
         created_at as createdAt
       from ops_events
       where created_at >= ?
       order by created_at desc
       limit 20`,
      since,
    ),
    d1All<{ eventName: string; count: number }>(
      `select event_name as eventName, count(*) as count
       from ops_events
       where created_at >= ?
         and event_name in ('rate_limit_denied', 'rate_limit_check_failed', 'llm_budget_denied', 'llm_budget_check_failed')
       group by event_name
       order by count desc`,
      since,
    ),
    db
      .select({
        day: llmUsageDailyShards.day,
        callCount: drizzleSql<number>`coalesce(sum(${llmUsageDailyShards.callCount}), 0)`,
      })
      .from(llmUsageDailyShards)
      .groupBy(llmUsageDailyShards.day)
      .orderBy(desc(llmUsageDailyShards.day))
      .limit(14),
    d1All<{
      users: number;
      chats: number;
      messages: number;
      aiRuns: number;
      productEvents: number;
      opsEvents: number;
    }>(
      `select
         (select count(*) from users) as users,
         (select count(*) from chats) as chats,
         (select count(*) from messages) as messages,
         (select count(*) from ai_runs) as aiRuns,
         (select count(*) from product_events where created_at >= ?) as productEvents,
         (select count(*) from ops_events where created_at >= ?) as opsEvents`,
      since,
      since,
    ),
  ]);

  return {
    since,
    aiDaily,
    productDaily,
    topRoutes,
    opsRecent,
    quotaEvents,
    llmUsage,
    totals: totals[0] ?? {
      users: 0,
      chats: 0,
      messages: 0,
      aiRuns: 0,
      productEvents: 0,
      opsEvents: 0,
    },
  };
}

export async function getAppTranslation(namespace: string, language: string) {
  const [translation] = await db
    .select()
    .from(appTranslations)
    .where(and(eq(appTranslations.namespace, namespace), eq(appTranslations.language, language)))
    .limit(1);
  return translation;
}

export async function getAppTranslations(namespaces: string[], languages: string[]) {
  if (!namespaces.length || !languages.length) return [];
  return db
    .select()
    .from(appTranslations)
    .where(and(inArray(appTranslations.namespace, namespaces), inArray(appTranslations.language, languages)));
}

export async function getAppTranslationSource(namespace: string) {
  const [source] = await db
    .select()
    .from(appTranslationSources)
    .where(eq(appTranslationSources.namespace, namespace))
    .limit(1);
  if (!source) return undefined;

  const sourceStrings = await db
    .select({
      key: appTranslationSourceStrings.sourceKey,
      value: appTranslationSourceStrings.sourceText,
    })
    .from(appTranslationSourceStrings)
    .where(eq(appTranslationSourceStrings.namespace, namespace))
    .orderBy(asc(appTranslationSourceStrings.sourceKey));

  return {
    ...source,
    sourceStrings: Object.fromEntries(sourceStrings.map((row) => [row.key, row.value])),
  };
}

export async function upsertAppTranslation(input: {
  namespace: string;
  language: string;
  sourceHash: string;
  payload: Record<string, string>;
  model: string;
}) {
  const existing = await getAppTranslation(input.namespace, input.language);
  const payload =
    existing?.sourceHash === input.sourceHash ? { ...existing.payload, ...input.payload } : input.payload;
  const [translation] = await db
    .insert(appTranslations)
    .values({ ...input, payload })
    .onConflictDoUpdate({
      target: [appTranslations.namespace, appTranslations.language],
      set: {
        sourceHash: input.sourceHash,
        payload,
        model: input.model,
        updatedAt: new Date(),
      },
    })
    .returning();
  return translation;
}

export async function deleteAppTranslation(namespace: string, language: string) {
  await db
    .delete(appTranslations)
    .where(and(eq(appTranslations.namespace, namespace), eq(appTranslations.language, language)));
}

export async function createChatForUser(userId: string, topicId: string) {
  const topic = await getTopicByIdOrSlug(topicId);
  if (!topic) return null;

  const [chat] = await db
    .insert(chats)
    .values({
      userId,
      topicId: topic.id,
      topicNameSnapshot: topic.name,
      title: topic.name,
    })
    .returning();

  return chat;
}

export async function getOwnedChat(chatId: string, userId: string) {
  const [chat] = await db
    .select({
      chat: chats,
      topic: topics,
    })
    .from(chats)
    .leftJoin(topics, eq(chats.topicId, topics.id))
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);

  return chat;
}

export async function getChatMessages(chatId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.createdAt));
}

export async function getChatMessagesByIds(chatId: string, messageIds: string[]) {
  const ids = [...new Set(messageIds)].filter(Boolean);
  if (!ids.length) return [];
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.chatId, chatId), inArray(messages.id, ids)))
    .orderBy(asc(messages.createdAt));
}

export async function getRecentChats(userId: string, topicId?: string, q?: string) {
  const topic = topicId ? await getTopicByIdOrSlug(topicId) : null;
  if (topicId && !topic) return [];
  const searchPattern = q ? d1ContainsLikePattern(q) : undefined;
  const baseWhere = [
    eq(chats.userId, userId),
    eq(chats.isArchived, false),
    topic ? eq(chats.topicId, topic.id) : undefined,
  ].filter(Boolean);

  if (!searchPattern) {
    const chatRows = await db
      .select({
        id: chats.id,
        topicId: chats.topicId,
        topicName: chats.topicNameSnapshot,
        title: chats.title,
        createdAt: chats.createdAt,
        updatedAt: chats.updatedAt,
      })
      .from(chats)
      .where(and(...baseWhere))
      .orderBy(desc(chats.updatedAt))
      .limit(100);
    const replyCounts = await getReplyCounts(chatRows.map((chat) => chat.id));
    return chatRows.map((chat) => ({ ...chat, replyCount: replyCounts.get(chat.id) ?? 0 }));
  }

  const where = [
    ...baseWhere,
    searchPattern
      ? or(
          drizzleSql`lower(${chats.title}) like lower(${searchPattern}) escape '\\'`,
          drizzleSql`lower(${chats.topicNameSnapshot}) like lower(${searchPattern}) escape '\\'`,
          drizzleSql`lower(${messages.content}) like lower(${searchPattern}) escape '\\'`,
        )
      : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: chats.id,
      topicId: chats.topicId,
      topicName: chats.topicNameSnapshot,
      title: chats.title,
      createdAt: chats.createdAt,
      updatedAt: chats.updatedAt,
      replyCount: count(messages.id),
    })
    .from(chats)
    .leftJoin(messages, eq(messages.chatId, chats.id))
    .where(and(...where))
    .groupBy(chats.id)
    .orderBy(desc(chats.updatedAt))
    .limit(100);

  return rows;
}

async function getReplyCounts(chatIds: string[]) {
  if (!chatIds.length) return new Map<string, number>();
  const rows = await db
    .select({
      chatId: messages.chatId,
      replyCount: count(messages.id),
    })
    .from(messages)
    .where(inArray(messages.chatId, chatIds))
    .groupBy(messages.chatId);
  return new Map(rows.map((row) => [row.chatId, row.replyCount]));
}

export async function getChatPreviews(chatIds: string[]) {
  const ids = [...new Set(chatIds)].filter(Boolean);
  if (!ids.length) return new Map<string, string>();
  const rows = await db
    .select({ chatId: messages.chatId, content: messages.content })
    .from(messages)
    .where(and(eq(messages.role, "user"), inArray(messages.chatId, ids)))
    .orderBy(asc(messages.chatId), asc(messages.createdAt));
  const previews = new Map<string, string>();
  for (const row of rows) {
    if (!previews.has(row.chatId)) previews.set(row.chatId, getVisibleMessageContent(row.content));
  }
  return previews;
}

export async function getChatPreview(chatId: string) {
  const [firstUserMessage] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.role, "user")))
    .orderBy(asc(messages.createdAt))
    .limit(1);
  return firstUserMessage ? getVisibleMessageContent(firstUserMessage.content) : undefined;
}

export async function insertMessage(input: {
  chatId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const [message] = await db
    .insert(messages)
    .values({ ...input, metadata: input.metadata ?? {} })
    .returning();
  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, input.chatId));
  if (input.role === "user") {
    const [{ value }] = await db
      .select({ value: count(messages.id) })
      .from(messages)
      .where(and(eq(messages.chatId, input.chatId), eq(messages.role, "user")));
    if (value === 1) {
      const visibleTitle = getVisibleMessageContent(input.content);
      await db
        .update(chats)
        .set({ title: visibleTitle.slice(0, 96), updatedAt: new Date() })
        .where(eq(chats.id, input.chatId));
    }
  }
  return message;
}

export async function createActivityRun(input: {
  chatId: string;
  type: string;
  status?: string;
  state: Record<string, unknown>;
  score?: number | null;
  maxScore?: number | null;
}) {
  const [run] = await db
    .insert(activityRuns)
    .values({
      chatId: input.chatId,
      type: input.type,
      status: input.status ?? "active",
      state: input.state,
      score: input.score ?? null,
      maxScore: input.maxScore ?? null,
    })
    .returning();
  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, input.chatId));
  return run;
}

export async function getLatestActivityRun(chatId: string) {
  const [run] = await db
    .select()
    .from(activityRuns)
    .where(eq(activityRuns.chatId, chatId))
    .orderBy(desc(activityRuns.updatedAt))
    .limit(1);
  return run;
}

export async function getActivityRunById(activityRunId: string) {
  const [run] = await db
    .select()
    .from(activityRuns)
    .where(eq(activityRuns.id, activityRunId))
    .limit(1);
  return run;
}

export async function updateActivityRun(
  activityRunId: string,
  input: {
    status?: string;
    state?: Record<string, unknown>;
    score?: number | null;
    maxScore?: number | null;
    completedAt?: Date | null;
  },
) {
  const [run] = await db
    .update(activityRuns)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(activityRuns.id, activityRunId))
    .returning();
  if (run?.chatId) {
    await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, run.chatId));
  }
  return run;
}

export async function updateActivityRunGuarded(
  activityRunId: string,
  input: {
    status?: string;
    state?: Record<string, unknown>;
    score?: number | null;
    maxScore?: number | null;
    completedAt?: Date | null;
  },
  guard: {
    currentIndex: number;
    status?: string;
  },
) {
  const [run] = await db
    .update(activityRuns)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(activityRuns.id, activityRunId),
        guard.status ? eq(activityRuns.status, guard.status) : undefined,
        drizzleSql`json_extract(${activityRuns.state}, '$.currentIndex') = ${guard.currentIndex}`,
      ),
    )
    .returning();
  if (run?.chatId) {
    await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, run.chatId));
  }
  return run;
}

export async function getOwnedAiRun(aiRunId: string, userId: string) {
  const [run] = await db
    .select({ id: aiRuns.id })
    .from(aiRuns)
    .innerJoin(chats, eq(aiRuns.chatId, chats.id))
    .where(and(eq(aiRuns.id, aiRunId), eq(chats.userId, userId)))
    .limit(1);
  return run ?? null;
}

export async function getContextMessages(chatId: string, limit = 30) {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.chatId, chatId), inArray(messages.role, ["user", "assistant"])))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}
