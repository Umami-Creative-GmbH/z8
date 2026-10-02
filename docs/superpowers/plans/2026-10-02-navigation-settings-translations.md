# Settings and Translation Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read render preferences once and deliver the shared shell plus needed feature translations without loading all 35 namespaces in the browser.

**Architecture:** A request-local preferences snapshot serves layout and time tracking. Cached public catalog slices feed a stable per-locale browser Tolgee instance through SSR-aware feature boundaries; a selective client loader covers lazy features without a post-paint translation dependency.

**Tech Stack:** React cache, Next.js `use cache`/Suspense, Tolgee 7 SSR, next-intl, Drizzle, Vitest.

**Spec:** [Section 4](../specs/2026-10-02-navigation-performance-design.md). Read the [delivery checklist](2026-10-02-navigation-performance.md) and [change 1 interfaces](2026-10-02-navigation-rendering-reads.md). Integrate after change 2.

## Global Constraints

- Preserve current data freshness, authorization, organization isolation, timekeeping results, preference defaults, translation keys, and page layout.
- Preferences: unset/invalid locale stays null; week start normalizes to Sunday; time format normalizes to 24-hour; empty timezone becomes UTC; unset analytics consent is true and explicit false remains false.
- Catalogs are public code-owned data; keep `cacheLife('max')`. Auth, headers, tenant data, and preference snapshots never enter persistent catalog caches.
- Preserve primary translation keys, namespace aliases, existing server/bot coverage, and stable shared/query providers. No Tolgee network service or new dependency.
- Source paths are relative to `apps/webapp`; inherit every delivery-plan constraint and gate.

## Review Focus

1. Partial/invalid settings and false consent preserve defaults without redirect loops.
2. Nested settings routes and route titles need keys outside their apparent feature namespace.
3. New slices sharing a translation subtree must not delete earlier siblings or aliases.
4. Failed imports or late old-locale requests cannot mark incomplete/wrong-language features ready.
5. Static catalog injection cannot trigger permanent-change refresh loops; real translation edits still refresh.

## File structure and contracts

- Create `src/lib/user-preferences/render-snapshot.ts` and `.test.ts`: narrow fresh preferences reader plus request-local wrapper.
- Create `src/tolgee/shell-catalog.ts` and `.test.ts`: explicit shared key/subtree manifest and projection, including every `APP_ROUTE_METADATA` title and unknown-route title.
- Create `src/tolgee/catalog-slices.ts` and `.test.ts`: supported-locale normalization, namespace validation/canonicalization and public `CatalogSlice` type. Export `CatalogSlice = { locale: string; namespaces: readonly Namespace[]; records: TolgeeStaticData; keyOwners: Readonly<Record<string, Namespace>> }`. Ownership entries are only for colliding primary leaves; encode each path as a JSON array of segments, so literal dots/colons cannot collide with nested paths.
- Create `src/tolgee/catalog-store.ts` and `.test.ts`: cumulative dictionaries and load identity per Tolgee instance/locale, without React/router dependencies.
- Create `src/tolgee/client-catalog-loader.ts` and `.test.ts`: selective imports with in-flight deduplication.
- Create `src/tolgee/route-boundary.tsx`, `feature-provider.tsx`, and `route-boundary.test.tsx`: server slice acquisition and first-render SSR records.
- Create `src/tolgee/route-catalog-scopes.ts` and `.test.ts`: explicit scope-to-namespace mapping and installed feature-layout coverage. It complements the existing `ROUTE_NAMESPACES`; it does not infer root records from pathname headers.
- Modify existing `shared.ts`, `load-translations.ts`, their tests, `client.tsx`, `client.test.tsx`, `server.tsx` only where needed to retain the complete server loader, locale `layout.tsx`/`layout.test.tsx`, `translation-providers.tsx`, app layout content, time tracking render context, and the feature layouts in task 4.

### Task 1: Consolidate render preferences

**Interfaces:** Consume `userSettings`, `ALL_LANGUAGES`, existing preference normalizers and `getRenderSession`. Produce:

