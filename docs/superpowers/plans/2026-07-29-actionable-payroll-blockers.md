# Actionable Payroll Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic payroll blocker labels with employee-local details and authorized links to the existing calendar and approval workflows.

**Architecture:** Enrich organization-scoped blocker results with employee-local date/time metadata using each employee's effective timezone. Render blocker rows joined to already-scoped payroll employees, and add a validated calendar date query so missing clock-outs open on the relevant employee/date without changing permissions.

**Tech Stack:** TypeScript, Next.js, React, Temporal, Drizzle ORM, Tolgee, Vitest, Testing Library, pnpm.

---

## File Map

- Modify `apps/webapp/src/lib/payroll-workspace/types.ts`: add safe blocker display metadata.
- Modify `apps/webapp/src/lib/payroll-workspace/summary.ts`: load affected employee timezone context and build employee-local blocker dates/times.
- Modify `apps/webapp/src/lib/payroll-workspace/summary.test.ts`: cover timezone boundaries and logical absence dates.
- Create `apps/webapp/src/lib/calendar/initial-date.ts`: validate calendar date query values.
- Create `apps/webapp/src/lib/calendar/initial-date.test.ts`: cover valid and invalid date parameters.
- Modify `apps/webapp/src/app/[locale]/(app)/calendar/page.tsx`: accept an optional initial date override after authorization.
- Modify `apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.tsx`: pass the `date` search parameter to calendar content.
- Modify `apps/webapp/src/components/payroll/payroll-workspace.tsx`: render actionable blocker rows.
- Modify `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`: cover employee details, duplicate distinction, and action links.

### Task 1: Add Employee-Local Blocker Metadata

**Files:**
- Modify: `apps/webapp/src/lib/payroll-workspace/types.ts`
- Modify: `apps/webapp/src/lib/payroll-workspace/summary.ts`
- Modify: `apps/webapp/src/lib/payroll-workspace/summary.test.ts`

- [ ] **Step 1: Write failing blocker metadata tests**

Extend the existing blocker tests in `summary.test.ts`:

```ts
it("formats missing clock-outs in the affected employee timezone", () => {
	const blockers = filterMissingClockOutBlockers({
		period: {
			start: DateTime.fromISO("2026-06-01T00:00:00Z"),
			end: DateTime.fromISO("2026-06-30T23:59:59Z"),
		},
		timezoneByEmployeeId: new Map([["employee-1", "America/New_York"]]),
		rows: [
			{
				id: "record-1",
				employeeId: "employee-1",
				startAt: DateTime.fromISO("2026-06-01T01:30:00Z"),
			},
		],
	});

	expect(blockers[0]).toMatchObject({
		date: "2026-05-31",
		time: "21:30",
	});
});
```

Add equivalent assertions to the pending time-correction test by passing
`timezoneByEmployeeId` and expecting its source `startAt` to produce a date and
time. Add a focused exported helper test for pending absences:

```ts
expect(
	buildPendingAbsenceBlockers([
		{
			id: "absence-1",
			employeeId: "employee-1",
			startDate: "2026-06-12",
		},
	]),
).toEqual([
	{
		id: "absence-1",
		employeeId: "employee-1",
		type: "pending_absence",
		label: "Pending absence",
		date: "2026-06-12",
		time: null,
	},
]);
```

