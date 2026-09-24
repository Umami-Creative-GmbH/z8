-- #288: legacy-authoritative absence evidence in the authority-independent
-- evidence store. Existing rows are canonical; legacy rows never name a
-- canonical workflow as their lifecycle and reference legacy rows by value.
ALTER TABLE "approval_submitted_revision" ADD COLUMN "authority" text DEFAULT 'canonical' NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_submitted_revision" ALTER COLUMN "workflow_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_submitted_revision" ADD COLUMN "legacy_approval_request_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_submitted_revision" ADD COLUMN "legacy_chain_instance_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_submitted_revision" ADD COLUMN "observed_workflow_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_submitted_revision" ADD CONSTRAINT "approval_submitted_revision_authority_check" CHECK (
	("authority" = 'canonical' AND "workflow_id" IS NOT NULL
		AND "legacy_approval_request_id" IS NULL
		AND "legacy_chain_instance_id" IS NULL
		AND "observed_workflow_id" IS NULL)
	OR ("authority" = 'legacy' AND "workflow_id" IS NULL
		AND "legacy_approval_request_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "approval_submitted_revision" ADD CONSTRAINT "approvalSubmittedRevision_id_organizationId_authority_idx" UNIQUE("id","organization_id","authority");
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalSubmittedRevision_org_legacy_cycle_revision_idx" ON "approval_submitted_revision" USING btree ("organization_id","source_type","source_id","request_cycle_key","revision") WHERE "authority" = 'legacy';
--> statement-breakpoint
ALTER TABLE "approval_decision_evidence" ADD COLUMN "authority" text DEFAULT 'canonical' NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_decision_evidence" ALTER COLUMN "workflow_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_decision_evidence" ADD COLUMN "legacy_approval_request_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_decision_evidence" ADD COLUMN "legacy_chain_stage_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_decision_evidence" ADD COLUMN "observed_workflow_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_decision_evidence" ADD CONSTRAINT "approval_decision_evidence_authority_check" CHECK (
	("authority" = 'canonical' AND "workflow_id" IS NOT NULL
		AND "legacy_approval_request_id" IS NULL
		AND "legacy_chain_stage_id" IS NULL
		AND "observed_workflow_id" IS NULL)
	OR ("authority" = 'legacy' AND "workflow_id" IS NULL
		AND "legacy_approval_request_id" IS NOT NULL
		AND "stage_id" IS NULL AND "assignment_id" IS NULL
		AND "reviewed_binding_id" IS NULL)
);
--> statement-breakpoint
-- The workflow-scoped revision FK is MATCH SIMPLE and skips legacy rows; this
-- one binds every decision to a revision of the same organization and authority.
ALTER TABLE "approval_decision_evidence" ADD CONSTRAINT "approval_decision_evidence_revision_authority_fk" FOREIGN KEY ("submitted_revision_id","organization_id","authority") REFERENCES "approval_submitted_revision"("id","organization_id","authority") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalDecisionEvidence_org_legacy_request_idx" ON "approval_decision_evidence" USING btree ("organization_id","legacy_approval_request_id") WHERE "authority" = 'legacy';
