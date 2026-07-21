# Absence Approval Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate absence submission, terminal decisions, and cancellation through the organization-scoped approval workflow boundary while preserving current public behavior and Phase 4 shadow authority.

**Architecture:** Existing absence flows remain the outer transaction owners through the repository transaction wrapper. Legacy and shadow/ready paths keep existing domain behavior, with shadow/ready capturing and mirroring legacy state atomically; canonical/complete paths use a reusable workflow-start boundary and the registered absence adapter. Cancellation becomes transactionally race-safe while retaining source hard deletion and current post-commit side effects.

**Tech Stack:** TypeScript, Next.js 16 server actions, Drizzle ORM, PostgreSQL, Effect, Temporal, Vitest, canonical approval repository/transition engine, pnpm.

**Design:** `docs/superpowers/specs/2026-07-18-absence-approval-adapter-design.md`

**Constraints:** Work only in `/home/kai/projekte/z8/.worktrees/approval-workflow-rewrite`. Do not commit, apply migrations, enable canonical rollout modes, build outbox delivery, change public response shapes, or edit `src/db/auth-schema.ts`. Preserve unrelated concurrent changes. Read `docs/refs/timekeeping.md` before Task 9.

---

## File Map

- Create `apps/webapp/src/lib/approvals/domain-adapters/absence-legacy-state.ts`: exact organization-scoped legacy capture for absence submission, decision, and cancellation.
- Create `apps/webapp/src/lib/approvals/domain-adapters/absence-legacy-state.test.ts`: source/request/chain capture and malformed-scope tests.
- Create `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.ts`: pure verified legacy evidence to canonical transition planning.
- Create `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.test.ts`: submission, decision, cancellation, chain, and idempotency planning tests.
- Create `apps/webapp/src/lib/approvals/workflow/identity.ts`: deterministic scoped workflow child identity derivation shared by observation and start.
- Create `apps/webapp/src/lib/approvals/workflow/identity.test.ts`: scope and stability tests for deterministic IDs.
- Create `apps/webapp/src/lib/approvals/domain-adapters/absence.adapter.ts`: concrete absence source, routing, terminal finalization, projection, and cancellation capability.
- Create `apps/webapp/src/lib/approvals/domain-adapters/absence.adapter.test.ts`: adapter contract tests.
- Create `apps/webapp/src/lib/approvals/domain-adapters/production-registry.ts`: real absence adapter plus explicit fail-closed entries for domains not yet migrated.
- Create `apps/webapp/src/lib/approvals/domain-adapters/production-registry.test.ts`: complete-map and fail-closed staged-rollout tests.
- Create `apps/webapp/src/lib/approvals/workflow/start-workflow.ts`: generic transaction-bound initial workflow orchestration.
- Create `apps/webapp/src/lib/approvals/workflow/start-workflow.test.ts`: start idempotency, routing, activation, auto-approval, and rollback tests.
- Create `apps/webapp/src/lib/approvals/workflow/runtime.ts`: production actor, authorization, source-loader, and result-builder composition.
- Create `apps/webapp/src/lib/approvals/workflow/runtime.test.ts`: organization scope, requester/assignment/admin authorization, and result construction tests.
- Modify `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`: concrete transaction-bound canonical-to-legacy request/chain row writer.
- Modify `apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts`: canonical-to-legacy row persistence and cancellation tests.
- Modify `apps/webapp/src/lib/approvals/workflow/ports.ts`: initial aggregate persistence contract.
- Modify `apps/webapp/src/lib/approvals/workflow/repository.ts`: scoped idempotent initial aggregate/event persistence.
- Modify `apps/webapp/src/lib/approvals/workflow/repository.test.ts`: initial persistence unit tests.
- Modify `apps/webapp/src/lib/approvals/workflow/repository.integration.test.ts`: PostgreSQL atomic initial persistence tests.
- Modify `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`: transaction-bound execution and runtime dependency scoping.
- Modify `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`: transaction reuse and requester authorization tests.
- Modify `apps/webapp/src/lib/approvals/server/absence-approvals.ts`: reusable transaction-bound terminal finalizer and rollout-aware legacy decisions.
- Modify `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`: legacy/shadow/canonical decision routing tests.
- Modify `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts`: rollout-aware submission in the existing transaction.
- Modify `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.test.ts`: submission mode, workflow link, and rollback tests.
- Modify `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts`: transaction-bound cancellation and post-commit side effects.
- Modify `apps/webapp/src/app/[locale]/(app)/absences/mutations.test.ts`: cancellation scope, race, rollback, and side-effect tests.
- Modify `apps/webapp/src/lib/approvals/handlers/absence-request.handler.ts`: organization-scope touched detail/batch reads.
- Modify `apps/webapp/src/lib/approvals/handlers/absence-request.handler.test.ts`: scoped read and stable dispatch tests.
- Modify `apps/webapp/src/lib/approvals/domain-adapters/registry.test.ts`: concrete absence registration and approved-cancellation authorization.
- Modify `apps/webapp/src/lib/approvals/approval-write-boundary.ts`: remove only superseded absence exceptions after production wiring no longer needs them.
- Modify `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`: exact updated ownership map and inventory.

