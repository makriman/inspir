UPDATE `users`
SET
  `email_verified` = 1,
  `email_verified_at` = COALESCE(`email_verified_at`, CAST(strftime('%s','now') AS integer) * 1000)
WHERE `email_verified` = 0
  AND EXISTS (
    SELECT 1
    FROM `accounts`
    WHERE `accounts`.`user_id` = `users`.`id`
      AND `accounts`.`provider` = 'google'
  );
