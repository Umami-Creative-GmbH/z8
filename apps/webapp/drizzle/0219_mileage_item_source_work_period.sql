-- Mileage item from own-vehicle work (#1131, spec #807; Time Tracking glossary "Driving"):
-- a mileage item remembers the work period it was pre-filled from. The partial unique index
-- puts a work period's driven distance in at most one item, also under concurrent requests;
-- deleting the item (or its draft report) releases it. Hard-deleting the work period clears
-- only the link: SET NULL ("source_work_period_id") keeps the item's organization.
-- Additive only. Idempotent.
ALTER TABLE "travel_expense_report_item" ADD COLUMN IF NOT EXISTS "source_work_period_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_source_work_period_fk" FOREIGN KEY ("source_work_period_id","organization_id") REFERENCES "public"."work_period"("id","organization_id") ON DELETE SET NULL ("source_work_period_id") ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_source_work_period_check" CHECK ("travel_expense_report_item"."source_work_period_id" IS NULL OR "travel_expense_report_item"."type" = 'mileage');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "travelExpenseReportItem_org_sourceWorkPeriod_idx" ON "travel_expense_report_item" USING btree ("organization_id","source_work_period_id") WHERE "travel_expense_report_item"."source_work_period_id" IS NOT NULL;
