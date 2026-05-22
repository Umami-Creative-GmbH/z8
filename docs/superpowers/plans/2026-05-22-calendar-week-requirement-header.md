# Calendar Week Requirement Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move daily required-hour and over/undertime summaries into the Schedule-X day headers so they align with the correct day in `/calendar` week and day views.

**Architecture:** Keep requirement data and formatting in React, but render the visible summary by augmenting Schedule-X header cells after the calendar has rendered. Remove the separate full-width `DailyRequirementStrip` grid from `ScheduleXCalendarWrapper` so there is no independent layout to align with the time-axis gutter.

**Tech Stack:** React client components, Schedule-X calendar, Luxon `DateTime`, Tolgee translations, Vitest with jsdom, Tailwind/CSS module-style global selectors in `schedule-x-calendar.css`.

---

## File Structure

- Modify `apps/webapp/src/components/calendar/daily-requirement-strip.tsx`: convert from a standalone grid component into small exported helpers for summary labels and injected header markup.
- Modify `apps/webapp/src/components/calendar/daily-requirement-strip.test.tsx`: update tests to cover helper output and status labeling instead of a detached strip row.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`: remove standalone strip rendering and add a scoped `useEffect` that injects per-date summary markup into Schedule-X day header cells for day/week views.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.css`: add restrained styles for injected header summaries.
- Do not commit changes unless the user explicitly asks. The plan includes verification steps instead of commit steps because this workspace policy requires explicit commit approval.

## Task 1: Replace Detached Strip API With Header Summary Helpers

**Files:**
- Modify: `apps/webapp/src/components/calendar/daily-requirement-strip.tsx`
- Test: `apps/webapp/src/components/calendar/daily-requirement-strip.test.tsx`

- [ ] **Step 1: Write failing helper tests**

Replace `apps/webapp/src/components/calendar/daily-requirement-strip.test.tsx` with:

```tsx
/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import type { DailyWorkHoursSummary } from "@/lib/calendar/types";
import {
	buildRequirementHeaderContent,
	getRequirementStatusLabel,
} from "./daily-requirement-strip";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) => {
			if (!params) return fallback;
			return Object.entries(params).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, value),
				fallback,
			);
		},
	}),
}));

const baseSummary: DailyWorkHoursSummary = {
	requiredMinutes: 480,
	actualMinutes: 573,
	deltaMinutes: 93,
	status: "over",
	policyId: "policy-1",
	policyName: "Standard",
};

describe("requirement header helpers", () => {
	it("builds compact header content for an over-requirement day", () => {
		const content = buildRequirementHeaderContent(baseSummary, "Friday, May 22", (key, fallback) =>
			fallback,
		);

		expect(content.requiredHours).toBe("8:00h");
		expect(content.deltaHours).toBe("+1:33h");
		expect(content.status).toBe("over");
		expect(content.accessibleLabel).toBe(
			"Friday, May 22: 8:00h required, 9:33h recorded, +1:33h delta, over requirement",
		);
	});

	it("omits the visible delta when the requirement is exactly met", () => {
		const content = buildRequirementHeaderContent(
			{ ...baseSummary, actualMinutes: 480, deltaMinutes: 0, status: "met" },
			"Friday, May 22",
			(key, fallback) => fallback,
		);

		expect(content.deltaHours).toBeNull();
		expect(content.status).toBe("met");
	});

	it("labels missing recorded time", () => {
		const label = getRequirementStatusLabel(
			{ ...baseSummary, actualMinutes: 0, deltaMinutes: -480, status: "missing" },
			(key, fallback) => fallback,
		);

		expect(label).toBe("missing recorded time");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- daily-requirement-strip.test.tsx`

Expected: FAIL because `buildRequirementHeaderContent` and `getRequirementStatusLabel` are not exported.

- [ ] **Step 3: Implement helper exports**

Replace `apps/webapp/src/components/calendar/daily-requirement-strip.tsx` with:

