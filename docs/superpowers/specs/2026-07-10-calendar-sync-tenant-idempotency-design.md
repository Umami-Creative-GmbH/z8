# Calendar Sync Tenant Idempotency Design

## Goal

Prevent calendar synchronization jobs from accessing another organization's data and prevent concurrent or retried create jobs from producing duplicate Google or Microsoft 365 events.

## Scope

This is a focused correction for tenant ownership and external create idempotency. It does not redesign calendar synchronization around an outbox, add stale-action ordering, preserve deletion tombstones, change retry semantics, or change the current single-connection processing behavior.

## Root Causes

`CalendarSyncJobData` omits `organizationId`, so the worker cannot establish a tenant boundary from the job payload. The processor selects a connection by employee ID and an absence by absence ID independently. A malformed or stale payload can therefore combine a connection from one organization or employee with an absence from another.

Create processing checks local `synced_absence` state before calling the provider, but it records the provider event only after the external request succeeds. Concurrent workers can both pass the local check and create separate events. A worker crash after provider success but before local persistence produces the same duplicate on retry. The local unique constraint cannot prevent either external side effect.

## Queue And Tenant Scope

`organizationId` becomes required in `CalendarSyncJobData`. Every calendar queue producer supplies the organization already available in its authenticated or domain context.

The processor selects an active, push-enabled connection by both `organizationId` and `employeeId`. Create and update absence reads require `absenceId`, `employeeId`, and `organizationId` to match, and organization-owned joins such as the absence category are constrained to the same organization. A mismatched payload must result in no provider access.

The existing `synced_absence` table does not need an organization column for this focused change. Its records are accessed only after the processor has established a scoped connection and, where required, a scoped absence. Delete processing remains bound to the scoped connection and the requested absence ID.

## External Idempotency

For each create, the processor derives a stable 64-character lowercase hexadecimal SHA-256 key from:

```text
organizationId + calendarConnectionId + absenceId
```

Including the connection keeps events distinct when separate external calendars process the same absence. Including the organization prevents identifier reuse across tenants. Hexadecimal output complies with Google Calendar's caller-supplied event ID alphabet and length requirements.

The provider create contract accepts this idempotency key:

- Google Calendar sends it as the event resource `id`. If Google returns `409 Conflict` for that deterministic ID, the provider treats the operation as successful and returns the known ID so local state can recover.
- Microsoft 365 sends it as the event resource `transactionId`, using Microsoft Graph's duplicate-POST protection. The normal Graph response supplies the external event ID for local persistence.

Existing `synced_absence` mappings keep their provider-generated event IDs. The deterministic key applies when a new external event must be created, so no data migration or external-event backfill is required.

## Local Convergence

After provider creation, the processor writes `synced_absence` with an insert that updates the existing `(absenceEntryId, calendarConnectionId)` row on conflict. Both concurrent workers therefore converge on the same externally idempotent event instead of one failing on the local unique constraint.

The upsert records the external event ID, calendar ID, optional ETag, `synced` status, `create` action, timestamps, and clears prior sync errors. The existing early return for an already-synced local mapping remains as the inexpensive sequential path.

## Error Handling

Missing scoped connections remain successful no-op jobs. Missing or mismatched scoped absence data returns a failed job result without contacting a provider. Logs include organization, employee, absence, action, and connection identifiers but no OAuth credentials or event contents.

Google `409 Conflict` is accepted only in the deterministic create path, where the requested event ID is already known. Other Google and Microsoft provider failures continue through the existing provider error handling. Broader BullMQ retry behavior is intentionally outside this change.

## Testing

Tests are written first and run in red-green-refactor cycles.

Queue producer tests verify that every calendar job includes `organizationId`.

Processor tests verify that:

- connection lookup includes organization and employee scope;
- absence lookup includes organization, employee, and absence scope;
- cross-organization and cross-employee payloads make no provider request;
- repeated or concurrent create handling uses the stable key and conflict-safe local persistence.

Provider tests verify that:

- identical organization, connection, and absence inputs produce the same key;
- changing any key component changes the result;
- Google sends a valid deterministic event `id` and recovers from duplicate `409` responses;
- Microsoft sends the deterministic value as `transactionId`.

Focused Vitest suites run after each implementation step. The completed calendar change also runs the relevant broader tests and project type/lint checks available without external credentials.

## Non-Goals And Residual Risks

This design does not correct pre-existing orphaned external events, hard-delete races, stale create/update/delete ordering, fire-and-forget enqueue loss, swallowed worker retries, token refresh races, or processing only one of multiple active provider connections. Those are separate reliability improvements and are not required to close the reported tenant leak and duplicate-create paths.
