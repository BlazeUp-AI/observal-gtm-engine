CREATE TABLE `warmup_sends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inbox_email` text NOT NULL,
	`to_email` text NOT NULL,
	`thread_id` text,
	`subject` text,
	`is_reply` integer DEFAULT false NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL
);
