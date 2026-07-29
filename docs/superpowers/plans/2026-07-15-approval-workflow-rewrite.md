# Approval Workflow Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Z8's fragmented approval paths with one organization-scoped workflow engine that gives requesters, reviewers, dashboards, mobile clients, notifications, and analytics one consistent lifecycle across absences, time requests, travel expenses, shifts, and compliance exceptions.

**Architecture:** `approval_workflow` is the business aggregate. Ordered workflow stages represent review steps, stage assignments represent eligible human reviewers, workflow events form the immutable audit trail, and a transactional outbox owns post-commit side effects. Domain adapters retain source-specific validation and mutations. Requester and inbox projections are transactionally derived from the aggregate so `/my-requests` and `/approvals/inbox` cannot disagree.

**Tech Stack:** Next.js 16 App Router, TypeScript, Drizzle ORM, PostgreSQL, Effect, CASL, Temporal via `temporal-polyfill`, Vitest, Testing Library, TanStack Query, BullMQ/cron infrastructure, Tolgee, and pnpm.

---

## Approved Product Decisions

1. The rewrite covers absence requests, time corrections, manual time submissions, policy-gated clock-outs, travel expense claims, shift swap/pickup requests, and compliance exceptions.
2. When a stage resolves the requester as an approver, that stage is system-auto-approved immediately. It never creates a requester-visible inbox task, even when other candidate reviewers could have acted.
3. A targetless shift swap cannot be approved until a target employee is selected. The engine returns a validation failure rather than approving a no-op or opening the shift implicitly.
4. Cancellation is a durable state transition. Shared workflow, stage, assignment, and event records are never deleted to represent cancellation.
5. Policy stages resolve and revalidate approvers when each stage activates. Future reviewer assignments are not frozen at submission.
6. Source creation and workflow creation are atomic. Final approval/rejection and the source-domain mutation are also atomic.
7. Email, mobile, calendar, webhook, and bot side effects run only from the transactional outbox after commit.
8. Existing route and client response contracts stay stable during migration unless a task explicitly changes and versions them.
9. Legacy compatibility exists only for persisted data and staged rollback. It is removed after the final cutover soak gate.

## Program Rules

- Keep every read and write scoped by `organizationId`.
- Use composite organization foreign keys for workflow, employee, stage, and assignment references.
- Use Temporal for workflow age, SLA, expiry, and escalation calculations. Convert `Temporal.Instant` to `Date` only through `apps/webapp/src/lib/datetime/drizzle-adapter.ts` at database boundaries.
- Never edit `apps/webapp/src/db/auth-schema.ts`.
- Re-read target files before editing and preserve unrelated concurrent changes, especially current changes in `apps/webapp/src/lib/absences/sick-vacation-override.ts`.
- Use pnpm only.
- Do not commit unless the user explicitly requests it. Each commit step below is a review checkpoint, not permission to commit.
- Do not apply migrations or run production repair commands without Phase-provided database credentials. Generate and test migration files locally; application and operational backfill are deployment tasks.
- The expected next migration sequence is `0054`. If another migration lands first, allocate the next free sequence and use a `when` value greater than every current entry in `apps/webapp/drizzle/meta/_journal.json`.
- Phases 4-6 run in `shadow` mode: legacy and canonical state are written atomically, legacy reads and decisions remain authoritative, projection queries only record parity results, and the new outbox does not deliver externally. No consumer or decision path becomes canonical until Phase 7 readiness passes and Phase 8 changes that organization/domain rollout row.

## Delivery Sequence

| Gate | Scope | Exit condition |
|---|---|---|
| Phase 0 | Live-risk containment | New self-resolved requests auto-complete; shifts are tenant-safe; ordinary time approvals are no longer hidden |
| Phase 1 | Canonical schema | Additive workflow schema and constraints pass schema/migration tests |
| Phase 2 | Transition engine | CAS, idempotency, cancellation, and stage advancement pass unit and PostgreSQL concurrency tests |
| Phase 3 | Routing engine | Policy context, reviewer activation, self-auto-approval, and fallbacks are deterministic and organization-scoped |
| Phase 4 | Shadow domain adapters | Every approval-producing domain can atomically dual-write legacy and canonical lifecycle state |
| Phase 5 | Projection parity | Inbox, requester, mobile, dashboard, and analytics projection queries match legacy reads without serving production traffic |
| Phase 6 | Durable side effects | Outbox delivery and escalation are complete and shadow-verified without duplicate production delivery |
| Phase 7 | Backfill and reconciliation | All pending records are classified or explicitly quarantined; hard mismatches are zero |
| Phase 8 | Domain cutovers | Each domain is authoritative on the new engine with a tested rollback checkpoint |
| Phase 9 | Legacy removal | No runtime legacy reads/writes remain; old tables are dropped after soak and restore verification |

## Canonical File Map

### New workflow core

- Create `apps/webapp/src/db/schema/approval-workflow.ts` for workflow, stage, assignment, event, projection, outbox, and rollout-checkpoint tables.
- Create `apps/webapp/src/lib/approvals/workflow/types.ts` for canonical commands, snapshots, statuses, and results.
- Create `apps/webapp/src/lib/approvals/workflow/state-machine.ts` for pure transition planning.
- Create `apps/webapp/src/lib/approvals/workflow/repository.ts` for scoped persistence and compare-and-set writes.
- Create `apps/webapp/src/lib/approvals/workflow/transition-engine.ts` for transaction ownership and command execution.
- Create `apps/webapp/src/lib/approvals/workflow/start-workflow.ts` for atomic workflow materialization and leading auto-stage drainage.
- Create `apps/webapp/src/lib/approvals/workflow/cutover.ts` for organization/domain rollout mode and readiness enforcement.
- Create `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts` for atomic legacy/canonical shadow writes and rollback mirrors.

### New routing core

- Create `apps/webapp/src/lib/approvals/routing/types.ts` for normalized policy context and resolved routes.
- Create `apps/webapp/src/lib/approvals/routing/policy-matcher.ts` for deterministic matching.
- Create `apps/webapp/src/lib/approvals/routing/approver-resolver.ts` for activation-time reviewer resolution.
- Create `apps/webapp/src/lib/approvals/routing/routing-engine.ts` for policy/default-route orchestration.

### New domain boundary

- Create `apps/webapp/src/lib/approvals/domain-adapters/types.ts` for the adapter contract.
- Create `apps/webapp/src/lib/approvals/domain-adapters/registry.ts` for static adapter registration.
- Create one adapter per supported workflow under `apps/webapp/src/lib/approvals/domain-adapters/`.

### New projections and operations

- Create `apps/webapp/src/lib/approvals/projection/` for transactional builders, inbox/requester/dashboard/analytics queries, backfill, reconciliation, and health.
- Create `apps/webapp/src/lib/approvals/outbox/` for claiming and dispatch.
- Create `apps/webapp/src/lib/approvals/escalation/` for shared escalation and reassignment.
- Create `apps/webapp/scripts/approval-workflow-maintenance.ts` for resumable backfill, reconciliation, repair, and readiness checks.

### Existing boundaries to migrate

- Modify `apps/webapp/src/lib/approvals/policies/chain-service.ts` only for Phase 0 compatibility, then retire it in Phase 9.
- Modify `apps/webapp/src/lib/approvals/inbox/` and `apps/webapp/src/app/api/approvals/inbox/` to preserve the manager API contract while changing persistence.
- Modify `apps/webapp/src/lib/self-service-requests/` and mobile request endpoints to use requester projections.
- Modify source schemas and creation/decision paths for absence, time, travel, shift, and compliance domains.

---

## Phase 0: Contain Live Approval Defects

### Task 0.1: Auto-Approve Legacy Self-Resolved Stages

**Files:**
- Create: `apps/webapp/src/lib/approvals/policies/requester-auto-approval.ts`
- Create: `apps/webapp/src/lib/approvals/policies/requester-auto-approval.test.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/chain-service.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/chain-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/travel-expense-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/travel-expense-approvals.test.ts`

- [ ] **Step 1: Write failing classification tests**

Cover direct manager, team manager, org admin, specific employee, and fallback routes where the resolved approver equals the requester. Assert a non-requester remains a human stage.

```ts
export type LegacyStageDisposition =
	| { kind: "human"; approverEmployeeId: string }
	| {
			kind: "auto_approve";
			reason: "requester_is_approver";
	  };

export function classifyLegacyStage(input: {
	requesterEmployeeId: string;
	approverEmployeeId: string;
}): LegacyStageDisposition;
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm --dir apps/webapp test src/lib/approvals/policies/requester-auto-approval.test.ts
```

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Implement the pure classifier**

Return `auto_approve` only when the two employee IDs are equal. Organization validation remains the responsibility of the resolver before this function is called.

- [ ] **Step 4: Add chain creation and advancement tests**

Assert that leading and consecutive self stages are recorded as approved, emit `approval_chain.stage_auto_approved`, and continue until a human stage or terminal completion. No pending `approval_request` may remain assigned to the requester.

- [ ] **Step 5: Extend the legacy chain result contract**

```ts
type ResolvePolicyAndCreateApprovalResult =
	| { kind: "default_created"; approvalRequestId: string }
	| { kind: "chain_created"; chainInstanceId: string; approvalRequestId: string }
	| {
			kind: "auto_completed";
			chainInstanceId: string | null;
			approvalRequestId: string;
			reason: "requester_is_approver";
	  };
```

