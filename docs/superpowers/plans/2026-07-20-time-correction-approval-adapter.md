# Time Correction Approval Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every approval-producing time-correction path through the organization-scoped workflow boundary, preserve endpoint and response behavior, and add atomic requester cancellation for pending corrections.

**Architecture:** The work period is the stable workflow source while each correction submission has a cycle-specific deterministic identity, allowing immutable terminal history and at most one pending cycle. Legacy/shadow/ready retain legacy authority inside the repository transaction wrapper; canonical/complete use `startApprovalWorkflow`, the transition engine, and a concrete time-correction adapter. Immutable private correction lineage drives finalization, while sanitized projections and post-commit side-effect descriptors prevent data leakage and duplicate delivery.

**Tech Stack:** TypeScript, Next.js 16 server actions and route handlers, Drizzle ORM, PostgreSQL, Effect, Temporal, Vitest, canonical approval repository/transition engine, pnpm.

**Design:** `docs/superpowers/specs/2026-07-20-time-correction-approval-adapter-design.md`

**Constraints:** Work only in `/home/kai/projekte/z8/.worktrees/approval-workflow-rewrite`. Do not commit, apply migrations, enable canonical rollout modes, build external outbox delivery, change public response payloads, or edit `src/db/auth-schema.ts`. Preserve unrelated concurrent changes. Use Temporal for modified business-time logic, native `Date` only at database/external boundaries, and exact `organizationId` plus employee/source ownership predicates for every touched query.

---

## File Map

- Create `apps/webapp/drizzle/0056_approval_workflow_cycle_identity.sql`: replace the pending-source index with the exact canonical source tuple including workflow type.
- Create the corresponding generated Drizzle snapshot under `apps/webapp/drizzle/meta/` and update `apps/webapp/drizzle/meta/_journal.json`: record migration 0055 without applying it.
- Modify `apps/webapp/src/db/schema/approval-workflow.ts`: align the Drizzle partial unique index with exact source identity.
- Modify `apps/webapp/scripts/approval-workflow-schema-contract.ts`: require the exact pending index contract.
- Modify workflow schema/migration contract tests: verify the index and generated migration without connecting to a database.
- Modify `apps/webapp/src/lib/approvals/workflow/identity.ts`: expose deterministic cycle and correction-row identity helpers without changing existing namespaces.
- Modify `apps/webapp/src/lib/approvals/workflow/repository.ts`: allow terminal workflow history, serialize exact-source starts/observations, and reject only another pending cycle.
- Modify `apps/webapp/src/lib/approvals/workflow/start-workflow.ts`: preserve exact-cycle replay and prevent stale terminal replay from rebinding a moved source.
- Modify workflow identity, repository, start, observation, and integration tests: cover repeated cycles and one pending winner.
- Create `apps/webapp/src/lib/approvals/domain-adapters/time-correction-contract.ts`: normalized private payload, sanitized display evidence, submission key, correction-row IDs, and strict parsing.
- Create `apps/webapp/src/lib/approvals/domain-adapters/time-correction-contract.test.ts`: normalization, replay identity, endpoint independence, and redaction tests.
- Create `apps/webapp/src/lib/approvals/domain-adapters/time-correction-legacy-state.ts`: one-statement transaction-scoped capture of source, request, chain, endpoint, correction, timezone, and canonical-record evidence.
- Create `apps/webapp/src/lib/approvals/domain-adapters/time-correction-legacy-state.test.ts`: exact capture and malformed/foreign subtype tests.
- Modify `apps/webapp/src/lib/approvals/workflow/ports.ts`: separate private context evidence from safe display evidence for observations.
- Modify `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.ts`: use request/chain cycle identity and sanitized display payloads.
- Modify `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.test.ts`: repeated cycles, private-data redaction, and deterministic replay tests.
- Modify `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`: transaction-bound terminal finalizer, source binding, rollout-aware submission/decision composition, and post-commit descriptors.
- Modify `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`: finalizer CAS, modes, routing, replay, and side-effect tests.
- Create `apps/webapp/src/lib/approvals/domain-adapters/time-correction.adapter.ts`: concrete source loader, router, terminal finalizer, projection, and pending-cancellation capability.
- Create `apps/webapp/src/lib/approvals/domain-adapters/time-correction.adapter.test.ts`: adapter contract and isolation tests.
- Modify `apps/webapp/src/lib/approvals/domain-adapters/production-registry.ts`: register concrete absence and time-correction adapters while retaining fail-closed unmigrated domains.
- Modify registry/runtime tests and absence runtime composition call sites: supply both migrated adapters without changing absence behavior.
- Modify `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`: preserve normalized correction metadata in canonical-to-legacy request rows.
- Modify `apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts`: correction metadata, stage advancement, cycle isolation, and cancellation tests.
- Modify modular, monolithic, REST, and demo creation paths and their tests: route all approval-producing correction writes through one shared rollout boundary.
- Modify `apps/webapp/src/lib/effect/services/time-entry.service.ts` and tests: lock/revalidate direct corrections against pending approval protection before mutation.
- Modify `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`, legacy query code, and tests: transaction-safe decisions and organization-scoped metadata-first reads.
- Create `apps/webapp/src/lib/approvals/server/time-correction-cancellation.ts`: authenticated requester-only cancellation orchestration.
- Create `apps/webapp/src/lib/approvals/server/time-correction-cancellation.test.ts`: mode, ownership, stale-state, replay, and race tests.
- Modify My Requests action/read/UI files and tests: expose and dispatch pending correction cancellation without changing mobile cancellation support.
- Modify `apps/webapp/src/lib/approvals/approval-write-boundary.ts` and tests: remove only superseded correction exceptions and forbid monolithic/demo bypasses.
- Add PostgreSQL-gated integration coverage beside workflow repository tests: locks, affected-row CAS, rollback, repeated cycles, and approval-versus-cancellation winner.

### Task 1: Support Repeated Workflow Cycles

