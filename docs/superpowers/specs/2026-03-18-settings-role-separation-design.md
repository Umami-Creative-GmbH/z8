# Settings Role Separation Design

## Summary

Restore a clear, role-aware settings model for the webapp so members keep a reduced personal settings experience, managers get scoped operational settings for the teams and people they oversee, and organization admins and owners regain the full organization settings surface.

## Context

- Recent settings simplification reduced the visible options for members.
- That same reduction now also affects organization owners because current menu visibility is derived from a binary admin check.
- The current check in `apps/webapp/src/lib/auth-helpers.ts` only treats `employee.role === "admin"` as organization-settings-capable.
- This misses organization membership owners and collapses three practical personas into two:
  - member
  - manager
  - org admin / owner
- The product is multi-tenant and compliance-sensitive, so settings visibility must remain explicit, predictable, and organization-scoped.

## Goals

- Restore full settings visibility for organization owners.
- Keep members on the reduced personal-settings surface.
- Add a deliberate middle tier for managers with scoped operational access.
- Make settings visibility easier to reason about than the current binary `adminOnly` model.
- Keep navigation visibility and page authorization aligned.

## Non-Goals

- No redesign of the settings visual layout.
- No broad rewrite of all settings page authorization logic.
- No new cross-organization permissions model.
- No database schema changes.

## Approved Direction

### Access tiers

The settings system should use three visibility tiers:

- `member`
- `manager`
- `orgAdmin`

`orgAdmin` includes both organization membership roles `owner` and `admin`.

### Member experience

Members continue to see only personal settings:

- `Profile`
- `Security`
- `Notifications`
- `Wellness`

### Manager experience

Managers see the member set plus scoped operational settings.

Manager-manage scope:

- `Organization & Teams` - own teams only
- `Employees` - managed members only
- `Vacation` - assignments for managed members only
- `Work Policies` - assignment only for managed members or teams
- `Skills & Qualifications` - managed members only
- `Shift Templates` - own teams only
- `Coverage Targets` - own areas only
- `Customers` - managed projects only
- `Projects` - own projects only

Manager-read scope:

- `Locations`
- `Holidays`
- `Change Policies`
- `Work Categories`
- `Surcharges`
- `Calendar Sync`
- `Statistics` - team-scoped analytics only

Manager-hidden settings:

- `Billing & Subscription`
- `Data Processing Agreement`
- `Custom Roles`
- `Domain & Branding`
- `Email Configuration`
- `API Keys`
- `Audit Log`
- `Webhooks`
- `Data Export`
- `Payroll Export`
- `Audit Export`
- `Demo Data`
- `Import Data`

### Org admin / owner experience

Organization owners and admins both see the full organization settings surface. Owners should no longer be treated like members just because they do not have `employee.role === "admin"`.

For this settings redesign, owners and org admins are intentionally identical in `/settings`. There are no owner-only exceptions in this scope. Any route or action currently available to org admins in settings remains available to owners, and any org-admin-visible settings entry should preserve owner/admin parity.

## Scope glossary

Use these scope terms consistently in both menu logic and route authorization:

- `managed members` - employees the current manager is explicitly allowed to supervise in the active organization
- `own teams` - teams the current manager is explicitly allowed to manage in the active organization
- `own areas` - locations, subareas, or coverage surfaces tied to the manager's authorized teams in the active organization
- `managed projects` - projects the current manager is explicitly assigned to oversee in the active organization

These terms are always resolved against the active organization only.

## Architecture

### 1. Access context at the source

Replace the current binary `canManageCurrentOrganizationSettings(): Promise<boolean>` usage in settings entry points with a settings-specific access context derived from the active organization membership and employee role.

Recommended shape:

```ts
type SettingsAccessTier = "member" | "manager" | "orgAdmin";
```

Source rules:

- if there is no active organization, resolve to a member-safe personal-settings context only
- else if active org membership role is `owner` or `admin`, tier is `orgAdmin`
- else if active-org employee role is `manager`, tier is `manager`
- else tier is `member`

This keeps owner handling correct even when there is no employee-admin role match.

### 2. Settings config becomes explicit

Update `apps/webapp/src/components/settings/settings-config.ts` so each settings entry declares who can see it.

Recommended model:

- replace or supplement `adminOnly` with a visibility field such as `minimumTier` or `visibleTo`
- optionally add a manager scope descriptor for documentation and downstream authorization work

Example direction:

```ts
type SettingsVisibility = "member" | "manager" | "orgAdmin";

type ManagerScope =
	| "hidden"
	| "read"
	| "manage";
```

This keeps the nav and grid filtering deterministic and avoids one-off booleans like `adminOnly`, `managerAllowed`, and other ad hoc combinations.

### 3. Shared filtering for grid and sidebar

`apps/webapp/src/app/[locale]/(app)/settings/page.tsx` and `apps/webapp/src/app/[locale]/(app)/settings/layout.tsx` should both obtain the same settings access tier and pass it into:

- `getVisibleSettings(...)`
- `getVisibleGroups(...)`
- `SettingsNav`
- `SettingsGrid`

This preserves one filtering source for both the overview page and the sidebar.

### 4. Group handling

Settings groups should no longer be filtered only by `adminOnly`. A group should be visible when it contains at least one entry visible to the current tier after role, billing, and feature-flag filtering.

This prevents managers from losing an entire group when they should still see one or two relevant entries inside it.

## Route contract for manager-visible entries

Every manager-visible setting must define its route behavior explicitly. Menu visibility is not enough.

Standard behaviors:

