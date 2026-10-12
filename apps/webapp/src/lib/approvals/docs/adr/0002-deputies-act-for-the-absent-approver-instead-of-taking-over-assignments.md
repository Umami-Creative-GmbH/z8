---
status: accepted
---

# Deputies act for an absent approver instead of taking over their assignments

While an approver is on an approved absence, the deputy named on that absence may see and decide the approvals assigned to that approver, as their deputy (#802). Nothing is reassigned: the assignment and the legacy request keep the absent approver, who can still decide as well, and the deputy's right ends by itself when the absence ends. Decisions record both people, as "decided by the deputy for the approver". This applies to every approval kind addressed to one person, under legacy and canonical approval authority alike.

## Considered Options

- **Reassign the absent approver's pending assignments to the deputy when the absence starts.** Rejected: the `reassign` transition exists only under canonical authority, so legacy requests would need a second mechanism; it is one-way, so returning the approvals needs another job that must cope with half-decided chains; and a reassigned target gets no card today.
- **Route only new requests to the deputy at submission.** Rejected: approvals already pending when the absence starts stay stuck, and approvals routed to the deputy stay with them after the approver returns.

## Consequences

- A decision's actor is no longer always the assignment's approver. Every place that equates the two (inbox listing, decision authorization for legacy and canonical, review bindings, self-decision refusal) must accept "the approver, or the approver's deputy during their absence".
- An escalation transfer still moves an overdue assignment away from the absent approver; the deputy then loses their right to it, because the assignment no longer belongs to the person they cover for.
