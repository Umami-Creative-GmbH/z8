---
status: accepted
date: 2026-10-20
---

# Intended-driver status is a scoped assignment, and losing it ends driving authorization

Driving licence control is an optional organization feature. Who needs checks is an **intended driver** decision, made the same way as other policy assignments: for the whole organization, a primary team or one employee, with the employee's own decision first, then their primary team's, then the organization default. A *Not required* value excludes someone from a broader decision. Assignments take effect when saved, with no effective dates. When an employee stops being an intended driver, through an assignment change, an exclusion or a move to another primary team, their driving authorizations end at once and their check records start their retention period. Becoming an intended driver again requires a new check.

The product rules were confirmed on 2026-10-20 and are recorded in the [driving licence management reference](../../../../../../../docs/refs/driving-licence-management.md).

## Considered Options

- **Keep enrolling employees one by one.** That doesn't scale to teams or the whole organization, and nothing removes an employee again. Other optional features already decide this kind of question with org, team and employee assignments.
- **Let the authorization lapse quietly.** The organization would still show permission to drive for someone it no longer intends to let drive. The check records would also keep supporting an active authorization, which delays their retention.
- **Match every team the employee belongs to.** This differs from every other policy assignment and makes two team decisions conflict. Verifier scope still matches every team membership, because it is an access grant and not a policy.
- **Use effective dates.** Ending an authorization is shown to the admin before saving. A future end date would be applied later by a job, without anyone seeing it.

## Consequences

- Every way of removing intended-driver status shows who loses which authorization before saving: the assignment preview, and a warning when a team is changed.
- Switching the feature off doesn't change who is an intended driver. It hides the feature and stops reminders and tasks. Deadlines keep running, and evidence cleanup continues.
- Switching it on again sends one suspension notice for each authorization that became overdue or expired while it was off. Missed reminders are not caught up.
- Existing enrollments become employee-level *Required* assignments, so nobody's status changes.
