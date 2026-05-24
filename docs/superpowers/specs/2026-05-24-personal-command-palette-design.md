# Personal Command Palette Design

## Goal

Evolve the existing global app search into a lightweight command palette that improves daily speed and discoverability without duplicating dashboard content or creating a second workflow engine.

The command palette should help users who already know what they want to do move directly to the right workflow: requesting time off, adding time, opening approvals, submitting travel expenses, inviting teammates, or opening relevant settings.

## Context

Z8 already has a broad product surface: time tracking, absences, travel expenses, approvals, scheduling, compliance, payroll readiness, reports, organization management, and settings. The current `AppSearch` already provides a `Mod+K` entry point, sidebar trigger, static page and settings results, and live employee/team search.

The dashboard and manager daily briefing already cover daily summary and status use cases. This feature should complement those surfaces by improving command execution and navigation speed, not by adding another summary page or widget.

## Goals

- Keep one global overlay by extending the existing `AppSearch` component.
- Add translated static action commands alongside pages, settings, people, and teams.
- Make common workflows faster for employees, managers, and admins.
- Keep commands permission-aware and organization-scoped through existing role, settings access, feature flag, and route authorization boundaries.
- Prefer route-based command execution in V1 to avoid invasive dialog coupling.
- Ensure all visible command text uses Tolgee `t()` translations.

## Non-Goals

- No new dashboard widgets or daily briefing duplication.
- No direct server mutations from commands in V1.
- No destructive commands.
- No broad refactor of module dialogs.
- No separate workflow engine.
- No command analytics in V1.

## Approaches Considered

### 1. Extend existing AppSearch (selected)

Add action commands to the existing search overlay and keep the current `Mod+K`, sidebar trigger, command dialog, static navigation results, and live people/team search.

Pros:
- Smallest product and code change.
- Preserves the existing keyboard-first interaction model.
- Avoids duplicate global overlays.
- Reuses existing translation, role, feature flag, and settings visibility inputs.

Cons:
- The existing component will need clearer result/action typing as it grows.

### 2. Build a separate command palette

Create a new global command palette component next to app search.

Pros:
- Could keep search and actions conceptually separate.
- More freedom for action-specific UI.

Cons:
- Duplicates the global overlay and hotkey problem.
- Increases user confusion around search vs command behavior.
- More code and maintenance for little V1 benefit.

### 3. Add workflow shortcuts to dashboard

Expose action shortcuts as dashboard widgets or quick links.

Pros:
- Very visible.
- Simple for mouse-first users.

Cons:
- Duplicates the dashboard's summary role.
- Does not solve keyboard-first navigation across the app.
- Adds more dashboard density instead of reducing friction globally.

## Selected Design

### Architecture

Keep `AppSearch` as the single global command overlay and extend it to support an `action` result type.

Primary changes:
- Extend app-search result types with `action`.
- Add a translated static command builder beside `buildStaticAppSearchResults`, tentatively `buildStaticAppCommands`.
- `AppSidebar` builds both translated static navigation results and translated static command results.
- `AppSearch` renders an `Actions` group before live people, teams, pages, and settings.
- Selecting route actions closes the palette, clears the query, and calls `router.push(href)`.
- Future runnable actions may call small client handlers, but V1 should mostly navigate.

Command descriptors should store translation keys and defaults rather than resolved hardcoded UI strings. A suggested source descriptor shape:

```ts
type StaticAppCommandDefinition = {
	id: string;
	titleKey: string;
	titleDefault: string;
	subtitleKey?: string;
	subtitleDefault?: string;
	keywordKeys?: string[];
	keywordDefaults?: string[];
	href?: string;
	requiredRole?: "employee" | "manager" | "admin";
};
```

The builder resolves descriptors into renderable command results with `t(titleKey, titleDefault)` and `t(subtitleKey, subtitleDefault)`.

### Initial Commands

V1 should start with route-first actions:

- Add manual time entry: route to `/time-tracking`, optionally with an action query if the page supports it cleanly.
- Request absence: route to `/absences`, optionally with an action query if the page supports it cleanly.
- Submit travel expense: route to `/travel-expenses`, optionally with an action query if the page supports it cleanly.
- Open my requests: route to `/my-requests`.
- Open approvals inbox: route to `/approvals/inbox`, visible to managers/admins.
- Invite teammate: route to `/organization` or the relevant organization member management surface, visible only where allowed.
- Create project: route to `/settings/projects`, visible to admins with access.
- Open payroll readiness: route to `/settings/payroll-readiness`, visible to admins with access.
- Open settings: route to `/settings`.

If opening a module dialog from the palette requires invasive refactoring, V1 should navigate to the relevant page instead. Query-param dialog opening can be added only where the destination page already has a clean reusable state boundary.

### Result Ordering

The command dialog should render groups in this order:

1. Actions.
2. People.
3. Teams.
4. Pages.
5. Settings.

This keeps executable shortcuts prominent while preserving the existing live search behavior.

### Visibility And Authorization

Command visibility should be derived from existing app context:

- Employee commands: personal time tracking, absence requests, travel expenses, my requests, settings.
- Manager commands: approvals, team-related destinations, scheduling if enabled, and invite teammate where the existing permissions allow it.
- Admin commands: organization settings, projects, payroll readiness, and administrative setup surfaces.

Unavailable commands should be filtered out before rendering rather than shown disabled. Route-level authorization remains the final guard for any destination.

Every command must remain organization-scoped through existing destination pages and server actions. The palette must not introduce cross-organization reads or writes.

## Internationalization

All visible command palette strings must use Tolgee `t()`:

- Command titles.
- Command subtitles.
- Group labels.
- Placeholder text.
- Dialog title and description.
- Empty and error messages.

Command descriptors should use translation keys and defaults, not raw rendered strings. Search keywords should include translated/default terms where useful so German and English users can find commands naturally. For example, absence-related commands should be searchable by English terms such as `absence`, `vacation`, and `time off`, and German terms such as `Abwesenheit`, `Urlaub`, and `Fehlzeit` once translated keyword support is added.

## Data Flow

1. `AppSidebar` receives the current role, settings access tier, billing state, compliance nav state, feature flags, and organization capability inputs as it does today.
2. `AppSidebar` calls `buildStaticAppSearchResults({ t, ... })` for pages and settings.
3. `AppSidebar` calls `buildStaticAppCommands({ t, employeeRole, settingsAccessTier, billingEnabled, showComplianceNav, featureFlags })` for actions.
4. `AppSearch` receives static navigation results and static command results, or receives one merged typed list if that keeps the component simpler.
5. `AppSearch` continues to debounce live employee/team search with `searchAppRecordsAction` when the query has at least two non-whitespace characters.
6. Selecting a page, setting, employee, team, or route action closes the palette, clears the query, and navigates to the result `href`.
7. Selecting a future runnable action closes only after the explicit UI has opened or the command has safely completed.

## UX Details

- Rename visible copy from `Search` to `Search or run command` where appropriate.
- Update the placeholder to communicate the expanded scope, such as `Search pages, people, teams, settings, or actions...`.
- Keep `Mod+K` as the primary shortcut and retain the sidebar entry point.
- Action rows should use concise labels and muted descriptions.
- Avoid destructive commands and hidden state changes in V1.
- Keep keyboard-first behavior: open, type, enter, escape.

## Error Handling

- Live employee/team search failures keep the current inline error behavior.
- Static route actions should avoid server-side failure paths.
- If a command cannot run because required client context is missing, keep the palette stable and show a visible inline error or toast.
- If a routed destination later fails authorization, rely on the existing route-level access handling.
- Unknown or unavailable commands should be filtered out before rendering.

## Testing Strategy

- Keep existing app search tests for pages, settings, employee results, team results, hotkey behavior, and live search errors.
- Add tests for the `Actions` group rendering before other static groups.
- Add tests for role-based command visibility.
- Add tests for selecting route actions and verifying the router receives the expected destination.
- Add tests that command titles and subtitles are resolved through `t()` rather than hardcoded at render time.
- Add tests for translated group labels, placeholder copy, and empty/error copy where existing app-search tests already cover those areas.

## Rollout Notes

This can ship as a small enhancement to the existing app search. V1 should focus on translated route actions. Dialog-opening command behavior can follow later, one workflow at a time, only where the destination page already exposes clean state for opening the relevant dialog.
