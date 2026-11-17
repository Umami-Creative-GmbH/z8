# Next.js configuration and stack optimization for Z8

Assessed November 17, 2026, at source `b8a3e4a3209a23bae5b116ab3f0345bf4c8dd2b0` on `chore/optimize-nextjs-stack`. This is a research deliverable with one existing runtime regression replay. Application configuration and dependencies were not changed.

## Recommendation

Keep the current Next.js/React, Node/pnpm, PostgreSQL/Drizzle, Effect, Better Auth and BullMQ stack. Z8 already enables the main Next.js performance features and has implemented much of its earlier performance backlog. The next useful investment is reliable framework upgrades, verifiable navigation behavior, and deployment/build efficiency.

Address the reproduced stream-completion regression first. Then add deterministic navigation checks, optimize the clock UI's remaining read transport, and evaluate a traced standalone image. Treat config cleanup as maintenance; removing redundant settings is not a measured product speedup.

The accompanying [platform source memo](nextjs-platform-sources-2026-11.md) records release-tagged framework behavior and security/version caveats. Recommendations below combine those sources with current repository evidence. Impact describes the expected mechanism, not a measured improvement.

## Current baseline: preserve completed work

All three web apps pin Next.js **16.4.6** and React **19.3.1**. The [webapp config](../../apps/webapp/next.config.ts) enables Cache Components, Partial Prefetching, React Compiler and Turbopack, with next-intl and conditional PostHog sourcemap integration. [Marketing](../../apps/marketing/next.config.ts) also enables Cache Components; [docs](../../apps/docs/next.config.mjs) uses Fumadocs without that flag. These apps need separate performance decisions rather than an identical shared config.

Current code already contains:

- A server-seeded [organization context provider](../../apps/webapp/src/components/providers/organization-context-provider.tsx) and [render-local identity reuse](../../apps/webapp/src/lib/auth/render-context.ts).
- [Independently started Dashboard reads and streamed widgets](../../apps/webapp/src/components/dashboard/server-section-cards.tsx), plus independent [time-tracking regions](../../apps/webapp/src/app/[locale]/(app)/time-tracking/regions.tsx).
- [GET-based employee reads](../../apps/webapp/src/lib/query/use-employee.ts), server snapshot freshness, and [explicit refresh ownership](../../apps/webapp/src/components/providers/view-refresh-provider.tsx).
- [Consent-gated lazy product analytics](../../apps/webapp/src/components/posthog-provider.tsx), notification-list reads deferred until open, and lazy boundaries for calendars, exports, editors and optional widgets.
- Actual organization-scoped [recent analytics cache readers](../../apps/webapp/src/lib/analytics/recent-read.ts), fresh visibility/dependency revisions, and cached employee selectors.

The [October 24 review](../performance/2026-10-24-webapp-performance-review.md) is useful history but is no longer an accurate list of missing improvements. Newer [multi-instance cache evidence](../performance/1448-multi-instance-cache.md) and [ingress evidence](../performance/1448-ingress-streaming.md) supersede several of its open questions for the tested local topology. Their production and controlled-measurement limits still apply.

## Ranked work

| Order | Work | Product or operational benefit | Completion evidence |
| --- | --- | --- | --- |
| 1 | Restore stream-completion patch coverage on the active Next version | Avoid stranded request work after an aborted prefetch; preserve reliable telemetry and shutdown behavior | Existing installed-runtime regression passes; exact built image passes cancellation checks |
| 2 | Add deterministic instant-navigation contracts | Predictable loading feedback for employees, managers and admins | Useful shell appears while dynamic content is held back on direct and sibling navigation |
| 3 | Consolidate the clock UI's repeated compliance reads | Reduce queued read requests around the most frequent employee interaction | Request/query counts fall without weakening command-time checks or increasing clock latency |
| 4 | Trial standalone webapp packaging | Potentially smaller deployment artifacts and faster image transfer/startup | Real image smoke tests plus measured size/startup comparison |
| 5 | Make build caches and Turbo environment inputs deliberate | Faster repeat builds with correct artifacts | Verified cache reuse and environment-sensitive task hashes |
| 6 | Tune prefetching and bundle boundaries from evidence | Less speculative server work and unnecessary initial JavaScript | Per-route query/Flight/JS comparison, including mobile CPU |
| 7 | Simplify config and client-cache ownership incrementally | Easier upgrades and less duplicate invalidation logic | Equivalent behavior with focused checks; no unsupported speed claims |

