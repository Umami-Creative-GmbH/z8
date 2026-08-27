ALTER TABLE "enterprise_identity_setup" ALTER COLUMN "scim" SET DEFAULT '{"policy":{"autoActivateUsers":false,"deprovisionAction":"suspend","defaultRoleTemplateId":null},"connection":null}'::jsonb;--> statement-breakpoint
UPDATE "enterprise_identity_setup"
SET "scim" = '{"policy":{"autoActivateUsers":false,"deprovisionAction":"suspend","defaultRoleTemplateId":null},"connection":null}'::jsonb
WHERE CASE
	WHEN "scim" IS NULL OR "scim" = 'null'::jsonb THEN true
	WHEN "scim" = 'false'::jsonb THEN true
	WHEN jsonb_typeof("scim") <> 'object' THEN false
	WHEN NOT ("scim" ? 'enabled') THEN false
	WHEN "scim" -> 'enabled' = 'null'::jsonb THEN true
	WHEN "scim" -> 'enabled' = 'false'::jsonb THEN true
	WHEN jsonb_typeof("scim" -> 'enabled') = 'string' THEN
		lower(btrim("scim" ->> 'enabled')) IN ('false', 'f', '0', 'no', 'n', 'off', 'disabled')
	WHEN jsonb_typeof("scim" -> 'enabled') = 'number' THEN ("scim" ->> 'enabled')::numeric = 0
	ELSE false
END;--> statement-breakpoint
-- Enabled or ambiguous legacy state is invalidated, never activated.
UPDATE "enterprise_identity_setup"
SET "scim" = '{"policy":{"autoActivateUsers":false,"deprovisionAction":"suspend","defaultRoleTemplateId":null},"connection":null}'::jsonb
WHERE NOT (
	jsonb_typeof("scim") = 'object'
	AND "scim" ? 'policy'
	AND "scim" ? 'connection'
);
