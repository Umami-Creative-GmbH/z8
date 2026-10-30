-- #1439 (spec #1437, Organization ADR 0006): the moment a former employee left
-- when no departure records it. Every writer that switches an employee off
-- (Deactivate, member removal, SCIM deprovisioning) goes through the trigger, so
-- none of them has to remember the instant; a departure taking effect writes its
-- own cutoff instead. Switching an employee on (Reactivate, rehire, SCIM) clears
-- it. Employees deactivated before this migration keep NULL: their date is not
-- recorded until the #1442 backfill recovers it from the audit log.
ALTER TABLE "employee" ADD COLUMN IF NOT EXISTS "deactivated_at" timestamp with time zone;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "employee_track_deactivated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.is_active THEN
		NEW.deactivated_at := NULL;
	ELSIF NEW.deactivated_at IS NOT DISTINCT FROM OLD.deactivated_at THEN
		-- The writer named no instant of its own: the transaction's now.
		NEW.deactivated_at := now();
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "employee_track_deactivated_at_trigger" ON "employee";
--> statement-breakpoint
CREATE TRIGGER "employee_track_deactivated_at_trigger"
	BEFORE UPDATE OF "is_active" ON "employee"
	FOR EACH ROW
	WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
	EXECUTE FUNCTION "employee_track_deactivated_at"();
--> statement-breakpoint
-- When a former employee left: the latest departure that ended their access by
-- p_now (effective, or pending past its cutoff and not blocked, checked per
-- departure exactly as employee_departure_denies_access does), or their
-- deactivation, whichever is later. A rehire followed by a deactivation thus
-- reports the deactivation, not the old departure. NULL when nothing is
-- recorded. Callers ask only for employees who are not current (#1439).
--
-- Known gaps until the #1442 backfill: an employee inserted already inactive
-- (an import) has no deactivation instant, and an employee who was rehired and
-- then deactivated before this migration reports the old departure's cutoff.
CREATE OR REPLACE FUNCTION "employee_left_at"(
	p_organization_id text,
	p_employee_id uuid,
	p_deactivated_at timestamptz,
	p_now timestamptz
)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
	SELECT GREATEST(
		(
			SELECT max(d."cutoff_at")
			FROM public."employee_departure" AS d
			JOIN public."employee" AS e
				ON e."id" = d."employee_id" AND e."organization_id" = d."organization_id"
			WHERE d."organization_id" = p_organization_id
				AND d."employee_id" = p_employee_id
				AND d."cutoff_at" <= p_now
				AND (
					d."status" = 'effective'
					OR (
						d."status" = 'pending'
						AND "employee_departure_blocked_reason"(p_organization_id, e."user_id", d."created_by") IS NULL
					)
				)
		),
		p_deactivated_at
	);
$$;
--> statement-breakpoint
-- The same moment as a calendar date in the organization's timezone, through the
-- 0264 helper that falls back to UTC for a missing or unknown zone name, so one
-- bad stored timezone can't make every query that shows the date fail.
CREATE OR REPLACE FUNCTION "employee_left_on"(
	p_organization_id text,
	p_employee_id uuid,
	p_deactivated_at timestamptz,
	p_now timestamptz
)
RETURNS date
LANGUAGE sql
STABLE
AS $$
	SELECT (
		"employee_left_at"(p_organization_id, p_employee_id, p_deactivated_at, p_now)
		AT TIME ZONE "vacation_organization_timezone"(p_organization_id)
	)::date;
$$;
