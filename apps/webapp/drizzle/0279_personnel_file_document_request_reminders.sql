-- Document request deadline reminders (#1307, #1406): the sent markers of the reminders 3 days
-- before the deadline, on the deadline day and on the first overdue day. One row per request,
-- kind and deadline, claimed before anyone is notified, so each reminder goes out at most once;
-- a moved deadline has no markers yet, so its reminders are armed again.
CREATE TABLE IF NOT EXISTS "employee_document_request_reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"deadline" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_document_request_reminder_kind_check" CHECK ("employee_document_request_reminder"."kind" IN ('three_days_before', 'deadline_day', 'overdue'))
);
--> statement-breakpoint
ALTER TABLE "employee_document_request_reminder" ADD CONSTRAINT "employee_document_request_reminder_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_reminder" ADD CONSTRAINT "employee_document_request_reminder_request_fk" FOREIGN KEY ("request_id","organization_id") REFERENCES "public"."employee_document_request"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeDocumentRequestReminder_request_kind_deadline_idx" ON "employee_document_request_reminder" USING btree ("request_id","kind","deadline");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDocumentRequestReminder_organizationId_idx" ON "employee_document_request_reminder" USING btree ("organization_id");