**Files:**
- Create: `apps/webapp/drizzle/0056_approval_workflow_cycle_identity.sql`
- Create: `apps/webapp/drizzle/meta/0055_snapshot.json`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Modify: `apps/webapp/src/db/schema/approval-workflow.ts`
- Modify: `apps/webapp/scripts/approval-workflow-schema-contract.ts`
- Modify: `apps/webapp/src/db/schema/__tests__/approval-workflow-schema.test.ts`
- Modify: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/rollout-schema-contract.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/identity.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/identity.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.integration.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/start-workflow.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/start-workflow.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.test.ts`

- [ ] **Step 1: Write failing schema, identity, and planner tests**

Require the partial unique index columns in this order:

```ts
expect(pendingSourceIndex.columns).toEqual([
  "organization_id",
  "workflow_type",
  "source_type",
  "source_id",
]);
expect(pendingSourceIndex.where).toContain("status = 'pending'");
```

Add identity tests proving `deriveApprovalWorkflowId` returns the same ID for one source/cycle key and a distinct ID for another cycle key. In observation planner tests, assert direct requests use `approvalRequest.id` and chain workflows use `chain.id` as `allocationKey`; pending and terminal snapshots of one request must retain one workflow ID, while a later request on the same work period gets a new ID.

- [ ] **Step 2: Write failing repository/start tests for terminal history**

Model these exact outcomes:

```ts
// Exact cycle, pending or terminal: idempotent replay.
expect(await repository.findInitialWorkflow(exactCycle)).toMatchObject({
  kind: "existing",
});

// Different pending cycle: source conflict.
expect(await repository.findInitialWorkflow(differentPendingCycle)).toEqual({
  kind: "source_conflict",
});

// Only unrelated terminal history: permit a new cycle.
expect(await repository.findInitialWorkflow(nextCycle)).toEqual({ kind: "none" });
```

Cover exact source locking with `organizationId`, `workflowType`, `sourceType`, and `sourceId`; multiple terminal histories; separate workflow types; exact terminal replay coexisting with a newer pending workflow; initial observed persistence under the same lock; source-link replacement rollback; and stale terminal replay after the source link has moved.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/db/schema/__tests__/approval-workflow-schema.test.ts \
  src/db/__tests__/drizzle-migrations.test.ts \
  src/lib/approvals/workflow/rollout-schema-contract.test.ts \
  src/lib/approvals/workflow/identity.test.ts \
  src/lib/approvals/workflow/repository.test.ts \
  src/lib/approvals/workflow/start-workflow.test.ts \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts
```

Expected: FAIL on the old three-column index, source-only advisory lock, all-history conflict behavior, and source-derived observation workflow ID.

- [ ] **Step 4: Implement exact-source cycle semantics and generate migration artifacts**

Keep the existing UUID derivation algorithm and namespaces. Change only the cycle allocation key supplied by callers. In repository preflight, look up the exact deterministic workflow ID and a different pending occupant for the exact source tuple; ignore unrelated terminal roots. Acquire the same exact-source advisory lock before canonical start and initial observed persistence. Preserve malformed-plan validation before the first SQL statement.

Create migration SQL with this semantic content, using the repository's generated quoting/style:

```sql
DROP INDEX "approvalWorkflow_org_source_pending_idx";
CREATE UNIQUE INDEX "approvalWorkflow_org_source_pending_idx"
ON "approval_workflow" USING btree (
  "organization_id", "workflow_type", "source_type", "source_id"
)
WHERE status = 'pending';
```

Generate the migration artifacts with:

```bash
pnpm --filter webapp exec drizzle-kit generate --name approval_workflow_cycle_identity
```

Expected: creates `drizzle/0056_approval_workflow_cycle_identity.sql`, `drizzle/meta/0056_snapshot.json`, and journal entry 0056. Inspect the generated SQL against the exact semantic SQL above; do not run `drizzle-kit push` or apply it. Teach `startApprovalWorkflow` that an exact terminal replay returns the existing result without planning or rebinding; a new cycle may bind over only a verified terminal link through the caller callback.

- [ ] **Step 5: Run unit, contract, and disposable PostgreSQL tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/db/schema/__tests__/approval-workflow-schema.test.ts \
  src/db/__tests__/drizzle-migrations.test.ts \
  src/lib/approvals/workflow/rollout-schema-contract.test.ts \
  src/lib/approvals/workflow/identity.test.ts \
  src/lib/approvals/workflow/repository.test.ts \
  src/lib/approvals/workflow/start-workflow.test.ts \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts \
  src/lib/approvals/workflow/repository.integration.test.ts
pnpm --filter webapp typecheck
```

Expected: all unit/contract tests pass; PostgreSQL tests pass when the disposable harness is available or report only the suite's established explicit skip when it is unavailable; typecheck exits 0.

### Task 2: Define Correction Identity And Safe Evidence

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/time-correction-contract.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/time-correction-contract.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/identity.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/identity.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.test.ts`

- [ ] **Step 1: Write failing normalized-contract tests**

Define and test this immutable contract:

```ts
export interface TimeCorrectionWorkflowPayload {
  timeCorrection: {
    action: "edit" | "delete";
    clockInCorrectionId?: string;
    clockOutCorrectionId?: string;
  };
}

export interface TimeCorrectionSubmissionIdentityInput {
  organizationId: string;
  workPeriodId: string;
  action: "edit" | "delete";
  clockIn?: { originalEntryId: string; instant: Instant };
  clockOut?: { originalEntryId: string; instant: Instant };
}

export interface TimeCorrectionEndpointEvidence {
  endpointType: "clock_in" | "clock_out";
  originalEntryId: string;
  correctionEntryId: string;
  instant: Instant;
  utcOffsetMinutes: number;
  timezone: string;
  timezoneSource: string;
}
```

Require at least one endpoint for edit, both endpoints for delete, distinct correction IDs, UUID syntax, normalized endpoint order, and no unknown payload keys. Prove a submission key is stable for one normalized request, differs when source/action/original/instant changes, and includes organization scope. Prove deterministic correction-row IDs are stable per submission key and endpoint type but distinct from each other.

- [ ] **Step 2: Write failing private/display separation tests**

Extend verified evidence with an explicit safe display snapshot:

```ts
export interface VerifiedLegacyApprovalState {
  // existing fields remain unchanged
  sourceSnapshot: JsonObject;
  displaySnapshot?: JsonObject;
}
```

