# Scoped payroll work collection and persisted export input (#322 / T57)

## Delivery and activation status

A payroll export can now collect its work as one immutable, scoped input. The export
is complete or refused; it is never partial. Before collecting, it runs the eligible
evidence-backed repairs from #320. It then assesses readiness and collects the work in
one real repeatable-read snapshot. The collected input is stored with the export job
before any delivery. A retried or recovered delivery formats that stored input and
does not reread work that has changed since. The payroll workspace reads the same
collection, so its totals credit exactly the minutes the export would.

The slice is switched off. Collection runs only for an organization with an `active`
row in `payroll_work_collection_control`, and there is no application setter. Without
that row, workspace and export keep their previous reads.

References: [#322](https://github.com/Umami-Creative-GmbH/z8/issues/322),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of
[#260](https://github.com/Umami-Creative-GmbH/z8/issues/260#issuecomment-5654136671)
(§4, §5),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538)
(§9) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145)
(§4.6, §5).

## Modules

| Module | Role |
| --- | --- |
| `lib/payroll-collection/payroll-work-collection.ts` | Pure assessment. Takes one snapshot and a resolved scope and returns the collected input, the blockers and a digest. |
| `lib/payroll-collection/payroll-work-collection-reader.ts` | `collectPayrollWork`: eligible repair first, then `readPayrollWorkCollection` (scope resolution, work, diagnostics and departure timers in one read-only repeatable-read snapshot). Also holds the control read. |
| `lib/payroll-collection/payroll-export-work-input.ts` | Stores a job's input and reads it back. The read checks the digest and version. |
| `lib/payroll-collection/payroll-work-collection-blocked-error.ts` | The refusal. It carries the blockers for server logs, and its client-facing `summary()` contains counts only. |
| `lib/payroll-export/collected-work.ts` | Turns collected lines into formatter lines without any recomputation. |
| Migration `0104_payroll_work_collection` | Adds `payroll_work_collection_control` and `payroll_export_work_input`. The input table is immutable (an update trigger raises) and cascades with its job and organization. |

Reused, not duplicated: the #319 diagnostics reader and assessment, the #320 plan
reader and executor, the #321 protected-minute rule, the snapshot helper shared with
append assurance, and the departure-repair finder.

## Collection contract

### 1. Eligible repair (#260 §4, #256 §9.1)

If the organization's `historical_work_repair_control` is `active`, the collection
reads the #320 plan for the scoped employees. It then applies every employee's plan
through `applyHistoricalGapRepair`, one short coordinated transaction per employee. The
fixed reason is `Eligible historical gap repair before payroll work collection`.

Repair needs a present organization administrator as its executor, the same authority
the #320 route requires:

- the workspace export passes the requester only when their ability allows `manage OrgSettings`;
- the settings export, which is administrator-only, passes the session user;
- scheduled exports pass nobody, so they never repair.

Without an executor, collection runs without repair. A stale plan simply
leaves its gap in place, and the final readiness check decides. If repair is not
authorized, no plan is read, and the gap blocks the export.

### 2. One snapshot (#256 §9.2)

The following all happen in one read-only `REPEATABLE READ` transaction:

- the scope is resolved: explicit employees and/or teams, intersected, and otherwise the whole organization;
- the work records of the scoped employees are read in **any** approval state, including open work and reversed endpoints;
- their details and project allocations are read;
- the whole-history #319 evidence and its assessment are read;
- open departure-timer repairs are read.

A write that commits during the collection is either part of the snapshot or not seen
at all. It never lands in one read and not the other.

### 3. Classification before any filter

Every record of a scoped employee that touches the employee-local window is
classified before a filter could drop it. For reversed endpoints, the hull of both
instants decides whether the record touches the window.

| Record | Outcome |
| --- | --- |
| Rejected | Excluded (`rejected`), recorded in the input. |
| Record of a deleted period | Excluded (`deleted`). It is never payable. |
| No end | Blocker `open_work` |
| Approval undecided (`pending`, `draft`) | Blocker `pending_work_approval` |
| Approved, with a pending `time_entry` approval request on the record or legacy pending changes on its period | Blocker `pending_work_correction`: its approved values may still change |
| Approved, and its minutes cannot be allocated | Blocker `unresolved_work_minutes`, with the #321 reason |
| Approved, outside a project filter | Excluded (`outside_project_filter`), after readiness |
| Approved, zero credited minutes | Excluded (`zero_minutes`): valid zero-minute work, kept distinct from missing work |
| Approved | Collected with its protected minutes and its overlap with the window |

