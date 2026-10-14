-- Personal data exports (#811, #1165): a ZIP of everything one organization holds about one
-- employee, built by the worker and kept privately for 7 days. Separate from the org-wide
-- data_export; neither blocks the other. At most one export per employee is pending or
-- processing. Deleting a row (expiry, or a cascade from its employee or organization) hands its
-- stored file to a cleanup ledger kept by value, which the sweep drains.
CREATE TABLE IF NOT EXISTS "personal_data_export" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"requested_by_user_id" text,
	"status" "export_status" DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"storage_key" text,
	"storage_bucket" text,
	"storage_version_id" text,
	"size_bytes" integer,
	"checksum_sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "personal_data_export_kind_check" CHECK (kind IN ('employee', 'admin')),
	CONSTRAINT "personal_data_export_completed_file_check" CHECK (status <> 'completed' OR (storage_key IS NOT NULL AND completed_at IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personal_data_export_file_cleanup" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"storage_bucket" text,
	"storage_version_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "personal_data_export" ADD CONSTRAINT "personal_data_export_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "personal_data_export" ADD CONSTRAINT "personal_data_export_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "personal_data_export" ADD CONSTRAINT "personal_data_export_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personalDataExport_one_in_progress_idx" ON "personal_data_export" USING btree ("organization_id","employee_id") WHERE status IN ('pending', 'processing');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personalDataExport_org_employee_createdAt_idx" ON "personal_data_export" USING btree ("organization_id","employee_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personalDataExport_org_requester_createdAt_idx" ON "personal_data_export" USING btree ("organization_id","requested_by_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personalDataExport_expiresAt_idx" ON "personal_data_export" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personalDataExportFileCleanup_nextAttemptAt_idx" ON "personal_data_export_file_cleanup" USING btree ("next_attempt_at");--> statement-breakpoint
-- Every deleted export with a stored file (expiry, or a cascade from its employee or
-- organization) hands that file to the sweep, so no file outlives its row.
CREATE OR REPLACE FUNCTION "personal_data_export_enqueue_cleanup"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."storage_key" IS NOT NULL THEN
		INSERT INTO "personal_data_export_file_cleanup" (
			"id", "organization_id", "storage_key", "storage_bucket", "storage_version_id",
			"next_attempt_at", "created_at"
		) VALUES (
			OLD."id", OLD."organization_id", OLD."storage_key", OLD."storage_bucket",
			OLD."storage_version_id", now(), now()
		)
		ON CONFLICT DO NOTHING;
	END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "personal_data_export_cleanup" ON "personal_data_export";--> statement-breakpoint
CREATE TRIGGER "personal_data_export_cleanup" AFTER DELETE ON "personal_data_export" FOR EACH ROW EXECUTE FUNCTION "personal_data_export_enqueue_cleanup"();--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'personal_data_export_ready';
