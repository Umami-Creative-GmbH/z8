-- #296: legacy-authoritative expense review, decision and delivery. Additive and
-- inactive: no evidence, presentation or delivery control row is inserted, so
-- every organization keeps review-only (and, for expenses, unsent) cards.
--
-- Reviewed bindings for a legacy lifecycle name the exact legacy request (the
-- assignment equivalent) and a legacy submitted revision, never a canonical
-- workflow. The legacy request is kept by value, like other legacy evidence.
ALTER TABLE "approval_review_binding" ADD COLUMN "authority" text DEFAULT 'canonical' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_review_binding" ADD COLUMN "legacy_approval_request_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_review_binding" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_review_binding" ALTER COLUMN "stage_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_review_binding" ALTER COLUMN "assignment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_review_binding" ADD CONSTRAINT "approval_review_binding_authority_check" CHECK (
	("authority" = 'canonical' AND "workflow_id" IS NOT NULL
		AND "stage_id" IS NOT NULL AND "assignment_id" IS NOT NULL
		AND "legacy_approval_request_id" IS NULL)
	OR ("authority" = 'legacy' AND "workflow_id" IS NULL
		AND "stage_id" IS NULL AND "assignment_id" IS NULL
		AND "legacy_approval_request_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "approval_review_binding" ADD CONSTRAINT "approvalReviewBinding_id_organizationId_authority_idx" UNIQUE("id","organization_id","authority");--> statement-breakpoint
ALTER TABLE "approval_review_binding" ADD CONSTRAINT "approval_review_binding_revision_authority_fk" FOREIGN KEY ("submitted_revision_id","organization_id","authority") REFERENCES "approval_submitted_revision"("id","organization_id","authority") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "approvalReviewBinding_org_recipient_legacy_request_revision_idx" ON "approval_review_binding" USING btree ("organization_id","recipient_employee_id","legacy_approval_request_id","submitted_revision_id") WHERE "authority" = 'legacy';--> statement-breakpoint
-- A legacy decision may now name the legacy binding it was reviewed through.
ALTER TABLE "approval_decision_evidence" DROP CONSTRAINT "approval_decision_evidence_authority_check";--> statement-breakpoint
ALTER TABLE "approval_decision_evidence" ADD CONSTRAINT "approval_decision_evidence_authority_check" CHECK (
	("authority" = 'canonical' AND "workflow_id" IS NOT NULL
		AND "legacy_approval_request_id" IS NULL
		AND "legacy_chain_stage_id" IS NULL
		AND "observed_workflow_id" IS NULL)
	OR ("authority" = 'legacy' AND "workflow_id" IS NULL
		AND "legacy_approval_request_id" IS NOT NULL
		AND "stage_id" IS NULL AND "assignment_id" IS NULL)
);--> statement-breakpoint
ALTER TABLE "approval_decision_evidence" ADD CONSTRAINT "approvalDecisionEvidence_id_organizationId_authority_idx" UNIQUE("id","organization_id","authority");--> statement-breakpoint
ALTER TABLE "approval_decision_evidence" ADD CONSTRAINT "approval_decision_evidence_binding_authority_fk" FOREIGN KEY ("reviewed_binding_id","organization_id","authority") REFERENCES "approval_review_binding"("id","organization_id","authority");--> statement-breakpoint
-- Invocations of a legacy decision name the legacy request, not a workflow.
ALTER TABLE "approval_invocation" ADD COLUMN "authority" text DEFAULT 'canonical' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_invocation" ADD COLUMN "legacy_approval_request_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_invocation" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_invocation" ADD CONSTRAINT "approval_invocation_authority_check" CHECK (
	("authority" = 'canonical' AND "workflow_id" IS NOT NULL
		AND "legacy_approval_request_id" IS NULL)
	OR ("authority" = 'legacy' AND "workflow_id" IS NULL
		AND "legacy_approval_request_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "approval_invocation" ADD CONSTRAINT "approval_invocation_decision_authority_fk" FOREIGN KEY ("decision_evidence_id","organization_id","authority") REFERENCES "approval_decision_evidence"("id","organization_id","authority") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "approval_invocation" ADD CONSTRAINT "approval_invocation_binding_authority_fk" FOREIGN KEY ("reviewed_binding_id","organization_id","authority") REFERENCES "approval_review_binding"("id","organization_id","authority") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX "approvalInvocation_org_legacy_request_idx" ON "approval_invocation" USING btree ("organization_id","legacy_approval_request_id") WHERE "authority" = 'legacy';--> statement-breakpoint
-- Delivery of legacy lifecycles: work and tracked messages name the legacy
-- source and exact legacy request; purging that request removes them.
ALTER TABLE "approval_delivery_message" ADD COLUMN "lifecycle" text DEFAULT 'canonical' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD COLUMN "workflow_type" "approval_workflow_type";--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD COLUMN "legacy_source_type" text;--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD COLUMN "legacy_source_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD COLUMN "legacy_approval_request_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ALTER COLUMN "stage_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ALTER COLUMN "assignment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD CONSTRAINT "approval_delivery_message_lifecycle_check" CHECK (
	("lifecycle" = 'canonical' AND "workflow_id" IS NOT NULL
		AND "assignment_id" IS NOT NULL AND "legacy_approval_request_id" IS NULL
		AND "legacy_source_type" IS NULL AND "legacy_source_id" IS NULL)
	OR ("lifecycle" = 'legacy' AND "workflow_id" IS NULL
		AND "assignment_id" IS NULL AND "workflow_type" IS NOT NULL
		AND "legacy_source_type" IS NOT NULL AND "legacy_source_id" IS NOT NULL
		AND "legacy_approval_request_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD CONSTRAINT "approval_delivery_message_legacy_reference_check" CHECK ("lifecycle" <> 'legacy' OR "approval_request_id" = "legacy_approval_request_id");--> statement-breakpoint
ALTER TABLE "approval_delivery_message" ADD CONSTRAINT "approval_delivery_message_legacy_request_fk" FOREIGN KEY ("legacy_approval_request_id","organization_id") REFERENCES "approval_request"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX "approvalDeliveryMessage_org_legacy_source_idx" ON "approval_delivery_message" USING btree ("organization_id","legacy_source_type","legacy_source_id") WHERE "lifecycle" = 'legacy';--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD COLUMN "lifecycle" text DEFAULT 'canonical' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD COLUMN "workflow_type" "approval_workflow_type";--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD COLUMN "legacy_source_type" text;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD COLUMN "legacy_source_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD COLUMN "legacy_approval_request_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ALTER COLUMN "assignment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD CONSTRAINT "approval_delivery_work_lifecycle_check" CHECK (
	("lifecycle" = 'canonical' AND "workflow_id" IS NOT NULL
		AND "assignment_id" IS NOT NULL AND "legacy_approval_request_id" IS NULL
		AND "legacy_source_type" IS NULL AND "legacy_source_id" IS NULL)
	OR ("lifecycle" = 'legacy' AND "workflow_id" IS NULL
		AND "assignment_id" IS NULL AND "workflow_type" IS NOT NULL
		AND "legacy_source_type" IS NOT NULL AND "legacy_source_id" IS NOT NULL
		AND "legacy_approval_request_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "approval_delivery_work" ADD CONSTRAINT "approval_delivery_work_legacy_request_fk" FOREIGN KEY ("legacy_approval_request_id","organization_id") REFERENCES "approval_request"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX "approvalDeliveryWork_org_legacy_source_idx" ON "approval_delivery_work" USING btree ("organization_id","legacy_source_type","legacy_source_id") WHERE "lifecycle" = 'legacy';--> statement-breakpoint
-- Lifecycle intents of legacy-authoritative approvals, written with each
-- submission/decision while the kind has a delivery control.
CREATE TABLE "approval_delivery_intent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"workflow_type" "approval_workflow_type" NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"legacy_approval_request_id" uuid NOT NULL,
	"event" text NOT NULL,
	"expansion_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expanded_at" timestamp with time zone,
	CONSTRAINT "approval_delivery_intent_event_check" CHECK ("event" IN ('submitted', 'decided')),
	CONSTRAINT "approval_delivery_intent_expansion_check" CHECK ("expansion_status" IN ('pending', 'expanded')),
	CONSTRAINT "approval_delivery_intent_legacy_request_fk" FOREIGN KEY ("legacy_approval_request_id","organization_id") REFERENCES "approval_request"("id","organization_id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "approvalDeliveryIntent_pending_idx" ON "approval_delivery_intent" USING btree ("organization_id","created_at") WHERE expansion_status = 'pending';--> statement-breakpoint
CREATE INDEX "approvalDeliveryIntent_org_legacy_request_idx" ON "approval_delivery_intent" USING btree ("organization_id","legacy_approval_request_id");
