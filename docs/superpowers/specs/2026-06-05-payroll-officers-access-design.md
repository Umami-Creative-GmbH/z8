# Payroll Officers Access Design

## Goal

Payroll workspace access must be opt-in for explicitly activated payroll officers. Employee-role admins and managers must not see or use payroll summaries, PDFs, or exports by default. An authorized organization admin or owner can manage payroll officers and assign each officer one or more teams and/or individual employees.

## Current Issue

The scoped payroll access implementation already added organization-scoped grant tables and a settings page. Two authorization paths are too broad:

- `ServerAppSidebar` shows the Payroll nav item to every active employee with role `admin`.
- Payroll workspace actions treat admins as globally scoped instead of requiring an active payroll access grant.

This makes sensitive payroll data visible to admins by role alone, which violates the opt-in requirement.

## Recommended Approach

Separate configuration permission from payroll-data permission.

- CASL controls who can manage the payroll officer settings page.
- Active `payroll_access_grant` rows control who can access the payroll workspace and export payroll data.
- No employee role, including `admin` or `manager`, grants payroll workspace access by itself.

This keeps admin configuration workflows possible while making data access explicit and scoped.

## Authorization Model

Add a CASL organization subject for payroll officer settings, for example `PayrollOfficerSettings`.

- Better Auth organization owners and organization admins can `manage` `PayrollOfficerSettings`.
- The settings page and settings server actions check CASL before reading or mutating grants.
- Payroll workspace read/export does not use `PayrollOfficerSettings`; it requires an active grant for the current employee.
- Existing `PayrollExport` permissions remain for payroll export configuration, not scoped officer workspace access.

For payroll data access, the required conditions are:

- The actor has an active employee record in the active organization.
- The actor has an active `payroll_access_grant` in that organization.
- The requested employees are intersected with employees resolved from the grant's assigned teams and individual employee assignments.
- If the resolved or intersected scope is empty, the action fails with authorization error.

## Data Model

Use the existing scoped payroll access tables:

- `payroll_access_grant`: active payroll officer grant per organization and payroll employee.
- `payroll_access_team`: teams assigned to the grant.
- `payroll_access_employee`: individual employees assigned to the grant.

No new tables are required for the correction. The existing active grant remains the source of truth for opt-in payroll officer status.

## UI Behavior

Rename the settings surface from "Payroll access" to "Payroll Officers" in page titles, card text, and user-facing copy.

The settings page explains that payroll officers are explicitly activated employees and can only generate payroll reports for assigned teams and employees.

The Payroll workspace nav item is visible only when the active employee has an active payroll officer grant in the active organization. Admins and managers without a grant do not see the item.

## Server Behavior

Payroll workspace server actions must remove the admin bypass.

The action context resolver always calls the grant resolver for the current employee. The returned allowed employee IDs are then intersected with requested employee filters. The summary, PDF export, configured format lookup, and scoped payroll export actions all share this same gate.

The settings actions replace `requireAdmin()` / ad-hoc role checks with CASL checks for `manage PayrollOfficerSettings` plus active organization ownership checks. They continue validating that selected payroll employees, assigned employees, and teams belong to the active organization.

## Error Handling

Unauthorized payroll workspace access returns an authorization error such as "No payroll employees are assigned to your access scope."

Unauthorized settings access returns an authorization error tied to `PayrollOfficerSettings`.

Validation errors remain separate for malformed IDs, cross-organization employees, cross-organization teams, or missing required fields.

## Testing

Add or update tests to cover:

- Admins without active grants do not see Payroll nav.
- Admins with active grants do see Payroll nav.
- Managers/employees with active grants do see Payroll nav.
- Payroll workspace actions deny admins without active grants.
- Payroll workspace actions scope admins with active grants to assigned teams/employees only.
- Settings actions require CASL `manage PayrollOfficerSettings`.
- CASL ability tests include owner/admin access to `PayrollOfficerSettings` and member denial.
- UI copy uses "Payroll Officers" and describes explicit activation.

## Non-Goals

- Do not introduce a broader custom role system for payroll access.
- Do not add self-access by default for payroll officers.
- Do not change payroll export format configuration permissions beyond distinguishing them from officer workspace access.
- Do not modify generated auth schema files.

## Acceptance Criteria

- No user sees or uses `/payroll` unless they have an active payroll officer grant.
- Admins and managers are denied payroll workspace actions unless explicitly activated as payroll officers.
- Authorized settings managers can create or update officer grants and assign teams/employees.
- Payroll data remains organization-scoped and employee-scoped by assigned teams/employees.
- CASL is used for the officer settings permission boundary.
