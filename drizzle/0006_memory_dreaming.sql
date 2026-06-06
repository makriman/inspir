ALTER TABLE "user_memory_settings"
  ADD COLUMN IF NOT EXISTS "saved_memory_enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "chat_history_enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "dreaming_enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "user_memories"
  ADD COLUMN IF NOT EXISTS "source_type" text DEFAULT 'auto' NOT NULL,
  ADD COLUMN IF NOT EXISTS "source_turn_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "source_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "valid_from" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "valid_until" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "freshness_status" text DEFAULT 'current' NOT NULL,
  ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "do_not_mention" boolean DEFAULT false NOT NULL;

UPDATE "user_memories"
SET "source_type" = CASE
  WHEN "tags" ? 'manual' THEN 'manual'
  WHEN "tags" ? 'prior_chat' THEN 'prior_chat'
  WHEN "kind" = 'explicit' THEN 'explicit'
  ELSE 'auto'
END
WHERE "source_type" = 'auto';

CREATE TABLE IF NOT EXISTS "user_memory_summaries" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "summary" text DEFAULT '' NOT NULL,
  "sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_turn_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "last_synthesized_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "memory_synthesis_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "reason" text NOT NULL,
  "status" text DEFAULT 'started' NOT NULL,
  "input_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "memory_source_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "ai_run_id" uuid REFERENCES "ai_runs"("id") ON DELETE set null,
  "memory_id" uuid REFERENCES "user_memories"("id") ON DELETE set null,
  "chat_turn_id" uuid REFERENCES "chat_memory_turns"("id") ON DELETE set null,
  "summary_section_id" text,
  "action" text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "user_memories_source_type_idx" ON "user_memories" ("source_type");
CREATE INDEX IF NOT EXISTS "user_memories_freshness_idx" ON "user_memories" ("freshness_status");
CREATE INDEX IF NOT EXISTS "user_memories_do_not_mention_idx" ON "user_memories" ("do_not_mention");
CREATE INDEX IF NOT EXISTS "memory_synthesis_runs_user_status_idx" ON "memory_synthesis_runs" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "memory_synthesis_runs_started_idx" ON "memory_synthesis_runs" ("started_at");
CREATE INDEX IF NOT EXISTS "memory_source_feedback_user_idx" ON "memory_source_feedback" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "memory_source_feedback_memory_idx" ON "memory_source_feedback" ("memory_id");
CREATE INDEX IF NOT EXISTS "memory_source_feedback_turn_idx" ON "memory_source_feedback" ("chat_turn_id");
