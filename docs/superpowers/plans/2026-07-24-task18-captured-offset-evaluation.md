# Task 18 Captured-Offset Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Task 18 by evaluating immutable surcharge rules from both segment endpoint captures and by completing PostgreSQL delayed-mutation coverage.

**Architecture:** `evaluateSurchargeSnapshot` receives a half-open UTC segment with exact start and end captures. Local opening boundaries are converted with the start capture's fixed offset and local closing boundaries with the end capture's fixed offset; IANA names are validated supporting evidence only, no interior transition is inferred, and UTC duration remains authoritative. Immediate no-approval and delayed terminal reconciliation both call the same evaluator through `reconcileWorkPeriods`.

**Tech Stack:** TypeScript, Temporal, Effect, Drizzle, Vitest, PostgreSQL integration harness, Biome.

---

### Task 1: Specify Fixed-Offset Evaluator Semantics

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/surcharge-reconciliation.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/surcharge.service.ts`
- Modify: `docs/refs/timekeeping.md`

- [ ] Add failing pure tests using `{ instant, utcOffsetMinutes, timezone }` endpoint captures for day, date, normal and overnight time-window rules; same-offset, DST, and travel offset changes near midnight; overlap max-wins; decimal rounding; validity start/end inclusivity and adjacent exclusions.
- [ ] Run `pnpm test src/lib/effect/services/surcharge-reconciliation.test.ts` and confirm failures are caused by the old single-`timeZone` API and behavior.
- [ ] Replace the evaluator input with exact `start` and `end` captures. Validate safe offset range and IANA names. Generate local rule intervals with opening boundaries interpreted at the start fixed offset and closing boundaries interpreted at the end fixed offset, intersect those intervals with `[start.instant, end.instant)`, then apply validity and max-wins per preserved UTC minute.
- [ ] Document that endpoint offsets are authoritative, IANA zones are supporting evidence, and no interior transition is inferred.
- [ ] Re-run the evaluator tests and confirm they pass.

### Task 2: Route Immediate And Terminal Calculation Through Exact Captures

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/surcharge-reconciliation.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/surcharge.service.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`

- [ ] Add failing reconciliation tests proving both endpoint captures are required, the clock-out IANA zone cannot replace captured offsets, synthetic split period captures are passed unchanged, and persisted output equals direct pure-evaluator output.
- [ ] Run the focused tests and confirm the old clock-out-zone call fails the assertions.
- [ ] Build evaluator input from each period's linked clock-in and clock-out timestamp, offset, and IANA evidence. Fail before deletion for missing, mismatched, invalid, or cross-tenant evidence.
- [ ] Add a no-approval clock-out assertion showing immutable evidence uses `reconcileWorkPeriods`, the same path used by terminal maintenance.
- [ ] Re-run surcharge reconciliation and clocking tests.

### Task 3: Correct PostgreSQL Evidence Matrices

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.integration.test.ts`

- [ ] Add failing static registration assertions and executable matrix expectations that every snapshot query selects both `breakPolicySnapshot` and `surchargeSnapshot`.
- [ ] Make source pending changes and canonical workflow context mandatory in all five modes; require zero compatibility rows in complete and one exact compatibility row in applicable non-complete modes.
- [ ] Audit complete-mode branches in submission, terminal parity, delayed mutation, list/detail, and replay scenarios so compatibility absence is explicit rather than treated as a missing snapshot.
- [ ] Run the PostgreSQL static registration suite and confirm it passes.

### Task 4: Add Delayed Assignment Replacement And Rule Deletion Cases

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/work-period-approvals.integration.test.ts`

- [ ] Add executable `it.each(modes)` cases that submit policy clock-out evidence, replace/deactivate the selected assignment, and approve after submission.
- [ ] Add executable `it.each(modes)` cases that delete the snapshotted rule after first removing stale foreign-key references, then approve after submission.
- [ ] Assert split and no-split calculations retain snapshotted minutes, terminal replay leaves calculations unchanged, canonical context remains exact, and complete creates no compatibility request.
- [ ] Run the static PostgreSQL suite; attempt the Docker-backed runner and record infrastructure failure if Docker still crashes before PostgreSQL starts.

### Task 5: Verify And Commit

**Files:**
- Verify all modified Task 18 files.

- [ ] Run surcharge snapshot, evaluator, reconciliation, clocking, submission, and PostgreSQL static suites.
- [ ] Run `pnpm typecheck`.
- [ ] Run Biome on touched files and `git diff --check`.
- [ ] Review tenant scoping, parameterized SQL, private snapshot redaction, fixed-offset use, and absence of live model/rule reads.
- [ ] Commit exactly `fix: evaluate surcharge evidence at captured offsets` without amending or pushing.
