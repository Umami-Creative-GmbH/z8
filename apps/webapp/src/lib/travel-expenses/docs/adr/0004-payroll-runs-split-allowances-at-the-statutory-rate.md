---
status: accepted
---

# Payroll runs split allowances at the statutory rate and send the rest by bank transfer

German payroll needs tax-free reimbursements and taxable pay on different wage types. Per diem and mileage above the statutory rate are taxable, and organizations may set their own rates above it. We decided that a payroll run splits each per diem and mileage item into its statutory share and its taxable excess, recomputing the item from its frozen itinerary or distance against the verified statutory tables, and puts each part, and each receipt category, on a wage type the organization maps per payroll format. Z8 never decides on its own whether an amount is taxed; the organization's choice of wage type does. Anything a payroll run cannot trace to items on mapped wage types stays out of the run, is listed by payroll readiness, and is reimbursed by bank transfer.

## Considered Options

- **One wage type for the whole amount owed.** Rejected: the payroll office would split every amount by hand, which is the work this channel removes.
- **One wage type per item kind, treated as tax-free.** Rejected: whenever an organization's rates exceed the statutory ones, taxable pay would reach the payslip as tax-free.
- **Put amounts without a statutory baseline on the taxable wage type.** Rejected: the employee would pay tax on money that may be tax-free.

## Consequences

- A payroll run takes only euro amounts and approved expense reports, not legacy claims, and is offered only by the file payroll formats.
- A report is left out when any item has no statutory baseline: an admin override, an itinerary the rules do not cover, or a day outside the verified tables.
- A report is left out once it has a bank-transfer reimbursement or a recovery, or when an adjustment would lower the amount on any wage type, because reimbursements carry no wage-type breakdown.
- The domestic statutory rates hold until § 9 Abs. 4a EStG changes. The foreign amounts come from the BMF's yearly table, so a report with foreign days stays out of payroll runs until that year's table is verified.
- Net-pay deductions are out of scope. Recoveries are always settled outside payroll.
