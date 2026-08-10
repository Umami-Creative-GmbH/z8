# Webapp Selective Cache Components Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the highly dynamic authenticated webapp useful non-sensitive shells and focused streaming boundaries while preserving request-fresh authorization, tenant data, and API behavior.

**Architecture:** Cache only public bundled translations by locale. Move Better Auth, billing, permissions, organization selection, and live product data into request-time components below meaningful Suspense boundaries; review each page/layout `connection()` rather than removing it mechanically. Keep existing durable cache helpers unless their persistence and invalidation semantics can be preserved.

**Tech Stack:** Next.js 16.3 App Router, React 19 Server Components and Suspense, Better Auth, Tolgee, next-intl, Drizzle, Vitest, Next.js MCP, agent-browser.

---

## Baseline And File Map

Run all commands from the repository worktree root unless a step specifies `apps/webapp`.

The current full webapp suite has an unrelated dependency baseline failure after lockfile reconciliation. Do not treat those failures as caused by this work. Every focused test introduced or changed by this plan must pass, and typecheck/build/runtime verification remains mandatory. If the corrected lockfile lands on `dev`, fast-forward or rebase before final verification.

New focused modules:

- `apps/webapp/src/tolgee/load-translations.ts`: server-only locale translation cache.
- `apps/webapp/src/app/[locale]/(app)/app-layout-content.tsx`: existing authenticated request-time gates and resolved UI.
- `apps/webapp/src/app/[locale]/(app)/app-layout-shell.tsx`: prop-free neutral authenticated shell.
- `apps/webapp/src/app/[locale]/(admin)/admin-layout-content.tsx`: existing platform-admin authorization and resolved UI.
- `apps/webapp/src/app/[locale]/(admin)/admin-layout-shell.tsx`: prop-free neutral admin shell.
- `apps/webapp/src/app/[locale]/(app)/cache-components-route-contract.test.ts`: explicit page/layout `connection()` inventory.

Existing modules retain these responsibilities:

- `apps/webapp/src/app/[locale]/layout.tsx`: static locale document and providers.
- `apps/webapp/src/tolgee/shared.ts`: client-safe translation constants, imports, and merge functions.
- `apps/webapp/src/tolgee/server.tsx`: server translator without implicit pathname/header discovery.
- `apps/webapp/src/app/[locale]/(app)/layout.tsx`: thin Suspense coordinator only.
- `apps/webapp/src/app/[locale]/(admin)/layout.tsx`: thin Suspense coordinator only.
- `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx`: independently streaming settings navigation, breadcrumbs, and page content.
- Product `page.tsx` files: static feature frame plus focused request-time content.

### Task 1: Make Translation Loading Locale-Only And Cacheable

**Files:**
- Create: `apps/webapp/src/tolgee/load-translations.ts`
- Modify: `apps/webapp/src/tolgee/shared.ts:206-217`
- Modify: `apps/webapp/src/tolgee/server.tsx:1-27`
- Modify: `apps/webapp/src/app/[locale]/layout.tsx:1-46,82-98`
- Modify: `apps/webapp/src/tolgee/shared.test.ts:1-120`
- Modify: `apps/webapp/src/app/[locale]/layout.test.tsx:43-48,153-156,209-257`
- Test: `apps/webapp/src/tolgee/shared.test.ts`
- Test: `apps/webapp/src/app/[locale]/layout.test.tsx`

- [ ] **Step 1: Write the failing locale-only loader tests**

Move the `loadRouteTranslations` import from `./shared` to `./load-translations`, mock `cacheLife`, and change all calls to one argument:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_LANGUAGES, ALL_NAMESPACES, mergeTreeTranslations } from "./shared";

const mockCacheLife = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
	cacheLife: mockCacheLife,
}));

import { loadRouteTranslations } from "./load-translations";

beforeEach(() => {
	mockCacheLife.mockClear();
});

it("uses locale as the only input for bundled translations", async () => {
	const translations = await loadRouteTranslations("de");

	expect(loadRouteTranslations).toHaveLength(1);
	expect(mockCacheLife).toHaveBeenCalledWith("max");
	expect(translations.de).toMatchObject({
		appSearch: { searchOrRunCommand: "Suchen oder Befehl ausführen" },
	});
});
```

Update the existing dashboard, analytics, and today assertions to call `loadRouteTranslations("de")` or `loadRouteTranslations("en")` without a pathname.

- [ ] **Step 2: Run the Tolgee test to verify RED**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/tolgee/shared.test.ts"
```

Expected: FAIL because `./load-translations` does not exist and no cache lifetime is configured.

- [ ] **Step 3: Add the server-only cached loader and remove the old shared export**

Create `apps/webapp/src/tolgee/load-translations.ts`:

```ts
import "server-only";

import type { TolgeeStaticData } from "@tolgee/react";
import { cacheLife } from "next/cache";
import { ALL_NAMESPACES, loadNamespaces } from "./shared";

export async function loadRouteTranslations(locale: string): Promise<TolgeeStaticData> {
	"use cache";
	cacheLife("max");

	return loadNamespaces(locale, ALL_NAMESPACES);
}
```

Delete only the existing `loadRouteTranslations(locale, pathname)` function from `shared.ts`. Keep `getNamespacesForRoute` and its tests because other code may still use the mapping.

- [ ] **Step 4: Run the Tolgee test to verify GREEN**

Run the command from Step 2.

Expected: PASS with the locale-only cache test and existing namespace-content assertions green.

- [ ] **Step 5: Write failing root-layout dependency and fallback tests**

Hoist a loader mock in `layout.test.tsx`:

```ts
const mockState = vi.hoisted(() => ({
	getSession: vi.fn(async () => null),
	findUserSettings: vi.fn(),
	headers: vi.fn(async () => new Headers({ "x-pathname": "/en/sign-in" })),
	loadRouteTranslations: vi.fn(async (_locale: string) => ({})),
	setRequestLocale: vi.fn(),
}));

vi.mock("@/tolgee/shared", () => ({
	ALL_LANGUAGES: ["en"],
}));

vi.mock("@/tolgee/load-translations", () => ({
	loadRouteTranslations: mockState.loadRouteTranslations,
}));
```

Replace the test that requires nested `fallback={null}` with:

```ts
it("loads root translations from locale alone", async () => {
	const layout = await LocaleLayout({
		children: <div>Auth content</div>,
		params: Promise.resolve({ locale: "en" }),
	});
	const stream = await renderToReadableStream(layout);
	const reader = stream.getReader();
	while (!(await reader.read()).done) {}

	expect(mockState.loadRouteTranslations).toHaveBeenCalledWith("en");

	const source = readFileSync("src/app/[locale]/layout.tsx", "utf8");
	expect(source).not.toContain('from "next/headers"');
	expect(source).not.toContain("DOMAIN_HEADERS");
	expect(source).not.toContain("pathname");
});

it("keeps route content visible in the translation fallback", () => {
	const source = readFileSync("src/app/[locale]/layout.tsx", "utf8");

	expect(source).toMatch(
		/<TranslationProviders locale=\{locale\} records=\{\{\}\}>\s*<ApplicationContent>\{children\}<\/ApplicationContent>\s*<\/TranslationProviders>/,
	);
	expect(source).not.toMatch(
		/<TranslationProviders locale=\{locale\} records=\{\{\}\}>\s*<Suspense fallback=\{null\}>/,
	);
});
```

- [ ] **Step 6: Run the root-layout test to verify RED**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/layout.test.tsx"
```

Expected: FAIL because the layout still imports `headers`, derives `pathname`, and nests a null Suspense fallback.

- [ ] **Step 7: Remove the root request dependency and preserve useful fallback content**

In `layout.tsx`, remove `headers` and `DOMAIN_HEADERS` imports, import `loadRouteTranslations` from `@/tolgee/load-translations`, and use:

```tsx
async function TranslationProvider({ locale, children }: { locale: string; children: ReactNode }) {
	const records = await loadRouteTranslations(locale).catch((error) => {
		console.warn("Failed to load Tolgee records:", error);
		return {};
	});

	return (
		<TranslationProviders locale={locale} records={records}>
			{children}
		</TranslationProviders>
	);
}
```

Use this translation fallback while retaining the deployment checker’s separate `fallback={null}`:

```tsx
<Suspense
	fallback={
		<TranslationProviders locale={locale} records={{}}>
			<ApplicationContent>{children}</ApplicationContent>
		</TranslationProviders>
	}
>
	<TranslationProvider locale={locale}>
		<ApplicationContent>{children}</ApplicationContent>
	</TranslationProvider>
</Suspense>
```

In `tolgee/server.tsx`, remove implicit headers/pathname discovery and initialize from bundled namespaces by language:

```ts
import { createServerInstance } from "@tolgee/react/server";
import { getLocale } from "next-intl/server";
import { ALL_NAMESPACES, loadNamespaces, TolgeeBase } from "./shared";

export const { getTolgee, getTranslate, T } = createServerInstance({
	getLocale,
	createTolgee: async (language) => {
		const staticData = await loadNamespaces(language, ALL_NAMESPACES);
		return TolgeeBase().init({
			observerOptions: { fullKeyEncode: false },
			language,
			staticData,
		});
	},
});
```

- [ ] **Step 8: Run focused translation tests and commit**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/tolgee/shared.test.ts" "src/tolgee/__tests__/shared-route-namespaces.test.ts" "src/tolgee/client.test.tsx" "src/app/[locale]/layout.test.tsx"
```

