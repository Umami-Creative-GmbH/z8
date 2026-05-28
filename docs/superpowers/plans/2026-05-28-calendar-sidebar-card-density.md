# Calendar Sidebar Card Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/calendar` sidebar order and compact card styling match the approved design.

**Architecture:** Use local class changes in the existing calendar sidebar components. Reorder the existing JSX in `CalendarView` and avoid changing global `Card` primitives or data behavior.

**Tech Stack:** Next.js React client components, Tailwind CSS utility classes, shadcn-style card primitives, Tolgee translations.

---

## File Structure

- Modify `apps/webapp/src/components/calendar/calendar-view.tsx`: reorder sidebar children for non-year calendar views.
- Modify `apps/webapp/src/components/calendar/calendar-filters.tsx`: apply compact card, header background, and body spacing.
- Modify `apps/webapp/src/components/calendar/calendar-legend.tsx`: apply the same compact card treatment as filters.
- Modify `apps/webapp/src/components/work-balance/work-balance-card.tsx`: make the compact variant match the sidebar card shell while leaving the non-compact variant unchanged.
- Test `apps/webapp/src/components/calendar/calendar-view.test.tsx`: run existing calendar view tests as a regression check.

### Task 1: Reorder Calendar Sidebar

**Files:**
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx:153-168`

- [ ] **Step 1: Move the employee selector above the all-time balance card**

Replace the sidebar block with this ordering:

```tsx
<div className="space-y-4 order-2 md:order-1">
	{/* Employee selector - replaces team toggle for better performance */}
	<CalendarEmployeeSelector
		currentEmployeeId={currentEmployeeId}
		selectedEmployeeId={selectedEmployeeId}
		onEmployeeChange={handleEmployeeChange}
		isManagerOrAbove={isManagerOrAbove}
	/>
	<WorkBalanceCard balance={workBalance} compact />
	<CalendarFiltersComponent
		filters={filters}
		onFiltersChange={setFilters}
		currentEmployeeId={currentEmployeeId}
	/>
	<CalendarLegend />
</div>
```

- [ ] **Step 2: Verify no data behavior changed**

Confirm the only change in this file is the JSX order inside the sidebar. `filters`, `selectedEmployeeId`, and `handleEmployeeChange` should be unchanged.

### Task 2: Compact Filter Card Styling

**Files:**
- Modify: `apps/webapp/src/components/calendar/calendar-filters.tsx:26-30`

- [ ] **Step 1: Apply compact card shell and title background**

Replace the opening card/header/content structure with:

```tsx
<Card className="gap-0 overflow-hidden py-0">
	<CardHeader className="bg-muted/45 px-4 py-3 dark:bg-muted/25">
		<CardTitle className="text-sm">{t("calendar.filters.title", "Filters")}</CardTitle>
	</CardHeader>
	<CardContent className="space-y-3 px-4 py-3">
```

Keep the existing four switch rows unchanged.

- [ ] **Step 2: Preserve switch accessibility**

Verify each `Label htmlFor` still matches the related `Switch id`: `show-holidays`, `show-absences`, `show-time-entries`, and `show-work-periods`.

### Task 3: Compact Legend Card Styling

**Files:**
- Modify: `apps/webapp/src/components/calendar/calendar-legend.tsx:34-38`

- [ ] **Step 1: Apply the same compact card shell**

Replace the opening card/header/content structure with:

```tsx
<Card className="gap-0 overflow-hidden py-0">
	<CardHeader className="bg-muted/45 px-4 py-3 dark:bg-muted/25">
		<CardTitle className="text-sm">{t("calendar.legend.title", "Legend")}</CardTitle>
	</CardHeader>
	<CardContent className="space-y-2 px-4 py-3">
```

Keep `legendItems` and the mapped row markup unchanged.

- [ ] **Step 2: Confirm theme-safe color usage**

Confirm the new background uses theme tokens only: `bg-muted/45` and `dark:bg-muted/25`. Do not add fixed light or dark hex colors.

### Task 4: Match Compact Work Balance Card

**Files:**
- Modify: `apps/webapp/src/components/work-balance/work-balance-card.tsx:18-39`

- [ ] **Step 1: Make only the compact variant use the sidebar shell**

Replace the returned JSX with:

```tsx
return (
	<Card className={compact ? "min-w-52 gap-0 overflow-hidden py-0" : undefined}>
		<CardHeader className={compact ? "bg-muted/45 px-4 py-3 dark:bg-muted/25" : undefined}>
			<CardDescription>{t("workBalance.label", "All-time balance")}</CardDescription>
			<CardTitle
				className={cn(
					"tabular-nums text-2xl",
					compact && "text-xl",
					status === "positive" && "text-emerald-600 dark:text-emerald-400",
					status === "negative" && "text-destructive",
				)}
			>
				{balance
					? formatSignedWorkBalance(balance.balanceMinutes)
					: t("workBalance.notCalculated", "Not calculated yet")}
			</CardTitle>
			<p className="text-muted-foreground text-xs">
				{balance?.computedAt
					? t("workBalance.updatedEveryThreeHours", "Updated every 3 hours")
					: t("workBalance.pendingDescription", "The worker will calculate this balance soon.")}
			</p>
		</CardHeader>
	</Card>
);
```

- [ ] **Step 2: Confirm non-compact balance cards are unchanged**

Verify `WorkBalanceCard` without `compact` still renders with default `Card` and `CardHeader` spacing. This protects usage in `apps/webapp/src/components/time-tracking/weekly-summary-cards.tsx`.

### Task 5: Verification

**Files:**
- Test: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run apps/webapp/src/components/calendar/calendar-view.test.tsx
```

Expected: tests pass. If the command is not supported by the workspace script layout, run the closest existing focused command for this test file and record the exact command used.

- [ ] **Step 2: Run static checks for edited files**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: TypeScript completes without errors. If the repo uses a package-specific typecheck command, use that command and record the exact command used.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git diff -- apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/calendar-filters.tsx apps/webapp/src/components/calendar/calendar-legend.tsx apps/webapp/src/components/work-balance/work-balance-card.tsx
```

Expected: diff contains only sidebar ordering and class-name changes, with no data fetching, permission, filter-state, or translation-key changes.

## Self-Review

- Spec coverage: sidebar order, unboxed employee selector, compact titled card headers, dark-mode theme tokens, and matching all-time balance style are each covered by Tasks 1-4.
- Placeholder scan: no placeholder implementation steps remain.
- Type consistency: all referenced components and props already exist; no new types or exports are introduced.
