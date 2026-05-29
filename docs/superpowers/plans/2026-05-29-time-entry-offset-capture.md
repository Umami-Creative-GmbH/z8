# Time Entry Offset Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the UTC offset for every time entry, use browser timezone for self time entry flows, and render single-employee calendars in the selected employee's timezone.

**Architecture:** UTC timestamps remain canonical. `time_entry` gets per-event offset metadata, server actions derive offsets from a validated timezone and exact timestamp, and calendar responses include the selected employee timezone plus work-period entry offset metadata. Client self flows detect browser timezone mismatches and ask whether to update the saved user timezone before continuing.

**Tech Stack:** Next.js server actions, React client components, Drizzle ORM/PostgreSQL migrations, Luxon, TanStack Query, Vitest/Testing Library, Schedule-X.

---

## File Structure

- Modify `apps/webapp/src/db/schema/time-tracking.ts`: add `utcOffsetMinutes`, `timezone`, and `timezoneSource` to `timeEntry`.
- Modify `apps/webapp/drizzle/schema.ts`: mirror the generated schema fields if this checked-in Drizzle schema is maintained manually in this repo.
- Create `apps/webapp/drizzle/0036_time_entry_timezone_capture.sql`: add/backfill time entry timezone columns.
- Modify `apps/webapp/drizzle/meta/_journal.json`: add a new entry after `0035_approval_request_metadata_recovery` with a `when` greater than the current latest value.
- Create `apps/webapp/src/lib/time-tracking/timezone-capture.ts`: shared validation, browser timezone detection, offset formatting, and offset derivation helpers.
- Create `apps/webapp/src/lib/time-tracking/timezone-capture.test.ts`: unit tests for offset derivation and formatting.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts`: add timezone context fields to clock/manual action input types.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/entry-helpers.ts`: require timezone capture values when inserting `time_entry` rows.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`: derive/store timezone capture for clock-in, clock-out, breaks, and manual entries.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`: keep the legacy monolithic action exports consistent if still referenced by tests or imports.
- Modify `apps/webapp/src/lib/query/use-time-clock.ts`: accept and pass browser timezone to clock-in/out server actions.
- Create `apps/webapp/src/components/time-tracking/timezone-mismatch-dialog.tsx`: reusable confirmation dialog for self flows.
- Modify `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`: gate self clock-in/out through browser timezone detection and the mismatch dialog state.
- Modify `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`: render the mismatch dialog.
- Modify `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx`: gate self manual entries through the mismatch dialog and pass browser timezone only for self entries.
- Modify `apps/webapp/src/app/api/calendar/events/route.ts`: return `calendarTimezone` for the scoped employee calendar.
- Modify `apps/webapp/src/hooks/use-calendar-data.ts`: parse and expose `calendarTimezone`.
- Modify `apps/webapp/src/components/calendar/calendar-view.tsx`: use selected employee `calendarTimezone` instead of the viewer timezone for Schedule-X and manual defaults.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`: accept an explicit `timeZone` prop instead of always reading the viewer timezone.
- Modify `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx`: pass the explicit timezone through to `ScheduleXCalendarWrapper`.
- Modify `apps/webapp/src/lib/calendar/work-period-service.ts`: join clock-in and clock-out entries and include offset metadata in work-period calendar events.
- Modify `apps/webapp/src/lib/calendar/types.ts` and `apps/webapp/src/lib/validations/calendar.ts`: type/validate new metadata and calendar timezone payload.
- Add/modify tests near the changed files listed in each task.

---

### Task 1: Timezone Capture Utility

**Files:**
- Create: `apps/webapp/src/lib/time-tracking/timezone-capture.ts`
- Create: `apps/webapp/src/lib/time-tracking/timezone-capture.test.ts`

- [ ] **Step 1: Write failing utility tests**

Create `apps/webapp/src/lib/time-tracking/timezone-capture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	formatUtcOffset,
	getBrowserTimezone,
	getUtcOffsetMinutesForZone,
	isValidIanaTimezone,
	resolveTimeEntryTimezoneCapture,
} from "./timezone-capture";

