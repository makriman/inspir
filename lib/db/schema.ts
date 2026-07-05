import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const uuidText = (name: string) => text(name).$defaultFn(() => crypto.randomUUID());
const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const timestampMsNow = (name: string) =>
  integer(name, { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
const booleanInt = (name: string) => integer(name, { mode: "boolean" });
const jsonText = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

export const users = sqliteTable("users", {
  id: uuidText("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestampMs("email_verified"),
  image: text("image"),
  score: integer("score").notNull().default(0),
  profilePictureUrl: text("profile_picture_url"),
  profileImageData: text("profile_image_data"),
  profileImageMime: text("profile_image_mime"),
  profileImageHash: text("profile_image_hash"),
  preferredLanguage: text("preferred_language").notNull().default("English"),
  dateOfBirth: text("date_of_birth"),
  dateOfBirthSource: text("date_of_birth_source"),
  profilePictureDownloadedAt: timestampMs("profile_picture_downloaded_at"),
  createdAt: timestampMsNow("created_at"),
  updatedAt: timestampMsNow("updated_at"),
});

export const accounts = sqliteTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.provider, table.providerAccountId] }),
    userIdx: index("accounts_user_id_idx").on(table.userId),
  }),
);

export const sessions = sqliteTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestampMs("expires").notNull(),
});

export const verificationTokens = sqliteTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestampMs("expires").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.identifier, table.token] }),
  }),
);

export const rateLimitWindows = sqliteTable("rate_limit_windows", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestampMs("reset_at").notNull(),
  createdAt: timestampMsNow("created_at"),
  updatedAt: timestampMsNow("updated_at"),
});

export const llmUsageDaily = sqliteTable("llm_usage_daily", {
  day: text("day").primaryKey(),
  callCount: integer("call_count").notNull().default(0),
  createdAt: timestampMsNow("created_at"),
  updatedAt: timestampMsNow("updated_at"),
});

export const appMetadata = sqliteTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestampMsNow("updated_at"),
});

