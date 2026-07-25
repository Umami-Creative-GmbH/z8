# Ordinary Work-Period Approval Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate manual time submissions and policy-gated clock-outs to concrete organization-scoped approval workflow adapters without changing public behavior or enabling new rollout modes.

**Architecture:** A shared ordinary work-period contract, verified legacy capture, terminal finalizer, and adapter factory serve two fixed workflow types: `manual_time_submission` and `policy_clock_out`. Existing creation and decision paths cross one repository-owned rollout boundary, while exact source locking, immutable kind metadata, canonical-record parity, affected-row compare-and-swap, compatibility projections, and post-commit side-effect descriptors preserve tenant isolation and transactional correctness. Terminal policy-clock-out approval also invokes one transaction-only break-maintenance boundary that atomically rewrites the approved source into two matching legacy and canonical segments when policy requires a break.

**Tech Stack:** TypeScript, Next.js 16 server actions, Drizzle ORM, PostgreSQL, Effect, Temporal, Vitest, canonical approval repository and transition engine, pnpm.

**Design:** `docs/superpowers/specs/2026-07-22-ordinary-work-period-approval-adapters-design.md`

**Constraints:** Work only in `/home/kai/projekte/z8/.worktrees/approval-workflow-rewrite`. Do not apply migrations, change rollout rows, enable shadow/ready/canonical/complete, add requester cancellation, build external outbox delivery, change public response shapes, or edit `src/db/auth-schema.ts`. Preserve UTC instants and existing timekeeping meaning. Every touched query and mutation must enforce exact `organizationId`, employee, source, and workflow-type ownership.

---

## File Map

- Create `apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts`: strict ordinary-kind context parsing, immutable private payload, and safe display evidence.
- Create `apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.test.ts`: strict keys, fixed-kind matching, redaction, and immutable-output tests.
- Create `apps/webapp/src/lib/approvals/domain-adapters/work-period-legacy-state.ts`: transaction-scoped capture of work period, canonical record, request, chain, actor, kind, and source-link evidence.
- Create `apps/webapp/src/lib/approvals/domain-adapters/work-period-legacy-state.test.ts`: exact capture, ambiguity, parity, and tenant-isolation tests.
- Create `apps/webapp/src/lib/approvals/domain-adapters/work-period.adapter.ts`: shared factory producing the two fixed ordinary work-period adapters.
- Create `apps/webapp/src/lib/approvals/domain-adapters/work-period.adapter.test.ts`: parameterized adapter contract tests for both workflow types.
- Create `apps/webapp/src/lib/approvals/server/work-period-submission.ts`: trusted transaction-bound five-mode submission orchestration.
- Create `apps/webapp/src/lib/approvals/server/work-period-submission.test.ts`: rollout, replay, routing, auto-completion, rollback, and side-effect tests.
- Create `apps/webapp/src/lib/approvals/server/work-period-approvals.integration.test.ts`: disposable PostgreSQL locking, compare-and-swap, replay, race, rollback, and tenant tests.
- Create `apps/webapp/src/lib/time-tracking/policy-clock-out-terminal-break.ts`: transaction-only policy lookup, Temporal break planning, synthetic entry creation, and canonical two-segment persistence.
- Create `apps/webapp/src/lib/time-tracking/policy-clock-out-terminal-break.test.ts`: no-op, split, timezone, metadata, allocation, compare-and-swap, and failure tests.
- Create `apps/webapp/src/lib/time-tracking/break-policy-calculation.ts`: pure shared break-rule selection and deficit calculation.
- Create `apps/webapp/src/lib/time-tracking/break-policy-calculation.test.ts`: threshold, highest-rule, existing-break, and no-policy tests.
- Create `apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.ts`: canonical-only ordinary inbox list, count, and detail composition with compatibility deduplication.
- Create `apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.test.ts`: complete discovery, visibility, deduplication, redaction, and stable-target tests.
- Create `apps/webapp/src/lib/time-tracking/policy-clock-out-break-snapshot.ts`: strict immutable break-policy snapshot parser and transaction-bound resolver.
- Create `apps/webapp/src/lib/time-tracking/policy-clock-out-break-snapshot.test.ts`: snapshot normalization, policy mutation, replay, and tenant tests.
- Create `apps/webapp/src/lib/time-tracking/policy-clock-out-surcharge-snapshot.ts`: strict immutable surcharge assignment, model, and rule evidence.
- Create `apps/webapp/src/lib/time-tracking/policy-clock-out-surcharge-snapshot.test.ts`: surcharge snapshot normalization, delayed mutation, split, and replay tests.
- Modify `apps/webapp/src/lib/approvals/time-request-kind.ts`: fail closed on contradictory ordinary-time classification evidence.
- Modify `apps/webapp/src/lib/approvals/workflow/ports.ts`: type ordinary workflow source snapshots instead of leaving them `unknown`.
- Modify `apps/webapp/src/lib/approvals/server/work-period-approvals.ts`: exact terminal finalizer, rollout-aware stable-target decisions, and detached post-commit descriptors.
- Modify `apps/webapp/src/lib/approvals/domain-adapters/production-registry.ts`: register both concrete ordinary adapters.
- Modify `apps/webapp/src/lib/approvals/workflow/runtime.ts`: compose the shared adapter factory through injected terminal dependencies.
- Modify `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`: preserve strict ordinary kind metadata in generated legacy rows.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.ts`: retain public wrappers while removing direct approval writes and policy fallback ownership.
- Modify modular and monolithic time-tracking creation paths: route manual submissions and policy clock-outs through the shared submission boundary.
- Modify inbox, handler, bulk, bot, and direct work-period decision paths: resolve one stable ordinary request target and use the shared decision owner.
- Modify inbox and requester read tests: preserve sanitized ordinary display and the current My Requests exclusion.
- Modify `apps/webapp/src/lib/approvals/approval-write-boundary.ts`: remove the ordinary direct-write exception and protect ordinary work-period approval columns.
- Modify the disposable PostgreSQL runner and CI contract tests: include the ordinary work-period integration suite.

### Task 1: Define Strict Ordinary Work-Period Evidence

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.test.ts`
- Modify: `apps/webapp/src/lib/approvals/time-request-kind.ts`
- Modify: `apps/webapp/src/lib/approvals/time-request-kind.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/contracts.typecheck.ts`

- [ ] **Step 1: Write failing strict-context tests**

Define the public contract expected by the tests:

```ts
export const ORDINARY_WORK_PERIOD_APPROVAL_KINDS = [
  "manual_time_submission",
  "policy_clock_out",
] as const;

export type OrdinaryWorkPeriodApprovalKind =
  (typeof ORDINARY_WORK_PERIOD_APPROVAL_KINDS)[number];

export interface OrdinaryWorkPeriodWorkflowPayload {
  timeRequest: { kind: OrdinaryWorkPeriodApprovalKind };
}

export function parseOrdinaryWorkPeriodWorkflowPayload(
  value: unknown,
  expectedKind?: OrdinaryWorkPeriodApprovalKind,
): Readonly<OrdinaryWorkPeriodWorkflowPayload>;
```

Test exact own enumerable data properties, ordinary UUID-independent payload stability, rejection of accessors/prototypes/symbols/arrays/unknown keys, fixed-kind mismatch, and detached frozen output. Assert JSON serialization contains only `timeRequest.kind`.

- [ ] **Step 2: Write failing ambiguity tests for historical classification**

Add table tests proving these results:

```ts
expect(classifyTimeApprovalRequest({
  metadata: {
    timeRequest: { kind: "manual_time_submission" },
    timeCorrection: { action: "edit" },
  },
})).toBe("unclassified");

expect(classifyTimeApprovalRequest({
  metadata: { timeRequest: { kind: "manual_time_submission" } },
  pendingChanges: { isNewClockOut: true },
})).toBe("unclassified");

expect(classifyTimeApprovalRequest({
  metadata: { timeRequest: { kind: "policy_clock_out" } },
  pendingChanges: { isManualEntry: true },
})).toBe("unclassified");
```

Retain explicit matching metadata, mutually exclusive historical markers, and exact legacy reason fallback when no contradictory evidence exists.

- [ ] **Step 3: Run the contract tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/work-period-contract.test.ts \
  src/lib/approvals/time-request-kind.test.ts
```

Expected: FAIL because the contract file does not exist and contradictory evidence currently returns an ordinary kind.

- [ ] **Step 4: Implement strict parsing and fail-closed classification**

Implement `parseOrdinaryWorkPeriodWorkflowPayload` with descriptor-based exact-key validation. Return a newly allocated, recursively frozen payload. Update `classifyTimeApprovalRequest` so correction metadata plus ordinary metadata, opposite pending markers, dual pending markers, and explicit-kind/opposite-reason combinations return `unclassified`.

Type `ApprovalWorkflowSourceMap` ordinary entries as a shared source interface exported from the contract:

```ts
export interface OrdinaryWorkPeriodApprovalSource {
  id: string;
  organizationId: string;
  employeeId: string;
  canonicalRecordId: string;
  approvalWorkflowId: string | null;
  approvalStatus: "pending" | "approved" | "rejected";
  startTime: string;
  endTime: string;
  durationMinutes: number;
  payload: Readonly<OrdinaryWorkPeriodWorkflowPayload>;
}
```

- [ ] **Step 5: Run focused tests, type contracts, and format checks**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/work-period-contract.test.ts \
  src/lib/approvals/time-request-kind.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/domain-adapters/work-period-contract.ts \
  src/lib/approvals/domain-adapters/work-period-contract.test.ts \
  src/lib/approvals/time-request-kind.ts \
  src/lib/approvals/time-request-kind.test.ts \
  src/lib/approvals/workflow/ports.ts \
  src/lib/approvals/workflow/contracts.typecheck.ts
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the contract**

```bash
git add apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts \
  apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.test.ts \
  apps/webapp/src/lib/approvals/time-request-kind.ts \
  apps/webapp/src/lib/approvals/time-request-kind.test.ts \
  apps/webapp/src/lib/approvals/workflow/ports.ts \
  apps/webapp/src/lib/approvals/workflow/contracts.typecheck.ts