### Task 1: Capture Verified Absence Legacy State

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/absence-legacy-state.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/absence-legacy-state.test.ts`

- [ ] **Step 1: Write failing capture tests**

Define the desired transaction-bound API in tests:

```ts
const state = await captureAbsenceLegacyApprovalState({
  dbService,
  organizationId: "org-1",
  absenceId: "10000000-0000-4000-8000-000000000001",
  capturedAt: parseInstant("2026-07-18T09:00:00Z"),
});

expect(state).toMatchObject({
  organizationId: "org-1",
  source: {
    organizationId: "org-1",
    workflowType: "absence",
    sourceType: "absence_entry",
    sourceId: "10000000-0000-4000-8000-000000000001",
  },
});
```

Cover no approval request, a direct request, a policy chain with ordered rows, requester auto-completion, rejection, and cancellation represented by `before.approvalRequest !== null` then `after.approvalRequest === null` while the source still exists. Assert all SQL/query predicates include `organizationId` and exact entity type/id.

- [ ] **Step 2: Run the capture suite and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/domain-adapters/absence-legacy-state.test.ts
```

Expected: FAIL because `absence-legacy-state.ts` does not exist.

- [ ] **Step 3: Implement the exact capture contract**

Export:

```ts
export interface CaptureAbsenceLegacyApprovalStateInput {
  dbService: ApprovalDbService;
  organizationId: string;
  absenceId: string;
  capturedAt: Instant;
}

export async function captureAbsenceLegacyApprovalState(
  input: CaptureAbsenceLegacyApprovalStateInput,
): Promise<VerifiedLegacyApprovalState>;
```

Load the scoped `absence_entry`, its scoped `approval_request`, optional `approval_chain_instance`, and ordered `approval_chain_stage_instance` rows through the caller's transaction. Convert database `Date` values only with `instantFromDB`/the existing Drizzle Temporal adapter. Build `sourceSnapshot` from stable business fields: absence ID, employee ID, organization ID, category ID, start/end dates and periods, status, rejection reason, approval actor/time, canonical record ID, and approval workflow ID.

Reject missing source, duplicate current request, foreign request/chain rows, chain rows without their scoped chain, and invalid timestamps before returning evidence.

- [ ] **Step 4: Add mutation and scope regressions**

Prove a foreign-organization request with the same source ID is ignored/rejected, request and chain identity cannot disagree, rows are sorted by `stepOrder`, and returned JSON/evidence cannot alias mutable database fixtures.

- [ ] **Step 5: Run tests and static checks**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/domain-adapters/absence-legacy-state.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/domain-adapters/absence-legacy-state.ts \
  src/lib/approvals/domain-adapters/absence-legacy-state.test.ts
```

Expected: all commands exit 0.

### Task 2: Plan Verified Legacy Observations

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.test.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/identity.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/identity.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.ts`

- [ ] **Step 1: Write failing pure planner tests**

Define:

```ts
export function createLegacyApprovalObservationPlanner(input: {
  clock: ApprovalEngineClock;
}): ApprovalLegacyObservationPlanner;
```

Feed exact `VerifiedLegacyApprovalState` pairs and assert deterministic `ObservedLegacyTransitionPlan` results for null-to-pending submission, null-to-approved all-auto submission, pending approval, pending rejection, pending-to-null cancellation, and multi-stage chain advancement. Assert no adapter/domain finalizer is accepted or invoked.

- [ ] **Step 2: Run planner tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/legacy-observation-planner.test.ts
```

Expected: FAIL because the planner module does not exist.

- [ ] **Step 3: Implement deterministic legacy interpretation**

Validate exact before/after scope and derive authoritative status in this order: chain status when a chain exists; request status for direct requests; disappearance of a previously pending request as cancellation; otherwise reject an ambiguous transition. Materialize ordered stages from chain rows and a single direct stage for a request without a chain. Preserve stable legacy request IDs on stages.

Extract the repository's existing SHA-1 UUIDv5-style normalization into `identity.ts`. Export scoped derivation functions for workflow, stage, assignment, and event IDs; every function includes organization and workflow/source identity plus its stable allocation key. Update repository allocation to use the same helper without changing existing IDs.

Use those deterministic IDs with stable legacy IDs as allocation keys. Produce only existing event types, contiguous versions/indexes, requester/inbox projection input, and `observe` outbox inputs. Copy the verified `sourceSnapshot` into canonical display/context evidence only after stable-data normalization.

- [ ] **Step 4: Add fail-closed and replay tests**

Reject foreign organizations, source changes, duplicate stage order, a request that does not belong to the active chain row, invalid status regressions, cancellation without a prior pending request, and changed evidence under the same idempotency key. Identical evidence must produce byte-equivalent plans.

- [ ] **Step 5: Run planner, compatibility, and repository suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts \
  src/lib/approvals/workflow/identity.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts \
  src/lib/approvals/workflow/repository.test.ts
```

