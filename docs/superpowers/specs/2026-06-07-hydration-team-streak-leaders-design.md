# Hydration Team Streak Leaders Design

## Goal

Enhance the existing dashboard hydration widget with a compact top 3 list of employees from the signed-in employee's team scope who currently have the highest hydration streaks.

The feature should encourage team visibility without creating a separate dashboard widget or exposing teammate hydration logs.

## Scope

In scope:

- Add `teamStreakLeaders` to the existing `getHydrationWidgetData` response.
- Compute team scope from the current employee's active organization.
- Include employees who share at least one team with the current employee.
- Support both legacy primary team membership through `employee.teamId` and multi-team membership through `team_membership`.
- Deduplicate employees by `employee.id` before ranking.
- Include the current user if they rank in the top 3.
- Render the leaderboard inside the existing Hydration dashboard widget.

Out of scope:

- A separate dashboard widget.
- Organization-wide hydration rankings.
- Manager-only rankings.
- Returning teammate hydration logs, daily intake, goals, snooze state, or settings.
- Schema changes.

## Data Model And Query Behavior

`getHydrationWidgetData` will continue returning the current personal hydration fields:

- `enabled`
- `currentStreak`
- `longestStreak`
- `todayIntake`
- `dailyGoal`
- `goalProgress`

It will also return:

```ts
teamStreakLeaders: Array<{
	employeeId: string;
	displayName: string;
	currentStreak: number;
	isCurrentUser: boolean;
}>;
```

The server action will:

1. Load the active session and current employee for the active organization.
2. Collect the current employee's team ids from `employee.teamId` and `team_membership` rows filtered by `organizationId`.
3. If the current employee has no team ids, return an empty `teamStreakLeaders` array.
4. Collect candidate employees in the same organization whose `employee.teamId` is one of those team ids or who have a matching `team_membership` row.
5. Deduplicate candidate employees by `employee.id` before ranking.
6. Join or look up each candidate's `hydration_stats` by user id.
7. Treat missing hydration stats as `currentStreak: 0`.
8. Sort by `currentStreak` descending, then by display name ascending for stable ties.
9. Return the first three rows.

All employee and team membership queries must filter by the active `organizationId`.

## UI Behavior

The Hydration widget will keep its existing progress ring, glass grid, and add-water buttons.

Below those controls, it will render a compact `Team streak leaders` section when `teamStreakLeaders` has at least one item.

Each row will show:

- Rank number: `1`, `2`, or `3`.
- Employee display name.
- Current streak formatted as days.
- A small `You` label when `isCurrentUser` is true.

If the user has no team scope, the section will not render. If team scope exists but all streaks are zero, the section will still show the top employees with `0 days`. If only one or two matching employees exist, it will show only those rows.

The visual treatment should stay within the existing widget style: compact typography, muted separators, and the hydration widget's existing blue/orange accents. No new card or separate dashboard widget should be added.

## Error Handling And Privacy

Leaderboard failures should not hide or break the personal hydration widget. If the leaderboard query fails while personal hydration data succeeds, return the personal hydration data with an empty `teamStreakLeaders` array.

The response must only include minimal leaderboard data:

- Employee id.
- Display name.
- Current streak.
- Whether the row is the current user.

The response must not include teammate hydration logs, daily intake, daily goals, snooze state, reminder settings, or cross-organization employee data.

## Testing

Add or update server/data tests to cover:

- An employee shared through multiple teams appears only once.
- The response is limited to the top 3 by `currentStreak`.
- The current user appears when they rank in the top 3.
- Employees from another organization are excluded.
- Missing hydration stats count as a zero streak.

Add or update widget tests to cover:

- Leaderboard rows render when `teamStreakLeaders` is present.
- The current user's row shows the `You` label.
- The leaderboard section does not render when the array is empty.

## Implementation Notes

- Use existing dashboard action and widget patterns.
- Keep the server-side dedupe logic close to `getHydrationWidgetData` unless an existing team membership helper already matches the exact scope.
- Avoid adding schema changes or new dashboard registry entries.
- Use `@tabler/icons-react` only if an icon is needed; the design does not require a new icon.