The `auto_completed` branch must invoke the existing domain finalizer in the caller's transaction. It must not only mark shared rows approved.

- [ ] **Step 6: Run legacy approval suites**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/policies/chain-service.test.ts \
  src/lib/approvals/server/absence-approvals.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/server/travel-expense-approvals.test.ts
```

Expected: PASS with source status, canonical state, chain state, and decision history consistent.

- [ ] **Step 7: Review checkpoint**

Inspect only the files above. Do not commit unless explicitly requested.

### Task 0.2: Make Team Reviewer Authorization Assignment-Aware

**Files:**
- Modify: `apps/webapp/src/lib/authorization/ability.ts`
- Modify: `apps/webapp/src/lib/authorization/__tests__/ability.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.test.ts`

- [ ] **Step 1: Write route-level regression tests using real ability construction**

Model a manager with no direct reports who is the primary manager of a requester's team. Assert the inbox and decision routes authorize the assigned/eligible manager. Add a self-resolved case and assert it is absent because Task 0.1 auto-completed it.

- [ ] **Step 2: Confirm the regression tests fail**

```bash
pnpm --dir apps/webapp test \
  src/lib/authorization/__tests__/ability.test.ts \
  src/app/api/approvals/inbox/route.test.ts \
  'src/app/api/approvals/inbox/[id]/approve/route.test.ts' \
  'src/app/api/approvals/inbox/[id]/reject/route.test.ts'
```

Expected: the team-only manager is forbidden before eligibility is considered.

- [ ] **Step 3: Separate coarse route access from per-request authorization**

Allow an active manager/admin to reach eligibility evaluation without granting organization-wide approval. Preserve per-item assignment/eligibility checks and the existing `manage Approval` override.

- [ ] **Step 4: Re-run the focused authorization tests**

Expected: team managers can act only on organization-scoped assigned/eligible requests; unrelated and cross-organization requests remain forbidden.

### Task 0.3: Stop Treating Every Time Request as a Correction

**Files:**
- Create: `apps/webapp/src/lib/approvals/time-request-kind.ts`
- Create: `apps/webapp/src/lib/approvals/time-request-kind.test.ts`
- Create: `apps/webapp/src/lib/approvals/server/work-period-approvals.ts`
- Create: `apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.test.ts`

- [ ] **Step 1: Define deterministic legacy classification tests**

```ts
export type TimeApprovalKind =
	| "time_correction"
	| "manual_time_submission"
	| "policy_clock_out"
	| "unclassified";
```

Classify by correction metadata first, then explicit new metadata, then known legacy reason and `workPeriod.pendingChanges` markers. Never guess unclassified rows.

- [ ] **Step 2: Add explicit metadata to new manual and clock-out requests**

```ts
metadata: {
	timeRequest: { kind: "manual_time_submission" | "policy_clock_out" },
}
```

- [ ] **Step 3: Keep non-correction requests visible**

Change the correction handler to reject unsupported decision handling explicitly instead of labeling metadata-free requests as orphaned. Add temporary inbox display mapping for the two ordinary time kinds until their Phase 4 adapters land.

- [ ] **Step 4: Add correct legacy decision finalizers**

Implement `work-period-approvals.ts` so manual submissions and policy-gated clock-outs update `work_period.approvalStatus`, clear `pendingChanges`, update canonical `time_record.approvalState`, and append `time_record_approval_decision` without looking for correction entries. Dispatch time decisions by `TimeApprovalKind`; keep correction decisions on the existing correction finalizer. Phase 4 adapters will reuse these tested finalizers rather than duplicating them.

- [ ] **Step 5: Consume legacy `auto_completed` for both ordinary time kinds**

In manual submission and policy clock-out creation transactions, pass `auto_completed` to the matching work-period finalizer before commit. Add assertions that work-period and canonical approval state are approved, one system-authored decision exists, no pending inbox row exists, and a later finalizer failure rolls back the entire source creation.

- [ ] **Step 6: Run time request and handler tests**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/time-request-kind.test.ts \
  src/lib/approvals/server/work-period-approvals.test.ts \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions/approvals.test.ts'
```

Expected: correction, manual submission, and clock-out rows remain distinct and visible.

### Task 0.4: Contain Shift Tenant and Race Risks

**Files:**
- Modify: `apps/webapp/src/db/schema/shift.ts`
- Create: `apps/webapp/src/lib/effect/services/shift-request.service.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/shift-request.service.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/scheduling/actions/shift-request-actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/scheduling/actions/shift-request-actions.test.ts`

- [ ] **Step 1: Add failing service tests**

Cover cross-organization request IDs, requester IDs, target employee IDs, approver IDs, actor scope, duplicate pending pickup, concurrent competing approvals, cancellation versus approval, and targetless swap rejection.

- [ ] **Step 2: Add `organizationId` to all runtime method inputs and predicates**

Do not add the database column until Phase 1 migration. Scope through the joined shift organization during containment, and verify requester, target, and approver employees are active members of that same organization before any insert or shift mutation.

- [ ] **Step 3: Make decision writes transactional and compare-and-set**

The selected request update must require `status = pending`; the shift assignment and competing-request rejection must run in the same transaction. Cancellation must update a durable status during Phase 1; until then, serialize it with approval and preserve an audit record.

- [ ] **Step 4: Run focused shift tests**

```bash
pnpm --dir apps/webapp test \
  src/lib/effect/services/shift-request.service.test.ts \
  'src/app/[locale]/(app)/scheduling/actions/shift-request-actions.test.ts'
```

Expected: cross-tenant attempts fail without writes and exactly one competing request can win.

### Phase 0 Gate

- [ ] New self-resolved submissions complete without an inbox row.
- [ ] Team-primary managers can review assigned requests without unrelated direct reports.
- [ ] Manual and clock-out approval records are not hidden as orphan corrections.
- [ ] Shift decisions are organization-scoped and transactionally race-safe.
- [ ] Run `pnpm --dir apps/webapp test src/lib/approvals src/lib/authorization src/lib/effect/services/shift-request.service.test.ts`.

---

## Phase 1: Add the Canonical Workflow Schema

### Task 1.1: Define Canonical Types and Schema Tests

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/types.ts`
- Create: `apps/webapp/src/db/schema/__tests__/approval-workflow-schema.test.ts`
- Modify: `apps/webapp/src/db/schema/enums.ts`

- [ ] **Step 1: Add canonical TypeScript unions**

```ts
export const APPROVAL_WORKFLOW_TYPES = [
	"absence",
	"time_correction",
	"manual_time_submission",
	"policy_clock_out",
	"travel_expense",
	"shift_request",
	"compliance_exception",
] as const;

export type ApprovalWorkflowStatus =
	| "pending"
	| "approved"
	| "rejected"
	| "cancelled"
	| "expired";

export type ApprovalStageStatus =
	| "waiting"
	| "pending"
	| "approved"
	| "rejected"
	| "cancelled"
	| "expired";
```

- [ ] **Step 2: Write failing schema tests**

Assert table exports, organization composite keys, workflow version, active-source uniqueness, ordered-stage uniqueness, assignment uniqueness, event idempotency, outbox dedupe, and UTC-aware timestamps.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --dir apps/webapp test src/db/schema/__tests__/approval-workflow-schema.test.ts
```

Expected: FAIL because `approval-workflow.ts` does not exist.

### Task 1.2: Implement Additive Workflow Tables

