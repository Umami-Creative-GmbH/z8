# Web clock-out outer transaction prefactor (#272 / T08)

## Delivery and activation status

This slice connects the existing web `clockOut` action to a transaction owner in
`lib/time-tracking/web-clock-out-transaction.ts`. Both its early committed-result
lookup and fresh closure use this owner. The physical transaction is borrowed by
the existing approval repository, which retains its reservation/CAS completion
checks. Clocking receives a branded, scoped, transaction-lifetime-bound context;
its coordinated adapter neither opens a transaction nor first acquires the
employee lock. The legacy transaction adapter remains for other callers.

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
4. Shared `JSON.stringify(["work-user-configuration-access", userId])`.
5. Exclusive **existing** employee key: `hashtextextended(employeeId, 0)`.
6. Sorted, deduplicated auxiliary/source identities, then rows below.
7. Existing workflow reservation/CAS/compatibility/outbox work.

All advisory locks are transaction-scoped with hash seed zero. This self-service
path has one organization, one acting/owning user, and one work-owning employee.
Manager/policy-directory reads remain organization-configuration dependencies;
they do not mutate another employee's work. Implicit foreign-key identity locks
from canonical/workflow inserts remain PostgreSQL's responsibility and must be
included in the outstanding real concurrency checks.

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
6. `work_policy_assignment`
7. `work_policy`
8. `work_policy_regulation`
9. `work_policy_break_rule`
10. `surcharge_model_assignment`
11. `surcharge_model`
12. `surcharge_rule`
13. `work_period`
14. `time_entry`
15. `time_record`
16. `time_record_work`
17. `time_record_allocation`

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
row's existing surcharge `FOR UPDATE` behavior is retained, so genuine shared
configuration can still serialize otherwise independent employees.

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
and the real ordinary-submission failure boundary. These use controlled database
and workflow adapters; they are **not PostgreSQL lock or rollback proof**.

Local check results will be recorded after final verification and two-axis
review.

Blocked obligations (ticket remains open; no activation):

- No Z8 PostgreSQL instance is available. The unrelated project's database must
  not be used. Execute real SQL/row-lock/foreign-key/cutover races and failure
  injection, both arrival orders, empty state, scope changes during locking,
  distinct employees, and approval auto-completion/terminal splitting once a
  specifically authorized Z8 test database is available.
- Prove every competing work/configuration/access/billing writer participates
  in the actual original transaction or is effectively disabled/drained.
  Shared guards do not protect against legacy writers that ignore them.
- Install durable admission/provenance/evidence/recovery and linked cleanup
  through the dependent slices before production capture or strict admission.
- Resolve deployment/history/in-flight evidence, old worker and client control,
  separately authorized diagnostics/repair, and the limited organization pilot
  required by #264/#259. This commit grants none of those permissions.
