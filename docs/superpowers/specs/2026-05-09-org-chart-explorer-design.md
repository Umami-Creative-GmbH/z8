# Org Chart Explorer Design

## Summary

Add a read-only organization explorer to the webapp that lets every active employee browse their current organization through an interactive graph. Small organizations load the full graph. Large organizations start focused on the signed-in employee and support iterative expansion and employee search.

## Context

- Z8 is a multi-tenant SaaS application. Every query and action must be scoped to the active organization.
- The webapp sidebar currently separates personal navigation from manager/admin team navigation.
- Employees are represented by `employee` records joined to Better Auth `user` records.
- Direct reporting relationships are stored in `employee_managers`.
- Team relationships are stored through `team_membership`, with `employee.teamId` still available as compatibility/default team data.
- Teams can have a primary manager through `team.primaryManagerId`.
- The webapp already includes `recharts`, but it is for statistical charts and is not a good fit for interactive node/link graphs.

## Goals

- Add a new main sidebar module where employees can explore their organization.
- Make the module available to all active employees in the current organization.
- Show direct manager links and team links as equally important graph relationships.
- Load complete org charts for organizations with fewer than 100 active employees.
- For organizations with 100 or more active employees, load the chart asynchronously and iteratively.
- Start large organizations focused on the signed-in employee.
- Let users search for any active employee in the current organization and focus that employee in the graph.
- When an employee is focused, make it clear whether they manage others, who manages them, which teams connect them, and which team managers are nearby.

## Non-Goals

- No editing of employees, teams, or manager assignments from the org chart.
- No database schema changes unless implementation reveals a missing index that is required for performance.
- No cross-organization browsing.
- No use of tenant-specific environment variables.
- No replacement of existing employee settings, team settings, or team pages.
- No attempt to render huge organizations fully in one request.

## Approved Direction

Use `@xyflow/react` for the graph UI.

Reasons:

- It is designed for custom interactive node/link graphs with pan, zoom, selection, controls, custom nodes, and custom edges.
- It fits the mixed graph requirement better than a strict tree org-chart component because direct manager links, team membership links, and team primary manager links are all first-class relationships.
- It is MIT licensed and avoids the commercial yFiles license requirement of `@yworks/react-yfiles-orgchart`.
- It can stay isolated to this route and does not affect the existing `recharts` usage in reports or dashboards.

Use a hybrid loading model:

- Small orgs, fewer than 100 active employees: load the full graph.
- Large orgs, 100 or more active employees: load a focused neighborhood first, then let users expand any visible employee or team node repeatedly.

## Navigation And Access

Add a new main sidebar item in `apps/webapp/src/components/app-sidebar.tsx`.

Working label: `Org Explorer`.

Route: `/organization`.

Access rules:

- Any signed-in active employee with an employee profile in the active organization can open the page.
- Users without an active employee profile see the existing `NoEmployeeError` style.
- The page must never load data from another organization, even if an employee or team ID is supplied manually.

## Graph Model

### Nodes

Employee nodes include:

- Employee ID.
- User ID.
- Display name.
- Email.
- Avatar image or avatar seed.
- Position.
- Role.
- Active status.
- Connected teams.
- Counts or flags for expandable managers, reports, and teams.

Team nodes include:

- Team ID.
- Team name.
- Optional description.
- Member count.
- Primary manager ID when available.
- Counts or flags for expandable members and primary manager.

The focused employee node is visually emphasized. Manager/admin employees can also be marked visually, but all chart content remains read-only.

### Edges

Manager edge:

- Source: manager employee node.
- Target: report employee node.
- Meaning: direct manager relationship from `employee_managers`.

Team membership edge:

- Source: team node.
- Target: employee node.
- Meaning: employee belongs to the team through `team_membership`.

Team primary manager edge:

- Source: manager employee node.
- Target: team node.
- Meaning: employee is the team's `primaryManagerId`.

Edges use distinct labels or visual styles, but manager and team relationships are both first-class. The graph should not hide team relationships behind manager hierarchy or hide manager relationships behind team grouping.

## Loading Behavior

### Small Organizations

For organizations with fewer than 100 active employees:

- Load all active employee nodes in the active organization.
- Load all active teams in the active organization.
- Load all direct manager links between active employees in the same organization.
- Load all team memberships for active employees in the same organization.
- Load all team primary manager links where the manager is active and in the same organization.
- Fit the graph to the viewport on initial render.

### Large Organizations

For organizations with 100 or more active employees:

- Initial graph focuses the signed-in employee.
- Initial graph loads the focused employee, their direct managers, their direct reports, their teams, those teams' primary managers, and up to 25 active members per connected team.
- Users can expand any visible employee or team node.
- Expansion is additive. Already loaded nodes and edges stay visible, and newly loaded nodes and edges are merged in.
- Client-side merge logic deduplicates nodes and edges by stable IDs.
- Search can focus an employee outside the currently loaded graph by loading that employee's neighborhood.

