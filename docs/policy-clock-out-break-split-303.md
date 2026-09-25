# Policy clock-out terminal break splits (#303 / T39)

## Delivery and activation status

A final policy clock-out approval that owes a required break splits the
approved period inside the approval transaction. Before this slice, the split
already ran in that transaction, but it:

- took the employee advisory lock late, after the decision had locked period
  and canonical rows;
- ignored other unresolved reviews of the period;
- read the time-entry chain head from the latest-created row, even in
  organizations whose append control is active;
- gave the generated segment an approved status with no recorded origin or
  decision lineage.

The split now runs in two terminal paths:

| Terminal path | Real callers | Coordination |
| --- | --- | --- |
| Final manager decision | inbox (`approveApprovalInboxItem`), bots and the time-tracking actions, all through `executeOrdinaryWorkPeriodDecisionInTransaction` | new work-period decision coordinator |
| Requester auto-completion | web, direct-HTTP, bot and on-behalf clock-out, through `executeOrdinaryWorkPeriodSubmissionInTransaction` | the clock-out's existing work transaction |

One switch decides what an organization writes, and nothing sets it:

- **Work adoption** follows the organization's `time_entry_append_control`
  (`active`), the same control that gates #273, #274, #286, #301 and #308.
  Adopted organizations do four extra things:
  - append the generated break entries through the append collaborator;
  - round each segment on its own;
  - advance the source revision;
  - write a `split_policy_clock_out_break` receipt.

All other changes apply to every organization, whether or not it has adopted
append:

- the coordinated transaction and its lock order;
- the exact-lifecycle review guard;
- recording the decision before the split.

Legacy organizations keep their established split writes.

