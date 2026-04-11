# Unified Approvals Design

## Summary

Create a shared approval platform for the webapp so managers can triage all approval work from one inbox, approval behavior is consistent across modules, and every decision produces a predictable audit trail without rewriting each domain around a new workflow engine.

## Context

- The repo already has multiple approval-producing domains, including absences, time records, shift requests, and travel expenses.
- The current approvals inbox is only partially unified. `apps/webapp/src/lib/approvals/domain/types.ts` currently covers absence, time, and shift approvals, while travel expenses still have their own approval surface.
- This fragmentation slows manager triage, increases the chance of inconsistent status handling, and makes audit behavior harder to reason about across modules.
- Z8 is a multi-tenant, compliance-sensitive SaaS, so all approval reads and writes must stay organization-scoped and produce reliable traceability.

## Goals

- Give managers a single approval inbox across all approval-producing modules.
- Standardize statuses, filtering, sorting, counters, and bulk action behavior where those concerns are shared.
- Preserve module-specific business rules and side effects in the owning domains.
- Improve audit and compliance traceability for every approval decision.
- Support partial-success bulk actions so triage is faster in mixed queues.

## Non-Goals

- No full rewrite of every approval workflow into a new canonical engine.
- No flattening of all module-specific approval payloads into one giant shared schema.
- No change to cross-organization permissions behavior.
- No removal of domain-specific validation or side effects.

## Approved Direction

Use a shared approval domain for cross-module concerns and keep domain-specific logic in each source module behind adapters.

This is intentionally not a full engine rewrite. The shared layer owns the inbox contract, common statuses, filtering, counters, bulk actions, and audit events. Each approval-producing module remains responsible for its own business validation, mutations, and side effects.

## Architecture

### 1. Canonical shared approval shape

Introduce a canonical model for the data the inbox and approval tooling need to reason about consistently.

The shared shape should cover cross-module concerns only:

- `organizationId`
- `type`
- `status`
- `actor` or current assignee / reviewer context
- `submittedAt`
- `decidedAt`
- `requester`
- `priority` or urgency marker
- source reference metadata needed to route actions back to the owning module
- audit metadata needed for traceability

This model should not absorb module-specific payloads such as time-entry fields, absence-policy details, shift assignment details, or travel-expense line items. Those stay in their source domains.

### 2. Module-owned payloads with shared references

Each domain continues to own its business data and business rules.

The shared approval layer references domain records rather than duplicating or denormalizing them into one universal approval table. The inbox only needs enough shared metadata to list, filter, sort, and route actions correctly. Detailed views can resolve additional data through the owning domain.

This keeps the shared contract small and reduces migration risk.

### 3. Module adapters

Each approval-producing domain implements a small adapter that exposes a common query and action interface to the shared approval layer.

Adapters should be responsible for:

- mapping source records into the shared approval shape
- declaring supported actions for that approval type
- validating single-item actions in the source domain
- executing approve or reject behavior in the source domain
- returning normalized success, conflict, and validation results
- emitting any source-domain side effects required after a decision

Initial adapters should cover:

- absences
- time records or time corrections
- shift requests or scheduling approvals
- travel expenses

Any future approval source should not build another standalone inbox path. It should add an adapter to the shared contract.

### 4. Shared query layer

Add a shared approval query layer that powers:

- inbox list queries
- approval counters and summary cards
- shared filtering
- shared sorting
- dashboard surfaces that need mixed approval counts or urgency views

The query layer should return a normalized list of approval items visible to the current user inside the active organization. It should not bypass module-level authorization rules.

### 5. Shared action layer

Add a shared action layer for single-item and bulk approval decisions.

This layer should:

- accept normalized action requests from the inbox
- resolve the correct adapter for each item
- enforce organization-scoped permission checks before delegation
- delegate validation and mutation to the owning adapter
- normalize results into a consistent response shape for the UI
- write audit events for every attempted and completed action as appropriate

The shared action layer should be the only path used by the unified inbox for approve and reject flows.

## Common Behavior Contract

### Status model

Statuses visible in the shared inbox should be standardized enough for filtering and counters to behave predictably across modules.

At minimum, the inbox should support a shared understanding of:

- pending
- approved
- rejected
- cancelled or withdrawn when a source domain supports it
- conflict or stale state as an action result, not a steady-state list filter unless the product already models it that way

Modules may still have richer internal lifecycle states, but they should map into the shared status vocabulary used by the inbox.

### Filters and sorting

The unified inbox should support one normalized filter model across approval types:

