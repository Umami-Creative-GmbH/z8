# Fresh Approvals Inbox Design

## Context

The current `/approvals/inbox` experience is unreliable across list loading, detail rendering, filtering, bulk actions, sprint mode, and fast lanes. The repository already contains useful approval domain work: typed handlers for absence requests, time corrections, and travel expense claims; shared decision paths; approval request persistence; manager eligibility checks; and prior unified approvals design notes.

The replacement should not preserve the broken page/query assumptions. It should introduce a stable inbox-facing contract while reusing durable domain handlers for the actual approval side effects.

## Goals

- Replace the current approvals inbox with a fresh, reliable implementation.
- Introduce a stable, serializable inbox API contract for list, counts, detail, and decisions.
- Support the current live approval sources: `absence_entry`, `time_entry`, and `travel_expense_claim`.
- Keep advanced triage in the first version: fast lanes, sprint mode, keyboard shortcuts, and visible risk explanations.
- Preserve organization scoping, current employee resolution, manager eligibility, admin org-wide visibility, and per-item decision authorization.
- Keep domain-specific approve/reject side effects in the owning approval handlers.

## Non-Goals

- No full rewrite of every approval-producing domain.
- No new approval persistence model unless implementation discovers a concrete data integrity blocker.
- No first-version shift request support unless a real backend source handler exists.
- No environment-variable configuration for tenant-specific approval behavior.
- No broad redesign of notification, dashboard, or payroll-readiness approval links beyond keeping `/approvals/inbox` working.

## Chosen Approach

Build a fresh inbox shell and fresh API contract, while reusing the existing domain approval handlers for business decisions.

This approach replaces the unstable UI/query boundary without taking on a full approval-platform rewrite. Existing handlers remain responsible for absence, time correction, and travel expense side effects such as status changes, notifications, audit records, and domain validation.

## Alternatives Considered

### 1. Fresh inbox shell and API contract

This is the chosen direction. It gives the inbox a reliable contract and avoids preserving broken client assumptions, while keeping proven domain behavior.

Trade-off: some handler cleanup may still be needed where existing read/detail methods leak inconsistent data or silently hide failures.

### 2. Full approval platform rewrite

Replace inbox, API routes, query services, handler registry, action services, and domain mutation paths together.

Trade-off: this is cleaner in theory but too large and risky for one implementation cycle.

### 3. UI-only rebuild

Replace only the React page and components while keeping the existing `/api/approvals/inbox` behavior.

Trade-off: fastest visually, but likely preserves the broken root causes: inconsistent serialization, weak error visibility, fragmented count/detail behavior, and overly stateful client logic.

## Architecture

Create a dedicated `approval-inbox` boundary under the approvals feature. The boundary should own the manager-facing inbox contract, not domain-specific business mutations.

Core units:

- `approval-inbox.service.ts`: list, counts, detail lookup, triage metadata, pagination, authorization-scoped read behavior, and decision orchestration.
- Existing approval handlers: domain-specific approve/reject side effects for `absence_entry`, `time_entry`, and `travel_expense_claim`.
- Thin API routes: authenticate, resolve active organization/current employee, call the inbox service, and map errors consistently.
- Fresh React page/components: consume the new contract directly and keep page-level state small and predictable.

The first version should advertise only approval types supported by the backend. Shift requests should not appear in filters, counts, fast lanes, or sprint mode until a real source handler exists.

## Route Contract

Keep the existing public route paths so current navigation, notifications, dashboard widgets, payroll-readiness links, and external approval URLs continue to work:

- `GET /api/approvals/inbox`: list items, counts, supported types, pagination metadata, and source warnings.
- `GET /api/approvals/inbox/counts`: lightweight pending counts for badges and widgets that do not need list rows.
- `GET /api/approvals/inbox/[id]`: detail sections for one approval request.
- `POST /api/approvals/inbox/[id]/approve`: single approval decision.
- `POST /api/approvals/inbox/[id]/reject`: single rejection decision with reason.
- `POST /api/approvals/inbox/bulk-approve`: partial-success bulk approval.
- `POST /api/approvals/inbox/bulk-reject`: partial-success bulk rejection with reason.

