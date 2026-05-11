# Time Tracking Paced Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard Time Tracking widget judge "Behind" against elapsed week/month pacing instead of the full period target.

**Architecture:** Keep data loading in `getQuickStats`, add `expectedToDate` to each returned stat, and keep the UI progress ring based on full-period target. Extract a small status helper from the widget so the status thresholds can be tested without rendering the dashboard.

**Tech Stack:** Next.js 16, React 19, TypeScript, Luxon, Vitest, pnpm.

---

## File Structure

- Modify `apps/webapp/src/components/dashboard/actions.ts`: calculate `expectedToDate` for week and month from the same full-period expectations already used today.
- Modify `apps/webapp/src/components/dashboard/quick-stats-widget.tsx`: add `expectedToDate` to the stat type and use a helper for status thresholds.
- Create `apps/webapp/src/components/dashboard/quick-stats-widget.test.ts`: unit-test the status helper.

## Task 1: Add Paced Status Helper Tests

**Files:**
- Test: `apps/webapp/src/components/dashboard/quick-stats-widget.test.ts`
- Modify: `apps/webapp/src/components/dashboard/quick-stats-widget.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/webapp/src/components/dashboard/quick-stats-widget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getQuickStatsStatus } from "./quick-stats-widget";

describe("getQuickStatsStatus", () => {
	it("does not mark early-period paced progress as behind", () => {
		expect(getQuickStatsStatus({ actual: 4, expectedToDate: 4 })).toBe("on-track");
	});

	it("marks genuine expected-to-date shortfall as behind", () => {
		expect(getQuickStatsStatus({ actual: 2.5, expectedToDate: 4 })).toBe("behind");
	});

	it("uses good pace between behind and on-track thresholds", () => {
		expect(getQuickStatsStatus({ actual: 3.2, expectedToDate: 4 })).toBe("good-pace");
	});

	it("avoids behind when expected-to-date is zero", () => {
		expect(getQuickStatsStatus({ actual: 0, expectedToDate: 0 })).toBe("good-pace");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --dir apps/webapp test apps/webapp/src/components/dashboard/quick-stats-widget.test.ts`

Expected: FAIL because `getQuickStatsStatus` is not exported from `quick-stats-widget.tsx`.

- [ ] **Step 3: Export the minimal helper**

Add this near the top of `apps/webapp/src/components/dashboard/quick-stats-widget.tsx`, after the `QuickStats` type:

```ts
export type QuickStatsStatus = "on-track" | "good-pace" | "behind";

export function getQuickStatsStatus({
	actual,
	expectedToDate,
}: {
	actual: number;
	expectedToDate: number;
}): QuickStatsStatus {
	if (expectedToDate <= 0) return "good-pace";

	const percentage = (actual / expectedToDate) * 100;
	if (percentage >= 90) return "on-track";
	if (percentage < 75) return "behind";
	return "good-pace";
}
```

- [ ] **Step 4: Run the helper tests**

Run: `pnpm --dir apps/webapp test apps/webapp/src/components/dashboard/quick-stats-widget.test.ts`

Expected: PASS.

## Task 2: Use Paced Status In The Widget

**Files:**
- Modify: `apps/webapp/src/components/dashboard/quick-stats-widget.tsx`
- Test: `apps/webapp/src/components/dashboard/quick-stats-widget.test.ts`

- [ ] **Step 1: Extend the widget stat type**

Change the `QuickStats` type in `apps/webapp/src/components/dashboard/quick-stats-widget.tsx` to include `expectedToDate`:

```ts
type QuickStats = {
	thisWeek: {
		actual: number;
		expected: number;
		expectedToDate: number;
	};
	thisMonth: {
		actual: number;
		expected: number;
		expectedToDate: number;
	};
};
```

- [ ] **Step 2: Pass expected-to-date into StatCard**

Add `expectedToDate` to `StatCard` props and calls:

