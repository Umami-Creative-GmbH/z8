---
status: accepted
---

# Vacation postings preserve committed amounts and expiry

Vacation balances and automated postings use the same employee-effective vacation policy periods from the organization's known or reviewed baseline, for 2026 onward (#989, #1370, #1371). This lets assigned employees accrue and carry vacation even when their company default has different terms or is absent. Required missing or conflicting coverage skips only the affected employee and remains visible for review. It never supplies an invented allowance.

A monthly accrual combines the effective policy amounts within that month using its actual calendar days and the employee's employment coverage. It retains the existing monthly or biweekly share arithmetic, posting cadence and final two-decimal row rounding. A custom annual allowance remains final. An existing employee/year/month accrual row is final on automatic retries, including its amount and provenance; no difference or compensation row is posted after a policy change.

For new year-end carryover, the policy effective on 31 December supplies permission and cap, and the policy effective on the receiving 1 January supplies expiry. Commit the transfer outcome once, including zero and disallowed outcomes, and freeze both the amount and expiry terms. Explicit no-expiry is a committed term, distinct from unknown legacy expiry. This preserves ADR 0001's rule that written year-end carryover keeps its value, while preventing a retry after a policy change from manufacturing another transfer.

## Consequences

- Later assignment, policy and method changes do not reprice stored accrual, change a committed transfer or move its expiry. Readers, expiry processing, reports and admin detail use those frozen terms. A dated expiry remains valid through its final millisecond; expiry applies after that instant in the selected organization timezone.
- Existing carryover keeps its legacy expiry treatment unless explicitly reviewed. Admission does not infer historical snapshots, merge duplicate legacy allowance rows, or rewrite existing amounts. The rollout gate coordinates readers and postings; pre-baseline and pre-2026 behavior stays compatible.
- Annual/monthly/biweekly method and employment-proration-switch changes remain restricted to 1 January by ADR 0004. Allowance amount changes within a month use actual calendar-day weighting. Part-time schedule conversion remains the separate ADR 0003 / #990 implementation.
- Automated transfers retain their system principal as durable provenance. They never attribute a system job to an employee merely to satisfy the human audit log. A reviewed correction uses the committed amount, allowance link and last derived-write time to establish whether the result is still untouched; a later manual write stays final.
- The existing reviewed employment-date correction remains the explicit exception for eligible stored amounts. Its preview includes the employee's resolution evidence and preserves manual or unproven carryover. A changed configuration invalidates the preview. Scheduled jobs and assignment/history writers never call that correction automatically.

The maintainer confirmed these effective-period and prospective carryover decisions in the [#989 agent brief](https://github.com/Umami-Creative-GmbH/z8/issues/989#issuecomment-6236277788). The implementation retains committed zero/no-expiry outcomes so idempotent retries preserve that contract.
