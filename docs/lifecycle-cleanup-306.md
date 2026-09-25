# Privileged and tenant cleanup across adopted lifecycles (#306 / T42)

## Delivery and activation status

This slice reconciles the three cleanup owners with every adopted evidence,
binding, receipt, intent and recovery relationship. The owners are privileged
approval deletion, whole-organization cleanup and the selective demo paths.
Each earlier evidence ticket already brought its own cleanup. This slice fixes
what only shows once all of those lifecycles exist in one organization.

- **Whole-organization cleanup did not work.** `permanentlyDeleteOrganization`
  deleted `time_entry` before `work_period`, whose clock-in and clock-out
  references do not cascade. It also deleted employees explicitly while approval
  workflows, evidence, delivery rows and attention still referenced them. Any
  soft-deleted organization with recorded work therefore failed and rolled back
  on every run. This was the known ordering gap handed to #306 in
  [Approval evidence](refs/approval-evidence.md).
- **Privileged deletion left recovery state behind.** A purged lifecycle's
  escalation attention stayed open. It pointed at a workflow or request that no
  longer existed.
- **A late correction retry recreated a purged lifecycle.** The retained
  correction entries were reused under a newly routed approval. Legacy
  organizations did this through the web action, and adopted and legacy
  organizations through the demo generator.
