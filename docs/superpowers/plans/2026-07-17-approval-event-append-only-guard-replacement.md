# Approval Event Append-Only Guard Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile append-only source scanner with deterministic TypeScript symbol analysis and PostgreSQL-aware constant SQL detection while preserving its public entry points and normal-test production gate.

**Architecture:** Split the current mixed scanner into a PostgreSQL lexer, a TypeScript semantic analyzer, and a small filesystem orchestrator. The analyzer uses compiler symbols plus statement-ordered writes instead of global name sets; the orchestrator prefilters and sorts files before analysis so the single production scan remains reliable under full-suite contention.

**Tech Stack:** TypeScript 6 compiler API, Node.js filesystem/path APIs, Vitest, pnpm, Biome.

**Execution constraint:** Do not commit. The approval workflow rewrite branch is intentionally uncommitted. Do not touch schema, migrations, repository behavior, PostgreSQL integration, CI services, or Task 2.3.

---

## File Map

- Create `apps/webapp/src/lib/approvals/workflow/event-append-only-sql.ts`: constant SQL evaluation and PostgreSQL tokenization only.
- Create `apps/webapp/src/lib/approvals/workflow/event-append-only-sql.test.ts`: direct lexer and constant-expression contract tests.
- Create `apps/webapp/src/lib/approvals/workflow/event-append-only-typescript.ts`: TypeScript program creation, symbol provenance, ordered alias resolution, DB receiver recognition, and AST violation extraction.
- Create `apps/webapp/src/lib/approvals/workflow/event-append-only-typescript.test.ts`: semantic analyzer tests independent of filesystem traversal.
- Modify `apps/webapp/src/lib/approvals/workflow/event-append-only-guard.ts`: retain public interfaces/functions and reduce the file to deterministic walking, prefiltering, analyzer invocation, sorting, and deduplication.
- Modify `apps/webapp/src/lib/approvals/workflow/event-append-only-guard.test.ts`: retain existing regressions, add public API/path/performance assertions, and remove cases moved to focused helper tests only when equivalent public coverage remains.

### Task 1: Lock The Public Contract And Transparent Expression Behavior

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/event-append-only-guard.ts:5-13`
- Modify: `apps/webapp/src/lib/approvals/workflow/event-append-only-guard.test.ts:17-424`

- [ ] **Step 1: Replace loose positive assertions with exact public results**

Add a helper near the top of the guard test:

```ts
function expectSingleViolation(
	 source: string,
	 kind: ApprovalWorkflowEventMutationViolation["kind"],
	 line: number,
): void {
	expect(
		findApprovalWorkflowEventMutationViolations(source, "fixture.ts"),
	).toEqual([
		{
			fileName: "fixture.ts",
			line,
			column: expect.any(Number),
			kind,
		},
	]);
}
```

Import `type ApprovalWorkflowEventMutationViolation` and update representative Drizzle/raw SQL cases to assert exact count, kind, file, and line rather than only non-empty output.

- [ ] **Step 2: Add failing transparent-wrapper and namespace-destructuring cases**

```ts
it.each([
	"approvalWorkflowEvent as any",
	"approvalWorkflowEvent!",
	"approvalWorkflowEvent satisfies unknown",
	"(approvalWorkflowEvent)",
] as const)("detects a wrapped event table: %s", (argument) => {
	const source = `import { approvalWorkflowEvent } from "@/db";
db.update(${argument});`;
	expectSingleViolation(source, "drizzle_update", 2);
});

