-- Run once in phpMyAdmin (database: hop_app_db) to enable top ups.
-- The same changes are already included in hop_app_db.sql for fresh installs.

-- 1. Saved cards: brand + last 4 only. Never store full card numbers.
CREATE TABLE IF NOT EXISTS `saved_cards` (
  `card_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `brand` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last4` char(4) COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider_payment_method_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`card_id`),
  UNIQUE KEY `unique_user_card` (`user_id`,`brand`,`last4`),
  CONSTRAINT `saved_cards_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Stops the same top up being credited twice. NULLs are allowed to repeat,
--    so ticket purchases (which have no payment id) are unaffected.
ALTER TABLE `transactions`
  ADD UNIQUE KEY `unique_payment_ref` (`stripe_payment_id`);
