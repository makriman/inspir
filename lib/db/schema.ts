import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
  status: text("status").notNull().default("started"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

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

export type Topic = typeof topics.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type User = typeof users.$inferSelect;
export type ActivityRun = typeof activityRuns.$inferSelect;
