-- Period submissions (#1059, spec #805): the canonical-only approval kind and
-- its source. The new enum value is only added here: a value added with ADD VALUE
-- cannot be used before the batch's transaction commits, and this migration never
-- uses it. Existing organizations need no rollout row: a missing row resolves to
-- `complete` for a canonical-only kind, and the first write gate inserts it (#1058).
ALTER TYPE "public"."approval_workflow_type" ADD VALUE IF NOT EXISTS 'period_submission';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "period_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"cadence" text NOT NULL,
	"week_start_day" text,
	"timezone" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"cadence_start_date" date NOT NULL,
	"cadence_end_date" date NOT NULL,
	"range_start" timestamp with time zone NOT NULL,
	"range_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approval_workflow_id" uuid,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_employee_id" uuid,
	"decision_reason" text,
	"closed_at" timestamp with time zone,
	"closed_cause" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_submission_id_organization_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "period_submission_cadence_check" CHECK (cadence IN ('weekly', 'monthly') AND (week_start_day IS NULL OR week_start_day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')) AND ((cadence = 'weekly') = (week_start_day IS NOT NULL))),
	CONSTRAINT "period_submission_range_check" CHECK ("period_submission"."end_date" >= "period_submission"."start_date" AND "period_submission"."start_date" >= "period_submission"."cadence_start_date" AND "period_submission"."end_date" <= "period_submission"."cadence_end_date" AND "period_submission"."range_end" > "period_submission"."range_start"),
	CONSTRAINT "period_submission_status_check" CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'outdated')),
	CONSTRAINT "period_submission_closed_cause_check" CHECK (closed_cause IS NULL OR closed_cause IN ('employee', 'change')),
	CONSTRAINT "period_submission_lifecycle_check" CHECK ((status = 'pending' AND decided_at IS NULL AND closed_at IS NULL AND closed_cause IS NULL)
				OR (status = 'approved' AND decided_at IS NOT NULL AND closed_at IS NULL AND closed_cause IS NULL)
				OR (status = 'rejected' AND decided_at IS NOT NULL AND decision_reason IS NOT NULL AND closed_at IS NULL AND closed_cause IS NULL)
				OR (status = 'withdrawn' AND decided_at IS NULL AND closed_at IS NOT NULL AND closed_cause IS NOT NULL)
				OR (status = 'outdated' AND decided_at IS NOT NULL AND closed_at IS NOT NULL AND closed_cause = 'change')),
	CONSTRAINT "period_submission_revision_check" CHECK ("period_submission"."revision" >= 1)
);--> statement-breakpoint
ALTER TABLE "period_submission" ADD CONSTRAINT "period_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_submission" ADD CONSTRAINT "period_submission_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_submission" ADD CONSTRAINT "period_submission_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_submission" ADD CONSTRAINT "period_submission_approval_workflow_fk" FOREIGN KEY ("approval_workflow_id","organization_id") REFERENCES "public"."approval_workflow"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "period_submission_live_idx" ON "period_submission" USING btree ("organization_id","employee_id","start_date") WHERE status IN ('pending', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "period_submission_workflow_idx" ON "period_submission" USING btree ("organization_id","approval_workflow_id") WHERE approval_workflow_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "period_submission_employee_idx" ON "period_submission" USING btree ("organization_id","employee_id","start_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "period_submission_cadence_period_idx" ON "period_submission" USING btree ("organization_id","cadence_start_date");
