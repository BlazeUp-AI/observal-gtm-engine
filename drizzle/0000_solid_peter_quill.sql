CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`name` text NOT NULL,
	`archetype` text,
	`icp_score` integer,
	`score_rationale` text,
	`headcount` integer,
	`funding` text,
	`sources_json` text,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_domain_unique` ON `accounts` (`domain`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent` text NOT NULL,
	`action` text NOT NULL,
	`payload_json` text,
	`at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_agent_idx` ON `audit_log` (`agent`,`at`);--> statement-breakpoint
CREATE TABLE `community_interactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person` text NOT NULL,
	`community` text NOT NULL,
	`url` text,
	`type` text NOT NULL,
	`notes` text,
	`at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`name` text NOT NULL,
	`title` text,
	`email` text,
	`email_status` text DEFAULT 'none' NOT NULL,
	`email_source` text,
	`github` text,
	`linkedin` text,
	`region` text,
	`signal_url` text,
	`signal_summary` text,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contacts_status_idx` ON `contacts` (`status`);--> statement-breakpoint
CREATE INDEX `contacts_email_idx` ON `contacts` (`email`);--> statement-breakpoint
CREATE TABLE `inboxes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`domain` text NOT NULL,
	`composio_connection_id` text,
	`ramp_started_at` integer,
	`daily_cap` integer DEFAULT 10 NOT NULL,
	`sent_today` integer DEFAULT 0 NOT NULL,
	`bounce_count` integer DEFAULT 0 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`paused_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inboxes_email_unique` ON `inboxes` (`email`);--> statement-breakpoint
CREATE TABLE `intent_feed` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`url` text NOT NULL,
	`author` text,
	`snippet` text,
	`relevance_score` integer,
	`posted_at` integer,
	`handled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intent_feed_url_unique` ON `intent_feed` (`url`);--> statement-breakpoint
CREATE TABLE `metrics_daily` (
	`date` text PRIMARY KEY NOT NULL,
	`signups` integer,
	`activated` integer,
	`activated_cumulative` integer,
	`invites_sent` integer,
	`invites_accepted` integer,
	`k_factor` real,
	`emails_delivered` integer,
	`email_replies` integer,
	`channel_attribution_json` text
);
--> statement-breakpoint
CREATE TABLE `replies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer,
	`thread_id` text,
	`classification` text,
	`snippet` text,
	`suggested_draft` text,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL,
	`handled` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sends` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`step` integer NOT NULL,
	`inbox_id` integer NOT NULL,
	`gmail_message_id` text,
	`subject` text,
	`body` text,
	`approved_by` text,
	`sent_at` integer,
	`bounced_at` integer,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_id` integer NOT NULL,
	`variant` text NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`next_send_at` integer,
	`stopped_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `suppression` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL
);