git commit -m "feat: define ordinary work-period approval evidence"
```

### Task 2: Capture Verified Legacy Work-Period State

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/work-period-legacy-state.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/work-period-legacy-state.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.test.ts`

- [ ] **Step 1: Write failing exact-capture tests**

Require this transaction-bound interface:

```ts
export interface CaptureOrdinaryWorkPeriodLegacyStateInput {
  dbService: ApprovalDbService;
  organizationId: string;
  workPeriodId: string;
  expectedKind: OrdinaryWorkPeriodApprovalKind;
  expectedRequesterEmployeeId: string;
  approvalRequestId: string;
}

export async function captureOrdinaryWorkPeriodLegacyState(
  input: CaptureOrdinaryWorkPeriodLegacyStateInput,
): Promise<VerifiedLegacyApprovalState>;
```

Assert one capture operation returns exact source identity, request/chain cycle identity, normalized private `{ timeRequest: { kind } }`, requester/routing evidence, and a display snapshot containing only safe labels, period instants, duration, and approval status.

- [ ] **Step 2: Write failing parity, ambiguity, and isolation tests**

Cover wrong organization, employee, source, request, kind, canonical-record link, record kind, start instant, end instant, duration, approval state, deleted/incomplete period, malformed metadata, dual markers, foreign source link, and more than one row. Assert private `pendingChanges`, reasons, internal IDs, and diagnostics are absent from serialized display evidence.

- [ ] **Step 3: Run capture tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/work-period-legacy-state.test.ts \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts
```

Expected: FAIL because the capture module does not exist.

- [ ] **Step 4: Implement one-operation verified capture**

Use one parameterized SQL statement or one Drizzle relational query rooted in the exact scoped approval request. Limit each identity-bearing relation to two rows and require exactly one expected row. Compare work-period and canonical-record instants by database value, not viewer timezone. Normalize private context through `parseOrdinaryWorkPeriodWorkflowPayload` and return detached source/display snapshots.

Do not add a metadata-less canonical fallback. Historical marker and exact reason classification is permitted only inside this verified legacy capture.

- [ ] **Step 5: Run capture and planner regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/work-period-contract.test.ts \
  src/lib/approvals/domain-adapters/work-period-legacy-state.test.ts \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts
pnpm --filter webapp exec biome check \
  src/lib/approvals/domain-adapters/work-period-legacy-state.ts \
  src/lib/approvals/domain-adapters/work-period-legacy-state.test.ts
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit legacy capture**

```bash
git add apps/webapp/src/lib/approvals/domain-adapters/work-period-legacy-state.ts \
  apps/webapp/src/lib/approvals/domain-adapters/work-period-legacy-state.test.ts \
  apps/webapp/src/lib/approvals/workflow/legacy-observation-planner.test.ts
git commit -m "feat: capture ordinary work-period approval state"
```

### Task 3: Harden The Transaction-Bound Terminal Finalizer

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts`

- [ ] **Step 1: Write failing finalizer contract tests**

Define and test:

```ts
export interface FinalizeOrdinaryWorkPeriodTerminalInput {
  dbService: ApprovalDbService;
  organizationId: string;
  workPeriodId: string;
  expectedApprovalWorkflowId: string | null;
  requesterEmployeeId: string;
  actorEmployeeId: string;
  actorUserId: string;
  kind: OrdinaryWorkPeriodApprovalKind;
  transition:
    | { kind: "approve"; reason: string | null }
    | { kind: "reject"; reason: string };
  finalizedAt: Instant;
  allowUnlinkedLegacySource: boolean;
}

export async function finalizeOrdinaryWorkPeriodTerminalInTransaction(
  input: FinalizeOrdinaryWorkPeriodTerminalInput,
): Promise<WorkPeriodApprovalResult>;
```

Approval must set work-period and canonical-record state to approved. Rejection must set both to rejected without changing `clockInId`, `clockOutId`, `startTime`, `endTime`, or `durationMinutes`. Both clear `pendingChanges`, insert exactly one scoped `timeRecordApprovalDecision`, and return detached post-commit facts.

- [ ] **Step 2: Write failing lock, parity, and compare-and-swap tests**

Assert the finalizer locks the exact organization-scoped work period and canonical record before mutation. Reject mismatched employee, workflow link, record kind, endpoints, instants, duration, pending status, immutable kind, deleted period, and foreign actor. Simulate zero and two affected rows for every update and insert-returning operation; each must fail and rely on the caller transaction for rollback.

- [ ] **Step 3: Run finalizer tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/work-period-approvals.test.ts
```

Expected: FAIL because the existing finalizer does not lock, verify full source parity, validate immutable kind, or require exactly one affected row.

- [ ] **Step 4: Implement the minimal shared finalizer**

Replace private `persistWorkPeriodDecision` with the exported transaction-only finalizer. Use explicit scoped lock reads. Require the linked canonical `work` record to match employee, start, end, duration, and pending approval state. Permit a null workflow link only when `allowUnlinkedLegacySource` is true and exact verified legacy request evidence is supplied by the caller.

Use `dateFromInstant` only at the database boundary for `finalizedAt`; perform no timezone arithmetic. Return facts for notification and work-balance handling without dispatching them.

- [ ] **Step 5: Route existing wrappers through the finalizer**

Update `decideWorkPeriodWithCurrentApproverInTransaction`, `approveWorkPeriodWithCurrentApproverEffect`, `rejectWorkPeriodWithCurrentApproverEffect`, and `finalizeAutoCompletedWorkPeriodApprovalEffect` to call the finalizer without nested transactions. Keep their current exported result types until Task 8 replaces decision orchestration.

- [ ] **Step 6: Run finalizer regressions and static checks**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/work-period-approvals.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/server/work-period-approvals.ts \
  src/lib/approvals/server/work-period-approvals.test.ts
```

Expected: all commands exit 0 and recorded instants remain unchanged on rejection.

- [ ] **Step 7: Commit terminal hardening**

```bash
git add apps/webapp/src/lib/approvals/server/work-period-approvals.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts \
  apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts
git commit -m "fix: harden ordinary work-period finalization"
```

### Task 4: Implement And Register Both Concrete Adapters

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/work-period.adapter.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/work-period.adapter.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/production-registry.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/production-registry.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/registry.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/runtime.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/runtime.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-submission.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-cancellation.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-cancellation.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/mutations.test.ts`
- Modify: `apps/webapp/src/lib/demo/demo-data.service.ts`
- Modify: `apps/webapp/src/lib/demo/demo-data.service.test.ts`

- [ ] **Step 1: Write failing parameterized adapter tests**

Require this factory:

```ts
export interface OrdinaryWorkPeriodApprovalAdapterDependencies {
  finalizeTerminal(
    input: FinalizeOrdinaryWorkPeriodTerminalInput,
  ): Promise<WorkPeriodApprovalResult>;
}

export function createOrdinaryWorkPeriodApprovalAdapter(
  kind: OrdinaryWorkPeriodApprovalKind,
  dependencies: OrdinaryWorkPeriodApprovalAdapterDependencies,
): ApprovalDomainAdapter<OrdinaryWorkPeriodApprovalSource>;
```

Run the same tests for both fixed kinds. Assert fixed `workflowType`, `sourceType: "time_entry"`, exact scoped source loading, requester routing context, no approved cancellation capability, submit/approve/reject preflight, cancellation rejection, callback-owned terminal finalization, sanitized projection, and workflow/payload kind mismatch rejection.

- [ ] **Step 2: Run adapter tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/work-period.adapter.test.ts \
  src/lib/approvals/domain-adapters/production-registry.test.ts \
  src/lib/approvals/workflow/runtime.test.ts
```

Expected: FAIL because ordinary registry entries still use `ApprovalDomainNotMigratedError`.

- [ ] **Step 3: Implement the factory and strict source loader**

The adapter must parse immutable context before routing or projection, validate source identity against its fixed kind, and delegate terminal mutation only through the injected callback. `preflightCommand` permits submit, approve, and reject and rejects cancellation. `preflightTerminal` rejects cancellation and expiry until a later design defines those source semantics.

Return display payload shaped as safe work-period facts only:

```ts
{
  kind,
  title: kind === "manual_time_submission"
    ? "Manual time submission"
    : "Policy clock-out",
  startTime,
  endTime,
  durationMinutes,
  approvalStatus,
}
```

- [ ] **Step 4: Register and compose both adapters**

Change production registry input to require `manualTimeSubmission` and `policyClockOut` adapters. Update runtime construction to create both through the shared factory using injected finalization. Update every runtime call site to provide the same transaction-bound finalizer dependency; do not import server modules into adapter or runtime modules.

- [ ] **Step 5: Run adapter, runtime, and existing-domain regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/domain-adapters/work-period.adapter.test.ts \
  src/lib/approvals/domain-adapters/production-registry.test.ts \
  src/lib/approvals/domain-adapters/registry.test.ts \
  src/lib/approvals/workflow/runtime.test.ts \
  src/lib/approvals/domain-adapters/absence.adapter.test.ts \
  src/lib/approvals/domain-adapters/time-correction.adapter.test.ts \
  src/lib/approvals/server/absence-approvals.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/demo/demo-data.service.test.ts
