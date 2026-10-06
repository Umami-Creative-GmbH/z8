ALTER TABLE "travel_expense_allowance_policy" DROP CONSTRAINT "travel_expense_allowance_policy_kind_check";--> statement-breakpoint
ALTER TABLE "travel_expense_allowance_policy" ADD CONSTRAINT "travel_expense_allowance_policy_kind_check" CHECK ("travel_expense_allowance_policy"."kind" IN ('mileage', 'per_diem'));--> statement-breakpoint
CREATE TABLE "travel_expense_per_diem_rate" (
	"version_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"area" text NOT NULL,
	"full_day_amount" numeric(10, 2) NOT NULL,
	"partial_day_amount" numeric(10, 2) NOT NULL,
	"breakfast_deduction" numeric(10, 2) NOT NULL,
	"lunch_deduction" numeric(10, 2) NOT NULL,
	"dinner_deduction" numeric(10, 2) NOT NULL,
	CONSTRAINT "travel_expense_per_diem_rate_pk" PRIMARY KEY("version_id","area"),
	CONSTRAINT "travel_expense_per_diem_rate_area_check" CHECK ("travel_expense_per_diem_rate"."area" IN ('DE')),
	CONSTRAINT "travel_expense_per_diem_rate_amount_check" CHECK ("travel_expense_per_diem_rate"."full_day_amount" > 0 AND "travel_expense_per_diem_rate"."full_day_amount" <= 1000
				AND "travel_expense_per_diem_rate"."partial_day_amount" >= 0 AND "travel_expense_per_diem_rate"."partial_day_amount" <= "travel_expense_per_diem_rate"."full_day_amount"
				AND "travel_expense_per_diem_rate"."breakfast_deduction" >= 0 AND "travel_expense_per_diem_rate"."breakfast_deduction" <= "travel_expense_per_diem_rate"."full_day_amount"
				AND "travel_expense_per_diem_rate"."lunch_deduction" >= 0 AND "travel_expense_per_diem_rate"."lunch_deduction" <= "travel_expense_per_diem_rate"."full_day_amount"
				AND "travel_expense_per_diem_rate"."dinner_deduction" >= 0 AND "travel_expense_per_diem_rate"."dinner_deduction" <= "travel_expense_per_diem_rate"."full_day_amount")
);
--> statement-breakpoint
ALTER TABLE "travel_expense_per_diem_rate" ADD CONSTRAINT "travel_expense_per_diem_rate_version_fk" FOREIGN KEY ("version_id","organization_id") REFERENCES "public"."travel_expense_allowance_policy_version"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" DROP CONSTRAINT "travel_expense_report_item_type_check";--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_type_check" CHECK ("travel_expense_report_item"."type" IN ('receipt', 'mileage', 'per_diem'));--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_per_diem_check" CHECK ("travel_expense_report_item"."type" <> 'per_diem' OR ("travel_expense_report_item"."original_amount" IS NULL
				AND "travel_expense_report_item"."original_currency" IS NULL AND "travel_expense_report_item"."category" IS NULL));--> statement-breakpoint
CREATE TABLE "travel_expense_report_per_diem" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"report_id" uuid NOT NULL,
	"start_date" date,
	"start_time" text,
	"start_time_zone" text,
	"end_date" date,
	"end_time" text,
	"end_time_zone" text,
	"overnight" text,
	"prolonged_workplace" boolean DEFAULT false NOT NULL,
	"meals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy" jsonb,
	CONSTRAINT "travel_expense_report_per_diem_time_check" CHECK (("travel_expense_report_per_diem"."start_time" IS NULL OR "travel_expense_report_per_diem"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
				AND ("travel_expense_report_per_diem"."end_time" IS NULL OR "travel_expense_report_per_diem"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
				AND ("travel_expense_report_per_diem"."start_date" IS NULL OR "travel_expense_report_per_diem"."end_date" IS NULL OR "travel_expense_report_per_diem"."end_date" >= "travel_expense_report_per_diem"."start_date")),
	CONSTRAINT "travel_expense_report_per_diem_overnight_check" CHECK ("travel_expense_report_per_diem"."overnight" IS NULL OR "travel_expense_report_per_diem"."overnight" IN ('away', 'none', 'mixed')),
	CONSTRAINT "travel_expense_report_per_diem_meals_check" CHECK (jsonb_typeof("travel_expense_report_per_diem"."meals") = 'array' AND jsonb_array_length("travel_expense_report_per_diem"."meals") <= 101)
);
--> statement-breakpoint
ALTER TABLE "travel_expense_report_per_diem" ADD CONSTRAINT "travel_expense_report_per_diem_item_fk" FOREIGN KEY ("item_id","organization_id") REFERENCES "public"."travel_expense_report_item"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_per_diem" ADD CONSTRAINT "travel_expense_report_per_diem_report_fk" FOREIGN KEY ("report_id","organization_id") REFERENCES "public"."travel_expense_report"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseReportPerDiem_report_idx" ON "travel_expense_report_per_diem" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "travelExpenseReportPerDiem_org_days_idx" ON "travel_expense_report_per_diem" USING btree ("organization_id","start_date","end_date");
