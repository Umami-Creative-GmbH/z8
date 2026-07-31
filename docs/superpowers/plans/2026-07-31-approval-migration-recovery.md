# Approval Migration Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair databases that recorded migration `0059` before the approval workflow migrations merged, and prevent future migrations from being silently inserted behind deployed journal timestamps.

**Architecture:** Add a new, last-in-journal `0060` migration that conditionally executes the complete approval expansion when its transactional anchor table is absent and independently reconciles the cycle-identity index. Add static repository invariants plus a disposable-PostgreSQL verifier that recreates the exact production history, applies the current journal, retries it, and also validates a fresh install.

**Tech Stack:** PostgreSQL 16, Drizzle ORM/Kit, TypeScript, Vitest, Node.js, pnpm, Docker

---

## File Map

- Create `apps/webapp/drizzle/0060_approval_workflow_recovery.sql`: authoritative idempotent recovery for skipped `0055` and `0056`.
- Modify `apps/webapp/drizzle/meta/_journal.json`: preserve published historical timestamps and register `0060` after `0059`.
- Modify `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`: enforce global journal/file invariants and the `0060` SQL contract.
- Create `apps/webapp/scripts/verify-approval-migration-recovery.ts`: reproduce the deployed-through-`0059` state without approval migrations, apply recovery, retry it, and verify a fresh migration chain.
- Modify `apps/webapp/scripts/run-approval-workflow-repository-integration.sh`: run the recovery verifier before approval repository integration tests.
- Modify `.github/workflows/tests.yml`: use the same recovery verifier in CI instead of testing only a fresh migration chain.

### Task 1: Add Failing Migration-History Guardrails

**Files:**
- Modify: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts:43-48,1745-1790`
- Test: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`

- [ ] **Step 1: Add the repository-wide journal and SQL-file tests**

Add these tests near the start of `describe("drizzle follow-up migrations", ...)`:

```ts
it("allows only recovered historical timestamp inversions", () => {
	const recoveredHistoricalInversions = new Set([
		"0021_sick_detail",
		"0027_employee_work_balance",
	]);

	for (let index = 1; index < migrationJournal.entries.length; index += 1) {
		const previous = migrationJournal.entries[index - 1];
		const current = migrationJournal.entries[index];

		if (current.when <= previous.when) {
			expect(
				recoveredHistoricalInversions.has(current.tag),
				`${current.tag} must be later than ${previous.tag}`,
			).toBe(true);
		}
	}
});

it("keeps journal tags and SQL files aligned", () => {
	const historicalOrphans = new Set(["0051_daily_digest_delivery"]);
	const sqlTags = readdirSync(drizzleDirUrl)
		.filter((fileName) => fileName.endsWith(".sql"))
		.map((fileName) => fileName.replace(/\.sql$/, ""));
	const journalTags = migrationJournal.entries.map((entry) => entry.tag);

	expect(
		sqlTags.filter(
			(tag) => !historicalOrphans.has(tag) && !journalTags.includes(tag),
		),
	).toEqual([]);
	expect(journalTags.filter((tag) => !sqlTags.includes(tag))).toEqual([]);
});

it("does not introduce duplicate migration prefixes", () => {
	const allowedDuplicatePrefixes = new Set(["0051"]);
	const prefixes = readdirSync(drizzleDirUrl)
		.filter((fileName) => fileName.endsWith(".sql"))
		.map((fileName) => fileName.slice(0, 4));
	const duplicates = prefixes.filter(
		(prefix, index) =>
			prefixes.indexOf(prefix) !== index &&
			!allowedDuplicatePrefixes.has(prefix),
	);

	expect([...new Set(duplicates)]).toEqual([]);
});
```

- [ ] **Step 2: Add the failing `0060` registration contract**

Add a URL constant for `../../../drizzle/0060_approval_workflow_recovery.sql`, then add:

