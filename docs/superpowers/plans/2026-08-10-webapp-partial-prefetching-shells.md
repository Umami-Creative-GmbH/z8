# Webapp Partial Prefetching Shells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Partial Prefetching adoption so authenticated and public navigations paint meaningful, non-sensitive shells while URL-specific and organization-scoped content streams safely.

**Architecture:** Keep authentication, authorization, billing, and tenant data request-bound. Place a generic app-frame fallback around the authenticated layout, then pass unresolved URL promises into focused async children behind page-shaped Suspense boundaries. Preserve default Link prefetching and add no runtime-prefetch or broad caching behavior.

**Tech Stack:** Next.js 16.3 App Router, React 19 Suspense, TypeScript, Vitest, Testing Library, Tailwind CSS, Next.js `/_next/mcp`, agent-browser.

---

## File Map

**New shared shell files**

- `apps/webapp/src/components/shells/app-frame-loading.tsx`: neutral authenticated sidebar, header, and content-frame fallback.
- `apps/webapp/src/components/shells/app-frame-loading.test.tsx`: verifies the fallback is structural and contains no tenant or user data.
- `apps/webapp/src/components/shells/auth-content-loading.tsx`: reusable centered auth-card skeleton.
- `apps/webapp/src/components/shells/settings-content-loading.tsx`: settings content-region skeleton that preserves settings navigation.

**Authenticated and shared layouts**

- `apps/webapp/src/app/[locale]/(app)/layout.tsx`: wrap request-bound authenticated content in the neutral app-frame fallback.
- `apps/webapp/src/app/[locale]/(app)/layout.test.tsx`: verify generic fallback and protected content placement.
- `apps/webapp/src/app/[locale]/layout.tsx`: replace the child-content null fallback without changing locale document attributes.
- `apps/webapp/src/app/[locale]/layout.test.tsx`: verify primary child content receives a visible fallback.
- `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx`: bound settings page content independently from permission-aware navigation.
- `apps/webapp/src/app/[locale]/(auth)/layout.tsx`: preserve auth shell geometry while domain configuration resolves.
- `apps/webapp/src/app/[locale]/(auth)/layout.test.tsx`: verify the auth fallback has background, controls, content card, and footer geometry.

**URL-dependent server routes**

- `apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.test.tsx`
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.tsx`
- `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.test.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.test.tsx`
- `apps/webapp/src/app/[locale]/(app)/works-council/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/works-council/page.test.tsx`

**Dynamic details**

- `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.test.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/import/[batchId]/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/import/[batchId]/page.test.tsx`
- `apps/webapp/src/app/[locale]/(auth)/accept-invitation/[invitationId]/page.tsx`
- `apps/webapp/src/app/[locale]/(auth)/accept-invitation/[invitationId]/page.test.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/team-detail-page-client.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/vacation/employees/[employeeId]/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/settings/vacation/employees/[employeeId]/employee-allowance-edit-page-client.tsx`

**Primary null fallbacks**

- `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`
- `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.test.tsx`
- `apps/webapp/src/app/[locale]/access-denied/page-client.tsx`
- `apps/webapp/src/app/[locale]/access-denied/page-client.test.tsx`
- `apps/webapp/src/app/[locale]/init/page-client.tsx`
- `apps/webapp/src/app/[locale]/(auth)/sign-in/page.tsx`
- `apps/webapp/src/app/[locale]/(auth)/sign-up/page.tsx`
- `apps/webapp/src/app/[locale]/(auth)/reset-password/page.tsx`
- `apps/webapp/src/app/[locale]/(auth)/verify-email/page.tsx`
- `apps/webapp/src/app/[locale]/(auth)/verify-email-pending/page.tsx`
- `apps/webapp/src/components/login-form.tsx`
- `apps/webapp/src/components/reset-password-form.tsx`

## Task 1: Establish Baseline And Shared Shell Components

**Files:**
- Create: `apps/webapp/src/components/shells/app-frame-loading.tsx`
- Create: `apps/webapp/src/components/shells/app-frame-loading.test.tsx`
- Create: `apps/webapp/src/components/shells/auth-content-loading.tsx`
- Create: `apps/webapp/src/components/shells/settings-content-loading.tsx`
- Read: `docs/refs/agent-workflow.md`
- Read: `docs/refs/project-conventions.md`
- Read: `docs/refs/design-context.md`

- [ ] **Step 1: Record the dependency baseline limitation**

Run from the worktree root:

```bash
pnpm install --frozen-lockfile
```

Expected at plan creation: FAIL because `apps/desktop/package.json` disagrees with `pnpm-lock.yaml` for `@types/react`, `@types/react-dom`, and `postcss`. Re-run before implementation because the user may repair the baseline. Do not modify desktop dependencies as part of this feature.

- [ ] **Step 2: Write the failing app-frame test**

Create `app-frame-loading.test.tsx` with assertions against generic structure and sensitive labels:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppFrameLoading } from "./app-frame-loading";

describe("AppFrameLoading", () => {
	it("renders a neutral authenticated frame without tenant data", () => {
		render(<AppFrameLoading />);

		expect(screen.getByLabelText("Loading application")).toBeInTheDocument();
		expect(screen.getByTestId("app-sidebar-loading")).toBeInTheDocument();
		expect(screen.getByTestId("app-header-loading")).toBeInTheDocument();
		expect(screen.queryByText(/organization|billing|notification/i)).not.toBeInTheDocument();
	});
});
```

