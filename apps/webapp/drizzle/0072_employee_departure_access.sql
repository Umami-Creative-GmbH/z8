-- Single source of truth for whether a departure may take effect. The
-- executor persists this reason as a blocked outcome; access checks use it so a
-- due owner is not denied while the executor would block the departure.
-- Mirrors the owner-invariant triggers from 0054: roles are comma-separated and
-- an owner/admin is accessible while approved and not linked to an inactive
-- employee profile in the organization.
CREATE OR REPLACE FUNCTION "employee_departure_blocked_reason"(
	p_organization_id text,
	p_target_user_id text,
	p_initiator_user_id text
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
	WITH "facts" AS (
		SELECT
			EXISTS (
				SELECT 1 FROM public."member" AS m
				WHERE m."organization_id" = p_organization_id AND m."user_id" = p_initiator_user_id
					AND m."status" = 'approved'
					AND 'owner' = ANY(regexp_split_to_array(COALESCE(m."role", ''), '\s*,\s*'))
					AND NOT EXISTS (
						SELECT 1 FROM public."employee" AS e
						WHERE e."organization_id" = m."organization_id" AND e."user_id" = m."user_id"
							AND e."is_active" = false
					)
			) AS initiator_is_owner,
			EXISTS (
				SELECT 1 FROM public."member" AS m
				WHERE m."organization_id" = p_organization_id AND m."user_id" = p_initiator_user_id
					AND m."status" = 'approved'
					AND 'admin' = ANY(regexp_split_to_array(COALESCE(m."role", ''), '\s*,\s*'))
					AND NOT EXISTS (
						SELECT 1 FROM public."employee" AS e
						WHERE e."organization_id" = m."organization_id" AND e."user_id" = m."user_id"
							AND e."is_active" = false
					)
			) AS initiator_is_admin,
			EXISTS (
				SELECT 1 FROM public."member" AS m
				WHERE m."organization_id" = p_organization_id AND m."user_id" = p_target_user_id
					AND m."status" = 'approved'
					AND 'owner' = ANY(regexp_split_to_array(COALESCE(m."role", ''), '\s*,\s*'))
			) AS target_is_owner,
			EXISTS (
				SELECT 1 FROM public."member" AS m
				WHERE m."organization_id" = p_organization_id AND m."user_id" <> p_target_user_id
					AND m."status" = 'approved'
					AND 'owner' = ANY(regexp_split_to_array(COALESCE(m."role", ''), '\s*,\s*'))
					AND NOT EXISTS (
						SELECT 1 FROM public."employee" AS e
						WHERE e."organization_id" = m."organization_id" AND e."user_id" = m."user_id"
							AND e."is_active" = false
					)
			) AS has_alternative_owner
	)
	SELECT CASE
		WHEN NOT (initiator_is_owner OR initiator_is_admin) THEN 'initiator_authorization_lost'
		WHEN target_is_owner AND NOT initiator_is_owner THEN 'owner_authorization_required'
		WHEN target_is_owner AND NOT has_alternative_owner THEN 'final_accessible_owner'
	END
	FROM "facts";
$$;
--> statement-breakpoint
-- True while a pending departure is due and would take effect: access ends at
-- the intended cutoff even if no worker has materialized the departure yet.
CREATE OR REPLACE FUNCTION "employee_departure_denies_access"(
	p_organization_id text,
	p_employee_id uuid,
	p_now timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM public."employee_departure" AS d
		JOIN public."employee" AS e
			ON e."id" = d."employee_id" AND e."organization_id" = d."organization_id"
		WHERE d."organization_id" = p_organization_id
			AND d."employee_id" = p_employee_id
			AND d."status" = 'pending'
			AND d."cutoff_at" <= p_now
			AND "employee_departure_blocked_reason"(p_organization_id, e."user_id", d."created_by") IS NULL
	);
$$;
