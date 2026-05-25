# Hydration Workday Streak Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make hydration streaks persist across non-workdays and reset only when a required workday is missed.

**Architecture:** Keep hydration stats user-level, but evaluate streak continuity against the session user's active organization employee work requirements. Reuse `getDailyWorkRequirementsForEmployee` so schedules, approved absences, and assigned holidays are handled by existing calendar logic.

**Tech Stack:** Next.js server actions and route handlers, Effect services, Drizzle ORM, Luxon, Vitest.

---

## File Structure

- Modify `apps/webapp/src/lib/wellness/streak-calculator.ts`: add pure workday-aware streak helpers while preserving existing calendar-day fallback helpers.
- Create `apps/webapp/src/lib/wellness/streak-calculator.test.ts`: unit tests for workday-aware streak decisions.
- Modify `apps/webapp/src/app/[locale]/(app)/wellness/actions/queries.ts`: add active employee lookup and work requirement lookup helpers for the Effect-based server actions.
- Modify `apps/webapp/src/app/[locale]/(app)/wellness/actions.ts`: pass active organization context into hydration stats and intake flows; use workday-aware reset and increment decisions.
- Modify `apps/webapp/src/app/api/wellness/water-action/route.ts`: keep service-worker water logging consistent with server actions using direct DB active employee lookup and `getDailyWorkRequirementsForEmployee`.
- Optionally add or extend route/server-action tests only if the existing test harness already covers this module; pure unit tests are the primary safety net for streak rules.

## Task 1: Add Pure Workday-Aware Streak Helpers

**Files:**
- Modify: `apps/webapp/src/lib/wellness/streak-calculator.ts`
- Create: `apps/webapp/src/lib/wellness/streak-calculator.test.ts`

- [ ] **Step 1: Write failing tests for workday-aware calculation**

Create `apps/webapp/src/lib/wellness/streak-calculator.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
	calculateStreakOnIntake,
	shouldResetStreak,
	type WorkdayRequirementByDate,
} from "./streak-calculator";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("hydration streak workday awareness", () => {
	it("increments across a weekend with no required workdays", () => {
		const result = calculateStreakOnIntake(
			{
				currentStreak: 5,
				longestStreak: 5,
				lastGoalMetDate: date("2026-05-22"),
				today: date("2026-05-25"),
				todayIntake: 7,
				dailyGoal: 8,
				workdayRequirements: {},
			},
			1,
		);

		expect(result).toMatchObject({
			newCurrentStreak: 6,
			newLongestStreak: 6,
			goalJustMet: true,
			streakBroken: false,
		});
		expect(result.newLastGoalMetDate?.toISOString().slice(0, 10)).toBe("2026-05-25");
	});

	it("resets when a required workday was missed", () => {
		const workdayRequirements: WorkdayRequirementByDate = {
			"2026-05-23": 480,
		};

		const result = calculateStreakOnIntake(
			{
				currentStreak: 5,
				longestStreak: 7,
				lastGoalMetDate: date("2026-05-22"),
				today: date("2026-05-25"),
				todayIntake: 7,
				dailyGoal: 8,
				workdayRequirements,
			},
			1,
		);

		expect(result).toMatchObject({
			newCurrentStreak: 1,
			newLongestStreak: 7,
			goalJustMet: true,
			streakBroken: true,
		});
	});

	it("preserves streak across holiday and absence dates with zero requirements", () => {
		const workdayRequirements: WorkdayRequirementByDate = {
			"2026-05-23": 0,
			"2026-05-24": 0,
		};

		const result = calculateStreakOnIntake(
			{
				currentStreak: 2,
				longestStreak: 4,
				lastGoalMetDate: date("2026-05-22"),
				today: date("2026-05-25"),
				todayIntake: 7,
				dailyGoal: 8,
				workdayRequirements,
			},
			1,
		);

		expect(result).toMatchObject({
			newCurrentStreak: 3,
			newLongestStreak: 4,
			goalJustMet: true,
			streakBroken: false,
		});
	});

	it("does not reset on stats load when only non-workdays were skipped", () => {
		expect(
			shouldResetStreak(date("2026-05-22"), 3, {
				today: date("2026-05-25"),
				workdayRequirements: {},
			}),
		).toBe(false);
	});

	it("resets on stats load when a required workday was skipped", () => {
		expect(
			shouldResetStreak(date("2026-05-22"), 3, {
				today: date("2026-05-25"),
				workdayRequirements: { "2026-05-23": 480 },
			}),
		).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter webapp test apps/webapp/src/lib/wellness/streak-calculator.test.ts`

