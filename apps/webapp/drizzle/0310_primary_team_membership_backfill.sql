-- Organization ADR 0010 (#1575): an employee's primary team is always one of their team
-- memberships, and anyone with a team membership has a primary team. Every write keeps
-- this true from now on; this repairs the employees written before. Organization-scoped
-- throughout: a team, membership and employee only ever meet within one organization.

-- 1. Every primary team becomes a membership, as migration 0014 did.
INSERT INTO "team_membership" ("organization_id", "team_id", "employee_id", "created_by")
SELECT "employee"."organization_id", "employee"."team_id", "employee"."id", NULL
FROM "employee"
JOIN "team" ON "team"."id" = "employee"."team_id"
	AND "team"."organization_id" = "employee"."organization_id"
ON CONFLICT ("team_id", "employee_id") DO NOTHING;
--> statement-breakpoint

-- 2. A primary team of another organization can be no membership: it is no team of theirs.
UPDATE "employee" SET "team_id" = NULL
WHERE "employee"."team_id" IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM "team"
		WHERE "team"."id" = "employee"."team_id"
			AND "team"."organization_id" = "employee"."organization_id"
	);
--> statement-breakpoint

-- 3. An employee with memberships but no primary team gets their oldest membership.
UPDATE "employee" SET "team_id" = "oldest"."team_id"
FROM (
	SELECT DISTINCT ON ("team_membership"."organization_id", "team_membership"."employee_id")
		"team_membership"."organization_id", "team_membership"."employee_id", "team_membership"."team_id"
	FROM "team_membership"
	ORDER BY "team_membership"."organization_id", "team_membership"."employee_id",
		"team_membership"."created_at", "team_membership"."team_id"
) AS "oldest"
WHERE "employee"."team_id" IS NULL
	AND "oldest"."employee_id" = "employee"."id"
	AND "oldest"."organization_id" = "employee"."organization_id";
