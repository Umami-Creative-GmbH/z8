# Incomplete manual time input — #269

## Approved scope

The user approved this design on 2026-09-13 for T05 of #264. A visible
incomplete or invalid time must immediately invalidate the form's submitted
value. Preserve editable partial text and existing valid-entry interactions.
The manual dialog already uses TanStack Form.

## Interface and state

Keep `TimeInput`'s existing change-event interface: complete valid input emits
normalized 24-hour `HH:mm`; incomplete, invalid, or cleared input emits `""`.
The component owns the visible draft and AM/PM selection. A controlled parent
echoing that empty value must not erase the partial draft or reset PM to AM.
External value/format changes must still synchronize the display, and returning
to a previously valid time must emit that value again. Picker confirmation
continues to produce a valid normalized value.

An explicit `{ text, value, validity }` API was considered but rejected because
it requires broader caller migration for this bounded correction.

## Form integration and feedback

Add strict minute-field validation at the existing TanStack fields. Validate on
change and submission so both button/keyboard submission and form submission
without browser constraint checks reject invalid values before calling the
manual-entry action. Use `TFormLabel`, `TFormControl`, and `TFormMessage` for
associated labels, invalid state, and localized actionable feedback.

## Verification

Use the real `TimeInput`, mask, and TanStack form. The existing manual-dialog
test's plain-input substitution must be removed. Stub only unrelated loaders
and the server-action boundary. Exercise valid → partial/invalid → valid,
keyboard deletion/replacement, masking across the colon, 12-hour PM continuity,
controlled echoes, external resets, and picker-confirmed recovery. Verify the
action is not called with stale values and receives the corrected values.

The user's current request authorizes focused tests, regular typechecking, and
one final full-suite run. No database access, build, deployment, historical
repair, or operational activation is authorized. Record actual evidence and
environment blockers; DOM tests do not prove deployment or database guarantees.

## Release boundary

This is the parent-approved early truthfulness correction. It introduces no
new timezone interpretation, policy, persistence, recovery, evidence lifecycle,
or protocol ownership. The parent's wider adoption and pilot gates remain
separate obligations.
