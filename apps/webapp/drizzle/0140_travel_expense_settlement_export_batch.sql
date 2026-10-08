-- Mark an export batch as reimbursed (#755): a reimbursement recorded for a
-- completed export batch names that batch. Nullable: every other entry, and
-- every entry recorded before this migration, has no batch. Entries stay
-- immutable; batches are deleted only with their organization.
ALTER TABLE "travel_expense_settlement_entry" ADD COLUMN "export_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "travel_expense_settlement_entry" ADD CONSTRAINT "travel_expense_settlement_entry_export_batch_fk" FOREIGN KEY ("export_batch_id","organization_id") REFERENCES "public"."travel_expense_export_batch"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "travelExpenseSettlementEntry_org_export_batch_idx" ON "travel_expense_settlement_entry" USING btree ("organization_id","export_batch_id") WHERE "travel_expense_settlement_entry"."export_batch_id" IS NOT NULL;
