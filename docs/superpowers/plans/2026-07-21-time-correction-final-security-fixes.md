# Time Correction Final Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final server-action authority, organization membership, cancelled-replay, orphan-row, and REST idempotency findings without changing public response shapes.

**Architecture:** Trusted correction submission and post-commit dispatch move behind a `server-only` boundary. The locked submission transaction validates one approved Better Auth membership, reports whether workflow work executed or replayed, and lets insertion owners remove only rows created by a replaying transaction. Pure-legacy cancellation retains strict durable submission evidence, while headerless REST requests receive a fresh UUID per request.

**Tech Stack:** TypeScript, Next.js 16 Server Actions and route handlers, Drizzle ORM, Better Auth organization members, Effect, Temporal, Vitest, PostgreSQL, pnpm.

**Constraint:** Do not commit. Preserve unrelated concurrent changes.

---

### Task 1: Remove Trusted Helpers From The Server Action Surface

**Files:**
- Create: `apps/webapp/src/lib/approvals/server/time-correction-submission.ts`
- Create: `apps/webapp/src/lib/approvals/server/time-correction-submission.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts`
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.ts`
- Modify: route/action mocks that import the trusted helpers

- [x] **Step 1: Write failing architecture tests**

Assert the file-level `"use server"` module does not export `submitCorrection`, `dispatchCommittedTimeCorrectionSubmission`, or a function accepting trusted organization, employee, post-commit, reason, period, or corrected-time evidence. Assert the new internal module imports `server-only` and exposes the trusted helpers only to server code.

- [x] **Step 2: Run the architecture tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/time-tracking/actions/corrections.test.ts' src/lib/approvals/server/time-correction-submission.test.ts
```

Expected: FAIL because trusted helpers are exported from `corrections.ts` and the internal module does not exist.

- [x] **Step 3: Move the trusted boundary**

Move `ApprovalResult`, submission validation/insertion/runtime helpers, `submitCorrection`, manager resolution, and post-commit descriptor dispatch into `time-correction-submission.ts`. Start that module with:

```ts
import "server-only";
```

Keep authentication and transaction-time actor revalidation in the trusted submission function. Import it from the Server Action and REST route. Keep public Server Action response types and REST payloads unchanged.

- [x] **Step 4: Run focused tests and confirm GREEN**

Run the Step 2 command plus REST route tests. Expected: all pass.

### Task 2: Require One Approved Better Auth Membership

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-submission.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-submission.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.behavior.test.ts`

- [x] **Step 1: Write failing membership tests**

Cover one approved row, suspended member with active SCIM employee, missing member, duplicate rows across any statuses, and wrong-organization membership. Assert rejection occurs before `insertTimeCorrectionSourceEntry` and workflow execution.

- [x] **Step 2: Run tests and confirm RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/approvals/server/time-correction-submission.test.ts 'src/app/[locale]/(app)/time-tracking/actions/corrections.behavior.test.ts'
```

- [x] **Step 3: Add locked membership cardinality validation**

Inside the submission transaction, query `member` by exact `userId` and `organizationId`, do not filter status, order deterministically, lock rows, limit two, and require exactly one row whose status is `approved`. Throw the existing generic stale-actor conflict before correction insertion for every other result.

- [x] **Step 4: Run tests and confirm GREEN**

Run the Step 2 command. Expected: all pass.

### Task 3: Make Submission Replay Explicit And Orphan-Free

