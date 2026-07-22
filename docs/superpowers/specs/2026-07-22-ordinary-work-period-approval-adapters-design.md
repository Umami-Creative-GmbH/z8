# Ordinary Work-Period Approval Adapters Design

## Goal

Migrate manual time submissions and policy-gated clock-outs to concrete, organization-scoped approval workflow adapters while preserving current creation, approval, rejection, notification, payroll-state, and public response behavior.

## Scope

This phase adds:

- concrete `manual_time_submission` and `policy_clock_out` domain adapters;
- one shared ordinary work-period contract and adapter implementation;
- verified legacy capture for both ordinary time approval types;
- rollout-aware creation and terminal decisions in all five rollout modes;
- strict source locking, affected-row compare-and-swap, and transaction ownership;
- sanitized inbox and requester projections;
- post-commit notification and work-balance effects.

This phase does not add requester cancellation, modify time-correction behavior, migrate travel expenses, shift requests, or compliance exceptions, enable any rollout mode, or build external outbox delivery.

## Adapter Structure

One ordinary work-period adapter factory produces two concrete adapters. Each registered instance has a fixed workflow type:

- `manual_time_submission` with source type `time_entry`;
- `policy_clock_out` with source type `time_entry`.

The shared implementation owns source loading, trusted capabilities, routing context, command and terminal preflight, terminal finalization, and display projection. Workflow-type-specific behavior is limited to strict kind validation and terminal notification selection. The production registry registers both concrete adapters and leaves travel expenses, shift requests, and compliance exceptions fail closed.

This structure preserves the registry's one-adapter-per-workflow-type contract without duplicating work-period locking, canonical-record parity, compare-and-swap, or projection logic.

## Source Identity

Both approval types use the work period as the stable source:

```ts
{
  organizationId,
  workflowType: "manual_time_submission" | "policy_clock_out",
  sourceType: "time_entry",
  sourceId: workPeriod.id,
}
```

The workflow type is part of the source identity. All work-period, canonical-record, approval-request, chain, workflow, projection, and decision operations require the exact `organizationId`, employee, source, and workflow type.

A work period must not have simultaneous pending ordinary approval types. Existing source-link and legacy pending-request constraints remain authoritative for overlap prevention. Exact retries replay the same workflow. A stale link, foreign workflow, wrong workflow type, or different pending workflow produces a conflict and rolls back.

## Immutable Context

Canonical creation stores a strict private context marker:

```ts
{
  timeRequest: {
    kind: "manual_time_submission" | "policy_clock_out";
  };
}
```

The parser rejects unknown keys, missing markers, ambiguous kinds, and mismatches between the adapter's fixed workflow type and the payload kind. Parsed values are detached and immutable.

Canonical creation never infers workflow type from reason text. Verified legacy capture may classify historical rows using the existing ordered evidence rules: explicit metadata first, then mutually exclusive pending-change markers, then exact historical reason markers. Ambiguous or contradictory evidence fails closed.

Private pending changes, source diagnostics, internal workflow identifiers, and employee-sensitive data do not enter display projections, public errors, or logs.

## Verified Legacy Capture

Legacy capture loads the complete ordinary approval state in one transaction-scoped operation:

- exact organization-scoped work period and employee ownership;
- canonical work record and approval-state parity;
- pending legacy approval request and optional chain state;
- explicit metadata and historical classification evidence;
- source link and current canonical workflow, when present;
- start, end, duration, and approval status required for safe display;
- requester and approver identity required for routing and authorization.

Capture rejects deleted or incomplete periods, missing canonical records, foreign employees, malformed metadata, ambiguous classification, incompatible approval states, moved source links, and requests that do not belong to the exact organization and source.

Private source evidence and sanitized display evidence are stored separately. Shadow and ready observations use private evidence for workflow correctness and safe evidence for projections.

## Submission Flow

Manual-entry and policy-clock-out creation paths use one shared rollout-aware submission boundary.

1. Authenticate the requester and derive organization, user, employee, and source authority server-side.
2. Enter the repository-owned transaction and acquire the exact source lock.
3. Revalidate the work period, employee ownership, canonical work record, current endpoints, approval state, and absence of another pending ordinary workflow.
4. Persist the existing pending work-period and canonical-record state.
5. Execute the workflow submission for the fixed ordinary approval kind.
6. Bind the exact workflow to the source and persist projection, compatibility, and outbox state according to rollout mode.
7. Commit before dispatching notifications or maintenance effects.

The boundary preserves current public action and API result shapes. Auto-approved submissions finalize in the same transaction and return the existing approved result.

## Rollout Behavior

### Legacy

The legacy approval request or chain remains authoritative. No canonical observation is required. Existing response and post-commit behavior remains unchanged.

### Shadow And Ready

