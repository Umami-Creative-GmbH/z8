---
status: accepted
---

# A decision is made under one claimed decision right, verified from the database and never exchanged

Whoever asks for a decision names exactly one decision right: approver, eligible manager, manager of approvals, or covering deputy for a named approver. The decision's own transaction verifies that right from the database and refuses if it no longer holds; it never falls back to another right the person may also have. Before this, callers passed flags that permitted a set of rights and each owner tried them in order. The two copies of that order for time approvals disagreed: one granted management whenever the person could manage approvals, the other only when the caller had asked for it. Time approvals adopt the rule first; the approval inbox and the other kinds follow.

## Considered Options

- **Keep the permitted set, with one shared order of fallbacks.** Rejected: an approval reassigned between the click and the decision would still be decided under a right the person never saw themselves using, and "no management from a card" would stay a convention each caller must remember instead of something a card cannot express.
- **Let the caller verify the right and have the transaction trust it.** Rejected: the check inside the transaction is deliberate defence in depth, and it is the only one that serializes with an escalation transfer or a change of role.
- **Verify management from the session inside the transaction, as before.** Rejected: it re-reads what the request already knew, and card presses and on-behalf decisions have no session to ask.

## Consequences

- A person who holds several rights is refused when the one they claimed is gone, for example a manager of approvals whose own assignment was reassigned. The caller may resolve their right again and retry; the decision does not do it for them.
- A card claims only its recipient's right as approver or covering deputy, so it cannot reach eligible-manager or management rights.
- Management is read from the person's membership and roles in the organization. A platform administrator's session-wide access no longer decides an approval unless they also manage approvals in that organization.
