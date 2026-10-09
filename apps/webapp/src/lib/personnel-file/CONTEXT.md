# Personnel File

The organization keeps employees' contracts, payslips, certificates and other records in one place per employee and decides which of them the employee may see.

## Language

### Documents

**Personnel file**:
All employee documents an organization keeps about one employee.
_Avoid_: dossier, employee folder, Personalakte

**Employee document**:
One stored file in a personnel file, with a document category, a title, a visibility and an optional expiry date.
_Avoid_: attachment, upload, file

**Document category**:
The kind of record an employee document is: contract, payslip, certificate, sick note or other. The list is fixed for every organization.
_Avoid_: document type, folder, tag

**Document date**:
The calendar day an employee document belongs to, such as the day a contract was signed or a certificate issued. It is a plain day, not tied to any timezone.
_Avoid_: upload date, created date

**Pay period**:
The month a payslip settles. Only payslips have one.
_Avoid_: payroll month, billing period

**Expiry date**:
The last day a certificate or other document is valid. Officers and, for shared documents, the employee are reminded before it and on it.
_Avoid_: valid until, due date

**Payslip batch**:
Many payslips for one pay period uploaded at once and matched to employees by personnel number, saved only after an officer confirms the matches.
_Avoid_: bulk upload, payslip import

**Personnel number**:
The organization's own identifier for an employee, also used by payroll exports. It is not guaranteed to be unique.
_Avoid_: employee ID, payroll ID

### Visibility

**Shared document**:
An employee document the employee can see in their own personnel file.
_Avoid_: public document, visible document

**HR-only document**:
An employee document only personnel file officers and admins can see.
_Avoid_: private document, hidden document

### Access

**Personnel file officer**:
A person granted access to the employee documents of chosen document categories, for all employees or for named employees and teams. Owners and admins have this access without a grant; managers do not have it by virtue of managing.
_Avoid_: HR, HR manager, HR role

Granted separately from payroll access and from expense officer grants: payroll access never shows payslips.

No one is a personnel file officer for their own personnel file: an officer, owner or admin sees their own file only as the employee, and another officer or admin keeps it.

**Former employee**:
An employee whose employment a departure ended. Their personnel file stays with the organization, but they no longer see it.
_Avoid_: ex-employee, leaver

### Retention

**Retention period**:
How many years an organization keeps employee documents of one document category, set per category by the organization.
_Avoid_: storage period, archive period

**Retention start**:
The end of the later of two calendar years: the year the employee's last employment ended and the year of the document date. A current employee's documents have no retention start, and neither do those of a former employee whose employment end was never recorded: those are listed as "retention start unknown" and purged only after an officer reviews them.
_Avoid_: retention date

**Due for deletion**:
Said of an employee document whose retention period has passed since its retention start. It stays until an officer confirms its purge.
_Avoid_: expired (that is the expiry date), overdue

**Purge**:
The confirmed, irreversible deletion of an employee document that is due for deletion.
_Avoid_: cleanup, archive