describe("timezone capture utilities", () => {
	it("derives offsets for the exact timestamp", () => {
		expect(getUtcOffsetMinutesForZone(new Date("2026-05-29T08:00:00.000Z"), "Europe/Berlin")).toBe(120);
		expect(getUtcOffsetMinutesForZone(new Date("2026-01-29T08:00:00.000Z"), "Europe/Berlin")).toBe(60);
		expect(getUtcOffsetMinutesForZone(new Date("2026-05-29T12:00:00.000Z"), "America/New_York")).toBe(-240);
		expect(getUtcOffsetMinutesForZone(new Date("2026-01-29T12:00:00.000Z"), "America/New_York")).toBe(-300);
	});

	it("rejects invalid IANA timezone names", () => {
		expect(isValidIanaTimezone("Europe/Berlin")).toBe(true);
		expect(isValidIanaTimezone("UTC")).toBe(true);
		expect(isValidIanaTimezone("UTC+02:00")).toBe(false);
		expect(isValidIanaTimezone("Not/AZone")).toBe(false);
	});

	it("formats UTC offsets for display", () => {
		expect(formatUtcOffset(120)).toBe("UTC+02:00");
		expect(formatUtcOffset(60)).toBe("UTC+01:00");
		expect(formatUtcOffset(0)).toBe("UTC+00:00");
		expect(formatUtcOffset(-240)).toBe("UTC-04:00");
		expect(formatUtcOffset(-330)).toBe("UTC-05:30");
	});

	it("uses browser timezone when valid", () => {
		expect(
			resolveTimeEntryTimezoneCapture({
				timestamp: new Date("2026-05-29T08:00:00.000Z"),
				browserTimezone: "America/New_York",
				fallbackTimezone: "Europe/Berlin",
				browserSource: "browser",
				fallbackSource: "user_setting",
			}),
		).toEqual({ timezone: "America/New_York", timezoneSource: "browser", utcOffsetMinutes: -240 });
	});

	it("falls back when browser timezone is invalid or missing", () => {
		expect(
			resolveTimeEntryTimezoneCapture({
				timestamp: new Date("2026-05-29T08:00:00.000Z"),
				browserTimezone: "Not/AZone",
				fallbackTimezone: "Europe/Berlin",
				browserSource: "browser",
				fallbackSource: "user_setting",
			}),
		).toEqual({ timezone: "Europe/Berlin", timezoneSource: "user_setting", utcOffsetMinutes: 120 });
	});

	it("reads browser timezone defensively", () => {
		expect(getBrowserTimezone({ DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "Europe/Berlin" }) }) } as unknown as typeof Intl)).toBe("Europe/Berlin");
		expect(getBrowserTimezone({ DateTimeFormat: () => ({ resolvedOptions: () => ({}) }) } as unknown as typeof Intl)).toBeNull();
	});
});
```

- [ ] **Step 2: Run utility tests and verify they fail**

Run: `pnpm --filter @z8/webapp test src/lib/time-tracking/timezone-capture.test.ts`

Expected: FAIL because `timezone-capture.ts` does not exist.

- [ ] **Step 3: Implement timezone capture utility**

Create `apps/webapp/src/lib/time-tracking/timezone-capture.ts`:

```ts
import { DateTime, IANAZone } from "luxon";

export type TimeEntryTimezoneSource =
	| "browser"
	| "user_setting"
	| "manager_target_user_setting"
	| "backfill";

export interface TimeEntryTimezoneCapture {
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: TimeEntryTimezoneSource;
}

export function isValidIanaTimezone(timezone: string | null | undefined): timezone is string {
	return typeof timezone === "string" && timezone.length > 0 && IANAZone.isValidZone(timezone);
}

export function getUtcOffsetMinutesForZone(timestamp: Date, timezone: string): number {
	const zonedDateTime = DateTime.fromJSDate(timestamp, { zone: "utc" }).setZone(timezone);

	if (!zonedDateTime.isValid) {
		return 0;
	}

	return zonedDateTime.offset;
}

export function formatUtcOffset(offsetMinutes: number): string {
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteMinutes = Math.abs(offsetMinutes);
	const hours = Math.floor(absoluteMinutes / 60).toString().padStart(2, "0");
	const minutes = (absoluteMinutes % 60).toString().padStart(2, "0");

	return `UTC${sign}${hours}:${minutes}`;
}

export function getBrowserTimezone(intlApi: typeof Intl = Intl): string | null {
	try {
		const timezone = intlApi.DateTimeFormat().resolvedOptions().timeZone;
		return isValidIanaTimezone(timezone) ? timezone : null;
	} catch {
		return null;
	}
}

export function resolveTimeEntryTimezoneCapture({
	timestamp,
	browserTimezone,
	fallbackTimezone,
	browserSource,
	fallbackSource,
}: {
	timestamp: Date;
	browserTimezone?: string | null;
	fallbackTimezone: string;
	browserSource: Extract<TimeEntryTimezoneSource, "browser">;
	fallbackSource: Exclude<TimeEntryTimezoneSource, "browser" | "backfill">;
}): TimeEntryTimezoneCapture {
	const timezone = isValidIanaTimezone(browserTimezone)
		? browserTimezone
		: isValidIanaTimezone(fallbackTimezone)
			? fallbackTimezone
			: "UTC";
	const timezoneSource = timezone === browserTimezone ? browserSource : fallbackSource;

	return {
		timezone,
		timezoneSource,
		utcOffsetMinutes: getUtcOffsetMinutesForZone(timestamp, timezone),
	};
}

export function resolveFallbackTimezoneCapture({
	timestamp,
	timezone,
	timezoneSource,
}: {
	timestamp: Date;
	timezone: string;
	timezoneSource: Exclude<TimeEntryTimezoneSource, "browser">;
}): TimeEntryTimezoneCapture {
	const validTimezone = isValidIanaTimezone(timezone) ? timezone : "UTC";

	return {
		timezone: validTimezone,
		timezoneSource,
		utcOffsetMinutes: getUtcOffsetMinutesForZone(timestamp, validTimezone),
	};
}
```

- [ ] **Step 4: Run utility tests and verify they pass**

Run: `pnpm --filter @z8/webapp test src/lib/time-tracking/timezone-capture.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit utility**

Run:

```bash
git add apps/webapp/src/lib/time-tracking/timezone-capture.ts apps/webapp/src/lib/time-tracking/timezone-capture.test.ts
git commit -m "feat: add time entry timezone capture helpers"
```

Expected: commit succeeds.

---

### Task 2: Schema And Migration

**Files:**
- Modify: `apps/webapp/src/db/schema/time-tracking.ts`
- Modify: `apps/webapp/drizzle/schema.ts`
- Create: `apps/webapp/drizzle/0036_time_entry_timezone_capture.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Test: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`

- [ ] **Step 1: Add a failing migration/schema test**

Append this test to `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`:

```ts
it("journals the time entry timezone capture migration after approval metadata recovery", () => {
	const journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
	const timezoneEntry = journal.entries.find(
		(entry: { tag: string }) => entry.tag === "0036_time_entry_timezone_capture",
	);
	const previousEntry = journal.entries.find(
		(entry: { tag: string }) => entry.tag === "0035_approval_request_metadata_recovery",
	);

	expect(timezoneEntry).toBeTruthy();
	expect(previousEntry).toBeTruthy();
	expect(timezoneEntry.when).toBeGreaterThan(previousEntry.when);
});
```

