# Hydration Team Streak Leaders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top 3 team hydration streak leaderboard to the existing dashboard Hydration widget.

**Architecture:** Keep the feature inside the existing `getHydrationWidgetData` server action and `HydrationWidget` UI. Add a small helper module for team id collection, deduplication, ranking, and formatting-friendly leader data so ranking rules can be tested without database setup. Cache the leaderboard database query with `unstable_cache`, scoped by organization, current employee, and team ids, and invalidate it when hydration streak data changes.

**Tech Stack:** Next.js server actions, React, TypeScript, Drizzle ORM, Vitest, Testing Library, Tolgee fallbacks, Tabler icons if needed.

---

## File Structure

- Create `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.ts`: pure helper types and functions for collecting team ids and building sorted/deduped leaderboard rows.
- Create `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`: unit tests for dedupe, ranking, current-user marker, org-scope protection through caller-provided candidate rows, missing stats, and stable tie sorting.
- Modify `apps/webapp/src/lib/cache/tags.ts`: add a scoped hydration streak cache tag.
- Modify `apps/webapp/src/app/[locale]/(app)/wellness/actions.ts`: revalidate the hydration streak cache tag after water logging updates streak stats.
- Modify `apps/webapp/src/components/dashboard/actions.ts`: import `teamMembership`, `unstable_cache`, cache tags, and helper functions; expand `getHydrationWidgetData` response; query shared team employees through a cached organization/team scoped lookup; degrade leaderboard failures to an empty array.
- Modify `apps/webapp/src/components/dashboard/hydration-widget.tsx`: extend the data type and render a compact `Team streak leaders` section.
- Create `apps/webapp/src/components/dashboard/hydration-widget.test.tsx`: component tests for leaderboard rows, `You` label, and hidden empty state.

## Commands

- Helper tests: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`
- Widget tests: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-widget.test.tsx`
- Full relevant test set: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts apps/webapp/src/components/dashboard/hydration-widget.test.tsx`
- Final project check if time allows: `pnpm test`

---

### Task 1: Add Ranking Helper With Tests

**Files:**
- Create: `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.ts`
- Create: `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";
import { buildTeamStreakLeaders, collectUniqueTeamIds } from "./hydration-team-streak-leaders";

describe("collectUniqueTeamIds", () => {
	it("combines primary and membership team ids without duplicates", () => {
		expect(
			collectUniqueTeamIds("team-a", [
				{ teamId: "team-a" },
				{ teamId: "team-b" },
				{ teamId: "team-b" },
			]),
		).toEqual(["team-a", "team-b"]);
	});

	it("ignores null primary team ids", () => {
		expect(collectUniqueTeamIds(null, [{ teamId: "team-b" }])).toEqual(["team-b"]);
	});
});

