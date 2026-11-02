---
status: accepted
date: 2026-11-01
---

# Going live is checked, never staged

The implementation checklist used to treat "a work policy exists" or "an admin ticked approval rules" as readiness, which says nothing about whether the employees going live can actually work. Go-live checks now resolve each member of the go-live group against the real setup: their effective work policy today, an eligible approver for each approval kind they can raise, and the payroll setup when the organization exports payroll. They are worked out afresh whenever the checklist is looked at and never stored, so a check can't be stale. To see what would happen for one employee, an admin uses the go-live rehearsal, a trace that changes nothing, notifies nobody and delivers nothing. Proof that the organization really works comes from first-workflow evidence: its first real clock-in, decided request and payroll export, noticed rather than staged.

Manual confirmations stay for what Z8 can't judge, such as whether the organization structure is final. Each one stores a fingerprint of the configuration it covers. A confirmation whose configuration has changed since stops counting until an admin confirms it again.

## Considered Options

- **A test employee who clocks, requests and exports for real.** Its work periods would enter the hash-chained, GoBD-relevant work records and the audit exports. Its notifications would reach real approvers and channels, and a payroll export could reach a provider. Every way of cleaning that up afterwards is a correction of evidence.
- **A guided real pilot inside the checklist.** This is what a phased go-live already is: an admin narrows the go-live group to pilot teams and lets them work. The checklist observes it through first-workflow evidence instead of driving it.
- **Stored check runs with staleness tracking.** These would need invalidation rules for every configuration change that could break a check. Most of those changes write no audit entry, and many are hard deletes, so the rules could never be complete. Live checks avoid the question.
- **Detecting stale confirmations from `updatedAt`.** This misses removed teams, memberships, manager links and wage-type mappings, which are deleted outright. Comparing a fingerprint taken at confirmation catches them.

## Consequences

- No go-live code path writes work records, approval requests, notifications or deliveries. A rehearsal reuses the approval workflow dry run, never the workflow itself.
- Large organizations need batched lookups, because checks resolve every member of the go-live group on each view.
- Confirmations made before fingerprints existed keep counting, labelled as confirmed before change tracking, until they are confirmed again.
