# Medium Findings Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the eight approved medium-severity webapp findings with independently verified, minimal regression patches.

**Architecture:** Use existing shared boundaries: Next.js proxy for request-wide app-access enforcement, server layouts for initial provider state, narrow Suspense boundaries for streaming, and existing Luxon/Tolgee preference hooks for deterministic formatting. Each task follows RED-GREEN-REFACTOR and must preserve unrelated concurrent changes.

**Tech Stack:** Next.js 16, React 19, TypeScript 7, Vitest, Testing Library, Better Auth, Zustand, Luxon, Tolgee, TanStack Query.

---

## File Map

- `src/proxy.ts`, `src/proxy.test.ts`: enforce app permissions for authenticated page and API requests.
- `src/lib/app-access.ts`, `src/lib/app-access.test.ts`: pure request-type and permission decision logic shared by proxy and session status.
- `src/instrumentation.ts`, `src/instrumentation.test.ts`: keep build phase free of external storage initialization.
- `src/app/[locale]/layout.tsx`, `src/app/[locale]/layout.test.tsx`: remove root consent blocking.
- `src/app/[locale]/(app)/layout.tsx`, `src/app/[locale]/(app)/layout.test.ts`: load consent and organization bootstrap state with the existing authenticated layout work.
- `src/components/posthog-provider.tsx`: continue consent-aware analytics under the authenticated layout.
- `src/components/providers/organization-settings-provider.tsx` and test: hydrate organization settings from server props without a context request.
- `src/lib/organization-settings.ts` and test: one organization-scoped loader and mapper for the layout and context API.
- `src/app/api/auth/context/route.ts`: reuse the organization-settings loader for client refetch after organization switching.
- `src/components/webhooks/webhook-delivery-logs-dialog.tsx` and test: pagination reload and stale-response protection.
- `src/app/[locale]/(app)/settings/layout.tsx` and `settings-layout-source.test.ts`: suspend the navigation only and render children once.
- `package.json`, `tsconfig.typecheck.json`: deterministic typecheck command.
- `src/lib/audit-export/infrastructure/crypto/signing-provider.ts` and test: preserve Ed25519 behavior while satisfying Node typings.
- `src/lib/platform-analytics/range.ts`, `range.test.ts`: make Luxon cursor validity typing stable.
- `src/lib/datetime/format.ts`, `format.test.ts`: explicit locale/zone display helpers.
- Validated UI files: pending members, webhook logs, email test status, export history, audit packages, day details, employee selector, and wellness settings.

### Task 1: Central App-Access Enforcement

- [ ] **Step 1: Re-read concurrent diffs**

Run: `git diff -- src/proxy.ts src/lib/auth-helpers.ts src/lib/effect/services/app-access.service.ts`

Expected: Preserve unrelated membership and authorization work; stop only for direct conflicts in these exact boundaries.

- [ ] **Step 2: Add failing pure decision tests**

Create `src/lib/app-access.test.ts` covering web cookie, mobile bearer, and desktop bearer requests:

```ts
it("denies the detected app when its permission is disabled", () => {
  expect(validateAppAccess({ canUseWebapp: false }, new Headers())).toMatchObject({
    allowed: false,
    appType: "webapp",
  });
});
```

Run: `pnpm exec vitest run src/lib/app-access.test.ts`

Expected: FAIL because the focused module does not exist.

- [ ] **Step 3: Add failing proxy boundary tests**

Extend `src/proxy.test.ts` to assert API routes match the proxy, ingest/static assets remain excluded, authenticated denied requests return 403 for APIs, and the access-denied page does not loop.

Run: `pnpm exec vitest run src/proxy.test.ts`

Expected: FAIL because `/api/time-entries` is excluded and no central denial occurs.

- [ ] **Step 4: Implement the minimal shared decision module**

Move request detection and permission evaluation into `src/lib/app-access.ts` without database imports:

```ts
export function validateAppAccess(user: AppAccessUser, requestHeaders: Headers) {
  const appType = detectAppType(requestHeaders);
  const allowed = appType === "webapp"
    ? user.canUseWebapp ?? true
    : appType === "mobile"
      ? user.canUseMobile ?? true
      : user.canUseDesktop ?? true;
  return { allowed, appType, reason: allowed ? undefined : getDeniedReason(appType) };
}
```

Update existing imports rather than retaining duplicate implementations.

- [ ] **Step 5: Enforce at the proxy**

Expand the matcher to API requests while retaining exclusions. For requests with a valid session, evaluate current user fields. Return the established JSON 403 shape for APIs and redirect page requests to localized `/access-denied?app=...`. Let unauthenticated requests continue to existing route/page authentication and exempt the access-denied route from enforcement.

- [ ] **Step 6: Verify Task 1**

Run: `pnpm exec vitest run src/lib/app-access.test.ts src/proxy.test.ts src/app/api/session/organization-status/route.test.ts`

Expected: PASS.

### Task 2: Build-Time Storage Isolation

- [ ] **Step 1: Write a failing instrumentation test**

