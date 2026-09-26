# Canonical absence escalation transfer — #298 / T34

## What this slice adds

Scheduled or management-authorized human escalation replaces **one** overdue
canonical absence assignment with an eligible backup manager of the requester,
journals the transfer atomically with the workflow transition, revokes the
former assignment on the web decision path, and lets the replacement find and
decide the approval in the web inbox. Nothing is active until an organization's
escalation ownership is switched (see [Activation blockers](#activation-blockers)).

Module: `apps/webapp/src/lib/approvals/escalation/`

| File | Responsibility |
| --- | --- |
| `kinds.ts` | Client-safe: the admitted kinds per authority and the canonical replacement-route rule (#326) |
| `transfer-evaluation.ts` | Pure: lineage/allowance/actionable-instant classification, candidate order, due decision, operation identity |
| `candidates.ts` | Requester-manager eligibility plus an actual inbox/decision path per candidate |
| `transfer-store.ts` | Journal reads and the atomic journal + delivery-event insert |
| `transfer.ts` | `processDueEscalations`, `escalateAssignmentByManager`, `listHumanEscalationCandidates` |
| `decision-authority.ts` | Decision target selection and revocation after escalation |
| `scheduled-job.ts` | `cron:approval-escalation` entry point (scope and limits only) |

Supporting changes outside the module:

- `workflow/ports.ts`, `runtime.ts`, `transition-engine.ts`, `state-machine.ts`:
  the narrow `approval-escalation` system principal.
- `server/absence-approvals.ts`: decision target selection and eligible-manager
  fallback revocation.
- `lib/authorization/principal-loader.ts`: the organization principal loader,
  extracted unchanged from `getPrincipalContext` so candidates can be checked
  against the existing CASL model inside a transaction and in workers.
- `maintenance.ts`: privileged linked-lifecycle cleanup of transfer journals.
- `/settings/approval-escalation`: a **Transfer…** action on open attention
  items for canonical absence assignments.

## Authority and principal

- `ApprovalWorkflowPrincipal` gains `{ kind: "system", systemId: "approval-escalation" }`.
  It resolves to the ordinary system actor (no fabricated human) and the engine
  admits it **only** for `escalate` with the `system` grant. Approve, reject,
  cancel, expire, reassign and forged management grants are forbidden.
- Its receipts use `v2:["system","approval-escalation",1]`. Every existing
  receipt keeps its `v1` fingerprint; nothing historical is rewritten.
- Human escalation requires explicit `manage Approval` for the active
  organization and a caller-supplied idempotency key. The workflow runtime used
  for it grants `manage_approval` only for `escalate` by that same employee;
  there is no eligible-manager fallback.
- The existing `escalate` transition does the replacement: it cancels only the
  source assignment, preserves siblings, creates the replacement with
  `reassignmentMetadata.kind = "escalation"`, mirrors the compatibility
  representative (`approval_request.approver_id`, chain-stage approver) and
  completes the receipt. The approval stays pending.

## Due processing

`processDueEscalations({ organizationId, limit })` (default 100, max 500):

1. Fresh ownership read: `approval_escalation_control.owner = 'escalation'` and
   not paused, else it returns without touching anything. The policy row must
   exist and be enabled.
2. Discovers pending assignments of the active human stage of pending absence
   workflows whose `assigned_at` is at least one window old (the actionable
   instant is never earlier than `assigned_at`, so nothing due is skipped),
   oldest first.
3. Each assignment commits in its **own transaction**, which re-reads ownership
   `FOR SHARE`, acquires the absence write gate, reloads the snapshot and
   revalidates that the source is still a pending assignment of the active
   human stage. Legacy-authoritative modes are skipped here; they are
   discovered and transferred by the legacy path (see
   [Legacy-authoritative transfers](#legacy-authoritative-transfers--299--t35)).
4. An exact committed operation (journal row for the operation key) replays
   before any fresh check.
5. Decision (all holds commit an attention incident and return normally):

| Condition | Outcome |
| --- | --- |
| Lineage/journal/compatibility contradiction, unproven actionable instant | hold `ambiguous_history` |
| Policy disabled or before the exact deadline | not due |
| Lineage already used its automatic transfer | hold `replacement_overdue` |
| No replacement inbox path (sibling pending assignments, or no canonical-to-legacy mirror) | hold `unsupported_route` |
| No eligible candidate | hold `no_eligible_backup` |
| Otherwise | transfer to the first ordered candidate |

A lost race against a decision or another transfer (`version_conflict`,
reassignment conflict) is counted as `raced`, not a failure.

### Evidence rules

- **Actionable instant**: native canonical assignments use `assigned_at`.
  Stages reconstructed from legacy rows (`resolverSnapshot.kind` of
  `legacy_direct`/`legacy_chain`) never trust their reconstructed timestamp;
  they use `approval_escalation_control.escalation_owned_since` (the recorded
  rollout fallback, a full window from the switch). Without it the assignment
  is held. Replacements created by the engine always carry native timestamps.
- **Deadline**: `actionableAt + current policy window` in absolute hours
  (`evaluateEscalationDeadline`); due exactly at the deadline. Policy edits move
  deadlines without restarting clocks; the transfer records the evaluated
  deadline and revision.
- **Lineage allowance**: walks `reassigned_from_assignment_id` to the root. Only
  a journaled `scheduled` transfer consumes the allowance; human transfers and
  human reassignments do not, and a later human reassignment never resets it.
  An `escalation` replacement without a journal row (for example an older
  channel mutation) is ambiguous, never an unused allowance.
- **Compatibility conflict**: a pending `approval_request` whose approver differs
  from the authoritative assignment is ambiguous history.

### Candidates

Eligible requester managers from `resolveEligibleManagers` (direct managers,
else team primary managers; active, `manager`/`admin`), excluding the
requester, the current approver and pending sibling assignees. Each must have an
actual decision path: an approved member and active employee whose CASL ability
(`defineAbilityFor` over the loaded principal) admits the approvals inbox and
`approve`/`manage` on this requester's `Approval`. Bot linkage is not
considered. Order: primary manager, longest `employee_managers.assigned_at`,
then employee id. Missing candidates never broaden authority.

## Journal and delivery event

`0074_escalation_transfer_journal.sql`:

- `approval_escalation_control.escalation_owned_since` — recorded by the
  exclusive ownership switch (not written by this slice).
- `approval_escalation_transfer` — one immutable row per committed transfer
  (`BEFORE UPDATE` trigger rejects updates). Unique per organization and
  operation key, and per source assignment. Links the workflow, source and
  replacement assignments, the `assignment.escalated` workflow event (the
  canonical audit record) and the receipt identity/fingerprints. Scheduled rows
  must carry actionable instant, evidence kind, deadline, policy revision and
  lineage root; human rows carry none of the deadline facts and may lack a root
  when the lineage is unknown. Actor: the named system capability, or the human
  user + employee (never a fabricated user).
- `approval_escalation_transfer_event` — the immutable delivery event
  (`assignment_transferred`) committed with the transfer for replacement
  delivery (#300). Only `expansion_status`/`expanded_at` may change.

Operation identity: `escalation:auto:v1:{workflow}:{stage}:{lineageRoot}:{source}`
for automatic transfers (never wall-clock time or the chosen replacement) and
`escalation:human:v1:{userId}:{idempotencyKey}` for human ones. The operation
key is also the workflow receipt's idempotency key. A reused human key with a
different request (recipient, assignment or reason) is an idempotency mismatch.

Human transfers also write an `audit_log` row
(`approval_escalation.transferred`). A successful transfer resolves open
`no_eligible_backup`, `unsupported_route` and `replacement_overdue` incidents for
the source assignment.

## Revocation on the decision path

`executeAbsenceDecisionInTransaction` now resolves its target with
`selectCanonicalDecisionTarget`:

- Single-assignment stages resolve exactly as before, so historical receipts
  keep their command fingerprints.
- A legacy request id never targets cancelled history: the actor's own pending
  assignment, else the single pending assignment, else (closed stage, exact
  retry) the single deciding assignment.
- A former assignee replaced by escalation gets `ApprovalAssignmentReassignedError`
  → `ConflictError` `approval_reassigned` ("This approval was reassigned…"), which
  the inbox shows as a stale item. No management override is invoked silently.

`createAbsenceApprovalManagementAuthorization` no longer lets eligible-manager
fallback decide an assignment whose lineage contains an escalation; explicit
organization `manage Approval` remains a separate, audited path. Bot cards stay
review-only for absences, and after the mirror retargets the representative a
former assignee's bot action is `unauthorized`. Replacement delivery and
old-card retirement (#300) are described in
[approval-delivery.md](approval-delivery.md#escalation-replacement-delivery--300--t36).

## Scheduling

`cron:approval-escalation` runs every 5 minutes and calls
`processDueEscalations` for each organization whose control row has
`owner = 'escalation'`. With no such organization it only reads the control
table. Legacy channel checkers keep their execution-time suppression (#271).

## Cleanup

`deleteApprovalInTransaction` locks `approval_escalation_transfer` with the
other approval stores, deletes the journal rows of the verified workflow links
explicitly (delivery events cascade) and reports them as `escalationTransfers`
(CLI, platform-admin card and its audit metadata). Whole-organization deletion
cascades from `organization`. Journal FKs to the workflow, its assignments and
its event prevent late recreation after a purge. Attention incidents (#297) are
not part of this lifecycle and are not deleted.

## Activation blockers

- **No ownership writer.** Nothing sets `owner = 'escalation'` or
  `escalation_owned_since`; the exclusive, drained cutover (#255 §7, #271) and
  policy preparation for every activated organization are separate authorized
  work. Until then this module never transfers.
- **Scope:** canonical absences in `canonical` mode with one pending assignment
  per stage. Legacy absences are covered by #299 below and the other admitted
  kinds by [#326](#admitted-kinds-326--t61); `complete` mode (the absence inbox
  has no canonical discovery) and parallel assignments are held, not
  transferred.
- **Delivery:** replacement cards and old-card retirement (#300) exist for
  Telegram only and need a delivery control; see the #300 blockers in
  `approval-delivery.md`. Otherwise the replacement finds the approval in the
  web inbox.
- **Starvation:** persistent holds are re-examined each run and count towards
  the batch limit. Organizations with more held assignments than the limit need
  a larger limit or a follow-up cursor.
- **Runtime evidence not produced:** the processors against a running database,
  lock behavior with the ownership switch, transfer-versus-decision races across
  real transactions, the replacement's inbox → approve/reject through the
  running app, and cleanup through the maintenance path on real rows. Only the
  migration's constraints and triggers were checked against PostgreSQL (see
  below); pure and mocked unit tests do not prove the other runtime guarantees.

## Legacy-authoritative transfers (#299 / T35)

While an organization's absences are decided by the legacy owners (rollout mode
`legacy`, `shadow` or `ready`), the authority is the single pending
`approval_request`. The same module transfers it; nothing is active before the
ownership switch described above.

| File | Responsibility |
| --- | --- |
| `workflow/legacy-escalation-lineage.ts` | The lineage a legacy request carries in `approval_request.metadata.escalation` |
| `transfer-evaluation.ts` | `classifyLegacyAssignmentEvidence`, `legacyAutomaticEscalationOperationKey` |
| `legacy-transfer.ts` | Authority selection for discovery, subject loading, the atomic legacy transfer, scheduled and human preparation |
| `legacy-transfer-store.ts` | Journal reads for a legacy request, decision-path transfer lookup |
| `transfer-context.ts` | Ownership/policy reads, escalation runtime, race classification (shared with the canonical path) |
| `transfer.ts` | `processDueEscalations` (selects canonical or legacy discovery), `escalateLegacyApprovalByManager`, `listLegacyHumanEscalationCandidates` |

### Authority selection and processing

`processDueEscalations` reads the absence rollout mode once for discovery: a
mode that decides canonically discovers canonical assignments as before;
`legacy`/`shadow`/`ready` discover pending legacy absence requests created at
least one window ago, oldest first (`summary.authority`). Each request then
commits in its own transaction, which re-reads ownership `FOR SHARE`, acquires
the absence write gate (the authoritative mode check; a request found under
canonical authority is skipped as `canonicalAuthority`), locks the request
`FOR UPDATE` and captures the verified legacy state
(`captureAbsenceLegacyApprovalState`).

| Condition | Outcome |
| --- | --- |
| Legacy state cannot be verified or does not match the request | hold `ambiguous_history` at once |
| A `teams_escalation` row exists for the request (Teams mutated approvers without journal evidence) | hold `ambiguous_history` |
| Journal and the request's lineage disagree, lineage unreadable, or current approver is not the last replacement | hold `ambiguous_history` |
| Policy disabled or before the exact deadline | not due |
| Chain stage (the stage row binds the approver) | hold `unsupported_route` once due |
| Shadow/ready request without an observed pending workflow | hold `unsupported_route` (`legacy_observation_missing`) |
| Lineage already had a scheduled transfer | hold `replacement_overdue` |
| No eligible candidate | hold `no_eligible_backup` |
| Otherwise | transfer to the first ordered candidate |

Exact committed replay (journal row for the operation key) precedes every fresh
check. A conditional update that finds the request decided or moved is a race
(`raced`), never a failure.

### Evidence

- **Actionable instant:** the request's persisted `created_at` for its original
  approver (`legacy_request_created_at`; no other writer changes a legacy
  absence approver except the Teams checker, which is held), the journaled
  `transferred_at` for a replacement (`legacy_transfer_at`). Deadlines use the
  current policy exactly as for canonical assignments.
- **Lineage allowance:** only a journaled `scheduled` legacy transfer consumes it;
  human transfers never do.
- **Candidates:** the same requester-manager eligibility and decision-path check
  as canonical transfers. A legacy absence has no parallel requests, so there
  are no siblings to preserve or exclude.

### The atomic transfer

In one transaction, through the legacy write coordinator:

1. `approval_request.approver_id` moves from the source to the replacement with a
   conditional update (still pending, still the source approver), and
   `metadata.escalation` appends `{sequence, from, to, transferredAt, initiator,
   actorEmployeeId}` (recording the request's observed pending instant before
   the first transfer). Other metadata is kept.
2. In `shadow`/`ready`, the change is mirrored into the observed workflow: the
   planner rebuilds every earlier holder as a cancelled assignment and the
   current holder as an `escalation` replacement, and emits
   `assignment.escalated` like the canonical transition. Later decisions rebuild
   the same history from the request's lineage. A contradictory observation
   rolls the transfer back; the scheduled path then commits an
   `ambiguous_history` hold (`legacy_observation_rejected`) in a fresh
   transaction, the human path returns `unsupported`.
3. The journal row (`authority_mode = 'legacy'`) with its delivery event. It
   names the legacy request by value (`legacy_approval_request_id`) and the
   replaced holder's position (`legacy_source_sequence`), never a canonical
   workflow, stage or assignment; any observation is recorded separately as
   `observed_workflow_id`/`observed_event_id`. The row is the replay receipt:
   operation key, `v2` system or `v1` employee actor fingerprint and
   `absence-legacy-transfer:v1` command fingerprint.
4. Human transfers write the `approval_escalation.transferred` audit row; the
   scheduled capability is attributed by the journal only (no fabricated user).
   Open `no_eligible_backup`/`unsupported_route`/`replacement_overdue`
   incidents for the source holder are resolved.

Operation identity: `escalation:auto:legacy:v1:{request}:{sequence}:{sourceApprover}`
for automatic transfers; human transfers share the canonical
`escalation:human:v1:{userId}:{idempotencyKey}` namespace, with the request
fingerprint naming `legacy:{request}`.

`0080_legacy_escalation_transfer.sql` makes the canonical columns nullable,
adds the legacy and observation columns, and replaces the mode, evidence and
deadline checks so canonical rows keep every canonical identity and legacy rows
carry none. A legacy source position is unique per organization and request.

### Decision path

`executeAbsenceDecisionInTransaction` (legacy branch), after exact replay and
before any fresh evidence check or mutation: when the addressed request was
ever transferred and the actor is not its current approver, the decision is
refused with `ApprovalAssignmentReassignedError` (409 `approval_reassigned`)
unless the trusted caller's explicit organization `manage Approval` check
passes. Eligible-manager fallback therefore never bypasses a replacement; the
replacement decides as the request's approver. Untransferred requests keep
the unchanged legacy authorization. The check locks the request row like the
transfer does, so a decision and a transfer serialize and a transfer that
commits first is always seen. Former holders and other eligible managers still
see the request in the inbox (as #298 does for canonical assignments); acting
on it returns the stale "reassigned" outcome.

### Management UI

Attention items for legacy requests (subject `legacy_assignment`) offer
**Transfer…** like canonical ones; the settings actions accept either an
`assignmentId` or an `approvalRequestId`.

### Cleanup

Approval maintenance links legacy journal rows to their request and observed
workflow, deletes them explicitly (delivery events cascade), reports them in
`escalationTransfers`, and accepts a legacy transfer ID directly after a
cancellation removed the request.

### Activation blockers (legacy)

- Everything under [Activation blockers](#activation-blockers) (ownership
  writer, delivery, starvation).
- Legacy chain stages are held, not transferred.
- Shadow/ready requests submitted before shadowing have no observation and are
  held (`legacy_observation_missing`).
- Replacement notification and old-card retirement: since #408, escalation's
  replacement pass expands legacy absence and expense transfer events into
  their legacy delivery lifecycle (replacement card, "Reassigned" former
  cards); see
  [Legacy escalation replacement delivery](approval-delivery.md#legacy-escalation-replacement-delivery--408)
  and its activation blockers. Without a delivery control for the kind the
  replacement finds the request in the web inbox as its approver.
- Old binaries: pre-deployment binaries decide legacy absences without the
  transfer check. Deploy before activation and drain old workers.
- The approval write-boundary scanner cannot read sources on Windows; the new
  `approval_request` update exception is verified by CI only.
- Cutover from `shadow`/`ready` to `canonical`: canonical lineage classification
  reads canonical journal rows only, so a still-pending absence whose observed
  workflow carries a mirrored legacy transfer is held as `unjournaled_escalation`
  (conservative) rather than recognized through `observed_event_id`. This joins
  #288's in-flight classification (blocker 2).
- A contradicted observation is held only for evidence refusals (planner,
  write-boundary, capture, repository `malformed`/`source_conflict`), after
  re-checking ownership, pause and policy; persistence invariants are retried
  as failures.

### Verification — 2026-09-25

Unit seams: `legacy-escalation-lineage.test.ts` (representation),
`legacy-transfer-evaluation.test.ts` (classification, holds, deadline, identity),
`legacy-observation-planner-escalation.test.ts` (shadow history across transfer
and decision), `server/absence-approvals.test.ts` (reassigned refusal, explicit
management, replay first), `maintenance.test.ts` (legacy journal cleanup).

PostgreSQL 16 runtime evidence (`escalation/legacy-transfer.integration.test.ts`,
disposable label-owned database, full migration chain including `0080`, run
together with #288's suite: 23/23) through the real callers
(`requestAbsenceEffect`, `processDueEscalations`, the escalation settings
actions, `approveAbsenceEffect`, `deleteApproval`):

- Not due one minute before the deadline; transferred exactly at it with system
  attribution, no audit row, no canonical workflow; the former holder (still an
  eligible manager) is refused as reassigned; the replacement approves.
- A later run holds `replacement_overdue` without a second transfer.
- Two simultaneous scheduled runs commit exactly one transfer; a transfer racing
  the current holder's decision leaves exactly one winner; an eligible
  non-holder's decision waits on an in-flight transfer and is then refused as
  reassigned (this test fails without the row lock).
- Human transfer through the settings action: candidates, audit row, exact
  replay, idempotency mismatch; a human transfer does not consume the allowance;
  explicit management decides.
- `shadow`: the observed workflow shows the cancelled original (unchanged
  `assigned_at`) and the escalated replacement with the journaled observed
  event; after the replacement's approval the history is intact.
- Teams attempt and chain stage are held; canonical mode selects canonical
  discovery; maintenance removes the journal and its event; the migration's
  checks reject a legacy row naming a workflow and a duplicate lineage position,
  and journal rows stay immutable.

Not executed: `ready` mode, bulk inbox decisions, mobile callers, bots
(absence cards stay review-only), deployment, and the write-boundary scanner.

## Admitted kinds (#326 / T61)

Escalation now transfers every approval kind that has a real inbox and
decision path under its current authority, and holds the rest explicitly.
The scope was decided with the user on 2026-09-25: canonical time kinds plus
legacy travel expenses. Legacy and shadow time authority followed in #439
(see [Legacy time authority](#legacy-time-authority-439)).

| Kind | Canonical authority (`canonical`) | `complete` | Legacy authority (`legacy`, `shadow`, `ready`) |
| --- | --- | --- | --- |
| Absence | Transfer (#298) | Held | Transfer (#299) |
| Manual time submission, policy clock-out, time correction | Transfer | Held (`time_inbox_requires_compatibility_mirror`) | Transfer (#439); chain stages, unverifiable state and missing or contradicted observations held |
| Travel expense | Held (`travel_expense_without_legacy_authority`; no canonical adapter) | Held (same) | Transfer in `legacy`; `shadow`/`ready` held (`legacy_observation_unsupported`) |

In every kind, parallel pending assignments and legacy chain stages are held
as before. `kinds.ts` names the admitted kinds and the canonical route rule;
the management UI offers **Transfer…** for exactly these kinds.

### Discovery

`processDueEscalations` reads the rollout mode of each discovered kind once
(`summary.authorities`, which replaces the absence-only `authority`) and
discovers, within one batch limit and oldest first:

- pending assignments of active human stages of every admitted kind that
  decides canonically, and
- pending legacy requests: absences under legacy authority, travel expenses
  (under every mode), and time entries while any time kind is
  legacy-authoritative. Compatibility representatives of canonically decided
  workflows are excluded; they are discovered through their assignments.
  Requests that already carry an open hold on a route no transfer can resolve
  (`UNTRANSFERABLE_ESCALATION_ROUTES`: expenses without legacy authority,
  unrepresented or unclassified time requests, expense observation modes) are
  excluded too, so permanent holds cannot starve the batch. Their hold stays
  open, and the management UI offers no **Transfer…** on them.

Each item still commits in its own transaction under the write gate of its
own kind, which re-reads the mode. A time request represented by a stage of a
canonically decided workflow is skipped (`canonicalAuthority`); legacy time
requests follow [Legacy time authority](#legacy-time-authority-439).

### Canonical time kinds

The canonical path is kind-agnostic: the workflow `escalate` transition
replaces the one pending assignment, the canonical-to-legacy mirror moves the
compatibility representative (including its pinned assignment metadata), and
the journal records the kind. Lineage, actionable instant, deadline, allowance,
candidate eligibility, replay and races are the #298 rules unchanged.

Revocation on the decision path, in both time decision owners
(`executeOrdinaryWorkPeriodDecisionInTransaction` and
`executeTimeCorrectionDecisionInTransaction`):

- A fresh decision of the pending replacement by an employee escalation
  replaced in that stage returns `approval_reassigned` (409,
  `assertNotReplacedByEscalation`), before any authorization.
- Eligible-manager fallback on a lineage that contains an escalation never
  decides. An eligible manager gets `approval_reassigned`; anyone else stays
  unauthorized.
- Explicit organization management still decides. It needs CASL
  `manage Approval`, and on the work-period path also the inbox's
  organization-wide flag.
- Bound time cards: a card bound to a replaced assignment decides nothing.
  The outcome is `review_required` with reason `stale` or `reassigned`.

The replacement finds the approval in the web inbox and decides it through the
existing routes. Replacement cards and former-card retirement use the #300
escalation delivery unchanged (the event names the kind and the delivery
control is per kind); they were verified with Telegram.

### Legacy travel expenses

The legacy path now loads its subject per kind. For travel expenses, the
request is transferable when all of these hold:

- it is the claim's only pending request;
- the claim is still `submitted` by the requester;
- no approval chain instance exists for the claim;
- the rollout mirrors nothing.

The transfer is the #299 atomic transfer: a conditional update of
`approval_request.approver_id`, the lineage in `metadata.escalation`, and the
journal row with its delivery event. The journal row names
`workflow_type = 'travel_expense'`, the claim as source, and the command
fingerprint `travel_expense-legacy-transfer:v1`. Absence rows keep
`absence-legacy-transfer:v1`.

`executeTravelExpenseDecisionInTransaction` looks up the addressed request (or
the claim's pending request) with the same row lock as the transfer. When that
request was ever transferred and the actor is not its current approver, the
result is `approval_reassigned` unless the trusted caller's explicit
organization management check passes. Bound expense cards never carry
management; their result is `review_required` with reason `reassigned`. This
applies to the inbox, the expense page actions and cards alike.

### Activation blockers (#326)

- Everything under [Activation blockers](#activation-blockers) and
  [Activation blockers (legacy)](#activation-blockers-legacy): ownership
  writer, drained cutover, policy preparation, starvation.
- **Legacy and shadow time authority** transfers since #439; its own
  blockers are listed under
  [Activation blockers (#439)](#activation-blockers-439).
- **`complete` mode and parallel assignments** are held for every canonical
  kind.
- **Excluded holds:** a legacy request held on an untransferable route is
  not re-examined, so a later change of its approver does not refresh that
  hold until an attention recheck or disposition closes it.
- **Expense delivery:** since #408 the replacement gets its card and the
  former holder's cards are retired as "Reassigned" (see
  [Legacy escalation replacement delivery](approval-delivery.md#legacy-escalation-replacement-delivery--408));
  pressing a former card decides nothing. Expense `shadow`/`ready` modes and
  approval chains are held.
- **Providers:** replacement cards for time kinds were exercised with Telegram
  only. Slack, Teams and Discord use the same #300 owner but have no runtime
  evidence for time kinds.
- **Old binaries:** pre-deployment binaries decide time kinds and expenses
  without the revocation checks. Deploy everywhere and drain old workers
  before an organization's ownership moves.
- **Not executed:** bulk inbox decisions, the #301/#302 web decision pages
  outside the inbox routes, and deployment.

### Verification — 2026-09-25

PostgreSQL 16 (disposable label-owned runner, full migration chain) through
the real callers:

- **`time-kinds.integration.test.ts` (11 tests).** Submissions run through
  the real actions: `createManualTimeEntry`, `clockIn`/`clockOut` with a
  forced policy clock-out, and `requestTimeCorrection`. Transfers run through
  `processDueEscalations`; decisions through the real inbox list and
  approve/reject routes with CASL abilities; cards through the delivery owner,
  escalation replacement delivery and the Telegram webhook. The suite covers:
  - For each time kind: nothing is discovered one minute before the deadline,
    and the transfer happens exactly at it with system attribution.
  - The compatibility representative follows the transfer.
  - The former holder and another eligible manager get 409 "reassigned".
  - The replacement lists the approval and approves it.
  - The replacement can also reject; a later run holds `replacement_overdue`.
  - Explicit management decides.
  - Two concurrent runs commit exactly one transfer, and a transfer racing
    the holder's decision has exactly one winner.
  - A human transfer is recorded with audit and exact replay, and it does not
    consume the automatic allowance.
  - Delivery: the replacement card is sent and the former card retired
    ("Reassigned"). A press on the former card decides nothing; the
    replacement's press approves.
  - Legacy time authority was held with `legacy_time_authority` (replaced by
    the #439 transfer; that test moved to the #439 suite).
  - Approval maintenance removes the journal.
- **`expense-transfer.integration.test.ts` (9 tests).** It runs the real
  draft/upload/submit actions, the processor, the settings actions, the inbox
  approve route, the expense page action, delivery and the Telegram webhook.
  The suite covers:
  - Nothing is discovered before the deadline; the transfer happens exactly
    at it.
  - The lineage lands on the request, and the event stays pending.
  - The former holder is refused through the inbox and the expense page, and
    another eligible manager is refused too.
  - The replacement approves, and the decision evidence names them.
  - `replacement_overdue` is held on a later run.
  - The former holder's card press decides nothing and records no invocation.
  - The management transfer has audit and replay and does not consume the
    allowance; explicit management decides.
  - Concurrent runs commit one transfer, and a transfer racing a decision has
    one winner.
  - A chain stage is held, and maintenance cleans up the journal.
  - Under a `canonical` expense rollout the request is held visibly
    (`travel_expense_without_legacy_authority`) and later runs skip it.
- **Regressions:** run together with #299's legacy absence suite, #300's
  replacement delivery, #296's expense suite, #325's time presentation and
  #301/#302's correction and work-period suites: 9 files, 349 tests passed.

Unit seams: `kinds.test.ts`, `decision-authority.test.ts` (revocation and
fallback rules shared by every canonical kind).

## Legacy time authority (#439)

Under `legacy`, `shadow` and `ready`, the legacy owners decide manual time
submissions, policy clock-outs and time corrections, so the authority is the
pending `approval_request` (entity type `time_entry`). Escalation transfers it
with the #299 atomic transfer: the conditional approver move, the lineage in
`metadata.escalation`, the journal row and its delivery event, all in one
transaction. The command fingerprint is `<kind>-legacy-transfer:v1`
(`manual_time_submission`, `policy_clock_out`, `time_correction`); absence
and expense fingerprints are unchanged.

### Kind and subject

A time entry's request can belong to three kinds, so the kind is established
before the kind's write gate is taken, and verified after the row lock:

1. **Resolve.** The kind of the workflow whose stage represents the request
   (`legacy_approval_request_id`), otherwise the kind its decision owner
   classifies it as (`classifyPersistedTimeApprovalRequest`: metadata,
   reason, the work period's pending changes and the verified correction
   rows). A request nothing classifies is held once due
   (`legacy_time_unclassified`, untransferable): no owner could decide it.
2. **Authority.** Under the kind's gate, a represented request of a
   canonically deciding kind is `canonicalAuthority`; an unrepresented one is
   held once due (`legacy_time_without_legacy_authority`, untransferable).
3. **Verify.** The request is locked `FOR UPDATE` and must be its work
   period's only pending request. The verified capture of its kind must
   confirm the kind, requester, approver and pending status of the locked row:
   `captureOrdinaryWorkPeriodLegacyState` for manual submissions and policy
   clock-outs, `captureTimeCorrectionLegacyApprovalState` for corrections.
   A capture failure or mismatch is held at once as `ambiguous_history`
   (`legacy_state_unverifiable` or `legacy_state_mismatch`); a chain stage
   is held once due (`legacy_chain_stage`).

The lineage extends the locked row's **raw** metadata. The captures
normalize metadata to what they verify and would drop keys other owners still
read (`submission`, `timeCorrectionOriginalWorkMetadata`, workflow bindings).

### Shadow mirroring

With `mirror = legacy_to_canonical` (`shadow`, `ready`), the transfer mirrors
into the pending observation the work period is bound to
(`work_period.approval_workflow_id`), against that observation's version, in
the transfer's transaction. Both captures accept a well-formed `escalation`
key (`splitLegacyEscalationLineage`) and carry it on the captured request, so
the planner rebuilds former holders, the current holder and `pendingSince`
exactly as for absences. A malformed or accessor lineage fails the capture.
Holds instead of a transfer:

- No bound pending observation: `legacy_observation_missing` (once due).
- An observation whose pending holder for the request is not the request's
  approver: `ambiguous_history` with cause `legacy_observation_contradicted`.
  The mirror rebuilds history from legacy rows, so it would overwrite such an
  observation instead of reconciling it.
- A planner or repository refusal during the mirror rolls the transaction
  back and is held as `ambiguous_history` (`legacy_observation_rejected`), as
  in #299.

The ordinary finalizer and the correction cancellation tombstone accept and
keep the lineage the same way, so later decisions and replays see it.

### Existing `legacy_time_authority` holds

`legacy_time_authority` is no longer raised and no longer untransferable.
Open holds with that route (raised by #326 code) are re-examined by the next
discovery. A transfer resolves them through the usual attention recovery
(`assignment_transferred`); any other outcome overwrites the hold's evidence
with the current route. So they cannot starve the batch for longer than one
re-examination, and the management UI offers **Transfer…** on them.

### Decision path

The legacy branches of `executeOrdinaryWorkPeriodDecisionInTransaction` and
`executeTimeCorrectionDecisionInTransaction` call
`assertLegacyTransferDecisionAuthority` after the replay checks and before any
evidence or mutation. It locks the addressed request like the transfer does,
so a decision racing a transfer serializes behind it. When the request was
ever transferred, only its current approver or explicit organization
management decides; everyone else gets `approval_reassigned` (409). This
covers the inbox routes, including the eligible-manager fallback, and the web
approvals actions. Management is `canManageOrganizationTimeApproval`: the
caller's organization-wide flag plus CASL `manage Approval`; without a check
there is none. The shared eligible-manager fallback (`shared.ts`) also
refuses a transferred request, for every legacy kind.

Bound legacy time cards are out of scope: #432 must add the same refusal.

### Activation blockers (#439)

- Everything under the #298, #299 and #326 blockers above.
- **Old binaries** decide legacy time requests without the refusal. Deploy
  everywhere and drain old workers before an organization's ownership moves.
- **Requester cancellation in `shadow`/`ready`** of a direct legacy
  correction already fails without #439: the observation planner refuses the
  retained tombstone, which also drops the original work metadata.
  Cancellation of a transferred correction is verified under `legacy` only.
- **Delivery:** legacy transfer events stay `pending` until legacy replacement
  delivery exists (#408). The replacement gets no card and the former card is
  not retired.
- **Not executed:** bound legacy time cards (#432), bulk inbox decisions,
  deployment.

## Verification checkpoint — 2026-09-24

Authorized scope: typecheck, unit tests, and applying the transfer migration (then `0071`, now `0074`) alone to the local
Development database with constraint checks. No app run, browser check, build
or deployment.

- `pnpm run typecheck` passes (app, workflow contracts and smoke projects).
- New and touched suites pass (562 tests): lineage/allowance/actionable-instant
  classification, candidate order and exclusions, exact deadline, holds, operation
  identity; decision target selection and revocation; the engine admitting the
  `approval-escalation` principal only for `escalate` with a `v2` receipt while
  expiry keeps `v1`; eligible-manager fallback denied on an escalated lineage
  with explicit management kept; cleanup reporting; the job loading in a plain
  Node worker.
- Wider approvals/settings/db suites: the only failures are environmental on this
  Windows checkout (CRLF substring checks, `spawnSync pnpm ENOENT`, date-dependent
  fixtures, and the write-boundary analyzer, whose 232 entries are all "Native
  source could not be retrieved").
- The migration (numbered `0071` at the time, renumbered `0074` after merging `dev`) applied alone to local Development (12 statements, one transaction; the
  database had `0069` but not `0070`, and has no Drizzle migration journal).
  Against real PostgreSQL, in a rolled-back transaction with synthetic workflow
  rows: a valid scheduled and a valid human transfer insert; duplicate operation
  key and second transfer of one source are rejected by their unique indexes;
  scheduled-without-deadline, user-attributed scheduled, human-with-deadline and
  same-approver rows fail their CHECKs; a foreign replacement assignment fails its
  FK; journal updates, delivery-payload updates and expansion reversal are
  rejected by the triggers; expansion without a timestamp fails its CHECK; a
  duplicate delivery event is rejected; deleting the workflow cascades the journal
  and its event.
- Not executed: the processors and human action against a running database,
  transfer-versus-decision races, the replacement's inbox → approve/reject in the
  app, lock-order interplay with the ownership switch, and cleanup through
  `deleteApprovalInTransaction` on real rows.

Binding contracts: [#298](https://github.com/Umami-Creative-GmbH/z8/issues/298),
[#251](https://github.com/Umami-Creative-GmbH/z8/issues/251#issuecomment-5653026359),
[#255](https://github.com/Umami-Creative-GmbH/z8/issues/255#issuecomment-5653995791),
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145)
and [parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264).
