# Work Balance, Payroll, and Migration Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make work-balance and payroll periods employee-local, recover skipped sick-detail schema, and replace fabricated historical timezone values with DST-aware inferences.

**Architecture:** Logical ISO dates are interpreted in each employee's effective timezone and converted to UTC only at database boundaries. Payroll uses a broad UTC query envelope followed by exact per-employee overlap and clipping. Two late idempotent migrations repair production databases regardless of which older migrations were skipped or applied.

**Tech Stack:** TypeScript, Luxon, Drizzle ORM, PostgreSQL migrations, Vitest, pnpm.

---

### Task 1: Employee-Local Work Balance Boundaries

**Files:**
- Modify: `apps/webapp/src/lib/work-balance/period-aggregation.test.ts`
- Modify: `apps/webapp/src/lib/work-balance/period-aggregation.ts`
- Modify: `apps/webapp/src/lib/work-balance/periods.test.ts`
- Modify: `apps/webapp/src/lib/work-balance/periods.ts`
- Modify: `apps/webapp/src/lib/work-balance/service.test.ts`
- Modify: `apps/webapp/src/lib/work-balance/service.ts`

- [ ] **Step 1: Write failing aggregation boundary tests**

Add a test that calls `computeEmployeePeriodBalance` with `timezone: "America/New_York"` and asserts these arguments:

```ts
expect(gte).toHaveBeenCalledWith(
	workPeriod.startTime,
	new Date("2026-05-01T04:00:00.000Z"),
);
expect(lte).toHaveBeenCalledWith(
	workPeriod.startTime,
	new Date("2026-06-01T03:59:59.999Z"),
);
expect(mockState.getDailyWorkRequirementsForEmployee).toHaveBeenCalledWith({
	employeeId: "employee-1",
	organizationId: "org-1",
	startDate: new Date("2026-05-01T04:00:00.000Z"),
	endDate: new Date("2026-06-01T03:59:59.999Z"),
	timezone: "America/New_York",
});
```

Add a calculation-start assertion for `2026-05-10T04:00:00.000Z`.

- [ ] **Step 2: Verify the aggregation tests fail for UTC boundaries**

Run: `pnpm test -- src/lib/work-balance/period-aggregation.test.ts`

Expected: FAIL because the implementation emits `2026-05-01T00:00:00.000Z` and does not pass `timezone` to requirements.

- [ ] **Step 3: Implement timezone-aware period conversion**

Extend `computeEmployeePeriodBalance` input with `timezone: string`. Parse logical dates directly in that zone:

```ts
const periodStart = DateTime.fromISO(input.periodStart, { zone: input.timezone }).startOf("day");
const periodEnd = DateTime.fromISO(input.periodEnd, { zone: input.timezone }).endOf("day");
const calculationStart = input.calculationStartDate
	? DateTime.fromISO(input.calculationStartDate, { zone: input.timezone }).startOf("day")
	: null;
```

Pass `timezone: input.timezone` to `getDailyWorkRequirementsForEmployee`.

- [ ] **Step 4: Add failing local cutoff and hot-window tests**

Assert that an instant crossing midnight only in New York uses the New York date:

```ts
expect(
	getWorkBalanceBatchCutoffDate(
		new Date("2026-05-02T02:00:00.000Z"),
		"America/New_York",
	),
).toBe("2026-04-30");

expect(getHotWindowRange(new Date("2026-06-01T01:00:00.000Z"), "America/New_York")).toEqual({
	startDate: "2026-03-01",
	endDate: "2026-05-31",
});
```

- [ ] **Step 5: Verify cutoff tests fail**

Run: `pnpm test -- src/lib/work-balance/periods.test.ts src/lib/work-balance/service.test.ts`

Expected: FAIL because both helpers currently derive dates in UTC and do not accept a timezone.

- [ ] **Step 6: Resolve scoped employee timezone once per refresh**

In `service.ts`, query the employee with both tenant keys and timezone relations:

```ts
const scopedEmployee = await dbClient.query.employee.findFirst({
	where: and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
	columns: { id: true },
	with: {
		userSettings: { columns: { timezone: true } },
		organization: { columns: { timezone: true } },
	},
});
```

Use `resolveEffectiveTimezone(scopedEmployee?.userSettings?.timezone, scopedEmployee?.organization?.timezone)` and return `{ updated: false }` if no scoped employee exists. Pass the resolved timezone into `getHotWindowRange`, `getWorkBalanceBatchCutoffDate`, and every `computeEmployeePeriodBalance` call.

Update the helpers as follows:

```ts
export function getHotWindowRange(now = new Date(), timezone = "UTC"): DateRangeIso {
	const today = DateTime.fromJSDate(now, { zone: "utc" }).setZone(timezone).startOf("day");
	return {
		startDate: toIsoDate(today.startOf("month").minus({ months: 2 })),
		endDate: toIsoDate(today),
	};
}

export function getWorkBalanceBatchCutoffDate(now = new Date(), timezone = "UTC"): string {
	return DateTime.fromJSDate(now, { zone: "utc" })
		.setZone(timezone)
		.startOf("day")
		.minus({ days: 1 })
		.toISODate()!;
}
```

- [ ] **Step 7: Verify work-balance tests pass**

Run: `pnpm test -- src/lib/work-balance/period-aggregation.test.ts src/lib/work-balance/periods.test.ts src/lib/work-balance/service.test.ts`

Expected: PASS.

### Task 2: Per-Employee Payroll Export Boundaries

**Files:**
- Create: `apps/webapp/src/lib/payroll-export/calendar-boundaries.ts`
- Create: `apps/webapp/src/lib/payroll-export/__tests__/calendar-boundaries.test.ts`
- Modify: `apps/webapp/src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts`
- Modify: `apps/webapp/src/lib/payroll-export/data-fetcher.ts`

- [ ] **Step 1: Write failing pure boundary tests**

Define the desired API in the test:

```ts
expect(buildEmployeePayrollRange("2026-05-01", "2026-05-31", "America/New_York")).toEqual({
	start: DateTime.fromISO("2026-05-01T04:00:00.000Z", { zone: "utc" }),
	end: DateTime.fromISO("2026-06-01T03:59:59.999Z", { zone: "utc" }),
});

expect(buildPayrollQueryEnvelope("2026-05-01", "2026-05-31")).toEqual({
	start: DateTime.fromISO("2026-04-30T10:00:00.000Z", { zone: "utc" }),
	end: DateTime.fromISO("2026-06-01T13:59:59.999Z", { zone: "utc" }),
});
```

- [ ] **Step 2: Verify the helper test fails because the module is missing**

Run: `pnpm test -- src/lib/payroll-export/__tests__/calendar-boundaries.test.ts`

Expected: FAIL with an unresolved `calendar-boundaries` import.

- [ ] **Step 3: Implement the pure boundary helper**

Create:

```ts
import { DateTime } from "luxon";

export function buildEmployeePayrollRange(startDate: string, endDate: string, timezone: string) {
	return {
		start: DateTime.fromISO(startDate, { zone: timezone }).startOf("day").toUTC(),
		end: DateTime.fromISO(endDate, { zone: timezone }).endOf("day").toUTC(),
	};
}

export function buildPayrollQueryEnvelope(startDate: string, endDate: string) {
	return {
		start: DateTime.fromISO(startDate, { zone: "utc" }).startOf("day").minus({ hours: 14 }),
		end: DateTime.fromISO(endDate, { zone: "utc" }).endOf("day").plus({ hours: 14 }),
	};
}
```

- [ ] **Step 4: Add failing data-fetcher tests for exact filtering and clipping**

