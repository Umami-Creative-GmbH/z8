# Evidence-only historical gap repair (#320 / T55)

## Delivery and activation status

Organization administrators can read a repair plan for historical work and, once
the organization has separately authorized repair, apply it. A plan fills only
the values that the #319 diagnostics report as pre-adoption missing
(`historical_gap`) and that other evidence of the same work establishes
uniquely. Everything else stays held for review, with a reason.

The slice is switched off. Repair runs only for an organization with an
`active` row in `historical_work_repair_control`, and there is no application
setter. Plans stay readable without it. Explicit proposals for conflicts belong
to #323. Scoped payroll collection, which runs eligible repairs before its
snapshot, belongs to #322.

References: [#320](https://github.com/Umami-Creative-GmbH/z8/issues/320),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the
canonical resolutions of
[#260](https://github.com/Umami-Creative-GmbH/z8/issues/260#issuecomment-5654136671)
(§1-§3, §6, §7),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538)
(§3, §5, §6) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Modules

| Module | Role |
| --- | --- |
| `lib/time-tracking/historical-gap-repair.ts` | Pure planner. Takes the diagnostics evidence and report and returns the repairable units per employee and the held gaps. |
| `lib/time-tracking/historical-gap-repair-executor.ts` | Reads plans in the diagnostics snapshot. Applies a reviewed plan per employee under the shared completed-work coordinator. |
| `POST /api/time-entries/diagnostics/repair` | `plan` and `apply` for one employee or every employee and a calendar-date range (at most 366 days). Organization administrators only. |
| `/settings/work-diagnostics` | Shows the repair panel below the diagnostics: repairable work, held gaps, authorization state, and a reason to apply. |
| `historical_work_repair_control` (migration `0100`) | Separate per-organization authorization. Cascades with the organization. |

The diagnostics reader gained two evidence fields: each endpoint entry's
`created_by` and each period's `graph_revision`. It now accepts any
organization-scoped reader, so a coordinated write transaction re-reads with the
same code.

## What a plan fills

Only `historical_gap` findings are candidates. Fresh post-adoption and backdated
gaps are integrity incidents. Ambiguous provenance needs investigation. Neither
is planned.

| Finding | Fill | Evidence required |
| --- | --- | --- |
| `canonical_link_missing` | Link the period to the record carrying its ID. | The record already exists, so its ID is kept. |
| `canonical_missing` | Create the record under the period's ID, with detail and project allocation. | A closed, inactive period with stored minutes, and its own current clock-out entry at the period end. That entry's author is the record's creator. |
| `canonical_detail_missing` | Insert the work detail (and project allocation) from the linked period. | A period links the record. Native records are held. |
| `endpoint_missing` (canonical end) | Complete the record's end and, when absent, its minutes. | A closed period, its current clock-out entry at the same instant, and stored period minutes. The record's own minutes must agree when present. |
| `endpoint_missing` (period end) | Complete the period's end and, when absent, its minutes. | The record's end and minutes, the period's own clock-out entry at that instant, and the same start. |
| `duration_missing` | Copy the other representation's stored minutes. | Both representations span exactly the same positive interval. |
| `metadata_missing` | Add the project allocation, or set the category or location where the detail has none. | The project or category belongs to the organization. |

Every other gap is held with one of these reasons:

- `conflicting_evidence`: another finding on the same work conflicts, is a suspected defect, or is not historical. All of that work's gaps are held, even when one side looks plausible. This covers overlapping possible duplicates, empty and reversed intervals, relink residue, and shared or foreign ownership.
- `no_restorable_evidence`: nothing establishes the value. This covers approval relationships (no workflow is started), missing endpoint entries (no append-chain entry is written), and native-record details.
- `original_rule_unknown`: no representation holds the minutes. They are never derived, because the original rounding rule is unknown.
- `original_actor_unrepresentable`: a missing record without a completing entry. `time_record.created_by` requires a human, and no stand-in is chosen (#260 §3).
- `active_work`: active work is completed by its own writers.
- `reference_outside_organization`: a referenced project or category belongs to another organization.

Preserved by construction:

- established canonical IDs and links (a link is only ever set where none exists);
- stored minutes (copied, never rerounded; positive zero-minute work stays zero);
- exact UTC endpoints and entries, with their captures;
- richer canonical metadata (only absent fields are filled);
- deletion (deleted periods have no gap findings and every write excludes them);
- pending and terminal approval state and history (state is copied from the period, and requests and decisions are never touched).

## Honest attribution

The receipt's `actor_kind`/`actor_user_id` name the **executor**: the
administrator who applied the repair. The receipt `result` carries the rest
separately:

- `originalActor`: `human` with the evidencing clock-out entry, for a created record. Otherwise `unknown_historical`, because nothing records who omitted a fact.
- `executor`, with `executedAt`;
- `reason`;
- `evidence`: the finding IDs, the expected field state, and the source of every fill.

The created record uses `origin = 'system'`, the representation convention of
earlier backfills, and `updated_by` stays null. Filled records keep their
original `created_by` and `updated_by`.

## Coordination, staleness and idempotency

`applyHistoricalGapRepair` runs one transaction per employee through
`withCompletedWorkTransaction`, in this order:

1. The adoption gate, then the organization configuration guard, the user access guards, and the employee coordination key. The routed scope is rechecked, as for every participating writer.
2. The repair authorization, read inside the transaction.
3. A first read of the employee's evidence to find the planned rows. Those periods, then records, are locked `FOR UPDATE` in ID order.
4. A second read of the field, absence and lineage evidence under those locks, and a new plan. If its fingerprint differs from the reviewed one, the executor stops without writing.
5. Every fill is a guarded write. `canonical_record_id IS NULL`, `end_at IS NULL`, `duration_minutes IS NULL`, detail `ON CONFLICT DO NOTHING`, and "no project allocation yet" each must affect exactly one row. The period's `graph_revision` advances from its expected value, with `deleted_at IS NULL`. Any mismatch rolls back the employee's whole repair as `stale`.
6. One receipt per repaired work, of kind `repair_historical_gap` and writer `historical_gap_repair`, commits with the graph. Its ID is derived from the organization, the period and the unit's plan fingerprint.

Repeating a reviewed plan after it committed finds its receipts by plan
fingerprint and returns `already_applied`. Nothing is written again. Two
concurrent applies serialize on the employee key: one applies and the other
replays. A repair receipt under `append` admission does not mark the work as
amended after adoption in later diagnostics.

Committed replay never calls this module. The organization-wide
`runCanonicalBackfill` is not used: nothing here relinks, overwrites, deletes or
rebuilds.

## Verification

### PostgreSQL (2026-09-25)

The suite is `apps/webapp/src/lib/time-tracking/historical-gap-repair.integration.test.ts`.
It is registered in `scripts/run-approval-workflow-repository-integration.sh` and
in the CI `integration-tests` job. It ran against a fresh label-owned PostgreSQL 16
container with the full migration chain: **7 tests passed**. The #319 diagnostics
suite passed 6/6 alongside it.

Work is written by the real legacy `createManualTimeEntry`. Gaps are injected with
SQL, as history would contain them. Plans and applies go through the real route.

Verified:

- **Fill and preserve.** A missing record is created under the period's ID. It keeps the stored 239 minutes (not today's 240), pending state, category and project, and the clock-out author as creator. The legacy approval request is untouched. A missing link keeps the existing record ID and its agreeing 125 stored minutes. An opened record gets its completion and detail.
- **Attribution and replay.** Each receipt names the executor and reason, with `originalActor` human (with entry) or `unknown_historical`. Afterwards the diagnostics show only the stored-minutes disclosure. Repeating the plan returns the same receipt IDs with a byte-identical snapshot. Not authorized means 409 and nothing is written.
- **Held.** A metadata gap on work with a duration conflict, minutes held nowhere, a pending period without a relationship, a missing record without a completing entry (plus its missing endpoint entry) and an overlapping possible duplicate are all held with their reasons. A deleted period is never planned or changed.
- **Races and staleness.** A concurrent completion, approval or deletion holds the worker's coordination key while the repair waits for it (observed in `pg_locks`), then commits. The repair re-reads and returns `stale` without a receipt. A real legacy calendar split before apply also yields `stale`, and the split's result is unchanged.
- **Failure and concurrency.** A trigger that fails the receipt insert rolls back the created record, detail, allocation, link and revision (snapshot equal). Two concurrent applies then give exactly one `applied` and one `already_applied`, with 2 receipts, 2 records and 1 allocation.
- **Adoption.** In an adopted organization only the pre-adoption gap is planned. A fresh version-2 manual entry's missing detail stays an integrity incident. After repair (receipt under `append` admission), the work's remaining held gap is still `historical_gap`.
- **Authorization.** A manager and an employee get 403 for plan and apply. A foreign-organization employee gets 404. An `expected` naming them gets 400, as do a blank reason and a reversed range. Another organization's active control does not authorize this one (409).

### Database-free

- `historical-gap-repair.test.ts` (19 tests) covers every fill, every hold reason, deleted, post-adoption and ambiguous exclusion, plan identity per employee, and revision sensitivity.
- `work-repair-panel.test.tsx` (3 tests) covers the unauthorized read-only state, the required reason, the exact apply request, the stale outcome, and the server's refusal.

## Known limits

- Races with the real completion, approval and deletion writers were exercised at their shared coordination key with SQL writes, not through those writers' code. The legacy split ran for real, but it does not take the key: the row locks and the re-plan protect the repair from it.
- The plan is O(history) per employee, read twice per applied employee (to find rows, then under locks).
- The original actor of a created record is the clock-out entry's author. When the entry was written by a manager on someone's behalf, that manager is the completing human, as for fresh work.
- Approval decisions (`time_record_approval_decision`) are never reconstructed, even when legacy requests exist.

## Remaining activation blockers

This slice closes on implementation (see the #264 decision of 2026-09-25).
Activation items move to #327/#329/#331:

- **Authorization (#327):** activating `historical_work_repair_control` per organization is the separately agreed repair authorization. Record who authorized it and on what diagnostics. Until the completion, approval, deletion and split writers all take the employee key, a repair's safety against them rests on row locks, guarded writes and the re-plan.
- **Pilot (#329):** run plans read-only on pilot organizations first. Measure plan cost for the organization-wide page. Tolgee keys under `settings.workDiagnostics.repair.*` need translations.
- **Payroll (#322):** calling eligible repair before the scoped readiness snapshot, and retiring `assertCanonicalCutoverReady`'s backfill, belongs to #322.
- **Rollback (#331):** the route and panel can be removed. The migration is additive. Repaired facts are ordinary graph values with receipts. They are not rolled back automatically: a correction is an audited operation (#323), not a blind revert. Deleting the control row stops further repair.
