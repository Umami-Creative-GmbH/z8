# Payroll Readiness Checklist Design

## Summary

Add a standalone org-admin payroll readiness page that checks whether a selected payroll period can be exported with confidence. V1 is read-only: it surfaces hard blockers and warnings, lists affected employees where useful, and deep-links to existing pages for investigation or remediation.

The page should live at `/settings/payroll-readiness` and default to the previous calendar month.

## Context

Z8 already has payroll export configuration, wage type mappings, payroll export job history, reports, canonical time records, absence records, approvals, travel expenses, compliance signals, and multiple payroll export targets. These pieces are currently spread across different settings and workflow pages.

Payroll owners need a single period-close view that answers: is this payroll period ready to export, and if not, what needs attention?

The checklist should reuse existing data and destinations rather than create a parallel remediation workflow.

## Goals

- Give org admins a clear readiness state before payroll export.
- Separate hard blockers from non-blocking warnings.
- Show affected employees for checks that require employee-level cleanup.
- Link to existing source pages instead of adding inline fix flows.
- Keep all reads organization-scoped and server-authorized.
- Avoid treating normal active work periods as blockers for global, multi-time-zone usage.

## Non-Goals

- No inline approvals, rejections, time edits, absence edits, payroll configuration edits, or export execution.
- No acknowledgement or persisted checklist state.
- No manager or employee self-service view in V1.
- No configurable severity rules in V1.
- No cross-organization or platform-admin view.
- No replacement for `/settings/payroll-export`, reports, approvals, absences, or compliance pages.

## Approved Direction

Build a standalone org-admin page at `/settings/payroll-readiness`. The page computes readiness on demand for the selected date range, defaults to the previous calendar month, and provides deep links to existing destinations.

V1 is organization-wide. Employee, team, and project filters can be added later if the payroll export workflow needs the same filtered readiness view.

## Approaches Considered

### 1. Standalone readiness page (selected)

Create `/settings/payroll-readiness` as a dedicated period-close page.

Pros:

- Provides a clear workflow separate from configuration.
- Scales well as readiness checks grow.
- Avoids making the existing payroll export page denser.
- Keeps the page read-only and low-risk.

Cons:

- Adds another settings destination.

### 2. Readiness tab inside payroll export

Add a new `Readiness` tab to `/settings/payroll-export`.

Pros:

- Keeps payroll-related workflows in one page.
- Puts the checklist close to the export action.

Cons:

- The existing payroll export page already contains many tabs and configuration forms.
- The checklist may feel secondary rather than a period-close workflow.

### 3. Pre-export validation only

Run checks inside the export form before export starts.

Pros:

- Smallest UI footprint.
- Directly protects the export action.

Cons:

- Catches issues too late.
- Does not support proactive payroll cleanup.
- Makes it harder to list and triage all issues calmly.

## Readiness Semantics

The page returns one overall state:

- `ready`: no hard blockers were found. Warnings may still exist.
- `blocked`: one or more hard blockers were found.
- `unavailable`: one or more required check groups could not be evaluated, so the page cannot safely claim readiness.

Hard blockers prevent `ready`. Warnings are visible but do not prevent `ready`.

Normal active work periods do not block readiness. In a global deployment, someone may legitimately still be clocked in when another region prepares payroll. V1 should only warn about stale active work periods that started inside the selected period and have been active beyond a long safety threshold, such as 24 hours.

## V1 Checks

### Hard Blockers

- Pending time corrections or canonical time records awaiting approval in the selected period.
- Pending absence approvals in the selected period.
- No configured payroll export target for the organization.
- Missing required wage type mappings for work or absence categories present in the selected period.
- Most recent payroll export for the same selected period failed.

### Warnings

- Stale active work periods that started in the selected period and have been active longer than the safety threshold.
- Employees with no recorded work time and no approved absence in the selected period.
- Unusually high or low hours compared with expected work hours where expected hours can be calculated.
- Pending or unapproved travel expense claims in the selected period.
- Active compliance warnings that overlap the selected period, where existing compliance data is available.

## Information Architecture

Add `/settings/payroll-readiness` to the org-admin settings area. It should appear near payroll export, scheduled exports, audit export, and export operations in settings navigation.

The page is for org admins and payroll owners. It should use the same access tier as payroll export configuration.

Deep-link destinations include:

- `/settings/payroll-export` for export configuration, wage mappings, and export history.
- `/approvals/inbox` for pending approval cleanup.
- `/time-tracking` or employee-specific time destinations where available for time issues.
- `/absences` for absence-related issues.
- `/travel-expenses` or `/travel-expenses/approvals` for travel expense warnings.
- `/compliance` for compliance warnings.

## Page Structure

The page should use the existing restrained settings and product UI style.

### Header

- Title: `Payroll Readiness`.
- Description: `Check whether a payroll period is ready before exporting time, absence, and payroll data.`
- Date range control defaulting to previous calendar month.
- Refresh or check action, depending on whether the page is server-rendered through query params or client-interactive.

### Summary

Show a compact summary section with:

- Overall readiness status: `Ready for payroll`, `Blocked`, or `Unable to verify`.
- Selected period label.
- Hard blocker count.
- Warning count.
- Affected employee count.
- Configured export target count.
- Primary link to payroll export when ready or when setup is missing.

### Checklist