**Files:**
- Create: `apps/webapp/src/db/schema/approval-workflow.ts`
- Modify: `apps/webapp/src/db/schema/index.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Modify: `apps/webapp/src/db/index.ts`
- Modify: `apps/webapp/src/db/schema/absence.ts`
- Modify: `apps/webapp/src/db/schema/time-tracking.ts`
- Modify: `apps/webapp/src/db/schema/travel-expense.ts`
- Modify: `apps/webapp/src/db/schema/shift.ts`
- Modify: `apps/webapp/src/db/schema/compliance.ts`
- Modify: `apps/webapp/src/db/schema/notification.ts`

- [ ] **Step 1: Add `approvalWorkflow`**

Required columns: `id`, `organizationId`, `workflowType`, `sourceType`, `sourceId`, nullable requester, status, current stage sequence, optimistic `version`, policy/context/display snapshots, submitted/completed/cancelled timestamps, decision reason, and created/updated timestamps.

- [ ] **Step 2: Add `approvalWorkflowStage`**

Required columns: organization/workflow composite reference, sequence, label, resolver snapshot, activation mode, status, activation/decision timestamps, decision reason, and optional `legacyApprovalRequestId`.

- [ ] **Step 3: Add `approvalStageAssignment`**

Required columns: organization/workflow/stage composite references, approver employee composite reference, assignment status, assigned/resolved timestamps, actor, and reassignment metadata.

- [ ] **Step 4: Add `approvalWorkflowEvent` and `approvalWorkflowCommand`**

Store workflow version, event index/type, actor kind and IDs, previous/resulting states, reason, metadata, occurrence time, and optional idempotency key. Enforce uniqueness for `(organizationId, workflowId, version, eventIndex)` and `(organizationId, idempotencyKey)` when present. The command receipt stores organization/workflow/key, actor fingerprint, command fingerprint, state (`reserved` or `completed`), serialized result, and timestamps; enforce unique `(organizationId, workflowId, idempotencyKey)`.

- [ ] **Step 5: Add transactional read projections**

Add `approvalRequesterProjection` keyed by workflow and `approvalInboxProjection` keyed by active stage. Store normalized source display payloads and search text, not localized prose. Inbox visibility joins through `approvalStageAssignment` rather than duplicating one row per manager.

- [ ] **Step 6: Add `approvalOutbox` and `approvalWorkflowRollout`**

Outbox event fields include event type, dedupe key, payload, creation time, and event-time delivery disposition (`observe` or `deliver`). Add `approvalOutboxDelivery` with one row per recipient/channel, its own dedupe key, disposition/status, availability, claim, retry, processed, and error fields. Rollout fields include organization, workflow type, lifecycle mode (`legacy`, `shadow`, `ready`, `canonical`, `complete`), side-effect mode (`legacy` or `canonical`), backfill watermark, mismatch counts, and reconciliation timestamps. Add `approvalWorkflowMigrationIssue` with organization, workflow type, legacy/source references, issue code, evidence, disposition, operator, and disposition timestamp.

- [ ] **Step 7: Add explicit source links and shift cancellation status**

Add a nullable organization-composite `approvalWorkflowId` reference to `absence_entry`, `work_period`, `travel_expense_claim`, `shift_request`, and `compliance_exception`. It points to the source's current/latest workflow while historical workflows remain discoverable by the canonical workflow source identity. Add nullable `shift_request.organizationId` for expansion/backfill. Add a nullable shadow `shift_request.lifecycleStatus` using a dedicated `shift_request_status` enum containing `pending`, `approved`, `rejected`, and `cancelled`; dual-write it with the existing status during migration and swap columns only in the Phase 8 contract migration. Add nullable `notification.idempotencyKey` and a partial unique index on `(organizationId, idempotencyKey)` for outbox-delivered in-app notifications; every conflict lookup includes both fields.

- [ ] **Step 8: Re-run schema tests**

Expected: PASS.

### Task 1.3: Generate and Review Expansion Migration

**Files:**
- Create: `apps/webapp/drizzle/0054_approval_workflow_expand.sql`
- Create/update: matching Drizzle snapshot under `apps/webapp/drizzle/meta/`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Modify: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`

- [ ] **Step 1: Generate the migration**

```bash
pnpm --dir apps/webapp exec drizzle-kit generate --name approval_workflow_expand
```

- [ ] **Step 2: Inspect generated SQL**

Verify the migration is additive, uses organization-composite foreign keys, does not alter `auth-schema.ts`, does not drop legacy approval tables, and has a journal `when` greater than every prior migration.

- [ ] **Step 3: Run migration metadata tests**

```bash
pnpm --dir apps/webapp test \
  src/db/schema/__tests__/approval-workflow-schema.test.ts \
  src/db/__tests__/drizzle-migrations.test.ts
```

Expected: PASS.

### Phase 1 Gate

- [ ] Expansion schema is additive and rollback-safe.
- [ ] Schema and migration tests pass.
- [ ] No source domain writes to the new tables yet.

---

## Phase 2: Implement the CAS Transition Engine

### Task 2.0: Define Transaction, Cutover, and Compatibility Ports

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/cutover.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/cutover.test.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/types.ts`
- Create: `apps/webapp/src/lib/approvals/projection/contracts.ts`
- Create: `apps/webapp/src/lib/approvals/projection/writer.ts`
- Create: `apps/webapp/src/lib/approvals/projection/writer.test.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/writer.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/writer.test.ts`
- Create: `apps/webapp/scripts/approval-workflow-rollout.ts`

- [ ] **Step 1: Define transaction-bound ports before the engine**

```ts
export interface TransactionalWorkflowRepository {
	loadSnapshot(input: { organizationId: string; workflowId: string }): Promise<ApprovalWorkflowSnapshot>;
	claimCommand(input: ApprovalCommandReceiptIdentity): Promise<
		| { kind: "reserved" }
		| { kind: "completed"; result: ApprovalCommandResult }
		| { kind: "fingerprint_mismatch" }
	>;
	tryAdvanceVersion(input: {
		organizationId: string;
		workflowId: string;
		expectedVersion: number;
	}): Promise<{ kind: "advanced"; version: number } | { kind: "conflict"; version: number }>;
	applyChildren(plan: ApprovalTransitionPlan): Promise<void>;
	completeCommand(
		input: ApprovalCommandReceiptIdentity & { result: ApprovalCommandResult },
	): Promise<void>;
	applyObservedLegacyTransition(input: ObservedLegacyTransition): Promise<ApprovalCommandResult>;
}

export interface ApprovalCommandReceiptIdentity {
	organizationId: string;
	workflowId: string;
	idempotencyKey: string;
	actorFingerprint: string;
	commandFingerprint: string;
}

export interface StageActivationResolver {
	resolve(input: StageActivationInput): Promise<ResolvedStage>;
}

export interface ApprovalProjectionWriter {
	write(input: ApprovalProjectionWriteInput): Promise<void>;
}

export interface ApprovalWorkflowTransactionContext {
	dbService: ApprovalDbService;
	repository: TransactionalWorkflowRepository;
	adapterRegistry: ApprovalDomainAdapterRegistry;
	projectionWriter: ApprovalProjectionWriter;
	compatibilityWriter: ApprovalCompatibilityWriter;
	outboxWriter: ApprovalOutboxWriter;
}

export interface ApprovalDomainAdapterRegistry {
	get<TSource>(workflowType: ApprovalWorkflowType): ApprovalDomainAdapter<TSource>;
}
```

The engine owns `db.transaction` and receives the complete `ApprovalWorkflowTransactionContext` built from that transaction client. No port may open a nested transaction.

- [ ] **Step 2: Define rollout behavior**

`legacy` writes/reads legacy only. `shadow` writes legacy and canonical atomically while serving legacy. `ready` keeps shadow behavior after reconciliation passes. `canonical` serves and decides canonical state while mirroring legacy for rollback. `complete` writes canonical only. Every approval write acquires a shared transaction advisory lock derived from `(organizationId, workflowType)`; readiness/cutover takes the matching exclusive transaction lock.

- [ ] **Step 3: Write cutover and compatibility tests**

Assert mode changes require organization/workflow type, `canonical` requires readiness, shadow/mirror writes share the caller transaction, either write failure rolls everything back, shared writer locks exclude readiness's exclusive lock, and `complete` cannot return to a legacy mode. Add command-receipt tests for cross-organization key reuse, actor/command fingerprint mismatch, and concurrent claims of the same scoped key. `claimCommand` must atomically insert-or-wait/read so the loser returns the winner's completed serialized result rather than surfacing a unique-constraint error.

- [ ] **Step 4: Implement compatibility writer adapters for current `approval_request` and chain rows**

The compatibility writer is the only new module allowed to mirror between lifecycle models. Implement `mirrorLegacyToCanonical` for `shadow`/`ready` by calling `applyObservedLegacyTransition`: update canonical aggregate, events, projections, and observe-only outbox records from verified legacy before/after snapshots without invoking the domain finalizer a second time. Implement `mirrorCanonicalToLegacy` for `canonical` after the normal canonical finalizer. Record stable canonical-to-legacy IDs so rollback reads cannot become stale. Tests cover submission, all-auto completion, approval, rejection, cancellation, and source mutation count exactly once.

- [ ] **Step 5: Implement the concrete transactional projection and outbox writers**

They accept the transaction-scoped DB service, never open their own transaction, and are available before `startApprovalWorkflow` and Phase 4 adapters need them.

Define the complete `ApprovalDomainAdapter` contract in `domain-adapters/types.ts` during this step, including load, routing context, preflight, terminal finalization result, approved-cancellation capability, display projection, and post-commit event methods. Phase 4 adds implementations only; the transition engine compiles against this port now.

- [ ] **Step 6: Add audited rollout bootstrap commands**

`approval-workflow-rollout.ts bootstrap` creates one `legacy` row per organization/workflow type. `enter-shadow` acquires the exclusive rollout lock, verifies expansion schema availability, records the actor and previous/resulting mode, and enables bidirectional mirror capture before backfill starts.

- [ ] **Step 7: Run port and cutover tests**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/workflow/cutover.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts \
  src/lib/approvals/projection/writer.test.ts \
  src/lib/approvals/outbox/writer.test.ts
```

### Task 2.1: Build the Pure State Machine

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/state-machine.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/state-machine.test.ts`

- [ ] **Step 1: Write failing transition matrix tests**

Cover approve, reject, cancel, expire, reassign, escalation, invalid terminal transitions, human-to-auto stage advancement, consecutive auto stages, and all-auto completion. Permit `approved -> cancelled` only when the adapter declares `canCancelAfterApproval`, as required for future approved absences; other terminal workflows remain immutable.

```ts
export type ApprovalWorkflowCommand =
	| { type: "approve"; stageId: string; assignmentId: string; reason?: string }
	| { type: "reject"; stageId: string; assignmentId: string; reason: string }
	| { type: "cancel"; reason: string }
	| { type: "expire"; reason: string }
	| { type: "reassign"; stageId: string; fromEmployeeId: string; toEmployeeId: string }
	| { type: "escalate"; stageId: string; fromEmployeeId: string; toEmployeeId: string };

