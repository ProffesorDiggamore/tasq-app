CREATE TABLE `task_photos` (
	`task_id` integer PRIMARY KEY NOT NULL,
	`mime` text DEFAULT 'image/jpeg' NOT NULL,
	`bytes` blob NOT NULL,
	`thumb_bytes` blob NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
