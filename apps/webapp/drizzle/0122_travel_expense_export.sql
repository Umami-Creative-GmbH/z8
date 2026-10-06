CREATE TABLE "travel_expense_export_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"selection_fingerprint" text NOT NULL,
	"manifest_version" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_digest" text NOT NULL,
	"revision_count" integer NOT NULL,
	"item_count" integer NOT NULL,
	"receipt_count" integer NOT NULL,
	"totals" jsonb NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"requested_by_employee_id" uuid,
	"requested_by_user_id" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"cancelled_by_user_id" text,
	"file_name" text,
	"storage_bucket" text,
	"storage_key" text,
	"storage_version_id" text,
	"size_bytes" integer,
	"checksum_sha256" text,
	CONSTRAINT "travel_expense_export_batch_status_check" CHECK ("travel_expense_export_batch"."status" IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "travel_expense_export_batch_counts_check" CHECK ("travel_expense_export_batch"."revision_count" >= 1 AND "travel_expense_export_batch"."item_count" >= "travel_expense_export_batch"."revision_count"
			AND "travel_expense_export_batch"."receipt_count" >= 0 AND "travel_expense_export_batch"."attempt" >= 1),
	CONSTRAINT "travel_expense_export_batch_outcome_check" CHECK (("travel_expense_export_batch"."status" <> 'completed' OR ("travel_expense_export_batch"."completed_at" IS NOT NULL AND "travel_expense_export_batch"."file_name" IS NOT NULL
				AND "travel_expense_export_batch"."storage_key" IS NOT NULL AND "travel_expense_export_batch"."size_bytes" IS NOT NULL AND "travel_expense_export_batch"."checksum_sha256" IS NOT NULL))
			AND ("travel_expense_export_batch"."status" <> 'failed' OR ("travel_expense_export_batch"."failed_at" IS NOT NULL AND "travel_expense_export_batch"."error_code" IS NOT NULL))
			AND ("travel_expense_export_batch"."status" <> 'cancelled' OR ("travel_expense_export_batch"."cancelled_at" IS NOT NULL AND "travel_expense_export_batch"."cancel_reason" IS NOT NULL))
			AND ("travel_expense_export_batch"."status" <> 'processing' OR "travel_expense_export_batch"."started_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "travel_expense_export_batch_revision" (
	"batch_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"report_id" uuid NOT NULL,
	"submitted_revision_id" uuid NOT NULL,
	"submission_cycle" integer NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "travel_expense_export_batch_revision_pk" PRIMARY KEY("batch_id","submitted_revision_id")
);
--> statement-breakpoint
ALTER TABLE "travel_expense_export_batch" ADD CONSTRAINT "travel_expense_export_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_export_batch" ADD CONSTRAINT "travel_expense_export_batch_requested_by_employee_id_employee_id_fk" FOREIGN KEY ("requested_by_employee_id") REFERENCES "public"."employee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseExportBatch_id_org_idx" ON "travel_expense_export_batch" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseExportBatch_org_idempotency_idx" ON "travel_expense_export_batch" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "travelExpenseExportBatch_org_requested_idx" ON "travel_expense_export_batch" USING btree ("organization_id","requested_at");--> statement-breakpoint
ALTER TABLE "travel_expense_export_batch_revision" ADD CONSTRAINT "travel_expense_export_batch_revision_batch_fk" FOREIGN KEY ("batch_id","organization_id") REFERENCES "public"."travel_expense_export_batch"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_export_batch_revision" ADD CONSTRAINT "travel_expense_export_batch_revision_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseExportBatchRevision_active_revision_idx" ON "travel_expense_export_batch_revision" USING btree ("organization_id","submitted_revision_id") WHERE released_at IS NULL;--> statement-breakpoint
CREATE INDEX "travelExpenseExportBatchRevision_org_report_idx" ON "travel_expense_export_batch_revision" USING btree ("organization_id","report_id");--> statement-breakpoint
-- What a batch exports is fixed when it is created, and a completed or
-- cancelled batch is history: neither changes again. The one permitted change
-- to a terminal batch is the ON DELETE SET NULL of the requesting employee.
CREATE FUNCTION "travel_expense_export_batch_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
		OR NEW."selection_fingerprint" IS DISTINCT FROM OLD."selection_fingerprint"
		OR NEW."manifest_version" IS DISTINCT FROM OLD."manifest_version"
		OR NEW."manifest" IS DISTINCT FROM OLD."manifest"
		OR NEW."manifest_digest" IS DISTINCT FROM OLD."manifest_digest"
		OR NEW."totals" IS DISTINCT FROM OLD."totals"
		OR NEW."requested_by_user_id" IS DISTINCT FROM OLD."requested_by_user_id"
		OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at" THEN
		RAISE EXCEPTION 'Travel expense export batch manifests are immutable';
	END IF;
	IF OLD."status" IN ('completed', 'cancelled')
		AND NOT (NEW."requested_by_employee_id" IS NULL
			AND to_jsonb(NEW) - 'requested_by_employee_id' = to_jsonb(OLD) - 'requested_by_employee_id') THEN
		RAISE EXCEPTION 'Completed or cancelled travel expense export batches are immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "travel_expense_export_batch_guard" BEFORE UPDATE ON "travel_expense_export_batch"
FOR EACH ROW EXECUTE FUNCTION "travel_expense_export_batch_guard"();
