CREATE TABLE `accounts` (
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `provider_account_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `activity_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`state` text NOT NULL,
	`score` integer,
	`max_score` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_runs_chat_id_idx` ON `activity_runs` (`chat_id`);--> statement-breakpoint
CREATE INDEX `activity_runs_type_idx` ON `activity_runs` (`type`);--> statement-breakpoint
CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`user_message_id` text,
	`assistant_message_id` text,
	`model` text NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`memory_context` text NOT NULL,
	`status` text DEFAULT 'started' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `app_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_translations` (
	`namespace` text NOT NULL,
	`language` text NOT NULL,
	`source_hash` text NOT NULL,
	`payload` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`namespace`, `language`)
);
--> statement-breakpoint
CREATE INDEX `app_translations_language_idx` ON `app_translations` (`language`);--> statement-breakpoint
CREATE TABLE `app_translation_sources` (
	`namespace` text PRIMARY KEY NOT NULL,
	`source_hash` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_translation_source_strings` (
	`namespace` text NOT NULL,
	`source_key` text NOT NULL,
	`source_text` text NOT NULL,
	PRIMARY KEY(`namespace`, `source_key`),
	FOREIGN KEY (`namespace`) REFERENCES `app_translation_sources`(`namespace`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_memory_summaries` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`topic_id` text,
	`summary` text NOT NULL,
	`topics` text NOT NULL,
	`source_message_count` integer DEFAULT 0 NOT NULL,
	`last_message_id` text,
	`embedding` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`last_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chat_memory_summaries_user_idx` ON `chat_memory_summaries` (`user_id`);--> statement-breakpoint
CREATE INDEX `chat_memory_summaries_topic_idx` ON `chat_memory_summaries` (`topic_id`);--> statement-breakpoint
CREATE TABLE `chat_memory_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`topic_id` text,
	`user_message_id` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`question` text NOT NULL,
	`answer_excerpt` text NOT NULL,
	`searchable_text` text NOT NULL,
	`topics` text NOT NULL,
	`embedding` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_memory_turns_user_idx` ON `chat_memory_turns` (`user_id`);--> statement-breakpoint
CREATE INDEX `chat_memory_turns_chat_idx` ON `chat_memory_turns` (`chat_id`);--> statement-breakpoint
CREATE INDEX `chat_memory_turns_topic_idx` ON `chat_memory_turns` (`topic_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_memory_turns_user_message_idx` ON `chat_memory_turns` (`user_message_id`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`user_email_snapshot` text,
	`topic_id` text,
	`legacy_topic_id` text,
	`topic_name_snapshot` text,
	`title` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `chats_user_id_idx` ON `chats` (`user_id`);--> statement-breakpoint
CREATE INDEX `chats_topic_id_idx` ON `chats` (`topic_id`);--> statement-breakpoint
CREATE TABLE `legacy_chat_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`assistant_raw` text,
	`messages_raw` text,
	`questions_raw` text,
	`topic_raw` text,
	`topic_name` text,
	`legacy_topic_id` text,
	`user_email` text,
	`imported_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legacy_dummy_data` (
	`id` text PRIMARY KEY NOT NULL,
	`dummy` text,
	`legacy_topic_id` text,
	`creator_legacy_id` text,
	`created_at` integer,
	`modified_at` integer
);
--> statement-breakpoint
CREATE TABLE `llm_usage_daily` (
	`day` text PRIMARY KEY NOT NULL,
	`call_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`memory_id` text,
	`chat_id` text,
	`message_id` text,
	`event_type` text NOT NULL,
	`reason` text,
	`metadata` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_id`) REFERENCES `user_memories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memory_events_user_created_idx` ON `memory_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `memory_events_memory_idx` ON `memory_events` (`memory_id`);--> statement-breakpoint
CREATE TABLE `memory_source_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ai_run_id` text,
	`memory_id` text,
	`chat_turn_id` text,
	`summary_section_id` text,
	`action` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`memory_id`) REFERENCES `user_memories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_turn_id`) REFERENCES `chat_memory_turns`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memory_source_feedback_user_idx` ON `memory_source_feedback` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `memory_source_feedback_memory_idx` ON `memory_source_feedback` (`memory_id`);--> statement-breakpoint
CREATE INDEX `memory_source_feedback_turn_idx` ON `memory_source_feedback` (`chat_turn_id`);--> statement-breakpoint
CREATE TABLE `memory_synthesis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'started' NOT NULL,
	`input_counts` text NOT NULL,
	`output_counts` text NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_synthesis_runs_user_status_idx` ON `memory_synthesis_runs` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `memory_synthesis_runs_started_idx` ON `memory_synthesis_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text NOT NULL,
	`legacy_sender_id` text,
	`legacy_user_id` text,
	`legacy_topic_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_chat_created_idx` ON `messages` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limit_windows` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `topic_legacy_ids` (
	`legacy_id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`source` text NOT NULL,
	`confidence` text DEFAULT 'derived' NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`sub_text` text NOT NULL,
	`description` text NOT NULL,
	`inputbox_text` text NOT NULL,
	`system_prompt` text NOT NULL,
	`icon_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`metadata` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_slug_unique` ON `topics` (`slug`);--> statement-breakpoint
CREATE TABLE `user_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'auto' NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`content` text NOT NULL,
	`tags` text NOT NULL,
	`confidence` integer DEFAULT 70 NOT NULL,
	`salience` integer DEFAULT 50 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_type` text DEFAULT 'auto' NOT NULL,
	`source_turn_ids` text NOT NULL,
	`source_memory_ids` text NOT NULL,
	`source_chat_id` text,
	`source_message_id` text,
	`superseded_by_memory_id` text,
	`embedding` text,
	`valid_from` integer,
	`valid_until` integer,
	`freshness_status` text DEFAULT 'current' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`do_not_mention` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_used_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `user_memories_user_status_idx` ON `user_memories` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `user_memories_category_idx` ON `user_memories` (`category`);--> statement-breakpoint
CREATE INDEX `user_memories_source_chat_idx` ON `user_memories` (`source_chat_id`);--> statement-breakpoint
CREATE INDEX `user_memories_source_type_idx` ON `user_memories` (`source_type`);--> statement-breakpoint
CREATE INDEX `user_memories_freshness_idx` ON `user_memories` (`freshness_status`);--> statement-breakpoint
CREATE INDEX `user_memories_do_not_mention_idx` ON `user_memories` (`do_not_mention`);--> statement-breakpoint
CREATE TABLE `user_memory_profiles` (
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`summary` text NOT NULL,
	`source_memory_ids` text NOT NULL,
	`last_compiled_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `category`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_memory_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`saved_memory_enabled` integer DEFAULT true NOT NULL,
	`chat_history_enabled` integer DEFAULT true NOT NULL,
	`dreaming_enabled` integer DEFAULT true NOT NULL,
	`capture_scope` text DEFAULT 'broad' NOT NULL,
	`retrieval_mode` text DEFAULT 'need_based' NOT NULL,
	`notice_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_memory_summaries` (
	`user_id` text PRIMARY KEY NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`sections` text NOT NULL,
	`source_memory_ids` text NOT NULL,
	`source_turn_ids` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_synthesized_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`email_verified` integer,
	`image` text,
	`score` integer DEFAULT 0 NOT NULL,
	`profile_picture_url` text,
	`profile_image_data` text,
	`profile_image_mime` text,
	`profile_image_hash` text,
	`preferred_language` text DEFAULT 'English' NOT NULL,
	`date_of_birth` text,
	`date_of_birth_source` text,
	`profile_picture_downloaded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verification_tokens` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
--> statement-breakpoint
CREATE TABLE `source_timestamp_precision` (
	`source_table` text NOT NULL,
	`source_pk` text NOT NULL,
	`column_name` text NOT NULL,
	`original_timestamp` text NOT NULL,
	`d1_timestamp_ms` integer NOT NULL,
	PRIMARY KEY(`source_table`, `source_pk`, `column_name`)
);
--> statement-breakpoint
CREATE INDEX `source_timestamp_precision_table_idx` ON `source_timestamp_precision` (`source_table`,`column_name`);
