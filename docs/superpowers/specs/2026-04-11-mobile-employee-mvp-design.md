# Mobile Employee MVP Design

**Goal:** Launch a focused employee mobile MVP for clock in/out, attendance status, and self-service absences without introducing a separate mobile-only domain model.

**Recommended approach:** Build a clock-first Expo app with three employee-facing areas: `Home`, `Absences`, and `Profile/Settings`. Keep clock in/out as the primary mobile job, use required work location at clock-in, support organization switching for multi-org users, and keep all reads and writes organization-scoped.

## Context

- `apps/mobile` currently contains only a placeholder Expo Router screen, so the MVP can establish the first real mobile interaction model.
- `apps/desktop` already implements a compact clock-in/out experience, which is a useful reference for the operational rhythm of the mobile app.
- The webapp already has organization-scoped time tracking and absence models, including `workPeriod`, `timeEntry`, and `absenceEntry`.
- Product guidance in `AGENTS.md` favors a calm, reliable, operational interface rather than a dense or playful mobile dashboard.
- The requested MVP scope is employee-only and should avoid manager workflows, approvals, and offline sync complexity.

## Scope

- Build the first real employee experience in `apps/mobile`.
- Support clock in and clock out.
- Show attendance-oriented status for today.
- Support absence request creation, viewing, and pending-request cancellation.
- Support multi-organization users through an explicit organization switcher.
- Require network connectivity for mutations in v1.

## Non-Goals

- Manager review or approval workflows.
- Team views, schedule management, or reporting.
- Offline write queueing or sync conflict handling.
- A mobile-specific time-tracking schema or separate business rules.
- Expanding the first release into a broad employee portal.

## Alternatives Considered

### 1. Clock-first native MVP

Create a small native-feeling mobile app centered on the primary employee jobs: start work, stop work, check today, and manage personal absences.

This is the recommended option because it matches the requested scope, keeps the first release focused, and avoids burying the most important action behind a dashboard-heavy shell.

### 2. Dashboard-first mobile app

Lead with a more information-dense mobile overview that combines status, summaries, absences, and shortcuts on the first screen.

This would expose more context immediately, but it weakens the primary clocking workflow and adds visual and state complexity before the app has proven its core utility.

### 3. Hybrid shell around web flows

Use the mobile app mainly as a thin container for existing web experiences, while keeping a small native wrapper for core actions.

This would reduce short-term implementation work in some areas, but it would create uneven mobile ergonomics, more navigation seams, and a less coherent product surface.

## Product Decisions

### 1. Audience

- The first mobile MVP is for employees only.
- The app should not include manager-specific actions in this phase.
- Any role-aware branching beyond employee access is out of scope for the initial release.

### 2. Core product shape

- The app should have three top-level areas:
  - `Home`
  - `Absences`
  - `Profile/Settings`
- `Home` is the primary screen and primary job-to-be-done surface.
- `Absences` is the dedicated self-service surface for personal leave actions.
- `Profile/Settings` stays intentionally small and operational.

### 3. Organization handling

- Multi-organization users are supported in v1.
- The app should expose an explicit organization switcher rather than silently locking to a single org.
- The active organization must be visible and understandable whenever data is shown or actions are taken.
- Switching organizations must reset and refetch all organization-bound employee data.

### 4. Connectivity model

- Mobile v1 does not support offline writes.
- Clock in, clock out, absence creation, and cancellation require a live connection.
- If the user loses connectivity, the app may continue to display the last successfully loaded state, but it must not pretend that new actions succeeded.

## Experience Design

### Home

`Home` should open as the operational center of the app. It should prioritize the current shift state and make starting or ending work feel immediate and dependable.

Recommended states:

- `Clocked out`
  - show the current work location context
  - require a valid work location before `Clock In` is enabled
  - make `Clock In` the dominant action
- `Working`
  - show start time, elapsed time, active location, and `Clock Out`
  - keep the presentation calm and easy to scan
- `Submitting`
  - preserve the visible submitted location and action context
  - disable editing while the request is in flight
- `Error`
  - keep the attempted action visible
  - show an inline actionable message close to the failed action

Below the primary state surface, `Home` should show a compact `Today` attendance summary. This summary should stay secondary to clocking.

Recommended summary content:

- current attendance state
- worked time so far or total for today
- latest clock event
- next upcoming approved absence when useful and available

### Work location at clock-in

- Work location is required before clock-in.
- The currently selected location must be visible before submission.
- If there is a valid remembered location, show it inline and allow editing.
- If there is no valid remembered location, show a required state and keep `Clock In` disabled until selection.
- The interaction should feel like a small correction inside the clock-in action, not a separate setup flow.

The expected first-release location model is the same constrained concept already used by the broader product, such as `office`, `home`, `field`, and `other`, rather than a free-form location workflow.

### Absences