Expected: all tests pass and source mutation count remains zero in the planner.

### Task 3: Implement The Concrete Absence Adapter

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/absence.adapter.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/absence.adapter.test.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/production-registry.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/production-registry.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/registry.test.ts`

- [ ] **Step 1: Write failing source and routing tests**

Create an adapter with explicit transaction-bound dependencies:

```ts
const adapter = createAbsenceApprovalAdapter({
  finalizeApprovedAbsence,
  finalizeRejectedAbsence,
  deleteCancelledAbsence,
});

expect(adapter.workflowType).toBe("absence");
expect(adapter.sourceType).toBe("absence_entry");
```

Assert `loadSource` requires exact organization/source/workflow identity and independently validates requester, category, team, canonical time record, and `approvalWorkflowId`. For a valid source, assert routing output exactly contains `teamIds`, `locationId: null`, `absenceCategoryId`, empty employee groups, and null amount/risk.

- [ ] **Step 2: Run adapter tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/domain-adapters/absence.adapter.test.ts
```

Expected: FAIL because the adapter module does not exist.

- [ ] **Step 3: Extract one reusable terminal finalizer**

In `absence-approvals.ts`, retain existing Effect/public wrappers but expose a transaction-bound function used by both legacy and adapter paths:

```ts
export async function finalizeAbsenceTerminalInTransaction(input: {
  dbService: ApprovalDbService;
  organizationId: string;
  absenceId: string;
  actorEmployeeId: string;
  actorUserId: string;
  transition:
    | { kind: "approve" }
    | { kind: "reject"; reason: string };
  finalizedAt: Instant;
}): Promise<ApprovedAbsenceResult | RejectedAbsenceResult>;
```

Define `RejectedAbsenceResult` beside `ApprovedAbsenceResult` as the scoped updated absence plus the optional work-balance dirty mark; it carries no post-commit service result.

Move no post-commit behavior into this function. Use guarded `(id, organizationId, expected pending status)` updates, existing sick/vacation override logic, and scoped canonical time-record parity updates. A zero-row update is a stale/not-found failure.

- [ ] **Step 4: Implement the adapter**

Implement all existing `ApprovalDomainAdapter<AbsenceApprovalSource>` methods. `getTrustedCapabilities` returns true only when the source is approved, belongs to the requester/actor employee, and its parsed `startDate` is after the injected organization-local current date. `preflightTerminal` rejects incompatible source states. `finalizeTerminal` delegates approve/reject to the shared finalizer and pending/approved cancellation to the injected scoped delete function.

Return exact finalization evidence:

```ts
{
  organizationId,
  workflowId: workflow.id,
  sourceIdentity,
  transitionKind: transition.kind,
  terminalStatus: transition.to,
  sourceSnapshot,
  eventPayload,
  compatibilityPayload,
  finalizedAt,
}
```

`projectDisplay` includes only non-sensitive requester/inbox fields; do not expose `sickDetail`.

- [ ] **Step 5: Add terminal and cancellation capability tests**

Cover approve/reject, intermediate-stage no finalizer call, pending cancellation, approved future owner cancellation, approved started absence rejection, manager/admin approved cancellation rejection, canonical time-record parity, and cross-organization linked records. Verify no adapter method opens a nested transaction or dispatches external side effects.

- [ ] **Step 6: Prove registry-issued cancellation authorization**

Extend `registry.test.ts` with a concrete absence source map entry. Assert authorization succeeds only for the exact organization/workflow/source and eligible owner, and copied/lookalike capabilities remain rejected.

Create `createProductionApprovalDomainAdapterRegistry({ absence })`. Register the concrete absence adapter and explicit fail-closed adapters for the six not-yet-migrated workflow types. Each unmigrated adapter exposes the exact workflow/source type but throws `ApprovalDomainNotMigratedError` from every operational method before reading or writing. Tests assert all seven keys are present, absence resolves to the concrete adapter, and every unmigrated type fails without invoking a database callback. Remove each fail-closed entry only when its later Phase 4 adapter lands.