Assert planner `contextSnapshot` retains the normalized private `timeCorrection` payload, while workflow display and requester/inbox projection payloads contain only work-period dates/status/requester-safe labels. Correction IDs, replacement IDs, raw notes, and internal timezone diagnostics must not appear in serialized display payloads. Existing absence evidence without `displaySnapshot` must retain its current fallback behavior.

- [ ] **Step 3: Run contract/planner tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/time-correction-contract.test.ts \
  src/lib/approvals/workflow/identity.test.ts \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts
```

Expected: FAIL because the correction contract, deterministic correction IDs, and safe display snapshot do not exist.

- [ ] **Step 4: Implement strict normalization and redaction**

Derive the submission key from stable normalized organization/source/action/original-entry/instant evidence, not random database IDs. Use the existing deterministic UUID machinery with a new namespaced helper for correction rows; do not change prior workflow/stage/assignment/event IDs. Return frozen/detached stable JSON from payload parsers. Update planner display/projection construction to use `displaySnapshot ?? sourceSnapshot`, while canonical context always uses private `sourceSnapshot`.

- [ ] **Step 5: Run focused tests and static checks**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/time-correction-contract.test.ts \
  src/lib/approvals/workflow/identity.test.ts \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts \
  src/lib/approvals/workflow/repository.test.ts
pnpm --filter webapp exec biome check \
  src/lib/approvals/domain-adapters/time-correction-contract.ts \
  src/lib/approvals/domain-adapters/time-correction-contract.test.ts \
  src/lib/approvals/workflow/identity.ts \
  src/lib/approvals/workflow/ports.ts \
  src/lib/approvals/workflow/legacy-observation-planner.ts
```

Expected: all commands exit 0 and existing absence planner snapshots remain unchanged.

### Task 3: Capture Verified Time-Correction Legacy State

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/time-correction-legacy-state.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/time-correction-legacy-state.test.ts`

- [ ] **Step 1: Write failing capture tests**

Define the transaction-bound API:

```ts
export interface CaptureTimeCorrectionLegacyApprovalStateInput {
  dbService: ApprovalDbService;
  organizationId: string;
  workPeriodId: string;
  capturedAt: Instant;
}

export async function captureTimeCorrectionLegacyApprovalState(
  input: CaptureTimeCorrectionLegacyApprovalStateInput,
): Promise<VerifiedLegacyApprovalState>;
```

Cover no request, direct pending/approved/rejected request, chain pending/advance/terminal state, and pending-to-absent cancellation while the work period and correction rows still exist. Include clock-in-only, clock-out-only, two-endpoint edit, and deletion payloads with independent endpoint timezone evidence.

- [ ] **Step 2: Add failing subtype, scope, and lineage tests**

Reject a manual submission or policy clock-out sharing `entityType: "time_entry"`; multiple current requests; malformed/empty/duplicate metadata IDs; foreign organization or employee rows; active/already-superseded pending corrections; endpoint-type mismatch; wrong `replacesEntryId`; correction/work-period disagreement; canonical record parity mismatch; invalid `Date`, UTC offset, timezone, or timezone source; and impossible request/chain status combinations. Assert the capture issues one transaction-scoped SQL statement and every join is constrained by organization plus exact source/employee lineage.

- [ ] **Step 3: Run capture tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/domain-adapters/time-correction-legacy-state.test.ts
```

Expected: FAIL because `time-correction-legacy-state.ts` does not exist.

- [ ] **Step 4: Implement one-statement exact capture**

Use one SQL statement through the caller's transaction to load the scoped work period, employee, canonical work record, original endpoints, all source requests, optional chain/stages, metadata-linked corrections, and their referenced originals. Convert database `Date` values with `instantFromDB`; validate IANA zones and captured offsets without deriving audit meaning from the viewer timezone. Build detached stable `sourceSnapshot` with the normalized private correction payload and a separately sanitized `displaySnapshot`.

- [ ] **Step 5: Run capture, planner, and static checks**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/time-correction-legacy-state.test.ts \
  src/lib/approvals/domain-adapters/time-correction-contract.test.ts \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/domain-adapters/time-correction-legacy-state.ts \
  src/lib/approvals/domain-adapters/time-correction-legacy-state.test.ts
```

Expected: all commands exit 0.

### Task 4: Extract The Temporal Terminal Finalizer

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Create: `apps/webapp/src/lib/time-tracking/time-correction-temporal.ts`
- Create: `apps/webapp/src/lib/time-tracking/time-correction-temporal.test.ts`

- [ ] **Step 1: Write failing Temporal and finalizer contract tests**

Define:

```ts
export interface FinalizeTimeCorrectionTerminalInput {
  dbService: ApprovalDbService;
  organizationId: string;
  workPeriodId: string;
  expectedApprovalWorkflowId: string | null;
  actorEmployeeId: string;
  actorUserId: string;
  correction: TimeCorrectionWorkflowPayload["timeCorrection"];
  legacyApprovalRequestId: string | null;
  transition:
    | { kind: "approve"; reason: string | null }
    | { kind: "reject"; reason: string };
  finalizedAt: Instant;
  allowMetadataLessLegacyFallback: boolean;
}

export interface TimeCorrectionTerminalResult {
  transition: "approved" | "rejected";
  requesterEmployeeId: string;
  dirtyFromDate: string | null;
}

export async function finalizeTimeCorrectionTerminalInTransaction(
  input: FinalizeTimeCorrectionTerminalInput,
): Promise<TimeCorrectionTerminalResult>;
```

Assert clock-in-only preserves the untouched clock-out, clock-out-only preserves clock-in, two-endpoint edit uses independent captured zones/offsets, delete requires both zero-duration correction rows, and rejection leaves modern metadata-linked rows inactive with originals unchanged.

- [ ] **Step 2: Add failing lock, CAS, and local-date tests**

Require locks for the organization-scoped work period and exact originals before mutation. Assert one affected row for correction activation, original superseding, work-period endpoint/status/link update, and canonical work-record sync with organization, employee, and record kind predicates. Simulate zero/two affected rows and stale active/inactive state; every case must roll back. Derive dirty balance dates from each affected event's trusted employee-local IANA zone using Temporal, never UTC date or viewer timezone. Validate submitted RFC3339 offset against the selected IANA zone at that instant.

- [ ] **Step 3: Run finalizer tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/time-tracking/time-correction-temporal.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts
```

