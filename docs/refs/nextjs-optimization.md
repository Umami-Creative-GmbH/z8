# Next.js optimization tools

Z8 uses Cache Components, Partial Prefetching, React Compiler and Turbopack. Keep
fresh authorization and live clock commands outside shared display caches. The
[November assessment](../research/2026-11-17-nextjs-stack-optimization.md) records
the rationale, earlier work and the limits of historical evidence.
The [implementation record](../performance/1858-nextjs-stack-implementation.md)
tracks changes, passing checks and remaining image/runtime qualification.

## Framework upgrades

Next 16.4.6 carries the maintained stream-completion patch in
`patches/next@16.4.6.patch`. It waits for final work but also completes naturally
when a client disconnects. The workspace now resolves only 16.4.6.

After any framework, patch or lockfile update, run:

```powershell
pnpm exec node --test scripts/performance/next-stream-completion.test.mjs
```

The `Next runtime` workflow repeats this against freshly installed dependencies
on PRs into `dev` and `main`. A future upstream fix can replace the maintained
patch after the same behavior passes without it. Keep historical performance
fingerprints unchanged; an upgraded runtime needs new source-qualified evidence.

## Bundle snapshots

Use the same configured checkout, runtime and build environment for before and
after snapshots. These commands write analysis without opening a server:

```powershell
pnpm --filter webapp analyze:bundle --snapshot before-1858
pnpm --filter webapp analyze:bundle:export --snapshot before-1858
```

The export emits JSON Lines on stdout. Redirect the underlying CLI when saving a
machine-readable graph, so pnpm's script banner is excluded:

```powershell
pnpm --filter webapp exec next analyze export --snapshot before-1858 > before-1858.jsonl
```

Both scripts also exist in `marketing` and `docs`. Give each new capture a unique
snapshot name: Next replaces an existing snapshot with the same name. Analysis is
stored under the selected app's `.next/diagnostics/analyze`. Keep generated
artifacts out of Git and inspect them before sharing; import graphs include file
paths. Do not run a capture against another operator's in-progress artifacts.

Filter by route/client/server and trace import chains before changing lazy
boundaries. Smaller dependencies in a manifest are not proof of smaller initial
JavaScript. Preserve role visibility, cold/warm conditions and settled resource
observation when measuring a change. The existing
[performance release gates](../performance/1448-release-budgets.md) remain the
acceptance protocol.

## Prefetch decisions

Retain default shell prefetching on the shared navigation. Use per-link
`prefetch={true}` only when a route's measured reuse justifies its URL-specific
work. The current payroll `connection()` boundary resolves a request-local
period; it must not be replaced with a reusable build-time month.

For a new reusable expensive subtree, `navigation()` can preserve caching while
deferring work until navigation. It does not speed up hard loads. Put it outside
cached functions and inside a useful Suspense boundary. Never extend auth,
permission or clock-state lifetimes to make prefetch results look faster.
