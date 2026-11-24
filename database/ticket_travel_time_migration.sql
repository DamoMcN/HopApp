-- Date and time the ticket is for (SCRUM-120). Run once on an existing database.
-- Stored as Irish local time. A ticket is valid for 90 minutes from this time.

ALTER TABLE `tickets`
  ADD COLUMN `travel_at` datetime DEFAULT NULL COMMENT 'Irish local time the ticket is for. Valid for 90 minutes from then.' AFTER `route`,
  ADD KEY `user_travel` (`user_id`, `travel_at`);