- [ ] **Step 2: Run migration test and verify it fails**

Run: `pnpm --filter @z8/webapp test src/db/__tests__/drizzle-migrations.test.ts`

Expected: FAIL because the journal entry does not exist.

- [ ] **Step 3: Add schema columns**

In `apps/webapp/src/db/schema/time-tracking.ts`, update the `timeEntry` table fields after `timestamp`:

```ts
		timestamp: timestamp("timestamp").notNull(),
		utcOffsetMinutes: integer("utc_offset_minutes").notNull(),
		timezone: text("timezone"),
		timezoneSource: text("timezone_source").notNull(),
```

Mirror the same columns in `apps/webapp/drizzle/schema.ts` if that file contains the checked-in generated `timeEntry` table definition.

- [ ] **Step 4: Add migration SQL**

Create `apps/webapp/drizzle/0036_time_entry_timezone_capture.sql`:

```sql
ALTER TABLE "time_entry" ADD COLUMN IF NOT EXISTS "utc_offset_minutes" integer;
ALTER TABLE "time_entry" ADD COLUMN IF NOT EXISTS "timezone" text;
ALTER TABLE "time_entry" ADD COLUMN IF NOT EXISTS "timezone_source" text;

UPDATE "time_entry"
SET
	"utc_offset_minutes" = 120,
	"timezone" = COALESCE("timezone", 'Europe/Berlin'),
	"timezone_source" = COALESCE("timezone_source", 'backfill')
WHERE "utc_offset_minutes" IS NULL OR "timezone_source" IS NULL;

ALTER TABLE "time_entry" ALTER COLUMN "utc_offset_minutes" SET NOT NULL;
ALTER TABLE "time_entry" ALTER COLUMN "timezone_source" SET NOT NULL;
```

- [ ] **Step 5: Add journal entry**

Append this object to `apps/webapp/drizzle/meta/_journal.json` after the `0035_approval_request_metadata_recovery` entry, adjusting commas to keep valid JSON:

```json
{
  "idx": 36,
  "version": "7",
  "when": 1780185600000,
  "tag": "0036_time_entry_timezone_capture",
  "breakpoints": true
}
```

- [ ] **Step 6: Run migration test and typecheck affected schema**

Run: `pnpm --filter @z8/webapp test src/db/__tests__/drizzle-migrations.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit schema and migration**

Run:

```bash
git add apps/webapp/src/db/schema/time-tracking.ts apps/webapp/drizzle/schema.ts apps/webapp/drizzle/0036_time_entry_timezone_capture.sql apps/webapp/drizzle/meta/_journal.json apps/webapp/src/db/__tests__/drizzle-migrations.test.ts
git commit -m "feat: add time entry timezone capture schema"
```

Expected: commit succeeds. If `apps/webapp/drizzle/schema.ts` did not need a change, omit it from `git add`.

---

### Task 3: Store Capture Metadata In Time Entry Inserts

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/entry-helpers.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`

- [ ] **Step 1: Write failing clocking tests for timezone capture**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`, add tests in the existing `clockIn`, `clockOut`, and `createManualTimeEntry` describe blocks. Match the file's existing mock names; assert inserted `timeEntry` values contain the new fields:

```ts
it("stores browser-derived timezone capture on self clock-in", async () => {
	mockState.getUserTimezone.mockResolvedValue("Europe/Berlin");
	mockState.getActiveWorkPeriod.mockResolvedValue(null);
	mockState.requireBillingForMutation.mockResolvedValue({ allowed: true });
	mockState.insertTimeEntry.mockResolvedValueOnce({ id: "entry-1" });

	const result = await clockIn("office", { browserTimezone: "America/New_York" });

	expect(result.success).toBe(true);
	expect(mockState.insertTimeEntry).toHaveBeenCalledWith(
		expect.objectContaining({
			timezone: "America/New_York",
			timezoneSource: "browser",
			utcOffsetMinutes: expect.any(Number),
		}),
	);
});

it("falls back to saved timezone when browser timezone is invalid", async () => {
	mockState.getUserTimezone.mockResolvedValue("Europe/Berlin");
	mockState.getActiveWorkPeriod.mockResolvedValue(null);
	mockState.requireBillingForMutation.mockResolvedValue({ allowed: true });
	mockState.insertTimeEntry.mockResolvedValueOnce({ id: "entry-1" });

	const result = await clockIn("office", { browserTimezone: "Not/AZone" });

	expect(result.success).toBe(true);
	expect(mockState.insertTimeEntry).toHaveBeenCalledWith(
		expect.objectContaining({
			timezone: "Europe/Berlin",
			timezoneSource: "user_setting",
			utcOffsetMinutes: expect.any(Number),
		}),
	);
});
```

Add a manual entry test for manager-on-behalf:

```ts
it("uses target employee timezone capture for manager-created manual entries", async () => {
	mockState.getUserTimezone.mockResolvedValue("Europe/Berlin");
	mockState.findTargetEmployeeSettings.mockResolvedValue({ timezone: "America/New_York" });

	const result = await createManualTimeEntry({
		employeeId: "employee-2",
		date: "2026-05-29",
		clockInTime: "08:00",
		clockOutTime: "13:00",
		reason: "Travel day",
		timezone: "America/New_York",
	});

	expect(result.success).toBe(true);
	expect(mockState.insertTimeEntry).toHaveBeenCalledWith(
		expect.objectContaining({ timezone: "America/New_York", timezoneSource: "manager_target_user_setting" }),
	);
});
```

- [ ] **Step 2: Run clocking tests and verify they fail**

Run: `pnpm --filter @z8/webapp test src/app/[locale]/\(app\)/time-tracking/actions/clocking.test.ts`

Expected: FAIL because action signatures and insert values do not include timezone capture.

- [ ] **Step 3: Extend action input types**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts`, add:

