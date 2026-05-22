DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "employee_managers"
		GROUP BY "employee_id", "manager_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Duplicate employee manager assignments must be resolved before removing employee.manager_id';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "employee" AS "e"
		LEFT JOIN "employee" AS "manager"
			ON "manager"."id" = "e"."manager_id"
			AND "manager"."organization_id" = "e"."organization_id"
		WHERE "e"."manager_id" IS NOT NULL
			AND "manager"."id" IS NULL
	) THEN
		RAISE EXCEPTION 'Cannot remove employee.manager_id: legacy manager assignment references a missing or cross-organization manager';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "employee" AS "e"
		LEFT JOIN "user" AS "assigned_user"
			ON "assigned_user"."id" = "e"."user_id"
		WHERE "e"."manager_id" IS NOT NULL
			AND "assigned_user"."id" IS NULL
	) THEN
		RAISE EXCEPTION 'Cannot remove employee.manager_id: legacy manager assignment has no valid assigned_by user';
	END IF;
END $$;--> statement-breakpoint
INSERT INTO "employee_managers" (
	"employee_id",
	"manager_id",
	"is_primary",
	"assigned_by",
	"assigned_at",
	"created_at"
)
SELECT
	"e"."id",
	"e"."manager_id",
	NOT EXISTS (
		SELECT 1
		FROM "employee_managers" AS "existing_primary"
		WHERE "existing_primary"."employee_id" = "e"."id"
			AND "existing_primary"."is_primary" = true
	),
	"e"."user_id",
	now(),
	now()
FROM "employee" AS "e"
INNER JOIN "employee" AS "manager"
	ON "manager"."id" = "e"."manager_id"
	AND "manager"."organization_id" = "e"."organization_id"
INNER JOIN "user" AS "assigned_user"
	ON "assigned_user"."id" = "e"."user_id"
WHERE "e"."manager_id" IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM "employee_managers" AS "existing_assignment"
		WHERE "existing_assignment"."employee_id" = "e"."id"
			AND "existing_assignment"."manager_id" = "e"."manager_id"
	);--> statement-breakpoint
UPDATE "employee_managers" AS "existing_assignment"
SET "is_primary" = true
FROM "employee" AS "e"
WHERE "e"."manager_id" IS NOT NULL
	AND "existing_assignment"."employee_id" = "e"."id"
	AND "existing_assignment"."manager_id" = "e"."manager_id"
	AND "existing_assignment"."is_primary" = false
	AND NOT EXISTS (
		SELECT 1
		FROM "employee_managers" AS "existing_primary"
		WHERE "existing_primary"."employee_id" = "e"."id"
			AND "existing_primary"."is_primary" = true
	);--> statement-breakpoint
DROP INDEX IF EXISTS "employeeManagers_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "employeeManagers_unique_idx" ON "employee_managers" USING btree ("employee_id","manager_id");--> statement-breakpoint
DROP INDEX IF EXISTS "employee_managerId_idx";--> statement-breakpoint
ALTER TABLE "employee" DROP COLUMN "manager_id";
