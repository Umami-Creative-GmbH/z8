# My Requests Scanability Improvement Design

## Summary

Improve the existing employee-facing `My Requests` page so employees can understand request status faster on desktop and mobile. The enhancement keeps the current data model, source adapters, route, and actions, but changes the main presentation from a single table-oriented list into prioritized request sections with compact, responsive request cards.

## Context

The current `My Requests` implementation already consolidates time corrections, absences, and travel expenses. It includes summary cards, filters, a `Needs attention` block for rejected requests, and an all-requests table.

The main scanability issue is that the page asks employees to parse a broad table after the summary area. On mobile this creates more horizontal and vertical scanning than necessary, and on desktop the most useful mental model is still status-based: what needs attention, what is waiting, and what was recently decided.

## Goals

- Make request status easier to scan without changing request sources or workflow behavior.
- Prioritize status groups over a single all-items table.
- Improve mobile readability by using card-style rows instead of relying on a wide table.
- Preserve the existing filters, summary counts, cancellation behavior, source error notices, and empty states.
- Keep all data organization-scoped and employee-scoped through the existing query path.

## Non-Goals

- No new persisted state.
- No new request source types.
- No system-detected issue discovery.
- No new approval, resubmission, or edit workflow.
- No changes to authorization rules or source-domain mutation logic.
- No replacement of the manager-facing approval inbox.

## Approved Direction

Use grouped request sections as the primary page structure:

- `Needs attention`: rejected requests, including decision reason and a primary Fix/View action.
- `In review`: pending requests, including submitted date and Cancel where the existing source action supports it.
- `Recently decided`: approved and rejected decisions inside the current recent-decision window.
- `All requests`: a lower-priority complete history section, shown after the priority groups and still controlled by the current filters.

This approach is selected because it improves scanability while preserving the current server-side query service and normalized item contract.

## UX Structure

The page keeps its current header and summary cards. Below the summary cards, source error notices continue to render when one adapter fails.

The main content should render status groups before the all-requests history:

1. `Needs attention` appears first when rejected filtered items exist. It should use a stronger visual treatment but stay calm and operational.
2. `In review` appears next when pending filtered items exist. It should emphasize waiting state and submitted date.
3. `Recently decided` appears when approved or rejected filtered items have a `resolvedAt` date inside the recent window used by the existing counts.
4. `All requests` remains available below the grouped sections as a complete filtered history, but it should use the same compact request-card pattern instead of the current wide table.

Filters should render directly above the grouped sections, after any source error notice. Changing filters affects all groups and the all-requests history consistently.

## Request Card Pattern

Each request card should show:

- source type label or badge
- status badge
- request title
- request subtitle
- submitted date
- decision date when available
- decision reason when available
- primary action area using the existing `RequestAction` behavior

Desktop cards can render as compact horizontal rows with metadata columns. Mobile cards should stack content vertically with actions below the request details. Actions must remain reachable without horizontal scrolling.

## Grouping Semantics

Grouping should be computed in the client from the already-loaded normalized items.

Definitions:

- `Needs attention`: `status === "rejected"`.
- `In review`: `status === "pending"`.
- `Recently decided`: `status` is `approved` or `rejected`, `resolvedAt` is not null, and `resolvedAt` is within the same 30-day recent-decision window used by the service summary count.
- `All requests`: all currently filtered items.

Rejected items can appear in both `Needs attention` and `Recently decided` when they were decided recently. This is acceptable because the two sections answer different questions: what needs action and what changed recently. The all-requests section is explicitly a complete history and may repeat items from the priority groups.

## Empty States

Empty states should remain distinct:

- No loaded requests: show the existing `No requests yet` state.
- Filters hide all requests: show the existing filtered-empty state.
- A specific group is empty: omit that group instead of showing multiple empty cards.

If filters produce matching items but none fall into priority groups, the page should still show `All requests` with those filtered items.

## Error Handling

The existing partial source error alert remains unchanged. Grouped sections should render with whatever items were successfully loaded.

Cancellation errors continue to render beside the action that failed. A cancellation success should keep using the existing server action revalidation behavior.

Unsupported actions must not render as enabled buttons.

## Accessibility And Responsive Requirements

- Each group should be a named `section` with a visible heading.
- Request cards should preserve semantic button and link behavior.
- Status and source labels must be text, not color-only indicators.
- Keyboard users should be able to move through filters, cards, and actions in a predictable order.
- Mobile layout must avoid horizontal scrolling for request content and actions.

## Testing

Tests should cover:

- rejected, pending, and recently decided items rendering in their correct groups
- filters applying consistently to all groups and all-requests history
- the no-requests and filtered-empty states remaining distinct
- request cards showing submitted date, decision date, reason, source label, status, and action
- cancel action behavior still working for pending absence requests only
- source error notices still rendering when adapter errors are present
- mobile-friendly card structure using accessible roles and labels rather than table-only assumptions

## Implementation Notes

- Prefer extracting small pure helpers from `my-requests-client.tsx` for grouping and recent-decision checks if that keeps the component easier to read.
- Keep the existing `SelfServiceRequestItem` contract unchanged.
- Keep the existing `getSelfServiceRequests` query service unchanged. The client should use a local `RECENT_DECISION_DAYS = 30` constant to match the current service count behavior.
- Use Luxon for date comparisons and formatting.
