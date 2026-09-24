CREATE TABLE "employee_departure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"employment_period_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"last_working_day" date,
	"timezone" text NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"replacement_employee_id" uuid,
	"acknowledge_unassigned_duties" boolean DEFAULT false NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"request_id" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"clock_out_action_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"effective_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employeeDeparture_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "employeeDeparture_identity_unique" UNIQUE("id","organization_id","employee_id","employment_period_id"),
	CONSTRAINT "employeeDeparture_mode_check" CHECK (mode IN ('scheduled', 'immediate')),
	CONSTRAINT "employeeDeparture_status_check" CHECK (status IN ('pending', 'canceled', 'blocked', 'effective')),
	CONSTRAINT "employeeDeparture_revision_check" CHECK (revision > 0),
	CONSTRAINT "employeeDeparture_scheduled_day_check" CHECK (mode <> 'scheduled' OR last_working_day IS NOT NULL),
	CONSTRAINT "employeeDeparture_effective_at_check" CHECK ((status = 'effective') = (effective_at IS NOT NULL)),
	CONSTRAINT "employeeDeparture_blocked_reason_check" CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL),
	CONSTRAINT "employeeDeparture_replacement_check" CHECK (replacement_employee_id IS NULL OR replacement_employee_id <> employee_id)
);
--> statement-breakpoint
CREATE TABLE "employee_departure_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"departure_id" uuid,
	"employment_period_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"event_index" integer DEFAULT 0 NOT NULL,
	"revision" integer,
	"kind" text NOT NULL,
	"actor_user_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_fingerprint" text,
	"result" jsonb,
	CONSTRAINT "employeeDepartureEvent_kind_check" CHECK (kind IN ('departure_scheduled', 'departure_rescheduled', 'departure_canceled', 'departure_superseded', 'departure_blocked', 'departure_effective', 'employee_rehired', 'review_resolved', 'task_failed', 'replacement_assigned')),
	CONSTRAINT "employeeDepartureEvent_index_check" CHECK (event_index >= 0)
);
--> statement-breakpoint
CREATE TABLE "employee_departure_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"employment_period_id" uuid NOT NULL,
	"departure_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"affected_start_at" timestamp with time zone,
	"affected_end_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employeeDepartureReview_subject_unique" UNIQUE NULLS NOT DISTINCT("organization_id","departure_id","kind","subject_id"),
	CONSTRAINT "employeeDepartureReview_kind_check" CHECK (kind IN ('clock_out', 'clock_repair', 'approval_handover', 'future_work', 'employment_terms')),
	CONSTRAINT "employeeDepartureReview_status_check" CHECK (status IN ('open', 'resolved')),
	CONSTRAINT "employeeDepartureReview_resolution_check" CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
	CONSTRAINT "employeeDepartureReview_affected_range_check" CHECK (affected_start_at IS NULL OR affected_end_at IS NULL OR affected_end_at >= affected_start_at)
);
--> statement-breakpoint
CREATE TABLE "employee_departure_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"employment_period_id" uuid NOT NULL,
	"departure_id" uuid,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employeeDepartureTask_kind_check" CHECK (kind IN ('dispatch_departure', 'session_revocation', 'billing_sync', 'clock_postprocess', 'notify_review', 'clock_repair', 'approval_handover')),
	CONSTRAINT "employeeDepartureTask_status_check" CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "employeeDepartureTask_attempt_check" CHECK (attempt_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "employee_employment_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"start_provenance" text NOT NULL,
	"legacy_diagnostic" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "employeeEmploymentPeriod_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "employeeEmploymentPeriod_id_org_employee_unique" UNIQUE("id","organization_id","employee_id"),
	CONSTRAINT "employeeEmploymentPeriod_status_check" CHECK (status IN ('open', 'closed', 'legacy_unknown')),
	CONSTRAINT "employeeEmploymentPeriod_start_provenance_check" CHECK (start_provenance IN ('recorded', 'legacy', 'unknown')),
	CONSTRAINT "employeeEmploymentPeriod_unknown_start_check" CHECK ((start_provenance = 'unknown') = (started_at IS NULL)),
	CONSTRAINT "employeeEmploymentPeriod_interval_check" CHECK (started_at IS NULL OR ended_at IS NULL OR ended_at >= started_at),
	CONSTRAINT "employeeEmploymentPeriod_closed_end_check" CHECK (status <> 'closed' OR ended_at IS NOT NULL),
	CONSTRAINT "employeeEmploymentPeriod_open_end_check" CHECK (status <> 'open' OR ended_at IS NULL)
);
--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD COLUMN "employment_period_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_departure" ADD CONSTRAINT "employee_departure_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure" ADD CONSTRAINT "employee_departure_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure" ADD CONSTRAINT "employeeDeparture_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure" ADD CONSTRAINT "employeeDeparture_period_fk" FOREIGN KEY ("employment_period_id","organization_id","employee_id") REFERENCES "public"."employee_employment_period"("id","organization_id","employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure" ADD CONSTRAINT "employeeDeparture_replacement_fk" FOREIGN KEY ("replacement_employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_event" ADD CONSTRAINT "employee_departure_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_event" ADD CONSTRAINT "employeeDepartureEvent_period_fk" FOREIGN KEY ("employment_period_id","organization_id","employee_id") REFERENCES "public"."employee_employment_period"("id","organization_id","employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_event" ADD CONSTRAINT "employeeDepartureEvent_departure_fk" FOREIGN KEY ("departure_id","organization_id","employee_id","employment_period_id") REFERENCES "public"."employee_departure"("id","organization_id","employee_id","employment_period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_review" ADD CONSTRAINT "employee_departure_review_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_review" ADD CONSTRAINT "employee_departure_review_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_review" ADD CONSTRAINT "employeeDepartureReview_departure_fk" FOREIGN KEY ("departure_id","organization_id","employee_id","employment_period_id") REFERENCES "public"."employee_departure"("id","organization_id","employee_id","employment_period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_task" ADD CONSTRAINT "employee_departure_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_task" ADD CONSTRAINT "employeeDepartureTask_period_fk" FOREIGN KEY ("employment_period_id","organization_id","employee_id") REFERENCES "public"."employee_employment_period"("id","organization_id","employee_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_departure_task" ADD CONSTRAINT "employeeDepartureTask_departure_fk" FOREIGN KEY ("departure_id","organization_id","employee_id","employment_period_id") REFERENCES "public"."employee_departure"("id","organization_id","employee_id","employment_period_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_employment_period" ADD CONSTRAINT "employee_employment_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_employment_period" ADD CONSTRAINT "employee_employment_period_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_employment_period" ADD CONSTRAINT "employeeEmploymentPeriod_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employeeDeparture_one_pending_idx" ON "employee_departure" USING btree ("organization_id","employee_id") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "employeeDeparture_request_idx" ON "employee_departure" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE INDEX "employeeDeparture_due_idx" ON "employee_departure" USING btree ("cutoff_at","organization_id","id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "employeeDeparture_employee_idx" ON "employee_departure" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employeeDepartureEvent_request_idx" ON "employee_departure_event" USING btree ("organization_id","request_id","event_index");--> statement-breakpoint
CREATE INDEX "employeeDepartureEvent_employee_idx" ON "employee_departure_event" USING btree ("organization_id","employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "employeeDepartureReview_open_idx" ON "employee_departure_review" USING btree ("organization_id","employee_id") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "employeeDepartureTask_dedupe_idx" ON "employee_departure_task" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "employeeDepartureTask_due_idx" ON "employee_departure_task" USING btree ("available_at","id") WHERE status IN ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "employeeDepartureTask_departure_idx" ON "employee_departure_task" USING btree ("organization_id","departure_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employeeEmploymentPeriod_one_open_idx" ON "employee_employment_period" USING btree ("organization_id","employee_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "employeeEmploymentPeriod_employee_idx" ON "employee_employment_period" USING btree ("organization_id","employee_id");--> statement-breakpoint
ALTER TABLE "employee_employment_history" ADD CONSTRAINT "employeeEmploymentHistory_period_fk" FOREIGN KEY ("employment_period_id","organization_id","employee_id") REFERENCES "public"."employee_employment_period"("id","organization_id","employee_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employeeEmploymentHistory_period_idx" ON "employee_employment_history" USING btree ("organization_id","employment_period_id");--> statement-breakpoint
-- Known employment intervals of one employee must not intersect. Intervals are
-- half-open, so a new period may start exactly at the previous end. Periods with
-- unknown legacy bounds are excluded rather than asserted against invented dates.
-- The per-employee advisory lock is the canonical clocking/lifecycle key, which
-- serializes concurrent period writers for the same employee.
CREATE OR REPLACE FUNCTION "employee_employment_period_guard_overlap"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	-- Inverted intervals are reported by the interval check constraint.
	IF NEW.status NOT IN ('open', 'closed')
		OR NEW.started_at IS NULL
		OR NEW.ended_at < NEW.started_at THEN
		RETURN NEW;
	END IF;

	PERFORM pg_advisory_xact_lock(hashtextextended(NEW.employee_id::text, 0));

	IF EXISTS (
		SELECT 1
		FROM public."employee_employment_period" AS "other"
		WHERE "other"."organization_id" = NEW.organization_id
			AND "other"."employee_id" = NEW.employee_id
			AND "other"."id" <> NEW.id
			AND "other"."status" IN ('open', 'closed')
			AND "other"."started_at" IS NOT NULL
			AND tstzrange("other"."started_at", COALESCE("other"."ended_at", 'infinity'::timestamptz), '[)')
				&& tstzrange(NEW.started_at, COALESCE(NEW.ended_at, 'infinity'::timestamptz), '[)')
	) THEN
		RAISE EXCEPTION USING
			ERRCODE = '23P01',
			MESSAGE = 'Employment periods of one employee must not overlap';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "employee_employment_period_guard_overlap_trigger"
	BEFORE INSERT OR UPDATE OF "status", "started_at", "ended_at", "employee_id", "organization_id"
	ON "employee_employment_period"
	FOR EACH ROW EXECUTE FUNCTION "employee_employment_period_guard_overlap"();
--> statement-breakpoint
-- Departure audit events are append-only. Deletion is permitted only as part
-- of a cascade from an already-deleted tenant, employee or employment period.
CREATE OR REPLACE FUNCTION "employee_departure_event_guard_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' AND (
		NOT EXISTS (SELECT 1 FROM public."organization" WHERE "id" = OLD.organization_id)
		OR NOT EXISTS (
			SELECT 1 FROM public."employee_employment_period"
			WHERE "id" = OLD.employment_period_id AND "organization_id" = OLD.organization_id
		)
	) THEN
		RETURN OLD;
	END IF;

	RAISE EXCEPTION USING
		ERRCODE = '55000',
		MESSAGE = 'Employee departure events are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "employee_departure_event_guard_append_only_trigger"
	BEFORE UPDATE OR DELETE ON "employee_departure_event"
	FOR EACH ROW EXECUTE FUNCTION "employee_departure_event_guard_append_only"();
--> statement-breakpoint
-- Gives each employee without an employment period one provenance-marked legacy
-- period and attaches that employee's unlinked terms history to it. Known dates
-- come only from employee.start_date/end_date or the earliest confirmed terms;
-- nothing is invented. Existing term dates are never modified. Idempotent: an
-- employee that already has any period is left untouched. Legacy employee
-- timestamps are stored as UTC wall time, hence AT TIME ZONE 'UTC'.
CREATE OR REPLACE FUNCTION "employee_employment_period_backfill_legacy"(
	p_organization_id text DEFAULT NULL,
	p_employee_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
	inserted_count integer;
BEGIN
	WITH "candidate" AS (
		SELECT
			e."id" AS employee_id,
			e."organization_id",
			e."is_active",
			COALESCE(
				e."start_date" AT TIME ZONE 'UTC',
				(
					SELECT min(h."valid_from") AT TIME ZONE 'UTC'
					FROM public."employee_employment_history" AS h
					WHERE h."organization_id" = e."organization_id"
						AND h."employee_id" = e."id"
						AND h."review_state" = 'confirmed'
				)
			) AS known_start,
			e."end_date" AT TIME ZONE 'UTC' AS known_end
		FROM public."employee" AS e
		WHERE (p_organization_id IS NULL OR e."organization_id" = p_organization_id)
			AND (p_employee_id IS NULL OR e."id" = p_employee_id)
			AND NOT EXISTS (
				SELECT 1 FROM public."employee_employment_period" AS p
				WHERE p."organization_id" = e."organization_id" AND p."employee_id" = e."id"
			)
	), "classified" AS (
		SELECT
			c.*,
			(
				NOT c."is_active"
				AND c.known_end IS NOT NULL
				AND (c.known_start IS NULL OR c.known_end >= c.known_start)
			) AS has_trusted_end,
			(
				c.known_start IS NOT NULL
				AND c.known_end IS NOT NULL
				AND c.known_end < c.known_start
			) AS is_inverted
		FROM "candidate" AS c
	), "inserted" AS (
		INSERT INTO public."employee_employment_period"
			("organization_id", "employee_id", "status", "started_at", "ended_at",
			 "start_provenance", "legacy_diagnostic")
		SELECT
			k."organization_id",
			k.employee_id,
			CASE
				WHEN k."is_active" THEN 'open'
				WHEN k.has_trusted_end THEN 'closed'
				ELSE 'legacy_unknown'
			END,
			k.known_start,
			CASE WHEN k.has_trusted_end THEN k.known_end END,
			CASE WHEN k.known_start IS NULL THEN 'unknown' ELSE 'legacy' END,
			CASE WHEN NOT k."is_active" AND k.is_inverted THEN 'end_before_start' END
		FROM "classified" AS k
		RETURNING 1
	)
	SELECT count(*)::integer INTO inserted_count FROM "inserted";

	-- Attach unlinked terms only where the employee's sole period is legacy, so
	-- terms are never assigned to a later stint by guesswork.
	UPDATE public."employee_employment_history" AS h
	SET "employment_period_id" = p."id"
	FROM public."employee_employment_period" AS p
	WHERE h."employment_period_id" IS NULL
		AND p."organization_id" = h."organization_id"
		AND p."employee_id" = h."employee_id"
		AND p."start_provenance" IN ('legacy', 'unknown')
		AND (p_organization_id IS NULL OR h."organization_id" = p_organization_id)
		AND (p_employee_id IS NULL OR h."employee_id" = p_employee_id)
		AND NOT EXISTS (
			SELECT 1 FROM public."employee_employment_period" AS other
			WHERE other."organization_id" = p."organization_id"
				AND other."employee_id" = p."employee_id"
				AND other."id" <> p."id"
		);

	RETURN inserted_count;
END;
$$;
--> statement-breakpoint
SELECT "employee_employment_period_backfill_legacy"(NULL, NULL);