Extend database mocks with `organization.findFirst`, nested `employee.userSettings`, and Drizzle operator objects that retain boundary values. Add one New York record beginning at `2026-05-01T02:00:00Z`, which must be excluded from May, and one at `2026-06-01T02:00:00Z`, which must be included and clipped at `2026-06-01T03:59:59.999Z`. Add a second employee in `Europe/Berlin` to prove ranges are not shared.

Assert `countWorkPeriods` returns the same number of included records as `fetchWorkPeriodsForExport`.

- [ ] **Step 5: Verify data-fetcher tests fail under UTC filtering**

Run: `pnpm test -- src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts`

Expected: FAIL because the implementation uses `filters.dateRange.start.toUTC()` and one common UTC end-of-day.

- [ ] **Step 6: Apply broad query and exact employee-local clipping**

In both fetch and count paths:

1. Convert filter values to logical dates with `toISODate()`.
2. Query with `buildPayrollQueryEnvelope`.
3. Include `employee.userSettings.timezone` and load the organization timezone with an organization-ID predicate.
4. Resolve each row timezone with `resolveEffectiveTimezone`.
5. Build that employee's exact range, reject non-overlapping records, and clip overlapping records with `DateTime.max` and `DateTime.min`.

Keep existing organization, approval, employee, team, and project filters. Exclude rows whose employee relation is unavailable. Keep absence date output as UTC-encoded logical ISO dates; only its selected-date overlap predicate may use the broad logical-date envelope.

- [ ] **Step 7: Verify payroll tests pass**

Run: `pnpm test -- src/lib/payroll-export/__tests__/calendar-boundaries.test.ts src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts`

Expected: PASS.

### Task 3: Sick Detail Recovery Migration

**Files:**
- Create: `apps/webapp/drizzle/0051_sick_detail_recovery.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Modify: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`

- [ ] **Step 1: Write a failing migration registration test**

Add assertions that `0051_sick_detail_recovery` is later than every prior journal entry and contains:

```ts
expect(migration0051).toContain("WHEN duplicate_object THEN null");
expect(migration0051).toContain('ADD COLUMN IF NOT EXISTS "sick_detail" "sick_detail"');
```

- [ ] **Step 2: Verify the migration test fails because 0051 is absent**

Run: `pnpm test -- src/db/__tests__/drizzle-migrations.test.ts`

Expected: FAIL because the migration and journal entry do not exist.

- [ ] **Step 3: Add the idempotent recovery migration and journal entry**

Create:

```sql
DO $$
BEGIN
	CREATE TYPE "sick_detail" AS ENUM ('child_sick', 'with_certificate', 'without_certificate', 'other');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "absence_entry" ADD COLUMN IF NOT EXISTS "sick_detail" "sick_detail";
```

Append journal index `51` with tag `0051_sick_detail_recovery` and a `when` greater than `1780773132901`.

- [ ] **Step 4: Verify sick-detail migration tests pass**

Run: `pnpm test -- src/db/__tests__/drizzle-migrations.test.ts`

Expected: PASS.

### Task 4: Historical Timezone Inference and Recovery

**Files:**
- Modify: `apps/webapp/drizzle/0036_time_entry_timezone_capture.sql`
- Create: `apps/webapp/drizzle/0052_time_entry_timezone_recovery.sql`
- Modify: `apps/webapp/drizzle/meta/_journal.json`
- Modify: `apps/webapp/src/db/__tests__/drizzle-migrations.test.ts`
- Modify: `apps/webapp/src/lib/time-tracking/timezone-capture.ts`
- Modify: `apps/webapp/src/lib/time-tracking/timezone-capture.test.ts`

- [ ] **Step 1: Replace old positive assertions with failing safety assertions**

Assert migration `0036` does not contain fixed fallback assignments and does contain inferred provenance:

```ts
expect(migration0036).not.toContain('COALESCE("utc_offset_minutes", 120)');
expect(migration0036).not.toContain("COALESCE(\"timezone\", 'Europe/Berlin')");
expect(migration0036).toContain("historical_inference");
```

