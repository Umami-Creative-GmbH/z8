-- #831 (spec #766, Time Tracking ADR 0004): the position stamp access log. One
-- entry each time someone other than the employee is shown stamps (a work
-- period's "Show positions", or an export containing stamps), with the
-- employees it covers as subjects. Entries are append-only and hold no position.
CREATE TABLE "position_stamp_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"viewer_user_id" text,
	"kind" text NOT NULL,
	"work_period_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"export_id" text,
	"accessed_at" timestamp NOT NULL,
	CONSTRAINT "positionStampAccessLog_id_organizationId_idx" UNIQUE("id","organization_id"),
	CONSTRAINT "position_stamp_access_log_kind_check" CHECK (("position_stamp_access_log"."kind" = 'work_period_detail' and cardinality("position_stamp_access_log"."work_period_ids") >= 1 and "position_stamp_access_log"."export_id" is null)
			or ("position_stamp_access_log"."kind" = 'data_export' and "position_stamp_access_log"."export_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "position_stamp_access_log_subject" (
	"access_log_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	CONSTRAINT "position_stamp_access_log_subject_pk" PRIMARY KEY("access_log_id","employee_id")
);
--> statement-breakpoint
ALTER TABLE "position_stamp_access_log" ADD CONSTRAINT "position_stamp_access_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_stamp_access_log" ADD CONSTRAINT "position_stamp_access_log_viewer_user_id_user_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_stamp_access_log_subject" ADD CONSTRAINT "position_stamp_access_log_subject_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_stamp_access_log_subject" ADD CONSTRAINT "position_stamp_access_log_subject_log_fk" FOREIGN KEY ("access_log_id","organization_id") REFERENCES "public"."position_stamp_access_log"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_stamp_access_log_subject" ADD CONSTRAINT "position_stamp_access_log_subject_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "positionStampAccessLog_org_accessedAt_idx" ON "position_stamp_access_log" USING btree ("organization_id","accessed_at");--> statement-breakpoint
CREATE INDEX "positionStampAccessLog_viewerUserId_idx" ON "position_stamp_access_log" USING btree ("viewer_user_id");--> statement-breakpoint
CREATE INDEX "positionStampAccessLogSubject_org_employee_idx" ON "position_stamp_access_log_subject" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE FUNCTION "position_stamp_access_log_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	-- Only the ON DELETE SET NULL of a deleted viewer passes.
	IF TG_TABLE_NAME = 'position_stamp_access_log' THEN
		IF (to_jsonb(NEW) - 'viewer_user_id') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'viewer_user_id')
			AND to_jsonb(NEW) -> 'viewer_user_id' = 'null'::jsonb THEN
			RETURN NEW;
		END IF;
	END IF;
	RAISE EXCEPTION 'position stamp access log entries are append-only'
		USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "position_stamp_access_log_append_only" BEFORE UPDATE ON "position_stamp_access_log"
	FOR EACH ROW EXECUTE FUNCTION "position_stamp_access_log_append_only"();--> statement-breakpoint
CREATE TRIGGER "position_stamp_access_log_subject_append_only" BEFORE UPDATE ON "position_stamp_access_log_subject"
	FOR EACH ROW EXECUTE FUNCTION "position_stamp_access_log_append_only"();