Expected: FAIL because `WorkdayRequirementByDate`, `today`, and `workdayRequirements` are not yet supported by `streak-calculator.ts`.

- [ ] **Step 3: Implement minimal helper support**

In `apps/webapp/src/lib/wellness/streak-calculator.ts`, add these exports and helper functions after the existing date helpers:

```ts
export type WorkdayRequirementByDate = Record<string, number>;

export interface WorkdayAwareStreakOptions {
	today?: Date;
	workdayRequirements?: WorkdayRequirementByDate;
}

function toDateKey(date: Date): string {
	return DateTime.fromJSDate(date, { zone: "utc" }).toFormat("yyyy-MM-dd");
}

function hasMissedRequiredWorkday(
	lastGoalMetDate: Date,
	today: Date,
	workdayRequirements?: WorkdayRequirementByDate,
): boolean {
	if (!workdayRequirements) {
		return differenceInCalendarDays(startOfDay(today), lastGoalMetDate) > 1;
	}

	let cursor = DateTime.fromJSDate(lastGoalMetDate, { zone: "utc" })
		.startOf("day")
		.plus({ days: 1 });
	const end = DateTime.fromJSDate(today, { zone: "utc" }).startOf("day");

	while (cursor < end) {
		const dateKey = cursor.toFormat("yyyy-MM-dd");
		if ((workdayRequirements[dateKey] ?? 0) > 0) {
			return true;
		}
		cursor = cursor.plus({ days: 1 });
	}

	return false;
}
```

Update `StreakCalculationInput`:

```ts
export interface StreakCalculationInput extends WorkdayAwareStreakOptions {
	currentStreak: number;
	longestStreak: number;
	lastGoalMetDate: Date | null;
	todayIntake: number;
	dailyGoal: number;
}
```

In `calculateStreakOnIntake`, replace the current `now` and `today` setup with:

```ts
	const today = startOfDay(input.today ?? new Date());
```

Replace the `isToday` and `isYesterday` branches with UTC date-key checks and the workday-aware gap check:

```ts
	if (!lastGoalMetDate) {
		newStreak = 1;
	} else if (toDateKey(lastGoalMetDate) === toDateKey(today)) {
		newStreak = currentStreak;
	} else if (!hasMissedRequiredWorkday(lastGoalMetDate, today, input.workdayRequirements)) {
		newStreak = currentStreak + 1;
	} else {
		newStreak = 1;
		streakBroken = currentStreak > 0;
	}
```

Update `shouldResetStreak` signature and body:

```ts
export function shouldResetStreak(
	lastGoalMetDate: Date | null,
	currentStreak: number,
	options: WorkdayAwareStreakOptions = {},
): boolean {
	if (!lastGoalMetDate || currentStreak === 0) {
		return false;
	}

	return hasMissedRequiredWorkday(
		lastGoalMetDate,
		startOfDay(options.today ?? new Date()),
		options.workdayRequirements,
	);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter webapp test apps/webapp/src/lib/wellness/streak-calculator.test.ts`

Expected: PASS for all `hydration streak workday awareness` tests.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/wellness/streak-calculator.ts apps/webapp/src/lib/wellness/streak-calculator.test.ts
git commit -m "fix: make hydration streak calculator workday-aware"
```

## Task 2: Add Active Employee and Work Requirement Query Helpers

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/wellness/actions/queries.ts`

- [ ] **Step 1: Add query helper imports**