- **"Delete non-admin data" failed on realistic data.** The approval lifecycles
  (of every kind except time, which #302 covered) and the audit rows of the
  deleted employees blocked the employee delete.

Nothing here adds capture, a control row or a retention policy. The fixes apply
to every organization. They repair cleanup and fence a recreation path; they do
not activate adopted behaviour. The deployment impact of the organization
cleanup fix is the first activation item below.

References: [#306](https://github.com/Umami-Creative-GmbH/z8/issues/306),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the
canonical resolutions of [#257](https://github.com/Umami-Creative-GmbH/z8/issues/257#issuecomment-5654287041)
(privileged linked-lifecycle cleanup), [#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073)
(cleanup never invalidates retained append evidence) and [#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145)
(whole-tenant cleanup without a new retention policy).

## Topology

### Whole-organization cleanup (`lib/jobs/organization-cleanup.ts`)

The daily `cron:organization-cleanup` job permanently deletes organizations that
were soft-deleted more than five days ago. Each organization is deleted in one
transaction:

1. The users of the organization's employees lose their user-level push
   subscriptions and water intake log, as before.
2. Sessions that have the organization active are reset, as before.
3. `sso_provider` rows go. They carry the organization without a foreign key.
4. `delete from organization`. **Everything else cascades.** Every
   organization-scoped table is reachable from `organization` through
   `ON DELETE CASCADE`, directly or through a parent that cascades. A PostgreSQL
   16 catalog walk over all 260 public tables of the current schema confirmed
   this. Three tables with an organization column are not reached:
   `sso_provider` (step 3), `travel_expense_receipt_upload` (see below) and
   `stripe_event`, whose billing events keep their row with the organization
   set to null, as before. The other unreached tables are user-global,
   authentication or SCIM tables without an organization column.

Rows that reference employees, periods or workflows without cascade are all
direct children of `organization`. So the single statement removes them before
their references are checked. The old explicit per-table deletes ran first
and were blocked by those references. They are gone, and so is the explicit
`deleteWorkPeriodApprovalEvidence` call.

What goes with the organization, among others:

- all adoption and configuration controls (`time_entry_append_control`,
  `approval_evidence_control`, `approval_presentation_control`,
  `approval_delivery_control`, `approval_workflow_rollout`, escalation policy,
  revisions and control);
- work history, completed-work receipts and append positions;
- approval lifecycles of every kind and authority: requests, chains, workflows
  with their stages, assignments, events, commands, outbox and projections,
  submitted revisions, decision evidence, review bindings, invocations, delivery
  intents, work and messages, escalation transfers with their events, attention
  with its events, and bot message and escalation rows;
- audit rows and employees.

**Kept on purpose:** `travel_expense_receipt_upload` staging rows hold the
organization and claim by value (#295). They are outstanding storage cleanup
work. `runTravelExpenseReceiptCleanup` still deletes the stored object after
the tenant is gone and then removes the row. Keeping them adds no new retention:
they disappear as soon as the object is deleted.

**Concurrency.** Every insert into an organization-scoped table takes a
key-share lock on the organization row (the foreign key check). That lock
conflicts with the delete. A writer running during tenant deletion either
commits first, and its rows are removed with the tenant, or waits and then
fails its foreign key check. A late worker (delivery pass, attention recheck,
receipt replay) finds no controls and no rows, so it recreates nothing.

**Failure.** Any error rolls the whole organization back. That includes a
future table that references an employee or period without cascade. The job
reports the error for that organization and continues with the others.
Previously every organization with recorded work failed this way on every run.

### Privileged approval deletion (`deleteApprovalInTransaction`)

Unchanged, except that it also removes the lifecycle's **escalation attention**.
An incident records the workflow, assignment, lineage root assignment or legacy
request it concerns by value, without a foreign key. The incidents that name
one of the lifecycle's workflows, those workflows' assignments or its legacy
requests are deleted before the approval rows, and their events cascade.
`approval_escalation_attention` joins the table lock set. The IDs are returned as
`attention` and written to the atomic `force_delete_approval` platform-admin
audit entry. The CLI and the platform-admin card list them as "Escalation
attention".

Retained on purpose, because they are work evidence rather than approval
lifecycle state:

- `time_entry` (including committed correction entries), `work_period`,
  `time_record`, completed-work receipts and `time_entry_append_position`.
  Purging an approval never rewrites the history it described. Only nullable
  approval references on the sources are cleared, as before.
- Source business records and their statuses. For example, an absence approved
  from a Telegram card stays `approved`.

### Employee-scoped lifecycle purge (`deleteEmployeeApprovalLifecycles`)

New, in `lib/approvals/maintenance.ts`. It finds every approval lifecycle, of
any kind and authority, that names one of the given employees in any role:

- requester, subject or submitter;
- assignee, reassigner or resolver;
- event, deciding or invoking actor;
- outbox or card recipient;
- escalation participant, or current attention approver.

It maps each reference to an ID that `deleteApprovalInTransaction` addresses: a
workflow, a legacy request, a legacy submitted revision or a legacy transfer. It
then purges each lifecycle through that owner, following its verified links
only. A root already removed with an earlier lifecycle is skipped. Attention
that still names an employee after that, because its lifecycle no longer
exists, is deleted last. The function runs in the caller's transaction.

### Selective demo cleanup

"Delete non-admin data" (`deleteNonAdminEmployeesData`) now does the following:

1. It purges every lifecycle naming the non-admin employees in one transaction,
   through `deleteEmployeeApprovalLifecycles`. Before, it deleted only legacy
   requests the employees had requested. Legacy requests they only approve are
   now included, because they block the employee delete too.
2. It deletes absences, time histories (per employee under the employee key,
   #285), allowances and manager links, as before.
3. It keeps the audit trail: `audit_log.employee_id` of the deleted employees is
   set to null, and the rows stay. This was the user's decision on 2026-09-25.
4. It deletes the employees, memberships and demo users, as before.

Admin employees' entries, periods, records, receipts and append positions are
untouched. The path was never transactional as a whole and still is not. A
failure after step 1 leaves the purged lifecycles purged and the employees in
place. Rerunning it is safe.

"Clear time data" is unchanged. It removes time-kind evidence with the
history (#302/#301) and keeps other kinds' lifecycles. Absence workflows whose
absences it deletes stay listed and can be purged with `deleteApproval`.

### Late retries cannot recreate a purged lifecycle

`executeTimeCorrectionSubmissionInTransaction` takes a new input,
`correctionEntriesCommitted`. The web submission sets it when the deterministic
correction entries already existed before the attempt; the demo generator sets
it when its entry already existed. If no request or workflow exists for the
submission key, and the entries were committed earlier, the lifecycle was
purged. The attempt is then refused with the `ConflictError`
`purged_time_correction_approval` ("Submit a new correction instead"). It is
not routed again. The demo generator skips that period.

The other lifecycles cannot be recreated by late work:

- evidence capture, bindings, invocations, delivery messages and escalation
  journals reference the workflow or request by foreign key, so a late write
  fails;
- delivery work and legacy intents are deleted, so no pass finds them;
- attention is deleted, so a recheck finds nothing;
- a press on a purged card finds no binding and decides nothing.

## Verification

### PostgreSQL (2026-09-25)

New suite `lib/approvals/lifecycle-cleanup.integration.test.ts`, registered in
the runner script and `tests.yml`. It passes 6/6 against a disposable PostgreSQL 16
database migrated through `0099`. Two organizations are populated identically
through real callers:

- adopted demo work for an admin and a requester, and demo corrections
  (entries, periods, canonical records, receipts, append positions, correction
  approval requests);
- two canonical absences submitted through `requestAbsenceEffect` and delivered
  by the real delivery owner. One card is blocked (403), which gives delivery
  work and `delivery_unavailable` attention. The other is delivered and approved
  from its Telegram card through `handleTelegramUpdate`, which gives a binding,
  a message, an invocation and decision evidence;
- a legacy expense request with its delivery intent, and a staged receipt upload
  through `stageTravelExpenseReceiptUpload`;
- a session with the tenant active, and a push subscription.

Only the request/session, billing guard, e-mail and notification fan-out,
calendar queue, work-balance marking, vault, delivery kick and the Telegram
HTTP transport are replaced. Controls are inserted the way the documented
operator SQL writes them. The scenarios:

- **Whole-tenant cleanup** through `runOrganizationCleanup`:
  - it succeeds (it failed on `time_entry` before the fix);
  - afterwards no organization-scoped row of the deleted tenant remains in any
    table, apart from the staging row, and no employee;
  - the session is reset and the push subscription is gone;
  - every organization-scoped row of the other tenant is identical;
  - the staged object is still deleted by the receipt cleanup, which removes
    the staging row;
  - a later delivery pass and an attention recheck find and recreate nothing.
- **Rollback**: a failure injected at the organization delete leaves every row of
  the tenant, the session and the push subscription unchanged.
- **Privileged deletion** through the real `forceDeleteApprovalAction` as a
  platform admin:
  - purging the decided absence returns and audits exactly its workflow,
    revisions, decision evidence, binding, invocation, delivery work and
    message;
  - the absence stays `approved` with its workflow reference cleared;
  - the requester's other cycle keeps its revisions, delivery work and
    attention;
  - the requester's work graph and the other tenant are unchanged;
  - a later press on the purged card records nothing;
  - purging the other cycle returns and audits its attention;
  - later delivery and recheck passes recreate no work, message, attention or
    revision.
- **Correction purge**: purging one demo correction request keeps the committed
  correction entries, receipts and append position byte-identical. A later demo
  correction run recreates no request for it.
- **Selective demo cleanup** through the real `deleteNonAdminDataAction`:
  - it succeeds (it failed on `audit_log` before the fix);
  - no approval workflow, request, evidence, binding, invocation, delivery row
    or attention of the tenant remains;
  - the audit entries remain, with their employee cleared;
  - the admin's work graph is byte-identical;
  - the staging row and the other tenant are unchanged.

`time-tracking/actions/correction-lifecycle.integration.test.ts` gained two
scenarios, one for an adopted and one for a legacy organization. A web
correction retry after `deleteApproval` purged its lifecycle is refused and
writes nothing (26/26). `demo/demo-work.integration.test.ts` still passes 14/14.

### Database-free

- `approvals/maintenance.test.ts` (10): attention scope, links and order, and the
  employee purge's reference coverage, scoping, skip and empty input.
- `jobs/organization-cleanup.test.ts` (2): statement topology and the failure
  report.
- `approval-write-boundary.test.ts`: the legacy `approval_request` delete
  exceptions of `delete-non-admin.ts` and `organization-cleanup.ts` are retired,
  because both files no longer write approval tables directly.

## Remaining activation blockers

This slice closes on implementation. The items below move to #327 (deployment),
#329 (pilot) and #331 (rollback).

1. **Organization cleanup now deletes stuck tenants.** Before deploying, list
   the organizations with `deleted_at < now() - interval '5 days'`. The job
   failed on those with recorded work and will now delete them permanently on
   its next run (#327). This is irreversible; rollback (#331) cannot restore a
   deleted tenant, only stop further runs.
2. **Other employee references still block "Delete non-admin data".** These are
   pre-existing configuration and business references, not lifecycle state,
   so this slice leaves them:
   - approval policy stages that name the employee as approver;
   - a team's primary manager;
   - `absence_entry.approved_by` on a retained employee's absence;
   - approvers of compliance exceptions and shift requests;
   - vacation adjustments, policy violation acknowledgements and payroll
     blocker dismissals;
   - replacement employees of departures;
   - team permission grants.

   A legacy chain with no stage request is also not reachable from the
   employee.
3. **Stored objects outside the receipt staging path** (attachments, exports) are
   not deleted with the tenant. This is pre-existing and adds no new retention
   policy.
4. **Legacy deletion requests leave no trace after a purge.** A retry of a
   purged legacy correction *deletion* request (no correction entries) is
   indistinguishable from a new submission and routes again. Edits are fenced;
   adopted organizations also keep their receipts.
5. **Not verified on PostgreSQL here:**
   - late retries of manual commands (#308) and clock-out approvals after a
     purge;
   - canonical time-correction workflows;
   - Teams, Slack and Discord cards;
   - legacy chains;
   - `clearOrganizationTimeData` with non-time lifecycles;
   - concurrent writers racing the tenant delete (argued from foreign key
     locking above, not exercised).
6. Old deployed builds still run the previous organization cleanup and demo
   delete. They fail rather than corrupt, so draining them is only needed for
   the fixes to take effect (#327).