- status
- type
- requester
- date range
- urgency or SLA state
- team or location where the source domain can provide that scope

Sorting should also be shared and predictable, with common defaults such as oldest first, newest first, or most urgent first.

### Bulk actions

Bulk actions should be partial-success, not all-or-nothing.

If one item fails because it is stale, unauthorized, or invalid, the other valid items should still complete. The result payload should include per-item outcomes so the UI can explain exactly what happened.

## Data Flow

1. A source module creates or exposes an approval item that can appear in the shared inbox.
2. The shared query layer fetches all approvals visible to the current user for the active organization.
3. The inbox displays those items using the shared filter and sort contract.
4. A manager takes a single or bulk action from the inbox.
5. The shared action layer checks permissions, resolves the correct adapter, and delegates the action.
6. The source module performs domain-specific validation and side effects.
7. The shared action layer returns normalized results and writes audit records.
8. The inbox refreshes counters and item state.

## Authorization Model

All approval reads and writes must remain organization-scoped.

Rules:

- users only see approval items inside the active organization they are authorized to review
- CASL and existing RBAC checks remain the source of truth for who may act on each item
- the shared approval layer may centralize enforcement orchestration, but it must not weaken module-specific permission rules
- mixed-type bulk actions must evaluate permissions per item, not once for the whole batch
- no cross-organization aggregation or action paths are introduced in this scope

## Error Handling

### Stale items

If an item changes between inbox load and action attempt, the shared action response should report a clear conflict or stale result. The system must not silently overwrite newer state.

### Validation failures

Source domains keep their own validation logic and messages. The shared layer should map these into a consistent response format for the inbox while preserving useful module-specific detail.

### Partial success

Bulk actions should always return per-item results that clearly distinguish:

- succeeded
- forbidden
- stale or conflict
- validation failed
- not found

This is required so the inbox can support fast triage without creating ambiguity.

## Audit and Traceability

Every approval decision should emit a consistent audit event shape regardless of source module.

Audit records should capture:

- organization scope
- approval type
- source module or source record reference
- acting user
- requested action
- previous status
- resulting status
- timestamp
- whether the action was single or bulk
- any stable identifiers needed for later audit export or investigation

Module-specific domains may continue to emit their own richer audit records, but the shared audit event contract should guarantee consistent cross-module traceability.

## UI Contract

The unified inbox should become the primary manager-facing surface for approval triage.

The UI should support:

- a mixed-type inbox list
- shared counters
- normalized filters
- single-item actions
- bulk approve and reject flows
- per-item result feedback after bulk actions
- clear stale-state and permission failure messaging

Module-specific detail panels or deep links can still be used where a decision requires additional context.

## Testing

### Adapter contract tests

Each approval adapter should satisfy a shared contract for:

- query mapping
- status mapping
- supported actions
- success results
- validation failures
- conflict handling

### Inbox integration tests

Add integration coverage for:

- mixed-type inbox queries
- counters
- filters
- sorting
- single-item actions
- mixed-type bulk actions

### Authorization tests

Add tests for:

- cross-organization isolation
- role-based action restrictions
- per-item permission checks in bulk flows

### Domain regression tests

Each source module should retain or gain coverage proving that delegated shared actions still trigger the correct module-specific side effects.

### Audit tests

Add tests confirming every approval decision emits the shared audit event shape consistently across modules.

## Rollout Strategy

Implement the shared approval layer incrementally.

Suggested order:

1. define the shared approval contract and adapter interface
2. migrate the existing unified inbox types onto that contract without changing behavior
3. add travel expenses to the shared inbox
4. add shared bulk-action and result handling
5. standardize audit events across all integrated approval types
6. remove any now-redundant module-specific manager triage surfaces where the unified inbox fully replaces them

This sequence delivers user-visible value early while limiting migration risk.

## Open Decisions Resolved

- Use adapters instead of a full approval-engine rewrite.
- Optimize for all three outcomes equally: faster manager triage, more consistent approval behavior, and better audit or compliance traceability.
- Treat partial-success bulk actions as a required product behavior.
- Keep domain-specific logic in the owning modules.

## Risks and Constraints

- If the shared contract grows to include too much domain detail, it will become a fragile pseudo-engine and increase migration cost.
- If adapters do not enforce the same permission checks as existing direct module flows, cross-module consistency could improve while security regresses.
- If audit events are standardized only in the inbox UI and not at the action layer, traceability will remain incomplete.
- Any module that cannot yet satisfy the adapter contract should remain outside the shared inbox until its behavior is explicit and tested.
