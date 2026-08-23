# Better Auth 1.7 Core Migration Design

## Summary

Z8 has upgraded its Better Auth packages to 1.7.1, but the webapp still contains Better Auth 1.6 configuration, schema, storage, and client API contracts. This migration will complete the production-safe core upgrade while separating the incompatible SCIM 1.7 cutover into dedicated follow-up work.

The core release will migrate account identity to issuer-scoped keys, update Better Auth configuration and callers, add required atomic storage operations, update SSO/SAML integration, regenerate the auth schema, and disable the legacy SCIM integration without deleting its data.

## Goals

- Make the webapp's active Better Auth configuration valid for 1.7.
- Preserve existing credential, social, and SSO account ownership.
- Add the required non-null `account.issuer` and unique `(issuer, accountId)` identity key safely.
- Update changed account, two-factor, SAML, database-join, and storage contracts.
- Keep all Better Auth runtime and CLI packages on the same 1.7 patch.
- Prevent legacy SCIM endpoints from running until a separate SCIM cutover is complete.
- Provide migration guards and verification steps that fail before unsafe identity changes are applied.

## Non-Goals

- Migrating legacy SCIM records to Better Auth 1.7 connection models.
- Rotating SCIM credentials or reprovisioning directory users and groups.
- Enabling trusted proxy headers before deployment infrastructure is verified.
- Adding OAuth Provider, MCP, Device Authorization, Generic OAuth, One Tap, SIWE, Electron, Expo, magic-link, email-OTP, or Better Auth Stripe features.
- Refactoring unrelated authentication or organization code.

## Release Boundary

The migration is one coordinated core-auth release applied during an authentication maintenance window. It includes application changes, an explicit Drizzle SQL migration, generated Better Auth schema changes, and verification.

SCIM is removed from the active Better Auth server and client configuration in this release. SCIM management controls and actions are hidden or return an explicit unavailable result, so removed Better Auth 1.6 endpoints cannot be invoked. Existing SCIM tables, credentials, logs, application mappings, and provisioned users are not dropped or rewritten.

Trusted forwarded headers remain disabled. The deployment must confirm whether the public hostname is available in the ordinary `Host` header or only through sanitized proxy headers before a future change enables `advanced.trustedProxyHeaders`.

## Package And CLI Alignment

All Better Auth packages used by the webapp will be pinned to the same 1.7 patch rather than mixing exact and caret ranges. The auth generation script will use the same CLI version instead of `auth@latest`, preventing future generated schemas from silently using a newer contract.

The selected CLI version requires Node.js 22.12 or newer. Schema generation and migration documentation will state this requirement.

## Account Identity Migration

### Required Model

Better Auth 1.7 identifies an external account by `(issuer, accountId)`:

- `account.id` remains the local Better Auth account-row identifier.
- `account.accountId` remains the immutable provider-side subject.
- `account.providerId` remains the local provider configuration identifier.
- `account.issuer` becomes required.

The migration preserves the existing physical `account_id` column. It does not rename it or replace it with the local row ID.

### Migration Sequence

The Drizzle migration will use PostgreSQL-safe staged operations:

1. Add `account.issuer` as nullable.
2. Backfill credential rows with `issuer = 'local:credential'` and normalize their provider subject to the linked `user_id`.
3. Backfill built-in social providers from an explicit, reviewed provider-to-issuer map. Issuer-bearing providers use their trusted issuer. Plain OAuth providers use `local:oauth:${encodeURIComponent(providerId)}`.
4. Backfill SSO rows only where persisted provider metadata supplies the exact trusted OIDC issuer or SAML IdP entity ID.
5. Abort if any account has a null or empty issuer.
6. Abort if any `(issuer, account_id)` pair has more than one row or maps to more than one user.
7. Set `issuer` to `NOT NULL`.
8. Create the unique compound index on `(issuer, account_id)`.

The provider map must be explicit in the migration and reviewed against the deployed provider configuration. The migration must not infer identity from email, display name, authorization endpoint, or another mutable or unverified value. Unknown providers cause the migration to fail rather than receiving a guessed issuer.

### Operational Preconditions

Before applying the migration, operators must:

- Stop authentication writes, account-linking requests, direct account inserts, and relevant background/admin jobs.
- Back up the `account` and `user` tables.
- Inventory every distinct persisted `provider_id` and compare it with the migration's explicit map.
- Prepare trusted old-to-new subjects for any SSO provider that previously used a custom OIDC/SAML `mapping.id`.
- Dry-run the null-issuer and collision checks against a production snapshot.

The migration is not considered successful until no account has a null or empty issuer and the unique compound index exists.

### Application Writers And Selectors

Every direct account insert will supply the appropriate `issuer`. This includes credential setup and organization-specific social OAuth linking.

Account unlinking will send only the local `account.id` as Better Auth's `accountId` selector. It will no longer send `providerId`, and it will not confuse the local row ID with provider-side `account.accountId`.

No current callers use the changed `getAccessToken`, `refreshToken`, or `accountInfo` selectors. This will be confirmed by a repository search during implementation.

## Better Auth Configuration

Database joins move from `experimental.joins` to `advanced.database.joins`. Generated Drizzle relations will be regenerated and reviewed after this change.

The existing wrapped Drizzle adapter remains based on the official 1.7 adapter and only overrides `findOne`. Its spread behavior will be tested to ensure 1.7 adapter operations, including atomic operations, are retained.

