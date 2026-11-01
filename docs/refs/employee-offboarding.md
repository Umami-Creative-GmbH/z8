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
is released, the employee's expense officer, payroll access and personnel file
officer grants are revoked, all driving authorizations and held driving licence verifier
grants end, the employee's kiosk badge and kiosk fob stop working, and the employee's pending approval duties are handed over. The
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
| *Approval duties need a replacement* | A captured duty could not be transferred (no replacement, ineligible replacement, or a legacy-only approval), or a later stage names only the departed person. | Assign a replacement on the review: the handover retries, or the later stage uses it when it starts. Legacy-only approvals are reassigned in Approvals. |
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
- A later stage routed explicitly to the departed person activates for a
  replacement, resolved in this order: the replacement assigned on that stage's
  review, otherwise the departure's replacement. A replacement assigned on a
  handover task applies to that one duty only.
- When the stage starts, the replacement is checked again exactly like a
  transfer: accessible, approved member, and able to decide the requester's
  approvals. Otherwise the stage falls back as configured; with fallback *fail*
  it cannot activate (it never auto-approves), so approving the stage before it
  fails.
- Without a departure replacement, such *fail* stages are captured at the
  cutoff as *Approval duties need a replacement* reviews. Assigning a
  replacement on the review resolves it; this is possible until the stage
  starts, after which the stage is managed in Approvals.
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

## Former employees and the current roster

