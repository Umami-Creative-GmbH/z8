# Platform Admin Mobile Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a left-side mobile offscreen menu to platform-admin and improve mobile readability for platform settings cards.

**Architecture:** Keep the current platform-admin desktop header nav intact. Add a focused client component that renders a mobile-only trigger and left `Sheet` from the existing server-built `navItems` array, sharing active-link logic with desktop actions. Make settings rows responsive with class changes only.

**Tech Stack:** Next.js App Router, React client components, Radix/Shadcn `Sheet`, Tabler icons, Tailwind classes, Tolgee translations, Vitest source-guard tests.

---

## File Structure

- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin-header-actions.tsx`: export shared active-link helper and icon map so mobile and desktop nav cannot drift.
- Create `apps/webapp/src/app/[locale]/(admin)/platform-admin-mobile-menu.tsx`: client-only mobile trigger plus left offscreen sheet rendering platform-admin nav items.
- Modify `apps/webapp/src/app/[locale]/(admin)/layout.tsx`: import and render the mobile menu button before the Admin Console identity.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/settings/page.tsx`: stack Turnstile rows on mobile and keep desktop row layout at `sm` and above.
- Modify `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`: add source-guard coverage for mobile menu wiring and settings responsive classes.

---

### Task 1: Add Failing Layout And Mobile Menu Tests

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`
- Test target: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`

- [ ] **Step 1: Add source-guard tests for the mobile menu**

Add these tests inside the existing `describe("platform admin layout", () => { ... })` block, after the `keeps the language switcher close to the exit admin action` test:

```ts
	it("renders a left-side mobile admin menu before the admin identity", () => {
		const source = stripComments(readFileSync(join(PLATFORM_ADMIN_ROOT, "../layout.tsx"), "utf8"));

		expect(source).toContain("PlatformAdminMobileMenu");
		expect(source).toContain("openMenuLabel={t(");
		expect(source).toContain('"Open admin menu"');
		expect(source.indexOf("<PlatformAdminMobileMenu")).toBeLessThan(
			source.indexOf('href="/platform-admin"'),
		);
	});

	it("defines the platform admin mobile menu as a left sheet using shared nav state", () => {
		const source = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "../platform-admin-mobile-menu.tsx"), "utf8"),
		);

		expect(source).toContain('"use client"');
		expect(source).toContain("SheetTrigger asChild");
		expect(source).toContain('side="left"');
		expect(source).toContain("IconMenu2");
		expect(source).toContain("platformAdminIcons[item.icon]");
		expect(source).toContain("isActivePlatformAdminItem(pathname, item)");
		expect(source).toContain("bg-accent text-accent-foreground");
	});

	it("exports shared platform admin nav helpers for desktop and mobile", () => {
		const source = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "../platform-admin-header-actions.tsx"), "utf8"),
		);

		expect(source).toContain("export const platformAdminIcons");
		expect(source).toContain("export function isActivePlatformAdminItem");
	});
```

- [ ] **Step 2: Add source-guard test for settings mobile rows**

Add this test inside the same `describe` block:

```ts
	it("stacks platform settings environment rows on mobile", () => {
		const source = stripComments(
			readFileSync(join(PLATFORM_ADMIN_ROOT, "settings/page.tsx"), "utf8"),
		);

		expect(source).toContain("flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between");
		expect(source).toContain("break-all text-left sm:text-right");
	});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: FAIL because `platform-admin-mobile-menu.tsx` does not exist, `PlatformAdminMobileMenu` is not wired, helpers are not exported, and settings responsive classes are missing.

---

### Task 2: Share Platform Admin Nav Helpers

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin-header-actions.tsx`
- Test target: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`

- [ ] **Step 1: Export the icon map and active helper**

In `platform-admin-header-actions.tsx`, change the icon map and active helper declarations to exported declarations:

```ts
export const platformAdminIcons = {
	analytics: IconChartLine,
	billing: IconCreditCard,
	diagnostics: IconActivityHeartbeat,
	organizations: IconBuilding,
	overview: IconChartBar,
	settings: IconSettings,
	systemEmailTemplates: IconMailCog,
	users: IconUsers,
	workerQueue: IconServer,
} satisfies Record<string, ComponentType<{ className?: string; "aria-hidden"?: "true" }>>;
```

```ts
export function isActivePlatformAdminItem(pathname: string, item: PlatformAdminNavItem) {
	if (item.href === "/platform-admin") {
		return pathname === item.href;
	}

	return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
```

- [ ] **Step 2: Run the targeted test**

Run:

```bash
pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: still FAIL because the mobile menu component and layout wiring are not implemented yet, but the shared-helper test should now pass.

- [ ] **Step 3: Commit shared helper change**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin-header-actions.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
git commit -m "test: cover platform admin mobile menu"
```

Expected: commit succeeds if committing is part of the selected execution mode. If commits are not allowed in the current environment, skip this commit and continue without modifying unrelated files.

---

### Task 3: Create Mobile Offscreen Admin Menu

**Files:**
- Create: `apps/webapp/src/app/[locale]/(admin)/platform-admin-mobile-menu.tsx`
- Test target: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`

- [ ] **Step 1: Create the mobile menu component**

Create `platform-admin-mobile-menu.tsx` with this content:

```tsx
"use client";

import { IconMenu2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Link, usePathname } from "@/navigation";
import {
	isActivePlatformAdminItem,
	platformAdminIcons,
	type PlatformAdminNavItem,
} from "./platform-admin-header-actions";

type PlatformAdminMobileMenuProps = {
	navItems: readonly PlatformAdminNavItem[];
	openMenuLabel: string;
	menuTitle: string;
};

export function PlatformAdminMobileMenu({
	navItems,
	openMenuLabel,
	menuTitle,
}: PlatformAdminMobileMenuProps) {
	const pathname = usePathname();

	return (
		<Sheet>
			<SheetTrigger asChild>
				<Button
					aria-label={openMenuLabel}
					className="md:hidden"
					size="icon"
					variant="ghost"
				>
					<IconMenu2 className="size-5" aria-hidden="true" />
				</Button>
			</SheetTrigger>
			<SheetContent className="w-80 max-w-[85vw] gap-0 bg-background p-0" side="left">
				<SheetHeader className="border-b px-5 py-4 text-left">
					<SheetTitle>{menuTitle}</SheetTitle>
				</SheetHeader>
				<nav className="flex flex-col gap-1 p-3" aria-label={menuTitle}>
					{navItems.map((item) => {
						const isActive = isActivePlatformAdminItem(pathname, item);
						const Icon = platformAdminIcons[item.icon];

						return (
							<Link
								key={item.href}
								href={item.href}
								className={cn(
									"flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
									isActive
										? "bg-accent text-accent-foreground"
										: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
								)}
							>
								<Icon className="size-4" aria-hidden="true" />
								<span>{item.label}</span>
							</Link>
						);
					})}
				</nav>
			</SheetContent>
		</Sheet>
	);
}
```

- [ ] **Step 2: Run the targeted test**

Run:

```bash
pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: still FAIL because `layout.tsx` does not render `PlatformAdminMobileMenu` and settings classes are not changed yet.

---

### Task 4: Wire Mobile Menu Into Admin Header

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/layout.tsx`
- Test target: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`

- [ ] **Step 1: Import the mobile menu**

Add this import in `layout.tsx` near the existing platform-admin header imports:

```ts
import { PlatformAdminMobileMenu } from "./platform-admin-mobile-menu";
```

- [ ] **Step 2: Render the trigger before the Admin Console identity**

Inside the left header group, immediately before the branding `Link`, add:

```tsx
<PlatformAdminMobileMenu
	navItems={navItems}
	openMenuLabel={t("admin:admin.layout.openMenu", "Open admin menu")}
	menuTitle={t("admin:admin.layout.menuTitle", "Admin Menu")}
/>
```

The surrounding header left group should still look like this structurally:

```tsx
<div className="flex items-center gap-8">
	<PlatformAdminMobileMenu
		navItems={navItems}
		openMenuLabel={t("admin:admin.layout.openMenu", "Open admin menu")}
		menuTitle={t("admin:admin.layout.menuTitle", "Admin Menu")}
	/>

	<Link
		href="/platform-admin"
		className="group flex items-center gap-3 transition-opacity hover:opacity-80"
	>
```

- [ ] **Step 3: Run the targeted test**

Run:

```bash
pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: still FAIL only on the settings responsive class test.

- [ ] **Step 4: Commit mobile menu implementation**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/layout.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin-mobile-menu.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin-header-actions.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
git commit -m "feat: add platform admin mobile menu"
```

Expected: commit succeeds if committing is part of the selected execution mode. If commits are not allowed in the current environment, skip this commit and continue without modifying unrelated files.

---

### Task 5: Improve Platform Settings Mobile Cards

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/settings/page.tsx`
- Test target: `apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts`

- [ ] **Step 1: Stack Turnstile environment rows on mobile**

Replace both Turnstile setting row wrappers with this responsive class:

```tsx
<div className="flex flex-col items-start gap-1 rounded-lg border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
```

Replace both Turnstile `code` elements with this class:

```tsx
<code className="break-all text-left text-xs text-muted-foreground sm:text-right" translate="no">
```

The first row should become:

```tsx
<div className="flex flex-col items-start gap-1 rounded-lg border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
	<span className="text-sm font-medium">
		{t("admin:admin.settings.turnstile.siteKey", "Site Key")}
	</span>
	<code className="break-all text-left text-xs text-muted-foreground sm:text-right" translate="no">
		TURNSTILE_SITE_KEY
	</code>
</div>
```

The second row should become:

```tsx
<div className="flex flex-col items-start gap-1 rounded-lg border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
	<span className="text-sm font-medium">
		{t("admin:admin.settings.turnstile.secretKey", "Secret Key")}
	</span>
	<code className="break-all text-left text-xs text-muted-foreground sm:text-right" translate="no">
		TURNSTILE_SECRET_KEY
	</code>
</div>
```

- [ ] **Step 2: Run the targeted test**

Run:

```bash
pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: PASS.

- [ ] **Step 3: Commit settings mobile card change**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(admin)/platform-admin/settings/page.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
git commit -m "fix: improve platform settings mobile layout"
```

Expected: commit succeeds if committing is part of the selected execution mode. If commits are not allowed in the current environment, skip this commit and continue without modifying unrelated files.

---

### Task 6: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run the targeted platform-admin test**

Run:

```bash
pnpm vitest run 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run formatting/lint check if available in current workflow**

Run:

```bash
pnpm lint
```

Expected: PASS, or report the exact missing script/error if this repository does not expose `pnpm lint`.

- [ ] **Step 3: Manual mobile verification**

Run the dev server if needed:

```bash
pnpm dev
```

Expected manual checks:

1. At a mobile viewport on `/platform-admin`, a menu button is visible on the left side of the header.
2. Tapping the button opens a left offscreen menu titled `Admin Menu`.
3. The active platform-admin page is highlighted.
4. Desktop navigation still appears at `md` and above.
5. At a mobile viewport on `/platform-admin/settings`, Turnstile setting rows stack label above environment variable.

- [ ] **Step 4: Inspect git diff before handoff**

Run:

```bash
git diff -- 'apps/webapp/src/app/[locale]/(admin)/layout.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin-mobile-menu.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin-header-actions.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/settings/page.tsx' 'apps/webapp/src/app/[locale]/(admin)/platform-admin/layout.test.ts'
```

Expected: only the intended mobile menu, helper export, settings responsive classes, and tests are changed.
