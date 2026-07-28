DROP INDEX "approvalWorkflow_org_source_pending_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "approvalWorkflow_org_source_pending_idx" ON "approval_workflow" USING btree ("organization_id","workflow_type","source_type","source_id") WHERE status = 'pending';