Relevant blocking #319 findings become `uncertain_historical_work` blockers for each
scoped employee they name. A finding with organization-level relevance, or one that
names only employees outside the scope, widens to every scoped employee. Unrepaired
departure timers become `offboarding_clock_repair` blockers. Undecided work blocks even
when its current project is outside the project filter.

### 4. Immutable input with scope and source revisions (#256 §9.3)

The input records:

- the scope: sorted employees, dates, and the team and project filters;
- every collected line: its record, employee identity fields, credited overlap, minutes, category and primary project;
- each line's source revision: the record's `updated_at`, and its linking period with that period's `graph_revision`;
- every exclusion;
- a SHA-256 digest over all of it, from canonical JSON.

Reading the input order-independently yields the same input and the same digest.

## Consumer adoption

- **`createExportJob`** (the workspace export action, the settings export action and the scheduled-export executor) collects first. On any blocker it throws `PayrollWorkCollectionBlockedError`, and no job is created. Otherwise it inserts the job and its input **in one transaction**. The sync/async decision counts the collected lines.
- **`processExportJob`** (inline processing and the `payroll-export` worker job) reads the stored input, checks its dates against the job's filters, and formats it. It never rereads work for such a job, including on a BullMQ retry after a failed delivery. A job without stored input, created before activation, keeps the legacy read.
- **Payroll workspace**: under the control, credited minutes come from the collection's lines, so workspace and export agree by construction. Its work blockers (`open_work`, `pending_work_approval`, `uncertain_historical_work`, `unresolved_work_minutes`, `offboarding_clock_repair`) come from the collection and cannot be dismissed. The legacy dismissible `missing_clock_out` blocker is not produced there, because `open_work` replaces it. Absence and correction blockers are unchanged. The workspace does not repair: it is a read, and it shows unaffected work under explicit blockers.
- **Organization-wide cutover**: under the control, `assertCanonicalCutoverReady` no longer runs for work. Its organization-wide backfill would rewrite work lineage, which #260 forbids. Absences keep an organization-wide check, but as the new read-only `assertCanonicalAbsencesReady`, which runs no backfill.

## Authorization and disclosure

- Scope is always the organization's employees. The reader resolves it with an organization predicate, and blockers only ever name scoped employees.
- An export refusal returns only a translated message (`payroll.errors.exportBlockedByUncertainWork`). Its details are counts per kind and the affected employee count. Record-level blockers stay in server logs and the workspace.
- A historical finding ID can name work outside the reader's payroll scope, for example a foreign-owned record. Workspace blocker IDs for such findings are therefore opaque digests, and the finding's date is shown only when every employee it names is in scope.

## Verification

### PostgreSQL (2026-09-25)

The suite is `apps/webapp/src/lib/payroll-collection/payroll-work-collection.integration.test.ts`.
It is registered in `scripts/run-approval-workflow-repository-integration.sh` and in the
CI `integration-tests` job. It ran against a fresh label-owned PostgreSQL 16 container
with the full migration chain: **6 tests passed**.

Work is written by the real legacy `createManualTimeEntry`. Exports and the workspace
use the real payroll server actions: membership, CASL ability, payroll access grants,
export service and DATEV formatter. The queued delivery is processed by the worker's
`processExportJob`.

Mocked:

- the session;
- the object store and the queue transport;
- Tolgee, whose translator returns fallbacks;
- the billing guard and the notification senders, as in the #319/#320 suites;
- a pass-through wrapper around the #319 evidence reader, used only to commit the concurrent write at a chosen point.

Verified:

- **Complete export, workspace agreement.** Protected 239 stored minutes over a 240-minute interval are exported as 239. The input stores two lines with source revisions, and its digest recomputes. The DATEV file names both personnel numbers. The workspace credits 3.98 h and 1 h, the same minutes, with no blockers. An `UPDATE` of the stored input raises.
- **All-or-blocked before filters.** Approved work, pending work, open work and approved work with a pending correction are in scope. The export action returns the translated conflict, and no job or input row is created. The service names exactly `open_work`, `pending_work_approval` and `pending_work_correction` for those records. The workspace credits only the approved 4 h and lists the three blockers, with no dismissible `missing_clock_out` or `pending_time_correction` duplicates. With the control removed, the legacy export succeeds and silently drops the uncertain work, which is the behavior this slice closes. Another organization's active control does not change that.
- **Tenant-scoped widening.** A work record owned by another organization's employee widens uncertainty to the organization. A payroll clerk scoped to the worker sees one blocker for the worker, and the response contains neither the peer, the foreign employee nor the foreign record. The owner sees the blocker for all four employees. The clerk's export is refused.
- **Repair precedes readiness.** A pre-adoption missing link blocks the export while repair is not authorized, and no receipt is written. Once repair is authorized, a payroll clerk's export is still refused and writes no receipt. The administrator's export succeeds. One `repair_historical_gap` receipt names the requester and the payroll reason, the period links its record, and the input holds the record.
- **One snapshot under a concurrent write.** A write nulling the work's minutes commits after the work rows are read and before the evidence is read. The export collects the pre-write 240 minutes and succeeds. The next collection sees the write and blocks (`missing_stored_minutes`, `duration_missing`).
- **Failed queued delivery recovers from stored input.** An async export is queued (`process-payroll-export`). Its work is then changed: minutes are corrected and new work is approved. The first delivery fails at the object store and the job is `failed`. The retry completes with `work_period_count` 1. Both attempts upload byte-identical files built from the stored input (4.00 h), and the stored row is unchanged. A fresh collection would now produce a different digest. Deleting the job removes its input.

Mutation checks, each run against PostgreSQL and then reverted:

- Running the collection under `READ COMMITTED` failed the snapshot test.
- Formatting a fresh read instead of the stored input failed the recovery test, and the snapshot test with it.
- Skipping the repair step failed the repair test.

### Database-free

- `payroll-work-collection.test.ts` (17 tests) covers:
  - protected and boundary allocation, and conservation across adjacent windows;
  - Tokyo and Berlin windows;
  - open, pending, draft, rejected and pending-correction work;
  - reversed endpoints by their hull;
  - unallocatable minutes and valid zero minutes;
  - deleted periods;
  - diagnostic widening and disclosure;
  - departure timers;
  - the project filter after readiness;
  - out-of-scope records;
  - order-independent digests and digest sensitivity.
- `export-service.test.ts` covers:
  - collect-then-store in the job transaction;
  - refusal without a job;
  - the legacy path without the control;
  - stored-input formatting on processing and recovery, with the read-only absence check.
- `summary.test.ts` and `summary.cutover.test.ts` cover:
  - workspace minutes equal to the export's;
  - non-dismissible opaque blockers;
  - no organization-wide backfill under the control.

The full webapp unit run had 139 failures, all in the known Windows/CRLF and
source-scanner baseline. That run included the employee-name source sweep, which this
change had tripped until the collected identity field was renamed (`person`). The
approval write-boundary scanner passed 290/290 in a Linux `node:24` container. This
change adds no write to a protected approval table.

## Known limits

- Races between a repair and a concurrent writer are covered by the #320 suite at the shared coordination key. Through payroll, a stale plan leaves its gap and the final snapshot blocks; there is no separate payroll race test for repair.
- A refusal from the settings export action or the scheduled executor surfaces as the error's message, which carries counts only. Only the workspace action maps it to the translated conflict, and only that path is verified.

- The collection reads each scoped employee's whole history for the diagnostics, as #319 does. Repair, when authorized, reads it once more for its plan.
- Absences are not part of the collected input. They are read when the job is processed, under the read-only organization-wide absence check (#256 §9: other export prerequisites keep their own readiness). A recovered job therefore rereads absences, but never work.
- The API connectors' sync-record bookkeeping on retries is unchanged.
- A queued job created **before** activation has no stored input and keeps the legacy read when it is processed.
- The workspace UI was not rendered in a browser. Its data path is the real action verified above, and the new blocker cases are plain switch branches next to the existing ones.

## Remaining activation blockers

This slice closes on implementation (see the #264 decision of 2026-09-25). Activation
items move to #327/#329/#331:

- **Activation (#327):** activation requires an explicitly authorized control row per organization, and each organization's canonical absence reconciliation must be clean first, because the backfill no longer repairs it at read time. Payroll readiness scale must be measured per organization.
- **Pilot (#329):** a real export and the workspace must be verified for a pilot organization, including how often pending or open work blocks month-end exports, and whether operators can clear those blockers.
- **Rollback (#331):** deleting the control row restores the legacy reads. Stored inputs of jobs already created stay and are still used by their own recovery. They are removed with their job or organization.
