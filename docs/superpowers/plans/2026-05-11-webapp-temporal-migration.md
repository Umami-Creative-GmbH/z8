# Webapp Temporal Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Z8 webapp date/time domain from Luxon and ad-hoc `Date` usage to native Temporal-compatible types while preserving existing database and API payload contracts.

**Architecture:** Introduce a small Temporal boundary module in `apps/webapp/src/lib/datetime` and migrate callers vertically. Keep Drizzle, Better Auth, third-party calendars, and existing JSON APIs on `Date`/ISO strings at their boundaries until each surface has explicit adapters and regression tests.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Vitest, Drizzle ORM, `temporal-polyfill` 0.3.2, current Luxon 3 compatibility layer during migration.

---

## Discovery Snapshot

- Runtime/polyfill: `apps/webapp/package.json` already depends on `temporal-polyfill` 0.3.2, so webapp code can import `Temporal` from `temporal-polyfill` without changing dependencies.
- Current central abstraction: `apps/webapp/src/lib/datetime/luxon-utils.ts`, `apps/webapp/src/lib/datetime/format.ts`, `apps/webapp/src/lib/datetime/drizzle-adapter.ts`, and `apps/webapp/src/lib/datetime/zod-adapters.ts` are Luxon-first.
- Current scale: `apps/webapp/src` has 221 files importing Luxon and 422 files with direct `new Date`, `Date.now`, `getTime`, or `toISOString` usage.
- Third-party constraints: Drizzle timestamp columns return `Date`; DayPicker and Schedule-X APIs still accept/emit `Date` or their own string formats; `cron-parser` accepts `Date` inputs for `currentDate`.
- Highest-risk webapp surfaces: time tracking, absences, scheduling, payroll exports, reports, scheduled exports, notifications, compliance rules, and Teams/Slack/Telegram cards/jobs.

## Migration Matrix

| Current usage | Target Temporal type/helper | Boundary rule |
| --- | --- | --- |
| `DateTime` for persisted timestamp | `Temporal.Instant` | Convert to `Date` only in Drizzle adapter functions. Serialize as ISO string with `Z`. |
| `DateTime` with `.setZone(timezone)` for user-local display | `Temporal.ZonedDateTime` | Require an explicit IANA timezone argument. Never infer server-local timezone. |
| `DateTime` for date-only form values or absences | `Temporal.PlainDate` | Serialize as `YYYY-MM-DD`; convert to UTC timestamp only for legacy DB columns. |
| `DateTime` for time-only inputs | `Temporal.PlainTime` | Serialize as `HH:mm` or `HH:mm:ss`; combine with `PlainDate` and timezone before persistence. |
| `DateTime.fromJSDate(date, { zone: "utc" })` | `instantFromDate(date)` | Adapter-only conversion. Domain code should receive `Temporal.Instant`. |
| `DateTime.fromISO(value)` | `instantFromIso(value)` or `plainDateFromIso(value)` | Pick based on payload semantics, not string shape alone. |
| `.toJSDate()` | `dateFromInstant(instant)` | Adapter-only conversion at Drizzle, DayPicker, Schedule-X, cron-parser, and mail/template boundaries. |
| `.toISO()` | `isoFromInstant(instant)` or `.toString()` | Preserve existing public API response strings until a versioned API change exists. |
| `.toISODate()` | `plainDate.toString()` | Use only for calendar-date concepts. |
| `.startOf("day")` in zone | `startOfPlainDateInZone(date, timezone)` | Return `Temporal.Instant` for DB queries. |
| `.endOf("day")` in zone | `endOfPlainDateInZone(date, timezone)` | Use exclusive end instants where possible; keep inclusive helpers only where existing SQL requires it. |
| `DateTime.now()` / `DateTime.utc()` | `Temporal.Now.instant()` or `nowPlainDate(timezone)` | Clock helpers live in `time.ts` for tests. |
| `new Date()` for timestamps | `nowInstant()` | Convert to `Date` at DB boundary only. |
| `new Date("YYYY-MM-DD")` | `Temporal.PlainDate.from(value)` | Avoid timezone drift from date-only parsing. |
| `Date#getTime()` duration math | `Temporal.Instant.compare` or `.since()` | Use Instant math for elapsed time and PlainDate math for calendar rules. |
| Luxon interval splitting | `plainDatesBetween(start, end)` | Return `Temporal.PlainDate[]` for calendar iterations. |
| `z.date()` form schemas | `zTemporalPlainDate` / `zTemporalInstant` | Keep compatibility transforms for DOM date inputs. |

