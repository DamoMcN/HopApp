-- Run once in phpMyAdmin (database: hop_app_db) to add card expiry dates.
-- The same column is already included in hop_app_db.sql for fresh installs.
--
-- Rule: a card is valid for exactly one year from the day it was created.
-- New sign-ups get their date automatically (see backend/auth/signup.php).

-- 1. Add the column. NULL means "expiry not known" and the app says so.
ALTER TABLE `users`
  ADD COLUMN `card_expiry` date DEFAULT NULL
  COMMENT 'Last day the card is valid: one year after created_at. NULL = not known.'
  AFTER `card_status`;

-- 2. Give every existing card its date: one year after it was created.
UPDATE `users`
  SET `card_expiry` = DATE_ADD(DATE(`created_at`), INTERVAL 1 YEAR)
  WHERE `card_expiry` IS NULL AND `created_at` IS NOT NULL;
