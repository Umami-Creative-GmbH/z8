# Effect Reference

## Open This When

- You are writing or changing code that imports `effect`.

## Read First

- `apps/webapp/node_modules/effect/CLAUDE.md` and its `ai-docs/`: the v4 API, written for agents.
- [Effect MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md): what changed from v3. Read it when an example or habit you know comes from v3.

## Version

The app runs Effect v4 only, installed as `effect`. Don't add another Effect version, alias or compat package.

- The shared infrastructure lives in `apps/webapp/src/lib/effect/`: the services, the `AppLayer` and runtime in `runtime.ts`, and the server-action bridge in `result.ts`.
- `lib/effect/errors.ts` holds the tagged errors. Code fails with them through `Effect.fail(new XError(...))` and reads them by `_tag` or `instanceof`.
- The approval write-boundary scanner (`lib/approvals/approval-write-boundary*.ts`) recognizes `effect` and `lib/effect/services/database.service` by module name, and registers some writers by file path. When a registered file moves, update its path in `CANONICAL_SOURCE_WRITE_OWNERS` and in the matching test expectations.

## v4 Rules That Change Behavior

These differ from v3, so code and examples written for v3 get them wrong.

- **Rejections:** `runPromise` rejects with the original error. v3 wrapped it in a `FiberFailure` with the same `message`, so it never passed `instanceof` checks. In `try { await Effect.runPromise(...) } catch`, every `instanceof`, `name` and `_tag` test in the catch matches the typed error.
- **Typed failures across a Promise boundary:** run with `runPromiseExit` and unwrap a failed exit with `failureOfCause(exit.cause)` from `lib/effect/cause-failure.ts`. It returns the typed failure, else the defect, else `Cause.squash`, so a typed failure wins over a finalizer defect. Return or rethrow that value. When a defect must never reach the user, read only the typed failure with `typedFailureOfCause` from the same module. Don't call `Cause.findErrorOption` or `Cause.findDefect` elsewhere, and don't use `Runtime.isFiberFailure` or `FiberFailureCauseId`; they don't exist in v4.
- **Layer sharing:** `Effect.provide(layer)` reuses an already-built layer across calls by default. Keep per-request and per-transaction state out of layers: read the session inside service methods (as `AuthService.getSession` does), and pass transaction-scoped services with `Effect.provideService`. Use `Effect.provide(layer, { local: true })` when a layer must be rebuilt each time.
- **Schedules:** use `Schedule.max([a, b])` where v3 used `Schedule.compose(a, b)`. It continues while both continue and waits the longer delay.

## Services

Define services as `class X extends Context.Service<X, Shape>()("X") {}` and provide them with `Layer.succeed` or `Layer.effect`. `lib/effect/services/database.service.ts` is the canonical example. Add a new service to the `AppLayer` in `lib/effect/runtime.ts`. Server actions run their effect through `runServerActionSafe` in `lib/effect/result.ts`, which turns an `Exit` into `ServerActionResult`.

In tests, `vi.mock` factories import `effect`, and stub services with `Context.Service<any>("Name")`.