pnpm --filter webapp typecheck
```

Expected: all commands exit 0; only travel expense, shift request, and compliance exception remain fail closed.

- [ ] **Step 6: Commit adapter registration**

```bash
git add apps/webapp/src/lib/approvals/domain-adapters/work-period.adapter.ts \
  apps/webapp/src/lib/approvals/domain-adapters/work-period.adapter.test.ts \
  apps/webapp/src/lib/approvals/domain-adapters/production-registry.ts \
  apps/webapp/src/lib/approvals/domain-adapters/production-registry.test.ts \
  apps/webapp/src/lib/approvals/domain-adapters/registry.test.ts \
  apps/webapp/src/lib/approvals/workflow/runtime.ts \
  apps/webapp/src/lib/approvals/workflow/runtime.test.ts \
  apps/webapp/src/lib/approvals/server/time-correction-submission.ts \
  apps/webapp/src/lib/approvals/server/time-correction-approvals.ts \
  apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts \
  apps/webapp/src/lib/approvals/server/time-correction-cancellation.ts \
  apps/webapp/src/lib/approvals/server/time-correction-cancellation.test.ts \
  apps/webapp/src/lib/approvals/server/absence-approvals.ts \
  apps/webapp/src/lib/approvals/server/absence-approvals.test.ts \
  'apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.ts' \
  'apps/webapp/src/app/[locale]/(app)/absences/request-absence-effect.test.ts' \
  'apps/webapp/src/app/[locale]/(app)/absences/mutations.ts' \
  'apps/webapp/src/app/[locale]/(app)/absences/mutations.test.ts' \
  apps/webapp/src/lib/demo/demo-data.service.ts \
  apps/webapp/src/lib/demo/demo-data.service.test.ts
git commit -m "feat: register ordinary work-period adapters"
```

### Task 5: Preserve Ordinary Metadata In Compatibility Rows

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts`

- [ ] **Step 1: Write failing compatibility metadata tests**

For each ordinary workflow type, require generated legacy request metadata to contain exact workflow/stage identity and strict kind:

```ts
expect(insertedRequest.metadata).toEqual({
  workflow: { id: workflow.id, organizationId: "org-1" },
  stage: { id: activeStage.id, sequence: activeStage.sequence },
  timeRequest: { kind: workflow.workflowType },
});
```

Cover direct creation, multistage advancement, auto-approval, approval, rejection, exact replay, and one ordinary kind attempting to reuse the other's context. Assert malformed or missing private context fails before any legacy write.

- [ ] **Step 2: Run compatibility tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/workflow/compatibility-writer.test.ts
```

Expected: FAIL because compatibility metadata currently augments only time corrections.

- [ ] **Step 3: Implement strict ordinary metadata augmentation**

When the source is `time_entry` and workflow type is one of the two ordinary kinds, parse canonical context with `parseOrdinaryWorkPeriodWorkflowPayload(workflow.contextSnapshot, workflow.workflowType)` and merge only the normalized `timeRequest` marker. Leave absence, time correction, and all fail-closed workflow metadata byte-equivalent.

- [ ] **Step 4: Run compatibility and transition regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/workflow/compatibility-writer.test.ts \
  src/lib/approvals/workflow/start-workflow.test.ts \
  src/lib/approvals/workflow/transition-engine.test.ts \
  src/lib/approvals/workflow/legacy-observation-planner.test.ts
pnpm --filter webapp exec biome check \
  src/lib/approvals/workflow/compatibility-writer.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit compatibility metadata**

```bash
git add apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts \
  apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts
git commit -m "feat: preserve ordinary approval compatibility metadata"
```

### Task 6: Add The Five-Mode Submission Boundary

**Files:**
- Create: `apps/webapp/src/lib/approvals/server/work-period-submission.ts`
- Create: `apps/webapp/src/lib/approvals/server/work-period-submission.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts`

- [ ] **Step 1: Write failing rollout submission tests**

Define one trusted transaction-bound API:

```ts
export interface ExecuteOrdinaryWorkPeriodSubmissionInput {
  dbService: ApprovalDbService;
  organizationId: string;
  workPeriodId: string;
  requesterEmployeeId: string;
  requesterUserId: string;
  teamId: string | null;
  defaultApproverId: string | null;
  reason: string;
  overtimeRisk: ApprovalPolicyOvertimeRisk;
  kind: OrdinaryWorkPeriodApprovalKind;
  metadata: Record<string, unknown>;
}

export interface WorkPeriodPostCommitDescriptor {
  disposition: "dispatch" | "observe";
  dedupeKey: string;
  event: "pending" | "approved" | "rejected";
  organizationId: string;
  workPeriodId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string | null;
  kind: OrdinaryWorkPeriodApprovalKind;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  reason: string | null;
}

export async function executeOrdinaryWorkPeriodSubmissionInTransaction(
  input: ExecuteOrdinaryWorkPeriodSubmissionInput,
): Promise<{
  result: ResolvePolicyAndCreateApprovalResult;
  postCommit: WorkPeriodPostCommitDescriptor | null;
}>;
```

For legacy, shadow, ready, canonical, and complete, assert exact source locking, strict metadata normalization, source/canonical parity, routing, one pending winner, exact replay, source binding, compatibility rows, projection, and observe-only outbox. Legacy writes no canonical observation. Shadow/ready atomically observe authoritative legacy state. Canonical/complete use `startApprovalWorkflow` and the concrete adapter.

- [ ] **Step 2: Add failing auto-approval and rollback tests**

For both kinds, prove requester auto-approval finalizes work period and canonical record in the submission transaction. Force failures at routing, legacy insert, capture, workflow start, source binding, projection, outbox, compatibility, and finalization; assert all source and approval writes roll back and no post-commit handler runs.

- [ ] **Step 3: Run submission tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/work-period-submission.test.ts \
  src/lib/approvals/server/work-period-approvals.test.ts
```

Expected: FAIL because ordinary creation directly uses `resolvePolicyAndCreateApproval` and has no rollout owner.

- [ ] **Step 4: Implement source locking and five-mode orchestration**

Acquire the exact advisory source lock before reading mutable source evidence. For a newly inserted manual work period, acquire the lock before approval state is made visible outside the transaction. Validate no pending `time_entry` legacy request and no pending ordinary canonical workflow exists for either ordinary kind.

Construct canonical context only from strict `{ timeRequest: { kind } }`. Return a detached post-commit descriptor; do not send notifications, calculate surcharges, mark balances, or revalidate routes inside this module.

- [ ] **Step 5: Run rollout, repository, and finalizer regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/work-period-submission.test.ts \
  src/lib/approvals/server/work-period-approvals.test.ts \
  src/lib/approvals/workflow/repository.test.ts \
  src/lib/approvals/workflow/start-workflow.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/approvals/server/work-period-submission.ts \
  src/lib/approvals/server/work-period-submission.test.ts \
  src/lib/approvals/server/work-period-approvals.ts
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit submission orchestration**

```bash
git add apps/webapp/src/lib/approvals/server/work-period-submission.ts \
  apps/webapp/src/lib/approvals/server/work-period-submission.test.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts
git commit -m "feat: orchestrate ordinary approval submissions"
```

### Task 7: Migrate Manual Entry And Policy Clock-Out Creation

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.manual-entry.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.atomicity.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.billing-guard.test.ts`
- Modify: `apps/webapp/src/lib/time-tracking/clocking-service.ts`
- Modify: `apps/webapp/src/lib/time-tracking/clocking-service.test.ts`

- [ ] **Step 1: Write failing modular creation tests**

For manual submission and policy clock-out, assert one caller transaction contains source/canonical pending state, shared submission, source binding, compatibility, projection, and outbox. Cover default manager, custom policy, requester auto-approval, multistage policy, no approver, exact retry, conflicting kind, and post-commit notification failure. Keep current action result fields and status values unchanged.

- [ ] **Step 2: Write failing monolithic-delegation and clocking-hook tests**

Assert monolithic `createManualTimeEntry` delegates to the modular implementation rather than owning a second approval write path. In `createClockingService`, prove `beforePeriodClose` and `afterPeriodClose` use the same transaction client, and no notification or maintenance effect runs before commit.

- [ ] **Step 3: Run creation tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/time-tracking/actions/approvals.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.manual-entry.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.atomicity.test.ts' \
  src/lib/time-tracking/clocking-service.test.ts
```

Expected: FAIL because creation still writes legacy approval state directly and the monolithic manual path remains independent.

- [ ] **Step 4: Replace direct approval writes with the shared boundary**

Keep exported async wrappers in the `"use server"` action module, but move trusted transaction logic to `work-period-submission.ts`. Delete `createDefaultTimeEntryApprovalRequest` and direct `approvalRequest.insert` ownership. Pass server-derived organization, requester, and approver evidence only.

For policy clock-out, invoke submission inside the clocking transaction after pending work-period and canonical-record persistence. For manual entry, invoke submission inside the transaction that creates endpoints, canonical record, and work period. Delegate the monolithic action to the modular action while preserving billing/authentication guards.

- [ ] **Step 5: Dispatch existing effects after commit**

Consume the returned descriptor only after transaction success. Preserve current pending/approved notifications, surcharge behavior, balance dirty marking, and route revalidation. Swallow and log best-effort effect failures without changing a committed success response. Canonical/complete descriptors remain observe-only and dispatch no external delivery.

- [ ] **Step 6: Run creation and public-contract regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/time-tracking/actions/approvals.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.manual-entry.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.atomicity.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.billing-guard.test.ts' \
  src/lib/time-tracking/clocking-service.test.ts \
  src/lib/approvals/server/work-period-submission.test.ts
pnpm --filter webapp typecheck
```

Expected: all commands exit 0 and public response snapshots are unchanged.

- [ ] **Step 7: Commit creation migration**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.ts' \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/approvals.test.ts' \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts' \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts' \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts' \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions.manual-entry.test.ts' \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions.atomicity.test.ts' \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions.billing-guard.test.ts' \
  apps/webapp/src/lib/time-tracking/clocking-service.ts \
  apps/webapp/src/lib/time-tracking/clocking-service.test.ts
git commit -m "feat: migrate ordinary time approval creation"
```

### Task 8A: Add Transaction-Bound Canonical Break Splitting