The legacy source and approval writes remain authoritative inside the repository transaction. Verified legacy capture mirrors the lifecycle into canonical workflow, projection, and observe-only outbox state before commit. Capture or observation failure rolls back the source and legacy writes.

### Canonical And Complete

The canonical workflow engine owns routing, transitions, compatibility writes, projection, and source binding. The ordinary work-period adapter owns source validation and terminal mutation. Compatibility rows preserve existing readers and callers. Outbox records remain observe-only in this phase.

No rollout row or organization mode changes as part of this work.

## Decision Flow

Individual inbox, bulk inbox, legacy handler, and bot decisions resolve one exact ordinary workflow kind from immutable metadata and verified source state. They do not route ordinary requests through time-correction finalization.

For all rollout modes, decision processing:

1. derives actor and organization authority from the authenticated caller;
2. resolves the exact request, assignment, workflow type, and source inside the transaction;
3. locks and reloads the organization-scoped work period and canonical record;
4. verifies requester ownership, pending state, source link, and work-period/canonical-record parity;
5. executes the legacy coordinator or canonical transition engine for the configured mode;
6. finalizes the source with affected-row compare-and-swap;
7. persists decision records, compatibility state, projection, and outbox state atomically;
8. dispatches notifications and work-balance maintenance only after commit.

Rejection changes approval state but does not rewrite recorded start or end instants. Approval preserves the submitted work-period values and marks the canonical record approved.

## Terminal Finalization

The shared finalizer accepts a fixed ordinary workflow kind and an approve or reject transition. It requires:

- exact organization, employee, source, workflow, and actor identity;
- a pending, non-deleted, complete work period;
- a linked canonical `work` record with matching employee, instants, duration, and pending approval state;
- a matching immutable `timeRequest.kind` marker;
- an exact pending legacy or canonical decision target for the active rollout mode.

The finalizer locks before mutation and requires exactly one affected row for each work-period, canonical-record, decision, and source-link update. Zero or multiple affected rows are conflicts. It opens no nested transaction, sends no notification, and performs no external effect.

Terminal replay is handled by workflow command receipts and exact legacy terminal evidence. A replay returns the prior result without applying source mutations or effects again.

## Side Effects

The transaction returns a detached post-commit descriptor containing only the data required for:

- manual-submission approval or rejection notification;
- policy-clock-out approval or rejection notification;
- work-balance dirty marking when required by existing behavior;
- route revalidation performed by current callers.

Legacy, shadow, and ready dispatch current best-effort effects after commit. Canonical and complete retain observe-only outbox intent and do not deliver externally in this phase. Effect failure is logged with organization-safe identifiers and does not change the committed approval result.

## Error Handling And Security

All user inputs use existing schema validation. Organization, actor, employee, and approver authority come from authenticated server context, never caller-supplied trusted fields. SQL remains parameterized.

Malformed, ambiguous, cross-organization, wrong-employee, wrong-workflow-type, stale-status, moved-link, and compare-and-swap failures return stable generic errors. Cross-tenant failures do not reveal whether a foreign source exists. Internal metadata, pending changes, and source diagnostics are excluded from public errors and logs.

No process-local lock, automatic retry loop, or metadata-less canonical fallback hides a database invariant failure.

## Timekeeping

Recorded instants remain canonical UTC database boundaries. This phase does not perform new business-time arithmetic or reinterpret event meaning in the viewer's timezone. Source parity compares stored instants and duration directly. Any modified date-boundary or timezone-sensitive logic must use Temporal with explicit employee-owned IANA zones, following the timekeeping reference.

## Testing

The implementation plan must include:

- strict context normalization, redaction, and legacy classification tests;
- shared adapter contract tests executed for both fixed workflow types;
- source loading, routing, terminal preflight, projection, and notification selection tests;
- all five rollout modes for creation, auto-approval, multistage approval, rejection, and replay;
- individual, bulk, legacy-handler, bot, inbox, and requester-read regressions;
- PostgreSQL tests for source locks, duplicate submission, concurrent decisions, affected-row compare-and-swap, rollback, and tenant isolation;
- write-boundary tests that remove ordinary-time bypasses only after every path uses the shared owner;
- payroll-state, notification, and work-balance regressions;
- typecheck, scoped Biome, full test, CI build, security review, and Temporal/timekeeping review.

## Success Criteria

- Both ordinary workflow types use concrete production adapters.
- Every approval-producing manual-entry and policy-clock-out path crosses the shared rollout boundary.
- Creation and terminal decisions are atomic with source, compatibility, projection, and outbox writes.
- Exact retries are idempotent and conflicting pending workflows fail closed.
- Work-period and canonical-record state remain organization and employee scoped and mutually consistent.
- Existing public responses, inbox behavior, notifications, payroll state, and recorded instants remain stable.
- No cancellation, rollout activation, or external outbox delivery is introduced.
