# Time Correction Terminal Replay And Error Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make exact time-correction submission replay preserve original public submission semantics across terminal states and translate canonical transition failures into existing typed application errors.

**Architecture:** Persist one immutable, narrowly namespaced `submission` JSON object alongside the normalized correction evidence at initial legacy and canonical creation. Parse it as strict own data, reconstruct replay from that immutable evidence rather than current status, and translate only known `ApprovalTransitionEngineError` codes at the time-correction decision boundary while preserving unknown/internal errors.

**Tech Stack:** TypeScript, Effect typed errors, Vitest, Drizzle-backed approval ports, Temporal instants.

---

### Task 1: Strict Immutable Submission Evidence

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Test: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Test: `apps/webapp/src/lib/approvals/domain-adapters/time-correction-legacy-state.test.ts`
- Test: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts`

- [ ] Add failing tests proving `submission` accepts only own enumerable data properties with exactly `key`, `resultKind`, and `originalStatus`; rejects accessors, inherited values, unknown keys, invalid enums, and key/payload mismatches.
- [ ] Run the focused tests and retain the RED evidence.
- [ ] Add a strict parser for:

```ts
type TimeCorrectionSubmissionEvidence = {
	key: string;
	resultKind: "default_created" | "chain_created" | "auto_completed";
	originalStatus: "pending" | "approved";
};
```

- [ ] Persist the evidence atomically in legacy approval metadata and canonical immutable context at initial creation. Preserve it through legacy capture and compatibility mirroring without placing it in display, search, outbox payloads, public errors, or correction-ID output.
- [ ] Run focused tests GREEN.

### Task 2: Exact Terminal Submission Replay

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify if generic replay validation requires it: `apps/webapp/src/lib/approvals/workflow/start-workflow.ts`
- Test: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Test if generic replay changes: `apps/webapp/src/lib/approvals/workflow/start-workflow.test.ts`

- [ ] Add shared-state RED tests for legacy, shadow, ready, canonical, and complete: submit pending with key K, reject through the real decision path, replay the same key/payload, and assert the same stable target/result with no new legacy/canonical/event/projection/outbox/bind/finalizer/post-commit writes.
- [ ] Add RED tests proving manager-approved originally-pending replay remains the original pending/default-or-chain response, while requester-auto-approved replay remains approved/auto-completed.
- [ ] Add RED tests for rejected, expired, and cancelled exact terminal replay; different-key later cycle; malformed marker; missing ambiguous historical marker; and exact-key payload mismatch.
- [ ] Run focused tests and retain RED evidence from current rejected/non-approved terminal conflicts and status-only approved inference.
- [ ] Refactor exact replay before pending/source conflict checks. Validate submission key, normalized correction, immutable marker, source binding, and stable target. Return original `default_created`, `chain_created`, or `auto_completed` semantics with `postCommit.terminal = null` and no writes.
- [ ] Permit historical missing-marker inference only where persisted evidence unambiguously distinguishes initial requester auto-completion from a pending creation; otherwise throw the existing generic conflict.
- [ ] Ensure a different key remains a new cycle and is subject to current source-binding rules.
- [ ] Run all replay tests GREEN.

### Task 3: Canonical Transition Error Translation

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Test: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`

- [ ] Add RED behavioral tests that inject real `ApprovalTransitionEngineError` instances through the canonical decision runtime and assert typed application errors.
- [ ] Implement a narrow translator following `translateAbsenceDecisionError`:

```ts
forbidden -> AuthorizationError
version_conflict | idempotency_mismatch -> ConflictError
malformed_command -> ValidationError
result_scope | invariant | activation_cycle -> unchanged internal error
```

- [ ] Map source/target missing failures to `NotFoundError` only where the time-correction boundary itself can identify a missing scoped entity; do not invent an engine code that does not exist.
- [ ] Preserve generic messages plus `conflictType: "approval_transition"` and `details.code`; never leak engine details.
- [ ] Run focused tests GREEN and prove an unknown `Error` retains object identity.

### Task 4: REST And Bot Propagation

**Files:**
- Test: `apps/webapp/src/lib/approvals/inbox/decision-service.test.ts`
- Test: `apps/webapp/src/app/api/approvals/inbox/[id]/approve/route.test.ts`
- Test: `apps/webapp/src/app/api/approvals/inbox/[id]/reject/route.test.ts`

- [ ] Add RED tests wiring translated time-correction decision failures into the decision service and asserting authorization/conflict/validation/not-found bot results rather than internal failure.
- [ ] Add RED approve/reject route tests asserting canonical translated failures produce 403/409/400/404 responses rather than 500.
- [ ] Make only the minimum boundary wiring changes required for these tests; retain existing route response shapes.
- [ ] Run route and decision-service tests GREEN.

### Task 5: Verification

**Files:**
- Verify all modified files.

- [ ] Run the full requested Task 7 suite.
- [ ] Run approve/reject route tests and inbox decision-service tests.
- [ ] Run supplementary shared, capture, repository, projection, and outbox suites.
- [ ] Run `pnpm --filter webapp typecheck`.
- [ ] Run Biome on every touched file and apply only safe formatting fixes.
- [ ] Run `git diff --check` and audit skips; exactly the established nine PostgreSQL skips may remain.
- [ ] Return the replay-semantics table, exact error-mapping table, GREEN counts, and skip count. Do not commit.
