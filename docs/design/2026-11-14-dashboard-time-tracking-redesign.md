# Dashboard and time tracking redesign

Status: visual and UX direction approved on 14 November 2026. Production implementation remains to be done.

The user reviewed the prototype and said: "i really like the design direction and reorganization of modules." Carry this direction into implementation; resolve implementation details against the real application.

## Start here

Read the [UI and UX language](../refs/ux-language.md) for the shared refresh rules. Preserve all existing capabilities, including sidebar collapse/expansion, shortcuts and saved preferences; controls missing from the prototype are not approved removals.

1. Open the [approved prototype](assets/2026-11-14-dashboard-time-tracking/prototype.html) in a browser. Use its bottom bar to inspect both screens, and the moon button for dark mode.
2. Inspect the [dashboard](assets/2026-11-14-dashboard-time-tracking/dashboard.png), [time tracking](assets/2026-11-14-dashboard-time-tracking/time-tracking.png), [dark theme](assets/2026-11-14-dashboard-time-tracking/time-tracking-dark.png), and mobile captures ([dashboard](assets/2026-11-14-dashboard-time-tracking/mobile-dashboard.png), [time tracking](assets/2026-11-14-dashboard-time-tracking/mobile-time-tracking.png)). The captures are visual references; the running app supplies all production data and behavior.
3. Follow the repository's ticket, branch, implementation and validation workflow. Compare the current implementation with this brief before choosing component boundaries.

The [new-session prompt](2026-11-14-dashboard-time-tracking-conversion-prompt.md) starts the conversion. [Research notes](assets/2026-11-14-dashboard-time-tracking/design-notes.html) retain the Mobbin evidence and before/after comparisons. All references are local to this repository; the original chat and user-profile visualization directory are not required.

## Intended outcome and scope

Make day-to-day workforce management calm, precise and easy to scan. The dashboard answers what needs attention, how the team is doing, and where the employee stands. Time tracking answers whether the employee is working, where, and what was recorded on each day.

Implement the approved organization for the dashboard, `/time-tracking`, and the shared navigation/header treatment they show. Adapt the shared shell consistently wherever it is rendered. Other routes retain their page content and workflows in this first conversion.

This is a production React/Next.js conversion. Reuse the application's existing data loading, authorization, actions, components, translations and preferences. The prototype is a visual reference, not a production component or a replacement data model.

## Visual language

- Preserve the existing friendly tech-blue brand, neutral surfaces and light/dark theme tokens. Use blue for primary actions, selection and progress; reserve amber for attention and green for positive status.
- Establish hierarchy through aligned sections, spacing, restrained typography and fine borders. Remove decorative icon colors, prominent per-widget refresh controls, nested cards and oversized empty-state illustrations where the approved layout replaces them. Preserve refresh behavior and feedback through the existing mechanisms.
- Use a compact navigation rail with clear workplace and team/organization groups. Keep all existing destinations, role visibility, search, organization switching and account controls available. Reconcile grouping with existing personal ordering/preferences rather than silently resetting them.
- Use a bounded reading width on large screens, then stack columns on narrow screens. Keep the clock, primary action and record usable without horizontal page scrolling.
- Reuse real organization logos and employee avatars. The prototype's letter avatars and text mark substitute for image assets; they do not define a new identity system.
- Implement readable type, accessible contrast and usable hit targets through the actual component system. Tiny annotation text in the mockup is not a requirement.

## Dashboard organization

| Region | Approved treatment | Production requirement |
| --- | --- | --- |
| Heading | Date, concise greeting, view customization | Derive date/name from existing context; retain customization access. |
| Summary strip | Weekly hours/progress, monthly hours/progress, overall balance, organization count | Use authoritative values with appropriate permissions. Keep summaries together without duplicating complete metric widgets elsewhere. |
| Main column: attention | "Heute im Blick": risks, pending approvals and today's absence state | Distinguish action-needed from all-clear states. Link each item to its actual workflow; derive visibility from the user's access. |
| Main column: team | One aligned table with person, team, presence and recent activity | Preserve authorized scope, real avatars/status and useful employee navigation. Adapt columns for mobile. |
| Side column: personal day | Clock state, today's elapsed work, target context, link to time tracking | Reflect the same active period as the global clock and time-tracking page, including break state where supported. |
| Side column: leave | Available leave, breakdown, request action and upcoming absence | Keep existing calculation semantics and request flow. |
| Side column: approvals history | Short recent list with access to remaining history | Preserve all records and actions; show real count and current state. |
| Secondary widgets | Collapsible area for workplace policy, organization details and hydration | Keep enabled content and user preferences reachable. Adapt existing widget customization/loading to the new regions. |

The manager screenshot is one role example. Employees must receive a useful personal dashboard, with unauthorized manager/organization modules omitted. Honor existing widget availability, visibility, order/customization and deferred loading; map these capabilities to the new regions deliberately.

## Time tracking organization

