---
status: accepted
---

# Officer scope is a team snapshot taken at approval, unlike payroll access

Payroll access resolves a scoped officer's employees at read time from current team membership, and departed employees drop out. An expense report outlives both: it may wait for reimbursement after the employee has changed team or left, and a departed employee is still owed the last reimbursement. We decided that an expense report records the employee's teams when it is approved. A scoped expense officer handles the report when the employee is named in their grant or one of those recorded teams is. The recorded teams never change afterwards. Reports approved before this decision, and legacy claims, were backfilled once with the teams at deployment time, or the last membership for departed employees.

## Considered Options

- **Current membership at read time, as payroll does.** Rejected: a team move hands outstanding reports to an officer for a cost centre that never approved the trip, and departed employees' reports become invisible to every scoped officer.
- **Current membership, with an exception that keeps departed employees visible.** Rejected: it still moves reports on team changes, and it needs an extra rule to decide which team a departed employee belongs to.

## Consequences

- Do not unify officer scope with payroll access scope. They answer different questions: payroll asks who someone works for now, and reimbursement asks who answered for the trip.
- Changing a grant's teams changes which reports the officer sees. Changing an employee's team does not.
