# Web clock-out outer transaction prefactor (#272 / T08)

## Delivery and activation status

This slice connects the existing web `clockOut` action to a transaction owner in
`lib/time-tracking/web-clock-out-transaction.ts`. Both its early committed-result
lookup and fresh closure use this owner. The physical transaction is borrowed by
the existing approval repository, which retains its reservation/CAS completion
checks. Clocking receives a branded, scoped, transaction-lifetime-bound context;
its coordinated adapter neither opens a transaction nor first acquires the
employee lock. The legacy transaction adapter remains for other callers.

> Since #274 the coordinator reads the append control and adopted organizations
> close through the completed-work operation; see
> [web-clock-out-operation-274.md](web-clock-out-operation-274.md). The text
> below describes the #272 prefactor as delivered.

Admission is deliberately fixed to `legacy`. There is no activation setter,
exclusive adoption upgrade, new command version, receipt owner, dispatcher, or
production evidence capture. The shared adoption lock reserves the future
coordination point; it is **not** a durable paused/adopting state machine or an
all-writer fence. Durable adoption/append support belongs to the following
slices. Existing approval receipts, outbox, replay matching, and linked cleanup
retain ownership. No new persisted lifecycle requires a new cleanup path here.

Implementation references: [#272](https://github.com/Umami-Creative-GmbH/z8/issues/272),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of #256, #258, and #259. Completing implementation does not satisfy
the ticket's blocked PostgreSQL evidence obligation or authorize activation.

## Concrete acquisition protocol

Read-only routing discovers scoped row identities and employee/source bindings.
One attempt then acquires, in order:

1. Shared `JSON.stringify(["completed-work-adoption", organizationId])`.
2. The existing `policy_clock_out` approval write gate, including its rollout-row
   bootstrap/read. Nested approval collaborators receive its fixed result and
   cannot acquire a new approval scope late.
3. Shared `JSON.stringify(["work-organization-configuration", organizationId])`.
4. Sorted shared `JSON.stringify(["work-user-configuration-access", userId])`
   for the requester and routed approval participants with user accounts.
5. Sorted exclusive **existing** employee keys: `hashtextextended(employeeId, 0)`.
6. Sorted, deduplicated auxiliary/source identities, then rows below.
7. Existing workflow reservation/CAS/compatibility/outbox work.

All advisory locks are transaction-scoped with hash seed zero. This self-service
path has one organization and one work-owning employee. Fresh approval routing
also inventories possible participants using the existing legacy and canonical
approver resolvers (default managers and stages of active policies). Their user
and employee identities participate in sorted protection before any work write.
This conservatively covers candidate stages before authoritative policy matching;
it does not decide an approval or grant permission to modify participants' work.
Committed replay does not perform fresh manager/policy routing.

Both actual legacy creation and canonical stage activation check resolved
participants and policy/stage identities against the protected context before
creating FK references. A late new participant or policy/stage aborts and
restarts the whole transaction, including when the
existing Effect/approval error boundaries wrap the internal exception.

Approval rollout bootstrap may acquire organization `KEY SHARE` through its FK
at step 2. The later organization read lock, including the surcharge resolver,
uses `FOR NO KEY UPDATE`, which is compatible with that FK lock; it must not be
strengthened to `FOR UPDATE`. This still blocks configuration updates/deletion
without the bootstrap shared-to-exclusive conflict. Project/category/cost-center
FK targets and approval participants are routed before workflow inserts. Real
PostgreSQL verification of these interactions remains mandatory.

Auxiliary/source identities are the existing terminal-break/balance ownership
key `JSON.stringify([organizationId, employeeId])`, and, for each routed source
period, the existing ordinary-source keys
`JSON.stringify([organizationId, kind, "time_entry", periodId])` for
`manual_time_submission` and `policy_clock_out`. They protect different
identities from the employee lock. Nested ordinary-source and terminal-break
code may reacquire these already-held keys; it does not first acquire them
after the closure. Existing command receipts/source-bootstrap identities and
new workflow rows remain with the workflow repository.

### Row order

`web-clock-out-resources.ts` defines one ordered row inventory, used for both
discovery and scoped locking. IDs within each table are ordered ascending:

1. `organization`
2. `user`
3. `member`
4. `user_settings`
5. `employee`
6. `approval_policy`
7. `approval_policy_stage`
8. `work_policy_assignment`
9. `work_policy`
10. `work_policy_regulation`
11. `work_policy_break_rule`
12. `surcharge_model_assignment`
13. `surcharge_model`
14. `surcharge_rule`
15. `project`
16. `work_category`
17. `cost_center`
18. `work_period`
19. `time_entry`
20. `time_record`
21. `time_record_work`
22. `time_record_allocation`

Rows without an organization column are reached through organization-scoped
parents or the authenticated owning user's scoped employee. Approved membership
and the active self-owned employee are required again in the transaction.
Missing settings/assignments remain covered by the advisory configuration
guards once their mutation owners participate; locking existing rows alone
cannot protect absence.

The resource set includes both requested-period and committed-action sources,
their linked endpoints/canonical children, and the terminal break's latest two
entry candidates. Fresh closure also covers a conservative UTC ±48-hour
start-time window around the supplied event instant for terminal break gap
reads; the existing collaborator still determines the actual local day and
policy. All applicable assignment candidates and their policy/model children
are acquired before the existing event-time resolvers run. The organization
row's surcharge protection uses `FOR NO KEY UPDATE` consistently, so genuine
shared configuration can still serialize otherwise independent employees.

Keep this conservative inventory aligned with the named owners:
`policy-clock-out-break-snapshot.ts` (assignment/policy/regulation/rules),
`policy-clock-out-surcharge-snapshot.ts` (organization/assignment/model/rules),
`policy-clock-out-terminal-break.ts` (gap periods, endpoints/head, canonical graph),
and approval `work-period-resource-routing.ts` (legacy/canonical participants).

Bindings and the complete resource set are checked after advisory protection
and again after acquiring **only previously routed** row IDs. Change throws out
the transaction; up to three complete attempts are allowed. New resources are
never appended to an already-acquired row order. Exhaustion propagates through
the action's existing failure result. No post-commit work runs for these failed
attempts. Deleted/revoked authorization fails closed.

## Compatibility boundary

- Session/current-organization selection, external billing provisioning and
  fresh holiday/project/category/policy preflights keep their current behavior.
- Committed replay still runs before fresh checks, through the existing exact
  source/canonical/approval evidence matchers. It does not create fresh work,
  rerun approval side effects, repair historical evidence, or recreate intents.
- Clock action IDs, hash serialization, timezone capture, approval outcomes,
  and post-commit notification/maintenance ownership are retained.
- This is the transaction prefactor, not #274's completed-work invariant
  implementation. The existing caller-calculated canonical duration and
  preflight snapshots, append-head interpretation, and best-effort follow-ups
  are still legacy behavior. Fresh authoritative preparation/non-provisioning
  billing and participating configuration writers remain later slices.
- Ordinary post-commit break enforcement stays outside the closure transaction.
  Approval-terminal splitting stays in the approval transaction. Its employee,
  ownership, source, endpoint/head, gap-period and existing canonical locks are
  included in routing; newly inserted rows are already owned by this transaction.

## Verification evidence and outstanding gates

The user explicitly authorized typechecking/tests and confirmed the real web
clock-out action as the test seam. Database-free action tests exercise the new
coordinator, changed-scope rollback/retry, existing replay/collision/approval
outcomes, actual clocking calculation/capture, transaction identity/lifetime,
and ordinary submission. Successful legacy approval closure additionally uses
the real production approval runtime, repository, write gate, submission and
chain service through database adapters, including manager and matched-policy
changes discovered after row acquisition. Those database-free runs are **not PostgreSQL
lock or rollback proof**; the PostgreSQL evidence below was added on 2026-09-24.

### Local results (2026-09-15)

- `pnpm --filter webapp typecheck`: passed, including route type generation,
  application types, workflow contracts, and smoke types. Repeated during work.
- Final focused Vitest run: **304 passed / 6 files**: action clocking, action
  delegation, clocking service, surcharge snapshot, approval chain service, and
  ordinary work-period submission.
- `pnpm test --env-mode=loose`: Docker tests **29 passed**. Turbo then failed to
  spawn the webapp/desktop commands with `Exec format error (os error 8)`.
- Direct fallback `pnpm --filter webapp test`: **11,141 passed, 289 skipped,
  33 failed** (990 passed files, 14 failed, 6 skipped). One failure was the old
  source-delegation assertion naming the former transaction owner; that assertion
  was updated and passed in the final focused run. The other **32 failures** are
  untouched localization/catalog assertions and the environment-usage assertion
  for `lib/cron/legacy-escalation-schedulers.ts`. The full suite was not rerun.
- `pnpm --filter desktop test`: Rust **12 passed / 1 ignored**; JavaScript
  **2 passed / 1 failed**, the untouched OrganizationSelector backdrop assertion.
- The failing catalogs, escalation scheduler, desktop component and desktop
  assertion have no diff from the ticket-start commit. Their repairs are outside
  this transaction slice.
- PostgreSQL integration opt-in was empty, and inherited database settings were
  pointed at an unavailable local port for the suite. No unrelated PostgreSQL
  database was used. Desktop tests use their own temporary SQLite fixtures.

### PostgreSQL runtime evidence (2026-09-24)

Suite: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.web-clock-out.integration.test.ts`,
registered in `scripts/run-approval-workflow-repository-integration.sh` and the CI
`integration-tests` job. It runs only against the gated, label-owned disposable
PostgreSQL 16 database (sentinel plus `approval_workflow_repository_test_*` name check),
never the dev or any unrelated database. Without that configuration it skips.

The real `clockIn` and `clockOut` server actions run end to end: session/membership
lookup, committed-replay lookup, preflight, the coordinator, clocking service, snapshot
resolvers, canonical record writer, approval runtime/repository/write gate/submission
and post-commit maintenance. Only these boundaries are replaced: the Better Auth
session, request headers, external billing provisioning, notification delivery and Next
cache revalidation. Lock order is observed from a second session through `pg_locks`,
`pg_blocking_pids` and `FOR ... NOWAIT` probes. Restarts are counted from the shared
adoption-lock statement that starts each attempt.

Verified (20 tests; 3 consecutive local runs green, plus the full runner below):

- Legacy admission closes the period with an approved canonical record and no approval
  rows. Replaying the same submission returns the same clock-out entry in one
  transaction and writes nothing. Its only insert is the idempotent rollout bootstrap.
- Order while the fresh closure waits for the employee key: adoption, `policy_clock_out`
  write gate, organization configuration and requester access are held shared. The
  employee key is the pending exclusive request. The ownership key and the
  organization/employee rows are not yet held.
- Order while it waits on the routed `work_period` row: the employee key, ownership key
  and both ordinary-source keys are held exclusive. The organization row is held
  `FOR NO KEY UPDATE` and the employee row is locked. The later-ranked `time_entry` row
  is still free.
- Competing clock-outs for one employee, in both arrival orders: one wins, the other gets
  "You are not currently clocked in", with one clock-out, one canonical record and an
  unforked hash chain. A concurrent duplicate submission returns one committed result.
- A distinct employee is not serialized behind a held employee key once the rollout row
  exists.
- A restart happens, not a late earlier-ranked acquisition, when any of these change
  while the fresh closure waits: a new work-policy assignment (configuration), a
  routed-row binding changed by a raw row writer holding `FOR UPDATE` (detected after
  row acquisition), a new primary manager (participant, legacy and canonical), or a
  newly active approval policy/stage (canonical). The retried attempt locks the new
  rows, and in both modes the approval goes to the newly discovered manager.
- Three changed-scope attempts exhaust the retries. The action returns the generic
  failure with the database unchanged.
- Membership revoked while waiting fails closed with no writes.
- With approval forced and no manager, the error is returned and the closed period,
  entry and canonical record roll back.
- A pending approval in legacy and canonical modes replays without duplicate rows,
  notifications or outbox entries. Legacy notifies after commit; canonical writes the
  pending stage assignment and outbox rows instead.
- Requester auto-completion with a 360/30 break rule, in legacy and canonical modes,
  splits the terminal period inside the same transaction. It leaves at least 30 break
  minutes, ends at the requested instant, marks all periods approved and keeps an
  unforked hash chain.

Full runner (`bash apps/webapp/scripts/run-approval-workflow-repository-integration.sh`,
fresh container, full migration chain): **8 files / 304 tests passed**, including all 20
tests of this suite. The container's ownership label was verified and the container
removed.

Runtime findings:

1. **First rollout bootstrap serializes same-organization writers.** The write gate's
   `insert into approval_workflow_rollout ... on conflict do nothing` makes any other
   same-organization clock-out (including other employees) wait while the first
   transaction's inserted row is uncommitted. It lasts only until that transaction ends
   and only happens before the organization's first `policy_clock_out` write. Among
   coordinated writers it cannot deadlock, because the bootstrap happens at step 2,
   before any employee key. A writer that holds an employee key or later-ranked rows and
   then first-bootstraps this rollout row would deadlock with it; PostgreSQL would abort
   one side. Pre-create rollout rows before any activation or pilot. The suite pins the
   current behavior.
2. **The approval branch was removed (#361).** Live clock-outs never route
   approval. The coordinator no longer routes approval policies, stages or
   participants and fails closed if a live clock-out would activate one; it keeps
   the policy clock-out write gate for replays of committed historical submissions.
3. Pre-existing and unrelated: pg reports a deprecation for concurrent relational
   queries on one transaction client (drizzle `query` builder). Not caused by this
   slice.

### Standards review

No confirmed documented-standard violations. One maintenance judgement remains:
the concrete row inventory must stay aligned with its named snapshot/terminal
collaborators. The owner pointers above make that obligation explicit; participant
routing delegates the existing reviewer resolvers rather than redefining them.
No UI components were changed, so UI accessibility/composition rules do not add
an interface change to review here.

### Spec review

Four source/interface findings were addressed during review: incompatible
organization bootstrap/row locking; missing approval participant FK scope;
missing successful real-runtime composition coverage; and missing matched-policy
and stage FK scope. Final focused re-review reported no remaining demonstrable
source correctness blocker. This does not satisfy the runtime evidence gates.

Blocked obligations (ticket remains open; no activation):

- PostgreSQL coverage not yet exercised: the `shadow`, `ready` and `complete` lifecycle
  modes; rollout cutover racing a clock-out; foreign-key failure injection; and
  same-organization distinct employees contending on the `FOR NO KEY UPDATE`
  organization row during the row phase. That contention is documented and expected.
- Pre-create `policy_clock_out` rollout rows before any activation, so the first-bootstrap
  serialization above cannot meet a writer that holds later-ranked resources.
- Prove every competing work/configuration/access/billing writer participates
  in the actual original transaction or is effectively disabled/drained.
  Shared guards do not protect against legacy writers that ignore them.
- Install durable admission/provenance/evidence/recovery and linked cleanup
  through the dependent slices before production capture or strict admission.
- Resolve deployment/history/in-flight evidence, old worker and client control,
  separately authorized diagnostics/repair, and the limited organization pilot
  required by #264/#259. This commit grants none of those permissions.