In `apps/webapp/src/app/[locale]/(app)/wellness/actions/queries.ts`, update imports:

```ts
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { employee, hydrationStats, userSettings, waterIntakeLog } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import type { WorkdayRequirementByDate } from "@/lib/wellness/streak-calculator";
import { createDefaultHydrationStats, getTodayRange } from "./shared";
```

- [ ] **Step 2: Add active employee helper**

Append to `queries.ts`:

```ts
export function getActiveEmployeeForHydration(userId: string, organizationId: string | null) {
	return Effect.gen(function* (_) {
		if (!organizationId) return null;

		const dbService = yield* _(DatabaseService);
		return yield* _(
			dbService.query("getActiveEmployeeForHydration", async () => {
				return dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, userId),
						eq(employee.organizationId, organizationId),
						eq(employee.isActive, true),
					),
					columns: { id: true, organizationId: true },
				});
			}),
		);
	});
}
```

- [ ] **Step 3: Add work requirement mapping helper**

Append below the active employee helper:

```ts
export function getHydrationStreakWorkdayRequirements(params: {
	organizationId: string | null;
	employeeId: string | null;
	lastGoalMetDate: Date | null;
	today?: Date;
}) {
	return Effect.gen(function* (_) {
		if (!params.organizationId || !params.employeeId || !params.lastGoalMetDate) {
			return undefined;
		}

		const start = DateTime.fromJSDate(params.lastGoalMetDate, { zone: "utc" })
			.startOf("day")
			.plus({ days: 1 });
		const end = DateTime.fromJSDate(params.today ?? new Date(), { zone: "utc" }).startOf("day");

		if (!start.isValid || !end.isValid || start >= end) {
			return {} satisfies WorkdayRequirementByDate;
		}

		const requirements = yield* _(
			Effect.promise(() =>
				getDailyWorkRequirementsForEmployee({
					organizationId: params.organizationId!,
					employeeId: params.employeeId!,
					startDate: start.toJSDate(),
					endDate: end.minus({ days: 1 }).endOf("day").toJSDate(),
				}),
			),
		);

		return Object.fromEntries(
			Object.entries(requirements).map(([dateKey, requirement]) => [
				dateKey,
				requirement.requiredMinutes,
			]),
		) satisfies WorkdayRequirementByDate;
	});
}
```

- [ ] **Step 4: Run TypeScript check for changed helper**

Run: `pnpm --filter webapp exec tsc --noEmit`

Expected: PASS, or only unrelated pre-existing type errors. If errors point to `queries.ts`, fix the helper before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/wellness/actions/queries.ts
git commit -m "fix: add hydration workday requirement queries"
```

## Task 3: Wire Workday-Aware Streaks Into Wellness Server Actions

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/wellness/actions.ts`

- [ ] **Step 1: Update action operation context**

In `actions.ts`, change `buildWellnessActionEffect` to pass active organization ID:

```ts
function buildWellnessActionEffect<T, E>(
	operation: (context: { userId: string; activeOrganizationId: string | null }) => Effect.Effect<T, E, DatabaseService>,
) {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		return yield* _(
			operation({
				userId: session.user.id,
				activeOrganizationId: session.session?.activeOrganizationId ?? null,
			}),
		);
	}).pipe(Effect.provide(AppLayer));
}
```

- [ ] **Step 2: Update imports**

Update the query imports in `actions.ts`:

```ts
import {
	ensureHydrationStatsRecord,
	getActiveEmployeeForHydration,
	getHydrationStatsRecord,
	getHydrationStreakWorkdayRequirements,
	getLastWaterIntakeToday,
	getTodayWaterIntake,
	getUserWaterReminderSettings,
} from "./actions/queries";
```

- [ ] **Step 3: Update simple user-only call sites**

For `getWaterReminderStatus`, `snoozeWaterReminder`, `updateWaterReminderSettings`, and `getWaterReminderSettings`, change callback parameters from `(userId) =>` to `({ userId }) =>`. Keep the function bodies unchanged except for using `userId` from the object.