- [ ] **Step 2: Run summary tests and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/payroll-workspace/summary.test.ts
```

Expected: failures because blockers do not contain date/time metadata and the
pending-absence helper does not exist.

- [ ] **Step 3: Extend the blocker type**

Update `PayrollBlocker` in `types.ts`:

```ts
export interface PayrollBlocker {
	id: string;
	employeeId: string;
	type: PayrollBlockerType;
	label: string;
	date: string | null;
	time: string | null;
}
```

Use nullable fields so missing display metadata never removes a blocker.

- [ ] **Step 4: Add Temporal employee-local conversion**

In `summary.ts`, import `Temporal` from `temporal-polyfill` and add:

```ts
function formatBlockerInstant(
	startAt: DateTime,
	timezone: string | undefined,
): Pick<PayrollBlocker, "date" | "time"> {
	if (!timezone) return { date: null, time: null };

	const iso = startAt.toUTC().toISO();
	if (!iso) return { date: null, time: null };

	const local = Temporal.Instant.from(iso).toZonedDateTimeISO(timezone);
	return {
		date: local.toPlainDate().toString(),
		time: local.toPlainTime().toString({ smallestUnit: "minute" }),
	};
}
```

Add `timezoneByEmployeeId: ReadonlyMap<string, string>` to both instant-based
filter inputs. Spread `formatBlockerInstant` into returned missing-clock-out and
pending-time-correction blockers.

- [ ] **Step 5: Add the pending absence helper**

Export a pure helper:

```ts
export function buildPendingAbsenceBlockers(
	rows: Array<{ id: string; employeeId: string; startDate: string | null }>,
): PayrollBlocker[] {
	return rows.map((row) => ({
		id: row.id,
		employeeId: row.employeeId,
		type: "pending_absence",
		label: "Pending absence",
		date: row.startDate,
		time: null,
	}));
}
```

- [ ] **Step 6: Load timezone and logical absence context without widening scope**

Import `absenceEntry` and `getEffectiveTimezone`. After the three blocker
queries resolve inside `getBlockers`, collect only affected employee IDs:

```ts
const affectedEmployeeIds = Array.from(
	new Set([
		...missingClockOutRows.map((row) => row.employeeId),
		...pendingAbsenceRows.map((row) => row.employeeId),
		...pendingApprovalRows.map((row) => row.employeeId),
	]),
);
const affectedEmployees =
	affectedEmployeeIds.length === 0
		? []
		: await db.query.employee.findMany({
				where: and(
					eq(employee.organizationId, organizationId),
					inArray(employee.id, affectedEmployeeIds),
				),
				columns: { id: true, userId: true },
			});
const timezoneByEmployeeId = new Map(
	await Promise.all(
		affectedEmployees.map(async (row) => [
			row.id,
			await getEffectiveTimezone(row.userId, organizationId),
		] as const),
	),
);
```

Pass this map into both instant-based blocker filters. This query is constrained
by the active organization and the already allowed blocker rows.

For pending absences, left-join `absenceEntry` with both canonical linkage and
organization scope:

```ts
and(
	eq(absenceEntry.canonicalRecordId, timeRecord.id),
	eq(absenceEntry.organizationId, organizationId),
)
```

Select `absenceEntry.startDate` and route rows through
`buildPendingAbsenceBlockers`. Do not exclude a blocker when the legacy link or
date is absent.

- [ ] **Step 7: Run summary tests and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/payroll-workspace/summary.test.ts
```

Expected: all summary tests pass.

### Task 2: Add Validated Calendar Date Deep Links

**Files:**
- Create: `apps/webapp/src/lib/calendar/initial-date.ts`
- Create: `apps/webapp/src/lib/calendar/initial-date.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/calendar/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.tsx`

- [ ] **Step 1: Write failing date validation tests**

Create `initial-date.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveCalendarInitialDate } from "./initial-date";

describe("resolveCalendarInitialDate", () => {
	it("accepts a valid ISO logical date", () => {
		expect(resolveCalendarInitialDate("2026-06-12", "2026-07-01")).toBe("2026-06-12");
	});

	it.each([undefined, "", "2026-02-30", "06/12/2026"])(
		"falls back for invalid input %s",
		(value) => {
			expect(resolveCalendarInitialDate(value, "2026-07-01")).toBe("2026-07-01");
		},
	);
});
```

- [ ] **Step 2: Run the date test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/lib/calendar/initial-date.test.ts
```

Expected: failure because `initial-date.ts` does not exist.

- [ ] **Step 3: Implement strict Temporal validation**

Create `initial-date.ts`:

```ts
import { parsePlainDate } from "@/lib/datetime/temporal-core";

export function resolveCalendarInitialDate(
	requestedDate: string | undefined,
	fallbackDate: string,
): string {
	if (!requestedDate) return fallbackDate;

	try {
		return parsePlainDate(requestedDate).toString();
	} catch {
		return fallbackDate;
	}
}
```

- [ ] **Step 4: Pass the authorized initial date into CalendarView**

Extend `CalendarPageContent` with `requestedDate?: string`. After resolving the
authorized employee context, pass:

```tsx
initialDateKey={resolveCalendarInitialDate(
	requestedDate,
	calendarEmployeeContext.initialDateKey,
)}
```

Do not pass the date into or around the employee authorization check.

- [ ] **Step 5: Read the selected employee route query**

Extend `CalendarEmployeePage` props:

```ts
params: Promise<{ employeeId: string }>;
searchParams: Promise<{ date?: string }>;
```

Await both values and render:

```tsx
<CalendarPageContent selectedEmployeeId={employeeId} requestedDate={date} />
```

- [ ] **Step 6: Run calendar tests and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/calendar/initial-date.test.ts \
  src/lib/calendar/calendar-employee-context.test.ts
```

