# TypeScript 7 Compiler API Migration

## Context

The webapp uses the legacy in-process TypeScript Compiler API for approval write-boundary analysis and several structural tests. Upgrading the `typescript` dependency from 6.0.3 to 7.0.2 breaks these consumers because the TypeScript 7 package root exposes version metadata rather than `createSourceFile`, `createProgram`, `CompilerHost`, and the old combined AST namespace.

TypeScript 7 provides a replacement under unstable entry points. The replacement runs the native compiler out of process and exposes immutable snapshots, projects, programs, checkers, and remote AST nodes. It does not provide direct parity with the old compiler host or string-to-AST APIs.

## Goals

- Use `typescript@7.0.2` for the webapp compiler and analyzer runtime.
- Preserve the current synchronous analyzer and scanner APIs.
- Preserve existing violation results, diagnostics, deterministic ordering, and analysis limits.
- Migrate every direct legacy Compiler API consumer in the webapp so the test suite does not contain a hidden TypeScript 6 dependency.
- Reuse one native compiler process instead of spawning a process for every analyzed source string.

## Non-Goals

- Providing a generic compatibility implementation of the TypeScript 6 Compiler API.
- Stabilizing or wrapping every TypeScript 7 unstable API.
- Converting approval scanning to asynchronous APIs.
- Changing approval policy or write-boundary behavior.
- Retaining TypeScript 6 as an aliased runtime dependency or fallback.

## Architecture

Add a focused internal TypeScript 7 analysis adapter for the webapp's source-analysis use cases. The adapter owns a long-lived synchronous native `API` session, a virtual filesystem overlay, snapshot creation, project selection, and resource cleanup. Consumers receive only the source file, program, and checker capabilities needed by the analyzers; they do not create native sessions directly.

The adapter uses the TypeScript 7 unstable entry points:

- `typescript/unstable/sync` for `API`, snapshots, programs, checkers, diagnostics, and compiler enums.
- `typescript/unstable/ast` for AST nodes, syntax kinds, guards, and traversal.
- `typescript/unstable/fs` for the virtual filesystem overlay.

The exact imports will follow the exports in the pinned 7.0.2 package rather than depending on unpublished `main`-branch APIs.

## Analysis Flow

For each `source` and `fileName` pair:

1. Normalize the file name and place the source in the virtual filesystem overlay.
2. Update the native API snapshot with the file creation or content change.
3. Select the inferred project for the file, or a minimal virtual configured project if inferred projects do not provide the required no-lib/no-resolve behavior.
4. Obtain the project's program, checker, and remote source file.
5. Run syntactic diagnostics before mutation analysis and translate the first diagnostic into the existing deterministic error format.
6. Run the existing provenance and SQL analysis against TypeScript 7 AST nodes.
7. Dispose the per-analysis snapshot while retaining the API process and reusable source-file cache.

The adapter serializes updates to its mutable virtual filesystem and current snapshot state. The public API remains synchronous, so one Node.js thread cannot interleave analyses; worker processes receive independent adapter instances. Cleanup closes the native API process when the test worker or scanning process exits.

## Analyzer Migration

Migrate the two approval analyzer families together:

- Approval workflow event append-only TypeScript and SQL analyzers.
- Approval write-boundary TypeScript and SQL analyzers.

Their code currently treats `typescript` as one namespace containing AST types, compiler types, guards, factories, and enums. TypeScript 7 separates these concerns. Imports and type annotations will be split accordingly while keeping the analysis algorithms unchanged.

The remaining structural tests that directly parse TypeScript source will use the same adapter or a smaller parse-only helper backed by it. No test should import the TypeScript package root and expect the TypeScript 6 runtime shape.

Semantic symbol queries cross an IPC boundary. Where the current analyzers query symbols repeatedly during traversal, the migration should collect nodes and use TypeScript 7's batched checker overloads when this can be done without changing provenance ordering. Queries whose result depends on an immediately preceding algorithmic step may remain individual calls.

## Errors And Lifecycle

- Failure to create a project, retrieve a source file, or communicate with the native process is an analyzer infrastructure error and must include the normalized file name.
- Existing parse-error text and approval analysis-limit errors remain stable.
- Every temporary snapshot is disposed in a `finally` block.
- The shared API process is closed by an explicit adapter cleanup function registered once per process.
- There is no silent TypeScript 6 fallback. Unsupported TypeScript 7 behavior fails visibly.

## Testing

The migration follows a red-green sequence using the current TypeScript 7 failure as the regression baseline.

Required verification:

- The reported `event-append-only-typescript.test.ts` suite passes unchanged.
- Both approval analyzer families and their guard/scanner tests pass.
- Structural tests that use the compiler API pass.
- The full webapp test suite passes under TypeScript 7.
- `pnpm run typecheck` resolves and executes TypeScript 7.
- A package-resolution assertion confirms the webapp's direct `typescript` dependency is version 7 and no direct TypeScript 6 alias was introduced.
- Repeated analysis in one process verifies snapshot updates do not leak prior source contents or symbols.
- Malformed source verifies diagnostic translation and snapshot cleanup.

## Risks

The TypeScript 7 API is explicitly unstable and may change in patch or minor releases. Pin TypeScript to the selected 7.0.2 release rather than using a range, and treat future upgrades as deliberate migrations.

Native API calls incur IPC overhead. A shared process, snapshot reuse, prefiltering, and batched semantic queries limit that cost. Performance should be measured against the existing production scan test before accepting the migration.

Remote AST details may differ from TypeScript 6. Existing analyzer tests are the behavioral contract; implementation changes should be limited to API adaptation unless a TypeScript 7 parser difference makes an expectation invalid and is reviewed separately.

## Acceptance Criteria

- `apps/webapp/package.json` pins `typescript` to `7.0.2`.
- No webapp source or test expects Compiler API members from the `typescript` package root.
- Approval analysis retains its synchronous public contract and existing outputs.
- Native snapshots and the compiler process have deterministic cleanup.
- Targeted tests, full webapp tests, and webapp typechecking pass with TypeScript 7.