A deactivation and an effective departure both make a **former employee**
(Organization glossary, Organization ADR 0006). One rule decides who is on the
**current roster** (#1438): `onCurrentRoster(organizationId, columns?, now?)` in
`apps/webapp/src/lib/employee-lifecycle/current-roster.ts`, organization-scoped,
active, and not past a due departure (the same live check as
`employeeHasOrganizationAccess`).

- **Roster views** filter with it: dashboard team widgets and counts, `/team`,
  pickers, team and project member lists, bot commands, digests and escalation
  targets, and manager notice recipients. Lists people manage hide former
  employees behind *Show former employees*. Settings → Employees opens on
  *Current*, which also lists pending invitation drafts.
- **Views of the past** keep former employees and mark them with
  `isFormerEmployee`: report selectors, the calendar selector, past team
  calendar days and the calendar feed up to today, `/team/driving` rows.
- **Role saves** refuse a former employee through
  `current-roster-guard.ts`; removals always work. Most saves refuse only
  employees they add, so a form that still lists a former holder can be saved.
  Vacation policy and approval group saves refuse every former employee.
  Expense-officer and personnel-file-officer *scopes* may still name former
  employees, because their last reports are still owed and their files stay
  managed; payroll access scope refuses newly named former employees.
- **Actionable manager notices** (the shift pickup request) go to the current
  admins when every manager the employee had is former; informational ones are
  dropped.
- **Guard**: `current-roster-surfaces.test.ts` lists every roster surface and
  view of the past, checks every other employee query in listed modules, and
  keeps hand-written `employee.isActive` checks from growing beyond
  `raw-employee-active-checks.json`.

## Deactivation

*Deactivate* (Settings → Employees and the members table, while the release
gate is closed) has the consequences of a departure taking effect, at the
moment of deactivation (#1440, Organization ADR 0006). It reuses the
departure's code paths; the area modules live in
`apps/webapp/src/lib/employee-lifecycle/deactivation/`.

**Consequences**, each audited under the acting admin with
`{ reason: "employee_deactivated", deactivationId, … }`:

1. **Manager links** end in both directions. A report who keeps another current
   manager just loses this one; that manager becomes primary when the ending
   link was the primary one (`manager.removed`, `manager.primary_changed`). A
   report who would be left with no current manager gets the replacement the
   admin picked: a current admin or manager with an approved membership, never
   the report (`manager.assigned`). A report who is a former employee just loses
   the link (`formerReports` in the plan): no replacement is asked for, and a
   former employee never gets a new manager.
2. **Team memberships, the person's own project assignments and project
   manager links** end (`team.member_removed`, `project.assignment_removed`,
   `project.manager_removed`). A team's project assignment stays.
3. **Approval duties** in the current stage of a pending canonical workflow are
   captured as handover tasks under the deactivation and delivered by the worker
   through the departure's handover: to the replacement picked for that
   requester (only a pick the manager links validated: the requester is a report
   who needs one and the pick is eligible), else to the stage's reviewers
   re-resolved without the person, else they become *Approval duties need a
   replacement* reviews. Later stages naming only the person and legacy-only
   duties become reviews at once. Their own submitted requests stay decidable.
   Each task and review is audited (`approval_duty.handed_over`,
   `approval_duty.review_raised`, target `deactivation_follow_up`); transfers
   also carry `reassignment_metadata.offboarding.deactivationId`. The
   maintenance scan (`runEmployeeDepartureMaintenance`) delivers a
   deactivation's tasks while the release gate is closed; departures and their
   tasks stay behind the gate.
4. **Shifts** starting after the instant (by their wall-clock time in the
   organization's zone, drafts too) are unassigned and stay open
   (`shift.unassigned`). Past and running shifts stay. The person's current
   managers, else the organization's owners and admins, get one
   `employee_deactivation_shifts_opened` notice with the count.
5. **Absences** that start after the day they left (the instant as a date in
   the organization's zone), pending or approved, are cancelled through the
   normal cancellation path with the `employee-deactivation` system capability,
   which frees the allowance (`absence.cancelled`). Absences spanning that day
   are kept and listed in the preview, and so are later ones that touch a closed
   month (`absencesInClosedMonths`): the closed month refuses the cancellation
   until it is reopened. The deputy release (#1014) still runs. The after-commit
   work (sick note cleanup, deputy notices) runs on the caller's database client.
6. **Access** ends as at a departure: held expense officer, payroll access,
   personnel file officer and driving licence verifier grants, driving
   authorizations (also suspended ones), kiosk badges, the kiosk fob and the
   person's report share links. `applied` records the grant ids actually revoked.
   A badge stores the reason `revoked` and a fob `removed`; their audit rows name
   the deactivation (`{ reason: "employee_deactivated", deactivationId,
   employmentPeriodId }`).
7. **Retention**: the instant counts as the end of employment (see Personnel
   file retention). The paid seat is released (see Billing reconciliation).

**Preview.** *Deactivate* opens a dialog served by
`previewEmployeeDeactivationAction` (`deactivation/preview.ts`): the same
authorization and owner rules as the action, then
`planDeactivationConsequences` (`deactivation/plan.ts`), which lists every item
above with replacement-manager pickers. A new pick asks for the preview again.
The preview is advisory and takes no locks; the action recomputes the plan in
its transaction with the same predicates and refuses with
`refusal: "replacement_required"` while a report has no eligible replacement.
The acceptance suite (`deactivation/deactivation.integration.test.ts`) checks
that the preview lists exactly what the server applied. The browser gets the
plan without the planner notice's recipients (`DeactivationPreview`), which are
other users' ids and stay on the server.

**Request IDs and replay.** `deactivateEmployeeAction({ employeeId, requestId,
replacementManagers })` records one `employee_deactivation` row per request ID
(unique per organization) with the fingerprint, the instant, the picks, the
applied ids (`applied`, the #1441 checklist source) and the replay result. The
same request again returns its first result and repeats only the after-commit
work that is safe to repeat: session revocation, seat recount, export pause,
the planner notice and the deputy notices (both keyed, so nothing is sent
twice) and calendar deletions. Audit rows and the self-service absence notices
are not repeated; a deactivation reactivated since repeats nothing. The same
request ID with other picks is refused (`refusal: "request_conflict"`). The
history event `employee_deactivated` (`employee_departure_event`, no departure)
is written when the employee has an employment period.

**Lock order**, all in one transaction, so that the deactivation never waits
on a guard it should already hold while another writer waits on it: the absence
and period
submission approval write gates (rank 2, shared, via `withAuthorizationMutation`'s
`beforeProtection` hook), the exclusive organization configuration guard
(rank 3, `organizationWide: true`), the user guards (rank 4) of the person,
their reports, their own managers and the picked replacements, then the
organization row `FOR UPDATE` (`lockLifecycleOrganization`). The plan is computed under these locks, then the
employee is switched off with `deactivated_at = <instant>` and the areas apply
in order: manager links, team links, approval duties, shifts, absences, access
ends. Notices and other external effects run after the commit.

**Follow-up.** The employee page shows the deactivation's handovers and reviews
where a departure's show, with the instant in the organization's zone; reviews
are resolved and replacements assigned the same way
(`assignDepartureReplacementAction` accepts `deactivationId`). *Reactivate*
restores nothing and marks the open deactivation reactivated, so its pending
handovers stop (`employee_rehired`). It also resolves the deactivation's open
reviews and completes its undelivered tasks as obsolete (outcome `obsolete`),
each audited as `deactivation.follow_up_closed` with
`{ reason: "employee_reactivated", deactivationId }`: nobody could see or
resolve them once the person is current again. A task a worker holds at that
moment finishes on its own. A deactivation principal that names a row it does
not match is denied as `deactivation_mismatch`, and a deactivation that no
longer holds as `deactivation_not_effective`.

**Backfill of earlier deactivations (#1442).** Employees deactivated before
#1440 get its consequences once, through the one-off script
`pnpm employees:backfill-deactivations` (`apps/webapp/scripts/backfill-former-employees.ts`,
library `deactivation/backfill.ts`; deploy steps in `deploy/README.md`). It is a
dry run unless `--apply` is given. Both modes plan with
`planDeactivationConsequences`, so the dry run reports exactly what the real run
applies. It handles inactive employees with no effective or pending departure
and no open `employee_deactivation` row.

- **When they left**: `employee.deactivated_at` if already set, else the latest
  surviving `employee.deactivated` audit entry or SCIM `leave` event
  (`user_lifecycle_event`), unless a later `employee.reactivated` entry, SCIM
  `join` or the start of the current employment period undid it. The recovered
  instant is written to `employee.deactivated_at` (the trigger is not involved,
  audited as `employee.updated` with the backfill's reason) and gets the
  `employee_deactivated` history event. For an instant already on the employee,
  the action's `employee.deactivated` audit entry written just after it (within
  minutes) is matched: its admin is the actor, and the history shows the
  deactivation once. Member removal writes no such evidence. Audit entries live
  365 days. Without evidence the date stays *not recorded*.
- **Consequences** apply from the run instant (user decision 2026-10-24): the
  recovered instant is kept only as when they left (`deactivated_at`, *Former
  since*), so no past shift is reopened and no past absence cancelled. They run
  with `replaceManagers: false` and the reason `employee_deactivation_backfill`.
  Audit rows are attributed to the admin whose audit entry deactivated the
  employee, else to the organization's longest-standing current owner (or
  admin). A report who would be left with no current manager keeps the link. The
  deputy release is not repeated, because Deactivate has done it since #1014.
- **Record**: one `employee_deactivation` row per employee (reason
  `employee_deactivation_backfill`) is the idempotency marker. Its
  `deactivated_at` is when they left: the recovered instant, else the run
  instant, while `employee.deactivated_at` stays NULL. The reactivation
  checklist then says the date is not recorded. The approval handover (`offboarding-authority.ts`) treats such a
  row as effective while the employee stays off without an instant. The
  absence cancellation capability takes the row's instant in place of the
  missing one. The offboarding view marks the row `dateNotRecorded`.
- **Admins told**: each organization whose reports keep only a former manager
  gets one `former_employee_reports_without_manager` notification per current
  owner and admin. The notification lists the reports and links to the
  employee page (Settings → Employees when there are several). It is keyed by
  the listed reports.
- Each employee is applied in its own transaction, in the lock order above. An
  absence in a closed month is kept and listed rather than failing the
  employee. An employee that fails is listed, and the run exits non-zero. A
  second run changes nothing.

## Reactivation

*Reactivate* (#1441) runs `executeReactivation`
(`apps/webapp/src/lib/employee-lifecycle/reactivation.ts`) inside the
lifecycle transaction: it switches the employee on (the 0283 trigger clears
`deactivated_at`, so they are on the current roster again and the personnel
file retention clock stops: retention reads a deactivated employee's open
period as ended at `deactivated_at`), stamps the open `employee_deactivation` row
with `reactivated_at`, `reactivated_by` and a server-generated
`reactivation_request_id`, and records the history event
`employee_reactivated` (`employee_departure_event`, no departure, metadata
`{ deactivationId }`) when the employee has an employment period. It restores
no grant, badge, fob, driving authorization, manager link, team or project link,
shift or absence; the acceptance suite asserts that.

**Checklist.** The ledger row keeps the applied consequences (`applied`) and,
since migration 0286, the plan they were applied from (`plan`, with only the
chosen replacements among the replacement options), so a deleted absence can
still be named. `loadReactivationChecklist` (`reactivation-checklist-store.ts`)
returns the checklist of the employee's latest deactivation once it was
reactivated and until an org admin dismisses it (`checklist_dismissed_at`,
`checklist_dismissed_by`; first dismissal wins, for every admin).
`buildReactivationChecklistItems` (`reactivation-checklist.ts`) lists exactly
what `applied` lists and links each item to where it is granted again: reports
and own managers to the employee pages, grants to their settings tabs, kiosk
badges to the employee page, driving authorizations to
`/driving-licence/checks/<id>`, teams to `/settings/teams/<id>`, projects to
`/settings/projects`, shifts to `/scheduling`, absences to `/team/absences`,
share links to `/settings/report-share-links`. Approval duties are not listed:
they were handed over. An ended kiosk fob is not listed either: nobody grants it
again, the employee registers a fob themselves at a kiosk. The dialog after *Reactivate* and the card on the
employee page are org-admin only (`employee-reactivation.actions.ts`).

**History.** `loadLifecycleHistory` (`lifecycle-history.ts`) lists the
`employee_deactivated` / `employee_reactivated` events plus, for older ones,
the surviving `employee.deactivated` / `employee.reactivated` audit entries
(kept 365 days). Those audit entries now carry `deactivationId` or
`reactivationRequestId`, so an entry of a recorded event is shown once. The
Contract & Work Model card shows them in the organization's zone, to everyone
who may read the employment history.

## Access grants

When the departure takes effect, the expense officer grant, the payroll access
grant and the personnel file officer grant the employee *holds* are revoked in
the departure's transaction (#750, #866). Each revocation is audited as
`expense_officer.grant_revoked`, `payroll_access.grant_revoked` or
`personnel_file.grant_revoked` under the departure's initiator, with metadata
`{ reason: "employee_departure", departureId, employmentPeriodId }`. Grants of
other officers that *name* the departed employee in their scope are untouched,
so that employee's last reports can still be reimbursed and their personnel
file stays manageable (the departed employee keeps no access to it).

## Driving licence control

Driving authorizations, including suspended classes and person-wide suspension
state, end at the departure cutoff. Held driving licence verifier grants are
revoked at that same cutoff. Current verifier scope still permits reading an
ended employee's retained evidence; it never permits a new check while the
employee is departed. Employees lose their own access at the cutoff, including
when departure processing is delayed.

Check records and their supplements follow the driving licence policy's own
finite retention and legal-case holds. Departure does not delete them immediately
or apply Personnel File document retention. Rehire restores neither class
authorization nor verifier responsibility: a new original check and a separately
issued verifier grant are required. An old departure retry cannot affect the new
employment period. Old impediment reports remain historical evidence, rather
than being represented as resolved or applied to the new employment period.

## Kiosk badges

A kiosk badge (#889, Time Tracking ADR 0013) belongs to the employment period
it was issued in. Kiosks stop accepting it at the departure cutoff through the
employment access rule, also while departure processing is delayed; a scheduled
departure ends nothing early, and an edit or cancellation before the cutoff is
followed. When the departure takes effect, the badges of the ended period are
revoked in the departure's transaction (#1365), with `revoked_at` at the cutoff
(never before the badge was issued) and reason `employee_departure`, audited as
`kiosk_badge.revoked` under the departure's initiator with metadata
`{ reason: "employee_departure", departureId, employmentPeriodId }`. The
revocation names the ended period, so an old departure retry never touches a
badge of a later period. A rehire never revives a badge: a manager issues a new
one, which belongs to the new period; the employee card offers it only while
the employee has access. The kiosk PIN keeps its own rules and is left as is.

## Kiosk fobs

A kiosk fob (#1358, Time Tracking ADR 0014) is bound, like a badge, to the
employment period it was registered in. A fob only selects the employee; the
kiosk PIN still proves. Kiosks stop selecting anyone by it at the departure
cutoff through the employment access rule, also while departure processing is
delayed; a scheduled departure ends nothing early, and an edit or cancellation
before the cutoff is followed. When the departure takes effect, the fobs of the
ended period are ended in the departure's transaction (#1509, through
`endKioskFobLinks`), with `ended_at` at the cutoff (never before the fob was
registered), reason `departure` and `ended_by_user_id` the departure's initiator,
audited as `kiosk_fob.ended` under the initiator with metadata
`{ reason: "departure", departureId, employmentPeriodId }`. An old departure
retry never touches a fob of a later period.

A link whose employee no longer has access but whose departure was not
processed yet never selects, and it does not block the card: when someone else
registers it, that link is ended first, as the departure would end it. A
deactivation ends the fob too (reason `removed`, see Deactivation).

A rehire never revives a fob, and an ended link is never reopened: the employee
registers the card again at a kiosk, which links it to the new period. Once
ended, the card may be registered by someone else. The fob is in the
employee's personal data export (Integrations, `kiosk_fobs`: serial number,
registered at and where, ended at and why); kiosk badges are not. Fob rows are
deleted with the employee's record and with the organization (foreign-key
cascades).

## Absence deputies

When the departure takes effect, the employee is cleared as **deputy** on every
pending or approved absence of the organization that has not ended at the
cutoff (#1014), in the departure's transaction. "Not ended" is the absent
employee's own day (user timezone, then organization, then UTC); ended absences
keep their historical deputy. Each cleared absence is audited as
`absence.deputy_changed` under the departure's initiator with metadata
`{ actorKind: "system", reason: "employee_departure", departureId, employmentPeriodId }`
and queues one `notify_deputy_release` task, which tells the absent employee
and their eligible managers (never the departed person) that the deputy is no
longer available. A deputy-required absence then shows *Deputy missing* on the
team absence page until someone names a new deputy. While a departure is
scheduled, the departure card lists *Deputy on running or upcoming absences: N*,
counted with the same rule, so the handover can arrange new cover.

Deactivations outside a departure clear the deputy the same way, in their own
transaction, and notify after the commit: *Deactivate* (`employee_deactivated`,
audited under the acting admin), member removal or leaving
(`member_removed`, under the rejecting admin for pending-member rejection,
otherwise the removed member's own user) and SCIM deprovisioning
(`scim_deprovisioned`, under the deprovisioned user, with the connection id).
A rehire or reactivation restores nothing.

## Personal data reminder

Personal data self-service on **My data** ends at the cutoff; afterwards only an
admin export reaches the employee (Organization ADR 0003). Recording a departure
with a future cutoff, or moving its cutoff, queues one
`notify_data_export_reminder` task (#1173). The worker tells the departing
employee, in-app and by email, to download their data on My data before the
cutoff day, shown in the departure's organization zone. Re-saving without a new
cutoff queues nothing; *Offboard now* has no future cutoff and sends nothing. At
delivery the task sends only while the departure is still pending with the same
future cutoff and no later reminder supersedes it; kiosk-only employees are
skipped, because their notifications would go to their managers.

## Rehire

*Rehire employee* is offered after an effective departure. It requires approved
membership; otherwise re-invite first. Confirm role, team, primary manager, work
policy and all contract terms. The new period starts at the server's instant,
and its terms start on the organization-local date of that instant, so terms
dated on the rehire day replace them (#1162). Terms dated before the rehire day
are refused. The gap between periods is shown in the employment history, which
is grouped by stint (legacy periods without a recorded start show *Date not
recorded*). A rehire never restores expense officer, payroll access or
personnel file officer grants; an admin must grant them again. Nor does it
revive a kiosk badge (issue a new one) or a kiosk fob (the employee registers
it again at a kiosk).

## Personnel file retention

A departure starts the retention of the employee's documents (#870): a
document's retention start is the end of the later of the year of the last day
of employment (in the organization's timezone) and the year of its document
date. Once the category's retention period has passed, the document is listed
as *due for deletion* and is purged only when a personnel file officer confirms.
The open period a rehire creates stops the clock: none of the employee's
documents is due while they are employed again. A deactivation ends the
employment the same way (#1440): while the employee stays deactivated, their
open period counts as ended at `employee.deactivated_at`, read by the shared
loader `lib/personnel-file/retention-employment.ts` for both the documents'
due list and the deletion of document requests. Reactivation clears that
instant, which stops the clock again. Someone deactivated before the instant
was recorded (migration 0283) has no retention start until the #1442 backfill
recovers it. Their documents are listed as *retention start unknown*, and stay
listed there when no evidence of the date survives. A former employee whose
employment end was never recorded (no employment period, or only a legacy
period without an end) has no retention start: their documents are listed
separately as *retention start unknown*, never counted by the daily reminder,
and purged only when an officer reviews and confirms them. A purge also
removes the document's descriptions (title, file name, ZIP entry names and
free-text reasons) from every audit record about it (#923). The records
themselves, with the actor, the employee, the category, the dates and their
timestamps, stay until the 365-day audit-log cleanup.

## Billing reconciliation

A billable seat is an approved member who is not a former employee (#1439):
not deactivated, not departed (effective, or past the cutoff of a due departure
that would take effect). This holds whether or not the release gate is open. A
member without an employee profile counts until the release; afterwards a seat
requires an employee profile. Departure and rehire each queue a `billing_sync`
task that recomputes the current count and delivers it in order; an uncertain
Stripe outcome is reconciled rather than blindly resent. Local seat counts are
updated even when Stripe is disabled.

*Deactivate* and *Reactivate* have no departure to hang a task on, so they
reconcile the organization's seats after the commit, as member removal does
(`reconcileBillingSeatsForOrganization`, only while billing is enabled). A
failed delivery is logged, and the hourly billing seat reconciliation job
settles it.

## When a former employee left

`employee.deactivated_at` (migration 0283) is kept by a trigger: set to the
transaction's now when `is_active` turns false without the writer naming an
instant, cleared when it turns true. A departure taking effect writes its own
cutoff. `employee_left_at(...)` returns the later of the latest departure that
ended access and `deactivated_at`, so a rehire followed by a deactivation
reports the deactivation; `employee_left_on(...)` gives that moment as the
organization-local date. Read them through `readEmployeeLeftOn`,
`employeeLeftAt`, `formerSinceDate` or `formerEmployeesAmong`; views show
*Former since <date>*, or *date not recorded* for employees deactivated before
0283 whose date the #1442 backfill could not recover from surviving evidence
(see Deactivation).

## Release gate and rollback

`EMPLOYEE_OFFBOARDING_RELEASE_READY` in
`apps/webapp/src/lib/employee-lifecycle/release.ts` controls whether new
departure and rehire commands (and the preview) are accepted and whether the
maintenance job runs. Review resolution, replacement assignment and retries stay
available regardless.

**Status: closed.** Activation waits for the browser verification required by
#341 task 3.7: apply migrations 0071–0077 to the target database, flip the gate,
and click through schedule, edit, cancel, offboard now, the follow-up list
(resolve, retry, assign replacement), the directory links and rehire, in both
English and German.

- **Disabling new commands does not undo effective departures.** Access and seat
  decisions for existing departures are enforced by the database regardless of
  the gate, and due departures still deny access at their cutoff.
- With the gate closed the maintenance job does not materialize or deliver;
  re-open it (or run the job) to finish pending follow-up.
- **Rolling back the schema after activation is unsupported**: migrations 0071–0073,
  0076 and 0077 hold departures, periods, reviews, seat delivery and audit that
  other tables and access checks depend on.

## Operational checks

- If a local database was created with `drizzle-kit push`, install the access
  functions before running setup. See [schema push and repair](database-schema.md#commands).

- Real-PostgreSQL suites: `pnpm --filter webapp test:approval-workflow-repository:integration`
  (includes `acceptance.integration.test.ts` with the ten cross-system scenarios).
- A departure stuck *pending* past its cutoff already denies access and the paid
  seat; the next `cron:employee-departures` run materializes it.
- Follow-up counts on the departure card come from persisted tasks and reviews,
  never from guesses.