export function planWorkflowTransition(
	snapshot: ApprovalWorkflowSnapshot,
	command: ApprovalWorkflowCommand,
	policy: { canCancelAfterApproval: boolean },
	now: Instant,
): ApprovalTransitionPlan;
```

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --dir apps/webapp test src/lib/approvals/workflow/state-machine.test.ts
```

- [ ] **Step 3: Implement the pure transition planner**

Do not import Drizzle, Effect, `Date`, or Luxon. Return planned workflow/stage/assignment changes and events without performing I/O. A decision that reaches another stage returns `needs_activation` rather than classifying that future stage.

Add a separate pure reducer:

```ts
export function planStageActivation(
	snapshot: ApprovalWorkflowSnapshot,
	resolvedStage: ResolvedStage,
	now: Instant,
): ApprovalTransitionPlan;
```

Import `type Instant` from `@/lib/datetime/temporal-core`. The engine obtains `canCancelAfterApproval` from the trusted adapter and passes it as transition policy; API and bot payloads cannot set it. The transactional engine calls the activation resolver, applies the activation reducer, and repeats while activation auto-approves the requester stage.

- [ ] **Step 4: Re-run and confirm GREEN**

Expected: complete transition matrix passes with a fixed `Instant` from the Temporal foundation.

### Task 2.2: Implement Scoped Repository and Idempotency

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/repository.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Assert every load/update includes `organizationId`, root version compare-and-set returns a conflict on zero rows, events append at the committed version, duplicate idempotency keys return the previous result, and no child rows are written after a failed root CAS.

Add a source guard assertion that production code has no update/delete operation for `approval_workflow_event`. The repository exposes append-only event methods; organization deletion remains the only database cascade that can remove events.

- [ ] **Step 2: Implement the repository transaction contract**

```ts
export interface ApprovalWorkflowRepository {
	withTransaction<T>(
		operation: (context: ApprovalWorkflowTransactionContext) => Promise<T>,
	): Promise<T>;
}
```

- [ ] **Step 3: Use drizzle boundary conversions**

Convert instants through `instantToDB`/`instantFromDB` helpers. Do not call `Date.now()` inside workflow business logic.

- [ ] **Step 4: Run repository tests**

```bash
pnpm --dir apps/webapp test src/lib/approvals/workflow/repository.test.ts
```

Expected: PASS.

### Task 2.3: Implement Transactional Transition Orchestration

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/transition-engine.test.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/transition-engine.integration.test.ts`

- [ ] **Step 1: Write failing engine tests**

Assert authorization allows an active assignment or organization-scoped `manage Approval`, rejects cross-organization overrides, the domain adapter runs only for terminal source transitions, projections and outbox rows update in the same transaction, duplicate idempotency keys return the previously serialized command result, and post-commit handlers are not invoked by the engine.

- [ ] **Step 2: Implement engine orchestration**

Expose `executeApprovalCommand({ organizationId, workflowId, expectedVersion, idempotencyKey, actor, command })`. Open one database transaction and receive the complete transaction context. Acquire the shared rollout lock and call atomic `claimCommand`. Return its completed result, reject fingerprint mismatch, or continue only for `reserved`. Load the scoped workflow, verify CASL capability plus active assignment or organization-scoped manage override, plan transition, and run adapter preflight. Apply the root CAS first. Only after the CAS succeeds, run the adapter finalizer, child stage/assignment changes, projection rebuild, event append, compatibility mirror, and outbox insert. Resolve and drain `needs_activation` stages through the injected activation port, serialize the final result with `completeCommand`, and commit. A conflict must roll back without invoking the finalizer.

- [ ] **Step 3: Add PostgreSQL concurrency tests**

Use the repository's existing database-test harness. Prove exactly one of two concurrent decisions succeeds, cancellation versus approval yields one terminal outcome, and rollback removes workflow/domain/projection/outbox changes together.

- [ ] **Step 4: Run unit tests**

```bash
pnpm --dir apps/webapp test src/lib/approvals/workflow
```

Expected: unit tests pass. Integration tests require the configured test database and must run in CI if Phase credentials are unavailable locally.

### Phase 2 Gate

- [ ] All transitions are organization-scoped, versioned, and idempotent.
- [ ] Real PostgreSQL tests prove concurrency behavior.
- [ ] No domain is cut over before this gate passes.

---

## Phase 3: Implement Authoritative Routing

### Task 3.1: Normalize Policy Context and Matching

**Files:**
- Create: `apps/webapp/src/lib/approvals/routing/types.ts`
- Create: `apps/webapp/src/lib/approvals/routing/policy-matcher.ts`
- Create: `apps/webapp/src/lib/approvals/routing/policy-matcher.test.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/matcher.ts` only to delegate during compatibility.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/action-helpers.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/page.tsx`
- Modify: `apps/webapp/messages/settings/rules/en.json`
- Modify the corresponding `de.json`, `el.json`, `es.json`, `fr.json`, `gsw.json`, `it.json`, `pl.json`, `pt.json`, and `tr.json` files in `apps/webapp/messages/settings/rules/`.

- [ ] **Step 1: Define the routing context**

```ts
export interface ApprovalRoutingContext {
	organizationId: string;
	workflowType: ApprovalWorkflowType;
	source: { type: string; id: string };
	requesterEmployeeId: string;
	teamIds: string[];
	locationId: string | null;
	absenceCategoryId: string | null;
	travelExpenseAmount: string | null;
	overtimeRisk: "none" | "warning" | "violation" | null;
	employeeGroupIds: string[];
}
```

- [ ] **Step 2: Define persisted policy compatibility aliases**

Existing `absence_entry` policies match canonical `absence`; existing `travel_expense_claim` policies match canonical `travel_expense`; existing `time_entry` policies intentionally match `time_correction`, `manual_time_submission`, and `policy_clock_out`. New policies may store any canonical workflow type, including `shift_request` and `compliance_exception`. When both broad legacy and canonical-specific policies match, existing priority and first-match ordering remains authoritative.

- [ ] **Step 3: Write matching and settings tests**

Cover every existing policy condition, all compatibility aliases, canonical-specific time policies, organization isolation, deterministic priority ties, invalid references, real location values, and no-match fallback. Assert settings validation and preview accept the seven canonical types and exactly `fail`, `default_manager`, or `organization_admin` stage fallbacks without rewriting persisted legacy conditions. Reject any other persisted fallback value during activation with an actionable policy validation error.

- [ ] **Step 4: Implement pure first-match behavior**

No source flow may require a default manager before matching policies. A matched policy is authoritative; fallback executes only when no policy matches or the configured stage fallback explicitly allows it.

- [ ] **Step 5: Run matcher and settings tests**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/routing/policy-matcher.test.ts \
  'src/app/[locale]/(app)/settings/approval-policies/actions.test.ts'
```

### Task 3.2: Resolve and Revalidate Reviewers at Activation

**Files:**
- Create: `apps/webapp/src/lib/approvals/routing/approver-resolver.ts`
- Create: `apps/webapp/src/lib/approvals/routing/approver-resolver.test.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/manager-eligibility.ts`
- Modify: `apps/webapp/src/lib/approvals/policies/manager-eligibility-db.ts`

- [ ] **Step 1: Write resolver tests**

Cover direct managers, team fallback managers, manager's manager, org admin, specific employee, inactive reviewers, role changes, cross-organization IDs, multiple eligible managers, and requester-in-candidate-set auto-approval.

- [ ] **Step 2: Implement activation-time resolution**

```ts
export type ResolvedStage =
	| {
			activationMode: "human";
			approverEmployeeIds: string[];
	  }
	| {
			activationMode: "requester_auto_approve";
			reason: "requester_is_approver";
	  };

export type StageFallbackBehavior = "fail" | "default_manager" | "organization_admin";
```

Persist the validated fallback behavior in each stage resolver snapshot. When the configured resolver returns no eligible candidate, `fail` returns a typed activation error, `default_manager` invokes the standard direct/team resolver, and `organization_admin` invokes the active organization-admin resolver. If fallback still cannot resolve, fail closed. If the requester appears in the resolved candidate set from either primary or fallback resolution, choose `requester_auto_approve` for the stage and create no assignments.

- [ ] **Step 3: Re-run resolver tests**

Expected: deterministic, organization-scoped results with no stale future assignments. Tests cover managerless requesters, inactive candidates, all three fallback values, fallback failure, and requester resolution through fallback.

### Task 3.3: Materialize and Activate Workflows

**Files:**
- Create: `apps/webapp/src/lib/approvals/routing/routing-engine.ts`
- Create: `apps/webapp/src/lib/approvals/routing/routing-engine.test.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/start-workflow.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/start-workflow.test.ts`

- [ ] **Step 1: Write route materialization tests**

Assert one workflow per active source, stage definitions snapshot policy configuration, only the current stage resolves reviewers, leading self stages auto-approve, all-auto routes finalize the source, and no-match default routes use the same activation logic.

- [ ] **Step 2: Implement `startApprovalWorkflow`**

It must accept a transaction-scoped database service and the domain adapter context. It creates workflow/stage/event/projection/outbox rows and invokes a source finalizer when every stage auto-completes.

- [ ] **Step 3: Run routing and start tests**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/routing \
  src/lib/approvals/workflow/start-workflow.test.ts
```

### Phase 3 Gate

