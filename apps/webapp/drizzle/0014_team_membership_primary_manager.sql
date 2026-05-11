ALTER TABLE "team" ADD COLUMN "primary_manager_id" uuid;

CREATE TABLE IF NOT EXISTS "team_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);

ALTER TABLE "employee" ADD CONSTRAINT "employee_id_organizationId_idx" UNIQUE("id","organization_id");

ALTER TABLE "team" ADD CONSTRAINT "team_id_organizationId_idx" UNIQUE("id","organization_id");

ALTER TABLE "team" ADD CONSTRAINT "team_primary_manager_id_organization_id_employee_id_organization_id_fk"
	FOREIGN KEY ("primary_manager_id", "organization_id")
	REFERENCES "employee"("id", "organization_id");

ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_organization_id_organization_id_fk"
	FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;

ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_team_id_organization_id_team_id_organization_id_fk"
	FOREIGN KEY ("team_id", "organization_id")
	REFERENCES "team"("id", "organization_id")
	ON DELETE CASCADE;

ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_employee_id_organization_id_employee_id_organization_id_fk"
	FOREIGN KEY ("employee_id", "organization_id")
	REFERENCES "employee"("id", "organization_id")
	ON DELETE CASCADE;

ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_created_by_user_id_fk"
	FOREIGN KEY ("created_by") REFERENCES "user"("id");

CREATE INDEX IF NOT EXISTS "team_primaryManagerId_idx" ON "team" ("primary_manager_id");
CREATE INDEX IF NOT EXISTS "teamMembership_organizationId_idx" ON "team_membership" ("organization_id");
CREATE INDEX IF NOT EXISTS "teamMembership_teamId_idx" ON "team_membership" ("team_id");
CREATE INDEX IF NOT EXISTS "teamMembership_employeeId_idx" ON "team_membership" ("employee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "teamMembership_team_employee_idx" ON "team_membership" ("team_id", "employee_id");

INSERT INTO "team_membership" ("organization_id", "team_id", "employee_id", "created_by")
SELECT "employee"."organization_id", "employee"."team_id", "employee"."id", NULL
FROM "employee"
JOIN "team" ON "team"."id" = "employee"."team_id"
	AND "team"."organization_id" = "employee"."organization_id"
WHERE "team_id" IS NOT NULL
ON CONFLICT ("team_id", "employee_id") DO NOTHING;
