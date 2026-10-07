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

Define services as `class X extends Context.Service<X, Shape>()("X") {}`. Provide them with `Layer.succeed(X, X.of({...}))` when building the service does no effectful work, and with `Layer.effect` only when the constructor yields services or runs effects. `lib/effect/services/database.service.ts` is the canonical example. Add a new service to the `AppLayer` in `lib/effect/runtime.ts`.

`runServerActionSafe` in `lib/effect/result.ts` is the only server-action runner. It runs the effect on the shared runtime and turns the `Exit` into the shared `ServerActionResult`: a typed failure comes back with its `message` and its `_tag` as `code`, so failure messages must be safe to show users. Don't add another runner or a local result type.

A service shape or callback type declares the real requirement type (`R`) of the effects it returns, never `any` or `unknown`. A missing service then fails to compile instead of failing at run time. Runners provide those services; they don't cast to `Effect<…, never>`. The approval handler contract is the example: its effects require `ApprovalHandlerServices` (`lib/approvals/domain/types.ts`), and the shared legacy decision owner passes its callbacks' requirements through as a type parameter.

In tests, `vi.mock` factories import `effect`, and stub services with `Context.Service<any>("Name")`.

## Runtime

`runtime` in `lib/effect/runtime.ts` is the one shared `ManagedRuntime`, built from `AppLayer`. Don't create another one.

1. **AppLayer services:** code that needs any `AppLayer` service runs on the shared runtime: `runServerActionSafe`, `runtime.runPromise` or `runtime.runPromiseExit`.
2. **No self-provided AppLayer:** never provide `AppLayer`, or a layer that is a member of it, yourself. The runtime already holds them.
3. **Services outside AppLayer** (billing, surcharge, break enforcement, schedule and Teams compliance, open shifts, invite code, time record, approval query): provide their own `*Live` layer with `Effect.provide(...)` on top of a shared-runtime run. The layer then reads `DatabaseService`, `WorkPolicyService` and the rest from the runtime instead of rebuilding them. Don't add `*FullLive` layers that bundle `DatabaseServiceLive`.
4. **Bare runs:** `Effect.runPromise` and `Effect.runPromiseExit` are only for effects that need no services (`R = never`), such as calendar provider calls or effects that take their dependencies as arguments.
5. **Transactions:** transaction overrides stay inside the transaction. Pass a transaction-bound instance with `Effect.provideService(Tag, instance)`, as the approval audit logger does, or rebuild a layer against the transaction with `Effect.provide(layer, { local: true })`, as the canonical time-entry client does.
6. **Nested runs:** service methods compose with `yield*`. Run an effect from inside a running one only at a Promise callback boundary, such as a port, a `planLegacy` hook or a `db.transaction(async (tx) => …)` callback. Use `tryPromiseWithRunner` from `lib/effect/promise-callback.ts` there: its runner keeps the caller's services, tracing span and interruption.
7. **Billing** stays out of `AppLayer`. Every billing run provides `BillingServicesLive` from `lib/effect/services/billing` and runs on the shared runtime. Import that module lazily outside the billing routes and jobs, and gate on `BILLING_ENABLED`. The Stripe client is created once per process and secret key.

`runServerActionSafe` only accepts effects whose requirements are `AppServices` (the `AppLayer` members, exported from `lib/effect/result.ts`), so an effect that needs a service outside `AppLayer` fails to compile until its layer is provided. `lib/effect/runtime-rule-guard.test.ts` enforces rule 2: non-test source must not pass `AppLayer` or one of its members (read from `AppLayer`'s `Layer.mergeAll`) to `Effect.provide`, `Layer.provide`, `Layer.provideMerge`, `Layer.merge` or `Layer.mergeAll`. Only the runtime module, test files and `{ local: true }` rebuilds are exempt.

A layer provided on top of the runtime is built for that run only, and its own new layers are not memoized past it. Keep process-wide resources, such as the Stripe client, in module scope.

A module that `AppLayer` itself imports, such as the time-tracking calculations that `AnalyticsService` uses, must not import the runtime, because that closes an import cycle. Export an effect that requires the service instead, and let callers on the runtime run it.