```ts
export interface BrowserTimezoneContext {
	browserTimezone?: string | null;
}
```

Then extend `ManualTimeEntryInput`:

```ts
export interface ManualTimeEntryInput {
	employeeId?: string;
	date: string;
	clockInTime: string;
	clockOutTime: string;
	reason: string;
	timezone?: string;
	browserTimezone?: string | null;
	projectId?: string;
	workCategoryId?: string;
}
```

- [ ] **Step 4: Require capture values in createTimeEntry**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/entry-helpers.ts`, import the type and extend params:

```ts
import type { TimeEntryTimezoneSource } from "@/lib/time-tracking/timezone-capture";
```

Update the `createTimeEntry` params type:

```ts
export async function createTimeEntry(params: {
	employeeId: string;
	organizationId: string;
	type: "clock_in" | "clock_out" | "correction";
	timestamp: Date;
	createdBy: string;
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: TimeEntryTimezoneSource;
	replacesEntryId?: string;
	notes?: string;
	isSuperseded?: boolean;
}, client: TimeEntryDbClient = db): Promise<typeof timeEntry.$inferSelect> {
```

Destructure and insert the new values:

```ts
const {
	employeeId,
	organizationId,
	type,
	timestamp,
	createdBy,
	utcOffsetMinutes,
	timezone,
	timezoneSource,
	replacesEntryId,
	notes,
	isSuperseded,
} = params;
```

```ts
.values({
	employeeId,
	organizationId,
	type,
	timestamp,
	utcOffsetMinutes,
	timezone,
	timezoneSource,
	hash,
	previousHash,
	ipAddress,
	deviceInfo: userAgent,
	createdBy,
	replacesEntryId,
	notes,
	...(isSuperseded === undefined ? {} : { isSuperseded }),
})
```

- [ ] **Step 5: Derive capture in clocking actions**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`, import helpers:

```ts
import {
	resolveFallbackTimezoneCapture,
	resolveTimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
```

Change signatures:

```ts
export async function clockIn(
	workLocationType?: WorkLocationType,
	timezoneContext: BrowserTimezoneContext = {},
): Promise<ServerActionResult<Awaited<ReturnType<typeof createTimeEntry>>>> {
```

```ts
export async function clockOut(
	projectId?: string,
	workCategoryId?: string,
	timezoneContext: BrowserTimezoneContext = {},
): Promise<ServerActionResult<ClockOutResult>> {
```

Before each self `createTimeEntry`, derive capture:

```ts
const timezoneCapture = resolveTimeEntryTimezoneCapture({
	timestamp: now,
	browserTimezone: timezoneContext.browserTimezone,
	fallbackTimezone: timezone,
	browserSource: "browser",
	fallbackSource: "user_setting",
});
```

Pass it into inserts:

```ts
const entry = await createTimeEntry({
	employeeId: currentEmployee.id,
	organizationId: currentEmployee.organizationId,
	type: "clock_in",
	timestamp: now,
	createdBy: session.user.id,
	...timezoneCapture,
});
```

For `addBreakToActiveSession`, no browser check exists in this run. Use saved timezone fallback for both synthetic entries:

```ts
const savedTimezone = await getUserTimezone(session.user.id);
const breakStartCapture = resolveFallbackTimezoneCapture({
	timestamp: breakStart,
	timezone: savedTimezone,
	timezoneSource: "user_setting",
});
const nowCapture = resolveFallbackTimezoneCapture({
	timestamp: now,
	timezone: savedTimezone,
	timezoneSource: "user_setting",
});
```

For self manual entries, use `resolveTimeEntryTimezoneCapture` with `data.browserTimezone`. For manager-on-behalf entries, use `resolveFallbackTimezoneCapture` with the target employee timezone and `timezoneSource: "manager_target_user_setting"`.

- [ ] **Step 6: Keep monolithic actions consistent**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions.ts`, apply the same `createTimeEntry` param extension and capture derivation at every local `createTimeEntry({ ... })` call. Use these rules:

- Self clock-in/out: `resolveTimeEntryTimezoneCapture` with `timezoneContext.browserTimezone` and fallback `getUserTimezone(session.user.id)`.
- Corrections and same-day edits: `resolveFallbackTimezoneCapture` with the actor's saved timezone unless the function already has an effective employee timezone variable.
- Manager-created manual entries: `resolveFallbackTimezoneCapture` with target employee timezone and `manager_target_user_setting`.
- Back-office generated split/delete entries: use the selected work period employee timezone if loaded; otherwise saved actor timezone with `user_setting`.

- [ ] **Step 7: Run clocking tests**

Run: `pnpm --filter @z8/webapp test src/app/[locale]/\(app\)/time-tracking/actions/clocking.test.ts src/app/[locale]/\(app\)/time-tracking/actions.manual-entry.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit server capture changes**

Run:

```bash
git add apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions/types.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions/entry-helpers.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions/clocking.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions/clocking.test.ts apps/webapp/src/app/[locale]/\(app\)/time-tracking/actions.manual-entry.test.ts
git commit -m "feat: store timezone capture on time entries"
```

Expected: commit succeeds.

---

### Task 4: Client Timezone Mismatch Flow

**Files:**
- Create: `apps/webapp/src/components/time-tracking/timezone-mismatch-dialog.tsx`
- Modify: `apps/webapp/src/lib/query/use-time-clock.ts`
- Modify: `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`
- Modify: `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`
- Modify: `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx`
- Test: `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx`

- [ ] **Step 1: Write failing UI tests for self manual mismatch**

In `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx`, add:

```tsx
it("offers to update saved timezone before self manual entry when browser timezone differs", async () => {
	vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
		resolvedOptions: () => ({ timeZone: "America/New_York" }),
	} as Intl.DateTimeFormat);
	mocks.updateTimezone.mockResolvedValue({ success: true });
	mocks.createManualTimeEntry.mockResolvedValue({ success: true, data: { workPeriodId: "period-1", requiresApproval: false } });

	render(<ManualTimeEntryDialog employeeId="employee-1" employeeTimezone="Europe/Berlin" hasManager={false} />);
	await user.click(screen.getByRole("button", { name: /add manual entry/i }));
	await user.click(screen.getByRole("button", { name: /create/i }));

	expect(screen.getByText(/Your device timezone is America\/New_York/i)).toBeTruthy();
	await user.click(screen.getByRole("button", { name: /update timezone and continue/i }));

	expect(mocks.updateTimezone).toHaveBeenCalledWith("America/New_York");
	expect(mocks.createManualTimeEntry).toHaveBeenCalledWith(expect.objectContaining({ browserTimezone: "America/New_York" }));
});
```

Ensure the test mock section includes:

```ts
vi.mock("@/app/[locale]/(app)/settings/profile/actions", () => ({
	updateTimezone: (timezone: string) => mocks.updateTimezone(timezone),
}));
```

- [ ] **Step 2: Run UI test and verify it fails**

Run: `pnpm --filter @z8/webapp test src/components/time-tracking/manual-time-entry-dialog.test.tsx`

Expected: FAIL because the dialog and action call do not exist yet.

- [ ] **Step 3: Create mismatch dialog component**

Create `apps/webapp/src/components/time-tracking/timezone-mismatch-dialog.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

interface TimezoneMismatchDialogProps {
	open: boolean;
	savedTimezone: string;
	browserTimezone: string;
	isUpdating?: boolean;
	onUpdateAndContinue: () => void;
	onContinueOnce: () => void;
	onCancel: () => void;
}

export function TimezoneMismatchDialog({
	open,
	savedTimezone,
	browserTimezone,
	isUpdating = false,
	onUpdateAndContinue,
	onContinueOnce,
	onCancel,
}: TimezoneMismatchDialogProps) {
	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Timezone changed</DialogTitle>
					<DialogDescription>
						Your device timezone is {browserTimezone}, but your saved timezone is {savedTimezone}.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className="gap-2 sm:justify-end">
					<Button type="button" variant="ghost" onClick={onCancel} disabled={isUpdating}>
						Cancel
					</Button>
					<Button type="button" variant="outline" onClick={onContinueOnce} disabled={isUpdating}>
						Continue once
					</Button>
					<Button type="button" onClick={onUpdateAndContinue} disabled={isUpdating}>
						{isUpdating ? "Updating..." : "Update timezone and continue"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
```

- [ ] **Step 4: Pass browser timezone through time clock hook**

In `apps/webapp/src/lib/query/use-time-clock.ts`, update mutation types and server calls:

```ts
type ClockInMutationInput = { workLocationType?: WorkLocationType; browserTimezone?: string | null };
type ClockOutMutationInput = { projectId?: string; workCategoryId?: string; browserTimezone?: string | null };
```

```ts
mutationFn: async (params: ClockInMutationInput) => {
```

```ts
return clockIn(params?.workLocationType, { browserTimezone: params?.browserTimezone });
```

```ts
mutationFn: async (params?: ClockOutMutationInput) => {
```

```ts
return clockOut(params?.projectId, params?.workCategoryId, { browserTimezone: params?.browserTimezone });
```

```ts
clockIn: (params?: ClockInMutationInput) => clockInMutation.mutateAsync(params ?? {}),
clockOut: clockOutMutation.mutateAsync,
```

- [ ] **Step 5: Gate clock-in/out through mismatch state**

In `apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx`, import helpers and action:

```ts
import { updateTimezone } from "@/app/[locale]/(app)/settings/profile/actions";
import { useUserTimezone } from "@/components/providers/user-preferences-provider";
import { getBrowserTimezone } from "@/lib/time-tracking/timezone-capture";
```

Add state fields to `ClockInOutWidgetState`:

```ts
timezoneMismatch: {
	action: "clock_in" | "clock_out";
	browserTimezone: string;
} | null;
isUpdatingTimezone: boolean;
```

Add reducer actions for `openTimezoneMismatch`, `closeTimezoneMismatch`, and `setIsUpdatingTimezone`.

Add helper inside the hook:

```ts
const savedTimezone = useUserTimezone();

const runWithTimezoneCheck = async (
	action: "clock_in" | "clock_out",
	run: (browserTimezone: string | null) => Promise<void>,
) => {
	const browserTimezone = getBrowserTimezone();
	if (browserTimezone && browserTimezone !== savedTimezone) {
		dispatch({ type: "openTimezoneMismatch", action, browserTimezone });
		return;
	}

	await run(browserTimezone);
};
```

Use it from `handleClockIn` and `handleClockOut`, passing `browserTimezone` into `timeClock.clockIn` and `timeClock.clockOut`.

Expose these handlers from the hook:

```ts
handleTimezoneUpdateAndContinue,
handleTimezoneContinueOnce,
handleTimezoneCancel,
```

Implement `handleTimezoneUpdateAndContinue`:

```ts
const handleTimezoneUpdateAndContinue = async () => {
	const pending = uiState.timezoneMismatch;
	if (!pending) return;

	dispatch({ type: "setIsUpdatingTimezone", value: true });
	const result = await updateTimezone(pending.browserTimezone);
	dispatch({ type: "setIsUpdatingTimezone", value: false });

	if (!result.success) {
		toast.error(result.error || "Failed to update timezone");
		return;
	}

	dispatch({ type: "closeTimezoneMismatch" });
	if (pending.action === "clock_in") {
		await submitClockIn(pending.browserTimezone);
	} else {
		await submitClockOut(pending.browserTimezone);
	}
};
```

- [ ] **Step 6: Render mismatch dialog in widget**

In `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx`, import and render:

```tsx
import { TimezoneMismatchDialog } from "@/components/time-tracking/timezone-mismatch-dialog";
import { useUserTimezone } from "@/components/providers/user-preferences-provider";
```

```tsx
const savedTimezone = useUserTimezone();
```

Before `</Card>`:

```tsx
<TimezoneMismatchDialog
	open={!!widget.uiState.timezoneMismatch}
	savedTimezone={savedTimezone}
	browserTimezone={widget.uiState.timezoneMismatch?.browserTimezone ?? savedTimezone}
	isUpdating={widget.uiState.isUpdatingTimezone}
	onUpdateAndContinue={widget.handleTimezoneUpdateAndContinue}
	onContinueOnce={widget.handleTimezoneContinueOnce}
	onCancel={widget.handleTimezoneCancel}
/>
```

- [ ] **Step 7: Gate self manual entries through mismatch dialog**

In `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx`, import:

```ts
import { updateTimezone } from "@/app/[locale]/(app)/settings/profile/actions";
import { TimezoneMismatchDialog } from "@/components/time-tracking/timezone-mismatch-dialog";
import { getBrowserTimezone } from "@/lib/time-tracking/timezone-capture";
```

Add state:

```ts
const [pendingSubmit, setPendingSubmit] = useState<FormValues | null>(null);
const [browserTimezone, setBrowserTimezone] = useState<string | null>(null);
const [updatingTimezone, setUpdatingTimezone] = useState(false);
const isManagerEntry = Boolean(targetEmployeeId && targetEmployeeId !== employeeId);
```

Move the current `createManualTimeEntry` call into a helper:

```ts
const submitManualEntry = async (value: FormValues, timezoneForEntry: string | null) => {
	const result = await createManualTimeEntry({
		...(targetEmployeeId ? { employeeId: targetEmployeeId } : {}),
		date: value.date,
		clockInTime: value.clockInTime,
		clockOutTime: value.clockOutTime,
		reason: value.reason,
		timezone: employeeTimezone,
		browserTimezone: isManagerEntry ? null : timezoneForEntry,
		projectId: value.projectId,
		workCategoryId: value.workCategoryId,
	});

	// Keep the existing success/error handling exactly as it is today.
};
```

Before calling `submitManualEntry` in `onSubmit`, check browser mismatch for self entries:

```ts
const detectedTimezone = isManagerEntry ? null : getBrowserTimezone();
if (detectedTimezone && detectedTimezone !== employeeTimezone) {
	setPendingSubmit(value);
	setBrowserTimezone(detectedTimezone);
	return;
}

await submitManualEntry(value, detectedTimezone);
```

Render `TimezoneMismatchDialog` next to `ActionPanel`:

```tsx
<TimezoneMismatchDialog
	open={!!pendingSubmit && !!browserTimezone}
	savedTimezone={employeeTimezone}
	browserTimezone={browserTimezone ?? employeeTimezone}
	isUpdating={updatingTimezone}
	onUpdateAndContinue={async () => {
		if (!pendingSubmit || !browserTimezone) return;
		setUpdatingTimezone(true);
		const result = await updateTimezone(browserTimezone);
		setUpdatingTimezone(false);
		if (!result.success) {
			toast.error(result.error || "Failed to update timezone");
			return;
		}
		const value = pendingSubmit;
		setPendingSubmit(null);
		await submitManualEntry(value, browserTimezone);
	}}
	onContinueOnce={async () => {
		if (!pendingSubmit || !browserTimezone) return;
		const value = pendingSubmit;
		setPendingSubmit(null);
		await submitManualEntry(value, browserTimezone);
	}}
	onCancel={() => setPendingSubmit(null)}
/>
```

- [ ] **Step 8: Run UI tests**

Run: `pnpm --filter @z8/webapp test src/components/time-tracking/manual-time-entry-dialog.test.tsx src/lib/query/use-time-clock.presence.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit client mismatch flow**

Run:

```bash
git add apps/webapp/src/components/time-tracking/timezone-mismatch-dialog.tsx apps/webapp/src/lib/query/use-time-clock.ts apps/webapp/src/components/time-tracking/use-clock-in-out-widget.tsx apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx
git commit -m "feat: confirm timezone changes before self time entries"
```

Expected: commit succeeds.

---

### Task 5: Calendar Selected Employee Timezone

**Files:**
- Modify: `apps/webapp/src/app/api/calendar/events/route.ts`
- Modify: `apps/webapp/src/hooks/use-calendar-data.ts`
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx`
- Test: `apps/webapp/src/app/api/calendar/events/route.test.ts`
- Test: `apps/webapp/src/components/calendar/calendar-view.test.tsx`
- Test: `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`

- [ ] **Step 1: Write failing API test for calendar timezone**

In `apps/webapp/src/app/api/calendar/events/route.test.ts`, add:

```ts
it("returns the scoped employee timezone for calendar rendering", async () => {
	mockState.findEmployee
		.mockResolvedValueOnce({ id: "employee-1", userId: "user-1", organizationId: "org-1", isActive: true, role: "manager", teamId: null })
		.mockResolvedValueOnce({ id: "employee-2", userId: "user-2", organizationId: "org-1", isActive: true, role: "employee", teamId: null });
	mockState.findManagerLinks.mockResolvedValue([{ employeeId: "employee-2" }]);
	mockState.findUserSettings.mockResolvedValueOnce({ timezone: "America/New_York" });

	const response = await GET(
		createRequest(
			"https://app.example.com/api/calendar/events?organizationId=org-1&employeeId=employee-2&year=2026&month=4&showWorkPeriods=true",
		),
	);
	const body = getResponsePayload(await response.json());

	expect(response.status).toBe(200);
	expect(body.calendarTimezone).toBe("America/New_York");
});
```

- [ ] **Step 2: Run API test and verify it fails**

Run: `pnpm --filter @z8/webapp test src/app/api/calendar/events/route.test.ts`

Expected: FAIL because `calendarTimezone` is not returned.

- [ ] **Step 3: Return selected employee timezone from calendar API**

In `apps/webapp/src/app/api/calendar/events/route.ts`, import `userSettings`:

```ts
import { employee, employeeManagers, userSettings } from "@/db/schema";
```

Add helper:

```ts
async function fetchCalendarTimezone(employeeId: string | undefined): Promise<string | null> {
	if (!employeeId) return null;

	const employeeRecord = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
		columns: { userId: true },
	});
	if (!employeeRecord) return null;

	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, employeeRecord.userId),
		columns: { timezone: true },
	});

	return settings?.timezone ?? "UTC";
}
```

Before returning the response, compute:

```ts
const calendarTimezone = await fetchCalendarTimezone(scopedEmployeeId);
```

Include it in `superJsonResponse`:

```ts
return superJsonResponse({
	events,
	total: events.length,
	dailyRequirements,
	dailyActualMinutes,
	workBalance,
	calendarTimezone,
});
```

- [ ] **Step 4: Expose calendarTimezone from hook**

In `apps/webapp/src/hooks/use-calendar-data.ts`, add to schemas and return type:

```ts
calendarTimezone: string | null;
```

Parse it:

```ts
calendarTimezone: typeof data.calendarTimezone === "string" ? data.calendarTimezone : null,
```

Return it from `useCalendarData`.

- [ ] **Step 5: Pass explicit timezone to Schedule-X**

In `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`, add prop:

```ts
timeZone?: string;
```

Destructure as `explicitTimeZone` and replace:

```ts
const viewerTimeZone = useUserTimezone();
const timeZone = explicitTimeZone ?? viewerTimeZone;
```

In `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx`, add and pass through the same `timeZone?: string` prop.

In `apps/webapp/src/components/calendar/calendar-view.tsx`, change:

```ts
const viewerTimeZone = useUserTimezone();
```

Use the hook result:

```ts
const { events, dailyRequirements, dailyActualMinutes, workBalance, calendarTimezone, isLoading, error, refetch } = useCalendarData(...);
const calendarTimeZone = calendarTimezone ?? viewerTimeZone;
```

Pass `timeZone={calendarTimeZone}` into `ScheduleXWrapper`.

- [ ] **Step 6: Update calendar tests**

In `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`, replace the source inspection test with:

```ts
describe("calendar timezone source", () => {
	it("supports an explicit selected employee timezone", () => {
		const source = readFileSync(join(process.cwd(), "src/components/calendar/schedule-x-calendar.tsx"), "utf8");

		expect(source).toContain("explicitTimeZone");
		expect(source).toContain("explicitTimeZone ?? viewerTimeZone");
	});
});
```

In `apps/webapp/src/components/calendar/calendar-view.test.tsx`, set `mockCalendarData.calendarTimezone = "America/New_York"` in the relevant test and assert the mocked `ScheduleXWrapper` receives it with `data-time-zone="America/New_York"`.

- [ ] **Step 7: Run calendar tests**

Run: `pnpm --filter @z8/webapp test src/app/api/calendar/events/route.test.ts src/hooks/use-calendar-data.test.ts src/components/calendar/calendar-view.test.tsx src/components/calendar/schedule-x-calendar.test.tsx`

Expected: PASS. If `src/hooks/use-calendar-data.test.ts` does not exist, omit it.

- [ ] **Step 8: Commit calendar timezone changes**

Run:

```bash
git add apps/webapp/src/app/api/calendar/events/route.ts apps/webapp/src/hooks/use-calendar-data.ts apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/schedule-x-wrapper.tsx apps/webapp/src/app/api/calendar/events/route.test.ts apps/webapp/src/components/calendar/calendar-view.test.tsx apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx
git commit -m "fix: render employee calendar in selected timezone"
```

Expected: commit succeeds.

---

### Task 6: Work Period Offset Metadata

**Files:**
- Modify: `apps/webapp/src/lib/calendar/work-period-service.ts`
- Modify: `apps/webapp/src/lib/calendar/types.ts`
- Modify: `apps/webapp/src/lib/validations/calendar.ts`
- Test: `apps/webapp/src/lib/calendar/work-period-service.test.ts`

- [ ] **Step 1: Write failing work-period metadata test**

In `apps/webapp/src/lib/calendar/work-period-service.test.ts`, add a completed period test:

```ts
it("includes captured clock-in and clock-out offsets in work period metadata", async () => {
	const startTime = new Date("2026-05-29T06:00:00.000Z");
	const endTime = new Date("2026-05-29T11:00:00.000Z");

	mockDb.where.mockResolvedValue([
		{
			period: {
				id: "period-1",
				organizationId: "org-1",
				employeeId: "employee-1",
				startTime,
				endTime,
				durationMinutes: 300,
				isActive: false,
				approvalStatus: "approved",
				projectId: null,
				clockInId: "clock-in-1",
				clockOutId: "clock-out-1",
			},
			employee: { id: "employee-1", userId: "user-1" },
			user: { id: "user-1", name: "Ada Lovelace" },
			clockInEntry: { id: "clock-in-1", utcOffsetMinutes: 120, timezone: "Europe/Berlin" },
			clockOutEntry: { id: "clock-out-1", utcOffsetMinutes: -240, timezone: "America/New_York", notes: null },
			surcharge: null,
			project: null,
		},
	]);

	const events = await getWorkPeriodsForMonth(4, 2026, { organizationId: "org-1" });

	expect(events[0]?.metadata).toMatchObject({
		clockInUtcOffsetMinutes: 120,
		clockInTimezone: "Europe/Berlin",
		clockOutUtcOffsetMinutes: -240,
		clockOutTimezone: "America/New_York",
	});
});
```

- [ ] **Step 2: Run work-period test and verify it fails**

Run: `pnpm --filter @z8/webapp test src/lib/calendar/work-period-service.test.ts`

Expected: FAIL because metadata is not included.

- [ ] **Step 3: Join clock-in and clock-out entries distinctly**

In `apps/webapp/src/lib/calendar/work-period-service.ts`, alias time entry joins:

```ts
import { alias } from "drizzle-orm/pg-core";
```

Add aliases near the top:

```ts
const clockInTimeEntry = alias(timeEntry, "clock_in_time_entry");
const clockOutTimeEntry = alias(timeEntry, "clock_out_time_entry");
```

Update select/join:

```ts
.select({
	period: workPeriod,
	employee: employee,
	user: user,
	clockInEntry: clockInTimeEntry,
	clockOutEntry: clockOutTimeEntry,
	surcharge: surchargeCalculation,
	project: project,
})
...
.leftJoin(clockInTimeEntry, eq(workPeriod.clockInId, clockInTimeEntry.id))
.leftJoin(clockOutTimeEntry, eq(workPeriod.clockOutId, clockOutTimeEntry.id))
```

Update the map destructuring:

```ts
return periods.map(({ period, user, clockInEntry, clockOutEntry, surcharge, project: proj }) => {
```

Keep notes from `clockOutEntry?.notes?.trim()`.

- [ ] **Step 4: Add metadata fields**

In both running and completed work period metadata objects, add:

```ts
clockInUtcOffsetMinutes: clockInEntry?.utcOffsetMinutes,
clockInTimezone: clockInEntry?.timezone ?? undefined,
clockOutUtcOffsetMinutes: clockOutEntry?.utcOffsetMinutes,
clockOutTimezone: clockOutEntry?.timezone ?? undefined,
```

For running periods, `clockOutUtcOffsetMinutes` and `clockOutTimezone` will be `undefined`.

- [ ] **Step 5: Update calendar types and validation**

In `apps/webapp/src/lib/calendar/types.ts`, extend `WorkPeriodEvent.metadata`:

```ts
clockInUtcOffsetMinutes?: number;
clockInTimezone?: string;
clockOutUtcOffsetMinutes?: number;
clockOutTimezone?: string;
```

In `apps/webapp/src/lib/validations/calendar.ts`, extend `workPeriodEventSchema.metadata`:

```ts
clockInUtcOffsetMinutes: z.number().int().optional(),
clockInTimezone: z.string().optional(),
clockOutUtcOffsetMinutes: z.number().int().optional(),
clockOutTimezone: z.string().optional(),
```

- [ ] **Step 6: Run work-period test**

Run: `pnpm --filter @z8/webapp test src/lib/calendar/work-period-service.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit calendar metadata changes**

Run:

```bash
git add apps/webapp/src/lib/calendar/work-period-service.ts apps/webapp/src/lib/calendar/types.ts apps/webapp/src/lib/validations/calendar.ts apps/webapp/src/lib/calendar/work-period-service.test.ts
git commit -m "feat: expose captured offsets on calendar work periods"
```

Expected: commit succeeds.

---

### Task 7: Final Verification

**Files:**
- No source changes unless verification exposes failures.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @z8/webapp test src/lib/time-tracking/timezone-capture.test.ts src/db/__tests__/drizzle-migrations.test.ts src/app/[locale]/\(app\)/time-tracking/actions/clocking.test.ts src/app/[locale]/\(app\)/time-tracking/actions.manual-entry.test.ts src/components/time-tracking/manual-time-entry-dialog.test.tsx src/app/api/calendar/events/route.test.ts src/components/calendar/calendar-view.test.tsx src/components/calendar/schedule-x-calendar.test.tsx src/lib/calendar/work-period-service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint/type/build checks available to this repo**

Run: `CI=true pnpm build`

Expected: PASS. If it fails because required Phase CLI environment variables are unavailable to agents, record the exact missing variable/task in the final response and do not fabricate success.

- [ ] **Step 3: Inspect git status**

Run: `git status --short`

Expected: no uncommitted changes after commits, or only intentional uncommitted changes if the user requested no commits during execution.

---

## Self-Review

- Spec coverage: Tasks cover schema/backfill, per-entry offset derivation, self browser timezone detection, mismatch modal, manager fallback behavior, selected employee calendar timezone, offset metadata, and verification.
- Placeholder scan: The plan contains concrete file paths, code snippets, commands, expected results, and commit messages. There are no deferred implementation sections.
- Type consistency: The plan consistently uses `utcOffsetMinutes`, `timezone`, `timezoneSource`, `browserTimezone`, and `calendarTimezone` across schema, actions, hooks, and calendar events.
