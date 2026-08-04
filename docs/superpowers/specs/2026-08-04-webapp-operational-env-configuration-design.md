# Webapp Operational Environment Configuration Design

## Goal

Make deployment-sensitive server-side operational constants configurable through `apps/webapp/src/env.ts` while preserving current behavior when no new environment variables are set.

## Scope

The migration covers hardcoded values that operators may need to tune for infrastructure capacity, latency, reliability, or storage usage:

- Queue health timeout, retry attempts, retry backoff, and completed/failed job retention
- Redis reconnect attempts, reconnect timing, request retries, health timeout, and log throttling
- SMTP connection, greeting, and socket timeouts
- Turnstile request timeout, but not the provider endpoint
- Webhook retry delays, maximum attempts, request timeout, and stored response-body limit
- Work-balance, Clockodo import, and export batch or concurrency controls
- Upload size and S3 multipart part-size limits
- Job execution retention
- Domain configuration and secret-store status cache TTLs

All telemetry constants and telemetry target configuration are explicitly excluded.

The following are also excluded:

- Vendor API endpoints
- Session, authorization, OAuth, and linking TTLs
- Commercial and product limits such as trial duration or API-key quotas
- Organization deletion grace policy
- Browser polling intervals and other client-side values
- Protocol constants, cryptographic parameters, identifiers, UI dimensions, and algorithm-local limits

## Configuration Model

Each migrated behavior receives a descriptive server-only environment variable in `apps/webapp/src/env.ts`. Variables remain separate when their current values happen to match but their meanings differ. For example, queue and general Redis health checks retain independent timeout settings so operators can tune one without silently changing the other.

Numeric variables use decimal strings at the process boundary, matching the existing `REDIS_COMMAND_TIMEOUT_MS` convention. The Zod schema validates positive integers and applies the current hardcoded value as the default. Runtime consumers convert validated strings to numbers where needed. Existing API constraints receive corresponding bounds when the constraint is known.

Webhook retry delays use a comma-separated list of non-negative integer milliseconds. As with other variables, an empty environment value is treated as unset and receives the default. Validation rejects malformed entries, negative values, and a list whose length cannot support the configured maximum attempts.

No variable is exposed through the `client` schema or given a `NEXT_PUBLIC_` prefix.

## Environment Variables

The implementation will add these exact server environment variables:

| Variable | Default |
| --- | ---: |
| `QUEUE_HEALTH_TIMEOUT_MS` | `1000` |
| `QUEUE_JOB_ATTEMPTS` | `3` |
| `QUEUE_JOB_BACKOFF_DELAY_MS` | `1000` |
| `QUEUE_COMPLETED_JOB_RETENTION_COUNT` | `100` |
| `QUEUE_COMPLETED_JOB_RETENTION_SECONDS` | `86400` |
| `QUEUE_FAILED_JOB_RETENTION_COUNT` | `500` |
| `QUEUE_FAILED_JOB_RETENTION_SECONDS` | `604800` |
| `REDIS_MAX_RECONNECT_ATTEMPTS` | `8` |
| `REDIS_LOG_THROTTLE_MS` | `30000` |
| `REDIS_MAX_RETRIES_PER_REQUEST` | `1` |
| `REDIS_RECONNECT_BASE_DELAY_MS` | `100` |
| `REDIS_RECONNECT_MAX_DELAY_MS` | `2000` |
| `REDIS_HEALTH_TIMEOUT_MS` | `1000` |
| `SMTP_CONNECTION_TIMEOUT_MS` | `10000` |
| `SMTP_GREETING_TIMEOUT_MS` | `10000` |
| `SMTP_SOCKET_TIMEOUT_MS` | `30000` |
| `TURNSTILE_TIMEOUT_MS` | `5000` |
| `WEBHOOK_RETRY_DELAYS_MS` | `0,1000,5000,30000,120000,600000` |
| `WEBHOOK_MAX_ATTEMPTS` | `6` |
| `WEBHOOK_TIMEOUT_MS` | `30000` |
| `WEBHOOK_MAX_RESPONSE_BODY_LENGTH` | `10240` |
| `WORK_BALANCE_JOB_BATCH_LIMIT` | `1000` |
| `CLOCKODO_IMPORT_QUERY_CHUNK_SIZE` | `500` |
| `CLOCKODO_IMPORT_CONCURRENCY` | `4` |
| `EXPORT_FETCH_BATCH_SIZE` | `1000` |
| `TUS_MAX_UPLOAD_SIZE_BYTES` | `10485760` |
| `IMAGE_MAX_UPLOAD_SIZE_BYTES` | `10485760` |
| `TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES` | `10485760` |
| `TUS_MULTIPART_PART_SIZE_BYTES` | `8388608` |
| `JOB_EXECUTION_RETENTION_DAYS` | `90` |
| `DOMAIN_CACHE_TTL_SECONDS` | `300` |
| `SECRET_STORE_STATUS_CACHE_TTL_SECONDS` | `86400` |

The three upload limits remain independent despite sharing the same default because they protect different workflows and may diverge later.

## Code Changes

`apps/webapp/src/env.ts` remains the sole process-environment boundary. Each new variable is declared in the server schema and mapped explicitly in `runtimeEnv`.

Consumers import `env` from `@/env` and replace their hardcoded operational values with validated configuration. Existing exported constants remain exported only when they are part of an internal module interface; otherwise they are removed or replaced directly at the use site. No consumer reads `process.env` directly.

The migration must preserve units used by each external API. Values are named with unit suffixes such as `_MS`, `_SECONDS`, `_DAYS`, or `_BYTES` to prevent accidental conversion errors. The webhook response limit retains the existing `_LENGTH` terminology because the current implementation truncates JavaScript string length rather than UTF-8 bytes.

## Error Handling

Invalid configured values fail during environment validation with the relevant variable name and a specific message. Defaults ensure deployments without the new variables retain current behavior.

Cross-field validation enforces webhook consistency. Runtime code does not silently repair, clamp, or fall back from explicitly invalid values.

## Testing

Tests will cover:

- Every new variable has the documented current value as its default
- Valid overrides reach the relevant consumer configuration
- Zero, negative, malformed, and out-of-range values fail validation where prohibited
- Webhook retry-delay and attempt settings are mutually consistent
- Migrated production files use `@/env` rather than direct `process.env` access
- Existing focused queue, Redis, SMTP, webhook, upload, import/export, cleanup, and cache tests continue to pass

The implementation will run targeted tests first, then webapp type checking or the repository's closest available static check, followed by the broader relevant test suite.

## Compatibility

This is backward compatible for deployments because every new variable defaults to the exact value used before migration. No database, tenant setting, client bundle contract, or public API changes.