```ts
it("registers approval recovery after every deployed migration", () => {
	const recoveryIndex = migrationJournal.entries.findIndex(
		(entry) => entry.tag === "0060_approval_workflow_recovery",
	);
	const recoveryEntry = migrationJournal.entries[recoveryIndex];
	const latestPriorWhen = Math.max(
		...migrationJournal.entries
			.slice(0, recoveryIndex)
			.map((entry) => entry.when),
	);

	expect(recoveryIndex).toBeGreaterThan(
		migrationJournal.entries.findIndex(
			(entry) => entry.tag === "0059_payroll_blocker_dismissal",
		),
	);
	expect(recoveryEntry).toMatchObject({
		idx: 60,
		version: "7",
		tag: "0060_approval_workflow_recovery",
		breakpoints: true,
	});
	expect(recoveryEntry?.when).toBeGreaterThan(latestPriorWhen);
	expect(existsSync(migration0060Url)).toBe(true);
});
```

- [ ] **Step 3: Run the focused test and confirm the intended failures**

Run: `pnpm --dir apps/webapp test src/db/__tests__/drizzle-migrations.test.ts`

Expected: the two documented historical inversions pass, and the test fails because `0060_approval_workflow_recovery` does not exist.

- [ ] **Step 4: Commit the failing guardrails**

```bash
git add apps/webapp/src/db/__tests__/drizzle-migrations.test.ts
git commit -m "test: guard global migration ordering"
```

### Task 2: Register the Recovery After All Deployed Migrations

**Files:**
- Modify: `apps/webapp/drizzle/meta/_journal.json:146-205,418-424`
- Test: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`

- [ ] **Step 1: Preserve published historical migration identities**

Do not change the existing `when` values for `0021_sick_detail`, `0022_absence_category_translations`, or `0027_employee_work_balance`. Their published values remain:

```json
{
  "tag": "0021_sick_detail",
  "when": 1778827536858
}
```

```json
{
  "tag": "0027_employee_work_balance",
  "when": 1778889600000
}
```

- [ ] **Step 2: Append the recovery entry**

Append this entry after `0059`:

```json
{
  "idx": 60,
  "version": "7",
  "when": 1785493929040,
  "tag": "0060_approval_workflow_recovery",
  "breakpoints": true
}
```

- [ ] **Step 3: Run the focused test**

Run: `pnpm --dir apps/webapp test src/db/__tests__/drizzle-migrations.test.ts`

Expected: the historical-inversion allowlist and recovery metadata tests pass; only SQL alignment/existence fails because the recovery file does not exist.

- [ ] **Step 4: Commit the journal repair**

```bash
git add apps/webapp/drizzle/meta/_journal.json
git commit -m "fix: restore monotonic migration journal"
```

### Task 3: Implement Retry-Safe Approval Recovery SQL

**Files:**
- Create: `apps/webapp/drizzle/0060_approval_workflow_recovery.sql`
- Reference: `apps/webapp/drizzle/0055_approval_workflow_expand.sql`
- Reference: `apps/webapp/drizzle/0056_approval_workflow_cycle_identity.sql`
- Test: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`

- [ ] **Step 1: Add a failing recovery SQL contract**

Read `0060` with `readRequiredMigration`, then assert:

```ts
it("recovers skipped approval expansion behind a transactional anchor", () => {
	const recovery = readRequiredMigration(
		migration0060Url,
		"0060 approval workflow recovery migration",
	);

	expect(recovery).toContain(
		"IF to_regclass('public.approval_workflow') IS NULL THEN",
	);
	for (const enumName of approvalWorkflowEnums.map(({ name }) => name)) {
		expect(recovery).toContain(`CREATE TYPE "public"."${enumName}"`);
	}
	for (const tableName of Object.keys(canonicalApprovalTableColumns)) {
		expect(recovery).toContain(`CREATE TABLE "${tableName}"`);
	}
	for (const sourceTable of [
		"absence_entry",
		"compliance_exception",
		"shift_request",
		"work_period",
		"travel_expense_claim",
	]) {
		expect(recovery).toContain(
			`ALTER TABLE "${sourceTable}" ADD COLUMN "approval_workflow_id" uuid`,
		);
	}
	expect(recovery).toContain(
		'CREATE UNIQUE INDEX "approvalWorkflow_org_source_pending_idx" ON "approval_workflow" USING btree ("organization_id","workflow_type","source_type","source_id") WHERE status = \'pending\'',
	);
});
```

