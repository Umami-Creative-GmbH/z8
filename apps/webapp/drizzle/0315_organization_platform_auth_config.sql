-- #1885: sign-in methods for an organization's canonical platform domain
-- (<slug>.<platform root>), which has no organization_domain row. No row means
-- the defaults in lib/domain/host-auth-config.ts.
CREATE TABLE IF NOT EXISTS "organization_platform_auth_config" (
	"organization_id" text PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
	"auth_config" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- An empty social provider list used to show every provider on the sign-in page,
-- while the settings dialog showed none ticked. It now shows none. Custom domains
-- saved with an empty list keep showing what they showed before.
UPDATE "organization_domain"
SET "auth_config" = jsonb_set(
	"auth_config"::jsonb,
	'{socialProvidersEnabled}',
	'["google","github","linkedin","apple"]'::jsonb
)::text
WHERE "auth_config" ~ '^\s*\{.*"socialProvidersEnabled"\s*:\s*\[\s*\]'
	AND "auth_config" ~ '\}\s*$';
