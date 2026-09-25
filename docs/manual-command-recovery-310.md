# Frozen manual command recovery within the tab (#310 / T45)

## Delivery and activation status

A version-2 manual command (#308) is now frozen once, after zone and occurrence
confirmation, and stored in the tab's session storage before its first request. If the
result is uncertain (lost response, generic failure, reload or navigation during the
request), the dialog keeps the command under **Unconfirmed entries**. From there the user
can resend exactly the stored bytes, inspect the outcome with a lookup-only request, or,
once the server has settled it, edit it as a new entry or dismiss it.

The behavior follows the #308 gate. A form only freezes commands when its target context
advertises `manualCommandVersion: 2`, which requires an active `time_entry_append_control`
row, and production has no setter for that row. Legacy input is not frozen and keeps its
established exact legacy replay. Lookup and exact retry answer in every admission mode.

References: [#310](https://github.com/Umami-Creative-GmbH/z8/issues/310),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#254](https://github.com/Umami-Creative-GmbH/z8/issues/254#issuecomment-5653344746) §7–8,
[#258](https://github.com/Umami-Creative-GmbH/z8/issues/258#issuecomment-5654533697) §7–8 and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
The command and operation are in [manual-commands-308.md](manual-commands-308.md).

```text
components/time-tracking/manual-command-recovery.ts      # tab storage, record lifecycle, response classification
components/time-tracking/use-manual-command-recovery.ts  # freeze-then-send, exact retry, lookup, dismiss
components/time-tracking/manual-time-entry-dialog.tsx    # submit path and the Unconfirmed entries panel
app/[locale]/(app)/time-tracking/actions.ts              # createManualTimeEntry(command, recoveryContext), lookupManualTimeEntry
app/[locale]/(app)/time-tracking/actions/manual-command-submission.ts  # lookupManualTimeEntryCommand
```

## Freezing

`submitManualEntry` builds the command once, from the draft snapshot taken at submit and
the user, organization and target captured at submit. The timezone prompt carries that
captured target, so later prop or context changes cannot re-target the command. The
record is written before the request leaves:

```ts
{
  version: 1,
  scope: { userId, organizationId, targetEmployeeId }, // from the server-derived target context
  submissionId,
  command,        // the serialized command; every attempt sends exactly these bytes
  frozenAt,
  attempts,
  status,         // uncertain | not_committed | conflict | unsupported
  code,           // the last answer worth showing
}
```

The key is `z8.manual-entry-recovery.v1:["<user>","<org>","<target>"]:<submissionId>`,
separate from the editable draft, which is never stored. `recoveryContext` (user and
organization) is new in `ManualEntryTargetContext`. It comes from the session on the
server, not from props. If session storage refuses the write, the record falls back to
page memory: it then survives dialog closure and client navigation, but not a reload.

## What an answer proves

| Response to an attempt | Meaning | Record |
| --- | --- | --- |
| success (executed or replayed) | Committed | Removed |
| typed rejection, `manual_entry_not_adopted`, `manual_entry_refresh_required`, `approval_unroutable` | Answered after replay recognition under the submission identity, with nothing written | First attempt from the form: removed, the draft stays for correction. Retry: `not_committed` |
| `manual_entry_collision` | The identity names other work or changed evidence | `conflict` |
| `context_mismatch`, `target_not_authorized`, `invalid_command`, `not_authenticated`, `employee_not_found`, billing | Refused before the identity was read. This attempt did not commit, but that proves nothing about earlier ones | First attempt: removed. Otherwise the earlier status stays |
| generic failure, unknown code, thrown request | May have committed | `uncertain` |

`approval_unroutable`, `not_authenticated`, `employee_not_found` and `context_mismatch`
are new codes on existing failures, so the classification never guesses from message text.

## Recovery actions

Nothing is resent automatically, on mount, on reconnect or after a context switch.

- **Retry exactly** sends the stored command with the stored `{ userId, organizationId }`.
  `createManualTimeEntry` refuses a mismatch with `context_mismatch` before billing or
  any lookup, so a tab whose session changed in another tab cannot submit the command
  into the new session. The record keeps its status and shows the mismatch.
- **Check status** calls `lookupManualTimeEntry(command, recoveryContext)`. It
  authenticates, matches the asserted user and organization, applies the billing gate
  and resolves the currently authorized target as a submission does. It then takes only
  the submission identity lock (`manualSubmissionIdentity`, the key every manual
  submission holds until it commits) and applies the exact receipt matcher of replay. It
  never writes.

  | Lookup | Meaning |
  | --- | --- |
  | `committed` | The receipt. `requiresApproval` is the participation at commit; `currentApprovalStatus` is the period's status read now |
  | `not_committed` | No commit under the identity was serialized before the lookup |
  | `conflict` | Changed command, deleted or relinked work, or legacy work under the identity |
  | `unsupported` | Unversioned, unknown or unparsable input, or an unsupported receipt version. Not proof of absence |
  | `refused` / `failed` | Nothing was established; the record is unchanged except for the shown code |

- **Edit as new entry** (only `not_committed`) copies the command's date, times, reason,
  project and category into the editable draft and removes the record. Occurrence
  choices are not copied; the user confirms them again in the current zone. Submitting
  the draft is a deliberate fresh submission with a new identity.
- **Dismiss** is offered for `not_committed`, `conflict` and `unsupported`, never for
  `uncertain`.
- Editing and submitting the draft while a command is uncertain creates a new identity
  and never touches the stored command.

A committed recovery shows the original outcome ("saved and submitted for approval")
together with the current status read separately, and refreshes the page data.

Sign-out through the user menu or the invitation screen clears every recovery record in
the tab (`clearManualRecoveries`). Tab closure ends the guarantee. There is no cross-tab
or offline queue. A tab duplicated by the browser gets a copy of session storage; a retry
from there is the same identity and replays.

## Verification (2026-09-25)

### PostgreSQL

Suite: `clocking.manual-command.integration.test.ts`, block "frozen command recovery
(#310)", already registered in the runner and the CI integration job. The real public
`createManualTimeEntry` and `lookupManualTimeEntry` actions run on the label-owned
disposable PostgreSQL 16 database. **34/34** (27 from #308 plus 7).

- Committed with approval: the lookup returns the original participation with current
  status `pending`, then `approved` after the period's status changes, and an exact retry
  with the recovery context replays. The lookup writes nothing (snapshot equality).
- Absent identity: `not_committed` with no writes; the exact command then commits and
  the lookup reports it.
- Every admission mode: committed and absent answers with the control `inactive` or
  missing, and no writes.
- Conflicts: changed command, deleted work, legacy work under a version-2 identity.
- Unsupported: legacy input, version 3, an unknown key.
- Serialization: a submission is held inside its transaction (a trigger on the receipt
  insert waits on a test lock) while it holds the identity; the lookup waits behind it
  and then reports the commit.
- Refusals before the identity: another user (a manager who could create for the target),
  another organization, an unauthorized colleague, no session; `createManualTimeEntry`
  refuses a mismatched recovery context. No writes.
- The unroutable-approval rollback now carries `approval_unroutable`.

Mutations, each caught: the lookup without the identity lock (2 failures), the lookup
without the scope assertion (1).

### Dialog and storage (jsdom session storage)

- `manual-time-entry-recovery.test.tsx` (9): the real dialog with the real `TimeInput`,
  `DatePicker`, project and category selectors. Only server actions, translation, router
  and toasts are replaced. A reload unmounts everything and mounts a fresh tree with a
  fresh query cache over the same tab storage. Covered: uncertain through close, reopen
  and reload, with the retry sending the identical command and context; a reload during
  the request; an edited draft under a new identity next to the kept command; no display
  or sending for another user, organization or target, and a refused retry keeping the
  command; props, zone and choices changing after freezing; lookup outcomes kept distinct
  (unsupported, unanswered, not committed, then edit as new with a new identity); conflict
  offering only dismissal; original participation versus current status; nothing kept
  when the first attempt is answered without a commit.
- `manual-command-recovery.test.ts` (18): scoping, immutable bytes, several records per
  target, malformed entries ignored but kept, sign-out clearing, classification, attempt
  and lookup settlement, no dismissal of uncertain records, session storage across a new
  handle, and the page-memory fallback.
- Mutations, each caught: storing after the request (1), a scope without the user (1),
  a refused retry dropping the record (2), resending on mount (7).
- `manual-time-entry-dialog.test.tsx` and `manual-entry-target.test.ts` were updated for
  the recovery context.

`pnpm run typecheck` passes.

## Remaining activation blockers

This slice closes on implementation. The items below move to #327, #329 and #331.

- **Real-browser pilot (#329).** Session storage was exercised in jsdom, not in a deployed
  browser. Verify in a deployed browser: reload and back/forward navigation, a second
  independent tab, duplicated tabs, sign-out clearing, and an account or organization
  switch in another tab, with the real server actions.
- **Lookup is not a tombstone (#327).** `not_committed` means no commit was serialized
  before the lookup. A request still before its transaction can commit afterwards and
  then replays on an exact retry. A deliberately edited fresh submission is protected
  from duplicating the same interval by exact occupancy, but a non-overlapping edit could
  still coexist with a late commit of the original.
- **Legacy input is not frozen.** Unversioned input (non-adopted organizations) keeps the
  in-dialog submission identity and exact legacy replay. The lookup answers
  `unsupported` for it. Adoption (#327) makes every fresh manual submission version 2.
- **Current status beyond the period.** `currentApprovalStatus` is the period's
  `approval_status`; it is not a full approval-request view.
- **Old page bundles (#329).** Pages loaded before deployment call `createManualTimeEntry`
  without a recovery context and have no recovery panel. They keep #308 behavior.
- **Rollback (#331).** Returning an organization to inactive keeps lookup and exact
  retry replay of committed commands; fresh retries answer `manual_entry_not_adopted`,
  which settles the record as not committed. Stored records are tab-local and need no
  server rollback.