- [ ] **Step 3: Run the focused test and verify red**

Run:

```bash
pnpm --dir apps/webapp test -- src/components/shells/app-frame-loading.test.tsx
```

Expected: FAIL because `./app-frame-loading` cannot be resolved.

- [ ] **Step 4: Implement the neutral shared components**

Implement `AppFrameLoading` with only `Skeleton` elements and no session-derived props:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export function AppFrameLoading() {
	return (
		<div className="flex min-h-svh w-full" aria-label="Loading application" aria-busy="true">
			<aside data-testid="app-sidebar-loading" className="hidden w-72 border-r p-4 md:block">
				<Skeleton className="mb-6 h-8 w-32" />
				<div className="space-y-3">
					{Array.from({ length: 7 }, (_, index) => (
						<Skeleton key={index} className="h-8 w-full" />
					))}
				</div>
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				<header data-testid="app-header-loading" className="flex h-12 items-center border-b px-4">
					<Skeleton className="h-7 w-40" />
				</header>
				<main className="flex-1 p-4"><Skeleton className="h-full min-h-72 w-full" /></main>
			</div>
		</div>
	);
}
```

Implement `AuthContentLoading` as a centered `Card` with heading, field, and button skeletons. Implement `SettingsContentLoading` as a padded title plus three card skeletons. Neither component accepts tenant or session props.

- [ ] **Step 5: Run tests and formatting checks**

Run:

```bash
pnpm --dir apps/webapp test -- src/components/shells/app-frame-loading.test.tsx
pnpm --dir apps/webapp exec biome check src/components/shells
```

Expected: PASS with no Biome diagnostics.

- [ ] **Step 6: Commit only if the user authorizes feature commits**

```bash
git add apps/webapp/src/components/shells
git commit -m "feat(webapp): add safe navigation shell fallbacks"
```

## Task 2: Bound The Authenticated And Root Layouts

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/layout.tsx:46-184`
- Create: `apps/webapp/src/app/[locale]/(app)/layout.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/layout.tsx:65-106`
- Modify: `apps/webapp/src/app/[locale]/layout.test.tsx`

- [ ] **Step 1: Write failing layout structure tests**

Add a source-structure regression test that confirms `AppLayout` returns Suspense before the async authenticated work and that its fallback is neutral:

```tsx
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("authenticated app shell", () => {
	it("bounds all request data behind AppFrameLoading", () => {
		const source = readFileSync(new URL("./layout.tsx", import.meta.url), "utf8");
		expect(source).toContain("<Suspense fallback={<AppFrameLoading />}>" );
		expect(source).toContain("<AuthenticatedAppLayout");
	});
});
```

Extend the locale layout test to assert the nested application-content boundary uses `AppFrameLoading` rather than `null` for primary children.

