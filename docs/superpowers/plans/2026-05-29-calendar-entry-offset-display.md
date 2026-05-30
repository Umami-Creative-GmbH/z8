# Calendar Entry Offset Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render calendar work-period blocks using each linked time entry's saved UTC offset and show the saved timezone context in the block.

**Architecture:** Keep persisted UTC instants unchanged. Extend only the Schedule-X adapter so work-period endpoints can render in fixed-offset zones derived from `WorkPeriodEvent.metadata`, with calendar timezone fallback when offset metadata is absent.

**Tech Stack:** Next.js app code, TypeScript, Luxon for formatting, Temporal polyfill for Schedule-X event values, Vitest for adapter tests.

---

## File Structure

- Modify: `apps/webapp/src/lib/calendar/schedule-x-adapter.ts`
- Test: `apps/webapp/src/lib/calendar/schedule-x-adapter.test.ts`

## Task 1: Add Offset Rendering Tests

**Files:**
- Test: `apps/webapp/src/lib/calendar/schedule-x-adapter.test.ts`

- [ ] **Step 1: Add failing tests for saved endpoint offsets**

Add these test cases inside the existing `describe("calendarEventToScheduleX", () => { ... })` block:

```ts
	it("renders work periods at the saved clock-in and clock-out offsets", () => {
		const workPeriod: WorkPeriodEvent = {
			id: "work-utc-plus-two",
			type: "work_period",
			date: new Date("2026-05-18T06:00:00.000Z"),
			endDate: new Date("2026-05-18T08:00:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: {
				durationMinutes: 120,
				employeeName: "Kai Hentschel",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
				clockOutUtcOffsetMinutes: 120,
				clockOutTimezone: "Europe/Berlin",
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(workPeriod, "UTC");

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-18T08:00:00+02:00[+02:00]");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-18T10:00:00+02:00[+02:00]");
		expect(scheduleXEvent?._customContent?.timeGrid).toContain("UTC+02:00");
	});

	it("uses different saved offsets for travel work-period endpoints", () => {
		const workPeriod: WorkPeriodEvent = {
			id: "work-travel",
			type: "work_period",
			date: new Date("2026-05-18T06:00:00.000Z"),
			endDate: new Date("2026-05-18T11:00:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: {
				durationMinutes: 300,
				employeeName: "Kai Hentschel",
				clockInUtcOffsetMinutes: 120,
				clockInTimezone: "Europe/Berlin",
				clockOutUtcOffsetMinutes: -300,
				clockOutTimezone: "America/New_York",
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(workPeriod, "UTC");

		expect(scheduleXEvent?.start.toString()).toBe("2026-05-18T08:00:00+02:00[+02:00]");
		expect(scheduleXEvent?.end.toString()).toBe("2026-05-18T06:00:00-05:00[-05:00]");
		expect(scheduleXEvent?._customContent?.timeGrid).toContain("UTC+02:00 -> UTC-05:00");
	});

	it("falls back to the configured calendar timezone when saved offsets are missing", () => {
		const workPeriod: WorkPeriodEvent = {
			id: "work-fallback",
			type: "work_period",
			date: new Date("2026-05-18T07:40:00.000Z"),
			endDate: new Date("2026-05-18T15:40:00.000Z"),
			title: "Work period",
			color: "#10b981",
			metadata: {
				durationMinutes: 480,
				employeeName: "Kai Hentschel",
			},
		};

		const scheduleXEvent = calendarEventToScheduleX(workPeriod, "America/New_York");

		expect(scheduleXEvent?.start.toString()).toBe(
			"2026-05-18T03:40:00-04:00[America/New_York]",
		);
		expect(scheduleXEvent?.end.toString()).toBe(
			"2026-05-18T11:40:00-04:00[America/New_York]",
		);
	});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `pnpm --filter webapp test src/lib/calendar/schedule-x-adapter.test.ts`

Expected: the new saved-offset tests fail because work periods still render in the configured calendar timezone and no timezone label custom content exists for completed work periods.

## Task 2: Implement Fixed-Offset Endpoint Conversion

**Files:**
- Modify: `apps/webapp/src/lib/calendar/schedule-x-adapter.ts`

- [ ] **Step 1: Add offset formatting helpers near `toTemporalZonedDateTime`**

Add these helpers after `toTemporalZonedDateTime`:

```ts
function formatUtcOffsetMinutes(offsetMinutes: number): string {
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteMinutes = Math.abs(offsetMinutes);
	const hours = Math.floor(absoluteMinutes / 60);
	const minutes = absoluteMinutes % 60;

	return `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function toTemporalZonedDateTimeWithOffset(
	date: Date | string | unknown,
	offsetMinutes: number | undefined,
	fallbackTimeZone: string | undefined,
): Temporal.ZonedDateTime {
	if (typeof offsetMinutes !== "number") {
		return toTemporalZonedDateTime(date, fallbackTimeZone);
	}

	const safeDate = toSafeDate(date);
	const offsetZone = formatUtcOffsetMinutes(offsetMinutes).replace("UTC", "");
	return Temporal.Instant.from(safeDate.toISOString()).toZonedDateTimeISO(offsetZone);
}

function buildWorkPeriodTimezoneLabel(event: CalendarEvent): string | null {
	if (event.type !== "work_period") return null;

	const clockInOffset = event.metadata.clockInUtcOffsetMinutes;
	const clockOutOffset = event.metadata.clockOutUtcOffsetMinutes;
	const startLabel =
		typeof clockInOffset === "number" ? formatUtcOffsetMinutes(clockInOffset) : undefined;
	const endLabel =
		typeof clockOutOffset === "number" ? formatUtcOffsetMinutes(clockOutOffset) : startLabel;

	if (!startLabel && !endLabel) return null;
	if (startLabel === endLabel) return startLabel ?? null;

	return `${startLabel ?? "calendar timezone"} -> ${endLabel ?? "calendar timezone"}`;
}
```

- [ ] **Step 2: Update work-period conversion to use endpoint offsets**

Replace this block in `calendarEventToScheduleX`:

```ts
		if (event.type === "work_period") {
			// Work periods span from clock-in to clock-out
			// Display as a timed block showing work time
			// Breaks appear as gaps between these blocks
			const start = toTemporalZonedDateTime(startDate, timeZone);
			const end = toTemporalZonedDateTime(endDate, timeZone);
```

with:

```ts
		if (event.type === "work_period") {
			// Work periods render in the timezone context captured on each endpoint.
			const start = toTemporalZonedDateTimeWithOffset(
				startDate,
				event.metadata.clockInUtcOffsetMinutes,
				timeZone,
			);
			const end = toTemporalZonedDateTimeWithOffset(
				endDate,
				event.metadata.clockOutUtcOffsetMinutes,
				timeZone,
			);
			const timezoneLabel = buildWorkPeriodTimezoneLabel(event);
```

- [ ] **Step 3: Add custom block timezone content for completed work periods**

Replace the returned object fragment:

```ts
				...(event.metadata.isRunning && {
					_customContent: {
						timeGrid: `<span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true"></span><span>${escapeHtml(event.title)}</span></span>`,
					},
				}),
