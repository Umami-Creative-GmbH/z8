# Effect Reference

## Open This When

- You are writing or changing code that imports `effect`.

## Read First

- `apps/webapp/node_modules/effect/CLAUDE.md` and its `ai-docs/`: the v4 API, written for agents.
- [Effect MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md): what changed from v3. Read it when an example or habit you know comes from v3. The compiler rejects removed v3 APIs. The sections below cover the v4 behavior that v3 code still compiles against: rejections, layer sharing and cause unwrapping.

## Version

The app runs Effect v4 only, installed as `effect`. Keep it the single Effect version, with no alias or compat package. The shared infrastructure lives in `apps/webapp/src/lib/effect/`.

## Services

- **Definition:** `class X extends Context.Service<X, Shape>()("X") {}`. `lib/effect/services/database.service.ts` is the canonical example.
- **Layers:** use `Layer.succeed(X, X.of({...}))` when building the service does no effectful work, and `Layer.effect` only when the constructor yields services or runs effects. Add a new service to `AppLayer` in `lib/effect/runtime.ts`.
- **Request state:** the runtime builds a layer once and shares it across requests, so a layer captures no session, organization or transaction. Read the session inside the service method, as `AuthService.getSession` does.
- **Database:** a service that touches the database yields `DatabaseService` in its layer instead of importing the global `db`, so a transaction-bound `DatabaseService` reaches it.
- **Requirement types:** a service shape or callback type declares the real requirement type (`R`) of the effects it returns. A missing service then fails to compile instead of failing at run time, and runners provide the service instead of casting to `Effect<…, never>`. The approval handler contract is the example: its effects require `ApprovalHandlerServices` (`lib/approvals/domain/types.ts`), and `processApproval` in `lib/approvals/server/shared.ts` passes its callbacks' requirements through as the type parameter `R`.

## Runtime

`runtime` in `lib/effect/runtime.ts` is the one shared `ManagedRuntime`, built from `AppLayer`. Every run goes through it unless rule 4 applies.

1. **AppLayer services:** code that needs any `AppLayer` service runs on the shared runtime: `runServerActionSafe`, `runtime.runPromise` or `runtime.runPromiseExit`.
2. **No self-provided AppLayer:** the runtime already provides `AppLayer` and its members, so code never provides them itself. `lib/effect/runtime-rule-guard.test.ts` enforces this for non-test source.
3. **Services outside AppLayer:** a service whose `*Live` layer is not in `AppLayer`'s `Layer.mergeAll` (billing, surcharge, break enforcement, approval query and others) gets its layer from `Effect.provide(...)` on top of a shared-runtime run. The layer then reads `DatabaseService`, `WorkPolicyService` and the rest from the runtime. Keep such layers free of `DatabaseServiceLive` and other `AppLayer` members.
4. **Bare runs:** `Effect.runPromise` and `Effect.runPromiseExit` are only for effects that need no services (`R = never`), such as calendar provider calls or effects that take their dependencies as arguments.
5. **Transactions:** inside a runtime run, `Effect.provide(XLive)` for an `AppLayer` member resolves to the runtime's instance. That holds even with a transaction-bound dependency provided around it, so the effect silently runs outside the transaction. Keep transaction overrides inside the transaction: pass a transaction-bound instance with `Effect.provideService(Tag, instance)`, as the approval audit logger does, or rebuild the layer with `Effect.provide(layer, { local: true })`, as the canonical time-entry client (`time-tracking/actions.canonical.ts`) does.
6. **Nested runs:** service methods compose with `yield*`. Run an effect from inside a running one only at a Promise callback boundary, such as a port, a `planLegacy` hook or a `db.transaction(async (tx) => …)` callback. Use `tryPromiseWithRunner` from `lib/effect/promise-callback.ts` there: its runner keeps the caller's services, tracing span and interruption. Promise code that starts its own runtime runs, such as `getManagerDailyBriefing`, is called after the effect instead of inside it, as `getManagerTodaySummary` (`components/dashboard/actions.ts`) does.
7. **Billing** stays out of `AppLayer`. Every billing run provides `BillingServicesLive` from `lib/effect/services/billing` and runs on the shared runtime. Import that module lazily outside the billing routes and jobs, and gate on `BILLING_ENABLED`. The seat recounts are the exception to the gate: the seat reconciliation job and the departure `billing_sync` task (`employee-lifecycle/runtime.ts`) update the local seat count while billing is disabled, and the seat sync skips Stripe then.

A layer provided on top of the runtime is built for that run only, and its own new layers are not memoized past it. Keep process-wide resources in module scope, as `billing/stripe.service.ts` does with one Stripe client per process and secret key.

A module that `AppLayer` itself imports, such as the time-tracking calculations that `AnalyticsService` uses, must not import the runtime, because that closes an import cycle. Export an effect that requires the service instead, and let callers on the runtime run it.

## Server Actions

