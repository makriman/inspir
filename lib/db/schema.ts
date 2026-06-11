import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
  score: integer("score").notNull().default(0),
  profilePictureUrl: text("profile_picture_url"),
  profileImageData: text("profile_image_data"),
  profileImageMime: text("profile_image_mime"),
  profileImageHash: text("profile_image_hash"),
  preferredLanguage: text("preferred_language").notNull().default("English"),
  dateOfBirth: date("date_of_birth", { mode: "string" }),
  dateOfBirthSource: text("date_of_birth_source"),
  profilePictureDownloadedAt: timestamp("profile_picture_downloaded_at", {
    withTimezone: true,
  }),
  legacyBubbleId: text("legacy_bubble_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
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

// NextAuth is configured for JWT sessions. This table stays for adapter
// compatibility and future provider flexibility; live sessions are not read
// from it unless the auth strategy changes.
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.identifier, table.token] }),
  }),
);

export const rateLimitWindows = pgTable("rate_limit_windows", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const llmUsageDaily = pgTable("llm_usage_daily", {
  day: date("day", { mode: "string" }).primaryKey(),
  callCount: integer("call_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const appMetadata = pgTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const topics = pgTable("topics", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  legacyBubbleId: text("legacy_bubble_id"),
  name: text("name").notNull(),
  subText: text("sub_text").notNull(),
  description: text("description").notNull(),
  inputboxText: text("inputbox_text").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  iconUrl: text("icon_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const topicLegacyIds = pgTable("topic_legacy_ids", {
  legacyId: text("legacy_id").primaryKey(),
  topicId: uuid("topic_id")
    .references(() => topics.id, { onDelete: "cascade" })
    .notNull(),
  source: text("source").notNull(),
  confidence: text("confidence").notNull().default("derived"),
});

export const chats = pgTable(
  "chats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBubbleId: text("legacy_bubble_id"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userEmailSnapshot: text("user_email_snapshot"),
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    legacyTopicId: text("legacy_topic_id"),
    topicNameSnapshot: text("topic_name_snapshot"),
    title: text("title"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    legacyChatIdx: uniqueIndex("chats_legacy_bubble_id_idx").on(table.legacyBubbleId),
    userIdx: index("chats_user_id_idx").on(table.userId),
    topicIdx: index("chats_topic_id_idx").on(table.topicId),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    legacyBubbleId: text("legacy_bubble_id"),
    chatId: uuid("chat_id")
      .references(() => chats.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    legacySenderId: text("legacy_sender_id"),
    legacyUserId: text("legacy_user_id"),
    legacyTopicId: text("legacy_topic_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    chatCreatedIdx: index("messages_chat_created_idx").on(table.chatId, table.createdAt),
  }),
);

export const activityRuns = pgTable(
  "activity_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatId: uuid("chat_id")
      .references(() => chats.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    status: text("status").notNull().default("active"),
    state: jsonb("state").$type<Record<string, unknown>>().default({}).notNull(),
    score: integer("score"),
    maxScore: integer("max_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    chatIdx: index("activity_runs_chat_id_idx").on(table.chatId),
    typeIdx: index("activity_runs_type_idx").on(table.type),
  }),
);

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  chatId: uuid("chat_id")
    .references(() => chats.id, { onDelete: "cascade" })
    .notNull(),
  userMessageId: uuid("user_message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  assistantMessageId: uuid("assistant_message_id").references(() => messages.id, {
    onDelete: "set null",
  }),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  memoryContext: jsonb("memory_context").$type<Record<string, unknown>>().default({}).notNull(),
  status: text("status").notNull().default("started"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const userMemorySettings = pgTable("user_memory_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  savedMemoryEnabled: boolean("saved_memory_enabled").notNull().default(true),
  chatHistoryEnabled: boolean("chat_history_enabled").notNull().default(true),
  dreamingEnabled: boolean("dreaming_enabled").notNull().default(true),
  captureScope: text("capture_scope").notNull().default("broad"),
  retrievalMode: text("retrieval_mode").notNull().default("need_based"),
  noticeSeenAt: timestamp("notice_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userMemories = pgTable(
  "user_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("auto"),
    category: text("category").notNull().default("general"),
    content: text("content").notNull(),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    confidence: integer("confidence").notNull().default(70),
    salience: integer("salience").notNull().default(50),
    status: text("status").notNull().default("active"),
    sourceType: text("source_type").notNull().default("auto"),
    sourceTurnIds: jsonb("source_turn_ids").$type<string[]>().default([]).notNull(),
    sourceMemoryIds: jsonb("source_memory_ids").$type<string[]>().default([]).notNull(),
    sourceChatId: uuid("source_chat_id").references(() => chats.id, { onDelete: "set null" }),
    sourceMessageId: uuid("source_message_id").references(() => messages.id, { onDelete: "set null" }),
    supersededByMemoryId: uuid("superseded_by_memory_id"),
    embedding: vector("embedding", { dimensions: 512 }),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    freshnessStatus: text("freshness_status").notNull().default("current"),
    pinned: boolean("pinned").notNull().default(false),
    doNotMention: boolean("do_not_mention").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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

export const chatMemorySummaries = pgTable(
  "chat_memory_summaries",
  {
    chatId: uuid("chat_id")
      .primaryKey()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    summary: text("summary").notNull(),
    topics: jsonb("topics").$type<string[]>().default([]).notNull(),
    sourceMessageCount: integer("source_message_count").notNull().default(0),
    lastMessageId: uuid("last_message_id").references(() => messages.id, { onDelete: "set null" }),
    embedding: vector("embedding", { dimensions: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("chat_memory_summaries_user_idx").on(table.userId),
    topicIdx: index("chat_memory_summaries_topic_idx").on(table.topicId),
  }),
);

export const chatMemoryTurns = pgTable(
  "chat_memory_turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    userMessageId: uuid("user_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    assistantMessageId: uuid("assistant_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answerExcerpt: text("answer_excerpt").notNull(),
    searchableText: text("searchable_text").notNull(),
    topics: jsonb("topics").$type<string[]>().default([]).notNull(),
    embedding: vector("embedding", { dimensions: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("chat_memory_turns_user_idx").on(table.userId),
    chatIdx: index("chat_memory_turns_chat_idx").on(table.chatId),
    topicIdx: index("chat_memory_turns_topic_idx").on(table.topicId),
    userMessageIdx: uniqueIndex("chat_memory_turns_user_message_idx").on(table.userMessageId),
  }),
);

export const userMemoryProfiles = pgTable(
  "user_memory_profiles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    summary: text("summary").notNull(),
    sourceMemoryIds: jsonb("source_memory_ids").$type<string[]>().default([]).notNull(),
    lastCompiledAt: timestamp("last_compiled_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.category] }),
  }),
);

export const userMemorySummaries = pgTable("user_memory_summaries", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  sections: jsonb("sections")
    .$type<
      Array<{
        id: string;
        title: string;
        category: string;
        summary: string;
        sourceMemoryIds?: string[];
        sourceTurnIds?: string[];
        doNotMention?: boolean;
      }>
    >()
    .default([])
    .notNull(),
  sourceMemoryIds: jsonb("source_memory_ids").$type<string[]>().default([]).notNull(),
  sourceTurnIds: jsonb("source_turn_ids").$type<string[]>().default([]).notNull(),
  version: integer("version").notNull().default(1),
  lastSynthesizedAt: timestamp("last_synthesized_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memorySynthesisRuns = pgTable(
  "memory_synthesis_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("started"),
    inputCounts: jsonb("input_counts").$type<Record<string, unknown>>().default({}).notNull(),
    outputCounts: jsonb("output_counts").$type<Record<string, unknown>>().default({}).notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userStatusIdx: index("memory_synthesis_runs_user_status_idx").on(table.userId, table.status),
    startedIdx: index("memory_synthesis_runs_started_idx").on(table.startedAt),
  }),
);

export const memorySourceFeedback = pgTable(
  "memory_source_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    memoryId: uuid("memory_id").references(() => userMemories.id, { onDelete: "set null" }),
    chatTurnId: uuid("chat_turn_id").references(() => chatMemoryTurns.id, { onDelete: "set null" }),
    summarySectionId: text("summary_section_id"),
    action: text("action").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("memory_source_feedback_user_idx").on(table.userId, table.createdAt),
    memoryIdx: index("memory_source_feedback_memory_idx").on(table.memoryId),
    turnIdx: index("memory_source_feedback_turn_idx").on(table.chatTurnId),
  }),
);

export const memoryEvents = pgTable(
  "memory_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memoryId: uuid("memory_id").references(() => userMemories.id, { onDelete: "set null" }),
    chatId: uuid("chat_id").references(() => chats.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userCreatedIdx: index("memory_events_user_created_idx").on(table.userId, table.createdAt),
    memoryIdx: index("memory_events_memory_idx").on(table.memoryId),
  }),
);

export const legacyChatSnapshots = pgTable("legacy_chat_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  assistantRaw: text("assistant_raw"),
  messagesRaw: text("messages_raw"),
  questionsRaw: text("questions_raw"),
  topicRaw: text("topic_raw"),
  topicName: text("topic_name"),
  legacyTopicId: text("legacy_topic_id"),
  userEmail: text("user_email"),
  importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
});

export const legacyDummyData = pgTable("legacy_dummy_data", {
  id: uuid("id").defaultRandom().primaryKey(),
  dummy: text("dummy"),
  legacyTopicId: text("legacy_topic_id"),
  creatorLegacyId: text("creator_legacy_id"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  modifiedAt: timestamp("modified_at", { withTimezone: true }),
});

export const appTranslations = pgTable(
  "app_translations",
  {
    namespace: text("namespace").notNull(),
    language: text("language").notNull(),
    sourceHash: text("source_hash").notNull(),
    payload: jsonb("payload").$type<Record<string, string>>().default({}).notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.namespace, table.language] }),
    languageIdx: index("app_translations_language_idx").on(table.language),
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
export type UserMemorySetting = typeof userMemorySettings.$inferSelect;
export type UserMemory = typeof userMemories.$inferSelect;
export type ChatMemorySummary = typeof chatMemorySummaries.$inferSelect;
export type ChatMemoryTurn = typeof chatMemoryTurns.$inferSelect;
export type UserMemoryProfile = typeof userMemoryProfiles.$inferSelect;
export type UserMemorySummary = typeof userMemorySummaries.$inferSelect;
export type MemorySynthesisRun = typeof memorySynthesisRuns.$inferSelect;
export type MemorySourceFeedback = typeof memorySourceFeedback.$inferSelect;
export type MemoryEvent = typeof memoryEvents.$inferSelect;