describe("buildTeamStreakLeaders", () => {
	it("deduplicates employees shared through multiple teams before limiting to the top three", () => {
		const leaders = buildTeamStreakLeaders(
			[
				{ employeeId: "emp-1", userId: "user-1", displayName: "Avery", currentStreak: 4 },
				{ employeeId: "emp-1", userId: "user-1", displayName: "Avery", currentStreak: 4 },
				{ employeeId: "emp-2", userId: "user-2", displayName: "Blair", currentStreak: 8 },
				{ employeeId: "emp-3", userId: "user-3", displayName: "Casey", currentStreak: 6 },
				{ employeeId: "emp-4", userId: "user-4", displayName: "Devon", currentStreak: 2 },
			],
			"user-1",
		);

		expect(leaders).toEqual([
			{ employeeId: "emp-2", displayName: "Blair", currentStreak: 8, isCurrentUser: false },
			{ employeeId: "emp-3", displayName: "Casey", currentStreak: 6, isCurrentUser: false },
			{ employeeId: "emp-1", displayName: "Avery", currentStreak: 4, isCurrentUser: true },
		]);
	});

	it("treats missing hydration stats as a zero streak", () => {
		expect(
			buildTeamStreakLeaders(
				[{ employeeId: "emp-1", userId: "user-1", displayName: "Avery", currentStreak: null }],
				"user-2",
			),
		).toEqual([
			{ employeeId: "emp-1", displayName: "Avery", currentStreak: 0, isCurrentUser: false },
		]);
	});

	it("sorts ties by display name for stable output", () => {
		expect(
			buildTeamStreakLeaders(
				[
					{ employeeId: "emp-2", userId: "user-2", displayName: "Blair", currentStreak: 3 },
					{ employeeId: "emp-1", userId: "user-1", displayName: "Avery", currentStreak: 3 },
				],
				"user-1",
			),
		).toEqual([
			{ employeeId: "emp-1", displayName: "Avery", currentStreak: 3, isCurrentUser: true },
			{ employeeId: "emp-2", displayName: "Blair", currentStreak: 3, isCurrentUser: false },
		]);
	});
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`

Expected: FAIL because `./hydration-team-streak-leaders` does not exist.

- [ ] **Step 3: Add the helper implementation**

Create `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.ts` with this content:

```ts
export type TeamStreakLeader = {
	employeeId: string;
	displayName: string;
	currentStreak: number;
	isCurrentUser: boolean;
};

export type TeamStreakLeaderCandidate = {
	employeeId: string;
	userId: string;
	displayName: string;
	currentStreak: number | null | undefined;
};

export function collectUniqueTeamIds(
	primaryTeamId: string | null | undefined,
	memberships: Array<{ teamId: string }>,
) {
	return Array.from(
		new Set([primaryTeamId, ...memberships.map((membership) => membership.teamId)].filter(Boolean)),
	) as string[];
}

export function buildTeamStreakLeaders(
	candidates: TeamStreakLeaderCandidate[],
	currentUserId: string,
): TeamStreakLeader[] {
	const uniqueCandidates = new Map<string, TeamStreakLeaderCandidate>();

	for (const candidate of candidates) {
		if (!uniqueCandidates.has(candidate.employeeId)) {
			uniqueCandidates.set(candidate.employeeId, candidate);
		}
	}

	return Array.from(uniqueCandidates.values())
		.map((candidate) => ({
			employeeId: candidate.employeeId,
			displayName: candidate.displayName,
			currentStreak: candidate.currentStreak ?? 0,
			isCurrentUser: candidate.userId === currentUserId,
		}))
		.sort((left, right) => {
			if (right.currentStreak !== left.currentStreak) {
				return right.currentStreak - left.currentStreak;
			}

			return left.displayName.localeCompare(right.displayName);
		})
		.slice(0, 3);
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit helper and tests**

Run:

```bash
git add apps/webapp/src/components/dashboard/hydration-team-streak-leaders.ts apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts
git commit -m "feat: add hydration team streak ranking helper"
```

Expected: Commit succeeds with only the helper and helper test files staged.

---

### Task 2: Add Hydration Leaderboard Cache Tag And Invalidation

**Files:**
- Modify: `apps/webapp/src/lib/cache/tags.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/wellness/actions.ts`

- [ ] **Step 1: Add the cache tag**

In `apps/webapp/src/lib/cache/tags.ts`, add this entry after `TEAMS`:

```ts
	HYDRATION_STREAKS: (orgId: string) => `hydration-streaks:${orgId}`,
```

The organization data section should become:

```ts
	// Organization data (public cache, scoped by org)
	EMPLOYEES: (orgId: string) => `employees:${orgId}`,
	TEAMS: (orgId: string) => `teams:${orgId}`,
	HYDRATION_STREAKS: (orgId: string) => `hydration-streaks:${orgId}`,
	LOCATIONS: (orgId: string) => `locations:${orgId}`,
```

- [ ] **Step 2: Import cache invalidation in wellness actions**

In `apps/webapp/src/app/[locale]/(app)/wellness/actions.ts`, add this import near the existing imports:

```ts
import { revalidateTag } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
```

- [ ] **Step 3: Revalidate after water logging updates streak stats**

In `logWaterIntake`, immediately after `yield* _(updateHydrationStatsAfterIntake({ ... }))`, add:

```ts
			if (activeOrganizationId) {
				revalidateTag(CACHE_TAGS.HYDRATION_STREAKS(activeOrganizationId), "max");
			}
```

The surrounding code should read:

```ts
			yield* _(
				updateHydrationStatsAfterIntake({
					userId,
					amount,
					currentStreak: streakResult.newCurrentStreak,
					longestStreak: streakResult.newLongestStreak,
					lastGoalMetDate: streakResult.newLastGoalMetDate,
				}),
			);

			if (activeOrganizationId) {
				revalidateTag(CACHE_TAGS.HYDRATION_STREAKS(activeOrganizationId), "max");
			}

			const newTodayIntake = currentTodayIntake + amount;
```

- [ ] **Step 4: Run an existing hydration-focused test**

Run: `pnpm vitest run apps/webapp/src/lib/wellness/streak-calculator.test.ts`

Expected: PASS. If importing `next/cache` requires a test mock in wellness action tests later, add a local `vi.mock("next/cache", ...)` only in the affected test file.

- [ ] **Step 5: Commit cache tag and invalidation**

Run:

```bash
git add apps/webapp/src/lib/cache/tags.ts apps/webapp/src/app/[locale]/(app)/wellness/actions.ts
git commit -m "feat: invalidate hydration streak leaderboard cache"
```

Expected: Commit succeeds with only the cache tag and wellness action files staged.

---

### Task 3: Wire Cached Leaderboard Data Into The Dashboard Action

**Files:**
- Modify: `apps/webapp/src/components/dashboard/actions.ts`
- Test: `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`

- [ ] **Step 1: Expand action imports**

In `apps/webapp/src/components/dashboard/actions.ts`, keep the existing Drizzle import unchanged because it already includes `inArray` for team id filters:

```ts
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
```

Add this import near the other external imports:

```ts
import { unstable_cache } from "next/cache";
```

Add this import near the other `@/lib` imports:

```ts
import { CACHE_TAGS } from "@/lib/cache/tags";
```

Change the schema import block by adding `teamMembership`:

```ts
import {
	absenceEntry,
	approvalRequest,
	employee,
	holiday,
	holidayCategory,
	hydrationStats,
	team,
	teamMembership,
	userSettings,
	waterIntakeLog,
	workPeriod,
	workPolicyAssignment,
} from "@/db/schema";
```

Add the helper import near the other local dashboard imports:

```ts
import {
	buildTeamStreakLeaders,
	collectUniqueTeamIds,
	type TeamStreakLeader,
	type TeamStreakLeaderCandidate,
} from "./hydration-team-streak-leaders";
```

- [ ] **Step 2: Expand the `getHydrationWidgetData` return type**

In the return type for `getHydrationWidgetData`, add `teamStreakLeaders: TeamStreakLeader[];` after `goalProgress: number;`.

The type block should become:

```ts
ServerActionResult<{
	enabled: boolean;
	currentStreak: number;
	longestStreak: number;
	todayIntake: number;
	dailyGoal: number;
	goalProgress: number;
	teamStreakLeaders: TeamStreakLeader[];
}>
```

- [ ] **Step 3: Return an empty leaderboard when hydration is disabled**

In the `if (!settings?.waterReminderEnabled)` branch, add `teamStreakLeaders: [],`.

The returned object should be:

```ts
return {
	enabled: false,
	currentStreak: 0,
	longestStreak: 0,
	todayIntake: 0,
	dailyGoal: 8,
	goalProgress: 0,
	teamStreakLeaders: [],
};
```

- [ ] **Step 4: Add cached team leaderboard query logic before the final enabled return**

Inside `getHydrationWidgetData`, after `const goalProgress = Math.min(100, Math.round((todayIntake / dailyGoal) * 100));`, add this block:

```ts
const activeOrganizationId = session.session.activeOrganizationId;

const teamStreakLeaders = activeOrganizationId
	? yield* _(
			dbService
				.query("getHydrationTeamStreakLeaders", async () => {
					const currentEmployee = await dbService.db.query.employee.findFirst({
						where: and(
							eq(employee.userId, session.user.id),
							eq(employee.organizationId, activeOrganizationId),
						),
						columns: {
							id: true,
							userId: true,
							organizationId: true,
							teamId: true,
						},
					});

					if (!currentEmployee) {
						return [];
					}

					const currentMemberships = await dbService.db.query.teamMembership.findMany({
						where: and(
							eq(teamMembership.organizationId, activeOrganizationId),
							eq(teamMembership.employeeId, currentEmployee.id),
						),
						columns: { teamId: true },
					});

					const teamIds = collectUniqueTeamIds(currentEmployee.teamId, currentMemberships);

					if (teamIds.length === 0) {
						return [];
					}

					const sortedTeamIds = [...teamIds].sort();
					return unstable_cache(
						async () => {
							const primaryTeamEmployees = await dbService.db.query.employee.findMany({
								where: and(
									eq(employee.organizationId, activeOrganizationId),
									inArray(employee.teamId, sortedTeamIds),
								),
								columns: { id: true, userId: true, firstName: true, lastName: true },
								with: { user: { columns: { name: true } } },
							});

							const membershipRows = await dbService.db.query.teamMembership.findMany({
								where: and(
									eq(teamMembership.organizationId, activeOrganizationId),
									inArray(teamMembership.teamId, sortedTeamIds),
								),
								columns: { employeeId: true },
								with: {
									employee: {
										columns: { id: true, userId: true, firstName: true, lastName: true },
										with: { user: { columns: { name: true } } },
									},
								},
							});

							const candidateEmployees = [
								...primaryTeamEmployees,
								...membershipRows.map((row) => row.employee),
							];
							const userIds = Array.from(
								new Set(candidateEmployees.map((candidate) => candidate.userId)),
							);

							const statsRows = userIds.length
								? await dbService.db.query.hydrationStats.findMany({
										where: inArray(hydrationStats.userId, userIds),
										columns: { userId: true, currentStreak: true },
									})
								: [];
							const statsByUserId = new Map(
								statsRows.map((statsRow) => [statsRow.userId, statsRow.currentStreak]),
							);

							const candidates: TeamStreakLeaderCandidate[] = candidateEmployees.map((candidate) => {
								const fullName = [candidate.firstName, candidate.lastName]
									.filter(Boolean)
									.join(" ");
								return {
									employeeId: candidate.id,
									userId: candidate.userId,
									displayName: fullName || candidate.user.name || "Employee",
									currentStreak: statsByUserId.get(candidate.userId),
								};
							});

							return buildTeamStreakLeaders(candidates, session.user.id);
						},
						[
							"hydration-team-streak-leaders",
							activeOrganizationId,
							currentEmployee.id,
							...sortedTeamIds,
						],
						{
							revalidate: 60,
							tags: [
								CACHE_TAGS.HYDRATION_STREAKS(activeOrganizationId),
								CACHE_TAGS.EMPLOYEES(activeOrganizationId),
								CACHE_TAGS.TEAMS(activeOrganizationId),
							],
						},
					)();
				})
				.pipe(Effect.catchAll(() => Effect.succeed([]))),
		)
	: [];
```

If TypeScript reports that `with: { user: ... }` or `with: { employee: ... }` is not available from existing Drizzle relations, import `user` from `@/db/auth-schema` and replace those two relation queries with explicit `select().from(...).innerJoin(user, eq(employee.userId, user.id))` queries while preserving the same output shape and organization filters.

- [ ] **Step 5: Include the leaderboard in the final enabled return**

In the final `return { enabled: true, ... }`, add `teamStreakLeaders,` after `goalProgress,`.

The final object should include:

```ts
return {
	enabled: true,
	currentStreak: stats?.currentStreak ?? 0,
	longestStreak: stats?.longestStreak ?? 0,
	todayIntake,
	dailyGoal,
	goalProgress,
	teamStreakLeaders,
};
```

- [ ] **Step 6: Run TypeScript-facing tests**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`

Expected: PASS. If TypeScript fails in `actions.ts`, fix the query shape without changing the helper API or widget response type.

- [ ] **Step 7: Commit cached action wiring**

Run:

```bash
git add apps/webapp/src/components/dashboard/actions.ts
git commit -m "feat: load cached hydration team streak leaders"
```

Expected: Commit succeeds with only `actions.ts` staged.

---

### Task 4: Render Leaderboard In Hydration Widget

**Files:**
- Modify: `apps/webapp/src/components/dashboard/hydration-widget.tsx`
- Create: `apps/webapp/src/components/dashboard/hydration-widget.test.tsx`

- [ ] **Step 1: Write failing widget tests**

Create `apps/webapp/src/components/dashboard/hydration-widget.test.tsx` with this content:

```tsx
/* @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getHydrationWidgetDataMock, logWaterIntakeMock } = vi.hoisted(() => ({
	getHydrationWidgetDataMock: vi.fn(),
	logWaterIntakeMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

vi.mock("sonner", () => ({
	toast: { error: vi.fn() },
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ organizationId: "org-1" }),
}));

vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({
		attributes: {},
		listeners: {},
		setNodeRef: vi.fn(),
		transform: null,
		transition: undefined,
		isDragging: false,
	}),
}));

vi.mock("@dnd-kit/utilities", () => ({
	CSS: { Translate: { toString: () => undefined } },
}));

vi.mock("@/app/[locale]/(app)/wellness/actions", () => ({
	logWaterIntake: logWaterIntakeMock,
}));

vi.mock("./actions", () => ({
	getHydrationWidgetData: getHydrationWidgetDataMock,
}));

import { HydrationWidget } from "./hydration-widget";

function mockHydrationData(overrides = {}) {
	getHydrationWidgetDataMock.mockResolvedValue({
		success: true,
		data: {
			enabled: true,
			currentStreak: 4,
			longestStreak: 8,
			todayIntake: 3,
			dailyGoal: 8,
			goalProgress: 38,
			teamStreakLeaders: [],
			...overrides,
		},
	});
}

describe("HydrationWidget", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders team streak leaders", async () => {
		mockHydrationData({
			teamStreakLeaders: [
				{ employeeId: "emp-1", displayName: "Avery Stone", currentStreak: 9, isCurrentUser: false },
				{ employeeId: "emp-2", displayName: "Blair Kim", currentStreak: 7, isCurrentUser: true },
			],
		});

		render(<HydrationWidget />);

		const leaderboard = await screen.findByTestId("hydration-team-streak-leaders");
		expect(within(leaderboard).getByText("Team streak leaders")).toBeTruthy();
		expect(within(leaderboard).getByText("Avery Stone")).toBeTruthy();
		expect(within(leaderboard).getByText("9 days")).toBeTruthy();
		expect(within(leaderboard).getByText("Blair Kim")).toBeTruthy();
		expect(within(leaderboard).getByText("7 days")).toBeTruthy();
	});

	it("marks the current user with a You label", async () => {
		mockHydrationData({
			teamStreakLeaders: [
				{ employeeId: "emp-2", displayName: "Blair Kim", currentStreak: 7, isCurrentUser: true },
			],
		});

		render(<HydrationWidget />);

		const leaderboard = await screen.findByTestId("hydration-team-streak-leaders");
		expect(within(leaderboard).getByText("You")).toBeTruthy();
	});

	it("does not render the leaderboard section when there are no leaders", async () => {
		mockHydrationData({ teamStreakLeaders: [] });

		render(<HydrationWidget />);

		await waitFor(() => expect(getHydrationWidgetDataMock).toHaveBeenCalledTimes(1));
		expect(screen.queryByTestId("hydration-team-streak-leaders")).toBeNull();
	});
});
```

- [ ] **Step 2: Run widget tests to verify they fail**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-widget.test.tsx`

Expected: FAIL because the leaderboard section is not rendered yet.

- [ ] **Step 3: Extend the widget data type**

In `apps/webapp/src/components/dashboard/hydration-widget.tsx`, change the `HydrationWidgetData` type to include `teamStreakLeaders`:

```ts
type HydrationWidgetData = {
	enabled: boolean;
	currentStreak: number;
	longestStreak: number;
	todayIntake: number;
	dailyGoal: number;
	goalProgress: number;
	teamStreakLeaders: Array<{
		employeeId: string;
		displayName: string;
		currentStreak: number;
		isCurrentUser: boolean;
	}>;
};
```

- [ ] **Step 4: Add a streak formatter helper inside the widget file**

Below `AddButton`, add:

```tsx
function formatStreakDays(streak: number) {
	return streak === 1 ? "1 day" : `${streak} days`;
}
```

- [ ] **Step 5: Render the leaderboard section**

In the JSX, replace the content wrapper at line 215 from:

```tsx
<div ref={widgetRef} className="flex items-center gap-4">
```

To:

```tsx
<div ref={widgetRef} className="flex flex-col gap-4">
	<div className="flex items-center gap-4">
```

Then close that new inner row after the existing right-side controls, immediately before the closing `</div>` that currently ends the widget content. After the new inner row, add:

```tsx
{stats.teamStreakLeaders.length > 0 ? (
	<div
		className="border-t border-border/60 pt-3"
		data-testid="hydration-team-streak-leaders"
	>
		<div className="mb-2 text-xs font-medium text-muted-foreground">
			{t("dashboard.hydration.team-leaders", "Team streak leaders")}
		</div>
		<div className="space-y-1.5">
			{stats.teamStreakLeaders.map((leader, index) => (
				<div
					key={leader.employeeId}
					className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-2 py-1.5 text-sm"
				>
					<div className="flex min-w-0 items-center gap-2">
						<span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-[11px] font-semibold text-blue-600 dark:text-blue-300">
							{index + 1}
						</span>
						<span className="truncate font-medium">{leader.displayName}</span>
						{leader.isCurrentUser ? (
							<span className="rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 dark:text-orange-300">
								{t("dashboard.hydration.you", "You")}
							</span>
						) : null}
					</div>
					<span className="shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
						{formatStreakDays(leader.currentStreak)}
					</span>
				</div>
			))}
		</div>
	</div>
) : null}
```

The final structure inside `{stats && (...)}` should be one outer column wrapper containing the existing horizontal progress controls and then the optional leaderboard section.

- [ ] **Step 6: Run widget tests to verify they pass**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-widget.test.tsx`

Expected: PASS.

- [ ] **Step 7: Run the full relevant test set**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts apps/webapp/src/components/dashboard/hydration-widget.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit widget rendering and tests**

Run:

```bash
git add apps/webapp/src/components/dashboard/hydration-widget.tsx apps/webapp/src/components/dashboard/hydration-widget.test.tsx
git commit -m "feat: show hydration team streak leaders"
```

Expected: Commit succeeds with only the widget and widget test files staged.

---

### Task 5: Final Verification

**Files:**
- Verify: `apps/webapp/src/components/dashboard/actions.ts`
- Verify: `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.ts`
- Verify: `apps/webapp/src/components/dashboard/hydration-widget.tsx`
- Verify: `apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts`
- Verify: `apps/webapp/src/components/dashboard/hydration-widget.test.tsx`
- Verify: `apps/webapp/src/lib/cache/tags.ts`
- Verify: `apps/webapp/src/app/[locale]/(app)/wellness/actions.ts`

- [ ] **Step 1: Run focused tests**

Run: `pnpm vitest run apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts apps/webapp/src/components/dashboard/hydration-widget.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run broader tests if practical**

Run: `pnpm test`

Expected: PASS. If unrelated existing failures appear, capture the failing test names and error summaries without changing unrelated files.

- [ ] **Step 3: Inspect working tree**

Run: `git status --short`

Expected: Only intentional files are modified or untracked. Existing unrelated untracked docs may still be present from before this work; do not stage or delete them.

- [ ] **Step 4: Inspect final diff**

Run: `git diff -- apps/webapp/src/components/dashboard/actions.ts apps/webapp/src/components/dashboard/hydration-team-streak-leaders.ts apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts apps/webapp/src/components/dashboard/hydration-widget.tsx apps/webapp/src/components/dashboard/hydration-widget.test.tsx`

Expected: Diff matches the approved spec: existing widget enhanced, team scope is organization-filtered, the leaderboard query is cached with organization/current-employee/team scoped keys, hydration streak cache tags are invalidated after water logging, employees are deduped by employee id, top 3 are sorted by current streak, and teammate private hydration details are not returned.

- [ ] **Step 5: Commit any final fixes**

If verification required fixes, run:

```bash
git add apps/webapp/src/components/dashboard/actions.ts apps/webapp/src/components/dashboard/hydration-team-streak-leaders.ts apps/webapp/src/components/dashboard/hydration-team-streak-leaders.test.ts apps/webapp/src/components/dashboard/hydration-widget.tsx apps/webapp/src/components/dashboard/hydration-widget.test.tsx
git commit -m "fix: verify hydration team streak leaders"
```

Expected: Commit succeeds only if there were final verification fixes. If no fixes were needed, skip this commit.

---

## Self-Review

- Spec coverage: the plan adds `teamStreakLeaders`, scopes by active organization, caches the leaderboard query with organization/current-employee/team scoped keys, invalidates the hydration streak tag after water logging, combines primary and multi-team membership, dedupes by employee id, includes the current user in rankings, renders inside the existing widget, omits the section when empty, protects privacy by returning only minimal fields, and tests ranking plus UI behavior.
- Placeholder scan: passed; the plan contains concrete tests, implementation snippets, commands, and expected outcomes.
- Type consistency: `TeamStreakLeader`, `TeamStreakLeaderCandidate`, `teamStreakLeaders`, `employeeId`, `displayName`, `currentStreak`, and `isCurrentUser` are used consistently across helper, action, widget, and tests.
