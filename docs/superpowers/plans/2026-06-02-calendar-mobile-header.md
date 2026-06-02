# Calendar Mobile Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Schedule-X calendar header readable and usable on mobile without changing desktop behavior.

**Architecture:** Keep the existing `ScheduleXCalendarWrapper` custom header, but render responsive desktop and mobile header structures. Desktop keeps the current single-row layout; mobile uses a date row above a non-wrapping controls row. Add compact mobile date formatting alongside the existing desktop date label.

**Tech Stack:** React, Next.js client components, Luxon, Tolgee, Tailwind CSS, Vitest, Testing Library.

---

## File Structure

- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`: add compact mobile date formatting and responsive header markup/classes.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`: add a regression test for mobile/desktop header structure and compact week label.
- Verify existing calendar tests still pass.

### Task 1: Mobile-Friendly Schedule-X Header

**Files:**
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- Test: `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`

- [ ] **Step 1: Write the failing regression test**

Add this test to `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`, inside the existing `describe` block for `ScheduleXCalendarWrapper` or create one if needed. Mock Tolgee language as German if the file does not already do so.

```tsx
it("renders a mobile header with compact date and non-wrapping controls", () => {
	render(
		<ScheduleXCalendarWrapper
			events={[]}
			timeZone="Europe/Berlin"
			viewMode="week"
			onViewModeChange={vi.fn()}
		/>,
	);

	const desktopHeader = screen.getByTestId("calendar-desktop-header");
	const mobileHeader = screen.getByTestId("calendar-mobile-header");
	const mobileDate = screen.getByTestId("calendar-mobile-date-range");
	const mobileControls = screen.getByTestId("calendar-mobile-header-controls");

	expect(desktopHeader.className).toContain("hidden");
	expect(desktopHeader.className).toContain("md:flex");
	expect(mobileHeader.className).toContain("md:hidden");
	expect(mobileDate.className).toContain("whitespace-nowrap");
	expect(mobileControls.className).toContain("overflow-x-auto");
	expect(mobileControls.className).toContain("whitespace-nowrap");
	expect(mobileDate.textContent).not.toMatch(/, \d{4}$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/webapp`:

```bash
pnpm vitest src/components/calendar/schedule-x-calendar.test.tsx --run
```

Expected: FAIL because the header test IDs and mobile date label do not exist yet.

- [ ] **Step 3: Add compact mobile date formatting**

In `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`, keep `dateRangeDisplay` unchanged for desktop and add this `mobileDateRangeDisplay` near it:

```tsx
const mobileDateRangeDisplay = (() => {
	const localizedCurrentDate = currentDate.setLocale(locale);

	switch (viewMode) {
		case "day":
			return localizedCurrentDate.toFormat("ccc, d. LLL yyyy");
		case "week": {
			const { start: weekStart, end: weekEnd } = getWeekBounds(
				localizedCurrentDate,
				weekStartDay,
			);
			if (weekStart.year === weekEnd.year) {
				return `${weekStart.toFormat("d. LLL")} - ${weekEnd.toFormat("d. LLL yyyy")}`;
			}
			return `${weekStart.toFormat("d. LLL yyyy")} - ${weekEnd.toFormat("d. LLL yyyy")}`;
		}
		case "month":
			return localizedCurrentDate.toFormat("LLL yyyy");
		default:
			return localizedCurrentDate.toFormat("d. LLL yyyy");
	}
})();
```

- [ ] **Step 4: Replace the header markup with responsive desktop/mobile structures**

Replace the current custom navigation header block in `schedule-x-calendar.tsx` with:

```tsx
<div className="pb-3 mb-3 space-y-3 md:space-y-0">
	<div
		data-testid="calendar-desktop-header"
		className="hidden items-center justify-between gap-4 md:flex"
	>
		<div className="flex items-center gap-2">
			<Button
				variant="outline"
				size="icon"
				onClick={navigatePrevious}
				aria-label={t("calendar.view.previous", "Previous")}
			>
				<IconChevronLeft className="size-4" />
			</Button>
			<Button
				variant="outline"
				size="icon"
				onClick={navigateNext}
				aria-label={t("calendar.view.next", "Next")}
			>
				<IconChevronRight className="size-4" />
			</Button>
			<Button variant="outline" size="sm" onClick={navigateToday}>
				{t("calendar.view.today", "Today")}
			</Button>
			{onRefresh && (
				<Button
					variant="outline"
					size="icon"
					onClick={onRefresh}
					aria-label={t("calendar.view.refresh", "Refresh")}
					title={t("calendar.view.refresh", "Refresh")}
				>
					<IconReload className="size-4" />
				</Button>
			)}
		</div>
		<h2 className="text-lg font-semibold">{dateRangeDisplay}</h2>
		<Tabs value={viewMode} onValueChange={(v) => onViewModeChange(v as ViewMode)}>
			<TabsList>
				<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
				<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
				<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
				<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
			</TabsList>
		</Tabs>
	</div>

	<div data-testid="calendar-mobile-header" className="space-y-2 md:hidden">
		<h2
			data-testid="calendar-mobile-date-range"
			className="truncate whitespace-nowrap text-base font-semibold leading-tight"
		>
			{mobileDateRangeDisplay}
		</h2>
		<div
			data-testid="calendar-mobile-header-controls"
			className="flex items-center justify-between gap-2 overflow-x-auto whitespace-nowrap pb-1"
		>
			<div className="flex shrink-0 items-center gap-2">
				<Button
					variant="outline"
					size="icon"
					onClick={navigatePrevious}
					aria-label={t("calendar.view.previous", "Previous")}
				>
					<IconChevronLeft className="size-4" />
				</Button>
				<Button
					variant="outline"
					size="icon"
					onClick={navigateNext}
					aria-label={t("calendar.view.next", "Next")}
				>
					<IconChevronRight className="size-4" />
				</Button>
				<Button variant="outline" size="sm" onClick={navigateToday}>
					{t("calendar.view.today", "Today")}
				</Button>
				{onRefresh && (
					<Button
						variant="outline"
						size="icon"
						onClick={onRefresh}
						aria-label={t("calendar.view.refresh", "Refresh")}
						title={t("calendar.view.refresh", "Refresh")}
					>
						<IconReload className="size-4" />
					</Button>
				)}
			</div>
			<Tabs value={viewMode} onValueChange={(v) => onViewModeChange(v as ViewMode)}>
				<TabsList className="shrink-0">
					<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
					<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
					<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
					<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
				</TabsList>
			</Tabs>
		</div>
	</div>
</div>
```

- [ ] **Step 5: Run the targeted test to verify it passes**

Run from `apps/webapp`:

```bash
pnpm vitest src/components/calendar/schedule-x-calendar.test.tsx --run
```

Expected: PASS.

- [ ] **Step 6: Run focused formatting/checks**

Run from repo root:

```bash
pnpm --dir apps/webapp exec biome check src/components/calendar/schedule-x-calendar.tsx src/components/calendar/schedule-x-calendar.test.tsx
```

Expected: PASS. If Biome reports safe formatting fixes, run the same command with `--write`, then rerun the check and targeted test.

## Self-Review

- Spec coverage: Task 1 implements the mobile two-row header, compact mobile date label, no-wrap controls row, and preserves desktop header behavior.
- Placeholder scan: No placeholders or vague implementation steps remain.
- Type consistency: The plan uses existing `ScheduleXCalendarWrapper`, `ViewMode`, `viewMode`, `onViewModeChange`, `dateRangeDisplay`, and Luxon/Tolgee patterns already present in the file.
