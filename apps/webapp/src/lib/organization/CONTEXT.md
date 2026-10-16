# Organization

An organization's master data about its employees, customers and vehicles, and the custom fields it defines for itself on employees, projects and customers. It also hands an employee their personal data on request. Projects themselves belong to the Projects context.

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

### Employment

**Employment terms**:
What the organization has agreed with an employee from a given date: contract type, weekly contract hours, work model, work policy and, for an hourly contract, the hourly wage. Only confirmed terms apply; draft and pending terms are proposals.
_Avoid_: contract record, employment record, employment history row

**Hourly wage**:
What an employee on an hourly contract is paid per hour worked. It is part of their employment terms, so the wage in force on a day is the one in the confirmed terms for that day. Changing it means confirming new terms.
_Avoid_: hourly rate, rate, salary, pay rate

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
The fixed list of personal data an employee export leaves out: HR-only documents, custom field values above employee visibility, billable and cost rates, internal notes on travel expenses, and departure tasks and reviews.
_Avoid_: hidden data, private data, restricted data

### Vehicles

**Organization vehicle**:
A vehicle the organization provides for its employees to drive for work, named and identified by its licence plate. An archived vehicle can no longer be picked but stays on the work it was recorded on.
_Avoid_: fleet car, company car, pool car

**Assigned driver**:
An employee, or every member of a team, for whom an organization vehicle is the one usually driven, so it is suggested first. Anyone may still pick any active vehicle.
_Avoid_: vehicle owner, vehicle holder

### Driving licence control (confirmed design)

The following terms describe the confirmed extension; see the
[driving licence management reference](../../../../../docs/refs/driving-licence-management.md)
for its agreed rules and implementation status.

**Driving entitlement**:
The employee's legal entitlement to drive a particular class of vehicle, subject to applicable restrictions and prohibitions.
_Avoid_: driving authorization, assigned driver

**Driving licence**:
The official document presented as evidence of an employee's driving entitlement. Its validity and the validity of individual licence classes are separate.
_Avoid_: driving authorization, driving entitlement

**Driving licence check**:
An authorized verifier's recorded personal inspection of an employee's original driving licence for explicitly identified classes. It establishes what was checked at that time.
_Avoid_: licence upload, licence photo, self-certification

**Driving licence verifier**:
A person the organization has explicitly authorized to perform checks for all employees or selected employees and teams. A verifier never verifies their own licence.
_Avoid_: assigned driver, personnel file officer, manager (as an implied verifier)

**Driving licence check record**:
The evidence of one check, including the employee, verifier, time, outcome, inspected classes, relevant document dates and the employee's declaration. A correction supplements the record.
_Avoid_: licence copy, skill certificate, generic audit log

**Driving licence check interval**:
The common interval an organization sets between routine checks. Each checked class has its own last successful check as the starting point.
_Avoid_: statutory six-month interval, employee-specific default interval

**Driving authorization**:
The organization's permission for an employee to drive within explicitly checked licence classes and applicable restrictions. It is separate from legal driving entitlement and recorded vehicle use.
_Avoid_: driving licence, assigned driver, permission to drive every organization vehicle

**Suspended driving authorization**:
A driving authorization put out of effect because a relevant condition is no longer met or cannot be confirmed. It requires a new check and explicit reinstatement.
_Avoid_: revoked driving entitlement, expired employment, automatic reinstatement

**Driving licence verifier scope**:
The employees a verifier is authorized to check and whose check records they may access. It covers the whole organization or selected employees and teams.
_Avoid_: line-management scope, payroll access, personnel file access

**Driving licence check retention**:
The organization's justified period for keeping a check record once it no longer supports an active driving authorization. A documented hold for a specific legal case postpones deletion.
_Avoid_: permanent archive, statutory three-year retention

## Confirmed design references

- [Driving licence management](../../../../../docs/refs/driving-licence-management.md): the confirmed product rules, awaiting implementation.
- [Driving authorization and check evidence have their own lifecycle](./docs/adr/0004-driving-authorization-and-check-evidence-have-their-own-lifecycle.md): why permission and check evidence stay separate from vehicle attribution, skill certificates and generic audit retention.
