ALTER TABLE "travel_expense_settings" ADD COLUMN "missing_receipt_exceptions_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD COLUMN "receipt_exception_reason" text;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD COLUMN "receipt_exception_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_receipt_exception_check" CHECK ("travel_expense_report_item"."receipt_exception_version" >= 0 AND ("travel_expense_report_item"."receipt_exception_reason" IS NULL
				OR char_length(btrim("travel_expense_report_item"."receipt_exception_reason")) BETWEEN 1 AND 1000));
