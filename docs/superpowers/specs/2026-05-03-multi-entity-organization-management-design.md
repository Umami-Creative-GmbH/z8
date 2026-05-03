# Multi-Entity Organization Management Design

## Goal

Support parent organizations that contain multiple legal entities. Each legal entity owns its own payroll settings, holidays, policies, exports, and scoped admins while staying inside one existing Z8 organization and user directory.

This unlocks larger customers without pretending every customer is a single legal company.

## Decisions

- Legal entities are subdivisions inside one existing Z8 organization, not separate Better Auth organizations.
- Every active employee belongs to exactly one legal entity.
- Legal entities independently own payroll settings, holidays, work policies, change policies, vacation settings, exports, and entity admins.
- Organization admins can manage all legal entities in the active organization.
- Entity admins can manage only their assigned legal entity's employees and entity-owned settings.
- Cross-entity payroll exports are out of scope for the first version; org admins run one export per entity.

## Data Model

Add legal entities as first-class records scoped by `organizationId`.

Create `legal_entity` with:

- `id`
- `organizationId`
- `name`
- `legalName`
- `registrationNumber`
- `taxId`
- `countryCode`
- `street`
- `city`
- `postalCode`
- `country`
- `defaultCurrency`
- `timezone`
- `isDefault`
- `isActive`
- audit fields

Add `employee.legalEntityId`, referencing `legal_entity.id`. Existing employees are assigned to a default legal entity created for their organization. New employees default to the organization's default legal entity but must have an explicit legal entity before saving.

Create `legal_entity_admin` to grant entity-scoped admin access to an employee in the same organization and legal entity.

Add `legalEntityId` to entity-owned configuration and operational tables, including payroll export configs/jobs, holiday categories/holidays/presets/assignments, work policies and assignments, change policies, vacation settings/allowances, and export settings where the data represents legal, compliance, or payroll configuration.

Update uniqueness constraints that are currently organization-wide when duplication should be allowed per entity. Examples include payroll config per format per legal entity and policy names per legal entity.

## Migration

For each existing organization, create one active default legal entity. Assign existing employees and entity-owned settings to that default entity.

Migration code must preserve historical records. Existing organization-scoped records become default-entity records rather than being duplicated or deleted.

## Access Control

Organization admins retain full access across all legal entities in the active organization.

Entity admins can:

- View and manage employees assigned to their legal entity.
- Manage that entity's payroll settings, holidays, work policies, change policies, vacation settings, and exports.
- Read historical records for inactive entities they administer.

Entity admins cannot:

- Create or delete legal entities.
- Access employees or settings owned by other legal entities.
- Move employees between legal entities.

Extend principal context to load legal entity admin grants. Add authorization helpers for legal entity access, such as `canManageLegalEntitySettings(legalEntityId)` and `canReadLegalEntityEmployee(legalEntityId)`.

Server actions and queries that touch entity-owned data must filter by both `organizationId` and an allowed `legalEntityId`. URL-provided legal entity IDs are never trusted without authorization checks.

## Application Flow

Add a Legal Entities settings page for organization admins. It lists entities in the active organization, supports create/edit operations, marks one active entity as default, assigns entity admins, and shows employee counts plus configuration readiness per entity.

Entity-owned settings pages gain an entity selector when the user can access more than one legal entity. Organization admins can select any entity. Entity admins see only their own legal entity and do not need a selector if they administer only one.

Selected legal entities should be represented in stable URLs through a `legalEntityId` query parameter. Server actions validate the selected entity before reading or writing data.

Employee management requires a legal entity on employee forms. Employee lists can filter by legal entity. Moving an employee between legal entities is organization-admin-only and must be audit logged because it changes payroll and compliance ownership.

Payroll config is legal-entity-owned. Payroll export jobs process employees from exactly one legal entity. Export files include legal entity metadata in filenames or headers where the format supports it.

## Policy And Holiday Resolution

Legal entity is the broadest assignment boundary below organization.

Policies and holidays are considered only when they match the employee's `organizationId` and `legalEntityId`. Inside a legal entity, the existing assignment priority remains: entity-wide default, then team, then employee.

Entity-owned pages should use UI language such as "entity-wide assignment" instead of "organization assignment" to avoid implying parent-organization scope.

Team and employee assignments must validate that the target team or employee belongs to the same organization and legal entity as the policy or holiday.

Existing organization-wide policy and holiday records are migrated into the default legal entity.

## Error Handling

- Missing `legalEntityId` in entity-owned actions fails validation before writing.
- Selected legal entity IDs are checked against the user's allowed legal entity scope.
- Cross-entity references return clear validation errors.
- Inactive entities reject new assignments and exports but keep historical records readable.
- Payroll export readiness is legal-entity-specific and blocks exports when required config is missing for that entity.

## Testing

- Migration or schema tests verify default legal entity creation and assignment of existing employees/settings.
- Access tests cover organization admin, entity admin, manager, and member visibility.
- Server action tests cover combined `organizationId` and `legalEntityId` scoping.
- Policy and holiday resolution tests cover entity default, team override, employee override, and cross-entity exclusion.
- Payroll/export tests verify jobs are single-entity and reject mixed-entity employee filters.
- UI tests cover entity selector behavior for org admins and single-entity admins.

## Out Of Scope

- Separate Better Auth child organizations per legal entity.
- Employees belonging to multiple legal entities.
- Cross-entity payroll exports in one job.
- Entity-specific branding, email providers, webhooks, projects, skills, notifications, or billing in the first version.
