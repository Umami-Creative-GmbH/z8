-- Personnel file (#865, Personnel File context, ADR 0001): employee documents
-- kept per employee, behind a per-organization feature toggle that is off by
-- default. Turning it off hides documents but keeps them stored.
ALTER TABLE "organization" ADD COLUMN "personnel_files_enabled" boolean DEFAULT false;--> statement-breakpoint
-- One stored private object per document. A payslip has exactly a pay period;
-- only certificates and other documents may expire.
CREATE TABLE "employee_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"document_date" date NOT NULL,
	"pay_period_year" integer,
	"pay_period_month" integer,
	"visibility" text NOT NULL,
	"expiry_date" date,
	"storage_provider" text NOT NULL,
	"storage_bucket" text,
	"storage_key" text NOT NULL,
	"storage_version_id" text,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"uploaded_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employeeDocument_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "employee_document_category_check" CHECK ("employee_document"."category" IN ('contract', 'payslip', 'certificate', 'sick_note', 'other')),
	CONSTRAINT "employee_document_visibility_check" CHECK ("employee_document"."visibility" IN ('shared', 'hr_only')),
	CONSTRAINT "employee_document_title_check" CHECK (char_length(btrim("employee_document"."title")) BETWEEN 1 AND 200),
	CONSTRAINT "employee_document_pay_period_check" CHECK (("employee_document"."category" = 'payslip'
				AND "employee_document"."pay_period_year" IS NOT NULL AND "employee_document"."pay_period_month" IS NOT NULL
				AND "employee_document"."pay_period_year" BETWEEN 1900 AND 2999
				AND "employee_document"."pay_period_month" BETWEEN 1 AND 12)
			OR ("employee_document"."category" <> 'payslip'
				AND "employee_document"."pay_period_year" IS NULL AND "employee_document"."pay_period_month" IS NULL)),
	CONSTRAINT "employee_document_expiry_check" CHECK ("employee_document"."expiry_date" IS NULL OR "employee_document"."category" IN ('certificate', 'other')),
	CONSTRAINT "employee_document_size_check" CHECK ("employee_document"."size_bytes" > 0)
);
--> statement-breakpoint
-- Staging and cleanup ledger, kept by value (no foreign keys) so it outlives
-- the employee and the organization.
CREATE TABLE "personnel_file_upload" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"uploaded_by" text,
	"storage_key" text NOT NULL,
	"storage_bucket" text,
	"storage_version_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personnel_file_upload_status_check" CHECK ("personnel_file_upload"."status" IN ('pending', 'cleanup_required')),
	CONSTRAINT "personnel_file_upload_reason_check" CHECK (("personnel_file_upload"."status" = 'pending' AND "personnel_file_upload"."reason" IS NULL)
			OR ("personnel_file_upload"."status" = 'cleanup_required'
				AND "personnel_file_upload"."reason" IN ('finalization_failed', 'abandoned', 'removed')))
);
--> statement-breakpoint
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employeeDocument_org_employee_category_idx" ON "employee_document" USING btree ("organization_id","employee_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "employeeDocument_org_storageKey_idx" ON "employee_document" USING btree ("organization_id","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "personnelFileUpload_org_storageKey_idx" ON "personnel_file_upload" USING btree ("organization_id","storage_key");--> statement-breakpoint
CREATE INDEX "personnelFileUpload_status_nextAttemptAt_idx" ON "personnel_file_upload" USING btree ("status","next_attempt_at");--> statement-breakpoint
-- Every deleted document (deletion, or a cascade from its employee or
-- organization) hands its stored object to the cleanup worker. This is how an
-- organization hard-delete purges all personnel file objects.
CREATE OR REPLACE FUNCTION "employee_document_enqueue_cleanup"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "personnel_file_upload" (
		"id", "organization_id", "employee_id", "uploaded_by", "storage_key",
		"storage_bucket", "storage_version_id", "status", "reason", "next_attempt_at",
		"created_at", "updated_at"
	) VALUES (
		OLD."id", OLD."organization_id", OLD."employee_id", OLD."uploaded_by",
		OLD."storage_key", OLD."storage_bucket", OLD."storage_version_id", 'cleanup_required',
		'removed', now(), now(), now()
	)
	ON CONFLICT DO NOTHING;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "employee_document_cleanup" AFTER DELETE ON "employee_document" FOR EACH ROW EXECUTE FUNCTION "employee_document_enqueue_cleanup"();
