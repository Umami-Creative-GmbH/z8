# React Doctor Clockodo Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove actionable Clockodo import loop diagnostics with tenant-safe, deterministic first-wins deduplication inside each fetched payload.

**Architecture:** Test through public `orchestrateImport` so private import functions stay private. Group source rows before database work, validate employee mappings against the active organization in 500-item chunks, and run at most four independent database statements concurrently. Insert missing representatives in bounded chunks, exact-validate flattened returned identities across the payload, and reconstruct mappings and result counts in source order. Cross-import duplicate prevention remains unchanged and requires a separate data audit and database design.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Vitest

**Delivery constraint:** Leave all edits unstaged and uncommitted for working-tree review.

---

### Task 1: Add Direct Clockodo Orchestrator Coverage

**Files:**
- Create: `apps/webapp/src/lib/clockodo/import-orchestrator.test.ts`
- Test: `apps/webapp/src/lib/clockodo/import-orchestrator.ts:157-231`

- [ ] **Step 1: Create hoisted database mocks before importing the orchestrator**

Follow `clockodo-adapter.test.ts`: use `vi.hoisted`, mock `@/db`, then dynamically import `orchestrateImport`. Keep `importTeams` and `importHolidayQuotas` private. Use this mock shape:

```ts
const mocks = vi.hoisted(() => ({
	teamFindMany: vi.fn(),
	teamFindFirst: vi.fn(),
	employeeFindMany: vi.fn(),
	allowanceFindMany: vi.fn(),
	allowanceFindFirst: vi.fn(),
	insert: vi.fn(),
	insertTeamValues: vi.fn(),
	returnTeams: vi.fn(),
	insertAllowanceValues: vi.fn(),
	returnAllowances: vi.fn(),
}));
```

Configure insert builders after importing the real schema objects:

```ts
mocks.insert.mockImplementation((tableArg) => {
	if (tableArg === team) return { values: mocks.insertTeamValues };
	if (tableArg === employeeVacationAllowance) {
		return { values: mocks.insertAllowanceValues };
	}
	throw new Error("Unexpected insert table");
});
```

Expose both old `findFirst` and new `findMany` relational methods so RED is an assertion failure rather than a missing-mock error. Both values mocks return `{ returning: ... }`. Reset every mock; default `findFirst` to `null` and `findMany`/returned rows to empty arrays in `beforeEach`.

- [ ] **Step 2: Add public team and quota characterization tests**

Call `orchestrateImport` with only `teams: true` for team tests. Use source teams `{ id: 1, name: "Support", leader: null }` and `{ id: 2, name: "Support", leader: null }`; return inserted `{ id: "team-1", name: "Support" }`; assert `{ imported: 1, skipped: 1, errors: [] }` and one insert payload. For an existing `{ id: "team-existing", name: "Support" }`, assert imported `0`, skipped `2`, and no insert.

For quotas, enable `users` and `holidayQuotas`, supply manual mappings from Clockodo user `1` to `employee-1`/`user-1`, and set `onlyImportMapped: true`. Use two quotas for user `1`, year `2026`; return the active organization employee and inserted allowance key; assert imported `1`, skipped `1`, and one allowance payload. Add two unmapped source users in a known order and assert exact ordered `no matching employee found` strings and no allowance read or insert.

- [ ] **Step 3: Run tests against the current implementation**

```bash
pnpm --filter webapp test src/lib/clockodo/import-orchestrator.test.ts
```

Expected: the new batching/query-count expectations fail against per-item reads/inserts. No production export is added before RED.

### Task 2: Batch Team Import

**Files:**
- Modify: `apps/webapp/src/lib/clockodo/import-orchestrator.test.ts`
- Modify: `apps/webapp/src/lib/clockodo/import-orchestrator.ts:301-347`

- [ ] **Step 1: Strengthen the duplicate test with query counts**

Assert bounded existing-team queries and inserts. For the two-row duplicate fixture, each remains one call:

```ts
expect(mocks.teamFindMany).toHaveBeenCalledOnce();
expect(mocks.insertTeamValues).toHaveBeenCalledOnce();
expect(mocks.insertTeamValues).toHaveBeenCalledWith([
	expect.objectContaining({ organizationId: "org-1", name: "Support" }),
]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run the Task 1 Step 3 command.

Expected: the current per-team `findFirst` and insert loop violates query-count assertions.

- [ ] **Step 3: Add set-query imports**

Add `inArray` to the existing `drizzle-orm` imports.

- [ ] **Step 4: Replace the team loop with grouped batching**

Use this structure, replacing the single read and insert shown below with `mapInBoundedBatches(chunkRows(..., 500), 4, ...)` and flattening returned rows before exact-name validation:

```ts
const firstByName = new Map<string, (typeof clockodoTeams)[number]>();
for (const source of clockodoTeams) {
	if (!firstByName.has(source.name)) firstByName.set(source.name, source);
}