Expected: PASS.

Commit:

```bash
git add apps/webapp/src/tolgee apps/webapp/src/app/'[locale]'/layout.tsx apps/webapp/src/app/'[locale]'/layout.test.tsx
git commit -m "perf: cache locale translation bundles"
```

### Task 2: Extract A Neutral Authenticated Application Shell

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/app-layout-shell.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/app-layout-shell.test.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/app-layout-content.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/layout.test.ts`

- [ ] **Step 1: Write a failing neutral-shell test**

Create `app-layout-shell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AuthenticatedAppShell } from "./app-layout-shell";

describe("AuthenticatedAppShell", () => {
	it("renders only neutral loading geometry", () => {
		render(<AuthenticatedAppShell />);

		expect(screen.getByRole("main", { name: "Loading application" })).toHaveAttribute(
			"aria-busy",
			"true",
		);
		expect(screen.queryByText("Example User")).not.toBeInTheDocument();
		expect(screen.queryByText("Example Organization")).not.toBeInTheDocument();
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
	});

	it("has no request, tenant, or billing dependency", () => {
		const source = readFileSync(
			"src/app/[locale]/(app)/app-layout-shell.tsx",
			"utf8",
		);
		for (const forbidden of ["@/lib/auth", "@/db", "BillingEnforcement", "organizationId", "children"]) {
			expect(source).not.toContain(forbidden);
		}
	});
});
```

- [ ] **Step 2: Run the shell test to verify RED**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/app-layout-shell.test.tsx"
```

Expected: FAIL because `app-layout-shell.tsx` does not exist.

- [ ] **Step 3: Implement the prop-free shell**

