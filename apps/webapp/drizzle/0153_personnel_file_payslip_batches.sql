-- Payslip batches (#868, Personnel File context): many payslips for one pay
-- period, staged and matched to employees by personnel number, saved as
-- employee documents only after the officer confirms. A staged file's object
-- is held by a pending personnel_file_upload row (no employee yet, tagged with
-- its batch) until confirmation, so abandoned files are cleaned up.
ALTER TABLE "personnel_file_upload" ALTER COLUMN "employee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "personnel_file_upload" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE INDEX "personnelFileUpload_batchId_idx" ON "personnel_file_upload" USING btree ("batch_id");--> statement-breakpoint
CREATE TABLE "payslip_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"pay_period_year" integer NOT NULL,
	"pay_period_month" integer NOT NULL,
	"visibility" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "payslipBatch_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "payslip_batch_status_check" CHECK ("payslip_batch"."status" IN ('open', 'confirmed')),
	CONSTRAINT "payslip_batch_visibility_check" CHECK ("payslip_batch"."visibility" IN ('shared', 'hr_only')),
	CONSTRAINT "payslip_batch_pay_period_check" CHECK ("payslip_batch"."pay_period_year" BETWEEN 1900 AND 2999 AND "payslip_batch"."pay_period_month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
-- A staged file's id becomes its employee document's id on confirmation, so
-- confirming twice never creates a second document.
CREATE TABLE "payslip_batch_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"batch_id" uuid NOT NULL,
	"original_file_name" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"storage_bucket" text,
	"storage_version_id" text,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"match_kind" text NOT NULL,
	"matched_employee_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"assigned_employee_id" uuid,
	"included" boolean DEFAULT true NOT NULL,
	"document_id" uuid,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslip_batch_file_match_kind_check" CHECK ("payslip_batch_file"."match_kind" IN ('matched', 'unmatched', 'ambiguous')),
	CONSTRAINT "payslip_batch_file_failure_check" CHECK ("payslip_batch_file"."failure" IS NULL OR "payslip_batch_file"."failure" IN ('expired', 'out_of_scope', 'error')),
	CONSTRAINT "payslip_batch_file_size_check" CHECK ("payslip_batch_file"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "payslip_batch" ADD CONSTRAINT "payslip_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_batch" ADD CONSTRAINT "payslip_batch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_batch_file" ADD CONSTRAINT "payslip_batch_file_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslip_batch_file" ADD CONSTRAINT "payslip_batch_file_batch_fk" FOREIGN KEY ("batch_id","organization_id") REFERENCES "public"."payslip_batch"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payslipBatch_org_createdBy_status_idx" ON "payslip_batch" USING btree ("organization_id","created_by","status");--> statement-breakpoint
CREATE INDEX "payslipBatchFile_batchId_idx" ON "payslip_batch_file" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payslipBatchFile_org_storageKey_idx" ON "payslip_batch_file" USING btree ("organization_id","storage_key");
