-- #1440 (spec #1437, Organization ADR 0006): a deactivation gets the
-- departure's consequences. `employee_deactivation` is its anchor: the
-- request-ID replay ledger of Deactivate, the owner of its approval handover
-- tasks and reviews, the reactivation checklist source (#1441) and the
-- backfill's idempotency marker (#1442). Departure rows are untouched: a
-- departure keeps `departure_id`, a deactivation's follow-up work carries
-- `deactivation_id` instead.
CREATE TABLE IF NOT EXISTS "employee_deactivation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"employment_period_id" uuid,
	"deactivated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"reason" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"result" jsonb,
	"replacement_managers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"applied" jsonb,
	"reactivated_at" timestamp with time zone,
	"reactivated_by" text,
	"reactivation_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employeeDeactivation_id_org_employee_unique" UNIQUE("id","organization_id","employee_id"),
	CONSTRAINT "employeeDeactivation_reason_check" CHECK (reason IN ('employee_deactivated', 'employee_deactivation_backfill')),
	CONSTRAINT "employeeDeactivation_reactivation_check" CHECK (reactivated_at IS NOT NULL OR (reactivated_by IS NULL AND reactivation_request_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "employee_deactivation" ADD CONSTRAINT "employee_deactivation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_deactivation" ADD CONSTRAINT "employeeDeactivation_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_deactivation" ADD CONSTRAINT "employeeDeactivation_period_fk" FOREIGN KEY ("employment_period_id","organization_id","employee_id") REFERENCES "public"."employee_employment_period"("id","organization_id","employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "employeeDeactivation_request_idx" ON "employee_deactivation" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDeactivation_employee_idx" ON "employee_deactivation" USING btree ("organization_id","employee_id");--> statement-breakpoint
-- Employment-history events of a deactivation without a departure.
ALTER TABLE "employee_departure_event" DROP CONSTRAINT IF EXISTS "employeeDepartureEvent_kind_check";--> statement-breakpoint
ALTER TABLE "employee_departure_event" ADD CONSTRAINT "employeeDepartureEvent_kind_check" CHECK (kind IN ('departure_scheduled', 'departure_rescheduled', 'departure_canceled', 'departure_superseded', 'departure_blocked', 'departure_effective', 'employee_rehired', 'review_resolved', 'task_failed', 'replacement_assigned', 'employee_deactivated', 'employee_reactivated'));--> statement-breakpoint
-- Follow-up tasks: at most one anchor (rehire billing work has none).
ALTER TABLE "employee_departure_task" ADD COLUMN IF NOT EXISTS "deactivation_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_departure_task" ADD CONSTRAINT "employeeDepartureTask_deactivation_fk" FOREIGN KEY ("deactivation_id","organization_id","employee_id") REFERENCES "public"."employee_deactivation"("id","organization_id","employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_task" ADD CONSTRAINT "employeeDepartureTask_one_anchor_check" CHECK (departure_id IS NULL OR deactivation_id IS NULL);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDepartureTask_deactivation_idx" ON "employee_departure_task" USING btree ("organization_id","deactivation_id") WHERE deactivation_id IS NOT NULL;--> statement-breakpoint
-- Reviews: exactly one anchor. The other anchor column is always NULL, so the
-- NULLS NOT DISTINCT key still allows one review per anchor, kind and subject.
ALTER TABLE "employee_departure_review" ADD COLUMN IF NOT EXISTS "deactivation_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_departure_review" ALTER COLUMN "departure_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_departure_review" ADD CONSTRAINT "employeeDepartureReview_deactivation_fk" FOREIGN KEY ("deactivation_id","organization_id","employee_id") REFERENCES "public"."employee_deactivation"("id","organization_id","employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_review" ADD CONSTRAINT "employeeDepartureReview_one_anchor_check" CHECK ((departure_id IS NULL) <> (deactivation_id IS NULL));--> statement-breakpoint
ALTER TABLE "employee_departure_review" DROP CONSTRAINT IF EXISTS "employeeDepartureReview_subject_unique";--> statement-breakpoint
ALTER TABLE "employee_departure_review" ADD CONSTRAINT "employeeDepartureReview_anchor_subject_unique" UNIQUE NULLS NOT DISTINCT("organization_id","departure_id","deactivation_id","kind","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "employeeDepartureReview_deactivation_idx" ON "employee_departure_review" USING btree ("organization_id","deactivation_id") WHERE deactivation_id IS NOT NULL;