**Files:**
- Create: `apps/webapp/src/lib/time-tracking/break-policy-calculation.ts`
- Create: `apps/webapp/src/lib/time-tracking/break-policy-calculation.test.ts`
- Create: `apps/webapp/src/lib/time-tracking/policy-clock-out-terminal-break.ts`
- Create: `apps/webapp/src/lib/time-tracking/policy-clock-out-terminal-break.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/break-enforcement.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/__tests__/break-enforcement.service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-submission.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-submission.test.ts`

- [ ] **Step 1: Write failing pure planning and transaction-bound split tests**

Define the transaction-only boundary expected by the tests:

```ts
export interface BreakPolicyCalculationInput {
  sessionDurationMinutes: number;
  breaksTakenMinutes: number;
  regulation: {
    regulationId: string;
    regulationName: string;
    maxUninterruptedMinutes: number | null;
    breakRules: readonly {
      workingMinutesThreshold: number;
      requiredBreakMinutes: number;
    }[];
  } | null;
}

export interface BreakDeficitCalculation {
  deficit: number;
  applicableRule: {
    workingMinutesThreshold: number;
    requiredBreakMinutes: number;
  } | null;
  regulationId: string | null;
  regulationName: string | null;
  maxUninterruptedMinutes: number | null;
}

export function calculateBreakDeficit(
  input: BreakPolicyCalculationInput,
): BreakDeficitCalculation;

export interface PolicyClockOutTerminalBreakInput {
  dbService: OrdinaryWorkPeriodFinalizerDbService;
  organizationId: string;
  employeeId: string;
  actorUserId: string;
  period: {
    id: string;
    canonicalRecordId: string;
    clockInId: string;
    clockOutId: string;
    startTime: Date;
    endTime: Date;
    durationMinutes: number;
    projectId: string | null;
    workCategoryId: string | null;
    workLocationType: "office" | "home" | "remote" | "other" | null;
    approvalWorkflowId: string | null;
  };
}

export type PolicyClockOutTerminalBreakResult =
  | { kind: "not_required" }
  | {
      kind: "split";
      breakMinutes: number;
      breakStart: string;
      breakEnd: string;
      secondWorkPeriodId: string;
      secondCanonicalRecordId: string;
    };

export async function applyPolicyClockOutTerminalBreakInTransaction(
  input: PolicyClockOutTerminalBreakInput,
): Promise<PolicyClockOutTerminalBreakResult>;
```

The tests must require all of the following:

- policy assignment and break rules are evaluated at the original `period.endTime`, not approval time;
- the original real clock-out entry's IANA timezone is used for synthetic events, falling back to the employee setting only when that entry has no valid zone;
- same-local-date break gaps include only completed, non-deleted, approved periods for the exact organization and employee;
- Temporal computes break instants; `resolveFallbackTimezoneCapture` derives each synthetic entry's exact offset;
- stored adjusted duration equals `period.durationMinutes - deficit`, first duration equals the integer insertion offset, and the second receives the remaining adjusted minutes;
- no rule/deficit returns `not_required` with zero writes;
- a split creates exactly two chained synthetic entries, updates the original period and canonical record, inserts the second period, canonical base/work subtype, and every allocation copied from the original canonical record;
- only the original period keeps `approvalWorkflowId`; only the original canonical record receives the terminal decision;
- both periods carry the same adjustment reason, while only the original stores `originalEndTime` and `originalDurationMinutes`;
- every predicate includes `organizationId` and employee/source identity; stale endpoints, canonical state, workflow link, or existing adjustment fail closed;
- failures at any write reject so the caller-owned transaction can roll back.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/time-tracking/break-policy-calculation.test.ts \
  src/lib/time-tracking/policy-clock-out-terminal-break.test.ts \
  src/lib/effect/services/__tests__/break-enforcement.service.test.ts \
  src/lib/approvals/server/work-period-approvals.test.ts \
  src/lib/approvals/server/work-period-submission.test.ts
```

Expected: FAIL because the transaction-only helper does not exist and terminal approval does not consume deferred break maintenance.

- [ ] **Step 3: Implement the pure break plan and transaction-only persistence boundary**

Keep the new module independent of workflow transitions, notifications, route revalidation, and transaction ownership. Its top-level flow must remain explicit:

```ts
async function acquireEmployeeTimeEntryLock(
  db: OrdinaryWorkPeriodFinalizerDatabase,
  input: { organizationId: string; employeeId: string },
): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${input.employeeId}`}, 0))`,
  );
}

export async function applyPolicyClockOutTerminalBreakInTransaction(
  input: PolicyClockOutTerminalBreakInput,
): Promise<PolicyClockOutTerminalBreakResult> {
  await acquireEmployeeTimeEntryLock(input.dbService.db, {
    organizationId: input.organizationId,
    employeeId: input.employeeId,
  });

  const evidence = await loadTerminalBreakEvidence(input);
  assertExactLockedSource(input, evidence);

  const plan = planTerminalBreak({
    period: input.period,
    policy: evidence.policyAtClockOut,
    breaksTakenMinutes: evidence.approvedBreakMinutes,
    timezone: evidence.eventTimezone,
  });
  if (plan.kind === "not_required") return plan;

  const entries = await insertSyntheticBreakEntries(input, evidence, plan);
  await shortenOriginalPeriodAndCanonicalRecord(input, evidence, entries, plan);
  const secondCanonicalRecordId = await insertSecondCanonicalWorkRecord(
    input,
    evidence,
    plan,
  );
  const secondWorkPeriodId = await insertSecondWorkPeriod(
    input,
    evidence,
    entries,
    plan,
    secondCanonicalRecordId,
  );

  return {
    kind: "split",
    breakMinutes: plan.breakMinutes,
    breakStart: plan.breakStart.toString(),
    breakEnd: plan.breakEnd.toString(),
    secondWorkPeriodId,
    secondCanonicalRecordId,
  };
}
```

Implement `calculateBreakDeficit` in `break-policy-calculation.ts` and use it from both the old immediate enforcement service and the new terminal helper. Preserve the existing strict-threshold rule (`duration > threshold`), choose the highest applicable threshold, and subtract already-taken break minutes without dropping below zero. Do not change ordinary no-approval enforcement behavior. Do not import app-layer `actions.canonical.ts`; perform the narrow canonical base, `timeRecordWork`, allocation, and work-period writes in this domain module using the caller's transaction client.

- [ ] **Step 4: Integrate the helper into the shared terminal finalizer**

Invoke it exactly once after the approve compare-and-swap has established approved source state and before inserting terminal decision evidence:

```ts
const breakResult =
  input.kind === "policy_clock_out" && input.transition.kind === "approve"
    ? await applyPolicyClockOutTerminalBreakInTransaction({
        dbService: input.dbService,
        organizationId: input.organizationId,
        employeeId: locked.employeeId,
        actorUserId: input.actor.userId,
        period: toTerminalBreakSource(locked),
      })
    : { kind: "not_required" as const };
```

The finalizer result, workflow event, compatibility row, projection, notification descriptor, and approval decision continue to describe the original submitted interval. The helper may change only the persisted approved source graph. Rejection and `manual_time_submission` must not load policy or invoke the helper.

Remove `deferBreakEnforcement` from `WorkPeriodPostCommitDescriptor` after both explicit decisions and requester auto-completion use the shared terminal finalizer. Keep Task 7's caller guard until the field removal proves every approval-producing clock-out is consumed transactionally; then simplify the caller so only no-approval clock-outs use immediate enforcement.

- [ ] **Step 5: Add terminal-path and replay regressions**

Add tests proving:

- legacy, shadow, ready, canonical, and complete terminal approval call the helper once;
- legacy and canonical requester auto-approval call the helper once in the submission transaction;
- intermediate stages and rejection call it zero times;
- exact submission and decision replay perform zero split writes;
- a helper failure rolls back source approval, workflow/legacy decision state, compatibility, projection, and decision evidence;
- non-approval clock-out still calls existing immediate enforcement once.

- [ ] **Step 6: Run focused verification**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/time-tracking/break-policy-calculation.test.ts \
  src/lib/time-tracking/policy-clock-out-terminal-break.test.ts \
  src/lib/effect/services/__tests__/break-enforcement.service.test.ts \
  src/lib/approvals/server/work-period-approvals.test.ts \
  src/lib/approvals/server/work-period-submission.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts'
pnpm --filter webapp typecheck
pnpm --filter webapp exec biome check \
  src/lib/time-tracking/break-policy-calculation.ts \
  src/lib/time-tracking/break-policy-calculation.test.ts \
  src/lib/time-tracking/policy-clock-out-terminal-break.ts \
  src/lib/time-tracking/policy-clock-out-terminal-break.test.ts \
  src/lib/effect/services/break-enforcement.service.ts \
  src/lib/approvals/server/work-period-approvals.ts \
  src/lib/approvals/server/work-period-submission.ts
```

Expected: all commands exit 0; no approval-producing policy clock-out invokes post-commit break enforcement.

- [ ] **Step 7: Commit terminal break maintenance**

```bash
git add apps/webapp/src/lib/time-tracking/policy-clock-out-terminal-break.ts \
  apps/webapp/src/lib/time-tracking/policy-clock-out-terminal-break.test.ts \
  apps/webapp/src/lib/time-tracking/break-policy-calculation.ts \
  apps/webapp/src/lib/time-tracking/break-policy-calculation.test.ts \
  apps/webapp/src/lib/effect/services/break-enforcement.service.ts \
  apps/webapp/src/lib/effect/services/__tests__/break-enforcement.service.test.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts \
  apps/webapp/src/lib/approvals/server/work-period-submission.ts \
  apps/webapp/src/lib/approvals/server/work-period-submission.test.ts \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts' \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts'
git commit -m "feat: enforce breaks on terminal clock-out approval"
```

