# Strict versioned manual commands (#308 / T44)

## Delivery and activation status

Manual time entries can now be submitted as a strict version-2 command. In an organization
whose `time_entry_append_control` row is `active`, the command is interpreted by a protected
preparation collaborator and committed through one completed-work operation. Every other
organization keeps the legacy manual writer unchanged. The manual form learns which
representation to send from its advisory target context (`manualCommandVersion`).

Nothing activates in this slice. There is no application setter for the append control;
the PostgreSQL suite enables a scope by inserting the control row directly. The same row
already gates web clock-in (#273), web clock-out (#274), imports (#284), demo work (#285)
and direct HTTP (#275). The activation blockers are listed at the end and move to #327,
#329 and #331.

Implementation references: [#308](https://github.com/Umami-Creative-GmbH/z8/issues/308),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#254](https://github.com/Umami-Creative-GmbH/z8/issues/254#issuecomment-5653344746),
[#258](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Command

`lib/time-tracking/manual-command.ts` (pure, shared by browser and server):

```ts
{
  version: 2,
  submissionId,              // canonical UUID; also the work period and receipt ID
  targetEmployeeId,          // explicit, also for self entries
  date: "YYYY-MM-DD",        // strict calendar date; one date, no end date
  clockIn:  { time: "HH:mm", occurrence: "earlier" | "later" | null, displayedOffsetMinutes },
  clockOut: { time: "HH:mm", occurrence: "earlier" | "later" | null, displayedOffsetMinutes },
  zone: { basis: "target" | "browser", timezone },   // named IANA zone
  browserTimezone,           // applicable browser context or null
  reason,                    // nonblank; normalized by trimming
  projectId, workCategoryId, // null or an ID
}
```

Parsing is exact: unknown or missing keys, loose dates/times and fixed-offset zones are
`invalid_command` with the field name. The receipt stores the submitted command unchanged;
the normalized interpretation is stored separately in the receipt result.

Interpretation (`interpretManualInterval`), in the governing zone:

| Rejection | When |
| --- | --- |
| `nonexistent_time` | The wall time falls in a spring-forward gap |
| `occurrence_required` | The wall time repeats and no occurrence was chosen; both offsets are returned |
| `reconfirmation_required` / `ambiguity_changed` | An occurrence was sent for a time that is not repeated |
| `reconfirmation_required` / `offset_mismatch` | The server-derived offset differs from the displayed one |
| `reconfirmation_required` / `zone_changed` | A target-basis command names a zone other than the target's current effective zone (even at equal offsets) |
| `nonpositive_interval` | UTC end is not after UTC start (UTC order decides repeated hours) |
| `future_endpoint` | The end is after the evaluation instant (equal is allowed) |
| `interval_too_long` | More than 24 elapsed hours |

A same-zone change of the fallback source (employee setting removed, organization zone equal)
is revalidated and accepted without reconfirmation; the receipt records the source used.
`basis: "browser"` is a self entry continued once in the validated browser zone, which then
governs interpretation and capture; on-behalf entries cannot use it.

## Acquisition protocol

`lib/time-tracking/manual-work-transaction.ts` acquires, in order:

1. Shared `["completed-work-adoption", organizationId]`, then the append control under it.
2. The `manual_time_submission` approval write gate.
3. Shared `["work-organization-configuration", organizationId]`.
4. Shared `["work-user-configuration-access", userId]`, sorted: actor, target and, when
   routed, approval participants.
5. The exclusive employee key `hashtextextended(employeeId, 0)` for the target and routed
   participants, sorted.
6. The submission identity `[organizationId, "manual_time_submission", "time_entry", submissionId]`
   (the key legacy manual replay already uses), then active approval policy rows `FOR SHARE`
   when routed, then the operation's rows and the append position.

The first attempt routes no approval participants. When preparation decides that approval is
required, the attempt rolls back before any write and restarts with participants routed. A
routed scope that changes while waiting restarts too (at most three attempts). Nothing
acquires an earlier-ranked resource late.

## Preparation and operation

Inside that transaction, `actions/manual-command-submission.ts`:

1. **Replay first, in every mode.** A receipt with the same organization, employee, writer,
   kind and exact command replays its committed result without any fresh check, repair or
   effect; this also holds after a return to inactive. A different command under the identity,
   legacy work already saved under it, or committed work that was deleted or relinked is a
   collision.
2. Not adopted → `manual_entry_not_adopted`, nothing written.
3. One authoritative instant is sampled for the attempt (a restart samples again).
4. `actions/manual-preparation.ts` reads everything through the transaction:
   current creation authorization (the principal loader on the transaction; bans; explicit
   `create TimeEntry` for on-behalf targets), the target's effective zone (employee →
   organization → UTC), zone agreement, interval interpretation, organization holiday
   blocking on each occupied local date in the effective zone (the holiday category must now
   also belong to the organization; this tightens the shared check for every caller), project
   eligibility (active,
   bookable, assigned), category eligibility (current effective set at the instant), and the
   change policy: organization-scoped, active, effective and not yet expired at the instant,
   employee → team → organization, with more than one candidate at the deciding level failing
   as `policy_ambiguous`. Age is inclusive calendar days from the end's local date to the
   instant's local date in the effective zone.
5. Manual approval intent: authorized on-behalf entries and owner/admin self entries are
   direct; no policy and trust mode are direct; within self-service is direct; within the
   approval window and, for manual entries only, beyond it (the age-based `forbidden`) require
   approval. The generic change-policy service is not changed.
6. `lib/time-tracking/record-manual-work.ts` writes the graph: symmetric half-open occupancy
   (the shared `work-occupancy.ts` from #286; nothing is trimmed), both entries from
   one append admission (`manual_entry`) with each endpoint's own offset, the canonical record
   (`origin = manual`), detail and project allocation, the period (`id = submissionId`,
   `graph_revision = 1`), required approval participation through the existing ordinary
   submission (including #302 evidence capture), the balance refresh intent and a
   `completed_work_operation` receipt (`kind = create_completed_work`, `writer = manual_entry`).
   Surcharge evidence keeps its event-time semantics.

Required approval that cannot be routed rolls back everything. Notification delivery and
best-effort surcharge calculation run after commit; their failure does not fail the save.

## Legacy input

Unversioned input keeps its established fingerprint and matcher. Its write transaction now
takes the adoption gate first. In adopted organizations, a committed legacy submission still
replays exactly; otherwise, once absence is established under the submission identity, it
returns `manual_entry_refresh_required` with nothing written.

## Form

When the target context advertises version 2, the manual form:

- shows an occurrence choice for each repeated endpoint, labelled with its UTC offset
  ("First, UTC+02:00" / "Second, UTC+01:00"), and flags spring-forward times immediately;
- freezes the command with the offsets it displayed and runs the same interpreter locally for
  feedback (UTC order, future, 24 hours);
- sends `basis: "browser"` only for a self entry continued once in the browser zone. The
  form then shows the browser zone; if an endpoint needs an occurrence choice there, the
  draft is not sent until the user chooses in that zone;
- drops an occurrence choice when its date or time changes, and all choices when the target,
  zone or zone basis changes;
- on reconfirmation, not-adopted or refresh outcomes, clears occurrence choices, refetches
  the context and asks the user to review.

New strings are in all 12 `timeTracking` locales.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.manual-command.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. The real public `createManualTimeEntry` action, approval routing and
live `clockIn` run on the label-owned disposable PostgreSQL 16 database; only the session,
billing provisioning, notification delivery and Next cache are replaced, and the authoritative
clock can be pinned. **27/27.**

- Gating: v2 writes nothing without or with an inactive control row; legacy input stays
  legacy before adoption; after adoption a committed legacy submission replays and fresh
  legacy input is refused, with no writes.
- The committed graph: exact endpoints and minutes, per-endpoint captures and notes, chained
  entries, `manual_entry` append position, canonical record, submitted-versus-normalized
  receipt, balance intent.
- Replay: exact retry without writes (also after a zone change and after a return to
  inactive); changed command and deleted work are collisions.
- Injected receipt failure rolls back every row.
- DST: gap, missing occurrence (with both offsets), both explicit occurrences with UTC
  ordering, zone/ambiguity/offset reconfirmation, same-zone fallback source, browser
  continue-once versus on-behalf.
- Future, nonpositive, over-24-hour and invalid fields; holiday blocking by the effective
  zone's local date (Auckland 09:00 on the 25th blocks, UTC would not); project eligibility;
  category eligibility from the current effective set at the evaluation instant.
- Occupancy: rejected work occupies, deleted work does not, adjacency commits, an active
  prior-day period occupies from its start, two concurrent overlapping submissions commit
  exactly one, manual work waits on the shared employee key.
- Configuration protection: a submission waits on the organization configuration guard and
  on the target user's access guard and then reads the committed change.
- Policy: inclusive age at one instant across Berlin midnight, approval routed to the manager
  with pending participation, beyond-window conversion, expired and future assignments
  ignored, owner self and manager on-behalf exemptions, unrelated target refused, an owner
  with an ordinary employee role may create for a colleague and a plain employee may not,
  unroutable approval rolled back.
- Cleanup: `clearOrganizationTimeData` removes manual receipts, positions and records.

Mutations each failed their tests: no occupancy (3), not-adopted before replay (1), no zone
check (2), no configuration guard (2), UTC instead of effective-zone age (1).

The approval write-boundary scanner registers the operation's `time_record`, detail,
allocation and `work_period` writes (`ManualWorkTransactionContext` is a trusted
transaction type); `approval-write-boundary.test.ts` passes 290/290 in a Linux container.

The #302 evidence suite and the #284 import suite now submit v2 commands in their adopted
organizations (10/10 and 28/28). The import suite's former pinned legacy trimming is replaced
by the target behavior: manual work over imported work is refused with the occupant.

### Database-free

- `lib/time-tracking/manual-command.test.ts` (42): strict parsing, wall-time classification,
  zone agreement, interval interpretation, half-open local dates, calendar-day age, intent.
- `components/time-tracking/manual-time-entry-dialog.test.tsx`: occurrence choice and command,
  UTC-ordered repeated hour, gap feedback, browser-basis continuation (including a time that
  repeats only in the browser zone), dropped choices after a time change, reconfirmation and
  not-adopted handling, with the real `TimeInput`.
- `actions/manual-entry-target.test.ts`: the advertised command version.

## Remaining activation blockers

This slice closes on implementation. The items below are activation gates for #327
(all-writer adoption), #329 (pilot) and #331 (rollback).

- **Configuration writers** (#311–#318) do not yet take the exclusive configuration and
  user access guards, so the shared guards reserve the protocol without fencing settings,
  auth/SCIM, project/category and billing mutations. Holiday, blocking-category and
  change-policy writers participate since #316
  ([evidence](holiday-change-policy-coordination-316.md)), except the import, demo and
  cleanup writers left to #318.
- **Billing** is still checked before the transaction with the provisioning gate; the
  transaction-bound non-provisioning recheck is #317.
- **Frozen command recovery** (tab-scoped storage, lookup-only recovery, exact retry after an
  uncertain result) was delivered by #310; see [manual-command-recovery-310.md](manual-command-recovery-310.md).
- **Other writers** that create intervals (corrections #301/#286, breaks/splits #304, on-behalf
  clock-out #276, mobile/extension/desktop clients) must adopt occupancy and append
  participation before the shared guarantees hold against manual work.
- **Lock order of the legacy manual path**: its replay transaction takes the submission
  identity before the approval write gate. It is only reachable for legacy input and waits
  on the adoption gate in its write transaction; old binaries must be drained before
  activation.
- **Not verified here:** unchanged surcharge event-time semantics with manual approval (the
  operation passes the exact interval to the existing snapshot resolver), and a manual/live
  clock race in both arrival orders (only manual-waits-behind-the-employee-key is exercised).
- **Freezing** the confirmed command across the timezone prompt was delivered by #310: the
  command is built once from the submit-time draft snapshot and captured target, then stored.
- **Policy ambiguity** cannot currently occur in the database (unique active assignment
  indexes per level); the explicit failure is covered only by construction.
- Deployment, old-client coexistence (forms without `manualCommandVersion` send legacy
  input and get `manual_entry_refresh_required` once adopted), the scoped pilot and
  compatible rollback (#327/#329/#331). A rollback to inactive keeps replaying receipts.
