## Goal

Replace hardcoded user-facing strings in the `/team/absences` webapp view with Tolgee `t()` calls so the table, controls, empty state, pagination, record action, and nearby record-absence dialog text can be translated.

## Scope

- Update `team-absences-table.tsx` to use `useTranslate()` for labels, placeholders, sortable header ARIA text, table headers, empty state copy, action ARIA labels, and pagination copy.
- Update `record-absence-dialog.tsx` where remaining dynamic or validation strings are hardcoded, including the employee-specific dialog title and date range errors where they originate in this component.
- Add matching `team.absences.*` message keys to all root webapp locale files: `en`, `de`, `es`, `fr`, `it`, and `pt`.
- Keep existing route behavior, form submission behavior, table structure, and URL parameter handling unchanged.

## Approach

Use inline `t(key, fallback, params)` calls following the existing app pattern. Dynamic labels such as `Record absence for {name}` and pagination counts will use interpolation parameters instead of string concatenation. Existing tests mock `t()` with fallback behavior, so tests should remain behavior-focused and only need adjustment if interpolation support is required in the mock.

## Testing

Run the focused `team-absences-table` test file after the change. If the repository test runner exposes lint/type errors for the touched files, fix those before completion.

## Constraints

- Do not edit generated auth schema.
- Do not change tenant scoping or server data access.
- Do not introduce new UI behavior or layout changes.