- [ ] **Step 2: Run the layout tests and verify red**

Run:

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/layout.test.tsx' 'src/app/[locale]/layout.test.tsx'
```

Expected: FAIL because the authenticated wrapper and fallback do not exist.

- [ ] **Step 3: Extract request-bound authenticated layout content**

Keep the default export synchronous and move the current function body unchanged into `AuthenticatedAppLayout`:

```tsx
export default function AppLayout(props: AppLayoutProps) {
	return (
		<Suspense fallback={<AppFrameLoading />}>
			<AuthenticatedAppLayout {...props} />
		</Suspense>
	);
}
```

Rename the current default `AppLayout` function to `AuthenticatedAppLayout` without changing its lines 52-183, then insert the wrapper above as the new default export.

Import `Suspense` and `AppFrameLoading`. Do not move any child content outside `AuthenticatedAppLayout`; unauthenticated requests must still redirect before protected children render.

- [ ] **Step 4: Replace only the primary root null fallback**

In `AppProviders`, change the nested fallback around `ApplicationContent` from `null` to `<AppFrameLoading />`. Keep the `DeploymentRefreshChecker` fallback null because it is invisible background behavior. Do not change `await params`, `<html lang={locale}>`, or translation selection until the live diagnostic sweep identifies an actual locale-root finding.

- [ ] **Step 5: Run layout tests**

Run:

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/layout.test.tsx' 'src/app/[locale]/layout.test.tsx'
```

Expected: PASS.

