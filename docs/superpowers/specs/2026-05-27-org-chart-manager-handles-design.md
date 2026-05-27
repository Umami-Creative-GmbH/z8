# Org Chart Manager Handles Design

## Summary

Make direct manager relationships visibly connect employee cards in the `/organization` org explorer. The graph already loads manager links and passes them to React Flow as edges; employee cards need explicit connection handles so those edges anchor to the cards reliably.

## Context

- The org explorer route is implemented in `apps/webapp/src/app/[locale]/(app)/organization`.
- `org-chart-graph.ts` already creates `manager` edges from manager employee nodes to report employee nodes.
- `org-chart-client.tsx` renders the graph with `@xyflow/react` and custom employee/team node cards.
- Custom employee cards currently do not expose React Flow handles, so manager connections may not render or may not visibly attach to the cards.

## Goals

- Show a visible line from each manager employee card to each managed employee card when both cards are loaded in the org explorer.
- Keep the existing manager edge data model and organization-scoped server queries unchanged.
- Preserve team membership and team primary-manager edges.
- Keep the card design restrained and readable in light and dark themes.

## Non-Goals

- No editing of manager assignments from the org explorer.
- No database schema changes.
- No new layout algorithm or major graph redesign.
- No tenant-specific environment configuration.

## Design

Use React Flow's native handles on employee cards. Add a source handle to employee nodes for outgoing manager edges and a target handle for incoming manager edges. Existing `manager` edges continue to use the manager employee node as `source` and the report employee node as `target`, so React Flow can draw a line directly between the two cards.

The implementation should avoid changing server action behavior unless tests reveal that manager edge data is missing. The existing organization scoping remains the source of truth: server actions load active employees in the active organization, and `buildScopedOrgChartGraph` filters manager links to loaded active employees in that same organization.

## Components

- `EmployeeFlowNode`: import and render React Flow `Handle` elements for manager connections.
- `buildFlowEdges`: keep the existing edge construction and styling for `manager` edges.
- Tests: update the org chart client test coverage to assert that employee cards expose connection handles or that manager relationships render with the expected React Flow wiring.

## Data Flow

1. Server actions load employees and `employeeManagers` links scoped to the active organization.
2. `buildScopedOrgChartGraph` filters links to loaded active employees.
3. `buildOrgChartGraph` creates `manager` edges from manager node IDs to employee node IDs.
4. `OrgChartClient` passes those edges to React Flow.
5. Employee cards expose source and target handles so React Flow renders the manager line between cards.

## Error Handling

No new error state is required. Existing server action errors and graph expansion failures remain unchanged.

## Testing

- Run focused tests for the org chart client and graph model if available.
- Run the relevant webapp test command if focused tests are unavailable or inconclusive.
- Verify type checking through the existing project checks when practical.

## Self-Review

- No placeholders or TBDs remain.
- Scope is limited to visible manager card connections.
- The design does not weaken multi-tenant scoping.
- The design keeps the existing graph model and avoids unnecessary redesign.