it("detects sql destructured from the Drizzle namespace", () => {
	const source = `import * as drizzle from "drizzle-orm";
const { sql } = drizzle;
sql\`delete from approval_workflow_event\`;`;
	expectSingleViolation(source, "raw_sql_delete", 3);
});
```

- [ ] **Step 3: Run RED and record the expected failures**

Run:

```bash
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-guard.test.ts -t "wrapped event table|destructured from"
```

Expected: wrapper cases and namespace destructuring fail because the current scanner does not unwrap assertions/non-null/satisfies or propagate destructured `sql`.

- [ ] **Step 4: Add `column` to the public violation contract without changing detection yet**

```ts
export interface ApprovalWorkflowEventMutationViolation {
	fileName: string;
	line: number;
	column: number;
	kind:
		| "drizzle_update"
		| "drizzle_delete"
		| "raw_sql_update"
		| "raw_sql_delete";
}
```

Use `sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))` for one-based line and column in existing emission sites so all old tests compile while the replacement is built.

- [ ] **Step 5: Run the public guard suite**

Run:

```bash
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-guard.test.ts
```

Expected: existing cases pass; new semantic cases remain RED until Task 3. Do not weaken or skip them.

### Task 2: Build The PostgreSQL Lexer And Constant SQL Evaluator

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/event-append-only-sql.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/event-append-only-sql.test.ts`

- [ ] **Step 1: Write failing lexer tests for PostgreSQL syntax boundaries**

```ts
import { describe, expect, it } from "vitest";
import { findEventTableSqlMutations } from "./event-append-only-sql";

describe("findEventTableSqlMutations", () => {
	it.each([
		["update approval_workflow_event set version = 2", ["raw_sql_update"]],
		["delete from only public.approval_workflow_event", ["raw_sql_delete"]],
		['update public."approval_workflow_event" set version = 2', ["raw_sql_update"]],
	] as const)("classifies executable SQL", (sql, expected) => {
		expect(findEventTableSqlMutations(sql)).toEqual(expected);
	});

	it.each([
		`select E'escaped\\' ; delete from approval_workflow_event'`,
		`select /* outer /* inner */ update approval_workflow_event */ 1`,
		`select $body$delete from approval_workflow_event$body$`,
		'update "APPROVAL_WORKFLOW_EVENT" set version = 2',
	] as const)("ignores non-executable or distinct identifiers", (sql) => {
		expect(findEventTableSqlMutations(sql)).toEqual([]);
	});
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-sql.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement a token-based PostgreSQL scanner**

Define the exact public boundary:

```ts
export type EventTableSqlMutationKind =
	| "raw_sql_update"
	| "raw_sql_delete";

interface SqlToken {
	kind: "identifier" | "quoted_identifier" | "symbol";
	text: string;
}

export function findEventTableSqlMutations(
	sqlText: string,
): EventTableSqlMutationKind[];
```

Implement a single left-to-right lexer that:

- skips line comments, nested block comments, normal strings, `E'...'` strings with backslash escapes, and dollar-quoted bodies;
- preserves unquoted identifiers lowercased and quoted identifiers exactly;
- recognizes `UPDATE [ONLY] [schema.] approval_workflow_event` and `DELETE FROM [ONLY] [schema.] approval_workflow_event`;
- treats unquoted `approval_workflow_event` case-insensitively but quoted identifiers case-sensitively;
- returns mutation kinds in source order without duplicates from overlapping token matches.

The table comparison must be explicit:

```ts
function isProtectedTable(token: SqlToken): boolean {
	return token.kind === "identifier"
		? token.text.toLowerCase() === "approval_workflow_event"
		: token.kind === "quoted_identifier" &&
			token.text === "approval_workflow_event";
}
```

- [ ] **Step 4: Run lexer GREEN**

Run:

```bash
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-sql.test.ts
```

Expected: all lexer tests pass.

- [ ] **Step 5: Add RED tests for compile-time string evaluation**

Add tests through a small exported evaluator that accepts an expression and checker context:

```ts
export interface ConstantSqlContext {
	checker: ts.TypeChecker;
	usePosition: number;
}

export function evaluateConstantSql(
	expression: ts.Expression,
	context: ConstantSqlContext,
): string | null;
```

Cover:

```ts
const direct = "delete from " + "approval_workflow_event";
const table = "approval_workflow_event" as const;
const aliased = `update ${table} set version = 2`;
```