- [ ] **Step 7: Run adapter and legacy finalizer suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/absence.adapter.test.ts \
  src/lib/approvals/domain-adapters/production-registry.test.ts \
  src/lib/approvals/domain-adapters/registry.test.ts \
  src/lib/approvals/server/absence-approvals.test.ts
```

Expected: all tests pass and current public behavior remains unchanged.

### Task 4: Add Initial Workflow Persistence

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.integration.test.ts`

- [ ] **Step 1: Write failing repository contract tests**

Add this transaction-port method:

```ts
createInitialWorkflow(input: {
  snapshot: ApprovalWorkflowSnapshot;
  events: ApprovalWorkflowEventSnapshot[];
  submissionKey: string;
}): Promise<
  | { kind: "created"; snapshot: ApprovalWorkflowSnapshot }
  | { kind: "existing"; snapshot: ApprovalWorkflowSnapshot }
  | { kind: "source_conflict" }
>;
```

Test exact organization/source/workflow identity, non-empty submission key, version/event ordering, child scope, one pending workflow per source, idempotent replay with identical payload, and conflict for the same source/key with different immutable submission data.

Also test exported deterministic ID derivation for the workflow and ordered stages. The same organization/source/submission key and stage sequence must reproduce IDs; changing any scoped input must change them.

- [ ] **Step 2: Run repository tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/repository.test.ts -t "initial workflow"
```

Expected: FAIL because `createInitialWorkflow` is absent.

- [ ] **Step 3: Implement repository-owned inserts**

Use `deriveApprovalWorkflowId` and `deriveApprovalChildId` from `identity.ts`. Derive workflow identity from organization/workflow/source/submission key and stage identity from organization/workflow ID/sequence. Assignment and event IDs continue through the same shared deterministic allocation path.

Acquire a transaction advisory lock derived from the exact organization/workflow/source identity before checking for an existing workflow. Persist the root, ordered stages, assignments, and immutable activation/auto-approval events through parameterized SQL in the caller transaction. Do not call projection/outbox writers from the repository. Load all statuses by exact `(organizationId, workflowType, sourceType, sourceId)`, not only the partial pending index. Return `existing` only when source identity, requester, snapshots, stages, events, and submission key match exactly; otherwise return `source_conflict`. Deterministic identities make exact replay comparison stable.

Use the existing hydration and strict event/snapshot validation helpers rather than creating permissive decoders.

- [ ] **Step 4: Add PostgreSQL atomicity tests**

Using only the existing disposable PostgreSQL harness, prove root/children/events commit together, duplicate starts converge to one workflow, foreign organization rows do not satisfy replay, and an injected child/event failure rolls back the root.

- [ ] **Step 5: Run repository verification**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/workflow/repository.test.ts \
  src/lib/approvals/workflow/repository.integration.test.ts
```

Expected: unit tests pass; integration tests pass when the label-owned disposable database is available and otherwise use the existing explicit skip behavior.

### Task 5: Implement Generic Workflow Start

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/start-workflow.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/start-workflow.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`

- [ ] **Step 1: Write failing start-boundary tests**

Define the transaction-bound API:

```ts
const result = await startApprovalWorkflow({
  context,
  organizationId: "org-1",
  workflowType: "absence",
  sourceIdentity,
  requesterEmployeeId: "employee-1",
  actor,
  submissionKey: "absence-submit:absence-1",
  defaultApproverEmployeeId: "manager-1",
  routingContext,
  displayProjection,
  bindSourceWorkflow: async (workflowId) => bindWorkflow(workflowId),
});
```

`defaultApproverEmployeeId` is `string | null`; it is required only when no active policy matches. Cover exact gate behavior (`canonical` and `complete` only), rejection in `legacy`/`shadow`/`ready`, source binding after aggregate persistence but before projection/outbox, active policy selection, default route, initial human assignment, consecutive requester-auto-approved stages, all-auto terminal approval, idempotent replay without rebinding, source conflict, projection/outbox writes, and failure rollback propagation.

- [ ] **Step 2: Run start tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/start-workflow.test.ts
```

Expected: FAIL because `start-workflow.ts` does not exist.

- [ ] **Step 3: Load and match routing policy inside the transaction**

Query active organization policies with their ordered conditions/stages through `context.dbService`. Pass decoded drafts to `findMatchingRoutingPolicy`. Map a matched stage to the existing activation resolver snapshot:

```ts
{
  approverType: stage.approverType,
  fallbackBehavior: stage.fallbackBehavior,
  ...(stage.approverEmployeeId
    ? { approverEmployeeId: stage.approverEmployeeId }
    : {}),
}
```

When no policy matches, create one stage using the trusted `defaultApproverEmployeeId` as `specific_employee` with `fail` fallback. Reject an absent default route before persistence or source binding.

