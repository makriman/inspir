import { and, asc, count, desc, eq, ilike, inArray, or, sql as drizzleSql } from "drizzle-orm";
import { db } from "./client";
import { activityRuns, appTranslations, chats, messages, topics, users } from "./schema";
import { defaultTopicSlug, topicSeeds } from "@/lib/content/topics";
import { getVisibleMessageContent } from "@/lib/ai/visible-content";

async function ensureSeedTopics() {
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
        .onConflictDoUpdate({
          target: topics.slug,
          set: {
            name: topic.name,
            subText: topic.subText,
            description: topic.description,
            inputboxText: topic.inputboxText,
            systemPrompt: topic.systemPrompt,
            sortOrder: topic.sortOrder,
            metadata: topic.metadata,
            status: "active",
            updatedAt: new Date(),
          },
        }),
    ),
  );
}

export async function getActiveTopics() {
  await ensureSeedTopics();
  return db
    .select()
    .from(topics)
    .where(eq(topics.status, "active"))
    .orderBy(asc(topics.sortOrder), asc(topics.name));
}

export async function getDefaultTopic() {
  await ensureSeedTopics();
  const [topic] = await db.select().from(topics).where(eq(topics.slug, defaultTopicSlug)).limit(1);
  return topic;
}

export async function getUserById(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user;
}

export async function updateUserProfile(
  userId: string,
  input: {
    preferredLanguage?: string;
    dateOfBirth?: string;
    dateOfBirthSource?: string;
  },
) {
  const [user] = await db
    .update(users)
    .set({
      ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage } : {}),
      ...(input.dateOfBirth ? { dateOfBirth: input.dateOfBirth } : {}),
      ...(input.dateOfBirth ? { dateOfBirthSource: input.dateOfBirthSource ?? "user" } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  return user;
}

export async function getAppTranslation(namespace: string, language: string) {
  const [translation] = await db
    .select()
    .from(appTranslations)
    .where(and(eq(appTranslations.namespace, namespace), eq(appTranslations.language, language)))
    .limit(1);
  return translation;
}

export async function upsertAppTranslation(input: {
  namespace: string;
  language: string;
  sourceHash: string;
  payload: Record<string, string>;
  model: string;
}) {
  const [translation] = await db
    .insert(appTranslations)
    .values(input)
    .onConflictDoUpdate({
      target: [appTranslations.namespace, appTranslations.language],
      set: {
        sourceHash: input.sourceHash,
        payload: drizzleSql`
          case
            when ${appTranslations.sourceHash} = ${input.sourceHash}
              then ${appTranslations.payload} || excluded.payload
            else excluded.payload
          end
        `,
        model: input.model,
        updatedAt: new Date(),
      },
    })
    .returning();
  return translation;
}

export async function createChatForUser(userId: string, topicId: string) {
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
  if (!topic) throw new Error("Topic not found");

  const [chat] = await db
    .insert(chats)
    .values({
      userId,
      topicId,
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

export async function getRecentChats(userId: string, topicId?: string, q?: string) {
  const where = [
    eq(chats.userId, userId),
    eq(chats.isArchived, false),
    topicId ? eq(chats.topicId, topicId) : undefined,
    q
      ? or(
          ilike(chats.title, `%${q}%`),
          ilike(chats.topicNameSnapshot, `%${q}%`),
          ilike(messages.content, `%${q}%`),
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

export async function getContextMessages(chatId: string, limit = 30) {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.chatId, chatId), inArray(messages.role, ["user", "assistant"])))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}
