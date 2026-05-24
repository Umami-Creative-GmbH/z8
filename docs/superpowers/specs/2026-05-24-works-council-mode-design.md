# Works Council Mode Design

## Summary

Add a read-only Works Council Mode for German enterprise customers that lets a Betriebsrat review workforce-impacting information without granting broad manager or admin access. V1 should focus on privacy-safe visibility, auditability, and enterprise rollout confidence.

The feature should expose a dedicated `/works-council` area for authorized works council users and an admin configuration surface for enabling the mode, setting visibility boundaries, and controlling exports.

## Context

Z8 already includes time tracking, scheduling, absences, approvals, work policies, surcharge rules, compliance checks, audit logs, reports, custom roles, and enterprise identity features. These are strong foundations for enterprise sales, but German buyers may still need confidence that a works council can review relevant workforce changes without overexposing personal or payroll-sensitive data.

Works Council Mode packages existing operational data into a privacy-aware review experience. It should help sales and rollout discussions by answering: can the Betriebsrat inspect relevant workforce decisions, can access be limited, and can the organization prove what was reviewed or exported?

## Goals

- Provide a dedicated read-only works council portal.
- Default to least-privilege and data minimization.
- Let admins configure visible teams, locations, identity visibility, absence visibility, and export access.
- Surface workforce-impacting changes from existing audit and domain data.
- Support a date-range review pack export for internal review.
- Audit all works council access and exports.
- Keep all data strictly organization-scoped.

## Non-Goals

- No legal advice or claims that Z8 guarantees Betriebsrat approval.
- No editing, approval, scheduling, time correction, payroll, or policy mutation actions.
- No wage, salary, or billing data in the works council portal.
- No unrestricted employee profile browsing.
- No raw sick-leave or medical reason exposure by default.
- No cross-organization or platform-admin works council view.
- No messaging or negotiation workflow between admins and works council users in V1.

## Approaches Considered

### 1. Dedicated Works Council Portal (selected)

Create a separate `/works-council` area with a purpose-built dashboard, review log, schedule review, and export flow.

Pros:

- Clear enterprise demo surface.
- Strong privacy boundary compared with expanding manager/admin pages.
- Easier to reason about least-privilege access.
- Can be enabled per organization and linked to enterprise plan packaging.

Cons:

- Adds a new app area and navigation path.
- Requires careful duplicated presentation of data that already exists elsewhere.

### 2. Custom Role Over Existing Pages

Use custom roles to grant works council users limited read access to existing schedule, compliance, reports, and audit pages.

Pros:

- Smaller initial UI footprint.
- Reuses existing pages directly.

Cons:

- Harder to guarantee data minimization across all pages.
- Less compelling as an enterprise feature.
- Existing pages may expose fields that are inappropriate for works council access.

### 3. Export-Only Review Packs

Skip the portal and let admins generate periodic review exports for the works council.

Pros:

- Lower access-control complexity.
- Useful for organizations that do not want works council users inside the app.

Cons:

- Less transparent and less self-service.
- More admin workload.
- Weaker sales story than a dedicated controlled portal.

## Approved Direction

Build the dedicated Works Council Portal first. V1 should be read-only and privacy-first, with configurable visibility and export controls. The first implementation should use existing data sources and avoid introducing a separate works council decision workflow.

## Access Model

Add a dedicated works council access path through one of these implementation-compatible options:

- A built-in custom role template named `works_council`.
- Or a first-class employee role/access tier if the existing RBAC model needs a non-admin, non-manager category.

The selected implementation must support these permissions:

- View works council dashboard.
- View filtered workforce change log.
- View published schedule review, subject to identity visibility settings.
- Export review packs only when enabled by admins.

Works council users must not inherit manager or admin mutation permissions. Authorization checks should be explicit and covered by tests.

## Admin Configuration

Add an organization-scoped settings area at `/settings/compliance/works-council`. This keeps the feature close to compliance controls while avoiding the broader enterprise identity settings. The settings should include:

- Enable or disable Works Council Mode.
- Visible teams and locations.
- Identity visibility level:
  - `aggregated`: no employee identities shown.
  - `pseudonymized`: stable pseudonyms shown within the selected period.
  - `named`: employee names shown where explicitly enabled.
- Absence visibility level:
  - `hidden`: absence counts only.
  - `grouped`: broad categories such as planned absence, sick leave, other.
  - `category`: configured absence category names visible.
- Export permission enabled or disabled.
- Minimum aggregation threshold, defaulting to 5 employees.

