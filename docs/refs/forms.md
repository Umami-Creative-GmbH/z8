# Forms Reference

## Open This When

- You are creating or modifying a form.
- You are migrating `react-hook-form` code.
- You need canonical form UI and validation patterns.

## Read First

- `apps/webapp/src/components/ui/tanstack-form.tsx`: shared primitives.
- `apps/webapp/src/components/ui/tanstack-form-utils.ts`: helpers like `fieldHasError`.

## Canonical Examples

- `apps/webapp/src/components/setup/setup-wizard-form.tsx`
- `apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.tsx`
- `apps/webapp/src/app/[locale]/onboarding/profile/page-client.tsx`

## Safe Form Rules

1. Use `@tanstack/react-form`.
2. Keep validators near field or form definitions.
3. Use shared form UI components for accessibility and error wiring.
4. Keep explicit typed `defaultValues` and submit payloads.
5. Preserve behavior when migrating legacy forms (validation, payload shape, permissions).
