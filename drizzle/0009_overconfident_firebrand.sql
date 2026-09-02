ALTER TABLE `tasks` ADD `reward_paid_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `reward_paid_by` integer REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `tasks_reward_unpaid_idx` ON `tasks` (`reward_paid_at`);