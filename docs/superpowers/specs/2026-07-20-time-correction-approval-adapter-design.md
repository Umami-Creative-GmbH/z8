# Time Correction Approval Adapter Design

## Goal

Migrate approval-producing time corrections to the organization-scoped workflow engine while preserving partial-endpoint correction, deletion, rejection, and public response behavior. Add requester-owned cancellation for pending correction requests without supporting reversal after approval.

## Scope

This phase adds:

- verified legacy capture for time-correction requests;
- a concrete `time_correction` domain adapter;
- rollout-aware correction creation and terminal decisions;
- pending correction cancellation;
- durable canonical correction identity;
- organization and employee scoped endpoint parity;
- Temporal-based timezone-sensitive boundary logic.

It does not migrate manual time submissions or policy-gated clock-outs, add approved-correction reversal, replace inbox/read projections, enable canonical rollout modes, or build external outbox delivery. Same-day edits and manager/admin corrections that apply immediately remain outside approval orchestration.

## Source Identity

The workflow source is the work period, not an individual correction row:

```ts
{
  organizationId,
  workflowType: "time_correction",
  sourceType: "time_entry",
  sourceId: workPeriod.id,
}
```

The legacy source alias remains `time_entry` for compatibility. Every work period, endpoint, correction row, approval request, chain, canonical time record, projection, and workflow operation is scoped by `organizationId`. Employee identity and endpoint lineage are validated independently because legacy foreign keys do not provide complete tenant ownership.

## Durable Correction Identity

Canonical workflows must not rediscover pending corrections by scanning inactive rows. The immutable workflow context stores a private correction payload:

```ts
{
  timeCorrection: {
    action: "edit" | "delete";
    clockInCorrectionId?: string;
    clockOutCorrectionId?: string;
  };
}
```

Edit requests require at least one correction ID. Delete requests require both IDs. Each ID must resolve to one inactive, non-superseding correction row for the same organization, employee, work period endpoint type, and expected original entry. The workflow display projection excludes private correction lineage and sensitive notes.

Legacy metadata and canonical context use the same normalized payload. Classification rejects ordinary time requests, malformed metadata, empty IDs, duplicate endpoint IDs, and correction rows belonging to another source.

## Repeated Correction Cycles

A work period may receive more than one correction request over its lifetime. The stable source identity therefore scopes concurrency, while a durable submission key identifies one correction cycle:

- at most one pending workflow may exist for the exact organization, workflow type, source type, and source ID;
- retries of one submission key replay the same pending or terminal workflow;
- terminal workflows from earlier submission keys remain immutable history and do not block a later cycle;
- legacy observations use the approval request ID or chain instance ID as the cycle key;
- canonical creation uses an organization-scoped durable request token that is stable across retries and distinct for a later business submission;
- `work_period.approvalWorkflowId` points to the current or latest cycle, remains set after terminal completion, and may be replaced only when the prior link resolves to a terminal workflow for the same exact source identity;
- a different pending link, foreign workflow, stale link, or failed compare-and-swap rejects the new cycle and rolls back its correction rows.

The canonical pending-workflow index and advisory source lock use the same exact source tuple, including `workflowType`. Legacy compatibility still permits only one pending `approval_request` per source, so all rollout modes continue to reject overlap with another pending legacy time-entry workflow subtype.

## Rollout Behavior

### Legacy

Existing correction rows and legacy approval request/chain remain authoritative. No canonical observation occurs. Current response contracts and post-commit behavior remain unchanged.

### Shadow And Ready

The existing correction transaction remains authoritative through the repository transaction wrapper. The time-correction capture loads exact before/after source, endpoint, correction, approval-request, and chain evidence. The legacy write coordinator mirrors the observed lifecycle before commit.

No correction creation, decision, rejection, or cancellation may commit in shadow/ready when capture or canonical observation fails.

### Canonical And Complete

Canonical creation uses `startApprovalWorkflow`, binds `work_period.approvalWorkflowId`, and stores correction identity in immutable context. Decisions execute through the transition engine and concrete adapter. Canonical mode mirrors canonical lifecycle state to legacy rows for rollback support; complete mode does not.

These modes remain disabled for production organizations until later cutover gates pass.

## Verified Legacy Capture

The capture uses one transaction-scoped SQL statement snapshot and loads:

- the exact work period and employee;
- current original clock-in and optional clock-out entries;
- canonical time record and employee parity;
- all approval requests for the source;
- optional chain and ordered chain stages;
- metadata-linked correction entries;
- original entries referenced by those corrections;
- per-entry timestamp, UTC offset, IANA timezone, and timezone source.

