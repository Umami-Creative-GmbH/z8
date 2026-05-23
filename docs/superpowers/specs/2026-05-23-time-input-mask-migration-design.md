# Time Input Mask Migration Design

## Goal

Replace `react-imask` in the webapp with a modern, low-dependency implementation for the existing time input mask. The migration should preserve current `TimeInput` behavior while removing `react-imask` from `apps/webapp/package.json` and the lockfile.

## Context

`react-imask` is only used by `apps/webapp/src/components/ui/time-input.tsx`. The component uses it to enforce an `HH:mm` text mask while a separate hidden anchor input integrates with `timepicker-ui`. Existing tests cover the important behavior: masked text input rendering, picker synchronization, 12-hour and 24-hour display, normalized change events, incomplete typed values, clearing, AM/PM conversion, and picker modal placement.

## Chosen Approach

Use a regular React `<input type="text">` with a small local formatter/validator instead of adding another mask package.

This keeps the implementation modern and dependency-light. The mask requirement is narrow enough that a package adds more surface area than value.

## Behavior

The typed input should:

- Keep only digits from user-entered text.
- Limit typed digits to four characters.
- Insert `:` after the hour portion when enough digits exist.
- Allow incomplete states such as `1`, `14`, and `14:` without emitting normalized time changes.
- Emit normalized `HH:mm` storage values only when the typed value parses as a valid time for the active format.
- Emit an empty string when a populated field is cleared.
- Preserve existing 12-hour AM/PM conversion behavior.
- Preserve existing picker-confirm behavior and hidden picker anchor synchronization.

## Implementation Scope

Update `TimeInput` to remove `IMask` and `IMaskInput` imports. Add a small local helper for formatting raw typed values into the display mask, then render a standard input using the existing styling, accessibility props, refs, and change handling.

Remove `react-imask` from `apps/webapp/package.json` and refresh `pnpm-lock.yaml` with pnpm.

## Testing

Run the existing `TimeInput` tests and adjust or extend them only where needed to cover the local formatter behavior. The existing tests should continue to validate the migration contract.

## Non-Goals

- Do not introduce a general-purpose masking abstraction.
- Do not change `timepicker-ui` integration.
- Do not change the stored time format.
- Do not migrate unrelated masked or redacted text usages.
