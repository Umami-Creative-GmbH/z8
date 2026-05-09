# Mobile Schedule And My Requests Parity Design

## Summary

Add focused employee self-service parity to the mobile app by introducing mobile `Schedule` and `My Requests` surfaces. The first pass is read-oriented: employees can see assigned shifts, their usual work policy schedule, and consolidated request status across absences, time corrections, and travel expenses. Existing absence request creation and cancellation remain in the current `Absences` flow.

## Context

The mobile app currently has `Home`, `Absences`, and `Profile` tabs. `Absences` supports viewing absence records, requesting absence, and cancelling pending absence requests. There is no mobile schedule surface and no mobile equivalent of the web `My Requests` page.

The web `My Requests` page already consolidates normalized request items from absences, time corrections, and travel expenses through `getSelfServiceRequests`. A recent design improved that page around status-based scanability with summary counts, filters, priority sections, and compact request cards. Mobile should reuse that normalized model rather than rebuilding request-source behavior.

The web app also has data paths for published assigned shifts and effective work policy schedule details. Mobile schedule parity should use those concepts with shifts as the primary view and work policy schedule as baseline context.

## Goals

- Add a mobile `Schedule` surface that shows assigned published shifts and the employee's usual work policy schedule.
- Add a mobile `My Requests` surface that consolidates absence, time correction, and travel expense request status.
- Keep mobile request behavior safe and read-oriented for this pass, using existing absence flows for absence creation and cancellation.
- Reuse existing server-side request aggregation and schedule assignment precedence where practical.
- Preserve organization and employee scoping for every mobile API response.
- Keep mobile UI optimized for quick, card-based scanning without horizontal scrolling.

## Non-Goals

- No mobile shift request creation, pickup, swap, or approval actions.
- No new request source types.
- No new persisted mobile preferences.
- No changes to web `My Requests` behavior.
- No changes to manager approval workflows.
- No redesign of the existing absence request form.

## Approved Approach

Use focused mobile parity with shared server-side aggregation.

Add two new employee-facing mobile surfaces:

- `Schedule`: a new mobile route and tab backed by a mobile API endpoint. It returns the active organization, upcoming published shifts assigned to the current employee, and the employee's effective work policy schedule.
- `My Requests`: a new mobile route and tab backed by a mobile API endpoint. It returns the same normalized request model used by web `My Requests`, including items, counts, and partial source errors.

Keep the existing `Absences` tab intact for absence-specific workflows. New schedule and request screens link into `/(app)/absences/request` where relevant instead of adding new mutation flows.

This approach gives employees the missing mobile surfaces while avoiding mobile-only business rules and avoiding premature shift-request workflow work.

## Mobile Navigation

The mobile tab layout should include `Home`, `Schedule`, `My Requests`, `Absences`, and `Profile`. `Absences` remains a direct tab because it is the only existing mobile mutation workflow, and `My Requests` becomes a direct tab because consolidated request status is part of the parity goal.

## Schedule UX

The `Schedule` screen should prioritize fast day-by-day checking.

The screen should include:

- Header summary: `Schedule`, with the next scheduled shift or a calm `No upcoming shifts` message.
- Upcoming shifts list: ordered by date, showing date, start time, end time, published status, notes when present, and an empty state when no upcoming shifts exist.
- Usual schedule context: work policy name, assignment source, weekly or cycle hours, home-office days when available, and compact day rows for recurring work days.
- Request entry points: links or buttons for `Request absence` and `View my requests`.

Assigned shifts are primary. The work policy schedule acts as baseline context when no shift is assigned for a day or as a compact `Usual schedule` section beneath upcoming shifts.

## My Requests UX

The mobile `My Requests` screen should mirror the web scanability model using React Native cards.

The screen should include:

- Summary counts for pending requests, required fixes, recent decisions, and total loaded requests.
- Segmented status filters for all, pending, approved, rejected, and cancelled.
- Source filters for all, absence, time correction, and travel expense where practical.
- Priority sections for `Needs attention`, `In review`, and `Recently decided`.
- A complete `All requests` history section containing every filtered request.

Each request card should show:

- source label
- status label
- request title
- request subtitle
- submitted date
- resolved date when available
- decision reason when available

Actions should stay conservative. `View` routes to available mobile source areas when they exist. Absence cancellation remains in the existing `Absences` surface for this pass and should not be added to mobile `My Requests`.

## Mobile API Design

### `GET /api/mobile/schedule`

This endpoint should:

- authenticate with `requireMobileSessionContext`
- require an active organization
- resolve the current employee with `requireMobileEmployee`
- load upcoming published shifts assigned to that employee and organization
- load effective work policy schedule details using the same assignment precedence as web work policies: individual, then team, then organization
- return only data for the active organization and current employee

The response should include enough normalized data for mobile rendering, not raw database rows.

### `GET /api/mobile/my-requests`

This endpoint should:

- authenticate with `requireMobileSessionContext`
- require an active organization
- resolve the current employee with `requireMobileEmployee`
- call `getSelfServiceRequests({ employeeId, organizationId })`
- return normalized `items`, `counts`, and `sourceErrors`

The endpoint should not duplicate the request-source queries for absences, time corrections, or travel expenses.

## Client Data Flow

Mobile hooks should follow the existing `useHomeQuery` and `useAbsencesQuery` pattern:

- query keys include the active organization id
- queries are enabled only when session token and active organization are present
- API calls use `createMobileApiClient(token)`
- formatting and grouping helpers stay pure and testable

The `Schedule` hook should fetch `/api/mobile/schedule`. The `My Requests` hook should fetch `/api/mobile/my-requests`.

## Error Handling

- Missing active organization should redirect to `Profile`, matching existing mobile behavior.
- Session failures should render `MobileSessionErrorState`.
- Schedule loading failures should render the existing mobile retry state.
- Request partial source failures should show a warning while still rendering successfully loaded request items.
- Schedule empty states should distinguish `No upcoming shifts` from `No usual schedule configured`.
- Unsupported request actions should not render as enabled buttons.

## Accessibility And Mobile Requirements

- Cards and actions must avoid horizontal scrolling.
- Interactive controls use `accessibilityRole="button"` where appropriate.
- Selected filter chips expose selected state.
- Status and source labels must be text, not color-only indicators.
- Error messages use alert/live-region behavior where React Native support is already established in the mobile app.

## Testing

API tests should cover:

- active organization required
- current employee required
- organization and employee scoping for schedule data
- published-only assigned shifts
- effective schedule fallback precedence
- `my-requests` response using normalized request aggregation
- partial source errors passing through for `my-requests`

Mobile tests should cover:

- schedule header and next shift rendering
- no upcoming shifts empty state
- usual schedule rendering
- request entry points from schedule
- request summary counts
- status/source filter behavior
- `Needs attention`, `In review`, `Recently decided`, and `All requests` sections
- request card metadata including submitted date, resolved date, decision reason, source, and status

Existing absence request tests should remain unchanged unless route labels or navigation labels require small updates.

## Implementation Notes

- Prefer extracting a small shared server helper for effective schedule lookup instead of importing settings server actions directly into mobile API code if the existing action is too tied to settings permissions.
- Keep mobile response types in the relevant mobile feature hook files unless they become shared across screens.
- Use Luxon for date comparisons and formatting.
- Do not edit `src/db/auth-schema.ts`.
- All queries must stay organization-scoped and employee-scoped.