- [ ] **Step 4: Update `getHydrationStats` streak reset logic**

In `getHydrationStats`, replace the callback body with:

```ts
const effect = buildWellnessActionEffect(({ userId, activeOrganizationId }) =>
	Effect.gen(function* (_) {
		const [settings, statsRecord, todayIntake, activeEmployee] = yield* _(
			Effect.all([
				getUserWaterReminderSettings(userId),
				ensureHydrationStatsRecord(userId),
				getTodayWaterIntake(userId),
				getActiveEmployeeForHydration(userId, activeOrganizationId),
			]),
		);

		const lastGoalMetDate = statsRecord.lastGoalMetDate
			? new Date(statsRecord.lastGoalMetDate)
			: null;
		const workdayRequirements = yield* _(
			getHydrationStreakWorkdayRequirements({
				organizationId: activeOrganizationId,
				employeeId: activeEmployee?.id ?? null,
				lastGoalMetDate,
			}),
		);

		let currentStreak = statsRecord.currentStreak;
		if (lastGoalMetDate && shouldResetStreak(lastGoalMetDate, currentStreak, { workdayRequirements })) {
			yield* _(resetHydrationStreak(userId));
			currentStreak = 0;
		}

		return toHydrationStatsValue({
			stats: statsRecord,
			currentStreak,
			todayIntake,
			dailyGoal: toWaterReminderSettings(settings).dailyGoal,
		});
	}),
);
```

- [ ] **Step 5: Update `logWaterIntake` streak calculation**

In `logWaterIntake`, fetch the active employee with the existing parallel reads and pass requirements into `calculateStreakOnIntake`:

```ts
const [settings, statsRecord, currentTodayIntake, activeEmployee] = yield* _(
	Effect.all([
		getUserWaterReminderSettings(userId),
		ensureHydrationStatsRecord(userId),
		getTodayWaterIntake(userId),
		getActiveEmployeeForHydration(userId, activeOrganizationId),
	]),
);

const lastGoalMetDate = statsRecord.lastGoalMetDate ? new Date(statsRecord.lastGoalMetDate) : null;
const workdayRequirements = yield* _(
	getHydrationStreakWorkdayRequirements({
		organizationId: activeOrganizationId,
		employeeId: activeEmployee?.id ?? null,
		lastGoalMetDate,
	}),
);
```

Then set `lastGoalMetDate` and `workdayRequirements` in the calculation input:

```ts
const streakResult = calculateStreakOnIntake(
	{
		currentStreak: statsRecord.currentStreak,
		longestStreak: statsRecord.longestStreak,
		lastGoalMetDate,
		todayIntake: currentTodayIntake,
		dailyGoal,
		workdayRequirements,
	},
	amount,
);
```

- [ ] **Step 6: Run targeted tests and type check**

Run: `pnpm --filter webapp test apps/webapp/src/lib/wellness/streak-calculator.test.ts`

Expected: PASS.

Run: `pnpm --filter webapp exec tsc --noEmit`

