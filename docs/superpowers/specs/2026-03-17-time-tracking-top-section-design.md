# Time Tracking Top Section Design

**Goal:** Redesign the top section of `/time-tracking` so the page feels calm, operational, and deliberate while making the pre-clock-in flow clear and trustworthy.

**Recommended approach:** Replace the current generic clock-in widget with a staged action panel that keeps the page balanced overall, but treats work location as a required, clearly explained input instead of a tab-like toggle. Keep summaries and history visible below, with less visual weight than the action panel.

## Context

- The current top section is implemented in `apps/webapp/src/components/time-tracking/clock-in-out-widget.tsx` and `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx`.
- The page currently mixes three jobs with similar visual weight: starting work, reading summary metrics, and reviewing history.
- The current work-location control uses a `ToggleGroup` that behaves like a segmented filter rather than a meaningful form input.
- On narrower widths, the control hides its text labels and degrades toward icon-only affordances, which makes the choice ambiguous.
- Product context from `AGENTS.md` calls for a calm, modern, operationally trustworthy experience with blue-led accents and restrained structure.

## Scope

- Redesign the top section of `/time-tracking` for the clocked-out, clocked-in, and post-clock-out states.
- Replace the current work-location selector with a clearer required input pattern.
- Rebalance the relationship between the top action area, summary cards, and time-entry history.
- Preserve existing time-tracking behavior, compliance logic, and data requirements.

## Decisions

### 1. Experience direction

- Keep `/time-tracking` as an overview page, not a dedicated single-purpose punch-clock screen.
- Make the top card the clearest and most intentional surface on the page.
- Preserve a balanced overview by keeping summaries and history immediately below the top section.
- Favor calm operational clarity over high-energy emphasis or onboarding-heavy guidance.

This aligns with the brand direction in `AGENTS.md` and the user's preference for a balanced overview rather than a hero-first clock-in experience.

### 2. Top-level layout

- Replace the current `Time Tracking` card structure with a staged action panel.
- The staged action panel has three layers:
  - a short status header
  - a required work-location step
  - a primary action row anchored by the `Clock In` button
- The panel should visually read as one workflow, not a card containing unrelated stacked controls.
- When the employee is clocked in, reuse the same surface and footprint, but shift the content from `Start Work` to `Current Session`.
- Use `Ready to Start` as the default clocked-out status line and `Current Session` as the default clocked-in status line.

This keeps the page stable across states and avoids layout jumps that make the workflow feel improvised.

### 3. Work-location input model

- Replace the current `ToggleGroup` in `apps/webapp/src/components/time-tracking/clock-in-out-widget-parts.tsx` with a labeled radio-card group.
- Use explicit labeling: `Where are you working today?`
- Add helper copy that explains why the field exists: `This helps apply the right attendance and compliance rules.`
- Keep the current four values:
  - `Office`
  - `Home`
  - `Field`
  - `Other`
- Keep this selection required before clock-in.
- Preserve the last-used selection from local storage, but present it as a visible selected input, not as hidden remembered state.
- A remembered value is acceptable as the selected default without explicit reconfirmation, as long as the selected card remains visible and easy to change before clock-in.
- If the remembered value is missing, invalid, or no longer recognized by the UI, fall back to `office` and render that choice visibly.

The main UX goal is to make this feel like a deliberate choice with compliance implications, not a view switch or filter toolbar.

### 4. Work-location visual treatment

- Use radio cards with icon, label, and full-card hit area.
- Never hide the labels at smaller widths.
- Use a 2x2 grid on smaller screens and a 4-column row on larger screens.
- Selected state should use stronger border emphasis, subtle tinted background, and a calm confirmation treatment.
- Avoid segmented-control styling, pill tabs, or icon-only presentation.

This makes the control understandable at a glance and removes the biggest UX problem in the current design.

### 5. Summary cards

- Keep `Today`, `This Week`, and `This Month` directly below the action panel.
- Reduce their visual dominance so they read as supporting operational context rather than competing hero content.
- Keep `Today` visually strongest because it is most relevant to the immediate task.
- Implement a lighter summary strip instead of three equally weighted dashboard blocks.
- Preserve the current information hierarchy, but reduce padding, border emphasis, and vertical mass so the top action panel remains the dominant surface.

This preserves the overview feel without letting the dashboard pattern undermine the top workflow.

### 6. Time-entry history

- Keep the time-entry table below the summaries.
- Strengthen the section header so it feels intentional rather than default table chrome.
- Keep the manual entry action available, but visually secondary unless product usage data suggests otherwise.
- Improve the empty state so it works as a designed moment, not just a generic no-results fallback.