Assert `0052` is later than `0051`, targets all three old signature fields, joins employee and organization context, uses `pg_timezone_names`, and computes an offset from each `time_entry.timestamp`.

- [ ] **Step 2: Verify timezone migration tests fail**

Run: `pnpm test -- src/db/__tests__/drizzle-migrations.test.ts src/lib/time-tracking/timezone-capture.test.ts`

Expected: FAIL because `0036` still assigns Berlin/+120, `0052` is absent, and the source type lacks `historical_inference`.

- [ ] **Step 3: Implement reusable SQL inference in 0036**

After adding nullable columns, use a CTE that joins `time_entry` to `employee`, `user_settings`, and `organization` using both employee and organization keys. Resolve only timezone names present in `pg_timezone_names`, preferring non-UTC user settings, then non-UTC organization settings, then UTC. Set:

```sql
"timezone" = inferred."timezone",
"utc_offset_minutes" = round(
	extract(epoch FROM ((("time_entry"."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE inferred."timezone") - "time_entry"."timestamp")) / 60
)::integer,
"timezone_source" = 'historical_inference'
```

Retain the final `NOT NULL` constraints because every historical row receives a valid UTC fallback and all new write paths provide capture fields.

- [ ] **Step 4: Add the targeted 0052 recovery**

Reuse the same inference CTE, but restrict rows before update:

```sql
WHERE "time_entry"."timezone_source" = 'backfill'
	AND "time_entry"."timezone" = 'Europe/Berlin'
	AND "time_entry"."utc_offset_minutes" = 120
```

Set source to `historical_inference`. Append journal index `52` with a `when` greater than the `0051` value.

- [ ] **Step 5: Extend the TypeScript provenance type**

Add the literal without weakening capture requirements:

```ts
export type TimeEntryTimezoneSource =
	| "browser"
	| "user_setting"
	| "manager_target_user_setting"
	| "backfill"
	| "historical_inference";
```

Keep browser and fallback helper parameter exclusions unchanged so current writes cannot claim historical inference accidentally.

- [ ] **Step 6: Verify timezone repair tests pass**

Run: `pnpm test -- src/db/__tests__/drizzle-migrations.test.ts src/lib/time-tracking/timezone-capture.test.ts`

Expected: PASS.

### Task 5: Integrated Verification

**Files:**
- Verify only: all files changed in Tasks 1-4

- [ ] **Step 1: Run focused regression suites together**

Run:

```bash
pnpm test -- \
	src/lib/work-balance/period-aggregation.test.ts \
	src/lib/work-balance/periods.test.ts \
	src/lib/work-balance/service.test.ts \
	src/lib/payroll-export/__tests__/calendar-boundaries.test.ts \
	src/lib/payroll-export/__tests__/data-fetcher.canonical.test.ts \
	src/db/__tests__/drizzle-migrations.test.ts \
	src/lib/time-tracking/timezone-capture.test.ts
```

Expected: PASS with no warnings or unhandled errors.

- [ ] **Step 2: Run formatting and type/build validation**

Run: `pnpm exec biome check src/lib/work-balance src/lib/payroll-export src/lib/time-tracking/timezone-capture.ts src/db/__tests__/drizzle-migrations.test.ts`

Expected: PASS.

Run from the repository root: `CI=true pnpm --filter webapp build`

Expected: PASS. If unrelated concurrent work causes failure, record the exact failing file and do not modify it.

- [ ] **Step 3: Inspect only the intended diff**

Run: `git diff --check -- apps/webapp/src/lib/work-balance apps/webapp/src/lib/payroll-export apps/webapp/src/lib/time-tracking/timezone-capture.ts apps/webapp/src/lib/time-tracking/timezone-capture.test.ts apps/webapp/src/db/__tests__/drizzle-migrations.test.ts apps/webapp/drizzle docs/superpowers`

Expected: no whitespace errors. Confirm unrelated modified files remain untouched.

No commit is included because repository policy requires an explicit user request before committing.
