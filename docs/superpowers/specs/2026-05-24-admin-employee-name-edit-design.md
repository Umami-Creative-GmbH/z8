# Admin Employee Name Editing Design

## Goal

Allow organization admins to change an employee's first and last name from `/settings/employees/{id}`.

## Scope

- Add `firstName` and `lastName` fields to the existing employee detail edit form.
- Enable these fields only for organization admins.
- Persist names to the linked Better Auth `user` row, not the `employee` row.
- Keep manager access unchanged; managers cannot edit employee names.

## Data Flow

The detail form initializes `firstName` and `lastName` from `employee.user`. On submit, the existing `updateEmployeeAction` validates the employee payload, verifies access to the target employee in the current organization, updates employee-owned fields as today, and updates the linked `user` row only for org admins when name fields are present. The action also updates `user.name` to the combined display name so existing display helpers and search/list surfaces stay consistent.

## Validation

`firstName` and `lastName` are required when submitted and limited to 100 characters, matching the existing profile validation rules. The server trims names before writing. The UI focuses the first invalid name field on submit errors.

## Testing

- Schema tests cover name field validation.
- Action tests cover org-admin user-name updates and manager-scoped rejection of name changes.
- Page utility tests cover syncing the form from `employee.user`.
