# Absence Approval Adapter Design

## Goal

Migrate absence approval submission, terminal decisions, and cancellation to the organization-scoped approval workflow boundary while preserving current absence behavior and public response contracts. Phase 4 remains a shadow rollout: legacy behavior is authoritative until a later domain cutover.

## Scope

This phase adds the concrete absence domain adapter, transaction-scoped legacy-state capture, rollout-aware wiring for absence creation and decisions, and the smallest generic workflow-start API required for canonical submissions.

It does not replace absence inbox reads, redesign absence UI, build outbox expansion or delivery, change notification content, or migrate another approval domain. Existing calendar, email, and in-app notification handlers remain post-commit behavior.

## Source Identity And Tenant Boundary

The trusted absence identity is:

```ts
{
  organizationId,
  workflowType: "absence",
  sourceType: "absence_entry",
  sourceId: absenceEntry.id,
}
```

Every absence, canonical time record, legacy approval request, chain, workflow, projection, and cancellation operation is scoped by `organizationId`. The adapter never derives organization identity from request metadata or viewer state. Source loading rejects missing, deleted, or cross-organization records.

## Rollout Behavior

### Legacy

Existing absence creation and decision mutations run without canonical observation. Public action results and post-commit side effects remain unchanged.

### Shadow And Ready

The caller's existing database transaction remains authoritative. The absence legacy-state loader captures exact source, request, chain, and chain-stage state before and after the mutation. The legacy write coordinator then mirrors the observed transition to canonical workflow, projection, and observe-only outbox state before commit.

No shadow or ready mutation may commit without successful canonical observation. Capture or mirror failure rolls back the source and legacy approval writes.

### Canonical And Complete

Canonical submission uses the generic workflow-start API. Approval, rejection, and cancellation use the transition engine and registered absence adapter. In canonical mode, compatibility writing mirrors canonical state to legacy persistence for rollback support. Complete mode does not mirror to legacy.

These paths are implemented and tested during Phase 4 but are not enabled for an organization until the later cutover gates pass.

## Generic Workflow Start

Add one reusable `startApprovalWorkflow` boundary rather than absence-specific canonical persistence. It runs inside a caller-provided transaction and:

- validates the rollout gate and trusted organization/source identity;
- resolves the initial route and activation-time reviewers;
- creates the workflow, ordered stages, active assignments, initial immutable events, requester projection, and observe-only outbox rows;
- drains leading requester-auto-approved stages before returning;
- returns the workflow identity and terminal/pending result needed by the source caller;
- remains idempotent for the supplied organization, source identity, and submission key.

The start boundary does not create the absence source and does not own the outer transaction. The absence creation flow writes the source and canonical time records first, starts the workflow in the same transaction, then stores `absence_entry.approvalWorkflowId`.

## Absence Adapter

The adapter implements the existing `ApprovalDomainAdapter` contract for workflow type `absence`; it does not introduce another adapter abstraction.

### Source Loading

Load `absence_entry` by `(organizationId, sourceId)` together with the organization-scoped canonical time-record link needed for parity updates. Independently require the requester employee, category, team membership, canonical record, and workflow link to belong to the same organization. Return a stable source shape containing requester, dates, half-day periods, category, approval state, workflow link, and canonical record identity.

### Routing Context

Build canonical routing context from trusted source data:

- workflow type `absence`;
- source type `absence_entry`;
- requester employee;
- requester team as `teamIds[]` when present;
- absence category;
- location ID `null`, preserving current absence policy behavior;
- empty employee-group IDs unless trusted group data is loaded;
- null travel-expense amount and overtime risk.

This mapping preserves current absence policy matching and does not infer missing attributes.

### Terminal Decisions

Approval updates the scoped absence to approved, records approver and approval time, applies existing sick/vacation override logic, and synchronizes the linked canonical time record to approved.

Rejection updates the scoped absence to rejected with the rejection reason and synchronizes the linked canonical time record to rejected.

The transition engine calls terminal source mutation exactly once, only when the workflow becomes terminal. Intermediate stage approvals do not finalize the absence.

### Display And Events

Build the requester/inbox display projection from the loaded absence without adding new read models. Build observe-only outbox messages for the existing absence lifecycle event identities. In legacy, shadow, and ready, existing direct calendar, email, and notification handlers continue after commit and remain the only external delivery path in Phase 4.

## Submission Flow

`createRequestedAbsenceRecordsInTransaction` remains the transaction owner and preserves the existing `ServerActionResult<{ absenceId: string }>` response.

It continues to atomically create the absence entry, canonical time record, canonical absence detail, and source link. The rollout-aware branch then:

