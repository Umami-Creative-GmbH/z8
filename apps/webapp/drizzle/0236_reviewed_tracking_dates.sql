ALTER TABLE "work_balance_rebuild_intent" DROP CONSTRAINT "work_balance_rebuild_intent_reason_check";
--> statement-breakpoint
ALTER TABLE "work_balance_rebuild_intent" ADD CONSTRAINT "work_balance_rebuild_intent_reason_check" CHECK ("reason" IN ('organization_timezone', 'user_timezone', 'tracking_dates'));
