# Scaleway Key Manager Secret Store Provider Design

## Context

Z8 currently stores organization-scoped, customer-entered secrets through `apps/webapp/src/lib/vault/secrets.ts`. Callers import `storeOrgSecret`, `getOrgSecret`, and related helpers from `@/lib/vault` or `@/lib/vault/secrets`. These helpers are used by settings and integrations such as SMTP, SSO, Slack, Telegram, Turnstile, export storage, payroll export connectors, and audit export signing keys.

The Scaleway migration should replace Vault for these customer-entered web UI secrets when configured, while keeping server-side and system-level configuration injected through environment variables. Scaleway Secret Manager must not be used for customer-created application secrets, because it is reserved for platform/runtime secrets such as database credentials. Scaleway Key Manager is used only for cryptographic keys and cryptographic operations.

## Goals

- Add an environment variable that selects the organization secret storage backend.
- Support both the existing HashiCorp Vault backend and Scaleway Key Manager-backed encrypted Postgres storage.
- Keep all existing customer-entered secret call sites using the same helper functions.
- Preserve organization scoping in every secret path.
- Avoid automatic cross-provider fallback so migration mistakes do not silently read stale secrets.
- Use one Scaleway Key Manager key per Z8 organization when the Scaleway provider is enabled.

## Non-Goals

- Do not move server-side platform settings, database settings, object storage credentials, or Scaleway credentials into the app secret store.
- Do not migrate existing Vault secrets automatically.
- Do not change the public settings UI behavior beyond routing saves and reads to the configured provider.
- Do not introduce tenant-specific environment variables.
- Do not store customer-created secrets in Scaleway Secret Manager.
- Do not store a global customer-secret encryption key in an environment variable.

## Configuration

Add `SECRET_STORE_PROVIDER` as a server-side env var with allowed values:

- `vault`, the default for current deployments.
- `scaleway`, for deployments using Scaleway Key Manager-backed encrypted Postgres storage.

Scaleway access credentials, project/region identifiers, and API endpoint settings remain system-level env vars injected by the existing deployment process. They are not organization-specific and are not configured from the web UI. The app uses these credentials to call Scaleway Key Manager APIs, not to retrieve customer secrets from Scaleway Secret Manager.

Add these server-side env vars for Scaleway mode:

- `SCALEWAY_ACCESS_KEY`
- `SCALEWAY_SECRET_KEY`
- `SCALEWAY_PROJECT_ID`
- `SCALEWAY_REGION`, defaulting to `fr-par` if not set
- `SCALEWAY_KEY_MANAGER_API_URL`, optional and defaulting to `https://api.scaleway.com`

Environment validation should be conditional. When `SECRET_STORE_PROVIDER=scaleway`, startup must fail if `SCALEWAY_ACCESS_KEY`, `SCALEWAY_SECRET_KEY`, or `SCALEWAY_PROJECT_ID` are missing. The existing `@t3-oss/env-nextjs` setup can enforce this with a refinement on the server env schema. When `SECRET_STORE_PROVIDER=vault` or unset, the Scaleway env vars remain optional.

The Scaleway IAM credentials should be least-privilege and limited to Key Manager actions needed by the app: list/get key metadata, create key, encrypt, and decrypt. They should not need Scaleway Secret Manager permissions.

## Architecture

Introduce an internal secret-store provider abstraction behind the existing `@/lib/vault` exports. The public helper API remains:

- `storeOrgSecret(organizationId, key, value)`
- `getOrgSecret(organizationId, key)`
- `deleteOrgSecret(organizationId, key)`
- `deleteAllOrgSecrets(organizationId)`
- `hasOrgSecret(organizationId, key)`
- `storeOrgSecrets(organizationId, secrets)`

The selector chooses the provider once from `SECRET_STORE_PROVIDER`. Existing Vault code becomes the Vault provider implementation. A new Scaleway provider implements the same contract by encrypting values with an organization-specific Scaleway Key Manager key and storing ciphertext in Postgres.

## Scaleway Key Model

When `SECRET_STORE_PROVIDER=scaleway`, each Z8 organization gets its own Scaleway Key Manager symmetric encryption key. The key should use `symmetric_encryption: aes_256_gcm`, which supports direct `encrypt` and `decrypt` operations and authenticated associated data.

The app stores only Scaleway key metadata in Postgres:

- `organizationId`
- `provider`
- `scalewayKeyId`
- `region`
- `createdAt`
- `disabledAt`

The Scaleway key material never lives in Z8 Postgres or environment variables. The provider is responsible for automatic organization key provisioning. Before storing the first secret for an organization, it must check whether key metadata already exists in Z8 Postgres. If metadata exists, it should verify that the Scaleway key is still present and usable. If no local metadata exists, it should query Scaleway Key Manager for an existing key tagged or named for that Z8 organization. Only when neither local metadata nor a matching Scaleway key exists should it create a new key.

Key names and tags should include stable, non-secret metadata such as the Z8 organization ID to support lookup and operations. The creation flow should persist discovered or newly created key metadata in Postgres before writing encrypted secrets.