```

with:

```ts
				...((event.metadata.isRunning || timezoneLabel) && {
					_customContent: {
						timeGrid: event.metadata.isRunning
							? `<span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full bg-red-500 animate-pulse" aria-hidden="true"></span><span>${escapeHtml(event.title)}</span>${timezoneLabel ? `<span class="text-[10px] opacity-80">${escapeHtml(timezoneLabel)}</span>` : ""}</span>`
							: `<span class="inline-flex flex-col gap-0.5"><span>${escapeHtml(event.title)}</span><span class="text-[10px] opacity-80">${escapeHtml(timezoneLabel ?? "")}</span></span>`,
					},
				}),
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `pnpm --filter webapp test src/lib/calendar/schedule-x-adapter.test.ts`

Expected: all tests in `schedule-x-adapter.test.ts` pass.

## Task 3: Final Verification

**Files:**
- Verify: `apps/webapp/src/lib/calendar/schedule-x-adapter.ts`
- Verify: `apps/webapp/src/lib/calendar/schedule-x-adapter.test.ts`

- [ ] **Step 1: Run targeted calendar tests**

Run: `pnpm --filter webapp test src/lib/calendar/schedule-x-adapter.test.ts src/components/calendar/schedule-x-calendar.test.tsx`

Expected: both test files pass.

- [ ] **Step 2: Check worktree diff**

Run: `git diff -- apps/webapp/src/lib/calendar/schedule-x-adapter.ts apps/webapp/src/lib/calendar/schedule-x-adapter.test.ts docs/superpowers/specs/2026-05-29-calendar-entry-offset-display-design.md docs/superpowers/plans/2026-05-29-calendar-entry-offset-display.md`

Expected: diff only contains the spec, plan, adapter helper changes, work-period conversion change, custom timezone label content, and tests.

- [ ] **Step 3: Commit if explicitly requested**

Do not commit by default in this environment. If the user explicitly requests a commit, run:

```bash
git add apps/webapp/src/lib/calendar/schedule-x-adapter.ts apps/webapp/src/lib/calendar/schedule-x-adapter.test.ts docs/superpowers/specs/2026-05-29-calendar-entry-offset-display-design.md docs/superpowers/plans/2026-05-29-calendar-entry-offset-display.md
```

Expected: commit succeeds after tests pass.

## Self-Review

- Spec coverage: the plan covers saved per-entry offsets, fallback behavior, visible timezone context, and adapter-level tests.
- Placeholder scan: no placeholder steps remain.
- Type consistency: helper names and metadata fields match `WorkPeriodEvent.metadata` in `apps/webapp/src/lib/calendar/types.ts`.
