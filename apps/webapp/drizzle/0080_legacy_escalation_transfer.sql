-- #299: legacy-authoritative escalation transfers share the escalation journal.
-- Existing rows are canonical. A legacy row never names a canonical workflow;
-- it references the legacy approval request and any shadow observation by
-- value, and is itself the operation's replay receipt.
ALTER TABLE "approval_escalation_transfer" ALTER COLUMN "workflow_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ALTER COLUMN "stage_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ALTER COLUMN "source_assignment_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ALTER COLUMN "replacement_assignment_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ALTER COLUMN "workflow_event_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ADD COLUMN "legacy_approval_request_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ADD COLUMN "legacy_source_sequence" integer;
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ADD COLUMN "observed_workflow_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ADD COLUMN "observed_event_id" uuid;
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" DROP CONSTRAINT "approval_escalation_transfer_mode_check";
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ADD CONSTRAINT "approval_escalation_transfer_mode_check" CHECK (
	("authority_mode" = 'canonical' AND "workflow_id" IS NOT NULL AND "stage_id" IS NOT NULL
		AND "source_assignment_id" IS NOT NULL AND "replacement_assignment_id" IS NOT NULL
		AND "workflow_event_id" IS NOT NULL
		AND "legacy_approval_request_id" IS NULL AND "legacy_source_sequence" IS NULL
		AND "observed_workflow_id" IS NULL AND "observed_event_id" IS NULL)
	OR ("authority_mode" = 'legacy' AND "workflow_id" IS NULL AND "stage_id" IS NULL
		AND "source_assignment_id" IS NULL AND "replacement_assignment_id" IS NULL
		AND "workflow_event_id" IS NULL AND "lineage_root_assignment_id" IS NULL
		AND "legacy_approval_request_id" IS NOT NULL AND "legacy_source_sequence" >= 0
		AND ("observed_workflow_id" IS NULL) = ("observed_event_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" DROP CONSTRAINT "approval_escalation_transfer_evidence_check";
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ADD CONSTRAINT "approval_escalation_transfer_evidence_check" CHECK (
	"actionable_evidence" IS NULL
	OR ("authority_mode" = 'canonical' AND "actionable_evidence" IN ('assignment_assigned_at', 'rollout_fallback'))
	OR ("authority_mode" = 'legacy' AND "actionable_evidence" IN ('legacy_request_created_at', 'legacy_transfer_at'))
);
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" DROP CONSTRAINT "approval_escalation_transfer_deadline_check";
--> statement-breakpoint
ALTER TABLE "approval_escalation_transfer" ADD CONSTRAINT "approval_escalation_transfer_deadline_check" CHECK (
	("initiator" = 'scheduled' AND "actionable_at" IS NOT NULL AND "actionable_evidence" IS NOT NULL
		AND "deadline_at" IS NOT NULL AND "policy_revision" IS NOT NULL
		AND ("lineage_root_assignment_id" IS NOT NULL OR "authority_mode" = 'legacy'))
	OR ("initiator" = 'human' AND "actionable_at" IS NULL AND "actionable_evidence" IS NULL AND "deadline_at" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalEscalationTransfer_org_legacy_source_idx" ON "approval_escalation_transfer" USING btree ("organization_id","legacy_approval_request_id","legacy_source_sequence") WHERE authority_mode = 'legacy';
