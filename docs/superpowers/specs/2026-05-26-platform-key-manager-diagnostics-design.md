# Platform Key Manager Diagnostics Design

## Context

`/platform-admin/diagnostics` already provides platform-admin-only deployment checks through a server-rendered page, a small client refresh island, and platform-admin-protected server actions. Scaleway Key Manager support already exists for organization-scoped secrets, but the platform does not yet have a reusable platform-scoped key for future system secrets or an operator-facing way to verify envelope encryption end to end.

The existing `system_config` table is the right place to store global setup state. The platform key should store the Scaleway key ID, not the generated key name, because the API returns the ID needed for later encrypt/decrypt calls.

## Goals

- Add a manual Scaleway Key Manager encryption test section to `/platform-admin/diagnostics`.
- Generate a random human-readable test value with faker when the operator presses the button.
- Ensure a platform-scoped Scaleway key exists before the test runs.
- Create a key named like `z8-platform-{nanoid}` when no platform key ID has been stored.
- Persist the returned Scaleway key ID in `system_config`.
- Encrypt and decrypt the generated test value and show whether input and output match.
- Keep all behavior platform-admin-only and avoid exposing Scaleway credentials.

## Non-Goals

- Do not build the full platform secret storage API yet.
- Do not store the generated test plaintext or ciphertext in the database.
- Do not reuse organization-scoped secret tables or pseudo organization IDs for platform data.
- Do not expose raw Scaleway access tokens, project IDs, or secret configuration in diagnostics output.

## Recommended Approach

Use a dedicated platform key service backed by `system_config`, then expose it through a diagnostics-only server action.

This keeps platform-scoped key management separate from organization-scoped customer secrets while making the key reusable for future platform secret work. It also keeps the diagnostics collector read-only; key provisioning only happens when a platform admin explicitly presses the test button.

## Architecture

Add a server-only Scaleway platform key module under `apps/webapp/src/lib/vault`. The module will use the existing `ScalewayKeyManagerClient` and provide a focused API for platform key operations:

- Read the `system_config` row with key `platform_scaleway_key_id`.
- Verify a stored key ID by fetching the remote key and checking it is enabled and compatible for platform encryption.
- If no key ID is stored, create a new Key Manager key named `z8-platform-{nanoid}`.
- Persist the returned key ID in `system_config` with a clear description.
- Encrypt and decrypt platform diagnostic values with platform-specific associated data.

The platform key must not use organization-scoped tags or `organizationSecretKey`. It should use platform-specific metadata such as a `z8-platform-secrets` tag and associated data like `scope=platform;purpose=diagnostics;version=1`.

## Data Flow

The new diagnostics card calls `testPlatformKeyManagerEncryptionAction()` when the operator presses the button.

The action flow is:

1. Require platform-admin access with `PlatformAdminService.requirePlatformAdmin()`.
2. Generate a faker person name on the server.
3. Ensure a platform Scaleway key exists.
4. Encrypt the generated name with the platform key and fixed platform associated data.
5. Decrypt the ciphertext with the same key and associated data.
6. Compare the decrypted value with the original generated value.
7. Return a serializable result to the client.

The returned result should include:

- generated input name
- decrypted output name
- `matches: boolean`
- ciphertext, or a shortened ciphertext preview if the full payload is too noisy
- platform key ID
- whether the key was created or reused

The test value and ciphertext are diagnostic artifacts only. They are safe to display to platform admins, but they should not be persisted.

## UI Design

Add a new card to `/platform-admin/diagnostics` titled "Scaleway Key Manager Encryption". It should sit below the current diagnostics sections and use the same Card, Button, Badge, and alert patterns as the existing diagnostics client.

The card should include:

- a short description that this runs an end-to-end platform key encrypt/decrypt test
- a button such as "Test encryption"
- loading state while the server action runs
- success state showing input, decrypted output, match status, key ID, key creation/reuse status, and ciphertext preview
- error state showing the safe server-action error message

The section should be responsive and accessible, with live status updates for pending, success, and failure states.

## Error Handling

If Scaleway environment configuration is missing or a Key Manager request fails, the action should return a safe error through the existing `ServerActionResult` pattern. The UI should show the error inline in the card.

If a stored platform key ID exists but the remote key is unavailable, disabled, or incompatible, the service should fail and report the problem. It should not silently create a replacement key because that could hide a broken persisted platform setup. If no platform key ID exists, the service may create and persist a new key.

Concurrent first-run tests should not create multiple platform keys. Use the same database transaction/advisory-lock style already used by the Scaleway organization provider, but scoped to a fixed platform key lock.

## Security And Multi-Tenancy

This feature is platform-scoped, not organization-scoped. It must not accept an organization ID and must not read tenant settings. All server actions must require platform-admin access before generating values, provisioning keys, or calling Scaleway.

Diagnostics output must never include Scaleway secret keys, project credentials, or raw environment values. Showing the generated faker value, decrypted value, ciphertext preview, and key ID is acceptable for platform admins because they are test artifacts or non-secret identifiers.

## Testing

Add focused tests for the platform key service, server action, and client UI.

Server-side tests should cover:

- no stored key creates a platform key and persists its returned ID
- stored key ID is verified and reused
- unusable stored key reports an error and does not create a replacement
- encrypt/decrypt success returns `matches: true`
- platform-admin authorization happens before Key Manager work
- returned data does not include Scaleway credentials

Client tests should cover:

- button pending state
- success result rendering
- mismatch or failure state rendering
- accessible status/alert behavior

## Acceptance Criteria

- `/platform-admin/diagnostics` includes a Scaleway Key Manager encryption test section.
- Pressing the test button generates a faker name server-side and runs Scaleway encrypt/decrypt.
- If no platform key ID exists in `system_config`, a key named like `z8-platform-{nanoid}` is created and its returned ID is persisted.
- If a stored platform key ID exists, it is verified and reused.
- The UI shows the input and decrypted output and clearly indicates whether they match.
- Non-platform-admin users cannot invoke the action directly.
- Scaleway credentials and other secret environment values are never returned to the client.
