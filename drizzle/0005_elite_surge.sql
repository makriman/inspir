CREATE TABLE "chat_memory_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"topic_id" uuid,
	"user_message_id" uuid NOT NULL,
	"assistant_message_id" uuid NOT NULL,
	"question" text NOT NULL,
	"answer_excerpt" text NOT NULL,
	"searchable_text" text NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" vector(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_memory_turns" ADD CONSTRAINT "chat_memory_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_memory_turns" ADD CONSTRAINT "chat_memory_turns_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_memory_turns" ADD CONSTRAINT "chat_memory_turns_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_memory_turns" ADD CONSTRAINT "chat_memory_turns_user_message_id_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_memory_turns" ADD CONSTRAINT "chat_memory_turns_assistant_message_id_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_memory_turns_user_idx" ON "chat_memory_turns" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_memory_turns_chat_idx" ON "chat_memory_turns" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_memory_turns_topic_idx" ON "chat_memory_turns" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_memory_turns_user_message_idx" ON "chat_memory_turns" USING btree ("user_message_id");--> statement-breakpoint
CREATE INDEX "chat_memory_turns_embedding_idx" ON "chat_memory_turns" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
