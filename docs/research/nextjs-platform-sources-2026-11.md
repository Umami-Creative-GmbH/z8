# Next.js platform source memo for Z8

Researched: **2026-11-17**. Target: **Next.js 16.4.6 / React 19.3.1**, self-hosted App Router, multi-tenant workforce SaaS.

This is background research for a separate implementation audit. Repository configuration and dependency pins below are supplied context, not findings from inspecting Z8 application code. Only this memo was written; no builds, dependency updates, tracker changes, or agents were used. Official documentation and release announcements were browsed; implementation details were checked against the **`v16.4.6` tag**, rather than assuming `canary` describes the installed release. All source excerpts below are paraphrased.

## 1. Version baseline and source reliability

- The official release page identifies **16.4.6**, released **November 9, 2026**, as the latest stable release observed. It explicitly describes a backport release and warns that pending canary work is not included. Its changes include Route Handler compression and development Turbopack GC fixes. [16.4.6 release](https://github.com/vercel/next.js/releases/tag/v16.4.6)
- The tagged package manifest is version 16.4.6, accepts React and React DOM `^19.0.0` among its peer ranges, and requires Node `>=20.9.0`. React 19.3.1 therefore satisfies its peer dependency range. Next.js 16.4's announcement explicitly describes React 19.3 support. This establishes compatibility intent, not independent verification of every React 19.3.1 dependency or security property. [Tagged package manifest](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/package.json), [16.4 announcement](https://nextjs.org/blog/next-16-4#react-193)
- Public docs currently display **Latest v16.4.6**, but remain rolling documents. The old Cache Components getting-started URL now redirects to the caching guide. Older articles can still describe pre-16.3 defaults, beta names, or the previous caching model. Where behavior matters, use the release-tagged implementation/docs linked here. In particular, the tagged docs confirm both private caching and the `instant` testing API discussed below. [Current caching guide](https://nextjs.org/docs/app/getting-started/caching), [tagged private-cache reference](https://github.com/vercel/next.js/blob/v16.4.6/docs/01-app/03-api-reference/01-directives/use-cache-private.mdx), [tagged instant reference](https://github.com/vercel/next.js/blob/v16.4.6/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.mdx)

**Interpretation for the parent audit:** the supplied webapp already enables the principal shipped programming-model features. Its opportunity is likely how routes use them, how mutations invalidate them, and how deployment infrastructure supports them. Enabling additional flags is not evidence of faster or safer behavior.

## 2. Cache Components, instant navigation, and Partial Prefetching

### Shipped capabilities

`cacheComponents: true` enables explicit component/function caching and partial prerendering: an initial HTML shell can render before request-dependent content finishes. It requires Node.js; the current reference says to remove route-level `runtime` exports, even `runtime = 'nodejs'`. It is not limited to Vercel hosting. [Cache Components configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents), [self-hosting support](https://nextjs.org/docs/app/guides/self-hosting#cache-components)

`partialPrefetching: true` is a separate top-level option, introduced in **16.3.0**, and requires Cache Components. Omitting it preserves older behavior and now warns; keeping both flags explicit is meaningful for an existing app. A route's explicit segment `prefetch` export can override the app default. [Partial Prefetching reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching), [tagged validation](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/config.ts#L651)

With Partial Prefetching, distinguish three stages:

| Stage | Official behavior | Z8 applicability, inferred |
| --- | --- | --- |
| Default `<Link>` | Prefetches a reusable App Shell for the route pattern. It excludes URL-specific data; session-dependent shells are cached per session in the client. | Useful for many employee/detail/report links without doing full work for every URL. |
| `<Link prefetch={true}>` | Also resolves the selected link's URL data and eligible cached content. | Consider for frequent destinations where the extra prefetch work pays off. |
| Navigation | Resolves the remaining dynamic content. | Current time records and authorization can still be read from their authoritative sources. |

These are distinct from a globally shared HTML shell. An App Shell containing session UI is not permission to put that response in a public CDN cache. [Partial Prefetching resolution](https://nextjs.org/docs/app/api-reference/config/next-config-js/partialPrefetching#how-prefetches-resolve), [optimizing prefetching](https://nextjs.org/docs/app/guides/optimizing-prefetching)

The **16.4** APIs `prefetch()` and `navigation()`, imported from `next/cache`, defer runtime work to a later navigation stage while preserving cacheability. The former skips App Shell rendering; the latter also skips runtime per-link prefetches. They belong above the deferred work, inside a subtree with Suspense, and outside cached scopes. They do not change the initial page load; static prerenders can still contain that content. These are shipped names replacing earlier canary `unstable_` spellings, also exported by 16.4.6 itself. [prefetch reference](https://nextjs.org/docs/app/api-reference/functions/prefetch), [navigation reference](https://nextjs.org/docs/app/api-reference/functions/navigation), [tagged exports](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/cache.js), [tagged stage implementation](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/request/cache-stages.ts)

**Potential use, not an implementation recommendation yet:** expensive payroll/report preparation could wait for navigation while filters, headings, and loading feedback are prefetched. Frequent small organization-scoped reads might justify prefetching. That choice needs query cost, freshness requirements, and actual usage data.

### What instant navigation guarantees

The official guide defines instant navigation as rendering useful static/cached/fallback UI immediately while remaining content streams. It assumes warm caches. A cold fill can still wait. Hard loads and soft navigation exercise different Suspense boundaries: a boundary above a shared layout may cover a direct visit but not navigation between sibling pages. [Instant navigation guide](https://nextjs.org/docs/app/guides/instant-navigation#what-instant-means)

The `instant` route export stabilized in **16.3.0**. It validates expected behavior; it does not make a route instant by declaration. The normal warning level reports development diagnostics, not a production-build guarantee. `instant = false` permits blocking and opts out of validation; setting it at the root also disables the static-shell check broadly. The underlying `experimental.instantInsights` settings remain experimental despite the stable export. [instant reference](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/instant)

`ensureStatic`, introduced in **16.4.0**, enforces a different property. Its `shell`, `prefetch`, and `navigation` levels progressively require server-rendered stages to remain static. A static route can still have client-side work that blocks visible navigation. This is potentially useful for marketing/docs and selected webapp shells; requiring an entire authenticated workforce route to be static needs a specific design reason. [ensureStatic reference](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/ensureStatic), [tagged reference](https://github.com/vercel/next.js/blob/v16.4.6/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/ensureStatic.mdx)

Official tooling includes the Navigation Inspector and `@next/playwright`'s `instant()` helper, which holds dynamic content back while assertions inspect the initial UI. The **16.4.6 tagged docs** already describe `experimental.exposeTestingApiInProductionBuild` for a production *test* build; this is not merely a later canary suggestion. Tooling still has a documented shared-domain testing-cookie issue, pertinent when running webapp, marketing, and docs on different localhost ports. Clear the testing cookie or close the inspector between projects. [Tagged instant tooling and known issue](https://github.com/vercel/next.js/blob/v16.4.6/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.mdx#testing-instant-navigation)

## 3. Authentication and safe organization caching

### Official mechanisms

Plain `use cache` cannot read request APIs such as `cookies()` or `headers()`, including indirectly through helpers. Read those outside and pass suitable values in. Serialized arguments and captured outer variables participate in cache identity. Entries normally use process-local memory, reusable across requests on a persistent self-hosted server, but not automatically shared with other processes. [use cache reference](https://nextjs.org/docs/app/api-reference/directives/use-cache#cache-keys), [runtime caching considerations](https://nextjs.org/docs/app/api-reference/directives/use-cache#runtime-caching-considerations)

React `cache()` is a separate mechanism: the official auth guide uses it to deduplicate session verification during a React render pass. It does not provide persistent cross-request auth caching, and its wrapper does not deduplicate calls made outside rendering in Server Actions or Route Handlers. Authorization still belongs close to data access and mutations. [Authentication DAL guidance](https://nextjs.org/docs/app/guides/authentication#creating-a-data-access-layer-dal)

The current auth-with-Cache-Components guide separates resolving the session from cached data derived from that session. Its public getter resolves the user and calls an unexported cache function keyed by a stable user ID. It warns that cache arguments/captured values and tags can be stored in plaintext; tokens and sensitive personal data do not belong there. Every action and Route Handler verifies authorization independently. [Authentication with Cache Components](https://nextjs.org/docs/app/guides/authentication-with-cache-components#step-4-cache-session-derived-data)

`use cache: private` is available under Cache Components in the **16.4.6 tagged reference**, without a separate experimental opt-in. Do not repeat older claims that it always requires an experimental private-cache flag. It allows request APIs and browser reuse, but **does not retain server results across production requests**. Production calls can deduplicate within one request; development additionally has request-keyed in-memory reuse, so development behavior is not a persistence benchmark. It is excluded from the static shell and has no configurable server handler. [Private-cache reference](https://nextjs.org/docs/app/api-reference/directives/use-cache-private), [tagged reference](https://github.com/vercel/next.js/blob/v16.4.6/docs/01-app/03-api-reference/01-directives/use-cache-private.mdx)

### Z8 implications, inferred from those mechanisms and repository rules

1. Resolve the authenticated actor, active organization, current membership, and applicable permissions before serving protected data. Keep that check outside a shared cached body: a cache hit may bypass the body's authorization code.
2. Shared data caches need `organizationId` in both cache identity **and the database predicate**. Add actor ID or an explicit visibility/permission dimension whenever two members of one organization may see different results. An organization-only key is insufficient for manager-scoped employee data.
3. Tags such as `org:<id>:time-records` or `org:<id>:employee:<id>` scope invalidation; they do not partition cache identity or enforce permissions. Keep cache keys and invalidation tags conceptually separate.
4. Permission removal, employee visibility changes, logout, and active-organization switching need explicit treatment of browser state as well as server entries. Do not infer that passing `organizationId` or refreshing a page makes a cached authorization decision safe indefinitely.
5. Avoid shared server caching of live clock state or authorization decisions unless the audit establishes a precise lifetime and invalidation contract. Stable organization settings and expensive aggregates are better candidates for evaluation. Preserve event-local timekeeping semantics in any cached report key; framework caching supplies no timezone/business-boundary correctness.

These are design constraints for the parent audit, not claims that Z8 currently violates them. The framework does not automatically enforce Z8 organization membership or RBAC.

## 4. Choosing invalidation after a mutation

| API | Official semantics | Likely Z8 use, inferred |
| --- | --- | --- |
| `updateTag(tag)` | Server Actions only; expires tagged entries immediately so the next read waits for fresh data. | Interactive edits where the actor must see the committed change, including approvals and settings. |
| `revalidateTag(tag, 'max')` | Server Actions or Route Handlers; marks stale and lets a later read trigger background regeneration while stale content is usable. | Content/aggregates where temporary staleness is explicitly acceptable. |
| `revalidateTag(tag, { expire: 0 })` | Blocking invalidation on the next read, available when `updateTag` cannot be used. | Authorized webhooks or API/import handlers requiring immediate server-cache expiry. |
| `refresh()` from `next/cache` | Server Action client refresh for dynamic/uncached output; does not expire server cached data. | Reread an uncached count/status after an action. |
| `router.refresh()` | Client-side route request and RSC merge, preserving unaffected client state; does not invalidate the server cache. | Refresh displayed output after the appropriate server-side invalidation, or reread uncached output. |

Sources: [updateTag](https://nextjs.org/docs/app/api-reference/functions/updateTag), [revalidateTag](https://nextjs.org/docs/app/api-reference/functions/revalidateTag), [refresh](https://nextjs.org/docs/app/api-reference/functions/refresh), [router.refresh](https://nextjs.org/docs/app/api-reference/functions/use-router#userouter), [tagged implementation](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/web/spec-extension/revalidate.ts).

The one-argument `revalidateTag(tag)` form is deprecated. In the tagged implementation it warns, and the TypeScript signature requires the second argument. Revalidation is demand-driven, not an eager rebuild of all matching pages. A refresh alone can return the same cached result. [revalidateTag behavior](https://nextjs.org/docs/app/api-reference/functions/revalidateTag#revalidation-behavior), [tagged implementation](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/web/spec-extension/revalidate.ts)

For correctness-sensitive mutations, expire the relevant tags **after the transaction succeeds**, including dependent summaries. Tags must already have been attached to the reads. Neither expiry nor client refresh is a cross-browser realtime transport; another employee's open screen needs an application update mechanism. These are application-level consequences, not guarantees supplied by `updateTag`.

`unstable_cache` remains an explicitly unstable legacy API. Current docs prefer `use cache` for most work, but note a real distinction: `unstable_cache`/the fetch cache can persist across deployments, whereas `use cache` and remote variant keys include build/deployment identity. Do not replace it mechanically if that persistence matters, and do not nest a public `use cache` function inside it. [unstable_cache reference](https://nextjs.org/docs/app/api-reference/functions/unstable_cache), [November nesting advisory](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h)

## 5. Standalone and self-hosted cache infrastructure

### Standalone compatibility

**A blanket statement that standalone output is incompatible with Cache Components is contradicted by upstream evidence.** The 16.4.6 test suite configures `cacheComponents: true` and `output: 'standalone'`, then starts the generated server. This particular test also modifies it for minimal mode, so it is evidence of supported integration coverage, not a reproduction of Z8's exact deployment. Tagged build tracing explicitly includes custom `cacheHandler` and `cacheHandlers` dependencies. [Tagged standalone/PPR test](https://github.com/vercel/next.js/blob/v16.4.6/test/production/standalone-mode/required-server-files/required-server-files-ppr.test.ts#L55), [tagged tracing](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/build/collect-build-traces.ts#L146)

The official output reference describes standalone as deployment packaging, including a generated `server.js` and traced dependencies. It omits `public` and `.next/static` unless separately copied/served; monorepos may require `outputFileTracingRoot` and targeted includes for runtime assets. Windows junction fallback can produce non-relocatable output. Therefore, evaluating standalone for Z8 requires a deployment-image smoke test covering its native libraries, external packages, wrappers, workers, and locale/runtime assets. No such test was performed here. [Standalone output and caveats](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)

An additional tagged-source limit: `supportsImmutableAssets` is disabled for standalone because it currently uses a non-adapter path. Do not infer that every adapter-specific asset strategy is available merely because standalone and Cache Components coexist. [Tagged configuration finalization](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/config.ts#L1847)

### Two different cache extension points

| Extension | What it covers | Deployment consequence |
| --- | --- | --- |
| Singular `cacheHandler` | Incremental server cache: generated route/ISR and fetch-cache entries. | Shared durable storage and compatible entry serialization are needed when coordinating those entries across replicas. |
| Plural `cacheHandlers` | `use cache`, `use cache: remote`, and named directive backends. | A separate interface and invalidation design; configuring the singular handler does not automatically replace these caches. |
| `use cache: private` | No configurable server backend. | Browser/request behavior; it cannot be turned into a shared Redis cache through these options. |

Official references distinguish these interfaces explicitly. Both directive handler kinds default to in-memory LRU unless configured; the word `remote` alone does not create shared storage on a self-hosted deployment. [Self-hosting cache configuration](https://nextjs.org/docs/app/guides/self-hosting#configuring-caching), [cacheHandlers reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers#handler-types)

A shared value store alone is insufficient. The 16.4.6 directive handler contract includes `get`, `set`, `refreshTags`, `getExpiration`, and `updateTags(tags, durations?)`. Preserve invalidation duration semantics, synchronize tags across instances before relevant reads, bound storage, handle failures, and return a fresh stream for each hit. Retaining the original stream/pending promise can retain request memory. [Tagged CacheHandler interface](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/lib/cache-handlers/types.ts), [distributed tag coordination](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers#distributed-tag-coordination)

The compiler's filesystem cache is a third, separate concern: `.next/cache/turbopack` is not an organization data cache or an invalidation bus. [Filesystem cache reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache)

### Deployment identity, streaming, and CDN behavior

For multiple instances, use the same built artifact, coordinate the Server Action encryption key, and support streaming through every proxy/load-balancer hop. Buffered responses remove PPR's early-shell benefit. Dynamic responses must retain private/no-store behavior rather than being placed in a publicly shared cache; RSC/CDN variants need their framework headers respected. [Self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting#multi-server-deployments), [streaming guidance](https://nextjs.org/docs/app/guides/self-hosting#streaming-and-suspense)

`deploymentId` is stable and identifies an artifact/deployment, not an organization. It adds asset cache-busting parameters and navigation identity headers, and affects `use cache` identity. Mismatches cause a hard navigation. **Next.js does not route incoming `?dpl=` requests to the corresponding deployment.** Version-aware routing/asset retention remains the host's responsibility; replicas of the same deployment should agree on the ID. For Z8, rolling-deployment reloads also need evaluation against unsaved time-entry forms and local state. [deploymentId reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/deploymentId)

## 6. Configuration defaults and experimental boundaries

These are research conclusions against the supplied config, not requested edits.

| Supplied setting | Status/default at 16.4.6 | Assessment |
| --- | --- | --- |
| `cacheComponents: true` | Shipped top-level feature; tagged generic config default is false. New recommended app templates enable it. | Meaningful explicit opt-in in an existing app. |
| `partialPrefetching: true` | Shipped top-level feature; unset keeps the older behavior and warns with Cache Components. | Meaningful, complementary setting. |
| `reactCompiler: true` | Stable integration since 16.0; opt-in. Standard integration uses the Babel compiler plugin. | Meaningful; separate from experimental Rust React Compiler. |
| Turbopack | Stable/default for dev and build since 16.0. | No extra enable flag needed on the normal path. Wrappers with webpack-specific behavior still need testing. |
| `experimental.useTypeScriptCli: true` | **Already true by default** in tagged config. Still exposed as experimental. | Redundant value; setting it does not disable type checking. |
| `experimental.turbopackFileSystemCacheForBuild: false` | Default **true** since 16.3; dev cache default true since 16.1. | Intentional opt-out, not a redundant false. Sensible when build cache is never restored; otherwise investigate lost warm-build benefit. |
| `experimental.optimizePackageImports: ['@tabler/icons-react', 'recharts']` | Both included in the framework's default merged set. API still explicitly experimental. | Those entries are redundant for this version. They are deduplicated rather than disabling the framework's list. |
| `experimental.workerThreads: true` | Tagged default false; used to enable worker threads for build static-worker execution. | Real experimental opt-in. No universal performance benefit established here. |
| `experimental.agentUpgrade: 'latest'` | Added in 16.4; default policy is `security`. | Different reminder/upgrade policy, not runtime optimization or automatic dependency upgrading. |
| `serverExternalPackages` | Stable top-level API; framework already externalizes selected Node packages. | Review duplicates against the tagged list; retain additions with demonstrated runtime/bundling needs. |

Sources: [tagged defaults](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/config-shared.ts#L2345), [tagged merged import set](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/config.ts#L1605), [Next.js 16 stable Turbopack/React Compiler announcement](https://nextjs.org/blog/next-16), [useTypeScriptCli reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli), [filesystem cache defaults](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache), [optimizePackageImports reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/optimizePackageImports), [static-worker implementation](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/build/index.ts#L1028), [agentUpgrade reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/agentUpgrade).

**Do not confuse two worker settings.** The 16.4 announcement's new loader/Babel/PostCSS worker mode is `experimental.turbopackPluginRuntimeStrategy: 'workerThreads'`, not the supplied `experimental.workerThreads`. It defaults to child processes. Tagged docs describe fallback to child processes on Node 24.13.1 and newer because native-addon teardown can abort Node; `forceWorkerThreads` bypasses that safeguard. This is a verified version caveat, not evidence Z8 hits it with its current flag. [Tagged runtime strategy reference](https://github.com/vercel/next.js/blob/v16.4.6/docs/01-app/03-api-reference/05-config/01-next-config-js/turbopackPluginRuntimeStrategy.mdx)

External packages use native Node loading rather than server bundling. The tagged defaults already include examples such as `pg`, `pino`, `sharp`, `@aws-sdk/client-s3`, and `@react-pdf/renderer`. A long explicit list is not inherently wrong; dependency runtime files and native assets still need deployment verification. Next.js sources alone cannot establish compatibility of Z8's particular next-intl/PostHog wrapper versions and external-library set. [serverExternalPackages reference](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages), [tagged default external package list](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/lib/server-external-packages.jsonc)

The practical boundary is per API, not whether a release itself is stable. `cacheComponents`, `partialPrefetching`, the shipped cache APIs/directives, `instant`, and `ensureStatic` are documented release features; `instantInsights`, the worker flags, `agentUpgrade`, Rust compiler selection, and the TypeScript CLI config retain experimental surfaces. Some experimental options are default-on. The `instant` export's stable status does not stabilize all its validation/testing internals. [Tagged instant reference](https://github.com/vercel/next.js/blob/v16.4.6/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.mdx), [tagged configuration types](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/config-shared.ts)

## 7. Verified security releases and current version caveats

### Patched vulnerabilities relevant to this application class

The **November 3, 2026** official security release shipped fixes in **16.4.5**. Z8's supplied **16.4.6** pin is newer than that fixed release. The latest advisory listing observed still leads with the November 3 batch; this memo does not assert that the application or its dependency tree is free of vulnerabilities. [November security release](https://nextjs.org/blog/november-2026-security-release), [official advisory listing](https://github.com/vercel/next.js/security/advisories)

| Advisory | Affected Next 16 range | Conditions and relevance | Fixed release |
| --- | --- | --- | --- |
| [GHSA-mfr8-8qww-v76h](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h) | `>=16.3.0 <=16.4.4` | Concurrent cold fills when the same public `use cache` function reads root params and is also called through `unstable_cache` can cross tenant/locale boundaries. Avoid that unsupported nesting. | 16.4.5 |
| [GHSA-vc7v-qv4w-wrv8](https://github.com/vercel/next.js/security/advisories/GHSA-vc7v-qv4w-wrv8) | `>=16.2.0 <=16.4.4` | Nested cached functions with pending inner streamed values can lose root-param identity in the outer cache. | 16.4.5 |
| [GHSA-rhh4-g77r-r9qj](https://github.com/vercel/next.js/security/advisories/GHSA-rhh4-g77r-r9qj) | `>=16.0.0 <=16.4.4` | Distinct binary cache arguments can collide, permitting cross-user disclosure/poisoning. Stable string identifiers remain easier to audit for tenant identity. | 16.4.5 |
| [GHSA-vvgp-ww4w-46vf](https://github.com/vercel/next.js/security/advisories/GHSA-vvgp-ww4w-46vf) | `>=16.4.0 <=16.4.4` | Self-hosted shared fallback-shell poisoning requires Cache Components with Partial Prefetching off/unset and a specific nested dynamic-route shape. The supplied enabled Partial Prefetching is outside the reported condition. | 16.4.5 |
| [GHSA-pc58-hwjq-p385](https://github.com/vercel/next.js/security/advisories/GHSA-pc58-hwjq-p385) | `>=16.0.0 <=16.4.4` | Forwarding fetched responses with stale compressed framing can desynchronize responses behind certain pipelining HTTP/1.1 proxies. Infrastructure details matter. | 16.4.5 |

The November announcement also covers Edge cookie-header exposure and SVG rejection bypass. Do not assume a Node webapp uses those paths, or that marketing/docs have identical exposure. [November security release](https://nextjs.org/blog/november-2026-security-release)

The **October 14** upstream-vulnerability release set **16.4.1** as its fixed Next 16 version for a Cache Components/RSC typed-array RCE, an image-optimization SVG RCE, and a Server Actions CPU denial of service. The image fix requires `sharp >=0.35.5`; 16.4.6's manifest requests `sharp ^0.35.5`. Actual deployment resolution, overrides, and separately installed native packages remain for the parent audit. There was no independent React 19.3.1 or full lockfile audit here. [October security release](https://nextjs.org/blog/nextjs-security-update-october-14-2026), [tagged Next package manifest](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/package.json)

**Source discrepancy:** the November blog labels the `unstable_cache`/root-param case high severity, while its individual GHSA currently rates it Moderate (6.3). The blog's install snippet also has a `16.4.5` command with a `16.5` comment. Use the advisory's explicit affected/patched ranges and actual package version, not those editorial labels, for applicability. [November announcement](https://nextjs.org/blog/november-2026-security-release), [individual advisory](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h)

### Source-confirmed 16.4.6 response-header caveat

The tagged `send-response.ts` skips handler-supplied `content-length`, `content-encoding`, and `transfer-encoding` for Node responses. Its explanation is that a fetched body may have been decompressed while retaining its old framing headers. This is directly observable in **16.4.6 source**, not just an issue allegation. Automatic Route Handler compression in 16.4.6 does not, by itself, prove arbitrary precompressed-body forwarding or precise handler-provided lengths work. [Tagged response implementation](https://github.com/vercel/next.js/blob/v16.4.6/packages/next/src/server/send-response.ts), [16.4.6 release](https://github.com/vercel/next.js/releases/tag/v16.4.6)

For Z8, inspect downloads, PDF/range consumers, exports, and any passthrough/compressed Route Handlers in the separate audit. The exact user-visible impact needs reproduction against the running image and proxy; it was not tested here. The upstream follow-up remains open as observed, but issue reports are corroborating context rather than the basis for the source finding. Do not recommend downgrading below security fixes to recover a header. [Upstream follow-up #101854](https://github.com/vercel/next.js/issues/101854)

## 8. Questions left for the implementation audit

- Which routes have meaningful instant shells for both direct entry and common sibling navigations? Which expensive queries execute during shell/per-link prefetches?
- Are session/auth checks request-scoped, cache keys organization/visibility-aware, and all database reads scoped independently of the cache?
- Do mutations expire all dependent tagged reads after commit, or merely refresh stale cached output? How are other open clients updated?
- Are there multiple runtime instances, and do both cache systems coordinate values and tags correctly across them?
- Can the actual standalone artifact load Z8's external/native packages, runtime assets, and configured wrappers? Does its proxy preserve streaming and correct cache variants?
- Do download and export consumers rely on the response headers filtered in 16.4.6? Does the deployed lockfile resolve the expected patched dependencies?

These are intentionally unresolved. Source research establishes framework behavior and version boundaries; it does not replace Z8 runtime measurements, tenant-isolation tests, deployment checks, or the parent's implementation audit.

## Validation note

Git inspection showed only this new memo as a repository change. An optional `pnpm exec oxfmt --check` attempt triggered the repository's automatic dependency verification/setup before running; that setup failed in the PostHog CLI postinstall, and the formatter excluded this Markdown path. It materialized local `node_modules`; no dependency manifest or lockfile changed. No application build or runtime verification was attempted. Content and citations were reviewed directly.