- [ ] **Step 4: Build and activate the initial aggregate**

Allocate the workflow/stage identities once, build the waiting stage graph, and resolve the first stage through `context.activationResolver`. Use existing pure state-machine activation planning for requester auto-approval and continue until a human stage or terminal approval. Enforce a pass limit of `stages.length + 1`.

Persist the existing event vocabulary emitted by activation planning: `stage.activated`, `assignment.created`, `stage.auto_approved`, `workflow.activation_requested`, and terminal `workflow.approved` where applicable. Do not add a new event enum or migration. Keep contiguous `(version, eventIndex)` values and exact actor identities. Do not invoke the terminal adapter finalizer for requester auto-approved submission; the absence caller owns its existing auto-completion finalizer in the same transaction.

- [ ] **Step 5: Persist projection and observe-only outbox**

Call `repository.createInitialWorkflow`; for a newly created result, call `bindSourceWorkflow` with that persisted workflow ID, then `projectionWriter.write` and `outboxWriter.write`. Every start outbox input uses `disposition: "observe"`. Existing replay verifies that the source is already linked to the returned workflow and does not bind or emit projection/outbox effects again. A binding failure rolls back initial persistence because every step uses the caller transaction.

- [ ] **Step 6: Run start, state-machine, and activation tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/workflow/start-workflow.test.ts \
  src/lib/approvals/workflow/state-machine.test.ts \
  src/lib/approvals/routing/policy-matcher.test.ts \
  src/lib/approvals/routing/stage-activation-resolver.test.ts
```

Expected: all tests pass with deterministic stage/event ordering.

### Task 6: Compose Production Transition Dependencies

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/runtime.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/runtime.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`

- [ ] **Step 1: Write failing transaction-bound dependency tests**

Require actor resolution and source loading to receive the repository transaction service:

```ts
actorResolver.resolve({ dbService, organizationId, principal });
sourceLoader.load({ dbService, organizationId, workflow, actor });
authorization.authorize({ dbService, organizationId, workflow, actor, command });
```

Cover inactive/foreign employees, exact user-to-employee binding, active assignment approval, requester cancellation, injected `manage Approval` authorization, system expiry, and denial of unrelated employees. Assert every database lookup uses `organizationId`.

- [ ] **Step 2: Run runtime tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/workflow/runtime.test.ts \
  src/lib/approvals/workflow/transition-engine.test.ts
```

Expected: FAIL because runtime dependencies and transaction-bound port fields are absent.

- [ ] **Step 3: Make engine dependencies transaction-bound**

Add `dbService` to `ApprovalCommandActorResolver.resolve`, `ApprovalWorkflowAuthorization.authorize`, and `ApprovalWorkflowSourceLoader.load`. Pass `context.dbService` from the transition engine. Extend authorization results with `requester`, allowed only for `cancel`; retain `active_assignment` for approve/reject, `manage_approval` for authorized management, and `system` for the established internal commands.

Expose a transaction-bound engine method:

```ts
executeInTransaction(
  context: ApprovalWorkflowTransactionContext,
  request: ApprovalWorkflowCommandRequest,
): Promise<ApprovalCommandResult>;
```

The existing `execute(request)` becomes a thin `repository.withTransaction` wrapper around it. Tests prove both paths are identical and `executeInTransaction` never opens another transaction.

- [ ] **Step 4: Implement production dependency factories**

Export:

```ts
export function createDatabaseApprovalCommandActorResolver(): ApprovalCommandActorResolver;
export function createApprovalWorkflowAuthorization(input: {
  canManageApproval: (input: {
    organizationId: string;
    actorEmployeeId: string;
  }) => Promise<boolean>;
}): ApprovalWorkflowAuthorization;
export function createRegistryApprovalSourceLoader(
  registry: ApprovalDomainAdapterRegistry,
): ApprovalWorkflowSourceLoader;
export function createApprovalTransitionResultBuilder(): ApprovalTransitionResultBuilder;
export function createApprovalWorkflowRuntime(input: {
  db: ApprovalWorkflowDatabase;
  adapterRegistry: ApprovalDomainAdapterRegistry;
  canManageApproval: (input: {
    organizationId: string;
    actorEmployeeId: string;
  }) => Promise<boolean>;
  clock?: Clock;
}): {
  repository: ApprovalWorkflowRepository;
  transitionEngine: ApprovalTransitionEngine;
};
```

The actor resolver loads one active employee by `(organizationId, userId)`. Authorization checks system identity, active assignments, exact requester cancellation, then the injected existing CASL-backed `manage Approval` decision. The source loader delegates to the registered adapter with the same `dbService` and exact workflow source identity.

The result builder accepts the immutable materialized batch and optional adapter finalization, returns the last snapshot, preserves every event in batch order, builds requester/inbox projection status from the terminal snapshot, and creates only `observe` outbox rows in Phase 4. It must not mutate its inputs or call external services.

The runtime factory composes the repository with `createLegacyApprovalObservationPlanner`, the transaction-bound legacy row-writer factory, the production registry, the database actor/source/authorization dependencies, the result builder, and the clock. It is the only default production composition used by absence submission/decision/cancellation; tests may still inject narrow fakes.

- [ ] **Step 5: Add result and replay regressions**

Cover multi-pass activation event order, terminal finalization evidence, cancellation source deletion, immutable inputs, duplicate event/dedupe rejection, and exact organization/workflow/source consistency. Re-run existing transition-engine mutation-defense tests.

- [ ] **Step 6: Implement the transaction-bound legacy row writer**

Change repository composition from a prebuilt `transactionBoundLegacyRowWriter` to:

```ts
createLegacyRowWriter: (dbService: ApprovalDbService) => LegacyApprovalRowWriter;
```

Export `createLegacyApprovalRowWriter(dbService)` from `compatibility-writer.ts`. It writes only through that transaction service. For canonical pending workflows, upsert exact organization/source-scoped `approval_request`, chain instance, and ordered chain-stage rows using repository-allocated stable request IDs. Approval/rejection updates the matching rows and closes siblings. Cancellation removes the pending request and marks chain rows cancelled because `approval_request` has no cancelled status. Every predicate includes organization, entity type/id, stable ID, and expected current status; affected-row mismatches fail closed.

Tests cover direct and multi-stage workflows, stable replay, approval, rejection, cancellation, foreign mappings, and rollback propagation. No domain source mutation occurs in this writer.

- [ ] **Step 7: Run runtime and engine suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/workflow/runtime.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts \
  src/lib/approvals/workflow/repository.test.ts \
  src/lib/approvals/workflow/transition-engine.test.ts \
  src/lib/approvals/workflow/ports.test.ts
```

