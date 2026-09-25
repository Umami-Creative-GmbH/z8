# Automatic break adjustment and its durable recovery (#305 / T41)

## Delivery and activation status

A work policy with break rules can owe a break after an ordinary clock-out, one that no
approval routed. Before this slice, `break-enforcement.service.ts` inserted that break
after the closure had committed, and it did so in four places: the live clock-outs
(web, direct HTTP, bots, on-behalf, the web active break), departure post-processing
and `cron:break-enforcement`. It:

- wrote two entries, updated the period and inserted a second period as separate
  statements outside any transaction, so a failure left a partial split behind;
- took no coordination and checked for no unresolved review, so it split periods with a
  pending correction;
- left the canonical record whole and read the entry chain head from the latest-created
  row;
- ran only in two cases: best effort right after the closure, or from a cron query for
  today's periods. A lost run, or a period reviewed past midnight, was never adjusted.
  The cron also passed `system-cron` as `created_by`, which is not a user, so every
  cron adjustment failed on the foreign key.

All four callers now go through one owner,
`lib/time-tracking/automatic-break-adjustment.ts` (`runAutomaticBreakAdjustment`).

| | Every organization | Adopted organizations add |
| --- | --- | --- |
| Coordination | The completed-work owner (`withCompletedWorkTransaction`) with a system actor, which routes only the owner. A failed adjustment rolls back alone; the committed closure is untouched. | |
| Review | The unresolved-review guard refuses the adjustment without writes. | The refusal commits a durable `deferred` intent. |
| Writes | Legacy organizations keep the established writes, now in one transaction, against a locked unchanged period. | The completed-work operation: append collaborator, independent rounding, revisions, canonical record, detail and allocations, and an `automatic_break_adjustment` receipt. |
| Recovery | The daily cron check of today's legacy periods, as before. | The closure commits the intent with the work. The cron recovers every intent, whatever the work's date. |

"Adopted" means the organization's `time_entry_append_control` is `active`, the switch
shared by #273–#304, and nothing sets it.

