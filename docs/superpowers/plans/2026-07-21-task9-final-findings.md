# Task 9 Final Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining Task 9 locking, race-model, REST rollout, idempotency, and replay findings without changing production seams.

**Architecture:** Direct correction and approval submission use one target-employee-then-work-period lock order and fail closed on non-unique or inactive targets. Tests model keyed PostgreSQL row locks only when production executes `FOR UPDATE`; REST rollout tests preserve the actual POST, submission action, and submission boundary while replacing infrastructure ports with stateful in-memory implementations.

**Tech Stack:** TypeScript, Effect, Drizzle, Vitest, Next.js route handlers, pnpm.

---

### Task 1: Target Employee Lock And Revalidation

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/time-entry.service.ts`
- Test: `apps/webapp/src/lib/effect/services/time-entry.service.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`

- [x] Add failing tests for inactive, missing, and duplicate target rows and exact lock order.
- [x] Run focused tests and retain expected RED output.
- [x] Lock exactly one active organization-scoped target employee before the exact work period lock in direct mutation and submission.
- [x] Remove the unlocked target query and fail closed before authorization or mutation.
- [x] Run focused tests and retain GREEN output.

### Task 2: Keyed Lock Contract Harness

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/time-entry.service.test.ts`

- [x] Replace `transactionTail` with keyed row-lock ownership acquired only by `.for("update")`.
- [x] Add a failing lock-disabled control proving broad transaction serialization no longer supplies safety.
- [x] Add contract labels and assertions for observed employee/work-period lock acquisition.
- [x] Run the service suite and retain RED/GREEN evidence.

### Task 3: Real Five-Mode REST Rollout Coverage

**Files:**
- Create: `apps/webapp/src/app/api/time-entries/corrections/route.rollout.test.ts`
- Modify only existing infrastructure test helpers when necessary; do not export a production test seam.

- [x] Build stateful module-mocked repository, write-gate, projection, outbox, binding, compatibility, auth, and database transport ports.
- [x] Preserve actual `POST`, `submitCorrection`, and `executeTimeCorrectionSubmissionInTransaction` imports.
- [x] Add five failing mode tests asserting mode-specific state and stable `201` payloads.
- [x] Adjust infrastructure mocks only until actual production flow passes all five modes.

### Task 4: REST Idempotency And Replay Regressions

**Files:**
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.test.ts`
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.rollout.test.ts`
- Modify production code only after a failing behavioral test.

- [x] Prove headerless retries with the same active original reuse submission and correction identities.
- [x] Prove a later active original, referenced by the request, creates new identities.
- [x] Prove fresh REST auto-completion dispatches maintenance once and exact replay adds no effect while preserving the response.
- [x] Run route suites and retain RED/GREEN evidence.

### Task 5: Verification

**Files:**
- Verify only; no commit.

- [x] Run all Task 9 action, route, service, Temporal, UI, adapter, live-action, and Task 7 approval tests.
- [x] Run `pnpm --filter webapp typecheck`.
- [x] Run targeted Biome checks and `git diff --check`.
- [x] Report RED/GREEN evidence and the remaining live PostgreSQL concurrency residual.