```tsx
function StatCard({
	title,
	icon: Icon,
	actual,
	expected,
	expectedToDate,
	color,
}: {
	title: string;
	icon: React.ElementType;
	actual: number;
	expected: number;
	expectedToDate: number;
	color: "blue" | "purple";
}) {
	const { t } = useTranslate();
	const percentage = expected > 0 ? (actual / expected) * 100 : 0;
	const status = getQuickStatsStatus({ actual, expectedToDate });
	const isOnTrack = status === "on-track";
	const isBehind = status === "behind";
```

Then pass the new field in both cards:

```tsx
<StatCard
	title={t("dashboard.quick-stats.this-week", "This Week")}
	icon={IconCalendarWeek}
	actual={stats.thisWeek.actual}
	expected={stats.thisWeek.expected}
	expectedToDate={stats.thisWeek.expectedToDate}
	color="blue"
/>
<StatCard
	title={t("dashboard.quick-stats.this-month", "This Month")}
	icon={IconClock}
	actual={stats.thisMonth.actual}
	expected={stats.thisMonth.expected}
	expectedToDate={stats.thisMonth.expectedToDate}
	color="purple"
/>
```

- [ ] **Step 3: Run the helper tests**

Run: `pnpm --dir apps/webapp test apps/webapp/src/components/dashboard/quick-stats-widget.test.ts`

Expected: PASS.

## Task 3: Return Expected-To-Date From The Server Action

**Files:**
- Modify: `apps/webapp/src/components/dashboard/actions.ts`

- [ ] **Step 1: Add paced expected calculations**

In `getQuickStats`, after `weekExpected` and `monthExpected` have been calculated, add:

```ts
const elapsedWeekMs = Math.max(0, Math.min(now.getTime() - weekStart.getTime(), weekEnd.getTime() - weekStart.getTime()));
const totalWeekMs = Math.max(1, weekEnd.getTime() - weekStart.getTime());
const weekExpectedToDate = weekExpected * (elapsedWeekMs / totalWeekMs);

const elapsedMonthMs = Math.max(0, Math.min(now.getTime() - monthStart.getTime(), monthEnd.getTime() - monthStart.getTime()));
const totalMonthMs = Math.max(1, monthEnd.getTime() - monthStart.getTime());
const monthExpectedToDate = monthExpected * (elapsedMonthMs / totalMonthMs);
```

Return the new fields:

```ts
return {
	thisWeek: {
		actual: weekActual,
		expected: weekExpected,
		expectedToDate: weekExpectedToDate,
	},
	thisMonth: {
		actual: monthActual,
		expected: monthExpected,
		expectedToDate: monthExpectedToDate,
	},
};
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --dir apps/webapp test apps/webapp/src/components/dashboard/quick-stats-widget.test.ts`

Expected: PASS.

## Task 4: Verify The Change

**Files:**
- Verify: `apps/webapp/src/components/dashboard/quick-stats-widget.tsx`
- Verify: `apps/webapp/src/components/dashboard/actions.ts`
- Verify: `apps/webapp/src/components/dashboard/quick-stats-widget.test.ts`

- [ ] **Step 1: Run the focused test**

Run: `pnpm --dir apps/webapp test apps/webapp/src/components/dashboard/quick-stats-widget.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the dashboard test set**

Run: `pnpm --dir apps/webapp test apps/webapp/src/components/dashboard`

Expected: PASS.

- [ ] **Step 3: Run formatting/lint check if available**

Run: `pnpm --dir apps/webapp exec biome check src/components/dashboard/quick-stats-widget.tsx src/components/dashboard/actions.ts src/components/dashboard/quick-stats-widget.test.ts`

Expected: PASS or actionable formatting output to fix with `pnpm --dir apps/webapp exec biome check --write ...`.

## Self-Review

- Spec coverage: The plan covers full-period display, expected-to-date status, weekly/monthly pacing, zero expected-to-date handling, and tests.
- Placeholder scan: No placeholders remain.
- Type consistency: The `expectedToDate` field and `getQuickStatsStatus` helper names are consistent across tasks.