### 1. Restore patch continuity before tuning

The apps use Next **16.4.6**, but [workspace patch registration](../../pnpm-workspace.yaml) targets only **16.4.3**. The older version remains in the dependency graph under `@react-email/ui`; its presence does not patch the webapp's newer runtime.

The maintained [patch](../../patches/next@16.4.3.patch) resolves the stream writer's completion promise on response close and checks `res.destroyed` after awaiting final work. The installed 16.4.6 CommonJS writer lacks both changes. The existing [regression](../../scripts/performance/next-stream-completion.test.mjs) exercises installed CommonJS and ESM function bodies with real local HTTP requests and actual Next/SDK tracing.

Replayed during this audit:

```powershell
pnpm --config.verifyDepsBeforeRun=false exec node --test scripts/performance/next-stream-completion.test.mjs
```

**Result: failed, 0 passed / 1 failed.** The assertion is `CommonJS/close-wait-abort: closed response must not strand the pipe` at line 203. This demonstrates the local installed-runtime failure; it does not measure production frequency or establish a production-wide outage. The test iterates both module formats but reports the first failed result, so this replay is not a separate passing/failing assessment of every format/mode.

Rebase the maintained correction onto the supported current version, regenerate the pnpm patch/lock registration, and replay the same test. Preserve final-work waiting and stream cancellation. Inspect the dependency graph before retiring the older patch. Add explicit version-upgrade coverage for this regression across package updates and the produced image. Keep both versions' historical evidence clearly separated. The [patch qualification record](../performance/1448-next-stream-completion.md) explains the original failure and acceptance boundaries.

### 2. Turn existing shells into tested product guarantees

Use the framework's `instant` contracts and `@next/playwright` helper to check time tracking, Dashboard, Team and employee settings, one route at a time. No explicit `instant`, `ensureStatic` or route `prefetch` exports, or `@next/playwright` usage, were found in the audited application sources. There are already [source-level route contracts](../../apps/webapp/src/app/[locale]/(app)/cache-components-route-contract.test.ts); extend the coverage with actual rendered behavior.

This does **not** mean navigation validation is disabled: the installed framework defaults already validate Page/Default segments in development. Explicit contracts document intent; held-dynamic tests supply regression protection. `instant` does not itself make a route fast, and its normal warning mode does not enforce a production build gate. [Official instant reference](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/instant).

Check both direct entry and navigation between siblings that reuse a layout. Assert a meaningful heading, navigation and labeled loading region before releasing dynamic work, then assert authorized final content. A skeleton passing this check says nothing about how quickly the clock becomes usable; retain separate usable-content and clock-command timing checks. Keep the existing [release-budget protocol](../performance/1448-release-budgets.md) intact.

