# Absence Holiday Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show holiday names in tooltips when users hover or focus holiday days in the `/absences` calendars.

**Architecture:** Use the existing Radix/shadcn tooltip primitives instead of custom hover state. Carry holiday names through the existing day-status/event lookup paths and wrap only holiday day cells with tooltip triggers.

**Tech Stack:** React, TypeScript, Tolgee, Luxon, existing `@/components/ui/tooltip`, `cn` utility.

---

## File Structure

- Modify `apps/webapp/src/components/absences/absence-year-calendar.tsx`: read holiday event names per date and wrap holiday day buttons with tooltip content.
- Modify `apps/webapp/src/components/absences/absence-calendar.tsx`: add holiday names to `DateStatus` and wrap holiday day cells with tooltip content.
- Keep `docs/superpowers/specs/2026-05-06-absence-holiday-tooltips-design.md` as the approved design reference.

### Task 1: Add Tooltips To The Year Calendar

**Files:**
- Modify: `apps/webapp/src/components/absences/absence-year-calendar.tsx`

- [ ] **Step 1: Import tooltip primitives**

Add this import near the existing UI imports:

```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
```

- [ ] **Step 2: Derive holiday names for each day**

Inside the `days.map((date) => { ... })` block, replace the current `hasHoliday` calculation with:

```tsx
const holidayNames = dayEvents
	.filter((event) => event.type === "holiday")
	.map((event) => event.title)
	.filter((title): title is string => Boolean(title));
const hasHoliday = holidayNames.length > 0;
```

- [ ] **Step 3: Wrap holiday buttons with a tooltip**

Replace the direct button return with a `dayButton` variable and return a tooltip only when `hasHoliday` is true:

```tsx
const dayButton = (
	<button
		key={date.getTime()}
		type="button"
		onClick={() => onDayClick?.(date)}
		className={cn(
			"aspect-square flex flex-col items-center justify-center text-[10px] rounded-sm relative",
			"hover:bg-accent transition-colors",
			isToday && "ring-1 ring-primary font-bold",
			isWeekend && "text-muted-foreground",
			bgClass,
		)}
	>
		<span>{date.getDate()}</span>
	</button>
);

if (!hasHoliday) {
	return dayButton;
}

return (
	<Tooltip key={date.getTime()}>
		<TooltipTrigger asChild>{dayButton}</TooltipTrigger>
		<TooltipContent className="max-w-xs">
			<div className="space-y-1">
				{holidayNames.map((holidayName) => (
					<div key={holidayName}>{holidayName}</div>
				))}
			</div>
		</TooltipContent>
	</Tooltip>
);
```

- [ ] **Step 4: Add one provider around the year calendar day grids**

Wrap the rendered mini-month grid area by adding `TooltipProvider` around the month grid in the `AbsenceYearCalendar` return:

```tsx
<TooltipProvider delayDuration={150}>
	<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto">
		{MONTHS.map((monthName, monthIndex) => (
			<MiniMonth
				key={monthName}
				year={year}
				month={monthIndex}
				monthName={monthName}
				weekdays={WEEKDAYS}
				weekStartDay={weekStartDay}
				eventsByDate={eventsByDate}
				onDayClick={onDayClick}
			/>
		))}
	</div>
</TooltipProvider>
```

- [ ] **Step 5: Run a targeted check**

Run:

```bash
pnpm --filter webapp lint
```

Expected: either PASS, or only unrelated existing lint failures outside the edited absence calendar files.

### Task 2: Add Tooltips To The Monthly Calendar

**Files:**
- Modify: `apps/webapp/src/components/absences/absence-calendar.tsx`

- [ ] **Step 1: Import tooltip primitives and `cn`**

Add these imports near the existing UI imports:

```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
```

- [ ] **Step 2: Carry holiday names in date status**

Add `holidayNames` to the `DateStatus` interface:

```tsx
holidayNames?: string[];
```

Then replace the holiday return in `getDateStatus` with collection logic:

