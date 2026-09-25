# All-writer adoption gaps and coordination (#327 / T62)

Implementation ticket: [#327](https://github.com/Umami-Creative-GmbH/z8/issues/327).
Parent: [#264](https://github.com/Umami-Creative-GmbH/z8/issues/264), inventory
[#265](audits/265-activation-dossier.md). Baseline: `dev` at `584514062`.

**Status: implemented and verified locally. Activation is still blocked.** This
slice closes the reachable source gaps and records what an activation still needs.
It certifies no organization. Deployed participation, old-binary populations and
historical provenance remain unknown until the E-records below are completed. As
decided on 2026-09-25, #327 closes on implementation. Its unresolved activation
items move to a new writer/drain activation tracker (see "Remaining activation
blockers").

Paths are relative to `apps/webapp/src/`.

## Decisions (2026-09-25)

- **Legacy direct writer:** in organizations whose `time_entry_append_control` is
  `active`, uncoordinated clock writes are refused. Organizations without an active
  control are unchanged.
- **W18 canonical creation:** retired, not adopted.
- **Verification scope:** gap-focused PostgreSQL races and failure injection through
  real adapters, not a full pairwise matrix.
- **Tracking:** #327 closes on implementation. Unresolved items move to a new
  tracker, as #328 did with #423.

## What changed

### Uncoordinated clock writers are fenced (W03, R01–R05, new W24)

Two callers used the clocking core (`lib/time-tracking/clocking-core.ts`) outside a
work-transaction coordinator:

- legacy `POST /api/time-entries`, which serves identity-less clients, legacy
  desktop clock-in/out and the two-request break, extension cohorts X1–X3 and
  action-ID replays;
- the departure clock-out, `lib/employee-lifecycle/clock-out.ts`, which is still
  behind the offboarding release gate.

In an adopted organization they wrote with legacy head selection, and the next
admitted append was held (`unexpected_history_change`). Both callers now:

1. take the shared organization adoption gate before the employee key. A
   caller-owned transaction, such as the departure's, may already hold its own
   locks;
2. read the append admission under that gate;
3. refuse a fresh write with `ClockingAppendAdoptedError` (`append_adopted`) before
   writing anything. An action ID that already committed still replays.

Each caller answers the refusal in its own way:

- **The route** answers `409 {code: "append_adopted"}`. Extension readers retain the
  row on 409 (the #266 fence only rewrites their 400). Pre-#267 browser queues get
  401 from the fence. Current browser and desktop builds retain every non-success.
- **The departure** records a `clock_repair` review with reason `append_adopted` and
  leaves the period open for the canonical correction flow. Offboarding shows its
  own label for this reason.

There is no activation code: the activation step is an operator transaction that
takes the exclusive adoption gate and then inserts the control row. The route
suite runs exactly that SQL. Such a transaction drains in-flight legacy writes,
and a legacy write that arrives while it commits is refused.

**Known limit: lock order in the departure path.** The departure runs inside its
lifecycle transaction, which already holds the employee advisory lock and the
organization row (`lockLifecycleScope`). The shared adoption gate is therefore
taken after them, which inverts the #264 order. That is safe while activation
takes only the exclusive gate and the control row. Activation tooling must not
take employee or organization locks while it holds the exclusive gate, or it can
deadlock with a departure. Adopting the departure into the completed-work
operation (W24 below) removes this.

### Symmetric occupancy for adopted live starts (W01)

The web `clockIn` action accepted a start inside committed work, as long as no
period was active. Bots reach it through `clockInAs`, and the mobile route calls it
too. Only the v2 `start-live-work` operation enforced the half-open rule. Adopted
starts now refuse over undeleted work that ends after the start, through
`ClockingStore.hasCompletedWorkEndingAfter`. The web action reports
`rejected/occupancy_conflict`, and bots show the server message. Legacy
organizations keep their rule. `LiveWorkOccupiedError` moved into the core and is
still re-exported from `start-live-work.ts`.

### Retired write surfaces

- **W18.** The `createTimeRecord` server action, `TimeRecordService.create` and
  their write-boundary registration are deleted. They inserted canonical work with
  a caller-supplied duration and approval state, and had no production caller.
  `listTimeRecords` (read-only) stays.
- **Raw entry writers as server actions.** `app/[locale]/(app)/time-tracking/actions.ts`
  exported an unauthenticated `createTimeEntry(params, transaction?)` from a
  `"use server"` module, with no caller; it is removed. The helper module
  `actions/entry-helpers.ts`, which only server code imports, was also `"use server"`,
  so its raw writers were server actions too. It is now `server-only`. Next only
  exposes actions that a client references, but a source-level all-writer claim
  cannot rest on that.

### CI registration

`.github/workflows/tests.yml` now lists every PostgreSQL suite of the runner:

- #299's `escalation/legacy-transfer`;
- the 21 employee-lifecycle, billing seat, legacy absence and expense submission
  suites that previously ran only locally;
- the new legacy-writer suite.

The Redis scheduler suite needs Redis and stays out of both lists.

## Inventory reconciliation (W-register)

Each row states the adopted behavior at this revision. "Participates" means the
writer runs inside a coordinator with the adoption gate, the employee key and
append admission, and commits a receipt where its operation defines one.

| Row | Adopted behavior at this revision | Evidence |
| --- | --- | --- |
| W01 live start (web action, bots, mobile route) | Participates in append admission (#273). Symmetric occupancy since #327. No start receipt: the closing operation's receipt covers the period, and v2 starts write `start_live_work` | web-clock-in suite, manual arrival-order races |
| W02 web close | Participates (`close_active_work`, #274) | web-clock-out-operation suite, failure matrix |
| W03 direct HTTP | v2 commands participate (#275). The legacy route is fenced (#327) | commands suite, legacy-writer suite |
| W04 on-behalf close | Participates (`manager_on_behalf`, #276) | on-behalf route suite |
| W05 mobile server route | Calls the shared web actions, so it participates like W01/W02. The app is retired (#283) | mobile route suite |
| W06 four bots | Participate through `clockInAs`/`clockOutAs` (#277) | bot clock-commands suite |
| W07 manual | v2 commands participate (#308). Legacy input is replay-only in adopted organizations | manual suite |
| W08 active break | Participates (`close_resume_work`, #281/#304) | active-break suite |
| W09 split | Both exports delegate to `splitOwnWorkPeriod`. Adopted splits go through `split-completed-work` (#304) | work-period-split suite, repair/proposal races |
| W10 automatic breaks | Durable intent plus operation (#305) | automatic-break suite, failure matrix |
| W11 policy-terminal break | Participates (#303) | policy-break-split suite |
| W12 direct correction/deletion | Amendment operation (#286). The legacy admin edit runs only for unadopted organizations | amendment suite |
| W13 correction lifecycle | Participates, with retention instead of deletion (#301) | correction-lifecycle suite, import races |
| W14 metadata | Project changes use the #286 amendment. Notes are neither hashed nor part of the interval graph | source |
| W15 reviewed imports | Participate (#284) | import suite, import↔correction races |
| W16 direct Clockodo/Clockin | Orchestrators deleted (#318). The actions refuse | Source only: `lib/clockodo`, `lib/clockin` hold only clients and types. No test in this slice |
| W17 runtime demo | Participates (#285); cleanup since #306/#318 | demo-work suite |
| W18 canonical creation | **Retired (#327)** | actions and service tests pin the absence |
| W19 read-time repair | Not run under `payroll_work_collection_control` (#322). Legacy payroll reads still run it | payroll collection suite |
| W20 payroll consumers | Scoped collection under the control (#322) | payroll collection suite |
| W21 verifier/audit | Graph-aware assurance (#324) | append-assurance suite |
| W22 absence neighbors | Not work-graph writers | — |
| W23 package verification | Consumer only | — |
| **W24 departure clock-out** (new) | Uncoordinated, **fenced (#327)**: adopted organizations get a timer repair instead of a legacy closure | departure suite |

Only these writers of `time_entry`/`work_period` choose between legacy and adopted
paths: the legacy admin edit, `addLegacyBreak`, `splitLegacyWorkPeriod`, the legacy
automatic break, `recordLegacyDemoWorkDay` and the legacy manual path. Each is
selected only when the coordinator's admission is `legacy`. The candidate "no other
reachable writer" rests on source inspection at this revision. It is not a
deployed-binary census (E01).

## Runtime evidence

All of the following ran against the disposable PostgreSQL 16 database, created and
migrated with the runner's migration verification, through the real handlers and
actions. Only session, headers, billing provisioning, notification delivery and
Next cache are replaced.

### Acquisition order and races

| Scenario | Arrival orders | Suite |
| --- | --- | --- |
| Legacy direct write vs activation | Legacy first: activation waits, the write commits. Activation first: the write is refused. Other organizations stay independent | `app/api/time-entries/route.integration.test.ts` |
| Manual v2 vs live clock-in, empty history | Live first: manual refused (`occupancy_conflict`). Manual first: live refused. Adjacent end admitted | `clocking.manual-command…` "manual and live clock-in arrival order (#327)" |
| Reviewed import vs correction submission | Correction first: import commits, then approval refused (`work_interval_occupied`). Import first: submission refused. Import over a corrected interval held | `correction-lifecycle…` "reviewed import and correction arrival order (#327)" |
| Gap repair vs real split | Split first: repair `stale`, no receipt. Repair first: `applied`, then the split proceeds | `historical-gap-repair…` |
| Proposal application vs real split | Split first: `stale`, no receipt. Application first: `applied`, then the split proceeds | `historical-work-proposals…` |

In each race, the first writer parks at its first insert on a test-owned
advisory lock, after it has taken the employee key. The test then waits until a
second ungranted advisory lock appears before it releases the first writer. That
the second writer waits on the employee key specifically follows from the
coordinators' acquisition order; the helpers do not inspect the lock key.

Configuration and cleanup races, and the changed-scope restart, are not raced
again here. They are covered by the #311–#318 suites (configuration guards in
both orders, organization and user scope restart) and #306 (cleanup), which pass
in the full run below.

### Failure injection

In the failure matrix (`clocking.manual-command…` "failure at every protected write
(#327)"), live clock-in, live clock-out and v2 manual each fail at every protected
write. That covers `time_entry`, `work_period`, `time_record`, `time_record_work`,
`completed_work_operation`, `time_entry_append_position`, `employee_work_balance`
and `work_break_adjustment_intent` (18 cases). In every case the whole operation
rolls back, another employee commits while the failure is armed, and the same
command then commits. The earlier slices' suites cover failure injection for their
own owners: imports, corrections, splits, breaks, demo, repair, approvals and
delivery. **Not in this matrix:** approval_request and approval evidence steps of
a clock-out that needs approval. The #274 and #302 suites cover them for web
clock-out; the other callers remain in "Verification not yet done".

### Continuity and provenance

- **Continuity.** With only participating writers (web clock-in/out and v2 manual,
  with the legacy route refused), the real verify route reports continuity
  `established` from an `empty_history` admission, with all four entries after the
  anchor (`append-assurance…`).
- **Provenance.** A defect in live work closed by the web writer classifies as a
  receipt-backed `fresh_backdated` incident, not as `ambiguous`
  (`historical-work-diagnostics…`).

### Suites changed by the fence or occupancy

- `commands/route…`: the committed 7-day recovery now commits before adoption.
- `clocking.web-clock-in…`: the stand-in for a non-participating writer is now
  "refused by the fence, then an undrained old binary simulated in SQL". Stand-in
  closed periods end before the fixed start instant.

## E-records (from the #265 dossier)

E01–E09 remain **unfilled, and therefore unknown**. None of them was collected in
this session:

- no deployed image digests, process owners or queued-job inventory (E01, E03);
- no client version populations (E02, E03);
- no scoped historical or in-flight provenance inventory (E04–E06);
- no repair authorization (E07);
- no pilot or rollback drill (E09).

E08 is partly advanced by the suites above; they record local evidence only. An
unfilled record is never an implicit pass. Activation of any organization still
requires them.

## Remaining activation blockers

This consolidates the items posted on #327 by #266, #273, #275–#286, #291–#294,
#296, #300–#306, #308, #310–#326. Items this slice resolved are marked as resolved.
The open items move to the new tracker.

### Resolved in source by #327

- **Gate the legacy direct writer** (#275, #279 browser path, #280 legacy desktop
  clock-in/out, #281 two-request break, #282 extension cohorts, #277/#285 "other
  writers" lists). Fenced server-side in adopted organizations. Draining old
  *server* binaries is still required.
- **Retained direct Clockodo/Clockin orchestrators** (#284, #315, #316). Already
  deleted by #318; this slice checked that they are gone.
- **Canonical-creation candidate** (#285: "confirm when the retained canonical
  creation action is dispositioned"). W18 is retired, and no production creator of
  canonical-only work without a period remains.
- **Races left unverified by earlier slices.** These now run on PostgreSQL:
  manual/live in both orders (#308), import versus correction (#284), and
  repair/proposals against a real writer (#320/#323; split only).
- **Re-runs after writer adoption.** Assurance (#324) and diagnostics (#319) were
  re-run with participating writers.
- **Mobile route participation** (#278/#283). It calls the shared web actions, so
  it now also gets symmetric occupancy.
- **CI registration** (#326), and the 21 other runner-only suites.

### Deployment and migrations

- Apply the migrations through the authorized deployment, in order: `0086`,
  `0089`–`0106`. These include `0090`/`0091`/`0094` (delivery provider CHECK
  unions), `0093` (legacy expense presentation), `0096` (replacement delivery),
  `0098` (correction lifecycle), `0102`/`0105` (repair and proposals), `0104`
  (payroll collection) and `0106` (automatic break adjustment). All of them have
  only run on disposable PostgreSQL 16. Later CHECK rewrites must keep every
  receipt kind, writer and append operation.
- **Organization cleanup before deploying #425** (#306). List the organizations
  with `deleted_at < now() - interval '5 days'`: after deploy, the cleanup cron
  deletes them permanently.
- **Configuration clean-up** (#318). Once #436 is everywhere, remove
  `CLOCKODO_IMPORT_QUERY_CHUNK_SIZE` and `CLOCKODO_IMPORT_CONCURRENCY`.

### Old binaries, workers and tools

Every app, worker and bot instance must run a release that contains all of the
following before the matching control rows exist. Old binaries must be drained, not
just outnumbered.

- **This fence (#327).** A pre-#327 server still accepts legacy clock writes in an
  adopted organization.
- **Clocking writers:** #273–#286, #301, #303–#305, #308.
- **Delivery owners:** #291/#294/#293/#292/#300; the matching control rows are
  `approval_delivery_control` and escalation ownership.
- **Expenses:** #296, before `travel_expense` capture, presentation or delivery.
- **Configuration writers:** #311–#318.
- **Time presentation:** #325/#326, before time-kind presentation, delivery or
  escalation ownership.

Separately:

- **Queued jobs.** Drain `import-review-commit` jobs that old workers would process
  with the old lock key (#284).
- **Old desktop binaries** (#280/#281). They read and delete the legacy `queue`
  table, and their deletion behavior on the new 409 is unknown. #280 binaries do not
  know the `break` kind. Inventory the deployed versions and establish update
  control.
- **Installed extension and mobile copies** (#282/#283). They stay reachable. Keep
  the #266 fence while they drain.
- **Operator tools** (#318, R15). `db/seed` must not target adopted organizations.
  `scripts/obliterate-job-queue.ts` can erase recovery evidence.

### Writer gaps and decisions still open

- **Departure clock-out adoption (#327, W24).** In adopted organizations it is now
  refused into a timer repair. Adopt it into the completed-work operation, which
  needs a writer and a receipt, before offboarding is released for adopted
  organizations.
- **Bot retry identity** (#277). A lost bot reply cannot be replayed. Using provider
  invocation IDs needs its own decision; Slack has no usable ID.
- **Identity-less legacy web clock-in** (#279). It participates, but has no stable
  identity for strict admission.
- **Legacy committed-retry ordering on the legacy route** (#275). Eligibility checks
  run before replay. Accept this, or move them.
- **Billing read inside other work transactions** (#317). Web clock-in/out,
  on-behalf, imports, demo, bots and direct HTTP check billing before their
  transaction.
- **Authorization inside the transaction** for on-behalf and web closures (#276,
  #315). Eligibility for live clocking, on-behalf, HTTP and legacy manual has no
  shared protection yet.
- **SCIM multi-user guard order** (#429). Sorted acquisition is needed before manual
  adoption in SCIM-provisioned organizations.
- **Manager sets are not atomic** (#313).
- **Policy ambiguity** (#316). It is covered only by construction.
- **Lookup fencing after `not_committed`** (#310). Accept this, or add a fence.
- **"Delete non-admin data" references** (#306). Deletion still fails on several
  non-lifecycle references.
- **Non-transactional cleanups** (#302). `clearOrganizationTimeData` and
  `deleteNonAdminEmployeesData` can fail part-way through.
- **Legacy adjustments refused by review are not durable** (#305). Accept this until
  adoption, or change it.
- **Replacement writers** (#305). Confirm that no writer replaces periods at
  adoption.
- **Canonical-native work has no receipt** (#319). It can only classify as
  `pre_adoption`/`ambiguous`.
- **Durable activation point, writer version and in-flight inventory** (#319 §7).
  Needed before #320 relies on `pre_adoption`.
- **Raw decision fingerprints** (#325). Evidence written before #433 keeps them.
  Decide whether to redact them.
- **In-flight expense classification** (#296) and the #295 drafts gap.
- **Pending corrections inventory** (#301). Review stuck legacy requests.

### Verification not yet done

- **Real approval-decision and break-enforcement writers** racing repair and
  proposals (#320/#323). Only the split is raced through real code.
- **Real callers of manual/policy clock-out evidence** (#302): direct HTTP,
  on-behalf, bots, and decision races between two approvers or against an admin
  edit.
- **Unraced #313/#314/#318 paths**: SCIM `/Users`/`/Groups`, the SSO callback
  endpoints, HTTP `remove-member`, admin `unban`/`update`/`remove-user`, and the
  demo batch restart limit.
- **#306 late retries after a purge**: canonical correction workflows,
  `clearOrganizationTimeData` with non-time lifecycles, and writers racing the
  tenant delete.
- **Not exercised by #305**: departure `clock_postprocess`, bot and desktop
  closures, and deferrals.
- **Surcharge event-time semantics** for manual entries that need approval (#308).
- **Linux/CI write-boundary scanner** for every release that adds a writer. It ran
  for this slice (290/290, see the verification record).
- **Unauthenticated `"use server"` follow-up exports.** `actions/compliance.ts` and
  `time-tracking/actions.ts` still export break, compliance and surcharge follow-ups
  without authorization. Only server code calls them. Tracked as a separate
  hardening task.
- **Departure correction flow.** No test shows that the canonical correction flow
  closes a departed employee's open period after an `append_adopted` repair.

### Operations and monitoring

- **Cron jobs.** Confirm that `cron:approval-delivery` and `cron:break-enforcement`
  run every minute in production.
- **Alerting.** Alert on `work_balance_rebuild_intent.attempts`/`last_error` (#311,
  #312), and on `work_break_adjustment_intent` attempts and long deferrals (#305).
- **Lock waits.** Observe lock waits and aborts: organization-wide guards (#313,
  #316, #318), the connection each coordinated `/api/auth` request holds (#314), and
  SCIM deadlocks until #429.
- **Credentials.** `MICROSOFT_APP_ID`/`MICROSOFT_APP_PASSWORD` must be set on every
  Teams webhook/worker instance (#293).
- **Escalation batch sizing** per organization (#326).

### Authorizations to record

These controls have no application setter:

- `historical_work_repair_control` (#320/#323);
- `payroll_work_collection_control` (#322);
- every `time_entry_append_control` activation.

Record who activated each control, for which organization, and on which evidence.
Do not apply continuations before the writer drain for that organization.

## Verification record

Runs on this branch (Windows, disposable PostgreSQL 16 created and migrated with
the runner's migration verification):

- **Unit tests.** New fence, occupancy, route-mapping and retirement tests; the
  touched unit suites pass. The only failures are the 5 date-dependent
  `clockOut` tests in `actions/clocking.test.ts`, which also fail on clean `dev`.
- **Typecheck.** `pnpm run typecheck` passes.
- **PostgreSQL, full runner list.** 75 files passed and 1 skipped (Redis); 1335
  tests passed, 6 skipped.
- **Write-boundary scanner (Linux, `node:24` container, run as `node`).**
  `approval-write-boundary.test.ts` passes 290/290.
