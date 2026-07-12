# Schedule-X Controls Lifecycle Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `ScheduleXCalendarWrapper` from calling the Schedule-X controls plugin before its calendar app is initialized while preserving initial and parent-driven date selection.

**Architecture:** Use the nullable calendar app returned by `useCalendarApp()` as the controls-readiness signal. Supply the initial `Temporal.PlainDate` declaratively through Schedule-X config, then use the controls plugin only after the calendar app exists.

**Tech Stack:** Next.js 16.2.10, React 19.2.7, TypeScript, Schedule-X 4.6.1, Temporal polyfill 1.0.1, Vitest, Testing Library

## Global Constraints

- Use pnpm only.
- Keep calendar business dates as Temporal values with explicit calendar date keys; do not introduce native `Date` calendar math.
- Preserve selected-employee timezone semantics and do not derive calendar meaning from the viewer timezone.
- Do not modify or discard unrelated concurrent changes.
- Make no visual or interaction changes beyond preventing the initialization crash.

---

## File Structure

- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`: model Schedule-X's nullable, effect-initialized hook lifecycle and hold the regression coverage.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`: configure the initial selected date and gate imperative date synchronization on calendar readiness.

### Task 1: Guard Schedule-X Date Synchronization by Calendar Readiness

**Files:**
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx:9-172`
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx:262-290`

**Interfaces:**
- Consumes: `useCalendarApp(config): CalendarApp | null`, `calendarControls.setDate(date: Temporal.PlainDate): void`, and `CalendarConfig.selectedDate?: Temporal.PlainDate`.
- Produces: a wrapper that initializes to `currentDateKey` declaratively and invokes `setDate()` only after `calendar` is non-null.

- [ ] **Step 1: Replace the eager calendar mock with a lifecycle-accurate test double**

Update the React import and the Schedule-X mocks in `schedule-x-calendar.test.tsx` so the hook returns `null` for its first render, initializes plugins in an effect, and then returns the calendar app. Make the controls plugin fail loudly if `setDate()` is invoked before `beforeRender()`:

```tsx
import { useEffect, useRef, useState } from "react";

const useCalendarAppMock = vi.hoisted(() => vi.fn());

type ScheduleXPluginTestDouble = {
	beforeRender?: () => void;
	setDate?: ReturnType<typeof vi.fn>;
};

function useCalendarAppTestDouble(config: { plugins: ScheduleXPluginTestDouble[] }) {
	const initialPlugins = useRef(config.plugins);
	const [calendar, setCalendar] = useState<{
		events: { set: ReturnType<typeof vi.fn> };
		setTheme: ReturnType<typeof vi.fn>;
	} | null>(null);

	useEffect(() => {
		for (const plugin of initialPlugins.current) plugin.beforeRender?.();
		setCalendar({
			events: { set: vi.fn() },
			setTheme: vi.fn(),
		});
	}, []);

	return calendar;
}
```

Replace the controls mock with:

```tsx
vi.mock("@schedule-x/calendar-controls", () => ({
	createCalendarControlsPlugin: () => {
		let isInitialized = false;
		return {
			beforeRender: () => {
				isInitialized = true;
			},
			setDate: vi.fn(() => {
				if (!isInitialized) {
					throw new TypeError("Cannot read properties of undefined (reading 'datePickerState')");
				}
			}),
			setView: vi.fn(),
		};
	},
}));
```

Configure the hook implementation in `beforeEach`:

```tsx
beforeEach(() => {
	useCalendarAppMock.mockReset();
	useCalendarAppMock.mockImplementation(useCalendarAppTestDouble);
});
```

- [ ] **Step 2: Add regression assertions for the uninitialized lifecycle and declarative initial date**

Add these tests at the start of the `ScheduleXCalendarWrapper header` suite:

```tsx
it("waits for the calendar app before synchronizing the selected date", () => {
	expect(() =>
		render(
			<ScheduleXCalendarWrapper
				events={[]}
				initialDateKey="2026-05-18"
				isLoading
				onViewModeChange={vi.fn()}
				viewMode="day"
			/>,
		),
	).not.toThrow();
});

it("provides the initial date to Schedule-X configuration", () => {
	render(
		<ScheduleXCalendarWrapper
			events={[]}
			initialDateKey="2026-05-18"
			onViewModeChange={vi.fn()}
			viewMode="day"
		/>,
	);

	expect(useCalendarAppMock.mock.calls[0]?.[0].selectedDate).toEqual(
		Temporal.PlainDate.from("2026-05-18"),
	);
});
```

- [ ] **Step 3: Run the focused test and verify the regression fails for the expected reasons**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/calendar/schedule-x-calendar.test.tsx
```

Expected: FAIL because the existing synchronization effect calls `setDate()` before plugin initialization, and because `selectedDate` is absent from the Schedule-X config.

- [ ] **Step 4: Implement the minimal lifecycle fix**

Delete the existing synchronization effect above `handleViewModeChange`. Add `selectedDate` to the `useCalendarApp` config and place the guarded synchronization effect immediately after the hook:

```tsx
const calendar = useCalendarApp({
	views: [createViewDay(), createViewWeek(), createViewMonthGrid(), createViewMonthAgenda()],
	defaultView: viewModeToScheduleX[viewMode],
	selectedDate: Temporal.PlainDate.from(currentDateKey),
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	events: scheduleXEvents as any,
	isDark,
	isResponsive: false,
	locale: scheduleXLocale,
	calendars: getScheduleXCalendars(),
	plugins: [createEventModalPlugin(), calendarControls],
	callbacks: {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		onEventClick: handleEventClick as any,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		onRangeUpdate: handleRangeChange as any,
	},
});

useEffect(() => {
	if (!calendar) return;
	calendarControls.setDate(Temporal.PlainDate.from(currentDateKey));
}, [calendar, calendarControls, currentDateKey]);
```

- [ ] **Step 5: Run the focused test and verify all calendar tests pass**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/calendar/schedule-x-calendar.test.tsx
```

Expected: PASS with zero failed tests, including the existing parent-driven date update test.

- [ ] **Step 6: Run formatting and type verification for the changed files**

Run:

```bash
pnpm --filter webapp exec biome check src/components/calendar/schedule-x-calendar.tsx src/components/calendar/schedule-x-calendar.test.tsx
pnpm --filter webapp typecheck
```

Expected: both commands exit 0 with no new diagnostics in the changed files.

- [ ] **Step 7: Run React diagnostics and review the final diff**

Follow the repository's `react-doctor` skill against the completed React change, then run:

```bash
git diff --check
git diff -- apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx
```

Expected: React diagnostics report no regression caused by this change; `git diff --check` exits 0; the diff contains only the lifecycle test double, two regression assertions, `selectedDate`, and the guarded effect relocation.

- [ ] **Step 8: Commit the tested fix**

```bash
git add apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx
git commit -m "fix(calendar): wait for Schedule-X controls"
```
