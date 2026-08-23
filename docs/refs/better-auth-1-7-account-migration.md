# Better Auth 1.7 Account Migration

This runbook covers the production migration to issuer-scoped Better Auth 1.7 account identities. Complete it during an authentication maintenance window. Node.js 22.12 or newer is required for the Better Auth CLI.

## Before The Window

1. Back up the `account`, `user`, and `sso_provider` tables and verify that the backups can be restored.
2. Run the migration and all checks against a recent production snapshot. Resolve every unknown provider, missing trusted issuer, and identity collision before scheduling production.
3. Build an explicit, reviewed provider-to-issuer map. Use trusted provider metadata or protocol identifiers only. Never map or merge users by email, display name, authorization endpoint, or another mutable attribute.
4. Prepare a trusted old-to-new subject mapping for any SSO provider that previously used `mapping.id`.
5. Confirm the deployment uses Node.js 22.12 or newer and contains the reviewed application and migration artifacts.

## Read-Only Inventory

Run these queries against the target database before the maintenance window. They return identifiers and configuration presence only. Do not select credentials, tokens, `oidc_config`, `saml_config`, or their raw JSON values into inventory output.

Inventory account providers:

```sql
SELECT provider_id, COUNT(*) AS account_count
FROM account
GROUP BY provider_id
ORDER BY provider_id;
```

Inventory SSO identifiers, trusted issuer values, and configuration presence without exposing raw configuration:

```sql
SELECT
  provider_id,
  issuer,
  oidc_config IS NOT NULL AS has_oidc_config,
  saml_config IS NOT NULL AS has_saml_config
FROM sso_provider
ORDER BY provider_id;
```

Detect providers whose legacy OIDC or SAML configuration contains a custom `mapping.id`. This reports presence only, never the mapping value or raw configuration:

```sql
SELECT
  provider_id,
  CASE
    WHEN oidc_config IS NOT NULL
      THEN COALESCE((oidc_config::jsonb -> 'mapping') ? 'id', FALSE)
    ELSE FALSE
  END AS has_oidc_mapping_id,
  CASE
    WHEN saml_config IS NOT NULL
      THEN COALESCE((saml_config::jsonb -> 'mapping') ? 'id', FALSE)
    ELSE FALSE
  END AS has_saml_mapping_id
FROM sso_provider
WHERE
  (oidc_config IS NOT NULL AND COALESCE((oidc_config::jsonb -> 'mapping') ? 'id', FALSE))
  OR (saml_config IS NOT NULL AND COALESCE((saml_config::jsonb -> 'mapping') ? 'id', FALSE))
ORDER BY provider_id;
```

Store inventory output in an access-controlled location. It must not contain secrets, bearer tokens, certificates, client secrets, or raw OIDC/SAML configuration.

## Maintenance Window

1. Stop all authentication traffic and every account writer, including sign-in, sign-up, account linking, password and social-account creation, admin APIs, background jobs, and direct database writers.
2. Confirm the `account`, `user`, and `sso_provider` backups completed successfully.
3. Re-run the read-only inventory and compare it with the reviewed provider and subject maps. Abort on an unknown provider or missing trusted SSO identity.
4. Apply the reviewed migration through the normal production deployment migration process. Do not use `auth:migrate` or `drizzle-kit push` against production or any shared database.
5. Keep writers stopped until every database and functional check below passes.

## Database Verification

Require zero accounts with a null or blank issuer:

```sql
SELECT COUNT(*) AS invalid_issuer_count
FROM account
WHERE issuer IS NULL OR BTRIM(issuer) = '';
```

Require zero duplicate issuer-scoped identities:

```sql
SELECT issuer, account_id, COUNT(*) AS account_count
FROM account
GROUP BY issuer, account_id
HAVING COUNT(*) > 1;
```

Require one unique index whose ordered columns are exactly `(issuer, account_id)`:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = current_schema()
  AND tablename = 'account'
  AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
  AND indexdef ~* '\\(issuer, account_id\\)';
```

Abort the deployment if any invalid issuer or duplicate is returned, or if the unique index is absent. Do not repair identities by matching email.

## Functional Verification

Before restoring traffic, verify:

- Credential sign-in and password reset.
- Every configured built-in social-provider sign-in.
- Organization-specific social account linking and unlinking.
- Session retrieval and organization-scoped session fields.
- TOTP enrollment and sign-in.
- Passkey registration and sign-in.
- OIDC SSO sign-in.
- SAML SP-initiated sign-in.
- SAML IdP-initiated sign-in.
- Custom-domain callbacks, trusted origins, and cookies.
- Rate limiting and single-use verification storage behavior.
- SCIM controls and endpoints are unavailable while all legacy SCIM data remains preserved.

Restore traffic and account writers only after the database and functional verification is complete.