References: [#305](https://github.com/Umami-Creative-GmbH/z8/issues/305),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264) §5, and the canonical
resolutions of
[#252](https://github.com/Umami-Creative-GmbH/z8/issues/252#issuecomment-5653113300) §5,
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538) §7 and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## The intent

`work_break_adjustment_intent` (migration `0106_automatic_break_adjustment`) holds one row
per organization and period. Its ID is derived from both
(`deriveAutomaticBreakIntentId`), so the intent has one stable identity.

- **Commit.** `closeActiveWorkGraph` inserts it, `pending`, in the closure's transaction,
  for an ordinary closure of an adopted organization. It names the closure's clock-out
  entry and the completing human as the trigger. The closure receipt's follow-up
  becomes `{ kind: "break_enforcement", delivery: "committed_intent", intentId }`. The
  web clock-out, direct HTTP, bots, on-behalf closure and both breaks (#281/#304) share
  this graph.
- **Approval-routed closures** commit no intent. Their terminal approval splits inside
  the approval transaction (#303).
- **Deferral.** A blocked adjustment keeps the row `deferred`, with the blocker, the source
  `graph_revision` it observed and when it was first deferred. The blockers are:
  - `pending_time_correction_approval` and `work_period_pending_approval`, from the
    shared review guard;
  - `completed_work_review_required`, for missing or diverging canonical work or
    superseded endpoints;
  - `work_occupancy_conflict`;
  - `append_review_required`.

  A recheck with the same blocker and revision keeps the first deferral time.
- **Failure.** A failed run rolls back and then records `attempts`, `last_attempt_at` and
  the database's own message in `last_error`, without the statement or its parameters.
- **Completion.** Every final outcome deletes the row: adjusted, not required, or the work
  is gone, deleted, rejected or already adjusted. The receipt, or the unchanged work, is
  the evidence.
- **Cleanup.** Organization and employee deletion cascade. Whole-history deletion
  (`deleteDemoEmployeeHistory`, behind `clearOrganizationTimeData` and the non-admin demo
  deletion) deletes the employee's intents explicitly, before the receipts and periods.
  Business deletion is a soft delete: the next evaluation completes the intent.

## Evaluation (adopted organizations)

`adjustAutomaticBreakInTransaction` runs inside the coordinated transaction and re-reads
everything under its locks. It never replays a plan it made earlier.

1. Lock the intent, if there is one, then the period. A missing, deleted, running,
   rejected or already adjusted period, or an existing adjustment receipt, completes the
   intent. A committed adjustment is final, so replaying a clock-out or re-running the
   cron never regenerates it.
2. The review guard (`assertNoUnresolvedWorkPeriodReview`), as for every structural
   writer. It has no exemption: this is not a terminal approval.
3. Lock the endpoint entries, the canonical record, its work detail and its allocations.
   They must describe the same segment, or the adjustment defers for review.
4. The break regulation in effect when the work ended
   (`resolvePolicyClockOutBreakSnapshotInTransaction`), read at evaluation time. A
   policy changed while the adjustment was deferred applies as it stands for that
   work.
5. Breaks already taken: the gaps longer than one minute between the owner's
   non-rejected completed work on the work's local start day, up to the work's end. The
   day is taken in the clock-out's captured zone, else the owner's setting, else the
   captured offset. The plan (`automatic-break-plan.ts`) depends only on these facts,
   never on today's date. The placement is unchanged: after the lower of the
   maximum uninterrupted time and the rule's threshold. Each segment rounds its own
   exact UTC elapsed time half up, and a positive segment may store 0 minutes (#252).
6. Symmetric occupancy of the source interval against the owner's other work.
7. Append admission (operation `automatic_break_adjustment`), then the writes:
   - both break entries, each with its exact predecessor;
   - the shortened source period (compare-and-set on its revision, which advances by one,
     with the established auto-adjustment audit fields);
   - the source canonical record;
   - the generated canonical record, with the source's origin, approval state and
     recording actor, plus its cloned work detail and allocations;
   - the generated period, at revision 1;
   - the work-balance refresh intent;
   - the receipt;
   - the intent's deletion.

Entries and canonical updates need a user. They record the triggering human, else the
human who completed the work. The receipt's actor is `system`
(`actor_user_id` null). Its ID is derived from the organization and period
(`deriveAutomaticBreakOperationId`). Its result records by value:

- the executing process and the triggering human with the closure entry;
- the originating work, with its approval state and recording actor;
- the deferral that held it, if any;
- the policy and rule applied;
- the break, the breaks already taken and the zone;
- both segments, where the generated one names its origin and
  `approval: { state, basis: "originating_work", sourceDecisionIds }`;
- the append links;
- the revisions;
- the follow-ups: the committed balance intent, and post-commit best-effort surcharges.

**Closure replay.** `findStandingClosure` treats a clock-out as standing when its period's
adjustment receipt names a generated segment that still ends with the closure's
clock-out entry. Without that, a retried clock-out would have become a collision.

## Callers

- **Immediate** (`completeClockOutAfterCommit` → `enforceBreaksAfterClockOut` →
  `BreakEnforcementService`): the same owner, with the human as trigger. An adopted
  organization evaluates the closure's intent. A legacy organization still makes the
  established plan from plain reads (`planLegacyBreakEnforcement`). Its writes then run
  in the coordinated owner only when a break is owed. The routing hint is re-read
  under the adoption gate, and a mode change in between re-routes the adjustment.
- **Departure post-processing** (`clock_postprocess`) uses the same service, so it is
  routed the same way.
- **`cron:break-enforcement`** (`runBreakEnforcementCheck`, every minute):
  1. `processAutomaticBreakIntents` evaluates up to 100 intents of adopted
     organizations, least recently checked first. Surcharges of an adjusted pair are
     then recalculated, best effort, with the snapshot resolved in the adjustment
     transaction.
  2. The established daily query follows. It now excludes adopted organizations, whose
     closures always carry an intent. Its result reports `deferredCount`.

Duplicate workers serialize on the owner's employee coordination. The later one finds the
intent resolved and the period adjusted, and writes nothing. An organization returned to
legacy admission keeps its intents until it is adopted again.

## Evidence

<!-- filled from the verification runs -->

## Not verified and activation blockers

<!-- filled from the verification runs -->
