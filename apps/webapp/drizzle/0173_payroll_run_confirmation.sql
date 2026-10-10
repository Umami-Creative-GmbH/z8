-- #853: confirming a payroll run as paid. A confirmed inclusion is final and
-- keeps the lines the run carried; when the run paid more than the account
-- still owed, the excess is flagged on it. Each reimbursement the confirmation
-- records names the run, like an export batch reference (0140): nullable, so
-- every other entry and every entry recorded before keeps none. Entries stay
-- immutable.
ALTER TABLE "travel_expense_payroll_run_inclusion" DROP CONSTRAINT IF EXISTS "travel_expense_payroll_run_inclusion_state_check";--> statement-breakpoint
ALTER TABLE "travel_expense_payroll_run_inclusion" ADD CONSTRAINT "travel_expense_payroll_run_inclusion_state_check" CHECK ("travel_expense_payroll_run_inclusion"."state" IN ('included', 'superseded', 'removed', 'discarded', 'confirmed'));--> statement-breakpoint
ALTER TABLE "travel_expense_payroll_run_inclusion" ADD COLUMN IF NOT EXISTS "overpaid_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "travel_expense_payroll_run_inclusion" ADD CONSTRAINT "travel_expense_payroll_run_inclusion_overpaid_check" CHECK ("travel_expense_payroll_run_inclusion"."overpaid_amount" IS NULL OR ("travel_expense_payroll_run_inclusion"."state" = 'confirmed' AND "travel_expense_payroll_run_inclusion"."overpaid_amount" > 0));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "travelExpensePayrollRunInclusion_org_report_confirmed_idx" ON "travel_expense_payroll_run_inclusion" USING btree ("organization_id","report_id") WHERE "travel_expense_payroll_run_inclusion"."state" = 'confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payrollExportJob_id_organizationId_idx" ON "payroll_export_job" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD COLUMN IF NOT EXISTS "payroll_run_id" uuid;--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD CONSTRAINT "travel_expense_settlement_entry_payroll_run_fk" FOREIGN KEY ("payroll_run_id","organization_id") REFERENCES "public"."payroll_export_job"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD CONSTRAINT "travel_expense_settlement_entry_payroll_run_check" CHECK ("travel_expense_settlement_entry"."payroll_run_id" IS NULL OR ("travel_expense_settlement_entry"."kind" = 'reimbursement' AND "travel_expense_settlement_entry"."source_type" = 'report' AND "travel_expense_settlement_entry"."export_batch_id" IS NULL));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "travelExpenseSettlementEntry_org_payroll_run_idx" ON "travel_expense_settlement_entry" USING btree ("organization_id","payroll_run_id") WHERE "travel_expense_settlement_entry"."payroll_run_id" IS NOT NULL;
