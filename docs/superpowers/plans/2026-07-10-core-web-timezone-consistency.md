# Core Web Timezone Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make time tracking, calendars, reports, scheduling, and approvals use explicit domain-owned timezones on the Temporal foundation.

**Architecture:** Resolve selected-employee or organization calendar context on the server, transmit primitive date/instant strings, and reconstruct Temporal values at each runtime. Use captured offsets for audited clock endpoints and half-open instant ranges for database queries.

**Tech Stack:** Next.js 16, React 19, TypeScript 7, `temporal-polyfill`, Drizzle ORM, TanStack Query/Form, Schedule-X, Vitest, pnpm.

**Prerequisite:** Complete `docs/superpowers/plans/2026-07-10-temporal-foundation.md`.

---

## File Map

- `lib/calendar/calendar-employee-context.ts`: authorized selected-employee timezone and initial date.
- `lib/calendar/date-keys.ts`: explicit-zone event date keys.
- Calendar components: primitive `YYYY-MM-DD` navigation state.
- Calendar services: half-open overlap queries and local-day splitting.
- `lib/time-tracking/split-work-period.ts`: wall-clock split resolution.
- Reports: primitive date ranges interpreted in organization timezone.
- Scheduling: `PlainDate`/`PlainTime` contracts and organization timezone.
- Approvals/corrections: explicit recipient display contexts.
- No Telegram, mobile, extension, DB schema, or Better Auth generated files are changed in this plan.

### Task 1: Resolve Selected-Employee Calendar Context

**Files:**
- Create: `apps/webapp/src/lib/calendar/calendar-employee-context.ts`
- Create: `apps/webapp/src/lib/calendar/calendar-employee-context.test.ts`
- Create: `apps/webapp/src/lib/calendar/date-keys.ts`
- Create: `apps/webapp/src/lib/calendar/date-keys.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/calendar/page.tsx`
- Modify: `apps/webapp/src/app/api/calendar/events/route.ts`
- Modify: `apps/webapp/src/app/api/calendar/events/route.test.ts`
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Modify: `apps/webapp/src/components/calendar/calendar-view.test.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- Modify: `apps/webapp/src/hooks/use-calendar-data.ts`

- [ ] **Step 1: Write failing selected-zone tests**

Cover these cases:

```ts
const now = parseInstant("2026-06-01T00:30:00.000Z");
expect(todayInZone(now, "America/New_York").toString()).toBe("2026-05-31");
expect(todayInZone(now, "Asia/Kathmandu").toString()).toBe("2026-06-01");
expect(eventDateKey("2026-06-01T02:00:00.000Z", "America/New_York")).toBe(
	"2026-05-31",
);
```

Assert the calendar page/API authorize the target employee inside `organizationId`, saved employee `UTC` remains UTC, and no Temporal object is passed as an RSC prop.

- [ ] **Step 2: Verify red**

```bash
pnpm --filter webapp exec vitest run \
  'src/lib/calendar/calendar-employee-context.test.ts' \
  'src/lib/calendar/date-keys.test.ts' \
  'src/components/calendar/calendar-view.test.tsx' \
  'src/app/api/calendar/events/route.test.ts'
```

Expected: FAIL because navigation uses browser/runtime dates.

- [ ] **Step 3: Implement authorized calendar context**

```ts
export function todayInZone(now: Instant, timezone: string): PlainDate {
	return now.toZonedDateTimeISO(timezone).toPlainDate();
}

export function eventDateKey(instantIso: string, timezone: string): string {
	return parseInstant(instantIso)
		.toZonedDateTimeISO(timezone)
		.toPlainDate()
		.toString();
}

