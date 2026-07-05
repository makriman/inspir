INSERT INTO `llm_usage_daily_shards` (`day`, `shard`, `call_count`, `created_at`, `updated_at`)
SELECT `day`, 0, `call_count`, `created_at`, `updated_at`
FROM `llm_usage_daily`
WHERE `call_count` > 0
ON CONFLICT(`day`, `shard`) DO UPDATE SET
  `call_count` = `llm_usage_daily_shards`.`call_count` + excluded.`call_count`,
  `created_at` = min(`llm_usage_daily_shards`.`created_at`, excluded.`created_at`),
  `updated_at` = max(`llm_usage_daily_shards`.`updated_at`, excluded.`updated_at`);
--> statement-breakpoint
DROP TABLE `llm_usage_daily`;
