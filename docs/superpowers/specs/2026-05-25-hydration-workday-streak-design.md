# Hydration Workday Streak Design

## Goal

Hydration streaks should persist across non-workdays. Weekends, approved absences that do not require work time, and assigned holidays should not break a user's hydration streak. A missed hydration goal should only break the streak when the missed date is a required workday in the user's active organization.

## Current Behavior

Hydration streak logic is calendar-day based. `calculateStreakOnIntake` increments only when the previous goal date is yesterday, and `shouldResetStreak` resets when more than one calendar day has passed since `lastGoalMetDate`. This means a streak can be broken by weekends, absences, and holidays even when the employee was not expected to work.

## Scope

Streak eligibility is based on the user's active organization only. The implementation should resolve the active employee record for the current user and active organization, then use that employee's effective work requirements to decide whether skipped dates should count against the streak.

Hydration stats remain user-level for this change. No schema migration is required.

## Data Flow

When hydration stats are loaded or water intake is logged:

1. Read the authenticated user and active organization from the session.
2. Resolve the active employee for that user in the active organization.
3. For dates after `lastGoalMetDate` and before today, fetch daily work requirements using `getDailyWorkRequirementsForEmployee`.
4. Treat a date as streak-breaking only if it has required work minutes and the hydration goal was not met on that date.
5. Preserve the current streak across all gap dates that have no required work minutes.

The existing work requirement path already applies work policy schedules, approved absences, and assigned holidays, so hydration streaks should reuse it rather than duplicate calendar logic.

## Streak Rules

- Meeting the daily goal for the first time starts a streak at `1`.
- Meeting the daily goal today increments the streak if there are no missed required workdays since `lastGoalMetDate`.
- Meeting the daily goal today resets the streak to `1` if at least one required workday was missed since `lastGoalMetDate`.
- Loading hydration stats resets the current streak only when a required workday has been missed since `lastGoalMetDate`.
- Non-workdays between `lastGoalMetDate` and today do not reset or increment the streak.
- If no active organization or active employee can be resolved, fall back to the existing calendar-day behavior so the action remains safe and predictable.

## Error Handling

If work requirement lookup fails, the server action should fail through the existing `runServerActionSafe` path rather than silently returning incorrect streak data. If there is no active employee in the active organization, use the existing calendar-day logic as a fallback because there is no organization-scoped work calendar to evaluate.

## Tests

Add coverage for:

- A Friday goal followed by a Monday goal increments the streak when the weekend has no work requirements.
- A goal after an assigned holiday preserves and increments the streak when the holiday removed work requirements.
- A goal after an approved absence preserves and increments the streak when the absence removed work requirements.
- A missed required workday between goal dates resets the streak to `1`.
- Loading hydration stats preserves streaks across non-workday gaps and resets across missed required workdays.

## Non-Goals

- Do not move hydration stats from user-level to organization-level storage.
- Do not add hydration-specific calendar settings.
- Do not change reminder timing or daily goal configuration.
