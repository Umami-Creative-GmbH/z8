# Temporal Timezone Consistency Design

**Date:** 2026-07-10
**Status:** Approved design
**Scope:** Temporal foundation plus Core and Telegram consistency; staged repository-wide migration afterward

## Summary

Z8 will use Temporal as the application-level date/time model. Actual events remain canonical UTC instants, local calendar concepts remain zone-free until explicitly resolved, and every display or calendar operation receives an explicit timezone owner.

The first delivery creates the Temporal foundation and migrates the high-risk Core and Telegram paths onto it. It preserves existing database columns, API payloads, integration contracts, and time-entry hash bytes. Remaining lower-risk Luxon and native `Date` call sites move in later vertical slices.

## Problem

The documented timekeeping model is sound, but the implementation selects timezones inconsistently. Depending on the feature, a displayed or queried value may use the saved user timezone, organization timezone, selected employee timezone, browser/device timezone, captured event offset, Telegram digest timezone, UTC, or the implicit host runtime timezone.

This fragmentation causes concrete defects:

- Personal UI and notifications can render in the server or browser timezone instead of the saved user timezone.
- Selected-employee calendars sometimes use viewer/runtime dates for navigation and aggregation.
- Historical time-entry endpoints are normalized to a current profile timezone instead of preserving their captured offsets.
- Work-period splitting mixes browser-local input with UTC server arithmetic.
- Custom report ranges mix organization-zone presets with browser-local selections and UTC labels.
- Scheduling converts date-only values through browser-local native `Date` operations.
- Telegram overloads `digestTimezone` as a display and query timezone for unrelated commands.
- Telegram approvals and generic notifications can format timestamps in the server timezone.
- Mobile and extension clock actions omit action-time device timezone evidence.
- Date-only values and actual instants are both commonly represented by `Date`, enabling calendar-day drift.
- A partial date-fns-token compatibility helper emits literal `p` in several calendar dialogs.

The root causes are semantic type ambiguity, competing timezone authorities, implicit runtime behavior, duplicated formatting/parsing logic, and incomplete boundary abstractions.

## Goals

- Keep actual event storage and elapsed-duration computation canonical in UTC.
- Display personal UI and personal chats in the recipient's saved timezone.
- Preserve domain-specific exceptions required for audit and workforce meaning.
- Make timezone ownership explicit and testable at every boundary.
- Use Temporal for application date/time parsing, arithmetic, comparison, boundaries, and formatting.
- Use strict primitive wire formats and retain `Date` only at required framework, database, and SDK boundaries.
- Fix the identified Core and Telegram defects without changing persisted timestamp or API formats.
- Provide staged rollback points for the rest of the repository migration.

## Non-Goals

- Changing PostgreSQL timestamp column types in the first delivery.
- Editing the generated Better Auth schema.
- Passing Temporal class instances through React Server Components, Server Actions, JSON, Drizzle, Better Auth, or third-party SDKs.
- Removing transitive Luxon dependencies owned by third-party packages.
- Migrating every low-risk audit log, settings preview, webhook log, and miscellaneous date label in the first delivery.
- Reconstructing historical audit offsets from current IANA timezone rules.

## Semantic Time Model

| Meaning | Application type | Persisted/wire form | Rules |
| --- | --- | --- | --- |
| Actual event or timestamp | `Temporal.Instant` | Drizzle `Date` or UTC ISO string | Always canonical UTC; use fixed millisecond precision at compatibility boundaries |
| Calendar date | `Temporal.PlainDate` | `YYYY-MM-DD` | Never convert through UTC midnight merely to format or compare it |
| Wall-clock time | `Temporal.PlainTime` | `HH:mm` or `HH:mm:ss` | Has no instant meaning without a date and named timezone |
| User-local date-time | `Temporal.ZonedDateTime` | Reconstructed from instant plus zone | Transient; used for display, local boundaries, and calendar arithmetic |
| Audited event-local display | `Temporal.Instant` plus captured offset | `{ instant, timezone, offsetMinutes }` | Captured offset is authoritative; IANA zone is supporting context |
| Elapsed duration | `Temporal.Duration` or integer minutes | Existing integer fields | Derived from canonical instants, never displayed wall-clock strings |

`Temporal.Instant` is the only internal representation for actual events. `Temporal.ZonedDateTime` is not the canonical persisted value.

## Timezone Ownership

Timezone resolution returns both a validated IANA/fixed-offset zone and a source. Callers do not infer domain meaning from the browser, server, or process timezone.

