# Time pilot — #329 / T64

This is the limited organization pilot of completed work, manual commands and
clock clients: append adoption, time approval evidence, reviewed imports and
payroll collection. The page covers four things:

- the readiness report;
- the exclusive activation step;
- the order of the operator steps;
- what the report cannot see.

The activation details of each piece live with its slice. The
[all-writer record](../all-writer-adoption-327.md) lists every writer and its
remaining blockers.

Nothing here activates anything. Each control change is a separately authorized
operator step. The operational checklist (deployed builds, old clients, click-throughs,
Tolgee) is tracked in [#448](https://github.com/Umami-Creative-GmbH/z8/issues/448). It was moved there from #329.

## Readiness report

```bash
pnpm time:pilot-readiness --organization-id <org-id>
pnpm time:pilot-readiness --organization-id <org-id> --json
```

The report needs the same database configuration and operator access as
[Approval maintenance](approval-maintenance.md). It reads everything in one
`repeatable read`, `read only` transaction scoped to the organization, and it
changes nothing. An unknown organization ID is an error, not an empty report.
`--json` prints the full report for the evidence record.

- Owner: `assessOrganizationTimePilotReadiness` in
  `apps/webapp/src/lib/time-tracking/pilot/readiness-reader.ts`.
- Classification: `assessTimePilotReadiness` in `pilot/readiness.ts`.

The history read covers every employee's whole retained history (O(history)), the
same read that diagnostics does. Measure it on the pilot organization before running
it on a large one.

Every section gets a verdict:

- `blocked` when any finding is a blocker;
- `hold` when there are only holds;
- `ready` otherwise.

The report's overall verdict is the worst section. A hold needs an explicit operator
decision, usually to accept it or to wait for it to drain. The report never clears one.

### Sections

**Append adoption.** This section covers:

- the `time_entry_append_control` mode. While the mode is `active`, the control's
  `updated_at` counts as the activation, because the control has no setter;
- every employee (inactive ones included), by how the append position was admitted
  (`empty_history`, `verified_lineage`, `authorized_continuation`) or not admitted;
- employees whose lineage needs review;
- adopted employees whose continuity is interrupted;
- open work periods.

Lineage and continuity come from the append assurance reader (#324).

**Historical work.** This section runs the #319 diagnostics over the whole retained
history of every employee. It counts findings by treatment, and blocking findings by
kind for triage.

**Time approvals.** This section covers `manual_time_submission`, `policy_clock_out`
and `time_correction`. For each kind it shows:

- the rollout's `lifecycle_mode` (`legacy` when no row exists);
- the evidence mode;
- every pending time approval request, sorted by its submitted evidence.

The report finds each request's kind with the same classifier as the legacy state
readers, and sorts it with the inbox's review preparation (#325). A held request in
the report is therefore one that a decision would refuse:

| Class | Meaning |
| --- | --- |
| `current` | Has a revision that still matches the live work. |
| `notCaptured` | No submitted revision. The request was submitted before capture, or capture is off. |
| `materialChange` | The live work changed after the revision. |
| `multiStage` | The request sits on a legacy chain with more than one stage (a subset of the above). |

**Writers since activation.** This section counts the completed-work receipts
committed since activation, by writer.

**Reviewed imports.** This section counts held rows (`blocked` with a `commit_hold`),
batches that ended `commit_failed`, and batches that are still scanning or
committing.

**Follow-up work.** This section covers:

- the payroll collection mode (#322);
- the historical repair mode (#320), for information only;
- pending balance rebuild intents (#311);
- open historical-work proposals (#323);
- pending automatic break adjustments (#305).

### Findings

| Code | Severity | Meaning and action |
| --- | --- | --- |
| `append_inactive` | hold | The organization is not adopted yet. Activate it with the [exclusive step](#exclusive-activation) once every other gate holds. |
| `open_work_in_flight` | hold | Before activation only: work is running right now. After the switch it is closed through the adopted clock-out operation (the suite closes such work on behalf). Activate outside working hours anyway (#308), so that no legacy manual retry is refused in the switch. |
| `lineage_review_required` | hold | The employee has no append position, and their history is not a single lineage. Their next fresh write is held (`append_review_required`) until an authorized continuation (#323) admits them. |
| `continuity_interrupted` | blocker | Since the employee was adopted, their history changed outside the append collaborator. This is a post-adoption incident. Find the write before going on. |
| `history_integrity_incident` | blocker | A fresh or backdated write that should have met the completed-work invariant. It must be resolved before activation (#319). |
| `history_investigation_required` | blocker | Ambiguous provenance, for example work written after admission without a receipt. It must be resolved before activation (#319). |
| `history_review_required` | hold | A conflict or suspected manual defect from before adoption. It needs an authorized review (#319, #323). |
| `history_gap` | hold | A missing value from before adoption. It is the only treatment that evidence-only repair may consider (#320). Payroll collection blocks on it while it is relevant. |
| `rollout_mode_unverified` | blocker | The kind runs `shadow`, `ready` or `complete`. Only `legacy` and `canonical` single-stage lifecycles were verified for time kinds (#301, #302). |
| `multi_stage_unverified` | blocker | Pending requests sit on legacy multi-stage chains, which were not verified for time kinds (#301, #302). |
| `evidence_capture_inactive` | hold | `approval_evidence_control` is off for the kind. The activation SQL is in [Approval evidence](approval-evidence.md#manual-time-submissions-and-policy-clock-outs-302--t38). `time_correction` uses the same statement with its rollout key `:15:time_correction`. |
| `in_flight_without_revision` | hold | Capture is still off, and these requests have no revision. Turning capture on holds them (`evidence_required`). Drain them first. Reconstructed revisions would need a separately authorized step, which is not implemented. |
| `evidence_held` | hold | Capture is on, and these requests have no revision. Approve and reject both refuse them with `evidence_required` until they drain or are cancelled. |
| `evidence_material_change` | hold | The live work no longer matches the revision (`material_change`). Ordinary users have no cancel or resubmit path for manual or policy clock-out requests (#302 blocker 2). |
| `pending_unclassified` | hold | The request's kind cannot be established (inconsistent markers, or no work period in the organization). The report does not assess its evidence. Investigate it. |
| `legacy_admission_after_activation` | blocker | A receipt was committed under `legacy` admission after activation. A writer read the control before the switch without the adoption gate, or an old server binary is still running. |
| `server_identity_on_behalf` | hold | An on-behalf clock-out without a client identity: a calendar bundle deployed before #401 is still in use (#276). It cannot recover a lost response. |
| `import_rows_held` | hold | Import rows held for review. There is no reviewer flow for them yet (#284). Decide how the pilot resolves them before importing. |
| `import_commit_failed` | hold | A batch ended `commit_failed`. That status covers held rows and infrastructure failures alike (#284). |
| `import_in_progress` | hold | A batch is scanning or committing. Let it finish before the switch. |
| `payroll_collection_inactive` | hold | Payroll exports still use the previous reads (#322). A payroll pilot needs the collection active. |
| `balance_rebuild_pending` | hold | A timezone rebuild waits for its next run, which can take up to three hours (#311). Balance cards show "Not calculated yet" until then. |
| `proposals_open` | hold | Historical-work proposals that are still proposed or approved (#323). Apply them or reject them. |
| `break_adjustment_pending` | hold | Automatic break adjustments that are pending or deferred (#305). |

## Exclusive activation

Every coordinated writer takes the shared adoption gate first, and then reads the
append control under it. Take the gate exclusively in the same transaction that
writes the control. The switch then waits for writers that are already in flight,
and every later writer sees the new mode:

```sql
begin;
select pg_advisory_xact_lock(hashtextextended('["completed-work-adoption","' || :org || '"]', 0));
insert into time_entry_append_control (organization_id, mode, updated_at)
values (:org, 'active', clock_timestamp())
on conflict (organization_id) do update set mode = excluded.mode, updated_at = excluded.updated_at;
commit;
```

Activate only with this statement. The report takes the control's `updated_at` as the
switch. An `update … set mode = 'active'` that leaves `updated_at` alone, or a row
that was inactive before, would date the switch too early. Receipts written before the
switch would then show as `legacy_admission_after_activation`.

The key is the same `JSON.stringify(["completed-work-adoption", organizationId])`
that `acquireAdoptionGate` hashes. `clock_timestamp()` stamps the switch after the
lock is granted. The report counts receipts from that instant on, so a writer that
finished before the switch never looks like a legacy writer after it. The PostgreSQL
suite below activates through exactly this statement. A clock-in that arrives while
the lock is held waits, and then appends under the new mode. Evidence capture for the time kinds uses each kind's
exclusive rollout lock ([Approval evidence](approval-evidence.md#manual-time-submissions-and-policy-clock-outs-302--t38)). Payroll
collection (`payroll_work_collection_control`) and historical repair
(`historical_work_repair_control`) are rows per organization with no application
setter.

## Pilot sequence

For each pilot organization, record the report (`--json`) before and after every
step.

1. **Deploy and inventory.** Apply the migrations listed in the
   [all-writer record](../all-writer-adoption-327.md#deployment-and-migrations) through
   the authorized deployment, on one release for every worker and app instance. Record
   the deployed versions and the old-client inventory. The report cannot see either.
2. **Drain old writers and clients.** No pre-fence server binary, browser worker
   without `frozen-v2`, old calendar bundle or unknown desktop build may remain
   (#266, #276, #279, #280). The extension and mobile clients are retired
   (#282, #283). Their installed copies stay old consumers until they are shown to
   be controlled.
3. **Triage history.** Resolve every `history_integrity_incident` and
   `history_investigation_required`, and decide each `history_review_required`,
   `history_gap` and `lineage_review_required`. Repairs, continuations and reviews
   stay separately authorized (#320, #323).
4. **Drain in-flight approvals and imports.** Get `in_flight_without_revision`,
   `import_in_progress` and the held import rows to zero, or accept them, before
   turning on capture.
5. **Evidence capture.** Turn on capture for the time kinds. `evidence_held` must
   match what step 4 accepted.
6. **Activate append admission**, with the [exclusive step](#exclusive-activation),
   outside working hours.
7. **Payroll collection.** Activate it only with an explicitly authorized control
   row, once the organization's canonical absence reconciliation is clean (#322).
   Measure the collection's cost on the organization first.
8. **Observe.** Re-run the report during the pilot:
   - `legacy_admission_after_activation` and `continuity_interrupted` must stay at
     zero;
   - `server_identity_on_behalf` must fall to zero as calendars are refreshed.

   Run the click-throughs listed on #448. Neither the report nor the PostgreSQL
   suites replace them.

A `ready` verdict covers only the gates the report can see. It cannot see:

- deployed builds, old clients and their device queues (browser IndexedDB, the desktop
  `offline_queue.db`, installed extension storage);
- how committed work replays: it counts receipts by writer, but it does not classify
  receipt-less legacy commits or legacy retries that are not yet committed;
- the canonical absence reconciliation that payroll collection needs (step 7);
- live click-throughs, measured latency and the Tolgee sync.

Record the evidence of steps 1, 2, 7 and 8 separately.

## Pause and rollback

There is no paused state for append admission, and this page adds none. Designing
rollback and proving it is #331.

- **Do not set the append control back to `inactive` as a pause.** Legacy writers
  would resume under legacy head selection, and positions would not advance. When the
  control becomes active again, each position's recorded entry count and tip no
  longer match the history, so continuity reports an interruption and fresh writes
  hold for review. Committed receipts and positions are never removed by a mode
  change.
- **Payroll collection:** delete the control row. That restores the previous reads.
  Stored export inputs stay with their jobs (#322).
- **Historical repair:** delete the control row to stop further repair. Applied
  repairs are ordinary receipted values. They are not reverted (#320).
- **Evidence capture** stays on, as in the [non-time pilot](approval-pilot.md#pause-and-rollback).

## Verification (#329)

`apps/webapp/src/lib/time-tracking/pilot/readiness.integration.test.ts` runs against
the disposable PostgreSQL 16 database. These real callers write the work:

- the public manual action: legacy before adoption, version 2 after it, under a real
  change policy that requires approval;
- `clockIn` and `clockOut`;
- the on-behalf route, called without an operation ID;
- the reviewed-import commit worker.

Tampered hashes and changed stored minutes are injected with SQL. No current writer
produces them. The suite covers:

- an organization before adoption: in-flight open work, a pending manual request
  without a revision, lineage review, a pending rebuild intent, and another
  organization's rows kept out;
- an adopted organization, activated through the exclusive SQL above. It covers:
  - the switch: a clock-in that arrives under the held gate waits, then appends,
    and work opened before the switch is closed afterwards by an identity-less
    on-behalf clock-out;
  - approvals: current, held (`evidence_required`) and materially changed requests;
  - writers: receipts by writer, a server-identity on-behalf clock-out, and a
    receipt under legacy admission after the switch (injected: current writers are
    fenced);
  - history: a post-adoption duration conflict (`integrity_incident`) and an
    interrupted continuity;
  - imports: a row held because it ends in the future, and the failed batch;
- that nothing the report reads changes;
- an unknown organization.

`readiness.test.ts` covers the classification and every finding.
`readiness-cli.test.ts` covers the arguments, help without a database, the required
environment, the text and JSON output, and pool cleanup.

These are not verified here:

- any real organization's data;
- deployed builds and old-client control;
- device queues;
- live clock clients, bots and providers;
- measured latency;
- Tolgee sync;
- the pilot itself.

These stay open on [#448](https://github.com/Umami-Creative-GmbH/z8/issues/448).
