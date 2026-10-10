-- Cover summaries (#1018, spec #802): the deputy hears what is waiting when
-- the cover starts, the approver what the deputy decided on return. Added enum
-- values are not used in this migration.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'approval_cover_started';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'approval_cover_return_summary';--> statement-breakpoint
-- Sent markers: one per absence, deputy and kind, claimed before notifying so
-- each summary is sent at most once, even with in-app notifications off.
CREATE TABLE IF NOT EXISTS "approval_deputy_cover_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"absence_id" uuid NOT NULL,
	"deputy_employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"local_date" date NOT NULL,
	"item_count" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_deputy_cover_summary_kind_check" CHECK ("approval_deputy_cover_summary"."kind" IN ('cover_start', 'return'))
);--> statement-breakpoint
ALTER TABLE "approval_deputy_cover_summary" ADD CONSTRAINT "approval_deputy_cover_summary_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_deputy_cover_summary" ADD CONSTRAINT "approval_deputy_cover_summary_absence_fk" FOREIGN KEY ("absence_id","organization_id") REFERENCES "public"."absence_entry"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_deputy_cover_summary" ADD CONSTRAINT "approval_deputy_cover_summary_deputy_fk" FOREIGN KEY ("deputy_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approvalDeputyCoverSummary_absence_deputy_kind_idx" ON "approval_deputy_cover_summary" USING btree ("organization_id","absence_id","deputy_employee_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalDeputyCoverSummary_organizationId_idx" ON "approval_deputy_cover_summary" USING btree ("organization_id");
