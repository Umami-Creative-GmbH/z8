# TypeScript 7 Compiler API Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run all webapp source analyzers on TypeScript 7's native Compiler API while preserving their synchronous behavior and existing findings.

**Architecture:** A focused adapter owns one synchronous native `API`, a mutable virtual filesystem, configured-project snapshots, and cleanup. Approval analyzers and structural tests consume remote TypeScript 7 AST nodes through callback-scoped programs; no caller retains nodes after snapshot disposal.

**Tech Stack:** TypeScript 7.0.2, `typescript/unstable/{sync,ast,fs}`, Vitest 4, pnpm 11

---

## File Map

- Create `apps/webapp/src/lib/typescript/native-source-analysis.ts`: singleton native API, virtual files, snapshot lifecycle, parse diagnostics, and callback-scoped source/program access.
- Create `apps/webapp/src/lib/typescript/native-source-analysis.test.ts`: adapter lifecycle, stale-source, multi-file, diagnostics, and TypeScript-version regression tests.
- Modify `apps/webapp/src/lib/approvals/workflow/event-append-only-typescript.ts`: use native programs/checkers and TypeScript 7 AST imports.
- Modify `apps/webapp/src/lib/approvals/workflow/event-append-only-sql.ts`: use TypeScript 7 AST imports and native checker types.
- Modify `apps/webapp/src/lib/approvals/workflow/event-append-only-sql.test.ts`: build multi-file native fixtures.
- Modify `apps/webapp/src/lib/approvals/approval-write-boundary-typescript.ts`: use native programs/checkers and TypeScript 7 AST imports.
- Modify `apps/webapp/src/lib/approvals/approval-write-boundary-sql.ts`: use TypeScript 7 AST imports and native checker types.
- Modify four structural tests under `src/app/api` and `src/components`: parse through the adapter.
- Modify `apps/webapp/package.json` and `pnpm-lock.yaml`: pin TypeScript 7.0.2.

### Task 1: Restore The TypeScript 7 Regression

**Files:**
- Modify: `apps/webapp/package.json:166`
- Modify: `pnpm-lock.yaml`
- Test: `apps/webapp/src/lib/approvals/workflow/event-append-only-typescript.test.ts`

- [ ] **Step 1: Pin the direct dependency to TypeScript 7**

Change the dev dependency exactly, without a caret, so unstable API changes require an intentional upgrade:

```json
"typescript": "7.0.2"
```

- [ ] **Step 2: Install the pinned dependency**

Run: `pnpm install`

Expected: `apps/webapp/node_modules/typescript/package.json` resolves to version `7.0.2` and `pnpm-lock.yaml` records `specifier: 7.0.2`.

- [ ] **Step 3: Run the reported test to verify the red baseline**

Run: `pnpm exec vitest run src/lib/approvals/workflow/event-append-only-typescript.test.ts` from `apps/webapp`.

Expected: FAIL at `ts.ScriptTarget.Latest`, proving the TypeScript 7 runtime incompatibility is active.

- [ ] **Step 4: Inspect the dependency baseline**

```bash
git diff --check -- apps/webapp/package.json pnpm-lock.yaml
git diff -- apps/webapp/package.json pnpm-lock.yaml
```

Expected: only the TypeScript pin and its lockfile resolution changed.

### Task 2: Add The Native Source Analysis Adapter

**Files:**
- Create: `apps/webapp/src/lib/typescript/native-source-analysis.ts`
- Create: `apps/webapp/src/lib/typescript/native-source-analysis.test.ts`

- [ ] **Step 1: Write adapter tests against the desired callback API**

Create tests covering a single source, sequential replacement, multi-file symbol ownership, malformed source, and package version:

