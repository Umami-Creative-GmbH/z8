-- #849: the organization's reimbursement channel. Existing organizations keep
-- paying by bank transfer; payroll_run stays behind the preview gate.
ALTER TABLE "travel_expense_settings" ADD COLUMN IF NOT EXISTS "reimbursement_channel" text DEFAULT 'bank_transfer' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "travel_expense_settings" ADD CONSTRAINT "travel_expense_settings_reimbursement_channel_check" CHECK ("travel_expense_settings"."reimbursement_channel" in ('bank_transfer', 'payroll_run'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- The preview gate of payroll_run. No row or 'inactive' means closed; there is
-- no application setter, the activation ticket (#856) opens it per organization.
CREATE TABLE IF NOT EXISTS "travel_expense_payroll_run_preview_control" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'inactive' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_expense_payroll_run_preview_control_mode_check" CHECK ("travel_expense_payroll_run_preview_control"."mode" IN ('inactive', 'active'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "travel_expense_payroll_run_preview_control" ADD CONSTRAINT "travel_expense_payroll_run_preview_control_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
