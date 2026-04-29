# Shadcn Date Picker Replacement Design

## Context

The webapp currently uses native browser date inputs in multiple client-side forms and filter panels under `apps/webapp/src/components`. These controls render inconsistently across browsers and do not match the existing shadcn-based interface. Existing shadcn primitives already include `Calendar`, `Popover`, and `Button`, and the shadcn registry recommends composing a date picker from those primitives.

The requested scope is to replace all native `type="date"` inputs in `src/components` while leaving `type="time"` inputs unchanged.

## Goals

- Replace every native `type="date"` input under `apps/webapp/src/components` with a shadcn-style date picker.
- Preserve existing form state, validation, labels, layout, and server/action payload formats.
- Keep date values as date-only `YYYY-MM-DD` strings at component boundaries to avoid changing data flow.
- Leave time pickers and any non-date inputs unchanged.
- Use the existing shadcn primitives and local design system patterns.

## Non-Goals

- No date range picker abstraction unless an existing field already behaves as two separate start/end date fields.
- No changes to database schema, server actions, API payloads, or validation semantics.
- No replacement of native `type="time"` controls.
- No tenant-specific settings or environment variable changes.

## Approach Options

### Option 1: Shared DatePicker Wrapper (Selected)

Create a reusable `DatePicker` component in `src/components/ui/date-picker.tsx` using `Button`, `Calendar`, and `Popover`. Replace all date inputs with this component.

Benefits: consistent UI, centralized parsing/formatting, less duplicated code, easier future changes.

Trade-off: requires a small reusable abstraction.

### Option 2: Inline shadcn Pattern Everywhere

Copy the registry pattern into each form field.

Benefits: minimal abstraction.

Trade-off: repeated parsing, formatting, accessibility, and popover behavior across many files.

### Option 3: Form-Specific Wrappers

Create several wrappers for filters, dialogs, and TanStack forms.

Benefits: can tune each usage category.

Trade-off: more component surface area without clear value for this change.

## Selected Design

Add one reusable client component:

`src/components/ui/date-picker.tsx`

The component accepts a string-based interface compatible with the current native input usage:

- `value?: string` using `YYYY-MM-DD`.
- `onChange: (value: string) => void`.
- `placeholder?: string`.
- `disabled?: boolean`.
- `className?: string`.
- `id?: string`.
- Accessibility and validation passthrough where needed, such as `aria-invalid`, `aria-describedby`, and `name` if existing fields rely on them.

The trigger renders as an outline button with a calendar icon, muted placeholder text when empty, and a readable formatted date when a value is present. The popover contains the existing shadcn `Calendar` in `mode="single"`. Selecting a date emits a `YYYY-MM-DD` string and closes the popover. Clearing behavior will match current form behavior where empty strings are already accepted; fields that are required continue to be enforced by existing validation.

## Date Handling

The wrapper will parse `YYYY-MM-DD` values into a local calendar day for display and selection. It will emit `YYYY-MM-DD` strings, not `Date` objects, so existing form state and server-side parsing remain unchanged.

This avoids changing semantics in forms that already send strings to actions, schemas, or filters. It also avoids mixing time zones into date-only form inputs.

## Replacement Scope

Replace all native `type="date"` inputs currently found under:

- Absence request forms.
- Travel expense claim and policy forms.
- Manual time entry forms.
- Surcharge and rate history settings.
- Project, holiday, employee skill, and employment history forms.
- Payroll export, audit log, audit export, and clock-in import filters.
- Organization invite code expiry forms.

Time inputs remain native.

## Error Handling And Accessibility

Existing validation messages stay in their current locations. The date picker trigger will preserve disabled state and validation-related ARIA attributes where present. Labels continue to target the field through `id` where applicable. The popover/calendar uses the existing shadcn calendar behavior for keyboard navigation.

## Testing And Verification

After implementation:

- Search `apps/webapp/src/components` to confirm no `type="date"` inputs remain.
- Run the relevant project checks available without environment variables, starting with TypeScript/lint or the closest package script available.
- Spot-check representative forms for controlled value behavior: empty value, selecting a date, editing an existing date, disabled state, and validation display.

## Risks

- Some existing inputs may pass native-only props such as `min` or `max`. The implementation must map these to calendar disabled-date behavior where used.
- Some forms may rely on empty string values. The wrapper must preserve empty-string semantics instead of returning `undefined` to callers.
- Date-only string conversion must avoid UTC shifts.
