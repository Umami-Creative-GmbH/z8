-- Sick notes on absences (#982, Personnel File ADR 0002): a sick note is an
-- employee document linked to the sick-leave absence it covers. Employees
-- attach them only when the organization allows it (off by default).
CREATE TABLE IF NOT EXISTS "absence_setting" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"employee_sick_note_upload" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "absence_setting" ADD CONSTRAINT "absence_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "absence_setting" ADD CONSTRAINT "absence_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The target of org-scoped references to an absence.
ALTER TABLE "absence_entry" ADD CONSTRAINT "absenceEntry_id_organizationId_idx" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "employee_document" ADD COLUMN "absence_entry_id" uuid;--> statement-breakpoint
-- Cancelling an absence deletes its sick notes explicitly, with an audit
-- record; the cascade backs up every other way an absence disappears, and the
-- document's deletion trigger hands its object to cleanup either way.
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_absence_entry_fk" FOREIGN KEY ("absence_entry_id","organization_id") REFERENCES "public"."absence_entry"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_absence_entry_check" CHECK ("employee_document"."absence_entry_id" IS NULL OR "employee_document"."category" = 'sick_note');--> statement-breakpoint
CREATE INDEX "employeeDocument_org_absenceEntry_idx" ON "employee_document" USING btree ("organization_id","absence_entry_id") WHERE absence_entry_id IS NOT NULL;
