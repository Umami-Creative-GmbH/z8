ALTER TABLE "account" ADD COLUMN "issuer" text;
--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN "failed_verification_count" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "two_factor" ADD COLUMN "locked_until" timestamp;
--> statement-breakpoint
DO $account_issuer_migration$
DECLARE
	sso_provider_row record;
	provider_config jsonb;
BEGIN
	-- Built-in providers must not be shadowed by a mutable SSO configuration.
	IF EXISTS (
		SELECT 1
		FROM "sso_provider"
		WHERE "provider_id" IN ('credential', 'google', 'apple', 'github', 'linkedin')
	) THEN
		RAISE EXCEPTION 'SSO provider IDs collide with built-in provider IDs';
	END IF;

	-- A custom mapping changes the persisted subject and cannot be inferred safely.
	FOR sso_provider_row IN
		SELECT "provider_id", "oidc_config", "saml_config"
		FROM "sso_provider"
	LOOP
		IF sso_provider_row.oidc_config IS NOT NULL THEN
			BEGIN
				provider_config := sso_provider_row.oidc_config::jsonb;
			EXCEPTION WHEN OTHERS THEN
				RAISE EXCEPTION 'SSO provider configuration is invalid';
			END;
			IF COALESCE((provider_config -> 'mapping') ? 'id', FALSE) THEN
				RAISE EXCEPTION 'accounts use a legacy SSO mapping.id';
			END IF;
		END IF;

		IF sso_provider_row.saml_config IS NOT NULL THEN
			BEGIN
				provider_config := sso_provider_row.saml_config::jsonb;
			EXCEPTION WHEN OTHERS THEN
				RAISE EXCEPTION 'SSO provider configuration is invalid';
			END;
			IF COALESCE((provider_config -> 'mapping') ? 'id', FALSE) THEN
				RAISE EXCEPTION 'accounts use a legacy SSO mapping.id';
			END IF;
		END IF;

		IF sso_provider_row.oidc_config IS NOT NULL AND sso_provider_row.saml_config IS NOT NULL THEN
			RAISE EXCEPTION 'SSO provider has ambiguous protocol configuration';
		END IF;
	END LOOP;

	UPDATE "account"
	SET "issuer" = 'local:credential', "account_id" = "user_id"
	WHERE "provider_id" = 'credential';

	UPDATE "account"
	SET "issuer" = CASE "provider_id"
		WHEN 'google' THEN 'https://accounts.google.com'
		WHEN 'apple' THEN 'https://appleid.apple.com'
		WHEN 'github' THEN 'local:oauth:github'
		WHEN 'linkedin' THEN 'local:oauth:linkedin'
	END
	WHERE "provider_id" IN ('google', 'apple', 'github', 'linkedin');

	UPDATE "account" AS account
	SET "issuer" = BTRIM(provider."issuer")
	FROM "sso_provider" AS provider
	WHERE account."provider_id" = provider."provider_id"
		AND provider."oidc_config" IS NOT NULL
		AND provider."saml_config" IS NULL
		AND NULLIF(BTRIM(provider."issuer"), '') IS NOT NULL;

	WITH saml_accounts AS (
		SELECT
			account."id",
			COALESCE(
				provider."saml_config"::jsonb #>> '{idpMetadata,metadata}',
				provider."saml_config"::jsonb ->> 'metadata'
			) AS metadata
		FROM "account" AS account
		JOIN "sso_provider" AS provider
			ON account."provider_id" = provider."provider_id"
		WHERE provider."saml_config" IS NOT NULL
			AND provider."oidc_config" IS NULL
	), extracted_issuers AS (
		SELECT
			"id",
			NULLIF(BTRIM(COALESCE(
				substring(metadata FROM '<[^>]*EntityDescriptor[^>]*[[:space:]]entityID[[:space:]]*=[[:space:]]*"([^"]+)"'),
				substring(metadata FROM '<[^>]*EntityDescriptor[^>]*[[:space:]]entityID[[:space:]]*=[[:space:]]*''([^'']+)''')
			)), '') AS issuer
		FROM saml_accounts
	)
	UPDATE "account" AS account
	SET "issuer" = extracted_issuers.issuer
	FROM extracted_issuers
	WHERE account."id" = extracted_issuers."id";

	IF EXISTS (
		SELECT 1
		FROM "account" AS account
		JOIN "sso_provider" AS provider
			ON account."provider_id" = provider."provider_id"
		WHERE provider."saml_config" IS NOT NULL
			AND provider."oidc_config" IS NULL
			AND (account."issuer" IS NULL OR BTRIM(account."issuer") = '')
	) THEN
		RAISE EXCEPTION 'accounts have missing or invalid SAML metadata';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "account"
		WHERE "issuer" IS NULL OR BTRIM("issuer") = ''
	) THEN
		RAISE EXCEPTION 'accounts have no trusted issuer mapping';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "account"
		GROUP BY "issuer", "account_id"
		HAVING COUNT(*) > 1 OR COUNT(DISTINCT "user_id") > 1
	) THEN
		RAISE EXCEPTION 'duplicate issuer-scoped account identities';
	END IF;
END
$account_issuer_migration$;
--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_accountId_uidx" ON "account" USING btree ("issuer","account_id");
