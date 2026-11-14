# Z8 UI and UX language

Status: shared direction for UI refreshes and refactoring, established on 14 November 2026 from the approved dashboard and time-tracking exploration.

Use this reference when changing an app page, shared navigation, a data view, a form, or an interaction. It extends the [design context](design-context.md) into working rules. The [dashboard and time-tracking brief](../design/2026-11-14-dashboard-time-tracking-redesign.md) and its repository-local prototype show the direction applied to two screens.

## The refresh contract

Refresh presentation and organization while preserving what people can do. A feature's absence from the prototype is not approval to remove it. The user explicitly requires existing functionality, including collapsing the sidebar, to survive the refresh.

Before changing a surface, inventory its destinations, actions, states, permissions, keyboard interactions and saved preferences. Map each capability to its place in the refreshed UI. A moved control must remain discoverable and usable in every supported layout. Removing or reducing a capability is a separate product decision that needs explicit approval.

The prototype demonstrates hierarchy, grouping and visual restraint. Its demo actions, fixture data, missing controls, abbreviated copy and simplified state handling do not define production behavior. Keep real logos, avatars, domain calculations, data loading and application actions.

## What the interface should communicate

Z8 should feel calm, precise and under control during ordinary work and operational exceptions. An employee can identify their clock state and records; a manager can identify what needs a decision; an administrator can understand the scope and effect of a change.

Each page answers three questions in order:

1. Where am I, and whose data or which period am I viewing?
2. What needs attention or action here?
3. What evidence and detail support that action?

Choose emphasis from the page's job. A working record should lead with the record and its controls. A decision queue should lead with pending work. An overview should summarize status and point into those workflows.

## Organizing a page

Use a stable shell, a concise page heading, relevant actions, and clearly grouped content. Put the primary action beside the information it needs. Add a subtitle only when it supplies scope, period or instructions that the title cannot convey.

| Region | Use it for | Treatment |
| --- | --- | --- |
| Page heading | Location, person or organization context, period, page actions | One page title; a clear primary action when the page has one. |
| Summary strip | Related totals, targets and variances | Aligned values with units and period context; one shared surface or dividers rather than independent nested cards. |
| Attention section | Exceptions, pending decisions and blockers | Order by urgency and actionability. Every actionable item opens its actual workflow. |
| Main record | The list, table, calendar, form or timeline the person works with | Give it the space needed to read and operate it. Keep filters and view controls nearby. |
| Supporting column | Context useful while working in the main record | Use for a selected period, policy, balance or related detail; stack deliberately on narrow screens. |
| Secondary content | Optional widgets and less frequent detail | Use explicit disclosure, tabs or existing customization; retain access and saved preferences. |

This is a vocabulary of regions, not a requirement to render all six. Avoid repeating a complete metric widget when a summary already communicates the same information. A repeated clock state must agree everywhere it appears.

Keep personal work and team oversight distinct. Manager and organization sections follow actual permissions. When a section is unavailable to an employee, the remaining personal layout must still make sense. Preserve user-selected widgets and ordering when mapping an existing dashboard into new regions.

## Navigation and shared shell

Group navigation around the person's work. The approved exploration separates workplace destinations from team and organization oversight. Retain existing destinations, organization switching, role visibility, account controls, help and platform administration. Adapt the grouping to actual navigation capabilities and saved ordering.

Sidebar collapse and expansion are required in the refreshed shell:

- Preserve the existing desktop toggle, collapsed rail, keyboard operation and persistence behavior. Keep the toggle available in both states, with an accessible label and expanded-state feedback.
- Retain destination icons, active-route indication and accessible names when labels collapse. Supply readable labels on hover and keyboard focus; tooltips supplement accessible names.
- Keep search, organization switching, account actions and nested navigation usable in the collapsed state. Preserve their existing shortcuts and interactions.
- Treat the mobile drawer as a separate responsive presentation. Support opening, closing, Escape, focus management, scrolling and return of focus to its trigger.
- Let content use the space released by collapse. Keep the selected route and page state stable when the shell changes.

Keep the global clock status and its route into time tracking. A page-level clock action may coexist with it when both use the same state and action model. Refresh and notification controls may become less prominent, but their capabilities and feedback remain available. Avoid adding repeated refresh icons to every module merely to make it look interactive.