export async function resolveAuthorizedCalendarEmployeeContext(input: {
	actorUserId: string;
	actorEmployeeId: string;
	organizationId: string;
	requestedEmployeeId?: string;
	now?: Instant;
}): Promise<{
	employeeId: string;
	userId: string;
	timezone: string;
	timezoneSource: "user" | "organization" | "default";
	initialDateKey: string;
}>;
```

Reuse existing CASL employee-read checks and query both employee and user settings with `organizationId`. Resolve via the foundation's personal resolver. Compute `initialDateKey` from `(input.now ?? systemClock.nowInstant()).toZonedDateTimeISO(timezone).toPlainDate().toString()`.

- [ ] **Step 4: Use primitive date navigation**

Change `CalendarView` state to `anchorDateKey: string`. Parse it with `parsePlainDate`, derive API `year` and zero-based `month`, and make today/previous/next operations use `PlainDate.add/subtract`. Pass `initialCalendarTimezone` and `initialDateKey` from the server page.

For timed events, `date-keys.ts` converts the event instant into the employee timezone. For absence/holiday all-day events, preserve stored `YYYY-MM-DD` values without instant conversion.

- [ ] **Step 5: Verify under two host zones**

```bash
TZ=UTC pnpm --filter webapp exec vitest run 'src/components/calendar/calendar-view.test.tsx' 'src/lib/calendar/date-keys.test.ts'
TZ=Pacific/Honolulu pnpm --filter webapp exec vitest run 'src/components/calendar/calendar-view.test.tsx' 'src/lib/calendar/date-keys.test.ts'
```

Expected: both PASS with identical assertions.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/calendar apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/hooks/use-calendar-data.ts 'apps/webapp/src/app/[locale]/(app)/calendar/page.tsx' apps/webapp/src/app/api/calendar/events
git commit -m "fix(calendar): use selected employee temporal context"
```

### Task 2: Query Overlapping Periods And Split Local-Day Totals

**Files:**
- Modify: `apps/webapp/src/lib/calendar/work-period-service.ts`
- Modify: `apps/webapp/src/lib/calendar/work-period-service.test.ts`
- Modify: `apps/webapp/src/lib/calendar/time-entry-service.ts`
- Modify: `apps/webapp/src/lib/calendar/time-entry-service.test.ts`
- Modify: `apps/webapp/src/lib/calendar/work-hours-summary.ts`
- Modify: `apps/webapp/src/lib/calendar/work-hours-summary.test.ts`
- Modify: `apps/webapp/src/app/api/calendar/events/route.ts`

- [ ] **Step 1: Write failing overlap and cross-midnight tests**

Assert a period `Apr 30 23:00` through `May 1 02:00` local is included in May; one ending exactly at May start is excluded; one starting exactly at June start is excluded. Assert New York `23:30-01:30` produces 30 and 90 minutes on consecutive local dates. Include Berlin DST and month-spanning cases.

- [ ] **Step 2: Verify red**

```bash
pnpm --filter webapp exec vitest run \
  'src/lib/calendar/work-period-service.test.ts' \
  'src/lib/calendar/time-entry-service.test.ts' \
  'src/lib/calendar/work-hours-summary.test.ts'
```

Expected: FAIL because completed periods are start-filtered and totals use the start date only.

- [ ] **Step 3: Implement half-open overlap predicates**

```ts
const completedOverlap = and(
	eq(workPeriod.organizationId, organizationId),
	employeeId ? eq(workPeriod.employeeId, employeeId) : undefined,
	not(isNull(workPeriod.endTime)),
	lt(workPeriod.startTime, dateFromInstant(range.endExclusive)),
	gt(workPeriod.endTime, dateFromInstant(range.start)),
);
```

Time-entry predicates use `timestamp >= range.start` and `timestamp < range.endExclusive`. Active periods use the same organization/employee predicates and overlap the current instant.

- [ ] **Step 4: Split clipped periods by local day**

Add a pure helper that walks local day boundaries, clips each segment to the period/range intersection, and allocates integer minutes so segment totals equal canonical elapsed minutes. `buildDailyActualMinutes(events, timezone, requestedRange)` keys each segment by `PlainDate.toString()`.

- [ ] **Step 5: Verify and commit**

Run the Step 2 command. Expected: PASS.

```bash
git add apps/webapp/src/lib/calendar apps/webapp/src/app/api/calendar/events/route.ts
git commit -m "fix(calendar): include overlaps and split local-day totals"
```

### Task 3: Fix Self Entry, Work-Period Split, Dialog Formatting, And Audit Times

