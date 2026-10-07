CREATE TABLE "travel_expense_reference_rate_policy" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"approved_by" text,
	"approved_by_name" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "travel_expense_reference_rate_policy_provider_check" CHECK ("travel_expense_reference_rate_policy"."provider" IN ('ecb'))
);
--> statement-breakpoint
CREATE TABLE "travel_expense_reference_rate_publication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"publication_date" date NOT NULL,
	"version" integer NOT NULL,
	"rates" jsonb NOT NULL,
	"content_sha256" text NOT NULL,
	"source_url" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "travel_expense_reference_rate_publication_check" CHECK ("travel_expense_reference_rate_publication"."provider" IN ('ecb') AND "travel_expense_reference_rate_publication"."version" >= 1
				AND "travel_expense_reference_rate_publication"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "travel_expense_reference_rate_provider_state" (
	"provider" text PRIMARY KEY NOT NULL,
	"history_from" date,
	"latest_success_at" timestamp with time zone,
	"latest_attempt_at" timestamp with time zone NOT NULL,
	"latest_failure" text,
	"latest_failure_at" timestamp with time zone,
	CONSTRAINT "travel_expense_reference_rate_provider_state_check" CHECK ("travel_expense_reference_rate_provider_state"."provider" IN ('ecb'))
);
--> statement-breakpoint
ALTER TABLE "travel_expense_reference_rate_policy" ADD CONSTRAINT "travel_expense_reference_rate_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_reference_rate_policy" ADD CONSTRAINT "travel_expense_reference_rate_policy_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReferenceRatePublication_version_idx" ON "travel_expense_reference_rate_publication" USING btree ("provider","publication_date","version");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReferenceRatePublication_current_idx" ON "travel_expense_reference_rate_publication" USING btree ("provider","publication_date") WHERE "travel_expense_reference_rate_publication"."superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "travelExpenseReferenceRatePublication_date_idx" ON "travel_expense_reference_rate_publication" USING btree ("provider","publication_date");--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" ADD COLUMN "reference_source" jsonb;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" ADD COLUMN "reference_expense_date" date;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" DROP CONSTRAINT "travel_expense_report_item_conversion_basis_check";--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" ADD CONSTRAINT "travel_expense_report_item_conversion_basis_check" CHECK (("travel_expense_report_item_conversion"."basis" = 'card_charge' AND "travel_expense_report_item_conversion"."charged_amount" IS NOT NULL
				AND "travel_expense_report_item_conversion"."charged_amount" > 0 AND "travel_expense_report_item_conversion"."rate" IS NULL
				AND "travel_expense_report_item_conversion"."rate_base_currency" IS NULL AND "travel_expense_report_item_conversion"."rate_quote_currency" IS NULL
				AND "travel_expense_report_item_conversion"."rate_date" IS NULL AND "travel_expense_report_item_conversion"."reason" IS NULL
				AND "travel_expense_report_item_conversion"."authorized_by_employee_id" IS NULL AND "travel_expense_report_item_conversion"."authorized_by_name" IS NULL
				AND "travel_expense_report_item_conversion"."authorized_at" IS NULL)
			OR ("travel_expense_report_item_conversion"."basis" = 'manual_rate' AND "travel_expense_report_item_conversion"."charged_amount" IS NULL
				AND "travel_expense_report_item_conversion"."rate" IS NOT NULL AND "travel_expense_report_item_conversion"."rate" > 0
				AND (("travel_expense_report_item_conversion"."rate_base_currency" = "travel_expense_report_item_conversion"."source_currency"
						AND "travel_expense_report_item_conversion"."rate_quote_currency" = "travel_expense_report_item_conversion"."target_currency")
					OR ("travel_expense_report_item_conversion"."rate_base_currency" = "travel_expense_report_item_conversion"."target_currency"
						AND "travel_expense_report_item_conversion"."rate_quote_currency" = "travel_expense_report_item_conversion"."source_currency"))
				AND "travel_expense_report_item_conversion"."rate_date" IS NOT NULL AND "travel_expense_report_item_conversion"."reason" IS NOT NULL
				AND length(btrim("travel_expense_report_item_conversion"."reason")) > 0 AND "travel_expense_report_item_conversion"."evidence_receipt_id" IS NULL
				AND "travel_expense_report_item_conversion"."authorized_by_employee_id" IS NOT NULL AND "travel_expense_report_item_conversion"."authorized_by_name" IS NOT NULL
				AND "travel_expense_report_item_conversion"."authorized_at" IS NOT NULL)
			OR ("travel_expense_report_item_conversion"."basis" = 'reference_rate' AND "travel_expense_report_item_conversion"."charged_amount" IS NULL
				AND "travel_expense_report_item_conversion"."rate" IS NOT NULL AND "travel_expense_report_item_conversion"."rate" > 0
				AND (("travel_expense_report_item_conversion"."rate_base_currency" = "travel_expense_report_item_conversion"."source_currency"
						AND "travel_expense_report_item_conversion"."rate_quote_currency" = "travel_expense_report_item_conversion"."target_currency")
					OR ("travel_expense_report_item_conversion"."rate_base_currency" = "travel_expense_report_item_conversion"."target_currency"
						AND "travel_expense_report_item_conversion"."rate_quote_currency" = "travel_expense_report_item_conversion"."source_currency"))
				AND "travel_expense_report_item_conversion"."rate_date" IS NOT NULL AND "travel_expense_report_item_conversion"."reference_expense_date" IS NOT NULL
				AND "travel_expense_report_item_conversion"."rate_date" <= "travel_expense_report_item_conversion"."reference_expense_date"
				AND "travel_expense_report_item_conversion"."reference_source" IS NOT NULL AND "travel_expense_report_item_conversion"."reason" IS NULL
				AND "travel_expense_report_item_conversion"."evidence_receipt_id" IS NULL AND "travel_expense_report_item_conversion"."authorized_by_employee_id" IS NULL
				AND "travel_expense_report_item_conversion"."authorized_by_name" IS NULL AND "travel_expense_report_item_conversion"."authorized_at" IS NULL));--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" ADD CONSTRAINT "travel_expense_report_item_conversion_reference_check" CHECK (("travel_expense_report_item_conversion"."basis" = 'reference_rate') = ("travel_expense_report_item_conversion"."reference_source" IS NOT NULL)
				AND ("travel_expense_report_item_conversion"."basis" = 'reference_rate') = ("travel_expense_report_item_conversion"."reference_expense_date" IS NOT NULL));
