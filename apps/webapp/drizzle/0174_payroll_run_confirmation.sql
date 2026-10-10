-- #853: confirming a payroll run as paid. A confirmed inclusion is final and
-- keeps the lines the run carried. Each reimbursement the confirmation records
-- names the run, like an export batch reference (0140): nullable, so every
-- other entry and every entry recorded before keeps none. Entries stay
-- immutable.
ALTER TABLE "travel_expense_payroll_run_inclusion" DROP CONSTRAINT IF EXISTS "travel_expense_payroll_run_inclusion_state_check";--> statement-breakpoint
ALTER TABLE "travel_expense_payroll_run_inclusion" ADD CONSTRAINT "travel_expense_payroll_run_inclusion_state_check" CHECK ("travel_expense_payroll_run_inclusion"."state" IN ('included', 'superseded', 'removed', 'discarded', 'confirmed'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "travelExpensePayrollRunInclusion_org_report_confirmed_idx" ON "travel_expense_payroll_run_inclusion" USING btree ("organization_id","report_id") WHERE "travel_expense_payroll_run_inclusion"."state" = 'confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payrollExportJob_id_organizationId_idx" ON "payroll_export_job" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD COLUMN IF NOT EXISTS "payroll_run_id" uuid;--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD CONSTRAINT "travel_expense_settlement_entry_payroll_run_fk" FOREIGN KEY ("payroll_run_id","organization_id") REFERENCES "public"."payroll_export_job"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD CONSTRAINT "travel_expense_settlement_entry_payroll_run_check" CHECK ("travel_expense_settlement_entry"."payroll_run_id" IS NULL OR ("travel_expense_settlement_entry"."kind" = 'reimbursement' AND "travel_expense_settlement_entry"."source_type" = 'report' AND "travel_expense_settlement_entry"."export_batch_id" IS NULL));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "travelExpenseSettlementEntry_org_payroll_run_idx" ON "travel_expense_settlement_entry" USING btree ("organization_id","payroll_run_id") WHERE "travel_expense_settlement_entry"."payroll_run_id" IS NOT NULL;
