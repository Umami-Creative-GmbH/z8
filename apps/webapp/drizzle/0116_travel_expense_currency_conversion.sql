ALTER TABLE "travel_expense_settings" ADD COLUMN "reimbursement_currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
CREATE TABLE "travel_expense_report_item_conversion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"report_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"basis" text NOT NULL,
	"source_currency" text NOT NULL,
	"target_currency" text NOT NULL,
	"charged_amount" numeric(12, 2),
	"rate" numeric(22, 10),
	"rate_base_currency" text,
	"rate_quote_currency" text,
	"rate_date" date,
	"reason" text,
	"evidence_receipt_id" uuid,
	"authorized_by_employee_id" uuid,
	"authorized_by_name" text,
	"authorized_at" timestamp with time zone,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_expense_report_item_conversion_pair_check" CHECK ("travel_expense_report_item_conversion"."source_currency" ~ '^[A-Z]{3}$' AND "travel_expense_report_item_conversion"."target_currency" ~ '^[A-Z]{3}$'
			AND "travel_expense_report_item_conversion"."source_currency" <> "travel_expense_report_item_conversion"."target_currency"),
	CONSTRAINT "travel_expense_report_item_conversion_basis_check" CHECK (("travel_expense_report_item_conversion"."basis" = 'card_charge' AND "travel_expense_report_item_conversion"."charged_amount" IS NOT NULL
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
				AND "travel_expense_report_item_conversion"."authorized_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" ADD CONSTRAINT "travel_expense_report_item_conversion_evidence_fk" FOREIGN KEY ("evidence_receipt_id") REFERENCES "public"."travel_expense_report_receipt"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" ADD CONSTRAINT "travel_expense_report_item_conversion_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" ADD CONSTRAINT "travel_expense_report_item_conversion_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item_conversion" ADD CONSTRAINT "travel_expense_report_item_conversion_item_fk" FOREIGN KEY ("item_id","organization_id") REFERENCES "public"."travel_expense_report_item"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportItemConversion_item_idx" ON "travel_expense_report_item_conversion" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "travelExpenseReportItemConversion_report_idx" ON "travel_expense_report_item_conversion" USING btree ("report_id");
