-- Vehicle use on work (#1120, spec #807; Time Tracking glossary "Driving", ADR 0009): the
-- vehicle, odometer readings and driven distance in whole kilometres, stored with the work's
-- attribution on work_period and mirrored on its canonical time_record_work. An organization
-- vehicle is referenced without a cascade, so a vehicle recorded on work cannot be deleted.
-- The closed-month guard (0191) freezes the new work_period columns like the work location.
-- Additive only. Idempotent.
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "vehicle_kind" text;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "odometer_start_km" integer;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "odometer_end_km" integer;--> statement-breakpoint
ALTER TABLE "work_period" ADD COLUMN IF NOT EXISTS "driven_distance_km" integer;--> statement-breakpoint
ALTER TABLE "time_record_work" ADD COLUMN IF NOT EXISTS "vehicle_kind" text;--> statement-breakpoint
ALTER TABLE "time_record_work" ADD COLUMN IF NOT EXISTS "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "time_record_work" ADD COLUMN IF NOT EXISTS "odometer_start_km" integer;--> statement-breakpoint
ALTER TABLE "time_record_work" ADD COLUMN IF NOT EXISTS "odometer_end_km" integer;--> statement-breakpoint
ALTER TABLE "time_record_work" ADD COLUMN IF NOT EXISTS "driven_distance_km" integer;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_vehicle_fk" FOREIGN KEY ("vehicle_id","organization_id") REFERENCES "public"."organization_vehicle"("id","organization_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "time_record_work" ADD CONSTRAINT "timeRecordWork_vehicle_fk" FOREIGN KEY ("vehicle_id","organization_id") REFERENCES "public"."organization_vehicle"("id","organization_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_vehicle_kind_chk" CHECK (("vehicle_kind" IS NULL OR "vehicle_kind" IN ('organization', 'own')) AND ("vehicle_id" IS NOT NULL) = ("vehicle_kind" IS NOT DISTINCT FROM 'organization'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "work_period" ADD CONSTRAINT "workPeriod_vehicle_readings_chk" CHECK (("vehicle_kind" IS NOT NULL OR ("odometer_start_km" IS NULL AND "odometer_end_km" IS NULL AND "driven_distance_km" IS NULL)) AND ("odometer_start_km" IS NULL OR "odometer_start_km" >= 0) AND ("odometer_end_km" IS NULL OR "odometer_end_km" >= 0) AND ("driven_distance_km" IS NULL OR "driven_distance_km" >= 0) AND ("odometer_start_km" IS NULL OR "odometer_end_km" IS NULL OR ("odometer_end_km" >= "odometer_start_km" AND "driven_distance_km" IS NOT NULL AND "driven_distance_km" = "odometer_end_km" - "odometer_start_km")) AND ("odometer_start_km" IS NULL OR "odometer_end_km" IS NOT NULL OR "driven_distance_km" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "time_record_work" ADD CONSTRAINT "timeRecordWork_vehicle_kind_chk" CHECK (("vehicle_kind" IS NULL OR "vehicle_kind" IN ('organization', 'own')) AND ("vehicle_id" IS NOT NULL) = ("vehicle_kind" IS NOT DISTINCT FROM 'organization'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "time_record_work" ADD CONSTRAINT "timeRecordWork_vehicle_readings_chk" CHECK (("vehicle_kind" IS NOT NULL OR ("odometer_start_km" IS NULL AND "odometer_end_km" IS NULL AND "driven_distance_km" IS NULL)) AND ("odometer_start_km" IS NULL OR "odometer_start_km" >= 0) AND ("odometer_end_km" IS NULL OR "odometer_end_km" >= 0) AND ("driven_distance_km" IS NULL OR "driven_distance_km" >= 0) AND ("odometer_start_km" IS NULL OR "odometer_end_km" IS NULL OR ("odometer_end_km" >= "odometer_start_km" AND "driven_distance_km" IS NOT NULL AND "driven_distance_km" = "odometer_end_km" - "odometer_start_km")) AND ("odometer_start_km" IS NULL OR "odometer_end_km" IS NOT NULL OR "driven_distance_km" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workPeriod_org_vehicleId_idx" ON "work_period" USING btree ("organization_id","vehicle_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timeRecordWork_org_vehicleId_idx" ON "time_record_work" USING btree ("organization_id","vehicle_id");--> statement-breakpoint
-- The closed-month guard: an update that changes vehicle use is a change of the work.
CREATE OR REPLACE FUNCTION "closed_month_guard_work_period"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	v_month date;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW.employee_id, NEW.organization_id, NEW.clock_in_id, NEW.clock_out_id,
		NEW.start_time, NEW.end_time, NEW.duration_minutes, NEW.is_active,
		NEW.project_id, NEW.task_id, NEW.is_billable, NEW.work_category_id,
		NEW.work_location_type, NEW.approval_status, NEW.deleted_at,
		NEW.vehicle_kind, NEW.vehicle_id, NEW.odometer_start_km, NEW.odometer_end_km,
		NEW.driven_distance_km
	) IS NOT DISTINCT FROM (
		OLD.employee_id, OLD.organization_id, OLD.clock_in_id, OLD.clock_out_id,
		OLD.start_time, OLD.end_time, OLD.duration_minutes, OLD.is_active,
		OLD.project_id, OLD.task_id, OLD.is_billable, OLD.work_category_id,
		OLD.work_location_type, OLD.approval_status, OLD.deleted_at,
		OLD.vehicle_kind, OLD.vehicle_id, OLD.odometer_start_km, OLD.odometer_end_km,
		OLD.driven_distance_km
	) THEN
		RETURN NEW;
	END IF;
	IF TG_OP <> 'INSERT' THEN
		v_month := public.closed_month_touching_work(OLD.employee_id, OLD.start_time, OLD.end_time);
		IF v_month IS NOT NULL
			AND NOT (TG_OP = 'DELETE' AND public.closed_month_erasing(OLD.organization_id, OLD.employee_id))
		THEN
			PERFORM public.closed_month_refuse(v_month);
		END IF;
	END IF;
	IF TG_OP <> 'DELETE' THEN
		v_month := public.closed_month_touching_work(NEW.employee_id, NEW.start_time, NEW.end_time);
		IF v_month IS NOT NULL THEN
			PERFORM public.closed_month_refuse(v_month);
		END IF;
		RETURN NEW;
	END IF;
	RETURN OLD;
END;
$$;
