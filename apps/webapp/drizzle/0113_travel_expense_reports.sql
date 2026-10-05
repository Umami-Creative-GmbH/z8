CREATE TABLE "travel_expense_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reimbursement_currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "travel_expense_report_kind_check" CHECK ("travel_expense_report"."kind" IN ('standalone')),
	CONSTRAINT "travel_expense_report_status_check" CHECK ("travel_expense_report"."status" IN ('draft'))
);
--> statement-breakpoint
CREATE TABLE "travel_expense_report_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"report_id" uuid NOT NULL,
	"type" text NOT NULL,
	"position" integer NOT NULL,
	"expense_date" date,
	"category" text,
	"description" text,
	"original_amount" numeric(12, 2),
	"original_currency" text,
	"paid_by" text,
	"accounting_reference" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "travel_expense_report_item_type_check" CHECK ("travel_expense_report_item"."type" IN ('receipt')),
	CONSTRAINT "travel_expense_report_item_category_check" CHECK ("travel_expense_report_item"."category" IS NULL OR "travel_expense_report_item"."category" IN ('transport', 'accommodation', 'meals', 'parking', 'other')),
	CONSTRAINT "travel_expense_report_item_paid_by_check" CHECK ("travel_expense_report_item"."paid_by" IS NULL OR "travel_expense_report_item"."paid_by" IN ('employee', 'company')),
	CONSTRAINT "travel_expense_report_item_amount_check" CHECK ("travel_expense_report_item"."original_amount" IS NULL OR "travel_expense_report_item"."original_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "travel_expense_report_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"report_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"storage_provider" text NOT NULL,
	"storage_bucket" text,
	"storage_key" text NOT NULL,
	"storage_version_id" text,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "travel_expense_receipt_upload" ALTER COLUMN "claim_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_receipt_upload" ADD COLUMN "report_id" uuid;--> statement-breakpoint
ALTER TABLE "travel_expense_receipt_upload" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReport_id_org_idx" ON "travel_expense_report" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "travelExpenseReport_org_employee_status_idx" ON "travel_expense_report" USING btree ("organization_id","employee_id","status");--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportItem_id_org_idx" ON "travel_expense_report_item" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportItem_report_position_idx" ON "travel_expense_report_item" USING btree ("report_id","position");--> statement-breakpoint
ALTER TABLE "travel_expense_report_receipt" ADD CONSTRAINT "travel_expense_report_receipt_uploaded_by_employee_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_receipt" ADD CONSTRAINT "travel_expense_report_receipt_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_receipt" ADD CONSTRAINT "travel_expense_report_receipt_item_fk" FOREIGN KEY ("item_id","organization_id") REFERENCES "public"."travel_expense_report_item"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "travelExpenseReportReceipt_item_idx" ON "travel_expense_report_receipt" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "travelExpenseReportReceipt_report_idx" ON "travel_expense_report_receipt" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportReceipt_org_storageKey_idx" ON "travel_expense_report_receipt" USING btree ("organization_id","storage_key");--> statement-breakpoint
ALTER TABLE "travel_expense_receipt_upload" DROP CONSTRAINT "travel_expense_receipt_upload_reason_check";--> statement-breakpoint
ALTER TABLE "travel_expense_receipt_upload" ADD CONSTRAINT "travel_expense_receipt_upload_reason_check" CHECK (("travel_expense_receipt_upload"."status" = 'pending' AND "travel_expense_receipt_upload"."reason" IS NULL)
			OR ("travel_expense_receipt_upload"."status" = 'cleanup_required'
				AND "travel_expense_receipt_upload"."reason" IN ('claim_not_draft', 'report_not_draft', 'finalization_failed', 'abandoned', 'removed')));--> statement-breakpoint
ALTER TABLE "travel_expense_receipt_upload" ADD CONSTRAINT "travel_expense_receipt_upload_owner_check" CHECK (("travel_expense_receipt_upload"."claim_id" IS NOT NULL AND "travel_expense_receipt_upload"."report_id" IS NULL AND "travel_expense_receipt_upload"."item_id" IS NULL)
			OR ("travel_expense_receipt_upload"."claim_id" IS NULL AND "travel_expense_receipt_upload"."report_id" IS NOT NULL AND "travel_expense_receipt_upload"."item_id" IS NOT NULL));--> statement-breakpoint
-- Every deleted report receipt (removal, or a cascade from its item, report,
-- employee or organization) hands its stored object to the receipt cleanup
-- worker. The staging row is kept by value, so it outlives the deleted owner.
CREATE OR REPLACE FUNCTION "travel_expense_report_receipt_enqueue_cleanup"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "travel_expense_receipt_upload" (
		"id", "organization_id", "report_id", "item_id", "uploaded_by", "storage_key",
		"storage_bucket", "storage_version_id", "status", "reason", "next_attempt_at",
		"created_at", "updated_at"
	) VALUES (
		OLD."id", OLD."organization_id", OLD."report_id", OLD."item_id", OLD."uploaded_by",
		OLD."storage_key", OLD."storage_bucket", OLD."storage_version_id", 'cleanup_required',
		'removed', now(), now(), now()
	)
	ON CONFLICT DO NOTHING;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "travel_expense_report_receipt_cleanup" AFTER DELETE ON "travel_expense_report_receipt" FOR EACH ROW EXECUTE FUNCTION "travel_expense_report_receipt_enqueue_cleanup"();