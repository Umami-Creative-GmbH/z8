# Smart Absence Planner Design

## Goal

Help employees evaluate an absence request before submitting it by showing vacation balance impact, assigned public holidays, published schedule conflicts, coverage risk, and an explainable approval signal inside the existing absence request flow.

## Scope

- Add an advisory planning preview to the existing `RequestAbsenceDialog`.
- Keep the absence request dialog as the only v1 entry point; do not add a separate planner page.
- Base v1 coverage checks on published shifts and configured coverage rules only.
- Keep existing hard validation for invalid date periods and insufficient vacation balance.
- Do not block submission for coverage warnings or approval-risk warnings.
- Do not persist planner results; the submit action remains authoritative.

## Architecture

Smart Absence Planner is a server-backed preview inside `RequestAbsenceDialog`. When the employee selects a category, start date, end date, and half-day periods, the client calls a new planner server action scoped to the current employee and active organization.

The server returns an `AbsencePlanPreview` object with derived planning information:

- Requested business days and balance after request.
- Assigned public holidays inside the selected range.
- Existing employee absence overlaps.
- Published shifts assigned to the employee inside the selected range.
- Coverage risk summaries based on affected published shifts and `coverageRule` records.
- Approval signal: `likely`, `needs_review`, or `risky`.
- Plain-language reasons and advisory warnings.

The planner does not create absence entries, approval workflows, calendar sync jobs, or canonical absence records.

## Components

Add an `AbsencePlanPreviewPanel` used by `RequestAbsenceDialog`. The panel appears only after the form has enough valid input to request a preview.

The panel has four sections:

- `Balance`: days requested, remaining balance after request, and whether the category counts against vacation.
- `Holidays`: assigned holidays that fall within the selected range.
- `Coverage`: affected published shifts and minimum-staffing risk by day and subarea.
- `Approval`: one status badge plus explainable reasons.

The panel supports loading, unavailable, and error states. If the preview cannot load, it shows a compact non-blocking message and leaves the request form usable.

## Data Flow

The client builds preview input from the same form values used for submission:

- `categoryId`
- `startDate`
- `startPeriod`
- `endDate`
- `endPeriod`

The server action resolves the current employee from the active organization, then gathers only organization-scoped data:

- Absence category by `categoryId` and `organizationId`.
- Vacation balance for the employee and selected year.
- Employee-scoped assigned holidays for the selected date range.
- Existing absence entries for overlap context.
- Published shifts assigned to the employee in the selected date range.
- Coverage rules and published shifts for affected subareas and days.

The planner derives the response in memory. Dates remain logical calendar dates. New date logic should follow existing absence date utilities and Luxon conventions.

Coverage risk is day/subarea based in v1. If removing the employee's published shift would drop published assigned staff below the configured minimum for that subarea/day/time window, the preview reports a warning. Draft shifts are ignored.

## Approval Signal Rules

The approval signal is rules-based and explainable, not predictive of manager behavior.

- `likely`: no blocking balance issue, no coverage risk, and the request either does not require approval or follows the normal approval path.
- `needs_review`: balance is unavailable, coverage rules are missing for affected scheduled work, or the request has unusual context that should be inspected.
- `risky`: vacation balance would be insufficient, coverage would drop below a configured minimum, or the selected dates conflict with the employee's existing approved or pending absences.

Every signal includes reasons so employees understand what influenced the result.

## Error Handling

Planner failures must not block absence submission. Existing submit-time server validation remains authoritative.

Specific handling:

- Missing vacation allowance: show balance as unavailable and mark approval as `needs_review`.
- No manager for an approval-required category: reflect current behavior as likely auto-approval, with a reason explaining that no manager is assigned.
- Missing coverage rules: show "No coverage rules configured" rather than inventing risk.
- Draft or unpublished schedule data: ignore it in v1.
- Cross-organization data: never include it.

## Security And Multi-Tenancy

All planner queries must be scoped by the current employee's active organization. The server action must resolve the employee from the authenticated session and active organization, rather than accepting `employeeId` or `organizationId` from the client.

The preview must not expose other employees' personal absence details. Coverage output should summarize staffing risk by day/subarea and only identify the requesting employee's own affected shifts.

## Testing

Add focused tests for server-side planner derivation:

- Balance impact for vacation-counting and non-vacation categories.
- Holiday inclusion inside the selected range.
- Existing absence overlap detection.
- Approval signal outcomes for `likely`, `needs_review`, and `risky`.
- Coverage risk when published staffing would fall below a configured minimum.
- No coverage risk when no rules exist or staffing remains sufficient.
- Organization scoping for shifts, absences, holidays, coverage rules, and categories.

Add or update dialog tests for user-facing behavior:

- Panel stays hidden until required fields are selected.
- Loading and error states are non-blocking.
- Risk advisory warnings do not prevent submit.
- Existing hard validation still blocks invalid periods and insufficient vacation balance.

Run targeted Vitest tests for the planner and dialog code. Broader webapp checks can follow if they do not require unavailable environment variables.
