# Approval Sprint Mode Design

## Goal

Improve manager and admin approval speed by enhancing the existing unified approvals inbox with a focused sprint review flow and smart bulk groups. The feature should help managers clear repetitive approval backlogs faster while keeping risk signals visible before decisions are made.

## Scope

This design covers additions to the existing `/approvals/inbox` experience in the webapp:

- Approval Sprint Mode for one-item-at-a-time review.
- Smart Bulk Groups, displayed as fast lanes above the inbox table.
- Lightweight triage metadata for risk labels and grouping.
- Tests for triage logic, sprint behavior, and fast-lane rendering.

This design does not create a second approvals system, a new persistence model for approvals, or a full notification/digest workflow.

## User Experience

The default approvals inbox remains a table-based overview. Managers can continue filtering, selecting, bulk approving, bulk rejecting, and opening the existing detail panel.

A new **Start approval sprint** action opens a focused sprint review flow. The sprint shows one approval at a time with the minimum information needed to decide quickly:

- Employee/requester.
- Approval type.
- Date or date range.
- Request reason or summary.
- Key details or diff supplied by the unified approval item.
- Triage label such as `No conflicts`, `Needs review`, `Payroll impact`, or `Policy exception`.

Managers can approve, reject, skip, open details, or move to the next item. After an approve or reject action completes, the sprint automatically advances to the next pending item. Skipping only changes local sprint position; it must not mutate the approval request.

Keyboard shortcuts should support rapid processing:

- `A`: approve.
- `R`: reject.
- `S`: skip.
- `N`: next.

Reject actions still require a reason, matching the existing bulk reject safety model.

## Smart Bulk Groups

Add a compact **Fast lanes** section above the existing inbox table. Fast lanes group approvals that are repetitive, urgent, or likely safe to process together.

Initial groups:

- **Low-risk absences**: absence requests without obvious conflict or warning metadata.
- **Small time corrections**: time corrections below a small threshold, initially 15 minutes where the underlying approval details expose a comparable delta.
- **Stale pending requests**: requests older than a few days, initially 3 days.
- **Payroll-period blockers**: requests marked as payroll relevant by triage metadata.

Each group shows:

- Count.
- Risk label.
- Affected date range when available.
- Primary bulk action.
- Expandable item list for inspection.

Bulk approve can act on the group. Bulk reject requires a shared reason before submitting. The existing bulk decision APIs should remain the decision path so permissions, auditing, and partial-failure behavior stay consistent.

## Architecture

Build this as a thin enhancement over the current unified approvals inbox.

Extend the approval inbox view model with triage metadata:

- `riskLevel`: `low`, `medium`, or `high`.
- `riskReasons`: short machine-readable reason codes.
- `fastLaneGroup`: optional group key.
- `isPayrollRelevant`: boolean.
- `ageDays`: integer derived from creation time.

Add pure triage helpers under `apps/webapp/src/lib/approvals` so risk labels and group selection can be tested without rendering UI. These helpers should accept existing `UnifiedApprovalItem` data and return normalized triage metadata. If required details are missing for a group, the helper should avoid marking the item as low risk rather than guessing.

Add UI components inside the existing approvals inbox route area:

- `approval-fast-lanes.tsx` renders grouped fast lanes and calls existing bulk approve/reject mutations.
- `approval-sprint-panel.tsx` owns sprint state, current index, skip behavior, and keyboard handling.
- `approval-sprint-card.tsx` renders the current item and action controls.

Keep the existing inbox table, filters, detail panel, pagination, and bulk decision flows. The sprint and fast-lane components consume the already-loaded inbox items for the first version. If large queues later need server-side sprint pagination, that can be added separately.

## Data Flow

1. The inbox query loads pending unified approval items using the existing hook and API route.
2. Triage helpers derive risk and grouping metadata from each item.
3. Fast lanes group the visible pending items by fast-lane key.
4. Sprint mode iterates through the same visible pending items, ordered by risk and age.
5. Approve/reject actions call the current single or bulk approval mutations.
6. Successful decisions refetch the inbox and clear or advance local sprint state.
7. Failed decisions surface the existing toast/error behavior and keep the item available for retry.

## Error Handling

Approval decisions should keep current API failure behavior. Partial bulk failures should continue showing per-item feedback. Sprint mode should not advance on failed approve or reject unless the API reports the item was already resolved; stale states should trigger a refetch.

Triage metadata is advisory. If metadata cannot be derived safely, the item should default to `medium` risk and no low-risk fast lane. No approval action should rely only on client-side risk labels for authorization or validation.

## Permissions And Multi-Tenancy

All reads and decisions must remain organization-scoped through the existing approvals API and service layer. The UI must not introduce direct database access or bypass CASL/approver checks. Fast-lane bulk actions must submit only approval IDs returned by the current organization-scoped inbox response.

## Testing

Add focused tests for:

- Triage helper risk and group assignment.
- Missing details defaulting to non-low-risk behavior.
- Fast lanes rendering counts and expandable items.
- Fast-lane bulk approve/reject using existing mutations.
- Sprint approve/reject advancing after success.
- Sprint skip not mutating approval state.
- Keyboard shortcut behavior where practical in component tests.

Existing approval inbox tests should continue to pass.

## Open Decisions

The initial implementation should use fixed thresholds: 15 minutes for small time corrections and 3 days for stale requests. These can become organization settings later if product feedback shows teams need customization.

Telemetry is intentionally out of scope for the first version. The component boundaries should make it easy to add interaction tracking later.