```ts
type RenderUserPreferences = {
  locale: string | null; weekStartDay: WeekStartDay; timeFormat: TimeFormat;
  timezone: string; helpImproveProduct: boolean;
};
readUserPreferences(userId: string): Promise<RenderUserPreferences> // fresh
getRenderUserPreferences(userId: string): Promise<RenderUserPreferences> // React cache wrapper
```

The scalar authorized user ID is the cache argument; do not key on newly allocated objects. No token/session is part of the snapshot.

- [ ] **Step 1: Add failing tests.** Mock `userSettings.findFirst`. Cover absent row, partial row, all ten supported locales, unsupported/empty locale, invalid week/format, empty timezone, and explicit consent false. Assert the query selects exactly `locale`, `weekStartDay`, `timeFormat`, `timezone`, `helpImproveProduct` and filters by user ID. Test the fresh reader after a write and between two users:

```ts
expect(await readUserPreferences('user-1')).toEqual({
  locale: null, weekStartDay: 'sunday', timeFormat: '24h', timezone: 'UTC', helpImproveProduct: true,
});
expect((await readUserPreferences('user-2')).helpImproveProduct).toBe(false);
```

Add app layout behavior coverage in `src/app/[locale]/(app)/app-layout-content.test.tsx`: supported saved locale redirects, null/invalid locale does not, billing/organization gates remain independent, and provider props retain exact values. Extend time tracking context tests to consume the snapshot without an extra settings query.

- [ ] **Step 2: Run to observe failure.** `pnpm exec vitest run --project unit 'src/lib/user-preferences/render-snapshot.test.ts' 'src/app/[locale]/(app)/app-layout-content.test.tsx' 'src/app/[locale]/(app)/time-tracking/render-context.test.ts'`. Expected: missing snapshot/new assertions fail.
- [ ] **Step 3: Implement and migrate.** One narrow query and existing normalizers; `getRenderUserPreferences = cache(readUserPreferences)`. Replace the app layout's five separate reads with one snapshot alongside the independent organization-settings request. Use the same wrapper in time tracking context. Preserve `getUserLocaleRaw`/bot callers and existing fresh preference APIs outside the migrated render paths.
- [ ] **Step 4: Verify.** Rerun step 2 and existing preference/provider tests. In real RSC fixture rendering, count one underlying settings query for migrated layout/page consumers; repeat after fixture preference write and with another user. Do not mock cache globally. Confirm locale redirect and consent behavior in the fixture browser. Run shared checks.
- [ ] **Step 5: Commit.** `git commit -m 'perf: consolidate render preference reads'` after explicitly staging snapshot, migrated callers and tests.

### Task 2: Define selective catalog slices and shared shell coverage

**Interfaces:** Consume `ALL_NAMESPACES`, `ALL_LANGUAGES`, `loadNamespaces`, `mergeTreeTranslations`, `APP_ROUTE_METADATA`, and the existing route mapping. Produce:

```ts
canonicalizeNamespaces(namespaces: readonly Namespace[]): readonly Namespace[]
loadCatalogSlice(locale: string, namespaces: readonly Namespace[]): Promise<CatalogSlice>
loadShellTranslations(locale: string): Promise<CatalogSlice>
loadCompleteServerTranslations(locale: string): Promise<TolgeeStaticData>
```

Export loaders from `load-translations.ts`; validation/canonicalization live in `catalog-slices.ts`. Public slice loading canonicalizes before entering its private `use cache` function; inside, merge source catalogs in `ALL_NAMESPACES` order to preserve the predecessor's complete-catalog precedence. Fill collision ownership from the source namespace before merging; shell projection retains the winning owner for included collision keys. Complete server loading preserves today's strict all-namespace coverage, while root layout switches to shell loading only in task 4. Ownership metadata must be counted in payload measurements.

- [ ] **Step 1: Write failing catalog tests.** Load local JSON through real `loadNamespaces` for ten locales and representative shell/feature keys. Enumerate global providers, sidebar/nav/user controls, metadata titles, header clock/break/timezone/notification/customize controls, offline/deployment prompts, organization/billing banners, and their reachable dialogs to populate `SHELL_CATALOG_KEYS`. Use complete dynamic subtrees for dynamic key families. The manifest records namespace plus key/subtree path; no whole feature namespace solely for a title. Test every metadata title resolves to the same predecessor translation, tree siblings and aliases remain, permutations/duplicates yield one canonical set, unsupported namespaces reject, and supported-locale normalization matches existing behavior:

```ts
expect(canonicalizeNamespaces(['reports', 'common', 'reports'])).toEqual(['common', 'reports']);
expect(shellTitle).toEqual(completeCatalogTitle);
expect(serializedShellBytes).toBeLessThan(serializedCompleteBytes);
expect(slice.records.en['reports:reports']).toEqual(expectedReportsTree);
```

The shown `reports:reports` alias exists in the current Reports catalog. Test colliding primary keys against the old all-namespace dictionary. If a required key's winning source lies in another namespace, add that explicit dependency to the relevant scope instead of accepting changed wording. Server/bot tests still expect their previous full/standalone coverage.

- [ ] **Step 2: Run tests.** `pnpm exec vitest run --project unit 'src/tolgee/catalog-slices.test.ts' 'src/tolgee/shell-catalog.test.ts' 'src/tolgee/load-translations.test.ts' 'src/tolgee/shared.test.ts'`. Expected: missing slice interfaces and shell assertions fail; predecessor compatibility remains characterized.
- [ ] **Step 3: Implement loaders/manifest.** Keep `loadRouteTranslations` as a compatibility delegate to complete server loading until callers migrate. Cached functions take only public locale/canonical catalog identity. Shell projection may load complete server catalogs internally, but serialized output contains only the manifest's selected keys/aliases. Keep `getTranslate` and bot localization complete and independent of shell delivery. Strict missing/import failures propagate to controlled boundaries; never mark an empty dictionary ready.
- [ ] **Step 4: Verify.** Rerun step 2, server translation tests and route metadata tests. Measure serialized merged/aliased dictionaries, not JSON file sizes. Document the explicit shell manifest and collision dependencies in tests. Shared gates must pass before using slices in the browser.
- [ ] **Step 5: Commit.** `git commit -m 'refactor: define shell and feature translation slices'`.

### Task 3: Merge records and load lazy slices without language races

**Interfaces:** Consume `CatalogSlice` and canonicalization. Produce in `catalog-store.ts`:

```ts
mergeCatalogRecords(current: CatalogSlice, incoming: CatalogSlice): CatalogSlice
applyCatalogRecords(instance: TolgeeInstance, incoming: CatalogSlice): TolgeeStaticData
isApplyingCatalogRecords(instance: TolgeeInstance): boolean
```

`TolgeeInstance` is derived from the existing `TolgeeBase().init` return type. Produce `loadClientCatalogSlice(locale: string, namespaces: readonly Namespace[]): Promise<CatalogSlice>` in the client loader. Shared slice acquisition/projection computes the same ownership for server and browser loaders; do not load every catalog merely to find ownership on the client. Put a code-owned collision-path/source registry per supported locale in `catalog-slices.ts`, generated from the existing local catalogs and checked against all ten locales in tests. `useNamespaces` retains its existing `{isLoading, isLoaded}` return contract; locale participates in its request identity and cleanup.

- [ ] **Step 1: Add failing tests.** Merge partial `settings` trees and namespace aliases; expect old siblings retained and incoming leaves inserted without mutation of input fixtures. Add actual complete-catalog precedence cases from task 2. Two simultaneous requests for the same canonical locale/set share one import; a failed load is removed from the in-flight map so retry works. Switching locale while a delayed slice resolves must leave destination readiness/records untouched. Test unknown/import-failed namespaces do not become loaded. In jsdom test a lazy feature remains gated until requested records are applied:

```ts
expect(merged.records.en.settings).toEqual({ title: 'Settings', employees: { title: 'Employees' } });
expect(importCatalog).toHaveBeenCalledTimes(1);
expect(result.current.isLoaded).toBe(false); // failed or obsolete request
expect(refresh).not.toHaveBeenCalled(); // catalog injection
```

Also assert an actual permanent translation edit triggers exactly one refresh, nested catalog injection does not, language registries are isolated, and the stable instance/query client are retained on same-locale navigation. Use real Tolgee for dictionary/SSR compatibility tests; mock router refresh only.

