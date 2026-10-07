-- An authorized manual conversion rate keeps an evidence reference (spec #598
-- review): where the rate can be verified. Manual rates recorded before this
-- migration (unreleased #607 test data only) are marked as such instead of
-- inventing evidence, so the constraint can hold for every row.
ALTER TABLE "travel_expense_report_item_conversion" ADD COLUMN "rate_evidence" text;--> statement-breakpoint
UPDATE "travel_expense_report_item_conversion" SET "rate_evidence" = 'Not recorded: authorized before rate evidence was required' WHERE "basis" = 'manual_rate';--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" ADD CONSTRAINT "travel_expense_report_item_conversion_rate_evidence_check" CHECK (("travel_expense_report_item_conversion"."basis" = 'manual_rate') = ("travel_expense_report_item_conversion"."rate_evidence" IS NOT NULL)
				AND ("travel_expense_report_item_conversion"."rate_evidence" IS NULL
					OR char_length(btrim("travel_expense_report_item_conversion"."rate_evidence")) BETWEEN 1 AND 2000));
