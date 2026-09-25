# Correction submission, decision and cancellation through the completed-work operation (#301 / T37)

## Delivery and activation status

Approval-based time corrections now run their whole lifecycle through the
shared outer work transaction:

| Transition | Real callers | Receipt `kind` / `writer` (adopted organizations) |
| --- | --- | --- |
| Submission | `requestTimeCorrection`, `requestTimeEntryDeletion`, `POST /api/time-entries/corrections` (approval branch), all through `submitCorrection` | `submit_time_correction` / `time_correction_request` |
| Decision (approval, rejection, business deletion, auto-completion) | inbox and bots through `decideTimeCorrectionWithStableTargetEffect`; the submission's requester auto-completion | `finalize_time_correction` / `time_correction_decision` |
| Cancellation | `cancelMyTimeCorrectionRequest` through `cancelPendingTimeCorrection` | `cancel_time_correction` / `time_correction_cancellation` |

Two independent switches decide what is written, and neither is set anywhere:

- **Work adoption** follows the organization's `time_entry_append_control`
  (`active`), the same control that gates #273, #274, #286 and #308. Only adopted
  organizations append pending correction entries through the collaborator,
  advance `graph_revision`, write receipts, round approved minutes half up, check
  occupancy and retain cancelled entries.
- **Evidence capture** follows `approval_evidence_control` for `time_correction`
  (`capture`), as for the #302 kinds. See
  [approval evidence](refs/approval-evidence.md#time-corrections-301--t37).

Every organization, adopted or not, now runs these transitions inside the
coordinated transaction and its lock order. Legacy organizations keep their
established writes.

Decisions with the user (2026-09-25): retained cancellation applies to adopted
organizations only; the slice captures both completed-work receipts and the
approval-evidence submitted revision. Business deletion moved here from #286
(handoff on #301).

References: [#301](https://github.com/Umami-Creative-GmbH/z8/issues/301),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the
canonical resolutions of [#252](https://github.com/Umami-Creative-GmbH/z8/issues/252#issuecomment-5653113300),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538),
[#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073),
[#253](https://github.com/Umami-Creative-GmbH/z8/issues/253#issuecomment-5653232524),
[#257](https://github.com/Umami-Creative-GmbH/z8/issues/257#issuecomment-5654287041) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Coordination

`acquireTimeCorrectionWorkScope` (`lib/approvals/server/time-correction-work-transaction.ts`)
runs on the approval repository transaction before any row lock, in the #264
order:

1. the shared adoption gate, with the append control read under it;
2. the `time_correction` approval write gate (rank 2);
3. the organization configuration guard;
4. the sorted user access guards (the actor and the owner's user);
5. the sorted exclusive employee keys (the owner and every employee record of the
   actor).

Before, submission, decision and cancellation each locked employee and period
rows first and only then took the approval gate. Now the gate result is fixed on
the context, so the existing owners never acquire it late. The routed scope is
re-read under the locks; a change throws `WorkTransactionScopeChanged` and
`retryTimeCorrectionWorkTransaction` restarts the transaction (at most twice).
A decision routes from plain reads of the request and period (the owner is the
period's employee); the finalizer re-reads everything under the locks.

`sealWorkTransactionScope` registers each sealed scope by its transaction client
(`workTransactionScopeFor`). The finalizer and the cancellation writer find the
coordinated scope through the client the approval engine hands them. The engine's
time-correction adapter additionally refuses an adopted organization when no
coordinated scope exists (`correction-work-fence.ts`), so an approval runtime that
reaches a correction terminal outside the coordinator (for example an activation
after an offboarding reassignment) cannot write with the legacy rules.

## What adopted organizations commit

`lib/time-tracking/correction-lifecycle-work.ts` owns the completed-work side.

**Submission.** A fresh submission checks its resulting interval against other
recorded work (symmetric occupancy, as in #286), admits the append through the
collaborator (operation `time_correction_submission`) and writes each pending
correction entry with the exact predecessor ID and hash; the position advances
with a version check. The period revision advances before routing, so an
auto-completing finalization advances from there. The receipt holds the submitted
command by value and a result with the baseline segment as locked (entry IDs, UTC
endpoints, stored minutes, captured offsets, attribution), the requested values
(metadata present only when the proposal carries it), the change mask, the intent
(`edit`, `metadata_only`, `delete`), the pending entries with their predecessors,
the revisions and the approval lifecycle routing created. A committed submission
replays only: it never creates an entry (a missing one is a conflict), and a
receipt whose command differs is a collision.

**Approval.** The finalizer keeps its established validation and flag changes.
When adopted it also derives fresh minutes from the exact UTC endpoints, rounded
half up (60m40s → 61), checks the resulting interval against other recorded
work, advances the revision with a compare-and-set on the revision it read,
commits the work-balance refresh intent in the transaction and writes the
receipt. The receipt records the source segment, the actual resulting segment and
every correction entry with its meaning (`active`). Metadata-only corrections keep
their stored minutes.

**Business deletion.** An approved deletion keeps its established shape: both
sentinel correction entries become active, the period is soft-deleted and the
canonical record becomes a zero-length sentinel. Adopted, the revision advances
and the receipt result is `{ kind: "deleted", deletedAt, sentinel }`. Deleted work
stops occupying its interval (#286 occupancy).

**Rejection.** The graph stays unchanged; the revision advances and the receipt
records the entries as `rejected_inactive`.

**Cancellation.** Adopted organizations no longer delete the pending entries.
They are committed and may already be predecessors of later entries, so they keep
their inactive flags (`is_superseded`, no successor). The revision advances and the
receipt records them as `cancelled_inactive`. The append position is unchanged,
the next live entry is admitted and may follow the retained entry. A cancellation
replay matches the receipt and the still-standing retained entries. Only
uncommitted speculative inserts roll back, with their transaction. Legacy
organizations keep deleting the pending rows.

Receipt identities are stable per lifecycle transition
(`deriveTimeCorrectionOperationId`): the submission key, or the lifecycle (the
canonical workflow, the legacy chain, or the legacy request). A second fresh write
of the same transition is a primary-key collision that rolls back.

User-facing outcomes reuse #286: collision (`completed_work_collision`),
occupied interval (`work_interval_occupied`) and held appends
(`completed_work_review_required`) are 409 conflicts, also when the legacy decision
throws them inside its Effect program. Evidence holds are `approval_evidence` 409s.

## Pre-existing defects fixed on the real callers

Verifying through the real callers exposed four defects on `dev`. Each made the
legacy or compatibility path unusable against a real database; the mocked unit
suites did not show them.

- **Pending corrections were unclassified.** The decision and the inbox verified a
  request's correction IDs only against active (non-superseded) rows, but a
  pending correction's rows are stored inactive until approval. Every pending
  endpoint correction was refused with "could not be classified". The rows the
  request names now verify it when they are pending-shaped (superseded without a
  successor) and replace the period's endpoints.
- **Canonical compatibility targets were refused.** The compatibility-target
  parser's key allowlist omitted `timeCorrectionOriginalWorkMetadata`, which every
  current-contract request carries, so canonical-mode decisions through the
  compatibility request failed with a transition conflict.
- **Legacy cancellation decoded instants from a missing field.** The capture
  serializes entry instants as `instant`; the cancellation read `timestamp`.
- **Legacy cancellation compared the wrong metadata.** The capture normalizes
  request metadata to the correction payload. The tombstone and the row writer's
  compare-and-set used it instead of the persisted request metadata, so the
  submission evidence was missing and the update matched no row. Both now use the
  persisted metadata.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/correction-lifecycle.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. Real `clockIn`/`clockOut`, `requestTimeCorrection`,
`requestTimeEntryDeletion`, `approveApprovalInboxItem`/`rejectApprovalInboxItem`,
`cancelMyTimeCorrectionRequest`, `updateWorkPeriodTimes` and
`clearOrganizationTimeData` run on the disposable PostgreSQL 16 database. Only the
session, billing, notification delivery, the Next cache and the edit-policy
capability are replaced; `getAuthContext` is replaced by an uncached equivalent
because React `cache` pins the first actor for the whole test process.

24/24 passing:

- **Adopted submission and approval.** The pending entry follows the admitted tip
  by ID and hash, the position advances with `last_operation =
  time_correction_submission`, the revision goes +1, and the receipt holds the
  baseline (121 stored minutes, captured offset), requested values, mask and
  lifecycle. While pending, the #286 direct edit is refused. Approval: 09:00:00 →
  10:00:40 stores 61 minutes in period and record, supersedes the original, dirties
  the balance from the work date, revision +2, receipt with the resulting segment.
  The next live work is admitted.
- **Replay.** An exact submission retry changes no row (whole-organization
  snapshot); a changed request under the same submission ID is refused and changes
  nothing. A retry after cancellation recreates nothing.
- **Rejection** retains the entry inactive with a `rejected_inactive` receipt.
- **Cancellation** retains the entry (the tip), leaves the position unchanged,
  advances the revision and writes the receipt; a replay changes nothing; the next
  clock-in follows the retained entry.
- **Business deletion**: soft-deleted period, zero-length canonical sentinel of 0
  minutes, both sentinel entries active, receipt `deleted`; new work may occupy the
  freed interval.
- **Occupancy**: overlapping work created after submission refuses the approval
  (409, no writes); an overlapping submission is refused (no writes).
- **Changed and deleted sources** refuse the approval with no writes.
- **Atomic failure**: an injected receipt failure rolls back the whole submission,
  approval or cancellation.
- **Races**: of a concurrent approval and cancellation exactly one commits, with one
  receipt; a concurrent live clock-in and correction submission both commit on one
  lineage.
- **Canonical engine path**: in `canonical` rollout mode the submission receipt names
  the canonical workflow and the approval runs through the engine and the adapter
  inside the coordinated transaction (90 minutes).
- **Legacy organizations**: no receipt, no revision change, cancellation still
  deletes the pending rows.
- **Evidence**: see the approval evidence reference (7 scenarios).
- **Cleanup**: `clearOrganizationTimeData` removes correction receipts and evidence.

### Database-free

- `correction-lifecycle-work.test.ts`: receipt identity, lifecycle keys, half-up
  versus legacy floor, the scope registry, error translation.
- `time-correction-facts.test.ts`: baseline, requested values with explicit null
  versus unchanged, deletion intent, refusals, revision comparison.
- `time-correction.adapter.test.ts`: the fence runs before delegation; cancellation
  passes the canonical lifecycle.
- `time-correction.handler.test.ts`: pending rows named by the request classify it;
  superseded or foreign rows do not.
- The legacy mock-database harnesses run the coordinator in legacy scope
  (`src/test/time-correction-work-transaction.ts`) and the decision harness runs
  with evidence capture inactive.

## Remaining activation blockers

This slice closes on implementation (see the #264 close-on-implementation rule).
The items below are activation gates, tracked in #327 (all-writer adoption), #329
(pilot), #331 (rollback) and #328 (non-time approval pilot, for evidence).

1. **Nothing activates.** Neither the append control nor the evidence control has
   an application setter.
2. **Old binaries and in-flight work.** Binaries deployed before this change submit,
   decide and cancel without the protocol and, in adopted organizations, would write
   pending entries from the latest-created row and delete cancelled ones. Drain them
   before activation. Lifecycles submitted before adoption have no submission
   receipt (none is fabricated); lifecycles submitted before capture are held with
   `evidence_required` once capture is active.
3. **The adapter fence reads the append control without the gate** when no
   coordinated scope exists. It is a fence for unexpected callers, not a guarantee;
   every production caller of the three transitions uses the coordinator.
4. **Demo correction generation** (#285) keeps its own adopted path (`demo_correction`)
   and captures no correction evidence or submission receipt.
5. **Retained cancellation is adopted-only.** Legacy organizations keep deleting
   pending rows; holes left by earlier deletion are review cases (#320).
6. **Legacy minutes.** Unadopted approvals keep the floor rounding; adopted
   approvals round half up.
7. **Presentation and bindings** of correction facts are #325.
8. **Historical data.** The pre-existing defects above mean pending legacy
   endpoint corrections could not be decided or cancelled before this change; any
   such stuck requests need review before activation.
9. Holiday validation and the change-policy capability remain preflights (as in
   #286); configuration writers do not take the guards yet (#316/#327).
10. **Cancelled meaning lives in the receipt.** Retained cancelled and rejected
    entries keep the pending row shape (`is_superseded`, no successor); only the
    `cancel_time_correction` / `finalize_time_correction` receipt names their
    `cancelled_inactive` / `rejected_inactive` meaning. This avoids changing the
    hashed `time_entry` table, but verifier and audit consumers must read the
    receipts to tell a cancelled entry from a pending one (#262 §6, #327).
11. **The scope registry is implicit.** The approval engine hands terminal
    collaborators only its transaction client, so they find the coordinated scope
    through `workTransactionScopeFor(client)` instead of a typed parameter. A typed
    engine-to-collaborator scope would remove this side channel.
12. **Decision replay.** A retried legacy decision (including a business deletion)
    is refused as already decided, as before; the finalize receipt is evidence, not
    a replay path. Canonical decisions replay through the engine's command receipt.
13. **Not verified on PostgreSQL:** `deleteNonAdminEmployeesData` and privileged
    `deleteApproval` for correction receipts and evidence, multi-stage legacy chains
    (their finalize receipts are keyed by chain), and bots deciding corrections.
14. Deployment, in-flight inventory, old-writer drain, the scoped pilot and
    compatible rollback (#327/#329/#331). A rollback to inactive keeps committed
    receipts; replay of adopted cancellations requires the receipt path, which is
    independent of the control.
