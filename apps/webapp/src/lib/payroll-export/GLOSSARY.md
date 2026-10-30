# Payroll Exports

How an organization prepares work, absences and overtime payouts for its payroll target, and understands changes to a period after an export.

## Language

**Payroll export**:
The data prepared for one payroll target, period and employee scope. A payroll export may be delivered as a file or through a payroll connector.
_Avoid_: payroll run (Travel Expenses uses that term for an export that can also carry reimbursements)

**Payroll connector**:
A payroll target that receives payroll exports through the vendor's API rather than as a file.
_Avoid_: integration, API export, sync

**Delivered record**:
A work period or absence a payroll connector has accepted, together with the vendor's id for it and the values Z8 sent. A later payroll export of the same period and scope updates or removes delivered records instead of sending them again; a file target instead receives a new file.
_Avoid_: synced record, export line (that belongs to files)

**Contract-verified**:
A payroll connector whose requests and responses match the vendor's published documentation, checked against examples taken from that documentation. It says nothing about whether any real vendor account accepts the export.
_Avoid_: tested, working

**Tenant-verified**:
A payroll connector that has delivered a payroll export into a real vendor account, with the result checked in the vendor's own system.
_Avoid_: live-tested, production-ready

**Withdrawn connector**:
A payroll connector Z8 no longer offers for setup or delivery until it is rebuilt and tenant-verified. Its past payroll exports stay in the history; nothing new is sent to it.
_Avoid_: disabled, deprecated, beta, hidden

**Baseline export**:
A successful payroll export an operator selects as the historical side of a payroll comparison. It represents what was exported then, including the identifiers and wage codes used at that time.
_Avoid_: previous payroll, last run, reconstructed baseline

**Current preview**:
A fresh view of the baseline export's period and employee scope using the records and mappings in effect when the preview is prepared. Preparing a current preview does not deliver payroll data or change a payroll run.
_Avoid_: rerun, correction export, delta export

**Payroll comparison**:
The additions, removals and changes between a baseline export and its current preview for the supported payroll lines. It shows old and new values and their signed differences, with excluded line kinds stated explicitly.
_Avoid_: reconciliation (Time Tracking uses record agreement and historical repair for a different concern), payroll adjustment

**Comparison evidence**:
The historical facts retained from a successful payroll export so its supported lines can be compared later, including the destination, scope, period boundaries, exported values and their source contributions. It represents the export as it happened, independently of whether its downloadable file still exists.
_Avoid_: work input (that is only part of the evidence), regenerated export

**Payroll impact**:
A change to the supported values or identifiers the payroll target would receive, at that target's grouping and precision. A change between wage codes can have payroll impact even when an employee's total hours are unchanged.
_Avoid_: balance change, net hours change
