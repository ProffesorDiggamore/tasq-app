ALTER TABLE `push_subscriptions` ADD `device_hash` text;--> statement-breakpoint
CREATE INDEX `push_device_idx` ON `push_subscriptions` (`user_id`,`device_hash`);