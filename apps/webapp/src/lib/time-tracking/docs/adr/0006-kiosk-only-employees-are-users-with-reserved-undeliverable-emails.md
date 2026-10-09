---
status: accepted
---

# Kiosk-only employees are users with reserved, undeliverable emails

A kiosk-only employee has no sign-in and no email, yet every employee references a user, every user needs a unique email, and time entries and audit records name a user as their creator. We decided that a kiosk-only employee is a real user whose email is a reserved, undeliverable placeholder and who has no credential, as demo employees already are (#761). Their kiosk clocking is still authorized by the kiosk and their kiosk PIN; the user only supplies provenance. Giving them a real email later turns them into an ordinary employee through the normal invitation, keeping their PIN and history.

## Considered Options

- **Employees without a user.** Rejected: making the employee's user optional reaches every creator reference, approval, audit record and every join from user to employee, for a population that only ever clocks.
- **Only employees with a sign-in may use kiosks.** Rejected: staff without a company email or smartphone are the reason kiosks exist.

## Consequences

- The reserved email domain must never be deliverable, must not match SSO or SCIM identities, and must not allow password reset or sign-in.
- Kiosk-only employees count as billable seats like any other employee until a separate kiosk seat price exists. Seat counting must not exclude them by the demo rule.
- Channels that need the employee to sign in (in-app inbox, push) do not reach kiosk-only employees; their notifications go to their managers.