1. Place the clock state, today's elapsed work, workplace selection and primary clock action in one compact band. Replace the large welcome panel with working context. Keep manual entry easy to find.
2. Present weekly hours, monthly hours, overall balance and today's summary in an aligned strip. Show target/variance context next to its value.
3. Show a week strip for daily context, with selected-day activity below it. The screenshot's Saturday is empty; real working days show their actual recorded periods, breaks, absences and shifts as supported by the current timeline.
4. Group entries under day headings, with a daily duration summary. Keep endpoint times, durations, descriptions and correction controls. Retain calendar access, browsing, filters and pagination where the real view provides them.
5. Use the side column for a compact calendar and workplace-policy context. Date controls must update the actual selected day/period consistently. Stack or adapt this context for mobile.
6. Keep captured endpoint offsets available. A multi-zone record may have different offsets at clock-in and clock-out. Do not replace them with the viewer's timezone or a single page-wide assumption.

The prototype's clock toggle, calendar switch and correction buttons demonstrate placement. Implement them through existing real actions and states, including active work, breaks, successful saves and failure/retry feedback. Preserve timezone-mismatch handling and manual-entry validation.

## Data and behavior boundaries

Read [Timekeeping Reference](../refs/timekeeping.md) before conversion. Production durations come from canonical UTC records. Day and week grouping follows the employee's defined calendar context; each endpoint retains its captured event-local offset. Use shared domain helpers and explicit-zone Temporal logic where new business logic is necessary.

Prototype values are screenshot fixtures, including these unresolved discrepancies:

- The dashboard monthly target is 171.4 hours; the time-tracking target is 168 hours. Inspect the existing calculation sources and explain the difference. Use authoritative production values; a visual refactor must not silently redefine targets.
- The screenshot's 11 November record from 09:08 to 12:45 displays 3h 36m. The prototype preserves that displayed value. Do not infer production durations by subtracting wall-clock labels.
- A 12 November record has identical displayed endpoints and no displayed duration. Preserve existing handling of incomplete/anomalous records.
- Monday and Tuesday in the prototype have dashes because full source records were unavailable. They are not zero-hour business states.

Keep data organization-scoped and permission-checked. Preserve existing clock synchronization, optimistic state, notifications, corrections, request flows, refresh behavior, offline behavior and error handling wherever currently supported. Migrate a touched legacy form to TanStack Form according to project conventions. Use Tabler React icons and the established translation system.

## Suggested implementation order

1. Map existing routes, widget permissions/preferences, clock state and time data owners. Produce a short component/behavior map with any real blockers identified.
2. Implement shared layout primitives and the navigation/header treatment, then the dashboard's regions using real reads/actions.
3. Implement time tracking's action band, summary, daily grouping and day/week context using the current time model.
4. Check role variants, themes, responsive layouts and operational states in the running app. Capture evidence, fix differences and complete the appropriate checks.

These are implementation increments, not separate design approvals. Continue through both screens unless a concrete external blocker prevents further work.

## Completion criteria

- Both real routes visibly follow the approved organization and render authoritative, authorized data.
- Every existing capability is retained, deliberately relocated or documented with a concrete reason; no required action is replaced by a demo toast.
- User widget preferences and role restrictions continue to work. Shared shell changes do not break other routes.
- Clocking, workplace selection, breaks, manual entry/corrections, day navigation and list/calendar access work through real application behavior wherever supported.
- Verify meaningful loading, empty, error, active-clock and break states, plus ordinary employee and manager views. Show unavailable data distinctly from zero.
- Inspect desktop around 1600 px, phone around 390 px, and a wide viewport in both themes. Check keyboard navigation, focus, labels, contrast and overflow. Responsive values are review targets, not hardcoded breakpoints.
- Use the required React performance, composition, accessibility and runtime-verification skills/checks. Add meaningful regression coverage where behavior changes. Report checks that could not run because the required environment was unavailable.
- Provide before/after captures from the actual implementation, a concise behavior/change summary, and unresolved limitations.

## Mobbin evidence

These screens informed structural decisions. Z8's palette, terminology and domain remain its own.

- [Remote dashboard](https://mobbin.com/screens/7f856b83-640e-42dd-957c-c048783c191f): grouped things to do.
- [Workable dashboard](https://mobbin.com/screens/19b27e00-cc51-481f-85dc-74c8216171de): clock beside daily work and to-dos.
- [7shifts](https://mobbin.com/screens/54bce8f6-0a63-4862-8d72-1eb34d3393a6): summary metrics above a team table.
- [Toggl Track](https://mobbin.com/screens/1e3ace50-ca2c-49f5-92ee-e0c631d30a1f): totals separate from detailed breakdowns.
- [Remote time tracking](https://mobbin.com/screens/03e3dac5-f555-46bf-95b6-dd1cfca1c952) and [ClickUp](https://mobbin.com/screens/4a1f479a-3fd9-4bcc-998c-3fa31a651063): daily groups and summaries.
- [Bonsai](https://mobbin.com/screens/b18ba349-7ca1-4c8b-a4e5-fb97812aae37): compact entries and a direct add-hours action.
- [Workable time tracking](https://mobbin.com/screens/2b9b3e7a-b8b1-416b-85b1-72724596ed5e): weekly activity context.
