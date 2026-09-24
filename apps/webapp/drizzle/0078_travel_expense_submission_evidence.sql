-- Expense submission evidence (#295). Additive only: entered logical trip
-- dates and their interpretation zone (null for existing claims, which stay
-- unprovable), the provider object version of stored receipts, and durable
-- staging/cleanup claims for private receipt objects. Organization and claim
-- are kept by value on the staging table so cleanup outlives their deletion.
CREATE TABLE "travel_expense_receipt_upload" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"claim_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
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
	CONSTRAINT "travel_expense_receipt_upload_status_check" CHECK ("travel_expense_receipt_upload"."status" IN ('pending', 'cleanup_required')),
	CONSTRAINT "travel_expense_receipt_upload_reason_check" CHECK (("travel_expense_receipt_upload"."status" = 'pending' AND "travel_expense_receipt_upload"."reason" IS NULL)
			OR ("travel_expense_receipt_upload"."status" = 'cleanup_required'
				AND "travel_expense_receipt_upload"."reason" IN ('claim_not_draft', 'finalization_failed', 'abandoned')))
);
--> statement-breakpoint
ALTER TABLE "travel_expense_attachment" ADD COLUMN "storage_version_id" text;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD COLUMN "trip_start_date" date;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD COLUMN "trip_end_date" date;--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD COLUMN "trip_date_time_zone" text;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReceiptUpload_org_storageKey_idx" ON "travel_expense_receipt_upload" USING btree ("organization_id","storage_key");--> statement-breakpoint
CREATE INDEX "travelExpenseReceiptUpload_status_nextAttemptAt_idx" ON "travel_expense_receipt_upload" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD CONSTRAINT "travel_expense_claim_trip_dates_check" CHECK (("travel_expense_claim"."trip_start_date" IS NULL AND "travel_expense_claim"."trip_end_date" IS NULL
				AND "travel_expense_claim"."trip_date_time_zone" IS NULL)
			OR ("travel_expense_claim"."trip_start_date" IS NOT NULL AND "travel_expense_claim"."trip_end_date" IS NOT NULL
				AND "travel_expense_claim"."trip_date_time_zone" IS NOT NULL
				AND "travel_expense_claim"."trip_end_date" >= "travel_expense_claim"."trip_start_date"));