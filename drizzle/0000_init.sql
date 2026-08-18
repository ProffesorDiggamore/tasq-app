CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer,
	`verb` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` integer,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_created_idx` ON `activity_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_actor_idx` ON `activity_log` (`actor_id`);--> statement-breakpoint
CREATE TABLE `login_throttle` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`lockout_level` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE TABLE `recurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`created_by` integer NOT NULL,
	`default_assignee` integer,
	`is_asap` integer DEFAULT false NOT NULL,
	`pattern` text NOT NULL,
	`weekdays` text,
	`day_of_month` integer,
	`spawn_time` text DEFAULT '06:00' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_spawned_on` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_assignee`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recurrences_active_idx` ON `recurrences` (`active`);--> statement-breakpoint
CREATE TABLE `supply_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item` text NOT NULL,
	`notes` text,
	`requested_by` integer NOT NULL,
	`quantity` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`created_at` integer NOT NULL,
	`ordered_at` integer,
	`received_at` integer,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `supply_status_idx` ON `supply_requests` (`status`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`created_by` integer NOT NULL,
	`assigned_to` integer,
	`is_asap` integer DEFAULT false NOT NULL,
	`due_at` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`claimed_at` integer,
	`accepted_at` integer,
	`completed_at` integer,
	`completed_by` integer,
	`decline_reason` text,
	`recurrence_id` integer,
	`overdue_notified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`completed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recurrence_id`) REFERENCES `recurrences`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_assigned_idx` ON `tasks` (`assigned_to`);--> statement-breakpoint
CREATE INDEX `tasks_asap_idx` ON `tasks` (`is_asap`);--> statement-breakpoint
CREATE INDEX `tasks_recurrence_idx` ON `tasks` (`recurrence_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`pin_hash` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_name_unique` ON `users` (`name`);