- **Runner:** `runServerActionSafe(effect)` in `lib/effect/result.ts` is the only server-action runner. It runs the effect on the shared runtime and returns the shared `ServerActionResult<T>`.
- **Types:** it accepts `Effect<T, AnyAppError, AppServices>`. `AppServices` is every `AppLayer` member, so a service from outside `AppLayer` fails to compile until its layer is provided (Runtime rule 3).
- **Results:** a typed failure comes back with its `message` as `error` and its `_tag` as `code`. A defect that is an `Error` comes back with its `message` and code `UNKNOWN_ERROR`, and an interrupt-only failure with a generic message. Write typed-failure and thrown messages that are safe to show users.

## Database Access

- **One wrapper:** database work in an effect runs through `DatabaseService.query(name, fn)`. It traces a `db.query.<name>` span and maps a rejection to `DatabaseError { operation: name, cause }` with the generic message `Database query failed: <name>`. `lib/effect/services/database-error-sites.test.ts` fails on an `Effect.tryPromise` or `tryPromiseWithRunner` that builds its own `DatabaseError`. Its only exceptions are Promise code that needs the caller's runner (the seat delivery and the automatic break adjustment); their `DatabaseError` keeps a generic message and never copies the cause's message. A failure that is not database work gets its own tagged error, such as `QueueError` for a BullMQ call.
- **Data access functions:** a Promise helper that an effect calls takes the client of the caller's `DatabaseService` as an argument instead of importing the global `db`, as the billing configuration writes (`billing/billing-configuration.ts`) do.
- **Names:** use `<area>.<operation>`, such as `subscription.getByOrganization`.
- **Several calls:** a multi-call body or a whole transaction can run inside one `query`. A typed error thrown inside arrives as the `DatabaseError`'s `cause`. When the caller must keep its type, map it back with `Effect.mapError`, as the project and work-category configuration writes (`settings/projects/actions.ts`, `settings/work-categories/actions.ts`) do.
- **Transactions:** build a transaction-bound service with `makeDatabaseService(tx)` from `database.service.ts`, the constructor `DatabaseServiceLive` uses too. Some Promise-first writers in approvals, time tracking and demo data pass `{ db: tx, query: (_name, fn) => Effect.promise(fn) }` instead, on purpose. There a failure becomes a defect, so a domain error thrown inside reaches the caller unwrapped through `failureOfCause`. Keep that shape where a caller recognizes those errors with `instanceof`, as the ordinary work-period approval (`time-tracking/actions/mutations.ts`) does. A helper that binds a service it was handed to a transaction keeps that service's query (`{ db: tx, query: dbService.query }`, as `processApprovalWithCurrentEmployee` and the approval chain creation do), so the caller's error shape holds inside the transaction.
- **Approval writes:** the approval write-boundary scanner (`lib/approvals/approval-write-boundary.test.ts`) follows writes through `yield* DatabaseService` when `DatabaseService` is imported from `@/lib/effect/services/database.service` by alias or relative path. It fails on a write to a protected approval table from a file that `lib/approvals/approval-write-boundary.ts` does not register, so a moved writer needs its new path there.

## Errors

- **Tagged errors:** `lib/effect/errors.ts` holds the `Data.TaggedError` classes and their union `AnyAppError`. Fail with `Effect.fail(new XError(...))` and read errors by `_tag` or `instanceof`. An error a server action returns is a member of `AnyAppError`.
- **Rejections:** `runPromise` and `runtime.runPromise` reject with the typed failure itself, so the `instanceof`, `name` and `_tag` checks in a `try { await … } catch` match it directly.
- **Exits:** to carry a typed failure across a Promise boundary, run with `runPromiseExit` and unwrap a failed exit with `failureOfCause(exit.cause)` from `lib/effect/cause-failure.ts`. It returns the typed failure, else the defect, else `Cause.squash`, so a typed failure wins over a finalizer defect. Return or rethrow that value. When a defect must never reach the user, read only the typed failure with `typedFailureOfCause` from the same module, and test for an interruption without either with `isInterruptOnly`. Unwrap causes only through these helpers; `toServerActionResult` uses them too.

## Tests

- **Runtime:** unit tests replace `@/lib/effect/runtime` with `runtimeModuleOver(stubLayer)` from `src/test/effect-runtime.ts`, which builds the shared runtime over stub services. A test that also mocks `@/lib/effect/result` runs the effect on that mocked `runtime`, so the stubs reach it.
- **Stubs:** a `vi.mock` factory imports `effect` and stubs a service with `Context.Service<any>("Name")` and `Layer.succeed`.
- **Layers:** test sources may provide `AppLayer` members directly; both guard tests skip them.
- **Type-level checks:** `pnpm typecheck` excludes `*.test.ts` files. Put compile-time assertions, such as a `@ts-expect-error` on a run that lacks a service, in a `*.typecheck.ts` file, as `lib/approvals/application/approval-query.service.typecheck.ts` does.
