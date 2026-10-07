-- A manager link joins two employees of one organization (#692). Before #318
-- the demo data wizard looked up the acting user's employee without an
-- organization filter, so it could assign that user's employee from another
-- organization as manager. Those links grant nothing in the employee's own
-- organization (routing only loads that organization's employees), so they are
-- removed rather than remapped: remapping would grant manager authority that no
-- one assigned.
DELETE FROM "employee_managers" AS "link"
USING "employee" AS "subject", "employee" AS "manager"
WHERE "subject"."id" = "link"."employee_id"
	AND "manager"."id" = "link"."manager_id"
	AND "subject"."organization_id" <> "manager"."organization_id";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "employee_managers_guard_same_organization"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	subject_organization_id text;
	manager_organization_id text;
BEGIN
	-- FOR SHARE conflicts with the row lock of an organization change, so a
	-- concurrent move of either employee waits for this link (and its guard).
	SELECT "organization_id" INTO subject_organization_id
	FROM public."employee" WHERE "id" = NEW.employee_id FOR SHARE;
	SELECT "organization_id" INTO manager_organization_id
	FROM public."employee" WHERE "id" = NEW.manager_id FOR SHARE;

	-- A missing employee is reported by the foreign keys.
	IF subject_organization_id <> manager_organization_id THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'A manager must belong to the employee''s organization';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "employee_managers_guard_same_organization_trigger"
	BEFORE INSERT OR UPDATE OF "employee_id", "manager_id"
	ON "employee_managers"
	FOR EACH ROW EXECUTE FUNCTION "employee_managers_guard_same_organization"();
--> statement-breakpoint
-- Moving a linked employee to another organization would split its links.
CREATE OR REPLACE FUNCTION "employee_guard_manager_link_organization"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM public."employee_managers"
		WHERE "employee_id" = NEW.id OR "manager_id" = NEW.id
	) THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = 'An employee with manager links cannot change organization';
	END IF;

	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "employee_guard_manager_link_organization_trigger"
	BEFORE UPDATE OF "organization_id" ON "employee"
	FOR EACH ROW
	WHEN (OLD.organization_id IS DISTINCT FROM NEW.organization_id)
	EXECUTE FUNCTION "employee_guard_manager_link_organization"();
