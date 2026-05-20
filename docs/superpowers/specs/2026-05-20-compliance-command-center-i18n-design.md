## Goal

Move hardcoded user-facing strings in the `/compliance` command center to Tolgee `t()` calls, including client UI chrome and display copy currently produced by command-center loaders/view models.

## Scope

- Update `ComplianceCommandCenterPage` and its child components to use `useTranslate()`/`t()` for headings, empty states, status labels, links, facts, critical event titles/descriptions, coverage notes, and refreshed timestamp labels.
- Replace server-generated English display text with stable translation keys plus interpolation parameters where the text is rendered on the client.
- Add `compliance.commandCenter.*` keys to `messages/compliance/{en,de,es,fr,it,pt}.json`.
- Keep `/compliance` permissions, data loading, auto-refresh, status calculation, ordering, links, and route behavior unchanged.

## Approach

The server-side command-center loaders will continue computing statuses, counts, links, and event metadata. Instead of returning final English strings for all display fields, they will return lightweight translation descriptors containing a key and parameters. Client components will render these descriptors through Tolgee `t()` with fallback strings, preserving the existing UI while enabling translations.

## Testing

Add/adjust focused tests for `ComplianceCommandCenterPage` to prove translated page chrome and interpolated command-center data render. Run the existing command-center component tests and relevant command-center lib tests after implementation.

## Constraints

- Do not change organization scoping or permissions.
- Do not introduce database or API changes.
- Do not alter compliance risk logic, thresholds, sorting, or link destinations.
