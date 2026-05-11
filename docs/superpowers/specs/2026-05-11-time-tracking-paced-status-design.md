# Time Tracking Paced Status Design

## Context

The dashboard Time Tracking widget currently marks the weekly and monthly cards as "Behind" when actual tracked hours are below 75% of the full period target. This can be demotivating early in a period, such as Monday with 4 tracked hours against a 40 hour weekly target.

## Decision

Keep the displayed period targets, but base the status label and color on expected progress to date instead of the full period target.

## Behavior

- The widget continues to show full-period progress text, such as `4.0h of 40.0h`.
- Each stat receives an `expectedToDate` value for status evaluation.
- Weekly pacing uses elapsed time within the configured user week, from week start through the current time.
- Monthly pacing uses elapsed time within the current month, from month start through the current time.
- "Behind" appears only when actual tracked hours are below 75% of the expected-to-date amount.
- "On track" appears at 90% or more of the expected-to-date amount; "Good pace" appears between 75% and 90%, avoiding negative feedback before the period has logically elapsed.

## Data Flow

`getQuickStats` will return `actual`, full-period `expected`, and `expectedToDate` for `thisWeek` and `thisMonth`. The widget will calculate the visible progress ring from full-period `expected`, while calculating the status label and status color from `actual / expectedToDate`.

## Edge Cases

- If `expectedToDate` is zero or unavailable, the widget should avoid showing "Behind".
- Active work periods continue to count elapsed minutes as they do today.
- Organization scoping remains unchanged because the existing work period query already filters by employee and organization.

## Testing

Add focused tests for the status calculation so early-period partial progress is not marked behind when it matches elapsed pacing, and genuine shortfall to date still shows behind.
