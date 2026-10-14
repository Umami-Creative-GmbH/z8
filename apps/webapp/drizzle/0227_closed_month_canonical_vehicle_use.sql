-- Closed months cover vehicle use on the canonical work record (#807 review, #1120): vehicle use
-- is stored with the work's attribution on work_period (guarded since 0224) and on its canonical
-- time_record_work, which the time_record guard (0191) cannot see. An update of a canonical work
-- record's vehicle, readings or driven distance is refused while its work touches a closed range,
-- as the same change on work_period is. The record's times come from its time_record. Inserts and
-- deletes of time_record_work go with their time_record, which 0191 guards. Idempotent.
--
-- The refusal raises SQLSTATE Z8M01 with the month (`YYYY-MM`) as its detail
-- (`closed_month_refuse`, 0191).
CREATE OR REPLACE FUNCTION "closed_month_guard_time_record_work"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	v_month date;
	v_employee_id uuid;
	v_start_at timestamp;
	v_end_at timestamp;
BEGIN
	IF (
		NEW.vehicle_kind, NEW.vehicle_id, NEW.odometer_start_km, NEW.odometer_end_km,
		NEW.driven_distance_km
	) IS NOT DISTINCT FROM (
		OLD.vehicle_kind, OLD.vehicle_id, OLD.odometer_start_km, OLD.odometer_end_km,
		OLD.driven_distance_km
	) THEN
		RETURN NEW;
	END IF;
	SELECT r."employee_id", r."start_at", r."end_at"
		INTO v_employee_id, v_start_at, v_end_at
		FROM public."time_record" r
		WHERE r."id" = OLD."record_id" AND r."organization_id" = OLD."organization_id";
	IF FOUND THEN
		v_month := public.closed_month_touching_work(v_employee_id, v_start_at, v_end_at);
		IF v_month IS NOT NULL THEN
			PERFORM public.closed_month_refuse(v_month);
		END IF;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "closed_month_guard_time_record_work" ON "time_record_work";--> statement-breakpoint
CREATE TRIGGER "closed_month_guard_time_record_work"
	BEFORE UPDATE OF "vehicle_kind", "vehicle_id", "odometer_start_km", "odometer_end_km", "driven_distance_km"
	ON "time_record_work"
	FOR EACH ROW EXECUTE FUNCTION "closed_month_guard_time_record_work"();
