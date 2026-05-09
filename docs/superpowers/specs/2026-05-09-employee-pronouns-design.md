# Employee Pronouns Design

## Overview

Add pronouns for each employee as organization-scoped personal profile data. Employees can edit their own pronouns from profile settings, and authorized managers or admins can edit pronouns from employee details. Employee identity UI should show pronouns when available without changing payroll or report export data.

## Goals

- Store an optional pronouns value for every employee record.
- Support preset pronouns plus custom text input.
- Let employees update their own pronouns and let managers/admins update pronouns through existing employee detail permissions.
- Display pronouns alongside employee identity UI where employee data already flows through app surfaces.
- Keep report and payroll export payloads stable unless they already render shared UI identity components.

## Non-Goals

- Do not add tenant-level pronoun configuration.
- Do not force a fixed pronoun enum in the database.
- Do not change payroll, CSV, PDF, or integration export schemas.
- Do not redesign employee identity surfaces beyond the small pronoun display addition.

## Data Model

Add a nullable `pronouns` text column to the organization-scoped `employee` table. This matches the existing ownership model for employee-specific personal information such as `gender` and `birthday`.

The stored value is the final display string, for example `she/her`, `he/him`, `they/them`, or a custom value. Empty values are normalized to `null`.

Validation should accept `null`, omitted values, or a trimmed string up to 50 characters. Validation happens server-side in the shared employee schemas used by create, update, and profile actions.

## UI And Forms

The profile form adds a pronouns control near gender and birthday. The employee detail form adds the same control near existing personal information fields.

The control offers common presets and a custom text option. Presets provide consistency, while custom text avoids excluding people whose pronouns are not covered by the common set.

Existing permission boundaries remain unchanged:

- Employees can update their own pronouns through the profile update action.
- Managers/admins can update pronouns through the employee update action according to the current settings access tier.
- Organization scoping remains enforced by existing employee context and target employee checks.

## Display Behavior

Employee identity UI should render pronouns when present, using a consistent format such as `Ada Lovelace (she/her)`. When pronouns are missing, the UI renders exactly as it does today.

Add a small shared helper or component for formatting employee display names with optional pronouns. Use it in the main employee identity surfaces where employee objects already include pronouns, and update the query shape for these app UI surfaces when needed: employee details, employee directory, employee selectors, organization chart identity surfaces, calendar/report employee selectors, and dashboard widgets.

Do not change report/payroll export data just to include pronouns. Those outputs remain stable unless they already render shared UI identity components.

## Data Flow

1. The user chooses a preset pronoun value or enters custom pronouns.
2. The form submits the final string value to the relevant server action.
3. The server validates and trims the value, normalizing empty values to `null`.
4. The employee row is updated within the existing organization-scoped permission flow.
5. Existing employee/profile query invalidation refetches the updated value.
6. Identity UI displays pronouns when the returned employee shape includes them.

## Error Handling

Invalid pronoun values return the same server action validation result pattern used by existing employee fields. The UI surfaces those validation errors through the current TanStack Form field error components.

If an update fails because of permissions, organization scope, or persistence errors, existing employee/profile error toast behavior remains the user-facing feedback path.

## Testing

Add focused coverage near existing tests:

- Validation accepts presets, custom text, `null`, and omitted values.
- Validation rejects values longer than the configured maximum.
- Employee create/update actions persist normalized pronouns.
- Profile updates persist normalized pronouns for the current employee.
- Employee detail/profile forms expose pronoun input and submit the selected/custom value.
- Shared identity display renders pronouns when present and preserves current output when absent.

Verification should use the relevant `pnpm` test targets and type/lint checks that do not require unavailable environment secrets.
