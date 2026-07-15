CREATE TABLE `transcript` (
	`id` text PRIMARY KEY NOT NULL,
	`video_asset_id` text NOT NULL,
	`model` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_asset_id`) REFERENCES `video_asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_asset_uq` ON `transcript` (`video_asset_id`);--> statement-breakpoint
CREATE TABLE `transcript_correction_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`from_text` text NOT NULL,
	`to_text` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transcript_edit` (
	`id` text PRIMARY KEY NOT NULL,
	`transcript_id` text NOT NULL,
	`deleted_word_idxs` text DEFAULT '[]' NOT NULL,
	`tighten_ms` integer DEFAULT 0 NOT NULL,
	`defiller` integer DEFAULT false NOT NULL,
	`manual_cuts` text DEFAULT '[]' NOT NULL,
	`keep_spans` text DEFAULT '[]' NOT NULL,
	`kept_duration_s` real,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`transcript_id`) REFERENCES `transcript`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_edit_transcript_uq` ON `transcript_edit` (`transcript_id`);--> statement-breakpoint
CREATE TABLE `transcript_word` (
	`id` text PRIMARY KEY NOT NULL,
	`transcript_id` text NOT NULL,
	`idx` integer NOT NULL,
	`start_s` real NOT NULL,
	`end_s` real NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`transcript_id`) REFERENCES `transcript`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transcript_word_order_idx` ON `transcript_word` (`transcript_id`,`idx`);--> statement-breakpoint
CREATE TABLE `video_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`video_project_id` text NOT NULL,
	`parent_video_asset_id` text,
	`asset_type` text NOT NULL,
	`uri` text NOT NULL,
	`duration_s` real,
	`width` integer,
	`height` integer,
	`fps` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_project_id`) REFERENCES `video_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_video_asset_id`) REFERENCES `video_asset`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `video_asset_project_idx` ON `video_asset` (`video_project_id`);--> statement-breakpoint
CREATE INDEX `video_asset_parent_idx` ON `video_asset` (`parent_video_asset_id`);--> statement-breakpoint
CREATE TABLE `video_processing_job` (
	`id` text PRIMARY KEY NOT NULL,
	`video_project_id` text,
	`job_type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`stage` text,
	`result` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`video_project_id`) REFERENCES `video_project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `video_processing_job_claim_idx` ON `video_processing_job` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `video_project` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_short` (
	`id` text PRIMARY KEY NOT NULL,
	`video_project_id` text NOT NULL,
	`clip_video_asset_id` text NOT NULL,
	`video_short_layout_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_project_id`) REFERENCES `video_project`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`clip_video_asset_id`) REFERENCES `video_asset`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_short_layout_id`) REFERENCES `video_short_layout`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `video_short_project_idx` ON `video_short` (`video_project_id`);--> statement-breakpoint
CREATE TABLE `video_short_layout` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`canvas` text NOT NULL,
	`regions` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_short_region_keyframe` (
	`id` text PRIMARY KEY NOT NULL,
	`video_short_id` text NOT NULL,
	`idx` integer NOT NULL,
	`region_key` text NOT NULL,
	`anchor` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	FOREIGN KEY (`video_short_id`) REFERENCES `video_short`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `video_short_region_keyframe_order_idx` ON `video_short_region_keyframe` (`video_short_id`,`idx`);--> statement-breakpoint
CREATE TABLE `video_short_text_cue` (
	`id` text PRIMARY KEY NOT NULL,
	`video_short_id` text NOT NULL,
	`idx` integer NOT NULL,
	`anchor` text NOT NULL,
	`hold_s` real NOT NULL,
	`at` text NOT NULL,
	`hook` integer DEFAULT false NOT NULL,
	`lines` text NOT NULL,
	FOREIGN KEY (`video_short_id`) REFERENCES `video_short`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `video_short_text_cue_order_idx` ON `video_short_text_cue` (`video_short_id`,`idx`);