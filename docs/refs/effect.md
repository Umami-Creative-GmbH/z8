# Effect Reference

## Open This When

- You are writing or changing code that imports `effect`.
- You are porting a part of the app from Effect v3 to v4 (#625).

## Read First

- `apps/webapp/node_modules/effect/CLAUDE.md` and its `ai-docs/`: the v4 API, written for agents.
- [Effect MIGRATION.md](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md): the v3 → v4 changes.

## Versions During the Migration

The app runs Effect v4 as `effect`. Until #633 finishes the migration, v3 is still installed as the `effect-v3` alias, and the v3 code lives in `apps/webapp/src/lib/effect-v3/`. The parent issue #625 lists which slice moves which part of the app.

- New code imports `effect` and the v4 modules in `lib/effect/`. Use `effect-v3` only to extend a part that has not moved yet, and keep `lib/effect-v3/` closed to new files.
- v3 and v4 code meet only at a plain Promise boundary: run one side to a Promise and wrap it on the other. A v3 Effect, Layer or service cannot be used from v4 code, and the reverse doesn't work either.
- A service with both v3 and v4 users keeps a **frozen** v3 copy in `lib/effect-v3/`. Its header names the v4 file. Make every change in both copies until the v3 copy is deleted.
- `lib/effect/errors.ts` is the single copy of the tagged errors, shared by both versions. Code fails with them through `Effect.fail(new XError(...))` and reads them by `_tag` or `instanceof`.
- The version-neutral types `ServerActionResult`, `ActionState` and `Session` live in the v4 modules. Type-only imports point there.
- The approval write-boundary scanner (`lib/approvals/approval-write-boundary*.ts`) knows both module names and registers some writers by file path. When a registered file moves between `lib/effect-v3/` and `lib/effect/`, update its path in `CANONICAL_SOURCE_WRITE_OWNERS` and in the matching test expectations.

## Porting a Slice

1. Run `node scripts/effect-v4-codemod.mjs <files>` from `apps/webapp`. It rewrites the mechanical changes and prints `REVIEW` lines for the rest.
2. Resolve every `REVIEW` line by hand (the rules below).
3. Move each ported service out of `lib/effect-v3/` into `lib/effect/`, and add it to the v4 `AppLayer` in `lib/effect/runtime.ts`. Remove it from the v3 `AppLayer` once nothing on v3 uses it. Otherwise leave a frozen copy behind.
4. Move the slice's tests with it: `vi.mock` factories import `effect`, and stub services with `Context.Service<any>("Name")`.
5. Done when no file in the slice imports `effect-v3` or `lib/effect-v3`, and typecheck, `CI=true pnpm build`, `pnpm test` and `pnpm test:integration` all pass.

## v4 Rules That Change Behavior

- **Rejections:** `runPromise` rejects with the original error. v3 wrapped it in a `FiberFailure` with the same `message`, so it never passed `instanceof` checks. When porting `try { await Effect.runPromise(...) } catch`, check each `instanceof`, `name` and `_tag` test in the catch: v4 matches cases that v3 silently skipped.
- **Typed failures across a Promise boundary:** to read the typed failure, run with `runPromiseExit` and read the error with `Cause.findErrorOption` or `Cause.findDefect`, the way `lib/effect/result.ts` does. This replaces `Runtime.isFiberFailure` and `FiberFailureCauseId`.
- **Layer sharing:** `Effect.provide(layer)` reuses an already-built layer across calls by default. Keep per-request and per-transaction state out of layers: read the session inside service methods (as `AuthService.getSession` does), and pass transaction-scoped services with `Effect.provideService`. Use `Effect.provide(layer, { local: true })` when a layer must be rebuilt each time.
- **Schedules:** `Schedule.compose(a, b)` becomes `Schedule.max([a, b])`, which keeps v3's "continue while both continue, wait the longer delay" behavior.

## Services

Define services as `class X extends Context.Service<X, Shape>()("X") {}` and provide them with `Layer.succeed` or `Layer.effect`. `lib/effect/services/database.service.ts` is the canonical example. Server actions run their effect through `runServerActionSafe` in `lib/effect/result.ts`, which turns an `Exit` into `ServerActionResult`.