**Files:**
- Create: `apps/webapp/src/lib/time-tracking/split-work-period.ts`
- Create: `apps/webapp/src/lib/time-tracking/split-work-period.test.ts`
- Create: `apps/webapp/src/components/calendar/split-work-period-dialog.test.tsx`
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Modify: `apps/webapp/src/components/calendar/split-work-period-dialog.tsx`
- Modify: `apps/webapp/src/components/calendar/delete-work-period-dialog.tsx`
- Modify: `apps/webapp/src/components/calendar/work-period-dialog-utils.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.ts`
- Modify: `apps/webapp/src/components/time-tracking/time-entries-table-columns.tsx`
- Create: `apps/webapp/src/components/time-tracking/time-entries-table-columns.test.tsx`

- [ ] **Step 1: Write failing self/on-behalf and split tests**

Assert own calendar omits `targetEmployeeId`, another employee supplies it, and switching back to self clears it. For a Berlin period `08:00Z-16:00Z`, assert local split `12:00` resolves to `10:00Z`, with 120 and 360 minutes. Add DST gap/fold responses.

- [ ] **Step 2: Write failing captured-offset display test**

```ts
expect(renderClockIn({ instant: "2026-05-04T08:00:00.000Z", offset: 120 })).toContain("10:00");
expect(renderClockOut({ instant: "2026-05-04T13:00:00.000Z", offset: -240 })).toContain("09:00");
expect(renderDuration()).toContain("5:00");
```

- [ ] **Step 3: Verify red**

```bash
pnpm --filter webapp exec vitest run \
  'src/lib/time-tracking/split-work-period.test.ts' \
  'src/components/calendar/split-work-period-dialog.test.tsx' \
  'src/components/time-tracking/time-entries-table-columns.test.tsx' \
  'src/components/calendar/calendar-view.test.tsx'
```

- [ ] **Step 4: Implement shared split resolution**

```ts
export type SplitResult =
	| { ok: true; instant: Instant; firstMinutes: number; secondMinutes: number }
	| { ok: false; code: "outside_period" | "nonexistent" | "ambiguous" };

export function resolveWorkPeriodSplit(input: {
	start: Instant;
	end: Instant;
	splitDate: PlainDate;
	splitTime: PlainTime;
	timezone: string;
	disambiguation: "reject" | "earlier" | "later";
}): SplitResult;
```

Both legacy and modular actions call this helper, then persist `dateFromInstant(result.instant)` and capture the exact offset. The dialog submits date, time, timezone, and disambiguation; ambiguous folds offer earlier/later, gaps show a validation error.

- [ ] **Step 5: Remove literal `p` and browser-local getters**

Pass `{ timezone, locale, timeFormat }` to split/delete dialogs and call `formatInstant(..., "time")`. Delete every `format(value, "p")` use and native `getHours`/`setHours` split preview.

- [ ] **Step 6: Render audit endpoints independently**

Include each endpoint's `utcOffsetMinutes` in the table row contract and call `formatCapturedOffsetInstant()` separately. Keep duration based on canonical start/end instants.

- [ ] **Step 7: Verify and commit**

Run the Step 3 command. Expected: PASS.

```bash
git add apps/webapp/src/lib/time-tracking/split-work-period* apps/webapp/src/components/calendar apps/webapp/src/components/time-tracking/time-entries-table-columns* 'apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts' 'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/mutations.ts'
git commit -m "fix(time-tracking): resolve split and audit times explicitly"
```

### Task 4: Use Organization Calendar Semantics For Reports

**Files:**
- Modify: `apps/webapp/src/lib/reports/types.ts`
- Modify: `apps/webapp/src/lib/reports/date-ranges.ts`
- Modify: `apps/webapp/src/lib/reports/date-ranges.test.ts`
- Modify: `apps/webapp/src/components/reports/date-range-picker.tsx`
- Create: `apps/webapp/src/components/reports/date-range-picker.test.tsx`
- Modify: `apps/webapp/src/components/reports/report-filters.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/reports/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/reports/actions.test.ts`
- Modify: `apps/webapp/src/lib/reports/report-generator.ts`
- Modify: `apps/webapp/src/lib/reports/report-generator.test.ts`

