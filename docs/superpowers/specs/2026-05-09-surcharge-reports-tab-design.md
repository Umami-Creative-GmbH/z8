# Surcharge Reports Tab Design

## Goal

Finish the Surcharges settings Reports tab with an audit-focused report view. Users should be able to inspect surcharge calculations for a selected period, see useful totals, and expand each calculation to verify the source details and applied rules.

## Scope

This work replaces the current "Coming soon" placeholder in the existing Surcharges settings page. It does not add exports, saved report views, payroll integrations, database schema changes, or a new route.

## Recommended Approach

Use an inline audit/detail report inside the existing settings tab. Add a focused `SurchargeReports` client component under `apps/webapp/src/components/settings`, and render it from the existing `SurchargeManagement` Reports tab. The component will call the existing scoped `getSurchargeCalculationsForPeriod` server action.

This approach is preferred because the tab already exists, backend scoping is already implemented, and users get the missing audit view without a broader reporting feature rewrite.

## Alternatives Considered

1. Dedicated `/reports/surcharges` page: better if surcharge reporting becomes a full reporting product with exports and saved views, but too heavy for finishing the existing tab.
2. Minimal audit table only: fastest to build, but less useful because users lose summary totals and practical filtering.

## UI Design

The Reports tab will contain:

1. Filter card with start date, end date, an optional employee filter, and an apply/refresh action. Dates default to the current month.
2. Summary cards for total calculations, total base hours, qualifying surcharge hours, and credited surcharge hours.
3. Audit table with calculation date, employee, base time, qualifying time, surcharge credit, percentage, and created timestamp.
4. Expandable row details showing calculation metadata: source work period start/end, overlap policy, calculated-at timestamp, and each applied rule with rule name, type, percentage, qualifying minutes, and surcharge minutes.
5. Clear loading, empty, and error states.

## Data Flow

`SurchargeReports` owns filter state and loading/error state. Applying filters calls `getSurchargeCalculationsForPeriod(organizationId, startDate, endDate, employeeId?)`. Returned rows are stored in component state. Summary totals are derived client-side from the returned rows.

No client code will duplicate authorization rules. The server action remains the permission and organization boundary.

## Permissions And Multi-Tenancy

All report data must remain organization-scoped through the existing server action. Organization admins may request all rows or filter by employee. Managers receive only rows in their scoped visibility, as already covered by existing behavior tests. The UI should not expose privileged assumptions or attempt to infer cross-organization access.

## Error Handling

Invalid date inputs prevent fetching and show an inline validation message. Server failures show the returned error message and preserve any previously loaded results. Empty result sets show a useful empty state explaining that no surcharge calculations matched the selected filters.

## Testing

Testing should cover the report UI behavior where practical:

1. Summary totals are derived correctly from returned calculations.
2. Empty results render the empty state.
3. Expanded rows render calculation details and applied rules.

Existing server action behavior tests already cover manager visibility for surcharge calculations and should continue to pass.
