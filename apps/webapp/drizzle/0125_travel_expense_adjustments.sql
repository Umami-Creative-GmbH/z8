CREATE TABLE "travel_expense_report_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"report_id" uuid NOT NULL,
	"original_report_id" uuid NOT NULL,
	"source_report_id" uuid NOT NULL,
	"source_revision_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_by_employee_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_expense_report_adjustment_link_check" CHECK ("travel_expense_report_adjustment"."report_id" <> "travel_expense_report_adjustment"."original_report_id" AND "travel_expense_report_adjustment"."source_report_id" <> "travel_expense_report_adjustment"."report_id"),
	CONSTRAINT "travel_expense_report_adjustment_reason_check" CHECK (length(btrim("travel_expense_report_adjustment"."reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "travel_expense_report_adjustment" ADD CONSTRAINT "travel_expense_report_adjustment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_adjustment" ADD CONSTRAINT "travel_expense_report_adjustment_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_adjustment" ADD CONSTRAINT "travel_expense_report_adjustment_original_fk" FOREIGN KEY ("original_report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportAdjustment_org_report_idx" ON "travel_expense_report_adjustment" USING btree ("organization_id","report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportAdjustment_org_idempotency_idx" ON "travel_expense_report_adjustment" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "travelExpenseReportAdjustment_org_original_idx" ON "travel_expense_report_adjustment" USING btree ("organization_id","original_report_id");--> statement-breakpoint
CREATE FUNCTION "travel_expense_report_adjustment_refuse_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'Travel expense report adjustments are immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "travel_expense_report_adjustment_immutable" BEFORE UPDATE ON "travel_expense_report_adjustment"
FOR EACH ROW EXECUTE FUNCTION "travel_expense_report_adjustment_refuse_update"();--> statement-breakpoint
-- An adjustment copies the receipts of the approved report it corrects: its
-- rows name the same stored objects, so a key is unique per report only. The
-- cleanup job already keeps an object while any receipt row names its key.
DROP INDEX "travelExpenseReportReceipt_org_storageKey_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportReceipt_org_report_storageKey_idx" ON "travel_expense_report_receipt" USING btree ("organization_id","report_id","storage_key");--> statement-breakpoint
CREATE INDEX "travelExpenseReportReceipt_org_storageKey_idx" ON "travel_expense_report_receipt" USING btree ("organization_id","storage_key");
