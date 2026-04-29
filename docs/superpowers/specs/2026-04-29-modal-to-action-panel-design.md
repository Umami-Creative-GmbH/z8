# Modal To Action Panel Design

## Goal

Replace ordinary webapp feature modals with a consistent right-side panel pattern so users can work in context with more space. Keep true blocking confirmations as alert dialogs where the interruption is intentional and safer.

## Current Context

The webapp already has Radix-based `Dialog`, Radix-based `Sheet`, Vaul-based `Drawer`, and Radix `AlertDialog` primitives. Feature code currently uses many `Dialog` components for create/edit forms, review flows, detail views, webhook logs, policies, time entries, travel expenses, and settings workflows. `Sheet` already implements the right-side overlay behavior closest to the desired interaction, while the existing `Drawer` primitive is more oriented around Vaul's drawer behavior and bottom/mobile affordances.

## Design Decision

Add an app-level `ActionPanel` primitive built on top of the existing `Sheet` primitive. Use it as the default shell for non-blocking product workflows that currently use `Dialog`.

`ActionPanel` should compose `Sheet` instead of duplicating Radix dialog behavior. This preserves portal rendering, focus trapping, escape handling, overlay behavior, and accessibility semantics while giving feature code a product-specific primitive with consistent layout and sizing.

`AlertDialog` remains the correct primitive for destructive or blocking confirmations. `Popover` remains the correct primitive for anchored lightweight controls such as date pickers, searchable selects, and small trigger-bound menus.

## Component API

Create a small API that mirrors the existing dialog mental model so migrations stay mechanical:

- `ActionPanel`
- `ActionPanelTrigger`
- `ActionPanelContent`
- `ActionPanelHeader`
- `ActionPanelTitle`
- `ActionPanelDescription`
- `ActionPanelBody`
- `ActionPanelFooter`
- `ActionPanelClose`

`ActionPanelContent` should support width variants instead of each feature inventing one-off sizing classes:

- `default`: standard form and detail panels.
- `wide`: complex editors and long workflows, such as policy forms.
- `compact`: short forms or lightweight details.

The default placement is the right side. On small screens the panel should remain usable by taking nearly the full viewport width, with a scrollable body and accessible close affordance.

## Layout Behavior

`ActionPanelContent` provides a consistent shell:

- Fixed right-side overlay above page content.
- Backdrop overlay behind the panel.
- Header at the top with title, optional description, and close button.
- Scrollable body for long forms and detailed content.
- Footer at the bottom for submit/cancel or secondary actions.
- Safe spacing, focus styles, dark-mode compatibility, and responsive width defaults.
- Optional `showCloseButton` behavior matching the current `DialogContent` convention.

Feature forms should keep their current state, validation, and submit logic. The migration changes presentation, not domain behavior.

## Migration Rules

Convert current feature-level `Dialog` usages to `ActionPanel` when they represent normal workflows:

- Create and edit forms.
- Detail, log, history, and review panels.
- Approval or decision forms that are not destructive confirmations.
- Setup, configuration, import, export, and webhook workflows.
- Large content areas where right-side space improves usability.

Keep `AlertDialog` when the interaction is intentionally blocking:

- Delete confirmations.
- Irreversible actions.
- Actions where the safest UX is explicit confirm/cancel before proceeding.

Keep `Popover` when the interaction is anchored and transient:

- Date pickers.
- Select/search menus.
- Clock or quick action popovers.

`Dialog` should no longer be the default primitive for product workflows. It may remain available for internal or third-party patterns where centered dialog semantics are still appropriate, such as command-style primitives.

## Implementation Shape

Most migrations should be mechanical replacements:

- `Dialog` to `ActionPanel`.
- `DialogContent` to `ActionPanelContent`.
- `DialogHeader` to `ActionPanelHeader`.
- `DialogTitle` to `ActionPanelTitle`.
- `DialogDescription` to `ActionPanelDescription`.
- `DialogFooter` to `ActionPanelFooter`.

For larger forms, move scrollable middle content into `ActionPanelBody` and place submit/cancel actions in `ActionPanelFooter` so actions remain reachable while content scrolls.

## Testing And Verification

Verification should cover both code and behavior:

- Check that `ActionPanel` composes `Sheet` correctly and preserves accessibility semantics.
- Search for remaining feature-level `Dialog` imports and inspect any leftovers.
- Ensure preserved `AlertDialog` usages are actual blocking confirmations.
- Run formatting, type, lint, and test checks available for the webapp.
- Browser spot-check representative pages: one short form, one long form, one detail or log panel, and one preserved delete confirmation.

## Non-Goals

- Do not replace destructive `AlertDialog` confirmations with drawers.
- Do not replace anchored popovers with panels.
- Do not change form validation, submit behavior, authorization, or organization scoping as part of this UI-shell migration.
- Do not remove the low-level `Dialog` primitive unless follow-up inspection proves it is unused or unnecessary.
