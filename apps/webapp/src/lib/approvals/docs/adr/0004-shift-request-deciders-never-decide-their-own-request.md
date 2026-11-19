---
status: accepted
---

# Shift request deciders never decide their own request, and a sole decider's request is approved on submission

A shift request (swap or pickup) is decided by any manager or admin on the current roster at the instant (#1604). Nothing stopped one of them from approving or rejecting their own request, while the approval inbox (#686), Absences ADR-0002 and expense reports all refuse self-decision. We decided that a shift request decider never decides their own shift request. When the requester is the only decider on the current roster at submission, the request is approved as it is submitted instead of waiting for a decision nobody else can make; this is what the approval route preview already shows (`requester_auto_approve`).

The list of pending shift requests and the decision check use the same rule for who is a decider: current roster plus role. The list still shows the decider's own pending requests, read-only, as the approval inbox does.

## Considered Options

- **Allow self-decision.** Rejected: it is the only approval kind that would, and the route preview would describe a review that never happens.
- **Refuse submission when the requester is the only decider.** Rejected: a sole manager could not record a swap or pickup through requests at all, and the outcome would be the same as approving it.
- **Allow self-decision only when the requester is alone, like the expense owner rule (#679).** Rejected: it leaves a request pending for a decision that can only go one way, and the preview already describes automatic approval.

## Consequences

- Approval on submission runs the same checks and effects as a manual approval: published shift, participants on the current roster, an assigned employee, the skill check, the shift assignment, and rejecting competing pending pickups. If approval would be refused (a swap with no target employee, or a missing required skill, which needs a reason), submission is refused with that reason; the sole decider can assign the shift directly in the planner instead.
- An approved-on-submission request records the requester as its approver. Since nobody else can decide their own request, `approverId` equal to `requesterId` identifies it.
- Whether the requester is alone is judged once, at submission. A request submitted while other deciders existed stays pending if they later leave; the requester can withdraw it and submit again.
- Withdrawing is not a decision: a decider can still withdraw their own pending request.
