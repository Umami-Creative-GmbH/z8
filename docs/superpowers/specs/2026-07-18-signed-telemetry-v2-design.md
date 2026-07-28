# Z8 Signed Telemetry Protocol v2 Design

## Goal

Update the Z8 telemetry sender to produce, authenticate, and retry protocol v2 reports exactly as required by the telemetry receiver. The implementation must preserve exact request bytes across idempotent retries while generating fresh authentication material for every attempt.

## Scope

This change covers:

- Protocol v2 payload construction and local validation.
- Persistent deployment UUID and Ed25519 key-pair initialization.
- Exact-body hashing and Ed25519 request signing.
- Protocol-aware HTTP retry and error handling.
- Wiring the existing telemetry cron processor to the sender.
- Automated tests for protocol, persistence, transport, and cron behavior.

The receiver, receiver-side public-key registration, UI for key management, and collection of `api_requests_24h` are outside this change. Operators register the public key emitted when the deployment key pair is first generated.

## Architecture

`apps/webapp/src/lib/telemetry.ts` remains the application-facing telemetry module. It is responsible for aggregate metric collection, persistent deployment identity and key initialization, creation of one immutable report per scheduled run, HTTP attempts, retry policy, and structured logging.

A new `apps/webapp/src/lib/telemetry-protocol.ts` module owns the security-sensitive wire protocol:

- Protocol v2 wire types.
- Payload validation.
- One-time JSON serialization and UTF-8 encoding.
- Raw-body size enforcement.
- SHA-256 body hashing.
- Nonce generation.
- Six-line canonical signed-content construction.
- Ed25519 signing and signature-format checks.

Keeping protocol operations separate makes byte-level behavior directly testable without database or network dependencies. The existing audit-export signing provider will not be reused because it belongs to an organization-level export subsystem and returns a richer domain object that does not match telemetry request signing.

The telemetry cron processor in `apps/webapp/src/lib/cron/registry.ts` will replace its placeholder with calls to deployment initialization, metric collection, and report sending.

## Persistent Deployment Identity

On first use, telemetry initialization creates:

- A lowercase UUID v4 deployment ID.
- An Ed25519 private key encoded as PKCS#8 PEM.
- The corresponding public key encoded as canonical standard base64 of DER SPKI bytes.

The deployment ID remains in the existing `deployment_id` system configuration entry. The private and public key are stored together under a new `telemetry_signing_key` entry as JSON with exactly `version: 1`, `private_key_pkcs8_pem`, and `public_key_spki_base64`. Keeping the pair in one row prevents concurrent initialization from persisting a private key from one pair and a public key from another. Initialization uses insert-if-absent followed by re-read semantics for both entries so concurrent workers converge on stored values instead of overwriting or rotating deployment identity. The implementation must also handle the upgrade case where a valid deployment ID already exists but key material does not.

The canonical base64 SPKI public key is logged once when a new key pair is successfully persisted so an operator can register it with the telemetry receiver. Private key material is never logged. Invalid stored deployment IDs, mismatched public/private keys, or malformed key material fail closed and require operator correction; the sender must not silently rotate an established identity.

## Payload

The wire payload is:

```json
{
  "version": "2.0",
  "deployment_id": "<lowercase UUID v4>",
  "timestamp": "<RFC 3339 timestamp with offset>",
  "metrics": {
    "active_users_24h": 0,
    "total_organizations": 0,
    "total_employees": 0,
    "sessions_created_24h": 0,
    "license_type": "community"
  }
}
```

`api_requests_24h` is optional and omitted until Z8 has a reliable aggregate source. `license_type` is restricted to `community` or `enterprise`; current metric collection emits `community`.

Every numeric metric must be an integer from 0 through 2,147,483,647. The deployment ID must be UUID v4, the version must equal `2.0`, and the report timestamp must be no more than 48 hours old and no more than five minutes in the future.

The report timestamp is created once at the external time boundary as a UTC RFC 3339 string ending in `Z`, which is a valid explicit offset. Protocol-window validation and retry-delay calculations use `Temporal.Instant`; native `Date` is limited to parsing or emitting external HTTP/RFC 3339 values where required.

## Exact Body Handling

For each report, the sender performs these operations once:

1. Construct and validate the v2 payload.
2. Call `JSON.stringify` once.
3. UTF-8 encode the resulting string.
4. Reject the report if the raw bytes exceed 65,536 bytes.
5. Calculate and retain the lowercase SHA-256 hex digest of those bytes.

The retained bytes and hash are reused for every HTTP attempt. The sender never parses, reconstructs, or reserializes the payload during retries. The exact retained bytes are passed directly to `fetch` as the request body.

