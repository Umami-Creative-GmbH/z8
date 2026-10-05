-- Yearly custom holidays recur on their saved UTC calendar date.
-- Repair stale, missing and malformed rules without changing dates or assignments.
DO $$
DECLARE
	target_organization text;
BEGIN
	FOR target_organization IN
		SELECT DISTINCT organization_id FROM holiday WHERE recurrence_type = 'yearly' ORDER BY organization_id
	LOOP
		-- Match the application's compact JSON organization configuration guard key.
		PERFORM pg_advisory_xact_lock(hashtextextended(
			format('["work-organization-configuration",%s]', to_json(target_organization)::text), 0
		));
		UPDATE holiday
		SET recurrence_rule = format('{"month":%s,"day":%s}', EXTRACT(MONTH FROM start_date)::integer, EXTRACT(DAY FROM start_date)::integer),
			updated_at = timezone('UTC', CURRENT_TIMESTAMP)
		WHERE organization_id = target_organization
			AND recurrence_type = 'yearly'
			AND recurrence_rule IS DISTINCT FROM format('{"month":%s,"day":%s}', EXTRACT(MONTH FROM start_date)::integer, EXTRACT(DAY FROM start_date)::integer);
	END LOOP;
END $$;
