# Collapsible Payroll Blockers

## Goal

Reduce the visual weight of the payroll blocker notice while keeping the blocker
count immediately visible and every blocker readily accessible.

## User Interface

The existing amber payroll blocker notice remains visible whenever the selected
payroll scope contains blockers. Its header becomes a full-width collapsible
trigger containing the existing warning icon and localized blocker count, plus a
chevron that communicates the current state.

The blocker rows are the collapsible content. They are hidden by default each
time the payroll workspace mounts and become visible when the user activates the
header. Activating the header again collapses the rows. The state is local to the
mounted workspace and is not persisted across visits.

The trigger exposes its expanded state through the existing design-system
`Collapsible` primitives. Keyboard activation and focus indication remain
available. The notice keeps its current light and dark theme styling and its
responsive blocker-row layout.

## Behavior

Only presentation state changes. Payroll blocker data, counts, workflow links,
false-positive dismissal, refresh behavior, authorization, and organization
scoping remain unchanged. The notice still disappears when no blockers remain.

Existing post-dismissal focus behavior remains intact: focus moves to another
available blocker control, the notice heading, or the blocker summary card as
appropriate. When focus must move to the notice heading, the blocker content
must be expanded so the focused destination and surrounding controls are
available to the user.

## Testing

- The notice header and blocker count render while blocker rows start hidden.
- The trigger reports a collapsed state initially.
- Activating the trigger expands the content and exposes blocker rows and their
  existing actions.
- Activating the trigger again collapses the content.
- Existing dismissal and focus-management tests continue to pass, with tests
  expanding the notice before interacting with blocker rows where necessary.
- A summary with no blockers renders no notice.

## Non-Goals

- Persisting the user's expanded or collapsed preference.
- Changing blocker data, actions, dismissal rules, or payroll readiness logic.
- Changing the payroll summary cards or employee table.
