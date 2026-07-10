# Manager Briefing Timezone Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manager daily briefings consistently use the organization's business timezone without integrating the rejected PostgreSQL session configuration.

**Architecture:** The briefing loader obtains the organization's timezone and passes it into its source-driven core. That core derives all daily values and record-query boundaries from one zoned `DateTime`; date-only shift values remain explicitly interpreted as UTC at the database boundary.

**Tech Stack:** TypeScript, Luxon, Drizzle ORM, Vitest, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/lib/manager-daily-briefing/get-manager-daily-briefing.ts` - Resolve the organization timezone and use it for all daily briefing behavior.
- Modify: `apps/webapp/src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts` - Cover business-day boundaries and pass the explicit test timezone.
- Modify: `apps/webapp/src/lib/manager-daily-briefing/__tests__/logic.test.ts` - Preserve explicit-offset instants in test fixtures.
- Delete worktree: `/home/kai/projekte/z8/.worktrees/fix-briefing-timezone-pgoptions` - Discard its rejected PostgreSQL pool, parser, environment, and test changes.

### Task 1: Prove Organization-Timezone Boundaries

**Files:**
- Modify: `apps/webapp/src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`

- [ ] **Step 1: Add the failing cross-midnight briefing test**

Add this test as the first test in `get-manager-daily-briefing.test.ts`:

```ts
it("uses the supplied business timezone for the local briefing day and record window", async () => {
	const sources = createSources();
	const briefing = await getManagerDailyBriefingFromSources({
		organizationId: "org-1",
		currentEmployee: { id: "manager-1", role: "manager" },
		now: DateTime.fromISO("2026-04-27T22:30:00.000Z", { setZone: true }),
		timezone: "Europe/Berlin",
		sources,
	});

	expect(briefing.date).toBe("2026-04-28");
	expect(sources.getPublishedShifts).toHaveBeenCalledWith({
		organizationId: "org-1",
		employeeIds: ["emp-1"],
		date: "2026-04-28",
	});
	expect(sources.getOpenTimeRecords).toHaveBeenCalledWith({
		organizationId: "org-1",
		employeeIds: ["emp-1"],
		from: DateTime.fromISO("2026-04-27T20:00:00.000Z", { setZone: true }).toJSDate(),
		to: DateTime.fromISO("2026-04-29T21:59:59.999Z", { setZone: true }).toJSDate(),
	});
});
```

- [ ] **Step 2: Run the test to verify the missing timezone contract fails**

Run: `pnpm --filter webapp exec vitest run src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`

Expected: FAIL because the source-driven briefing input does not accept `timezone` and derives the UTC date.

### Task 2: Make Briefings Organization-Timezone Aware

**Files:**
- Modify: `apps/webapp/src/lib/manager-daily-briefing/get-manager-daily-briefing.ts:71-76`
- Modify: `apps/webapp/src/lib/manager-daily-briefing/get-manager-daily-briefing.ts:148-234`
- Modify: `apps/webapp/src/lib/manager-daily-briefing/get-manager-daily-briefing.ts:283-302`
- Modify: `apps/webapp/src/lib/manager-daily-briefing/get-manager-daily-briefing.ts:397-427`

- [ ] **Step 1: Add the explicit timezone input and derive a business instant**

Change the source-driven input and function destructuring:

```ts
type GetManagerDailyBriefingFromSourcesInput = {
	organizationId: string;
	currentEmployee: CurrentEmployee;
	now: DateTime;
	timezone: string;
	sources: ManagerDailyBriefingSources;
};

