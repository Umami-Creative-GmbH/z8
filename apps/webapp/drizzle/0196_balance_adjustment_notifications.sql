-- Employee notifications when a balance adjustment on their work balance is
-- recorded or cancelled (#996). An added enum value is not usable in the
-- transaction that adds it, so nothing else uses it here.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'work_balance_adjustment_recorded';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'work_balance_adjustment_cancelled';