- [ ] Policy context uses real source attributes, including location where available.
- [ ] Reviewer capability and active status are checked on activation.
- [ ] Requester resolution always auto-approves the stage.
- [ ] Default-manager prerequisites no longer block valid admin/specific-employee policies.

---

## Phase 4: Implement Domain Lifecycle Adapters in Shadow Mode

Before enabling any Phase 4 adapter in a deployed environment, run the audited rollout bootstrap and move that organization/workflow type from `legacy` to `shadow`. The mode switch must commit before the first dual-written request so Phase 7's high-water backfill cannot miss concurrent changes.

### Task 4.1: Define and Guard the Domain Adapter Boundary

**Files:**
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/types.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/registry.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/registry.test.ts`
- Create: `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`

- [ ] **Step 1: Implement the concrete registry against the Phase 2 adapter contract**

```ts
export interface ApprovalDomainAdapter<TSource> {
	readonly workflowType: ApprovalWorkflowType;
	loadSource(
		dbService: ApprovalDbService,
		input: { organizationId: string; sourceId: string },
	): Promise<TSource>;
	buildRoutingContext(source: TSource): ApprovalRoutingContext;
	preflightTerminalDecision(
		dbService: ApprovalDbService,
		input: ApprovalDomainDecisionInput<TSource>,
	): Promise<void>;
	applyTerminalDecision(
		dbService: ApprovalDbService,
		input: ApprovalDomainDecisionInput<TSource>,
	): Promise<{ source: TSource | null; projection: ApprovalDisplayProjection }>;
	canCancelAfterApproval(source: TSource): boolean;
	buildDisplayProjection(source: TSource): ApprovalDisplayProjection;
	buildPostCommitEvents(input: ApprovalDomainEventInput): ApprovalOutboxMessage[];
}
```

The interface above is the Phase 2 contract repeated for implementation reference; do not create a second adapter abstraction in this phase.

- [ ] **Step 2: Add registry completeness tests**

Assert exactly seven workflow types and one adapter per type.

- [ ] **Step 3: Add direct-write guard tests**

The guard scans production TypeScript and fails if new code writes legacy `approvalRequest`/chain tables outside the explicit compatibility allowlist or writes canonical workflow tables outside repository/start/maintenance modules.

- [ ] **Step 4: Require every adapter entry point to pass through rollout mode**

In `shadow`/`ready`, submissions and legacy decisions update canonical state through the compatibility writer in the same transaction while the legacy result remains authoritative. In `canonical`, the transition engine is authoritative and mirrors its result to legacy. Tests must exercise both directions before any domain cutover.

### Task 4.2: Migrate Absence Workflows

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/absence.adapter.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/absence.adapter.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/absence-request.handler.ts`

- [ ] **Step 1: Write adapter and cancellation tests**

Cover creation rollback, approval, rejection, multi-stage finalization, requester auto-approval, pending cancellation, approved future-absence domain cancellation, canonical time-record parity, and calendar outbox events.

- [ ] **Step 2: Create absence and workflow atomically**

Use the existing absence/canonical transaction and call `startApprovalWorkflow` inside it.

- [ ] **Step 3: Replace deletion cancellation**

Mark workflow and requester projection cancelled, then delete the `absence_entry`, its canonical absence record, and calendar-facing source link in the same transaction. Preserve workflow, stage, assignment, event, and projection history. Insert calendar-deletion and manager-notification outbox events before commit; only the outbox processor may enqueue calendar or notification work after commit.

- [ ] **Step 4: Run absence suites**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/domain-adapters/absence.adapter.test.ts \
  src/lib/approvals/server/absence-approvals.test.ts \
  'src/app/[locale]/(app)/absences/mutations.test.ts'
```

### Task 4.3: Migrate Time Correction Workflows

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/time-correction.adapter.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/time-correction.adapter.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts`
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`

- [ ] **Step 1: Add adapter tests for edit, delete, partial endpoint correction, rejection, cancellation, and rollback**
- [ ] **Step 2: Preserve inactive correction entries until final approval**
- [ ] **Step 3: Atomically synchronize work period, correction entries, canonical time record, immutable decision, workflow, projections, and outbox**
- [ ] **Step 4: Run correction suites**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/domain-adapters/time-correction.adapter.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/app/api/time-entries/corrections/route.test.ts
```

### Task 4.4: Migrate Manual Time Submission Workflows

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/manual-time-submission.adapter.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/manual-time-submission.adapter.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.manual-entry.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.atomicity.test.ts`

- [ ] **Step 1: Write failing atomicity and decision tests**

Assert clock-in, clock-out, work period, canonical time record, and workflow all roll back when workflow creation fails.

- [ ] **Step 2: Consolidate duplicate manual-entry implementations**

Make `actions.ts` a thin wrapper around the transaction-owning implementation in `actions/clocking.ts`. Preserve timezone capture, work category, project allocation, canonical record, and billing guards.

- [ ] **Step 3: Implement manual-specific finalization**

Approval sets work-period and canonical approval state to approved and writes `time_record_approval_decision`; rejection sets both to rejected without correction-entry lookup. Surcharge calculation runs from post-commit events.

- [ ] **Step 4: Run manual-entry tests**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/domain-adapters/manual-time-submission.adapter.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions.manual-entry.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.atomicity.test.ts'
```

### Task 4.5: Migrate Policy-Gated Clock-Out Workflows

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/policy-clock-out.adapter.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/policy-clock-out.adapter.test.ts`
- Modify: `apps/webapp/src/lib/time-tracking/clocking-service.ts`
- Modify: `apps/webapp/src/lib/time-tracking/clocking-service.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.ts`
- Modify: `apps/webapp/src/lib/teams/commands/clock-out.ts`
- Modify: `apps/webapp/src/lib/teams/commands/clock-out.test.ts`

- [ ] **Step 1: Write policy clock-out rollback and decision tests**
- [ ] **Step 2: Extend the employee-locked clocking transaction to accept workflow creation**

Run deterministic compliance and change-policy validation inside the employee-locked transaction before writes. The atomic write set is clock-out entry, work-period close, canonical record, and workflow. Only retryable derived work, surcharge calculation, and notifications are post-commit.

- [ ] **Step 3: Route web and Teams through the same workflow-capable service**
- [ ] **Step 4: Wire existing `onClockOutApproved` and `onClockOutRejected` triggers through outbox events**
- [ ] **Step 5: Run clock-out suites**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/domain-adapters/policy-clock-out.adapter.test.ts \
  src/lib/time-tracking/clocking-service.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts' \
  src/lib/teams/commands/clock-out.test.ts
```

### Task 4.6: Migrate Travel Expense Workflows

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/travel-expense.adapter.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/travel-expense.adapter.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/travel-expenses/actions.ts`
- Modify: `apps/webapp/src/lib/approvals/server/travel-expense-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/travel-expense-claim.handler.ts`

- [ ] **Step 1: Write submission, policy, detail, decision-log, rollback, and self-auto-approval tests**
- [ ] **Step 2: Create submitted claim and workflow atomically**
- [ ] **Step 3: Resolve detail by workflow/stage identity rather than arbitrary source approval lookup**
- [ ] **Step 4: Preserve claim validation and decision logs in the adapter**
- [ ] **Step 5: Run travel suites**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/domain-adapters/travel-expense.adapter.test.ts \
  src/lib/approvals/server/travel-expense-approvals.test.ts
```

### Task 4.7: Migrate Shift Requests

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/shift-request.adapter.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/shift-request.adapter.test.ts`
- Modify: `apps/webapp/src/db/schema/shift.ts`
- Modify: `apps/webapp/src/lib/effect/services/shift-request.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/open-shifts.service.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/scheduling/actions/shift-request-actions.ts`
- Modify: `apps/webapp/src/lib/teams/shift-pickup-handler.ts`

- [ ] **Step 1: Add `shift_request.organizationId` through the expansion/backfill/contract migration sequence**
- [ ] **Step 2: Write creation, duplicate, target validation, competing pickup, cancellation, and concurrency tests**
- [ ] **Step 3: Create shift request and workflow atomically**
- [ ] **Step 4: Decide request, mutate shift, close competitors, close competitor workflows, and audit in one transaction**
- [ ] **Step 5: Replace hard-delete cancellation with cancelled source/workflow state**
- [ ] **Step 6: Run shift suites and PostgreSQL race tests**

### Task 4.8: Migrate Compliance Exceptions

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/compliance-exception.adapter.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/compliance-exception.adapter.test.ts`
- Create: `apps/webapp/src/lib/effect/services/compliance-guardrail.service.approvals.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/compliance/actions.ts`
- Modify: `apps/webapp/src/lib/effect/services/compliance-guardrail.service.ts`

- [ ] **Step 1: Write creation, self-auto-approval, decision, expiration, use, and tenant tests**
- [ ] **Step 2: Resolve route before inserting and create exception/workflow atomically**
- [ ] **Step 3: Route decisions through the transition engine**
- [ ] **Step 4: Expire pending exceptions and workflows atomically, then notify through outbox**
- [ ] **Step 5: Scope `hasValidException` and `markExceptionAsUsed` by organization and expected state**

### Phase 4 Gate

