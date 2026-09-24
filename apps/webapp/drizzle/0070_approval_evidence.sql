CREATE TABLE "approval_evidence_control" (
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"workflow_type" "approval_workflow_type" NOT NULL,
	"mode" text DEFAULT 'inactive' NOT NULL,
	CONSTRAINT "approval_evidence_control_organization_id_workflow_type_pk" PRIMARY KEY("organization_id","workflow_type"),
	CONSTRAINT "approval_evidence_control_mode_check" CHECK ("mode" IN ('inactive', 'capture'))
);
--> statement-breakpoint
CREATE TABLE "approval_submitted_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"workflow_id" uuid NOT NULL,
	"workflow_type" "approval_workflow_type" NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"request_cycle_key" text NOT NULL,
	"revision" integer NOT NULL,
	"subject_employee_id" uuid NOT NULL,
	"requester_employee_id" uuid NOT NULL,
	"submitter_actor_kind" "approval_actor_kind" NOT NULL,
	"submitter_employee_id" uuid,
	"submitter_user_id" text REFERENCES "user"("id"),
	"schema_version" integer NOT NULL,
	"material_fingerprint" text NOT NULL,
	"facts" jsonb NOT NULL,
	"labels" jsonb NOT NULL,
	"provenance" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvalSubmittedRevision_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "approvalSubmittedRevision_id_workflow_organizationId_idx" UNIQUE("id","workflow_id","organization_id"),
	CONSTRAINT "approval_submitted_revision_revision_check" CHECK ("revision" >= 1),
	CONSTRAINT "approval_submitted_revision_workflow_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "approval_workflow"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_submitted_revision_subject_fk" FOREIGN KEY ("subject_employee_id","organization_id") REFERENCES "employee"("id","organization_id"),
	CONSTRAINT "approval_submitted_revision_requester_fk" FOREIGN KEY ("requester_employee_id","organization_id") REFERENCES "employee"("id","organization_id"),
	CONSTRAINT "approval_submitted_revision_submitter_fk" FOREIGN KEY ("submitter_employee_id","organization_id") REFERENCES "employee"("id","organization_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalSubmittedRevision_org_workflow_revision_idx" ON "approval_submitted_revision" USING btree ("organization_id","workflow_id","revision");
--> statement-breakpoint
CREATE TABLE "approval_review_binding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"recipient_employee_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"submitted_revision_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvalReviewBinding_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "approval_review_binding_assignment_fk" FOREIGN KEY ("workflow_id","stage_id","assignment_id","organization_id") REFERENCES "approval_stage_assignment"("workflow_id","stage_id","id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_review_binding_revision_fk" FOREIGN KEY ("submitted_revision_id","workflow_id","organization_id") REFERENCES "approval_submitted_revision"("id","workflow_id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_review_binding_recipient_fk" FOREIGN KEY ("recipient_employee_id","organization_id") REFERENCES "employee"("id","organization_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalReviewBinding_org_recipient_assignment_revision_idx" ON "approval_review_binding" USING btree ("organization_id","recipient_employee_id","assignment_id","submitted_revision_id");
--> statement-breakpoint
CREATE TABLE "approval_decision_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"workflow_id" uuid NOT NULL,
	"submitted_revision_id" uuid NOT NULL,
	"operation_kind" text NOT NULL,
	"receipt_idempotency_key" text NOT NULL,
	"receipt_actor_fingerprint" text NOT NULL,
	"receipt_command_fingerprint" text NOT NULL,
	"action" text NOT NULL,
	"stage_id" uuid,
	"assignment_id" uuid,
	"assignment_outcome" text,
	"request_outcome" "approval_workflow_status" NOT NULL,
	"actor_kind" "approval_actor_kind" NOT NULL,
	"actor_employee_id" uuid,
	"actor_user_id" text REFERENCES "user"("id"),
	"decided_at" timestamp with time zone NOT NULL,
	"event_ids" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"labels" jsonb NOT NULL,
	"reviewed_binding_id" uuid,
	"schema_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decision_evidence_operation_kind_check" CHECK ("operation_kind" IN ('command', 'submission_activation')),
	CONSTRAINT "approval_decision_evidence_action_check" CHECK ("action" IN ('approve', 'reject')),
	CONSTRAINT "approval_decision_evidence_assignment_outcome_check" CHECK ("assignment_outcome" IS NULL OR "assignment_outcome" IN ('approved', 'rejected')),
	CONSTRAINT "approval_decision_evidence_workflow_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "approval_workflow"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_decision_evidence_revision_fk" FOREIGN KEY ("submitted_revision_id","workflow_id","organization_id") REFERENCES "approval_submitted_revision"("id","workflow_id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_decision_evidence_binding_fk" FOREIGN KEY ("reviewed_binding_id","organization_id") REFERENCES "approval_review_binding"("id","organization_id"),
	CONSTRAINT "approval_decision_evidence_actor_fk" FOREIGN KEY ("actor_employee_id","organization_id") REFERENCES "employee"("id","organization_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalDecisionEvidence_org_workflow_receipt_idx" ON "approval_decision_evidence" USING btree ("organization_id","workflow_id","receipt_idempotency_key");
--> statement-breakpoint
CREATE INDEX "approvalDecisionEvidence_org_revision_idx" ON "approval_decision_evidence" USING btree ("organization_id","submitted_revision_id");
--> statement-breakpoint
CREATE FUNCTION "approval_evidence_reject_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'approval evidence is immutable: % rows cannot be updated', TG_TABLE_NAME
		USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "approval_submitted_revision_immutable" BEFORE UPDATE ON "approval_submitted_revision" FOR EACH ROW EXECUTE FUNCTION "approval_evidence_reject_update"();
--> statement-breakpoint
CREATE TRIGGER "approval_review_binding_immutable" BEFORE UPDATE ON "approval_review_binding" FOR EACH ROW EXECUTE FUNCTION "approval_evidence_reject_update"();
--> statement-breakpoint
CREATE TRIGGER "approval_decision_evidence_immutable" BEFORE UPDATE ON "approval_decision_evidence" FOR EACH ROW EXECUTE FUNCTION "approval_evidence_reject_update"();
