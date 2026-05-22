ALTER TABLE "approval_request" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "approvalRequest_pending_entity_unique_idx" ON "approval_request" USING btree ("organization_id","entity_type","entity_id") WHERE status = 'pending';
