# Organization Fiscal Year Start Design

## Summary

Organizations need to support business years that do not start in January. The default remains January, but organization owners can choose a different fiscal year start month in organization settings. The setting is organization-scoped and should affect business-year calculations without changing visual calendar-year views.

## Goals

- Add an organization-level fiscal year start month with January as the default.
- Allow only organization owners to change the setting, matching current timezone and feature-setting behavior.
- Hydrate the setting through the existing organization settings flow so client code can read it consistently.
- Use the fiscal year start month for organization business-year ranges in reports, absences, vacation, and carryover where the code currently assumes January 1.
- Keep calendar-year UI and year-specific import flows calendar-based unless they explicitly represent business-year reporting.

## Non-Goals

- Do not support arbitrary fiscal year start days. The setting is month-only and each fiscal year starts on day 1 of that month.
- Do not make the setting editable by organization admins or members.
- Do not reinterpret holiday import years, visual year calendars, or generic date pickers as fiscal years.
- Do not migrate historical persisted records into new fiscal-year labels in this feature.

## Recommended Approach

Store `fiscalYearStartMonth` as an integer from `1` to `12` on the Better Auth `organization` table. Configure it as an additional organization field with database column `fiscal_year_start_month`, default value `1`, and server-side validation. Hydrate it through `/api/auth/context`, `useOrganization`, and `organization-settings-store` alongside timezone and feature flags.

Add an owner-only organization settings card near the timezone card. The card shows the current month to all organization admins who can access the organization settings page, but only owners can change it. The UI should optimistically update the Zustand organization settings store, call a server action, refresh the router on success, and revert on failure, matching `OrganizationTimezoneCard`.

## Data Model

- `organization.fiscalYearStartMonth`: integer, default `1`, nullable only if required by generated Better Auth schema constraints.
- Runtime fallback: if the value is missing or invalid, use `1`.
- Validation: accept only whole numbers `1` through `12`.

Because `src/db/auth-schema.ts` is generated, the source of truth is the Better Auth configuration in `src/lib/auth.ts`; regenerate or update the generated schema through the existing project workflow rather than manually editing the generated file.

## Permissions

The server action `updateOrganizationFiscalYearStartMonth(organizationId, month)` requires the current member role to be `owner`. This intentionally matches `updateOrganizationTimezone` and `toggleOrganizationFeature`.

Unauthorized users receive the existing server action error shape. The client card disables editing for non-owners and displays explanatory helper text.

## User Interface

Add `OrganizationFiscalYearCard` under `/settings/organizations`, close to `OrganizationTimezoneCard` because both settings affect date interpretation. The card contains:

- Title: `Fiscal year`
- Description explaining that reports, vacation, and other business-year calculations use this month as the start of the organization year.
- A month picker or select with January through December.
- Owner-only helper text for users who cannot edit.
- Pending state and optimistic update behavior matching the timezone card.

## Date Utility

Add a small Luxon-based utility for fiscal ranges instead of duplicating date math. It should support:

- Current fiscal year range for a given date, timezone, and start month.
- Previous fiscal year range.
- Fiscal year-to-date range.
- Fiscal year label/year derivation where needed by vacation/carryover code.

All utility functions should normalize invalid or missing start months to January.

## Business-Year Behavior

Use the setting where the application means organization business year:

- Report presets such as `current_year`, `last_year`, and `ytd` become fiscal-year aware when the organization setting is available.
- Vacation and carryover year boundaries use the organization's fiscal year start month for accrual, annual carryover, and expiry timing where they currently assume January 1.
- Absence page year-level data loading should use the current fiscal year span when it is summarizing annual absence/vacation information.

Keep the following calendar-year based:

- Visual year calendars that display January through December.
- Holiday import and year-specific holiday presets.
- Generic date pickers and import flows that ask for explicit calendar dates.

## Data Flow

1. Server fetches the active organization's `fiscalYearStartMonth` in `/api/auth/context`.
2. `useOrganization` includes the field in `OrganizationSettingsResponse`.
3. `organization-settings-store` stores and exposes the value with a default of `1`.
4. Organization settings UI reads the initial value from the organization record and updates through the owner-only server action.
5. Business-year consumers read the setting from server data or the hydrated client store depending on where the calculation runs.

## Error Handling

- Invalid month input returns a validation error and does not update the database.
- Unauthorized updates return an authorization error.
- Failed client updates revert the optimistic local month and show a toast.
- Missing database values and invalid hydrated values fall back to January.

## Testing

Add focused tests for:

- Fiscal range utility boundaries for January, April, and December fiscal starts.
- Current fiscal year and previous fiscal year behavior around boundary dates.
- Server action validation for invalid months.
- Server action owner-only authorization.
- Organization settings store default and hydration behavior.
- UI disabled state for non-owners and optimistic revert behavior where practical.

Existing tests around reports, absences, and vacation should be updated only where behavior intentionally changes from calendar year to fiscal year.

## Implementation Notes

- Follow existing organization settings code style rather than introducing a separate settings subsystem.
- Keep the first implementation narrow: month-only start, no arbitrary day support, no historical data migration.
- Prefer Luxon over native `Date` for new fiscal range logic.
- Preserve multi-tenancy by always reading and updating the setting through the active/current organization context or an explicit organization-scoped authorization check.