Start with a narrow test dependency and test-only build configuration. The production-build testing API is an experimental opt-in for test artifacts, not a setting to enable unconditionally in shipped images. The [instant-navigation guide](https://nextjs.org/docs/app/guides/instant-navigation) describes the distinction between first loads and shared-layout transitions.

For marketing, evaluate `ensureStatic` as a guard against accidentally introducing request-time server rendering. Docs does not currently enable Cache Components; first inspect its generated static/dynamic output and Fumadocs requirements before proposing adoption. `ensureStatic` constrains server output; it does not prove client UI is immediately usable. [Official ensureStatic reference](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/ensureStatic).

### 3. Remove remaining clock read queues without caching command authority

[useComplianceStatus](../../apps/webapp/src/hooks/use-compliance-status.ts) has separate Server Action reads for rest period, full status, overtime, exceptions and active-session alerts. [The clock widget](../../apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx) enables this hook and periodic polling. Parallel-looking query hooks do not guarantee parallel requests: Next documents that Server Actions are queued and primarily intended for mutations. [Official backend-for-frontend guidance](https://nextjs.org/docs/app/guides/backend-for-frontend#server-actions).

Introduce a fresh, authorized display snapshot through a GET handler or a small set of independently owned GET reads. Reuse identity/context within that request; return only fields the visible widget needs. Preserve separate freshness rules where they matter, cancel superseded polling, and keep responses private/no-store. Measure whether the aggregate reduces total database work rather than merely combining HTTP calls.

Keep clock commands and exception requests on their mutation paths. Authorization, compliance enforcement and current clock state must be checked authoritatively at command time. A cached display snapshot is not permission to clock in. New business date/time work must use Temporal with explicit zones and preserve [event-local timekeeping](../refs/timekeeping.md).

Scope migrated query keys by actor and organization as well as the selected employee. Several legacy compliance keys use employee `"current"`; [current organization switching](../../apps/webapp/src/components/providers/organization-context-provider.tsx) and its consumers must be examined before implementing an in-place switch. Existing full-document organization switching limits current reuse; this audit did not demonstrate a cross-tenant disclosure.

### 4. Prototype a standalone image against Z8's real dependencies

The config and [deployment guide](../../deploy/README.md) state that standalone output is incompatible with Cache Components. That blanket statement is outdated: the **16.4.6 tagged suite** combines both in a production integration test. Its minimal-mode fixture is not Z8's exact deployment, so use it as evidence to investigate, not proof that changing one flag is sufficient. [Tagged standalone/PPR test](https://github.com/vercel/next.js/blob/v16.4.6/test/production/standalone-mode/required-server-files/required-server-files-ppr.test.ts).

The [webapp Dockerfile](../../docker/Dockerfile.webapp) currently installs a separate production dependency tree and copies full dependencies, source, scripts and migrations into the server image. Trial `output: "standalone"` together with monorepo tracing-root configuration and a matching runtime stage. Serve/copy `public` and `.next/static` explicitly, and start the emitted `server.js`. [Official standalone output reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

Smoke-test Sharp/native binaries on both supported architectures, Pino transports, OpenTelemetry, pg, Redis/BullMQ clients, TUS/uploads, email/PDF/Excel paths, translations, tenant/custom-domain routing, and next-intl/PostHog integration. Include missing-module and asset checks after deployment into a clean container. Keep workers, migrations and seed jobs in their existing images. Tracing fixes should include specific required files, rather than copying the whole repository back into the image.

Compare compressed image size, pull time, startup readiness and peak RSS. Standalone is primarily packaging; do not promise faster SQL or page rendering from it.

### 5. Separate three kinds of build caching

Z8 has Docker layer caching, BuildKit cache mounts, and Turbo task caching. They are different mechanisms.

- The Dockerfile mounts the pnpm store and `.next/cache`; image publishing exports architecture-scoped GHA build layers. Docker says **cache mounts are not preserved in GHA cache by default**. Establish explicit mount persistence or a persistent builder before expecting warm Turbopack compilations. [Docker cache-mount documentation](https://docs.docker.com/build/ci/github-actions/cache/#cache-mounts).
- `turbopackFileSystemCacheForBuild: false` intentionally disables a default-on cache in this Next version. Retain that choice until a bounded A/B run shows reuse, net wall-time benefit and acceptable memory/storage costs. Merely deleting the setting can restore work that CI will discard. [Next filesystem-cache reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache).
- Root [build orchestration](../../scripts/build.mjs) uses Turbo. Its [build environment list](../../turbo.json) currently names only the SCIM secret, while Next config consumes deployment identity and private PostHog build inputs. Declare output-affecting variables in task hashing, and separate credentials used only to authorize upload side effects. Ensure those side effects occur when required even on task-cache hits. Turbo already infers `NEXT_PUBLIC_*` for Next apps. Docker invokes Next directly, so this finding concerns the Turbo path separately. [Turbo environment documentation](https://turborepo.dev/docs/crafting-your-repository/using-environment-variables).

Preserve existing native amd64/arm64 builders, image/cache scopes, Server Actions key handling and CI resource controls. Do not introduce unlimited remote caches or tune thread counts without measuring peak resource use.

### 6. Use newer feature controls selectively

**Partial Prefetching:** already enabled. Default links prefetch a reusable App Shell; `prefetch={true}` additionally resolves per-link URL-dependent work. [NavMain](../../apps/webapp/src/components/nav-main.tsx) currently uses default links. Test fuller prefetch only for frequent, cheap destinations where the extra reads pay off. Do not apply it to every employee/report link. Measure prefetch SQL, abandoned work and Flight bytes alongside navigation readiness. [Official partialPrefetching reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching).

**`navigation()` / `prefetch()`:** shipped in 16.4, these defer reusable subtree work to navigation or per-link prefetch without necessarily losing cacheability. They are candidates when a reusable expensive report read is introduced behind a useful shell. They do not improve initial hard loads. Payroll already [calls `connection()`](../../apps/webapp/src/app/[locale]/(app)/payroll/page.tsx) for its current period and request-time work; that is an intentional reviewed boundary. Do not replace it mechanically to obtain more prefetching, or freeze the current month during build. [Official navigation reference](https://nextjs.org/docs/app/api-reference/functions/navigation), [prefetch reference](https://nextjs.org/docs/app/api-reference/functions/prefetch).

**Turbopack bundle analysis:** use the installed `next analyze --output --snapshot <name>` and `next analyze export` on an operator-configured build to find actual import chains by route. This is a better next step than adding more guessed package-import settings. Analyze root/provider cost and route-specific editors, uploads, charts and workflows; many already have lazy boundaries. No new custom font is warranted to remove a font waterfall that does not exist. Marketing already uses `next/image`; focus image work on measured LCP and responsive sizes. [Official bundle-analysis guide](https://nextjs.org/docs/app/guides/package-bundling).

**Cache invalidation:** recent analytics already combines organization tags with fresh authorization and committed revision identities. Keep that design. For future tagged interactive caches, choose `updateTag` in Server Actions when the next read must wait for committed data; choose `revalidateTag(tag, "max")` only where stale-while-revalidate is acceptable. Route Handlers needing blocking expiry can use `{ expire: 0 }`. `router.refresh()` alone does not expire server data. Check reader/tag correspondence before changing writers: the legacy [query-cache helpers](../../apps/webapp/src/lib/cache/query-cache.ts) have no production callers found in this audit, so migrating them alone would not improve a user flow. [updateTag](https://nextjs.org/docs/app/api-reference/functions/updateTag), [revalidateTag](https://nextjs.org/docs/app/api-reference/functions/revalidateTag), [router.refresh](https://nextjs.org/docs/app/api-reference/functions/use-router#userouter).

## Config disposition for 16.4.6

These are recommendations for a later implementation change, not a replacement config to paste over the current one.

| Setting | Decision | Reason |
| --- | --- | --- |
| `cacheComponents`, `partialPrefetching`, `reactCompiler` | Keep | Already central to current rendering; test effectiveness route by route |
| `deploymentId`, build hash, UTC initialization | Keep | Preserve deployment-skew handling, release identity and server boundary behavior |
| next-intl, PostHog wrapper/rewrites | Keep; smoke-test when packaging changes | Application integrations, not generic config noise |
| `turbopack.root` | Keep | Explicit workspace boundary in a monorepo |
| `output` | Trial standalone with its Docker change | Correct outdated incompatibility rationale after qualification |
| `experimental.workerThreads: true` | Keep pending targeted verification | Deliberate IPC/string-limit workaround; different from Turbopack plugin-runtime worker selection |
| `experimental.turbopackFileSystemCacheForBuild: false` | Keep until build-cache experiment | Intentional memory/persistence tradeoff |
| `experimental.useTypeScriptCli: true` | Optional cleanup | Same as tagged default; removal is not a type-checking or runtime optimization |
| Tabler/Recharts `optimizePackageImports` entries | Optional cleanup | Both already in the framework's merged default set |
| `images.unoptimized: false` | Optional cleanup | Default value; does not identify image bottlenecks |
| `experimental.agentUpgrade: "latest"` | Treat as upgrade-policy choice | A reminder policy, not runtime acceleration |
| `serverExternalPackages` | Review by dependency when packaging changes | Several are framework defaults; native loading and trace correctness still matter |

Config defaults and feature status were checked against installed 16.4.6 and [tagged configuration](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/config-shared.ts), [merged import defaults](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/config.ts), and [external-package defaults](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/lib/server-external-packages.jsonc). Framework defaults can change; preserving an explicit value with a reason is reasonable. Do not broadly remove settings because they appear experimental.

## Stack decisions and boundaries

**Retain revision-keyed process-memory caching for current analytics.** The newer two-replica experiment passed mutation, permission reduction, concurrency, expiry, outage and restart stages with fresh authorization before lookup. Its [recorded decision](../performance/1448-multi-instance-cache.md#backend-and-resource-decision) explicitly retains memory. Production topology, capacity and different-version rollout remain open. This evidence does not justify a custom Redis cache handler today.

If a future workload does need a shared backend, singular `cacheHandler` covers incremental/ISR/fetch storage while plural `cacheHandlers` covers directive caches; they have different contracts. A Redis client for jobs/auth does not implement either. Coordinate value storage and tag expiration for the chosen system. [Official cacheHandlers reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers).

**Keep Node and pnpm.** The [November 16 Bun assessment](../refs/bun-adoption.md) identifies worker-preload and Node/V8 evidence-tool blockers. The marketing image's separate Bun 1.3.11 runtime should be reconciled with the supported baseline as its own packaging decision. There is no demonstrated product benefit from a wholesale runtime migration, an Edge rewrite of Node-dependent services, or replacing the existing queue.

**Converge client server-state ownership gradually on TanStack Query.** SWR still serves scheduled-export/job-status families, and the global refresh provider supports both. Migrate those families when touched to simplify invalidation and identity scoping; measure bundles before claiming savings. Keep Zustand for genuine client state and TanStack Form for forms.

**Keep durable background work in BullMQ.** Next's `after()` can defer short noncritical telemetry, but it is response-lifetime work and may also run during prerendering. It does not replace durable exports, approval delivery, audit persistence or after-commit job scheduling. [Official after reference](https://nextjs.org/docs/app/api-reference/functions/after).

**Preserve deployment freshness and transport correctness.** Existing deployment-ID and user refresh/skew handling are useful for long-lived employee sessions; keep them during packaging changes. Production CDN/proxy streaming remains unverified despite local ingress tests. Also include export/download smoke tests on 16.4.6: its [response implementation](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/send-response.ts) filters handler-supplied framing headers, and the [travel-expense export handler](../../apps/webapp/src/app/api/travel-expenses/exports/[batchId]/route.ts) supplies a length. User-visible impact needs a real image/proxy reproduction. [Official self-hosting guidance](https://nextjs.org/docs/app/guides/self-hosting).

Defer experimental compiler/runtime switches and decorative transition work until a measured bottleneck or product interaction justifies them. Do not add a shared CDN cache around authenticated responses or extend auth/clock lifetimes to improve apparent hit rates.

## Suggested implementation sequence and validation

1. Repair patch/version continuity as an isolated ticket and commit. Require the installed-runtime regression and built-image cancellation proof.
2. Add held-dynamic navigation tests for one high-frequency route, then migrate the remaining clock compliance display reads with scoped keys and focused authorization/freshness checks.
3. Prototype standalone packaging independently, including architecture/native dependency and export/upload smoke tests. Keep the current image available for rollback until qualification.
4. Correct Turbo build inputs and run a bounded cache-persistence experiment. Compare cold/warm wall time, peak memory, storage and artifact identity.
5. Use bundle snapshots and prefetch traces to choose the next route-level change. Extend successful patterns gradually; retain current cache and ingress acceptance boundaries.

For runtime comparisons, use the same source-qualified build, runtime, representative organization sizes, role visibility and time ranges. Track useful shell and usable-content readiness separately; include clock-command outcomes under report load, SQL calls/rows, pool waits, pending work, settled JS/Flight bytes, CPU and memory. Reuse the existing performance apparatus and prospective budgets rather than introducing a second benchmark framework or relabeling historical failures.

The research did not run a production build, database integration suites, browser journeys, image builds, bundle analysis, or production benchmarks. Phase-managed runtime variables are unavailable to agents. The one new runtime check was the local stream regression above. No latency percentage, image-size saving or build-time gain is claimed. The source-research setup also encountered a PostHog installer failure; manifests and lockfile stayed unchanged. Both research documents were checked for local link targets and patch whitespace errors.
