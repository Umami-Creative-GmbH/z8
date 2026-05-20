# Absence Cancel Refresh Tooltip Design

## Goal

After a user cancels an absence, refresh the absence calendar/table data and show a translated tooltip on the cancel absence button.

## Scope

In scope:

- Reload personal absence year data after successful cancellation.
- Keep the existing `router.refresh()` behavior.
- Add a tooltip to the cancel absence button using existing tooltip components.
- Use `t()` for tooltip text.
- Add focused tests for refresh callback and tooltip text.

Out of scope:

- Changing cancellation permissions.
- Changing manager notifications.
- Adding tenant-level tooltip/custom copy settings.

## Approach

Use the existing `AbsenceEntriesTable` `onUpdate` callback. On successful cancellation, call `router.refresh()` and then call `onUpdate`; the parent `AbsencesViewContainer` already reloads calendar-year data through `getAbsenceCalendarYearData`.

Wrap the cancel button with `Tooltip`, `TooltipTrigger`, and `TooltipContent`. The tooltip text should use `t("absences.table.cancelAbsenceTooltip", "Cancel absence")`. Keep the button `aria-label` translated as well.

## Testing

- Update `absence-entries-table.test.tsx` to confirm successful cancellation calls `onUpdate`.
- Add a tooltip text assertion using the translated fallback.
- Run the absence entries table test and the absences view container test.
