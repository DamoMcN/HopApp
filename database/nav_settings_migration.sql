-- Each person's own bottom bar (navbar_layout, a JSON list of page ids) and start page (default_tab).
-- Only needed if your database was made before the `settings` table was added. Safe to run more than once.

CREATE TABLE IF NOT EXISTS `settings` (
  `user_id` int NOT NULL,
  `theme` enum('light','dark','system') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system',
  `default_tab` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'home',
  `navbar_layout` json DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `settings_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