- [ ] **Step 1: Write failing browser/organization mismatch tests**

Under browser `Pacific/Honolulu` and organization `Europe/Berlin`, selecting May 1-31 must submit `{ startDate: "2026-05-01", endDate: "2026-05-31" }` and query `2026-04-30T22:00Z` through exclusive `2026-05-31T22:00Z`. Add New York DST and Kathmandu preset cases.

- [ ] **Step 2: Change report wire values to date strings**

```ts
export interface DateRange {
	startDate: string;
	endDate: string;
}
```

At the DayPicker boundary only, convert local fields into `Temporal.PlainDate`. Server actions parse the strings, verify start <= end, resolve the organization timezone, and construct a half-open instant range ending at `endDate.add({ days: 1 })` local start.

- [ ] **Step 3: Clip work periods and format plain dates**

Report queries use overlap predicates, clip periods to the requested range, and split local-day totals. Absence dates remain plain strings. Report labels/exports format `PlainDate`, not boundary instants.

- [ ] **Step 4: Verify under two host zones and commit**

```bash
TZ=UTC pnpm --filter webapp exec vitest run 'src/lib/reports/date-ranges.test.ts' 'src/components/reports/date-range-picker.test.tsx' 'src/app/[locale]/(app)/reports/actions.test.ts' 'src/lib/reports/report-generator.test.ts'
TZ=Pacific/Honolulu pnpm --filter webapp exec vitest run 'src/lib/reports/date-ranges.test.ts' 'src/components/reports/date-range-picker.test.tsx'
git add apps/webapp/src/lib/reports apps/webapp/src/components/reports 'apps/webapp/src/app/[locale]/(app)/reports'
git commit -m "fix(reports): apply organization calendar semantics"
```

Expected: both runs PASS.

### Task 5: Make Scheduling Browser-Independent

**Files:**
- Create: `apps/webapp/src/components/scheduling/scheduler/shift-scheduler-utils.test.ts`
- Modify: `apps/webapp/src/components/scheduling/scheduler/shift-scheduler-utils.ts`
- Modify: `apps/webapp/src/components/scheduling/scheduler/shift-scheduler.tsx`
- Modify: `apps/webapp/src/components/scheduling/shifts/use-shift-dialog-form.ts`
- Modify: `apps/webapp/src/lib/effect/services/shift.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/__tests__/shift.service.test.ts`
- Modify: `apps/webapp/src/lib/effect/services/schedule-compliance.service.ts`
- Modify: `apps/webapp/src/lib/scheduling/compliance/schedule-compliance-evaluator.ts`

- [ ] **Step 1: Write failing logical-date tests under three host zones**

Assert shift date `2026-03-29` remains that date, week boundaries match organization settings, drag to May 4 emits `2026-05-04`, overnight shifts end next day, and compliance ignores the manager profile timezone.

- [ ] **Step 2: Replace scheduler contracts with primitives**

```ts
export interface UpsertShiftInput {
	id?: string;
	employeeId?: string | null;
	date: string;
	startTime: string;
	endTime: string;
	subareaId: string;
}
```

Use `PlainDate` and `PlainTime` for UI/domain logic. Convert the legacy DB shift date to/from fixed UTC midnight only in a named adapter. Materialize schedule instants in organization timezone with the foundation's compatible scheduled-wall-clock resolver.

- [ ] **Step 3: Preserve tenant predicates**

Every shift, employee, overlap, compliance, and coverage query includes `organizationId`. Organization scheduling always resolves organization timezone, never the acting manager's effective personal timezone.

- [ ] **Step 4: Verify and commit**