Shared shell changes apply consistently to every route that uses the shell. A page refresh must also be checked with both expanded and collapsed navigation.

## Visual grammar

Use the existing tokens and UI primitives in [globals.css](../../apps/webapp/src/app/globals.css) and [the shared component directory](../../apps/webapp/src/components/ui). Changes to a shared primitive need review in its other consumers. A screen-specific adjustment belongs in that screen until a reusable need is established.

| Element | Rule |
| --- | --- |
| Surfaces | Use the app background for the workspace, card surfaces for meaningful groups, and muted surfaces for supporting context. Separate rows with spacing or fine borders. |
| Blue | Use the primary role for primary actions, selection, active navigation and relevant progress. |
| Status colors | Use semantic theme roles for success, attention and failure. Pair color with text or an icon; ordinary categories do not each need a saturated color. |
| Borders and elevation | Prefer fine borders and restrained radii. Reserve elevation for overlays and elements that actually sit above content. |
| Typography | Keep the existing app font and font-size preferences. Use a small hierarchy of page title, section heading, body, label and supporting text. Convey importance through weight and spacing before increasing size. |
| Numbers | Use aligned, tabular numerals for comparisons and records. Keep units beside values, and distinguish duration, balance, target and percentage. |
| Spacing | Compose with the existing spacing scale. The gap within a related group is smaller than the gap between independent sections. Align headings, controls and record columns. |
| Icons and identity | Follow [project conventions](project-conventions.md) for Tabler React icons. Use icons to identify actions or destinations; retain real organization and person assets. |

Avoid a card around every number, a subtitle under every heading, an icon beside every label, decorative gradients and large illustrations for routine empty states. Preserve information while simplifying its containers.

Light and dark modes express the same structure, emphasis and statuses. Use paired foreground/background tokens and inspect contrast in both themes. Small annotation text in the prototype is not a production size requirement; keep meaningful labels and metadata readable at the supported font sizes.

## Patterns by task

| Page type | What leads | Supporting organization |
| --- | --- | --- |
| Overview | Related summaries and items needing attention | Team or personal context, recent activity and configurable secondary modules. |
| Work queue | Pending items, scope and useful filters | Counts that match the visible scope, clear status, record detail and the decision action. |
| Record list or report | Period/scope controls and the records | Group headings and subtotals where meaningful; drill into evidence without losing the list context. |
| Planning or calendar | Selected person/team, period and calendar | Relevant availability and policy context; keep selection synchronized across views. |
| Settings or form | A named configuration task and its fields | Related fields in sections, explicit save behavior, validation and clear permission requirements. |

### Lists, tables and history

Use one aligned record surface for comparable items. Give rows a readable identity, status and useful next action. Use tables for cross-row comparison and preserve table semantics. On narrow screens, prioritize columns or offer an accessible detail view while retaining every field and action. Local scrolling can serve genuinely wide tables; avoid horizontal scrolling of the whole page.

Group history by a meaningful boundary, such as day, when that supports the task. Keep ordering, filters, sorting, pagination, selection, bulk actions and exports wherever supported. A condensed recent-history preview must link to the complete history. Preserve descriptions and correction access when grouping time entries.

Show the period and scope of totals beside them. Use authoritative calculation sources, consistent precision and locale-aware formatting. Represent unknown, unavailable or still-loading data distinctly from zero. Explain stale data and retain refresh/retry access. A visual change must not silently alter a balance or calculation rule.

### Operational actions and forms

Keep clock state, work location and clock action together. Distinguish working, on break and stopped states with clear labels. Preserve workplace rules, timezone mismatch decisions, manual entry and corrections. Other operational actions should similarly place the affected record, decision context and action together.

Keep labels visible, validation close to the affected field, and the submitted scope clear. Preserve entered values when an operation fails. Show pending, success and failure feedback, prevent duplicate submissions, and provide a useful retry path. Use confirmation or undo according to the consequence of the action; do not add confirmation to routine reversible interactions without a reason.

Follow the [forms reference](forms.md) for implementation and migration. Preserve existing draft, unsaved-change, cancellation and dialog behavior when reorganizing a form.

### Disclosure and personalization

