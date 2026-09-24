ALTER TABLE "approval_escalation_control" ADD COLUMN "escalation_owned_since" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "approval_escalation_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"operation_key" text NOT NULL,
	"initiator" text NOT NULL,
	"authority_mode" text NOT NULL,
	"workflow_type" "approval_workflow_type" NOT NULL,
	"workflow_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"source_assignment_id" uuid NOT NULL,
	"replacement_assignment_id" uuid NOT NULL,
	"lineage_root_assignment_id" uuid,
	"source_approver_employee_id" uuid NOT NULL,
	"replacement_approver_employee_id" uuid NOT NULL,
	"requester_employee_id" uuid NOT NULL,
	"actionable_at" timestamp with time zone,
	"actionable_evidence" text,
	"deadline_at" timestamp with time zone,
	"policy_revision" integer,
	"workflow_event_id" uuid NOT NULL,
	"receipt_idempotency_key" text NOT NULL,
	"receipt_actor_fingerprint" text NOT NULL,
	"receipt_command_fingerprint" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_system_id" text,
	"actor_user_id" text REFERENCES "user"("id"),
	"actor_employee_id" uuid,
	"reason" text,
	"transferred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvalEscalationTransfer_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "approvalEscalationTransfer_workflow_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "approval_workflow"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approvalEscalationTransfer_source_fk" FOREIGN KEY ("workflow_id","stage_id","source_assignment_id","organization_id") REFERENCES "approval_stage_assignment"("workflow_id","stage_id","id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approvalEscalationTransfer_replacement_fk" FOREIGN KEY ("workflow_id","stage_id","replacement_assignment_id","organization_id") REFERENCES "approval_stage_assignment"("workflow_id","stage_id","id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approvalEscalationTransfer_event_fk" FOREIGN KEY ("workflow_id","workflow_event_id","organization_id") REFERENCES "approval_workflow_event"("workflow_id","id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approvalEscalationTransfer_source_approver_fk" FOREIGN KEY ("source_approver_employee_id","organization_id") REFERENCES "employee"("id","organization_id"),
	CONSTRAINT "approvalEscalationTransfer_replacement_approver_fk" FOREIGN KEY ("replacement_approver_employee_id","organization_id") REFERENCES "employee"("id","organization_id"),
	CONSTRAINT "approvalEscalationTransfer_requester_fk" FOREIGN KEY ("requester_employee_id","organization_id") REFERENCES "employee"("id","organization_id"),
	CONSTRAINT "approvalEscalationTransfer_actor_employee_fk" FOREIGN KEY ("actor_employee_id","organization_id") REFERENCES "employee"("id","organization_id"),
	CONSTRAINT "approval_escalation_transfer_initiator_check" CHECK ("initiator" IN ('scheduled', 'human')),
	CONSTRAINT "approval_escalation_transfer_mode_check" CHECK ("authority_mode" IN ('canonical')),
	CONSTRAINT "approval_escalation_transfer_evidence_check" CHECK ("actionable_evidence" IS NULL OR "actionable_evidence" IN ('assignment_assigned_at', 'rollout_fallback')),
	CONSTRAINT "approval_escalation_transfer_actor_check" CHECK (("actor_kind" = 'system' AND "initiator" = 'scheduled' AND "actor_system_id" = 'approval-escalation' AND "actor_user_id" IS NULL AND "actor_employee_id" IS NULL) OR ("actor_kind" = 'user' AND "initiator" = 'human' AND "actor_system_id" IS NULL AND "actor_user_id" IS NOT NULL AND "actor_employee_id" IS NOT NULL)),
	CONSTRAINT "approval_escalation_transfer_deadline_check" CHECK (("initiator" = 'scheduled' AND "actionable_at" IS NOT NULL AND "actionable_evidence" IS NOT NULL AND "deadline_at" IS NOT NULL AND "policy_revision" IS NOT NULL AND "lineage_root_assignment_id" IS NOT NULL) OR ("initiator" = 'human' AND "actionable_at" IS NULL AND "actionable_evidence" IS NULL AND "deadline_at" IS NULL)),
	CONSTRAINT "approval_escalation_transfer_distinct_check" CHECK ("source_assignment_id" <> "replacement_assignment_id" AND "source_approver_employee_id" <> "replacement_approver_employee_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalEscalationTransfer_org_operation_idx" ON "approval_escalation_transfer" USING btree ("organization_id","operation_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalEscalationTransfer_org_source_idx" ON "approval_escalation_transfer" USING btree ("organization_id","source_assignment_id");
--> statement-breakpoint
CREATE INDEX "approvalEscalationTransfer_org_workflow_idx" ON "approval_escalation_transfer" USING btree ("organization_id","workflow_id");
--> statement-breakpoint
CREATE TABLE "approval_escalation_transfer_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"transfer_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expansion_status" text DEFAULT 'pending' NOT NULL,
	"expanded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvalEscalationTransferEvent_transfer_fk" FOREIGN KEY ("transfer_id","organization_id") REFERENCES "approval_escalation_transfer"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_escalation_transfer_event_type_check" CHECK ("event_type" IN ('assignment_transferred')),
	CONSTRAINT "approval_escalation_transfer_event_expansion_check" CHECK (("expansion_status" = 'pending' AND "expanded_at" IS NULL) OR ("expansion_status" = 'expanded' AND "expanded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalEscalationTransferEvent_transfer_type_idx" ON "approval_escalation_transfer_event" USING btree ("transfer_id","event_type");
--> statement-breakpoint
CREATE INDEX "approvalEscalationTransferEvent_pending_idx" ON "approval_escalation_transfer_event" USING btree ("organization_id","created_at") WHERE expansion_status = 'pending';
--> statement-breakpoint
CREATE FUNCTION "approval_escalation_transfer_reject_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'approval escalation transfers are immutable: % rows cannot be updated', TG_TABLE_NAME
		USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "approval_escalation_transfer_immutable" BEFORE UPDATE ON "approval_escalation_transfer" FOR EACH ROW EXECUTE FUNCTION "approval_escalation_transfer_reject_update"();
--> statement-breakpoint
CREATE FUNCTION "approval_escalation_transfer_event_guard_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."transfer_id" IS DISTINCT FROM OLD."transfer_id"
		OR NEW."event_type" IS DISTINCT FROM OLD."event_type"
		OR NEW."payload" IS DISTINCT FROM OLD."payload"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
		OR (OLD."expansion_status" = 'expanded' AND NEW."expansion_status" <> 'expanded') THEN
		RAISE EXCEPTION 'approval escalation transfer events are immutable except for expansion'
			USING ERRCODE = 'integrity_constraint_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "approval_escalation_transfer_event_guarded" BEFORE UPDATE ON "approval_escalation_transfer_event" FOR EACH ROW EXECUTE FUNCTION "approval_escalation_transfer_event_guard_update"();
