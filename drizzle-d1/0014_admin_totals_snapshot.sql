INSERT INTO `app_metadata` (`key`, `value`, `updated_at`)
SELECT
  'native-admin-totals-v1',
  json_object(
    'users', (
      SELECT count(*) FROM `users` AS `counted_users`
      WHERE lower(`counted_users`.`email`) NOT LIKE '%@inspirlearning.invalid'
    ),
    'chats', (
      SELECT count(*) FROM `chats` AS `counted_chats`
      WHERE NOT EXISTS (
        SELECT 1 FROM `users` AS `validation_users`
        WHERE `validation_users`.`id` = `counted_chats`.`user_id`
          AND lower(`validation_users`.`email`) LIKE '%@inspirlearning.invalid'
      )
    ),
    'messages', (
      SELECT count(*) FROM `messages` AS `counted_messages`
      WHERE NOT EXISTS (
        SELECT 1 FROM `chats` AS `validation_chats`
        JOIN `users` AS `validation_users` ON `validation_users`.`id` = `validation_chats`.`user_id`
        WHERE `validation_chats`.`id` = `counted_messages`.`chat_id`
          AND lower(`validation_users`.`email`) LIKE '%@inspirlearning.invalid'
      )
    ),
    'aiRuns', (
      SELECT count(*) FROM `ai_runs` AS `counted_ai_runs`
      WHERE NOT EXISTS (
        SELECT 1 FROM `chats` AS `validation_chats`
        JOIN `users` AS `validation_users` ON `validation_users`.`id` = `validation_chats`.`user_id`
        WHERE `validation_chats`.`id` = `counted_ai_runs`.`chat_id`
          AND lower(`validation_users`.`email`) LIKE '%@inspirlearning.invalid'
      )
    )
  ),
  unixepoch('now') * 1000
ON CONFLICT (`key`) DO UPDATE SET
  `value` = excluded.`value`,
  `updated_at` = excluded.`updated_at`;