References: [#303](https://github.com/Umami-Creative-GmbH/z8/issues/303),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the
canonical resolutions of [#252](https://github.com/Umami-Creative-GmbH/z8/issues/252#issuecomment-5653113300),
[#256](https://github.com/Umami-Creative-GmbH/z8/issues/256#issuecomment-5654366538) §7,
[#257](https://github.com/Umami-Creative-GmbH/z8/issues/257#issuecomment-5654287041),
[#262](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).

## Coordination

`acquireWorkPeriodDecisionScope` (`lib/approvals/server/work-period-decision-transaction.ts`)
runs on the approval repository transaction before any row lock. It takes the
#264 locks in this order:

1. the shared adoption gate, with the append control read under it;
2. the ordinary approval write gate of the decided kind (rank 2);
3. the organization configuration guard;
4. the sorted user access guards (the deciding actor and the owner's user);
5. the sorted exclusive employee keys (the owner and every employee record of
   the actor).

Previously this position held only the write gate.

The decision routes from plain reads of its request, workflow and period.
Before its first read it records an observation of those rows:

- the period;
- its legacy requests;
- its workflows, with their versions, stages and assignments.

Under the locks it takes that observation again and re-reads the routed scope.
A change in either throws `WorkTransactionScopeChanged`.
`retryWorkPeriodDecisionTransaction` then restarts the transaction, at most
twice. The restart matters for a second decision that waited for the first one:
it replays the committed decision from fresh reads instead of deciding on stale
ones. Two existing concurrent-duplicate PostgreSQL tests failed until this
check was added.

The sealed scope is registered for the transaction client. The terminal split
(`lib/time-tracking/policy-clock-out-terminal-break.ts`) looks it up with
`workTransactionScopeFor` and takes no lock of its own. Requester
auto-completion finds the clock-out's coordinated scope the same way.

Another approval runtime can still reach this terminal outside both
coordinators, for example an assignment activation after a reassignment. That
case follows the #301 correction fence:

- an adopted organization is refused;
- a legacy organization keeps the established employee locks, so a working
  path does not start failing.

## Review guard with exact exemption

The finalizer builds the resolving lifecycle from the evidence it has already
verified:

- a canonical lifecycle: `{ authority: "canonical", workflowId }`;
- a legacy lifecycle: `{ authority: "legacy", approvalRequestId, observedWorkflowId }`,
  where `observedWorkflowId` is the shadow mirror bound to the period, if any.

The split first checks that the lifecycle's workflow is the one bound to the
locked period. Only then does it call `assertNoUnrelatedWorkPeriodReview`
(`lib/time-tracking/work-period-review.ts`). That guard first verifies the
resolving identities: the workflow's type, source and requester, and the
request's entity and requester. A mismatch is an integrity failure, not an
exemption.

Only three things are exempt:

- the resolving workflow;
- that workflow's legacy compatibility mirror rows (`approval_workflow_stage.legacy_approval_request_id`);
- the resolving legacy request.

Any other pending approval request or workflow for the period blocks the split,
whatever its type. For example, a pending time correction blocks it. A blocked
split raises a `ConflictError` (`work_period_pending_approval`, "Another approval
for this work period is still pending"). That error passes through the finalizer
and decision wrappers, so the approver sees the reason as a `stale` inbox
failure, and the whole approval rolls back. The guard runs only when a split is
needed, after the period lock and before the first split write. There is no
generic bypass flag.

## What a split commits

Every organization gets the same split graph:

- both synthetic entries;
- the shortened source period;
- the source canonical record;
- the generated period;
- the generated canonical record, with its work detail and cloned allocations;
- the approval status.

These are committed together, or the whole approval rolls back. The human
decision (`time_record_approval_decision`) is now written on the originating
record before the split, so the split can name it. The generated record gets no
decision row of its own, because no second human approval exists.

Adopted organizations additionally commit:

- **Append.** Both generated entries are admitted through the append
  collaborator with operation `policy_clock_out_break`. Each entry records its
  exact predecessor ID and hash, and the position advances with a version check.
- **Independent rounding.** Each segment's minutes come from its own exact UTC
  endpoints, rounded half up (`deriveWorkDurationMinutes`). Legacy organizations
  keep the established arithmetic on the stored minutes.
- **Revisions.** The source period's `graph_revision` advances with a
  compare-and-set in the same update. The generated period starts at revision 1,
  like other adopted creators.
- **Receipt.** `completed_work_operation` stores kind `split_policy_clock_out_break`
  and writer `policy_clock_out_decision`. Its actor is `system`, with no human
  user. Its ID is derived from the lifecycle
  (`derivePolicyClockOutBreakOperationId`), so a second fresh split is a key
  collision. The result records:
  - the executing process and the triggering human (user and employee);
  - the originating work, by value;
  - the decision lineage: the lifecycle, the record decision ID and the action;
  - the policy adjustment;
  - both segments, by value, with their roles. The generated segment records its
    origin and `approval: { state: "approved", basis: "originating_decision" }`;
  - the append links;
  - the revisions;
  - the follow-ups.

Migration `0100_policy_clock_out_break_split` adds the receipt kind, the writer
and the append operation to their CHECK constraints. It keeps every existing
value, including `close_resume_work` and the #301 kinds.

Cleanup: whole-history cleanup (demo history deletion and organization cleanup)
already deletes every receipt by organization and employee, whatever its kind.
Organization and employee deletion cascade.

## Evidence

<!-- filled from the runs below -->

## Not verified and activation blockers

These items move to #327, #329 and #331 (see
[spec #264 close-on-implementation](https://github.com/Umami-Creative-GmbH/z8/issues/264)):

- **Activation.** Adopted behavior is dormant until an organization's append
  control is `active`, and that waits for every competing writer to participate.
  The ordinary automatic break paths are not yet coordinated:
  `break-enforcement.service.ts` and the cron path. Their durable deferral is a
  separate slice.
- **Uncoordinated runtimes.** A legacy organization's split reached outside
  both coordinators (for example a reassignment activation) still locks the
  employee late. Adopted organizations refuse that path. It must be coordinated
  or retired before activation (#327).
- **Old binaries.** During a rollout, instances on the previous binary decide
  without the protocol. Old-consumer drain applies (#329).
- **Unverified paths.** Canonical multi-stage lifecycles, shadow and ready
  rollout modes, and bot and mobile decisions were not exercised against
  PostgreSQL. They use the same decision entry point.
- **Rollback.** Rolling back to a binary without the coordinator reintroduces the
  late employee lock. Receipts already written stay as evidence. An old binary
  cannot write kind `split_policy_clock_out_break` (#331).
