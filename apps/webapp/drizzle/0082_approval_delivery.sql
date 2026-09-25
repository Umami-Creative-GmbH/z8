-- #291: one durable owner for approval-card delivery. No control row keeps the
-- existing notification path for every organization.
CREATE TABLE "approval_delivery_control" (
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"workflow_type" "approval_workflow_type" NOT NULL,
	"provider" text NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_delivery_control_pk" PRIMARY KEY("organization_id","workflow_type","provider"),
	CONSTRAINT "approval_delivery_control_provider_check" CHECK ("provider" IN ('telegram'))
);
--> statement-breakpoint
-- Every actual remote approval message, with complete destination and binding
-- identity. Duplicates and late sends each get their own row.
CREATE TABLE "approval_delivery_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"workflow_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"approval_request_id" uuid,
	"recipient_employee_id" uuid NOT NULL,
	"recipient_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"provider" text NOT NULL,
	"receiver_scope" text NOT NULL,
	"destination_id" text NOT NULL,
	"remote_message_id" text NOT NULL,
	"binding_id" uuid,
	"origin_work_id" uuid,
	"controls" text NOT NULL,
	"state" text DEFAULT 'current' NOT NULL,
	"status_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvalDeliveryMessage_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "approval_delivery_message_provider_check" CHECK ("provider" IN ('telegram')),
	CONSTRAINT "approval_delivery_message_controls_check" CHECK ("controls" IN ('actionable', 'none')),
	CONSTRAINT "approval_delivery_message_state_check" CHECK ("state" IN ('current', 'retired', 'gone')),
	CONSTRAINT "approval_delivery_message_workflow_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "approval_workflow"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_delivery_message_assignment_fk" FOREIGN KEY ("assignment_id","organization_id") REFERENCES "approval_stage_assignment"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_delivery_message_binding_fk" FOREIGN KEY ("binding_id","organization_id") REFERENCES "approval_review_binding"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_delivery_message_recipient_fk" FOREIGN KEY ("recipient_employee_id","organization_id") REFERENCES "employee"("id","organization_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalDeliveryMessage_remote_identity_idx" ON "approval_delivery_message" USING btree ("organization_id","provider","receiver_scope","destination_id","remote_message_id");
--> statement-breakpoint
CREATE INDEX "approvalDeliveryMessage_org_workflow_idx" ON "approval_delivery_message" USING btree ("organization_id","workflow_id");
--> statement-breakpoint
-- One logical delivery effect per row, leased by workers and completed only
-- while the lease token still holds.
CREATE TABLE "approval_delivery_work" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"outbox_id" uuid,
	"workflow_id" uuid NOT NULL,
	"effect" text NOT NULL,
	"provider" text NOT NULL,
	"assignment_id" uuid NOT NULL,
	"recipient_employee_id" uuid NOT NULL,
	"message_id" uuid,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_outcome" text,
	"last_attempt_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_delivery_work_provider_check" CHECK ("provider" IN ('telegram')),
	CONSTRAINT "approval_delivery_work_effect_check" CHECK (("effect" = 'initial' AND "message_id" IS NULL) OR ("effect" = 'refresh' AND "message_id" IS NOT NULL)),
	CONSTRAINT "approval_delivery_work_status_check" CHECK ("status" IN ('pending', 'processing', 'delivered', 'suppressed', 'cancelled', 'awaiting_repair', 'exhausted', 'failed')),
	CONSTRAINT "approval_delivery_work_outbox_fk" FOREIGN KEY ("outbox_id","organization_id") REFERENCES "approval_outbox"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_delivery_work_workflow_fk" FOREIGN KEY ("workflow_id","organization_id") REFERENCES "approval_workflow"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_delivery_work_assignment_fk" FOREIGN KEY ("assignment_id","organization_id") REFERENCES "approval_stage_assignment"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_delivery_work_message_fk" FOREIGN KEY ("message_id","organization_id") REFERENCES "approval_delivery_message"("id","organization_id") ON DELETE CASCADE,
	CONSTRAINT "approval_delivery_work_recipient_fk" FOREIGN KEY ("recipient_employee_id","organization_id") REFERENCES "employee"("id","organization_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalDeliveryWork_org_dedupe_idx" ON "approval_delivery_work" USING btree ("organization_id","dedupe_key");
--> statement-breakpoint
CREATE INDEX "approvalDeliveryWork_org_workflow_idx" ON "approval_delivery_work" USING btree ("organization_id","workflow_id");
--> statement-breakpoint
CREATE INDEX "approvalDeliveryWork_due_idx" ON "approval_delivery_work" USING btree ("organization_id","available_at") WHERE status IN ('pending', 'processing');