## Staged PR Plan And Rollback Points

1. PR 1: Add Temporal core module and tests, no caller migration. Rollback: delete the new files and dependency imports; no behavior changes.
2. PR 2: Add Temporal-compatible Drizzle/Zod/display adapters while keeping Luxon exports. Rollback: revert adapter exports; existing Luxon callers continue working.
3. PR 3: Migrate `time-tracking` date-boundary utilities and tests. Rollback: restore `timezone-utils.ts` from previous commit; DB schema and API contracts unchanged.
4. PR 4: Migrate absences and scheduling calendar-date logic to `Temporal.PlainDate`. Rollback: revert those feature folders; existing form payloads remain `YYYY-MM-DD`.
5. PR 5: Migrate exports/reports/compliance/scheduled jobs by vertical slice. Rollback: revert one slice at a time because adapters remain dual-compatible.
6. PR 6: Remove Luxon from shared datetime module and block new Luxon imports. Rollback: remove lint rule and re-enable compatibility exports until all callers are clean.

## Files

- Create: `apps/webapp/src/lib/datetime/time.ts` for canonical Temporal type aliases, clock helpers, parsing, serialization, timezone helpers, and Date adapters.
- Create: `apps/webapp/src/lib/datetime/time.test.ts` for DST, leap year, date-only parsing, adapter, and timezone tests.
- Modify: `apps/webapp/src/lib/datetime/drizzle-adapter.ts` to add Temporal Instant DB adapters while preserving existing Luxon adapter exports during transition.
- Modify: `apps/webapp/src/lib/datetime/zod-adapters.ts` to add Temporal Zod schemas alongside current Luxon schemas.
- Modify: `apps/webapp/src/lib/time-tracking/timezone-utils.ts` to use Temporal internally while returning existing `DateTime` values only where downstream callers still require them.
- Modify: `apps/webapp/src/lib/user-preferences/week-start.ts` after `timezone-utils.ts`, replacing Luxon week-bound calculations with PlainDate/ZonedDateTime helpers.
- Modify: `apps/webapp/src/lib/datetime/luxon-utils.ts` only in the final cleanup PR to deprecate or remove Luxon helpers.
- Modify: `apps/webapp/package.json` only in the final cleanup PR to remove `luxon` and `@types/luxon` after all imports are gone.

## Task 1: Add Temporal Core Boundary

**Files:**
- Create: `apps/webapp/src/lib/datetime/time.ts`
- Create: `apps/webapp/src/lib/datetime/time.test.ts`

- [ ] **Step 1: Write failing tests for Temporal adapters and calendar boundaries**

```ts
import { describe, expect, it } from "vitest";
import {
	dateFromInstant,
	endOfPlainDateInZone,
	instantFromDate,
	instantFromIso,
	isoFromInstant,
	plainDateFromIso,
	plainDatesBetween,
	startOfPlainDateInZone,
} from "./time";

describe("Temporal time boundary helpers", () => {
	it("round-trips Date through Instant at the DB boundary", () => {
		const date = new Date("2026-05-11T08:15:30.000Z");
		const instant = instantFromDate(date);

		expect(isoFromInstant(instant)).toBe("2026-05-11T08:15:30Z");
		expect(dateFromInstant(instant).toISOString()).toBe("2026-05-11T08:15:30.000Z");
	});

	it("parses timestamp and calendar-only values with different Temporal types", () => {
		expect(instantFromIso("2026-05-11T08:15:30.000Z").epochMilliseconds).toBe(1778487330000);
		expect(plainDateFromIso("2026-05-11").toString()).toBe("2026-05-11");
	});

	it("calculates Berlin DST day boundaries as UTC instants", () => {
		const date = plainDateFromIso("2026-03-29");

		expect(startOfPlainDateInZone(date, "Europe/Berlin").toString()).toBe("2026-03-28T23:00:00Z");
		expect(endOfPlainDateInZone(date, "Europe/Berlin").toString()).toBe("2026-03-29T21:59:59.999999999Z");
	});

	it("iterates calendar dates without timestamp math", () => {
		expect(
			plainDatesBetween(plainDateFromIso("2026-02-27"), plainDateFromIso("2026-03-01")).map((date) =>
				date.toString(),
			),
		).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
	});
});
```

