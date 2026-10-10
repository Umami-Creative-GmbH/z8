-- #851: the wage type each payroll line kind is paid under, per payroll file
-- format. Keyed by organization and kind; no default codes ship (#856).
CREATE TABLE IF NOT EXISTS "payroll_expense_wage_type_mapping" (
	"organization_id" text NOT NULL,
	"payroll_line_kind" text NOT NULL,
	"datev_wage_type_code" text,
	"lexware_wage_type_code" text,
	"sage_wage_type_code" text,
	"successfactors_wage_type_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "payroll_expense_wage_type_mapping_organization_id_payroll_line_kind_pk" PRIMARY KEY("organization_id","payroll_line_kind"),
	CONSTRAINT "payroll_expense_wage_type_mapping_kind_check" CHECK ("payroll_expense_wage_type_mapping"."payroll_line_kind" IN ('per_diem_statutory', 'per_diem_excess', 'mileage_statutory', 'mileage_excess', 'receipt_transport', 'receipt_accommodation', 'receipt_meals', 'receipt_parking', 'receipt_other'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "payroll_expense_wage_type_mapping" ADD CONSTRAINT "payroll_expense_wage_type_mapping_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "payroll_expense_wage_type_mapping" ADD CONSTRAINT "payroll_expense_wage_type_mapping_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
