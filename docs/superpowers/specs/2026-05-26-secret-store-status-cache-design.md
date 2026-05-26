# Secret Store Status Cache Design

## Context

The organization email settings page at `/settings/enterprise/email` still reads and renders Vault-specific availability state. When `SECRET_STORE_PROVIDER=scaleway`, organization secrets are stored through the Scaleway-backed provider, but the page can still show a misleading Vault unavailable warning.

## Goals

- Show provider-accurate secret-store status on the email configuration page.
- In Scaleway mode, report whether the current organization already has a usable generated Scaleway Key Manager key.
- Avoid provisioning a Scaleway key from a settings page read.
- Cache Scaleway status in Redis for fast repeated reads.
- Expire cached status once per day.
- Preserve existing Vault behavior when `SECRET_STORE_PROVIDER=vault`.

## Non-Goals

- Do not migrate secrets between Vault and Scaleway.
- Do not create Scaleway organization keys from status checks.
- Do not cache plaintext secrets or ciphertext values.
- Do not change email provider save, test, or delete semantics beyond status display and cache invalidation.

## Approach

Use a provider-neutral secret-store status API. The email page should request secret-store status for the current organization instead of Vault status. The returned status should include the configured provider, an availability boolean, and enough detail for UI copy.

For Vault mode, wrap the existing `getVaultStatus()` result into the neutral status shape. The UI can continue showing Vault-specific connected, unavailable, or sealed messages.

For Scaleway mode, run an organization-scoped, non-provisioning check:

- Read the active `organizationSecretKey` row for the organization where `provider = 'scaleway'` and `disabledAt IS NULL`.
- If no row exists, return unavailable with a reason indicating that no organization key has been generated yet.
- If a row exists, call Scaleway Key Manager `getKey` for the stored key ID.
- Treat the key as available only when it is enabled, uses `aes_256_gcm`, and has the expected `z8-customer-secrets` and `z8-org:{organizationId}` tags.
- Return unavailable for missing, disabled, incompatible, or unreachable remote keys without leaking credentials or secret values.

## Redis Cache

Cache only the status result, never secret material. Use a Redis key scoped by provider and organization, for example:

```text
secret-store-status:scaleway:{organizationId}
```

Set the TTL to `86400` seconds. A cache hit should skip database and Scaleway API checks. If Redis is unavailable, fall back to the live check and continue without caching.

Invalidate the cached Scaleway status after successful secret writes and deletes for that organization. This keeps the page responsive after first key provisioning from a save while still satisfying the once-a-day automatic expiry requirement.

## UI Behavior

Rename the client prop and component concepts from `vaultStatus` to `secretStoreStatus`. The alert should be provider-aware:

- Vault available: show the existing secure Vault connected message.
- Vault unavailable or sealed: show the existing Vault-specific warning.
- Scaleway available: show that the organization Scaleway key is available and secrets are stored through Scaleway Key Manager-backed encryption.
- Scaleway unavailable because no key exists: show a non-Vault message explaining that the organization key has not been generated yet and will be created when a secret is saved.
- Scaleway unavailable because the remote key is invalid or unreachable: show a Scaleway-specific warning that secret storage cannot be verified.

## Error Handling

The status check should be defensive and read-only. It should not throw into the email settings page for expected unavailability. Unexpected errors should be logged with organization ID, provider, and non-secret identifiers only, then mapped to an unavailable status.

Secret save and delete operations should continue throwing or returning errors as they do today. Cache invalidation should be best-effort and must not fail the user operation.

## Testing

Add focused tests for:

- Vault mode preserving the current status mapping.
- Scaleway mode returning unavailable when no active organization key row exists.
- Scaleway mode returning available when local key metadata exists and the remote key is enabled and compatible.
- Scaleway mode returning unavailable when the remote key is missing, disabled, incompatible, or the API call fails.
- Redis cache hit avoiding database and Scaleway calls.
- Redis cache miss storing the computed status with a one-day TTL.
- Successful Scaleway secret writes/deletes invalidating the organization status cache.
