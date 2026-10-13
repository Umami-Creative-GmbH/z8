# Organization

An organization's master data about its employees, customers and vehicles, and the custom fields it defines for itself on employees, projects and customers. It also hands an employee their personal data on request. Projects themselves belong to the Projects context.

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

### Personal data

**Personal data export**:
A file holding one employee's personal data kept by one organization, in a form they can read and reuse elsewhere. The employee requests it for themselves, or an org admin requests it on their behalf. An employee of several organizations gets a separate one from each.
_Avoid_: GDPR export, DSAR, self-export, data export (that is the organization-wide export)

**Employee export**:
A personal data export the employee requests for themselves. It leaves out withheld data.
_Avoid_: self-service export, own export

**Admin export**:
A personal data export an org admin requests on an employee's behalf, including withheld data. It is the complete answer to a request for access and the only route for a former employee.
_Avoid_: full export, HR export

**Withheld data**:
The fixed list of personal data an employee export leaves out: HR-only documents, custom field values above employee visibility, rates, internal notes on travel expenses, and departure tasks and reviews.
_Avoid_: hidden data, private data, restricted data

### Vehicles

**Organization vehicle**:
A vehicle the organization provides for its employees to drive for work, named and identified by its licence plate. An archived vehicle can no longer be picked but stays on the work it was recorded on.
_Avoid_: fleet car, company car, pool car

**Assigned driver**:
An employee, or every member of a team, for whom an organization vehicle is the one usually driven, so it is suggested first. Anyone may still pick any active vehicle.
_Avoid_: vehicle owner, vehicle holder