Expected: FAIL on Luxon/native-date business calculations, missing affected-row evidence, unlocked work-period mutation, and the absent transaction-bound finalizer.

- [ ] **Step 4: Implement the minimal shared finalizer**

Move terminal source mutation behind `finalizeTimeCorrectionTerminalInTransaction`. Parse database timestamps at boundaries into `Temporal.Instant`; compare durations as instants; preserve each endpoint's own timezone capture; and return post-commit work-balance/notification facts rather than dispatching them. Keep metadata-less rejection fallback only when `allowMetadataLessLegacyFallback` is true and exact scoped lineage proves the historical shape. Do not send notifications, update outbox, or open another transaction in the finalizer.

- [ ] **Step 5: Run focused regressions and static checks**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/time-tracking/time-correction-temporal.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/time-tracking/time-correction-temporal.ts \
  src/lib/time-tracking/time-correction-temporal.test.ts \
  src/lib/approvals/server/time-correction-approvals.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts
```

Expected: all commands exit 0 and legacy public wrappers retain their current result types.

### Task 5: Implement And Register The Time-Correction Adapter

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/time-correction.adapter.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/time-correction.adapter.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/production-registry.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/production-registry.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/registry.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/runtime.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/runtime.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`

- [ ] **Step 1: Write failing source/routing adapter tests**

Define a dependency-injected adapter:

```ts
export interface TimeCorrectionApprovalAdapterDependencies {
  clock: Clock;
  finalizeTimeCorrectionTerminal(
    input: FinalizeTimeCorrectionTerminalInput,
  ): Promise<TimeCorrectionTerminalResult>;
  deleteCancelledCorrections(
    input: DeleteCancelledTimeCorrectionInput,
  ): Promise<void>;
}

export interface TimeCorrectionApprovalSource {
  id: string;
  organizationId: string;
  employeeId: string;
  requesterUserId: string;
  approvalWorkflowId: string;
  canonicalRecordId: string;
  correction: TimeCorrectionWorkflowPayload["timeCorrection"];
  clockIn: TimeCorrectionEndpointEvidence | null;
  clockOut: TimeCorrectionEndpointEvidence | null;
}

export interface DeleteCancelledTimeCorrectionInput {
  dbService: ApprovalDbService;
  organizationId: string;
  workPeriodId: string;
  expectedEmployeeId: string;
  expectedApprovalWorkflowId: string;
  correction: TimeCorrectionWorkflowPayload["timeCorrection"];
}

export function createTimeCorrectionApprovalAdapter(
  dependencies: TimeCorrectionApprovalAdapterDependencies,
): ApprovalDomainAdapter<TimeCorrectionApprovalSource>;
```

Assert `workflowType: "time_correction"` and `sourceType: "time_entry"`. `loadSource` must require exact organization/work-period/workflow link, requester membership, canonical work-record organization/employee/kind, original endpoint identity/state, normalized private correction payload, inactive correction rows, replacement lineage, and independent timestamp/offset/zone/source evidence. Routing must return trusted requester/team/location/group/overtime data and permit no default manager only when policy routing resolves another valid approver.

- [ ] **Step 2: Write failing terminal, projection, and cancellation tests**

Assert intermediate approvals never invoke the finalizer. Terminal approve/reject passes exact actor, source, workflow link, correction payload, request identity, and engine time to the shared finalizer once. Pending cancellation capability is requester-only; manager/admin cancellation, approved/rejected/expired state, active/applied/superseded corrections, or changed original lineage fails closed. Projection output must omit correction IDs and notes.

- [ ] **Step 3: Run adapter/registry tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/time-correction.adapter.test.ts \
  src/lib/approvals/domain-adapters/production-registry.test.ts \
  src/lib/approvals/domain-adapters/registry.test.ts \
  src/lib/approvals/workflow/runtime.test.ts
```

Expected: FAIL because `time_correction` still resolves to `ApprovalDomainNotMigratedError`.

- [ ] **Step 4: Implement source binding and complete production composition**

Add exact work-period helpers:

```ts
export async function bindTimeCorrectionWorkflowToWorkPeriod(input: {
  dbService: ApprovalDbService;
  organizationId: string;
  workPeriodId: string;
  employeeId: string;
  workflowId: string;
}): Promise<void>;

export async function verifyTimeCorrectionWorkflowBinding(input: {
  dbService: ApprovalDbService;
  organizationId: string;
  workPeriodId: string;
  employeeId: string;
  workflowId: string;
}): Promise<void>;
```

Under a source lock, bind null to the new workflow, accept exact-link replay, replace only a different verified terminal workflow for the same exact source with affected-row CAS, and reject a different pending/foreign/stale link. Register both concrete migrated adapters in the production registry and leave manual submission, policy clock-out, travel, shift, and compliance entries fail closed. Add one runtime composition helper that builds the complete production registry so absence and correction call sites do not create partial registries; update the three absence call sites and prove absence behavior is unchanged.

- [ ] **Step 5: Run adapter, absence, runtime, and static regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/time-correction.adapter.test.ts \
  src/lib/approvals/domain-adapters/absence.adapter.test.ts \
  src/lib/approvals/domain-adapters/production-registry.test.ts \
  src/lib/approvals/domain-adapters/registry.test.ts \
  src/lib/approvals/workflow/runtime.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/server/absence-approvals.test.ts \
  'src/app/[locale]/(app)/absences/request-absence-effect.test.ts' \
  'src/app/[locale]/(app)/absences/mutations.test.ts'
pnpm --filter webapp typecheck
```

Expected: all commands exit 0; only unmigrated workflow types remain fail closed.

### Task 6: Preserve Correction Metadata In Legacy Compatibility Rows

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts`

- [ ] **Step 1: Write failing correction metadata tests**

For canonical `time_correction/time_entry` snapshots, require generated legacy request metadata to contain the exact normalized payload alongside workflow/stage identity:

```ts
expect(insertedRequest.metadata).toEqual({
  workflow: { id: workflow.id, organizationId: "org-1" },
  stage: { id: activeStage.id, sequence: activeStage.sequence },
  timeCorrection: {
    action: "edit",
    clockInCorrectionId: "10000000-0000-4000-8000-000000000011",
  },
});
```

Cover direct creation, multistage advancement, auto-approval, rejection, pending cancellation, and two terminal cycles on one source. Assert malformed/missing private context fails before writing a legacy row and other workflow metadata remains byte-equivalent.

- [ ] **Step 2: Run compatibility tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/workflow/compatibility-writer.test.ts
```