- [ ] **Step 6: Commit only if authorized**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/layout.tsx' 'apps/webapp/src/app/[locale]/(app)/layout.test.tsx' 'apps/webapp/src/app/[locale]/layout.tsx' 'apps/webapp/src/app/[locale]/layout.test.tsx'
git commit -m "feat(webapp): preserve authenticated app shell"
```

## Task 3: Fix Calendar And Platform Analytics URL Boundaries

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.tsx:17-34`
- Modify: `apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.tsx:15-80`
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics/analytics-controls.tsx:42-46`

- [ ] **Step 1: Write failing promise-pass-through tests**

For calendar, mock `CalendarPageContent`, call the synchronous page with unresolved promises, render it, and assert `CalendarPageLoading` is visible without resolving either promise. For analytics, assert the page source passes `searchParams` into a child under Suspense and does not await it in the default export.

Use this calendar shape:

```tsx
it("renders the calendar shell before URL data resolves", () => {
	const pending = new Promise<never>(() => {});
	render(<CalendarEmployeePage params={pending} searchParams={pending} />);
	expect(screen.getByTestId("calendar-page-loading")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run both route tests and verify red**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/calendar/[employeeId]/page.test.tsx' 'src/app/[locale]/(admin)/platform-admin/analytics/page.test.tsx'
```

Expected: FAIL because both default exports await URL data above Suspense.

- [ ] **Step 3: Pass calendar URL promises below Suspense**

Make the default export synchronous:

```tsx
export default function CalendarEmployeePage(props: CalendarEmployeePageProps) {
	return (
		<Suspense fallback={<CalendarPageLoading />}>
			<CalendarEmployeeContent {...props} />
		</Suspense>
	);
}

async function CalendarEmployeeContent({ params, searchParams }: CalendarEmployeePageProps) {
	const [{ employeeId }, { date }] = await Promise.all([params, searchParams]);
	return <CalendarPageContent requestedDate={date} selectedEmployeeId={employeeId} />;
}
```

Add `data-testid="calendar-page-loading"` to the fallback root.

- [ ] **Step 4: Split analytics shell from URL-specific content**

Keep translated static heading content in the page shell. Introduce `PlatformAnalyticsRouteContent` under a single page-level Suspense that awaits `searchParams`, parses it, and renders both controls and data sections. Remove the internal `fallback={null}` from `analytics-controls.tsx` so the parent controls skeleton can display.

The URL child signature is:

```tsx
async function PlatformAnalyticsRouteContent({
	searchParams,
}: {
	searchParams?: Promise<PlatformAnalyticsSearchParams>;
}) {
	const parsedParams = parsePlatformAnalyticsParams((await searchParams) ?? {});
	return <PlatformAnalyticsResolvedContent parsedParams={parsedParams} />;
}
```

Do not add caching to `getPlatformAnalyticsData`.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/calendar/[employeeId]/page.test.tsx' 'src/app/[locale]/(admin)/platform-admin/analytics/page.test.tsx' 'src/app/[locale]/(admin)/platform-admin/analytics/analytics-controls.test.tsx'
```

Expected: PASS.

- [ ] **Step 6: Commit only if authorized**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/analytics'
git commit -m "fix(webapp): stream URL-dependent analytics and calendar data"
```

## Task 4: Fix Payroll Readiness And Works Council Shells

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.tsx:18-48`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/works-council/page.tsx:36-81`
- Modify: `apps/webapp/src/app/[locale]/(app)/works-council/page.test.tsx`
- Read: `docs/refs/timekeeping.md`

- [ ] **Step 1: Write failing shell tests**

Add tests proving the page title or dashboard skeleton renders while request work is unresolved. For payroll readiness, mock `requireOrgAdminSettingsAccess` with a pending promise and assert the heading plus `SettingsContentLoading`. For works council, mock `requireUser` as pending and assert a new `WorksCouncilLoading` region with `aria-label="Loading works council"`.

- [ ] **Step 2: Run the tests and verify red**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/settings/payroll-readiness/page.test.tsx' 'src/app/[locale]/(app)/works-council/page.test.tsx'
```

Expected: FAIL because both pages await all request data before returning UI.

- [ ] **Step 3: Extract payroll request content**

Make the default export synchronous. Render the existing title and description outside Suspense, then place `PayrollReadinessContent` behind `SettingsContentLoading`. The child retains the existing `connection()`, org-admin requirement, `searchParams` resolution, date parsing, and organization-scoped `getPayrollReadiness` call.

Do not alter `getPayrollReadinessPeriod`, `parseUtcDate`, or their UTC semantics during this shell-only task.

- [ ] **Step 4: Extract works-council request content**

Make the default export return:

```tsx
export default function WorksCouncilPage(props: WorksCouncilPageProps) {
	return (
		<Suspense fallback={<WorksCouncilLoading />}>
			<WorksCouncilContent {...props} />
		</Suspense>
	);
}
```

Move the current `connection()`, authorization, feature check, `searchParams` read, audit write, and organization-scoped model query into `WorksCouncilContent` unchanged. The loading component must contain only generic skeletons.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/settings/payroll-readiness/page.test.tsx' 'src/app/[locale]/(app)/works-council/page.test.tsx'
```

Expected: PASS, including existing organization-scope assertions.

- [ ] **Step 6: Commit only if authorized**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness' 'apps/webapp/src/app/[locale]/(app)/works-council'
git commit -m "fix(webapp): preserve payroll and works council shells"
```

## Task 5: Bound Server-Rendered Dynamic Details

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/import/[batchId]/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/import/[batchId]/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(auth)/accept-invitation/[invitationId]/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(auth)/accept-invitation/[invitationId]/page.test.tsx`

- [ ] **Step 1: Write failing fallback tests**

For each default export, pass a never-resolving `params` promise and verify a route-specific fallback renders immediately. Employee and import use `SettingsContentLoading`; invitation uses `AuthContentLoading`.

- [ ] **Step 2: Run tests and verify red**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/settings/employees/[employeeId]/page.test.tsx' 'src/app/[locale]/(app)/settings/import/[batchId]/page.test.tsx' 'src/app/[locale]/(auth)/accept-invitation/[invitationId]/page.test.tsx'
```

Expected: FAIL because the default exports await params before returning boundaries.

- [ ] **Step 3: Add synchronous route wrappers**

Apply this pattern to each route:

```tsx
export default function DetailPage(props: DetailPageProps) {
	return (
		<Suspense fallback={<SettingsContentLoading />}>
			<DetailPageContent {...props} />
		</Suspense>
	);
}
```

Use route-specific wrapper and child names. For employee detail, move current lines 12-48 into `EmployeeDetailPageContent` and destructure `employeeId`. For import review, move current lines 15-44 into `ImportReviewRouteContent` and destructure `batchId`. For invitation acceptance, move current lines 16-55 into `AcceptInvitationPageContent` and destructure `invitationId`. Keep import review queries filtered by both `batchId` and `organizationId`. Do not move invitation organization or inviter details into the fallback.

- [ ] **Step 4: Run focused tests**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/settings/employees/[employeeId]/page.test.tsx' 'src/app/[locale]/(app)/settings/import/[batchId]/page.test.tsx' 'src/app/[locale]/(auth)/accept-invitation/[invitationId]/page.test.tsx'
```

Expected: PASS with existing redirects and tenant filters preserved.

- [ ] **Step 5: Commit only if authorized**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]' 'apps/webapp/src/app/[locale]/(app)/settings/import/[batchId]' 'apps/webapp/src/app/[locale]/(auth)/accept-invitation/[invitationId]'
git commit -m "fix(webapp): add shells for dynamic detail routes"
```

## Task 6: Bound Client Pages That Consume Params

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]/team-detail-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/employees/[employeeId]/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/vacation/employees/[employeeId]/employee-allowance-edit-page-client.tsx`
- Modify: related test files in both route directories

- [ ] **Step 1: Write failing source-boundary tests**

Assert each `page.tsx` is a server component without `"use client"`, renders Suspense with `SettingsContentLoading`, and forwards the unresolved promise to a client component. Assert `use(params)` exists only in the extracted client file.

- [ ] **Step 2: Run tests and verify red**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/settings/teams/[teamId]/*.test.tsx' 'src/app/[locale]/(app)/settings/vacation/employees/[employeeId]/*.test.tsx'
```

Expected: FAIL because both route entry files are currently client components that call `use(params)` at their roots.

- [ ] **Step 3: Extract the team client implementation**

Move the existing client file body unchanged to `team-detail-page-client.tsx`, export `TeamDetailPageClient`, and replace `page.tsx` with:

```tsx
import { Suspense } from "react";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { TeamDetailPageClient } from "./team-detail-page-client";

export default function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
	return (
		<Suspense fallback={<SettingsContentLoading />}>
			<TeamDetailPageClient params={params} />
		</Suspense>
	);
}
```

- [ ] **Step 4: Extract vacation employee client implementation**

Move all hooks and client logic to `employee-allowance-edit-page-client.tsx`. Keep the route entry as a server wrapper using the same Suspense pattern and the unresolved `employeeId` promise. Preserve existing Temporal/date behavior and organization-scoped actions.

- [ ] **Step 5: Update imports and run focused tests**

Update tests that import the default client implementation to import the named extracted client component when they need hook behavior. Keep route tests pointed at `page.tsx`.

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/settings/teams/[teamId]/*.test.tsx' 'src/app/[locale]/(app)/settings/vacation/employees/[employeeId]/*.test.tsx'
```

Expected: PASS.

- [ ] **Step 6: Commit only if authorized**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/teams/[teamId]' 'apps/webapp/src/app/[locale]/(app)/settings/vacation/employees/[employeeId]'
git commit -m "fix(webapp): bound client detail params with route shells"
```

## Task 7: Replace Primary Null Fallbacks

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/access-denied/page-client.tsx`
- Create: `apps/webapp/src/app/[locale]/access-denied/page-client.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/init/page-client.tsx`
- Modify: auth page files listed in the File Map
- Modify: `apps/webapp/src/components/login-form.tsx`
- Modify: `apps/webapp/src/components/reset-password-form.tsx`

- [ ] **Step 1: Add failing non-null fallback tests**

Use source tests for all primary boundaries:

```tsx
expect(source).not.toMatch(/<Suspense fallback=\{null\}>/);
```

Scope this assertion only to the primary route component or form boundary. Do not fail invisible background boundaries such as `DeploymentRefreshChecker`.

- [ ] **Step 2: Run affected tests and verify red**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(auth)/**/*.test.tsx' 'src/app/[locale]/(app)/approvals/inbox/page.test.tsx' 'src/app/[locale]/access-denied/page-client.test.tsx'
```

Expected: FAIL at each primary `fallback={null}`.

- [ ] **Step 3: Implement an auth-layout fallback**

Create `AuthLayoutLoading` in `layout.tsx` that renders the existing outer background color, controls placeholders, centered `AuthContentLoading`, and footer geometry. Use it at line 31 instead of null. It must not use domain branding because domain configuration has not resolved.

- [ ] **Step 4: Replace page-level null fallbacks**

Use these mappings:

- Approval inbox: a padded toolbar, table-row, and detail-panel skeleton local to `page.tsx`.
- Access denied: `AuthContentLoading` inside the full-screen centered container.
- Initialization: a centered accessible progress state with `aria-label="Initializing workspace"`.
- Sign-in, sign-up, reset password, verify email, and pending verification: `AuthContentLoading`.
- Nested login and reset-password form boundaries: the same card-sized `AuthContentLoading`, avoiding a second blank interval after the route fallback resolves.

- [ ] **Step 5: Run affected tests**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(auth)/**/*.test.tsx' 'src/app/[locale]/(app)/approvals/inbox/page.test.tsx' 'src/app/[locale]/access-denied/page-client.test.tsx'
```

Expected: PASS.

- [ ] **Step 6: Commit only if authorized**

```bash
git add 'apps/webapp/src/app/[locale]/(auth)' 'apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.tsx' 'apps/webapp/src/app/[locale]/(app)/approvals/inbox/page.test.tsx' 'apps/webapp/src/app/[locale]/access-denied' 'apps/webapp/src/app/[locale]/init/page-client.tsx' apps/webapp/src/components/login-form.tsx apps/webapp/src/components/reset-password-form.tsx
git commit -m "fix(webapp): replace blank primary navigation fallbacks"
```

## Task 8: Preserve Settings Content And Sweep Remaining Static Findings

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx:36-53`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/layout.test.tsx`
- Review: all `apps/webapp/src/app/[locale]/**/{page,layout}.tsx`

- [ ] **Step 1: Write the failing settings boundary test**

Assert that settings navigation and breadcrumbs are siblings of a Suspense boundary around only the page content:

```tsx
expect(source).toContain("<SettingsBreadcrumbs />");
expect(source).toContain("<Suspense fallback={<SettingsContentLoading />}>" );
expect(source).toContain("{children}");
```

- [ ] **Step 2: Run the test and verify red**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/settings/layout.test.tsx'
```

Expected: FAIL because children are currently unbounded.

- [ ] **Step 3: Bound only the settings content region**

Wrap the child container in Suspense while leaving navigation and breadcrumbs outside:

```tsx
<main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
	<SettingsBreadcrumbs />
	<Suspense fallback={<SettingsContentLoading />}>
		<div className="min-w-0 flex-1 overflow-auto overflow-x-hidden">{children}</div>
	</Suspense>
</main>
```

- [ ] **Step 4: Run a static URL-read inventory**

Run:

```bash
rg -n 'await (params|searchParams)|use\((params|searchParams)\)|fallback=\{null\}' apps/webapp/src/app apps/webapp/src/components -g '*.tsx'
```

Expected remaining matches:

- URL reads already below meaningful boundaries.
- Null fallbacks used only for invisible background behavior.
- Locale root `await params` retained for `<html lang>` pending live framework diagnostics.

For any additional primary route match, apply the same synchronous-wrapper pattern and add a focused source test before changing it.

- [ ] **Step 5: Run settings and route tests**

```bash
pnpm --dir apps/webapp test -- 'src/app/[locale]/(app)/settings/**/*.test.tsx'
```

Expected: PASS.

- [ ] **Step 6: Commit only if authorized**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings'
git commit -m "fix(webapp): preserve settings navigation during loading"
```

## Task 9: Full Verification And Live App-Shell Sweep

**Files:**
- Verify: `apps/webapp/next.config.ts`
- Modify only when diagnostics identify a concrete route: affected `page.tsx` or `layout.tsx`

- [ ] **Step 1: Run all focused tests**

```bash
pnpm --dir apps/webapp test -- 'src/components/shells/**/*.test.tsx' 'src/app/[locale]/(app)/layout.test.tsx' 'src/app/[locale]/layout.test.tsx' 'src/app/[locale]/(auth)/**/*.test.tsx' 'src/app/[locale]/(app)/calendar/[employeeId]/page.test.tsx' 'src/app/[locale]/(admin)/platform-admin/analytics/**/*.test.tsx' 'src/app/[locale]/(app)/settings/**/*.test.tsx' 'src/app/[locale]/(app)/works-council/page.test.tsx' 'src/app/[locale]/(app)/approvals/inbox/page.test.tsx'
```

Expected: PASS.

- [ ] **Step 2: Run repository quality checks**

```bash
pnpm --dir apps/webapp exec biome check src
pnpm --dir apps/webapp typecheck
pnpm --dir apps/webapp test
CI=true pnpm --dir apps/webapp build
```

Expected: all commands exit 0. If frozen dependency validation still blocks before compilation, report it separately and do not claim the build passed.

- [ ] **Step 3: Start the development server and run next-dev-loop preflight**

```bash
pnpm --dir apps/webapp dev
```

In another shell, derive the worktree browser session and open the authenticated app:

```bash
SESSION="$(agent-browser session id --scope worktree --prefix next-dev-loop)"
export AGENT_BROWSER_SESSION="$SESSION"
export AGENT_BROWSER_RESTORE="$SESSION"
agent-browser skills get core
agent-browser --session "$SESSION" --restore --headed --enable react-devtools open http://localhost:3000
```

Confirm `/_next/mcp` lists `get_compilation_issues`, `get_routes`, and `get_errors`. If login state is absent, pause for the user to authenticate in the headed browser and then continue with the same session.

- [ ] **Step 4: Sweep every changed feature in development**

Navigate through actual links to:

- Dashboard and Today
- Employee calendar detail
- Platform analytics with and without query parameters
- Payroll readiness with and without period parameters
- Works council with and without range parameters
- Employee, team, vacation employee, import review, and invitation details using valid local records
- Approval inbox
- Sign-in, reset password, verification, access denied, and initialization flows where reachable

After each navigation, call `get_errors` and inspect the dev log. Expected: no URL-data App Shell finding and no blocking-prerender finding for the route. Confirm the first paint includes meaningful generic structure and no stale tenant data.

- [ ] **Step 5: Resolve diagnostics from their exact docs pages**

For each distinct Next.js diagnostic URL printed by the dev server, open that docs page and apply its prescribed structural fix. If the locale root is named because `<html lang>` requires locale params, do not remove locale semantics. Use `export const instant = false` only at the narrowest route segment that cannot produce a safe shell, then record that route in the final report.

- [ ] **Step 6: Verify production prefetch behavior**

```bash
CI=true pnpm --dir apps/webapp build
pnpm --dir apps/webapp start
```

Open the production URL with the same authenticated browser session. Navigate representative default links for app, settings, admin, and auth surfaces. Expected: the shared shell paints immediately, dynamic data streams afterward, and no link generates per-link runtime-prefetch behavior.

- [ ] **Step 7: Run React and UI regression reviews**

Invoke and follow:

- `vercel-react-best-practices`
- `vercel-composition-patterns`
- `web-design-guidelines`
- `react-doctor`

Apply only findings introduced by or directly relevant to the shell changes. Re-run focused tests after any edit.

- [ ] **Step 8: Inspect final diff**

```bash
git status --short
git diff --check
git diff --stat dev...HEAD
git diff dev...HEAD -- apps/webapp
```

Expected: only shell components, affected route/layout files, tests, and the implementation plan differ. No lockfile, desktop package, generated auth schema, or tenant authorization changes are included.

- [ ] **Step 9: Final commit only if authorized**

```bash
git add apps/webapp docs/superpowers/plans/2026-08-10-webapp-partial-prefetching-shells.md
git commit -m "feat(webapp): complete partial prefetching shells"
```

Do not commit generated files, dependency baseline changes, or unrelated concurrent edits.