| Context | Authoritative timezone |
| --- | --- |
| Personal web/mobile UI | Saved user profile timezone |
| Personal Telegram commands such as `/status`, clock-in, and clock-out replies | Linked recipient's saved profile timezone |
| Personal approvals and direct notifications | Recipient's saved profile timezone |
| Single-employee calendar | Selected employee's saved profile timezone |
| Manager-created entry for another employee | Target employee's saved profile timezone |
| Organization-wide schedules, reports, coverage, and manager bot commands | Organization timezone |
| Historical clock-in/out audit endpoints | Each endpoint's captured UTC offset |
| Self-service clock capture | Validated browser/device timezone as event evidence |
| Telegram digest dispatch schedule | Persisted `digestTimezone` only for deciding send time |
| Telegram digest content and organization calendar queries | Organization timezone |

A saved `UTC` value is an intentional preference. Organization fallback applies only when no user-preference row exists. The existing behavior that treats the string `UTC` as an unset sentinel is removed.

Browser/device timezone is evidence for self-service capture, not a universal display preference. A mismatch flow may update the saved preference, continue once in the device zone, or cancel. The server validates the IANA zone and derives the exact-instant offset itself.

## Temporal Runtime Strategy

Z8 will continue using the existing `temporal-polyfill` package.

- Ordinary application modules import `Temporal` explicitly from `temporal-polyfill`.
- `temporal-polyfill/global` remains limited to Schedule-X integration points that require a global.
- `@js-temporal/polyfill` is not added alongside it.
- Every assembled runtime target that executes migrated code includes the selected polyfill: webapp, worker, migration/seed code where needed, tests, mobile, extension, and desktop if Temporal reaches it.
- Native Temporal support is not assumed because the supported Node, Safari, Hermes, extension, and Tauri environments are not uniformly compatible.

Temporal values from different implementations are never mixed. Interoperability uses canonical strings or plain records.

## Foundation Components

The Temporal foundation lives in the existing date/time library area and stays small. It provides:

- Strict parsers for instants, dates, times, and zoned wall-clock input.
- `Date` to `Temporal.Instant` and `Temporal.Instant` to `Date` adapters at Drizzle and SDK boundaries.
- Fixed-millisecond UTC serialization compatible with `Date.toISOString()`.
- Local day/week/month half-open boundary helpers.
- Explicit timezone validation and ownership resolution.
- Exact captured-offset formatting for audited time-entry endpoints.
- Named locale/time-format presets instead of arbitrary Luxon/date-fns token emulation.
- A clock abstraction whose production implementation uses `Temporal.Now.instant()` and whose tests can be deterministic.
- Primitive serializers for RSC, Server Actions, SuperJSON/JSON, queues, and external APIs.

Generic helpers must require semantic intent. A function may accept an instant or a plain date, but not an ambiguous union that silently chooses UTC or the host timezone.

## Boundary Contracts

### Database

Drizzle continues to read and write `Date` for timestamp columns. Conversion occurs immediately:

```text
Drizzle Date <-> Temporal.Instant
SQL date string <-> Temporal.PlainDate
```

Application and worker runtime timezone is pinned to UTC. PostgreSQL sessions also use UTC. Tests run with alternate host timezone settings to prove that timestamp-without-time-zone round trips remain stable.

Database type modernization, including possible conversion to `timestamp with time zone`, is a separate migration with its own reconciliation and rollback plan.

### Framework And Network

Temporal instances do not cross serialization boundaries. Supported forms are:

- Instant: UTC ISO 8601 with fixed millisecond precision, for example `2026-07-10T12:30:00.000Z`.
- Date: `YYYY-MM-DD`.
- Time: `HH:mm` or an explicitly documented seconds variant.
- Zoned/audited value: `{ instant, timezone, offsetMinutes }`.

Receiving runtimes reconstruct Temporal values after validating the primitive payload.

### External APIs

External contracts retain their native representation:

- Stripe and signature timestamps remain explicit epoch seconds.
- Drizzle and Date-based SDKs remain `Date` at their adapters.
- Telegram transport values remain JSON strings/numbers.
- ICS keeps its strict UTC timestamp and exclusive all-day end conventions.
- React Native date pickers convert local fields explicitly at the component boundary.

Seconds and milliseconds are never inferred by magnitude.

## Core Data Flows

### Standard Display

```text
Drizzle Date
  -> Temporal.Instant
  -> fixed UTC ISO wire string
  -> Temporal.Instant in client/runtime
  -> explicitly selected timezone owner
  -> localized display using locale and 12/24-hour preference
```