Expected: FAIL because generated metadata currently contains only workflow and stage identity.

- [ ] **Step 3: Implement workflow-type-specific metadata augmentation**

When and only when the source identity is `time_correction/time_entry`, parse immutable context through the strict correction contract and merge normalized `timeCorrection` metadata into the legacy request. Keep legacy request and chain IDs cycle-scoped through the workflow/stage IDs. Never read correction identity from display projections or rediscover inactive rows.

- [ ] **Step 4: Add cycle and rollback regressions**

Prove a second cycle gets distinct legacy request/chain identities, cannot mutate the first terminal cycle, and can start only after the first legacy request is terminal. Force metadata persistence failure and assert canonical root/event, projection, outbox, legacy request/chain, source link, and correction rows all roll back at the coordinating transaction boundary.

- [ ] **Step 5: Run compatibility and workflow regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/workflow/compatibility-writer.test.ts \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts \
  src/lib/approvals/workflow/start-workflow.test.ts \
  src/lib/approvals/workflow/transition-engine.test.ts
pnpm --filter webapp exec biome check \
  src/lib/approvals/workflow/compatibility-writer.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts
```

Expected: all commands exit 0.

### Task 7: Add Shared Rollout-Aware Submission And Decision Boundaries

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/decision-service.test.ts`

- [ ] **Step 1: Write failing submission-mode tests**

Define one transaction-bound submission API:

```ts
export interface ExecuteTimeCorrectionSubmissionInput {
  dbService: ApprovalDbService;
  organizationId: string;
  requesterEmployeeId: string;
  teamId: string | null;
  workPeriodId: string;
  defaultApproverId: string | null;
  reason: string | null;
  overtimeRisk: ApprovalPolicyOvertimeRisk | null;
  submissionKey: string;
  correction: TimeCorrectionWorkflowPayload["timeCorrection"];
}

export async function executeTimeCorrectionSubmissionInTransaction(
  input: ExecuteTimeCorrectionSubmissionInput,
): Promise<TimeCorrectionApprovalWorkflowResult>;
```

Test all modes: legacy performs only existing writes; shadow/ready capture before, mutate legacy, capture after, observe, and bind in one transaction; canonical starts and binds then mirrors canonical-to-legacy; complete starts and binds without legacy rows. Cover policy/default routing, missing manager with employee/admin policy, requester auto-approval exactly once, sequential stages, parallel reviewers, exact replay, another pending payload conflict, and all-or-nothing rollback.

- [ ] **Step 2: Write failing decision-mode and transaction-scope tests**

Define a decision boundary that accepts an authenticated actor plus stable inbox request ID, then resolves request subtype, source, exact workflow link/version, active assignment/delegation, and rollout gate inside the repository transaction. Legacy remains authoritative in legacy/shadow/ready; shadow/ready capture and observe terminal/intermediate results; canonical/complete call `transitionEngine.executeInTransaction`. Assert receipt replay cannot finalize twice or target a later stage, and typed authorization/conflict outcomes survive REST/bot callers.

- [ ] **Step 3: Run server/handler tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/inbox/decision-service.test.ts
```

Expected: FAIL because correction creation/decision bypasses the rollout gate and classification occurs outside the mutation transaction.

- [ ] **Step 4: Implement rollout coordination and deferred side effects**

Compose the existing repository, gate, legacy write coordinator, capture, planner, compatibility writer, runtime, and adapter rather than duplicating their logic. Return a descriptor such as:

```ts
export interface TimeCorrectionPostCommitEffects {
  authority: "legacy" | "canonical";
  submittedToEmployeeId: string | null;
  terminal:
    | { kind: "approved"; dirtyFromDate: string; requesterEmployeeId: string }
    | { kind: "rejected"; requesterEmployeeId: string }
    | null;
}
```

Run direct manager email, requester decision notification, and work-balance maintenance only after the outer transaction commits and only for legacy/shadow/ready. Catch/log failures so committed data still returns success. Canonical/complete write observe-only outbox intent and dispatch no direct side effect.

- [ ] **Step 5: Run decision, engine, and side-effect regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/inbox/decision-service.test.ts \
  src/lib/approvals/workflow/transition-engine.test.ts \
  src/lib/approvals/workflow/transition-engine.integration.test.ts
pnpm --filter webapp typecheck
```

Expected: all non-PostgreSQL tests pass; disposable integration tests pass or report only their established explicit skip.

### Task 8: Migrate Modular And Monolithic Creation Paths

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.behavior.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.billing-guard.test.ts`
- Modify: `apps/webapp/src/components/time-tracking/time-correction-dialog.test.tsx`
- Modify: `apps/webapp/src/components/calendar/delete-work-period-dialog.test.tsx`

- [ ] **Step 1: Write failing modular edit/deletion tests**

For edit and deletion requests, assert one repository-owned transaction contains: organization-scoped work-period lock/revalidation, deterministic submission/correction identities, inactive correction inserts, legacy/canonical workflow state, source binding, projection, and observe-only outbox. Cover clock-in-only, clock-out-only, two endpoints, deletion, auto-approval, independent endpoint timezone evidence, repeated exact submission, later cycle after terminal history, and a different pending correction conflict. Keep `ServerActionResult<{ approvalId; status }>` unchanged.

- [ ] **Step 2: Write failing monolithic delegation and side-effect tests**

Assert the exported monolithic `requestTimeCorrectionEffect`/`requestTimeCorrection` delegates to the modular rollout-aware implementation rather than creating correction/request rows or nested transactions. Preserve its authentication/billing guard. Simulate manager email and maintenance failures after commit and assert the action still returns committed success; force a transaction failure and assert no side effect runs.

- [ ] **Step 3: Run action tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.behavior.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.billing-guard.test.ts' \
  src/components/time-tracking/time-correction-dialog.test.tsx \
  src/components/calendar/delete-work-period-dialog.test.tsx
```