Automatic key provisioning must be idempotent:

- Concurrent first writes for the same organization should not create multiple active organization keys.
- The database should enforce one active Scaleway key metadata row per organization.
- If Scaleway returns an already-existing matching key, the provider should reuse it rather than creating another key.
- If local metadata points to a missing, disabled, deleted, or unusable Scaleway key, saving a secret should fail with a clear operational error instead of silently creating a second active key.

## Encrypted Postgres Storage

Add an organization-scoped encrypted secret table for the Scaleway provider. The table stores encrypted customer values, not plaintext:

- `organizationId`
- `key`, the existing logical secret path such as `email/smtp_password` or `sso/{providerId}/client_secret`
- `ciphertext`, returned by Scaleway Key Manager
- `provider`, set to `scaleway`
- `kmsKeyId`, the Scaleway key used for encryption
- `createdAt`
- `updatedAt`

The table should enforce uniqueness on `(organizationId, key)` and should not include any plaintext value columns.

## Secret Naming

The logical namespace stays the same as today:

```text
organizations/{organizationId}/{key}
```

Examples:

```text
organizations/org_123/email/smtp_password
organizations/org_123/sso/provider_456/client_secret
organizations/org_123/audit/signing_key_private
```

In Vault mode, this logical namespace maps to the existing Vault paths. In Scaleway mode, it maps to the `(organizationId, key)` row identity in Postgres and to Key Manager associated data.

The Scaleway provider should send associated data with every encrypt and decrypt request. The associated data binds ciphertext to its intended organization and logical key, for example:

```text
organizationId={organizationId};key={key};version=1
```

This prevents ciphertext copied from another organization or key path from decrypting under the wrong context.

## Data Flow

On save, existing settings actions call `storeOrgSecret`. Vault mode writes the value to Vault using the existing organization-scoped logical path. Scaleway mode ensures the organization has a usable Scaleway Key Manager key by checking local metadata, looking up an existing Scaleway key for the organization when metadata is absent, and creating a key only when none exists. It then encrypts the value through Key Manager with associated data and upserts the ciphertext row in Postgres.

On read, existing integration code calls `getOrgSecret`. Vault mode reads from Vault. Scaleway mode loads the encrypted row from Postgres, decrypts the ciphertext through Scaleway Key Manager with the same associated data, and returns plaintext only in memory to the caller. Missing secrets return `null`.

On delete, existing settings actions call `deleteOrgSecret` or `deleteAllOrgSecrets`. Vault mode deletes from Vault. Scaleway mode deletes encrypted rows from Postgres and ignores missing rows. Organization key deletion or disabling is a separate lifecycle operation and should not happen during individual secret deletion.

## Error Handling

Vault mode preserves current behavior:

- Save throws if Vault is unavailable or write fails.
- Read returns `null` when Vault is unavailable or the secret is missing, and throws for unexpected read failures.
- Delete skips unavailable Vault and ignores missing secrets.

Scaleway mode should mirror those semantics as closely as possible:

- Save throws when Scaleway Key Manager is misconfigured, unavailable, rejects key lookup, rejects key creation, finds unusable existing key metadata, or rejects encryption.
- Read returns `null` for missing rows and throws for unexpected decrypt failures, including associated-data mismatches and disabled/deleted organization keys.
- Delete ignores missing secrets and throws for unexpected deletion failures.
- Logs must never include plaintext secret values, ciphertext bodies, Scaleway API tokens, or decrypted key material.

## Migration Behavior

Provider selection is exclusive. If `SECRET_STORE_PROVIDER=scaleway`, reads and writes use encrypted Postgres rows plus Scaleway Key Manager only. If existing production secrets are in Vault, they must be migrated separately before switching the env var. This avoids accidental stale reads and makes deployment state explicit.

Key rotation should be handled explicitly. Rotating a Scaleway organization key can make future encryptions use the new key version while existing ciphertext remains decryptable through Key Manager if Scaleway supports versioned decrypt for prior rotations. Any re-encryption workflow should be a separate operational task.

## Testing

- Unit-test provider selection for default `vault` and explicit `scaleway`.
- Unit-test Scaleway organization key creation and lookup behavior.
- Unit-test idempotent key provisioning when local metadata exists, when only a remote matching key exists, and when no key exists.
- Unit-test associated data construction from `organizationId` and logical secret key.
- Unit-test Scaleway store/read/delete behavior with mocked Key Manager and database responses.
- Keep existing caller tests stable by preserving exported helper names.
- Add focused coverage for missing rows, decrypt failures, key creation failures, and unexpected provider errors.

## Open Decisions Resolved

- The Scaleway backend is for all customer-entered organization secrets, not just audit export keys.
- Server-side/system settings continue to come from injected environment variables.
- Existing helper imports remain valid to keep the change minimal and reduce risk.
- Scaleway Secret Manager is intentionally not used for customer-created secrets.
- The Scaleway design uses one Key Manager key per Z8 organization and encrypted rows in Postgres.
