-- Run once in phpMyAdmin (database: hop_app_db) to enable recurring top ups.
-- The same table is already included in hop_app_db.sql for fresh installs.

-- One recurring top up per user.
--   amount         added every time (EUR)
--   interval_type  weekly = every week, fortnightly = every 2 weeks, monthly = every month
--   card_id        saved card to pay with; NULL = demo wallet
--   start_date     day of the first top up
--   next_run_date  day of the next top up
--   enabled        1 = on, 0 = turned off by the user
CREATE TABLE IF NOT EXISTS `recurring_topups` (
  `recurring_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `interval_type` enum('weekly','fortnightly','monthly') COLLATE utf8mb4_unicode_ci NOT NULL,
  `card_id` int DEFAULT NULL,
  `start_date` date NOT NULL,
  `next_run_date` date NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`recurring_id`),
  UNIQUE KEY `unique_user_recurring` (`user_id`),
  KEY `card_id` (`card_id`),
  CONSTRAINT `recurring_topups_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `recurring_topups_ibfk_2` FOREIGN KEY (`card_id`) REFERENCES `saved_cards` (`card_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
