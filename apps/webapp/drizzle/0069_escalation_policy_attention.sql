ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'approval_escalation_attention';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_escalation_policy" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"response_window_hours" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"migrated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"migration_provenance" jsonb NOT NULL,
	"conflict_review_status" text DEFAULT 'none' NOT NULL,
	"conflict_reviewed_by_user_id" text,
	"conflict_reviewed_at" timestamp with time zone,
	"updated_by_user_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_escalation_policy_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_escalation_policy_conflict_reviewed_by_user_id_user_id_fk" FOREIGN KEY ("conflict_reviewed_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "approval_escalation_policy_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "approval_escalation_policy_window_check" CHECK ("response_window_hours" >= 1),
	CONSTRAINT "approval_escalation_policy_revision_check" CHECK ("revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_escalation_policy_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"revision" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"response_window_hours" integer NOT NULL,
	"origin" text NOT NULL,
	"changed_by_user_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvalEscalationPolicyRevision_org_revision_idx" UNIQUE("organization_id","revision"),
	CONSTRAINT "approvalEscalationPolicyRevision_policy_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."approval_escalation_policy"("organization_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_escalation_policy_revision_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "approval_escalation_policy_revision_origin_check" CHECK ("origin" IN ('migration', 'management_edit'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_escalation_attention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"approval_type" text,
	"approval_request_id" uuid,
	"workflow_id" uuid,
	"assignment_id" uuid,
	"lineage_root_assignment_id" uuid,
	"current_approver_employee_id" uuid,
	"delivery_channel" text,
	"evidence" jsonb NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_revision" integer,
	"first_raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observation_count" integer DEFAULT 1 NOT NULL,
	"last_rechecked_at" timestamp with time zone,
	"admin_alerted_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closure_note" text,
	"disposed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvalEscalationAttention_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "approval_escalation_attention_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approvalEscalationAttention_approver_fk" FOREIGN KEY ("current_approver_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "approval_escalation_attention_disposed_by_user_id_user_id_fk" FOREIGN KEY ("disposed_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "approval_escalation_attention_status_check" CHECK ("status" IN ('open', 'resolved', 'disposed')),
	CONSTRAINT "approval_escalation_attention_closure_check" CHECK (("status" = 'open') = ("closed_at" IS NULL)),
	CONSTRAINT "approval_escalation_attention_disposal_check" CHECK (("status" = 'disposed') = ("disposed_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "approvalEscalationAttention_open_dedupe_idx" ON "approval_escalation_attention" USING btree ("organization_id","dedupe_key") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalEscalationAttention_org_status_idx" ON "approval_escalation_attention" USING btree ("organization_id","status","last_observed_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_escalation_attention_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attention_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" text,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvalEscalationAttentionEvent_attention_fk" FOREIGN KEY ("attention_id","organization_id") REFERENCES "public"."approval_escalation_attention"("id","organization_id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "approval_escalation_attention_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "approval_escalation_attention_event_actor_check" CHECK (("actor_kind" = 'user') = ("actor_user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvalEscalationAttentionEvent_attention_idx" ON "approval_escalation_attention_event" USING btree ("attention_id","created_at");
