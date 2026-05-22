# Calendar Week Requirement Header Design

## Purpose

Fix the `/calendar` week-view daily work requirement summary so required hours and over/undertime align with the correct day and feel like part of the calendar header rather than a detached extra row.

## Current Context

`ScheduleXCalendarWrapper` renders `DailyRequirementStrip` above the Schedule-X calendar. The strip uses seven equal columns across the full calendar width, but the Schedule-X week grid has a left time-axis gutter before the day columns. Because the strip does not account for that gutter, the requirement cells are shifted and do not line up with the actual days.

## UI Design

Remove the standalone requirement strip from above the calendar for day and week views. Instead, render each day's requirement summary inside the existing Schedule-X day header cell so Schedule-X remains the source of truth for day-column alignment.

Each day header should keep the existing weekday/date presentation and add a compact, non-clickable requirement summary below it when policy data exists for that date:

- Required time, for example `8:00h`.
- Delta only when useful, for example `+1:33h` or `-2:02h`.
- Muted treatment for missing recorded time.
- Green accent for met or over requirement.
- Red accent for under requirement.

The visual style should be restrained: small tabular numbers, clear contrast in light and dark themes, and a thin accent or subtle pill rather than a large colored block. Dates without requirements should not render an empty placeholder that adds visual noise.

## Implementation Shape

Reuse the existing `DailyWorkHoursSummaries` data and formatting helpers. Replace the separate grid-based strip with header-cell augmentation that runs after Schedule-X renders or through the closest supported header customization point available in the current Schedule-X API.

If direct header rendering is not available, a minimal DOM augmentation scoped to `.schedule-x-container` is acceptable, provided it is idempotent, cleans up stale injected content, and uses date keys from the visible `DateTime` values rather than inferred column positions.

## Testing

Update component-level tests around the requirement summary formatting and status labeling. Add or adjust a regression test to ensure the standalone strip is not rendered as a separate full-width row in day/week views.

Manual verification should cover week view alignment, day view rendering, light and dark theme readability, and dates with no requirement data.

## Out Of Scope

This change does not alter requirement calculation, policy logic, calendar event rendering, month/year summaries, or overtime approval behavior.