- [ ] Registry contains all seven adapters.
- [ ] Every source submission and workflow start share a transaction.
- [ ] Every terminal decision and source mutation share a transaction.
- [ ] No adapter sends external side effects inside the transaction.
- [ ] Legacy and canonical writes are atomic, and legacy decisions remain authoritative until Phase 8.
- [ ] Every enabled organization/workflow type has an audited `shadow` rollout row before dual writes begin.
- [ ] Run `pnpm --dir apps/webapp test src/lib/approvals/domain-adapters` plus each domain's focused suite.

---

## Phase 5: Build Shared Projection Reads and Prove Parity

### Task 5.1: Build Transactional Projection Writers

**Files:**
- Modify: `apps/webapp/src/lib/approvals/projection/contracts.ts`
- Create: `apps/webapp/src/lib/approvals/projection/contracts.test.ts`
- Modify: `apps/webapp/src/lib/approvals/projection/writer.ts`
- Modify: `apps/webapp/src/lib/approvals/projection/writer.test.ts`

- [ ] **Step 1: Define stable requester and inbox DTOs**
- [ ] **Step 2: Extend the Phase 2 transactional writer tests so every workflow transition updates both projections in the same transaction**
- [ ] **Step 3: Enrich the existing state projection writer with normalized display payload and search text builders per adapter**
- [ ] **Step 4: Prove rollback removes projection updates with workflow/domain writes**

### Task 5.2: Build Canonical Inbox Query and Shadow Comparison

**Files:**
- Create: `apps/webapp/src/lib/approvals/projection/inbox-query.ts`
- Create: `apps/webapp/src/lib/approvals/projection/inbox-query.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/read-service.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/read-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/decision-service.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/route.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/counts/route.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/route.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/bulk-approve/route.test.ts`
- Modify: `apps/webapp/src/app/api/approvals/inbox/bulk-reject/route.test.ts`

- [ ] **Step 1: Write SQL-level filter/count/cursor tests**

Status, type, search, team, priority, age, and date range must affect rows and totals consistently. Counts may intentionally ignore only the active type filter so type tabs remain informative; encode that explicitly in tests.

- [ ] **Step 2: Implement one projection query**

Join active assignments for assigned/eligible managers, allow organization-wide `manage Approval`, sort deterministically, and page in SQL rather than after loading all sources.

In `shadow` and `ready` modes, execute the canonical query for parity telemetry but return the legacy response. Only `canonical` and `complete` modes return projection results.

- [ ] **Step 3: Preserve the existing API contract**

Keep ISO date strings, supported types, warnings, capabilities, and partial bulk results. Add `shift_request` and `compliance_exception` only after their adapters pass Phase 4.

- [ ] **Step 4: Resolve details by workflow and stage IDs**

Domain handlers receive the exact workflow/stage identity and stop rediscovering arbitrary legacy `approval_request` rows.

- [ ] **Step 5: Run inbox suites**

```bash
pnpm --dir apps/webapp test \
  src/lib/approvals/projection/inbox-query.test.ts \
  src/lib/approvals/inbox \
  src/app/api/approvals/inbox
```

### Task 5.3: Build Requester/Mobile Projection Query and Shadow Comparison

**Files:**
- Create: `apps/webapp/src/lib/approvals/projection/requester-query.ts`
- Create: `apps/webapp/src/lib/approvals/projection/requester-query.test.ts`
- Modify: `apps/webapp/src/lib/self-service-requests/get-self-service-requests.ts`
- Modify: `apps/webapp/src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/my-requests/actions.ts`
- Modify: `apps/webapp/src/app/api/mobile/my-requests/route.ts`
- Modify: `apps/webapp/src/app/api/mobile/my-requests/route.test.ts`
- Modify: `apps/webapp/src/app/api/mobile/shared.ts`
- Create: `apps/mobile/src/features/my-requests/use-my-requests-query.test.ts`
- Modify: `apps/mobile/src/features/my-requests/my-requests-screen.test.tsx`

- [ ] **Step 1: Write parity tests**

Assert one logical item per workflow, current stage/reviewer visibility, persisted cancelled history, pagination beyond 100 rows, and identical web/mobile statuses.

- [ ] **Step 2: Query requester projection only**

Map the requester projection to the existing response shape. In `shadow` and `ready` modes, compare it with source fan-out while returning the legacy response. Remove source fan-out only during Phase 9 after canonical soak.

- [ ] **Step 3: Require approved mobile membership status**

Align mobile active-organization membership validation with web authorization.

- [ ] **Step 4: Run requester and mobile suites**

### Task 5.4: Migrate Dashboard and Analytics

**Files:**
- Create: `apps/webapp/src/lib/approvals/projection/dashboard-query.ts`
- Create: `apps/webapp/src/lib/approvals/projection/dashboard-query.test.ts`
- Create: `apps/webapp/src/lib/approvals/projection/analytics-query.ts`
- Create: `apps/webapp/src/lib/approvals/projection/analytics-query.test.ts`
- Modify: `apps/webapp/src/components/dashboard/actions.ts`
- Modify: `apps/webapp/src/components/dashboard/pending-approvals-widget.tsx`
- Modify: `apps/webapp/src/components/dashboard/recently-approved-requests.ts`
- Modify: `apps/webapp/src/lib/effect/services/analytics.service.ts`
- Modify: `apps/webapp/src/lib/analytics/__tests__/approval-performance.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/__tests__/analytics-manager-effectiveness.service.test.ts`

- [ ] **Step 1: Write parity tests for pending, recently approved, and response-time metrics**
- [ ] **Step 2: Count workflow outcomes once, not intermediate stages**
- [ ] **Step 3: Remove separate travel-claim counting**
- [ ] **Step 4: Compute SLA windows with an explicit Temporal instant**
- [ ] **Step 5: Run dashboard and analytics suites**

In `shadow` and `ready` modes, record metric parity but continue returning legacy dashboard and analytics values. Phase 8 switches each consumer after readiness.

### Task 5.5: Define Canonical-to-Client Type Mapping and New Inbox UI

**Files:**
- Modify: `apps/webapp/src/lib/approvals/inbox/types.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/types.test.ts`
- Modify: `apps/webapp/src/lib/self-service-requests/types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-toolbar.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-toolbar.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-table.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-inbox-table.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-detail-panel.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-detail-panel.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/components/approval-sprint-card.tsx`
- Modify: `apps/webapp/messages/approvals/en.json`
- Modify the `de.json`, `el.json`, `es.json`, `fr.json`, `gsw.json`, `it.json`, `pl.json`, `pt.json`, and `tr.json` files in `apps/webapp/messages/approvals/`.

- [ ] **Step 1: Encode compatibility mapping tests**

Map `absence -> absence_entry`; all three time workflow types to client type `time_entry` with distinct `workflowType` and labels; `travel_expense -> travel_expense_claim`; `shift_request -> shift_request`; and `compliance_exception -> compliance_exception`. Keep persisted workflow type in detail/decision contracts so time decisions never route by broad client type.

- [ ] **Step 2: Add shift and compliance filters, rows, details, sprint rendering, and translations**
- [ ] **Step 3: Add component tests for every workflow type and capability set**
- [ ] **Step 4: Keep new filters hidden until the corresponding domain rollout is `canonical`**

### Phase 5 Gate

- [ ] `/approvals/inbox`, `/my-requests`, mobile, dashboard, and analytics have shared projection queries with clean shadow parity.
- [ ] Requester and inbox status parity tests pass.
- [ ] Filters, counts, pagination, and date ranges agree.
- [ ] Multi-stage workflows appear once to requesters and analytics.

---

## Phase 6: Move Side Effects and Escalation to the Outbox

### Task 6.1: Implement Durable Outbox Claiming and Dispatch

**Files:**
- Create: `apps/webapp/src/lib/approvals/outbox/processor.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/processor.test.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/notification-dispatcher.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/notification-dispatcher.test.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/calendar-dispatcher.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/calendar-dispatcher.test.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/webhook-dispatcher.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/webhook-dispatcher.test.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/derived-work-dispatcher.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/derived-work-dispatcher.test.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/registry.ts`
- Create: `apps/webapp/src/lib/approvals/outbox/registry.test.ts`
- Modify: `apps/webapp/src/lib/cron/registry.ts`
- Modify: `apps/webapp/src/lib/cron/schedules.ts`
- Modify: `apps/webapp/src/lib/cron/registry.test.ts`
- Modify: `apps/webapp/src/lib/cron/schedules.test.ts`

- [ ] **Step 1: Write event-expansion, claim, retry, idempotency, and crash-recovery tests**

Test one delivery row per recipient/channel, a crash after one channel succeeds but before the next starts, a retry that selects only unfinished deliveries, and duplicate event expansion producing no duplicate delivery rows.

- [ ] **Step 2: Materialize delivery rows transactionally**

Expand each workflow event into organization-enabled recipient/channel deliveries using deterministic keys `{eventId}:{recipientKind}:{recipientId}:{channel}`. Mark the event expanded only after all delivery rows exist.

Use a typed exhaustive dispatcher registry covering in-app, email, mobile push, Teams, Slack, Telegram, Discord, webhook, calendar sync, surcharge recalculation, and work-balance/cache invalidation messages. The registry test must fail compilation/runtime completeness when a new outbox message type lacks a dispatcher.

- [ ] **Step 3: Claim bounded delivery batches with `FOR UPDATE SKIP LOCKED`**
- [ ] **Step 4: Record each channel result independently**