The settings should be organization-specific and stored in the database, not environment variables.

## Works Council Portal

### Navigation

Show a `Works Council` navigation item only to authorized works council users and eligible admins. Admin visibility is useful for setup validation and demos, but admin access should still respect organization scoping.

### Dashboard

The dashboard should summarize a selected date range with privacy-safe metrics:

- Overtime totals and trend.
- Break and rest-time risk counts.
- Schedule publication count.
- Schedule change volume.
- Compliance finding counts by severity.
- Absence coverage pressure without raw sensitive reasons.
- Number of workforce-impacting policy changes.

Groups smaller than the configured minimum aggregation threshold should be suppressed or combined into an `insufficient data` state.

### Change Review Log

Provide a filtered audit-style timeline for workforce-impacting changes:

- Work policy changes.
- Approval policy changes.
- Schedule publications.
- Shift template changes.
- Surcharge rule changes.
- Compliance warning acknowledgments.
- Time correction policy changes.
- Works Council Mode setting changes.

Each entry should show timestamp, actor display label, event type, affected scope, and a short summary. Details that reveal sensitive employee data should be minimized according to the organization settings.

### Published Schedule Review

Provide read-only review of published schedules and schedule changes for the selected date range.

Identity display must follow the configured identity visibility level:

- Aggregated mode shows counts and coverage by team/location/time without employee names.
- Pseudonymized mode uses stable labels such as `Employee A`, scoped to the selected period and organization.
- Named mode shows employee names only when explicitly enabled by an admin.

Draft schedules should not be visible in V1. Published schedules and publication/change history are enough for the first review workflow.

### Review Pack Export

When exports are enabled, works council users can generate a date-range review pack. V1 can start with CSV or structured JSON if PDF generation is not already available in the app.

The export should include:

- Selected date range and export metadata.
- Summary metrics.
- Relevant policy and schedule publication changes.
- Compliance warning summaries.
- Overtime distribution.
- Applied privacy settings.

Every export must create an audit event with organization, actor, date range, export type, and visibility settings used.

## Data Flow

1. Admin enables Works Council Mode and configures visibility settings.
2. Admin assigns the works council role/template to selected users.
3. Authorized user opens `/works-council`.
4. Server loads organization settings and validates works council access.
5. Server queries only organization-scoped data for the selected date range.
6. Server applies privacy transforms before returning data to the UI.
7. UI renders dashboard, change log, schedule review, or export status.
8. Access and export events are written to the audit log.

## Privacy and Security

- Filter every query by `organizationId`.
- Enforce works council permissions server-side; UI hiding is not sufficient.
- Apply privacy transforms on the server before data reaches client components.
- Suppress groups smaller than the configured minimum aggregation threshold.
- Exclude payroll, wage, salary, billing, and private manager-note data.
- Hide raw sick-leave and medical details by default.
- Audit all portal access and review pack exports.
- Do not use environment variables for organization-specific settings.

## Error Handling

- If Works Council Mode is disabled, authorized users should see an access-disabled state, not partial data.
- If the selected date range has too little data for aggregation thresholds, show `insufficient data` instead of leaking small groups.
- If one metric group fails to load, show the dashboard with an unavailable state for that group and avoid claiming the review pack is complete.
- Export generation failures should be visible and audited as failed export attempts when an export job record exists.

## Testing Strategy

- Unit: authorization denies manager/admin mutations for works council users.
- Unit: organization scoping is required for every works council data query.
- Unit: aggregation threshold suppresses small groups.
- Unit: identity visibility transforms aggregated, pseudonymized, and named views correctly.
- Unit: absence visibility hides or groups sensitive categories correctly.
- Integration: works council user can load portal when enabled and assigned.
- Integration: works council user cannot access portal when mode is disabled.
- Integration: export creates an audit event with date range and visibility settings.
- UI: dashboard renders empty, suppressed, partial-unavailable, and normal states.
- UI: schedule review respects configured identity visibility.

## Rollout Notes

- Gate behind an enterprise feature flag or billing entitlement if available.
- Start with read-only portal access and CSV/JSON export before adding polished PDF output.
- Use conservative defaults: aggregated identities, grouped or hidden absences, exports disabled, minimum group size of 5.
- Position as a privacy-aware review aid, not a legal compliance guarantee.

## Open Implementation Choice

The implementation plan should decide whether works council access is best represented as a built-in custom role template or a new first-class access tier. The decision should be based on the existing RBAC and CASL patterns at implementation time, but the behavior and privacy constraints in this spec are fixed requirements.
