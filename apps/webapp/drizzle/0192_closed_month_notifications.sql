-- Closed months (#762): in-app notifications of the automatic close, of an
-- automatic close a blocker stopped, and of a reopening (to the managers).
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'month_closed_automatically';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'month_close_blocked';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'month_reopened';