```bash
for zone in UTC America/Los_Angeles Asia/Tokyo; do TZ="$zone" pnpm --filter webapp exec vitest run 'src/components/scheduling/scheduler/shift-scheduler-utils.test.ts'; done
pnpm --filter webapp exec vitest run 'src/lib/effect/services/__tests__/shift.service.test.ts' 'src/lib/effect/services/__tests__/schedule-compliance.service.test.ts' 'src/lib/scheduling/compliance/__tests__/schedule-compliance-evaluator.test.ts'
git add apps/webapp/src/components/scheduling apps/webapp/src/lib/effect/services apps/webapp/src/lib/scheduling
git commit -m "fix(scheduling): use organization temporal dates"
```

Expected: all runs PASS.

### Task 6: Format Approvals And Corrections For The Recipient

**Files:**
- Create: `apps/webapp/src/lib/time-tracking/correction-notification-format.ts`
- Create: `apps/webapp/src/lib/time-tracking/correction-notification-format.test.ts`
- Modify: `apps/webapp/src/components/approvals/time-correction-approvals-table.tsx`
- Create: `apps/webapp/src/components/approvals/time-correction-approvals-table.test.tsx`
- Modify: `apps/webapp/src/lib/approvals/inbox/read-service.ts`
- Modify: `apps/webapp/src/lib/approvals/handlers/time-correction.handler.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts`
- Modify: `apps/webapp/src/lib/notifications/triggers.ts`

- [ ] **Step 1: Write failing recipient-context tests**

For `2026-05-22T14:00Z`, assert Berlin 24-hour recipient sees `16:00`, New York 12-hour recipient sees `10:00 AM`, and output is identical under process `TZ=UTC` and `TZ=Pacific/Honolulu`.

- [ ] **Step 2: Add one formatter contract**

```ts
export function formatCorrectionNotification(input: {
	originalStart: Date;
	originalEnd: Date | null;
	correctedStart: Date;
	correctedEnd: Date | null;
	context: DisplayContext;
}): {
	date: string;
	originalClockIn: string;
	originalClockOut: string;
	correctedClockIn: string;
	correctedClockOut: string;
};
```

Resolve the viewer/recipient display context server-side and pass only primitive context fields. Remove module-level unzoned `Intl.DateTimeFormat` and native `toLocaleTimeString` calls from touched paths.

- [ ] **Step 3: Verify and commit**

```bash
TZ=UTC pnpm --filter webapp exec vitest run 'src/lib/time-tracking/correction-notification-format.test.ts' 'src/components/approvals/time-correction-approvals-table.test.tsx'
TZ=Pacific/Honolulu pnpm --filter webapp exec vitest run 'src/lib/time-tracking/correction-notification-format.test.ts' 'src/components/approvals/time-correction-approvals-table.test.tsx'
git add apps/webapp/src/lib/time-tracking/correction-notification-format* apps/webapp/src/components/approvals apps/webapp/src/lib/approvals 'apps/webapp/src/app/[locale]/(app)/time-tracking/actions/corrections.ts' apps/webapp/src/lib/notifications/triggers.ts
git commit -m "fix(approvals): format timestamps for recipients"
```

Expected: both runs PASS.

### Task 7: Add Core Source Guardrails And Verify

**Files:**
- Create: `apps/webapp/src/lib/datetime/core-temporal-guardrails.test.ts`

- [ ] **Step 1: Guard migrated files**

Reject direct Luxon imports, native calendar getters/setters, unzoned locale formatting, and `format(..., "p")` in migrated files. Allow native `Date` only in named Drizzle, DayPicker, Schedule-X, and SDK adapters. Assert affected queries retain `organizationId`.

- [ ] **Step 2: Run focused Core tests**

```bash
pnpm --filter webapp exec vitest run \
  'src/lib/calendar' \
  'src/components/calendar' \
  'src/components/time-tracking' \
  'src/lib/reports' \
  'src/components/reports' \
  'src/components/scheduling' \
  'src/components/approvals' \
  'src/lib/approvals' \
  'src/lib/datetime/core-temporal-guardrails.test.ts'
```

Expected: PASS.

- [ ] **Step 3: Run full verification**

```bash
pnpm test
CI=true pnpm build
```

Expected: all tests and production build PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/webapp/src/lib/datetime/core-temporal-guardrails.test.ts
git commit -m "test(webapp): guard temporal ownership boundaries"
```