- [ ] **Step 2: Run to see failure.** `pnpm exec vitest run --project unit 'src/tolgee/catalog-store.test.ts' 'src/tolgee/client-catalog-loader.test.ts' 'src/tolgee/client.test.tsx'`. Expected: missing store/loader interfaces and selective readiness assertions fail.
- [ ] **Step 3: Implement store/loader/provider integration.** Retain cumulative per-locale records, deep-merge using existing tree semantics, apply merged records rather than replacing with the latest slice, and guard all injection paths against the refresh listener. For a colliding primary leaf, retain the value whose recorded owner has the higher `ALL_NAMESPACES` index; merge disjoint children normally, preserve namespace aliases, and reject cross-locale merges. This preserves the task-2 precedence regardless of arrival order. Store browser Tolgee instances per locale; on SSR use a render-local instance, never a shared mutable server registry. Add `TolgeeBase(options?: { loadAllLanguageCatalogs?: boolean })`, default true for existing server/bot callers; root/feature provider instances pass false on both SSR and browser paths and do not register the current all-language/all-namespace fallback. Selective lazy loading explicitly calls `loadNamespaces(..., {strict: true})`, applies records, and only then marks ready. It does not depend on `addActiveNs` to acquire the flattened key dictionary.
- [ ] **Step 4: Verify.** Rerun step 2 with reversed namespace arrival order and locale races. Test failed import plus retry and existing translation edit behavior. Check that no ordinary browser loader path calls `ALL_NAMESPACES`; source inspection is supplementary, real module-load tests must pass. Run shared typechecks.
- [ ] **Step 5: Commit.** `git commit -m 'perf: selectively load and merge browser catalogs'`.

### Task 4: Install SSR-aware feature boundaries and validate route coverage

**Interfaces:** Produce:

```ts
RouteTranslationBoundary({ route, params, children }: {
  route: string; params: Promise<{ locale: string }>; children: React.ReactNode;
}): React.ReactNode // synchronous Suspense wrapper
FeatureTranslationProvider({ slice, children }: {
  slice: CatalogSlice; children: React.ReactNode;
}): React.ReactNode // client component
TranslationProviders({ locale, slice, children }: {
  locale: string; slice: CatalogSlice; children: React.ReactNode;
}): React.ReactNode
TolgeeNextProvider({ slice, children }: {
  slice: CatalogSlice; children: React.ReactNode;
}): React.ReactNode
```

An async child inside the boundary awaits locale and cached slice, then passes records to the provider. Root `TranslationProviders` accepts the shell `CatalogSlice`; `TolgeeNextProvider` initializes a shared context containing the locale, original Tolgee instance, and cumulative slice, and passes only `records` to Tolgee itself. Define that context in `feature-provider.tsx` and consume it from both providers without creating a second browser instance. Feature provider merges its slice with that root context and uses Tolgee's `ssr={{language, staticData: mergedSlice.records}}` for matching first-render records before revealing children. Cumulative browser records stay on the stable instance. No new QueryProvider or NextIntl provider per feature. Root loading fallback uses an empty slice `{locale, namespaces: [], records: {}, keyOwners: {}}` for shell skeletons; feature content stays hidden until its records are ready.

**Exact boundary placement:** Under `src/app/[locale]`, modify `(auth)/layout.tsx`, `(admin)/layout.tsx`, `(setup)/layout.tsx`, `onboarding/layout.tsx`, `init/page.tsx`, and `layout.tsx`/`translation-providers.tsx`. Under `(app)`, wrap the dashboard in `page.tsx`; create feature `layout.tsx` in `absences`, `approvals`, `billing`, `calendar`, `compliance`, `my-requests`, `notifications`, `organization`, `payroll`, `reports`, `scheduling`, `team`, `time-tracking`, `today`, `travel-expenses`, and `works-council`. Modify existing `analytics/layout.tsx`, `settings/layout.tsx`, and `settings/enterprise/layout.tsx` rather than replacing them. For settings-specific namespace slices, create child layouts in `approval-escalation`, `approval-policies`, `audit-export`, `audit-log`, `calendar`, `change-policies`, `clockodo-import`, `coverage-rules`, `demo`, `discord`, `employees`, `holidays`, `permissions`, `payroll-export`, `payroll-readiness`, `work-diagnostics`, `roles`, `scheduled-exports`, `shifts`, `slack`, `surcharges`, `teams`, `teams-notifications`, `telegram`, `travel-expenses`, `vacation`, `webhooks`, `work-categories`, `work-policies`, and `compliance`. Add the billing slice at `settings/billing/layout.tsx`. These paths are derived from this checkout; preserve any concurrently added layout by composing into it.

