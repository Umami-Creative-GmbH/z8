-- An approved expense report records the employee's teams (#746, ADR 0002):
-- their `team_id` and their team memberships, by value. Scoped expense officers
-- match these teams later, so a team move never hands a report to another
-- officer. New approvals record them in the approving transaction; null means
-- not recorded. Adjustment reports belong to their original report's teams and
-- never record their own.
ALTER TABLE "travel_expense_report" ADD COLUMN "approval_team_ids" uuid[];--> statement-breakpoint
ALTER TABLE "travel_expense_claim" ADD COLUMN "approval_team_ids" uuid[];--> statement-breakpoint
-- One-time backfill of reports approved before this migration: the employee's
-- teams now. A departed employee without a team keeps their last team from
-- `employee_team_history`, if that team still exists; otherwise none.
UPDATE "travel_expense_report" AS "report"
SET "approval_team_ids" = CASE
	WHEN cardinality("current_teams"."ids") = 0 AND NOT "subject"."is_active" THEN "last_team"."ids"
	ELSE "current_teams"."ids"
END
FROM "employee" AS "subject"
CROSS JOIN LATERAL (
	SELECT coalesce(array_agg("teams"."team_id" ORDER BY "teams"."team_id"), '{}'::uuid[]) AS "ids"
	FROM (
		SELECT "team"."id" AS "team_id" FROM "team"
		WHERE "team"."id" = "subject"."team_id"
			AND "team"."organization_id" = "subject"."organization_id"
		UNION
		SELECT "team_membership"."team_id" FROM "team_membership"
		WHERE "team_membership"."employee_id" = "subject"."id"
			AND "team_membership"."organization_id" = "subject"."organization_id"
	) AS "teams"
) AS "current_teams"
CROSS JOIN LATERAL (
	SELECT ARRAY(
		SELECT "latest"."team_id"
		FROM (
			SELECT "history"."team_id" FROM "employee_team_history" AS "history"
			WHERE "history"."employee_id" = "subject"."id"
				AND "history"."organization_id" = "subject"."organization_id"
			ORDER BY "history"."effective_from" DESC, "history"."effective_to" DESC NULLS FIRST
			LIMIT 1
		) AS "latest"
		JOIN "team" ON "team"."id" = "latest"."team_id"
			AND "team"."organization_id" = "subject"."organization_id"
	) AS "ids"
) AS "last_team"
WHERE "subject"."id" = "report"."employee_id"
	AND "subject"."organization_id" = "report"."organization_id"
	AND "report"."status" = 'approved'
	AND "report"."approval_team_ids" IS NULL
	AND NOT EXISTS (
		SELECT 1 FROM "travel_expense_report_adjustment" AS "adjustment"
		WHERE "adjustment"."organization_id" = "report"."organization_id"
			AND "adjustment"."report_id" = "report"."id"
	);--> statement-breakpoint
-- Legacy claims approved before this migration, by the same rule. Claims
-- decided later record their teams with the decision.
UPDATE "travel_expense_claim" AS "claim"
SET "approval_team_ids" = CASE
	WHEN cardinality("current_teams"."ids") = 0 AND NOT "subject"."is_active" THEN "last_team"."ids"
	ELSE "current_teams"."ids"
END
FROM "employee" AS "subject"
CROSS JOIN LATERAL (
	SELECT coalesce(array_agg("teams"."team_id" ORDER BY "teams"."team_id"), '{}'::uuid[]) AS "ids"
	FROM (
		SELECT "team"."id" AS "team_id" FROM "team"
		WHERE "team"."id" = "subject"."team_id"
			AND "team"."organization_id" = "subject"."organization_id"
		UNION
		SELECT "team_membership"."team_id" FROM "team_membership"
		WHERE "team_membership"."employee_id" = "subject"."id"
			AND "team_membership"."organization_id" = "subject"."organization_id"
	) AS "teams"
) AS "current_teams"
CROSS JOIN LATERAL (
	SELECT ARRAY(
		SELECT "latest"."team_id"
		FROM (
			SELECT "history"."team_id" FROM "employee_team_history" AS "history"
			WHERE "history"."employee_id" = "subject"."id"
				AND "history"."organization_id" = "subject"."organization_id"
			ORDER BY "history"."effective_from" DESC, "history"."effective_to" DESC NULLS FIRST
			LIMIT 1
		) AS "latest"
		JOIN "team" ON "team"."id" = "latest"."team_id"
			AND "team"."organization_id" = "subject"."organization_id"
	) AS "ids"
) AS "last_team"
WHERE "subject"."id" = "claim"."employee_id"
	AND "subject"."organization_id" = "claim"."organization_id"
	AND "claim"."status" = 'approved'
	AND "claim"."approval_team_ids" IS NULL;
