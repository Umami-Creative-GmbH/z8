# Custom field values are typed rows, not JSON on the entity

Custom fields are stored as a definitions table plus one value table. Each value row points at exactly one employee, project or customer through a real foreign key (one nullable column per entity, with a check that exactly one is set). Each row holds its value in a column of the field's type and carries an optional valid-from date for tracked custom fields.

We rejected a JSON column on `employee`, `project` and `customer`. Tracked custom fields need several dated values per field, and reports and payroll need to read the value as of a date. A JSON blob also gives the database no way to enforce types, organization scoping or select-option integrity. We also rejected a polymorphic "entity type + id" reference: Postgres cannot cascade deletes or enforce same-organization ownership through it.

## Consequences

- Adding a fourth entity (time entries are planned) means adding another nullable foreign key column and widening the check.
- Values cascade when their entity is deleted. Z8 has no per-employee erasure today, so the cascade is what will remove an employee's values once one exists.
