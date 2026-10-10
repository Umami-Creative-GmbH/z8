-- Closed months (#762, Time Tracking ADR-0004): the database refuses any insert,
-- update or delete of work records or absences that touches a closed range,
-- before or after the change, as the backstop behind every writer's own typed
-- refusal. Notes are not frozen: an update that leaves every frozen column
-- unchanged passes. Erasing an employee or an organization entirely is not a
-- change: a delete passes once its employee or organization is gone (the
-- parent-deletion cascades). No session flag can unlock it.
--
-- The refusal raises SQLSTATE Z8M01 with the month (`YYYY-MM`) as its detail;
-- `closed-months/refusal.ts` turns it into the typed "month closed" refusal.
CREATE FUNCTION "closed_month_refuse"(p_month date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'month closed'
		USING ERRCODE = 'Z8M01', DETAIL = to_char(p_month, 'YYYY-MM');
END;
$$;--> statement-breakpoint
-- The first closed month whose range an employee's work touches, even in part:
-- it starts before the range ends and, live or not, reaches the range start.
CREATE FUNCTION "closed_month_touching_work"(
	p_employee_id uuid,
	p_start timestamp,
	p_end timestamp
) RETURNS date LANGUAGE plpgsql STABLE AS $$
BEGIN
	RETURN (
		SELECT c."month"
		FROM public."closed_month_employee" c
		WHERE c."employee_id" = p_employee_id
			AND c."reopened_at" IS NULL
			AND p_start < c."range_end"
			AND (p_end IS NULL OR p_end >= c."range_start")
		ORDER BY c."range_start"
		LIMIT 1
	);
END;
$$;--> statement-breakpoint
-- The first closed month an absence's local days touch, even in part.
CREATE FUNCTION "closed_month_touching_days"(
	p_employee_id uuid,
	p_start_date date,
	p_end_date date
) RETURNS date LANGUAGE plpgsql STABLE AS $$
BEGIN
	RETURN (
		SELECT c."month"
		FROM public."closed_month_employee" c
		WHERE c."employee_id" = p_employee_id
			AND c."reopened_at" IS NULL
			AND p_start_date <= (c."month" + interval '1 month' - interval '1 day')::date
			AND p_end_date >= c."month"
		ORDER BY c."month"
		LIMIT 1
	);
END;
$$;--> statement-breakpoint
-- A delete is part of erasing the whole employee or organization once that
-- parent row is already gone.
CREATE FUNCTION "closed_month_erasing"(p_organization_id text, p_employee_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
	RETURN NOT EXISTS (SELECT 1 FROM public."employee" WHERE "id" = p_employee_id)
		OR (
			p_organization_id IS NOT NULL
			AND NOT EXISTS (SELECT 1 FROM public."organization" WHERE "id" = p_organization_id)
		);
END;
$$;--> statement-breakpoint
CREATE FUNCTION "closed_month_guard_work_period"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	v_month date;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW.employee_id, NEW.organization_id, NEW.clock_in_id, NEW.clock_out_id,
		NEW.start_time, NEW.end_time, NEW.duration_minutes, NEW.is_active,
		NEW.project_id, NEW.task_id, NEW.is_billable, NEW.work_category_id,
		NEW.work_location_type, NEW.approval_status, NEW.deleted_at
	) IS NOT DISTINCT FROM (
		OLD.employee_id, OLD.organization_id, OLD.clock_in_id, OLD.clock_out_id,
		OLD.start_time, OLD.end_time, OLD.duration_minutes, OLD.is_active,
		OLD.project_id, OLD.task_id, OLD.is_billable, OLD.work_category_id,
		OLD.work_location_type, OLD.approval_status, OLD.deleted_at
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
$$;--> statement-breakpoint
CREATE TRIGGER "closed_month_guard_work_period" BEFORE INSERT OR UPDATE OR DELETE ON "work_period"
	FOR EACH ROW EXECUTE FUNCTION "closed_month_guard_work_period"();--> statement-breakpoint
CREATE FUNCTION "closed_month_guard_time_entry"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	v_month date;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW.employee_id, NEW.organization_id, NEW.type, NEW.timestamp,
		NEW.utc_offset_minutes, NEW.timezone, NEW.timezone_source,
		NEW.replaces_entry_id, NEW.is_superseded, NEW.superseded_by_id
	) IS NOT DISTINCT FROM (
		OLD.employee_id, OLD.organization_id, OLD.type, OLD.timestamp,
		OLD.utc_offset_minutes, OLD.timezone, OLD.timezone_source,
		OLD.replaces_entry_id, OLD.is_superseded, OLD.superseded_by_id
	) THEN
		RETURN NEW;
	END IF;
	IF TG_OP <> 'INSERT' THEN
		v_month := public.closed_month_touching_work(OLD.employee_id, OLD.timestamp, OLD.timestamp);
		IF v_month IS NOT NULL
			AND NOT (TG_OP = 'DELETE' AND public.closed_month_erasing(OLD.organization_id, OLD.employee_id))
		THEN
			PERFORM public.closed_month_refuse(v_month);
		END IF;
	END IF;
	IF TG_OP <> 'DELETE' THEN
		v_month := public.closed_month_touching_work(NEW.employee_id, NEW.timestamp, NEW.timestamp);
		IF v_month IS NOT NULL THEN
			PERFORM public.closed_month_refuse(v_month);
		END IF;
		RETURN NEW;
	END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "closed_month_guard_time_entry" BEFORE INSERT OR UPDATE OR DELETE ON "time_entry"
	FOR EACH ROW EXECUTE FUNCTION "closed_month_guard_time_entry"();--> statement-breakpoint
-- Canonical work and break records; an absence's canonical record follows its
-- `absence_entry`, which is guarded by its local days.
CREATE FUNCTION "closed_month_guard_time_record"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	v_month date;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW.employee_id, NEW.organization_id, NEW.record_kind, NEW.start_at, NEW.end_at,
		NEW.duration_minutes, NEW.approval_state
	) IS NOT DISTINCT FROM (
		OLD.employee_id, OLD.organization_id, OLD.record_kind, OLD.start_at, OLD.end_at,
		OLD.duration_minutes, OLD.approval_state
	) THEN
		RETURN NEW;
	END IF;
	IF TG_OP <> 'INSERT' AND OLD.record_kind <> 'absence' THEN
		v_month := public.closed_month_touching_work(OLD.employee_id, OLD.start_at, OLD.end_at);
		IF v_month IS NOT NULL
			AND NOT (TG_OP = 'DELETE' AND public.closed_month_erasing(OLD.organization_id, OLD.employee_id))
		THEN
			PERFORM public.closed_month_refuse(v_month);
		END IF;
	END IF;
	IF TG_OP <> 'DELETE' THEN
		IF NEW.record_kind <> 'absence' THEN
			v_month := public.closed_month_touching_work(NEW.employee_id, NEW.start_at, NEW.end_at);
			IF v_month IS NOT NULL THEN
				PERFORM public.closed_month_refuse(v_month);
			END IF;
		END IF;
		RETURN NEW;
	END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "closed_month_guard_time_record" BEFORE INSERT OR UPDATE OR DELETE ON "time_record"
	FOR EACH ROW EXECUTE FUNCTION "closed_month_guard_time_record"();--> statement-breakpoint
-- Absences by their local days. Their organization may still be unset on old
-- rows (a canonical backfill fills it), so it is not frozen.
CREATE FUNCTION "closed_month_guard_absence_entry"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	v_month date;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW.employee_id, NEW.category_id, NEW.start_date, NEW.start_period,
		NEW.end_date, NEW.end_period, NEW.status, NEW.sick_detail
	) IS NOT DISTINCT FROM (
		OLD.employee_id, OLD.category_id, OLD.start_date, OLD.start_period,
		OLD.end_date, OLD.end_period, OLD.status, OLD.sick_detail
	) THEN
		RETURN NEW;
	END IF;
	IF TG_OP <> 'INSERT' THEN
		v_month := public.closed_month_touching_days(OLD.employee_id, OLD.start_date, OLD.end_date);
		IF v_month IS NOT NULL
			AND NOT (TG_OP = 'DELETE' AND public.closed_month_erasing(OLD.organization_id, OLD.employee_id))
		THEN
			PERFORM public.closed_month_refuse(v_month);
		END IF;
	END IF;
	IF TG_OP <> 'DELETE' THEN
		v_month := public.closed_month_touching_days(NEW.employee_id, NEW.start_date, NEW.end_date);
		IF v_month IS NOT NULL THEN
			PERFORM public.closed_month_refuse(v_month);
		END IF;
		RETURN NEW;
	END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "closed_month_guard_absence_entry" BEFORE INSERT OR UPDATE OR DELETE ON "absence_entry"
	FOR EACH ROW EXECUTE FUNCTION "closed_month_guard_absence_entry"();
