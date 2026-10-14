-- Recording a departure with a future cutoff reminds the departing employee to
-- download their personal data on My data before the cutoff (#1173, spec #811).
-- An added enum value is not usable in the transaction that adds it, so
-- nothing else uses it here.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personal_data_export_reminder';--> statement-breakpoint
-- The reminder is a durable departure task, queued once per cutoff.
ALTER TABLE "employee_departure_task" DROP CONSTRAINT IF EXISTS "employeeDepartureTask_kind_check";--> statement-breakpoint
ALTER TABLE "employee_departure_task" ADD CONSTRAINT "employeeDepartureTask_kind_check" CHECK (kind IN ('dispatch_departure', 'session_revocation', 'billing_sync', 'clock_postprocess', 'notify_review', 'clock_repair', 'approval_handover', 'notify_deputy_release', 'notify_data_export_reminder'));