The history area should feel like review and correction space, not part of the immediate start-shift action path.

### 7. State behavior

#### Clocked out

- Show the `Ready to Start` status line.
- Present the required work-location selection.
- Show the primary `Clock In` action as the concluding step.

#### Clocking in or clocking out

- Keep the panel layout stable while the mutation is in progress.
- Replace the primary action label with the existing progress state and spinner treatment.
- Keep the selected work location visible during clock-in submission so the user can understand what is being submitted.

#### Clocked in

- Preserve the same panel footprint.
- Replace the setup flow with current-session information: elapsed time, start time, and nearby compliance feedback.
- Keep the session state visually stronger than the supporting summaries below.

#### Blocking compliance state before clock-in

- If clock-in is blocked by a compliance rule such as rest-period enforcement, keep the work-location selection visible.
- Show the blocking message directly within the top panel above the primary action.
- Keep the blocked primary action visually subordinate to the blocking explanation and exception path.

#### Clock-in or clock-out failure

- Preserve the panel structure and the user's selected work location after a failure.
- Surface the error message close to the action area in addition to any toast feedback.
- Avoid resetting the panel to a generic neutral state that obscures what just failed.

#### Just clocked out

- Keep the post-clock-out notes step within the same panel structure.
- Treat notes as a continuation of the shift flow, not a separate mode change.
- Avoid abrupt layout changes that make the notes request feel bolted on.

### 8. Copy direction

- Replace generic welcome-style copy with short operational copy.
- Prefer direct, work-oriented phrasing over conversational filler.
- Explain required choices briefly when they affect attendance or compliance logic.
- Ensure translation keys exist for work-location labels and helper copy instead of relying on fallback literals.
- Use explicit labels and statuses rather than optional copy variants so the top section remains consistent across future refinements.

This is especially important because the current English locale file does not define work-location strings, which suggests the field has not been treated as a first-class UX surface.

## Component model

- `ClockInOutWidget` remains the orchestrating container for the top section.
- Replace `WorkLocationSelector` with a dedicated required-input component that models radio-card behavior rather than toggle behavior.
- Keep `ClockActionButton`, `ActiveSessionSummary`, and post-clock-out notes as separate focused subcomponents, but restyle and reorganize them under the staged-panel structure.
- Keep compliance banners and reminders close to the main panel, but ensure they do not visually overpower the primary path.

## Data flow

- Preserve the existing `useClockInOutWidget` state shape for the selected work location and local-storage persistence unless implementation friction justifies a small local refactor.
- Continue sending the selected `workLocationType` through the existing `timeClock.clockIn` mutation.
- No schema or API changes are required for this redesign.
- Add translation keys for work-location labels, helper text, and any new status copy.

## Accessibility and interaction

- Implement the work-location selector as a semantic radio group with visible labeling.
- Ensure every option has a large clickable area and clear keyboard focus styling.
- Preserve visible text labels on all breakpoints.
- Keep button and card state contrast strong enough in both light and dark themes.
- Maintain reduced-motion-friendly behavior for any transitions.

## Testing strategy

- Verify the top section reads clearly on mobile and desktop.
- Verify the work-location input remains understandable and fully labeled at small widths.
- Verify keyboard navigation across the work-location options and primary action.
- Verify the top panel remains stable across clocked-out, clocked-in, and post-clock-out notes states.
- Verify translations exist for newly promoted copy surfaces.
- Verify dark and light themes still feel restrained and operational.

## Risks and mitigations

- Risk: the page still feels too dashboard-like after the top-panel redesign.
  - Mitigation: reduce the visual mass of the summary cards and make the action panel clearly more intentional.
- Risk: the radio-card selector becomes too large on mobile.
  - Mitigation: use a compact 2x2 layout with full labels and consistent spacing.
- Risk: remembered last-used state makes the required choice feel invisible.
  - Mitigation: keep the selected option visibly rendered and optionally acknowledge that the last-used location was reused.
- Risk: compliance banners compete with the action flow.
  - Mitigation: keep alerts adjacent to the action panel but subordinate in hierarchy unless they block action.

## Out of scope

- Redesigning the full time-entry table interaction model.
- Changing compliance rules, presence logic, or clock-in/out backend behavior.
- Moving project or work-category selection unless later implementation work identifies a strong reason to consolidate those surfaces.
- Broader navigation or sidebar redesign beyond `/time-tracking`.