```ts
import { isIdentifier, isVariableStatement } from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";
import {
	withNativeProgram,
	withNativeSource,
} from "./native-source-analysis";

describe("native source analysis", () => {
	it("uses the TypeScript 7 native API", async () => {
		const packageJson = await import("typescript/package.json", {
			with: { type: "json" },
		});
		expect(packageJson.default.version).toBe("7.0.2");
	});

	it("replaces source content between snapshots", () => {
		const names = ["first", "second"].map((name) =>
			withNativeSource(`const ${name} = 1;`, "/fixture.ts", ({ sourceFile }) => {
				const statement = sourceFile.statements[0];
				if (!statement || !isVariableStatement(statement)) {
					throw new Error("Fixture variable statement was not parsed");
				}
				return statement.declarationList.declarations[0].name.getText(sourceFile);
			}),
		);
		expect(names).toEqual(["first", "second"]);
	});

	it("keeps symbols scoped to their source file", () => {
		const sources = new Map([
			["/entry.ts", "const result = other;"],
			["/other.ts", "const other = 'value';"],
		]);
		const fileName = withNativeProgram(sources, "/entry.ts", ({ checker, sourceFile }) => {
			let identifierFile: string | undefined;
			sourceFile.forEachChild(function visit(node) {
				if (isIdentifier(node) && node.text === "other") {
					identifierFile = checker.getSymbolAtLocation(node)?.declarations?.[0]?.getSourceFile().fileName;
				}
				node.forEachChild(visit);
			});
			return identifierFile;
		});
		expect(fileName).toBe("/other.ts");
	});

	it("returns deterministic syntactic diagnostics", () => {
		const diagnostics = withNativeSource("const value = `unterminated", "/broken.ts", ({ program }) =>
			program.getSyntacticDiagnostics("/broken.ts"),
		);
		expect(diagnostics[0]).toMatchObject({ code: 1160 });
	});
});
```

- [ ] **Step 2: Run the adapter tests to verify they fail**

Run: `pnpm exec vitest run src/lib/typescript/native-source-analysis.test.ts`

Expected: FAIL because `./native-source-analysis` does not exist.

- [ ] **Step 3: Implement the callback-scoped native adapter**

Create `native-source-analysis.ts` with this public surface and lifecycle:

```ts
import type { SourceFile } from "typescript/unstable/ast";
import { createVirtualFileSystem, type FileSystem } from "typescript/unstable/fs";
import {
	API,
	type Checker,
	type Program,
} from "typescript/unstable/sync";

const CONFIG_FILE = "/__z8_native_analysis__/tsconfig.json";
const CONFIG = JSON.stringify({
	compilerOptions: {
		allowJs: true,
		module: "ESNext",
		noLib: true,
		noResolve: true,
		target: "ESNext",
	},
	files: [],
});

export interface NativeSourceContext {
	checker: Checker;
	program: Program;
	sourceFile: SourceFile;
}

let fileSystem: FileSystem | undefined;
let api: API | undefined;
let closeRegistered = false;