Expected: all selected calendar tests pass.

### Task 3: Render Actionable Blocker Rows

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Update blocker fixtures and write failing UI tests**

Add `date` and `time` to existing blocker fixtures. Add a focused test with two
missing clock-outs for different employees/dates and one pending correction.
Assert employee names, dates/times, and links:

```ts
expect(
	screen.getByRole("link", { name: "Open employee calendar" }).getAttribute("href"),
).toBe("/calendar/employee-1?date=2026-06-10");
expect(
	screen.getByRole("link", { name: "Open approval inbox" }).getAttribute("href"),
).toBe("/approvals/inbox?types=time_entry");
```

Use `getAllByRole` when multiple calendar links exist and assert both hrefs.

- [ ] **Step 2: Run the workspace test and verify RED**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/payroll/payroll-workspace.test.tsx
```

Expected: failure because generic bullet rows have no employee/date/action links.

- [ ] **Step 3: Add contextual action helpers**

Import `Link` from `next/link`. Add:

```ts
function blockerAction(blocker: PayrollWorkspaceSummary["blockers"][number]) {
	if (blocker.type === "missing_clock_out") {
		const query = blocker.date ? `?date=${encodeURIComponent(blocker.date)}` : "";
		return { href: `/calendar/${blocker.employeeId}${query}`, labelKey: "calendar" as const };
	}

	return {
		href:
			blocker.type === "pending_time_correction"
				? "/approvals/inbox?types=time_entry"
				: "/approvals/inbox?types=absence_entry",
		labelKey: "approval" as const,
	};
}
```

- [ ] **Step 4: Replace generic bullets with blocker rows**

Pass `employees={displayedEmployees}` into `PayrollBlockersAlert`. Build an
employee-name map and render each blocker in a bordered responsive row showing:

```txt
Employee name
Localized blocker label
YYYY-MM-DD · HH:mm (omit unavailable parts safely)
Action link rendered as a small outline Button with asChild
```

Use these translation fallbacks:

```ts
t("payroll.blockers.missingClockOut", "Missing clock-out")
t("payroll.blockers.pendingTimeCorrection", "Pending time correction")
t("payroll.blockers.pendingAbsence", "Pending absence")
t("payroll.blockers.openCalendar", "Open employee calendar")
t("payroll.blockers.openApprovals", "Open approval inbox")
t("payroll.blockers.unknownEmployee", "Unknown employee")
t("payroll.blockers.dateUnavailable", "Date unavailable")
```

Keep the existing alert title, blocker count, filtered behavior, and row key.

- [ ] **Step 5: Run workspace tests and verify GREEN**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/payroll/payroll-workspace.test.tsx
```

Expected: all payroll workspace tests pass.

### Task 4: Verify Payroll, Calendar, and React Behavior

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/lib/payroll-workspace/summary.test.ts \
  src/lib/payroll-workspace/summary.cutover.test.ts \
  src/components/payroll/payroll-workspace.test.tsx \
  src/lib/calendar/initial-date.test.ts \
  src/lib/calendar/calendar-employee-context.test.ts \
  'src/app/[locale]/(app)/payroll/actions.test.ts'
```

Expected: all selected tests pass.

- [ ] **Step 2: Run formatting and type checks**

Run Ultracite on every changed code/test file, then:

```bash
pnpm --filter webapp typecheck
git diff --check
```

Typecheck may remain blocked only by the pre-existing missing generated
`@/data/licenses.json`; no changed file may introduce a diagnostic.

- [ ] **Step 3: Run React Doctor changed-scope regression scan**

From `apps/webapp`, run the user-required command:

```bash
npx react-doctor@latest --verbose --scope changed
```

Record the score and fix any issue introduced by the blocker UI or calendar
route before completion.

- [ ] **Step 4: Review authorization and timekeeping boundaries**

Confirm from the final diff:

```txt
All blocker queries remain organization-scoped and employee-scoped.
Instant display uses affected employee timezone, not viewer timezone.
Pending absence uses its logical date when available.
Calendar date input is strictly validated after employee authorization.
No payroll officer permissions are added.
Approval decisions remain in the existing inbox.
Blocker totals and fail-closed readiness are unchanged.
```
