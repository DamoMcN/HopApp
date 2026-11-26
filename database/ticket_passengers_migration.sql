-- How many people a ticket is for. Run once on an existing database, after ticket_travel_time_migration.sql.

ALTER TABLE `tickets`
  ADD COLUMN `passengers` tinyint unsigned NOT NULL DEFAULT 1 COMMENT 'How many people the ticket is for.' AFTER `travel_at`;
