CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `setup_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `setup_codes_unused_idx` ON `setup_codes` (`used_at`);