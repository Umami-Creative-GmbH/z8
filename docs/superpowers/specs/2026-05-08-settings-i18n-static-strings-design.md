# Settings i18n Static Strings Design

## Goal

Remove mixed-language UI in the settings area by converting static user-facing strings to Tolgee `t()` calls. This covers settings routes and settings components only, so the change is broad enough to fix the reported class of bugs while staying reviewable.

## Scope

In scope:

- `apps/webapp/src/app/[locale]/(app)/settings/**`
- `apps/webapp/src/components/settings/**`
- Visible static UI copy: headings, card titles, descriptions, labels, placeholders, select options, badges, empty states, table headers, dialogs, validation copy, toasts, loading text, button text, screen-reader labels, and aria labels.
- Static English copy already wrapped in component config arrays or option definitions.
- Existing German strings in settings UI when they are static user-facing copy rather than proper nouns.

Out of scope:

- Non-settings routes and non-settings components.
- Generated translations or edits to `apps/webapp/messages/**/*.json`; Tolgee CLI extraction will handle keys later.
- Proper nouns, product names, route names, organization names, IDs, URLs, and code tokens unless they are embedded in explanatory copy.
- Broad component architecture refactors unrelated to i18n.

## Approach

Use inline static Tolgee keys with English fallback values:

```tsx
const { t } = useTranslate();

<CardTitle>{t("settings.permissions.employeePermissions", "Employee Permissions")}</CardTitle>
```

Rules:

- Use static literal keys only. Do not construct keys dynamically, so Tolgee extraction can find them.
- Prefer namespaced keys under the existing settings domain, e.g. `settings.employees.directory.refresh`, `settings.teams.detail.addMember`, or `settings.enterprise.identity.providerPreset`.
- Keep fallbacks as the current English source copy unless the current copy is already German.
- For option arrays defined outside components, either move their display copy inside the component where `t()` is available or store translation keys/defaults in the array and resolve them during render.
- Preserve behavior and layout. The change should be copy plumbing, not UI redesign.

## Components And Data Flow

Each affected client component will import or reuse `useTranslate()` from `@tolgee/react`. Parent components may pass translated labels into smaller reusable selectors when those selectors are shared or intentionally generic. Static selectors can also accept optional `labels` props, as already done for employee role and contract type selectors.

Server components and route pages should use existing project patterns for translation access if present. If a server component cannot use `useTranslate()`, move only the user-facing copy into a client child that already owns the UI interaction, or keep the smallest possible wrapper consistent with nearby code.

## Error Handling

Toasts and validation messages must be wrapped in `t()` with stable keys. Existing backend or action error strings should not be translated at the call site unless they are static frontend fallbacks. Dynamic server-provided errors may continue to pass through unchanged.

## Testing

Add or update focused tests for high-risk settings views with large translated surfaces. Tests should verify that representative German translation stubs render and that the previous English static strings are not present. Existing behavior tests should be updated to query translated labels through the same fallback text when full locale setup is not practical.

## Verification

Run:

- Focused Vitest tests for changed settings components.
- `pnpm exec biome check` for changed TS/TSX files.
- `pnpm exec tsc --noEmit --pretty false`.
- React Doctor diff scan after React changes.

Message JSON files are intentionally not part of this implementation because Tolgee CLI extraction will be run separately.
