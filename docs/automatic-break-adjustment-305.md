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
   day is taken in the zone captured with the work's start, else that entry's captured
   offset, never a current setting. The break entries are captured like the closure's
   clock-out. The plan (`automatic-break-plan.ts`) depends only on these facts,
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

Everything below ran locally on 2026-09-25. The PostgreSQL results come from a
disposable PostgreSQL 16 database with the full migration chain, including the recovery
verification.

- **`clocking.automatic-break.integration.test.ts`, 25/25.** It drives the real
  `clockIn`/`clockOut`, `requestTimeCorrection`, `requestTimeEntryDeletion`,
  `cancelMyTimeCorrectionRequest`, the inbox approve/reject, `clearOrganizationTimeData`
  and `runBreakEnforcementCheck`. The work is 08:00:40 to 15:00:31 UTC (420 minutes), and
  the regulation owes 30 minutes after 6 hours.
  - **Adopted, immediate.** The response reports the adjustment. Both representations
    hold 08:00:40–14:00:40 (360 minutes) and 14:30:40–15:00:31 (29m51s, rounded to 30).
    The closure receipt names the intent, and the intent is gone. The break entries chain
    from the closure entry, and the position's last operation is
    `automatic_break_adjustment`. The balance is dirty from 2026-07-22, the source
    revision goes from 1 to 2, the generated period is at revision 1, and the whole
    receipt matches exactly.
  - **Replay.** Replaying the clock-out succeeds and a later cron run writes nothing.
  - **Failed adjustment.** The clock-out still succeeds and the 420-minute closure stays
    whole. The intent stays `pending` with the database message. The cron retries it
    (attempts 2) and, once the failure is gone, adjusts.
  - **Write failures.** A failure injected at any of nine writes leaves every row
    unchanged except the intent's failure evidence, and the retry adjusts once. The nine
    writes are:
    - the entry insert;
    - the position update;
    - the period update and insert;
    - the record update and insert;
    - the work detail;
    - the balance;
    - the intent deletion.
  - **Process loss.** A worker's backend is terminated while it waits for the employee.
    It leaves nothing but its failure evidence. Two concurrent workers then adjust exactly
    once, with one receipt and no errors.
  - **Deferral across dates.** A pending correction defers the adjustment with no writes
    except the intent (`pending_time_correction_approval` and the observed revision). A
    run on another date keeps the first deferral time. After the rejection it adjusts,
    and the receipt names the deferral.
  - **Cancellation.** After cancelling the correction, it adjusts the original work.
  - **Approved correction.** An approved 07:30–16:00 correction re-plans from the
    corrected work (07:30–13:30 and 14:00–16:00, 360 and 120 minutes). The receipt
    records the current source revision and the older observed one. An approved
    correction to 5 hours drops the intent with no receipt and no writes.
  - **Business deletion.** Deleting the work while deferred drops the intent.
  - **Occupancy.** Overlapping canonical work defers the adjustment
    (`work_occupancy_conflict`) with no writes. Once the overlap is gone, it adjusts.
  - **Policy change.** The break rule is removed while the adjustment is deferred. When
    the review clears, nothing is adjusted and the intent is dropped.
  - **Cleanup.** `clearOrganizationTimeData` removes deferred intents.
  - **Approval-routed closure.** It commits no ordinary intent.
  - **Legacy.** The established writes (floored minutes 360/29, revision 0, chain head
    from the latest-created entry, the human as `created_by`) happen with no intent and
    no receipt. A write failure leaves the closure whole with no break entries: before
    this slice, those writes were left behind. A pending correction refuses the daily
    check without writes, and after the cancellation it adjusts.
- **Existing suites.** The web clock-out operation, active break, direct-HTTP command
  and on-behalf suites exercise the widened closure replay: 110/110 together with the
  new suite.
- **Full runner.** 73 files: 1274 passed, 6 skipped (the Chrome-only browser suite),
  none failed.
- **Mutation checks.** Removing the review guard from the adopted evaluation fails 7
  tests. Committing no intent with the closure fails 20.
- **Write-boundary scanner (Linux `node:24`).** 290/290.
  - The adopted evaluation is a canonical owner.
  - The legacy period writes and the shared entry helper are exceptions.
  - The retired `break-enforcement.service.ts` writes are removed.
  - The scanner itself infers the `policy_clock_out_terminal_break` semantic for the
    generated canonical record inserts, as for the #304 split.
- **Unit tests.**
  - `automatic-break-plan.test.ts` covers the planner.
  - `break-enforcement.service.test.ts` covers the adapter result mapping.
  - `tsc` is clean.
  - The full webapp suite was compared with clean `dev` test by test: 139 failures on
    each side, the same tests, the known Windows, CRLF and date-dependent ones.

## Not verified and activation blockers

These items move to #327, #329 and #331 (see
[spec #264 close-on-implementation](https://github.com/Umami-Creative-GmbH/z8/issues/264)):

- **Activation (#327).** The intent, deferral and operation stay dormant until an
  organization's append control is `active`.
- **Legacy organizations (#327).** They changed without a gate:
  - coordination;
  - the review refusal;
  - atomic writes;
  - the human `created_by`, which also fixes the cron's foreign-key failure.

  A legacy adjustment refused by review is not durable: only the daily check of today's
  periods retries it. After midnight it is never adjusted, where before it would have
  split work under review. Durable recovery arrives with adoption.
- **Old binaries (#329).** During a rollout, an instance on the previous binary closes
  adopted work without an intent and runs the uncoordinated service writes. An old
  binary cannot write the `0106` values. Adopted organizations are excluded from the
  daily check, so an adopted closure written by an old binary is never adjusted. The old
  consumers must be drained first.
- **Stuck intents (#327).** Intents are retried on every run, up to 100 per minute, least
  recently checked first, with no backoff. `attempts` is unbounded and nothing alerts. A
  permanent blocker such as `completed_work_review_required` or `append_review_required`
  stays deferred indefinitely. Operations need an alert on `attempts`, `last_error` and
  long-deferred intents before activation.
- **Replacement work.** An adopted correction updates its period in place, which this
  slice covers. A writer that instead replaced the period with a new one would leave the
  replacement without an intent.
- **Diagnostics (#327).** As for #303 and #304, the generated period has no receipt of
  its own. Diagnostics must read it from the adjustment receipt.
- **Not exercised.** Departure post-processing, the bot and desktop closures, and a
  deferral on `completed_work_review_required` or `append_review_required`. They reach
  the same owner.
- **Rollback (#331).** A binary without this slice ignores intents and splits with the
  uncoordinated writes. Receipts stay readable only while the `0106` CHECK values stay.
  Intents left behind are inert without this binary.
