# Hydration Streak Leaderboards Design

## Goal

Expand the dashboard hydration widget so it shows competitive hydration streaks at both team and organization levels without showing a team leaderboard when the current user is the only active employee in their relevant team set.

## Scope

- Keep the existing hydration widget layout and row styling.
- Increase team streak leaderboard size from 3 to 5.
- Add an organization-wide streak leaderboard below the team streak leaderboard.
- Hide team streaks when the user has no active teammate in their primary team or team memberships.
- Keep all queries scoped to the active organization.

## Data Flow

`getHydrationWidgetData` will return two leaderboard arrays:

- `teamStreakLeaders`: top 5 active employees from the current employee's primary team and team memberships, only when at least two active employees participate in that team set.
- `organizationStreakLeaders`: top 5 active employees from the active organization.

Both leaderboards reuse the existing `TeamStreakLeader` row shape: `employeeId`, `displayName`, `currentStreak`, and `isCurrentUser`.

## UI

The widget will render the existing team leaderboard block when `teamStreakLeaders.length > 0`. It will render a second leaderboard block below it titled “Org streaks” when `organizationStreakLeaders.length > 0`.

Both blocks will use the existing ranking row presentation, localized day labels, and current-user “You” badge.

## Error Handling

Leaderboard loading remains non-critical. If either leaderboard query fails, the widget still renders personal hydration stats and returns an empty list for that leaderboard.

## Testing

Tests will cover:

- Team leaderboard still renders rows.
- Team leaderboard supports up to 5 rows.
- Team leaderboard is hidden for solo-team data.
- Organization leaderboard renders below team streaks.
- Organization leaderboard supports up to 5 rows.
