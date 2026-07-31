LOCK TABLE "team_permissions" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
WITH "ranked" AS (
	SELECT
		"id",
		"organization_id",
		"employee_id",
		"team_id",
		ROW_NUMBER() OVER (
			PARTITION BY "organization_id", "employee_id", "team_id"
			ORDER BY "updated_at" DESC NULLS LAST, "granted_at" DESC NULLS LAST, "id" DESC
		) AS "permission_rank",
		COUNT(*) OVER (
			PARTITION BY "organization_id", "employee_id", "team_id"
		) AS "duplicate_count",
		BOOL_OR("can_create_teams") OVER (
			PARTITION BY "organization_id", "employee_id", "team_id"
		) AS "merged_can_create_teams",
		BOOL_OR("can_manage_team_members") OVER (
			PARTITION BY "organization_id", "employee_id", "team_id"
		) AS "merged_can_manage_team_members",
		BOOL_OR("can_manage_team_settings") OVER (
			PARTITION BY "organization_id", "employee_id", "team_id"
		) AS "merged_can_manage_team_settings",
		BOOL_OR("can_approve_team_requests") OVER (
			PARTITION BY "organization_id", "employee_id", "team_id"
		) AS "merged_can_approve_team_requests"
	FROM "team_permissions"
)
UPDATE "team_permissions" AS "survivor"
SET
	"can_create_teams" = "ranked"."merged_can_create_teams",
	"can_manage_team_members" = "ranked"."merged_can_manage_team_members",
	"can_manage_team_settings" = "ranked"."merged_can_manage_team_settings",
	"can_approve_team_requests" = "ranked"."merged_can_approve_team_requests"
FROM "ranked"
WHERE "ranked"."permission_rank" = 1
	AND "ranked"."duplicate_count" > 1
	AND "survivor"."id" = "ranked"."id"
	AND "survivor"."organization_id" = "ranked"."organization_id"
	AND "survivor"."employee_id" = "ranked"."employee_id"
	AND "survivor"."team_id" IS NOT DISTINCT FROM "ranked"."team_id";
--> statement-breakpoint
WITH "ranked" AS (
	SELECT
		"id",
		"organization_id",
		"employee_id",
		"team_id",
		ROW_NUMBER() OVER (
			PARTITION BY "organization_id", "employee_id", "team_id"
			ORDER BY "updated_at" DESC NULLS LAST, "granted_at" DESC NULLS LAST, "id" DESC
		) AS "permission_rank"
	FROM "team_permissions"
)
DELETE FROM "team_permissions" AS "duplicate"
USING "ranked"
WHERE "ranked"."permission_rank" > 1
	AND "duplicate"."id" = "ranked"."id"
	AND "duplicate"."organization_id" = "ranked"."organization_id"
	AND "duplicate"."employee_id" = "ranked"."employee_id"
	AND "duplicate"."team_id" IS NOT DISTINCT FROM "ranked"."team_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "teamPermissions_unique_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "teamPermissions_employeeOrganizationTeam_unique_idx" ON "team_permissions" USING btree ("employee_id","organization_id","team_id") WHERE "team_permissions"."team_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "teamPermissions_employeeOrganizationOrgWide_unique_idx" ON "team_permissions" USING btree ("employee_id","organization_id") WHERE "team_permissions"."team_id" IS NULL;
