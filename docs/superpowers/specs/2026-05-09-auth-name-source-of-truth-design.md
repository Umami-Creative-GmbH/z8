# Auth Name Source Of Truth Design

## Context

Z8 currently stores structured personal names in two places:

- `user.firstName` and `user.lastName` in the Better Auth user schema.
- `employee.firstName` and `employee.lastName` in the organization-scoped employee profile.

This creates drift risk. Profile updates currently write Better Auth first and then sync only the active organization employee record. Employee admin updates write employee fields without updating Better Auth. Because names are personal identity data rather than organization-specific employment data, Better Auth should be the source of truth.

## Decision

Use `user.firstName` and `user.lastName` as the application source of truth for structured names.

Keep the existing `employee.firstName` and `employee.lastName` database columns temporarily for migration safety, but stop relying on them in application reads and writes. Treat those employee columns as deprecated.

## Scope

In scope:

- Read employee display names from the joined auth user record.
- Search and sort employees using auth user names where employee queries already join `user`.
- Update profile forms to load names from auth user data, not employee data.
- Update profile mutations so structured names are written to Better Auth only.
- Keep employee-owned personal fields such as `gender` and `birthday` on `employee`.
- Stop writing employee `firstName` and `lastName` in employee create/update and onboarding flows.
- Add focused tests around profile updates and employee listing/search behavior.

Out of scope for the first implementation:

- Dropping `employee.firstName` and `employee.lastName` from the database schema.
- Writing a data migration to backfill or delete existing employee name values.
- Supporting organization-specific legal or preferred names.

## Architecture

The employee record remains organization-scoped and continues to own employment data: organization membership, team, managers, role, employee number, position, employment dates, contract details, gender, birthday, and active status.

The auth user record owns identity data shared across organizations: name, structured first name, structured last name, email, image, and app access flags.

Employee query boundaries should expose both employee and user data where UI needs both. Display helpers and UI components should compose the visible name from `user.firstName`, `user.lastName`, `user.name`, and finally `user.email` as fallback.

## Data Flow

Profile update flow:

1. User submits first name and last name in profile settings.
2. Server validates the structured profile input.
3. Server updates Better Auth user fields with `firstName`, `lastName`, and derived `name`.
4. Server updates only employee-owned profile fields such as `gender` and `birthday` on the active employee record.

Employee admin flow:

1. Employee settings create/update continues to manage organization-scoped employment fields.
2. Name inputs are removed from employee-owned admin forms and payloads in the first implementation. Admin-editable auth names are not added in this change.
3. Employee list, select, scheduling, team, reports, and related UI surfaces derive names from the joined user record.

Onboarding flow:

1. Profile onboarding writes structured names to Better Auth.
2. Employee record creation or update writes only employee-owned fields.
3. Profile completion checks use auth structured names for name completion and employee fields for employment/profile completion where relevant.

## Error Handling

Profile updates should avoid a two-store rollback for names because names are only written to Better Auth. If the Better Auth update fails, the action returns a validation/action error and no employee name update is attempted.

Employee-owned field updates should remain organization-scoped and should continue using existing permission checks and server-action error handling.

## Testing

Add or adjust tests to verify:

- Profile details update calls Better Auth with structured names and does not write employee name fields.
- Profile form initializes first and last name from auth user data even when employee name columns contain stale values.
- Employee search/list uses auth user name fields and email fallback.
- Onboarding profile completion is based on auth structured names rather than employee name columns.

## Migration Strategy

The first implementation is a behavioral migration only. Existing employee name columns remain in the schema to avoid a broad destructive migration. After application code no longer reads or writes those columns, a later migration can remove them safely.

## Risks

- Some UI components may receive employee objects without joined user data. Those surfaces need either query updates or explicit fallback behavior.
- Admin employee forms may currently require first and last name. Removing those fields from employee-owned validation may affect create/edit flows and tests.
- Existing stale employee name data will remain visible only if any references are missed.