const names = [...firstByName.keys()];
const existingTeams = (
	await mapInBoundedBatches(
		chunkRows(names, CLOCKODO_IMPORT_QUERY_CHUNK_SIZE),
		CLOCKODO_IMPORT_CONCURRENCY,
		(nameChunk) =>
			tx.query.team.findMany({
				where: and(
					eq(team.organizationId, organizationId),
					inArray(team.name, nameChunk),
				),
				columns: { id: true, name: true },
			}),
	),
).flat();
const teamIdByName = new Map(existingTeams.map((row) => [row.name, row.id]));
const existingTeamIds = new Set(existingTeams.map((row) => row.id));
const missing = [...firstByName.values()].filter(
	(source) => !teamIdByName.has(source.name),
);

if (missing.length > 0) {
	const inserted = (
		await mapInBoundedBatches(
			chunkRows(missing, CLOCKODO_IMPORT_QUERY_CHUNK_SIZE),
			CLOCKODO_IMPORT_CONCURRENCY,
			(rows) =>
				tx
					.insert(team)
					.values(rows.map((source) => mapTeamToZ8(source, organizationId)))
					.returning({ id: team.id, name: team.name }),
		),
	).flat();
	const expectedNames = new Set(missing.map((source) => source.name));
	const returnedByName = new Map<string, string[]>();
	for (const row of inserted) {
		const ids = returnedByName.get(row.name) ?? [];
		ids.push(row.id);
		returnedByName.set(row.name, ids);
	}
	for (const name of expectedNames) {
		const ids = returnedByName.get(name);
		if (ids?.length === 1) teamIdByName.set(name, ids[0]);
	}
	for (const name of returnedByName.keys()) {
		if (!expectedNames.has(name)) {
			result.errors.push(`Team insert returned unexpected name "${name}"`);
		}
	}
}

for (const source of clockodoTeams) {
	const mappedId = teamIdByName.get(source.name);
	if (!mappedId) {
		result.errors.push(
			`Team "${source.name}": insert did not return exactly one matching team`,
		);
		continue;
	}
	idMappings.teams.set(source.id, mappedId);
	if (existingTeamIds.has(mappedId)) result.skipped++;
	else if (firstByName.get(source.name)?.id === source.id) result.imported++;
	else result.skipped++;
}
```

Add tests for missing, duplicate, and unexpected returned names, empty payloads, mixed existing/missing names, and active `organizationId` on every inserted team. Add 501 unique missing names and assert two read chunks and two insert chunks. Add a 2,001-name deferred-read case and assert the fifth query starts only after the first four settle. Instrument active promises and assert the maximum is no greater than four. Returned-name errors must be deterministic and source rows with invalid returned identity are not counted or mapped.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the Task 1 Step 3 command.

Expected: team import tests pass with deterministic mappings and counts.

### Task 3: Batch Holiday Quota Import

**Files:**
- Modify: `apps/webapp/src/lib/clockodo/import-orchestrator.test.ts`
- Modify: `apps/webapp/src/lib/clockodo/import-orchestrator.ts:719-774`

- [ ] **Step 1: Add tenant, key, batching, and returned-identity tests**

Add named tests for: one employee in 2026 and 2027; employee-1 and employee-2 in 2026; an existing exact employee/year key; a mapped employee omitted by the organization-scoped employee query; and 501 unique employee/year keys producing two validation reads and two allowance-candidate reads.

Also test an exact cross-product candidate that was not requested, missing/duplicate/unexpected inserted keys, duplicate employee/year source rows, missing mappings, and original source-order errors. Assert employee validation predicates contain both `organization_id` and `id`. For 501 keys, assert two read and two write chunks. For 2,001 mapped employee IDs, defer reads and prove the fifth starts only after the first four settle. Instrument active promises and assert no more than four statements run concurrently.

- [ ] **Step 2: Run the focused test and verify RED**

Run the Task 1 Step 3 command.

Expected: per-quota reads/inserts violate batching assertions.

- [ ] **Step 3: Add a bounded promise-batch helper**

Define `CLOCKODO_IMPORT_QUERY_CHUNK_SIZE = 500` and `CLOCKODO_IMPORT_CONCURRENCY = 4`. Add a local generic helper that processes each array in slices of four promises, preserving input/result order without an `await` inside a loop. Use recursive promise chaining between windows so React Doctor does not report a new actionable loop diagnostic. Add direct behavior through orchestrator tests that holds query promises and proves the fifth statement does not start before one of the first four settles.

```ts
function chunkRows<T>(rows: readonly T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
		rows.slice(index * size, (index + 1) * size),
	);
}

