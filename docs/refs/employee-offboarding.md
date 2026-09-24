# Employee Offboarding and Rehire — Operator Guide

Spec #338, delivered in #340 (lifecycle and history), #339 (clock-out and billing)
and #341 (approval handover, UI and activation). Read
[Timekeeping](timekeeping.md) before changing anything that touches the cutoff or
clock-out.

## Model in one paragraph

A **departure** ends one **employment period** at its **cutoff**: the start of the
day after the last working day in the organization's timezone, frozen on the
departure when it is scheduled (or the command instant for *Offboard now*). At
the cutoff access ends, the running timer is closed at the cutoff, the paid seat
is released, and the employee's pending approval duties are handed over. The
departure is *effective* even while follow-up work (billing, session sign-out,
timer post-processing, approval handover, notifications) is still pending or has
failed; follow-up never decides whether someone has left. A **rehire** starts a
new employment period with freshly confirmed terms; nothing from the previous
stint is restored.

## Where to find it

- Employee detail page: **Settings → Employees → (employee) → Employment and
  departure**. Owners and admins see the actions the server offers
  (schedule, edit, cancel, offboard now, rehire, resolve, retry, assign
  replacement). The employee's managers see a read-only view.
- Directory: once released, *Deactivate* / *Reactivate* in the employee and
  member tables open the departure card instead of flipping the active flag.
- Notifications: *Employee offboarding needs review* links to the specific
  review (`?review=<id>` highlights it). Preference: **Notifications → Team →
  Offboarding needs review**.
- Diagnostics: **Platform admin → Worker queue** shows the
  `cron:employee-departures` job (every minute) and the delayed
  `execute-employee-departure` jobs.

## Scheduling, editing and cancelling

- **Schedule departure** asks for the last working day; the form shows the exact
  cutoff in the organization zone, eligible replacements for approval duties,
  and known exceptions (running timer, future shifts/absences, approvals that
  cannot be transferred automatically, owner rules). The preview is advisory;
  the server recomputes everything on submit.
- **Edit** creates a new revision; queued work for the old revision becomes
  obsolete. **Cancel** is possible until the cutoff (or while blocked); the
  canceled departure stays in the audit trail. An effective departure cannot be
  canceled — rehire instead.
- **Offboard now** takes effect immediately and supersedes a pending schedule.
- Every command carries a request ID: retrying an unchanged submission replays
  the first result instead of acting twice.

## Blocked departures and the final owner

A departure is re-authorized when it takes effect. It becomes **blocked** (and
nothing is closed, released or handed over) when:

- `initiator_authorization_lost` — the admin who scheduled it is no longer an
  accessible owner/admin;
- `owner_authorization_required` — the target is an owner and the initiator is not;
- `final_accessible_owner` — the target is the last accessible owner.

Resolve by assigning and activating another approved owner (or restoring the
initiator's authority), then reschedule or cancel the blocked departure.

## Reviews versus repairs

Reviews are durable work items on the departure; they never hide time.

| Review | Meaning | How to resolve |
| --- | --- | --- |
| *Needs review: offboarding clock-out* | The timer was closed at the cutoff. | Check the period (*Correct time* opens the calendar at the cutoff), then mark resolved with a note. |
| *Timer repair required* (`clock_repair`) | The clock-out failed, or a client captured a clock action before the cutoff that arrived after access ended. **Blocks payroll** for the affected range. | Correct the time through the canonical correction flow. The review cannot be resolved while the period is still open. |
| *Approval duties need a replacement* | A captured duty could not be transferred (no replacement, ineligible replacement, or a legacy-only approval). | Assign a replacement on the review; the handover retries. Legacy-only approvals are reassigned in Approvals. |
| *Future employment terms need review* | Confirmed terms or policy assignments dated after the cutoff. | Review them in the employment history; they no longer apply to the ended period. |

There is intentionally no "clear error" action.

## Approval handover

When the departure takes effect, every pending duty the employee holds in the
current stage of a pending canonical workflow is captured as its own
`approval_handover` task naming the exact assignment. The worker transfers it
through the narrow `employee-offboarding` system principal, which can only
reassign that exact assignment to a replacement who can currently decide the
requester's approvals — never approve, reject, cancel or expire. The transfer
event is recorded under the system actor with departure, period, task and source
lineage; the initiating admin stays in the departure's own audit trail.

- A decision made before the handover runs wins; the handover records
  `source_resolved` and rewrites nothing.
- A retry after a crash replays the committed transfer through its receipt.
- A retry after a rehire does nothing (`employee_rehired`), and never touches
  duties created in the new employment.
- A later stage routed explicitly to the departed person activates for the
  departure's replacement; without one it fails visibly (it never auto-approves).
- Submitted claims *of* the departed employee (absences, time corrections, work
  periods, expenses) stay decidable by their current approvers.

## Scoped manual retry

**Retry** on a failed follow-up item queues exactly that task of that
organization again with a fresh attempt budget. Only failed work can be retried,
so a retry never races a worker that owns the task. A notification whose
delivery outcome is unknown (the worker stopped mid-send) fails as
`delivery_ambiguous` instead of resending; retrying it is an explicit decision to
send again.

## Membership versus employment

- **Membership** (organization access) and **employment** (periods, terms, time)
  are separate. Owner-only *Remove access* removes membership and never ends or
  reactivates employment.
- External provisioning (SCIM, invitations, pending-member approval) cannot
  reactivate an employee whose employment an effective departure ended; the
  database guard keeps them inactive. Access returns only through a rehire.

## Rehire

*Rehire employee* is offered after an effective departure. It requires approved
membership; otherwise re-invite first. Confirm role, team, primary manager, work
policy and all contract terms. The new period starts at the server's instant;
the gap between periods is shown in the employment history, which is grouped by
stint (legacy periods without a recorded start show *Date not recorded*).

## Billing reconciliation

A billable seat is an approved member who is not departed (effective, or past
the cutoff of a due departure that would take effect) and, once released, has
an active employee profile. Departure and rehire each queue a `billing_sync`
task that recomputes the current count and delivers it in order; an uncertain
Stripe outcome is reconciled rather than blindly resent. Local seat counts are
updated even when Stripe is disabled.

## Release gate and rollback

`EMPLOYEE_OFFBOARDING_RELEASE_READY` in
`apps/webapp/src/lib/employee-lifecycle/release.ts` controls whether new
departure and rehire commands (and the preview) are accepted and whether the
maintenance job runs. Review resolution, replacement assignment and retries stay
available regardless.

- **Disabling new commands does not undo effective departures.** Access and seat
  decisions for existing departures are enforced by the database regardless of
  the gate, and due departures still deny access at their cutoff.
- With the gate closed the maintenance job does not materialize or deliver;
  re-open it (or run the job) to finish pending follow-up.
- **Rolling back the schema after activation is unsupported**: migrations 0071–0073,
  0076 and 0077 hold departures, periods, reviews, seat delivery and audit that
  other tables and access checks depend on.

## Operational checks

- Real-PostgreSQL suites: `pnpm --filter webapp test:approval-workflow-repository:integration`
  (includes `acceptance.integration.test.ts` with the ten cross-system scenarios).
- A departure stuck *pending* past its cutoff already denies access and the paid
  seat; the next `cron:employee-departures` run materializes it.
- Follow-up counts on the departure card come from persisted tasks and reviews,
  never from guesses.
