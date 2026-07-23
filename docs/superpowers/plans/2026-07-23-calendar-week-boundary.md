# Calendar Week Boundary Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load events, requirements, and actual minutes for every local date shown in a cross-month or cross-year calendar week.

**Architecture:** Initialize the visible seven-day range from the selected calendar date and week-start preference using Temporal date keys, then retain the exact range reported by Schedule-X during navigation. Pass that range through the calendar query and let the existing organization-scoped API fetch and merge each touched month while using the selected employee timezone for display boundaries.

**Tech Stack:** Next.js, React, TypeScript, Temporal polyfill, TanStack Query, Vitest, Testing Library.

## Global Constraints

- Store canonical event instants in UTC and interpret calendar boundaries in the selected employee's timezone.
- Keep every data request organization-scoped and preserve existing employee authorization.
- Use Temporal for new date arithmetic; native `Date` is limited to service/database boundaries.
- Preserve existing day/month requests and full-year requests.
- Do not modify concurrent unrelated changes.

---

### Task 1: Derive an Inclusive Week Date-Key Range

**Files:**
- Modify: `apps/webapp/src/lib/calendar/date-keys.ts`
- Test: `apps/webapp/src/lib/calendar/date-keys.test.ts`

**Interfaces:**
- Consumes: `WeekStartDay` from `@/lib/user-preferences/week-start`.
- Produces: `calendarWeekDateKeyRange(dateKey: string, weekStartDay: WeekStartDay): { startDateKey: string; endDateKey: string }`.

- [ ] **Step 1: Write failing Monday- and Sunday-start tests**

```ts
it("returns an inclusive Monday-start week across a month boundary", () => {
	expect(calendarWeekDateKeyRange("2026-09-03", "monday")).toEqual({
		startDateKey: "2026-08-31",
		endDateKey: "2026-09-06",
	});
});

it("returns an inclusive Sunday-start week across a year boundary", () => {
	expect(calendarWeekDateKeyRange("2027-01-01", "sunday")).toEqual({
		startDateKey: "2026-12-27",
		endDateKey: "2027-01-02",
	});
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/calendar/date-keys.test.ts
```

Expected: FAIL because `calendarWeekDateKeyRange` is not exported.

- [ ] **Step 3: Implement the Temporal helper**

```ts
export function calendarWeekDateKeyRange(
	dateKey: string,
	weekStartDay: WeekStartDay,
): { startDateKey: string; endDateKey: string } {
	const date = Temporal.PlainDate.from(dateKey);
	const daysSinceStart =
		weekStartDay === "monday" ? date.dayOfWeek - 1 : date.dayOfWeek % 7;
	const start = date.subtract({ days: daysSinceStart });

	return {
		startDateKey: start.toString(),
		endDateKey: start.add({ days: 6 }).toString(),
	};
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/calendar/date-keys.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the helper**

```bash
git add apps/webapp/src/lib/calendar/date-keys.ts apps/webapp/src/lib/calendar/date-keys.test.ts
git commit -m "fix(calendar): derive visible week date range"
```

### Task 2: Send the Visible Week Range in Calendar Queries

**Files:**
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Modify: `apps/webapp/src/hooks/use-calendar-data.ts`
- Test: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

**Interfaces:**
- Consumes: `calendarWeekDateKeyRange(...)` from Task 1 and `useWeekStartDay()`.
- Produces: optional `dateRange: { startDateKey: string; endDateKey: string }` on `UseCalendarDataOptions`; query parameters `rangeStart` and `rangeEnd`.

- [ ] **Step 1: Write a failing component regression test**

Extend the user-preferences mock with `useWeekStartDay: () => "monday"`, render:

```tsx
render(
	<CalendarView
		organizationId="org-1"
		currentEmployeeId="employee-1"
		initialDateKey="2026-09-03"
		initialTimezone="Europe/Berlin"
	/>,
);

expect(capturedCalendarQueries.at(-1)).toMatchObject({
	dateRange: {
		startDateKey: "2026-08-31",
		endDateKey: "2026-09-06",
	},
});
```

Extend the Schedule-X mock with an `onRangeChange` button that reports
`2026-12-28` through `2027-01-03`; click it and assert the latest query contains
that exact range. Also switch to month view and assert the latest query has
`dateRange: undefined`, preserving the month request.

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/calendar/calendar-view.test.tsx
```

Expected: FAIL because week queries do not contain `dateRange`.

- [ ] **Step 3: Add the optional query range**

In `UseCalendarDataOptions` add:

```ts
dateRange?: {
	startDateKey: string;
	endDateKey: string;
};
```

Pass it into `fetchCalendarEvents`, include it in `queryParams`, and build parameters with this precedence:

```ts
if (dateRange) {
	params.set("rangeStart", dateRange.startDateKey);
	params.set("rangeEnd", dateRange.endDateKey);
} else if (fullYear) {
	params.set("fullYear", "true");
} else if (month !== undefined) {
	params.set("month", month.toString());
}
```

- [ ] **Step 4: Derive the week range in `CalendarView`**

Read `weekStartDay` with `useWeekStartDay()`, initialize `visibleDateRange` with:

```ts
const [visibleDateRange, setVisibleDateRange] = useState(() =>
	calendarWeekDateKeyRange(currentDateKey, weekStartDay),
);
```

Update `handleRangeChange` to retain the reported range before updating the
midpoint. Pass `dateRange: viewMode === "week" ? visibleDateRange : undefined`
to `useCalendarData`. This gives the initial week a complete fallback range and
uses Schedule-X's exact visible range after navigation.

- [ ] **Step 5: Run the component test and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/calendar/calendar-view.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit client query wiring**

```bash
git add apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx apps/webapp/src/hooks/use-calendar-data.ts
git commit -m "fix(calendar): request the complete visible week"
```

### Task 3: Load and Merge Every Month Touched by a Week Range

**Files:**
- Modify: `apps/webapp/src/app/api/calendar/events/route.ts`
- Test: `apps/webapp/src/app/api/calendar/events/route.test.ts`

**Interfaces:**
- Consumes: inclusive `rangeStart` and `rangeEnd` ISO date keys; existing `fetchMonthEvents(...)`.
- Produces: the existing calendar response shape with merged unique events, merged daily actuals, exact employee-local daily requirement boundaries, and HTTP 400 for invalid ranges.

- [ ] **Step 1: Write failing cross-month and cross-year API tests**

For `rangeStart=2026-08-31&rangeEnd=2026-09-06`, assert that month indexes 7 and 8 are requested with year 2026 and that unique events/actuals from both results are returned.

For `rangeStart=2026-12-28&rangeEnd=2027-01-03`, assert calls for `{ month: 11, year: 2026 }` and `{ month: 0, year: 2027 }`.

Assert the Berlin requirement boundaries for the first range:

```ts
expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith({
	organizationId: "org-1",
	employeeId: "employee-1",
	startDate: new Date("2026-08-30T22:00:00.000Z"),
	endDate: new Date("2026-09-06T21:59:59.999Z"),
	timezone: "Europe/Berlin",
});
```

- [ ] **Step 2: Write failing validation tests**

Assert HTTP 400 for:

```text
rangeStart without rangeEnd
2026-02-30 as either boundary
rangeStart later than rangeEnd
an inclusive range longer than seven dates
```

- [ ] **Step 3: Run the route test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/app/api/calendar/events/route.test.ts
```

Expected: FAIL because the route still requires `month` and ignores the range.

- [ ] **Step 4: Parse and validate the inclusive range with Temporal**

Add a focused parser returning `null` when neither range parameter exists and throwing `RangeError` when only one is present, either date is invalid, the order is descending, or `start.until(end).days > 6`.

Use `parsePlainDate` for strict `YYYY-MM-DD` parsing. Convert the first local midnight and the midnight after the inclusive end using `localDayRange` and the authorized employee timezone. Convert to `Date` only when calling existing services:

```ts
const startRange = localDayRange(range.startDateKey, timezone);
const endRange = localDayRange(range.endDateKey, timezone);
const startDate = dateFromInstant(startRange.start);
const endExclusive = dateFromInstant(endRange.endExclusive);
const endDate = new Date(endExclusive.getTime() - 1);
```

- [ ] **Step 5: Enumerate and fetch touched months**

Start at `range.start.with({ day: 1 })`, advance with `add({ months: 1 })` until the end month is included, and call `fetchMonthEvents` for each `{ year, month: month - 1 }`.

Merge with the same semantics as full-year mode:

```ts
const eventsById = new Map<string, CalendarEvent>();
for (const event of monthResults.flatMap((result) => result.events)) {
	if (!eventsById.has(event.id)) eventsById.set(event.id, event);
}
events = [...eventsById.values()];
dailyActualMinutes = Object.assign(
	{},
	...monthResults.map((result) => result.dailyActualMinutes),
);
```

Range mode takes precedence over `fullYear` and `month`; existing modes retain their current behavior.

- [ ] **Step 6: Return HTTP 400 for range validation errors**

Catch range parsing errors before month fetching and return:

```ts
NextResponse.json({ error: "Invalid calendar date range" }, { status: 400 });
```

Do not change organization or employee authorization.

- [ ] **Step 7: Run the route test and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/app/api/calendar/events/route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit server range support**

```bash
git add apps/webapp/src/app/api/calendar/events/route.ts apps/webapp/src/app/api/calendar/events/route.test.ts
git commit -m "fix(calendar): merge cross-boundary week data"
```

### Task 4: Verify the Calendar Regression

**Files:**
- No production changes expected.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: verification evidence for the completed fix.

- [ ] **Step 1: Run all focused calendar tests**

```bash
pnpm --filter webapp exec vitest run \
	src/lib/calendar/date-keys.test.ts \
	src/components/calendar/calendar-view.test.tsx \
	src/components/calendar/schedule-x-calendar.test.tsx \
	src/app/api/calendar/events/route.test.ts
```

Expected: all tests PASS with no unhandled errors.

- [ ] **Step 2: Run the webapp TypeScript check**

```bash
pnpm --filter webapp typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Inspect the final diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; unrelated concurrent changes remain untouched and are reported separately.