Also assert `let sql = "..."`, a reassigned `const`-ineligible alias, function calls, and runtime template substitutions return `null`.

- [ ] **Step 6: Implement immutable constant evaluation and run GREEN**

Evaluation may recurse only through:

- string/no-substitution template literals;
- parenthesized, `as`, type assertion, non-null, and `satisfies` wrappers;
- `+` where both operands resolve to strings;
- template spans where every expression resolves to a constant string;
- identifiers whose compiler symbol has exactly one `const` variable declaration, no writes, and an initializer earlier than the use.

Use a visited-symbol set to reject cycles. Never execute code or call constant-folding helpers.

Run:

```bash
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-sql.test.ts
```

Expected: all lexer and constant-evaluation tests pass.

### Task 3: Build Symbol-Based TypeScript Mutation Analysis

**Files:**
- Create: `apps/webapp/src/lib/approvals/workflow/event-append-only-typescript.ts`
- Create: `apps/webapp/src/lib/approvals/workflow/event-append-only-typescript.test.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/event-append-only-guard.ts`

- [ ] **Step 1: Write RED tests for semantic provenance and ordered aliases**

Test the exported analyzer using realistic imports/types:

```ts
import { describe, expect, it } from "vitest";
import { analyzeApprovalWorkflowEventMutations } from "./event-append-only-typescript";

it("detects wrapped protected tables and namespace sql destructuring", () => {
	const source = `
import { approvalWorkflowEvent } from "@/db";
import * as drizzle from "drizzle-orm";
const { sql } = drizzle;
db.update(approvalWorkflowEvent as any);
sql\`delete from approval_workflow_event\`;
`;
	expect(analyzeApprovalWorkflowEventMutations(source, "/repo/apps/webapp/src/x.ts"))
		.toMatchObject([
			{ kind: "drizzle_update" },
			{ kind: "raw_sql_delete" },
		]);
});

it("uses the latest reaching assignment at each call", () => {
	const source = `
import { approvalWorkflowEvent } from "@/db";
let table = otherTable;
db.update(table);
table = approvalWorkflowEvent;
db.delete(table);
table = otherTable;
db.update(table);
`;
	expect(analyzeApprovalWorkflowEventMutations(source, "/repo/apps/webapp/src/x.ts"))
		.toEqual([
			expect.objectContaining({ kind: "drizzle_delete", line: 6 }),
		]);
});
```

Add negative tests for shadowing, unrelated modules, unrelated `runner.execute`, and reassignment away from protected bindings.

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-typescript.test.ts
```

Expected: FAIL because the analyzer module does not exist.

- [ ] **Step 3: Create the semantic analyzer boundary**

```ts
export interface ApprovalWorkflowEventMutationViolation {
	fileName: string;
	line: number;
	column: number;
	kind:
		| "drizzle_update"
		| "drizzle_delete"
		| "raw_sql_update"
		| "raw_sql_delete";
}

export function analyzeApprovalWorkflowEventMutations(
	source: string,
	fileName: string,
): ApprovalWorkflowEventMutationViolation[];
```

Create an in-memory `ts.Program` with `noResolve: true`, `allowJs: false`, and a compiler host that returns the supplied source file. Obtain symbols using `checker.getSymbolAtLocation`; never identify lexical bindings by text alone.

- [ ] **Step 4: Implement shared transparent-expression unwrapping**

```ts
function unwrapExpression(expression: ts.Expression): ts.Expression {
	let current = expression;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isNonNullExpression(current) ||
		ts.isSatisfiesExpression(current)
	) {
		current = current.expression;
	}
	return current;
}
```

Use it for table arguments, SQL tags/raw targets, receivers, alias initializers, assignment sides, and constant SQL expressions.

- [ ] **Step 5: Implement symbol provenance and statement-ordered writes**

Build these indexes in one AST walk:

