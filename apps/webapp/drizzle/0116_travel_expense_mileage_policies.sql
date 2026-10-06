CREATE TABLE "travel_expense_allowance_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "travel_expense_allowance_policy_kind_check" CHECK ("travel_expense_allowance_policy"."kind" IN ('mileage'))
);
--> statement-breakpoint
CREATE TABLE "travel_expense_allowance_policy_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"currency" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_reference" text,
	"source_version" text,
	"default_key" text,
	"note" text,
	"replaces_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	CONSTRAINT "travel_expense_allowance_policy_version_currency_check" CHECK ("travel_expense_allowance_policy_version"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "travel_expense_allowance_policy_version_source_check" CHECK (("travel_expense_allowance_policy_version"."source_kind" = 'organization' AND "travel_expense_allowance_policy_version"."default_key" IS NULL)
			OR ("travel_expense_allowance_policy_version"."source_kind" = 'statutory_default' AND "travel_expense_allowance_policy_version"."default_key" IS NOT NULL
				AND "travel_expense_allowance_policy_version"."source_reference" IS NOT NULL AND "travel_expense_allowance_policy_version"."source_version" IS NOT NULL)),
	CONSTRAINT "travel_expense_allowance_policy_version_withdrawn_check" CHECK ("travel_expense_allowance_policy_version"."withdrawn_by" IS NULL OR "travel_expense_allowance_policy_version"."withdrawn_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "travel_expense_mileage_rate" (
	"version_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"vehicle" text NOT NULL,
	"rate_per_km" numeric(8, 4) NOT NULL,
	CONSTRAINT "travel_expense_mileage_rate_pk" PRIMARY KEY("version_id","vehicle"),
	CONSTRAINT "travel_expense_mileage_rate_vehicle_check" CHECK ("travel_expense_mileage_rate"."vehicle" IN ('car', 'other_motor_vehicle')),
	CONSTRAINT "travel_expense_mileage_rate_amount_check" CHECK ("travel_expense_mileage_rate"."rate_per_km" > 0 AND "travel_expense_mileage_rate"."rate_per_km" <= 100)
);
--> statement-breakpoint
ALTER TABLE "travel_expense_allowance_policy" ADD CONSTRAINT "travel_expense_allowance_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_allowance_policy" ADD CONSTRAINT "travel_expense_allowance_policy_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseAllowancePolicy_id_org_idx" ON "travel_expense_allowance_policy" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseAllowancePolicy_org_kind_idx" ON "travel_expense_allowance_policy" USING btree ("organization_id","kind");--> statement-breakpoint
ALTER TABLE "travel_expense_allowance_policy_version" ADD CONSTRAINT "travel_expense_allowance_policy_version_policy_fk" FOREIGN KEY ("policy_id","organization_id") REFERENCES "public"."travel_expense_allowance_policy"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_allowance_policy_version" ADD CONSTRAINT "travel_expense_allowance_policy_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_allowance_policy_version" ADD CONSTRAINT "travel_expense_allowance_policy_version_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseAllowancePolicyVersion_id_org_idx" ON "travel_expense_allowance_policy_version" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "travelExpenseAllowancePolicyVersion_active_start_idx" ON "travel_expense_allowance_policy_version" USING btree ("policy_id","effective_from") WHERE withdrawn_at IS NULL;--> statement-breakpoint
CREATE INDEX "travelExpenseAllowancePolicyVersion_org_idx" ON "travel_expense_allowance_policy_version" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "travel_expense_mileage_rate" ADD CONSTRAINT "travel_expense_mileage_rate_version_fk" FOREIGN KEY ("version_id","organization_id") REFERENCES "public"."travel_expense_allowance_policy_version"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD COLUMN "mileage_route" text;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD COLUMN "mileage_distance_km" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD COLUMN "mileage_vehicle" text;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD COLUMN "mileage_policy" jsonb;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" DROP CONSTRAINT "travel_expense_report_item_type_check";--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_type_check" CHECK ("travel_expense_report_item"."type" IN ('receipt', 'mileage'));--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_mileage_check" CHECK (("travel_expense_report_item"."type" = 'mileage' OR ("travel_expense_report_item"."mileage_route" IS NULL
				AND "travel_expense_report_item"."mileage_distance_km" IS NULL AND "travel_expense_report_item"."mileage_vehicle" IS NULL
				AND "travel_expense_report_item"."mileage_policy" IS NULL))
			AND ("travel_expense_report_item"."type" <> 'mileage' OR ("travel_expense_report_item"."original_amount" IS NULL
				AND "travel_expense_report_item"."original_currency" IS NULL AND "travel_expense_report_item"."category" IS NULL
				AND ("travel_expense_report_item"."mileage_distance_km" IS NULL OR "travel_expense_report_item"."mileage_distance_km" > 0)
				AND ("travel_expense_report_item"."mileage_vehicle" IS NULL OR "travel_expense_report_item"."mileage_vehicle" IN ('car', 'other_motor_vehicle')))));
