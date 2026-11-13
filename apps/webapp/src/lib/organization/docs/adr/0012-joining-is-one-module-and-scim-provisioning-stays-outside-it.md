---
status: accepted
date: 2026-11-13
---

# Joining is one module, and SCIM provisioning stays outside it

Every way into an organization wrote its own employee: an accepted invitation, organization creation, an invite code, the approval of a pending membership, both SSO sign-ins and kiosk-only creation each hand-wrote part of the same sequence, and the steps a path left out were defects (a returning former employee placed in a team while still off the current roster, a missing seat recount, an admin's employee created with the employee role). Joining is now one module. It starts from an approved membership and owns what follows, in the transaction that approves the membership. SCIM provisioning does not go through it and stays a second writer of employees on purpose.

## Considered Options

- **SCIM provisioning joins through the module too.** Rejected for now. SCIM projects the identity provider's state rather than reacting to a membership being approved: it writes through Better Auth's adapter, keeps an inactive employee beside a pending membership while auto-activation is off, overwrites team permissions from a role template, and takes its user guards in the provider's sorted subject order (#429). Fitting those into joining would give the module a second meaning and a flag for each difference.

## Consequences

- SCIM keeps in step with joining by sharing the parts, not the sequence: the same reactivation on return, team placement through the team placement module (#1594), and its own durable seat outbox.
- A change to what joining does has to be checked against SCIM provisioning by hand.
- Rehire and demo seeding also write employees and are not joining.
- Worth reopening if SCIM stops keeping an employee beside a pending membership, since that is the largest difference.
