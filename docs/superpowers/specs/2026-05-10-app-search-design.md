# App Search Command Palette Design

## Summary

Add a global command search overlay for the authenticated web app. Users can open it from a new sidebar search button or with `Cmd+K` / `Ctrl+K`, then search accessible pages, settings, users/employees, and teams. Search results must be scoped to the active organization and to the current user's capabilities so employees never see manager or admin-only destinations or records.

## Goals

- Add a sidebar search affordance that opens a `cmdk` overlay.
- Support `Cmd+K` / `Ctrl+K` using `@tanstack/react-hotkeys`.
- Search static destinations such as main app pages and settings pages.
- Search live user/employee and team records and navigate directly to their detail pages.
- Reuse existing authorization and visibility rules instead of creating a parallel permission model.

## Non-Goals

- Full-text search across time entries, approvals, documents, audit logs, or exports.
- Cross-organization search.
- Client-side preloading of all employees or teams.
- New role or capability semantics beyond the existing settings, employee, and team scoping rules.

## User Experience

The sidebar gets a search button near the top of the navigation stack, below the organization switcher and before the main navigation groups. It should read as an action, not a route: search icon, label, and a shortcut hint when the sidebar has enough room.

The search overlay uses the existing `CommandDialog` component from `apps/webapp/src/components/ui/command.tsx`. It opens from the sidebar button or the keyboard shortcut, focuses the input, and closes when the user selects a result or presses escape. Results are grouped as `Pages`, `Settings`, `Employees`, and `Teams`.

When the input is empty, the overlay can show a small set of useful authorized destinations such as Dashboard, Time Tracking, Settings, and accessible team or settings pages. As the user types, static destinations filter immediately through `cmdk`. Live employee and team results load after a short debounce and show loading, empty, and partial-error states inside their groups.

Selecting a result navigates directly to its destination:

- Static pages navigate to their existing route.
- Settings entries navigate to their configured `href`.
- Employee results navigate to `/settings/employees/[employeeId]`.
- Team results navigate to `/settings/teams/[teamId]`.

If live search fails, static results remain usable and the records area shows a quiet message such as `Could not load people or teams`.

## Architecture

Implement the feature as a hybrid command palette:

- A client `AppSearch` component mounted in the authenticated app shell so it is available across all app routes.
- A sidebar search button that toggles the `AppSearch` overlay.
- `@tanstack/react-hotkeys` to register `Cmd+K` / `Ctrl+K`.
- Static searchable destinations generated from existing sidebar and settings configuration.
- A server action for live employee and team search.

The static search index should be built from data already needed by the sidebar or settings surfaces. The implementation should prefer small, explicit destination objects with this shape:

```ts
type AppSearchResult = {
	type: "page" | "setting" | "employee" | "team";
	id: string;
	title: string;
	subtitle?: string;
	href: string;
};
```

The client should not receive unauthorized live records. It should send only the query string to the server action for records, then render the safe result shape returned by the server.

## Authorization And Visibility

Static destinations reuse existing rules:

- Main personal navigation is visible to every authenticated app user.
- Team navigation is visible only to manager or admin employee roles, matching the current sidebar behavior.
- Compliance navigation is visible only when the current settings access tier is `orgAdmin`.
- Settings results are derived from `getResolvedSettingsVisibility`, including billing and organization feature flags.

Live record search is server-authoritative:

- The server action resolves the current principal, settings actor, and active organization.
- Employee search reuses the employee settings query scoping behavior. Org admins can search organization employees. Managers are scoped to employees they are allowed to manage. Employees receive no employee record results in this first version.
- Team search reuses the team settings surface rules. Org admins can search all organization teams. Managers can search only teams where they can manage members or settings. Employees receive no team record results in this first version.
- All queries include `organizationId` filters and never search across organizations.

## Data Flow

1. App layout/server sidebar resolves organizations, current organization, employee role, settings access tier, and feature flags.
2. The search component receives authorized static destinations or enough scoped inputs to derive them.
3. The user opens the palette from the sidebar button or `Cmd+K` / `Ctrl+K`.
4. Static destinations filter locally as the query changes.
5. After a short debounce, the client calls the live search server action with the normalized query.
6. The server action applies organization and role/capability scoping before querying employees and teams.
7. The client renders grouped results and navigates with the existing localized `useRouter` or `Link` utilities on selection.

## Components And Files

Likely implementation areas:

- `apps/webapp/package.json`: add `@tanstack/react-hotkeys`.
- `apps/webapp/src/components/app-sidebar.tsx`: add the search button placement and pass authorized search inputs or destinations.
- `apps/webapp/src/components/server-app-sidebar.tsx`: provide server-derived access tier and feature flag inputs required for static search visibility.
- `apps/webapp/src/components/app-search.tsx`: new client overlay component using `CommandDialog` and hotkeys.
- `apps/webapp/src/lib/app-search/static-results.ts`: helper for building authorized static results from sidebar/settings configuration.
- `apps/webapp/src/app/[locale]/(app)/search/actions.ts` or similar: server action for live employee/team search.

File names can change during implementation if a nearby existing pattern is a better fit.

## Error Handling

- Empty or whitespace-only live search queries should not query records, except for optional static suggestions.
- Live search errors should not close the palette or block static navigation results.
- Unauthorized or missing organization contexts should return an empty record result set rather than leaking existence of records.
- Navigation failures should fall back to normal Next.js route error behavior.

## Testing

Add targeted tests around the authorization and UI seams:

- Static result builder tests for member, manager, and org-admin visibility.
- Static result tests for billing and feature-gated settings.
- Server action tests for employee and team search scoping by organization, settings access tier, manager scope, and team permissions.
- Component tests that open the palette from the sidebar button.
- Component tests for the `Cmd+K` / `Ctrl+K` shortcut registration through `@tanstack/react-hotkeys`.
- Component tests that render grouped results and navigate to employee and team detail routes on selection.

Targeted Vitest runs should be used while implementing, followed by broader checks if touched areas require it.

## Open Decisions Resolved

- Search includes both static pages and live employees/teams.
- Employee and team result selection opens detail pages directly.
- Keyboard shortcut support is required and must use `@tanstack/react-hotkeys`.
- The first implementation uses a hybrid static-client plus live-server search model.