Run: `pnpm --dir apps/webapp test src/db/__tests__/drizzle-migrations.test.ts`

Expected: FAIL until `0060` contains the complete retry-safe contract.

- [ ] **Step 2: Create the idempotent recovery migration**

Use `0055` as the semantic source of truth and preserve its statement order. Keep the daily-digest recovery at the start, then place the approval expansion inside one transactional-anchor block:

```sql
-- Recover 0055/0056 after they were merged behind already-deployed migration 0059.
-- PostgreSQL commits 0055 atomically, so approval_workflow distinguishes skipped and applied states.
DO $approval_recovery$
BEGIN
	IF to_regclass('public.approval_workflow') IS NULL THEN
```

Keep the existing daily-digest recovery block unchanged outside the anchor block. Copy all approval DDL from lines 27-310 of `0055` into the `IF` body, removing Drizzle `statement-breakpoint` comments inside the block but making no semantic DDL changes. This deliberately preserves the all-or-nothing `0055` contract rather than trying to infer a partially applied state that PostgreSQL transactions cannot produce.

Close the anchor block immediately after the copied `shift_request_approval_workflow_organization_check` statement:

```sql
	END IF;
END
$approval_recovery$;
```

Finish with an independent, exact `0056` reconciliation:

```sql
DROP INDEX IF EXISTS "approvalWorkflow_org_source_pending_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "approvalWorkflow_org_source_pending_idx"
	ON "approval_workflow" USING btree
	("organization_id","workflow_type","source_type","source_id")
	WHERE status = 'pending';
```

Do not use `CASCADE`, delete rows, update approval rows, or weaken organization-scoped foreign keys.

- [ ] **Step 3: Run static migration tests**