```tsx
const holidayNames: string[] = [];
for (const holiday of holidays) {
	const start = DateTime.fromJSDate(holiday.startDate);
	const end = DateTime.fromJSDate(holiday.endDate);
	const date = DateTime.local(year, month + 1, day);

	if (date >= start.startOf("day") && date <= end.endOf("day")) {
		holidayNames.push(holiday.name);
	}
}

if (holidayNames.length > 0) {
	return { type: "holiday", holidayNames };
}
```

- [ ] **Step 3: Convert day class strings to `cn`**

Replace the day-cell `className` template literal with:

```tsx
className={cn(
	"aspect-square rounded-md p-2 text-sm relative",
	isToday && "ring-2 ring-primary",
	status?.type === "holiday" && "bg-muted",
	getTextClass(),
)}
```

- [ ] **Step 4: Wrap monthly holiday cells with a tooltip**

Create a `dayCell` variable for the current JSX and wrap it only for holiday statuses:

```tsx
const dayCell = (
	<div
		key={day}
		className={cn(
			"aspect-square rounded-md p-2 text-sm relative",
			isToday && "ring-2 ring-primary",
			status?.type === "holiday" && "bg-muted",
			getTextClass(),
		)}
		style={status?.type === "absence" ? getBackgroundStyle() : {}}
	>
		<div className="flex flex-col h-full">
			<div className="font-medium">{day}</div>
			{status && (
				<div className="mt-auto flex items-center gap-1">
					<div className="h-1 flex-1 rounded-full bg-current opacity-50" />
					{status.type === "absence" && status.period !== "full_day" && (
						<span className="text-[10px] uppercase opacity-70">
							{status.period === "am" ? t("absences.period.am", "AM") : t("absences.period.pm", "PM")}
						</span>
					)}
				</div>
			)}
		</div>
	</div>
);

if (status?.type !== "holiday" || !status.holidayNames?.length) {
	return dayCell;
}

return (
	<Tooltip key={day}>
		<TooltipTrigger asChild>{dayCell}</TooltipTrigger>
		<TooltipContent className="max-w-xs">
			<div className="space-y-1">
				{status.holidayNames.map((holidayName) => (
					<div key={holidayName}>{holidayName}</div>
				))}
			</div>
		</TooltipContent>
	</Tooltip>
);
```

- [ ] **Step 5: Add one provider around the monthly day grid**

Wrap the monthly grid that renders `days` with:

```tsx
<TooltipProvider delayDuration={150}>
	<div className="grid grid-cols-7 gap-1">{days}</div>
</TooltipProvider>
```

- [ ] **Step 6: Run a targeted check**

Run:

```bash
pnpm --filter webapp lint
```

Expected: either PASS, or only unrelated existing lint failures outside the edited absence calendar files.

### Task 3: Final Verification

**Files:**
- Verify: `apps/webapp/src/components/absences/absence-year-calendar.tsx`
- Verify: `apps/webapp/src/components/absences/absence-calendar.tsx`

- [ ] **Step 1: Run the final check**

Run:

```bash
pnpm --filter webapp lint
```

Expected: PASS, or document unrelated existing failures.

- [ ] **Step 2: Inspect git diff**

Run:

```bash
git diff -- apps/webapp/src/components/absences/absence-year-calendar.tsx apps/webapp/src/components/absences/absence-calendar.tsx docs/superpowers/specs/2026-05-06-absence-holiday-tooltips-design.md docs/superpowers/plans/2026-05-06-absence-holiday-tooltips.md
```

Expected: diff only contains holiday tooltip changes plus the design and plan docs.

- [ ] **Step 3: Do not commit unless requested**

This environment requires explicit user approval before creating commits. Report the changed files and verification results instead of committing.

## Self-Review

- Spec coverage: all approved behavior is covered by Task 1 and Task 2.
- Placeholder scan: no placeholders or TBD items remain.
- Type consistency: `holidayNames` is consistently `string[]`; year calendar uses `CalendarEvent.title`; monthly calendar uses `Holiday.name`.
