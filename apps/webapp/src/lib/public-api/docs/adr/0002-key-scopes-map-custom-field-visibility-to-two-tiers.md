# Key scopes map custom field visibility to two tiers

Custom field visibility is defined by base role (admin, manager, employee), but an API key has no role (ADR 0001). A key with an entity's read scope therefore reads only that entity's custom fields with employee visibility, the ones every member already sees, and a single opt-in scope, `custom-fields:read-restricted`, adds the manager and admin fields, definitions included. Like the health scope, it grants nothing on its own.

## Considered Options

- **Every key reads every field**, as the payroll export does. Rejected: any key that can list employees would expose admin-only fields such as salary bands, and existing keys would gain them silently.
- **Three tiers**, with separate manager and admin scopes. Rejected: a key acts as the organization, so it has no meaningful "manager view", and one more scope is one more thing an admin has to understand when creating a key.

## Consequences

- Existing keys with an entity read scope start returning that entity's employee-visible custom fields without a migration. This is an addition, which v1 allows, and widens nothing beyond what every member sees.
- Raising a field's visibility from employee to manager removes it from keys without the restricted scope on their next request.
