-- Personnel file retention (#870): a retention period in whole years per
-- document category and organization (no row = never due), the documents the
-- daily job already reported as due for deletion, and one reminder per
-- recipient and organization day. Purges themselves need an officer's
-- confirmation and delete through the existing cleanup trigger.
CREATE TABLE "personnel_file_retention_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"category" text NOT NULL,
	"retention_years" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "personnel_file_retention_period_category_check" CHECK ("personnel_file_retention_period"."category" IN ('contract', 'payslip', 'certificate', 'sick_note', 'other')),
	CONSTRAINT "personnel_file_retention_period_years_check" CHECK ("personnel_file_retention_period"."retention_years" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "personnel_file_due_notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"retention_start" date NOT NULL,
	"noticed_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personnel_file_due_reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"local_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personnel_file_retention_period" ADD CONSTRAINT "personnel_file_retention_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_retention_period" ADD CONSTRAINT "personnel_file_retention_period_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_due_notice" ADD CONSTRAINT "personnel_file_due_notice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_due_notice" ADD CONSTRAINT "personnel_file_due_notice_document_fk" FOREIGN KEY ("document_id","organization_id") REFERENCES "public"."employee_document"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_due_reminder" ADD CONSTRAINT "personnel_file_due_reminder_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personnel_file_due_reminder" ADD CONSTRAINT "personnel_file_due_reminder_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personnelFileRetentionPeriod_org_category_idx" ON "personnel_file_retention_period" USING btree ("organization_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "personnelFileDueNotice_document_start_idx" ON "personnel_file_due_notice" USING btree ("document_id","retention_start");--> statement-breakpoint
CREATE INDEX "personnelFileDueNotice_organizationId_idx" ON "personnel_file_due_notice" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personnelFileDueReminder_org_user_date_idx" ON "personnel_file_due_reminder" USING btree ("organization_id","user_id","local_date");--> statement-breakpoint
-- Officer reminder when documents become due for deletion. An added enum value
-- is not usable in the transaction that adds it, so nothing here uses it.
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personnel_file_due_for_deletion';