Create `src/instrumentation.test.ts` with mocked `initializeStorage`, set `NEXT_PHASE=phase-production-build`, call `register()`, and assert storage initialization is not imported/called. Add a runtime case asserting it is called outside build phase.

Run: `pnpm exec vitest run src/instrumentation.test.ts`

Expected: FAIL because build-phase registration currently initializes storage.

- [ ] **Step 2: Guard runtime startup work**

Move the storage import/initialization under `if (!isBuildTime)` together with runtime health checks. Keep OpenTelemetry behavior and production runtime failure handling unchanged.

- [ ] **Step 3: Verify Task 2**

Run: `pnpm exec vitest run src/instrumentation.test.ts src/lib/storage/s3-client.test.ts src/lib/storage/export-s3-client.test.ts`

Expected: PASS.

### Task 3: Remove the Root Consent Waterfall

- [ ] **Step 1: Strengthen the failing layout test**

Extend `src/app/[locale]/layout.test.tsx` with a source/element assertion that the root body does not wrap all route children in `PostHogConsentProvider` or a full-screen Suspense boundary.

Run: `pnpm exec vitest run 'src/app/[locale]/layout.test.tsx'`

Expected: FAIL against the current root layout.

- [ ] **Step 2: Move authenticated consent loading**

Remove `getHelpImproveProduct` and `PostHogConsentProvider` from the root layout. In `(app)/layout.tsx`, load `helpImproveProduct` in parallel with locale/time preferences and wrap only authenticated app content in the existing client `PostHogProvider`.

```tsx
<PostHogProvider disabled={env.NODE_ENV === "development"} helpImproveProduct={helpImproveProduct}>
  {authenticatedShell}
</PostHogProvider>
```

Anonymous/auth pages remain untracked, matching the existing root behavior where no session returned `false`.

- [ ] **Step 3: Verify Task 3**

Run: `pnpm exec vitest run 'src/app/[locale]/layout.test.tsx' 'src/app/[locale]/(app)/layout.test.ts' src/components/posthog-provider.test.tsx`

Expected: PASS.

### Task 4: Server-Seed Organization Settings

- [ ] **Step 1: Add a failing loader test**

Create `src/lib/organization-settings.test.ts` asserting an organization ID is always included in the query predicate and nullable flags/timezone are normalized into the existing `OrganizationSettings` shape.

Run: `pnpm exec vitest run src/lib/organization-settings.test.ts`

Expected: FAIL because no shared loader exists.

- [ ] **Step 2: Add a failing provider test**

Create `src/components/providers/organization-settings-provider.test.tsx`. Render with `initialSettings`, expose store values through a probe, and assert the store is hydrated without calling `/api/auth/context`.

Run: `pnpm exec vitest run src/components/providers/organization-settings-provider.test.tsx`

Expected: FAIL because the provider accepts no initial state and calls `useOrganization()`.

- [ ] **Step 3: Implement the organization loader**

Create a server-only loader that queries `organization.id` by the supplied active organization ID and returns normalized settings. Reuse it in `src/app/api/auth/context/route.ts`.

- [ ] **Step 4: Seed the provider from the app layout**

Load organization settings in the authenticated app layout alongside billing data. Change `OrganizationSettingsProvider` to accept `initialSettings`, hydrate the Zustand store from those props, and remove its unconditional `useOrganization()` call. Keep `/api/auth/context` for explicit refetches after organization switching.

- [ ] **Step 5: Verify Task 4**

Run: `pnpm exec vitest run src/lib/organization-settings.test.ts src/components/providers/organization-settings-provider.test.tsx src/app/api/auth/context/route.test.ts 'src/app/[locale]/(app)/analytics/page.test.tsx'`

Expected: PASS with no initial context request.

### Task 5: Correct Webhook Delivery Pagination

- [ ] **Step 1: Write failing behavioral tests**

Create `src/components/webhooks/webhook-delivery-logs-dialog.test.tsx`. Mock `getWebhookDeliveryLogs`, open the dialog, click Next, and assert the second call receives offset `20`. Add deferred responses and assert a late offset-0 response cannot overwrite offset-20 data.

Run: `pnpm exec vitest run src/components/webhooks/webhook-delivery-logs-dialog.test.tsx`

Expected: FAIL because offset changes do not trigger a request and stale responses are unguarded.

- [ ] **Step 2: Implement dependency and stale-response handling**

Trigger loading from `open`, `webhookId`, and `offset`. Track a monotonically increasing request ID in a ref; only the latest request may update deliveries, totals, request keys, or loading state. Reset offset and expanded rows when the webhook changes.

- [ ] **Step 3: Verify Task 5**

Run: `pnpm exec vitest run src/components/webhooks/webhook-delivery-logs-dialog.test.tsx src/lib/webhooks/webhook-delivery.test.ts`

Expected: PASS.

### Task 6: Render Settings Children Once

- [ ] **Step 1: Add a failing source regression assertion**

Extend `settings-layout-source.test.ts` to extract the fallback and assert it does not contain `{children}`, while the full source contains exactly one rendered `{children}` expression.