Group checks by domain:

- `Time`.
- `Absences`.
- `Payroll Setup`.
- `Exports`.
- `Travel Expenses`.
- `Compliance`.

Each check card shows:

- Status.
- Severity.
- Count.
- Short explanation.
- Primary next-action link when useful.
- Compact affected employee list when relevant.

Healthy checks should remain visible but compact so users can see what was verified.

### Affected Employees

Affected employee rows should include:

- Employee name.
- Employee number when available.
- Issue count or short issue label.
- Destination link to the most relevant existing route.

## Architecture

Introduce a read-only payroll readiness module:

```text
apps/webapp/src/lib/payroll-readiness/get-payroll-readiness.ts
```

The route resolves org-admin access through `requireOrgAdminSettingsAccess()`, then calls the readiness loader with the resolved `organizationId` and selected date range. Client code must not provide an organization ID.

The loader evaluates check groups in parallel where possible and returns a normalized view model. It should not perform mutations and should not depend on UI components.

Recommended route:

```text
apps/webapp/src/app/[locale]/(app)/settings/payroll-readiness/page.tsx
```

Optional presentational components can live under:

```text
apps/webapp/src/components/settings/payroll-readiness/
```

## View Model

```ts
type PayrollReadinessStatus = "ready" | "blocked" | "unavailable";
type PayrollReadinessSeverity = "blocker" | "warning" | "info";
type PayrollReadinessCheckStatus = "pass" | "fail" | "warning" | "unavailable";

type PayrollReadinessResult = {
	status: PayrollReadinessStatus;
	period: {
		start: string;
		end: string;
		label: string;
	};
	summary: {
		blockerCount: number;
		warningCount: number;
		affectedEmployeeCount: number;
		configuredExportTargetCount: number;
	};
	checks: PayrollReadinessCheck[];
};

type PayrollReadinessCheck = {
	id: string;
	group: "time" | "absences" | "payrollSetup" | "exports" | "travelExpenses" | "compliance";
	title: string;
	status: PayrollReadinessCheckStatus;
	severity: PayrollReadinessSeverity;
	count: number;
	description: string;
	actionHref?: string;
	actionLabel?: string;
	affectedEmployees?: PayrollReadinessAffectedEmployee[];
};

type PayrollReadinessAffectedEmployee = {
	employeeId: string;
	name: string;
	employeeNumber: string | null;
	issueCount: number;
	issueLabel: string;
	href?: string;
};
```

The overall `status` is derived from checks:

- Any required check with `unavailable` makes the overall status `unavailable`.
- Otherwise, any check with severity `blocker` and status `fail` makes the overall status `blocked`.
- Otherwise, the overall status is `ready`.

## Data Sources

Use existing tables and modules where possible:

- Canonical `timeRecord` for approved and pending work or absence records.
- Existing approval data, including `approval_request`, for pending approval state where needed.
- `payrollExportConfig`, `payrollWageTypeMapping`, and payroll export configuration helpers for setup checks.
- `payrollExportJob` for the most recent export attempt that matches the selected period.
- `travelExpenseClaim` for warning-only pending or unapproved travel expense claims.
- Existing compliance command center data or compliance finding data where available.
- Existing expected-hours calculation helpers for high or low hours warnings when available.

All queries must filter by the resolved `organizationId`.

## Error Handling

The page should degrade by check group.

Rules:

- If one check group fails, return that check as `unavailable` and render the rest of the page.
- Missing configuration is a valid blocker, not a loader error.
- Empty datasets are valid passing checks unless the check specifically requires data to exist.
- Required groups that cannot be evaluated make the overall state `unavailable`. In V1, `Time`, `Absences`, `Payroll Setup`, and `Exports` are required groups.
- Warning-only groups that cannot be evaluated should show as unavailable without incorrectly blocking payroll readiness.

This avoids both false confidence and unnecessary hard failures.

## Permissions And Security

- V1 is org-admin only.
- Use `requireOrgAdminSettingsAccess()` at the route level.
- Do not accept `organizationId` from the client.
- Every data source must be explicitly organization-scoped.
- Do not expose cross-tenant data through affected employee lists, counts, export history, or links.

## Testing Strategy

### Loader Tests

Cover:

- Pending time approvals block readiness.
- Pending absence approvals block readiness.
- Normal active work periods do not block readiness.
- Stale active work periods are warning-only.
- Missing payroll export configuration blocks readiness.
- Missing wage mappings for categories present in the period block readiness.
- Recent failed payroll export for the same period blocks readiness.
- Pending or unapproved travel expenses are warning-only.
- Empty period data can be ready when setup checks pass.
- Partial group failure returns `unavailable` without dropping successful checks.
- All query paths preserve organization scoping.

### UI Tests

Cover:

- Ready state summary.
- Blocked state summary with blocker and warning counts.
- Partial unavailable state.
- Affected employee rows render employee name, employee number, issue label, and action link.
- Payroll export deep link appears when ready or setup is missing.

## Success Criteria

- An org admin can open one page, select a payroll period, and immediately see whether payroll export is ready.
- The page distinguishes blockers from warnings and does not treat normal active work periods as blockers.
- Users can identify affected employees without leaving the page.
- Users can navigate to the right existing page to fix each issue.
- The checklist introduces no new write paths and no cross-tenant visibility.
