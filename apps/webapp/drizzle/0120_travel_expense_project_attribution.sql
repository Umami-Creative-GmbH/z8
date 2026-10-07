ALTER TABLE "project" ADD CONSTRAINT "project_id_organizationId_idx" UNIQUE("id","organization_id");--> statement-breakpoint
CREATE TABLE "project_assignment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"source_assignment_id" uuid NOT NULL,
	"assignment_type" text NOT NULL,
	"employee_id" uuid,
	"team_id" uuid,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_by" text,
	CONSTRAINT "project_assignment_history_target_check" CHECK (("project_assignment_history"."assignment_type" = 'employee' AND "project_assignment_history"."employee_id" IS NOT NULL AND "project_assignment_history"."team_id" IS NULL)
			OR ("project_assignment_history"."assignment_type" = 'team' AND "project_assignment_history"."team_id" IS NOT NULL AND "project_assignment_history"."employee_id" IS NULL)),
	CONSTRAINT "project_assignment_history_interval_check" CHECK ("project_assignment_history"."effective_to" IS NULL OR "project_assignment_history"."effective_to" >= "project_assignment_history"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "project_assignment_history" ADD CONSTRAINT "project_assignment_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment_history" ADD CONSTRAINT "project_assignment_history_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assignment_history" ADD CONSTRAINT "project_assignment_history_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projectAssignmentHistory_open_idx" ON "project_assignment_history" USING btree ("source_assignment_id") WHERE effective_to IS NULL;--> statement-breakpoint
CREATE INDEX "projectAssignmentHistory_org_employee_idx" ON "project_assignment_history" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "projectAssignmentHistory_org_team_idx" ON "project_assignment_history" USING btree ("organization_id","team_id");--> statement-breakpoint
CREATE TABLE "employee_team_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	CONSTRAINT "employee_team_history_interval_check" CHECK ("employee_team_history"."effective_to" IS NULL OR "employee_team_history"."effective_to" >= "employee_team_history"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "employee_team_history" ADD CONSTRAINT "employee_team_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_team_history" ADD CONSTRAINT "employee_team_history_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employeeTeamHistory_open_idx" ON "employee_team_history" USING btree ("employee_id") WHERE effective_to IS NULL;--> statement-breakpoint
CREATE INDEX "employeeTeamHistory_org_employee_idx" ON "employee_team_history" USING btree ("organization_id","employee_id");--> statement-breakpoint
-- History starts now: one open interval per current assignment and team
-- membership, from the migration time. Nothing earlier is inferred from them.
INSERT INTO "project_assignment_history" (
	"organization_id", "project_id", "source_assignment_id", "assignment_type", "employee_id",
	"team_id", "effective_from", "created_by"
)
SELECT pa."organization_id", pa."project_id", pa."id", pa."assignment_type"::text, pa."employee_id",
	pa."team_id", now(), pa."created_by"
FROM "project_assignment" pa
INNER JOIN "project" p ON p."id" = pa."project_id" AND p."organization_id" = pa."organization_id"
WHERE (pa."assignment_type"::text = 'employee' AND pa."team_id" IS NULL AND EXISTS (
		SELECT 1 FROM "employee" e
		WHERE e."id" = pa."employee_id" AND e."organization_id" = pa."organization_id"
	))
	OR (pa."assignment_type"::text = 'team' AND pa."team_id" IS NOT NULL AND pa."employee_id" IS NULL);--> statement-breakpoint
INSERT INTO "employee_team_history" ("organization_id", "employee_id", "team_id", "effective_from")
SELECT e."organization_id", e."id", e."team_id", now()
FROM "employee" e
WHERE e."team_id" IS NOT NULL;--> statement-breakpoint
-- Every write of a project assignment, cascades included, closes and opens
-- its intervals in the writing transaction. The capture never blocks the
-- write: a row whose project or employee is not of its organization, or that
-- names no single target, can never prove eligibility and is not recorded.
CREATE OR REPLACE FUNCTION "project_assignment_record_history"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') THEN
		UPDATE "project_assignment_history" SET "effective_to" = now()
		WHERE "source_assignment_id" = OLD."id" AND "effective_to" IS NULL;
	END IF;
	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		INSERT INTO "project_assignment_history" (
			"organization_id", "project_id", "source_assignment_id", "assignment_type", "employee_id",
			"team_id", "effective_from", "created_by"
		)
		SELECT NEW."organization_id", NEW."project_id", NEW."id", NEW."assignment_type"::text,
			NEW."employee_id", NEW."team_id", now(), NEW."created_by"
		WHERE EXISTS (
				SELECT 1 FROM "project" p
				WHERE p."id" = NEW."project_id" AND p."organization_id" = NEW."organization_id"
			)
			AND (
				(NEW."assignment_type"::text = 'employee' AND NEW."team_id" IS NULL AND EXISTS (
					SELECT 1 FROM "employee" e
					WHERE e."id" = NEW."employee_id" AND e."organization_id" = NEW."organization_id"
				))
				OR (NEW."assignment_type"::text = 'team' AND NEW."team_id" IS NOT NULL
					AND NEW."employee_id" IS NULL)
			);
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "project_assignment_history_capture" AFTER INSERT OR UPDATE OR DELETE ON "project_assignment" FOR EACH ROW EXECUTE FUNCTION "project_assignment_record_history"();--> statement-breakpoint
-- Every change of an employee's team, including SET NULL from a deleted team.
CREATE OR REPLACE FUNCTION "employee_record_team_history"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF OLD."team_id" IS NOT DISTINCT FROM NEW."team_id" THEN
			RETURN NULL;
		END IF;
		UPDATE "employee_team_history" SET "effective_to" = now()
		WHERE "employee_id" = OLD."id" AND "effective_to" IS NULL;
	END IF;
	IF NEW."team_id" IS NOT NULL THEN
		INSERT INTO "employee_team_history" ("organization_id", "employee_id", "team_id", "effective_from")
		VALUES (NEW."organization_id", NEW."id", NEW."team_id", now());
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "employee_team_history_capture" AFTER INSERT OR UPDATE OF "team_id" ON "employee" FOR EACH ROW EXECUTE FUNCTION "employee_record_team_history"();--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project"("id","organization_id") ON DELETE SET NULL ("project_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report" ADD CONSTRAINT "travel_expense_report_project_check" CHECK ("travel_expense_report"."kind" = 'trip' OR "travel_expense_report"."project_id" IS NULL);--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD COLUMN "project_inherits" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project"("id","organization_id") ON DELETE SET NULL ("project_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_report_item" ADD CONSTRAINT "travel_expense_report_item_project_check" CHECK (NOT ("travel_expense_report_item"."project_inherits" AND "travel_expense_report_item"."project_id" IS NOT NULL));--> statement-breakpoint
CREATE TABLE "travel_expense_project_attribution_exception" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"reason" text NOT NULL,
	"evidence" text NOT NULL,
	"authorized_by_employee_id" uuid NOT NULL,
	"authorized_by_user_id" text NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_expense_project_exception_dates_check" CHECK ("travel_expense_project_attribution_exception"."valid_to" >= "travel_expense_project_attribution_exception"."valid_from"),
	CONSTRAINT "travel_expense_project_exception_text_check" CHECK (length(btrim("travel_expense_project_attribution_exception"."reason")) BETWEEN 1 AND 1000
			AND length(btrim("travel_expense_project_attribution_exception"."evidence")) BETWEEN 1 AND 2000),
	CONSTRAINT "travel_expense_project_exception_authorizer_check" CHECK ("travel_expense_project_attribution_exception"."authorized_by_employee_id" <> "travel_expense_project_attribution_exception"."employee_id")
);
--> statement-breakpoint
ALTER TABLE "travel_expense_project_attribution_exception" ADD CONSTRAINT "travel_expense_project_attribution_exception_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_project_attribution_exception" ADD CONSTRAINT "travel_expense_project_exception_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_expense_project_attribution_exception" ADD CONSTRAINT "travel_expense_project_exception_project_fk" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "travelExpenseProjectException_org_employee_idx" ON "travel_expense_project_attribution_exception" USING btree ("organization_id","employee_id","project_id");