- [ ] **Step 2: Run the new test and verify it fails because `time.ts` does not exist**

Run: `pnpm --dir apps/webapp vitest run src/lib/datetime/time.test.ts`

Expected: FAIL with an import resolution error for `./time`.

- [ ] **Step 3: Add the Temporal boundary module**

```ts
import { Temporal } from "temporal-polyfill";

export type Instant = Temporal.Instant;
export type ZonedDateTime = Temporal.ZonedDateTime;
export type PlainDate = Temporal.PlainDate;
export type PlainTime = Temporal.PlainTime;
export type PlainDateTime = Temporal.PlainDateTime;

export const UTC_TIMEZONE = "UTC";

export function nowInstant(): Instant {
	return Temporal.Now.instant();
}

export function todayPlainDate(timeZone: string): PlainDate {
	return Temporal.Now.plainDateISO(timeZone);
}

export function instantFromDate(date: Date): Instant {
	return Temporal.Instant.from(date.toISOString());
}

export function dateFromInstant(instant: Instant): Date {
	return new Date(instant.epochMilliseconds);
}

export function instantFromIso(value: string): Instant {
	return Temporal.Instant.from(value);
}

export function plainDateFromIso(value: string): PlainDate {
	return Temporal.PlainDate.from(value);
}

export function plainTimeFromIso(value: string): PlainTime {
	return Temporal.PlainTime.from(value);
}

export function isoFromInstant(instant: Instant): string {
	return instant.toString();
}

export function zonedDateTimeFromInstant(instant: Instant, timeZone: string): ZonedDateTime {
	return instant.toZonedDateTimeISO(timeZone);
}

export function startOfPlainDateInZone(date: PlainDate, timeZone: string): Instant {
	return date.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") }).toInstant();
}

export function endOfPlainDateInZone(date: PlainDate, timeZone: string): Instant {
	return date
		.add({ days: 1 })
		.toZonedDateTime({ timeZone, plainTime: Temporal.PlainTime.from("00:00") })
		.toInstant()
		.subtract({ nanoseconds: 1 });
}

export function plainDatesBetween(start: PlainDate, end: PlainDate): PlainDate[] {
	const dates: PlainDate[] = [];
	for (let current = start; Temporal.PlainDate.compare(current, end) <= 0; current = current.add({ days: 1 })) {
		dates.push(current);
	}
	return dates;
}

export function compareInstants(left: Instant, right: Instant): number {
	return Temporal.Instant.compare(left, right);
}

export function isValidTimeZone(timeZone: string): boolean {
	try {
		Temporal.Now.instant().toZonedDateTimeISO(timeZone);
		return true;
	} catch {
		return false;
	}
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `pnpm --dir apps/webapp vitest run src/lib/datetime/time.test.ts`

Expected: PASS for all tests in `time.test.ts`.

- [ ] **Step 5: Commit the boundary module**

```bash
git add apps/webapp/src/lib/datetime/time.ts apps/webapp/src/lib/datetime/time.test.ts
git commit -m "feat(webapp): add temporal time boundary"
```

## Task 2: Add Database And Validation Compatibility Adapters

**Files:**
- Modify: `apps/webapp/src/lib/datetime/drizzle-adapter.ts`
- Modify: `apps/webapp/src/lib/datetime/zod-adapters.ts`
- Create: `apps/webapp/src/lib/datetime/temporal-adapters.test.ts`

- [ ] **Step 1: Write failing adapter tests**

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { temporalDateFromDB, temporalDateToDB, temporalNowForDB } from "./drizzle-adapter";
import { instantFromIso, plainDateFromIso } from "./time";
import { instantSchema, plainDateSchema } from "./zod-adapters";

describe("Temporal database and Zod adapters", () => {
	it("converts DB dates to Temporal Instants and back", () => {
		const dbDate = new Date("2026-05-11T08:15:30.000Z");
		const instant = temporalDateFromDB(dbDate);

		expect(instant?.toString()).toBe("2026-05-11T08:15:30Z");
		expect(temporalDateToDB(instant)?.toISOString()).toBe("2026-05-11T08:15:30.000Z");
	});

	it("returns Date for Drizzle default callbacks", () => {
		expect(temporalNowForDB()).toBeInstanceOf(Date);
	});

	it("validates timestamp and date-only payloads", () => {
		const schema = z.object({ startsAt: instantSchema, day: plainDateSchema });

		const parsed = schema.parse({ startsAt: "2026-05-11T08:15:30.000Z", day: "2026-05-11" });

		expect(parsed.startsAt.toString()).toBe(instantFromIso("2026-05-11T08:15:30.000Z").toString());
		expect(parsed.day.toString()).toBe(plainDateFromIso("2026-05-11").toString());
	});
});
```

