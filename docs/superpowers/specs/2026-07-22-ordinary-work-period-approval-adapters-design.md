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

Canonical mode writes compatibility rows while legacy serving remains enabled. Complete mode writes no legacy compatibility rows. Inbox list, count, detail, individual-decision, and bulk-decision surfaces discover complete-mode ordinary approvals from organization-scoped canonical inbox projections and active assignments. Canonical rows are suppressed when an authoritative compatibility request for the same workflow stage already serves the item, so no rollout mode produces duplicate inbox entries. The public stable target for a canonical-only item is its assignment ID.

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

## Terminal Break Enforcement

Policy-clock-out break enforcement is part of terminal approval, not a post-submission effect. Intermediate approvals and rejections do not enforce breaks. Requester auto-approval uses the same terminal maintenance path as an explicit terminal decision.

Submission resolves the employee's effective break policy at the submitted clock-out instant and persists one strict, versioned private snapshot. The snapshot records either no applicable policy or the complete immutable calculation inputs: assignment and team evidence, policy and regulation identity, maximum uninterrupted minutes, and ordered break-rule thresholds and requirements. Values required for calculation are stored directly; terminal approval does not reconstruct historical meaning from mutable current policy rows.

The exact same snapshot is stored in the work-period pending changes and, according to rollout mode, legacy request metadata and canonical workflow context. Shadow and ready observation must preserve byte-equivalent normalized evidence. Canonical compatibility metadata carries the snapshot; complete mode stores it only in the source and canonical context. The snapshot is excluded from display projections, search text, public errors, notifications, and logs.

Exact submission replay requires the same normalized snapshot. A changed snapshot for the same submission identity is a conflict. Newly created policy-clock-out submissions without valid snapshot evidence fail closed. Historical legacy requests created before this contract may use the explicitly isolated legacy fallback; canonical and complete requests never synthesize policy evidence at decision time.

Terminal approval runs break enforcement inside the repository-owned approval transaction after locking and revalidating the organization-scoped work period, canonical work record, immutable policy snapshot, and employee timezone. If no break is required, approval completes without changing the recorded interval. If a break is required, the transaction:

1. creates the synthetic clock-out and clock-in entries with timezone capture for their exact event instants;
2. shortens the original work period to the first segment and updates its existing approved canonical work record to exact parity;
3. creates a second approved work period for the remaining segment and a second matching approved canonical work record;
4. retains the approval workflow and source link only on the original source segment; and
5. preserves the original submitted interval in approval history and terminal decision evidence.

The system-generated second segment has no approval workflow. Both segments retain the same organization and employee ownership. Every update and insertion is transaction-scoped and organization-scoped; any calculation, timezone-capture, compare-and-swap, or persistence failure rolls back the terminal decision and the complete split.

Exact submission and decision replay returns stored terminal evidence without enforcing or splitting again. Clock-outs that do not cross the approval boundary retain immediate break enforcement after clock-out.

## Side Effects

The transaction returns a detached post-commit descriptor containing only the data required for:

- manual-submission approval or rejection notification;
- policy-clock-out approval or rejection notification;
- work-balance dirty marking when required by existing behavior;
- route revalidation performed by current callers.

Legacy, shadow, and ready dispatch current best-effort effects after commit. Canonical and complete retain observe-only outbox intent and do not deliver externally in this phase. Effect failure is logged with organization-safe identifiers and does not change the committed approval result.

Break enforcement is not dispatched from this descriptor. It is consumed transactionally by terminal policy-clock-out approval before commit. Work-balance dirty marking remains post-commit because it does not mutate the approved source graph.

Terminal approval returns detached internal maintenance facts independently from notification disposition. When a break split occurs, those facts identify the original and generated period IDs, employee, organization, and earliest dirty instant. After commit, every rollout mode:

1. removes stale surcharge calculation state for the original unsplit period;
2. recalculates surcharge state for both resulting periods with exact organization ownership; and
3. marks work balance dirty from the original period's event-local date.

Approved no-split periods also mark work balance dirty when pending periods are excluded from approved balance calculations. Rejection removes any surcharge state created while pending when required by existing persistence behavior. Intermediate decisions and exact replay perform no terminal maintenance. Internal maintenance failure is logged with safe identifiers and does not change the committed decision; external notification delivery remains gated by rollout disposition.

## Error Handling And Security

All user inputs use existing schema validation. Organization, actor, employee, and approver authority come from authenticated server context, never caller-supplied trusted fields. SQL remains parameterized.

Malformed, ambiguous, cross-organization, wrong-employee, wrong-workflow-type, stale-status, moved-link, and compare-and-swap failures return stable generic errors. Cross-tenant failures do not reveal whether a foreign source exists. Internal metadata, pending changes, and source diagnostics are excluded from public errors and logs.

No process-local lock, automatic retry loop, or metadata-less canonical fallback hides a database invariant failure.

## Timekeeping

Recorded instants remain canonical UTC database boundaries and are never reinterpreted in the viewer's timezone. Source parity compares stored instants and duration directly. Terminal break calculations use Temporal with the employee-owned IANA timezone and derive each synthetic event's offset at its exact instant. Synthetic entries store that offset, timezone, and server-derived timezone source. Native `Date` is limited to database boundaries; this path does not add Luxon arithmetic.

## Testing

The implementation plan must include:

- strict context normalization, redaction, and legacy classification tests;
- shared adapter contract tests executed for both fixed workflow types;
- source loading, routing, terminal preflight, projection, and notification selection tests;
- all five rollout modes for creation, auto-approval, multistage approval, rejection, and replay;
- transaction-bound policy-clock-out break enforcement covering no-op, atomic split, requester auto-approval, rejection, exact replay, rollback, timezone capture, and two-record canonical parity;
- immutable break-policy snapshots covering team transfer, assignment deactivation, policy replacement, rule edits, malformed evidence, and conflicting replay;
- complete-mode canonical inbox list, count, detail, individual, and bulk discovery without compatibility rows or duplicate canonical-mode items;
- organization-scoped surcharge reconciliation and work-balance dirty marking for terminal split, no-split, rejection, failure, and replay paths;
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
- Terminal policy-clock-out break splits produce two approved work periods and two matching canonical work records while retaining workflow ownership only on the original source segment.
- Delayed approval applies the immutable break policy captured at submission rather than mutable current policy or team state.
- Complete-mode ordinary approvals remain discoverable and actionable through canonical projections without restoring legacy writes.
- Terminal source changes reconcile local surcharge and work-balance state in every rollout mode without redispatch on replay.
- Existing public responses, inbox behavior, notifications, and payroll semantics remain stable; only the established break-enforcement split introduces synthetic event instants and adjusted segment boundaries.
- No cancellation, rollout activation, or external outbox delivery is introduced.
