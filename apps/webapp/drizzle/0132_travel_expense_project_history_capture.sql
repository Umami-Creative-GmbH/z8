-- Project attribution exceptions (#605) cover only dates before assignment history was captured
-- (spec #598 review). The capture start of every organization that existed when capture began
-- (0120 seeded one open interval per current assignment and team membership at that moment) is
-- recorded here; an organization created later has captured history since its creation.
CREATE TABLE "travel_expense_project_history_capture" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"captured_from" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "travel_expense_project_history_capture" ADD CONSTRAINT "travel_expense_project_history_capture_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "travel_expense_project_history_capture" ("organization_id", "captured_from")
SELECT o."id", LEAST(
	now(),
	COALESCE((SELECT min(h."effective_from") FROM "project_assignment_history" h WHERE h."organization_id" = o."id"), now()),
	COALESCE((SELECT min(t."effective_from") FROM "employee_team_history" t WHERE t."organization_id" = o."id"), now())
)
FROM "organization" o;--> statement-breakpoint
-- Team history records only a team of the employee's own organization (#605 review).
CREATE OR REPLACE FUNCTION "employee_record_team_history"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF OLD."team_id" IS NOT DISTINCT FROM NEW."team_id" THEN
			RETURN NULL;
		END IF;
		UPDATE "employee_team_history" SET "effective_to" = now()
		WHERE "employee_id" = OLD."id" AND "effective_to" IS NULL;
	END IF;
	IF NEW."team_id" IS NOT NULL AND EXISTS (
		SELECT 1 FROM "team" t WHERE t."id" = NEW."team_id" AND t."organization_id" = NEW."organization_id"
	) THEN
		INSERT INTO "employee_team_history" ("organization_id", "employee_id", "team_id", "effective_from")
		VALUES (NEW."organization_id", NEW."id", NEW."team_id", now());
	END IF;
	RETURN NULL;
END;
$$;