`Absences` should be a focused self-service screen for the active employee in the active organization.

Recommended structure:

- top-level filters for `Upcoming`, `Pending`, and `Past`
- absence rows showing date range, category, and current status
- a primary `Request absence` action
- row or detail actions that allow cancellation only for pending requests

The first release should support:

- viewing the employee's own absences
- creating a new absence request
- cancelling a pending absence request

The first release should not support editing previously submitted requests. If a request is no longer wanted and is still pending, the action is cancel rather than edit.

### Absence request flow

The request flow should be a short, mobile-friendly form with the minimum needed fields:

- category
- start date
- start period
- end date
- end period
- optional notes

The flow should validate locally for obviously invalid ranges before submission, then surface any server-side policy or permission failures inline.

### Profile/Settings

`Profile/Settings` should remain thin in v1.

Recommended contents:

- active organization
- switch organization action
- sign out
- app version or lightweight diagnostics if already easy to surface

This screen should not become a catch-all menu for secondary product areas.

## Architecture

### Navigation model

- Use Expo Router as the app shell.
- Treat the app as a small authenticated employee application with stable top-level navigation.
- Keep the first release navigation shallow and predictable.
- Prefer one clear path per primary job instead of deep nested flows.

### Data boundaries

The mobile app should reuse the existing product concepts and server-side rules rather than recreating them.

Core mobile domains:

- authenticated user session
- active organization selection
- employee membership inside the active organization
- current clock status and today's summary
- the employee's own absence entries

Recommended app-side query and mutation surface:

- query: authenticated session and org memberships
- query: active organization employee context
- query: home status and today summary
- query: absences list for the active employee and active organization
- mutation: `clockIn(workLocationType)`
- mutation: `clockOut()`
- mutation: `createAbsence(input)`
- mutation: `cancelPendingAbsence(absenceId)`
- mutation: `switchOrganization(organizationId)`

### Aggregation strategy for Home

`Home` should prefer one coherent server-facing status payload over stitching together many unrelated mobile calls.

The mobile screen needs a single consistent answer for:

- whether the employee is clocked in
- what the active work session is
- what today's attendance summary is
- what organization context applies

That contract can be implemented as one aggregated endpoint or one thin composition layer, but the mobile screen should consume it as one unit to avoid fragmented loading and contradictory partial states.

## Tenant And Access Rules

- Every server-side read and write must validate the active `organizationId`.
- The authenticated user may only access their own employee-scoped records for that organization.
- Organization switching must never leak cached data from one tenant into another.
- If a user has no employee membership in the selected organization, the app should show a blocked state instead of rendering partial attendance or absence UI.
- Pending absence cancellation is allowed only for the employee's own pending requests.

## Error Handling

### Clock actions

- Show failures inline near the main action.
- Preserve the selected work location after a failed submission.
- Keep the state understandable so the user knows what was attempted.

### Absence actions

- Distinguish validation problems from server failures.
- Keep field-level problems next to the relevant fields.
- Keep request-level failures in the form context rather than in a detached toast-only flow.

### Organization switching

- If switching fails, keep the previous active organization.
- Explain the failure clearly.
- Do not leave the app in a mixed-tenant intermediate state.

### Empty and blocked states

- If there is no relevant attendance data for today, show a calm empty summary rather than a blank area.
- If the user is not mapped to an employee record in the active org, show a clear blocked state and avoid presenting actions that cannot succeed.

## Testing Strategy

Behavioral coverage for the MVP should focus on:

- authentication and organization selection for multi-org users
- `Home` state transitions for clocked out, working, submitting, and error states
- required work-location gating before clock-in
- rendering of today's attendance summary with full, partial, and empty data
- absence list filtering for `Upcoming`, `Pending`, and `Past`
- absence request submission flow
- pending absence cancellation rules
- organization switch query reset and refetch behavior
- tenant safety on all server-side attendance and absence paths

Recommended project-level verification after implementation:

- `pnpm test`
- `pnpm build`

## Risks And Mitigations

- Risk: the first screen becomes a miniature dashboard and weakens clocking speed.
  - Mitigation: keep `Home` clock-first and treat today's summary as supporting context.
- Risk: multi-organization support creates stale-cache or wrong-tenant bugs.
  - Mitigation: make active organization part of the query boundary and clear org-bound data on switch.
- Risk: absence v1 grows into edit, approval, or history-detail complexity.
  - Mitigation: keep the first release to list, request, and cancel pending requests only.
- Risk: mobile drifts from existing time-tracking and absence business rules.
  - Mitigation: reuse existing server-side models and introduce mobile-specific aggregation only where presentation requires it.

## Out Of Scope

- offline clock queueing
- manual availability statuses separate from attendance state
- manager approvals or team dashboards
- editing submitted absences
- broad settings or account-management expansion beyond what the MVP needs
