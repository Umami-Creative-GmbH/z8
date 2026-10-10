-- Public API (#763, Public API ADR 0001): an API key belongs to its
-- organization and acts as it. Keys used to belong to the admin who created
-- them (reference_id = user id), with the organization, scopes and rate limit
-- only in their metadata. Each key now references the organization from its
-- metadata, keeps its creator for attribution, stores its v1 scopes as key
-- permissions (unsupported scopes are dropped) and gets the rate limit its
-- admin chose. A key without a known organization could never be used or
-- listed; it is deleted. Key ids become UUIDs so audit entries can name them.
DO $$
DECLARE
	r record;
	meta jsonb;
	org_id text;
	creator_id text;
	perms jsonb;
BEGIN
	FOR r IN SELECT * FROM "apikey" FOR UPDATE LOOP
		BEGIN
			meta := r.metadata::jsonb;
			-- Older plugin versions stored metadata JSON-encoded twice.
			IF jsonb_typeof(meta) = 'string' THEN
				meta := (meta #>> '{}')::jsonb;
			END IF;
		EXCEPTION WHEN others THEN
			meta := NULL;
		END;
		IF meta IS NULL OR jsonb_typeof(meta) <> 'object' THEN
			meta := '{}'::jsonb;
		END IF;

		org_id := meta ->> 'organizationId';
		IF org_id IS NULL AND EXISTS (SELECT 1 FROM "organization" WHERE "id" = r.reference_id) THEN
			-- Already owned by its organization.
			org_id := r.reference_id;
		END IF;
		IF org_id IS NULL OR NOT EXISTS (SELECT 1 FROM "organization" WHERE "id" = org_id) THEN
			DELETE FROM "apikey" WHERE "id" = r.id;
			CONTINUE;
		END IF;

		creator_id := meta ->> 'createdBy';
		IF creator_id IS NULL AND EXISTS (SELECT 1 FROM "user" WHERE "id" = r.reference_id) THEN
			creator_id := r.reference_id;
		END IF;

		IF r.reference_id = org_id AND r.permissions IS NOT NULL THEN
			perms := r.permissions::jsonb;
		ELSE
			SELECT coalesce(jsonb_object_agg(resource, actions), '{}'::jsonb)
			INTO perms
			FROM (
				SELECT split_part(scope, ':', 1) AS resource,
					jsonb_agg(split_part(scope, ':', 2) ORDER BY ordinal) AS actions
				FROM (
					SELECT v.scope, v.ordinal
					FROM unnest(ARRAY[
						'time-entries:read',
						'absences:read',
						'absences:read-health',
						'employees:read',
						'projects:read',
						'customers:read'
					]) WITH ORDINALITY AS v(scope, ordinal)
					WHERE jsonb_typeof(meta -> 'scopes') = 'array'
						AND (meta -> 'scopes') ? v.scope
				) granted
				GROUP BY split_part(scope, ':', 1)
			) grouped;
		END IF;

		UPDATE "apikey" SET
			"id" = CASE
				WHEN r.id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN r.id
				ELSE gen_random_uuid()::text
			END,
			"reference_id" = org_id,
			"name" = coalesce(nullif(meta ->> 'displayName', ''), r.name),
			"permissions" = perms::text,
			"metadata" = CASE
				WHEN creator_id IS NULL THEN '{}'
				ELSE jsonb_build_object('createdBy', creator_id)::text
			END,
			"rate_limit_enabled" = CASE
				WHEN jsonb_typeof(meta -> 'rateLimitEnabled') = 'boolean'
					THEN (meta ->> 'rateLimitEnabled')::boolean
				ELSE r.rate_limit_enabled
			END,
			"rate_limit_max" = CASE
				WHEN jsonb_typeof(meta -> 'rateLimitMax') = 'number'
					THEN (meta ->> 'rateLimitMax')::numeric::integer
				ELSE r.rate_limit_max
			END,
			"rate_limit_time_window" = CASE
				WHEN jsonb_typeof(meta -> 'rateLimitTimeWindow') = 'number'
					THEN (meta ->> 'rateLimitTimeWindow')::numeric::integer
				ELSE r.rate_limit_time_window
			END
		WHERE "id" = r.id;
	END LOOP;
END $$;