export const topics = sqliteTable("topics", {
  id: uuidText("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  subText: text("sub_text").notNull(),
  description: text("description").notNull(),
  inputboxText: text("inputbox_text").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  iconUrl: text("icon_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("active"),
  metadata: jsonText<Record<string, unknown>>("metadata")
    .notNull()
    .$defaultFn(() => ({})),
  createdAt: timestampMsNow("created_at"),
  updatedAt: timestampMsNow("updated_at"),
});

export const topicLegacyIds = sqliteTable("topic_legacy_ids", {
  legacyId: text("legacy_id").primaryKey(),
  topicId: text("topic_id")
    .references(() => topics.id, { onDelete: "cascade" })
    .notNull(),
  source: text("source").notNull(),
  confidence: text("confidence").notNull().default("derived"),
});

export const chats = sqliteTable(
  "chats",
  {
    id: uuidText("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    userEmailSnapshot: text("user_email_snapshot"),
    topicId: text("topic_id").references(() => topics.id, { onDelete: "set null" }),
    legacyTopicId: text("legacy_topic_id"),
    topicNameSnapshot: text("topic_name_snapshot"),
    title: text("title"),
    isArchived: booleanInt("is_archived").notNull().default(false),
    createdAt: timestampMsNow("created_at"),
    updatedAt: timestampMsNow("updated_at"),
  },
  (table) => ({
    userIdx: index("chats_user_id_idx").on(table.userId),
    topicIdx: index("chats_topic_id_idx").on(table.topicId),
  }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: uuidText("id").primaryKey(),
    chatId: text("chat_id")
      .references(() => chats.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonText<Record<string, unknown>>("metadata")
      .notNull()
      .$defaultFn(() => ({})),
    legacySenderId: text("legacy_sender_id"),
    legacyUserId: text("legacy_user_id"),
    legacyTopicId: text("legacy_topic_id"),
    createdAt: timestampMsNow("created_at"),
  },
  (table) => ({
    chatCreatedIdx: index("messages_chat_created_idx").on(table.chatId, table.createdAt),
  }),
);

export const activityRuns = sqliteTable(
  "activity_runs",
  {
    id: uuidText("id").primaryKey(),
    chatId: text("chat_id")
      .references(() => chats.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("active"),
    state: jsonText<Record<string, unknown>>("state")
      .notNull()
      .$defaultFn(() => ({})),
    score: integer("score"),
    maxScore: integer("max_score"),
    createdAt: timestampMsNow("created_at"),
    updatedAt: timestampMsNow("updated_at"),
    completedAt: timestampMs("completed_at"),
  },
  (table) => ({
    chatIdx: index("activity_runs_chat_id_idx").on(table.chatId),
    typeIdx: index("activity_runs_type_idx").on(table.type),
  }),
);

export const aiRuns = sqliteTable("ai_runs", {
  id: uuidText("id").primaryKey(),
  chatId: text("chat_id")
    .references(() => chats.id, { onDelete: "cascade" })
    .notNull(),
  userMessageId: text("user_message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  assistantMessageId: text("assistant_message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  memoryContext: jsonText<Record<string, unknown>>("memory_context")
    .notNull()
    .$defaultFn(() => ({})),
  status: text("status").notNull().default("started"),
  error: text("error"),
  createdAt: timestampMsNow("created_at"),
  completedAt: timestampMs("completed_at"),
});

export const userMemorySettings = sqliteTable("user_memory_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: booleanInt("enabled").notNull().default(true),
  savedMemoryEnabled: booleanInt("saved_memory_enabled").notNull().default(true),
  chatHistoryEnabled: booleanInt("chat_history_enabled").notNull().default(true),
  dreamingEnabled: booleanInt("dreaming_enabled").notNull().default(true),
  captureScope: text("capture_scope").notNull().default("broad"),
  retrievalMode: text("retrieval_mode").notNull().default("need_based"),
  noticeSeenAt: timestampMs("notice_seen_at"),
  createdAt: timestampMsNow("created_at"),
  updatedAt: timestampMsNow("updated_at"),
});

export const userMemories = sqliteTable(
  "user_memories",
  {
    id: uuidText("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("auto"),
    category: text("category").notNull().default("general"),
    content: text("content").notNull(),
    tags: jsonText<string[]>("tags")
      .notNull()
      .$defaultFn(() => []),
    confidence: integer("confidence").notNull().default(70),
    salience: integer("salience").notNull().default(50),
    status: text("status").notNull().default("active"),
    sourceType: text("source_type").notNull().default("auto"),
    sourceTurnIds: jsonText<string[]>("source_turn_ids")
      .notNull()
      .$defaultFn(() => []),
    sourceMemoryIds: jsonText<string[]>("source_memory_ids")
      .notNull()
      .$defaultFn(() => []),
    sourceChatId: text("source_chat_id").references(() => chats.id, { onDelete: "set null" }),
    sourceMessageId: text("source_message_id").references(() => messages.id, { onDelete: "set null" }),
    supersededByMemoryId: text("superseded_by_memory_id"),
    embedding: jsonText<number[] | null>("embedding"),
    validFrom: timestampMs("valid_from"),
    validUntil: timestampMs("valid_until"),
    freshnessStatus: text("freshness_status").notNull().default("current"),
    pinned: booleanInt("pinned").notNull().default(false),
    doNotMention: booleanInt("do_not_mention").notNull().default(false),
    createdAt: timestampMsNow("created_at"),
    updatedAt: timestampMsNow("updated_at"),
    lastUsedAt: timestampMs("last_used_at"),
    deletedAt: timestampMs("deleted_at"),
  },
  (table) => ({
    userStatusIdx: index("user_memories_user_status_idx").on(table.userId, table.status),
    categoryIdx: index("user_memories_category_idx").on(table.category),
    sourceChatIdx: index("user_memories_source_chat_idx").on(table.sourceChatId),
    sourceTypeIdx: index("user_memories_source_type_idx").on(table.sourceType),
    freshnessIdx: index("user_memories_freshness_idx").on(table.freshnessStatus),
    doNotMentionIdx: index("user_memories_do_not_mention_idx").on(table.doNotMention),
  }),
);

export const chatMemorySummaries = sqliteTable(
  "chat_memory_summaries",
  {
    chatId: text("chat_id")
      .primaryKey()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: text("topic_id").references(() => topics.id, { onDelete: "set null" }),
    summary: text("summary").notNull(),
    topics: jsonText<string[]>("topics")
      .notNull()
      .$defaultFn(() => []),
    sourceMessageCount: integer("source_message_count").notNull().default(0),
    lastMessageId: text("last_message_id").references(() => messages.id, { onDelete: "set null" }),
    embedding: jsonText<number[] | null>("embedding"),
    createdAt: timestampMsNow("created_at"),
    updatedAt: timestampMsNow("updated_at"),
  },
  (table) => ({
    userIdx: index("chat_memory_summaries_user_idx").on(table.userId),
    topicIdx: index("chat_memory_summaries_topic_idx").on(table.topicId),
  }),
);

export const chatMemoryTurns = sqliteTable(
  "chat_memory_turns",
  {
    id: uuidText("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    topicId: text("topic_id").references(() => topics.id, { onDelete: "set null" }),
    userMessageId: text("user_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    assistantMessageId: text("assistant_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answerExcerpt: text("answer_excerpt").notNull(),
    searchableText: text("searchable_text").notNull(),
    topics: jsonText<string[]>("topics")
      .notNull()
      .$defaultFn(() => []),
    embedding: jsonText<number[] | null>("embedding"),
    createdAt: timestampMsNow("created_at"),
    updatedAt: timestampMsNow("updated_at"),
  },
  (table) => ({
    userIdx: index("chat_memory_turns_user_idx").on(table.userId),
    chatIdx: index("chat_memory_turns_chat_idx").on(table.chatId),
    topicIdx: index("chat_memory_turns_topic_idx").on(table.topicId),
    userMessageIdx: uniqueIndex("chat_memory_turns_user_message_idx").on(table.userMessageId),
  }),
);

export const userMemoryProfiles = sqliteTable(
  "user_memory_profiles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    summary: text("summary").notNull(),
    sourceMemoryIds: jsonText<string[]>("source_memory_ids")
      .notNull()
      .$defaultFn(() => []),
    lastCompiledAt: timestampMsNow("last_compiled_at"),
    createdAt: timestampMsNow("created_at"),
    updatedAt: timestampMsNow("updated_at"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.category] }),
  }),
);

export const userMemorySummaries = sqliteTable("user_memory_summaries", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  sections: jsonText<
    Array<{
      id: string;
      title: string;
      category: string;
      summary: string;
      sourceMemoryIds?: string[];
      sourceTurnIds?: string[];
      doNotMention?: boolean;
    }>
  >("sections")
    .notNull()
    .$defaultFn(() => []),
  sourceMemoryIds: jsonText<string[]>("source_memory_ids")
    .notNull()
    .$defaultFn(() => []),
  sourceTurnIds: jsonText<string[]>("source_turn_ids")
    .notNull()
    .$defaultFn(() => []),
  version: integer("version").notNull().default(1),
  lastSynthesizedAt: timestampMsNow("last_synthesized_at"),
  createdAt: timestampMsNow("created_at"),
  updatedAt: timestampMsNow("updated_at"),
});

export const memorySynthesisRuns = sqliteTable(
  "memory_synthesis_runs",
  {
    id: uuidText("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("started"),
    inputCounts: jsonText<Record<string, unknown>>("input_counts")
      .notNull()
      .$defaultFn(() => ({})),
    outputCounts: jsonText<Record<string, unknown>>("output_counts")
      .notNull()
      .$defaultFn(() => ({})),
    error: text("error"),
    startedAt: timestampMsNow("started_at"),
    finishedAt: timestampMs("finished_at"),
    createdAt: timestampMsNow("created_at"),
  },
  (table) => ({
    userStatusIdx: index("memory_synthesis_runs_user_status_idx").on(table.userId, table.status),
    startedIdx: index("memory_synthesis_runs_started_idx").on(table.startedAt),
  }),
);

export const memorySourceFeedback = sqliteTable(
  "memory_source_feedback",
  {
    id: uuidText("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    aiRunId: text("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    memoryId: text("memory_id").references(() => userMemories.id, { onDelete: "set null" }),
    chatTurnId: text("chat_turn_id").references(() => chatMemoryTurns.id, { onDelete: "set null" }),
    summarySectionId: text("summary_section_id"),
    action: text("action").notNull(),
    note: text("note"),
    createdAt: timestampMsNow("created_at"),
  },
  (table) => ({
    userIdx: index("memory_source_feedback_user_idx").on(table.userId, table.createdAt),
    memoryIdx: index("memory_source_feedback_memory_idx").on(table.memoryId),
    turnIdx: index("memory_source_feedback_turn_idx").on(table.chatTurnId),
  }),
);

export const memoryEvents = sqliteTable(
  "memory_events",
  {
    id: uuidText("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memoryId: text("memory_id").references(() => userMemories.id, { onDelete: "set null" }),
    chatId: text("chat_id").references(() => chats.id, { onDelete: "set null" }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    reason: text("reason"),
    metadata: jsonText<Record<string, unknown>>("metadata")
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: timestampMsNow("created_at"),
  },
  (table) => ({
    userCreatedIdx: index("memory_events_user_created_idx").on(table.userId, table.createdAt),
    memoryIdx: index("memory_events_memory_idx").on(table.memoryId),
  }),
);

export const legacyChatSnapshots = sqliteTable("legacy_chat_snapshots", {
  id: uuidText("id").primaryKey(),
  assistantRaw: text("assistant_raw"),
  messagesRaw: text("messages_raw"),
  questionsRaw: text("questions_raw"),
  topicRaw: text("topic_raw"),
  topicName: text("topic_name"),
  legacyTopicId: text("legacy_topic_id"),
  userEmail: text("user_email"),
  importedAt: timestampMsNow("imported_at"),
});

export const legacyDummyData = sqliteTable("legacy_dummy_data", {
  id: uuidText("id").primaryKey(),
  dummy: text("dummy"),
  legacyTopicId: text("legacy_topic_id"),
  creatorLegacyId: text("creator_legacy_id"),
  createdAt: timestampMs("created_at"),
  modifiedAt: timestampMs("modified_at"),
});

export const appTranslations = sqliteTable(
  "app_translations",
  {
    namespace: text("namespace").notNull(),
    language: text("language").notNull(),
    sourceHash: text("source_hash").notNull(),
    payload: jsonText<Record<string, string>>("payload")
      .notNull()
      .$defaultFn(() => ({})),
    model: text("model").notNull(),
    createdAt: timestampMsNow("created_at"),
    updatedAt: timestampMsNow("updated_at"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.namespace, table.language] }),
    languageIdx: index("app_translations_language_idx").on(table.language),
  }),
);

export const appTranslationSources = sqliteTable("app_translation_sources", {
  namespace: text("namespace").primaryKey(),
  sourceHash: text("source_hash").notNull(),
  updatedAt: timestampMsNow("updated_at"),
});

export const appTranslationSourceStrings = sqliteTable(
  "app_translation_source_strings",
  {
    namespace: text("namespace")
      .notNull()
      .references(() => appTranslationSources.namespace, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    sourceText: text("source_text").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.namespace, table.sourceKey] }),
  }),
);

export const sourceTimestampPrecision = sqliteTable(
  "source_timestamp_precision",
  {
    sourceTable: text("source_table").notNull(),
    sourcePk: text("source_pk").notNull(),
    columnName: text("column_name").notNull(),
    originalTimestamp: text("original_timestamp").notNull(),
    d1TimestampMs: integer("d1_timestamp_ms").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sourceTable, table.sourcePk, table.columnName] }),
    tableIdx: index("source_timestamp_precision_table_idx").on(table.sourceTable, table.columnName),
  }),
);