### Task 8B: Route Every Ordinary Decision Through One Stable Target

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/decision-service.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/decision-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/application/bulk-approval.service.ts`
- Modify: `apps/webapp/src/lib/approvals/application/bulk-approval.service.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.test.ts`
- Modify: `apps/webapp/src/components/time-tracking/time-entries-table.test.tsx`
- Verify existing bot and inbox API route tests.

- [ ] **Step 1: Write failing five-mode decision tests**

Define the transaction-bound decision API:

```ts
export async function executeOrdinaryWorkPeriodDecisionInTransaction(input: {
  dbService: ApprovalDbService;
  runtime: ReturnType<typeof createProductionApprovalWorkflowRuntime>;
  organizationId: string;
  approvalRequestId: string;
  workPeriodId: string;
  actor: CurrentApprover;
  kind: OrdinaryWorkPeriodApprovalKind;
  decision:
    | { kind: "approve"; reason: string | null }
    | { kind: "reject"; reason: string };
}): Promise<{
  result: WorkPeriodApprovalResult;
  postCommit: WorkPeriodPostCommitDescriptor | null;
}>;
```

Cover legacy, shadow, ready, canonical, and complete; direct and multistage chains; intermediate stage approval without source mutation; terminal approval/rejection; exact replay; stale request; moved active stage; wrong kind; foreign actor; foreign source; and compatibility failure rollback.

- [ ] **Step 2: Write failing stable-target entry-point tests**

Require individual inbox, bulk inbox, legacy handler, old bulk service, bot delegation, and authenticated server actions to carry the exact `approvalRequestId` into the transaction. A request ID must resolve to exactly one organization-scoped active ordinary target. Remove kind as caller authority; derive it from strict metadata and verified source evidence.

- [ ] **Step 3: Write failing direct-approve bypass tests**

For `actions/mutations.ts::approveWorkPeriod`, require an exact pending ordinary approval request and dispatch through the same stable decision owner. If no pending ordinary request exists, preserve the current authorization check but return a typed conflict rather than directly changing only `workPeriod.approvalStatus`. Assert canonical record, decision log, workflow, compatibility, projection, and notifications remain consistent.

- [ ] **Step 4: Run decision tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/work-period-approvals.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/inbox/decision-service.test.ts \
  src/lib/approvals/application/bulk-approval.service.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions/mutations.test.ts' \
  src/components/time-tracking/time-entries-table.test.tsx
```

Expected: FAIL because ordinary decisions bypass rollout acquisition, old bulk decisions omit stable request identity, and direct approval mutates only the work period.

- [ ] **Step 5: Implement stable-target rollout decisions**

Move the ordinary branch out of correction finalization into `executeOrdinaryWorkPeriodDecisionInTransaction`. Reuse the shared runtime and fixed ordinary adapter. Legacy/shadow/ready remain legacy-authoritative; canonical/complete execute transition commands. Finalize the source only for terminal transitions. Return detached post-commit descriptors and dispatch them after commit.

Keep `time-correction.handler.ts` as the legacy `time_entry` dispatch facade, but make it classify and delegate; it must never call correction finalization for ordinary kinds.

- [ ] **Step 6: Run all decision-entry regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/server/work-period-approvals.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/inbox/decision-service.test.ts \
  src/lib/approvals/application/bulk-approval.service.test.ts \
  src/lib/bot-platform/approval-decision.test.ts \
  src/app/api/approvals/inbox \
  'src/app/[locale]/(app)/time-tracking/actions/mutations.test.ts' \
  src/components/time-tracking/time-entries-table.test.tsx
pnpm --filter webapp typecheck
```

Expected: all commands exit 0; every decision path has one exact request target and one terminal source mutation.

- [ ] **Step 7: Commit decision migration**

```bash
git add apps/webapp/src/lib/approvals/server/work-period-approvals.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts \
  apps/webapp/src/lib/approvals/server/time-correction-approvals.ts \
  apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts \
  apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts \
  apps/webapp/src/lib/approvals/handlers/time-correction.handler.test.ts \
  apps/webapp/src/lib/approvals/inbox/decision-service.ts \
  apps/webapp/src/lib/approvals/inbox/decision-service.test.ts \
  apps/webapp/src/lib/approvals/application/bulk-approval.service.ts \
  apps/webapp/src/lib/approvals/application/bulk-approval.service.test.ts \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.ts' \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.test.ts' \
  apps/webapp/src/components/time-tracking/time-entries-table.test.tsx
git commit -m "feat: unify ordinary work-period decisions"
```

### Task 9: Preserve Sanitized Inbox And Requester Reads

**Files:**
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/read-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/detail-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/source-adapters.test.ts`
- Modify: `apps/webapp/src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts`
- Modify: `apps/webapp/src/lib/approvals/projection/writer.test.ts`

- [ ] **Step 1: Write failing ordinary inbox display tests**

For both kinds, assert list and detail reads show safe title, requester, period range, duration, status, stage, and available actions from compatibility rows in all rollout modes. Assert private pending changes, internal workflow/request/record IDs, reasons not already public, and source diagnostics are absent from display payload and search text.

- [ ] **Step 2: Preserve the current My Requests exclusion explicitly**

Keep the existing contract that `loadTimeCorrections` excludes `manual_time_submission` and `policy_clock_out`. Extend tests to cover canonical/complete compatibility rows and canonical requester projections, proving ordinary requests do not appear as time corrections and do not gain cancellation actions.

- [ ] **Step 3: Run read tests and confirm RED where canonical metadata is missing**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/inbox/read-service.test.ts \
  src/lib/approvals/inbox/detail-service.test.ts \
  src/lib/approvals/inbox/source-adapters.test.ts \
  src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts \
  src/lib/approvals/projection/writer.test.ts
```

Expected: ordinary legacy reads pass; new canonical compatibility and redaction assertions fail until strict ordinary metadata and projection handling is connected.

- [ ] **Step 4: Implement metadata-first safe display dispatch**

Use strict `timeRequest.kind` metadata before historical fallback. Treat malformed, ambiguous, or foreign ordinary evidence as orphaned/invalid rather than a correction. Keep mobile and web requester behavior unchanged. Do not introduce a new self-service source type in this phase.

- [ ] **Step 5: Run inbox, requester, and mobile regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/inbox/read-service.test.ts \
  src/lib/approvals/inbox/detail-service.test.ts \
  src/lib/approvals/inbox/source-adapters.test.ts \
  src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts \
  src/app/api/mobile/my-requests/route.test.ts
```

Expected: all commands exit 0 with no ordinary cancellation surface.

- [ ] **Step 6: Commit read-model hardening**

```bash
git add apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts \
  apps/webapp/src/lib/approvals/handlers/time-correction.handler.test.ts \
  apps/webapp/src/lib/approvals/inbox/read-service.test.ts \
  apps/webapp/src/lib/approvals/inbox/detail-service.test.ts \
  apps/webapp/src/lib/approvals/inbox/source-adapters.test.ts \
  apps/webapp/src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts \
  apps/webapp/src/lib/approvals/projection/writer.test.ts
git commit -m "fix: sanitize ordinary approval read models"
```

### Task 10: Close Ordinary Approval Write-Ownership Gaps

**Files:**
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary.ts`
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary-sql.ts`
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary-typescript.ts`

- [ ] **Step 1: Write failing ownership tests**

Remove the expected temporary exception for:

```ts
"src/app/[locale]/(app)/time-tracking/actions/approvals.ts": {
  approval_request: ["insert"],
}
```

Protect ordinary approval source columns on `work_period`: `approval_status`, `pending_changes`, `approval_workflow_id`, `canonical_record_id`, `clock_in_id`, `clock_out_id`, `start_time`, `end_time`, and `duration_minutes`. Add exact owner capabilities for named functions in `work-period-submission.ts` and `work-period-approvals.ts`. Assert action, clocking, direct mutation, demo, and handler files cannot directly own canonical ordinary finalization.

- [ ] **Step 2: Run ownership tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/approval-write-boundary.test.ts
```

Expected: FAIL on the existing action exception and previously unprotected work-period approval columns.

- [ ] **Step 3: Extend analyzers and delete only obsolete exceptions**

Teach SQL and TypeScript analyzers the exact protected work-period column semantics. Add no directory-wide or dynamic-payload exemption. Keep unrelated import, correction, cleanup, and legacy-domain exceptions unchanged. If a dynamic write can touch protected ordinary columns and cannot prove its payload, fail closed and refactor that write to an explicit safe column set.

- [ ] **Step 4: Run ownership and affected source tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/approval-write-boundary.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions/approvals.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/mutations.test.ts' \
  src/lib/approvals/server/work-period-submission.test.ts \
  src/lib/approvals/server/work-period-approvals.test.ts
```

Expected: all commands exit 0 and no ordinary approval direct-write bypass remains.

- [ ] **Step 5: Commit ownership enforcement**

```bash
git add apps/webapp/src/lib/approvals/approval-write-boundary.ts \
  apps/webapp/src/lib/approvals/approval-write-boundary.test.ts \
  apps/webapp/src/lib/approvals/approval-write-boundary-sql.ts \
  apps/webapp/src/lib/approvals/approval-write-boundary-typescript.ts
git commit -m "fix: enforce ordinary approval write ownership"
```

### Task 11: Prove Concurrency And Rollback In PostgreSQL

**Files:**
- Create: `apps/webapp/src/lib/approvals/server/work-period-approvals.integration.test.ts`
- Modify: `apps/webapp/scripts/run-approval-workflow-repository-integration.sh`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository-integration-runner.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/repository-integration-ci.test.ts`

- [ ] **Step 1: Write the disposable-database safety gate**

Reuse `repository-integration-harness.ts`. Refuse configured/shared databases. Run only against the runner-provisioned disposable PostgreSQL instance and skip with the established explicit prerequisite message when Docker is unavailable.

- [ ] **Step 2: Write failing submission concurrency tests**

