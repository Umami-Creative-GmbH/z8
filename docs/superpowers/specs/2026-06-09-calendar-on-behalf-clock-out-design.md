# Calendar On-Behalf Clock-Out Design

## Goal

Allow authorized supervisors to clock out employees directly from the employee calendar when a running work period is visible. Owners and admins can clock out any employee in the active organization. Managers can clock out only employees assigned to them. The clock-out happens at the current server time; later timestamp adjustments use the existing edit or correction flow.

## Scope

- Add a stop action to running work period blocks in the calendar day and week views.
- Do not add stop controls to month or year views.
- Do not change the existing self-service header clock-in or clock-out flow.
- Do not add a custom timestamp picker for this action.
- Keep month and year summaries based on completed periods only.
- Keep all reads and writes scoped by `organizationId`.

## Chosen Approach

Use a dedicated on-behalf clock-out API route rather than extending the existing `/api/time-entries` self-service endpoint. This keeps target-employee authorization, timezone capture, and audit behavior separate from the current-user clocking path.

Alternatives considered:

- Extend `/api/time-entries` with `employeeId`. This is smaller, but it risks mixing current-user and target-user timezone and validation semantics.
- Reuse manual-entry or correction flows only. This avoids a new mutation, but it does not satisfy the requested stop button and leaves running periods open longer.

## Backend Design

Add `POST /api/time-entries/clock-out-on-behalf`, accepting the running `workPeriodId`. The backend is authoritative; UI visibility is only a convenience and must not be trusted.

The mutation will:

- Resolve the active organization from the authenticated session.
- Resolve the actor's active employee record in that organization.
- Load the target `workPeriod` with `organizationId`, `isActive = true`, `endTime IS NULL`, and no deletion marker.
- Join or load the target employee and user settings needed for authorization and timezone capture.
- Enforce billing mutation guards before writing.
- Authorize with existing CASL rules using a `manage TimeEntry` check against `{ organizationId, employeeId: targetEmployee.id }`.
- Use an advisory transaction lock keyed by `organizationId:targetEmployee.id` to avoid duplicate clock-outs.
- Create a `clock_out` `timeEntry` with `employeeId = targetEmployee.id`, `organizationId`, `createdBy = actor.user.id`, and `timestamp = current server time`.
- Capture timezone from the target employee's saved timezone with `timezoneSource: "manager_target_user_setting"`; never use the manager or admin browser timezone for this on-behalf action.
- Update the work period with `clockOutId`, `endTime`, `durationMinutes`, and `isActive = false`.
- Return clear errors for unauthorized access, no active/running period, race conflicts, missing target employee, and billing restrictions.

The existing self-service `/api/time-entries` behavior remains unchanged.

## Authorization

The authorization model follows existing workforce rules:

- Owners/admins can manage time entries for any employee in the active organization.
- Managers can manage time entries only for their assigned/direct-report employee IDs.
- Employees cannot use the on-behalf path for other employees.
- Cross-organization employee IDs or work period IDs are rejected even if the ID exists.

The UI should receive or derive enough information to decide whether to show the stop control, but the server re-checks authorization every time.

## Calendar Event Shape

Running `work_period` events already use `metadata.isRunning = true`. Add target identity metadata needed by the stop action:

- `metadata.employeeId`: target employee ID for authorization-aware rendering.
- `id`: the `workPeriod.id`, submitted as the mutation target.

Existing running event behavior remains the same: visible in day/week Schedule-X views, excluded from month/year views and summary calculations.

## UI Design

In the employee calendar day and week views, show a compact stop button inside each running work period block when the viewer can clock out that employee.

Behavior:

- The stop button appears only on running work periods.
- The action uses the visible running event's `workPeriodId`.
- Clicking stop opens a confirmation dialog before writing an auditable clock-out entry for another employee.
- Confirming calls `POST /api/time-entries/clock-out-on-behalf`.
- While the mutation is pending, the stop control shows a disabled/loading state to prevent duplicate submits.
- On success, calendar data refetches so the running event becomes a completed work period.
- On failure, the UI shows the server error and leaves the running event visible.

The first implementation should avoid changing the existing work period edit dialog for running periods unless needed for the stop control. Running period click behavior can remain unchanged if the stop button is rendered directly in the event block.

## Data Flow

1. `/api/calendar/events` continues returning running work periods for authorized employee calendar views.
2. Running work period events include `metadata.isRunning = true` and `metadata.employeeId`.
3. The day/week renderer places a stop control on authorized running events.
4. The user confirms the stop action.
5. The client submits the `workPeriodId` to `POST /api/time-entries/clock-out-on-behalf`.
6. The server verifies organization scope, authorization, active-period state, timezone capture, and billing access.
7. The server creates the clock-out time entry and closes the work period transactionally.
8. The client refetches calendar data.
9. Summaries continue using only completed periods.

## Error Handling

Use specific user-facing errors where possible:

- Unauthorized: the viewer is not allowed to clock out this employee.
- Not found: the work period does not exist in the active organization or is not visible to the actor.
- Already stopped: the work period is no longer running.
- Conflict: another request closed the period at the same time.
- Billing restricted: mutation is blocked by billing state.

Unexpected errors return a generic failure message and should be logged server-side.

## Testing

Backend tests:

- Owner/admin can clock out any active employee in the organization.
- Manager can clock out an assigned/direct-report employee.
- Manager cannot clock out an unassigned employee.
- Employee cannot clock out another employee through the on-behalf path.
- Cross-organization work periods are rejected.
- Non-running, deleted, or already-closed periods are rejected.
- Clock-out entries use the target employee timezone and `timezoneSource: "manager_target_user_setting"`.
- Race conditions do not create duplicate clock-out entries.

UI tests:

- Running work period blocks can render a stop action when authorized.
- Unauthorized running events do not render the stop action.
- Confirming the stop action calls the mutation with the work period ID.
- Successful clock-out refetches calendar data.
- Failed clock-out shows an error and keeps the running event visible.
- Running periods remain excluded from month/year summaries.

## Open Decisions

None. The action closes at current server time and any timestamp adjustment is handled later through existing edit/correction flows.
