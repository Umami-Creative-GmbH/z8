# Connected Masked Time Input Design

## Summary

Update the shared webapp `TimeInput` so users can type times directly with a mask while still having access to the existing `timepicker-ui` picker through a connected trigger button. The field remains preference-aware: 24-hour users type `HH:mm`; 12-hour users type `hh:mm` with an adjacent AM/PM toggle. All form values continue to emit normalized `HH:mm` strings.

## Goals

- Let users type time values without opening the picker by default.
- Open the picker only when the connected trigger button is pressed.
- Use a proven masking library rather than custom caret and mask handling.
- Preserve the existing `TimeInput` API, time format preference behavior, and normalized `HH:mm` form values.
- Keep the UI compact and field-like, with the input, optional AM/PM toggle, and picker trigger visually connected.

## Non-Goals

- Do not change how time values are stored or validated outside `TimeInput`.
- Do not replace `timepicker-ui` in this iteration.
- Do not alter date inputs or date picker behavior.
- Do not add organization-level configuration for time format.

## Recommended Approach

Use `react-imask` for the editable mask and keep `timepicker-ui` for the popup picker. This avoids reinventing masking behavior, limits the scope to the shared `TimeInput`, and keeps the existing picker dependency that already supports the user's 12-hour or 24-hour preference.

Alternatives considered:

- Manual masking inside `TimeInput`: fewer dependencies, but higher risk around deletion, caret movement, partial values, and edge cases.
- Replacing `timepicker-ui`: potentially cleaner long-term, but higher regression risk because `TimeInput` is used across scheduling, time tracking, and settings.

## Component Behavior

`TimeInput` renders as a grouped field:

- Masked text input on the left.
- Optional AM/PM toggle next to the input when the active time format is `12h`.
- Connected clock button on the right that opens the picker.

The input is editable. Focusing or clicking the input should not open the picker. The picker should open only from the trigger button.

For 24-hour users:

- The input mask is `HH:mm`.
- Valid hours are `00` through `23`.
- Complete valid input emits the same normalized `HH:mm` value.

For 12-hour users:

- The input mask is `hh:mm`.
- Valid hours are `01` through `12`.
- The AM/PM toggle is visible and connected to the field group.
- Complete valid input plus the active AM/PM marker emits a normalized `HH:mm` value.

Incomplete or invalid partial input can remain visible during editing, but it should not emit a new normalized value until it becomes valid. Picker confirmation updates the visible masked input, updates the AM/PM toggle when relevant, and emits one normalized `HH:mm` change event.

## Data Flow

`TimeInput` continues to accept controlled or uncontrolled input props. External values remain normalized `HH:mm` strings. The component formats those values for display according to the active `timeFormat` from the explicit prop or `UserPreferencesProvider`.

The component may keep local draft display state so users can enter incomplete masked values in controlled forms. The draft should initialize from `value` or `defaultValue`, update from external `value` changes when the field is not actively being edited, and resynchronize after a valid typed value, AM/PM change, picker confirmation, or blur.

On typed input:

- Parse the masked display value.
- Validate hour and minute ranges for the active format.
- Combine with AM/PM in 12-hour mode.
- Emit a synthetic React change event with `target.value` and `currentTarget.value` set to normalized `HH:mm`.

On AM/PM toggle:

- If the current masked value is complete and valid, emit the converted normalized value.
- If the current masked value is incomplete, update only the local marker state.

On picker confirmation:

- Normalize `timepicker-ui` confirm data to `HH:mm`.
- Update the display value and marker state.
- Emit the normalized value through the existing `onChange` contract.

## UI And Accessibility

The field group should match existing input styling: same height, border radius, focus ring, disabled opacity, and invalid styling. Internal seams should feel connected rather than like separate floating controls.

The picker trigger should be a real `button` with `type="button"`, a clock icon from `@tabler/icons-react`, and an accessible label such as `Open time picker`. Disabled state must disable the input, AM/PM toggle, and picker trigger.

The AM/PM toggle should be keyboard accessible and announce its state. It can be a compact two-option segmented control or a single toggle button that switches between `AM` and `PM`, as long as it remains visually attached to the field.

## Dependency

Add `react-imask` to the webapp package. It provides React bindings for input masking and avoids custom mask logic. Use `pnpm` to add the dependency.

## Testing

Update focused `TimeInput` tests to cover:

- The input is a text input, not a native time input.
- `timepicker-ui` receives the active 12-hour or 24-hour clock type.
- The picker does not open from typing or input focus.
- The connected button opens the picker.
- 24-hour masked typing emits normalized `HH:mm` values.
- 12-hour masked typing plus AM/PM emits normalized `HH:mm` values.
- Toggling AM/PM emits a converted value when the current input is complete.
- Picker confirmation still emits normalized values and updates display state.
- Disabled state applies to input, toggle, and trigger.

## Verification

Run the focused `TimeInput` test file after implementation. If dependency or type changes affect the package, run the relevant webapp typecheck or test command available in the repo scripts.