Expected: FAIL because modular writes use a plain transaction and the monolithic path remains an independent bypass.

- [ ] **Step 4: Route both server-action paths through the shared boundary**

Load and validate authenticated organization/employee/source evidence before entering the transaction, then repeat authorization-sensitive source/endpoint checks under the transaction lock before mutation. Derive endpoint-specific timezone capture server-side and validate submitted zone/offset agreement. Insert deterministic inactive correction rows and call `executeTimeCorrectionSubmissionInTransaction` without nested transactions. Delegate the monolithic export to this implementation and retain stable result/error translation.

- [ ] **Step 5: Run action, server, type, and format checks**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.behavior.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.billing-guard.test.ts' \
  src/lib/approvals/server/time-correction-approvals.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.ts'
```

Expected: all commands exit 0.

### Task 9: Migrate REST Creation And Protect Direct Corrections

**Files:**
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.ts`
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/time-entry.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/time-entry.service.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`

- [ ] **Step 1: Write failing REST self-service mode tests**

Assert self-service correction uses the shared submission boundary in all five rollout modes, supports exact clock-in-only/clock-out-only identity, and retains HTTP 201 with `entry`, `approvalId`, and the existing message. Prove the submission key is stable for a replay of the same organization/work period/original endpoint/requested instant and differs after the active original changes. Reject RFC3339 offsets that disagree with the supplied IANA zone at the instant.

- [ ] **Step 2: Write failing immediate-correction race tests**

For REST manager/admin and both same-day direct edit paths, simulate a pending correction creation racing with immediate mutation. Require the work-period lock before any correction insert/original supersede, then recheck organization, employee, current endpoints, and absence of any pending `time_entry` legacy request or canonical correction workflow. Exactly one operation may win; the loser returns the existing typed conflict without partial rows.

- [ ] **Step 3: Run route/service tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/app/api/time-entries/corrections/route.test.ts \
  src/lib/effect/services/time-entry.service.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts'
```

Expected: FAIL because REST self-service uses the legacy creator directly, manager correction lacks pending-workflow protection, and service mutation begins before the source lock.

- [ ] **Step 4: Implement REST rollout and shared direct-mutation guard**

Move approval-producing REST writes into the repository-owned transaction and call the same submission boundary as server actions. Keep auth/source loading and public JSON translation stable, but revalidate under lock. In `TimeEntryService.createCorrectionEntry`, acquire/verify the scoped work-period lock before inserting or superseding and invoke a shared pending-approval guard that recognizes legacy requests and canonical correction workflows. Use the same guard in direct same-day edit code.

- [ ] **Step 5: Run REST, service, Temporal, and static regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/app/api/time-entries/corrections/route.test.ts \
  src/lib/effect/services/time-entry.service.test.ts \
  src/lib/time-tracking/time-correction-temporal.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts'
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/app/api/time-entries/corrections/route.ts \
  src/lib/effect/services/time-entry.service.ts
```

Expected: all commands exit 0 and direct manager/admin corrections remain outside approval orchestration.

### Task 10: Migrate Demo Correction Generation

**Files:**
- Modify: `apps/webapp/src/lib/demo/demo-data.service.ts`
- Modify: `apps/webapp/src/lib/demo/demo-data.service.test.ts`

- [ ] **Step 1: Write failing atomic demo-generation tests**

Assert each demo correction uses one repository-owned transaction and the shared submission boundary. The generated correction row must be inactive (`isSuperseded: true`), metadata-linked to the exact original endpoint, organization/employee scoped, and associated with a pending workflow/legacy request according to rollout mode. A forced workflow, binding, projection, outbox, or notification-intent failure must not leave a correction or approval row.

- [ ] **Step 2: Write failing bypass and side-effect tests**

Prove the generator does not directly insert `approval_request` or `approval_chain_instance`, does not create an active standalone correction, and does not emit a manager notification before commit. Legacy/shadow/ready may dispatch the existing best-effort notification after commit; canonical/complete create observe-only outbox intent and no direct notification.

- [ ] **Step 3: Run demo tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/demo/demo-data.service.test.ts
```

Expected: FAIL because demo generation currently performs separate direct correction, legacy request, and notification inserts and leaves the correction active.

- [ ] **Step 4: Route demo generation through the shared boundary**

Construct valid original/correction endpoint and timezone evidence, derive deterministic submission/correction identities, then execute correction insert plus submission inside one repository transaction. Preserve `pendingTimeCorrectionApprovalsCreated` and the aggregate `generateDemoData` result. Dispatch legacy-authority notification only after commit and swallow/log delivery failure.

- [ ] **Step 5: Run demo, boundary, and static checks**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/demo/demo-data.service.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/approval-write-boundary.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/demo/demo-data.service.ts \
  src/lib/demo/demo-data.service.test.ts
```

Expected: all commands exit 0.

### Task 11: Harden Inbox Decisions And Legacy Reads

**Files:**
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/queries.ts`
- Modify: `apps/webapp/src/lib/approvals/server/queries.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/decision-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/application/bulk-approval.service.test.ts`

- [ ] **Step 1: Write failing organization and metadata-first read tests**

Assert every touched actor, request, work-period, correction, original endpoint, and batch-detail query requires the authenticated `organizationId`. A modern pending inactive correction referenced by exact normalized metadata must render in both unified inbox and legacy approvals table. Foreign or missing metadata-linked rows must produce an orphaned/invalid result without falling back to an unrelated active row. Manual submissions and policy clock-outs must remain classified outside time correction.

- [ ] **Step 2: Write failing stable-target decision tests**

From individual REST, bulk inbox, bot, and alternate bulk-service entry points, assert a request ID resolves to one exact organization-scoped active correction target inside the transaction. Revalidate assignment, delegation, admin authority, subtype, source, and workflow link at mutation time. A stale request ID, changed active stage, foreign actor, cross-organization source, or ambiguous metadata must fail without revealing whether foreign data exists.

- [ ] **Step 3: Run handler/query tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/server/queries.test.ts \
  src/lib/approvals/inbox/decision-service.test.ts \
  src/lib/approvals/application/bulk-approval.service.test.ts
