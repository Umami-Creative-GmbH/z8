# Settings Sticky Category Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make settings category headers sticky on mobile and desktop in both the settings grid and settings navbar while preserving existing navigation and visibility behavior.

**Architecture:** Update the existing `SettingsGrid` section heading and `SettingsNav` group label usage so CSS handles sticky behavior. Keep the navbar change local to the settings layout/nav instead of changing the shared sidebar primitive, and verify class output with focused component/source tests.

**Tech Stack:** Next.js, React, Tailwind CSS, Vitest, pnpm.

---

### Task 1: Sticky Settings Grid Headers

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-grid.tsx`
- Test: `apps/webapp/src/components/settings/settings-grid.test.tsx`

- [ ] **Step 1: Add a focused render test**

Create `apps/webapp/src/components/settings/settings-grid.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsGrid } from "./settings-grid";
import type { SettingsEntry, SettingsGroupConfig } from "./settings-config";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useOrganizationSettings: () => ({ isHydrated: true }),
}));

vi.mock("@/components/settings/settings-card", () => ({
	SettingsCard: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe("SettingsGrid", () => {
	const visibleGroups: SettingsGroupConfig[] = [
		{
			id: "account",
			labelKey: "settings.group.account",
			labelDefault: "Account",
		},
	];

	const visibleSettings: SettingsEntry[] = [
		{
			id: "profile",
			titleKey: "settings.profile.title",
			titleDefault: "Profile",
			descriptionKey: "settings.profile.description",
			descriptionDefault: "Manage your profile",
			href: "/settings/profile",
			icon: "user-circle",
			minimumTier: "member",
			group: "account",
		},
	];

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders category headings as sticky scroll headers", () => {
		render(<SettingsGrid visibleSettings={visibleSettings} visibleGroups={visibleGroups} />);

		expect(screen.getByRole("heading", { name: "Account" })).toHaveClass(
			"sticky",
			"top-0",
			"z-10"
		);
	});
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter webapp test src/components/settings/settings-grid.test.tsx`

Expected: FAIL because the heading does not yet include `sticky`, `top-0`, and `z-10`.

- [ ] **Step 3: Implement sticky header classes**

In `apps/webapp/src/components/settings/settings-grid.tsx`, replace the heading with:

```tsx
<h2 className="sticky top-0 z-10 -mx-1 mb-4 bg-background px-1 py-2 text-lg font-medium">
	{t(group.labelKey, group.labelDefault)}
</h2>
```

- [ ] **Step 4: Run the targeted test**

Run: `pnpm --filter webapp test src/components/settings/settings-grid.test.tsx`

Expected: PASS.

### Task 2: Sticky Settings Navbar Labels

**Files:**
- Modify: `apps/webapp/src/components/settings/settings-nav.tsx`
- Test: `apps/webapp/src/components/settings/settings-nav-component.test.tsx`

- [ ] **Step 1: Add a focused render test**

Create `apps/webapp/src/components/settings/settings-nav-component.test.tsx` with:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SettingsNav } from "./settings-nav";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("@/navigation", () => ({
	Link: ({ children, href }: { children: ReactNode; href: string }) => (
		<a href={href}>{children}</a>
	),
	usePathname: () => "/settings/profile",
}));

vi.mock("@/stores/organization-settings-store", () => ({
	useOrganizationSettings: () => ({ isHydrated: true }),
}));

beforeAll(() => {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			dispatchEvent: vi.fn(),
		})),
	});
});

describe("SettingsNav", () => {
	it("renders group labels as sticky scroll headers", () => {
		render(
			<SidebarProvider>
				<SettingsNav accessTier="orgAdmin" billingEnabled={true} />
			</SidebarProvider>,
		);

		const accountLabel = screen.getByText("Account");

		expect(accountLabel.className).toContain("sticky");
		expect(accountLabel.className).toContain("top-0");
		expect(accountLabel.className).toContain("z-10");
		expect(accountLabel.className).toContain("bg-card");
	});
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter webapp test src/components/settings/settings-nav-component.test.tsx`

Expected: FAIL because the group label does not yet include `sticky`, `top-0`, `z-10`, and `bg-card`.

- [ ] **Step 3: Implement sticky label classes**

In `apps/webapp/src/components/settings/settings-nav.tsx`, replace the group label with:

```tsx
<SidebarGroupLabel className="sticky top-0 z-10 bg-card">
	{t(group.labelKey, group.labelDefault)}
</SidebarGroupLabel>
```

- [ ] **Step 4: Run the targeted test**

Run: `pnpm --filter webapp test src/components/settings/settings-nav-component.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run broader verification**

Run: `pnpm --filter webapp test src/components/settings/settings-config.test.ts src/components/settings/settings-nav.test.ts src/components/settings/settings-grid.test.tsx src/components/settings/settings-nav-component.test.tsx`

Expected: PASS.

### Task 3: Flush Settings Navbar Sticky Label Surface

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx`
- Modify: `apps/webapp/src/components/settings/settings-nav.tsx`
- Test: `apps/webapp/src/components/settings/settings-nav-component.test.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/settings-layout-source.test.ts`

- [ ] **Step 1: Update the focused render test**

In `apps/webapp/src/components/settings/settings-nav-component.test.tsx`, extend the sticky label assertions with:

```tsx
expect(accountLabel.className).toContain("bg-card");
expect(accountLabel.className).toContain("rounded-none");
expect(accountLabel.className).toContain("px-4");
expect(accountGroup?.className).toContain("p-0");
```

Create `apps/webapp/src/app/[locale]/(app)/settings/settings-layout-source.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("settings layout sidebar", () => {
	it("keeps the settings nav scroll container flush for sticky headers", () => {
		const source = readFileSync("src/app/[locale]/(app)/settings/layout.tsx", "utf8");

		expect(source).toContain('className="w-64 border-r bg-card hidden md:block overflow-auto"');
		expect(source).not.toContain('className="w-64 border-r bg-card p-4 hidden md:block overflow-auto"');
	});
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter webapp test src/components/settings/settings-nav-component.test.tsx`

Expected: FAIL because the group label/layout do not yet use the settings navbar `bg-card` surface without scroll-container padding.

- [ ] **Step 3: Implement flush sticky label classes**

In `apps/webapp/src/components/settings/settings-nav.tsx`, replace the group with:

```tsx
<SidebarGroup key={group.id} className="p-0">
	<SidebarGroupLabel className="sticky top-0 z-10 rounded-none bg-card px-4">
		{t(group.labelKey, group.labelDefault)}
	</SidebarGroupLabel>
	<SidebarGroupContent className="px-2 pb-2">
		{/* existing menu */}
	</SidebarGroupContent>
</SidebarGroup>
```

In `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx`, remove `p-4` from the settings nav `aside` and move loading padding to the skeleton wrapper.

- [ ] **Step 4: Run the focused test**

Run: `pnpm --filter webapp test src/components/settings/settings-nav-component.test.tsx 'src/app/[locale]/(app)/settings/settings-layout-source.test.ts'`

Expected: PASS.

- [ ] **Step 5: Run broader verification**

Run: `pnpm --filter webapp test src/components/settings/settings-config.test.ts src/components/settings/settings-nav.test.ts src/components/settings/settings-grid.test.tsx src/components/settings/settings-nav-component.test.tsx 'src/app/[locale]/(app)/settings/settings-layout-source.test.ts'`

Expected: PASS.