No step uses the implicit host timezone.

### Clock Capture

1. A self-service client records the action-time IANA device zone and submits it, including in offline queues.
2. The server validates organization membership, authorization, timestamp input where applicable, and the IANA zone.
3. The server obtains or validates the canonical instant.
4. The server derives the offset for that exact instant.
5. The existing UTC `Date`, `timezone`, `timezoneSource`, and `utcOffsetMinutes` fields are persisted transactionally.
6. Duration is computed from the canonical start and end instants.

Telegram clocking has no trustworthy browser zone. It uses the linked user's saved profile zone and routes through the same transaction-safe creation/closure path as other clocking entry points.

### Historical Time-Entry Display

Clock-in and clock-out endpoints are formatted independently with their captured offsets. Updating a profile timezone or viewing from another timezone does not change their audit wall-clock meaning. The captured IANA zone may be shown as context but does not replace the stored offset.

### Calendar And Reports

The server resolves the selected employee or organization timezone before constructing local boundaries. Local dates become half-open UTC instant ranges:

```text
local start <= event instant < next local start
```

Periods overlapping a range are selected by interval overlap, not only by start time. Cross-midnight actuals are split by local day before aggregation.

### Telegram

Bot context exposes distinct fields:

- `recipientTimezone`
- `organizationTimezone`
- `digestScheduleTimezone`
- recipient locale and time-format preference

Personal commands use the recipient timezone. Organization commands use organization calendar boundaries. The digest scheduler uses `digestScheduleTimezone` only to decide dispatch time; digest content uses organization timezone. Approval and notification formatters receive an explicit display context and cannot fall back to server-local formatting.

## DST And Ambiguity Policy

Manual wall-clock input must not silently normalize:

- Nonexistent spring-forward times are rejected with a user-facing correction message.
- Ambiguous fall-back times require an explicit earlier/later choice.
- The selected result is persisted as an instant with its exact captured offset.

Automated schedule and digest materialization uses Temporal's explicit `compatible` policy: move gap times forward by the gap and select the earlier occurrence in a fold. Dispatch jobs use an organization/date/type idempotency key so a repeated fold cannot send the same digest twice.

The UI states the timezone in which manual values are interpreted. Manager-on-behalf input always states and uses the target employee timezone.

## Validation And Failure Handling

- Profile, organization, and Telegram setting writes reject invalid IANA timezone values.
- Existing invalid persisted values emit a structured warning and fall through the domain resolver to a valid organization zone or UTC.
- Instant parsers reject zone-less date-times.
- Date parsers reject date-times.
- Wall-clock conversion requires a date, named zone, and explicit disambiguation.
- Telegram formatting errors never fall back to server-local time.
- Logs include the failed timezone and resolution source but no unrelated tenant data.
- All database queries and mutations remain organization-scoped and permission-checked.

## First Delivery Scope

### 1. Characterization And Foundation

- Capture current DB, API, hash, calendar, integration, and bot wire behavior with golden tests.
- Install the Temporal foundation and runtime setup.
- Pin server/worker and PostgreSQL session behavior to UTC.
- Add timezone ownership resolvers and validation.
- Add source guardrails for migrated modules.

### 2. Time Tracking And Calendar

- Route clocking paths, including Telegram, through shared transaction-safe capture logic.
- Preserve exact per-entry offset semantics.
- Fix calendar self-entry browser capture.
- Fix work-period splitting to interpret wall time in the displayed employee zone.
- Fix selected-employee initial date, navigation, boundaries, and date keys.
- Include periods overlapping range boundaries.
- Split cross-midnight daily actuals by selected-employee local day.
- Replace literal `p` formatting with named time presets.

### 3. Reports, Scheduling, And Approvals

- Make custom and preset report ranges use organization calendar semantics.
- Remove browser-local `Date` math from shift dates and week boundaries.
- Format approvals and correction messages in the recipient timezone.
- Ensure all migrated formatting honors locale and saved 12/24-hour preference.

### 4. Telegram And Shared Notifications

- Separate recipient, organization, and digest-schedule zones in bot context.
- Correct personal and organization command boundaries and output.
- Correct logical-date handling in `/whosout` and `/openshifts`.
- Format approvals and generic notification timestamps with explicit contexts.
- Validate Telegram digest time/timezone settings.
- Add digest idempotency across retries and DST folds.

### 5. Mobile And Extension Capture

- Submit validated action-time device timezone for online clock actions.
- Persist that timezone with offline events and replay the original value at sync time.
- Do not substitute sync-time device timezone for missing action-time evidence.