```

Expected: FAIL on conditionally scoped actor/detail reads, metadata filtering that excludes inactive corrections, and pre-transaction correction classification.

- [ ] **Step 4: Implement exact scoped reads and shared decision dispatch**

Pass authenticated organization through all handler helpers and include it in Drizzle predicates, not post-query filtering. Resolve metadata-linked corrections before relational legacy fallback. Make the correction handler call the rollout-aware decision boundary from Task 7; leave manual/policy handlers unchanged. Preserve current DTO fields/redaction and typed HTTP translation for individual, bulk, Slack, Teams, Telegram, and Discord callers.

- [ ] **Step 5: Run inbox and platform regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/server/queries.test.ts \
  src/lib/approvals/inbox/decision-service.test.ts \
  src/lib/approvals/application/bulk-approval.service.test.ts \
  src/lib/bot-platform/approval-decision.test.ts \
  src/lib/slack/approval-handler.test.ts \
  src/lib/teams/approval-handler.test.ts \
  src/lib/telegram/approval-handler.test.ts \
  src/lib/discord/approval-handler.test.ts
pnpm --filter webapp typecheck
```

Expected: all commands exit 0; platform adapters require no correction-specific mutation logic.

### Task 12: Add Requester-Owned Pending Cancellation

**Files:**
- Create: `apps/webapp/src/lib/approvals/server/time-correction-cancellation.ts`
- Create: `apps/webapp/src/lib/approvals/server/time-correction-cancellation.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/actions.test.ts`
- Modify: `apps/webapp/src/lib/self-service-requests/get-self-service-requests.ts`
- Modify: `apps/webapp/src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx`
- Modify: `apps/webapp/src/app/api/mobile/my-requests/route.test.ts`

- [ ] **Step 1: Write failing cancellation-domain tests**

Define:

```ts
export async function cancelPendingTimeCorrection(input: {
  organizationId: string;
  requesterEmployeeId: string;
  requesterUserId: string;
  workPeriodId: string;
}): Promise<{ replayed: boolean }>;
```

Test legacy, shadow, ready, canonical, and complete modes. Inside one repository transaction, require exact authenticated requester ownership, source/workflow link, pending request/workflow, private payload, inactive unsuperseded corrections, active originals, endpoint lineage, and canonical record parity. Legacy removes/cancels pending request/chain then deletes only corrections; shadow/ready capture terminal evidence before deleting corrections; canonical/complete transition to cancelled and let the adapter delete corrections. Originals, work-period endpoints/link, and canonical record remain unchanged.

- [ ] **Step 2: Add failing authorization, terminal, replay, and race tests**

Reject manager/admin cancellation, caller-supplied actor/organization authority, approved/rejected/expired workflow, applied/active/superseded correction, stale original, moved workflow link, malformed metadata, and foreign organization/employee/source. Exact canonical receipt replay returns success without deleting again or dispatching side effects. Approval versus cancellation must produce one winner; the loser returns conflict and all losing writes roll back.

- [ ] **Step 3: Run cancellation tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/server/time-correction-cancellation.test.ts
```

Expected: FAIL because no time-correction cancellation boundary exists.

- [ ] **Step 4: Implement authenticated action, read model, and UI dispatch**

Export only this public server action shape:

```ts
export async function cancelMyTimeCorrectionRequest(
  workPeriodId: string,
): Promise<{ success: boolean; error?: string }>;
```

Derive organization, user, and employee from the authenticated session; validate `workPeriodId` as UUID; pass no caller actor fields into trusted authorization. In `loadTimeCorrections`, classify normalized correction metadata, use the work-period ID as cancellation `sourceId`, retain request ID as item `id`, and expose `cancel` only for pending corrections. Dispatch absence versus correction actions by `sourceType` in the client, use correction-neutral confirmation/error copy, keep keyboard/focus behavior, and keep mobile cancellation actions stripped.

- [ ] **Step 5: Run domain, action, read, UI, and mobile regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/time-correction-cancellation.test.ts \
  'src/app/[locale]/(app)/my-requests/actions.test.ts' \
  src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts \
  'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx' \
  src/app/api/mobile/my-requests/route.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/server/time-correction-cancellation.ts \
  'src/app/[locale]/(app)/my-requests/actions.ts' \
  src/lib/self-service-requests/get-self-service-requests.ts \
  'src/app/[locale]/(app)/my-requests/my-requests-client.tsx'
```

Expected: all commands exit 0; web pending corrections are cancellable by their requester and mobile behavior is unchanged.

### Task 13: Enforce Ownership And Concurrency In PostgreSQL

**Files:**
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary.ts`
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository.integration.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.integration.test.ts`
- Create: `apps/webapp/src/lib/approvals/server/time-correction-approvals.integration.test.ts`

- [ ] **Step 1: Write failing exact write-ownership tests**

Inventory all production writes to `approval_request`, chain tables, canonical workflow tables, `work_period.approvalWorkflowId`, and inactive correction rows. Remove exceptions only after modular, monolithic, REST, demo, decision, and cancellation paths cross their owners. Assert demo and monolithic files cannot receive broad protected-write exceptions and canonical workflow writes remain restricted to repository/compatibility/projection/outbox modules.

- [ ] **Step 2: Write PostgreSQL-gated race and rollback tests**

Using only the existing disposable harness, cover:

```ts
it.runIf(databaseAvailable)("serializes approval against requester cancellation", async () => {
  const [approval, cancellation] = await Promise.allSettled([
    approvePendingCorrection(),
    cancelPendingCorrection(),
  ]);
  expect([approval, cancellation].filter(isFulfilled)).toHaveLength(1);
  await expectDatabaseParity();
});
```

Add exact endpoint/work-period locks; correction/original/work-period/canonical-record affected-row CAS; source-link replacement; two concurrent different pending cycles; next cycle after terminal history; canonical receipt replay; projection/outbox/legacy/source rollback; and no duplicate finalization. Tests must refuse any configured/shared database and explicitly skip only when the established disposable PostgreSQL prerequisites are absent.

