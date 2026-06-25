# Payroll Scope Selection Redesign Design

## Context

The `/payroll` workspace currently renders every assigned employee as an always-visible checkbox inside the `Payroll scope` card. For payroll officers who manage many employees or teams, this creates a long, cluttered control area before they can reach blockers, totals, and export actions.

The existing scope model is correct: an empty team and employee filter means the payroll workspace covers all employees and teams the user is allowed to manage. The redesign should make that default clear and move detailed selection into focused side panels.

## Goals

- Replace the always-visible employee and team checkbox lists with a compact payroll scope card.
- Add `Specific teams` and `Specific employees` controls that open side sheets for multi-select filtering.
- Make the empty-filter state read as `All employees and teams I manage`.
- Let users draft multiple checkbox changes before applying them.
- Preserve existing payroll authorization, organization scoping, summary refresh, PDF export, and payroll export behavior.

## Non-Goals

- No database schema changes.
- No changes to payroll access grants or server authorization rules.
- No changes to payroll export formats, PDF contents, or payroll summary calculation.
- No persisted payroll scope preferences.
- No broader redesign of the `/payroll` page beyond the scope card interaction.

## User Workflow

The `Payroll scope` card becomes a compact control surface. When no team or employee filters are selected, the card shows `All employees and teams I manage` to communicate that the workspace is using the full authorized payroll scope.

When filters are selected, the card shows a concise summary such as `2 teams, 4 employees selected`. If only one category is selected, the summary mentions only that category.

The card provides two outline buttons:

- `Specific teams`
- `Specific employees`

Each button opens a right-side sheet. The sheet contains the available teams or employees from the user's already-authorized payroll scope. Users can check one or more items, then choose `Apply` or `Cancel`.

Checkbox changes inside a sheet are draft-only. `Apply` commits the draft selection, refreshes the payroll summary with the narrowed scope, and closes the sheet. `Cancel`, closing the sheet, or pressing Escape discards un-applied changes.

If users apply an empty selection for both teams and employees, the workspace returns to the default full managed scope.

## Data And Authorization

This is a client UI and workflow change only.

The component keeps the existing state shape for selected filters:

- `selectedTeamNames`
- `selectedEmployeeIds`

The client continues calculating filtered employee IDs from `initialSummary.employees`, the selected teams, and the selected employees. Server actions continue receiving `employeeIds` only as a narrowing filter.

Server-side payroll actions must continue to enforce organization boundaries and payroll access scope. Requested filters must never expand the user's authorized payroll scope.

## Error Handling And Empty States

If the applied team and employee filter combination matches no employees, the card keeps the existing destructive message: `No employees match the selected payroll filters.` Refresh, PDF download, and payroll export remain blocked in that state.

If there are no assigned teams available, the team sheet shows `No assigned teams in this payroll scope.`

If there are no assigned employees available, the employee sheet shows `No assigned employees in this payroll scope.`

While payroll refresh or export is pending, scope buttons and sheet actions are disabled to avoid conflicting updates.

## Accessibility And Responsive Behavior

The sheet triggers are regular buttons with clear accessible names. Sheet titles identify whether the user is selecting teams or employees. `Apply` and `Cancel` are reachable by keyboard, and closing the sheet without applying discards the draft selection.

The right-side sheet pattern should reuse `@/components/ui/sheet`, which already supports focus management and keyboard dismissal. On narrow screens, the sheet should remain usable with scrollable content if the assigned employee list is long.

## Testing

Update `apps/webapp/src/components/payroll/payroll-workspace.test.tsx` to cover:

- Initial render shows `All employees and teams I manage` when no filters are selected.
- Initial render does not expose every employee checkbox directly in the scope card.
- `Specific employees` opens an employee selection sheet.
- `Specific teams` opens a team selection sheet.
- Checking items inside a sheet does not refresh until `Apply`.
- `Cancel` discards draft selections.
- Applying employee selections updates the compact summary and refreshes payroll data.
- Applying team selections updates the compact summary and refreshes payroll data.
- Applying an empty selection for both filters returns to the full managed scope summary.
- Existing no-match behavior still disables PDF and payroll export actions.

## Implementation Notes

Keep the implementation focused in `apps/webapp/src/components/payroll/payroll-workspace.tsx` unless tests expose a narrow need for a helper.

Reuse existing reducer actions for committed filter state. Add local draft state inside the team and employee sheets rather than changing the server action contract.

Use existing card, button, and sheet components. If a new icon is useful, use `@tabler/icons-react` only.
