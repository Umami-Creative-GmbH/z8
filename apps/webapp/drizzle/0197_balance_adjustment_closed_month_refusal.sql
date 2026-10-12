-- Closed months (#762, Time Tracking ADR-0004) cover balance adjustments too
-- (spec #804): the database refuses recording an adjustment, or cancelling
-- one, whose day lies in a closed month of its employee, as the backstop
-- behind the store's typed "month closed" refusal. The day is a local date in
-- the employee's effective timezone, so it is matched by calendar month, as
-- absence days are. Every other update and every delete stays with
-- `balance_adjustment_guard_insert_only` (0193): the foreign keys clearing a
-- deleted user and the cascade erasing an employee or organization pass.
--
-- The refusal raises SQLSTATE Z8M01 with the month (`YYYY-MM`) as its detail
-- (`closed_month_refuse`, 0191).
CREATE FUNCTION "closed_month_guard_balance_adjustment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
	v_month date;
BEGIN
	IF TG_OP = 'UPDATE' AND NOT (OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL) THEN
		RETURN NEW;
	END IF;
	v_month := public.closed_month_touching_days(NEW.employee_id, NEW.day, NEW.day);
	IF v_month IS NOT NULL THEN
		PERFORM public.closed_month_refuse(v_month);
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "closed_month_guard_balance_adjustment" BEFORE INSERT OR UPDATE ON "balance_adjustment"
	FOR EACH ROW EXECUTE FUNCTION "closed_month_guard_balance_adjustment"();
