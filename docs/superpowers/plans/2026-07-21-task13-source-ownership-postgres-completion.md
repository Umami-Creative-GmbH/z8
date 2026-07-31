# Task 13 Source Ownership And PostgreSQL Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Task 13's targeted source-write ownership, real PostgreSQL concurrency/rollback, CI enforcement, and explicit local-skip gaps.

**Architecture:** Extend the existing approval mutation analyzer with targeted source mutation capabilities rather than protecting all writes to `work_period` and `time_entry`. Exercise production repositories, transition engine, finalizers, binding, and cancellation against the existing disposable PostgreSQL schema, with strict database guards and non-skippable CI wiring.

**Tech Stack:** TypeScript 6, TypeScript compiler API, Drizzle ORM, PostgreSQL 16, Vitest, GitHub Actions, pnpm.

---

### Task 1: Targeted Source Mutation Model

**Files:**
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary-sql.ts`
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary-typescript.ts`
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary.ts`
- Test: `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`

- [ ] Add failing tests for direct and aliased Drizzle `workPeriod.approvalWorkflowId` updates.
- [ ] Add failing tests for raw SQL updates of `work_period.approval_workflow_id`.
- [ ] Add failing tests for Drizzle and raw SQL correction inserts and lifecycle updates involving `type`, `is_superseded`, `replaces_entry_id`, and `superseded_by_id`.
- [ ] Verify RED with `pnpm --filter webapp exec vitest run src/lib/approvals/approval-write-boundary.test.ts`.
- [ ] Add exact source mutation target types carrying table, operation, columns, and correction-row semantics.
- [ ] Extend TypeScript provenance to recognize `workPeriod` and `timeEntry`, `.values()` and `.set()` object keys, helper/alias propagation, and targeted source findings.
- [ ] Extend SQL parsing to return inserted/updated column sets and correction-row semantics when statically provable; fail closed on protected targeted columns when values are dynamic.
- [ ] Add exact path/function owner declarations and path/table/operation/column-scoped exceptions.
- [ ] Verify GREEN and inventory every production source finding.

### Task 2: Production Source Ownership Cleanup

**Files:**
- Modify only production callers identified by the Task 1 inventory.
- Test: `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`

- [ ] Add a failing inventory assertion that every production targeted source write is either an exact owner or exact exception.
- [ ] Add assertions that monolithic actions, REST routes, demo services, and server actions are not owners.
- [ ] Move approval-owned source mutations behind existing owner functions where inventory identifies bypasses.
- [ ] Retain only concrete non-approval time-entry exceptions with exact columns and operations.
- [ ] Verify ownership tests GREEN and record the final exception inventory.

### Task 3: PostgreSQL Fixture And Guard Contracts

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/repository-integration-harness.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.integration.test.ts`
- Test: `apps/webapp/src/lib/approvals/workflow/repository-integration-runner.test.ts`

- [ ] Add failing tests proving absent local variables produce a named skipped disposable PostgreSQL suite.
- [ ] Add failing tests proving a wrong sentinel or configured unsafe database fails instead of skipping.
- [ ] Add a failing CI contract proving `APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED=1` forbids skips.
- [ ] Implement a tri-state guard: unavailable, enabled, or configuration error.
- [ ] Build minimal reusable organization/user/employee/time-entry/work-period/canonical/workflow seed and snapshot helpers.
- [ ] Verify guard contracts GREEN without a live database.

### Task 4: PostgreSQL Races And Lock Ordering

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.integration.test.ts`

- [ ] Add and run a failing requester-cancellation-vs-approval test using production cancellation and finalization boundaries; assert one winner and source parity.
- [ ] Add and run a failing concurrent employee/period/endpoint/predecessor/canonical lock-order test with PostgreSQL lock observation and bounded timeout; assert no deadlock.
- [ ] Add and run a failing concurrent distinct correction-cycle test; assert one pending winner.
- [ ] Add and run a failing terminal-then-next-cycle test; assert both workflow histories remain.
- [ ] Add and run a failing immediate-manager-correction-vs-pending-creation test; assert one winner and exact source state.
- [ ] Apply minimal production transaction/constraint fixes only where live RED demonstrates a defect.
- [ ] Rerun each test GREEN before proceeding.

### Task 5: PostgreSQL CAS And Atomic Rollback

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.integration.test.ts`

- [ ] Add parameterized live tests that force stale correction activation, original supersede, work-period, and canonical CAS failures after prior writes.
- [ ] Snapshot canonical workflow, events, receipts, projections, outbox, compatibility rows, correction rows, and source rows before each attempt.
- [ ] Assert each failure rolls every table back to the exact snapshot.
- [ ] Add injected projection, outbox, compatibility, and source-binding failure cases through production ports.
- [ ] Add duplicate terminal finalization coverage proving one application and rejection of the duplicate.
- [ ] Apply only transaction-owner fixes demonstrated by RED and rerun GREEN.

### Task 6: PostgreSQL Replay And Duplicate Effects

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.integration.test.ts`
- Modify if required by RED: `apps/webapp/src/lib/approvals/workflow/transition-engine.ts`
- Modify if required by RED: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`

- [ ] Add a live canonical time-correction transition receipt replay test using the production repository and transition engine.
- [ ] Assert identical results, one receipt, one finalizer application, and no duplicate events/projections/outbox/legacy/source effects.
- [ ] Verify RED for any duplicate effect, implement the minimal receipt/finalizer ordering fix, and rerun GREEN.

### Task 7: CI And Runner Enforcement

**Files:**
- Modify: `.github/workflows/tests.yml`
- Modify: `apps/webapp/scripts/run-approval-workflow-repository-integration.sh`
- Modify: `apps/webapp/package.json`
- Test: `apps/webapp/src/lib/approvals/workflow/repository-integration-runner.test.ts`
- Test: `apps/webapp/src/lib/approvals/server/time-correction-approvals.integration.test.ts`

- [ ] Add failing contracts requiring the time-correction integration file, URL, sentinel, and required flag in CI.
- [ ] Add the explicit test file to the CI Vitest invocation and set `APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED=1`.
- [ ] Keep the label-owned local runner's explicit file list synchronized.
- [ ] Ensure package scripts invoke only the established disposable runner.
- [ ] Verify CI/runner contracts GREEN.

### Task 8: Final Verification

**Files:**
- Modify only files needed to resolve verification failures.

- [ ] Run ownership and non-live integration tests.
- [ ] Run the complete focused Task 13 suite.
- [ ] Run `pnpm --filter webapp typecheck`.
- [ ] Run scoped Biome on every changed Task 13 source/test/workflow file.
- [ ] Run `git diff --check` and inspect the final diff and exception inventory.
- [ ] Attempt `pnpm --filter webapp test:approval-workflow-repository:integration`; report Docker `SIGBUS` exactly if it recurs.
- [ ] Do not commit.
