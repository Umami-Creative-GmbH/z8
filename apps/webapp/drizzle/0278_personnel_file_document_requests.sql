-- Document requests (#1307, #1401; Personnel File ADR 0003): an officer asks one employee for
-- certificates or other documents by a deadline (a plain calendar day). The request carries a
-- version bumped by every event, so the first of two concurrent decisions wins. Its history,
-- its submissions and the documents uploaded from it are kept beside it. Free text (the note,
-- event reasons and submission notes) counts as document descriptions (#1408).
CREATE TABLE IF NOT EXISTS "employee_document_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"deadline" date NOT NULL,
	"renewed_document_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employeeDocumentRequest_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "employee_document_request_category_check" CHECK ("employee_document_request"."category" IN ('certificate', 'other')),
	CONSTRAINT "employee_document_request_status_check" CHECK ("employee_document_request"."status" IN ('open', 'submitted', 'accepted', 'cancelled')),
	CONSTRAINT "employee_document_request_title_check" CHECK (char_length(btrim("employee_document_request"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "employee_document_request_note_check" CHECK ("employee_document_request"."note" IS NULL OR char_length("employee_document_request"."note") <= 2000),
	CONSTRAINT "employee_document_request_version_check" CHECK ("employee_document_request"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_document_request_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"note" text,
	"submitted_by" text,
	"submitted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "employeeDocumentRequestSubmission_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "employee_document_request_submission_note_check" CHECK ("employee_document_request_submission"."note" IS NULL OR char_length("employee_document_request_submission"."note") <= 2000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_document_request_document" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"submission_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_document_request_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"reason_code" text,
	"submission_id" uuid,
	"changes" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "employee_document_request_event_kind_check" CHECK ("employee_document_request_event"."kind" IN ('created', 'edited', 'submitted', 'returned', 'accepted', 'cancelled')),
	CONSTRAINT "employee_document_request_event_reason_code_check" CHECK ("employee_document_request_event"."reason_code" IS NULL OR "employee_document_request_event"."reason_code" IN ('employment_ended')),
	CONSTRAINT "employee_document_request_event_reason_check" CHECK ("employee_document_request_event"."reason" IS NULL OR char_length("employee_document_request_event"."reason") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "employee_document_request" ADD CONSTRAINT "employee_document_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request" ADD CONSTRAINT "employee_document_request_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Deleting the renewed document clears only the link; the request stays.
ALTER TABLE "employee_document_request" ADD CONSTRAINT "employee_document_request_renewed_document_fk" FOREIGN KEY ("renewed_document_id","organization_id") REFERENCES "public"."employee_document"("id","organization_id") ON DELETE SET NULL ("renewed_document_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request" ADD CONSTRAINT "employee_document_request_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_submission" ADD CONSTRAINT "employee_document_request_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_submission" ADD CONSTRAINT "employee_document_request_submission_request_fk" FOREIGN KEY ("request_id","organization_id") REFERENCES "public"."employee_document_request"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_submission" ADD CONSTRAINT "employee_document_request_submission_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_document" ADD CONSTRAINT "employee_document_request_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_document" ADD CONSTRAINT "employee_document_request_document_document_fk" FOREIGN KEY ("document_id","organization_id") REFERENCES "public"."employee_document"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_document" ADD CONSTRAINT "employee_document_request_document_request_fk" FOREIGN KEY ("request_id","organization_id") REFERENCES "public"."employee_document_request"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_document" ADD CONSTRAINT "employee_document_request_document_submission_fk" FOREIGN KEY ("submission_id","organization_id") REFERENCES "public"."employee_document_request_submission"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_event" ADD CONSTRAINT "employee_document_request_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_event" ADD CONSTRAINT "employee_document_request_event_request_fk" FOREIGN KEY ("request_id","organization_id") REFERENCES "public"."employee_document_request"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_event" ADD CONSTRAINT "employee_document_request_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document_request_event" ADD CONSTRAINT "employee_document_request_event_submission_fk" FOREIGN KEY ("submission_id","organization_id") REFERENCES "public"."employee_document_request_submission"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDocumentRequest_org_employee_status_idx" ON "employee_document_request" USING btree ("organization_id","employee_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDocumentRequest_org_status_deadline_idx" ON "employee_document_request" USING btree ("organization_id","status","deadline");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDocumentRequest_renewedDocument_idx" ON "employee_document_request" USING btree ("renewed_document_id") WHERE renewed_document_id IS NOT NULL;--> statement-breakpoint
-- At most one open or submitted request per renewed document.
CREATE UNIQUE INDEX IF NOT EXISTS "employeeDocumentRequest_active_renewedDocument_idx" ON "employee_document_request" USING btree ("organization_id","renewed_document_id") WHERE renewed_document_id IS NOT NULL AND status IN ('open', 'submitted');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDocumentRequestSubmission_request_idx" ON "employee_document_request_submission" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDocumentRequestDocument_request_idx" ON "employee_document_request_document" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDocumentRequestDocument_submission_idx" ON "employee_document_request_document" USING btree ("submission_id") WHERE submission_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDocumentRequestEvent_request_occurredAt_idx" ON "employee_document_request_event" USING btree ("request_id","occurred_at");--> statement-breakpoint
-- Notification types of document requests. An added enum value is not usable in the transaction
-- that adds it, so nothing here uses them.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personnel_file_document_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personnel_file_document_request_decided';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personnel_file_document_request_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personnel_file_document_request_submitted';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personnel_file_document_request_overdue';