Capture rejects:

- a non-`time_correction` legacy subtype;
- missing, duplicate, foreign, active, or already superseded pending corrections;
- endpoint type or replacement lineage mismatches;
- request, chain, source, employee, or organization disagreement;
- impossible request/chain/source status combinations;
- malformed timestamps or timezone capture.

Source snapshots are stable, detached JSON evidence. Native `Date` values are converted to `Temporal.Instant` only at database boundaries.

## Time Correction Adapter

The adapter replaces only the `time_correction` fail-closed production-registry entry. Other unmigrated time workflow types remain fail closed.

### Source Loading

Load the work period by exact organization and source ID, then validate:

- requester employee ownership and active organization membership;
- exact `approvalWorkflowId` for decisions and cancellation;
- canonical record organization, employee, and work-record kind;
- original endpoint IDs and active state;
- immutable correction payload;
- correction rows, endpoint types, lineage, organization, employee, and inactive pending state;
- each correction row's UTC instant and local timezone evidence.

### Routing

Build canonical routing context with:

- workflow type `time_correction`;
- source alias `time_entry` and work-period ID;
- requester employee and trusted team IDs;
- location when trusted source data supplies one, otherwise null;
- null absence category and travel amount;
- trusted overtime risk when already calculated, otherwise null;
- trusted employee-group IDs only when loaded.

Missing default manager is permitted when an active policy matches a specific employee or organization admin. No matching policy and no default route fails before durable creation.

### Terminal Approval

The adapter uses one transaction-bound finalizer shared with legacy decisions. It:

1. Locks the scoped work period and original endpoints.
2. Revalidates immutable correction IDs and lineage.
3. Confirms originals remain active and corrections remain inactive.
4. Calculates the corrected period while preserving an untouched endpoint.
5. For deletion, requires both endpoint corrections and zero-duration semantics.
6. Activates only requested correction rows.
7. Supersedes only corresponding originals.
8. Updates the work period with expected endpoint/status/link CAS predicates.
9. Synchronizes the canonical time record with exact organization, employee, record kind, and affected-row evidence.

Intermediate stage approvals never mutate the work period. Requester auto-approval invokes the terminal finalizer exactly once before commit.

### Terminal Rejection

Rejection keeps originals active and correction rows inactive. For metadata-less historical requests only, retain the existing behavior that reactivates originals identified by exact organization, employee, work-period endpoint, and correction-lineage evidence. The canonical time record and work period remain unchanged.

### Cancellation Capability

The adapter permits cancellation only when:

- the workflow and legacy request are pending;
- the actor is the requester employee;
- all correction rows remain inactive and unsuperseded;
- the original work period and endpoints still match captured lineage.

Approved, rejected, expired, or already applied corrections cannot be cancelled. Managers and admins do not receive pending-cancellation authority in this phase.

## Creation Paths

The following approval-producing paths use the shared rollout boundary:

- modular time-correction server action;
- time-entry deletion request;
- REST self-service correction;
- any still-reachable monolithic correction action;
- demo-data correction creation.

Each path uses one repository-owned transaction for correction rows, workflow/legacy approval state, source binding, canonical projection, and observe-only outbox. Demo corrections follow the same inactive-pending semantics and cannot insert a standalone active correction plus legacy request.

Direct same-day edits and authorized manager/admin corrections that apply immediately remain on their current non-approval path. They must reject or conflict when a pending correction workflow already protects the same work period.

Existing responses remain stable:

- server actions return `ServerActionResult<{ approvalId; status }>`;
- REST self-service returns HTTP 201 with `entry`, `approvalId`, and the existing message.

## Decision Flow

Legacy/shadow/ready keep the existing decision service authoritative. Shadow/ready run capture-before, legacy request/chain mutation, terminal source finalization when applicable, capture-after, and canonical mirror inside one repository transaction.

Canonical/complete resolve the stable inbox target, exact workflow link, current version, and authenticated actor inside the transaction, then call `transitionEngine.executeInTransaction`. Receipt replay cannot mutate a later stage or repeat source finalization.

Expected engine conflicts and authorization failures retain typed HTTP semantics. Legacy delegated-manager authorization is revalidated transactionally and bound to request CAS evidence.

## Pending Cancellation Flow

Add one authenticated requester cancellation boundary for pending time corrections. It returns `Promise<{ success: boolean; error?: string }>` and never accepts caller-supplied actor or organization authority.

Inside one repository transaction:

- reload and verify the authenticated requester, source, workflow link, correction payload, correction rows, originals, and canonical record;
- acquire and validate rollout authority;
- reject any applied, active, superseded, terminal, or stale correction evidence;
- legacy mode cancels/removes the pending legacy request/chain and deletes only the inactive correction rows;
- shadow/ready capture live state, cancel legacy state, capture terminal evidence while source exists, mirror cancellation, then delete inactive correction rows;
- canonical/complete transition workflow history to cancelled and let the adapter delete inactive correction rows;
- leave original entries, work period endpoints, and canonical time record unchanged.

No cancellation side effect runs before commit. Replayed canonical cancellation returns success without duplicate post-commit delivery.

## Timekeeping Rules

All modified correction business logic uses Temporal:

- event timestamps are `Temporal.Instant`;
- employee-local dates derive from an explicit trusted IANA timezone;
- dirty balance dates use the employee's calendar date, not UTC date or viewer timezone;
- submitted RFC3339 offsets must agree with the selected IANA zone at that instant;
- clock-in and clock-out retain independent timezone/offset evidence for travel cases;
- database `Date` conversion occurs only through shared Temporal adapters.

Existing external API timestamp formats remain unchanged.

## Side Effects

Legacy/shadow/ready preserve current post-commit manager submission email, requester decision notification, and work-balance maintenance. Failures are best effort after commit and do not turn a committed request into a failed public result.

Canonical/complete create observe-only outbox intent and dispatch no direct external side effects during Phase 4. External delivery remains Phase 6 work.

## Handler And Read Safety

Touched handler and detail queries add exact `organizationId` predicates for actor, work period, approval request, correction rows, and endpoints. Pending metadata-linked inactive corrections render correctly. Existing payloads and redaction remain stable; this phase does not replace inbox reads with canonical projections.

## Failure Semantics

- Invalid subtype, source identity, actor, policy, metadata, endpoint lineage, timezone evidence, or workflow link fails before mutation.
- Stale originals or corrections produce conflict and leave workflow/source unchanged.
- Capture, mirror, source binding, correction mutation, canonical parity, projection, outbox, or cancellation failure rolls back the complete transaction.
- Source mutation occurs exactly once at terminal approval.
- Idempotency receipt replay cannot advance another stage or duplicate post-commit behavior.
- Errors do not expose private correction metadata or cross-organization existence.

## Write Ownership

Canonical workflow writes remain owned by repository, compatibility, projection, and outbox modules. The time-correction adapter does not write canonical workflow tables directly.

Temporary direct legacy exceptions are removed only when the corresponding creation/decision path no longer writes protected request/chain tables. Any retained exception remains exact path/table/operation scoped. Demo and monolithic bypasses cannot receive broad exceptions.

## Tests

Tests cover:

- exact legacy capture and subtype rejection;
- clock-in-only, clock-out-only, two-endpoint edit, and deletion requests;
- independent endpoint timezone evidence and offset-zone agreement;
- policy/default routing and requester auto-approval;
- legacy, shadow, ready, canonical, and complete submission/decision modes;
- terminal approval and rejection;
- intermediate stages and parallel reviewers;
- pending requester cancellation in every mode;
- rejection of manager cancellation and approved cancellation;
- original/correction/work-period/canonical-record CAS races;
- approval-versus-cancellation concurrency;
- exact rollback across correction, workflow, projection, outbox, and legacy rows;
- canonical receipt replay and stable inbox targets;
- organization, employee, source, workflow, and endpoint isolation;
- stable server-action and REST responses;
- repeated correction cycles, exact submission replay, one pending-cycle winner, and terminal workflow history retention;
- no duplicate or pre-commit side effects;
- write-boundary inventory and production registry completeness.

PostgreSQL-gated tests verify endpoint locks, affected-row CAS, FK behavior, rollback, and concurrent approval/cancellation winners using only the existing disposable harness.

## Exit Criteria

- Every approval-producing correction path crosses the rollout boundary.
- Shadow/ready dual-write atomically while legacy remains authoritative.
- Canonical/complete paths are implemented and tested but remain disabled.
- Partial corrections, deletion, rejection, and auto-approval preserve current behavior.
- Pending requester cancellation is atomic and cannot alter original applied time.
- Canonical parity and dirty dates are employee/timezone correct.
- Direct non-approval corrections cannot invalidate a pending correction workflow silently.
- Public responses and legacy/shadow side effects remain stable.
- Focused correction, workflow, ownership, Temporal, typecheck, Biome, build, and broad approval regressions pass.