Expected: all tests pass and no dependency reads outside the transaction service.

### Task 7: Wire Absence Submission Through Rollout Modes

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`

- [ ] **Step 1: Write failing mode-routing tests**

Inject a transaction-bound approval workflow dependency into `createRequestedAbsenceRecordsInTransaction` and cover:

```ts
approvalLifecycle: {
  withApprovalTransaction,
  startCanonicalWorkflow,
}
```

Assert legacy calls current approval creation only; shadow/ready call capture-before, current creation, capture-after, mirror; canonical/complete call start and never create a legacy request directly. Preserve `ServerActionResult<{ absenceId: string }>`.

- [ ] **Step 2: Run submission tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/absences/request-absence-effect.test.ts' \
  src/lib/approvals/server/absence-approvals.test.ts
```

Expected: new mode-routing assertions fail.

- [ ] **Step 3: Compose the transaction-bound rollout boundary**

For approval-producing submissions, make `runtime.repository.withTransaction` the outer transaction wrapper and perform the existing absence/canonical-record writes through `context.dbService.db`. This replaces, rather than nests inside, the current `dbService.db.transaction`. Submissions that require no approval may retain the existing plain transaction.

Inside that approval transaction context, construct the trusted source identity, actor, and submission key. Invoke `createLegacyApprovalWriteCoordinator` with `context.writeGate` and `context.compatibilityWriter` for legacy/shadow/ready behavior. Its `captureState` calls `captureAbsenceLegacyApprovalState` with `context.dbService` and a clock instant.

Build the default lifecycle dependency once through `createApprovalWorkflowRuntime` with `createProductionApprovalDomainAdapterRegistry({ absence })` and the existing CASL-backed `manage Approval` check for the authenticated principal. Tests inject `approvalLifecycle` and never replace global database modules.

For canonical/complete, invoke `startApprovalWorkflow` with the existing primary/default approver and a `bindSourceWorkflow` callback that performs a guarded `(absenceId, organizationId, approvalWorkflowId IS NULL)` update. In canonical mode, pass the start result through `compatibilityWriter.mirrorCanonicalToLegacy` before commit so rollback support remains available; complete mode performs no legacy mirror. Neither mode inserts legacy rows directly from the absence module.

- [ ] **Step 4: Preserve requester auto-completion**

When legacy or canonical start returns all stages auto-approved, call the existing absence terminal finalizer before commit so `absence_entry` and canonical time record become approved exactly once. Keep work-balance/calendar processing post-commit.

- [ ] **Step 5: Add rollback and response regressions**

Make capture-after, mirror, source binding, initial persistence, and auto-finalization fail independently. Assert absence entry, canonical records, workflow link, and approval rows all roll back. Assert successful calls still return only the existing absence ID payload.

