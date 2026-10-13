# Organization

An organization's master data about its employees, customers and vehicles, and the custom fields it defines for itself on employees, projects and customers. Projects themselves belong to the Projects context.

## Language

### Employees

**Personnel number**:
The organization's own identifier for an employee, used by payroll exports and to match payslips. An employee may have none. No two employees of an organization share one, current or former: a former employee keeps theirs and it is never given to anyone else. Numbers that differ only in surrounding spaces or in upper and lower case are the same number; leading zeros count.
_Avoid_: employee ID, payroll ID

### Custom fields

**Custom field**:
A piece of data an organization defines for itself on employees, projects or customers, with a name, a type and whether it is required.
_Avoid_: custom attribute, metadata, extra field, property

**Custom field value**:
What one employee, project or customer holds for a custom field.
_Avoid_: field data, attribute value

**Tracked custom field**:
A custom field whose values each carry the date they are valid from, so the value as of any date can be read back.
_Avoid_: versioned field, historised field, temporal field

**Field visibility**:
The lowest base role (admin, manager or employee) that may see a custom field's values. A custom role sees what its base role sees.
_Avoid_: field permission, field access

**Field edit level**:
The lowest base role that may change a custom field's values. Employees never edit values, not even their own.
_Avoid_: field write permission

**Archived custom field**:
A custom field taken out of use. It no longer appears in forms or new exports, but its values are kept. Select options are archived the same way.
_Avoid_: deleted field, disabled field

**Missing required value**:
A required custom field with no value as of today on an employee, project or customer. Records created by SCIM, imports or demo data can have one; the forms refuse to save a record that still has one.
_Avoid_: incomplete record, invalid record

### Vehicles

**Organization vehicle**:
A vehicle the organization provides for its employees to drive for work, named and identified by its licence plate. An archived vehicle can no longer be picked but stays on the work it was recorded on.
_Avoid_: fleet car, company car, pool car

**Assigned driver**:
An employee, or every member of a team, for whom an organization vehicle is the one usually driven, so it is suggested first. Anyone may still pick any active vehicle.
_Avoid_: vehicle owner, vehicle holder
