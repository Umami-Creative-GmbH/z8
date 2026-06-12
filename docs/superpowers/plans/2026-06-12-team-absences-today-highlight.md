# Team Absences Today Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight the real current day in the `/team/absences` year calendar only when the selected year contains today.

**Architecture:** Keep the change local to the existing client calendar. `TeamAbsenceYearCalendar` computes one UTC ISO date key for today, passes it into `TeamAbsenceMonth`, and each day cell compares against its own ISO key for styling and accessible labeling.

**Tech Stack:** Next.js client component, React, Luxon `DateTime` and `Settings`, Vitest, Testing Library, Tailwind utility classes, existing `cn` helper.

---

## File Structure

- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx`
  - Responsibility: Render the team absence year calendar, including day cell absence states and the new today state.
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx`
  - Responsibility: Verify aggregate absence rendering and the new today labeling behavior.

## Task 1: Add Today State To Team Absence Calendar

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx`

- [ ] **Step 1: Write the failing tests**

In `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx`, update the Vitest imports and add Luxon `Settings`:

```ts
import { render, screen, within } from "@testing-library/react";
import { Settings } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
```

Add this cleanup after the mocks and before `describe`:

```ts
afterEach(() => {
	Settings.now = () => Date.now();
});
```

Add these tests inside `describe("TeamAbsenceYearCalendar", () => { ... })`:

```ts
	it("labels the current day when the selected year contains today", () => {
		Settings.now = () => new Date("2026-06-12T10:00:00.000Z").valueOf();

		render(
			<TeamAbsenceYearCalendar
				data={{
					year: 2026,
					teamId: null,
					entries: [],
				}}
			/>,
		);

		expect(screen.getByRole("button", { name: "Today, June 12, 2026" })).toBeTruthy();
	});

	it("does not label the same month and day as today in other selected years", () => {
		Settings.now = () => new Date("2026-06-12T10:00:00.000Z").valueOf();

		render(
			<TeamAbsenceYearCalendar
				data={{
					year: 2025,
					teamId: null,
					entries: [],
				}}
			/>,
		);

		expect(screen.queryByRole("button", { name: /Today,/ })).toBeNull();
		expect(screen.getByRole("button", { name: "June 12, 2025" })).toBeTruthy();
	});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx
```

Expected: FAIL because no calendar button has an accessible name beginning with `Today,`.

- [ ] **Step 3: Add today label support**

In `apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.tsx`, change `buildDayLabel` from:

```ts
function buildDayLabel(day: ManagerAbsenceCalendarDay | undefined, date: DateTime): string {
	if (!day) {
		return formatDateLabel(date);
	}

	const pendingPart = day.pendingCount > 0 ? `, ${day.pendingCount} pending` : "";

	return `${formatDateLabel(date)}: ${day.totalCount} absent${pendingPart}`;
}
```

to:

```ts
function buildDayLabel(
	day: ManagerAbsenceCalendarDay | undefined,
	date: DateTime,
	isToday = false,
): string {
	const dateLabel = `${isToday ? "Today, " : ""}${formatDateLabel(date)}`;

	if (!day) {
		return dateLabel;
	}

	const pendingPart = day.pendingCount > 0 ? `, ${day.pendingCount} pending` : "";

	return `${dateLabel}: ${day.totalCount} absent${pendingPart}`;
}
```

- [ ] **Step 4: Pass and apply the today date key**

In the `TeamAbsenceMonth` props destructuring, add `todayDateKey`:

```ts
function TeamAbsenceMonth({
	month,
	year,
	monthName,
	weekdays,
	weekStartDay,
	daysByDate,
	todayDateKey,
}: {
	month: number;
	year: number;
	monthName: string;
	weekdays: string[];
	weekStartDay: WeekStartDay;
	daysByDate: Map<string, ManagerAbsenceCalendarDay>;
	todayDateKey: string | null;
}) {
```

Inside the day render callback, after `const hasPending = ...`, add:

```ts
					const isToday = todayDateKey === dateKey;
```

Update the `className` conditions for the button to include the today styles:

```ts
							className={cn(
								"relative flex aspect-square w-full flex-col items-center justify-center rounded-sm text-[10px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
								hasApproved && "bg-blue-100 text-blue-950 dark:bg-blue-900/30 dark:text-blue-100",
								isToday && "bg-primary/10 font-semibold ring-2 ring-primary ring-offset-1 ring-offset-background",
								hasPending && "ring-1 ring-yellow-500",
							)}
```

Update the `aria-label` from:

```ts
aria-label={buildDayLabel(day, date)}
```

to:

```ts
aria-label={buildDayLabel(day, date, isToday)}
```

- [ ] **Step 5: Compute today once in the year calendar**

In `TeamAbsenceYearCalendar`, after the pending/total counts, add:

```ts
	const today = DateTime.utc();
	const todayDateKey = today.year === data.year ? today.toISODate() : null;
```

Pass `todayDateKey` into the month component:

```tsx
						<TeamAbsenceMonth
							key={month}
							month={month}
							year={data.year}
							monthName={monthNames[month - 1] ?? String(month)}
							weekdays={weekdays}
							weekStartDay={weekStartDay}
							daysByDate={daysByDate}
							todayDateKey={todayDateKey}
						/>
```

- [ ] **Step 6: Run the focused test to verify it passes**

Run:

```bash
pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx
```

Expected: PASS for all tests in `team-absence-year-calendar.test.tsx`.

- [ ] **Step 7: Run broader verification**

Run:

```bash
pnpm --filter webapp test apps/webapp/src/app/[locale]/(app)/team/absences/team-absence-year-calendar.test.tsx apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.test.tsx
```

Expected: PASS for the team absences calendar and table tests.

---

## Self-Review

- Spec coverage: The plan covers current-year-only highlighting, accessible labeling, preserving existing approved/pending states, and focused tests.
- Placeholder scan: No placeholder tasks or unspecified code steps remain.
- Type consistency: `todayDateKey` is consistently typed as `string | null`, `buildDayLabel` accepts a defaulted `isToday` boolean, and existing `ManagerAbsenceCalendarDay` usage remains unchanged.
