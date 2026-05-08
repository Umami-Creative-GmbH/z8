# Absence Categories Management Design

## Goal

Add organization-scoped absence category management to `/settings/vacation` so org admins can create and maintain absence types used by absence requests, approvals, and payroll mappings.

## UI

The vacation settings page will keep the existing tabbed layout and add a new middle tab:

- `Policies`
- `Categories`
- `Assignments`

The new `Categories` tab will show a CRUD table for absence categories. It will display the category name, enum type, approval requirement, vacation balance behavior, work-time requirement, color, and active status. Org admins can create, edit, deactivate/reactivate, and delete any category, including seeded defaults.

## Permissions

The page keeps its existing access behavior: members are redirected away from vacation settings. Category write actions are limited to org admins and must validate that the target category belongs to the active organization.

## Data Model

Use the existing `absence_category` table and `absence_type` enum. No schema change is required for this feature.

New server actions will list, create, update, activate/deactivate, and delete categories scoped by `organizationId`. Actions must validate organization ownership and avoid cross-tenant access.

## Defaults

Each organization should have useful default categories:

- Vacation
- Sick Leave
- Personal Day
- Home Office
- Unpaid Leave
- Parental Leave
- Bereavement

Defaults are inserted idempotently per organization. Existing organizations get missing defaults lazily when `/settings/vacation` loads. Demo data should reuse the same default list to avoid drift.

## Error Handling

Client mutations show success and failure toasts. Server actions return structured success/error results and reject invalid input, unauthorized access, or categories from another organization.

## Testing

Add coverage for the server actions and default seeding helper where existing test patterns allow it. Run project verification for the touched package before completion.
