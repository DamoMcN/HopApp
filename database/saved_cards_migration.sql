-- Run once in phpMyAdmin (database: hop_app_db) so people can save their own card.
-- The same columns are already included in hop_app_db.sql for fresh installs.
-- Only brand, last 4 digits and expiry are stored. The full number and CVC never are.

ALTER TABLE `saved_cards`
  ADD COLUMN `exp_month` tinyint DEFAULT NULL AFTER `last4`,
  ADD COLUMN `exp_year` smallint DEFAULT NULL AFTER `exp_month`;
