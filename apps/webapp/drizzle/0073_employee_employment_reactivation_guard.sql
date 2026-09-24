-- True when an effective departure ended the employee's employment and no
-- employment period is open again. Only an explicit rehire opens one.
CREATE OR REPLACE FUNCTION "employee_employment_ended_without_rehire"(
	p_organization_id text,
	p_employee_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
	SELECT EXISTS (
		SELECT 1 FROM public."employee_departure" AS d
		WHERE d."organization_id" = p_organization_id AND d."employee_id" = p_employee_id
			AND d."status" = 'effective'
	)
	AND NOT EXISTS (
		SELECT 1 FROM public."employee_employment_period" AS p
		WHERE p."organization_id" = p_organization_id AND p."employee_id" = p_employee_id
			AND p."status" = 'open'
	);
$$;
--> statement-breakpoint
-- Membership acceptance, invite codes, pending-member approval, SCIM and
-- generic toggles reactivate the employee projection directly. Membership
-- alone must not reopen ended employment, so those writes keep the employee
-- inactive; the membership change itself still succeeds. Legacy deactivations
-- without a departure are unaffected.
CREATE OR REPLACE FUNCTION "employee_guard_ended_employment_reactivation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.is_active = false AND NEW.is_active = true
		AND "employee_employment_ended_without_rehire"(NEW.organization_id, NEW.id) THEN
		NEW.is_active := false;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "employee_guard_ended_employment_reactivation_trigger"
	BEFORE UPDATE OF "is_active" ON "employee"
	FOR EACH ROW EXECUTE FUNCTION "employee_guard_ended_employment_reactivation"();