function mapInBoundedBatches<T, R>(
	items: readonly T[],
	concurrency: number,
	operation: (item: T) => Promise<R>,
	offset = 0,
): Promise<R[]> {
	const batch = items.slice(offset, offset + concurrency);
	if (batch.length === 0) return Promise.resolve([]);

	return Promise.allSettled(batch.map(operation)).then((settled) => {
		const rejected = settled.find(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		);
		if (rejected) throw rejected.reason;
		const current = settled.map((result) =>
			(result as PromiseFulfilledResult<R>).value,
		);
		return mapInBoundedBatches(
			items,
			concurrency,
			operation,
			offset + concurrency,
		).then((remaining) => [...current, ...remaining]);
	});
}
```

Keep both constants internal. Validate positive fixed constants through construction; do not add runtime configuration. Every active window must settle before its first failure is surfaced.

- [ ] **Step 4: Add phase rollback tests**

Make the database mock expose transaction-local state with commit/rollback snapshots. Add a delayed successful sibling plus a rejected sibling and assert the operation does not return before the delayed sibling settles. Add 1,001-row team and allowance cases where an earlier write window succeeds and a later chunk fails; assert no team/allowance rows, mappings, or imported counts survive the phase failure.

- [ ] **Step 5: Make each entity database phase transactional**

Run team reads/inserts and quota employee-validation/allowance reads/inserts through one `db.transaction` callback per entity phase. Use the transaction client for every query and mutation. Return local rows/maps from the callback and merge `idMappings` and result counts only after commit. A failed chunk must roll back every phase write and leave no in-memory mapping for rolled-back rows.

- [ ] **Step 6: Validate mapped employees in bounded organization-scoped chunks**

Import `employee` and `chunkEmployeeIds`, and rename `_organizationId` to `organizationId`. Collect unique mapped employee IDs and query independent bounded chunks through the concurrency-four helper:

```ts
const validatedEmployees = (
	await mapInBoundedBatches(
		chunkEmployeeIds(
			mappedEmployeeIds,
			CLOCKODO_IMPORT_QUERY_CHUNK_SIZE,
		),
		CLOCKODO_IMPORT_CONCURRENCY,
		(employeeIdChunk) =>
			tx.query.employee.findMany({
				where: and(
					eq(employee.organizationId, organizationId),
					inArray(employee.id, employeeIdChunk),
				),
				columns: { id: true },
			}),
	)
).flat();
```

Build `validatedEmployeeIds`. During the original quota traversal, keep the existing missing-mapping error. For a mapped ID absent from the validated set, append:

```ts
`Holiday quota for user ${quota.users_id}: mapped employee ${mapping.employeeId} was not found in organization ${organizationId}`
```

Do not read or insert allowances for invalid mappings.

- [ ] **Step 7: Resolve valid source rows and first-wins groups**

```ts
const valid: Array<{
	quota: (typeof quotas)[number];
	employeeId: string;
	key: string;
}> = [];
for (const quota of quotas) {
	const mapping = idMappings.users.get(quota.users_id);
	if (!mapping) {
		result.errors.push(
			`Holiday quota for user ${quota.users_id}: no matching employee found`,
		);
		continue;
	}
	if (!validatedEmployeeIds.has(mapping.employeeId)) {
		result.errors.push(
			`Holiday quota for user ${quota.users_id}: mapped employee ${mapping.employeeId} was not found in organization ${organizationId}`,
		);
		continue;
	}
	valid.push({
		quota,
		employeeId: mapping.employeeId,
		key: `${mapping.employeeId}:${quota.year_since}`,
	});
}

const firstByKey = new Map<string, (typeof valid)[number]>();
for (const row of valid) {
	if (!firstByKey.has(row.key)) firstByKey.set(row.key, row);
}
```

- [ ] **Step 8: Prefetch existing allowances in bounded exact-key chunks**

Chunk canonical `${employeeId}:${year}` keys with `chunkEmployeeIds`. Start each bounded candidate read through the all-settled concurrency helper, then retain only exact requested keys from its corresponding chunk:

```ts
const uniqueRows = [...firstByKey.values()];
const keyChunks = chunkEmployeeIds(
	uniqueRows.map((row) => row.key),
	CLOCKODO_IMPORT_QUERY_CHUNK_SIZE,
);
const candidateBatches = await mapInBoundedBatches(
	keyChunks,
	CLOCKODO_IMPORT_CONCURRENCY,
	async (keyChunk) => {
		const rows = keyChunk.map((key) => firstByKey.get(key)!);
		const employeeIds = [...new Set(rows.map((row) => row.employeeId))];
		const years = [...new Set(rows.map((row) => row.quota.year_since))];
		const candidates = await tx.query.employeeVacationAllowance.findMany({
			where: and(
				inArray(employeeVacationAllowance.employeeId, employeeIds),
				inArray(employeeVacationAllowance.year, years),
			),
			columns: { employeeId: true, year: true },
		});
		return { candidates, requestedKeys: new Set(keyChunk) };
	},
);
const existingKeys = new Set<string>();
for (const { candidates, requestedKeys } of candidateBatches) {
	for (const candidate of candidates) {
		const key = `${candidate.employeeId}:${candidate.year}`;
		if (requestedKeys.has(key)) existingKeys.add(key);
	}
}
const missing = uniqueRows.filter((row) => !existingKeys.has(row.key));
```

- [ ] **Step 9: Bulk insert and exact-validate missing allowance keys**

```ts