```tsx
"use client";

import type { DailyWorkHoursSummary, DailyWorkHoursStatus } from "@/lib/calendar/types";
import { formatSignedMinutes, formatTimeHours } from "@/lib/calendar/work-hours-summary";

export type RequirementTranslate = (
	key: string,
	fallback: string,
	params?: Record<string, string>,
) => string;

export interface RequirementHeaderContent {
	requiredHours: string;
	actualHours: string;
	deltaHours: string | null;
	status: DailyWorkHoursStatus;
	accessibleLabel: string;
}

export function getRequirementStatusLabel(
	summary: DailyWorkHoursSummary,
	t: RequirementTranslate,
): string {
	if (summary.status === "under") {
		return t("calendar.requirements.status.under", "under requirement");
	}
	if (summary.status === "missing") {
		return t("calendar.requirements.status.missing", "missing recorded time");
	}
	if (summary.status === "over") {
		return t("calendar.requirements.status.over", "over requirement");
	}
	return t("calendar.requirements.status.met", "requirement met");
}

export function buildRequirementHeaderContent(
	summary: DailyWorkHoursSummary,
	dateLabel: string,
	t: RequirementTranslate,
): RequirementHeaderContent {
	const requiredHours = formatTimeHours(summary.requiredMinutes);
	const actualHours = formatTimeHours(summary.actualMinutes);
	const deltaHours = summary.status === "met" ? null : formatSignedMinutes(summary.deltaMinutes);
	const accessibleLabel = t(
		"calendar.requirements.dayLabel",
		"{date}: {required} required, {actual} recorded, {delta} delta, {status}",
		{
			date: dateLabel,
			required: requiredHours,
			actual: actualHours,
			delta: formatSignedMinutes(summary.deltaMinutes),
			status: getRequirementStatusLabel(summary, t),
		},
	);

	return {
		requiredHours,
		actualHours,
		deltaHours,
		status: summary.status,
		accessibleLabel,
	};
}
```

- [ ] **Step 4: Run helper tests**

Run: `pnpm --filter webapp test -- daily-requirement-strip.test.tsx`

Expected: PASS for all helper tests.

## Task 2: Inject Requirement Summaries Into Schedule-X Headers

**Files:**
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`

- [ ] **Step 1: Add imports**

In `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`, replace:

```tsx
import { DailyRequirementStrip } from "./daily-requirement-strip";
```

with:

```tsx
import { buildRequirementHeaderContent } from "./daily-requirement-strip";
```

- [ ] **Step 2: Add DOM helper functions above `ScheduleXCalendarWrapper`**

Add this code above `export function ScheduleXCalendarWrapper`:

```tsx
function getHeaderCells(container: HTMLDivElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			".sx__week-header .sx__week-grid__date, .sx__week-header .sx__date-grid__date, .sx__week-header [data-time-grid-date]",
		),
	);
}

function clearRequirementHeaderContent(container: HTMLDivElement) {
	for (const node of container.querySelectorAll(".z8-requirement-header-summary")) {
		node.remove();
	}
}
```

- [ ] **Step 3: Add the header injection effect**

Add this effect after the existing scroll effect in `ScheduleXCalendarWrapper`:

```tsx
	useEffect(() => {
		const container = calendarContainerRef.current;
		if (!container || (viewMode !== "day" && viewMode !== "week")) {
			return;
		}

		const renderRequirementHeaders = () => {
			clearRequirementHeaderContent(container);

			const headerCells = getHeaderCells(container);
			if (headerCells.length === 0) return;

			for (const [index, date] of visibleRequirementDates.entries()) {
				const summary = workHoursData.get(date.toFormat("yyyy-MM-dd"));
				const cell = headerCells[index];
				if (!summary || !cell) continue;

				const content = buildRequirementHeaderContent(
					summary,
					date.toFormat("cccc, LLLL d"),
					t,
				);
				const wrapper = document.createElement("div");
				wrapper.className = `z8-requirement-header-summary z8-requirement-header-summary--${content.status}`;
				wrapper.setAttribute("aria-label", content.accessibleLabel);

				const required = document.createElement("span");
				required.className = "z8-requirement-header-summary__required";
				required.textContent = content.requiredHours;
				wrapper.append(required);

				if (content.deltaHours) {
					const delta = document.createElement("span");
					delta.className = "z8-requirement-header-summary__delta";
					delta.textContent = content.deltaHours;
					wrapper.append(delta);
				}

				cell.append(wrapper);
			}
		};

		const frame = window.requestAnimationFrame(renderRequirementHeaders);
		return () => {
			window.cancelAnimationFrame(frame);
			clearRequirementHeaderContent(container);
		};
	}, [viewMode, visibleRequirementDates, workHoursData, t]);
```

- [ ] **Step 4: Remove detached strip rendering**

Delete this line from the returned JSX:

```tsx
			<DailyRequirementStrip dates={visibleRequirementDates} summaries={workHoursData} />
```

- [ ] **Step 5: Run type-aware test command for the touched files**

Run: `pnpm --filter webapp test -- daily-requirement-strip.test.tsx calendar-view.test.tsx`

Expected: PASS. If `calendar-view.test.tsx` fails because Schedule-X does not render real header DOM in jsdom, keep the helper coverage and verify manually in Task 4.

## Task 3: Style The Header Summary

**Files:**
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.css`

- [ ] **Step 1: Add scoped CSS**