- [ ] **Step 3: Run ownership tests and PostgreSQL suites to confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/approval-write-boundary.test.ts \
  src/lib/approvals/workflow/repository.integration.test.ts \
  src/lib/approvals/workflow/transition-engine.integration.test.ts \
  src/lib/approvals/server/time-correction-approvals.integration.test.ts
```

Expected: ownership tests fail on remaining correction bypasses; PostgreSQL tests fail on missing locks/CAS or report only the established explicit skip until the disposable harness is available.

- [ ] **Step 4: Close exact ownership gaps and concurrency defects**

Delete only obsolete path/table/operation exceptions. Add no broad directory exemptions. Fix each race at the transaction/query predicate that owns it: lock the exact source before mutation, require expected state and organization/employee/source/workflow identity in updates, assert one affected row, and preserve engine receipt claim ordering before source finalization. Do not add process-local mutexes or retry loops that hide a database invariant failure.

- [ ] **Step 5: Run ownership, integration, type, and format checks**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/approval-write-boundary.test.ts \
  src/lib/approvals/workflow/repository.integration.test.ts \
  src/lib/approvals/workflow/transition-engine.integration.test.ts \
  src/lib/approvals/server/time-correction-approvals.integration.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/approval-write-boundary.ts \
  src/lib/approvals/approval-write-boundary.test.ts \
  src/lib/approvals/server/time-correction-approvals.integration.test.ts
```

Expected: all available checks pass and any PostgreSQL skip names the unavailable disposable prerequisite.

### Task 14: Run Final Regression And Security Verification

**Files:**
- Modify only files required to fix regressions found by these commands.

- [ ] **Step 1: Run the complete focused Phase 4.3 suite**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/time-correction-contract.test.ts \
  src/lib/approvals/domain-adapters/time-correction-legacy-state.test.ts \
  src/lib/approvals/domain-adapters/time-correction.adapter.test.ts \
  src/lib/approvals/domain-adapters/production-registry.test.ts \
  src/lib/approvals/workflow/identity.test.ts \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts \
  src/lib/approvals/workflow/repository.test.ts \
  src/lib/approvals/workflow/repository.integration.test.ts \
  src/lib/approvals/workflow/start-workflow.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts \
  src/lib/approvals/workflow/transition-engine.test.ts \
  src/lib/approvals/workflow/transition-engine.integration.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/server/time-correction-approvals.integration.test.ts \
  src/lib/approvals/server/time-correction-cancellation.test.ts \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/server/queries.test.ts \
  src/lib/approvals/inbox/decision-service.test.ts \
  src/lib/approvals/approval-write-boundary.test.ts \
  src/lib/time-tracking/time-correction-temporal.test.ts \
  src/app/api/time-entries/corrections/route.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/corrections.behavior.test.ts' \
  src/lib/demo/demo-data.service.test.ts \
  'src/app/[locale]/(app)/my-requests/actions.test.ts' \
  src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts \
  'src/app/[locale]/(app)/my-requests/my-requests-client.test.tsx'
```

Expected: all available tests pass; only established disposable PostgreSQL skips remain.

- [ ] **Step 2: Run broader approval and timekeeping regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals \
  src/lib/self-service-requests \
  src/lib/time-tracking \
  src/lib/effect/services/time-entry.service.test.ts \
  src/app/api/approvals \
  src/app/api/time-entries \
  'src/app/[locale]/(app)/time-tracking' \
  'src/app/[locale]/(app)/my-requests' \
  src/lib/demo/demo-data.service.test.ts
```

Expected: all available tests pass with no new skips.

- [ ] **Step 3: Run typecheck, scoped Biome, build, and diff validation**

Build the exact changed-file list from `git diff --name-only --diff-filter=ACMR` and run Biome only on supported changed source/test files so unrelated pre-existing formatting drift is not rewritten. Then run:

```bash
pnpm --filter webapp typecheck
CI=true pnpm build
git diff --check
npx react-doctor@latest --verbose --scope changed
```

Expected: typecheck/build/diff checks exit 0 and React Doctor reports no score regression from the My Requests change. Do not modify unrelated files to make a repository-wide formatter pass.

- [ ] **Step 4: Perform security and timekeeping review**

Use the `security-review` skill and verify: no caller-controlled actor/organization authority; all user inputs schema-validated; all SQL parameterized; every touched row organization/employee/source scoped; no correction IDs/notes in display/error/log output; requester-only cancellation; exact transaction-time authorization; stable generic cross-tenant errors; no pre-commit external side effects; and no approved cancellation path.

Use the `migrate-to-temporal-api` checklist and verify: `Temporal.Instant` for domain timestamps; explicit IANA zone ownership; independent endpoint capture; offset-zone agreement including DST overlap/gap tests; employee-local dirty dates; native `Date` only at database/external boundaries; and no new Luxon/native-date business arithmetic.

- [ ] **Step 5: Request final code review and record residual risks**

Use `requesting-code-review` with the design, this plan, and final diff. Require findings-first review of tenant isolation, authorization, workflow-cycle idempotency, transaction ownership, CAS/locking, private metadata, Temporal correctness, side-effect timing, and missing tests. Resolve all confirmed high/medium findings, rerun the affected focused tests plus Step 3, and record Docker/PostgreSQL skips as residual verification risk rather than claiming those tests ran.

## Exit Checklist

- [ ] Every approval-producing correction path uses the shared rollout boundary.
- [ ] One exact source has at most one pending cycle while retaining terminal history.
- [ ] Exact retries replay one cycle and a later genuine correction receives a new cycle.
- [ ] Shadow/ready dual-write atomically; canonical/complete remain implemented but disabled.
- [ ] Partial edits, deletion, rejection, and requester auto-approval preserve behavior.
- [ ] Pending requester cancellation is atomic and approved corrections cannot be cancelled.
- [ ] Direct edits cannot silently invalidate a pending correction workflow.
- [ ] Private correction lineage never enters display projections or public errors.
- [ ] Employee-local dates and endpoint timezone evidence follow Temporal/timekeeping rules.
- [ ] Public server-action and REST response shapes remain stable.
- [ ] Legacy-authority side effects are best effort after commit; canonical authority is observe-only.
- [ ] Ownership, focused tests, broad regressions, typecheck, scoped Biome, CI build, and diff checks pass.
