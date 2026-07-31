# Task 2.1 Final Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final Task 2.1 capability-authority, plan-completeness, actor-type, and event-registry findings without adding persistence or orchestration.

**Architecture:** A complete workflow-type-keyed domain-adapter registry becomes the only capability issuer and owns the private WeakMap. Transition plans carry an authoritative cloned previous snapshot so materialization can derive and compare the full child/root diff and exact next action. Persisted assignment and event actors become distinct types, while event names come from one workflow contract tuple.

**Tech Stack:** TypeScript, Temporal, Vitest, Biome, pnpm.

---

### Task 1: Private registry authorization

**Files:**
- Create: `apps/webapp/src/lib/approvals/domain-adapters/registry.ts`
- Create: `apps/webapp/src/lib/approvals/domain-adapters/registry.test.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/types.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/approved-cancellation-capability.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/approved-cancellation-capability.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/contracts.typecheck.ts`

- [ ] Add RED runtime and type tests proving no raw issuer export exists, direct adapters cannot issue, complete registry maps are required, context type/source/org mismatches reject, and only registry tokens pass state-machine scope verification.
- [ ] Implement `createApprovalDomainAdapterRegistry` over a complete `{ [Type in ApprovalWorkflowType]: ApprovalDomainAdapter<TSourceMap[Type]> }` map.
- [ ] Keep the WeakMap and raw registration function module-private in `registry.ts`; export only token type, scope verifier, factory, and registry contract.
- [ ] Run registry, state-machine authorization, and dedicated contract checks for GREEN.

### Task 2: Authoritative previous snapshot and complete diff

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/contracts.typecheck.ts`

- [ ] Add RED exploit tests for stripped final-approval child events/changes/allocations, terminal action changed to none, omitted sibling update, extra unchanged stage change, and modified previous snapshot.
- [ ] Add deeply cloned `previousSnapshot: ApprovalWorkflowSnapshot` to every transition plan.
- [ ] Derive root, stage, update, and create changes from previous/resulting snapshots using safe semantic equality and reject deletions.
- [ ] Compare the derived complete changes exactly with listed changes before materialization, including scope and version constraints.
- [ ] Derive the required next action from resulting status/current stage and compare it to the listed action, including approved-cancel capability validation.
- [ ] Preserve event sequence/allocation checks and require child-changing plans to retain corresponding child events.
- [ ] Run focused exploit and full state-machine tests for GREEN.

### Task 3: Persisted actor split and event registry

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/types.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/ports.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/state-machine.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/contracts.typecheck.ts`

- [ ] Add RED type assertions that assignment actors cannot contain employee user context and event actors can, while materialized rows use the correct actor type.
- [ ] Define assignment, event, and command actor contracts separately and update planned/materialized snapshots and validators.
- [ ] Export `APPROVAL_WORKFLOW_EVENT_TYPES` and its union type from the workflow contract layer.
- [ ] Replace reducer-local event literals/validation registry with the shared tuple while preserving unknown-event rejection.
- [ ] Run focused tests and typechecks for GREEN.

### Task 4: Verification

**Files:**
- Verify only Task 2.1 files; do not touch schema, migrations, history, generated auth schema, persistence, or orchestration.

- [ ] Run targeted state-machine and registry tests.
- [ ] Run full workflow, approvals, and temporal-core suites.
- [ ] Run dedicated workflow and full application typechecks.
- [ ] Run Biome and `git diff --check`.
- [ ] Inspect status/diff, report RED/GREEN evidence and residual Task 2.2/2.3 risks, and leave the worktree uncommitted.
