---
status: accepted
---

# Payroll comparisons retain exported output independently of source records and downloadable files

A payroll comparison must explain what a successful export actually carried, even after work corrections, identifier and wage-code changes, or expiry of the downloadable file. We retain immutable comparison evidence with the exported values, source contributions, payroll destination, resolved employee scope and employee-local period boundaries, for 24 calendar months from export completion; we do not reconstruct a baseline from current source records or treat the existing frozen work input as a complete export snapshot. The maintainer accepted this trade-off during triage of #1303: retaining a minimal historical record costs storage, but replaying current records would give a misleading account of what payroll received.

## Consequences

- File expiry, target removal and deletion of the employee who requested an export must not accidentally destroy comparison evidence. Organization and employee erasure still apply; evidence made incomplete by erasure becomes unavailable for comparison rather than silently changing the historical baseline.
- Current previews use read-only collection. They do not run historical repair, create an export or payroll run, include expense reports, deliver payroll data, or change a closed month.
- Compare the payroll target's actual output grouping and precision, with source contributions retained for explanation. Wage-code and personnel-identifier changes remain visible; a different destination, resolved employee scope, filters or employee-local period boundaries makes the comparison incompatible.
- Exported lines and their source contributions are different concepts: the format may combine work, absences and overtime payouts into one row. Payroll impact follows the exported row; available source reasons explain it without claiming a complete historical audit.
- The first release supports DATEV, Lexware and Sage work, absence and overtime payout lines. Expense reimbursements are explicitly excluded, including from any claim that no supported values changed.
