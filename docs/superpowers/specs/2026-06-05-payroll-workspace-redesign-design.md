Payroll Workspace Redesign Design
=================================

## Context

The `/payroll` workspace currently lets payroll users review employee totals, blockers, filters, and exports for a selected period. The month and week modes reset to the current period but do not let users move backward or forward between periods. The selected period is also repeated in multiple places, and the layout gives similar visual treatment to controls, filters, blockers, details, and export actions without a clear operational hierarchy.

The redesign keeps the workflow balanced: period navigation, readiness, employee totals, and exports should all remain easy to access without making the page export-first or blocker-first.

## Goals

- Add previous, next, and current-period navigation for month and week views.
- Remove duplicate selected-period information.
- Improve the hierarchy and scanability of the payroll workspace.
- Keep the UI restrained, precise, and operationally trustworthy.
- Preserve existing payroll scope filtering and export behavior.
- Keep period calculations in Luxon, not native `Date`.

## Non-Goals

- No server-side data model changes.
- No changes to payroll access permissions or organization scoping.
- No changes to payroll export formats or generated files.
- No new persisted user preferences for payroll view mode or filters.

## Proposed Layout

The page uses a single top `Payroll controls` card as the primary workspace control surface.

The page header shows `Payroll` with a concise subtitle such as `Review payroll totals, readiness, and exports for the selected period.` The header does not repeat the selected period.

The controls card contains:

- Current period label, for example `June 2026`.
- Previous and next buttons for month and week modes.
- A current-period button for returning to the current month or week.
- Mode buttons for `Month`, `Week`, and `Custom`.
- Custom start/end date fields and `Apply` when custom mode is active.
- A compact scope summary such as `2 employees in scope`.
- Inline feedback when the selected filters match no employees.
- Export format selection and export actions, aligned to the right on desktop and stacked on mobile.

Below the controls card, the page shows operational summary cards:

- `Employees`: total employees in the current summary.
- `Worked hours`: total worked hours.
- `Ready`: employees without blockers, derived from the summary employee rows.
- `Blockers`: blocker count, using the warning tone when non-zero.

The `Selected period` summary card is removed because the current period is already prominent in the controls card.

The `Payroll scope` card follows the summary cards. It contains the existing employee and team filters in cleaner columns and frames them as a way to narrow the current workspace. If the filters produce no matching employees, the card shows inline destructive feedback and export/refresh actions remain blocked.

The blockers panel appears only when blockers exist. It uses the existing warning visual language but presents the information as a concise readiness warning rather than a visually dominant duplicate section.

The `Employee totals` table remains the main detail surface. Status and contract badges carry most of the meaning. Full-row coloring should be avoided except for subtle emphasis where it improves blocker visibility.

## Period Navigation Behavior

Month mode:

- Previous moves to the previous calendar month based on the currently selected period start.
- Next moves to the next calendar month based on the currently selected period start.
- Current period moves to the current UTC month.
- The label uses the existing month format, for example `June 2026`.

Week mode:

- Previous moves to the previous ISO week based on the currently selected period start.
- Next moves to the next ISO week based on the currently selected period start.
- Current period moves to the current UTC week.
- The label uses the existing week range format, for example `Jun 1 - Jun 7, 2026`.

Custom mode:

- Previous and next period navigation is disabled or hidden.
- Users adjust the date inputs and click `Apply`.
- The label uses the existing custom range format.

All period calculations use Luxon `DateTime`. The client continues to pass ISO dates to the existing server actions.

## States And Error Handling

- Pending refresh/export disables relevant controls and uses the existing spinner treatment.
- If filters match no employees, the UI shows inline feedback and blocks refresh/export with the existing toast behavior.
- If no export formats are configured, the export target select and export trigger remain disabled with explanatory helper text.
- Failed server actions keep the current summary visible and show the existing toast error.

## Accessibility And Responsive Behavior

- Previous, next, and current-period controls have accessible labels.
- Date mode buttons retain clear selected state.
- The controls card stacks on mobile in this order: period title, period navigation, mode switch, custom date fields, scope status, export controls.
- Table and form controls keep their existing keyboard behavior.

## Testing

Update `payroll-workspace.test.tsx` to cover:

- Rendering the redesigned controls and summary cards.
- Removing the duplicate `Selected period` summary card.
- Moving to the previous month.
- Moving to the next month.
- Moving to the previous week.
- Moving to the next week.
- Returning to the current period for month or week mode.
- Existing employee and team filter behavior.
- Existing export behavior and disabled states when formats or filter matches are missing.

## Implementation Notes

- Keep the changes focused in `apps/webapp/src/components/payroll/payroll-workspace.tsx` and its test file unless implementation exposes a narrow need for a small helper.
- Prefer small local helper functions for period math, such as creating a period request from a `DateTime` and mode.
- Preserve the existing server action contracts.
- Do not change generated auth schema or database migrations.