Run: `pnpm exec vitest run 'src/app/[locale]/(app)/settings/settings-layout-source.test.ts'`

Expected: FAIL because both fallback and primary trees render children.

- [ ] **Step 2: Narrow the Suspense boundary**

Refactor the async access lookup into `SettingsNavigation`. Render the static main/breadcrumb/children tree once and wrap only the navigation component with a sidebar skeleton fallback.

- [ ] **Step 3: Verify Task 6**

Run: `pnpm exec vitest run 'src/app/[locale]/(app)/settings/settings-layout-source.test.ts' 'src/app/[locale]/(app)/settings/page.test.tsx'`

Expected: PASS.

### Task 7: Reproducible Type Checking

- [ ] **Step 1: Add the typecheck configuration and observe RED**

Create `tsconfig.typecheck.json` extending the main config but including source and `.next/types` while excluding `.next/dev/types` and tests. Add `"typecheck": "next typegen && tsc --project tsconfig.typecheck.json --noEmit --incremental false"` to `package.json`.

Run: `pnpm typecheck`

Expected: FAIL only on the signing provider and platform analytics source errors.

- [ ] **Step 2: Add signing behavior coverage**

Create `src/lib/audit-export/infrastructure/crypto/signing-provider.test.ts` that generates a key pair, derives the public key from the private key, signs data, and verifies the signature.

Run: `pnpm exec vitest run src/lib/audit-export/infrastructure/crypto/signing-provider.test.ts`

Expected: PASS behaviorally before the type-only repair, documenting preserved behavior.

- [ ] **Step 3: Fix the Node key typing without a cast**

Export the created private `KeyObject` as PKCS8 PEM before passing it to `createPublicKey`, then export the public key as SPKI PEM.

- [ ] **Step 4: Fix the Luxon cursor typing**

Give the bucket cursor and `getNextBucketStart` a consistent `DateTime` validity type or avoid reassigning incompatible inferred validity unions. Add an invalid-range boundary assertion to `range.test.ts` if behavior changes; otherwise use `pnpm typecheck` as the RED/GREEN test.

- [ ] **Step 5: Verify Task 7**

Run: `pnpm typecheck && pnpm exec vitest run src/lib/audit-export/infrastructure/crypto/signing-provider.test.ts src/lib/platform-analytics/range.test.ts`

Expected: PASS with no `.next/dev/types` diagnostics.

### Task 8: Validated Date and Accessibility Defects

- [ ] **Step 1: Add failing explicit-format tests**

Create `src/lib/datetime/format.test.ts` using a UTC instant that falls on different calendar days in Berlin and New York. Assert date, time, and date-time helpers honor both explicit `locale` and `timezone`.

Run: `pnpm exec vitest run src/lib/datetime/format.test.ts`

Expected: FAIL because the existing helpers accept neither option.

- [ ] **Step 2: Implement explicit formatting helpers**

Extend `src/lib/datetime/format.ts` with focused helpers that normalize `Date | string | DateTime`, set the supplied zone and locale, and return Luxon `toLocaleString` output. Invalid input returns `"-"` rather than relying on browser defaults.

- [ ] **Step 3: Replace validated implicit formatting sites**

Update pending members, webhook delivery logs, email configuration test status, export history, audit package history, and day details to use explicit locale and the relevant user/organization/selected-calendar timezone. Use `useLocale`, `useUserTimezone`, or `useOrganizationTimezone` according to the displayed data.

- [ ] **Step 4: Add failing accessibility tests**

Extend employee-selector and wellness form tests to query the remove, decrement, and increment buttons by translated accessible name.

Run: `pnpm exec vitest run src/components/employee-select/employee-select-modal.test.tsx src/components/settings/wellness-settings-form.test.tsx`

Expected: FAIL because the icon-only controls are unnamed.

- [ ] **Step 5: Add translated names and decorative icon semantics**

Add translated `aria-label` attributes to the three controls and `aria-hidden="true"` to their icons. Do not alter keyboard or click behavior.

- [ ] **Step 6: Verify Task 8**

Run: `pnpm exec vitest run src/lib/datetime/format.test.ts src/components/employee-select/employee-select-modal.test.tsx src/components/settings/wellness-settings-form.test.tsx`

Run: `pnpm dlx react-doctor@latest . --verbose --scope changed`

Expected: Tests pass and the changed files no longer report the validated locale/timezone or missing-label findings.

### Final Verification

- [ ] Re-read `git diff -- apps/webapp` and distinguish this work from concurrent agent changes.
- [ ] Run `pnpm test` and require zero failures.
- [ ] Run `pnpm typecheck` and require zero diagnostics.
- [ ] Run `pnpm dlx react-doctor@latest . --verbose --scope changed` and inspect all changed-file errors.
- [ ] Run `CI=true pnpm build` only when Phase-managed environment variables are available; otherwise report the environment blocker.
- [ ] Run `git status --short -- apps/webapp` and report all files touched without staging or committing.
