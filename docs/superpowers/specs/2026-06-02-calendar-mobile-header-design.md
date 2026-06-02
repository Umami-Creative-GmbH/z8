# Calendar Mobile Header Design

## Goal

Make the custom Schedule-X calendar header usable on mobile. The current single-row layout squeezes navigation, the date range, and view tabs into one line, causing the date range to wrap into a tall vertical block.

## Scope

- Mobile layout of the custom header in `ScheduleXCalendarWrapper`.
- Mobile date range formatting for day, week, and month display.
- Existing navigation, refresh, and view mode behavior.

## Non-Goals

- No changes to Schedule-X event rendering, data fetching, time selection, filters, permissions, or calendar state semantics.
- No redesign of the desktop calendar header.
- No changes to year view, which is handled by `YearCalendarView`.

## Design

Desktop keeps the current single-row header: navigation controls, date range, and view tabs aligned horizontally.

On mobile, the header becomes two rows. The first row shows the date range full-width with `whitespace-nowrap` and truncation protection. The second row contains navigation controls and view tabs, with horizontal overflow if the available width is too small. Controls should not wrap into multiple lines.

The mobile week label should be shorter and locale-aware enough for the existing Tolgee/Luxon setup: for example, German mobile week display should read like `31. Mai - 6. Juni 2026` instead of wrapping `Mai 31 - Juni 6, 2026`. Day and month labels should also use compact mobile formats while preserving the desktop labels.

## Testing

- Add a regression test for `ScheduleXCalendarWrapper` that verifies the custom header exposes separate mobile and desktop date labels or mobile-specific responsive classes.
- Verify the targeted calendar tests still pass.
- Run Biome on touched files.