- [ ] **Step 6: Run submission suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/absences/request-absence-effect.test.ts' \
  src/lib/approvals/domain-adapters/absence-legacy-state.test.ts \
  src/lib/approvals/workflow/start-workflow.test.ts
```

Expected: all tests pass in every rollout mode.

### Task 8: Wire Decisions Through The Adapter

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/absence-request.handler.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/absence-request.handler.test.ts`

- [ ] **Step 1: Write failing approve/reject routing tests**

For the stable `approveAbsenceEffect` and `rejectAbsenceEffect` entry points, cover legacy, shadow, ready, canonical, and complete. Assert shadow/ready observation shares the legacy decision transaction and canonical/complete call `transitionEngine.executeInTransaction` with exact organization/workflow/source/actor/idempotency identity.

- [ ] **Step 2: Run decision tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/absence-approvals.test.ts \
  src/lib/approvals/handlers/absence-request.handler.test.ts
```

Expected: mode-routing tests fail.

- [ ] **Step 3: Wrap legacy decisions in the coordinator**

Make `runtime.repository.withTransaction` the outer transaction owner for approval-producing legacy/shadow/ready decisions. Call `processApprovalWithCurrentEmployee` against `context.dbService` with nested transaction creation disabled. Capture-before occurs before request mutation and capture-after/mirror occur after chain/source finalization but before the repository transaction commits. Use expected workflow version from the exact scoped workflow when present; initial shadow observation uses null.

- [ ] **Step 4: Dispatch canonical decisions through the transition engine**

Load `absence_entry` and its exact organization-scoped `approvalWorkflowId`; reject a missing/mismatched link. Build approve/reject commands with existing actor resolution and stable idempotency keys. Call `transitionEngine.executeInTransaction(context, request)` so the engine uses the existing repository transaction. Let the transition engine invoke the absence adapter only when the workflow becomes terminal.

Canonical/complete paths do not dispatch direct calendar/email/notification handlers in Phase 4. Legacy/shadow/ready retain the existing once-after-commit handlers.

- [ ] **Step 5: Scope the existing handler reads touched by this wiring**

Add `organizationId` to absence batch/detail and approval-request predicates in `absence-request.handler.ts`. Preserve redaction and response payloads; do not migrate inbox reads or redesign handler output.

- [ ] **Step 6: Add multi-stage and replay tests**

Assert intermediate approval does not update the absence, final approval/rejection updates it once, requester auto-activation finalizes once, receipt replay does not repeat source mutation, cross-organization workflow IDs fail, and public results remain `ServerActionResult<void>`.

- [ ] **Step 7: Run decision and engine suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/absence-approvals.test.ts \
  src/lib/approvals/handlers/absence-request.handler.test.ts \
  src/lib/approvals/domain-adapters/absence.adapter.test.ts \
  src/lib/approvals/workflow/transition-engine.test.ts
```

Expected: all tests pass without changing public contracts.

### Task 9: Make Absence Cancellation Transactional

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/absence.adapter.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/absence.adapter.test.ts`

- [ ] **Step 1: Read the timekeeping reference**

Read `docs/refs/timekeeping.md`. Cancellation eligibility is based on the organization-local calendar date, not the viewer timezone.

- [ ] **Step 2: Write failing transactional cancellation tests**

Cover pending owner cancellation, pending admin cancellation, future approved owner cancellation, started approved rejection, rejected rejection, cross-organization IDs, approval-versus-cancellation compare-and-set, mirror failure, source-delete failure, and canonical-record-delete failure. Assert no calendar/manager notification occurs before commit or after rollback.

- [ ] **Step 3: Run cancellation tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/absences/mutations.test.ts' \
  src/lib/approvals/domain-adapters/absence.adapter.test.ts
```

Expected: atomicity and pre-commit side-effect tests fail against the current `Promise.all` implementation.

- [ ] **Step 4: Move authorization and date checks inside one transaction**

After billing authorization, open one `runtime.repository.withTransaction`, acquire the rollout gate inside it, and branch by the validated mode. Canonical/complete call `transitionEngine.executeInTransaction(context, request)`; no path nests another transaction. Inside the owning transaction, reload absence, organization timezone, actor/employee ownership, workflow link, legacy request/chain, and canonical record by `organizationId`. Replace Luxon in this modified flow with Temporal:

```ts
const today = clock
  .nowInstant()
  .toZonedDateTimeISO(organization.timezone ?? "UTC")
  .toPlainDate();
const startsAfterToday = comparePlainDates(parsePlainDate(absence.startDate), today) > 0;
```

Use the existing permission result but revalidate it against transaction-loaded state.

- [ ] **Step 5: Implement mode-specific cancellation ordering**