```ts
interface SymbolWrite {
	position: number;
	value: ts.Expression;
}

interface AnalysisIndex {
	writes: Map<ts.Symbol, SymbolWrite[]>;
	drizzleSqlSymbols: Set<ts.Symbol>;
	drizzleNamespaceSymbols: Set<ts.Symbol>;
	eventTableSymbols: Set<ts.Symbol>;
	schemaNamespaceSymbols: Set<ts.Symbol>;
	databaseReceiverSymbols: Set<ts.Symbol>;
}
```

Recognize provenance only from:

- `sql` or namespace imports from `drizzle-orm`;
- `approvalWorkflowEvent` or namespace imports from `@/db`, `@/db/schema`, `@/db/schema/approval-workflow`, and relative paths resolving lexically to `apps/webapp/src/db` or its schema entry points;
- DB receivers imported from `@/db`, constructed from `pg.Pool`, or typed as `Pool`, `PoolClient`, `NodePgDatabase`, `ApprovalDbService["db"]`, or the repository transaction DB service. Property chains ending in the resolved `.db` member of an `ApprovalDbService` value are accepted;
- explicit ambient fixture names only after tests declare them with one of those DB types. Do not trust a receiver merely because its property is named `query` or `execute`.

Sort each symbol's writes by source position. Resolve a symbol at a use by selecting the final declaration initializer or assignment strictly before the use; recurse with a `(symbol, usePosition)` visited key. Destructuring declarations/assignments contribute writes for the extracted property. This makes reassignment flow-sensitive without a global fixed-point loop.

- [ ] **Step 6: Detect Drizzle and raw SQL calls**

For each call/tag:

- resolve `update`/`delete` table arguments to protected event-table provenance;
- resolve SQL tags and `sql.raw` through compiler symbols and destructuring aliases;
- require `query`/`execute` receivers to resolve to a known DB receiver;
- evaluate executable arguments using `evaluateConstantSql` or template interpolation where a resolved event-table expression contributes the canonical unquoted table token;
- classify extracted SQL using `findEventTableSqlMutations`;
- emit one violation per operation at the call/tag position.

Sort by file, line, column, then kind and deduplicate identical tuples before return.

- [ ] **Step 7: Run semantic analyzer GREEN**

Run:

```bash
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-typescript.test.ts
```

Expected: semantic provenance, wrapper, constant SQL, unrelated receiver, lexical shadowing, and reaching-assignment cases all pass.

- [ ] **Step 8: Route the public single-file API through the analyzer**

Replace the current implementation body with:

```ts
export function findApprovalWorkflowEventMutationViolations(
	source: string,
	fileName: string,
): ApprovalWorkflowEventMutationViolation[] {
	return analyzeApprovalWorkflowEventMutations(source, fileName);
}
```

Re-export or import the shared violation type from the analyzer so there is one definition.

- [ ] **Step 9: Run the public regression suite**

Run:

```bash
pnpm exec vitest run \
  src/lib/approvals/workflow/event-append-only-sql.test.ts \
  src/lib/approvals/workflow/event-append-only-typescript.test.ts \
  src/lib/approvals/workflow/event-append-only-guard.test.ts
```

Expected: all old and new scanner behavior passes. If an old fixture used an untyped arbitrary `query`/`execute` receiver, make the fixture realistic by declaring/importing its DB type; do not reintroduce property-name-only detection.

