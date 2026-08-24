# Better Auth 1.7 Account Migration

## Preconditions

- Use Node.js 22.12 or newer for Better Auth CLI commands.
- Back up `account`, `user`, and `sso_provider`.
- Stop all authentication, account-linking, setup, admin, and background account writes.
- Do not run this migration while an old application instance can insert accounts.

## Inventory

```sql
SELECT provider_id, COUNT(*) FROM account GROUP BY provider_id ORDER BY provider_id;

SELECT
  provider_id,
  issuer,
  oidc_config IS NOT NULL AS has_oidc_config,
  saml_config IS NOT NULL AS has_saml_config
FROM sso_provider
ORDER BY provider_id;

SELECT provider_id
FROM sso_provider
WHERE
  (oidc_config IS NOT NULL AND (oidc_config::jsonb #> '{mapping}') ? 'id')
  OR (saml_config IS NOT NULL AND (saml_config::jsonb #> '{mapping}') ? 'id');
```

The final query must return zero rows. If it does not, obtain a trusted old-to-new subject mapping from the identity provider and stop this deployment. Never map by email.

## Dry Run

- Restore a production snapshot into an isolated PostgreSQL database.
- Apply all pending Drizzle migrations there.
- Confirm the issuer migration reports no unmapped providers or collisions.
- Exercise credential, social, OIDC, and SAML sign-in against the isolated environment.

## Apply

- Keep authentication writes stopped.
- Apply the reviewed Drizzle migration through the normal deployment migration runner.
- Deploy the Better Auth 1.7 application and generated schema together.

## Verify Before Restoring Traffic

```sql
SELECT COUNT(*) FROM account WHERE issuer IS NULL OR btrim(issuer) = '';

SELECT issuer, account_id, COUNT(*), COUNT(DISTINCT user_id)
FROM account
GROUP BY issuer, account_id
HAVING COUNT(*) > 1 OR COUNT(DISTINCT user_id) > 1;

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'account' AND indexdef LIKE '%issuer%account_id%';
```

The first two queries must return zero problem rows. The final query must show the unique issuer/account index.

## Functional Checks

- Email/password sign-in and password reset.
- Google, GitHub, LinkedIn, and Apple sign-in when configured.
- Organization-specific social linking and account unlinking.
- Session retrieval with active organization fields.
- TOTP enrollment and sign-in.
- Passkey registration and sign-in.
- OIDC and SAML SP-initiated sign-in.
- SAML IdP-initiated sign-in.
- Custom-domain callback and cookie origins.
- Rate limiting and single-use verification state.
- SCIM controls are unavailable and all legacy SCIM tables/data remain intact.