- uses current legacy approval creation in legacy mode;
- wraps current approval creation with before/after capture and compatibility mirroring in shadow/ready;
- calls `startApprovalWorkflow` and stores the workflow link in canonical/complete.

Requester auto-approval must produce the same final absence and canonical time-record state in every mode. A finalizer failure rolls back source creation, approval state, canonical records, and workflow state.

## Decision Flow

Legacy, shadow, and ready keep `processApprovalWithCurrentEmployee` authoritative. Shadow and ready wrap the existing approval/rejection transaction with exact legacy capture and canonical observation.

Canonical and complete dispatch the stable approve/reject entry points through the transition engine. The absence adapter performs the terminal mutation. Existing public results remain `ServerActionResult<void>`.

In legacy, shadow, and ready, post-commit work-balance, calendar, email, and notification behavior remains unchanged and runs once only after a successful commit. Canonical and complete paths do not invoke these direct external handlers during Phase 4; they record observe-only outbox intent and remain disabled in production until Phase 6 provides durable delivery and Phase 8 enables cutover.

## Cancellation

Current permission semantics remain unchanged:

- owners may cancel pending absences;
- owners may cancel approved absences only before the organization-local start date;
- admins may cancel another employee's pending request under the existing authorization rule;
- rejected absences cannot be cancelled.

Cancellation becomes one transaction. Inside that transaction, reload the scoped source, workflow link, actor authorization, organization timezone, organization-local eligibility date, and linked records. Guard every state transition and delete by organization and expected current status so approval and cancellation cannot both win.

In shadow/ready, capture the live source and approval state, perform the legacy cancellation transition while the source still exists, capture and mirror the terminal cancelled state, and only then hard-delete the source and linked canonical records in the same transaction. The post-mutation capture therefore never fabricates a missing-source snapshot. In canonical/complete, the transition engine records cancellation before the adapter deletes the source. Workflow/stage/assignment/event/projection history remains durable in shadow, ready, canonical, and complete. Legacy mode preserves current hard-deletion behavior without canonical history.

The source record continues to be hard-deleted; no new `cancelled` absence status is added. Calendar deletion and manager notification remain post-commit. No queue job may be published before the transaction commits.

Approved cancellation authorization uses the existing registry-issued capability and retains the current owner-only future-absence rule. This phase does not extend approved cancellation to managers or admins.

## Failure Semantics

- Invalid workflow types, organization mismatches, and source-identity mismatches fail before mutation.
- A null source workflow link is valid only while canonical start is creating that workflow; the returned exact scoped link is stored before commit. Decision and cancellation paths reject missing, ambiguous, or mismatched source/workflow links.
- Legacy capture, canonical start, compatibility mirror, terminal source mutation, projection, outbox, or cancellation failure rolls back the complete transaction.
- Duplicate canonical commands use existing receipt idempotency and cannot repeat source mutations. Direct external post-commit handlers are not dispatched by canonical/complete paths during Phase 4.
- Errors preserve existing public action shapes and do not expose captured source state.

## Write Ownership

The absence migration removes temporary legacy write exceptions only after the corresponding production path no longer writes the protected table directly. The canonical workflow repository, compatibility writer, projection writer, and outbox writer remain the only canonical table owners.

The exact compatibility-writer owner entry may add only the legacy request/chain operations implemented by its transaction-bound canonical-to-legacy row writer. Temporary domain exceptions are not widened to accommodate the adapter. All new persistence flows through approved transaction-bound ports.

## Tests

Adapter tests cover organization-scoped source loading, routing context, approval, rejection, intermediate stages, requester auto-approval, canonical time-record parity, cancellation eligibility, display projection, and observe-only outbox messages.

Integration tests cover:

- atomic absence and workflow creation;
- legacy versus shadow/ready versus canonical/complete routing;
- capture and mirror rollback;
- multi-stage terminal finalization exactly once;
- pending cancellation;
- owner cancellation of a future approved absence using organization-local date rules;
- cancellation rollback and no pre-commit side effects;
- stable submission and decision response contracts;
- no duplicate post-commit calendar or notification work;
- cross-organization source, workflow, canonical-record, and actor rejection.

PostgreSQL tests are limited to transaction, compare-and-set, and rollback behavior that unit tests cannot establish reliably.

## Exit Criteria

- Absence submission and decisions dual-write atomically in shadow/ready while legacy remains authoritative.
- Canonical/complete absence paths are implemented and tested but remain disabled until cutover.
- Cancellation is transactionally durable at the workflow level while preserving source deletion behavior.
- Existing absence API results and external side effects remain stable.
- Every read and write is organization-scoped.
- Focused absence, adapter, workflow, compatibility, and write-boundary suites pass with typecheck, Biome, and `git diff --check`.
