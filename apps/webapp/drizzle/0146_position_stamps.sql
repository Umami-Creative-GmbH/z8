-- #826 (spec #766, Time Tracking ADR 0004): position stamps captured with an
-- employee's own web/PWA clock commands, one per clock event, outside the
-- hash-chained time_entry fields. Stamps are immutable except that purge_at may
-- move earlier (a shortened retention).
CREATE TABLE "position_stamp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"accuracy_meters" double precision NOT NULL,
	"fixed_at" timestamp NOT NULL,
	"captured_at" timestamp NOT NULL,
	"purge_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "position_stamp_coordinates_check" CHECK ("position_stamp"."latitude" between -90 and 90 and "position_stamp"."longitude" between -180 and 180),
	CONSTRAINT "position_stamp_accuracy_check" CHECK ("position_stamp"."accuracy_meters" >= 0 and "position_stamp"."accuracy_meters" < 'Infinity'::float8),
	CONSTRAINT "position_stamp_purge_check" CHECK ("position_stamp"."purge_at" > "position_stamp"."captured_at")
);
--> statement-breakpoint
ALTER TABLE "position_stamp" ADD CONSTRAINT "position_stamp_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_stamp" ADD CONSTRAINT "position_stamp_time_entry_id_time_entry_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_stamp" ADD CONSTRAINT "position_stamp_consent_id_position_consent_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."position_consent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_stamp" ADD CONSTRAINT "position_stamp_employee_fk" FOREIGN KEY ("employee_id","organization_id") REFERENCES "public"."employee"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "positionStamp_timeEntryId_idx" ON "position_stamp" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX "positionStamp_org_employee_idx" ON "position_stamp" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "positionStamp_purgeAt_idx" ON "position_stamp" USING btree ("purge_at");--> statement-breakpoint
CREATE FUNCTION "position_stamp_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF (to_jsonb(NEW) - 'purge_at') IS DISTINCT FROM (to_jsonb(OLD) - 'purge_at')
		OR NEW."purge_at" > OLD."purge_at" THEN
		RAISE EXCEPTION 'position stamps are immutable; only purge_at may move earlier'
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "position_stamp_immutable" BEFORE UPDATE ON "position_stamp"
	FOR EACH ROW EXECUTE FUNCTION "position_stamp_immutable"();
