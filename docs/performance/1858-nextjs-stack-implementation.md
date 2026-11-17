# Next.js stack implementation (#1858)

Implemented November 17, 2026, on `feature/1858-nextjs-stack-optimization`, from
`b8a3e4a3209a23bae5b116ab3f0345bf4c8dd2b0`.

The [research report](../research/2026-11-17-nextjs-stack-optimization.md) supplied
the scope. This record describes implementation and verification, not controlled
performance acceptance or deployment authorization.

## Implemented

- Rebased the maintained stream-completion correction onto Next 16.4.6 through
  pnpm's patch workflow. Retained the 16.4.3 patch for its transitive dependency
  and left historical performance fingerprints unchanged. Added the `Next
  runtime` workflow for dependency/config updates into `dev` and `main`.
- Kept Cache Components, Partial Prefetching, React Compiler, UTC initialization,
  deployment identity and existing integrations. Removed redundant TypeScript
  CLI, package-import and image defaults. Prerender concurrency is bounded to
  four workers, respecting smaller CPU allocations, rather than scaling to every
  CPU on a large host. The existing thread-based IPC workaround remains.
- Added explicit instant-navigation contracts for Dashboard, Time Tracking, Team
  and employee settings, stable shell/content markers and local loading
  boundaries. Preserved the authenticated hard-load gate. Added 16 desktop/mobile
  held-dynamic Playwright checks, an isolated test artifact, a dedicated typecheck
  and an operator rig. Shipping config excludes the testing API; only the explicit
  test mode selects `.next-instant-nav` and a normal `next start` output.
- Replaced repeated clock compliance display actions with a private, no-store
  cancellable GET snapshot. Idle mode reads rest status and exceptions; active
  mode reads alerts. Removed unused full-status/overtime reads. Fresh admission,
  expected-scope checks, actor/organization/employee/mode query keys and
  mode-transition rereads preserve display isolation and fresh rest boundaries.
  Command-time authorization/enforcement and exception mutations remain intact.
- Migrated job polling, scheduled exports and owner candidates to TanStack Query.
  Removed SWR and its global invalidation path. Preserved single/batch request
  deduplication, polling, terminal callbacks, optimistic rollback and refresh
  ownership, with actor/organization-scoped keys.
- Implemented standalone webapp packaging using the emitted monorepo server,
  explicit public/static assets and static Pino transport resolution. Image
  assembly checks dependency/asset containment, critical external dependencies
  and target-platform Sharp encoding. Workers/migrations remain separate.
  Marketing now starts Next with Node rather than Bun.
- Added output-affecting Turbo environment inputs and isolated test output
  caching. Sourcemap-upload builds force execution so a cached task cannot skip
  upload side effects. Upload credentials are passthrough inputs, not public
  configuration. Explicit pnpm store paths match Docker cache mounts.
- Added opt-in, architecture-scoped BuildKit cache-mount restore/export with a
  512 MiB upload cap. Kept the compilation-cache opt-out until reuse, wall time
  and memory are measured. The cap limits uploads, not temporary export disk use.
- Added named Turbopack bundle capture/export scripts to webapp, marketing and
  docs. Marketing now enables Partial Prefetching and guards its home page with
  `ensureStatic = "navigation"`.
- Excluded navigation artifacts, private browser authentication state and browser
  reports from Git and all Docker build contexts.

## Verification

| Check | Result |
| --- | --- |
| Installed-runtime stream regression before/after patch | Failed before; passes after, using actual CJS/ESM runtime, HTTP and SDK tracing |
| Runtime/config checks | 2 passed; shipping/testing isolation and bounded workers validated |
| Combined affected application suites | 290 passed across 12 files |
| Delivery/build/cache/manifest checks | 45 passed in the authoritative serial replay |
| CI workflow/scope checks | 25 passed |
| Publishing workflow contracts | Webapp/worker/migration and marketing verifiers passed |
| Production source/workflow-contract/smoke TypeScript | Full `pnpm --filter webapp typecheck` passed |
| Navigation test tooling | 16 tests listed; dedicated typecheck passed; browser execution not performed |
| Marketing production build | Passed with Cache Components, Partial Prefetching and static guard; `/en` and `/de` static |
| Frozen offline dependency installation | Passed; manifests and lockfile synchronized |
| Focused lint / React Doctor | No errors; unchanged unused destructuring warning and reviewed terminal-callback lifecycle warning retained |
| Standalone Linux image qualification | Attempted; incomplete due to local Docker failure described below |

The first simultaneous parent/child delivery-suite replay raced its intentional
migration-manifest mutation/restore tests and failed one check. The task-owned
fixture mutation was restored through the manifest generator. The subsequent
single authoritative replay passed all 45 checks. No unrelated target-manifest
content change is part of this implementation.

React Doctor initially identified an unsupported dependent default expression in
the new hook. Moving that expression out of destructuring removed the compiler
error; the final scan has zero errors and two reviewed warnings. No diagnostic
configuration or suppression was added.

## Incomplete runtime qualification

The first image command used the machine's selected Kiri builder, whose named
pipe was absent. An explicit Docker Desktop builder then installed dependencies,
compiled the app successfully and passed its build-time TypeScript check. It
entered prerendering 3,381 pages with the existing default allocation of 31
workers and stopped reporting progress. A diagnostic Docker API call later
returned HTTP 500. Only this task's matching build/diagnostic client processes
were stopped; the user's builder selection was not changed and Docker was not
restarted.

This establishes an incomplete local build, not a proven out-of-memory diagnosis
or a defect in standalone tracing. The bounded-worker config was added afterward
and passed config checks; a full final-image retry and artifact/native smoke
validation remain necessary on an available builder. The earlier partial build
is not exact-final-source qualification. No completed image-size/startup
comparison or amd64/arm64 qualification is claimed.

Authenticated application journeys, held-dynamic positive/negative controls,
production topology/CDN checks and controlled latency/query/resource comparisons
require Phase-managed runtime configuration and an approved test account. Those
were unavailable and were not run. GHA cache reuse/storage measurements were not
run. Use the documented opt-in workflow and
[navigation rig](../../apps/webapp/e2e/instant-navigation/instant-nav.rig.md) for
those checks.

Default shared-navigation prefetch behavior and the analytics process-memory
backend remain unchanged. Selective fuller prefetch, further bundle splitting
and filesystem-cache enablement require measured evidence; enabling them
globally would contradict the research recommendation. The new tooling makes
those experiments runnable without weakening the existing
[release-budget gates](1448-release-budgets.md).

## Useful commands

```powershell
pnpm test:next-runtime
pnpm test:delivery
pnpm --filter webapp typecheck
pnpm --filter webapp typecheck:navigation
pnpm --filter webapp test:navigation --list
pnpm --filter marketing exec next build # set CI=true first
```

The [optimization tools reference](../refs/nextjs-optimization.md) describes
bundle snapshots, upgrade checks and conservative prefetch decisions. No latency
percentage, image saving or build-speed improvement is asserted by this record.
