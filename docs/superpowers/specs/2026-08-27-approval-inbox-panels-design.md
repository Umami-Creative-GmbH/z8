# Approval Inbox Panels Refactor

## Goal

Reduce `ApprovalInboxContent` below the React Doctor component-size threshold
without changing approval inbox behavior.

## Design

Keep query ownership, reducer state, derived selections, bulk mutations, and
event handlers in `ApprovalInboxContent`. Extract its final panel-rendering
section into an `ApprovalInboxPanels` presentational component in the same
module.

The new component receives the already-derived inbox data, panel visibility
state, pending state, and event handlers as props. It renders the page header,
requests card, detail panel, sprint panel, and bulk-reject panel exactly as the
parent does today.

## Data Flow

`ApprovalInboxContent` remains the single owner of state and side effects. It
passes values down to `ApprovalInboxPanels`; the child invokes the supplied
callbacks for user interactions. No callbacks or data flow cross module
boundaries, and no new state is introduced.

## Error Handling

Loading and error branches remain in `ApprovalInboxContent`, before the child
is rendered. Existing mutation errors and toast behavior remain in the parent
handlers.

## Verification

Run the existing approval inbox page tests, formatting/type checks for the
changed module, and React Doctor changed-scope scan. The component-size finding
must disappear with no new diagnostics introduced by the refactor.