Collapse secondary detail when the page's main task remains complete without it. Use a label that names the hidden content and show a count or attention state when relevant. Keep urgent work and the primary action discoverable. Preserve enabled modules, customization controls, saved layout choices and the existing persistence model.

Do not interpret the prototype's collapsed utility section as a blanket instruction to hide features. Choose disclosure per page and role, and document where each moved capability can be found.

## States, accessibility and responsiveness

Treat these as part of the design, rather than later implementation polish:

| State | Required behavior |
| --- | --- |
| Loading | Keep the shell and relevant controls stable. Reserve the main content's space where practical; distinguish pending data from an empty result. |
| Empty or all clear | Say what is empty, for which scope, and offer the next relevant action. An all-clear manager state must not imply an employee is currently present. |
| Error or offline | Explain what failed, retain usable data and input, and expose recovery. Preserve existing offline and synchronization behavior. |
| Pending mutation | Reflect progress and prevent accidental duplicate actions. Keep feedback consistent across shared clock and record surfaces. |
| Disabled or restricted | Explain prerequisites when useful. Use real authorization for data and actions; hiding a control is only presentation. |
| Long or dense content | Handle long names, translations, many rows and missing images without obscuring identity or actions. |

Use semantic headings, navigation, buttons, links, tables and labeled fields. Provide visible keyboard focus, accessible icon-only controls, announced operation feedback and focus management for overlays. Keep controls operable by keyboard and touch. Honor reduced motion and avoid animations that delay work or obscure state changes.

At smaller widths, retain the primary task and move supporting context into a deliberate reading order. Preserve all actions and fields through adaptation, rather than removing them to make the screenshot fit. At large widths, bound reading-heavy content; let tables and planning views use more space when the job needs it. Verify enlarged font preferences, browser zoom, drawer behavior and the absence of unintended page overflow.

## Copy, scope and time

Use direct labels in the person's vocabulary: name the action, affected record and period. Prefer explicit action labels such as “Zeit nachtragen” or “Abwesenheit beantragen” over generic continuation labels. Keep established domain terms consistent across navigation, headings, filters and feedback. Follow the [i18n reference](i18n.md); the prototype's German copy is illustrative, not a replacement for translations.

Show whose data is being viewed and make organization, employee and period changes apparent. Keep data and actions organization-scoped under [project conventions](project-conventions.md). A refreshed layout must preserve all existing access boundaries.

Follow the [timekeeping reference](timekeeping.md) and [date/time reference](dates.md) for time-related surfaces. Keep captured endpoint offsets available, including different offsets within one record. Explain the timezone used by manual inputs and calendar boundaries. UI grouping and labels must follow the domain's time context, not the viewer's device timezone. Resolve contradictory displayed metrics against their authoritative sources, rather than styling the discrepancy away.

## Applying the language to a refactor

1. State the page's task and inventory its current capabilities. Include shortcuts, sidebar states, preferences, permissions and non-happy-path behavior.
2. Map those capabilities to the new regions. Record deliberate relocations and any unresolved behavior questions before removing existing UI.
3. Rebuild with existing components, tokens, translations, authorized reads and actions. Extract shared patterns when their consumers and behavior are understood.
4. Compare the running page with the approved direction and the capability inventory. Verify real interactions and data, not only a static capture.
5. Supply before/after evidence, the capability mapping, completed checks and any remaining limitations in the implementation handoff.

A refactor is ready when the primary task is clear; all previous capabilities remain usable or have separately approved changes; data and shared state agree; and the affected roles, themes, navigation states, responsive layouts, font preferences and operational states have been checked. Complete the repository's applicable quality checks and meaningful regression coverage for changed behavior.

## Evidence and design judgment

The approved [screen brief](../design/2026-11-14-dashboard-time-tracking-redesign.md#mobbin-evidence) records the Mobbin screens inspected during the exploration. Remote and Workable informed task/clock placement; 7shifts and Toggl Track informed summary/detail separation; Remote, ClickUp, Bonsai and Workable informed time-record organization. These are examples of structure, not prescriptions to adopt another product's appearance or business model.

This document generalizes the approved direction into Z8 recommendations. It does not claim every rule was demonstrated by every reference. Use the prototype for composition, this document for app-wide UX decisions, and domain references for behavior. Record justified exceptions in the relevant issue or PR so future work can distinguish an intentional trade-off from drift.