Append this CSS to `apps/webapp/src/components/calendar/schedule-x-calendar.css`:

```css
/* Daily work requirement summary injected into Schedule-X day headers. */
.schedule-x-container .z8-requirement-header-summary {
	display: inline-flex;
	align-items: center;
	gap: 0.375rem;
	margin-top: 0.375rem;
	border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
	border-radius: 999px;
	padding: 0.125rem 0.5rem;
	font-size: 0.6875rem;
	font-variant-numeric: tabular-nums;
	line-height: 1.25;
	white-space: nowrap;
}

.schedule-x-container .z8-requirement-header-summary__required {
	font-weight: 650;
}

.schedule-x-container .z8-requirement-header-summary__delta {
	color: color-mix(in srgb, currentColor 72%, transparent);
}

.schedule-x-container .z8-requirement-header-summary--over,
.schedule-x-container .z8-requirement-header-summary--met {
	background: color-mix(in srgb, rgb(16 185 129) 12%, transparent);
	color: rgb(6 95 70);
}

.dark .schedule-x-container .z8-requirement-header-summary--over,
.dark .schedule-x-container .z8-requirement-header-summary--met {
	color: rgb(167 243 208);
}

.schedule-x-container .z8-requirement-header-summary--under {
	background: color-mix(in srgb, rgb(239 68 68) 10%, transparent);
	color: rgb(127 29 29);
}

.dark .schedule-x-container .z8-requirement-header-summary--under {
	color: rgb(254 202 202);
}

.schedule-x-container .z8-requirement-header-summary--missing {
	background: color-mix(in srgb, currentColor 6%, transparent);
	color: var(--sx-color-neutral, currentColor);
}
```

- [ ] **Step 2: Run tests after styling**

Run: `pnpm --filter webapp test -- daily-requirement-strip.test.tsx`

Expected: PASS.

## Task 4: Verify In Browser And Adjust Selectors If Needed

**Files:**
- Modify only if needed: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`

- [ ] **Step 1: Start the webapp**

Run: `pnpm dev`

Expected: the development server starts successfully.

- [ ] **Step 2: Open `/calendar` week view**

Use the browser to open the webapp calendar, switch to week view, and inspect the day headers.

Expected: each visible requirement summary appears inside the matching day header, below the weekday/date text. No separate full-width requirement strip appears above the calendar.

- [ ] **Step 3: If no summaries appear, inspect Schedule-X header selectors**

In the browser devtools console, run:

```js
Array.from(document.querySelectorAll(".schedule-x-container .sx__week-header *"))
	.slice(0, 40)
	.map((node) => ({ className: node.className, text: node.textContent?.trim() }));
```

Expected: identify the seven day header elements that contain weekday/date text.

- [ ] **Step 4: Update `getHeaderCells` selector if needed**

If the inspected header cell class differs, replace the selector in `getHeaderCells` with the exact class that selects the day header cells and not the time-axis gutter. Keep the return type as `HTMLElement[]`.

- [ ] **Step 5: Verify light and dark themes**

Switch between light and dark theme.

Expected: green, red, and muted summaries remain readable and do not overpower the date header.

## Task 5: Final Verification

**Files:**
- Inspect: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- Inspect: `apps/webapp/src/components/calendar/daily-requirement-strip.tsx`
- Inspect: `apps/webapp/src/components/calendar/schedule-x-calendar.css`

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter webapp test -- daily-requirement-strip.test.tsx calendar-view.test.tsx`

Expected: PASS, or document any unrelated existing failures with exact output.

- [ ] **Step 2: Run lint/type verification if available**

Run: `pnpm --filter webapp lint`

Expected: PASS, or document any unrelated existing failures with exact output.

- [ ] **Step 3: Inspect changed files**

Run: `git diff -- apps/webapp/src/components/calendar/daily-requirement-strip.tsx apps/webapp/src/components/calendar/daily-requirement-strip.test.tsx apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/schedule-x-calendar.css docs/superpowers/specs/2026-05-22-calendar-week-requirement-header-design.md docs/superpowers/plans/2026-05-22-calendar-week-requirement-header.md`

Expected: diff only contains the approved header integration, helper tests, scoped CSS, and docs.

## Self-Review

- Spec coverage: alignment is handled by rendering into Schedule-X header cells; detached strip is removed; visual treatment is compact, non-clickable, status-colored, and dark-mode aware; tests and manual verification are included.
- Placeholder scan: no TBD/TODO/fill-in placeholders remain.
- Type consistency: helper types use existing `DailyWorkHoursSummary` and `DailyWorkHoursStatus`; `ScheduleXCalendarWrapper` keeps existing `DailyWorkHoursSummaries` data flow unchanged.
