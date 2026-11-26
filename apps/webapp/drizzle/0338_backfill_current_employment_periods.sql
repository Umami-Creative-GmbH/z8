-- Joining now opens the first period in its transaction. Repair current roster
-- members who joined before that change using the existing date and kind rules.
DO $$
DECLARE
	target record;
BEGIN
	FOR target IN
		SELECT e.organization_id, e.id
		FROM public.employee AS e
		WHERE e.is_active
			AND NOT public.employee_departure_denies_access(e.organization_id, e.id, now())
			AND NOT EXISTS (
				SELECT 1 FROM public.employee_employment_period AS p
				WHERE p.organization_id = e.organization_id AND p.employee_id = e.id
			)
	LOOP
		BEGIN
			PERFORM public.employee_employment_period_backfill_legacy(target.organization_id, target.id);
		EXCEPTION WHEN unique_violation OR exclusion_violation THEN
			-- A live lifecycle write may have opened the period after selection.
			IF NOT EXISTS (
				SELECT 1 FROM public.employee_employment_period AS p
				WHERE p.organization_id = target.organization_id AND p.employee_id = target.id
			) THEN
				RAISE;
			END IF;
		END;
	END LOOP;
END
$$;
