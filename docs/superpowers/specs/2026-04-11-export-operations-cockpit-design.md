# Export Operations Cockpit Design

## Objective

Add an organization-scoped export operations cockpit for org admins that centralizes monitoring and triage across payroll exports, audit exports, and scheduled export runs without replacing the existing configuration pages.

The cockpit should answer four operational questions quickly:

- Is anything failing right now?
- What is scheduled to run next?
- What happened recently?
- Where do I go to fix or inspect it?

## Scope

V1 includes:

- A new org-admin settings page for export operations overview.
- Unified alerts for failed or blocked export-related work.
- A consolidated view of upcoming scheduled runs.
- A normalized recent activity feed across payroll, audit, and scheduled exports.
- Deep links into the existing detailed pages for setup, history, and troubleshooting.
- Organization-scoped summary counters for export activity.

V1 excludes:

- Inline configuration forms on the cockpit page.
- Manual run actions from the cockpit.
- Platform-wide worker or cron diagnostics.
- Replacing `settings/payroll-export`, `settings/scheduled-exports`, or `settings/audit-export`.
- Cross-tenant operational visibility.

## Approved Product Decisions

- Primary audience: org admin.
- Primary job: monitor and triage.
- Scope boundary: org-only visibility.
- Interaction model: status and deep links, not direct run controls.
- Preferred implementation: new overview cockpit plus existing detailed pages.

## Approaches Considered

### 1. Overview Cockpit With Deep Links (Selected)

Create a new export operations page that aggregates status and recent activity while preserving the current settings pages as the systems of record for setup and detailed history.

Pros:

- Fits the current codebase structure.
- Keeps write paths and domain-specific forms where they already live.
- Delivers the monitoring value without a large refactor.

Cons:

- Navigation remains split between overview and detail pages.

### 2. Replace Existing Export Pages With One Unified Cockpit

Move monitoring, setup, and history into one large surface.

Pros:

- Most unified user experience.

Cons:

- Much larger refactor.
- Blurs the line between configuration and operations.
- Higher regression risk because the existing pages already have mature forms and actions.

### 3. Keep Existing Pages and Add Small Cross-Links Only

Add badges and links across the existing settings pages without a new unified overview.

Pros:

- Lowest implementation cost.

Cons:

- Does not solve the triage problem.
- Forces org admins to keep stitching together status manually.

## Architecture

Add a new server-rendered route at `apps/webapp/src/app/[locale]/(app)/settings/export-operations/page.tsx` and register `/settings/export-operations` as an org-admin settings route and settings navigation entry in the existing data/settings group.

The page should use the same access model as the current export settings pages via `requireOrgAdminSettingsAccess`.

Introduce a new read-focused orchestration module:

- `apps/webapp/src/lib/export-operations/get-export-operations-cockpit.ts`

This module is responsible for fetching and normalizing a single org-scoped view model for the page. It should not own any mutation logic.

The cockpit should reuse the existing pages for drill-down:

- `/settings/payroll-export`
- `/settings/scheduled-exports`
- `/settings/audit-export`

Optional presentational components can be added under `components/settings/export-operations/` for page sections such as alerts, upcoming runs, recent activity, and summary cards. These components should remain display-only and consume the aggregated view model.

## Data Sources

The new cockpit query layer should read from existing domain modules and tables instead of introducing a parallel export stack.

Primary source categories:

- Payroll export configuration and recent payroll export jobs.
- Scheduled export definitions and recent scheduled export execution records.
- Audit export configuration and recent audit package records.

The implementation should prefer existing read/query functions where possible. If the current code only exposes page-local server actions, extract or add shared read helpers in the domain layer rather than making the cockpit depend on UI-specific action shapes.

## View Model

The page should normalize source data into one compact cockpit model:

- `coverageSummary`
- `alerts`
- `upcomingRuns`
- `recentActivity`

### Coverage Summary

Top-level counters for quick orientation, such as:

- active scheduled exports
- failed runs in the recent window
- last payroll export time
- last audit package time

These are situational cues, not analytics.

### Alerts

Alert cards should highlight issues that need org-admin attention, including:

- failed payroll export jobs
- failed scheduled export executions
- failed audit package generation
- scheduled exports blocked by missing target configuration
- configured feature area that has never successfully run when that is operationally meaningful

Each alert should include a short label, timestamp or recency signal when available, and a deep link to the page that can resolve or explain the issue.

### Upcoming Runs

This section should list active scheduled exports with:

- schedule name
- report type
- next execution time
- last execution outcome
- destination deep link

This section is organization-scoped and should not expose raw worker or cron internals.

### Recent Activity

Merge payroll export jobs, scheduled export executions, and audit package records into one reverse-chronological feed with normalized fields:

- item type
- status
- title
- timestamp
- concise secondary metadata
- deep link

The feed is for triage, not forensic detail. Rows should stay compact and link out for full history.

## Data Flow

1. The page resolves org-admin access and `organizationId`.
2. The cockpit query layer fetches payroll, scheduled export, and audit export summaries in parallel.
3. Each source is normalized into a common view model shape.
4. Derived sections are built:
   - alerts from failures, blocked schedules, and missing readiness
   - upcoming runs from active schedules with `nextExecutionAt`
   - recent activity from merged timestamped records
   - summary counters from the normalized sources
5. The page renders each section independently, with deep links into the existing detailed pages.

## Error Handling

The cockpit should degrade by section instead of failing as a whole page.

Rules:

- If one source fails, render the other sections and show a scoped error state for the failed section.
- Treat missing configuration as an expected empty or setup state, not as a fetch failure.
- Distinguish between `failed run`, `never run`, and `blocked by missing configuration`.
- Preserve strict organization boundaries in all reads and derived alerts.

This keeps the page useful during partial outages or incomplete setup.

## Navigation And Permissions

- Add `/settings/export-operations` to `ORG_ADMIN_SETTINGS_ROUTES`.
- Add a new settings entry in the `data` group near the existing export-related pages.
- Keep access at the org-admin tier only.
- Do not add platform-admin worker queue information to this route.

## Testing Strategy

### Unit Tests

Add focused tests for the cockpit query layer to verify that it:

- merges source records correctly
- orders recent activity correctly
- derives alerts correctly
- distinguishes empty/setup states from error states
- preserves organization scoping

### Page And Route Tests

Add route-level or page-level coverage for:

- org-admin access enforcement
- rendering when no export features are configured
- rendering when one source fails but others succeed

### UI Tests

Add light UI coverage for:

- correct deep links to payroll, scheduled exports, and audit export pages
- expected status badge and alert labels
- compact recent activity rendering for mixed item types

## Non-Goals

- A new mutation API for export operations.
- Direct cron introspection for org admins.
- Rebuilding existing export configuration forms.
- In-cockpit execution history detail beyond triage-level summaries.
- Broad settings-navigation refactoring unrelated to export operations.

## Success Criteria

- Org admins can open one page and immediately see export-related failures, upcoming runs, and recent activity for their organization.
- The cockpit reduces the need to visit multiple pages just to understand current export state.
- Existing export settings pages remain the authoritative place for setup and detailed history.
- The cockpit introduces no cross-tenant visibility and no new operational dependence on platform-admin diagnostics.