Cover two exact retries, two distinct submissions of one kind, manual versus policy-clock-out pending competition, source advisory lock observation, stale source link, terminal prior history, foreign organization, and transaction rollback after legacy, workflow, projection, outbox, compatibility, binding, or auto-finalization failure. Exactly one conflicting pending submission may commit.

- [ ] **Step 3: Write failing terminal concurrency tests**

Race approve versus reject and duplicate approve commands. Assert one terminal source mutation, one decision row, one completed command receipt, consistent workflow/legacy/projection/outbox/source state, and generic conflict for the loser. For an enforced policy clock-out, assert exactly two synthetic entries, two approved work periods, two matching canonical work records, one workflow-owned source segment, and no duplicate split. Force zero-row compare-and-swap for work period, canonical record, decision insert, source link, and split-sensitive source state; assert complete rollback.

Inject failures after the first synthetic entry, second synthetic entry, original period update, original canonical update, new canonical base, `timeRecordWork`, allocation copy, and second period insert. After each failure, assert the original pending graph and time-entry chain are unchanged. Race terminal splitting against another employee time-entry insertion and assert the shared transaction advisory lock preserves one valid hash/previous-entry chain.

- [ ] **Step 4: Run the disposable suite and confirm RED**

Run:

```bash
pnpm --filter webapp test:approval-workflow-repository:integration
```

Expected: the new suite fails on missing runner inclusion or unresolved lock/compare-and-swap behavior; if Docker is unavailable, only the established explicit prerequisite skip is acceptable.

- [ ] **Step 5: Fix defects at their transaction owner**

Fix each race in `work-period-submission.ts`, `work-period-approvals.ts`, repository calls, or exact SQL predicates. Do not add process-local mutexes, automatic retries, broad locks, or test-only behavior.

- [ ] **Step 6: Run integration, ownership, and type checks**

Run:

```bash
pnpm --filter webapp test:approval-workflow-repository:integration
pnpm --filter webapp exec vitest run \
  src/lib/approvals/approval-write-boundary.test.ts \
  src/lib/approvals/server/work-period-submission.test.ts \
  src/lib/approvals/server/work-period-approvals.test.ts
pnpm --filter webapp typecheck
```

Expected: all available tests pass; any skip names the unavailable disposable prerequisite.

- [ ] **Step 7: Commit PostgreSQL coverage**

```bash
git add apps/webapp/src/lib/approvals/server/work-period-approvals.integration.test.ts \
  apps/webapp/scripts/run-approval-workflow-repository-integration.sh \
  apps/webapp/src/lib/approvals/workflow/repository-integration-runner.test.ts \
  apps/webapp/src/lib/approvals/workflow/repository-integration-ci.test.ts \
  apps/webapp/src/lib/approvals/server/work-period-submission.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.ts
git commit -m "test: cover ordinary approval concurrency"
```

### Task 12: Run Final Regression And Security Verification

**Files:**
- Modify only files required to fix regressions found by these commands and reviews.

- [ ] **Step 1: Run the complete focused ordinary approval suite**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/time-tracking/break-policy-calculation.test.ts \
  src/lib/time-tracking/policy-clock-out-terminal-break.test.ts \
  src/lib/approvals/time-request-kind.test.ts \
  src/lib/approvals/domain-adapters/work-period-contract.test.ts \
  src/lib/approvals/domain-adapters/work-period-legacy-state.test.ts \
  src/lib/approvals/domain-adapters/work-period.adapter.test.ts \
  src/lib/approvals/domain-adapters/production-registry.test.ts \
  src/lib/approvals/workflow/runtime.test.ts \
  src/lib/approvals/workflow/compatibility-writer.test.ts \
  src/lib/approvals/server/work-period-submission.test.ts \
  src/lib/approvals/server/work-period-approvals.test.ts \
  src/lib/approvals/server/work-period-approvals.integration.test.ts \
  src/lib/approvals/server/time-correction-approvals.test.ts \
  src/lib/approvals/handlers/time-correction.handler.test.ts \
  src/lib/approvals/inbox/decision-service.test.ts \
  src/lib/approvals/inbox/read-service.test.ts \
  src/lib/approvals/inbox/detail-service.test.ts \
  src/lib/approvals/application/bulk-approval.service.test.ts \
  src/lib/bot-platform/approval-decision.test.ts \
  src/lib/self-service-requests/__tests__/get-self-service-requests.test.ts \
  src/lib/approvals/approval-write-boundary.test.ts \
  'src/app/[locale]/(app)/time-tracking/actions/approvals.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.manual-entry.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions.atomicity.test.ts' \
  'src/app/[locale]/(app)/time-tracking/actions/mutations.test.ts'
```

Expected: all available tests pass; only established disposable PostgreSQL skips remain.

- [ ] **Step 2: Run broader approval, timekeeping, payroll, and notification regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals \
  src/lib/time-tracking \
  'src/app/[locale]/(app)/time-tracking' \
  src/app/api/approvals \
  src/lib/notifications/triggers.test.ts \
  src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts \
  src/lib/self-service-requests
```

Expected: all available tests pass with no new skips.

- [ ] **Step 3: Run typecheck, scoped Biome, full tests, build, and diff validation**

Build the exact changed source/test file list and run Biome only on supported files. Then run:

```bash
git -C apps/webapp diff --name-only --diff-filter=ACMR 3507fe87 -- \
  '*.ts' '*.tsx' '*.js' '*.jsx' '*.json' \
  | xargs -r pnpm --filter webapp exec biome check
pnpm --filter webapp typecheck
pnpm test
CI=true pnpm build
git diff --check
pnpm dlx react-doctor@latest --verbose --scope changed
```

Expected: typecheck, tests, build, and diff checks exit 0. React Doctor must not regress due to changed action or UI files. Record existing repository warnings separately rather than modifying unrelated files.

- [ ] **Step 4: Perform security and timekeeping review**

Use the `security-review` skill and verify authenticated actor/organization authority, strict input validation, parameterized SQL, exact tenant/employee/source/workflow predicates, transaction-time authorization, stable cross-tenant errors, private metadata redaction, post-commit effects, and the absence of cancellation paths.

Use the `migrate-to-temporal-api` checklist and verify no new native `Date` business arithmetic, no viewer-timezone derivation, direct stored-instant parity, explicit zones for any modified calendar boundary, and native `Date` only at database/external boundaries.

- [ ] **Step 5: Request final findings-first code review**

Use `requesting-code-review` with the approved design, this plan, and the complete diff. Require review of tenant isolation, immutable kind identity, source locking, exact replay, multistage terminal timing, compare-and-swap, compatibility metadata, direct-write ownership, private evidence, side-effect timing, and missing PostgreSQL tests. Resolve every confirmed high or medium finding and rerun the affected focused tests plus Step 3.

- [ ] **Step 6: Commit final verified fixes**

If verification required changes, inspect the final diff, stage tracked webapp fixes, inspect the staged file list, and commit them with the verification subject:

```bash
git diff --stat
git add -u apps/webapp
git diff --cached --name-only
git commit -m "fix: close ordinary approval verification gaps"
```

If verification required no changes, do not create an empty commit.

### Task 13: Serve Complete-Mode Ordinary Approvals From Canonical Projections

**Files:**
- Create: `apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.ts`
- Create: `apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.test.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/read-service.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/ordinary-read-composition.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/decision-service.test.ts`
- Modify: `apps/webapp/src/lib/approvals/application/bulk-approval.service.test.ts`

- [ ] **Step 1: Write failing canonical-only discovery tests**

Define one internal canonical read boundary:

```ts
export interface CanonicalOrdinaryInboxTarget {
  assignmentId: string;
  workflowId: string;
  workflowType: "manual_time_submission" | "policy_clock_out";
  organizationId: string;
  sourceId: string;
  requesterEmployeeId: string;
  stage: { name: string; order: number };
  display: Record<string, unknown>;
}

export async function loadCanonicalOrdinaryInboxTargets(input: {
  db: ApprovalDbService["db"];
  organizationId: string;
  visibleApproverEmployeeIds: readonly string[];
}): Promise<readonly CanonicalOrdinaryInboxTarget[]>;
```

Using real submission/projection fixtures, require complete mode with zero `approval_request` rows to appear in list and count, open by assignment ID in detail, and flow through individual and bulk decisions. Require exact organization, workflow, pending stage, pending assignment, requester, source, and projection parity. Waiting/terminal/foreign/malformed rows fail closed.

- [ ] **Step 2: Write failing deduplication and redaction tests**

Canonical mode has both a compatibility request and canonical assignment but must render one item using the compatibility request ID. Complete mode renders the assignment ID. Assert private context, policy snapshots, source diagnostics, workflow IDs, and record IDs are absent from list/detail/search text.

- [ ] **Step 3: Run read tests and confirm RED**

```bash
pnpm --filter webapp exec vitest run \
  src/lib/approvals/inbox/ordinary-canonical-read.test.ts \
  src/lib/approvals/inbox/ordinary-read-composition.test.ts \
  src/lib/approvals/inbox/read-service.test.ts \
  src/lib/approvals/inbox/detail-service.test.ts
```

Expected: complete-mode canonical assignments are absent until the canonical reader is composed.

- [ ] **Step 4: Implement canonical list, count, and detail composition**

Join `approval_inbox_projection`, `approval_workflow`, active workflow stage, and active assignment inside exact organization scope. Reuse strict ordinary source adapters for safe display. Suppress a canonical row when an organization-scoped compatibility request already owns the same workflow and active stage. Do not write compatibility rows in complete mode and do not generalize unrelated domain handlers.

- [ ] **Step 5: Verify discovery through every public inbox path**

Run list, count, detail, individual API, bulk API, UI target propagation, and stable-decision tests. Add a disposable-PostgreSQL case proving real complete submission writes zero compatibility rows but remains discoverable by assignment ID.

- [ ] **Step 6: Commit canonical read serving**