function normalizeFileName(fileName: string): string {
	const normalized = fileName.replaceAll("\\", "/");
	return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function getRuntime(): { api: API; fileSystem: FileSystem } {
	if (!fileSystem || !api) {
		fileSystem = createVirtualFileSystem({ [CONFIG_FILE]: CONFIG });
		api = new API({ cwd: "/", fs: fileSystem });
	}
	if (!closeRegistered) {
		process.once("exit", closeNativeSourceAnalysis);
		closeRegistered = true;
	}
	return { api, fileSystem };
}

export function closeNativeSourceAnalysis(): void {
	api?.close();
	api = undefined;
	fileSystem = undefined;
}

export function withNativeProgram<T>(
	sources: ReadonlyMap<string, string>,
	entryFileName: string,
	callback: (context: NativeSourceContext) => T,
): T {
	const runtime = getRuntime();
	const normalizedSources = new Map(
		[...sources].map(([fileName, source]) => [normalizeFileName(fileName), source]),
	);
	const normalizedEntry = normalizeFileName(entryFileName);
	if (!normalizedSources.has(normalizedEntry)) {
		throw new Error(`Native TypeScript analysis entry file is missing: ${normalizedEntry}`);
	}
	runtime.fileSystem.writeFile?.(
		CONFIG_FILE,
		JSON.stringify({ ...JSON.parse(CONFIG), files: [...normalizedSources.keys()] }),
	);
	for (const [fileName, source] of normalizedSources) {
		runtime.fileSystem.writeFile?.(fileName, source);
	}
	const snapshot = runtime.api.updateSnapshot({
		openProject: CONFIG_FILE,
		fileChanges: { invalidateAll: true },
	});
	try {
		const project = snapshot.getProject(CONFIG_FILE);
		if (!project) throw new Error(`Native TypeScript analysis project was not created: ${CONFIG_FILE}`);
		const sourceFile = project.program.getSourceFile(normalizedEntry);
		if (!sourceFile) throw new Error(`Native TypeScript analysis source file was not created: ${normalizedEntry}`);
		return callback({ checker: project.checker, program: project.program, sourceFile });
	} finally {
		snapshot.dispose();
	}
}

export function withNativeSource<T>(
	source: string,
	fileName: string,
	callback: (context: NativeSourceContext) => T,
): T {
	return withNativeProgram(new Map([[fileName, source]]), fileName, callback);
}
```

The pinned 7.0.2 sync entry point exports `Checker`; use that type and do not add a TypeScript 6 fallback.

- [ ] **Step 4: Run adapter tests and typecheck the adapter**

Run: `pnpm exec vitest run src/lib/typescript/native-source-analysis.test.ts`

Run: `pnpm exec tsc --project tsconfig.typecheck.json --noEmit --incremental false`

Expected: adapter tests PASS. Typechecking fails only in the not-yet-migrated legacy consumers and reports no error from `native-source-analysis.ts`.

- [ ] **Step 5: Inspect the adapter checkpoint**

```bash
git diff --check -- apps/webapp/src/lib/typescript/native-source-analysis.ts apps/webapp/src/lib/typescript/native-source-analysis.test.ts
git diff -- apps/webapp/src/lib/typescript/native-source-analysis.ts apps/webapp/src/lib/typescript/native-source-analysis.test.ts
```

### Task 3: Migrate Workflow Event Analysis

**Files:**
- Modify: `apps/webapp/src/lib/approvals/workflow/event-append-only-typescript.ts:1-253`
- Modify: `apps/webapp/src/lib/approvals/workflow/event-append-only-sql.ts:1`
- Modify: `apps/webapp/src/lib/approvals/workflow/event-append-only-sql.test.ts:1-83`
- Test: `apps/webapp/src/lib/approvals/workflow/event-append-only-typescript.test.ts`
- Test: `apps/webapp/src/lib/approvals/workflow/event-append-only-sql.test.ts`
- Test: `apps/webapp/src/lib/approvals/workflow/event-append-only-guard.test.ts`

- [ ] **Step 1: Add a stale-snapshot regression to the workflow analyzer suite**

Append a test that analyzes the same logical file twice and proves symbols from the first source do not survive:

```ts
it("does not retain symbols from a previous snapshot of the same file", () => {
	expect(
		analyzeApprovalWorkflowEventMutations(
			`import { approvalWorkflowEvent } from "@/db"; db.delete(approvalWorkflowEvent);`,
			FILE_NAME,
		),
	).toHaveLength(1);
	expect(analyzeApprovalWorkflowEventMutations(`const approvalWorkflowEvent = {};`, FILE_NAME)).toEqual([]);
});
```

- [ ] **Step 2: Run the workflow suites to verify the TypeScript 7 failure**

Run: `pnpm exec vitest run src/lib/approvals/workflow/event-append-only-typescript.test.ts src/lib/approvals/workflow/event-append-only-sql.test.ts src/lib/approvals/workflow/event-append-only-guard.test.ts`

Expected: FAIL because all three still depend on the TypeScript 6 package-root API.

- [ ] **Step 3: Split AST and checker imports**

In both production files, replace the package-root import with AST imports:

```ts
import * as ts from "typescript/unstable/ast";
import type { Checker, Symbol as TypeScriptSymbol } from "typescript/unstable/sync";
```

Replace `ts.TypeChecker` with `Checker` and `ts.Symbol` with `TypeScriptSymbol`. Keep `ts.Node`, `ts.Expression`, guards, `SyntaxKind`, and `node.forEachChild` on the AST namespace. Replace every `ts.forEachChild(node, visit)` with `node.forEachChild(visit)`.

- [ ] **Step 4: Replace legacy program construction**

Delete the local `createProgram` function in `event-append-only-typescript.ts`. Wrap the existing analyzer body:

```ts
import { withNativeSource } from "@/lib/typescript/native-source-analysis";

export function analyzeApprovalWorkflowEventMutations(
	source: string,
	fileName: string,
): ApprovalWorkflowEventMutationViolation[] {
	return withNativeSource(source, fileName, ({ checker, program, sourceFile }) => {
		const diagnostics = [...program.getSyntacticDiagnostics(sourceFile.fileName)].sort(
			(left, right) => (left.pos ?? 0) - (right.pos ?? 0) || left.code - right.code,
		);
		const diagnostic = diagnostics[0];
		if (diagnostic) {
			const location = sourceFile.getLineAndCharacterOfPosition(diagnostic.pos ?? 0);
			throw new Error(
				`Approval workflow event mutation analysis parse error at ${normalizedFileName(fileName)}:${location.line + 1}:${location.character + 1} [TS${diagnostic.code}] ${diagnostic.text}`,
			);
		}
		const roots = new Map<TypeScriptSymbol, Provenance>();
		const writes = new Map<TypeScriptSymbol, SymbolWrite[]>();
		// Move the current analyzer body from its `roots` declaration through its
		// final sorted violation return into this callback without behavioral edits.
	});
}
```

Use TypeScript 7 diagnostic fields `pos` and `text`; do not retain `flattenDiagnosticMessageText`.

- [ ] **Step 5: Move SQL evaluator fixtures to the multi-file adapter**

Replace fixture-local `createSourceFile`, `CompilerHost`, and `createProgram` with:

```ts
return withNativeProgram(sources, fileName, ({ checker, program, sourceFile }) => {
	let resultExpression: ts.Expression | undefined;
	sourceFile.forEachChild(function visit(node) {
		if (
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === "result"
		) {
			resultExpression = node.initializer;
		}
		node.forEachChild(visit);
	});
	if (!resultExpression) throw new Error("Fixture must declare const result");
	const sourceFiles = new Map(
		[...sources.keys()].map((candidate) => {
			const candidateSource = program.getSourceFile(candidate);
			if (!candidateSource) throw new Error(`Fixture source file was not created: ${candidate}`);
			return [candidate, candidateSource] as const;
		}),
	);
	options.prepare?.({ checker, resultExpression, sourceFiles });
	let result: string | null = null;
	for (let count = 0; count < (options.evaluationCount ?? 1); count += 1) {
		result = evaluateConstantSql(resultExpression, {
			checker,
			usePosition: resultExpression.getStart(sourceFile),
		});
	}
	return result;
});
```

Preserve the `sourceFiles` map because the existing cache-index test inspects multiple files.

- [ ] **Step 6: Run all workflow event tests**

Run: `pnpm exec vitest run src/lib/approvals/workflow/event-append-only-typescript.test.ts src/lib/approvals/workflow/event-append-only-sql.test.ts src/lib/approvals/workflow/event-append-only-guard.test.ts`

Expected: all workflow event tests PASS, including exact parse-error and analysis-limit assertions.

- [ ] **Step 7: Inspect the workflow migration checkpoint**

```bash
git diff --check -- apps/webapp/src/lib/approvals/workflow
git diff -- apps/webapp/src/lib/approvals/workflow/event-append-only-typescript.ts apps/webapp/src/lib/approvals/workflow/event-append-only-sql.ts apps/webapp/src/lib/approvals/workflow/event-append-only-sql.test.ts apps/webapp/src/lib/approvals/workflow/event-append-only-typescript.test.ts
```

### Task 4: Migrate Approval Write-Boundary Analysis

**Files:**
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary-typescript.ts:1-430`
- Modify: `apps/webapp/src/lib/approvals/approval-write-boundary-sql.ts:1`
- Test: `apps/webapp/src/lib/approvals/approval-write-boundary.test.ts`
- Test: `apps/webapp/src/lib/approvals/approval-write-boundary-typescript.test.ts`
- Test: `apps/webapp/src/lib/approvals/approval-write-boundary-sql.test.ts`

- [ ] **Step 1: Add sequential-source coverage**

Add this regression near the analyzer fixture tests:

```ts
it("does not retain protected provenance across source replacements", () => {
	expect(
		analyzeApprovalWriteMutations(
			`import { timeEntry } from "@/db"; db.delete(timeEntry);`,
			FILE_NAME,
		),
	).toHaveLength(1);
	expect(analyzeApprovalWriteMutations(`const timeEntry = {};`, FILE_NAME)).toEqual([]);
});
```

- [ ] **Step 2: Run the write-boundary suites to verify they fail under TypeScript 7**

Run: `pnpm exec vitest run src/lib/approvals/approval-write-boundary.test.ts src/lib/approvals/approval-write-boundary-typescript.test.ts src/lib/approvals/approval-write-boundary-sql.test.ts`

Expected: FAIL in the legacy package-root Compiler API path.

- [ ] **Step 3: Migrate AST, symbol, checker, and program types**

Apply the same import split as Task 3:

```ts
import * as ts from "typescript/unstable/ast";
import type { Checker, Symbol as TypeScriptSymbol } from "typescript/unstable/sync";
import { withNativeSource } from "@/lib/typescript/native-source-analysis";
```

Replace legacy namespace types and `ts.forEachChild` calls. Do not alter provenance, helper propagation, SQL evaluation budgets, ordering, or limits.

- [ ] **Step 4: Replace local program construction and diagnostics**

Delete the local `createProgram`, call `withNativeSource`, and retain the full analyzer inside its callback. Read syntactic diagnostics by normalized file name and format TypeScript 7's `diagnostic.text` exactly where the old code formatted `messageText`.

- [ ] **Step 5: Run write-boundary tests**

Run: `pnpm exec vitest run src/lib/approvals/approval-write-boundary.test.ts src/lib/approvals/approval-write-boundary-typescript.test.ts src/lib/approvals/approval-write-boundary-sql.test.ts`

Expected: all tests PASS with unchanged findings and deterministic error output.

- [ ] **Step 6: Inspect the write-boundary migration checkpoint**

```bash
git diff --check -- apps/webapp/src/lib/approvals/approval-write-boundary-typescript.ts apps/webapp/src/lib/approvals/approval-write-boundary-sql.ts apps/webapp/src/lib/approvals/approval-write-boundary.test.ts apps/webapp/src/lib/approvals/approval-write-boundary-typescript.test.ts
git diff -- apps/webapp/src/lib/approvals/approval-write-boundary-typescript.ts apps/webapp/src/lib/approvals/approval-write-boundary-sql.ts apps/webapp/src/lib/approvals/approval-write-boundary.test.ts apps/webapp/src/lib/approvals/approval-write-boundary-typescript.test.ts
```

### Task 5: Migrate Structural AST Tests

**Files:**
- Modify: `apps/webapp/src/app/api/tenant-mutation-scope.test.ts`
- Modify: `apps/webapp/src/components/form-module-size.test.ts`
- Modify: `apps/webapp/src/components/organization/invite-code-management.test.tsx`
- Modify: `apps/webapp/src/components/settings/settings-component-size.test.ts`

- [ ] **Step 1: Run the four tests to record their TypeScript 7 failures**

Run:

```bash
pnpm exec vitest run src/app/api/tenant-mutation-scope.test.ts src/components/form-module-size.test.ts src/components/organization/invite-code-management.test.tsx src/components/settings/settings-component-size.test.ts
```

Expected: FAIL at `ts.createSourceFile` or `ts.ScriptTarget.Latest`.

- [ ] **Step 2: Replace direct parsing with callback-scoped native parsing**

Use this pattern in each test:

```ts
import * as ts from "typescript/unstable/ast";
import { withNativeSource } from "@/lib/typescript/native-source-analysis";

return withNativeSource(sourceText, filePath, ({ sourceFile }) => {
	let match: ts.Node | undefined;
	sourceFile.forEachChild(function visit(node) {
		if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
			match = node;
		}
		node.forEachChild(visit);
	});
	if (!match) throw new Error(`${functionName} not found in ${filePath}`);
	const start = sourceFile.getLineAndCharacterOfPosition(match.getStart(sourceFile));
	const end = sourceFile.getLineAndCharacterOfPosition(match.getEnd());
	return end.line - start.line + 1;
});
```

For `tenant-mutation-scope.test.ts`, keep the entire visit and violation collection inside the callback so no remote node escapes after snapshot disposal. For the two component count tests, return plain arrays/maps from the callback.

- [ ] **Step 3: Verify the structural tests**

Run the four-file command from Step 1.

Expected: 4 test files PASS with unchanged component limits and tenant-scope assertions.

- [ ] **Step 4: Prove no legacy package-root imports remain**

Run: `rg 'import ts from "typescript"|createSourceFile|createProgram\(' apps/webapp/src`

Expected: no legacy `typescript` imports and no legacy parser/program construction. Matches referring to the adapter or function names unrelated to TypeScript must be reviewed explicitly.

- [ ] **Step 5: Inspect the structural test checkpoint**

```bash
git diff --check -- apps/webapp/src/app/api/tenant-mutation-scope.test.ts apps/webapp/src/components/form-module-size.test.ts apps/webapp/src/components/organization/invite-code-management.test.tsx apps/webapp/src/components/settings/settings-component-size.test.ts
git diff -- apps/webapp/src/app/api/tenant-mutation-scope.test.ts apps/webapp/src/components/form-module-size.test.ts apps/webapp/src/components/organization/invite-code-management.test.tsx apps/webapp/src/components/settings/settings-component-size.test.ts
```

### Task 6: Verify Performance And Complete The Migration

**Files:**
- Test: `apps/webapp/src/lib/typescript/native-source-analysis.test.ts`

- [ ] **Step 1: Run the approval scan performance coverage before optimization**

Run: `pnpm exec vitest run src/lib/approvals/approval-write-boundary.test.ts src/lib/approvals/workflow/event-append-only-guard.test.ts --reporter=verbose`

Expected: PASS in one Vitest worker with no native process timeout. The adapter test proves sequential calls reuse the module-scoped runtime while receiving fresh source contents.

- [ ] **Step 2: Verify the native checker supports batched symbol queries**

Add an adapter test that parses two identifiers and sends them in one checker call:

```ts
it("supports batched symbol queries", () => {
	const names = withNativeSource("const first = 1; const second = first;", "/batch.ts", ({ checker, sourceFile }) => {
		const identifiers: import("typescript/unstable/ast").Identifier[] = [];
		sourceFile.forEachChild(function visit(node) {
			if (isIdentifier(node)) identifiers.push(node);
			node.forEachChild(visit);
		});
		return checker.getSymbolAtLocation(identifiers).map((symbol) => symbol?.name);
	});
	expect(names).toEqual(["first", "second", "first"]);
});
```

Run: `pnpm exec vitest run src/lib/typescript/native-source-analysis.test.ts`

Expected: PASS. This records the available optimization surface without changing order-sensitive analyzer logic.

- [ ] **Step 3: Run all direct Compiler API consumer tests**

Run:

```bash
pnpm exec vitest run src/lib/typescript/native-source-analysis.test.ts src/lib/approvals/workflow/event-append-only-typescript.test.ts src/lib/approvals/workflow/event-append-only-sql.test.ts src/lib/approvals/workflow/event-append-only-guard.test.ts src/lib/approvals/approval-write-boundary.test.ts src/lib/approvals/approval-write-boundary-typescript.test.ts src/lib/approvals/approval-write-boundary-sql.test.ts src/app/api/tenant-mutation-scope.test.ts src/components/form-module-size.test.ts src/components/organization/invite-code-management.test.tsx src/components/settings/settings-component-size.test.ts
```

Expected: every listed file PASS with zero failures.

- [ ] **Step 4: Run webapp typechecking under TypeScript 7**

Run: `pnpm run typecheck` from `apps/webapp`.

Expected: `next typegen` and all three `tsc` projects exit 0. Run `pnpm exec tsc --version` and expect `Version 7.0.2`.

- [ ] **Step 5: Run the full webapp test suite**

Run: `pnpm test` from `apps/webapp`.

Expected: all webapp tests PASS. The existing Vite native-config warning may remain; no new warning or native API process leak is acceptable.

- [ ] **Step 6: Check the final dependency graph and diff**

Run: `pnpm why typescript --filter webapp`

Expected: webapp's direct dependency is exactly 7.0.2; no direct aliased TypeScript 6 dependency exists.

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only planned files and pre-existing concurrent changes are listed.

- [ ] **Step 7: Inspect the verification coverage**

```bash
git diff --check -- apps/webapp/src/lib/typescript/native-source-analysis.test.ts
git diff -- apps/webapp/src/lib/typescript/native-source-analysis.test.ts
```
