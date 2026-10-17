# Payroll Exports

How an organization prepares work, absences and overtime payouts for its payroll target, and understands changes to a period after an export.

## Language

**Payroll export**:
The data prepared for one payroll target, period and employee scope. A payroll export may be delivered as a file or through a supported integration.
_Avoid_: payroll run (Travel Expenses uses that term for an export that can also carry reimbursements)

**Baseline export**:
A successful payroll export an operator selects as the historical side of a payroll comparison. It represents what was exported then, including the identifiers and wage codes used at that time.
_Avoid_: previous payroll, last run, reconstructed baseline

**Current preview**:
A fresh view of the baseline export's period and employee scope using the records and mappings in effect when the preview is prepared. Preparing a current preview does not deliver payroll data or change a payroll run.
_Avoid_: rerun, correction export, delta export

**Payroll comparison**:
The additions, removals and changes between a baseline export and its current preview for the supported payroll lines. It shows old and new values and their signed differences, with excluded line kinds stated explicitly.
_Avoid_: reconciliation (Time Tracking uses record agreement and historical repair for a different concern), payroll adjustment