These route handlers should be thin adapters over the new inbox service. They should not contain source-specific query or mutation logic.

## Inbox Data Contract

The list endpoint returns plain JSON. Dates are ISO strings, not `Date` instances. The UI converts strings at display boundaries with Luxon utilities.

```ts
type ApprovalInboxItem = {
	id: string;
	type: "absence_entry" | "time_entry" | "travel_expense_claim";
	entityId: string;
	status: "pending" | "approved" | "rejected";
	requester: {
		id: string;
		name: string;
		email: string;
		image: string | null;
		teamId: string | null;
	};
	summary: {
		title: string;
		subtitle: string;
		detail: string;
		badge: { label: string; color: string | null } | null;
	};
	timing: {
		createdAt: string;
		resolvedAt: string | null;
		slaDeadline: string | null;
		ageDays: number;
	};
	triage: {
		priority: "urgent" | "high" | "normal" | "low";
		riskLevel: "low" | "medium" | "high";
		riskReasons: string[];
		fastLaneGroup: string | null;
		isPayrollRelevant: boolean;
		explanation: string;
	};
	capabilities: {
		canApprove: boolean;
		canReject: boolean;
		canBulkApprove: boolean;
		requiresRejectReason: boolean;
	};
};
```

List responses should also include pagination metadata, pending counts for the actor's current visibility scope, supported filters, and non-fatal source warnings when applicable. Counts are per supported type and should not be affected by the current type filter, so type badges remain useful while filtering.

```ts
type ApprovalInboxListResult = {
	items: ApprovalInboxItem[];
	nextCursor: string | null;
	hasMore: boolean;
	total: number;
	counts: Record<"absence_entry" | "time_entry" | "travel_expense_claim", number>;
	supportedTypes: Array<"absence_entry" | "time_entry" | "travel_expense_claim">;
	warnings: Array<{ source: string; message: string }>;
};
```

Detail should be a separate lookup by approval request ID. It returns the list item plus type-specific sections as serializable JSON. The UI should render generic sections where practical instead of importing absence, time, or travel entity internals into route components.

## Detail Contract

The detail endpoint returns:

- `item`: the same `ApprovalInboxItem` shape used by the list.
- `sections`: ordered detail sections such as request summary, policy context, time correction diff, travel expense amounts, notes, and audit timeline.
- `actions`: current capabilities and any required fields such as rejection reason.

Type-specific detail sections should be normalized into display primitives:

- key-value rows
- text blocks
- timeline events
- warning/risk callouts
- optional money/date/time rows

This keeps the detail drawer stable even when source domains have different underlying schemas.

## Query Behavior

The inbox service should query only organization-scoped approval requests visible to the current actor.

Visibility rules:

- Assigned approvers see requests where `approval_request.approverId` is their current employee ID.
- Eligible managers see requests covered by current manager eligibility scopes.
- Users with `manage Approval` can see organization-wide approvals.
- Users without approval permission receive a forbidden response before data is fetched.

Filters:

- status, defaulting to `pending`
- approval type, limited to supported live sources
- requester search by name/email and source-specific searchable fields where reliable
- team where the source entity exposes a team ID
- priority/risk where derived by the inbox service
- minimum age in days

Pagination should use a stable cursor based on sorted fields and ID. Sorting should default to highest risk/priority first, then oldest pending request first, then ID for deterministic ordering.

## Decision Behavior

Single approve/reject and bulk approve/reject should go through the inbox service. The service resolves the persisted approval request, checks organization and permission scope, resolves the source handler from the persisted type, and delegates the domain mutation.

Rules:

- Rejections always require a non-empty reason.
- The service never trusts client-provided type, entity ID, requester, or triage metadata for a decision.
- Stale approvals return `409` for single decisions or a per-item `stale` result for bulk decisions.
- Bulk decisions are partial-success. One failed item must not block valid items.
- Bulk authorization is per item, not one global check.
- Successful decisions invalidate or refetch list, counts, fast lanes, and sprint queue data.

## Triage And Fast Lanes

Triage metadata is advisory and must never authorize a decision. It exists to help managers decide faster.

The first version includes:

- Low-risk absences: absence requests without detected warning metadata.
- Small time corrections: time corrections with a safely derived small time delta.
- Stale pending requests: requests older than the review threshold, initially 3 days.
- Payroll blockers: requests marked payroll-relevant by reliable metadata.

Each item receives:

- `riskLevel`
- `riskReasons`
- `fastLaneGroup`
- `isPayrollRelevant`
- human-readable `explanation`
- `priority`
- `ageDays`

If metadata is missing or ambiguous, the item should default to medium risk and no low-risk fast lane. The implementation should avoid optimistic low-risk labeling.

## User Experience

The fresh page layout:

- Header with pending count, refresh, and selected-item actions.
- Fast lanes at the top with grouped cards for low-risk absences, small time corrections, stale requests, and payroll blockers.
- Main inbox list/table with type, requester, summary, risk, SLA, requested age, and selection.
- Detail drawer for the selected approval.
- Sprint mode panel for one-at-a-time review.

Workflow behavior:

- Fast lanes use the same bulk decision path as manual selection.
- Sprint mode operates on the loaded pending queue ordered by risk and age.
- Keyboard shortcuts are active only while sprint mode is open and no text field, dialog, or drawer has focus.
- Sprint supports approve, reject, skip, next, and open details.
- Rejection flows always collect a reason before submission.
- Bulk action feedback shows succeeded and failed counts plus per-item failed reasons.
- After a successful decision, the inbox refetches and clears stale selection.
- Risk explanations are visible in list, detail, and sprint surfaces.

## Error Handling

- Unknown approval types are excluded from first-version filters and counts.
- Persisted unknown approval types should be reported as unsupported rather than crashing the whole inbox.
- Handler failures should not be silently swallowed. If a non-critical source fails while other sources load, the response includes a warning and the UI displays it.
- Detail fetches return `404` for missing, cross-organization, or invisible records without leaking existence.
- Invalid filters return `400` with a clear message.
- Decision conflicts return `409` for single actions and `stale` per-item failures for bulk actions.
- Unexpected server errors should log diagnostic context without exposing sensitive data.

## Security And Multi-Tenancy

All reads and writes must be organization-scoped by the active organization.

Required safeguards:

- Resolve the current employee inside the active organization.
- Filter every approval request by `organizationId` before returning or mutating data.
- Verify related source entities belong to the same organization.
- Use CASL approval permissions plus manager eligibility checks.
- Authorize bulk decisions per item.
- Do not trust client-provided approval type, entity ID, requester, capabilities, or triage metadata for mutations.
- Return not-found semantics for cross-organization detail and decision attempts where appropriate.

## Testing

Add focused coverage for the new boundary and UI.

Service and contract tests:

- list payloads are serializable and use ISO strings for dates
- detail payloads are serializable and section-based
- organization scope is enforced on list, detail, and decisions
- manager eligibility and admin org-wide visibility work correctly
- unsupported types do not appear as first-version filter options
- filters, counts, pagination, and deterministic sorting work
- source warnings are returned instead of silently swallowing handler failures

Decision tests:

- single approve and reject delegate to the correct persisted source handler
- rejection reason is required
- stale pending records produce conflict results
- forbidden records fail without mutating data
- bulk decisions produce partial success with per-item failures

Component tests:

- inbox renders list, empty, loading, warning, and error states
- fast lanes render counts, explanations, and bulk controls
- sprint mode advances after successful decisions and does not mutate on skip
- keyboard shortcuts are scoped to sprint mode and ignored while typing
- detail drawer renders generic sections and action controls
- selection clears after refetch or successful decisions

Regression tests:

- first-version live approval sources are `absence_entry`, `time_entry`, and `travel_expense_claim`
- no shift request filter/count is shown without a registered source
- existing approval links to `/approvals/inbox` continue to route to the fresh page

## Rollout Notes

Implement behind the existing `/approvals/inbox` route so dashboard, notification, payroll-readiness, and external approval links continue to work.

Prefer replacing the route internals in one focused implementation rather than maintaining two inboxes. If necessary during development, the old components can be kept temporarily under separate filenames but should not remain as an alternate production path.