Use capped exponential retry. Pass the delivery dedupe key to providers that support idempotency, rely on the unique notification key for in-app delivery, and retain existing bot message ledgers for interactive channels. Delivery remains explicitly at-least-once for providers without idempotency support.

- [ ] **Step 5: Register `cron:approval-outbox` every minute as a high-risk job**

Capture delivery disposition when the event is inserted, based on the domain's side-effect mode. `observe` deliveries are expanded for recipient/channel parity, marked terminal as `suppressed`, and can never be replayed after a later cutover. Only events created after an audited switch to side-effect mode `canonical` receive `deliver` disposition.

### Task 6.2: Convert Notification and Calendar Producers

**Files:**
- Modify: `apps/webapp/src/lib/notifications/notification-service.ts`
- Modify: `apps/webapp/src/lib/notifications/__tests__/notification-service.test.ts`
- Modify: `apps/webapp/src/lib/notifications/triggers.ts`
- Modify: `apps/webapp/src/lib/notifications/triggers.test.ts`
- Modify: `apps/webapp/src/lib/notifications/teams-channel.ts`
- Create: `apps/webapp/src/lib/notifications/teams-channel.test.ts`
- Modify: `apps/webapp/src/lib/notifications/slack-channel.ts`
- Create: `apps/webapp/src/lib/notifications/slack-channel.test.ts`
- Modify: `apps/webapp/src/lib/notifications/telegram-channel.ts`
- Modify: `apps/webapp/src/lib/notifications/telegram-channel.test.ts`
- Modify: `apps/webapp/src/lib/notifications/discord-channel.ts`
- Create: `apps/webapp/src/lib/notifications/discord-channel.test.ts`
- Modify: `apps/webapp/src/lib/queue/index.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts`

- [ ] **Step 1: Add tests proving rollback sends nothing**
- [ ] **Step 2: Dispatch `approval.stage_assigned` to the exact active assignee set**
- [ ] **Step 3: Dispatch final requester decisions only after terminal workflow state**
- [ ] **Step 4: Add notification idempotency keys and preserve recipient locale**
- [ ] **Step 5: Isolate legacy producers behind side-effect mode**

Keep legacy post-commit delivery active while side-effect mode is `legacy`; suppress canonical deliveries for those same events. Phase 8 switches side-effect mode under the rollout lock and removes/bypasses legacy producers atomically for subsequent events.

### Task 6.3: Consolidate Escalation and Bot Decisions

**Files:**
- Create: `apps/webapp/src/lib/approvals/escalation/service.ts`
- Create: `apps/webapp/src/lib/approvals/escalation/service.test.ts`
- Modify: `apps/webapp/src/lib/bot-platform/approval-decision.ts`
- Modify: `apps/webapp/src/lib/bot-platform/approval-decision.test.ts`
- Modify: `apps/webapp/src/lib/teams/approval-handler.ts`
- Create: `apps/webapp/src/lib/teams/approval-handler.test.ts`
- Modify: `apps/webapp/src/lib/slack/approval-handler.ts`
- Create: `apps/webapp/src/lib/slack/approval-handler.test.ts`
- Modify: `apps/webapp/src/lib/telegram/approval-handler.ts`
- Modify: `apps/webapp/src/lib/telegram/approval-handler.test.ts`
- Modify: `apps/webapp/src/lib/discord/approval-handler.ts`
- Create: `apps/webapp/src/lib/discord/approval-handler.test.ts`
- Modify: `apps/webapp/src/lib/cron/registry.ts`
- Modify: `apps/webapp/src/lib/cron/registry.test.ts`
- Modify: `apps/webapp/src/lib/cron/schedules.ts`
- Modify: `apps/webapp/src/lib/cron/schedules.test.ts`

- [ ] **Step 1: Write stale-stage, reassignment, duplicate-run, cross-org, and inactive-backup tests**
- [ ] **Step 2: Atomically reassign stage assignment and inbox projection**
- [ ] **Step 3: Emit one `approval.escalated` outbox event**
- [ ] **Step 4: Route all bot decisions through the transition engine**
- [ ] **Step 5: Enable shared escalation cron, then delete platform-specific escalation jobs after parity**

### Phase 6 Gate

- [ ] No external side effect occurs before commit.
- [ ] Outbox delivery is explicitly at-least-once, retries only unfinished per-channel deliveries, and uses provider/in-app/bot deduplication wherever supported.
- [ ] Every channel notifies the actual active reviewer.
- [ ] One shared escalation transition authorizes every channel consistently.

---

## Phase 7: Backfill, Reconcile, and Repair Persisted Data

### Task 7.1: Implement Resumable Classification and Backfill

**Files:**
- Create: `apps/webapp/src/lib/approvals/projection/migration/classification.ts`
- Create: `apps/webapp/src/lib/approvals/projection/migration/classification.test.ts`
- Create: `apps/webapp/src/lib/approvals/projection/migration/backfill.ts`
- Create: `apps/webapp/src/lib/approvals/projection/migration/backfill.test.ts`
- Create: `apps/webapp/src/lib/approvals/projection/migration/issues.ts`
- Create: `apps/webapp/src/lib/approvals/projection/migration/issues.test.ts`
- Create: `apps/webapp/scripts/approval-workflow-maintenance.ts`

- [ ] **Step 1: Encode deterministic classifications**

Absence and travel map directly. Time maps by explicit metadata, correction links, known reason, and pending-change markers. Shift and compliance map from their source rows. Unknown time rows become quarantined reconciliation records; they are never guessed.

- [ ] **Step 2: Backfill workflows in organization-scoped bounded batches**

Capture a stable per-organization high-water mark, preserve existing approval request IDs as stage IDs when possible, collapse chain rows into one workflow, preserve stage order and decisions, create requester/inbox projections, and checkpoint after each batch. Shadow writes from Phases 4-6 capture changes newer than the high-water mark while the backfill runs.

For each imported legacy decision, append a deterministic event keyed by the legacy request/stage ID. Preserve actor, timestamp, reason, previous/resulting status, and legacy reference. When historical actor evidence is absent, use actor kind `legacy_unknown` rather than inventing an employee.

- [ ] **Step 3: Recover pending source rows lacking actionable approvals**

Create workflows only when source status is operationally pending and routing resolves safely. Managerless or malformed records create durable `approval_workflow_migration_issue` rows for operator review.

- [ ] **Step 4: Add dry-run and organization filters to the maintenance CLI**

Commands:

```bash
pnpm --dir apps/webapp exec tsx scripts/approval-workflow-maintenance.ts backfill --dry-run
pnpm --dir apps/webapp exec tsx scripts/approval-workflow-maintenance.ts backfill --organization-id "$ORGANIZATION_ID"
pnpm --dir apps/webapp exec tsx scripts/approval-workflow-maintenance.ts issues --organization-id "$ORGANIZATION_ID"
pnpm --dir apps/webapp exec tsx scripts/approval-workflow-maintenance.ts dispose-issue --issue-id "$ISSUE_ID" --resolution "$RESOLUTION"
```

These scoped commands require database credentials and explicitly exported shell variables. Every disposition records operator identity, resolution, evidence, and timestamp; it never silently deletes an issue.

### Task 7.2: Implement Reconciliation and Readiness Gates

**Files:**
- Create: `apps/webapp/src/lib/approvals/projection/migration/reconciliation.ts`
- Create: `apps/webapp/src/lib/approvals/projection/migration/reconciliation.test.ts`
- Create: `apps/webapp/src/lib/approvals/projection/migration/cutover-state.ts`
- Create: `apps/webapp/src/lib/approvals/projection/migration/cutover-state.test.ts`
- Create: `apps/webapp/src/lib/approvals/projection/health.ts`
- Create: `apps/webapp/src/lib/approvals/projection/health.test.ts`

- [ ] **Step 1: Compare legacy and canonical task identity/status/assignee/timestamps**
- [ ] **Step 2: Compare source state, workflow state, canonical time-record state, and immutable decisions**
- [ ] **Step 3: Compare requester item counts, inbox counts by reviewer/type, dashboard totals, and analytics buckets**
- [ ] **Step 4: Detect orphan sources, orphan tasks, unsupported types, cross-org references, and duplicate outbox events**
- [ ] **Step 5: Make `assertApprovalWorkflowReady(organizationId, workflowType)` fail closed on hard mismatches**

- [ ] **Step 6: Run final catch-up reconciliation**

After the bounded scan reaches its high-water mark, repeat reconciliation until two consecutive passes observe no new legacy-only changes. Then take the exclusive transaction advisory lock for `(organizationId, workflowType)`; all approval writers already take its shared counterpart. Perform one final legacy/canonical comparison and move the organization/domain from `shadow` to `ready` in the same transaction.

### Task 7.3: Generate Backfill/Constraint Migration

**Files:**
- Create: `apps/webapp/drizzle/0055_approval_workflow_backfill.sql`
- Update matching Drizzle metadata and migration tests.

- [ ] **Step 1: Keep large row backfill in resumable application code**
- [ ] **Step 2: Use SQL only for deterministic schema-level backfills such as `shift_request.organization_id` from `shift.organization_id`**
- [ ] **Step 3: Leave not-null and final composite constraints for the Phase 8 contract migration after readiness proves no violating rows**

### Phase 7 Gate

