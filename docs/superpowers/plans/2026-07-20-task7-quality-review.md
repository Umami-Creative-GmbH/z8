# Task 7 Quality Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every live time-correction decision through the rollout-aware stable-target boundary, remove caller-forgeable rollout authority, enforce strict submission markers, and bound repeated-cycle reads.

**Architecture:** UI actions submit the persisted approval target ID while retaining work-period IDs only for display/cache updates. Transaction boundaries capture rollout authority once and replace the transaction context with an exact-scope fixed gate plus a compatibility writer bound to that gate; nested APIs no longer accept authority values. Exact replay uses indexed/bounded identity predicates, and partial markers fail closed.

**Tech Stack:** TypeScript, Effect, Drizzle ORM/PostgreSQL JSONB, React Query, Vitest.

---

### Task 1: Stable Live Decision Target

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`
- Modify: `apps/webapp/src/components/approvals/time-correction-approvals-table.tsx`
- Test: corresponding server/action/table tests.

- [ ] Add RED tests asserting approve/reject pass `approval.id`, never `workPeriod.id`, and live wrappers invoke `decideTimeCorrectionWithStableTargetEffect` without `processApproval`.
- [ ] Add RED all-mode tests proving shadow observation, canonical transition execution, complete-mode legacy suppression, and typed-error preservation.
- [ ] Replace live wrappers with authenticated stable-target actions and update optimistic table variables to carry `{ approvalRequestId, workPeriodId }`.
- [ ] Run focused tests GREEN.

### Task 2: Fixed Gate Context And Authority API Removal

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/start-workflow.ts`
- Modify: `apps/webapp/src/lib/approvals/domain-adapters/legacy-write-coordinator.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/absence-approvals.ts`
- Test: generic, absence, and time-correction suites.

- [ ] Add RED source/type tests proving `authoritySnapshot` is absent from exported operation inputs and object literals no longer type-check.
- [ ] Add RED behavioral tests proving exact-scope fixed gates reject organization/workflow mismatch while the physical rollout gate is acquired once.
- [ ] Remove authority fields and make nested operations acquire from their bound fixed gate.
- [ ] Rebind compatibility writers to fixed gates without exposing mode/behavior inputs.
- [ ] Remove the generic context finalizer if safe; otherwise validate/freeze its result before all persistence and test that failures cause zero writes. Document that it transforms immutable domain context only and cannot influence rollout authority.
- [ ] Run generic and absence regressions GREEN.

### Task 3: Strict Marker And Trusted Historical Identity

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Test: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

- [ ] Replace historical key-only acceptance tests with RED conflict tests across all five modes, including zero writes/effects.
- [ ] Add RED missing-marker tests: legacy without another trusted key binding conflicts; canonical deterministic workflow identity permits only unambiguous inference.
- [ ] Require every present `submission` object to contain exactly `key`, `resultKind`, and `originalStatus` as own enumerable data properties.
- [ ] Keep absent-marker inference separate from malformed-marker parsing.
- [ ] Run replay tests GREEN.

### Task 4: Bounded Repeated-Cycle Queries

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Test: server tests and SQL/source contract tests.

- [ ] Add RED tests asserting exact legacy replay uses a JSON submission-key predicate and `limit: 2`.
- [ ] Add RED tests asserting canonical compatibility lookup uses exact workflow/stage predicates and `limit: 2`.
- [ ] Add a long-history fixture proving at most two rows are materialized and ambiguity still conflicts.
- [ ] Replace source-wide `findMany` calls with exact bounded predicates while preserving organization/source scoping.
- [ ] Run focused tests GREEN.

### Task 5: Full Verification

**Files:** all touched files.

- [ ] Run the full Task 7 suite.
- [ ] Run live approval action/table tests, affected absence suites, and approve/reject route plus bot decision tests.
- [ ] Run typecheck, Biome, and `git diff --check`.
- [ ] Confirm only the established nine PostgreSQL skips remain and no commit exists.
