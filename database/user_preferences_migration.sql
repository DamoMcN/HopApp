-- Run once in phpMyAdmin after selecting the hop_app_db database.
-- This stores each account's automatic top-up preferences and selected saved card.
CREATE TABLE IF NOT EXISTS `user_preferences` (
  `user_id` int NOT NULL,
  `auto_top_up_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `auto_top_up_amount_eur` int NOT NULL DEFAULT 10,
  `auto_top_up_card_id` int DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  KEY `auto_top_up_card_id` (`auto_top_up_card_id`),
  CONSTRAINT `user_preferences_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `user_preferences_card_fk` FOREIGN KEY (`auto_top_up_card_id`) REFERENCES `saved_cards` (`card_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;