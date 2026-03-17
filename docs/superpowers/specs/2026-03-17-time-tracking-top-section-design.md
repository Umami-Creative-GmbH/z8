# Time Tracking Top Section Design

**Goal:** Redesign the `/time-tracking` clock-in experience so it feels professional, confident, and operationally clear, with work location handled as inline shift context instead of a separate selector UI.

**Recommended approach:** Make clock-in the primary interaction and treat work location as editable inline context inside that interaction. The page should be the more confident, review-oriented version of quick clock-in from the app shell, not a separate interaction model.

## Context

- The previous redesign direction over-emphasized work location as a standalone choice before clock-in.
- That made the experience feel toy-like and visually overbuilt for a workflow that should feel calm and precise.
- The product already has a quick clock-in entry point in the app shell, so the full `/time-tracking` page must relate to that experience rather than invent a competing pattern.
- The user wants `/time-tracking` to feel like the professional, confident version of clock-in: visible context, easy correction, and strong operational clarity.
- Product context from `AGENTS.md` calls for a calm, trustworthy, blue-led operational interface rather than playful or overly expressive UI.

## Scope

- Redesign the top section of `/time-tracking` around a new clock-in flow.
- Redefine how work location is shown and changed during clock-in.
- Align the page flow with the shell quick clock-in mental model.
- Rebalance summaries and history around the new primary action.
- Preserve existing backend behavior, compliance rules, and time-tracking data requirements.

## Decisions

### 1. Core interaction model

- The page should not begin with a location picker.
- The page should begin with a primary clock-in action surface.
- Work location should appear inside that surface as the current shift context.
- The user flow should be:
  - review current context
  - optionally change it
  - clock in

This replaces the earlier “choose location first, then act” model with a more professional “confirm and act” model.

### 2. Relationship to shell quick clock-in

- The shell quick clock-in remains the fastest way to start work.
- `/time-tracking` becomes the more confident and review-oriented version of the same action.
- Both surfaces must share the same mental model:
  - a current work location is visible
  - it can be changed
  - clock-in is the main action
- The shell version is condensed.
- The page version is calmer, more legible, and surrounded by supporting context.

Users should never feel that location works differently depending on where they start their shift.

### 3. Clocked-out top section

- The top section should lead with a short operational header such as `Ready to Start`.
- Directly below that, render a single composed clock-in row as the dominant action surface.
- The row should be structured around:
  - a primary `Clock In` action
  - visible current location context, for example `from Home`
  - a restrained `Change` affordance
- The current location should be preselected from the last-used value when available, but always visible.
- The user should be able to clock in immediately if the current location is correct.

This keeps the experience one-click by default while preserving confidence and reviewability.

### 4. Work-location behavior

- Work location remains part of the clock-in action and must be visible before submission.
- The default location should use remembered state when available.
- The current location must never be hidden behind an implicit default.
- If there is no remembered location or the remembered value is no longer valid, the default visible state should be `Location Required` instead of silently assuming a value.
- In that state, the primary action remains visible but disabled until the user selects a valid location.
- The `Change` affordance should open a compact inline editor attached to the clock-in row.
- The editor should not look like tabs, segmented controls, or a card gallery.
- The editor should use a compact single-select pattern with text-first options:
  - `Office`
  - `Home`
  - `Field`
  - `Other`
- Icons may support those options, but text must carry the meaning.

This makes work location feel like shift context, not like a mini-app.

### 5. Work-location editing surface

- The edit surface should open inline directly below or attached to the main action row.
- It should feel temporary and focused, not persistent and dominant.
- The recommended interaction is a compact list or popover-style single-select chooser.
- Selecting a new location should update the main row immediately.
- The edit surface should then collapse or close naturally once the selection is made.
- During clock-in submission, the visible location context must remain stable and non-editable.

If the default state is `Location Required`, opening the edit surface is the first required step before the main action can be used.

The desired feeling is “small correction inside the action,” not “enter a separate setup mode.”

### 5a. Shared interaction contract with quick clock-in

- Both shell quick clock-in and page clock-in must share the same core states:
  - `Ready with remembered location`
  - `Location required`
  - `Editing location`
  - `Submitting clock-in`
  - `Clocked in`
- Both surfaces must use the same core language model:
  - current location is rendered inline with the action
  - location changes are triggered by `Change`
  - pending state keeps the submitted location visible and locked
- The page version may add calmer framing and supporting context around that interaction.
- The shell version may compress the same interaction into a smaller wrapper.
- Neither surface should introduce a different location-selection metaphor such as tabs, large cards, or a detached form section.

