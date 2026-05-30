# Demo Pending Approvals Design

## Context

The demo data wizard currently creates broad sample data for time entries, absences, teams, projects, locations, work categories, change policies, and shifts. Absence demo data already has a random status mix that can include pending requests, but it does not guarantee pending approval rows. Demo time entries create completed work periods but do not create pending time-correction approval requests.

Testing the notification center and approvals inbox needs deterministic pending approval data. Admins should be able to generate pending absence approvals and pending time-correction approvals on demand without relying on random status distribution.

## Goals

- Add explicit demo wizard options for pending absence approvals and pending time-correction approvals.
- Generate a small guaranteed set of pending items suitable for the approvals inbox and notification center.
- Keep all generated data scoped to the selected organization.
- Reuse existing approval table conventions: `entityType: "absence_entry"` for absence requests and `entityType: "time_entry"` with the work period id for time corrections.
- Return zero created items instead of failing the whole wizard when required source data is missing.

## Non-Goals

- Do not redesign the approvals inbox or notification center.
- Do not add tenant-specific configuration through environment variables.
- Do not change production approval workflow behavior.
- Do not require new database schema or migrations.

## User Experience

Add an `Approvals Testing` section to the demo data wizard. It contains two checkbox cards:

- `Pending absence approvals`: creates pending absence requests with approval rows.
- `Pending time correction approvals`: creates pending time-correction approval rows for completed work periods.

When selected, each option adds a generation step with a count result. The options are independent, but pending time corrections need completed work periods to exist. If no completed work periods are available, the step completes with `0` created.

## Data Flow

The wizard passes two boolean flags through `StepGenerationInput` to server actions. Each selected option runs as a dedicated step after manager assignments and after the source demo data steps it may depend on.

Pending absence approvals:

- Ensure absence categories exist for the organization.
- Select organization employees.
- Choose an approver from an employee manager relationship when available, falling back to another employee in the organization.
- Insert pending `absenceEntry` rows.
- Insert matching pending `approvalRequest` rows for `entityType: "absence_entry"`.

Pending time-correction approvals:

- Select completed organization-scoped `workPeriod` rows for the selected employees.
- Skip work periods that already have a pending time-entry approval to avoid the pending unique index conflict.
- Create inactive correction `timeEntry` rows that represent the requested change.
- Insert matching pending `approvalRequest` rows for `entityType: "time_entry"` and `entityId` equal to the work period id.
- Include metadata that points to the correction entry ids where useful for the existing approval handler.

## Error Handling

Missing prerequisites are not fatal. The generators return `{ pendingAbsenceApprovalsCreated: 0 }` or `{ pendingTimeCorrectionApprovalsCreated: 0 }` when employees, approvers, categories, or completed work periods are unavailable.

Database errors from invalid data or uniqueness conflicts should be avoided by prefiltering source records. Any unexpected database error should surface through the existing step error UI.

## Testing

- Add unit coverage for the wizard rendering the new options and labels.
- Add source-level or focused tests for server action wiring if existing patterns make direct database tests impractical.
- Verify generated approval requests are organization-scoped and use the correct `entityType`/`entityId` convention.
- Run the targeted demo wizard tests after implementation.
