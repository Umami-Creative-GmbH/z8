# Quick Clock-In Location Selector Design

## Context

Z8 already stores a work location on live work periods through `work_period.work_location_type`. The full time-tracking page already exposes this selector through `ClockInOutWidget`, but the global quick clock-in popover in `TimeClockPopover` currently calls `clockIn()` without a location, so clock-ins from the app header do not capture the user-selected work location.

The existing persisted location set is `office`, `home`, `field`, and `other`. The desired product language is `office`, `home`, `remote`, and `other`, with `office` selected by default. The change should replace `field` globally with `remote` rather than keeping both concepts.

## Goals

- Add a work location selector to the global quick clock-in popover.
- Preselect `office` for quick clock-in and full widget clock-in unless the user changes it.
- Persist selected quick clock-in locations on the active work period.
- Replace `field` with `remote` across schema, types, API validation, UI labels, and compliance logic.
- Preserve historical records by migrating existing `field` values to `remote`.

## Non-Goals

- Do not add organization-specific configuration for location options.
- Do not add geolocation, address capture, or device location enforcement.
- Do not redesign the time clock popover beyond the location selector needed for this flow.

## Approach

Use a global replacement from `field` to `remote`.

The quick clock-in popover will render the existing `WorkLocationSelector` while the user is not clocked in and not entering post-clock-out notes. The selector will use the same compact toggle presentation as the full time-tracking widget and pass the selected value to `useTimeClock().clockIn({ workLocationType })`.

To avoid duplicated literal unions, introduce or update a shared work location type source if the existing structure allows it with minimal churn. If no shared type already exists, keep the change surgical but ensure all current `field` type unions become `remote` unions consistently.

## Data Model And Migration

Update the Drizzle enum declaration for `workLocationTypeEnum` from `office | home | field | other` to `office | home | remote | other`.

Add a SQL migration that:

- Creates a replacement enum containing `office`, `home`, `remote`, and `other`.
- Converts existing `field` values in `work_period.work_location_type` and `time_record_work.work_location_type` to `remote` during the type cast.
- Replaces the old enum type with the new enum type under the existing `work_location_type` name.

This migration keeps historical records readable while aligning persisted values with the new product vocabulary.

## UI Behavior

The quick clock-in popover will show the location selector only before clock-in. The selector defaults to `office`. The options are:

- Office
- Home
- Remote
- Other

The full time-tracking widget will use the same option set and label. The current local storage key for the full widget may remain, but invalid or stale saved values such as `field` must normalize to `office` or `remote` so users do not get an invalid toggle state.

## API And Offline Behavior

The web clock-in action will accept `office | home | remote | other` and store the value on `work_period`.

The mobile time-clock API will require the same enum for `clock_in`. Existing clients sending `field` after this change will receive validation errors, because the requested product behavior is a global replacement rather than compatibility mode.

Offline queued clock-in support should carry the selected `workLocationType` where the current offline event format supports it. If the service worker queue currently lacks that field for clock-in, the implementation should extend the queued event type and sync payload in the smallest compatible way.

## Compliance Behavior

Presence compliance currently treats `office` and `field` as onsite. After the rename, only `office` should count as onsite unless a separate future requirement defines `remote` as onsite. `home`, `remote`, and `other` do not satisfy onsite presence requirements.

## Error Handling

If the selected location value is missing or invalid in client state, the UI should fall back to `office` before submitting. Server-side validation remains enforced by TypeScript unions and mobile API zod validation. Failed clock-in behavior continues to use the existing toast error path.

## Testing

Add or update tests to verify:

- Quick clock-in passes the selected `workLocationType` to the clock-in mutation.
- Server clock-in persists the supplied location value.
- Mobile API accepts `remote` and rejects obsolete `field`.
- Presence compliance no longer treats `remote` as onsite.
- Existing tests and type checks do not reference `field` as a valid location.

## Rollout Notes

The migration changes a persisted enum value and updates historical rows from `field` to `remote`. This is intentional and required by the global replacement decision. No environment variables or tenant-specific configuration are required.