if (missing.length > 0) {
	const inserted = (
		await mapInBoundedBatches(
			chunkRows(missing, CLOCKODO_IMPORT_QUERY_CHUNK_SIZE),
			CLOCKODO_IMPORT_CONCURRENCY,
			(rows) =>
				tx
					.insert(employeeVacationAllowance)
					.values(
						rows.map(({ quota, employeeId }) =>
							mapHolidayQuotaToVacationAllowance(quota, employeeId),
						),
					)
					.returning({
						employeeId: employeeVacationAllowance.employeeId,
						year: employeeVacationAllowance.year,
					}),
		),
	).flat();
	const expectedKeys = new Set(missing.map((row) => row.key));
	const returnedCounts = new Map<string, number>();
	for (const row of inserted) {
		const key = `${row.employeeId}:${row.year}`;
		returnedCounts.set(key, (returnedCounts.get(key) ?? 0) + 1);
		if (!expectedKeys.has(key)) {
			result.errors.push(
				`Holiday quota insert returned unexpected allowance for employee ${row.employeeId}, year ${row.year}`,
			);
		}
	}
}
```

An expected key is successful only when its returned count is exactly one. For every affected source row append `Holiday quota (user ${quota.users_id}, year ${quota.year_since}): insert did not return exactly one matching allowance`. Unexpected keys also receive the entity-level error above.

Calculate results in original valid-row order: first missing representative is imported, duplicates and pre-existing keys are skipped.

- [ ] **Step 10: Run focused tests and verify GREEN**

Run the Task 1 Step 3 command.

Expected: quota tests pass with tenant validation, bounded reads and writes, at most four active statements, exact returned-key accounting, and deterministic source-order results.

### Task 4: Validate Clockodo Changes

**Files:**
- Verify: `apps/webapp/src/lib/clockodo/import-orchestrator.ts`
- Verify: `apps/webapp/src/lib/clockodo/import-orchestrator.test.ts`

- [ ] **Step 1: Run focused Clockodo tests**

```bash
pnpm --filter webapp test src/lib/clockodo/import-orchestrator.test.ts src/lib/import-review/clockodo-adapter.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter webapp typecheck
```

Expected: typecheck passes.

- [ ] **Step 3: Inspect unstaged changes**

```bash
git diff --check && git status --short
```

Expected: no whitespace errors. Do not stage or commit.

### Task 5: Final Cross-Plan Validation

**Files:**
- Verify all implementation and documentation changes from all three plans

- [ ] **Step 1: Run the branch React Doctor scan**

```bash
pnpm exec react-doctor --version
pnpm exec react-doctor --json --scope changed --include-untracked --yes \
  --json-out /tmp/diagnostics-after.json
pnpm exec react-doctor --verbose --scope changed --include-untracked --yes
```

Expected: version `0.9.2`; safe independent-await and set-based-loop occurrences are gone. Remaining diagnostics match only the validated false positives and required-ordering inventory in the design spec. Score does not regress from 76.

- [ ] **Step 2: Run repository tests**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 3: Run Temporal timezone smoke tests**

```bash
pnpm test:temporal-timezone-smoke
```

Expected: every configured timezone passes.

- [ ] **Step 4: Run the production build**

```bash
CI=true pnpm build
```

Expected: all workspace app builds pass.

- [ ] **Step 5: Compare generated output with pre-command worktree evidence**

Record `git status --short` before commands that may generate files. If `apps/docs/.source/dynamic.ts` changes and pre-command evidence proves this session alone created that change, restore only those generated lines with `apply_patch`. Otherwise leave it untouched and report it as concurrent work.

- [ ] **Step 6: Produce the working-tree summary**

Run:

```bash
git diff --check
```

Expected: all remediation and docs changes are unstaged and no conflict markers or whitespace errors exist. Report fixed diagnostics, validated false positives, required-ordering occurrences, concurrent unrelated files if any, and verification evidence. Do not stage, commit, or push.
