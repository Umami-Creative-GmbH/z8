---
status: accepted
---

# Payroll runs record reimbursements only when an expense officer confirms them

With the payroll reimbursement channel, the payroll export also carries the amounts awaiting reimbursement, so the money reaches employees on their payslip. A payroll export file can still be regenerated, rejected by the payroll software or corrected before payday, so exporting it proves nothing about money moving. We decided that a payroll run records reimbursements only when an expense officer confirms it was paid, each officer for the reports in their officer scope, and that payroll access alone is enough to include the amounts in the export. Until then the reports are included in the run: no other run and no bank-transfer reimbursement may take them, and the employee sees nothing new.

## Considered Options

- **Record the reimbursements when the export completes.** Rejected: an export moves no money, and a discarded or corrected file would leave reports reimbursed that were never paid.
- **Let payroll access confirm the run.** Rejected: recording reimbursements is an expense officer capability (ADR 0001), and payroll and bookkeeping are often different people.
- **Require an expense officer grant to export the amounts.** Rejected: a payroll officer without that grant would produce payroll files that silently miss reimbursements, and the net amount owed per employee is less sensitive than the salary data payroll access already shows.

## Consequences

- Confirmation can be partial. Reports outside every confirming officer's scope stay included until someone with scope confirms them, and the coverage gap names them.
- A report is included in at most one unconfirmed run. Exporting the same period and employees again replaces the earlier unconfirmed inclusions, and a confirmed run is final.
- Confirmation never records more than is still owed. If an adjustment lowered the amount after the export, the officer records the overpayment as a recovery outside payroll.