- [ ] Every organization has a rollout checkpoint.
- [ ] Hard mismatches, unsupported types, and cross-org references are zero.
- [ ] Quarantined rows have explicit operator disposition.
- [ ] Shadow parity remains clean for the agreed soak period before cutover.

---

## Phase 8: Cut Over Domains and Consumers

### Task 8.1: Add Controlled Per-Domain Cutover

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/cutover.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/cutover.test.ts`
- Modify: `apps/webapp/src/db/schema/approval-workflow.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/diagnostics/diagnostics-client.test.tsx`

- [ ] **Step 1: Represent cutover state in database, not environment variables**

Store organization/domain modes as `legacy`, `shadow`, `ready`, `canonical`, and `complete`. This is operational workflow state, not tenant-secret configuration.

- [ ] **Step 2: Require readiness before entering canonical mode**
- [ ] **Step 3: Keep rollback to shadow mode while legacy mirror writes remain active**
- [ ] **Step 4: Surface mismatch, outbox backlog, and last reconciliation in platform diagnostics**

### Task 8.2: Cut Over in Dependency Order

- [ ] **Step 1: Cut over analytics and dashboard reads**

These are non-mutating and reveal projection parity without risking decisions.

- [ ] **Step 2: Cut over `/my-requests` and mobile reads**
- [ ] **Step 3: Cut over absence, time correction, and travel writes/decisions**
- [ ] **Step 4: Cut over manual time and policy clock-out writes/decisions**
- [ ] **Step 5: Cut over shift and compliance writes/decisions**
- [ ] **Step 6: Enable shift/compliance inbox filters and detail panels**
- [ ] **Step 7: Switch `/approvals/inbox` to canonical-only reads after every domain is authoritative**
- [ ] **Step 8: Exercise rollback, then perform the irreversible side-effect cutover**

Before this step, roll every domain back to `shadow` and forward to `canonical` in a non-production environment, reconcile both directions, and take a verified snapshot. Then, under the exclusive organization/workflow rollout lock, verify no pending legacy post-commit delivery is in flight, set side-effect mode to `canonical`, and disable legacy producers for newly committed events. Pre-cutover canonical deliveries remain terminal `suppressed`; only new `deliver` events are processed. This side-effect switch is irreversible: incident handling pauses canonical delivery and repairs/replays canonical rows; it never re-enables legacy producers.

For Steps 1-7: run focused tests, run reconciliation, observe one release checkpoint, and retain database-backed rollback to shadow. Step 8 begins only after the rollback drill passes and ends the rollback window.

### Task 8.3: Apply Contract Constraints

**Files:**
- Create: `apps/webapp/drizzle/0056_approval_workflow_contract.sql`
- Update schema snapshots, journal, and migration tests.

- [ ] **Step 1: Make `shift_request.organization_id` and shadow lifecycle status non-null, then swap to the dedicated status column**

Keep source `approvalWorkflowId` links nullable because many valid absence, work-period, travel, shift, and compliance rows never require approval. Enforce uniqueness on active workflows by canonical `(organizationId, sourceType, sourceId)` and validate that source rows in an approval-required pending state have a workflow through reconciliation and transactional creation tests.
- [ ] **Step 2: Add final composite foreign keys and active-source uniqueness constraints**
- [ ] **Step 3: Re-run full reconciliation after migration**

### Phase 8 Gate

- [ ] All seven domains create and decide canonical workflows.
- [ ] All user-facing and operational consumers read canonical projections.
- [ ] Outbox and escalation health meet production thresholds.
- [ ] Rollback was exercised in a non-production environment.

---

## Phase 9: Remove Legacy Approval Infrastructure

### Task 9.1: Remove Legacy Runtime Reads and Writes

**Files:**
- Delete after replacement: `apps/webapp/src/lib/approvals/application/approval-query.service.ts`
- Delete after replacement: `apps/webapp/src/lib/approvals/server/queries.ts`
- Delete after replacement: `apps/webapp/src/lib/approvals/handlers/base-handler.ts`
- Delete after replacement: `apps/webapp/src/lib/teams/jobs/escalation-checker.ts`
- Delete after replacement: `apps/webapp/src/lib/slack/jobs/escalation-checker.ts`
- Delete after replacement: `apps/webapp/src/lib/telegram/jobs/escalation-checker.ts`
- Delete after replacement: `apps/webapp/src/lib/discord/jobs/escalation-checker.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/statistics/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-data.ts`
- Modify: `apps/webapp/src/lib/audit-pack/application/audit-pack-orchestrator.ts`
- Modify: `apps/webapp/src/lib/payroll-workspace/summary.ts`
- Modify: `apps/webapp/src/lib/time-record/migration/backfill.ts`
- Modify: `apps/webapp/src/lib/demo/demo-data.service.ts`
- Modify: `apps/webapp/src/lib/demo/delete-non-admin.ts`
- Modify: `apps/webapp/src/lib/jobs/organization-cleanup.ts`

- [ ] **Step 1: Search the complete runtime inventory**

```bash
rg -n 'approvalRequest|approval_request|ApprovalQueryService|getPendingApprovals|getPendingApprovalCounts|approvalChainInstance|approvalChainStageInstance' \
  apps/webapp/src \
  --glob '!db/auth-schema.ts'
```

- [ ] **Step 2: Replace remaining statistics, payroll, audit-pack, demo, cleanup, and migration-tooling consumers**

At minimum inspect settings statistics, workday timeline, payroll workspace, audit-pack orchestrator, demo data, organization cleanup, bot ledgers, and time-record migration modules.

- [ ] **Step 3: Remove compatibility writes and classifiers**

After every organization/domain has remained `canonical` for the rollback soak period, reconciliation is clean, and snapshot restore has been exercised, switch rollout rows to `complete` and remove compatibility writes in the same release. Observe one additional release with legacy tables retained but read-only before Task 9.2.

- [ ] **Step 4: Delete obsolete services and their tests**

Do not delete historical SQL migrations.

### Task 9.2: Drop Legacy Tables and Repoint Foreign Keys

**Files:**
- Create: next migration after `0056`, expected `0057_remove_legacy_approval_tables.sql`
- Modify: `apps/webapp/src/db/schema/approval-policy.ts`
- Modify: `apps/webapp/src/db/schema/time-tracking.ts`
- Modify: `apps/webapp/src/db/schema/teams-integration.ts`
- Modify: `apps/webapp/src/db/schema/slack-integration.ts`
- Modify: `apps/webapp/src/db/schema/telegram-integration.ts`
- Modify: `apps/webapp/src/db/schema/discord-integration.ts`
- Modify: `apps/webapp/src/db/schema/relations.ts`
- Modify: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`

- [ ] **Step 1: Repoint chain-stage, work-period deletion, bot-card, and escalation ledger references to canonical workflow/stage IDs**
- [ ] **Step 2: Verify no runtime or current-schema foreign key references legacy tables**
- [ ] **Step 3: Verify database snapshot and restore procedures in a non-production environment**
- [ ] **Step 4: Drop `approval_request`, `approval_chain_instance`, and `approval_chain_stage_instance`**
- [ ] **Step 5: Verify every rollout row was already `complete` for one release and retain rollout history as migration evidence**

### Task 9.3: Final Verification

- [ ] **Step 1: Run focused approval tests**

```bash
pnpm --dir apps/webapp test src/lib/approvals src/app/api/approvals/inbox
```

- [ ] **Step 2: Run domain regression suites**

```bash
pnpm --dir apps/webapp test \
  'src/app/[locale]/(app)/absences' \
  'src/app/[locale]/(app)/time-tracking' \
  src/app/api/time-entries/corrections \
  'src/app/[locale]/(app)/travel-expenses' \
  'src/app/[locale]/(app)/scheduling' \
  'src/app/[locale]/(app)/settings/compliance'
```

- [ ] **Step 3: Run mobile tests**

```bash
pnpm --dir apps/mobile test src/features/my-requests
```

- [ ] **Step 4: Run type checking and full test suite**

```bash
pnpm --filter webapp typecheck
pnpm test
```

- [ ] **Step 5: Run production build**

```bash
CI=true pnpm build
```

- [ ] **Step 6: Confirm no current runtime legacy references**

Repeat the Phase 9 search. Expected: no runtime references outside historical migration fixtures explicitly retained for migration tests.

---

## Rollout Metrics

Track these by organization and workflow type throughout Phases 7-9:

- Pending source rows without a pending workflow.
- Pending workflows without an active human assignment or active auto-stage transition.
- Requester/inbox status mismatches.
- Source/workflow/canonical-time-record status mismatches.
- Transition conflicts and duplicate idempotency attempts.
- Workflow age and SLA distribution using explicit UTC instants.
- Outbox backlog count, oldest age, retries, and terminal failures.
- Escalation candidates, reassignments, and duplicate suppressions.
- Backfill quarantines and unresolved legacy time classifications.
- Decision failures by domain adapter.

## Execution Handoff

Execute one phase at a time with review at every phase gate. Phase 0 may ship independently as containment. Phases 1-3 establish the reusable engine. Phase 4 domain adapters can be assigned to separate workers only after the shared contracts stabilize; manual time and policy clock-out may run in parallel, as may shift and compliance. Phases 5-6 can then proceed in parallel around stable workflow events. Phases 7-9 remain sequential because each depends on observed data parity and operational soak.
