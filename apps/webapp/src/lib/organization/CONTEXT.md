# Organization

An organization's master data about its employees, projects and customers, including the data it defines for itself.

## Language

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