Run: `pnpm --dir apps/webapp test src/db/__tests__/drizzle-migrations.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit the recovery migration**

```bash
git add apps/webapp/drizzle/0060_approval_workflow_recovery.sql apps/webapp/src/db/__tests__/drizzle-migrations.test.ts
git commit -m "fix: recover skipped approval migrations"
```

### Task 4: Reproduce the Production Migration History in PostgreSQL

**Files:**
- Create: `apps/webapp/scripts/verify-approval-migration-recovery.ts`
- Modify: `apps/webapp/scripts/run-approval-workflow-repository-integration.sh:66-74`

- [ ] **Step 1: Create the incident-history verifier**

The script must:

1. Require `APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL` and the existing sentinel.
2. Copy `drizzle/` to an OS temporary directory.
3. Remove journal entries `0055`, `0056`, and `0060` from the temporary journal while retaining `0057`-`0059`.
4. Run Drizzle migrate against that temporary folder.
5. Assert `drizzle.__drizzle_migrations` ends at `1785493929039` and `work_period.approval_workflow_id` is absent.
6. Run Drizzle migrate against the real folder.
7. Assert the approval tables, source columns, and four-column cycle index exist.
8. Run Drizzle migrate against the real folder again and assert success.
9. Drop and recreate the isolated test database's `public` schema and drop its `drizzle` schema so the migration ledger is empty.
10. Run the full real migration folder from empty and assert the same schema contract.
11. Remove the temporary migration directory in `finally`.

Use these core imports and migration call:

```ts
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
await migrate(database, { migrationsFolder });
```

Query `pg_indexes.indexdef` and require its normalized definition to contain:

```text
UNIQUE INDEX "approvalWorkflow_org_source_pending_idx"
(organization_id, workflow_type, source_type, source_id)
WHERE (status = 'pending'::approval_workflow_status)
```

- [ ] **Step 2: Replace the shell script's fresh-only migration command**

Replace lines 66-74 of `run-approval-workflow-repository-integration.sh` with:

```bash
printf 'Verifying skipped, retried, and fresh approval migration histories\n'
POSTGRES_HOST=127.0.0.1 \
POSTGRES_PORT="$host_port" \
POSTGRES_DB="$database_name" \
POSTGRES_USER=postgres \
POSTGRES_PASSWORD="$database_password" \
POSTGRES_SSL_MODE=disable \
SKIP_ENV_VALIDATION=1 \
APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL="postgresql://postgres:${database_password}@127.0.0.1:${host_port}/${database_name}" \
APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL=approval-workflow-repository-test \
pnpm --dir "$app_directory" exec tsx scripts/verify-approval-migration-recovery.ts
```

- [ ] **Step 3: Run the disposable PostgreSQL verification**

Run: `pnpm --dir apps/webapp test:approval-workflow-repository:integration`

Expected: the script reports the skipped state, recovered state, retry, and fresh state; then all four approval integration suites pass and the label-owned container is removed.

- [ ] **Step 4: Commit the integration verifier**

```bash
git add apps/webapp/scripts/verify-approval-migration-recovery.ts apps/webapp/scripts/run-approval-workflow-repository-integration.sh
git commit -m "test: reproduce skipped approval migration"
```

### Task 5: Run the Recovery Verifier in CI

**Files:**
- Modify: `.github/workflows/tests.yml:88-110`

- [ ] **Step 1: Replace CI's fresh-only migration step**

After exporting the PostgreSQL variables, replace direct `drizzle-kit migrate` with:

```yaml
          APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/${database_name}" \
          APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL=approval-workflow-repository-test \
          pnpm --filter webapp exec tsx scripts/verify-approval-migration-recovery.ts
```

Keep the existing four approval integration test files unchanged.

- [ ] **Step 2: Validate the workflow and focused tests**

Run: `pnpm --dir apps/webapp test src/db/__tests__/drizzle-migrations.test.ts`

Expected: PASS.

Run: `pnpm exec prettier --check .github/workflows/tests.yml apps/webapp/scripts/verify-approval-migration-recovery.ts`

Expected: PASS. If the repository formatter reports changes, run the repository's existing formatter only on these two files and repeat the check.

- [ ] **Step 3: Commit the CI coverage**

```bash
git add .github/workflows/tests.yml
git commit -m "ci: verify approval migration recovery"
```

### Task 6: Final Verification

**Files:**
- Verify all files changed in Tasks 1-5.

- [ ] **Step 1: Run the migration contract suite**

Run: `pnpm --dir apps/webapp test src/db/__tests__/drizzle-migrations.test.ts src/db/schema/__tests__/approval-workflow-schema.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the real PostgreSQL recovery and approval suites**

Run: `pnpm --dir apps/webapp test:approval-workflow-repository:integration`

Expected: PASS with no disposable container remaining.

- [ ] **Step 3: Run webapp type checking**

Run: `pnpm --dir apps/webapp typecheck`

Expected: PASS.

- [ ] **Step 4: Inspect the final diff**

Run: `git status --short && git diff --check && git diff -- apps/webapp/drizzle apps/webapp/src/db/__tests__/drizzle-migrations.test.ts apps/webapp/scripts .github/workflows/tests.yml`

Expected: only intended migration recovery, tests, verifier, workflow, spec, and plan changes; no whitespace errors.

- [ ] **Step 5: Commit any final verification-only corrections**

```bash
git add apps/webapp/drizzle apps/webapp/src/db/__tests__/drizzle-migrations.test.ts apps/webapp/scripts .github/workflows/tests.yml docs/superpowers/specs/2026-07-31-approval-migration-recovery-design.md docs/superpowers/plans/2026-07-31-approval-migration-recovery.md
git commit -m "fix: complete approval migration recovery"
```
