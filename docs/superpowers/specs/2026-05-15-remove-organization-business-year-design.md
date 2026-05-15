# Remove Organization Business-Year Setting Design

**Goal:** Remove the organization-level non-calendar year setting and restore calendar-year behavior across vacation, absence, reporting, settings, and hydration flows.

**Decision:** Z8 will not support an organization-specific business-year start setting. Vacation balances, carryover windows, reports, analytics, and absence queries must use calendar-year ranges based on January 1 through December 31.

## Background

A previous change introduced an organization setting that let administrators choose a start month for yearly business calculations. The product decision is to remove that capability completely before it becomes a supported feature. The removal must include runtime code, tests, translated messages, generated-facing configuration, UI, and the old planning documents for that abandoned change.

## Scope

- Remove the organization settings UI for the business-year start month.
- Remove server actions and authorization tests dedicated to changing that setting.
- Remove hydration of the setting from auth context, organization hooks, and organization settings store state.
- Remove utility functions dedicated to non-calendar year range calculations.
- Update vacation, carryover, absence, analytics, and report callers to use calendar-year helpers.
- Update or remove tests that asserted non-calendar year behavior.
- Remove translated labels and descriptions for the removed setting.
- Add a forward database migration that drops the old organization start-month column.
- Delete the old design and implementation documents for the abandoned feature while preserving this removal design and its plan.

## Desired Behavior

Vacation and absence calculations use the requested calendar year. A request for year `2026` starts on `2026-01-01` and ends on `2026-12-31`, with timezone-aware helper functions where existing code already requires timezone handling.

Carryover automation calculates expiry from calendar-year boundaries and the configured carryover duration. It no longer depends on any organization year-start setting.

Reports and analytics presets such as current year, last year, and year to date remain calendar-based. They must not read organization-specific year-start data.

Settings pages no longer show, submit, hydrate, or translate the removed option. Organization context and stores should expose only retained organization settings.

## Data And Migration

The old organization start-month database column must be dropped in a forward migration. The migration should be safe for environments where the column exists because the abandoned feature may have been deployed to some development or staging databases.

Generated auth schema files should reflect the removed column after the schema source and migration path are updated. Do not hand-maintain generated schema output beyond what the repository already expects.

## Testing

Focused tests should cover these areas:

- Organization settings store no longer contains the removed state.
- Report date ranges are calendar-year based.
- Absence date helpers return calendar-year ranges.
- Vacation calculator and carryover automation use calendar-year behavior.
- Absence queries derive start and end dates through calendar-year helpers.
- Removed settings actions, card, and translations no longer appear in source or message search.

## Completion Criteria

The cleanup is complete when the application source, message files, and superpowers docs no longer contain the abandoned feature's old identifiers, except for this removal design and plan using neutral business-year wording. The focused regression test set for organization settings, reports, absence date helpers, vacation calculation, carryover automation, and absence queries must pass.
