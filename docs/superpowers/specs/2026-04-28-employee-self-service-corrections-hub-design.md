# Employee Self-Service Corrections Hub Design

## Summary

Create a new employee-facing "My Requests" page that consolidates the current employee's own time corrections, absences, travel expenses, and approval outcomes into one status hub. The hub should help employees quickly see what is pending, what needs attention, and what was recently decided without replacing the source workflows that own each request type.

## Context

- Z8 already has separate employee request surfaces for time corrections, absence requests, and travel expenses.
- Z8 also has a manager-facing unified approval inbox built around approver workflows and `approverId`.
- Employees currently have to visit source pages separately to understand pending requests, rejected items, and recent decisions.
- This feature should stay organization-scoped and employee-scoped because Z8 is a multi-tenant SaaS.

## Goals

- Add one primary navigation page for employees named "My Requests".
- Show pending employee requests across time corrections, absences, and travel expenses.
- Show required fixes for rejected requests only in the first version.
- Show recent approved and rejected decisions in one place.
- Allow lightweight actions from the hub when the source domain already supports them safely.
- Route complex fixes and resubmissions back to the owning source page.

## Non-Goals

- Do not build a new workflow engine.
- Do not introduce system-detected issue discovery in the first version.
- Do not add direct resubmission flows unless the source domain already supports them.
- Do not replace the manager-facing unified approval inbox.
- Do not aggregate requests across organizations or employees.

## Approved Direction

Build a lightweight employee self-service request hub backed by a normalized query layer and source-specific adapters. The hub reads existing domain records, maps them into one employee-facing item shape, and keeps domain mutations in the owning modules.

This is intentionally different from extending the manager approval inbox directly. The existing approval inbox is optimized for reviewers, while this feature needs requester-side status tracking.

## User Experience

The page should be added as a primary sidebar item labeled "My Requests".

The default page layout should use restrained operational UI patterns consistent with the existing app:

- summary cards for Pending, Required fixes, Recent decisions, and Total loaded
- a "Needs attention" section that lists rejected items first
- a unified request list or table below the summary area
- filters for request type and status
- search if existing list components make it low-cost

The unified list should show:

- request type
- status
- submitted date
- decision date when available
- concise request summary
- decision reason when available
- available action or source link

## Request Buckets

### Pending Requests

Pending requests are employee-owned records waiting for approval or processing. The first version should include pending time corrections, absence requests, and travel expense claims where those source domains expose pending status.

### Required Fixes

Required fixes are rejected requests only in the first version. A rejected item should explain the approver-provided reason when available and provide a "Fix" or "View" route back to the source page.

System-detected problems such as incomplete time entries, missing receipts, or validation gaps are out of scope for the first version.

### Recent Decisions

Recent decisions are approved or rejected records from the supported source domains. The first version should use a 30-day recent-decision window.

### All Requests

All requests is the filterable history view over the normalized items loaded for the current employee and active organization.

## Architecture

Add a small employee self-service request layer with a normalized item contract.

Recommended contract:

```ts
interface SelfServiceRequestItem {
  id: string;
  sourceType: "time_correction" | "absence" | "travel_expense";
  sourceId: string;
  organizationId: string;
  employeeId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  submittedAt: Date;
  resolvedAt: Date | null;
  title: string;
  subtitle: string;
  decisionReason: string | null;
  availableActions: Array<"view" | "fix" | "cancel">;
  sourceHref: string;
}
```

The final implementation may refine status values to match existing source-domain statuses, but the UI-facing contract should keep one normalized vocabulary.

## Source Adapters

Each source adapter should query only records belonging to the current employee and active organization.

### Time Corrections

Time correction items should derive from existing `approval_request` rows where:

- `organizationId` equals the active organization
- `requestedBy` equals the current employee
- `entityType` is `time_entry`

The adapter should include the referenced work period details needed for display.

### Absences

Absence items should derive from `absence_entry` rows where:

- `organizationId` equals the active organization through the employee or record scope available in the schema
- `employeeId` equals the current employee

Pending absence cancellation may be exposed from the hub only if it reuses the existing cancellation behavior.

### Travel Expenses

Travel expense items should derive from `travel_expense_claim` rows where:

- `organizationId` equals the active organization
- `employeeId` equals the current employee

Rejected travel expenses should link back to the travel expenses page for follow-up unless an existing supported edit or resubmit path is available.

## Query Service

Create a server-side query service that:

- calls all supported source adapters
- returns normalized `SelfServiceRequestItem` records
- filters by type, status, and search text
- computes summary counts
- sorts required-fix items first, then pending items, then recent decisions by date
- preserves partial data where practical if one source fails

The service must never accept an arbitrary employee ID from the client for this page. It should resolve the current employee from the authenticated session and active organization.

## Data Flow

1. The `/my-requests` page resolves the current session and active organization.
2. The page resolves the current employee for the active organization.
3. The self-service request query service loads source-domain items for that employee and organization.
4. The UI groups normalized items into summary buckets and renders the unified list.
5. Lightweight actions such as cancel call existing source-domain actions where supported.
6. Complex actions such as fix or resubmit navigate to the owning source page.

## Authorization And Multi-Tenancy

All reads and actions must be scoped by both `organizationId` and current `employeeId`.

Rules:

- employees can only see their own request items in the active organization
- the page must not expose client-provided employee selection
- source adapters must enforce organization scope in their database queries
- cancellation actions must reuse existing source-domain authorization checks
- no cross-organization request counts or history are introduced

## Error Handling

- If the whole query fails, show a clear unavailable state rather than a blank page.
- If one source adapter fails and partial rendering is practical, show the remaining items with a notice that some requests could not be loaded.
- Empty states should distinguish between "no requests yet" and "filters hide all requests".
- Unsupported actions must not render as enabled buttons.
- Rejected items without a decision reason should show a neutral fallback such as "No reason provided."

## Testing

Test coverage should include:

- normalized query service scoping by organization and employee
- mixed source result mapping and sorting
- bucket counts for pending, required fixes, recent decisions, and total
- adapter mapping for time corrections, absences, and travel expenses
- rejected items appearing as required fixes
- approved and rejected items appearing as recent decisions
- empty state and filtered-empty state rendering
- action/link availability for cancel, fix, and view
- cancellation behavior only where existing source-domain actions support it

## Open Implementation Notes

- The recent-decision window should be kept easy to tune, with 30 days as the initial value.
- The route should be the locale-aware app route equivalent of `/my-requests`.
- Labels should prefer "My Requests" over "Corrections Hub" because the page includes absences and travel expenses, not only corrections.
