-- Run once in phpMyAdmin (database: hop_app_db) to allow "Report stolen".
-- The same change is already included in hop_app_db.sql for fresh installs.
-- Running it twice is harmless.

ALTER TABLE `users`
  MODIFY `card_status` enum('active','frozen','reported_lost','reported_stolen')
  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active';
