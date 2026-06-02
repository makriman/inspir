CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "chat_memory_summaries" (
	"chat_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"topic_id" uuid,
	"summary" text NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_message_count" integer DEFAULT 0 NOT NULL,
	"last_message_id" uuid,
	"embedding" vector(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"memory_id" uuid,
	"chat_id" uuid,
	"message_id" uuid,
	"event_type" text NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'auto' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" integer DEFAULT 70 NOT NULL,
	"salience" integer DEFAULT 50 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_chat_id" uuid,
	"source_message_id" uuid,
	"superseded_by_memory_id" uuid,
	"embedding" vector(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_memory_profiles" (
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"summary" text NOT NULL,
	"source_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_compiled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_memory_profiles_user_id_category_pk" PRIMARY KEY("user_id","category")
);
--> statement-breakpoint
CREATE TABLE "user_memory_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"capture_scope" text DEFAULT 'broad' NOT NULL,
	"retrieval_mode" text DEFAULT 'need_based' NOT NULL,
	"notice_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "memory_context" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_memory_summaries" ADD CONSTRAINT "chat_memory_summaries_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_memory_summaries" ADD CONSTRAINT "chat_memory_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_memory_summaries" ADD CONSTRAINT "chat_memory_summaries_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_memory_summaries" ADD CONSTRAINT "chat_memory_summaries_last_message_id_messages_id_fk" FOREIGN KEY ("last_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_memory_id_user_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."user_memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_source_chat_id_chats_id_fk" FOREIGN KEY ("source_chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_profiles" ADD CONSTRAINT "user_memory_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_settings" ADD CONSTRAINT "user_memory_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_memory_summaries_user_idx" ON "chat_memory_summaries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_memory_summaries_topic_idx" ON "chat_memory_summaries" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "memory_events_user_created_idx" ON "memory_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_events_memory_idx" ON "memory_events" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "user_memories_user_status_idx" ON "user_memories" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "user_memories_category_idx" ON "user_memories" USING btree ("category");--> statement-breakpoint
CREATE INDEX "user_memories_source_chat_idx" ON "user_memories" USING btree ("source_chat_id");--> statement-breakpoint
CREATE INDEX "user_memories_embedding_idx" ON "user_memories" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_memory_summaries_embedding_idx" ON "chat_memory_summaries" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