**Files:**
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-submission.ts`
- Modify: `apps/webapp/src/lib/demo/demo-data.service.ts`
- Modify: corresponding submission/demo tests

- [x] **Step 1: Write failing disposition and cleanup tests**

Assert every fresh mode result has `disposition: "executed"`; exact pending, approved, rejected, and cancelled retries have `disposition: "replayed"`. For modular, REST, and demo owners, simulate rows absent before retry so deterministic insertion occurs, then assert replay deletes only those newly inserted inactive rows and emits no workflow or post-commit effect. Assert pre-existing correction rows are never deleted.

- [x] **Step 2: Run relevant tests and confirm RED**

Run the Task 7 submission, action behavior, REST rollout, and demo suites.

- [x] **Step 3: Implement disposition and insertion ownership**

Add this internal field to `TimeCorrectionSubmissionResult`:

```ts
disposition: "executed" | "replayed";
```

Return `replayed` from exact legacy/canonical replay branches and `executed` from fresh coordinator/workflow branches. Change deterministic insertion to return `{ entry, inserted }`. If submission replays, delete only `inserted === true` rows using exact ID, organization, employee, type `correction`, original replacement, and inactive-state predicates; require one affected row per cleanup. Apply the same ownership rule in demo creation. Do not expose disposition publicly.

- [x] **Step 4: Run tests and confirm GREEN**

Run the Step 2 suites. Expected: all pass with zero orphan rows and no replay effects.

### Task 4: Preserve Cancelled Legacy Cycle Identity

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/compatibility-writer.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-cancellation.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-cancellation.test.ts`
- Modify: `apps/webapp/src/lib/approvals/server/time-correction-approvals.ts`
- Modify: unit and PostgreSQL integration tests

- [x] **Step 1: Write failing five-mode cancellation replay tests**

For direct and chain cycles in legacy, shadow, ready, canonical, and complete modes: cancel, retry the same submission token, and assert original semantics, `replayed`, no correction rows, no new workflow/request/effects. Submit a new token and assert a later pending cycle. Add a stateful or PostgreSQL race proving replay cleanup cannot delete a pre-existing valid row.

- [x] **Step 2: Run cancellation/submission tests and confirm RED**

Run cancellation, compatibility writer, Task 7 submission, and integration suites.

- [x] **Step 3: Retain strict pure-legacy tombstones**

For pure-legacy direct and chain cancellations, update the cycle request to a terminal rejected tombstone rather than deleting it. Preserve normalized `submission.key`, `submission.submissionId`, result kind, correction IDs, chain identity, requester cancellation identity, and cancellation instant. Keep pending chain stages unlinked from the request. Task 7 replay must find this exact tombstone by submission key and reject malformed, duplicate, foreign, or payload-mismatched evidence. Shadow/ready continue deriving canonical observation from the established before/after capture.

- [x] **Step 4: Run tests and confirm GREEN**

Run the Step 2 suites. Expected: all pass.

### Task 5: Make Headerless REST Requests Fresh Cycles

**Files:**
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.ts`
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.test.ts`
- Modify: `apps/webapp/src/app/api/time-entries/corrections/route.rollout.test.ts`

- [x] **Step 1: Write failing REST token tests**

Assert a supplied UUID is stable across exact retries; malformed present keys return 400 before repository work; two headerless identical requests receive distinct UUID submission IDs; and an identical request after rejection/cancellation creates a new cycle when the key is new or absent. Assert response payloads do not expose the token.

- [x] **Step 2: Run route tests and confirm RED**

Run both REST route suites.

- [x] **Step 3: Replace body hashing with secure request identity**

Use `randomUUID()` when the header is absent. Normalize supplied UUIDs to lowercase. Add an inline API contract comment stating that headerless requests are backward-compatible but not transport-idempotent, and clients requiring safe retries must supply `Idempotency-Key`.

- [x] **Step 4: Run route tests and confirm GREEN**

Run both REST route suites. Expected: all pass and public responses are unchanged.

### Task 6: Full Verification

- [x] **Step 1: Run Task 7-12 and security architecture suites**

Run focused approval, cancellation, REST, action, demo, self-service, and write-boundary tests from the Phase 4.3 plan.

- [ ] **Step 2: Run PostgreSQL integration when Docker is available**

```bash
pnpm --filter webapp test:approval-workflow-repository:integration
```

- [x] **Step 3: Run static and production checks**

```bash
pnpm --filter webapp typecheck
CI=true pnpm build
git diff --check
npx react-doctor@latest --verbose --scope changed
```

Run scoped Biome on every changed supported source/test file. Validate untracked files with `git diff --no-index --check`. Report exact pass/fail/skip counts, Docker availability, warnings, and residual risks. Do not commit.
