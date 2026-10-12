# Overtime payouts in API payroll connectors

Z8 does not send overtime payouts to the API payroll connectors:
Personio, the SAP SuccessFactors OData connector and Workday. These
connectors send attendance and absences. They do not send payouts.

Overtime payouts reach payroll through the payroll **files**. DATEV,
Lexware and Sage carry them since #1001, and the SuccessFactors CSV
since #1050. Each payout is a number of hours under the wage type or
time type the organization mapped to the "overtime" special category.

## Why this is out of scope

A Z8 overtime payout is a number of hours under a mapped code. No
connector's API takes that cleanly. Each API would need a different
kind of payroll input, with its own mapping and its own idea of what a
payout is. The findings, with links to the official documentation, are
on #1004 (researched 2026-10-10).

**Personio** has no API for overtime. Its overtime payouts ("Compensate
as pay") are created in the Personio UI, and no endpoint writes to the
overtime balance. The only write path is a one-time compensation
(`POST /v2/compensations`). It takes a money amount, and Personio does
not support hourly compensation types. Z8 would have to own every
employee's hourly rate and turn hours into money. Personio would then
see an ordinary one-time payment, and its own overtime balance would
drift from Z8's.

**SAP SuccessFactors** has no documented entity that takes overtime
hours paid as wages. `EmployeeTime` is documented for absences. The
native time-account payout runs inside SuccessFactors against a balance
SuccessFactors holds, not Z8. The only write-capable fit is a one-time
payment (`EmpPayCompNonRecurring`). It needs a pay component code
instead of the time type Z8 maps, and the docs don't confirm that it
accepts hours.

**Workday** could technically take a payout: SOAP
`Submit_Payroll_Input` accepts a worker, an earning and hours. But that
makes the connector a payroll-input integration, with a per-tenant
earning mapping and duplicate protection on re-sends. Every Workday
tenant configures its own earnings, so this could only be tested
against a real customer tenant. The maintainer ruled it out together
with the other two.

So in every case, "send the payout" means a vendor-specific payroll
input model, a new mapping and a real tenant to test against, for a
small part of the export. Customers on an API connector record the
payout in their payroll system, or export it with one of the file
formats.

## What is still in scope

- Overtime payouts in the file formats (#1001, #1050).
- Fixes to how the connectors send attendance and absences. #1004
  found that the Workday connector targets REST paths that aren't in
  Workday's public API, and that the SuccessFactors connector posts to
  an `EmployeeTimeOff` entity that SuccessFactors does not document.
  These are bugs in what the connectors already do, not requests for
  new payroll data.
- Re-opening this if a vendor adds an API that takes overtime hours as
  payroll input.

## Prior requests

- #1004: "Overtime payouts in API payroll connectors (Personio,
  SuccessFactors, Workday)"