```bash
git add apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.ts \
  apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.test.ts \
  apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts \
  apps/webapp/src/lib/approvals/inbox/read-service.ts \
  apps/webapp/src/lib/approvals/inbox/ordinary-read-composition.test.ts
git commit -m "fix: serve complete ordinary approval reads"
```

### Task 14: Persist Immutable Terminal Break Policy Evidence

**Files:**
- Create: `apps/webapp/src/lib/time-tracking/policy-clock-out-break-snapshot.ts`
- Create: `apps/webapp/src/lib/time-tracking/policy-clock-out-break-snapshot.test.ts`
- Modify: `apps/webapp/src/db/schema/types.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/work-period-legacy-state.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/work-period.adapter.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-submission.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-submission.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`
- Modify: `apps/webapp/src/lib/time-tracking/policy-clock-out-terminal-break.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`

- [ ] **Step 1: Write failing strict snapshot contract tests**

Define the private versioned payload:

```ts
export type PolicyClockOutBreakSnapshot = Readonly<{
  version: 1;
  evaluatedAt: string;
  resolution:
    | { kind: "none" }
    | {
        kind: "work_policy";
        teamId: string | null;
        assignmentId: string;
        assignmentType: "employee" | "team" | "organization";
        policyId: string;
        policyName: string;
        regulationId: string | null;
        regulationName: string | null;
        maxUninterruptedMinutes: number | null;
        breakRules: readonly Readonly<{
          id: string;
          workingMinutesThreshold: number;
          requiredBreakMinutes: number;
        }>[];
      };
}>;
```

Reject unknown keys, invalid IDs, negative minutes, duplicate rule IDs/thresholds, unsorted rules, and `evaluatedAt` unequal to the canonical submitted end instant. Parsed results are detached and deeply frozen.

- [ ] **Step 2: Write failing transaction-bound resolver tests**

Resolve exact organization, employee/team, assignment priority, policy, regulation, and rules at `period.endTime` inside the source-creation transaction. Test employee/team/organization priority, no policy, tenant mismatch, malformed references, and deterministic normalized rule order.

- [ ] **Step 3: Persist identical evidence in all five modes**

Add `terminalBreakPolicy` to policy-clock-out pending changes, legacy metadata, and canonical context. Shadow/ready observation and canonical compatibility metadata must carry the same normalized snapshot. Complete stores source plus canonical context and no compatibility row. Manual submissions contain no break snapshot. Exact retry with changed snapshot conflicts.

- [ ] **Step 4: Consume only immutable evidence at terminal approval**

Remove live team/assignment/policy/regulation/rule resolution from terminal break enforcement. Pass the strictly parsed snapshot from verified source/request/workflow evidence. Retain transaction locks for source, canonical records, timezone evidence, and existing-period gaps. Newly created missing/mismatched snapshots fail before mutation; isolated historical legacy fallback remains explicit.

- [ ] **Step 5: Add delayed-approval mutation regressions**

After submission, mutate employee team, deactivate assignment, replace/archive policy, and edit/delete break rules. Terminal approval must produce the same result as the stored snapshot in legacy, shadow, ready, canonical, and complete. A stored `none` remains no-op after a later policy assignment. Replay does not query policy tables or split twice.

- [ ] **Step 6: Verify and commit snapshot evidence**

Run contract, legacy capture, submission, finalizer, break, clocking, compatibility, read-redaction, ownership, typecheck, and scoped Biome tests.

```bash
git add apps/webapp/src/lib/time-tracking/policy-clock-out-break-snapshot.ts \
  apps/webapp/src/lib/time-tracking/policy-clock-out-break-snapshot.test.ts \
  apps/webapp/src/db/schema/types.ts \
  apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts \
  apps/webapp/src/lib/approvals/server/work-period-submission.ts \
  apps/webapp/src/lib/time-tracking/policy-clock-out-terminal-break.ts \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts'
git commit -m "fix: snapshot terminal break policy evidence"
```

### Task 15: Reconcile Terminal Surcharge And Work-Balance State

**Files:**
- Modify: `apps/webapp/src/lib/time-tracking/policy-clock-out-terminal-break.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-submission.ts`
- Modify: `apps/webapp/src/lib/effect/services/surcharge.service.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/compliance.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Test corresponding files above.

- [ ] **Step 1: Write failing detached maintenance-fact tests**

Extend the private terminal result/descriptor, not public action results:

```ts
interface OrdinaryTerminalMaintenance {
  organizationId: string;
  employeeId: string;
  dirtyFromDate: string; // ISO PlainDate in the employee-owned event timezone
  decision: "approved" | "rejected";
  surchargePeriodIds: readonly string[];
  staleSurchargePeriodIds: readonly string[];
}
```

Adjusted approval returns original and second period IDs; no-split approval returns the original; rejection identifies stale pending-period surcharge state; intermediate and replay return no maintenance.

- [ ] **Step 2: Write failing organization-scoped surcharge reconciliation tests**

Add a service operation that, in exact organization scope, deletes stale calculations and recalculates each approved resulting period. Deletion must persist when recalculation yields no surcharge. Foreign period IDs fail closed. Do not use the existing unscoped short-circuit path.

- [ ] **Step 3: Stop persisting final surcharge state for pending submissions**

No-approval clock-outs retain immediate calculation. Pending approval defers final surcharge calculation. Requester auto-approval and later manager approval reconcile the committed terminal graph. Historical pending calculations are removed on approval or rejection.

- [ ] **Step 4: Dispatch internal maintenance independently from notifications**

After commit, every rollout mode marks work balance dirty from the original event-local date and reconciles surcharge facts. Notification `dispatch` versus `observe` remains unchanged. Await internal maintenance attempts with `Promise.allSettled`, log safe failures, and preserve committed success. Replay and intermediate decisions perform no maintenance.

- [ ] **Step 5: Add lifecycle regressions**

Cover explicit and requester-auto split approval, no-split approval, rejection, intermediate stage, exact replay, notification failure, maintenance failure, canonical/complete observe mode, and no-approval immediate clock-out. Assert split approval reconciles both periods once and marks balance once.

- [ ] **Step 6: Verify and commit maintenance**

Run surcharge, work-balance, clocking, submission, finalizer, decision, notification, payroll, ownership, typecheck, and scoped Biome suites.

```bash
git add apps/webapp/src/lib/time-tracking/policy-clock-out-terminal-break.ts \
  apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.ts \
  apps/webapp/src/lib/approvals/server/work-period-submission.ts \
  apps/webapp/src/lib/effect/services/surcharge.service.ts \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/compliance.ts' \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts'
git commit -m "fix: reconcile terminal time maintenance"
```

### Task 16: Re-run Final Cross-Task Verification

- [ ] **Step 1: Run complete canonical-read, snapshot, and maintenance suites**

Run all Task 13-15 tests plus the complete focused ordinary suite, approval APIs, bots, payroll, notifications, work balance, surcharge, and mobile requester tests.

- [ ] **Step 2: Run disposable PostgreSQL coverage**

Add complete-mode discovery, delayed policy mutation, and terminal maintenance cases to the 65-case suite. Run the disposable integration command. If Docker still crashes with `SIGBUS`, record the exact unexecuted count and retain the environment rerun blocker; do not claim PostgreSQL verification.

- [ ] **Step 3: Run all quality gates**

```bash
pnpm --filter webapp typecheck
pnpm --filter mobile typecheck
pnpm test
CI=true pnpm build
git diff --check
pnpm dlx react-doctor@latest --verbose --scope changed
```

Run scoped Biome, security review, Temporal/timekeeping review, and a final findings-first whole-phase code review. Resolve every confirmed Medium+ issue and rerun affected gates. Commit only verified fixes; do not create an empty commit.

### Task 17: Preserve Historical Approvals And Strict Canonical Paging

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.integration.test.ts`

- [ ] **Step 1: Write failing pre-contract compatibility tests**

An unmarked legacy policy-clock-out request created before snapshot-capable submission represents the shipped contract where break enforcement already ran at clock-out. Approval and rejection must preserve endpoints and auto-adjustment audit, change status, and never resolve current break policy or split again. A request carrying strict `ordinarySubmission` evidence but missing or mismatching snapshots remains a conflict.

- [ ] **Step 2: Implement isolated historical finalization**

Require exact organization, requester, source, pending status, verified historical kind, and absence of every new submission marker. Keep this branch legacy-only; shadow-observed, canonical, and complete workflows require immutable evidence. Rejection never needs break evidence.

- [ ] **Step 3: Write failing strict SQL validity tests**

Create policy snapshots that pass shallow version/resolution checks but fail the strict parser: unknown keys, invalid IDs, zero minutes, unsorted/duplicate rules, mismatched `evaluatedAt`, and malformed nested fields. Put more than one page before valid rows. Valid rows must still appear with exact count and cursor.

- [ ] **Step 4: Unify candidate, count, and parser validity**

Express every strict snapshot/source invariant in shared PostgreSQL predicates before ordering, cursor, limit, and count. If an invariant cannot be represented safely, continue through bounded candidate batches until `limit + 1` strictly valid rows are collected and derive counts through the same complete boundary. Invalid rows never consume slots or inflate totals.

- [ ] **Step 5: Verify and commit**

Run finalizer/replay, canonical list/count/detail/paging, redaction, decisions, ownership, typecheck, and Biome. Add executable PostgreSQL historical approval/rejection and malformed-pagination cases.

```bash
git add apps/webapp/src/lib/approvals/server/work-period-approvals.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.test.ts \
  apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.ts \
  apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.test.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.integration.test.ts
git commit -m "fix: preserve historical ordinary approvals"
```

### Task 18: Persist Immutable Surcharge Calculation Evidence

