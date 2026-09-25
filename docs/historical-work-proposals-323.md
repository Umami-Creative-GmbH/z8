# Authorized repair and continuation proposals (#323 / T58)

## Delivery and activation status

Organization administrators can make, inspect, approve, reject and apply two kinds
of explicit historical proposal:

- a **field repair** changes named fields of one work, each with its exact current
  value (`before`) and new value (`after`);
- an **append continuation** lets future time entries continue from one exact
  existing entry (the anchor) when the history cannot be admitted automatically.

Making, approving and rejecting a proposal writes only the proposal. Applying one
needs the organization's separate repair authorization
(`historical_work_repair_control`, from #320), which has no application setter. A
continuation also needs the organization's append adoption
(`time_entry_append_control`), because only adopted organizations admit appends from
positions. Nothing is applied until those gates are opened (#327).

References: [#323](https://github.com/Umami-Creative-GmbH/z8/issues/323),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#260](https://github.com/Umami-Creative-GmbH/z8/issues/260#issuecomment-5654136671)
(§3, §6, §9), [#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073)
(§1, §3, §4, §8), [#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538)
(§6) and [#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
The activation items #324 moved here (issuecomment-5829808100) are covered in
[Append assurance](#append-assurance).

Decisions made with the user on 2026-09-25:

- Any organization administrator may approve, including the proposer. Approval is
  still a separate, recorded step on the exact proposal (its fingerprint).
- Field repair is limited to a bounded field set (below).
- A continuation is offered only for employees without an append position. It never
  replaces a position, including an interrupted one.

## Modules

| Module | Role |
| --- | --- |
| `lib/time-tracking/historical-repair-proposal.ts` | Pure. Builds a field-repair proposal from the employee's diagnostics evidence, or refuses it. |
| `lib/time-tracking/historical-repair-fields.ts` | The bounded field set, dependency-free so the client form offers exactly what the server accepts. |
| `lib/time-tracking/append-continuation.ts` | Pure. Builds a continuation proposal from the employee's append evidence, or refuses it. Also `appendHistoryDigest`. |
| `lib/time-tracking/historical-work-proposals.ts` | Create, approve, reject and apply both kinds; list for the settings page. |
| `POST /api/time-entries/diagnostics/proposals` | `propose_repair`, `propose_continuation`, `approve`, `reject`, `apply`. Organization administrators only. |
| `/settings/work-diagnostics` | `WorkProposalPanel` below the #320 repair panel: create both kinds, inspect, approve, reject, apply. |
| `historical_work_proposal` (migration `0105`) | The proposals. Cascades with the organization and the employee. |
| `time_entry_append_position` (migration `0105`) | New admission `authorized_continuation` with `admitted_history_digest` and `continuation_proposal_id`. |

## Field repair proposals

A request names one work period and the new value of each field. The bounded set:

| Representation | Fields |
| --- | --- |
| Time record | `start_at`, `end_at`, `duration_minutes`, `work_category_id`, `work_location_type` |
| Work period | `duration_minutes`, `work_category_id`, `work_location_type`, `project_id` |

Period endpoints are never repairable: they mirror hashed time entries. Approval state,
deletion, links, ownership and record creation are outside explicit repair too.

The proposal holds:

- **changes**: each with target row, field, exact `before` and `after`;
- **evidence**: the operator's note and every diagnostics finding touching the work;
- **uncertainty**: the findings that would remain after the change (the same
  diagnostics, run over the changed evidence);
- **consequences**: approval (`approved_work_changes`, `rejected_work_changes`,
  always `no_decision_recorded`), allocation (`allocation_weights_unchanged`,
  `period_project_differs_from_record_allocation`), replay (the work's receipt IDs and
  `committed_replay_returns_recorded_result`), payroll (`payable_minutes_change` for an
  approved record, `legacy_totals_change` for period minutes, always
  `finalized_exports_unchanged`), and audit (the receipt kind and writer);
- **expected state**: the period's revision and fields and the record's fields.

The fingerprint covers all of it. Any change to the work, its findings or its receipts
therefore makes the proposal stale.

Refusals that no approval can waive: `work_not_found` (includes other organizations'
work), `work_deleted`, `work_active`, `approval_pending`, `correction_pending`,
`record_missing`, `record_detail_missing`, `field_not_repairable`, `duplicate_field`,
`invalid_value`, `no_change`, `interval_invalid` (start not before end),
`minutes_exceed_interval` (more stored minutes than the elapsed interval, rounded up)
and `reference_outside_organization`. Zero minutes stay valid. Work under a pending
approval or correction is refused because that review must resolve first (#256 §7).

## Continuation proposals

A request names the employee and the anchor's exact ID and stored hash. The proposal
holds the anchor (with its hash status and link resolution), every competing head
(each entry nothing follows), the lineage components over resolved links, the #262
issues, the accepted limitations, the guarantee (`post_anchor`, history before the
anchor `unverified_disclosed`), the consequences, and the expected state: the entry
count and `appendHistoryDigest` of every retained entry.

Accepted limitations are `pre_anchor_history_unverified` (always) and
`anchor_hash_not_reproduced` or `anchor_hash_input_unavailable` when the anchor's
format is unknown. That is how a Clockodo-format anchor can be used honestly.

Refusals that no approval can waive: `position_exists`, `history_admissible`
(automatic admission accepts it), `anchor_not_found` (missing, or another employee's
or organization's), `anchor_hash_missing`, `anchor_hash_mismatch`,
`anchor_identity_ambiguous` (another entry in scope carries the same hash),
`anchor_has_successor` (continuing would fork it), `active_work` (open work's clock-out
must follow its own clock-in, not a chosen anchor) and `correction_pending` (a pending
correction's entries would be finalized around the new anchor). With no suitable anchor,
nothing is invented: there is no fresh genesis.

The proposal lists the suitability checks the anchor passed (`in_scope`, `hash_matches`,
`unique_hash`, `no_successor`, `no_pending_work`). Why this anchor is the right one among
the heads is the operator's reason, which the approver reads with the proposal.

## Lifecycle, coordination and idempotency

`proposed` → `approved` → `applied`, or `stale` or `rejected` from either pending state.

- **Create.** The client sends a proposal ID. Repeating the same request with that ID
  returns the same proposal; a different request is `proposal_id_conflict`.
- **Approve.** The approver sends the fingerprint they reviewed. The proposal is locked,
  rebuilt from current evidence and compared first; a changed proposal becomes `stale`
  (stage `approval`) instead of approved.
- **Reject.** Needs a note; recorded as the outcome.
- **Apply.** One transaction through `withCompletedWorkTransaction` for the proposal's
  employee: adoption gate, configuration and user guards, the employee coordination key
  (this drains every participating writer for that employee), then the repair
  authorization, the proposal row lock, the work rows (period, then record) or the append
  position row, a re-read and a rebuild. A different fingerprint marks the proposal
  `stale` (stage `application`) and writes nothing else.
  - A field repair's writes are guarded by each changed field's `before` value, the
    record's organization, employee and kind, and the period's expected
    `graph_revision` with `deleted_at IS NULL`. The period's revision advances.
    A receipt (`apply_historical_repair_proposal`, writer `historical_repair_proposal`,
    ID = proposal ID) and the proposal's `applied` outcome commit with the work. If a
    guard still disagrees, everything rolls back and the proposal is marked stale in a
    separate transaction.
  - A continuation inserts the append position at the anchor: tip = anchor, version 1,
    entry count = admitted count = the reviewed count, admission
    `authorized_continuation`, the reviewed history digest and the proposal ID. The
    proposal's outcome records it in the same transaction. No entry is rehashed,
    rechained, removed or created.
- **Repeat.** Applying an applied proposal returns `already_applied` with the recorded
  outcome, even after the repair authorization was withdrawn. Two concurrent applications serialize on the employee key: one applies, the
  other replays.

The receipt names the executor as its actor. Its result holds `originalActor:
unknown_historical` (the new values come from the operator's evidence), the proposer,
approver and executor with their times, the reason, the changes, evidence, uncertainty,
consequences, expected state and revisions. As in #320, the changed record records the
executor as `time_record.updated_by` (the last writer); its `created_by` is untouched.
`work_period` has no updater column, and #320 does not set its `updated_at` either.

Diagnostics treat `apply_historical_repair_proposal` like #320's repair receipts: a
historical correction, not an amendment after admission.

**Recovery is a new proposal, never a blind revert.** To undo an applied repair, an
operator proposes the old value as `after` against the current state. If anything newer
changed the work, that proposal is stale too.

## Append admission

`admitTimeEntryAppend` gained one branch. For a position with admission
`authorized_continuation` it admits the next append from the recorded tip only when the
assurance continuity check is `established`. Otherwise it returns the interruption
reasons as a review requirement. The collaborator never establishes a continuation
itself; only an applied proposal does.

## Append assurance

This covers the four items #324 moved to #323:

- `AppendContinuityProvenance` carries `continuationProposalId`, and continuity is still
  reported from `time_entry_append_position`.
- For a continuation position, disclosed pre-anchor issues do not raise
  `admitted_history_changed`. Instead, every entry outside the post-anchor path must
  still match the digest the continuation recorded. Any change there, including a
  competing head growing before the anchor, interrupts continuity. So does anything new
  after the anchor (count change, broken path, unexpected successor).
- A new scope, `post_anchor`, with the limitation `continuation_anchor { anchorEntryId,
  proposalId }`. It is never `whole_history`. It is carried through the audit pack:
  `AuditPackAppendAssurance.postAnchor` (optional for older packs), `meta/scope.json`,
  `audit_pack_artifact.append_assurance`, and the audit-pack card, which says
  "Continuity from an approved anchor for N of M employees; history before the anchor
  is not verified." The work-diagnostics dashboard no longer counts these employees as
  verified; it lists them separately ("Employees continuing from an approved anchor").
- `append-assurance.integration.test.ts` has the new continuation case (below).

## Review

`/code-review` (standards and spec axes) ran on the branch. Fixed from it: demo history
cleanup now removes proposals; continuation refuses open work and pending corrections
and lists its suitability checks; a retry returns the recorded outcome before the
authorization check; non-UUID references are refused instead of failing the query; the
panel validates whole minutes and rejects through TanStack Form; copy that read "1
employees". Left as judgement calls: the field-to-column mapping appears in several
switches (one per concern: validation, evidence, SQL, labels), the `proposal` JSON column
is cast at its boundary, and the `continuation_proposal_id` foreign key is on the proposal
ID alone (both rows carry the same organization and are written in one transaction).

## Verification

### PostgreSQL (2026-09-25)

New suite `apps/webapp/src/lib/time-tracking/historical-work-proposals.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and in the CI
`integration-tests` job. Work is written by the real legacy `createManualTimeEntry`;
conflicts are injected with SQL, as history would contain them. Everything else goes
through the real proposals and diagnostics routes (membership, principal, CASL, shared
coordinator). Result: **12 tests passed**, on a fresh label-owned PostgreSQL 16 container
with the full migration chain.

- **Exact repair and provenance.** A 200-vs-240-minute conflict is proposed with
  before/after, findings, remaining uncertainty and consequences. An admin approves it,
  and applying is refused (409, nothing written) until repair is authorized. Then it
  applies. The receipt names proposer, approver and executor separately with
  `unknown_historical` original actor, the revision advances, approval requests are
  untouched, the conflict disappears from diagnostics, and a repeat returns
  `already_applied` with a byte-identical snapshot, also after authorization is withdrawn.
- **Self-approval and idempotent creation.** The proposer approves their own proposal.
  The same proposal ID and request return the same proposal; a different request is
  `proposal_id_conflict`. A wrong fingerprint and a second approval are refused.
- **Staleness and recovery.** Evidence changed before approval marks it stale at
  approval. A change after approval makes application stale without writing, even to
  an unguarded field such as the period's location. A recovery proposal over the newest
  state applies; one made before a newer change goes stale.
- **Coordination.** A concurrent writer holding the employee key changes the work; the
  application waits (observed in `pg_locks`), then returns stale with no receipt.
- **Failure and concurrency.** A trigger failing the receipt insert rolls back the record
  and period changes (snapshot equal) and leaves the proposal approved. Two concurrent
  applications then give one `applied` and one `already_applied`, with one receipt.
- **Refusals and authorization.** Foreign project, a non-UUID project (422, not 500), a
  period endpoint field, too many
  minutes, pending approval and deleted work are refused with their reasons. Managers and
  employees get 403. Another organization's administrator gets 404 for the proposal and
  for the work. Another organization's authorization does not authorize this one. A
  rejected proposal cannot be applied. Malformed requests get 400.
- **Replay.** After a repair, replaying the committed legacy manual submission returns
  exactly its original result and writes nothing.
- **Continuation.** Over a forked history, the proposal lists both heads, the fork and the
  guarantee. Applying writes the position with admission, anchor, counts, digest and
  proposal, and changes no entry. Deleting the organization removes the proposal and the
  position. Parent, foreign, mismatched and duplicated-hash anchors are refused;
  admissible history and existing positions are refused. Applying in a non-adopted
  organization is `append_not_adopted`. A new entry between approval and application
  makes it stale with no position. Open work is refused (`active_work`). The real
  `deleteDemoEmployeeHistory` removes the applied continuation's position and proposal.

The #324 suite `append-assurance.integration.test.ts` gained one case: after append
adoption, a real `clockIn` over a forked history is held (`append_review_required`). The
continuation is proposed, approved and applied through the real route. The verify route
then reports `established` continuity with `authorized_continuation` provenance, scope
`post_anchor` and the `continuation_anchor` limitation; an employee verifying themselves
sees the scope without identities. A real `clockIn` appends from the anchor (explicit
predecessor ID and hash), and continuity names it as the only post-anchor entry. The real
audit-pack job records `postAnchor: 1` in `scope.json` and on the artifact. A bypassing
write after the tip interrupts continuity (scope `none`), and a real `clockOut` is then
held.

Regression set run together (11 files, **179 tests passed**): the two suites above,
`historical-gap-repair`, `historical-work-diagnostics`, web clock-in, demo work, correction
lifecycle, manual command, policy break split, lifecycle cleanup and reviewed import.

Mutation check: skipping the fingerprint comparison at application failed two tests
(the unguarded-field recovery case and the continuation staleness case).

The approval write-boundary scanner found exactly the two new source writes
(`time_record` and `work_period` updates in `applyFieldRepair`); they are registered and
pinned. Scanner result: see the PR.

### Database-free

- `historical-repair-proposal.test.ts` (21 tests): before/after, evidence and remaining
  findings, consequences, fingerprint stability and staleness, every refusal.
- `append-continuation.test.ts` (15 tests): proposal content over forks and islands,
  unknown-format anchors, order independence, every refusal, the history digest.
- `append-assurance.test.ts`: five continuation cases (post-anchor scope, fresh appends,
  new incident after, changed pre-anchor history, a competing head growing).
- `work-proposal-panel.test.tsx` (8 tests), `work-diagnostics-dashboard.test.tsx`
  (post-anchor never counted as verified), `audit-pack-generator-card.test.tsx` and the
  pack summary tests.

## Known limits

- One proposal addresses one work (field repair) or one employee (continuation).
  Several works need several proposals, and each applied one advances the work's
  revision, so a second proposal on the same work is made after the first applies.
- Plans, proposals and approvals read O(history) per employee, like #319/#320.
- Proposal creation is ungated, like the #320 plan. Only application is gated.
- The settings page lists the newest 200 proposals of the scope.
- The anchor picker in the panel shows entry IDs and hash prefixes. The full candidates,
  with type and event time, are in the created proposal for review before approval.
- Races with other writers were exercised at their shared coordination key with SQL
  writes, not through those writers' code, as in #320.

## Remaining activation blockers

This slice closes on implementation (the #264 decision of 2026-09-25). Activation items
move to #327/#329/#331:

- **Authorization and drain (#327):** activating `historical_work_repair_control`
  authorizes application of approved proposals of both kinds. Record who authorized it.
  A continuation is only as safe as the writer drain: until every appender takes the
  employee key, a legacy writer can interrupt the new position (the verifier reports it).
- **Pilot (#329):** try proposals on pilot organizations. Tolgee keys under
  `settings.workDiagnostics.proposals.*`, `settings.workDiagnostics.append.continued` and
  `settings.auditExport.auditPack.lineageContinued` need translations.
- **Linked cleanup:** proposals cascade with the organization and the employee, and
  `deleteDemoEmployeeHistory` removes them after the append position. The PostgreSQL suite
  checks both.
- **Rollback (#331):** the route and panel can be removed; migration `0105` is additive.
  Applied repairs are ordinary graph values with receipts; undoing one is a new proposal.
  A continuation position cannot be dropped without losing its provenance; rollback
  pauses fresh appends (append control) instead. An older release does not know the
  `authorized_continuation` admission and would hold that employee's appends for review,
  which is the safe direction.