Dynamic `baseURL.allowedHosts`, the trusted fallback URL, and custom-domain origin validation remain in place. `advanced.trustedProxyHeaders` remains disabled until the reverse proxy is confirmed to overwrite and sanitize forwarded headers.

## Secondary Storage

The guarded Redis secondary storage will implement Better Auth 1.7's required atomic operations:

- `increment(key, ttl)` atomically increments a counter and initializes expiry without extending an existing window incorrectly.
- `getAndDelete(key)` atomically returns and removes a single-use value.

The guarded wrapper will preserve its failure policy for session and verification data while exposing these operations with the Better Auth contract. Implementations will use Redis atomic primitives or transactions rather than separate read/write/delete calls.

Tests will cover concurrent increments, first-write TTL initialization, subsequent increment behavior, missing keys, single-use reads, and storage failures.

## Two-Factor Authentication

TOTP enrollment will explicitly use and narrow Better Auth 1.7's discriminated response. The caller reads `totpURI` and `backupCodes` only when `method === 'totp'`. Unexpected methods or missing data produce a controlled setup error instead of accessing fields from the OTP response variant.

Existing TOTP issuer, backup-code length, and backup-code count remain unchanged.

## Enterprise SSO And SAML

SAML provider creation will pass uploaded metadata through the Better Auth 1.7 `idpMetadata.metadata` shape. Manual configurations without metadata must provide `idpMetadata.entityID` and a valid signing-certificate source.

The settings UI will display the new ACS URL:

`/api/auth/sso/saml2/sp/acs/:providerId`

Existing IdP-initiated SAML behavior remains explicitly enabled with `allowIdpInitiated: true`. Strict signature, response-correlation, timestamp, RelayState, and logout behavior remain enabled unless tests or a known IdP requirement justify a focused change.

OIDC accounts use the verified issuer and `sub`; SAML accounts use the IdP entity ID and signed `NameID`. Persisted providers are audited for removed custom `mapping.id` values before the account backfill. The migration will not use email to replace an old SSO subject.

The application does not currently consume SAML certificate response fields or partially update SSO mappings. Repository searches will verify those assumptions during implementation.

## SCIM Staging Boundary

Better Auth 1.7 SCIM is a replacement architecture requiring connection modes, new credentials, identity callbacks, projections, incompatible tables, and full directory reprovisioning. It will not be treated as a generated-schema upgrade.

For the core migration:

- Remove the incompatible 1.6 `scim()` configuration from active auth plugins.
- Remove the SCIM client plugin if one is active.
- Hide SCIM management controls or return an explicit temporarily unavailable state from server actions.
- Preserve all legacy SCIM tables and application extension tables.
- Preserve provisioned users, organization memberships, teams, employees, logs, and mappings.
- Do not accept or rotate legacy SCIM credentials through Better Auth 1.7.

A separate design will choose plugin-managed or application-owned connections, inventory legacy users and account rows, define retain/recreate dispositions, rotate credentials, migrate admin APIs and UI, and coordinate complete user/group reprovisioning.

## Error Handling

Migration errors fail closed:

- Unknown providers abort issuer backfill.
- Missing trusted SSO metadata aborts issuer backfill.
- Null or empty issuers abort constraint creation.
- Identity collisions abort index creation.
- Unexpected two-factor response methods abort enrollment cleanly.
- Missing or invalid SAML metadata is returned as a validation error.
- Disabled SCIM operations return an explicit unavailable result and perform no mutation.
- Atomic storage failures follow the existing guarded storage policy and are logged without exposing secrets.

No compatibility fallback will guess issuers, merge users by email, invoke removed SCIM endpoints, or trust forwarded headers implicitly.

## Testing And Verification

### Automated Tests

Focused tests will cover:

- Provider-to-issuer mapping and unknown-provider rejection.
- Credential account subject normalization.
- Null, empty, and duplicate identity migration guards.
- Direct credential and organization-social account inserts including issuer.
- Account unlink payloads using local account row IDs.
- Redis atomic increment, TTL, and get-and-delete behavior.
- Preservation of wrapped Drizzle adapter methods.
- TOTP response narrowing and error handling.
- SAML metadata request shape and ACS URL display.
- Disabled SCIM UI/action behavior and absence of legacy endpoint calls.

### Repository Verification

Implementation verification will run:

- Focused Vitest suites for changed modules.
- Full `pnpm test` where feasible.
- `pnpm run typecheck`.
- Auth schema generation with the pinned 1.7 CLI, followed by generated-diff review.
- Drizzle migration tests and migration metadata checks.
- `CI=true pnpm build`.

### Deployment Verification

Before restoring traffic, verify:

- Zero null or empty account issuers.
- Zero duplicate `(issuer, account_id)` identities.
- Presence of the required unique index.
- Email/password sign-in and password reset.
- Each configured built-in social-provider sign-in.
- Organization-specific social linking and account unlinking.
- Session retrieval and organization-scoped fields.
- TOTP enrollment and sign-in.
- Passkey registration and sign-in.
- OIDC SSO and SAML SP-initiated sign-in.
- SAML IdP-initiated sign-in because Z8 explicitly enables it.
- Custom-domain callback and cookie origins.
- Rate limiting and single-use verification state.
- SCIM controls are unavailable and legacy data remains untouched.

## Follow-Up Work

Create a dedicated Better Auth 1.7 SCIM cutover design and runbook. It must choose a connection mode, define immutable provisioning domains, inventory all legacy SCIM-owned records, decide retained-user mappings, generate new credentials, replace management APIs and UI, apply the new SCIM schema with native transactions, and coordinate complete directory reprovisioning.
