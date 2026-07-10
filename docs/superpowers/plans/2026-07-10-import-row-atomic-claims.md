# Import Row Atomic Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure only one worker can commit an accepted import staging row and that stale failures cannot overwrite successful commits.

**Architecture:** Keep the candidate scan, but atomically transition each row from `accepted` to `committing` as the first operation in its existing transaction. Guard every later transition with expected state and full tenant/job scope; rely on transaction rollback to release claims after thrown errors.

**Tech Stack:** Drizzle ORM, PostgreSQL conditional updates with `RETURNING`, Luxon, Vitest.

---

## File Map

- Modify `apps/webapp/src/lib/import-review/committers.ts`: claim rows and guard transitions.
- Modify `apps/webapp/src/lib/import-review/committers.setup.test.ts`: deterministic overlap and blocker tests.
- Modify `apps/webapp/src/lib/import-review/committers.test.ts`: rollback, final-failure, and organization-scope tests.

No schema migration is required because `committing` already exists. Do not modify import job leasing in `worker.ts`; that is outside this fix. Do not commit unless explicitly requested.

### Task 1: Build a Stateful Claim Test Harness

**Files:**
- Modify: `apps/webapp/src/lib/import-review/committers.setup.test.ts:3-103`

- [ ] **Step 1: Model persisted staged-row state separately from stale candidate snapshots**

Add a shared row-state map keyed by row ID. Extend the update mock so `where(...).returning()` can atomically return a row only when persisted status is `accepted`, then update it to `committing`.

Use a deferred barrier so two `commitAcceptedRowsForEntity` calls both receive the same accepted candidate before either transaction claims it. Do not use timing sleeps.

- [ ] **Step 2: Add a failing overlap test**

Run two team commits with `Promise.all` and assert:

```ts
expect(results[0].committedRows + results[1].committedRows).toBe(1);
expect(dbMock.insertCalls.filter((call) => call.name === "Operations")).toHaveLength(1);
expect(persistedRows.get("row_1")?.rowStatus).toBe("committed");
```

Also assert the losing worker reports zero committed rows and zero failed rows.

Add a stale-candidate case where persisted row organization is `org_other`; assert the claim returns no row and no target insert occurs. Inspect the claim predicate to require `organizationId`, not only row ID.

- [ ] **Step 3: Run the overlap test and confirm RED**

```bash
pnpm vitest run src/lib/import-review/committers.setup.test.ts -t "overlapping"
```

Expected: two team inserts because no claim occurs before domain writes.

### Task 2: Claim Before Domain Writes

**Files:**
- Modify: `apps/webapp/src/lib/import-review/committers.ts:21-113,430-507`

- [ ] **Step 1: Add a skipped outcome and claim helper**

Extend the outcome union:

```ts
type CommitRowOutcome =
	| { status: "committed"; chainHead?: ChainHead }
	| { status: "blocked"; message: string }
	| { status: "skipped" };
```

Add a helper whose update includes every scope predicate:

```ts
const [claimedRow] = await database
	.update(importStagedRow)
	.set({ rowStatus: "committing", commitError: null })
	.where(
		and(
			eq(importStagedRow.id, candidate.id),
			eq(importStagedRow.batchId, job.batchId),
			eq(importStagedRow.organizationId, job.organizationId),
			eq(importStagedRow.entityType, job.entityType),
			eq(importStagedRow.rowStatus, "accepted"),
		),
	)
	.returning();
```

Return the typed row or `null`.

- [ ] **Step 2: Claim as the first transaction operation**

Inside each per-row transaction, call the claim helper before the switch. Return `{ status: "skipped" }` when no row is returned. Pass `claimedRow`, not the outer candidate, to every committer.

- [ ] **Step 3: Ignore skipped outcomes in counters**

After the transaction, continue immediately for `skipped`; do not increment `committedRows`, `failedRows`, or `errors`.

- [ ] **Step 4: Run the overlap test and confirm GREEN**

```bash
pnpm vitest run src/lib/import-review/committers.setup.test.ts -t "overlapping"
```