- [ ] **Step 2: Run the adapter test and verify it fails because exports are missing**

Run: `pnpm --dir apps/webapp vitest run src/lib/datetime/temporal-adapters.test.ts`

Expected: FAIL with missing exports from `drizzle-adapter.ts` and `zod-adapters.ts`.

- [ ] **Step 3: Add Temporal exports to `drizzle-adapter.ts` without removing Luxon exports**

```ts
import { dateFromInstant, instantFromDate, nowInstant, type Instant } from "./time";

export function temporalDateFromDB(date: Date | null | undefined): Instant | null {
	if (!date) return null;
	return instantFromDate(date);
}

export function temporalDateToDB(instant: Instant | null | undefined): Date | null {
	if (!instant) return null;
	return dateFromInstant(instant);
}

export function temporalNowForDB(): Date {
	return dateFromInstant(nowInstant());
}
```

- [ ] **Step 4: Add Temporal schemas to `zod-adapters.ts` without removing Luxon schemas**

```ts
import { Temporal } from "temporal-polyfill";
import type { Instant, PlainDate, PlainTime } from "./time";

export const instantSchema = z
	.string()
	.datetime()
	.transform((value): Instant => Temporal.Instant.from(value));

export const plainDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
	.transform((value): PlainDate => Temporal.PlainDate.from(value));

export const plainTimeSchema = z
	.string()
	.regex(/^\d{2}:\d{2}(:\d{2})?$/, "Time must be in HH:mm or HH:mm:ss format")
	.transform((value): PlainTime => Temporal.PlainTime.from(value));
```

- [ ] **Step 5: Run focused adapter tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/datetime/temporal-adapters.test.ts src/lib/datetime/time.test.ts`

Expected: PASS for both test files.

- [ ] **Step 6: Commit compatibility adapters**

```bash
git add apps/webapp/src/lib/datetime/drizzle-adapter.ts apps/webapp/src/lib/datetime/zod-adapters.ts apps/webapp/src/lib/datetime/temporal-adapters.test.ts
git commit -m "feat(webapp): add temporal compatibility adapters"
```

## Task 3: Migrate Timezone Boundary Utilities Internally

**Files:**
- Modify: `apps/webapp/src/lib/time-tracking/timezone-utils.ts`
- Create: `apps/webapp/src/lib/time-tracking/timezone-utils.temporal.test.ts`

- [ ] **Step 1: Write regression tests for DST and existing return contracts**

```ts
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
	formatDateInZone,
	formatTimeInZone,
	getCalendarDayEndUTC,
	getCalendarDayKey,
	getCalendarDayStartUTC,
	getDayRangeInTimezone,
} from "./timezone-utils";

