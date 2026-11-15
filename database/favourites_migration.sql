-- Run once in phpMyAdmin (database: hop_app_db) so people can save favourite routes and stops.
-- The same table is already included in hop_app_db.sql for fresh installs.

-- One row per saved route or stop.
--   fav_type  'route' or 'stop'
--   item_id   route_id or stop id from the map data (frontend/map/data/index.json)
--   label     name shown in the Favourites list, e.g. "401 Salthill - Eyre Square"
CREATE TABLE IF NOT EXISTS `favourites` (
  `favourite_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `fav_type` enum('route','stop') COLLATE utf8mb4_unicode_ci NOT NULL,
  `item_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`favourite_id`),
  UNIQUE KEY `unique_user_favourite` (`user_id`,`fav_type`,`item_id`),
  CONSTRAINT `favourites_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