### Task 4: Make Production Scanning Deterministic And Fast

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/event-append-only-guard.ts`
- Modify: `apps/webapp/src/lib/approvals/workflow/event-append-only-guard.test.ts`

- [ ] **Step 1: Add RED tests for paths, ordering, and prefilter behavior**

Create temp roots in deliberately reverse lexical order and assert exact sorted output. Add tests that call scanning with relative roots and analyze Windows-style file names for relative schema imports. Add a file with no protected identifier or raw table token and spy through an injectable/internal analyzer callback to prove it is not parsed.

Expected ordering:

```ts
expect(violations.map(({ fileName, line, column, kind }) => ({
	fileName,
	line,
	column,
	kind,
}))).toEqual([...expected].sort(compareViolations));
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-guard.test.ts -t "deterministic|relative roots|Windows|prefilters"
```

Expected: current unsorted walking/path handling fails and every TypeScript file reaches parsing.

- [ ] **Step 3: Implement the deterministic walker and exact exclusions**

The orchestrator must:

```ts
const TYPESCRIPT_SOURCE = /\.(?:ts|tsx|mts|cts)$/;
const TEST_SOURCE = /\.(?:test|spec)\.[cm]?tsx?$/;
const PREFILTER = /approvalWorkflowEvent|approval_workflow_event/;
```

- resolve every root before traversal;
- sort every `readdirSync` result;
- normalize lexical separators with `replaceAll("\\", "/")`;
- exclude only tests/specs, `__tests__`, `<webapp>/drizzle/**`, and `<webapp>/src/db/auth-schema.ts`;
- read candidate source once;
- skip analyzer construction when `PREFILTER` does not match;
- sort and deduplicate final violations.

Do not exclude generic `migration`, `meta`, `snapshot`, or `generated` directories.

- [ ] **Step 4: Run path/order GREEN**

Run:

```bash
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-guard.test.ts -t "deterministic|relative roots|Windows|prefilters|runtime-named"
```

Expected: all selected tests pass.

- [ ] **Step 5: Measure the authoritative production scan without increasing timeout**

Run the dedicated file three times:

```bash
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-guard.test.ts
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-guard.test.ts
pnpm exec vitest run src/lib/approvals/workflow/event-append-only-guard.test.ts
```

Expected: each run passes; the `src + scripts` production scan remains below 8 seconds in isolation, leaving headroom under the existing 15-second timeout. Do not solve performance by increasing the timeout.

- [ ] **Step 6: Verify full-suite contention**

Run:

```bash
pnpm test
```

Expected: the authoritative scan does not time out and no scanner-related test fails. If the unrelated Tolgee teardown error recurs, record it separately with its stack; scanner assertions must still pass.

### Task 5: Final Verification And Self-Review

**Files:**
- Review all files listed in the File Map.

- [ ] **Step 1: Run all workflow tests**

```bash
pnpm exec vitest run src/lib/approvals/workflow/*.test.ts
```

Expected: all non-gated workflow tests pass; PostgreSQL integration remains skipped unless its dedicated disposable URL is supplied.

- [ ] **Step 2: Run type contracts and application typecheck**

```bash
pnpm typecheck
```

Expected: `next typegen`, application TypeScript, and workflow contract TypeScript all exit 0.

- [ ] **Step 3: Run focused formatting/static checks**

```bash
pnpm exec biome check --max-diagnostics=200 \
  src/lib/approvals/workflow/event-append-only-guard.ts \
  src/lib/approvals/workflow/event-append-only-guard.test.ts \
  src/lib/approvals/workflow/event-append-only-sql.ts \
  src/lib/approvals/workflow/event-append-only-sql.test.ts \
  src/lib/approvals/workflow/event-append-only-typescript.ts \
  src/lib/approvals/workflow/event-append-only-typescript.test.ts
git diff --check
```

Expected: Biome reports no diagnostics and `git diff --check` has no output.

- [ ] **Step 4: Self-review against the design**

Confirm all of the following before requesting spec review:

- public scanner entry points remain unchanged except the additive `column` field;
- TypeScript bindings use symbols and source-ordered writes, not global text sets/fixed-point loops;
- only known DB receivers expose direct string `query`/`execute` scanning;
- PostgreSQL escaped strings, nested comments, dollar quotes, optional `ONLY`, schemas, and quoted case are correct;
- walker roots and results are absolute, slash-normalized for comparisons, sorted, and narrowly excluded;
- exactly one normal-test production scan covers both `src` and `scripts`;
- no timeout increase, schema/migration/repository/CI/Task 2.3 edit, database access, or commit occurred.