export type Topic = typeof topics.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type User = typeof users.$inferSelect;
export type RateLimitWindow = typeof rateLimitWindows.$inferSelect;
export type LlmUsageDaily = typeof llmUsageDaily.$inferSelect;
export type AppMetadata = typeof appMetadata.$inferSelect;
export type ActivityRun = typeof activityRuns.$inferSelect;
export type AppTranslation = typeof appTranslations.$inferSelect;
export type AppTranslationSource = typeof appTranslationSources.$inferSelect;
export type AppTranslationSourceString = typeof appTranslationSourceStrings.$inferSelect;
export type UserMemorySetting = typeof userMemorySettings.$inferSelect;
export type UserMemory = typeof userMemories.$inferSelect;
export type ChatMemorySummary = typeof chatMemorySummaries.$inferSelect;
export type ChatMemoryTurn = typeof chatMemoryTurns.$inferSelect;
export type UserMemoryProfile = typeof userMemoryProfiles.$inferSelect;
export type UserMemorySummary = typeof userMemorySummaries.$inferSelect;
export type MemorySynthesisRun = typeof memorySynthesisRuns.$inferSelect;
export type MemorySourceFeedback = typeof memorySourceFeedback.$inferSelect;
export type MemoryEvent = typeof memoryEvents.$inferSelect;
export type SourceTimestampPrecision = typeof sourceTimestampPrecision.$inferSelect;

export const sqlitePragmas = sql`pragma foreign_keys = on`;