This contract is intended to prevent drift between shell and page implementations.

### 6. Clocked-in and post-clock-out states

- The same top surface should remain in place after clock-in.
- When clocked in, that surface should become `Current Session` rather than switching to a different visual model.
- The action row should be replaced by current session information and the clock-out action.
- After clock-out, notes should remain in the same surface as a continuation of the shift flow.
- The post-clock-out notes state should feel like a closing step, not a reset to a new generic card.

This preserves continuity and avoids abrupt mode changes.

### 7. Compliance and error handling

- Compliance messages must remain close to the primary action surface.
- Blocking states must appear inline with the action, not detached elsewhere on the page.
- Warning states may remain visually subordinate, but still part of the same action context.
- Error feedback should explain what failed and remain close to the interaction that caused it.
- If clock-in fails, the visible location context must remain intact so the user can understand what was submitted.
- If compliance blocks clock-in, the action row must stay visible with the selected location still shown.
- In a blocked state, the primary clock-in action becomes unavailable and the blocking explanation replaces it as the immediate next step.
- If an exception request is available, that action should sit directly inside the same inline block rather than forcing users to search elsewhere.
- The location `Change` action remains available in blocked and warning states unless policy explicitly prevents location editing.
- If the user changes location while a warning or block is shown, validation must rerun and the inline message must update within the same surface.

The user should always feel in control of what the system is doing.

### 8. Summaries and history

- Summary metrics remain on the page but move clearly into supporting roles.
- They should sit below the clock-in surface and no longer compete with it for attention.
- History remains useful as review space, not as part of the immediate start-shift decision.
- `/time-tracking` should feel like:
  - action first
  - operational context second
  - history third

This keeps the page useful without diluting the main job.

### 9. Copy direction

- Copy should be short, operational, and direct.
- The primary action should read as a clear commitment, not as generic SaaS interface language.
- Work location should be phrased as current context rather than as a form label in the default state.
- `Change` should be the secondary verb for editing location.
- Supporting copy should be minimal and only appear when it reduces ambiguity.

The page should sound like a precise workforce tool, not a consumer app.

## Component model

- `ClockInOutWidget` remains the top-level orchestrator for the page surface.
- The standalone work-location selector model should be replaced with a context-oriented location control integrated into the clock-in row.
- The clock-in row and location editor should be separate focused subcomponents so the default and editing states remain clean.
- Quick clock-in and page clock-in should eventually share the same work-location interaction primitive, even if their wrappers differ.
- Summary and history components remain separate and subordinate.

## Data flow

- Preserve existing location persistence and clock-in/out mutation behavior.
- Preserve the remembered last-used work location.
- Preserve compliance enforcement and exception-request integration.
- No backend or schema changes are required for this redesign direction.
- Translation keys should support both the default inline location state and the edit-state copy.

## Accessibility and interaction

- The default state must expose the current work location as readable text.
- The `Change` affordance must be a real button.
- The location edit surface must use semantic single-select controls.
- The editing surface must remain keyboard accessible and easy to dismiss.
- During mutation, location must remain visible but not editable.
- Post-clock-out notes must remain properly labeled and accessible.

## Testing strategy

- Verify the default clocked-out state supports immediate clock-in with visible current location.
- Verify location changes update the inline context correctly.
- Verify the edit surface behaves correctly on mobile and desktop.
- Verify clock-in submission freezes the visible context while pending.
- Verify quick clock-in and page clock-in remain conceptually aligned.
- Verify clocked-in and post-clock-out states preserve continuity in the same surface.
- Verify summaries and history remain secondary in layout and hierarchy.

## Risks and mitigations

- Risk: the inline context becomes too dense if too many settings move into the row.
  - Mitigation: keep only work location in the default row and resist pulling in extra fields unless absolutely necessary.
- Risk: page and shell implementations drift again over time.
  - Mitigation: treat them as the same interaction primitive with different wrappers.
- Risk: location changes feel hidden if the `Change` affordance is too subtle.
  - Mitigation: keep the current location visible and make `Change` consistently placed and obvious.
- Risk: the page still feels dashboard-heavy after fixing the action flow.
  - Mitigation: further reduce the visual weight of summaries and keep the top action surface dominant.

## Out of scope

- Redesigning the quick clock-in shell entry point in this phase.
- Reworking project, work-category, or other secondary shift metadata unless later design work proves it is necessary.
- Replacing the time-entry table architecture.
- Changing compliance policy logic or clock-in/out backend behavior.