Expansion controls should communicate when more data is available without implying that the visible graph is complete.

## Search And Focus

The page includes an employee search control above the graph.

Search behavior:

- Searches active employees in the current organization only.
- Matches name, email, first name, last name, and position.
- Returns enough metadata to show an accessible result list.
- Selecting a result focuses that employee.

Focus behavior:

- Highlight the focused employee node.
- Center or fit the graph around the focused employee and their loaded neighborhood.
- Load the focused employee's neighborhood when missing.
- Show whether the focused employee has direct managers above them, direct reports below them, team memberships, and team manager connections.

## Server Actions

Create org-chart-specific server actions under `apps/webapp/src/app/[locale]/(app)/organization/actions.ts`.

Proposed actions:

- `getOrgChartInitialGraph()`: resolves current employee and active organization, counts active employees, and returns either the complete small-org graph or the focused large-org graph.
- `searchOrgEmployees(query)`: searches active employees in the current organization.
- `getEmployeeNeighborhood(employeeId)`: returns managers, reports, teams, team primary managers, and up to 25 active members per connected team for one employee.
- `getTeamNeighborhood(teamId)`: returns up to 50 active team members, primary manager, and related manager/report edges for one team, with pagination metadata when more members are available.

All actions validate that requested employee and team IDs belong to the active organization. Cross-organization IDs return not found or authorization-safe empty results rather than leaking existence.

## UI Structure

Keep the implementation local to the new route unless reusable primitives naturally emerge.

Likely files:

- `apps/webapp/src/app/[locale]/(app)/organization/page.tsx` for the server page shell.
- `apps/webapp/src/app/[locale]/(app)/organization/actions.ts` for org-scoped graph actions.
- `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx` for the React Flow client component.
- Local employee node, team node, search, toolbar, empty state, and error components if they keep the main client component focused.

The graph should include pan and zoom controls. A minimap is optional and should only be included if it remains useful and legible for this product UI.

## Error And Empty States

- Missing employee profile: show the existing `NoEmployeeError` pattern.
- No active employees in the organization: show a calm empty state explaining that no active employees were found.
- Failed initial load: show a page-level error state.
- Failed search or expansion: show inline feedback or a toast without clearing the current graph.
- Large org partial graph: make partial loading explicit so users understand they are exploring a subset.

## Performance

- Use the 100-active-employee threshold to avoid full graph loading for large organizations.
- Keep large-org expansion payloads capped so expanding a large team does not load thousands of nodes at once.
- Use 25 active members per connected team in employee neighborhoods and 50 active members per team expansion request.
- Prefer server-side filtering and counts over loading all rows client-side.
- Deduplicate client-side nodes and edges by stable IDs.
- Keep React Flow and its CSS isolated to the org chart route.
- If implementation finds slow queries, add targeted indexes in a separate schema migration only when justified by the query shape.

## Accessibility And Usability

- Search must be keyboard usable.
- Node content should expose meaningful labels for employee and team names.
- Focus changes should be visible without relying only on color.
- Edge styles should be distinguishable by more than color where practical, such as labels or stroke style.
- The page must work on desktop and mobile, with mobile prioritizing search, focused-node details, and pan/zoom controls.

## Testing

Add server action coverage for:

- Active organization scoping.
- Rejecting or hiding cross-organization employee and team IDs.
- Small-org full graph selection under the 100-employee threshold.
- Large-org focused graph selection at 100 employees and above.
- Search only returning active employees in the active organization.
- Employee neighborhood payloads including managers, reports, teams, and team primary managers.
- Team neighborhood payloads including team members and primary manager relationships.

Add component coverage where practical for:

- Empty state.
- Search result selection focusing an employee.
- Focused node styling or state.
- Expansion controls invoking the expected action.
- Expansion failures preserving the current graph.

Verification should run targeted webapp tests first, then broader `pnpm test` if feasible.

## Risks

- A mixed team/manager graph can become visually dense. The implementation should use clear edge styles, focus behavior, and partial loading to keep it understandable.
- Large teams can still create heavy neighborhoods. Expansion payloads need caps or pagination.
- React Flow handles interaction well, but automatic graph layout still needs explicit implementation choices. The first implementation should choose a simple deterministic layout that can evolve later.
- Some existing code still treats `employee.teamId` as a primary team. This feature should prefer `team_membership` and use `employee.teamId` only for compatibility display if necessary.

## Rollout Notes

- Install `@xyflow/react` in `apps/webapp` with `pnpm`.
- Ship as read-only exploration first.
- Keep all new functionality in the webapp.
- No environment variables are required.
- Future iterations can add saved views, filters, export, or admin editing, but those are intentionally outside this design.