describe("timezone-utils Temporal migration", () => {
	it("keeps existing DateTime range contract while calculating via explicit timezone", () => {
		const range = getDayRangeInTimezone(DateTime.fromISO("2026-03-29T12:00:00Z"), "Europe/Berlin");

		expect(range.start.toISO()).toBe("2026-03-28T23:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-03-29T21:59:59.999Z");
	});

	it("formats UTC timestamps in the requested timezone", () => {
		expect(formatTimeInZone("2026-05-11T08:15:00.000Z", "Europe/Berlin", false, "24h")).toBe("10:15");
		expect(formatDateInZone("2026-05-11T08:15:00.000Z", "Europe/Berlin")).toContain("May");
	});

	it("maps UTC instants to local calendar day keys", () => {
		expect(getCalendarDayKey(new Date("2026-05-10T22:30:00.000Z"), "Europe/Berlin")).toBe("2026-05-11");
	});

	it("keeps Date boundary adapters for callers that still query Drizzle with Date", () => {
		expect(getCalendarDayStartUTC("2026-03-29", "Europe/Berlin").toISOString()).toBe("2026-03-28T23:00:00.000Z");
		expect(getCalendarDayEndUTC("2026-03-29", "Europe/Berlin").toISOString()).toBe("2026-03-29T21:59:59.999Z");
	});
});
```

- [ ] **Step 2: Run the test against current Luxon implementation as a baseline**

Run: `pnpm --dir apps/webapp vitest run src/lib/time-tracking/timezone-utils.temporal.test.ts`

Expected: PASS before implementation, proving the test captures current behavior.

- [ ] **Step 3: Replace internal date math in `timezone-utils.ts` with Temporal helpers while preserving exported types**

```ts
import { DateTime } from "luxon";
import {
	dateFromInstant,
	endOfPlainDateInZone,
	instantFromDate,
	instantFromIso,
	plainDateFromIso,
	startOfPlainDateInZone,
	todayPlainDate,
	zonedDateTimeFromInstant,
} from "@/lib/datetime/time";
import { fromJSDate } from "@/lib/datetime/luxon-utils";

function toInstant(date: string | Date | DateTime) {
	if (typeof date === "string") return instantFromIso(date);
	if (date instanceof Date) return instantFromDate(date);
	return instantFromIso(date.toUTC().toISO() ?? date.toUTC().toString());
}

function dateTimeFromInstant(instant: ReturnType<typeof instantFromIso>): DateTime {
	return fromJSDate(dateFromInstant(instant), "utc");
}
```

Then update `getDayRangeInTimezone`, `getTodayRangeInTimezone`, `formatTimeInZone`, `formatDateInZone`, `getCalendarDayKey`, `getCalendarDayStartUTC`, and `getCalendarDayEndUTC` to call those helpers. Keep the public function signatures unchanged in this task.

- [ ] **Step 4: Run focused timezone tests**

Run: `pnpm --dir apps/webapp vitest run src/lib/time-tracking/timezone-utils.temporal.test.ts src/lib/time-tracking`

Expected: PASS for timezone tests and existing time-tracking tests.

- [ ] **Step 5: Commit timezone boundary migration**

```bash
git add apps/webapp/src/lib/time-tracking/timezone-utils.ts apps/webapp/src/lib/time-tracking/timezone-utils.temporal.test.ts
git commit -m "refactor(webapp): use temporal for timezone boundaries"
```

## Task 4: Migrate Calendar-Date Vertical Slices

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/holiday-expansion.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/plan-preview.ts`
- Modify: `apps/webapp/src/lib/absences/absence-plan-preview.ts`
- Modify: `apps/webapp/src/components/absences/absence-calendar.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- Modify: existing related tests in the same directories.

- [ ] **Step 1: Add PlainDate tests for absence ranges crossing DST and month boundaries**

```ts
import { describe, expect, it } from "vitest";
import { plainDateFromIso, plainDatesBetween } from "@/lib/datetime/time";

describe("absence calendar date ranges", () => {
	it("expands calendar-only dates without timezone drift", () => {
		const dates = plainDatesBetween(plainDateFromIso("2026-03-28"), plainDateFromIso("2026-03-30"));

		expect(dates.map((date) => date.toString())).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
	});

	it("keeps leap-day absences in the range", () => {
		const dates = plainDatesBetween(plainDateFromIso("2028-02-28"), plainDateFromIso("2028-03-01"));

		expect(dates.map((date) => date.toString())).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
	});
});
```

- [ ] **Step 2: Run affected absence/calendar tests before refactor**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/absences src/lib/absences src/components/absences`