Other settings pages inherit generic/shared records unless their audited keys need a separate scope. Register explicit scopes for organization, notifications, compliance, works council, billing recovery, and the actual `clockodo-import` spelling; the existing route mapping omits some. All locale pages must be covered by a scope or an explicit shared-only exception. The coverage test discovers current `page.tsx` files with route-group segments removed and verifies actual boundary ancestry plus key coverage; it is a route-wiring contract, not evidence of rendered translations.

- [ ] **Step 1: Add failing integration tests.** Build `route-catalog-scopes.test.ts` from the page inventory and reachable dialogs, retaining segment-boundary/longest-prefix behavior for nested routes. Test direct SSR and hydration with real Tolgee in `route-boundary.test.tsx`: shared header titles, a feature primary key, and a namespace alias render the predecessor wording on first render, with no key/default flash. Include no-employee/create-org, billing recovery, report project pages, nested settings, and a lazy cross-feature dialog. Assert the destination locale is ready before revealing its feature content and no query provider is recreated. Update locale `layout.test.tsx` and provider mocks for the slice contract while retaining the existing fallback/provider stability assertions; changing a prop name does not justify removing those assertions.

```ts
expect(uncoveredPages).toEqual([]);
expect(serverMarkup).toContain(expectedTranslatedLabel);
expect(hydrationErrors).toEqual([]);
expect(featureRecordsBytes).toBeLessThan(completeRecordsBytes);
```

- [ ] **Step 2: Run to observe failure.** `pnpm exec vitest run --project unit 'src/tolgee/route-catalog-scopes.test.ts' 'src/tolgee/route-boundary.test.tsx' 'src/tolgee/__tests__/shared-route-namespaces.test.ts'`. Expected: uncovered/new routes and missing feature boundaries fail.
- [ ] **Step 3: Wire shell and boundaries.** Root locale layout supplies `loadShellTranslations`, including its fallback treatment without exposing partially translated feature content. Install feature layouts from the file list, preserving existing authorization and UI wrappers. Compose generic settings with specialized child scopes; avoid sending all settings namespaces from the parent. Extend mappings with actual key dependencies found by tests. Use cached static catalogs for fallbacks/errors so header and no-employee UI remain translated even when a feature read fails. Reuse root locale/instance context and Tolgee SSR support; an effect may reconcile persistent records, but first-render text never depends on that effect. Keep locale change navigation and server translator behavior unchanged.
- [ ] **Step 4: Verify all coverage and production behavior.** Rerun all `src/tolgee` unit tests, settings snapshot/layout tests, route metadata tests, and relevant time tracking tests. Run shared build/typecheck/lint and React diagnostics. In the disposable production browser, direct-load and navigate representative pages from every route family in all supported locales; open shared/lazy dialogs, switch language, navigate rapidly/back/forward, and reject/retry a catalog chunk. Confirm no key flashes, wrong-language records, hydration errors, refresh loops, or provider resets. Record actual serialized root/feature/RSC bytes and loaded catalog chunks versus baseline; shell plus feature must be smaller and neither root nor fallback should load all 35. Use the existing Next prefetch insights/development loop to verify useful shell/feature boundaries; no config adoption is necessary.
- [ ] **Step 5: Commit and deliver change 4.** `git commit -m 'perf: deliver translations at feature boundaries'`. Include settings and translation commits in one reviewed change-4 PR, with full runtime/payload evidence or explicit pending gates. Do not claim completion of runtime verification when only unit tests/build passed.
