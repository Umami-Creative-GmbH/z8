# Sidebar Personal Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the webapp personal sidebar items while leaving Team navigation unchanged.

**Architecture:** The personal sidebar is defined by the static `navPersonal` array in `apps/webapp/src/components/app-sidebar.tsx`. The implementation changes only that array order and updates the existing `AppSidebar` unit test to assert the full personal navigation sequence.

**Tech Stack:** Next.js, React, Vitest, Testing Library, pnpm.

---

### Task 1: Personal Sidebar Order

**Files:**
- Modify: `apps/webapp/src/components/app-sidebar.test.tsx:163-171`
- Modify: `apps/webapp/src/components/app-sidebar.tsx:86-128`

- [ ] **Step 1: Write the failing test**

Replace the existing partial order test in `apps/webapp/src/components/app-sidebar.test.tsx` with a full personal order assertion:

```tsx
it("orders personal navigation items", () => {
	render(<AppSidebar />);

	expect(navMainSpy.mock.lastCall?.[0].map((item) => item.url)).toEqual([
		"/",
		"/time-tracking",
		"/calendar",
		"/absences",
		"/travel-expenses",
		"/my-requests",
		"/reports",
		"/organization",
	]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/webapp/src/components/app-sidebar.test.tsx --runInBand`

Expected: the order assertion fails because `My Requests` and `Org Explorer` currently appear before `Absences`, `Travel Expenses`, and `Reports`.

- [ ] **Step 3: Write minimal implementation**

Reorder only the `navPersonal` entries in `apps/webapp/src/components/app-sidebar.tsx` to this sequence:

```ts
const navPersonal = [
	{ title: t("nav.dashboard", "Dashboard"), url: "/", icon: IconDashboard },
	{ title: t("nav.time-tracking", "Time Tracking"), url: "/time-tracking", icon: IconClock },
	{ title: t("nav.calendar", "Calendar"), url: "/calendar", icon: IconCalendarEvent },
	{ title: t("nav.absences", "Absences"), url: "/absences", icon: IconBeach },
	{ title: t("nav.travel-expenses", "Travel Expenses"), url: "/travel-expenses", icon: IconReceipt },
	{ title: t("nav.my-requests", "My Requests"), url: "/my-requests", icon: IconFileDescription },
	{ title: t("nav.reports", "Reports"), url: "/reports", icon: IconReport },
	{ title: t("nav.org-explorer", "Org Explorer"), url: "/organization", icon: IconHierarchy },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/webapp/src/components/app-sidebar.test.tsx --runInBand`

Expected: the sidebar component tests pass.

- [ ] **Step 5: Do not commit unless requested**

Leave changes unstaged. This follows the workspace instruction to commit only on explicit request.