Expected: PASS or only pre-existing unrelated failures recorded in the PR notes.

- [ ] **Step 3: Replace date-only Luxon logic with `Temporal.PlainDate` helpers**

Use this conversion pattern in each modified file:

```ts
import { plainDateFromIso, plainDatesBetween, type PlainDate } from "@/lib/datetime/time";

function toDateKey(date: PlainDate): string {
	return date.toString();
}

function expandDateRange(startDate: string, endDate: string): string[] {
	return plainDatesBetween(plainDateFromIso(startDate), plainDateFromIso(endDate)).map(toDateKey);
}
```

Keep `Date` adapters only where DayPicker or Schedule-X require `Date` values for UI rendering.

- [ ] **Step 4: Run affected absence/calendar tests after refactor**

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/absences src/lib/absences src/components/absences src/components/calendar`

Expected: PASS for affected tests.

- [ ] **Step 5: Commit calendar-date migration**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/absences apps/webapp/src/lib/absences apps/webapp/src/components/absences apps/webapp/src/components/calendar
git commit -m "refactor(webapp): use temporal plain dates for absence calendars"
```

## Task 5: Migrate High-Risk Operational Slices One At A Time

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/queries.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/workday-timeline-date.ts`
- Modify: `apps/webapp/src/lib/reports/report-generator.ts`
- Modify: `apps/webapp/src/lib/payroll-export/data-fetcher.ts`
- Modify: `apps/webapp/src/lib/scheduled-exports/domain/schedule-evaluator.ts`
- Modify: `apps/webapp/src/lib/compliance/rules/presence-requirement-rule.ts`
- Modify: related tests next to each file.

- [ ] **Step 1: Migrate time tracking timestamps first**

Use `Temporal.Instant` for clock events and convert at DB boundaries:

```ts
import { dateFromInstant, instantFromDate, nowInstant } from "@/lib/datetime/time";

const clockedAt = nowInstant();
const dbClockedAt = dateFromInstant(clockedAt);
const existingClockedAt = instantFromDate(row.startTime);
```

Run: `pnpm --dir apps/webapp vitest run src/app/[locale]/\(app\)/time-tracking src/lib/time-tracking src/lib/time-record`

Expected: PASS for time tracking and time record tests.

- [ ] **Step 2: Migrate report and payroll calendar math**

Use `Temporal.PlainDate` for report ranges and `Temporal.Instant` for event timestamps:

```ts
import { plainDateFromIso, plainDatesBetween } from "@/lib/datetime/time";

const reportDates = plainDatesBetween(plainDateFromIso(startDateIso), plainDateFromIso(endDateIso));
const businessDayKeys = reportDates.map((date) => date.toString());
```

Run: `pnpm --dir apps/webapp vitest run src/lib/reports src/lib/payroll-export`

Expected: PASS for report and payroll tests, including month-end ranges.

- [ ] **Step 3: Migrate scheduled export cron boundaries with Date adapter isolation**

Keep `cron-parser` calls on `Date`, but isolate conversions:

```ts
import { dateFromInstant, instantFromDate, nowInstant } from "@/lib/datetime/time";

const currentDate = dateFromInstant(referenceInstant ?? nowInstant());
const nextRunInstant = instantFromDate(interval.next().toDate());
```

Run: `pnpm --dir apps/webapp vitest run src/lib/scheduled-exports`

Expected: PASS for scheduled export tests, including timezone-specific cron cases.

- [ ] **Step 4: Migrate compliance and notification slices after timestamp slices pass**

Use explicit zones for compliance windows:

```ts
import { startOfPlainDateInZone, endOfPlainDateInZone, plainDateFromIso } from "@/lib/datetime/time";