**Files:**
- Create: `apps/webapp/src/lib/time-tracking/policy-clock-out-surcharge-snapshot.ts`
- Create: `apps/webapp/src/lib/time-tracking/policy-clock-out-surcharge-snapshot.test.ts`
- Modify: `apps/webapp/src/db/schema/types.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/work-period-legacy-state.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-submission.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`
- Modify: `apps/webapp/src/lib/effect/services/surcharge.service.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Modify corresponding tests and PostgreSQL integration suite.

- [ ] **Step 1: Write failing strict surcharge snapshot tests**

Define a version-1 private snapshot evaluated at the submitted end instant. Its `resolution` is `none` or `surcharge_model` containing team, assignment ID/type/priority, model ID/name, and every calculation field from each rule: ID, name, rule type, decimal percentage, day, time window, specific/range dates, priority, and validity window. Reject unknown keys, invalid IDs/enums/decimals/times/dates, duplicates, unsorted rules, invalid rule-specific combinations, and mismatched evaluation instant. Deep-freeze detached output.

```ts
export interface PolicyClockOutSurchargeSnapshot {
  version: 1;
  evaluatedAt: string;
  resolution:
    | { kind: "none" }
    | {
        kind: "surcharge_model";
        teamId: string | null;
        assignmentId: string;
        assignmentType: "employee" | "team" | "organization";
        assignmentPriority: number;
        modelId: string;
        modelName: string;
        rules: readonly {
          id: string;
          name: string;
          ruleType: "time_window" | "day_of_week" | "date_based";
          percentage: string;
          dayOfWeek: string | null;
          windowStartTime: string | null;
          windowEndTime: string | null;
          specificDate: string | null;
          dateRangeStart: string | null;
          dateRangeEnd: string | null;
          priority: number;
          validFrom: string | null;
          validUntil: string | null;
        }[];
      };
}
```

- [ ] **Step 2: Resolve evidence inside source creation**

Resolve exact organization, employee team, effective assignment priority and specificity, model tenant parity, and active/effective rule values at `period.endTime`. Fail closed on ambiguous assignments and malformed references. `none` means no applicable assignment.

- [ ] **Step 3: Persist identical private evidence across modes**

Store `surchargeSnapshot` beside `breakPolicySnapshot` in pending changes, legacy metadata, canonical context, shadow/ready observations, and canonical compatibility metadata. Complete writes no compatibility row. Reconcile exact source/request/workflow equality; redact from display, search, errors, notifications, and logs. Terminal replay uses stored evidence without model queries.

- [ ] **Step 4: Evaluate terminal segments from immutable rules**

Extract a pure surcharge evaluator accepting the snapshot plus exact segment instants and captured offsets. No-approval clock-out may resolve and evaluate immediately. Delayed no-split and break-split maintenance evaluates each final segment only from persisted evidence, never current team, assignment, model activity, or rules.

- [ ] **Step 5: Add delayed mutation tests**

Across legacy, shadow, ready, canonical, and complete, submit then transfer team, replace/deactivate assignment, archive model, and edit/delete rules. Approve with and without split and assert submission-time results. Stored `none` remains none after later assignment. Rejection preserves historical compatibility; replay does no duplicate work.

- [ ] **Step 6: Verify and commit**

Run snapshot, contract, capture, submission, compatibility, surcharge, maintenance, clocking, redaction, ownership, payroll, typecheck, and Biome. Add executable PostgreSQL delayed-mutation and split-segment cases.

```bash
git add apps/webapp/src/lib/time-tracking/policy-clock-out-surcharge-snapshot.ts \
  apps/webapp/src/lib/time-tracking/policy-clock-out-surcharge-snapshot.test.ts \
  apps/webapp/src/db/schema/types.ts \
  apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts \
  apps/webapp/src/lib/approvals/server/work-period-submission.ts \
  apps/webapp/src/lib/effect/services/surcharge.service.ts \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts'
git commit -m "fix: snapshot terminal surcharge evidence"
```

### Task 19: Run Final Verification After Historical And Surcharge Fixes

- [ ] **Step 1: Run focused and cross-task suites**

Run Tasks 13-18, complete ordinary approvals, time corrections, no-approval clocking, inbox/API/bulk/bots, payroll, surcharge, work balance, notifications, ownership, requester, and mobile suites.

- [ ] **Step 2: Run PostgreSQL and final quality gates**

Register historical compatibility, strict pagination, and surcharge mutation cases. Attempt the disposable runner and report the exact unexecuted count if Docker remains broken. Run webapp/mobile typechecks, scoped Biome, `pnpm test`, CI build, diff/whitespace checks, React Doctor, security review, Temporal/timekeeping review, and one final whole-phase code review. Resolve every confirmed Medium+ issue and commit only actual fixes.

### Task 20: Extend Immutable Surcharge Evidence To Manual Submissions

**Files:**
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/work-period-legacy-state.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-submission.ts`
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`
- Modify: `apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Modify corresponding tests and PostgreSQL integration suite.

- [ ] **Step 1: Write failing manual snapshot lifecycle tests**

Require new marked `manual_time_submission` payloads to contain strict `surchargeSnapshot` but no `breakPolicySnapshot`. Resolve the snapshot in the manual-entry source transaction at the submitted end instant. Persist identical evidence in pending changes, legacy metadata, shadow/ready observation, canonical context, and canonical compatibility metadata; complete writes no compatibility row. Missing or mismatched marked evidence fails closed.

- [ ] **Step 2: Preserve historical manual compatibility**

Unmarked pre-contract manual requests retain existing persisted surcharge behavior. Approval/rejection does not require a snapshot. Marked new requests require it. Exact replay uses durable stored evidence and never resolves current team/model/rules.

- [ ] **Step 3: Reconcile surcharge on terminal manual approval**

Approved manual submissions emit maintenance for `[workPeriod.id]` and evaluate the stored immutable surcharge snapshot. Rejection removes stale historical state but creates no new calculation. Intermediate decisions and replay emit no maintenance. Requester auto-approval and explicit approval use the same path in legacy, shadow, ready, canonical, and complete.

- [ ] **Step 4: Add delayed mutation and redaction tests**

After submission, transfer team, replace/deactivate assignment, archive model, edit/delete rules, then approve. Results match submission evidence in every mode. Stored `none` remains none. Assert private surcharge evidence is absent from list/detail/search/errors/notifications and canonical SQL validates the exact manual two-key context before paging/counting.

- [ ] **Step 5: Add executable PostgreSQL definitions**

Cover explicit and requester-auto manual approval, rejection, replay, delayed mutations, canonical complete discovery, maintenance failure, and historical compatibility. No `todo` placeholders. Docker failure may block execution but not registration or compilation.

- [ ] **Step 6: Verify and commit**

Run manual-entry, snapshot, contract, capture, submission, finalizer, maintenance, canonical read, payroll, ownership, typecheck, and Biome tests.

```bash
git add apps/webapp/src/lib/approvals/domain-adapters/work-period-contract.ts \
  apps/webapp/src/lib/approvals/domain-adapters/work-period-legacy-state.ts \
  apps/webapp/src/lib/approvals/server/work-period-submission.ts \
  apps/webapp/src/lib/approvals/server/work-period-approvals.ts \
  apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts \
  apps/webapp/src/lib/approvals/inbox/ordinary-canonical-read.ts \
  'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts'
git commit -m "fix: reconcile manual submission surcharge"
```

### Task 21: Run Final Verification After Manual Surcharge Fix

- [ ] **Step 1: Run complete Phase 4.4 verification**

Run all focused/broad/mobile suites, full `pnpm test`, webapp/mobile typechecks, scoped Biome, CI build, diff/whitespace checks, React Doctor, security and Temporal reviews. Attempt all executable PostgreSQL cases and record the exact environment-blocked count.

- [ ] **Step 2: Request final whole-phase review**

Recheck manual and policy surcharge snapshots, complete discovery, historical compatibility, strict pagination, terminal maintenance, exact replay, time corrections, no-approval paths, tenant isolation, and public redaction. Resolve every confirmed Medium+ issue and commit only actual fixes.

## Exit Checklist

- [ ] Both ordinary workflow types use concrete production adapters.
- [ ] Manual entry and policy clock-out creation use one rollout-aware transaction owner.
- [ ] Individual, bulk, legacy, bot, and direct work-period decisions use one stable request target.
- [ ] Source, canonical record, compatibility, projection, outbox, and decision writes are atomic.
- [ ] Exact retries replay and competing pending submissions fail closed.
- [ ] Multistage source finalization occurs only on terminal transition.
- [ ] Terminal policy-clock-out approval atomically produces either no adjustment or two approved legacy/canonical segments, with workflow ownership retained only by the original segment.
- [ ] Synthetic break entries use Temporal-derived instants, exact event offsets, and a serialized employee entry chain.
- [ ] Rejection preserves recorded endpoints and instants.
- [ ] Private pending changes and internal identities never enter display or public errors.
- [ ] Existing My Requests exclusion and public response shapes remain unchanged.
- [ ] Complete-mode ordinary approvals are discoverable through canonical list, count, detail, individual, and bulk paths without legacy rows.
- [ ] Policy-clock-out break policy meaning is captured immutably at submission and survives later team or policy mutation.
- [ ] Terminal approval/rejection reconciles organization-scoped surcharge and work-balance state in every rollout mode without replay duplication.
- [ ] Unmarked historical policy-clock-out requests remain approvable and rejectable without reapplying break policy.
- [ ] Canonical pagination and counts exclude every row rejected by strict snapshot/source validation before applying limits.
- [ ] Delayed terminal surcharge calculation uses immutable submission evidence rather than current team, assignment, model, or rules.
- [ ] Approved manual submissions reconcile surcharge from immutable evidence in every rollout mode without replay duplication.
- [ ] No requester cancellation, rollout activation, or external outbox delivery is introduced.
- [ ] Ownership, PostgreSQL concurrency, focused tests, broad regressions, typecheck, scoped Biome, CI build, security review, and timekeeping review are complete.
