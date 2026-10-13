---
status: accepted
---

# Only an admin export is the complete personal data export

An employee can download a personal data export of themselves, and an org admin can request one on an employee's behalf. We decided that the employee's own export deliberately leaves out a fixed list (HR-only documents, custom fields above employee visibility, rates, internal finance and officer notes on travel expenses, and departure tasks and reviews), and that only the admin export is the complete answer to an Art. 15 request. That makes the admin export the only route for former employees as well. Self-service stays instant and needs no officer review, while the organization keeps its say over records it chose to keep from the employee. The organization owes the full Art. 15 answer either way, and the employee export's README says a complete copy can be requested from the organization's admins.

## Considered Options

- **The employee export contains everything.** Rejected: an employee could download an HR-only document, such as a warning letter not yet discussed, or a manager-only custom field, without anyone deciding to release it. That would undo HR-only visibility and field visibility for anyone who presses the button.
- **The employee export contains everything after an officer reviews it.** Rejected: every export would wait for a person, and Z8 would need a review queue, deadlines and reminders to meet the one-month Art. 15 deadline. The admin export covers the same need, on request.
- **Former employees keep access to self-service export.** Rejected for the same reason as Personnel File ADR 0001: it needs a new kind of sign-in after membership ends.

## Consequences

- Whether something is withheld depends only on the fixed list. A record that has no page in the app today still goes into the employee export.
- An admin cannot run an admin export on themselves, because no one is an officer for their own personnel file. Another admin runs it for them.
- When an admin exports an employee's data, a current employee is told about it.
