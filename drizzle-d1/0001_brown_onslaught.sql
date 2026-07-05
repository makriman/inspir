CREATE TABLE IF NOT EXISTS `llm_usage_daily_shards` (
	`day` text NOT NULL,
	`shard` integer NOT NULL,
	`call_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`day`, `shard`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `llm_usage_daily_shards_day_idx` ON `llm_usage_daily_shards` (`day`);
