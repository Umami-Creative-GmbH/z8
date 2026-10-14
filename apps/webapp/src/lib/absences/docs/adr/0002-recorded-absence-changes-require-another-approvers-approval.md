---
status: accepted
---

# Recorded absence changes require another approver's approval

An employee who recovers earlier cannot currently shorten sick leave recorded on their behalf. Employees can cancel some approved future absences immediately, while new sick-leave requests normally auto-approve. We decided that changing or cancelling any of an employee's own approved absences is an absence change request: the recorded absence stays effective until another eligible approver approves the change. This preserves the absence that calendars, balances and reports rely on while the proposed change is reviewed.

The employee's current category/team approval policy and eligible approvers decide the request, with the existing review, deputy and escalation rules. The original recorder or approver has no permanent right to review changes. Category auto-approval and requester self-auto-approval never apply to these requests; submission is refused with an explanation if no other eligible approver can be resolved. A manager-recorded absence is already approved even though it has no original approval request.

## Considered Options

- **Edit the recorded absence immediately and undo it on rejection.** Rejected: calendars, balances and reports would use unapproved dates during review.
- **Reuse every auto-approval rule for new absence requests.** Rejected: sick-leave categories normally skip approval, and some policies auto-approve requests assigned to their requester. Either would defeat the required independent review of a recorded absence change.
- **Always return to the original recorder or approver.** Rejected: the employee's team, managers and approval policy may have changed since the absence was recorded.

## Consequences

- This applies to all categories and all of the employee's own approved absences, regardless of who entered them. The employee can change either date, shorten or extend the range, use the category's existing full-day/morning/afternoon options, or request full cancellation. Category, deputy and attached documents are unchanged by a date change.
- Every request requires a reason. Reviewers see the original absence, the proposed range and half-day coverage or full cancellation, and that reason. Request and decision history retain the original and proposed values and the people involved.
- A date-only change preserves recorded clock hours by default, including overnight coverage. The employee can explicitly choose full-day/morning/afternoon coverage instead. Legacy morning markers cannot identify exact partial-day hours, so the original and proposed canonical intervals are captured and checked during approval.
- An absence has at most one pending change or cancellation request. The employee can withdraw it before submitting a replacement; withdrawal preserves its history and leaves the effective absence unchanged. Rejection also leaves the absence unchanged.
- Past dates are allowed. Time Tracking ADR-0004 still applies: if the original or proposed absence touches a closed month, even in part, the change requires an authorized reopening first. There is no exception for changing only the open portion of a spanning absence.
- Submission and approval validate the employee's current absence and the normal date, overlap and vacation-balance rules. A proposal is not counted as a second effective absence or a second vacation deduction, and does not reserve extra proposed vacation days. Calendars, effective absence totals and vacation balances change only on approval. If the original absence changes or is cancelled during review, or the proposal becomes invalid before approval, the request becomes obsolete, remains in history, and the employee is told why a fresh valid request is needed. Approval never overwrites a newer change.
- Date changes retain linked sick notes and their original document information. Pending, rejected and withdrawn cancellation requests also retain them. An approved cancellation deletes linked sick notes, preserving Personnel File ADR-0002, while retaining the absence change and approval history.
- Approval of a full-day sickness extension applies the existing sickness-over-vacation rule. Reviewers see the vacation dates that will be displaced. No overlapping vacation changes while the request is pending. Shortening or cancelling sickness never automatically restores previously displaced vacation; the employee is told to submit a new vacation request if they still want those dates off.
- Applying an approved change uses the existing absence side effects: affected submitted periods are sent back across the original and proposed ranges, and derived balances and calendar data are refreshed. Submission, rejection and withdrawal do not apply these side effects.
- An initial absence request still awaiting approval can be withdrawn immediately and corrected dates submitted as a new request. It does not need a second approval to withdraw. Rejected and cancelled absences remain history and cannot receive change requests.

These decisions were agreed during the grill-with-docs interview on 2026-10-14. Application implementation is separate from this decision record.
