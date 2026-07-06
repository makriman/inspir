ALTER TABLE `ai_runs` ADD `cached_prompt_tokens` integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_response_cache` (
  `cache_key` text PRIMARY KEY NOT NULL,
  `scope` text NOT NULL,
  `surface` text NOT NULL,
  `topic_id` text,
  `topic_slug` text NOT NULL,
  `language` text NOT NULL,
  `model` text NOT NULL,
  `model_params` text NOT NULL,
  `prompt_hash` text NOT NULL,
  `question_hash` text NOT NULL,
  `response_text` text NOT NULL,
  `prompt_tokens` integer,
  `completion_tokens` integer,
  `total_tokens` integer,
  `cached_prompt_tokens` integer,
  `hit_count` integer DEFAULT 0 NOT NULL,
  `last_hit_at` integer,
  `expires_at` integer NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `metadata` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_response_cache_status_expires_idx` ON `ai_response_cache` (`status`, `expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_response_cache_scope_topic_idx` ON `ai_response_cache` (`scope`, `topic_slug`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_response_cache_prompt_idx` ON `ai_response_cache` (`prompt_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_response_cache_question_idx` ON `ai_response_cache` (`question_hash`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_response_cache_last_hit_idx` ON `ai_response_cache` (`last_hit_at`);
