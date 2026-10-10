-- Closed months (#762, Time Tracking ADR-0004): a close fixes, for each
-- employee it covers, the calendar month in their effective timezone as UTC
-- instants (`closed_month_employee`). Reopening lifts it with a reason.
CREATE TABLE "closed_month" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"month" date NOT NULL,
	"scope" text NOT NULL,
	"team_id" uuid,
	"covers_new_employees" boolean DEFAULT false NOT NULL,
	"actor_kind" text NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closed_month_month_first_day_check" CHECK (extract(day from "closed_month"."month") = 1),
	CONSTRAINT "closed_month_scope_check" CHECK (("closed_month"."scope" = 'organization' AND "closed_month"."team_id" IS NULL) OR ("closed_month"."scope" = 'team' AND "closed_month"."team_id" IS NOT NULL AND NOT "closed_month"."covers_new_employees")),
	CONSTRAINT "closed_month_actor_check" CHECK ("closed_month"."actor_kind" = 'user' OR "closed_month"."closed_by" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "closed_month_reopening" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"month" date NOT NULL,
	"scope" text NOT NULL,
	"team_id" uuid,
	"reason" text NOT NULL,
	"employee_count" integer NOT NULL,
	"reopened_by" text,
	"reopened_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closed_month_reopening_month_first_day_check" CHECK (extract(day from "closed_month_reopening"."month") = 1),
	CONSTRAINT "closed_month_reopening_reason_check" CHECK (length(btrim("closed_month_reopening"."reason")) > 0),
	CONSTRAINT "closed_month_reopening_employee_count_check" CHECK ("closed_month_reopening"."employee_count" >= 0),
	CONSTRAINT "closed_month_reopening_scope_check" CHECK (("closed_month_reopening"."scope" = 'team') = ("closed_month_reopening"."team_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "closed_month_employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"closed_month_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" date NOT NULL,
	"range_start" timestamp NOT NULL,
	"range_end" timestamp NOT NULL,
	"timezone" text NOT NULL,
	"team_id" uuid,
	"covered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopening_id" uuid,
	"reopened_at" timestamp with time zone,
	CONSTRAINT "closed_month_employee_range_check" CHECK ("closed_month_employee"."range_end" > "closed_month_employee"."range_start")
);
--> statement-breakpoint
CREATE TABLE "closed_month_setting" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"auto_close_enabled" boolean DEFAULT false NOT NULL,
	"auto_close_after_days" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "closed_month_setting_after_days_check" CHECK ("closed_month_setting"."auto_close_after_days" BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "closed_month_auto_close_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"month" date NOT NULL,
	"run_date" date NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closedMonthAutoCloseRun_org_month_day_idx" UNIQUE("organization_id","month","run_date")
);
--> statement-breakpoint
ALTER TABLE "closed_month" ADD CONSTRAINT "closed_month_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_month" ADD CONSTRAINT "closed_month_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_month_reopening" ADD CONSTRAINT "closed_month_reopening_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_month_reopening" ADD CONSTRAINT "closed_month_reopening_reopened_by_user_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_month_employee" ADD CONSTRAINT "closed_month_employee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_month_employee" ADD CONSTRAINT "closed_month_employee_closed_month_id_closed_month_id_fk" FOREIGN KEY ("closed_month_id") REFERENCES "public"."closed_month"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_month_employee" ADD CONSTRAINT "closed_month_employee_employee_id_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_month_employee" ADD CONSTRAINT "closed_month_employee_reopening_id_closed_month_reopening_id_fk" FOREIGN KEY ("reopening_id") REFERENCES "public"."closed_month_reopening"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_month_setting" ADD CONSTRAINT "closed_month_setting_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_month_setting" ADD CONSTRAINT "closed_month_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closed_month_auto_close_run" ADD CONSTRAINT "closed_month_auto_close_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "closedMonth_organizationId_month_idx" ON "closed_month" USING btree ("organization_id","month");--> statement-breakpoint
CREATE INDEX "closedMonthReopening_organizationId_month_idx" ON "closed_month_reopening" USING btree ("organization_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "closedMonthEmployee_employee_month_closed_idx" ON "closed_month_employee" USING btree ("employee_id","month") WHERE "closed_month_employee"."reopened_at" IS NULL;--> statement-breakpoint
CREATE INDEX "closedMonthEmployee_employee_range_idx" ON "closed_month_employee" USING btree ("employee_id","range_start","range_end") WHERE "closed_month_employee"."reopened_at" IS NULL;--> statement-breakpoint
CREATE INDEX "closedMonthEmployee_organizationId_month_idx" ON "closed_month_employee" USING btree ("organization_id","month");--> statement-breakpoint
CREATE INDEX "closedMonthEmployee_closedMonthId_idx" ON "closed_month_employee" USING btree ("closed_month_id");
--> statement-breakpoint
-- An organization close also covers employees added later, at the range
-- their effective timezone (personal, else organization, else UTC) gives when
-- they are first covered: when their employee row is created.
CREATE FUNCTION "closed_month_cover_new_employee"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	v_timezone text;
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM public."closed_month"
		WHERE "organization_id" = NEW.organization_id AND "covers_new_employees"
	) THEN
		RETURN NEW;
	END IF;
	SELECT candidate.tz INTO v_timezone
	FROM (
		SELECT s."timezone" AS tz, 1 AS preference FROM public."user_settings" s WHERE s."user_id" = NEW.user_id
		UNION ALL
		SELECT o."timezone", 2 FROM public."organization" o WHERE o."id" = NEW.organization_id
	) candidate
	WHERE candidate.tz IS NOT NULL
		AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = candidate.tz)
	ORDER BY candidate.preference
	LIMIT 1;
	v_timezone := COALESCE(v_timezone, 'UTC');
	INSERT INTO public."closed_month_employee" (
		"organization_id", "closed_month_id", "employee_id", "month",
		"range_start", "range_end", "timezone", "team_id"
	)
	SELECT DISTINCT ON (c."month")
		c."organization_id", c."id", NEW.id, c."month",
		(c."month"::timestamp AT TIME ZONE v_timezone) AT TIME ZONE 'UTC',
		((c."month" + interval '1 month')::timestamp AT TIME ZONE v_timezone) AT TIME ZONE 'UTC',
		v_timezone, NEW.team_id
	FROM public."closed_month" c
	WHERE c."organization_id" = NEW.organization_id AND c."covers_new_employees"
	ORDER BY c."month", c."closed_at" DESC
	ON CONFLICT DO NOTHING;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "closed_month_cover_new_employee" AFTER INSERT ON "employee"
	FOR EACH ROW EXECUTE FUNCTION "closed_month_cover_new_employee"();