Expected: one target insert and one committed row across both workers.

### Task 3: Guard Successful and Blocked Transitions

**Files:**
- Modify: `apps/webapp/src/lib/import-review/committers.ts:61-103`
- Modify: `apps/webapp/src/lib/import-review/committers.setup.test.ts:105-316`

- [ ] **Step 1: Add predicate assertions**

Add tests that inspect update predicates and require ID, batch, organization, entity, and `rowStatus: "committing"` for committed and blocked transitions.

- [ ] **Step 2: Add a failing non-final blocker release test**

Commit a mapping-required employee row with `finalAttempt:false`. Assert the persisted status returns to `accepted`, the result reports one blocker, and a later final attempt can claim it and set `blocked`.

- [ ] **Step 3: Run blocker tests and confirm RED**

```bash
pnpm vitest run src/lib/import-review/committers.setup.test.ts -t "block"
```

Expected: the newly claimed row remains `committing` on a non-final blocker until release logic exists.

- [ ] **Step 4: Pass full scope to transition helpers**

Replace row-ID/organization-only helper inputs with the claimed row plus job. Require `committing` in `markCommitted` and `markBlocked` predicates.

- [ ] **Step 5: Release non-final blockers**

For `finalAttempt:false`, update `committing -> accepted`, clear `commitError`, and use the same full scope. For final attempts, update `committing -> blocked`.

- [ ] **Step 6: Confirm GREEN**

```bash
pnpm vitest run src/lib/import-review/committers.setup.test.ts
```

Expected: all setup/reference tests PASS.

### Task 4: Prevent Stale Failure Overwrites

**Files:**
- Modify: `apps/webapp/src/lib/import-review/committers.test.ts:239-316,370-401`
- Modify: `apps/webapp/src/lib/import-review/committers.ts:105-113,498-503`

- [ ] **Step 1: Add a failing concurrent success versus final failure test**

Orchestrate worker A to claim and throw, roll back its transaction to `accepted`, allow worker B to claim and commit, then release A's outside failure update. Assert the row remains `committed` with B's target ID.

- [ ] **Step 2: Add a non-final rollback/retry test**

The first invocation claims and throws with `finalAttempt:false`; assert rollback restores `accepted`. Invoke again and assert exactly one target commits.

- [ ] **Step 3: Run tests and confirm RED**

```bash
pnpm vitest run src/lib/import-review/committers.test.ts -t "concurrent|retry"
```

Expected: the unconditional failure update can overwrite committed state or the mock exposes the missing expected-state predicate.

- [ ] **Step 4: Make final failure a compare-and-set**

Change `markCommitFailed` to accept candidate row and job, and update only when all scope fields match and `rowStatus` is still `accepted`:

```ts
.where(
	and(
		eq(importStagedRow.id, row.id),
		eq(importStagedRow.batchId, job.batchId),
		eq(importStagedRow.organizationId, job.organizationId),
		eq(importStagedRow.entityType, job.entityType),
		eq(importStagedRow.rowStatus, "accepted"),
	),
)
```

Do not mark failure on non-final attempts. Transaction rollback remains responsible for returning the claimed row to `accepted`.

- [ ] **Step 5: Confirm GREEN**

```bash
pnpm vitest run src/lib/import-review/committers.test.ts
```

Expected: all tests PASS.

### Task 5: Verify Import Atomicity

- [ ] Run both committer suites and worker retry coverage:

```bash
pnpm vitest run src/lib/import-review/committers.test.ts src/lib/import-review/committers.setup.test.ts src/lib/import-review/worker.test.ts src/lib/import-review/queue.test.ts
```

- [ ] Run touched-file checks:

```bash
pnpm exec biome check src/lib/import-review/committers.ts src/lib/import-review/committers.test.ts src/lib/import-review/committers.setup.test.ts
```

- [ ] Run typecheck:

```bash
pnpm typecheck
```

Expected: all commands pass. If unrelated concurrent work causes failures, report exact paths and preserve those changes.
