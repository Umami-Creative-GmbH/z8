-- An authorized manual conversion rate keeps an evidence reference (spec #598
-- review): where the rate can be verified. Manual rates recorded before this
-- migration (unreleased #607 test data only) are marked as such instead of
-- inventing evidence, so the constraint can hold for every row.
ALTER TABLE "travel_expense_report_item_conversion" ADD COLUMN "rate_evidence" text;--> statement-breakpoint
UPDATE "travel_expense_report_item_conversion" SET "rate_evidence" = 'Not recorded: authorized before rate evidence was required' WHERE "basis" = 'manual_rate';--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" ADD CONSTRAINT "travel_expense_report_item_conversion_rate_evidence_check" CHECK (("travel_expense_report_item_conversion"."basis" = 'manual_rate') = ("travel_expense_report_item_conversion"."rate_evidence" IS NOT NULL)
				AND ("travel_expense_report_item_conversion"."rate_evidence" IS NULL
					OR char_length(btrim("travel_expense_report_item_conversion"."rate_evidence")) BETWEEN 1 AND 2000));--> statement-breakpoint
-- The acknowledgement an approval of a reference-rate source required is kept
-- with it. Earlier approvals could only be saved with that acknowledgement
-- (statement version 1), so they are backfilled with it at their approval time.
ALTER TABLE "travel_expense_reference_rate_policy" ADD COLUMN "acknowledgement" text;--> statement-breakpoint
ALTER TABLE "travel_expense_reference_rate_policy" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
UPDATE "travel_expense_reference_rate_policy" SET "acknowledgement" = 'ecb_information_only_v1', "acknowledged_at" = "approved_at";--> statement-breakpoint
ALTER TABLE "travel_expense_reference_rate_policy" ALTER COLUMN "acknowledgement" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_reference_rate_policy" ALTER COLUMN "acknowledged_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_reference_rate_policy" ADD CONSTRAINT "travel_expense_reference_rate_policy_acknowledgement_check" CHECK ("travel_expense_reference_rate_policy"."provider" = 'ecb' AND "travel_expense_reference_rate_policy"."acknowledgement" IN ('ecb_information_only_v1'));