Expected: PASS, or only unrelated pre-existing type errors. Fix all errors in `actions.ts`, `queries.ts`, or `streak-calculator.ts`.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/app/[locale]/(app)/wellness/actions.ts
git commit -m "fix: use workday-aware hydration streaks"
```

## Task 4: Keep Notification Water Action Route Consistent

**Files:**
- Modify: `apps/webapp/src/app/api/wellness/water-action/route.ts`

- [ ] **Step 1: Update imports**

In `route.ts`, update schema and helper imports:

```ts
import { employee, hydrationStats, userSettings, waterIntakeLog } from "@/db/schema";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { calculateStreakOnIntake, type WorkdayRequirementByDate } from "@/lib/wellness/streak-calculator";
```

- [ ] **Step 2: Add local requirement helper**

Add below `waterActionSchema`:

```ts
async function getRouteWorkdayRequirements(params: {
	userId: string;
	organizationId: string | null;
	lastGoalMetDate: Date | null;
}): Promise<WorkdayRequirementByDate | undefined> {
	if (!params.organizationId || !params.lastGoalMetDate) return undefined;

	const activeEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.userId, params.userId),
			eq(employee.organizationId, params.organizationId),
			eq(employee.isActive, true),
		),
		columns: { id: true },
	});
	if (!activeEmployee) return undefined;

	const start = DateTime.fromJSDate(params.lastGoalMetDate, { zone: "utc" })
		.startOf("day")
		.plus({ days: 1 });
	const end = DateTime.now().startOf("day");
	if (!start.isValid || !end.isValid || start >= end) return {};

	const requirements = await getDailyWorkRequirementsForEmployee({
		organizationId: params.organizationId,
		employeeId: activeEmployee.id,
		startDate: start.toJSDate(),
		endDate: end.minus({ days: 1 }).endOf("day").toJSDate(),
	});

	return Object.fromEntries(
		Object.entries(requirements).map(([dateKey, requirement]) => [
			dateKey,
			requirement.requiredMinutes,
		]),
	);
}
```

- [ ] **Step 3: Pass requirements into route calculation**

Before `const streakResult = calculateStreakOnIntake(...)`, add:

```ts
const lastGoalMetDate = stats?.lastGoalMetDate ? new Date(stats.lastGoalMetDate) : null;
const workdayRequirements = await getRouteWorkdayRequirements({
	userId: session.user.id,
	organizationId: session.session?.activeOrganizationId ?? null,
	lastGoalMetDate,
});
```

Then update the calculation input:

```ts
const streakResult = calculateStreakOnIntake(
	{
		currentStreak: stats?.currentStreak ?? 0,
		longestStreak: stats?.longestStreak ?? 0,
		lastGoalMetDate,
		todayIntake: currentTodayIntake,
		dailyGoal,
		workdayRequirements,
	},
	amount,
);
```

- [ ] **Step 4: Run targeted validation**

Run: `pnpm --filter webapp test apps/webapp/src/lib/wellness/streak-calculator.test.ts`

Expected: PASS.

Run: `pnpm --filter webapp exec tsc --noEmit`

Expected: PASS, or only unrelated pre-existing type errors. Fix all errors in `route.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/app/api/wellness/water-action/route.ts
git commit -m "fix: align water action streak continuity"
```

## Task 5: Final Verification

**Files:**
- Verify: all modified files

- [ ] **Step 1: Run focused hydration tests**

Run: `pnpm --filter webapp test apps/webapp/src/lib/wellness/streak-calculator.test.ts`

Expected: PASS.

- [ ] **Step 2: Run broader test suite if time allows**

Run: `pnpm --filter webapp test`

Expected: PASS, or document unrelated pre-existing failures with exact failing test names.

- [ ] **Step 3: Run production build check if environment permits**

Run: `CI=true pnpm build`

Expected: PASS. If build requires unavailable Phase CLI environment variables, skip and record the skipped variables or command reason in the final response.

- [ ] **Step 4: Inspect worktree**

Run: `git status --short`

Expected: only intended hydration streak files and plan/spec docs are modified unless other user or peer-agent changes already existed.

- [ ] **Step 5: Commit final verification note if changes were made after prior commits**

```bash
git add docs/superpowers/specs/2026-05-25-hydration-workday-streak-design.md docs/superpowers/plans/2026-05-25-hydration-workday-streak.md
git commit -m "docs: plan hydration workday streak persistence"
```

Only run this commit if the user explicitly requested commits for this session.

## Self-Review

- Spec coverage: active organization scoping is covered in Tasks 2-4; schedule, absence, and holiday handling is covered by reusing `getDailyWorkRequirementsForEmployee`; no schema migration is planned; tests cover weekend, holiday/absence zero requirements, missed workday reset, and load-time reset.
- Placeholder scan: the plan contains no unresolved implementation placeholders.
- Type consistency: `WorkdayRequirementByDate`, `WorkdayAwareStreakOptions`, `getActiveEmployeeForHydration`, and `getHydrationStreakWorkdayRequirements` are introduced before use and referenced consistently.
