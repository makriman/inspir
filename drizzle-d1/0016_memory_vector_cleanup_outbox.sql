ALTER TABLE `user_memory_settings`
  ADD COLUMN `summary_suppression_mask` integer DEFAULT 0 NOT NULL
    CONSTRAINT `user_memory_settings_summary_suppression_mask_check`
    CHECK (`summary_suppression_mask` BETWEEN 0 AND 511);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `memory_vector_cleanup_outbox` (
  `vector_id` text PRIMARY KEY NOT NULL
    CHECK (
      length(`vector_id`) BETWEEN 1 AND 64
      AND `vector_id` NOT GLOB '*[^A-Za-z0-9:._-]*'
    ),
  `owner_user_id` text
    CHECK (`owner_user_id` IS NULL OR length(`owner_user_id`) BETWEEN 1 AND 120),
  `source_namespace` text
    CHECK (`source_namespace` IS NULL OR `source_namespace` IN ('user_memories', 'chat_memory_turns')),
  `source_row_id` text
    CHECK (`source_row_id` IS NULL OR length(`source_row_id`) BETWEEN 1 AND 120),
  `source_row_revision` integer
    CHECK (`source_row_revision` IS NULL OR `source_row_revision` BETWEEN 1 AND 9007199254740991),
  `write_token` text
    CHECK (`write_token` IS NULL OR length(`write_token`) BETWEEN 1 AND 120),
  `reason` text NOT NULL
    CHECK (length(`reason`) BETWEEN 1 AND 80),
  `state` text DEFAULT 'cleanup_ready' NOT NULL
    CHECK (`state` IN ('write_pending', 'cleanup_fenced', 'cleanup_ready', 'verifying_absence')),
  `write_fence_expires_at` integer
    CHECK (`write_fence_expires_at` IS NULL OR `write_fence_expires_at` >= 0),
  `absence_count` integer DEFAULT 0 NOT NULL
    CHECK (`absence_count` >= 0 AND `absence_count` <= 2),
  `attempt_count` integer DEFAULT 0 NOT NULL
    CHECK (`attempt_count` >= 0),
  `lease_token` text
    CHECK (`lease_token` IS NULL OR length(`lease_token`) BETWEEN 1 AND 120),
  `lease_until` integer DEFAULT 0 NOT NULL CHECK (`lease_until` >= 0),
  `next_attempt_at` integer NOT NULL CHECK (`next_attempt_at` >= 0),
  `last_attempt_at` integer
    CHECK (`last_attempt_at` IS NULL OR `last_attempt_at` >= 0),
  `last_error` text
    CHECK (`last_error` IS NULL OR length(`last_error`) <= 160),
  `created_at` integer NOT NULL CHECK (`created_at` >= 0),
  `updated_at` integer NOT NULL CHECK (`updated_at` >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_vector_cleanup_outbox_due_idx`
  ON `memory_vector_cleanup_outbox` (`next_attempt_at`, `created_at`, `vector_id`);--> statement-breakpoint
WITH `feedback_bits` AS (
  SELECT DISTINCT `user_id`, CASE `summary_section_id`
    WHEN 'identity' THEN 1
    WHEN 'native-memory-identity' THEN 1
    WHEN 'preferences' THEN 2
    WHEN 'native-memory-preferences' THEN 2
    WHEN 'learning_style' THEN 4
    WHEN 'native-memory-learning_style' THEN 4
    WHEN 'projects' THEN 8
    WHEN 'native-memory-projects' THEN 8
    WHEN 'goals' THEN 16
    WHEN 'native-memory-goals' THEN 16
    WHEN 'knowledge' THEN 32
    WHEN 'native-memory-knowledge' THEN 32
    WHEN 'constraints' THEN 64
    WHEN 'native-memory-constraints' THEN 64
    WHEN 'interaction' THEN 128
    WHEN 'native-memory-interaction' THEN 128
    WHEN 'native-recent-learning' THEN 128
    WHEN 'general' THEN 256
    WHEN 'native-memory-general' THEN 256
  END AS `bit`
  FROM `memory_source_feedback`
  WHERE `action` IN ('dont_mention', 'not_relevant')
    AND `summary_section_id` IN (
      'identity', 'native-memory-identity',
      'preferences', 'native-memory-preferences',
      'learning_style', 'native-memory-learning_style',
      'projects', 'native-memory-projects',
      'goals', 'native-memory-goals',
      'knowledge', 'native-memory-knowledge',
      'constraints', 'native-memory-constraints',
      'interaction', 'native-memory-interaction', 'native-recent-learning',
      'general', 'native-memory-general'
    )
), `combined_masks` AS (
  SELECT `user_id`, sum(DISTINCT `bit`) AS `mask`
  FROM `feedback_bits`
  GROUP BY `user_id`
)
INSERT INTO `user_memory_settings` (
  `user_id`, `enabled`, `saved_memory_enabled`, `chat_history_enabled`,
  `dreaming_enabled`, `capture_scope`, `retrieval_mode`,
  `summary_suppression_mask`, `notice_seen_at`, `created_at`, `updated_at`
)
SELECT
  `combined_masks`.`user_id`, 1, 1, 1,
  1, 'broad', 'need_based',
  `combined_masks`.`mask`, NULL, `users`.`created_at`, `users`.`updated_at`
FROM `combined_masks`
INNER JOIN `users` ON `users`.`id` = `combined_masks`.`user_id`
WHERE `combined_masks`.`mask` > 0
ON CONFLICT(`user_id`) DO UPDATE SET
  `summary_suppression_mask` =
    `user_memory_settings`.`summary_suppression_mask` | excluded.`summary_suppression_mask`
WHERE (`user_memory_settings`.`summary_suppression_mask` & excluded.`summary_suppression_mask`)
  <> excluded.`summary_suppression_mask`;--> statement-breakpoint
INSERT INTO `app_metadata` (`key`, `value`, `updated_at`)
VALUES (
  'runtime-migration-0016-complete',
  'summary-suppression-mask-backfill-v1',
  unixepoch('now') * 1000
)
ON CONFLICT (`key`) DO UPDATE SET
  `value` = excluded.`value`,
  `updated_at` = excluded.`updated_at`;
