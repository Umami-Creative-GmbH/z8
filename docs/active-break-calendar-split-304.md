# Active breaks and calendar splits (#304 / T40)

## Delivery and activation status

Three structural writers used to change work with separate raw writes:

- the web "add break" on the running session (`addBreakToActiveSession`);
- the two calendar split entry points, `splitWorkPeriod` in
  `time-tracking/actions.ts` and in `time-tracking/actions/mutations.ts`.

They wrote periods and entries outside any coordinated transaction. The splits
left the canonical record spanning the whole original interval. They also
superseded the clock-out entry that the second period still used. None of them
checked for unresolved review.

All three now run through the shared completed-work operations.

| Caller | Every organization | Adopted organizations add |
| --- | --- | --- |
| Web active break | Runs under the clock-out owner (`withWebClockOutTransaction`) and refuses work under review. | The shared close/resume operation (#281): approval participation, append progression, canonical record, carried attribution and one `close_resume_work` receipt. |
| Both calendar splits | Run through one adapter (`actions/work-period-split.ts`) under the completed-work owner (`withCompletedWorkTransaction`). They lock the period, check that it is unchanged and refuse work under review. | The new completed-work split operation (`lib/time-tracking/split-completed-work.ts`) and a `split_completed_work` receipt. |

"Adopted" means the organization's `time_entry_append_control` is `active`. That
is the same switch as #273, #274, #281, #286, #301, #303 and #308, and nothing
sets it. Legacy organizations keep their established writes. Only the
coordination and the review guard are new for them.

References: [#304](https://github.com/Umami-Creative-GmbH/z8/issues/304),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the
canonical resolutions of
[#252](https://github.com/Umami-Creative-GmbH/z8/issues/252#issuecomment-5653113300),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538),
[#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Web active break

`addBreakToActiveSession(breakMinutes, { submissionId, browserTimezone })` closes the
running work at `now - breakMinutes` and resumes it at `now`.

- **Identity and replay.** The client sends one submission ID per request, like
  clock-out. The server looks up a committed receipt first, in every mode, before
  any preflight read. A committed break replays with no writes and no effects. The
  same ID with a different request is a collision. Without an ID, the server
  generates one.
- **Endpoints.** Each endpoint is captured in the browser zone at its own instant,
  or in the user setting when the browser sent none.
- **Adopted.** `closeAndResumeWork` runs with writer `web_clock_out` and the command
  `{ version, operationId, breakMinutes, browserTimezone, deviceInfo: "web" }`. Its
  behavior:
  - It takes the clock-out approval decision, so a policy that requires approval
    leaves the closed segment `pending` with its request. The legacy break marks it
    `approved`; the adopted break does not promote it.
  - The resumed work carries the closed work's project and category, and its
    location when the command names none. `startLiveWorkGraph` records carried
    attribution in the start result. The desktop break (#281) now carries project
    and category too.
  - The follow-ups are the clock-out's (`completeClockOutAfterCommit`).
- **Legacy.** The established writes (`addLegacyBreak`) now run inside the owner,
  after the review guard.
- **Refusals.** Each refusal writes nothing and returns a message:
  - unresolved review: the guard's message plus "Add the break once it is resolved.";
  - an occupied resumed interval: "The break overlaps other recorded work.";
  - a collision, or an append history that needs review: the clock-out messages.

## Calendar split

Both entry points delegate to `splitOwnWorkPeriod`. They keep their positional
signatures and take an optional `submissionId` last. The dialog keeps one ID per
split: a retry after a lost or refused response reuses it, and a completed split
or a close starts a new one.

The adapter's order:

1. Committed replay by receipt, when an ID was sent.
2. Preflight: the owner's period, the wall-clock split resolved in the owner's zone
   (`resolveWorkPeriodSplit`), holidays over the period, billing.
3. The coordinated transaction. Adopted organizations replay again, then run the
   operation. Legacy organizations run `splitLegacyWorkPeriod`.

### The split operation

`splitCompletedWork` runs inside `withCompletedWorkTransaction` and:

1. Refuses an existing receipt for the ID as a collision, then locks the actor's
   current owner authority (the #286 `lockAuthority`).
2. Locks the period and checks it against what the caller read. A changed period
   is `time_correction_work_period_stale`, and running work is refused.
3. Runs the unresolved-review guard (`assertNoUnresolvedWorkPeriodReview`).
4. Locks the endpoint entries, the canonical record, its work detail and all its
   allocations. A missing or diverging record is `completed_work_review_required`,
   never repaired inline, as for amendments.
5. Plans the segments with `planCompletedWorkSplit`. Each segment rounds its own
   exact UTC elapsed time half up, and a positive segment may store 0 minutes (#252).
6. Checks symmetric occupancy of the resulting segments against every other work
   of the owner.
7. Appends the split clock-out and clock-in through the append collaborator
   (operation `completed_work_split`). Each entry records its exact predecessor
   ID and hash.
8. Shortens the source period (a compare-and-set on its revision, which advances
   by one) and its canonical record.
9. Creates the generated segment:
   - a canonical record with the source's origin, approval state and recording
     actor;
   - a work detail and every allocation, cloned;
   - a period with the source's attribution and approval state, at revision 1.
10. Commits the work-balance refresh intent from the earliest UTC or captured-offset
    date of the source start and the split.
11. Writes the receipt.

Notes follow the period-notes convention: a period's notes are its clock-out
entry's notes.

- The "before" notes go on the new clock-out.
- The "after" notes go on the new clock-in and on the source clock-out, which the
  generated period keeps. Notes are not part of the entry hash.
- Nothing is superseded.

The receipt is kind `split_completed_work`, writer `work_period_split`, actor
`human`, `work_period_id` = the source. Its result records by value:

- the split instant and capture;
- the source as locked, with its approval state and recording actor;
- both segments with their allocations. The generated segment names its origin and
  `approval: { state, basis: "split_source", sourceDecisionIds }`, the source
  record's decision lineage. No new decision is recorded;
- the notes (the source clock-out's previous notes, before and after);
- the append links;
- the revisions;
- the follow-ups (the committed balance intent, and post-commit best-effort
  surcharge calculation for both periods).

A replay keeps current access rules and only succeeds while both segments still
stand with the named entries.

Migration `0103_completed_work_split` adds the kind, the writer and the append
operation to their CHECK unions and keeps every earlier value.

### Legacy split

The established period-only writes are unchanged. They still supersede the source
clock-out that the second period uses, still floor both segments and still leave
the canonical record whole. They now run under the completed-work owner, after a
locked "period unchanged" check and the review guard. Before this change, a legacy
split of a period with pending approval or a pending correction went through.

## Evidence (2026-09-25)

Everything below ran locally. The PostgreSQL results come from a disposable
PostgreSQL 16 database with the full migration chain, including the recovery
verification.

- **`clocking.active-break.integration.test.ts`, 15/15.** It drives the real
  `clockIn` and both `addBreakToActiveSession` exports (the `actions.ts` wrapper and
  the clocking action).
  - Adopted break:
    - the closure ends exactly 15 minutes before the resume;
    - the closed period and its canonical record are 105 minutes with the
      project allocation;
    - the entries chain as clock-in, close, resume, with the resume under the
      submission ID;
    - the position is at version 3 and the balance is dirty;
    - the resumed work carries project, category and location, and the receipt
      matches exactly;
    - replay through the other export writes nothing, and a changed request is a
      collision.
  - Required approval: the closed segment is `pending` with one request and one
    notification, the resumed work is active, and replay repeats nothing.
  - An unresolved correction request refuses the break with no writes, both adopted
    and legacy.
  - A resumed interval occupied by completed work rolls the closure back.
  - An injected failure at each of nine writes leaves every row unchanged, and the
    retry commits once:
    - canonical record, work detail and allocation;
    - entry and append position;
    - period update and period insert;
    - balance intent and receipt.
  - Legacy: established writes, revision 0, no receipt.
- **`work-period-split.integration.test.ts`, 19/19.** It drives the real `clockIn`
  and `clockOut` and both `splitWorkPeriod` exports.
  - Adopted split of 08:00:40 to 17:00:31 UTC at Berlin 14:00:
    - the segments are 239 and 301 minutes in both representations;
    - the project and cost-center allocations are cloned;
    - the recording actor and approval state are preserved, with the decision
      lineage in the receipt;
    - the notes are placed as described above;
    - the entries chain from the previous tip with offset 120, and the position
      advances by two with `completed_work_split`;
    - the balance is dirty from 2026-07-22;
    - the receipt matches exactly.
  - Replay through the other export returns the same periods and writes nothing, and
    a changed request is a collision. The other export then splits the generated
    segment as fresh work (180 and 121 minutes).
  - A 20-second segment stores 0 minutes.
  - Prior-day work across Berlin midnight splits at 00:30, and the balance
    refresh starts on the first local date.
  - A pending correction request refuses the split with no writes, both adopted and
    legacy.
  - Overlapping work is refused with no writes, and so is a diverging canonical
    record (held for review).
  - An injected failure at each of eleven writes leaves every row unchanged, and the
    retry commits once and then replays:
    - entry insert, append position and notes update;
    - period update, record update and record insert;
    - work detail and allocation;
    - generated period, balance intent and receipt.
  - Legacy: established writes, source revision unchanged, canonical record whole,
    no receipt.
- **Mutations** (PostgreSQL, both suites):
  - removing the split's review guard fails the adopted review test;
  - dropping the carried project fails the adopted break test.
- **Unit tests:**
  - `split-work-period.test.ts` covers the planner: rounding, zero minutes and
    out-of-period splits.
  - `clocking.break.test.ts` covers the break adapter's seams: legacy writes
    inside the owner, the review refusal, the adopted operation call, replay and
    validation.
  - `split-work-period-dialog.test.tsx` covers the split identity across retries.

## Not verified and activation blockers

These items move to #327, #329 and #331 (see
[spec #264 close-on-implementation](https://github.com/Umami-Creative-GmbH/z8/issues/264)):

- **Activation (#327).** Adopted behavior is dormant until an organization's
  append control is `active`. The legacy split still supersedes the clock-out entry
  that its second period keeps. It still leaves the canonical record whole. Both
  are corrected only by adoption, so these writers must be adopted (or the
  organization activated) before payroll relies on canonical records.
- **Diagnostics (#327).** The #319 diagnostics map receipts to periods by
  `work_period_id`. A split-generated period, like the resumed period of a
  #281/#304 break and the #303 generated segment, has no receipt of its own and
  reads as "written after admission without receipt". Diagnostics must also read
  the generated or resumed period from these receipts before activation.
- **Old binaries (#329).** During a rollout, instances on the previous binary
  split and break with raw writes, without coordination or the review guard.
  Old-consumer drain applies. An old binary cannot write `split_completed_work`,
  `work_period_split` or `completed_work_split`.
- **Post-commit follow-ups.** Surcharge calculation after a split, and compliance,
  break enforcement and surcharges after an adopted break, remain best effort, as
  for clock-out. Their durable recovery belongs to #305.
- **Real browser.** The calendar dialog and the quick-break control were not
  exercised in a running app. The server paths are verified on PostgreSQL. The
  dialog's identity handling is covered in jsdom.
- **Rollback (#331).** Returning to a binary without this slice reintroduces the
  uncoordinated writes. Receipts written stay readable only while the `0103` CHECK
  values stay.