Legacy performs guarded organization-scoped deletion in the transaction.

Shadow/ready performs: capture live state; guarded legacy approval-request/chain cancellation while source exists; capture state with the legacy request absent/cancelled; mirror `pending -> cancelled`; delete scoped absence and linked canonical records. Any failure rolls back all steps.

Canonical/complete calls `transitionEngine.executeInTransaction(context, request)` with the cancellation command. Approved cancellation obtains registry-issued authorization from the loaded eligible owner source. The adapter then deletes the source and linked canonical records after canonical cancellation persistence planning, within the same transaction.

- [ ] **Step 6: Guard deletes and defer side effects**

Every update/delete includes `organizationId`, exact IDs, and expected current status/link. Require expected affected-row counts. Publish calendar deletion and manager notification only after the transaction promise resolves. Keep the existing `{ success, error? }` response.

- [ ] **Step 7: Run cancellation and Temporal guards**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/absences/mutations.test.ts' \
  src/lib/approvals/domain-adapters/absence.adapter.test.ts \
  src/lib/datetime/temporal-source-guard.test.ts
```

Expected: all tests pass and cancellation code has no Luxon/native calendar arithmetic.

### Task 10: Tighten Write Ownership And Verify Phase 4.2

**Files:**
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary.ts`
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`
- Review all Phase 4.2 files above.

- [ ] **Step 1: Remove only superseded absence exceptions**

Run the production inventory first. Add the concrete compatibility owner operations required by Task 6, limited to the existing exact file:

```ts
"src/lib/approvals/workflow/compatibility-writer.ts": {
  approval_workflow_stage: ["update"],
  approval_request: ["insert", "update", "delete"],
  approval_chain_instance: ["insert", "update"],
  approval_chain_stage_instance: ["insert", "update"],
},
```

These are canonical-to-legacy compatibility ownership, not temporary domain exceptions. Then remove a temporary exception only when its exact production mutation has moved behind an approved owner. Expected candidates are:

```ts
"src/lib/approvals/server/absence-approvals.ts": {
  approval_request: ["insert"],
},
"src/app/[locale]/(app)/absences/mutations.ts": {
  approval_request: ["delete"],
},
```

If either file still directly owns the protected mutation for legacy compatibility, retain that exact operation and document why; do not widen another entry.

- [ ] **Step 2: Run the exact production inventory**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/approval-write-boundary.test.ts
```

Expected: PASS with zero unowned protected writes.

- [ ] **Step 3: Run focused Phase 4.2 suites**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/absence-legacy-state.test.ts \
  src/lib/approvals/domain-adapters/absence.adapter.test.ts \
  src/lib/approvals/domain-adapters/registry.test.ts \
  src/lib/approvals/workflow/start-workflow.test.ts \
  src/lib/approvals/workflow/repository.test.ts \
  src/lib/approvals/workflow/transition-engine.test.ts \
  src/lib/approvals/server/absence-approvals.test.ts \
  src/lib/approvals/handlers/absence-request.handler.test.ts \
  'src/app/[locale]/(app)/absences/request-absence-effect.test.ts' \
  'src/app/[locale]/(app)/absences/mutations.test.ts' \
  src/lib/approvals/approval-write-boundary.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Run type and static checks**

Run:

```bash
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/domain-adapters/absence-legacy-state.ts \
  src/lib/approvals/domain-adapters/absence-legacy-state.test.ts \
  src/lib/approvals/domain-adapters/absence.adapter.ts \
  src/lib/approvals/domain-adapters/absence.adapter.test.ts \
  src/lib/approvals/workflow/start-workflow.ts \
  src/lib/approvals/workflow/start-workflow.test.ts \
  src/lib/approvals/workflow/ports.ts \
  src/lib/approvals/workflow/repository.ts \
  src/lib/approvals/server/absence-approvals.ts \
  'src/app/[locale]/(app)/absences/request-absence-effect.ts' \
  'src/app/[locale]/(app)/absences/mutations.ts' \
  src/lib/approvals/handlers/absence-request.handler.ts \
  src/lib/approvals/approval-write-boundary.ts \
  src/lib/approvals/approval-write-boundary.test.ts
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Run the broader approval and absence regression suites**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals 'src/app/[locale]/(app)/absences'
```

Expected: all unit tests pass; existing explicitly environment-gated PostgreSQL tests may skip only through their established harness.

- [ ] **Step 6: Perform final security and scope review**

Verify every adapter/capture/cancellation query is organization-scoped; source/workflow links are exact; callbacks cannot mutate before authority validation; shadow writes cannot commit without observation; canonical modes remain disabled in rollout data; source mutation occurs exactly once; cancellation has no pre-commit side effects; no external outbox delivery was added; and public response shapes did not change.
