# Platform Admin Sidebar Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/platform-admin` link below `Feedback` in the left sidebar for platform admins only.

**Architecture:** `ServerAppSidebar` derives a dedicated `showPlatformAdminNav` boolean from the authenticated user's platform role and passes it to `AppSidebar`. `AppSidebar` conditionally appends the link to secondary navigation without reusing org-admin settings state.

**Tech Stack:** Next.js, React, TypeScript, Vitest, Testing Library, Tabler icons, Tolgee translation defaults.

---

## File Structure

- Modify `apps/webapp/src/components/app-sidebar.tsx`: add `showPlatformAdminNav` prop, import `IconServerCog`, and conditionally append the `Platform Admin` secondary navigation item after `Feedback`.
- Modify `apps/webapp/src/components/server-app-sidebar.tsx`: compute `showPlatformAdminNav` from `authContext?.user.role === "admin"` and pass it to `AppSidebar`.
- Modify `apps/webapp/src/components/app-sidebar.test.tsx`: add tests for the conditional secondary link and server prop derivation, keeping org-admin and platform-admin concepts separate.

### Task 1: Client Sidebar Conditional Link

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.tsx`

- [ ] **Step 1: Add failing tests for the client sidebar link**

In `apps/webapp/src/components/app-sidebar.test.tsx`, update the Tabler icon import at the top:

```tsx
import {
	IconBeach,
	IconHelp,
	IconMessageCircle,
	IconServerCog,
	IconShieldCheck,
} from "@tabler/icons-react";
```

Add these tests after the existing `renders help and feedback entries in secondary navigation` test:

```tsx
	it("hides platform admin navigation by default", () => {
		render(<AppSidebar />);

		expect(screen.queryByRole("link", { name: "Platform Admin" })).toBeNull();
		expect(navSecondarySpy).toHaveBeenLastCalledWith(
			expect.not.arrayContaining([
				expect.objectContaining({
					title: "Platform Admin",
					url: "/platform-admin",
				}),
			]),
		);
	});

	it("renders platform admin navigation below feedback when enabled", () => {
		render(<AppSidebar showPlatformAdminNav />);

		expect(screen.getByRole("link", { name: "Platform Admin" }).getAttribute("href")).toBe(
			"/platform-admin",
		);

		const secondaryItems = navSecondarySpy.mock.lastCall?.[0] ?? [];
		expect(secondaryItems).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Platform Admin",
					url: "/platform-admin",
					icon: IconServerCog,
				}),
			]),
		);
		expect(secondaryItems.map((item) => item.title).slice(-2)).toEqual([
			"Feedback",
			"Platform Admin",
		]);
	});
```

- [ ] **Step 2: Run the focused sidebar tests and verify failure**

Run:

```bash
pnpm vitest run apps/webapp/src/components/app-sidebar.test.tsx
```

Expected: FAIL because `showPlatformAdminNav` does not exist on `AppSidebarProps`, `IconServerCog` is not imported in `app-sidebar.tsx`, and the `Platform Admin` link is not rendered.

- [ ] **Step 3: Implement the minimal client sidebar change**

In `apps/webapp/src/components/app-sidebar.tsx`, ensure `IconServerCog` is imported from `@tabler/icons-react` with the other icons:

```tsx
	IconSettings,
	IconServerCog,
	IconShieldCheck,
```

Add the prop to `AppSidebarProps`:

```tsx
	showPlatformAdminNav?: boolean;
```

Default it in the component parameters:

```tsx
	showPlatformAdminNav = false,
```

Append the conditional link immediately after the `Feedback` item in `navSecondary`:

```tsx
		{
			title: t("nav.feedback", "Feedback"),
			url: "https://feedback.z8-time.app/",
			icon: IconMessageCircle,
		},
		...(showPlatformAdminNav
			? [
					{
						title: t("nav.platform-admin", "Platform Admin"),
						url: "/platform-admin",
						icon: IconServerCog,
					},
				]
			: []),
```

- [ ] **Step 4: Run focused sidebar tests and verify pass for client cases**

Run:

```bash
pnpm vitest run apps/webapp/src/components/app-sidebar.test.tsx
```

Expected: the new client tests pass. Existing server-sidebar assertions may still need updates in Task 2.

### Task 2: Server Prop Derivation

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`
- Modify: `apps/webapp/src/components/server-app-sidebar.tsx`

- [ ] **Step 1: Add failing tests for server-derived platform admin state**

In the existing `passes showComplianceNav from the org-admin settings tier at runtime` test in `apps/webapp/src/components/app-sidebar.test.tsx`, include a non-platform user role in the first mocked auth context:

```tsx
		getAuthContextMock.mockResolvedValue({
			user: {
				role: "user",
			},
			employee: {
				organizationId: "org_1",
				role: "admin",
			},
		});
```

Add `showPlatformAdminNav: false` to the first expected props object:

```tsx
				showPlatformAdminNav: false,
```

Add `showPlatformAdminNav: false` to the second expected props object:

```tsx
				showPlatformAdminNav: false,
```

Add this new test after the existing server-sidebar runtime test:

```tsx
	it("passes platform admin navigation from the authenticated platform role", async () => {
		vi.stubEnv("BILLING_ENABLED", "false");
		getUserOrganizationsMock.mockResolvedValue([{ id: "org_1", shiftsEnabled: false }]);
		getAuthContextMock.mockResolvedValue({
			user: {
				role: "admin",
			},
			employee: {
				organizationId: "org_1",
				role: "employee",
			},
		});
		getCurrentSettingsAccessTierMock.mockResolvedValueOnce("member");

		vi.doMock("@/lib/auth-helpers", () => ({
			getUserOrganizations: getUserOrganizationsMock,
			getAuthContext: getAuthContextMock,
			getCurrentSettingsAccessTier: getCurrentSettingsAccessTierMock,
		}));

		vi.doMock("./app-sidebar", () => ({
			AppSidebar: (props: Record<string, unknown>) => {
				appSidebarSpy(props);
				return <div data-testid="server-sidebar-proxy" />;
			},
		}));

		const { ServerAppSidebar } = await import("./server-app-sidebar");

		render(await ServerAppSidebar({}));

		expect(screen.getByTestId("server-sidebar-proxy")).toBeTruthy();
		expect(appSidebarSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				showPlatformAdminNav: true,
				employeeRole: "employee",
				settingsAccessTier: "member",
			}),
		);
	});
```

- [ ] **Step 2: Run focused sidebar tests and verify failure**

Run:

```bash
pnpm vitest run apps/webapp/src/components/app-sidebar.test.tsx
```

Expected: FAIL because `ServerAppSidebar` does not pass `showPlatformAdminNav` yet.

- [ ] **Step 3: Implement server-derived prop**

In `apps/webapp/src/components/server-app-sidebar.tsx`, pass the prop to `AppSidebar`:

```tsx
			showPlatformAdminNav={authContext?.user.role === "admin"}
```

Place it near the existing role and access props:

```tsx
			showComplianceNav={settingsAccessTier === "orgAdmin"}
			showPlatformAdminNav={authContext?.user.role === "admin"}
			settingsAccessTier={settingsAccessTier ?? "member"}
```

- [ ] **Step 4: Run focused sidebar tests and verify pass**

Run:

```bash
pnpm vitest run apps/webapp/src/components/app-sidebar.test.tsx
```

Expected: PASS for all tests in `app-sidebar.test.tsx`.

### Task 3: Verification

**Files:**
- Verify: `apps/webapp/src/components/app-sidebar.tsx`
- Verify: `apps/webapp/src/components/server-app-sidebar.tsx`
- Verify: `apps/webapp/src/components/app-sidebar.test.tsx`

- [ ] **Step 1: Run type/lint-relevant project verification**

Run the focused test first:

```bash
pnpm vitest run apps/webapp/src/components/app-sidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the broader test suite if time allows**

Run:

```bash
pnpm test
```

Expected: PASS, or report any unrelated pre-existing failures with exact failing test names.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff -- apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx docs/superpowers/specs/2026-05-17-platform-admin-sidebar-link-design.md docs/superpowers/plans/2026-05-17-platform-admin-sidebar-link.md
```

Expected: diff only contains the sidebar link feature, spec, and plan.

- [ ] **Step 4: Commit only if explicitly requested**

If the user explicitly asks for a commit, run:

```bash
git status --short
git add apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/server-app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx docs/superpowers/specs/2026-05-17-platform-admin-sidebar-link-design.md docs/superpowers/plans/2026-05-17-platform-admin-sidebar-link.md
git commit -m "feat: add platform admin sidebar link"
```

Expected: commit succeeds and includes only intended files.

## Self-Review

- Spec coverage: the plan adds a dedicated server-derived platform-admin prop, appends the link below feedback, keeps org-admin state separate, and tests both visible and hidden states.
- Placeholder scan: no TBD/TODO placeholders are present.
- Type consistency: the prop name is consistently `showPlatformAdminNav`, the route is consistently `/platform-admin`, and the label is consistently `Platform Admin`.
