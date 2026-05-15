# Presence-Aware User Avatar Design

## Goal

Employee avatars should consistently show whether the employee is currently clocked in or clocked out. The existing scattered avatar status dots should be replaced by a central `UserAvatar` implementation that keeps uploaded images, DiceBear fallbacks, and status badge rendering in one place.

## Scope

- Centralize user avatar rendering in `apps/webapp/src/components/user-avatar.tsx`.
- Preserve the existing image fallback chain: uploaded user image, deterministic DiceBear avatar, then initials/loading fallback.
- Add a clock presence badge to employee user avatars across the app, using `unknown` only while presence is loading, unavailable because of an error, or intentionally hidden by permissions.
- Use green for clocked in and red for clocked out.
- Avoid showing a misleading badge when presence cannot be loaded; unknown status renders no dot by default.
- Keep organization logos and other non-user avatar uses on the lower-level `Avatar` primitives.

## Recommended Approach

Use a presence-aware `UserAvatar` API backed by a shared batched presence lookup.

`UserAvatar` accepts an optional clock status value, such as `"clocked-in"`, `"clocked-out"`, or `"unknown"`. It remains responsible for avatar image handling and becomes the only place that draws the bottom-right clock status dot. Call sites no longer wrap avatars with manual badge markup.

Employee collections use a shared server action, for example `getEmployeeClockStatuses(employeeIds)`, to resolve clock status for the active organization. High-presence surfaces opt into short polling. Low-presence and incidental surfaces use page-load data or cached lookup results without polling.

## Alternatives Considered

### Server-Enriched Employee Queries

Every server action that returns employees could include `isClockedIn`. This gives page-load accuracy and avoids client fanout, but it duplicates presence query logic across many unrelated employee queries and requires broad changes to existing result types.

### Global Organization Presence Store

The app could load presence for all employees in the active organization and let every avatar read from one cache. This makes avatar consumption simple, but it can be expensive for large tenants and may cache more presence data than each page needs.

The chosen batched lookup is smaller, permission-aware, and scales with visible employees rather than tenant size.

## Component Design

Extend `UserAvatar` with presence props while keeping existing props compatible:

- `clockStatus?: "clocked-in" | "clocked-out" | "unknown"`
- Optional `showClockStatus?: boolean` if a caller needs to explicitly suppress badge rendering for a non-presence context.
- Existing `image`, `seed`, `name`, `gender`, `size`, `shape`, `className`, and `bordered` props continue to work.

The badge should be rendered inside the avatar root so all sizes and shapes use one consistent visual treatment. The dot should use the current background as a border so it remains legible in light and dark themes.

Badge mapping:

- `clocked-in`: green dot.
- `clocked-out`: red dot.
- `unknown` or omitted: no dot by default.

The badge should include accessible text, such as `Clocked in` or `Clocked out`, through an `aria-label` or visually hidden text. The dot is only a quick presence cue and should not replace textual status where a table or detail view needs explicit status text.

## Data Flow

1. A page or component renders employees with `UserAvatar`.
2. If the page already knows presence, it passes `clockStatus` directly.
3. If the page renders many employees and needs presence, a parent hook or provider batches visible employee IDs into one lookup.
4. The lookup server action validates the active organization and the viewer's allowed employee scope.
5. The lookup queries active work periods for those employee IDs in the active organization, treating a period as active when it is marked active and has no clock-out/end time.
6. Employees with an active work period are returned as `clocked-in`; requested employees without an active work period are returned as `clocked-out`.
7. If lookup fails or permission excludes an employee, the UI treats that employee as `unknown` and hides the badge.

## Caching And Freshness

Use TanStack Query for client-side presence caching and request deduping. Query keys should include the active organization and a normalized employee ID list so repeated avatars and repeated lists do not trigger per-avatar requests.

Use hybrid freshness:

- Dashboard, team, and employee directory surfaces poll about every 30 seconds while mounted.
- Dialogs, approvals, selectors, and other incidental surfaces use page-load data or cached lookup results without polling.
- Clock-in and clock-out actions invalidate the current user's presence query immediately so their own badge updates without waiting for polling.
- During refetch, keep previous data to avoid badge flicker.

This keeps high-value presence views fresh without making every avatar in the app poll independently.

## Permissions And Multi-Tenancy

Presence lookup must be organization-scoped. The server action only considers employees in the session's active organization and should apply the same access model used by employee lists: admins can see the organization set, managers can see employees they are allowed to manage, and employees should not gain broad presence visibility through arbitrary ID requests.

The response should not leak whether an inaccessible employee ID exists. Inaccessible IDs should be omitted or returned as `unknown` by the client mapping.

## Error Handling

- Presence lookup failure renders `unknown` and hides the badge.
- Partial lookup results default only requested, accessible employees without active periods to `clocked-out`; inaccessible or failed employees remain `unknown`.
- Existing image load failures continue to fall back through DiceBear and initials.
- Refetches keep prior presence data until new data arrives to prevent UI flicker.

## Testing

Add focused tests for:

- `UserAvatar` renders green, red, and no badge for `clocked-in`, `clocked-out`, and `unknown` or omitted status.
- Existing DiceBear fallback behavior remains unchanged.
- The batched presence action only returns `clocked-in` for active work periods in the active organization.
- The presence action does not expose employees outside the viewer's permitted scope.
- At least one high-presence surface uses the batched cache/polling path rather than per-avatar requests.

## Migration Notes

Start by adding the `UserAvatar` status API and replacing existing manual avatar dots, including the hard-coded green dot in the managed employees dashboard widget. Then migrate employee-heavy surfaces to the batched presence hook and pass page-load presence directly where a server query already has it. The end state is that employee `UserAvatar` call sites either receive a known clock status or deliberately render `unknown` because the viewer is not allowed to see that employee's presence or the lookup failed. As each call site is touched, pass available `gender` data through to preserve the existing gender-aware DiceBear fallback behavior.
