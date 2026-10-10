-- A departure or deactivation clears the employee as deputy on running and
-- upcoming absences (#1014, spec #802). The absent employee and their managers
-- are told "Y is no longer available as deputy". An added enum value is not
-- usable in the transaction that adds it, so nothing else uses it here.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'absence_deputy_unavailable';--> statement-breakpoint
-- A departure queues one durable notification task per cleared absence.
ALTER TABLE "employee_departure_task" DROP CONSTRAINT IF EXISTS "employeeDepartureTask_kind_check";--> statement-breakpoint
ALTER TABLE "employee_departure_task" ADD CONSTRAINT "employeeDepartureTask_kind_check" CHECK (kind IN ('dispatch_departure', 'session_revocation', 'billing_sync', 'clock_postprocess', 'notify_review', 'clock_repair', 'approval_handover', 'notify_deputy_release'));