const day = plainDateFromIso(workDate);
const windowStart = startOfPlainDateInZone(day, organizationTimezone);
const windowEnd = endOfPlainDateInZone(day, organizationTimezone);
```

Run: `pnpm --dir apps/webapp vitest run src/lib/compliance src/lib/notifications`

Expected: PASS for compliance and notification tests.

- [ ] **Step 5: Commit each vertical slice separately**

```bash
git add apps/webapp/src/app/[locale]/\(app\)/time-tracking apps/webapp/src/lib/time-tracking apps/webapp/src/lib/time-record
git commit -m "refactor(webapp): migrate time tracking to temporal instants"
git add apps/webapp/src/lib/reports apps/webapp/src/lib/payroll-export
git commit -m "refactor(webapp): migrate reports to temporal dates"
git add apps/webapp/src/lib/scheduled-exports
git commit -m "refactor(webapp): isolate cron date adapters"
git add apps/webapp/src/lib/compliance apps/webapp/src/lib/notifications
git commit -m "refactor(webapp): migrate compliance windows to temporal"
```

## Task 6: Deprecate Luxon And Enforce New Conventions

**Files:**
- Modify: `apps/webapp/src/lib/datetime/luxon-utils.ts`
- Modify: `apps/webapp/src/lib/datetime/format.ts`
- Modify: `apps/webapp/package.json`
- Modify: lint or architecture configuration used by this repo after confirming the active tool config.

- [ ] **Step 1: Confirm no production Luxon imports remain outside temporary compatibility files**

Run: `rg "from ['\"]luxon['\"]" apps/webapp/src --glob '!**/*.test.ts' --glob '!**/*.test.tsx'`

Expected: No production matches, or only explicitly documented compatibility files.

- [ ] **Step 2: Remove Luxon compatibility exports after callers are clean**

Replace the contents of `apps/webapp/src/lib/datetime/luxon-utils.ts` with a migration error stub only if no imports remain:

```ts
throw new Error("luxon-utils has been removed. Use @/lib/datetime/time Temporal helpers instead.");
```

Do not do this step while any production import remains.

- [ ] **Step 3: Remove Luxon dependencies after all imports are gone**

Run: `pnpm --dir apps/webapp remove luxon @types/luxon`

Expected: `apps/webapp/package.json` and the lockfile remove Luxon entries.

- [ ] **Step 4: Add an import guard for future PRs**

Add the project’s established lint/architecture rule to reject new `luxon` imports in `apps/webapp/src`, with exceptions only for migration tests while this plan is in progress.

- [ ] **Step 5: Run full webapp verification**

Run: `pnpm --dir apps/webapp test`

Expected: PASS.

Run: `CI=true pnpm --dir apps/webapp build`

Expected: PASS.

- [ ] **Step 6: Commit cleanup**

```bash
git add apps/webapp package.json pnpm-lock.yaml
git commit -m "refactor(webapp): remove luxon date layer"
```

## Validation Requirements

- Add DST tests for `Europe/Berlin` spring-forward and fall-back days.
- Add leap-year tests for `2028-02-29` in calendar-only ranges.
- Add month-end tests for reports and payroll periods.
- Add timezone-specific cron tests for scheduled exports.
- Snapshot current report/payroll outputs before each vertical slice and compare after migration.
- Keep existing API payload formats stable unless a separate versioned API plan is approved.

## Deprecation Timeline

- Phase 1: `time.ts` introduced; new code must use Temporal helpers for date/time logic.
- Phase 2: Luxon imports allowed only in files actively being migrated and in tests that verify compatibility.
- Phase 3: Luxon imports blocked in production code once high-risk slices are migrated.
- Phase 4: `luxon` and `@types/luxon` removed from `apps/webapp/package.json` after `rg "from ['\"]luxon['\"]" apps/webapp/src` returns no production matches.

## Rollback Strategy

- Each PR keeps DB schema and API payloads unchanged, so rollback is a normal git revert of the affected vertical slice.
- Do not remove Luxon until all migrated slices have passed focused tests and full `pnpm --dir apps/webapp test`.
- If production telemetry shows timezone drift or parse failures, revert only the affected slice because shared Temporal adapters are additive until Task 6.

## Skipped Work

- No Phase CLI environment-dependent checks are included. This migration plan does not require database URLs, Redis, or external credentials.
- No database schema migration is included. Drizzle continues to receive `Date` values at persistence boundaries.
