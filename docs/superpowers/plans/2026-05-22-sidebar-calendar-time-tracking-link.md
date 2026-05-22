# Sidebar Calendar and Time Tracking Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Calendar directly below Time Tracking in the sidebar and add a `View Calendar` link to the Time Entries card on `/time-tracking`.

**Architecture:** This is a small client UI change using existing navigation arrays and card header actions. The sidebar order changes in `AppSidebar`; the time-tracking link is added in `TimeEntriesTable` using the app's localized `Link` helper and existing button styling.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Testing Library, shadcn-style UI components, `@tabler/icons-react`, Tolgee translations.

---

## File Structure

- Modify: `apps/webapp/src/components/app-sidebar.tsx` reorders `navPersonal` entries.
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx` adds an order assertion for the relevant primary nav links.
- Modify: `apps/webapp/src/components/time-tracking/time-entries-table.tsx` adds the `View Calendar` link in the card header.
- Create: `apps/webapp/src/components/time-tracking/time-entries-table.test.tsx` covers the new link without exercising the full table implementation.

## Task 1: Sidebar Navigation Order

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx`
- Modify: `apps/webapp/src/components/app-sidebar.tsx`

- [ ] **Step 1: Write the failing sidebar order test**

Add this test after the existing `renders My Requests as a primary personal navigation item` test in `apps/webapp/src/components/app-sidebar.test.tsx`:

```tsx
it("orders Calendar after Time Tracking and before My Requests", () => {
	render(<AppSidebar />);

	expect(navMainSpy.mock.lastCall?.[0].map((item) => item.url).slice(1, 4)).toEqual([
		"/time-tracking",
		"/calendar",
		"/my-requests",
	]);
});
```

- [ ] **Step 2: Run the focused sidebar test and verify it fails**

Run: `pnpm vitest run apps/webapp/src/components/app-sidebar.test.tsx --testNamePattern "orders Calendar"`

Expected: FAIL because the current order is `/time-tracking`, `/my-requests`, `/calendar`.

- [ ] **Step 3: Reorder `navPersonal` entries**

In `apps/webapp/src/components/app-sidebar.tsx`, move the Calendar object so the relevant section reads:

```tsx
		{
			title: t("nav.time-tracking", "Time Tracking"),
			url: "/time-tracking",
			icon: IconClock,
		},
		{
			title: t("nav.calendar", "Calendar"),
			url: "/calendar",
			icon: IconCalendarEvent,
		},
		{
			title: t("nav.my-requests", "My Requests"),
			url: "/my-requests",
			icon: IconFileDescription,
		},
```

- [ ] **Step 4: Run the focused sidebar test and verify it passes**

Run: `pnpm vitest run apps/webapp/src/components/app-sidebar.test.tsx --testNamePattern "orders Calendar"`

Expected: PASS.

## Task 2: Time Entries Calendar Link

**Files:**
- Create: `apps/webapp/src/components/time-tracking/time-entries-table.test.tsx`
- Modify: `apps/webapp/src/components/time-tracking/time-entries-table.tsx`

- [ ] **Step 1: Write the failing time entries table test**

Create `apps/webapp/src/components/time-tracking/time-entries-table.test.tsx` with:

```tsx
/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { TimeEntriesTable } from "./time-entries-table";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
	}),
}));

vi.mock("next/dynamic", () => ({
	default: (loader: () => Promise<unknown>) => {
		void loader;
		return function DynamicMock() {
			return <button type="button">Add manual entry</button>;
		};
	},
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({
		refresh: vi.fn(),
	}),
}));

vi.mock("@/components/data-table-server", () => ({
	DataTable: () => <div data-testid="data-table" />,
}));

vi.mock("@/components/time-tracking/time-entries-table-columns", () => ({
	getTimeEntriesColumns: () => [],
}));

vi.mock("@/app/[locale]/(app)/time-tracking/actions/mutations", () => ({
	approveWorkPeriod: vi.fn(),
}));

describe("TimeEntriesTable", () => {
	it("links to the calendar from the table header", () => {
		render(
			<TimeEntriesTable
				workPeriods={[]}
				hasManager={false}
				canApproveTimeEntries={false}
				employeeTimezone="Europe/Berlin"
				timeFormat="24h"
				employeeId="employee-1"
			/>,
		);

		expect(screen.getByRole("link", { name: "View Calendar" }).getAttribute("href")).toBe(
			"/calendar",
		);
	});
});
```

- [ ] **Step 2: Run the focused time entries table test and verify it fails**

Run: `pnpm vitest run apps/webapp/src/components/time-tracking/time-entries-table.test.tsx`

Expected: FAIL because no `View calendar` link exists yet.

- [ ] **Step 3: Add the calendar link implementation**

In `apps/webapp/src/components/time-tracking/time-entries-table.tsx`:

1. Change the icon import to include `IconCalendarEvent`:

```tsx
import { IconCalendarEvent, IconCheck, IconDotsVertical } from "@tabler/icons-react";
```

2. Change the navigation import to include `Link`:

```tsx
import { Link, useRouter } from "@/navigation";
```

3. Replace the card header action container with:

```tsx
				<div className="flex items-center gap-2">
					<Button asChild variant="outline" size="sm">
						<Link href="/calendar">
							<IconCalendarEvent className="size-4" aria-hidden="true" />
							{t("timeTracking.table.viewCalendar", "View Calendar")}
						</Link>
					</Button>
					<ManualTimeEntryDialog
						employeeId={employeeId}
						employeeTimezone={employeeTimezone}
						hasManager={hasManager}
						onSuccess={() => router.refresh()}
					/>
				</div>
```

- [ ] **Step 4: Run the focused time entries table test and verify it passes**

Run: `pnpm vitest run apps/webapp/src/components/time-tracking/time-entries-table.test.tsx`

Expected: PASS.

## Task 3: Verification

**Files:**
- Verify: `apps/webapp/src/components/app-sidebar.test.tsx`
- Verify: `apps/webapp/src/components/time-tracking/time-entries-table.test.tsx`
- Verify: `apps/webapp/src/components/time-tracking/time-entries-table.tsx`
- Verify: `apps/webapp/src/components/app-sidebar.tsx`

- [ ] **Step 1: Run affected tests**

Run: `pnpm vitest run apps/webapp/src/components/app-sidebar.test.tsx apps/webapp/src/components/time-tracking/time-entries-table.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run TypeScript/lint check if available through the standard test command**

Run: `pnpm test -- --run apps/webapp/src/components/app-sidebar.test.tsx apps/webapp/src/components/time-tracking/time-entries-table.test.tsx`

Expected: PASS for the targeted tests. If the project-level test wrapper does not accept file arguments, use the passing `pnpm vitest run ...` command from Step 1 as the verification result.

- [ ] **Step 3: Inspect final diff**

Run: `git diff -- apps/webapp/src/components/app-sidebar.tsx apps/webapp/src/components/app-sidebar.test.tsx apps/webapp/src/components/time-tracking/time-entries-table.tsx apps/webapp/src/components/time-tracking/time-entries-table.test.tsx docs/superpowers/specs/2026-05-22-sidebar-calendar-time-tracking-link-design.md docs/superpowers/plans/2026-05-22-sidebar-calendar-time-tracking-link.md`

Expected: Diff only contains the sidebar order change, new calendar link, related tests, and the planning/spec documents.

## Self-Review

- Spec coverage: Task 1 covers sidebar ordering. Task 2 covers the `Time Entries` card header link. Task 3 covers verification.
- Placeholder scan: No placeholders remain.
- Type consistency: Tests and implementation use existing component props and the existing `Link`/`useRouter` navigation module.