Create `app-layout-shell.tsx` with no props:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function AuthenticatedAppShell() {
	return (
		<SidebarProvider
			style={{
				"--sidebar-width": "calc(var(--spacing) * 72)",
				"--header-height": "calc(var(--spacing) * 12)",
			} as React.CSSProperties}
		>
			<aside aria-hidden="true" className="hidden w-(--sidebar-width) shrink-0 border-r md:block">
				<div className="space-y-3 p-4">
					<Skeleton className="h-8 w-28" />
					{Array.from({ length: 7 }, (_, index) => (
						<Skeleton className="h-8 w-full" key={index} />
					))}
				</div>
			</aside>
			<SidebarInset>
				<header aria-hidden="true" className="flex h-(--header-height) items-center border-b px-4">
					<Skeleton className="h-5 w-40" />
				</header>
				<main
					aria-busy="true"
					aria-label="Loading application"
					className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-6"
				>
					<Skeleton className="h-8 w-48" />
					<Skeleton className="h-5 w-full max-w-2xl" />
					<Skeleton className="min-h-64 w-full flex-1" />
				</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
```

- [ ] **Step 4: Run the shell test to verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write a failing layout-coordinator contract**

Extend `layout.test.ts`:

```ts
it("streams request-time authenticated content behind a neutral shell", () => {
	const source = stripComments(readFileSync(join(APP_ROUTE_ROOT, "layout.tsx"), "utf8"));

	expect(source).toContain("<Suspense fallback={<AuthenticatedAppShell />}");
	expect(source).toContain("<AuthenticatedAppContent params={params}>{children}</AuthenticatedAppContent>");
	expect(source).not.toContain("headers()");
	expect(source).not.toContain("auth.api.getSession");
});
```

- [ ] **Step 6: Run the layout test to verify RED**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/layout.test.ts"
```

Expected: FAIL because request-time work still lives at the layout top level.

- [ ] **Step 7: Move existing request-time behavior unchanged and make the layout synchronous**

Move the current imports, constants, `AppLayoutProps`, and async function body from `layout.tsx` to `app-layout-content.tsx`. Rename the exported function without changing its ordering or query predicates:

```tsx
export async function AuthenticatedAppContent({ children, params }: AppLayoutProps) {
	const [{ locale }, headersList] = await Promise.all([params, headers()]);
	const session = await auth.api.getSession({ headers: headersList });

	if (!session?.user) {
		const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || `/${locale}`;
		redirect(
			`/api/auth/session-expired?locale=${locale}&callbackUrl=${encodeURIComponent(pathname)}`,
		);
	}

	// Keep the remaining locale, organization, billing, membership, and provider logic unchanged.
}
```

Replace `layout.tsx` with:

```tsx
import { Suspense } from "react";
import { AuthenticatedAppContent } from "./app-layout-content";
import { AuthenticatedAppShell } from "./app-layout-shell";

interface AppLayoutProps {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}

export default function AppLayout({ children, params }: AppLayoutProps) {
	return (
		<Suspense fallback={<AuthenticatedAppShell />}>
			<AuthenticatedAppContent params={params}>{children}</AuthenticatedAppContent>
		</Suspense>
	);
}
```

Do not render `children` in `AuthenticatedAppShell`. Do not alter the existing fail-closed billing catch, recovery-path predicates, membership query, subscription query, or redirect targets.

- [ ] **Step 8: Run focused app-layout tests and commit**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/app-layout-shell.test.tsx" "src/app/[locale]/(app)/layout.test.ts" "src/app/[locale]/(app)/billing/suspended/page.test.tsx"
```

Expected: PASS.

Commit:

```bash
git add apps/webapp/src/app/'[locale]'/'(app)'/layout.tsx apps/webapp/src/app/'[locale]'/'(app)'/layout.test.ts apps/webapp/src/app/'[locale]'/'(app)'/app-layout-*
git commit -m "perf: stream the authenticated app shell"
```

### Task 3: Extract Admin Shell And Isolate Shared URL Hooks

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/admin-layout-shell.tsx`
- Create: `apps/webapp/src/app/[locale]/(admin)/admin-layout-shell.test.tsx`
- Create: `apps/webapp/src/app/[locale]/(admin)/admin-layout-content.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/settings-layout-source.test.ts`
- Modify: `apps/webapp/src/components/app-sidebar.tsx`

- [ ] **Step 1: Write failing admin shell and settings boundary tests**

Create `admin-layout-shell.test.tsx` using the same structure as the authenticated shell test, asserting `aria-label="Loading admin console"`, no links, and no fixture identity.

Extend `settings-layout-source.test.ts`:

```ts
it("streams request-bound navigation and URL breadcrumbs independently", () => {
	const source = readFileSync("src/app/[locale]/(app)/settings/layout.tsx", "utf8");

	expect(source).not.toContain("connection()");
	expect(source).toContain("<Suspense fallback={<SettingsNavigationLoading />}");
	expect(source).toContain("<Suspense fallback={<SettingsBreadcrumbsLoading />}");
	expect(source.match(/\{children\}/g)).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(admin)/admin-layout-shell.test.tsx" "src/app/[locale]/(app)/settings/settings-layout-source.test.ts"
```

Expected: FAIL because the admin shell is missing, settings still calls `connection()`, and breadcrumbs lack a boundary.

- [ ] **Step 3: Implement the neutral admin shell and coordinator**

The shell is prop-free and contains only generic geometry:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export function AdminLayoutShell() {
	return (
		<div className="min-h-screen bg-background">
			<header aria-hidden="true" className="flex h-16 items-center border-b px-6">
				<Skeleton className="size-9 rounded-lg" />
				<Skeleton className="ml-3 h-5 w-36" />
				<Skeleton className="ml-auto size-8 rounded-full" />
			</header>
			<main aria-busy="true" aria-label="Loading admin console" className="mx-auto max-w-screen-2xl space-y-4 px-6 py-8">
				<Skeleton className="h-8 w-52" />
				<Skeleton className="h-64 w-full" />
			</main>
		</div>
	);
}
```

Move the current async admin body unchanged into `AdminLayoutContent`, then make `layout.tsx` synchronous:

```tsx
import { Suspense } from "react";
import { AdminLayoutContent } from "./admin-layout-content";
import { AdminLayoutShell } from "./admin-layout-shell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
	return (
		<Suspense fallback={<AdminLayoutShell />}>
			<AdminLayoutContent>{children}</AdminLayoutContent>
		</Suspense>
	);
}
```

Preserve `redirect("/sign-in")` for missing sessions and `redirect("/")` for non-admin users.

- [ ] **Step 4: Remove the obsolete settings layout marker and add breadcrumb fallback**

Remove the `connection` import and `await connection()` from `SettingsNavigation`. Add:

```tsx
function SettingsBreadcrumbsLoading() {
	return (
		<div aria-hidden="true" className="mb-4 flex h-9 items-center gap-2 px-6 pt-4">
			<Skeleton className="size-4" />
			<Skeleton className="h-4 w-40" />
		</div>
	);
}
```

Render breadcrumbs as:

```tsx
<Suspense fallback={<SettingsBreadcrumbsLoading />}>
	<SettingsBreadcrumbs />
</Suspense>
```

- [ ] **Step 5: Add local sidebar pathname boundaries**

Import `Suspense` in `app-sidebar.tsx`. Wrap `NavMain`, `NavTeam`, and `NavSecondary` individually. Their fallbacks must use `SidebarMenuSkeleton` rows and must not render guessed links or capability labels:

```tsx
<Suspense fallback={<SidebarNavigationLoading rows={8} />}>
	<NavMain items={navPersonal} />
</Suspense>
```

Implement `SidebarNavigationLoading` in the same file using the existing `SidebarMenu`, `SidebarMenuItem`, and `SidebarMenuSkeleton` primitives.

- [ ] **Step 6: Update existing admin source tests for the extracted content module**

Where `platform-admin/layout.test.ts` reads `(admin)/layout.tsx`, read both coordinator and content source:

```ts
const layoutSource = readFileSync(join(ADMIN_ROUTE_ROOT, "../layout.tsx"), "utf8");
const contentSource = readFileSync(join(ADMIN_ROUTE_ROOT, "../admin-layout-content.tsx"), "utf8");
const source = `${layoutSource}\n${contentSource}`;
```

Keep all existing redirect, navigation-label, and user-identity assertions against the combined source.

- [ ] **Step 7: Run focused tests and commit**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(admin)/admin-layout-shell.test.tsx" "src/app/[locale]/(admin)/platform-admin/layout.test.ts" "src/app/[locale]/(app)/settings/settings-layout-source.test.ts" "src/components/site-header.test.tsx" "src/components/nav-main.test.tsx" "src/components/nav-team.test.tsx" "src/components/nav-secondary.test.tsx"
```

Expected: PASS.

Commit:

```bash
git add apps/webapp/src/app/'[locale]'/'(admin)' apps/webapp/src/app/'[locale]'/'(app)'/settings/layout.tsx apps/webapp/src/app/'[locale]'/'(app)'/settings/settings-layout-source.test.ts apps/webapp/src/components/app-sidebar.tsx
git commit -m "perf: isolate admin and navigation shells"
```

### Task 4: Establish A Test-Enforced `connection()` Inventory

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/cache-components-route-contract.test.ts`
- Modify: page/layout files listed by the test as each route group is adopted

- [ ] **Step 1: Write the failing inventory test**

Create a source contract that excludes API Route Handlers and records only deliberately retained page/layout calls:

```ts
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

const APP_ROOT = "src/app";
const ALLOWED_CONNECTION_FILES = new Set([
	"src/app/[locale]/(auth)/layout.tsx",
	"src/app/[locale]/onboarding/layout.tsx",
	"src/app/[locale]/(app)/payroll/page.tsx",
	"src/app/[locale]/(app)/absences/page.tsx",
	"src/app/[locale]/(app)/works-council/page.tsx",
	"src/app/[locale]/(app)/settings/wellness/page.tsx",
	"src/app/[locale]/(app)/settings/payroll-readiness/page.tsx",
	"src/app/[locale]/(app)/settings/vacation/employees/page.tsx",
]);

describe("Cache Components route escape hatches", () => {
	it("keeps connection only for reviewed synchronous or per-request behavior", () => {
		const routeFiles = globSync(`${APP_ROOT}/**/{page,layout}.tsx`);
		const filesWithConnection = routeFiles
			.filter((file) => readFileSync(file, "utf8").includes("connection()"))
			.sort();

		expect(filesWithConnection).toEqual([...ALLOWED_CONNECTION_FILES].sort());
	});
});
```

If the repository TypeScript target does not expose `node:fs` `globSync`, use the existing test helper or the `glob` package already present in the workspace; do not add a dependency.

- [ ] **Step 2: Run the inventory test to verify RED**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/cache-components-route-contract.test.ts"
```

Expected: FAIL and print the current 51 page plus 4 layout call sites not included in the reviewed allowlist.

- [ ] **Step 3: Add a contract for meaningful boundaries before marker removal**

In the same test file, add:

```ts
const ROUTES_REQUIRING_LOCAL_SUSPENSE = [
	"src/app/[locale]/(app)/organization/page.tsx",
	"src/app/[locale]/(app)/calendar/page.tsx",
	"src/app/[locale]/(app)/time-tracking/page.tsx",
	"src/app/[locale]/(app)/team/absences/page.tsx",
	"src/app/[locale]/(app)/settings/locations/page.tsx",
	"src/app/[locale]/(app)/settings/locations/[locationId]/page.tsx",
	"src/app/[locale]/(app)/settings/approval-policies/page.tsx",
	"src/app/[locale]/(app)/settings/change-policies/page.tsx",
	"src/app/[locale]/(app)/settings/permissions/page.tsx",
	"src/app/[locale]/(app)/settings/work-categories/page.tsx",
];

it.each(ROUTES_REQUIRING_LOCAL_SUSPENSE)("keeps a non-null local shell in %s", (file) => {
	const source = readFileSync(file, "utf8");
	expect(source).toContain("<Suspense");
	expect(source).toMatch(/fallback=\{<[^>]+\/?>\}/);
});
```

- [ ] **Step 4: Run the test and preserve the failure list as the route work queue**

Run the Step 2 command.

Expected: FAIL until Tasks 5-7 remove obsolete markers and provide boundaries.

### Task 5: Remove Obsolete Markers From Routes That Already Have Focused Suspense

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/calendar/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/locations/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/locations/[locationId]/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/approval-policies/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/change-policies/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/permissions/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/work-categories/page.tsx`
- Test: existing adjacent `page.test.tsx` files and `cache-components-route-contract.test.ts`

- [ ] **Step 1: Run representative behavior tests before editing**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/calendar/page.test.tsx" "src/app/[locale]/(app)/team/absences/page.test.tsx" "src/app/[locale]/(app)/cache-components-route-contract.test.ts"
```

Expected: behavior tests PASS; contract test FAIL because markers remain.

- [ ] **Step 2: Remove only `connection` imports and calls from the listed content components**

Use this exact transformation inside the existing Suspense boundary:

```tsx
// Before
async function PageContent() {
	await connection();
	const data = await loadRequestFreshData();
	return <Feature data={data} />;
}

// After
async function PageContent() {
	const data = await loadRequestFreshData();
	return <Feature data={data} />;
}
```

Do not add `use cache`; uncached data remains request-fresh. Do not change authorization, organization predicates, redirects, params, or searchParams handling.

- [ ] **Step 3: Run representative behavior and route-contract tests**

Run the Step 1 command.

Expected: behavior tests PASS; contract test has a smaller failure list.

- [ ] **Step 4: Commit the low-risk route group**

```bash
git add apps/webapp/src/app/'[locale]'/'(app)'/organization apps/webapp/src/app/'[locale]'/'(app)'/calendar apps/webapp/src/app/'[locale]'/'(app)'/time-tracking apps/webapp/src/app/'[locale]'/'(app)'/team/absences apps/webapp/src/app/'[locale]'/'(app)'/settings apps/webapp/src/app/'[locale]'/'(app)'/cache-components-route-contract.test.ts
git commit -m "perf: stream request-fresh route content"
```

### Task 6: Add Focused Shells To Remaining Dynamic Product And Settings Routes

**Files:**
- Modify product pages: `apps/webapp/src/app/[locale]/(app)/page.tsx`, `today/page.tsx`, `scheduling/page.tsx`, `travel-expenses/page.tsx`, `my-requests/page.tsx`, `reports/page.tsx`, `reports/projects/page.tsx`
- Modify settings pages: `avv/page.tsx`, `shifts/page.tsx`, `statistics/page.tsx`, `compliance/page.tsx`, `implementation-checklist/page.tsx`, `surcharges/page.tsx`, `change-policies/page.tsx`, `payroll-access/page.tsx`, `vacation/page.tsx`, `calendar/page.tsx`, `work-policies/page.tsx`, `roles/page.tsx`, `projects/page.tsx`, `holidays/page.tsx`, `compliance/works-council/page.tsx`, `telegram/page.tsx`, `email-templates/page.tsx`, `enterprise/email/page.tsx`, `skills/page.tsx`, `billing/page.tsx`, `organizations/page.tsx`, `travel-expenses/page.tsx`, `customers/page.tsx`
- Modify admin pages: `apps/webapp/src/app/[locale]/(admin)/platform-admin/page.tsx`, `analytics/page.tsx`, `billing/page.tsx`, `diagnostics/page.tsx`, `worker-queue/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(auth)/verify-2fa/page.tsx`
- Test: adjacent tests plus `cache-components-route-contract.test.ts`

- [ ] **Step 1: Extend the route contract with every route in this task**

Add each listed path to `ROUTES_REQUIRING_LOCAL_SUSPENSE`. Run the contract test.

Expected: FAIL for pages that still render as a direct async component or use a null fallback.

- [ ] **Step 2: Extract request-time content without changing data behavior**

For each direct async page, make the default export synchronous and pass unresolved route promises to an async child:

```tsx
export default function Page(props: PageProps) {
	return (
		<Suspense fallback={<PageLoading />}>
			<PageContent {...props} />
		</Suspense>
	);
}

async function PageContent(props: PageProps) {
	// Existing auth, params, searchParams, redirects, and uncached queries move here unchanged.
}
```

Use an existing feature skeleton where present. Otherwise add a local `PageLoading` that renders the existing static title/description plus `Skeleton` geometry. Never use `fallback={null}` for primary content.

- [ ] **Step 3: Remove obsolete broad markers from the extracted content**

Delete the `connection` import and call after the content is below non-null Suspense. Keep all data uncached. For `Promise.all` placeholders, transform:

```ts
const [t, access] = await Promise.all([getTranslate(), requireOrgAdminSettingsAccess()]);
```

Do not retain an unused first tuple element.

- [ ] **Step 4: Run feature-group tests after each directory group**

Settings access group:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/settings/__tests__/settings-route-access.test.ts" "src/app/[locale]/(app)/settings/settings-layout-source.test.ts" "src/app/[locale]/(app)/cache-components-route-contract.test.ts"
```

Admin group:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(admin)/platform-admin/layout.test.ts" "src/app/[locale]/(app)/cache-components-route-contract.test.ts"
```

Auth group:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(auth)/verify-2fa/page.test.tsx" "src/app/[locale]/(app)/cache-components-route-contract.test.ts"
```

Expected: adjacent behavior tests PASS and the inventory failure list shrinks to the deliberate allowlist.

- [ ] **Step 5: Commit product groups separately**

Use review-sized commits after each passing group:

```bash
git commit -m "perf: add settings route shells"
git commit -m "perf: add product route shells"
git commit -m "perf: stream platform admin data"
```

Stage only files belonging to each group before its commit.

### Task 7: Narrow And Document Deliberate Request-Time Escape Hatches

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(auth)/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/onboarding/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/layout.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/payroll/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/works-council/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/wellness/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/vacation/employees/page.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/cache-components-route-contract.test.ts`

- [ ] **Step 1: Remove the obsolete analytics layout marker behind an authorization shell**

Wrap the existing analytics authorization content in a non-null Suspense boundary, preserve all role checks, then remove its `connection()` import/call. Add the analytics layout to `ROUTES_REQUIRING_LOCAL_SUSPENSE`, not `ALLOWED_CONNECTION_FILES`.

- [ ] **Step 2: Keep random selection request-time in auth and onboarding**

Retain `await connection()` immediately before `selectRandomAuthBackgroundImage()` and use this reason comment:

```ts
// Random background selection must run at request time, outside the prerendered shell.
await connection();
const backgroundImage = selectRandomAuthBackgroundImage();
```

Ensure both layouts have meaningful non-null outer fallbacks. Do not cache trusted Host classification, custom-domain configuration, Turnstile configuration, or cookie-consent script selection.

- [ ] **Step 3: Keep current-period calculations request-time without moving business timezone logic**

For payroll, absences, payroll readiness, and vacation employees, retain `connection()` immediately before the existing current-time call. Do not migrate Luxon/current date logic in this performance change. Add a concise reason identifying the business period determined by the request-time instant.

- [ ] **Step 4: Preserve per-view Works Council audit behavior**

Retain `connection()` before the existing permission/date/audit flow with this reason:

```ts
// This protected view must execute per request so authorization and audit recording are not reused.
await connection();
```

Do not cache the Works Council model, authorization result, or audit side effect.

- [ ] **Step 5: Preserve the Effect runtime marker for wellness**

Keep the existing wellness `connection()` immediately before the Effect program that invokes current-time operations. Rewrite only generic “fully dynamic” wording to state that synchronous current-time access requires request execution.

- [ ] **Step 6: Run the inventory test to verify GREEN**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/app/[locale]/(app)/cache-components-route-contract.test.ts"
```

Expected: PASS with exactly the eight reviewed files in `ALLOWED_CONNECTION_FILES` and no unexplained page/layout marker.

- [ ] **Step 7: Commit the deliberate dynamic-route review**

```bash
git add apps/webapp/src/app/'[locale]'
git commit -m "refactor: document request-time route boundaries"
```

### Task 8: Verify Cache Safety And Preserve Durable Existing Caches

**Files:**
- Modify only if tests expose a mismatch: `apps/webapp/src/lib/cache/tags.ts`
- Modify only if tests expose a mismatch: `apps/webapp/src/lib/cache/query-cache.ts`
- Test: `apps/webapp/src/lib/cache/tags.test.ts`
- Test: `apps/webapp/src/components/dashboard/hydration-team-streak-leaders-query.test.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/teams/actions.scope.test.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/wellness/actions.cache.test.ts`

- [ ] **Step 1: Run tenant cache scope and invalidation tests**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/lib/cache/tags.test.ts" "src/components/dashboard/hydration-team-streak-leaders-query.test.ts" "src/app/[locale]/(app)/settings/teams/actions.scope.test.ts" "src/app/[locale]/(app)/wellness/actions.cache.test.ts"
```

Expected: PASS. If a test fails, fix only the organization key/tag mismatch it demonstrates; do not broadly migrate caches.

- [ ] **Step 2: Confirm no session or tenant request API entered a public cache scope**

Run:

```bash
rg -n -U '"use cache"[\s\S]{0,120}(cookies|headers|connection)\(' apps/webapp/src
```

Expected: no matches. The only new public cache scope is `tolgee/load-translations.ts`, keyed by locale.

- [ ] **Step 3: Confirm every new tenant cache argument and query is organization-scoped**

If implementation introduced any cache beyond translations, inspect it and require both:

```ts
async function getDataForOrganization(organizationId: string) {
	"use cache";
	cacheTag(CACHE_TAGS.DATA(organizationId));
	return db.query.table.findMany({ where: eq(table.organizationId, organizationId) });
}
```

If either the argument or SQL predicate is absent, remove that cache boundary rather than weakening tenant isolation.

- [ ] **Step 4: Commit only if cache safety tests required a code change**

```bash
git add apps/webapp/src/lib/cache apps/webapp/src/components/dashboard apps/webapp/src/app/'[locale]'/'(app)'/settings
git commit -m "fix: scope cache invalidation by organization"
```

Skip the commit when no code changed.

### Task 9: Runtime Route Sweep And Final Verification

**Files:**
- Modify only routes identified by Next.js diagnostics
- Update: `apps/webapp/src/app/[locale]/(app)/cache-components-route-contract.test.ts` only when a deliberate retained route is proven necessary

- [ ] **Step 1: Run focused changed tests**

Run:

```bash
pnpm --dir apps/webapp exec vitest run "src/tolgee/shared.test.ts" "src/app/[locale]/layout.test.tsx" "src/app/[locale]/(app)/app-layout-shell.test.tsx" "src/app/[locale]/(app)/layout.test.ts" "src/app/[locale]/(admin)/admin-layout-shell.test.tsx" "src/app/[locale]/(admin)/platform-admin/layout.test.ts" "src/app/[locale]/(app)/settings/settings-layout-source.test.ts" "src/app/[locale]/(app)/cache-components-route-contract.test.ts"
```

Expected: PASS with zero focused failures.

- [ ] **Step 2: Run type checking**

Run:

```bash
pnpm --dir apps/webapp typecheck
```

Expected: PASS.

- [ ] **Step 3: Start Turbopack and perform next-dev-loop preflight**

Run the development server in a persistent shell:

```bash
pnpm --dir apps/webapp dev
```

In another shell, obtain the version-matched browser guide and stable worktree session:

```bash
agent-browser skills get core
SESSION="$(agent-browser session id --scope worktree --prefix next-dev-loop)"
export AGENT_BROWSER_SESSION="$SESSION"
export AGENT_BROWSER_RESTORE="$SESSION"
agent-browser --session "$SESSION" --restore --headed --enable react-devtools open http://localhost:3000/en
```

Probe `http://localhost:3000/_next/mcp` with `tools/list`, `get_compilation_issues`, and `get_routes`. Expected: MCP reachable, Turbopack available, no compilation issues.

- [ ] **Step 4: Verify representative authenticated and admin routes**

Visit and inspect:

```text
/en
/en/calendar
/en/time-tracking
/en/team/absences?year=2026
/en/settings
/en/settings/locations
/en/settings/billing
/en/settings/payroll-readiness
/en/platform-admin
/en/platform-admin/analytics?range=30d&bucket=week
/en/sign-in
/en/verify-2fa
```

For each route verify:

- Neutral geometry appears before request data.
- No user, organization, billing, permission, or tenant record appears in fallback content.
- Fallback resolves to real content.
- Redirect and `notFound()` behavior is unchanged.
- MCP reports no blocking-prerender or client-hook error.
- Browser console has no hydration/runtime error.

Use `get_page_metadata` to confirm the expected segment files and React inspection to verify shared shell and local Suspense boundaries.

- [ ] **Step 5: Verify request-fresh behavior**

On `/en/time-tracking`, perform a clock mutation and confirm refreshed state is visible. On settings and admin routes, confirm navigation capability changes do not appear before authorized content resolves. Verify a missing/expired session never exposes protected child DOM. Verify billing-check failure still redirects outside recovery paths.

- [ ] **Step 6: Run the production build**

Run:

```bash
CI=true pnpm --dir apps/webapp build
```

Expected: PASS with no Cache Components blocking route errors. If the unrelated lockfile mismatch still prevents the command from reaching Next.js, report it as the exact external blocker and do not claim the build passes.

- [ ] **Step 7: Run the full webapp suite and separate baseline failures**

Run:

```bash
pnpm --dir apps/webapp test
```

Expected after corrected baseline: PASS. If the known dependency baseline remains, confirm every focused test from Step 1 passes and report the unchanged unrelated failure count separately.

- [ ] **Step 8: Run React diagnostics on changed components**

Invoke the `react-doctor` skill and follow its local triage workflow for the changed React files. Expected: no new high-confidence accessibility, architecture, or performance finding.

- [ ] **Step 9: Close browser session and inspect final diff**

```bash
agent-browser --session "$SESSION" --restore close
git status --short
git diff --check
git diff --stat dev...HEAD
```

Expected: only approved Cache Components adoption files and plan/spec documentation are changed; `git diff --check` is clean.

- [ ] **Step 10: Commit final diagnostic fixes if needed**

```bash
git add apps/webapp
git commit -m "fix: resolve cache component diagnostics"
```

Skip the commit if no final code changes were needed.
