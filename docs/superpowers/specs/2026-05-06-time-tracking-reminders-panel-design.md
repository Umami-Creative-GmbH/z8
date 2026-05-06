# Time Tracking Reminders Panel Design

**Goal:** Replace the oversized break and water reminder alerts inside `/time-tracking` with one compact, operational status panel that keeps compliance guidance prominent without making wellness nudges dominate the clock card.

**Recommended approach:** Combine break and hydration reminders into a single `Session reminders` panel shown below the active session summary. Break compliance state gets priority; hydration remains available as a secondary wellness row with direct actions.

## Context

- The current implementation renders `BreakReminder` and `WaterReminder` as separate full-width alert blocks inside `ClockInOutWidget`.
- In dark mode, the break reminder can appear as a large mostly empty bordered area because the alert content is narrow while the container spans the full card.
- The current break copy can produce awkward states such as `0 minutes until a break is required`, which reads as broken instead of actionable.
- Water reminders are useful but should not visually compete with clock-out or compliance-critical break guidance.
- Z8’s product direction favors calm, precise, operational interfaces over decorative or consumer-like reminder surfaces.

## Scope

- Redesign reminder presentation inside the `/time-tracking` clock card.
- Preserve existing break reminder and water reminder behavior, settings, actions, and server logic.
- Improve reminder hierarchy, density, copy, and responsive behavior.
- Keep the clock-in/out action as the primary interaction in the card.

## Decisions

### 1. Unified panel model

- Replace separate full-width reminder alerts with one compact panel.
- The panel appears only while clocked in and at least one reminder row is relevant.
- The panel title should be short and neutral, for example `Session reminders`.
- The panel should sit directly below the active session summary and above compliance blockers or clock-out actions only when it has relevant content.
- The panel should use restrained borders, compact padding, and the app’s neutral surface styling rather than large alert styling.

This makes reminders feel like session context instead of disruptive page-level notifications.

### 2. Reminder hierarchy

- Break state is the highest-priority row because it can be compliance-relevant.
- Hydration is a secondary row because it is wellness guidance.
- If break state is urgent or overdue, the panel should visually emphasize the break row using warning or destructive accents.
- If break state is only approaching a limit, use a softer warning tone.
- Water state should use blue accents sparingly and should not make the whole panel blue.

The user should immediately understand whether there is a compliance issue, while still being able to log water quickly.

### 3. Break row behavior

- When a break is overdue, show direct copy such as `Pause jetzt erforderlich`.
- When a break is approaching, show `Noch {minutes} min bis zur Pause`.
- Avoid showing `0 minutes until required`; zero or negative remaining time should be treated as required now.
- Include a compact progress indicator only if it communicates useful state without increasing panel height too much.
- Preserve the existing dismiss behavior per work session.
- If there is a required break duration remaining, show it as a short secondary detail, for example `{remaining} min Pause offen`.

The break row should be clear, scannable, and impossible to misread.

### 4. Hydration row behavior

- Show hydration only when the water reminder hook says a reminder is due.
- Show today’s progress as short text, for example `{intake}/{goal} Gläser heute`.
- Provide compact inline actions: `+1 Glas`, `+2`, and `Heute stummschalten`.
- Preserve existing logging, snooze, toast, disabled, and loading behavior.
- Keep current streak optional and secondary; omit it from the panel if it makes the row feel crowded.

Hydration should be helpful and easy to act on without pulling attention away from time tracking.

### 5. Layout and responsiveness

- Desktop: render rows in a compact vertical stack inside one panel.
- Mobile: keep the same stack, with actions wrapping cleanly below the relevant row text.
- The panel should not create large empty horizontal space when copy is short.
- The dismiss affordance should be row-level or panel-level depending on which reminder is being dismissed, but it must remain keyboard accessible.
- Touch targets for hydration actions should remain usable on mobile.

The final result should look intentional in the wide clock card and still work on narrow screens.

## Component Model

- Introduce a small combined reminder component owned by `ClockInOutWidget`, for example `SessionReminderPanel`.
- Move presentation concerns out of the separate alert components or replace their usage inside `ClockInOutWidget` with the combined panel.
- Keep the existing reminder hooks and action functions as the behavior sources:
  - break status continues to come from `getBreakReminderStatus` plus `useElapsedTimer`
  - hydration continues to use `useWaterReminder` and `useHydrationStats`
- Avoid backend, schema, and settings changes.

## Data Flow

- `ClockInOutWidget` passes `isClockedIn` and `sessionStartTime` to the combined panel.
- The panel derives break and hydration visibility independently.
- The panel renders nothing if neither row is visible.
- Break dismissal remains scoped to the current session start timestamp.
- Water dismissal and snooze continue to use the existing water reminder behavior.

## Copy Direction

- Use short, operational copy.
- Prefer direct state language over generic reminder language.
- German examples:
  - `Session-Hinweise`
  - `Pause jetzt erforderlich`
  - `Noch {minutes} min bis zur Pause`
  - `{intake}/{goal} Gläser heute`
  - `Heute stummschalten`

## Accessibility

- Keep all dismiss and action controls as real buttons with accessible names.
- Use color as reinforcement, not the only indicator of break urgency.
- Ensure loading states are announced through button text or accessible labels where needed.
- Preserve focusability and keyboard operation for logging, snoozing, and dismissing reminders.

## Testing Strategy

- Verify the panel does not render while clocked out.
- Verify the panel does not render when neither break nor hydration reminders are due.
- Verify break approaching, break required, and break duration remaining states render with the correct copy.
- Verify zero remaining break minutes renders as required now, not as `0 minutes until required`.
- Verify hydration logging and snoozing still call the existing hooks and preserve disabled/loading behavior.
- Verify desktop and mobile layouts avoid the current oversized empty alert presentation.

## Risks and Mitigations

- Risk: Combining reminders could hide compliance urgency.
  - Mitigation: always render break first and use stronger urgency styling for overdue break states.
- Risk: The combined component becomes too large.
  - Mitigation: keep behavior in existing hooks and split only small row render helpers if needed.
- Risk: Hydration actions crowd the panel on mobile.
  - Mitigation: allow action wrapping and keep labels short.

## Out of Scope

- Changing break compliance rules or organization policy logic.
- Changing water reminder settings, presets, or database schema.
- Redesigning the rest of `/time-tracking` beyond the reminder area.
- Adding new notification channels or background reminder behavior.
