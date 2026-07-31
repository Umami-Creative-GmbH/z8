# Approval Domain Write Boundary Design

## Goal

Establish the transaction and ownership boundaries every Phase 4 domain adapter must use before migrating production approval submissions and decisions.

## Scope

- Add a transaction-bound coordinator for legacy-authoritative writes across all rollout modes.
- Require shadow and ready writes to capture verified before/after state and mirror legacy changes to canonical state in the same transaction.
- Reject legacy writes in canonical and complete modes before source or approval mutation.
- Add a static production-code guard that restricts writes to protected legacy and canonical approval tables by exact file, table, and operation.
- Preserve the existing adapter contract and registry rather than introducing a second domain-adapter abstraction.

## Non-Goals

- No production domain entrypoint migration in this increment.
- No concrete absence, time, travel, shift, or compliance adapter.
- No source-specific verified-state loader or observation planner.
- No schema or migration changes.
- No routing of legacy decisions into the canonical transition engine.
- No removal of existing legacy writers until their domain adapter is implemented.

## Legacy Write Coordinator

The coordinator runs inside a caller-owned transaction. It receives the transaction-bound `ApprovalWriteGate` and `ApprovalCompatibilityWriter`; it never opens a transaction.

Each execution supplies:

- Trusted `organizationId`, canonical `workflowType`, and complete `ApprovalSourceIdentity`.
- An optional `captureState` callback that returns `VerifiedLegacyApprovalState` from the same transaction; it is mandatory in shadow and ready modes.
- A `mutate` callback that performs one legacy-authoritative submission or decision and returns its domain result.
- Trusted actor, idempotency key, and expected canonical version for observation.

Execution order is fixed:

1. Acquire the rollout gate for organization and workflow type.
2. Reject unless legacy writes are authoritative for the mode.
3. In `legacy`, execute `mutate` and return its result without observation.
4. In `shadow` or `ready`, capture `before`, execute `mutate`, capture `after`, then call `mirrorLegacyToCanonical` before returning.
5. In `canonical` or `complete`, throw a typed boundary error before capture or mutation.

The coordinator validates that the trusted source identity matches the organization and workflow type input, then requires both captured states to match that exact source identity. It passes the exact caller actor, idempotency key, and expected version to the compatibility writer. A missing capture callback, null mirror result, scope mismatch, or compatibility failure in shadow/ready aborts the transaction. Shadow/ready may not silently degrade to unobserved legacy behavior.

## Workflow-Type Classification

Callers provide a canonical workflow type derived from trusted source evidence. Legacy `time_entry` is never accepted as a workflow type. Time flows must classify as `time_correction`, `manual_time_submission`, or `policy_clock_out`; unclassified requests fail before gate acquisition.

The coordinator does not infer workflow type from arbitrary entity strings or user input.

## Static Write Ownership Guard

The guard scans production TypeScript and executable scripts. It detects Drizzle mutations and raw SQL mutations, including aliases, namespace imports, upserts, writable CTEs, and same-file generic write helpers.

Protected legacy tables:

- `approval_request`
- `approval_chain_instance`
- `approval_chain_stage_instance`

Protected canonical tables:

- `approval_workflow`
- `approval_workflow_stage`
- `approval_stage_assignment`
- `approval_workflow_event`
- `approval_workflow_command`
- `approval_requester_projection`
- `approval_inbox_projection`
- `approval_outbox`
- `approval_outbox_delivery`
- `approval_workflow_rollout`
- `approval_workflow_migration_issue`

The allowlist uses normalized workspace-relative paths and allowed operation sets per table. It never exempts a directory by prefix.

Canonical ownership is restricted to:

- Workflow aggregate/event/command tables: `workflow/repository.ts`.
- Stage legacy-ID linkage only: `workflow/compatibility-writer.ts`.
- Requester/inbox projections: `projection/writer.ts`.
- Approval outbox insertion: `outbox/writer.ts`.
- Rollout bootstrap and transitions: `scripts/approval-workflow-rollout.ts`.
- Tables without an implemented owner remain deny-all.

Existing legacy writers are listed as exact temporary exceptions with only their current table/operation permissions. The guard output names the violating path, table, and operation. Adding another legacy writer requires an explicit reviewed allowlist change; adding a domain adapter should remove superseded exceptions.

## Security And Failure Semantics

- Every gate and observation is organization/workflow-type scoped.
- No callback can run before the gate result is validated.
- Canonical-authoritative modes cannot mutate legacy state through this boundary.
- Shadow/ready mutations and canonical observation share the same transaction and advisory lock.
- Parameterized repository and compatibility-writer SQL remains the only canonical persistence path.
- The coordinator returns domain results only after required observation succeeds.
- Errors expose stable boundary codes without leaking captured source data.

## Tests

- Coordinator tests cover all five lifecycle modes and exact operation ordering.
- Tests prove canonical/complete reject before capture and mutation.
- Shadow/ready tests prove capture-mutate-capture-mirror ordering and rollback propagation.
- Scope tests reject foreign organization, workflow type, and source identities.
- Time classification tests reject broad or unclassified legacy values.
- Guard tests cover direct Drizzle calls, aliases, namespace imports, raw SQL, upserts, writable CTEs, generic helpers, comments/strings, and exact allowlist behavior.
- Fixture tests prove every current production protected-table mutation is either owned or an explicit temporary legacy exception.
- Run coordinator, registry, compatibility, guard, and existing append-only guard suites, plus webapp typecheck, Biome on changed files, and `git diff --check`.