## Authentication

Every HTTP attempt generates fresh authentication material:

- `X-Z8-Signed-At`: the current UTC RFC 3339 timestamp ending in `Z`.
- `X-Z8-Nonce`: 16 cryptographically random bytes encoded as exactly 32 lowercase hexadecimal characters.
- `X-Z8-Signature`: canonical standard base64 of the 64-byte Ed25519 signature.

The signed content is exactly:

```text
POST
/api/telemetry
<deployment UUID>
<signed-at>
<nonce>
<lowercase SHA-256 body hash>
```

The six lines are joined with one LF character and have no trailing newline. The resulting string is UTF-8 encoded and signed with the deployment private key using Ed25519.

The request is sent to `https://telemetry.z8-time.app/api/telemetry` with `Content-Type: application/json` and all four authentication headers. The header deployment ID exactly matches the lowercase body deployment ID.

## Retry Policy

One report allows at most three total attempts, preserving the existing sender limit and remaining below the receiver's ten-active-nonce limit. Each retry keeps the deployment ID, report timestamp, exact body bytes, and body hash unchanged. It generates a new signed-at timestamp, nonce, and signature.

Retryable conditions are:

- Network connection failures.
- Request timeouts.
- HTTP 503.
- HTTP 429.

For HTTP 429, `Retry-After` controls the delay. Both delta-seconds and HTTP-date values are supported. If the header is absent or invalid, the normal bounded exponential delay applies. HTTP 503 and transient network failures use bounded exponential delays. HTTP 400, 401, 409, 413, and other non-success statuses fail immediately.

An HTTP 200 response is successful only when its JSON body contains a valid deployment ID matching the request, a boolean `idempotent`, and a valid `recorded_at` timestamp. Both new reports and idempotent exact retries count as success.

## Error Handling And Logging

The public `sendTelemetryReport` function retains its boolean result contract. It returns `true` for a valid new or idempotent success response and `false` after a terminal failure or exhausted retries.

Receiver error responses are parsed defensively. Structured failure logs include, when available:

- HTTP status.
- Stable receiver error code.
- Receiver `request_id`.
- `X-Request-Id` response header.
- Deployment ID.
- Attempt count and error category.

Logs never include the private key, raw signature, signed content, nonce, or request body. A malformed error response does not hide the original HTTP status. Local validation and key failures are classified separately from network, timeout, and receiver failures.

## Cron Integration

The `cron:telemetry` processor will:

1. Obtain or initialize the deployment identity and signing key.
2. Calculate aggregate telemetry metrics.
3. Send one immutable report through the v2 sender.
4. Return a successful cron result only when the receiver returns a valid HTTP 200 response.

The telemetry schedule changes from every 15 minutes to once daily at UTC midnight (`0 0 * * *`). This matches the documented telemetry cadence and avoids routine requests inside the receiver's rolling 12-hour acceptance window. Existing visibility behavior remains unchanged.

## Testing

Protocol unit tests will verify:

- Exact snake_case payload shape and exact `2.0` version.
- Metric integer bounds, license enum, UUID v4, and report timestamp windows.
- Single serialization, UTF-8 byte reuse, and the 65,536-byte limit.
- Lowercase SHA-256 output.
- Exact six-line canonical content with LF separators and no trailing newline.
- Exactly 32 lowercase hexadecimal nonce characters.
- Canonical base64 64-byte Ed25519 signatures verified against a known/generated key pair.

Sender tests will verify:

- Correct endpoint, headers, and exact body bytes.
- Stable body, report timestamp, and body hash across retries.
- Fresh nonce and signature on every attempt.
- Network, timeout, 503, and 429 retries.
- Delta-seconds and HTTP-date `Retry-After` handling.
- Immediate termination for 400, 401, 409, and 413.
- Validation of new and idempotent success responses.
- Structured receiver error handling without secret leakage.

Persistence and integration tests will verify:

- Concurrent-safe initialization of the deployment UUID and key pair.
- Upgrade initialization for an existing valid deployment ID.
- Failure on malformed or mismatched stored identity/key material.
- Canonical SPKI public-key storage and one-time logging.
- Cron invocation of initialization, metric collection, and sending.
- Daily UTC cron scheduling, with no 15-minute telemetry schedule remaining.

## Compatibility And Security

The existing deployment ID is preserved when valid. The public sender result remains boolean. No tenant data or organization-level secret is introduced; telemetry identity is deployment-scoped system configuration.

The design fails closed on identity and signing errors, never logs signing secrets, uses cryptographically secure randomness, signs exact transmitted bytes, and limits retry attempts so the client cannot exceed the receiver nonce budget by itself.