## Later Migration Slices

After Core and Telegram are stable, remaining direct application Luxon/native calendar logic migrates by vertical slice:

1. Remaining date-only absence, holiday, birthday, and dashboard paths.
2. Analytics, exports, audit displays, and webhook/log UIs.
3. Calendar integrations and ICS adapters.
4. Compliance, payroll, imports, exports, and time-record migration tooling.
5. Remaining mobile, extension, and desktop utilities.
6. Dependency cleanup and enforcement of zero direct application Luxon imports.

Luxon may remain transitively through third-party packages such as cron tooling. That does not violate the application-level target.

## Compatibility And Rollback

- Existing DB columns and values do not change in the first delivery.
- Existing API and integration payload formats do not change.
- Time-entry hash input remains byte-identical to `Date.toISOString()`, including `.000Z`.
- Each domain slice changes internal implementation behind stable adapters and can be reverted independently.
- Legacy Luxon behavior remains available only as a temporary per-slice rollback implementation until parity is proven; it is not used as an ongoing dual model.
- Database timestamp modernization is not bundled with application migration.

## Testing Strategy

### Zone Matrix

Tests cover:

- `UTC`
- `Europe/Berlin`
- `America/New_York`
- `Asia/Kathmandu`
- spring-forward gaps
- fall-back folds
- leap day and year boundaries
- month/week boundaries
- cross-midnight periods
- clock-in and clock-out in different captured offsets

### Foundation Tests

- Strict semantic parsing and invalid input.
- Fixed-millisecond instant serialization.
- `Date`/`Instant` and date-string/`PlainDate` round trips.
- Explicit Temporal comparison and arithmetic.
- Half-open local calendar boundaries.
- Timezone validation and ownership precedence.
- Saved `UTC` as an intentional preference.
- RSC/JSON primitive serialization.
- Hash golden values for `.000`, `.123`, and `.999` timestamps.

### Core Regression Tests

- Work-period split time in non-UTC employee zones.
- Calendar self-entry browser mismatch/capture.
- Selected-employee month boundaries near UTC date changes.
- Historical endpoint display using different captured offsets.
- Cross-midnight daily aggregation.
- Report custom ranges when browser and organization zones differ.
- Shift scheduling when browser and organization zones differ.
- Approval and correction output independent of server timezone.
- Invalid profile and organization timezone writes.

### Telegram Regression Tests

- Personal versus organization command timezone ownership.
- Clocking capture and display in the linked user's profile zone.
- Approval timestamps in the recipient zone.
- `/whosout` logical return dates in eastern and western zones.
- `/openshifts` organization-local date boundaries.
- Digest schedule zone separated from content zone.
- DST gap/fold dispatch and duplicate prevention.
- Locale and 12/24-hour preference.
- Identical explicit-zone output under UTC and non-UTC server processes.

### Client Capture Tests

- Mobile and extension online actions send device timezone.
- Offline queues preserve action-time timezone.
- Replay does not replace it with sync-time timezone.

### Verification

- Run focused tests after each vertical slice.
- Run the full Vitest suite.
- Run `CI=true pnpm build`.
- Run migrated source guardrails.
- Exercise production-like Node/browser runtimes with the Temporal polyfill.

## Source Guardrails

Migrated modules must not introduce:

- Native `Date` calendar math or timezone conversion.
- Locale formatting without an explicit timezone owner.
- Direct Luxon imports.
- Temporal class instances in serialized payloads.
- New time-entry insertion paths that bypass timezone capture.
- Organization-unscoped queries or mutations.

Boundary adapters may use native `Date` where required by Drizzle, Better Auth, UI widgets, or SDKs.

## Acceptance Criteria

The first delivery is complete when:

- Server/worker and PostgreSQL session handling is explicitly UTC.
- The Temporal foundation runs in all affected first-delivery runtimes.
- Core and Telegram surfaces follow the approved domain-aware timezone policy.
- Personal UI/chat output uses the saved recipient timezone.
- Selected-employee and organization calendar operations use their domain-owned zones.
- Historical time-entry endpoints preserve captured-offset audit meaning.
- Mobile and extension clock capture retains action-time device timezone.
- The identified high-risk defects in first-delivery scope have regression coverage.
- No existing DB, API, external integration, or hash contract changes unintentionally.
- Focused tests, full tests, build, and guardrails pass.

The repository-wide migration is complete later when direct application Luxon use reaches zero, all business calendar logic uses Temporal, and only explicit boundary adapters retain native `Date`.
