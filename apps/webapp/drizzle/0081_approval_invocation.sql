-- #290: actionable bot cards are admitted per organization/kind/provider. No
-- row keeps every card review-only. Slack has no established per-invocation
-- identity and can never be admitted.
CREATE TABLE "approval_presentation_control" (
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"workflow_type" "approval_workflow_type" NOT NULL,
	"provider" text NOT NULL,
	"mode" text DEFAULT 'review_only' NOT NULL,
	CONSTRAINT "approval_presentation_control_pk" PRIMARY KEY("organization_id","workflow_type","provider"),
	CONSTRAINT "approval_presentation_control_provider_check" CHECK ("provider" IN ('telegram', 'discord', 'teams', 'slack')),
	CONSTRAINT "approval_presentation_control_mode_check" CHECK ("mode" IN ('review_only', 'actionable')),
	CONSTRAINT "approval_presentation_control_slack_check" CHECK (NOT ("provider" = 'slack' AND "mode" = 'actionable'))
);
--> statement-breakpoint
ALTER TABLE "approval_decision_evidence" ADD CONSTRAINT "approvalDecisionEvidence_id_workflow_organizationId_idx" UNIQUE("id","workflow_id","organization_id");
--> statement-breakpoint
-- One authenticated provider invocation, the bound command it carried and the
-- decision it committed, written in the decision transaction. Immutable.
CREATE TABLE "approval_invocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"scheme" text NOT NULL,
	"scheme_version" integer NOT NULL,
	"receiver_scope" text NOT NULL,
	"invocation_id" text NOT NULL,
	"delivery_id" text,
	"provider_actor_id" text NOT NULL,
	"actor_employee_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL REFERENCES "user"("id"),
	"workflow_id" uuid NOT NULL,
	"reviewed_binding_id" uuid NOT NULL,
	"action" text NOT NULL,
	"command_fingerprint" text NOT NULL,
	"receipt_idempotency_key" text NOT NULL,
	"decision_evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_invocation_scheme_check" CHECK ("scheme" IN ('telegram_callback_query') AND "scheme_version" = 1),
	CONSTRAINT "approval_invocation_action_check" CHECK ("action" IN ('approve', 'reject')),
	CONSTRAINT "approval_invocation_workflow_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "approval_workflow"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_invocation_binding_fk" FOREIGN KEY ("reviewed_binding_id","organization_id") REFERENCES "approval_review_binding"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_invocation_decision_fk" FOREIGN KEY ("decision_evidence_id","workflow_id","organization_id") REFERENCES "approval_decision_evidence"("id","workflow_id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_invocation_actor_fk" FOREIGN KEY ("actor_employee_id","organization_id") REFERENCES "employee"("id","organization_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalInvocation_org_identity_idx" ON "approval_invocation" USING btree ("organization_id","scheme","receiver_scope","invocation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalInvocation_org_workflow_receipt_idx" ON "approval_invocation" USING btree ("organization_id","workflow_id","receipt_idempotency_key");
--> statement-breakpoint
CREATE INDEX "approvalInvocation_org_workflow_idx" ON "approval_invocation" USING btree ("organization_id","workflow_id");
--> statement-breakpoint
CREATE TRIGGER "approval_invocation_immutable" BEFORE UPDATE ON "approval_invocation" FOR EACH ROW EXECUTE FUNCTION "approval_evidence_reject_update"();
