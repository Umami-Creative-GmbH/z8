-- Employee notifications for money recorded on their travel expenses (#752).
-- An added enum value is not usable in the transaction that adds it, so
-- nothing else uses it here.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'travel_expense_reimbursed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'travel_expense_partially_reimbursed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'travel_expense_recovery_recorded';