- `hidden` - the entry is absent from nav and overview; direct URL access returns the existing admin-only denial path for that route
- `read` - the route is reachable, scoped data is visible, edit controls are hidden, mutating actions are server-rejected for managers, and unsupported direct mutation attempts return forbidden behavior
- `manage` - the route is reachable, scoped reads and writes are allowed only within the manager's active-organization scope, and org-wide mutations remain forbidden

Per-entry manager contract:

- `Organization & Teams` - `manage`; managers may view and update their own teams and team membership surfaces only; no org-wide invitation or cross-team administration
- `Employees` - `manage`; managers may view and update managed members only; no org-wide role administration or unrestricted employee edits
- `Vacation` - `manage`; managers may view policy definitions and assign or adjust policies for managed members only; no policy-definition editing
- `Work Policies` - `manage`; managers may view policy definitions and assign them within their scope only; no policy-definition editing
- `Skills & Qualifications` - `manage`; managers may update qualifications for managed members only; no org-wide catalog administration
- `Shift Templates` - `manage`; managers may create or edit templates for own teams only
- `Coverage Targets` - `manage`; managers may edit targets for own areas only
- `Customers` - `manage`; managers may create or update customers only when those records are tied to managed projects; no unscoped org-wide customer creation
- `Projects` - `manage`; managers may create, edit, and staff managed projects only, and any newly created project must be assigned within the manager's active-organization scope at creation time
- `Locations` - `read`; managers may view locations and subareas tied to own teams or own areas only
- `Holidays` - `read`; managers may view holiday calendars applied to own teams or managed members only
- `Change Policies` - `read`; managers may view policy rules applied to own teams or managed members only
- `Work Categories` - `read`; managers may view category definitions used by own teams, own areas, or managed projects only
- `Surcharges` - `read`; managers may view surcharge definitions applied to own teams, own areas, or managed projects only
- `Calendar Sync` - `read`; managers may view calendar configuration tied to own teams, own areas, or managed projects only
- `Statistics` - `read`; managers may view team-scoped analytics only

## Authorization Model

Navigation visibility alone is not sufficient.

For every manager-visible settings page, the page and its actions must enforce team- or member-scoped authorization that matches the menu promise.

Rules:

- pages hidden from managers remain admin / owner only
- pages visible to managers in read mode must hide edit controls in the UI and reject mutations on the server
- pages visible to managers in manage mode must scope reads and writes to managed members, teams, areas, or projects
- all checks remain organization-scoped

Release rule:

- a setting may become manager-visible only when its route guard, data loading, and mutations are scoped and tested in the same change
- if a route cannot meet that bar yet, it remains hidden from managers even if the long-term matrix marks it as manager-visible

## Data Flow

- server entry points resolve current settings access tier from active organization context
- active-organization resolution must use only the current organization's membership and employee data, never another org the user belongs to
- the tier is passed into shared settings filtering helpers
- filtering then applies, in order:
  - role tier visibility
  - billing availability
  - feature flags
- the resulting entries drive the overview grid and sidebar nav
- downstream pages enforce authorization based on the same intended scope

## Error Handling and Edge Cases

- if the user has an active organization owner membership but no matching employee admin role, they still resolve to `orgAdmin`
- if a manager has no managed team or employee scope, manager-only pages may render an empty scoped state, but the role resolution should still be correct
- if feature flags disable a manager-visible setting, it remains hidden or disabled exactly as today
- if billing is disabled, billing-gated settings remain hidden for every tier
- if a user lacks an active organization, settings access should fall back safely and not expose organization settings
- if a user belongs to multiple organizations, switching active org must recompute tier and visible settings from that org only
- if a user is owner or admin in one org but only member or manager in another, the active org alone determines the visible settings set
- if a user has org membership but no employee row in the active org, owner/admin membership still resolves to `orgAdmin`; otherwise the user falls back to `member`

## Testing Strategy

Add focused coverage for settings visibility:

- member sees only personal settings
- manager sees the approved scoped matrix
- org admin sees full admin surface
- owner sees the same full admin surface as org admin
- owner regression test specifically proves owners are no longer filtered to the member set
- owner/admin parity is covered for every org-admin-visible settings entry
- manager-hidden sensitive settings remain hidden
- group visibility follows visible entries rather than old admin-only group flags
- feature-flag and billing filtering still work after tier filtering changes
- active organization switching recomputes visibility correctly for multi-org users
- users without an employee row in the active org resolve safely according to active membership rules

Add or extend authorization coverage for manager-visible routes:

- direct navigation to manager-hidden routes is denied
- manager-read routes render without edit affordances
- manager-read routes reject direct mutation attempts on the server
- manager-manage routes reject out-of-scope reads and writes
- owner and org admin both pass the same route-access checks for org-admin-visible settings

This authorization coverage is required before a manager-visible route can ship.

## Risks and Mitigations

- Risk: role logic splits between nav, grid, and page routes.
  - Mitigation: centralize tier resolution and shared filtering helpers.
- Risk: owners regain menu visibility but some pages still deny them incorrectly.
  - Mitigation: audit current settings route guards against owner membership and align where needed.
- Risk: managers see routes that still allow org-wide edits.
  - Mitigation: treat manager-visible pages as scoped authorization follow-ups, not menu-only changes.
- Risk: future settings additions repeat the old mistake.
  - Mitigation: require every new settings entry to declare explicit tier visibility.

## Out of Scope

- Full CASL refactor of the entire settings area.
- New role editor UX for managers.
- New settings information architecture or visual redesign.
- Cross-tenant or platform-admin behavior changes outside the current organization settings experience.