export async function getManagerDailyBriefingFromSources({
	organizationId,
	currentEmployee,
	now,
	timezone,
	sources,
}: GetManagerDailyBriefingFromSourcesInput): Promise<ManagerDailyBriefing> {
	const businessNow = now.setZone(timezone);
	const date = businessNow.toISODate() ?? "";
```

- [ ] **Step 2: Use the business instant for every daily calculation**

Replace the time-record window and daily logic inputs:

```ts
const timeRecordWindow = {
	from: businessNow.startOf("day").minus({ hours: 2 }).toJSDate(),
	to: businessNow.endOf("day").plus({ days: 1 }).toJSDate(),
};

const attendanceItems =
	shiftsResult.status === "fulfilled" && timeRecordsResult.status === "fulfilled"
		? detectAttendanceExceptions({
			now: businessNow,
			shifts,
			records: timeRecords,
			graceMinutes: 5,
		})
		: [];
const absenceItems =
	absencesResult.status === "fulfilled"
		? detectAbsencesToday({ today: businessNow, absences })
		: [];
const coverageItems =
	coverageRulesResult.status === "fulfilled" && shiftsResult.status === "fulfilled"
		? detectCoverageRisks({
			dayOfWeek: businessNow.toFormat("cccc").toLowerCase(),
			coverageRules,
			publishedShifts: shifts,
		})
		: [];
```

- [ ] **Step 3: Resolve the organization timezone in the database entry point**

Replace the beginning of `getManagerDailyBriefing` with:

```ts
const [{ db, organization }, { resolveEffectiveTimezone }] = await Promise.all([
	import("@/db"),
	import("@/lib/timezone/effective-timezone"),
]);
const persistedOrganization = await db.query.organization.findFirst({
	where: eq(organization.id, currentEmployee.organizationId),
	columns: { timezone: true },
});
```

Pass the resolved timezone into the source-driven call:

```ts
timezone: resolveEffectiveTimezone(undefined, persistedOrganization?.timezone),
```

- [ ] **Step 4: Preserve UTC semantics for date-only shift values**

In `getPublishedShifts`, replace the date query and returned date conversion with:

```ts
eq(shift.date, DateTime.fromISO(date, { zone: "UTC" }).toJSDate()),
```

```ts
date: DateTime.fromJSDate(row.date, { zone: "UTC" }).toISODate() ?? date,
```

- [ ] **Step 5: Run the source-driven briefing test**

Run: `pnpm --filter webapp exec vitest run src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`

Expected: PASS, including the cross-midnight test.

### Task 3: Preserve Explicit Test Instants

**Files:**
- Modify: `apps/webapp/src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`
- Modify: `apps/webapp/src/lib/manager-daily-briefing/__tests__/logic.test.ts`

- [ ] **Step 1: Pass the test timezone to all source-driven test calls**

For every existing `getManagerDailyBriefingFromSources` invocation, preserve its explicit offset with `{ setZone: true }` and add:

```ts
timezone: "Europe/Berlin",
```

- [ ] **Step 2: Preserve the offset in Luxon logic fixtures**

Change each explicit-offset fixture from:

```ts
DateTime.fromISO("2026-04-28T09:20:00.000+02:00")
```

to:

```ts
DateTime.fromISO("2026-04-28T09:20:00.000+02:00", { setZone: true })
```

Apply the same `{ setZone: true }` option to every `DateTime.fromISO` fixture with an explicit offset in these two test files.

- [ ] **Step 3: Run all manager briefing tests**

Run: `pnpm --filter webapp exec vitest run src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts src/lib/manager-daily-briefing/__tests__/logic.test.ts`

Expected: PASS with zero failures.

### Task 4: Discard Rejected Database Changes and Clean Up

**Files:**
- Delete worktree: `/home/kai/projekte/z8/.worktrees/fix-briefing-timezone-pgoptions`

- [ ] **Step 1: Confirm only briefing files are modified on `dev`**

Run: `git diff --name-only -- apps/webapp/src/lib/manager-daily-briefing`

Expected: only the implementation and its two test files are listed; existing unrelated `dev` changes remain unmodified.

- [ ] **Step 2: Force-remove the obsolete briefing worktree after the briefing files are on `dev`**

Run: `git worktree remove --force "/home/kai/projekte/z8/.worktrees/fix-briefing-timezone-pgoptions"`

Expected: the worktree and its rejected PGOPTIONS, pool, type-parser, and database-test changes are discarded.

- [ ] **Step 3: Verify the remaining worktrees**

Run: `git worktree list --porcelain`

Expected: `dev` and `temporal-timezone-consistency` are registered; `fix-briefing-timezone-pgoptions` is absent.

### Task 5: Typecheck

**Files:**
- Modify: `apps/webapp/src/lib/manager-daily-briefing/get-manager-daily-briefing.ts`
- Modify: `apps/webapp/src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts`
- Modify: `apps/webapp/src/lib/manager-daily-briefing/__tests__/logic.test.ts`

- [ ] **Step 1: Run the webapp typecheck**

Run: `pnpm --filter webapp typecheck`

Expected: exit code 0.
