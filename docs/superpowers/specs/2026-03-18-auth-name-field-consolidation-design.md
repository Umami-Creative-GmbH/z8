# Auth Name Field Consolidation

## Summary

Remove the duplicate user-facing `name` field from the webapp and standardize on `firstName` and `lastName` as the only editable personal-name inputs. Keep Better Auth's required `user.name` field as an internal compatibility value derived from the separate fields so existing session consumers continue to work.

## Approved Direction

### Core Decision

- `firstName` and `lastName` become the only user-facing name inputs in sign-up and profile settings
- Better Auth `user.name` remains in use internally, but is always derived from the structured fields
- Existing consumers of `session.user.name` are preserved for now to avoid a broad display-name migration

### Alternatives Rejected

- Keep all three fields and rely on users or forms to keep them aligned -> preserves duplication and drift risk
- Remove `name` everywhere in the app immediately -> cleaner long-term, but too large for this change because `session.user.name` is still used broadly

## Goals

- Eliminate duplicate name entry in sign-up and profile settings
- Make structured personal name fields the only editable source of truth in the UI
- Preserve Better Auth compatibility without exposing a separate editable display-name concept
- Keep the change localized to auth and profile flows
- Maintain existing session and display behavior elsewhere in the app

## Non-Goals

- No app-wide migration away from `session.user.name`
- No redesign of broader employee display-name logic across scheduling, approvals, analytics, or organization views
- No direct edits to `apps/webapp/src/db/auth-schema.ts`
- No tenant-level settings or auth-provider behavior changes unrelated to name capture

## Current State

The current implementation duplicates personal-name data across two editing surfaces:

- `apps/webapp/src/components/signup-form.tsx` captures a single `name` field and sends it directly to Better Auth sign-up
- `apps/webapp/src/components/settings/profile-form.tsx` exposes both an editable `name` field and separate `firstName` / `lastName` fields
- `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts` validates and updates Better Auth with a raw `name`
- employee personal data already stores `firstName` and `lastName`, and onboarding already treats them as separate required fields

This creates avoidable inconsistency: users can edit `name` independently from `firstName` and `lastName`, and sign-up does not collect the structured fields that the app already uses elsewhere.

## User and Intent

### Who This Is For

- new users creating accounts
- existing users updating their own profile information
- downstream app surfaces that still depend on `session.user.name` for compact labels or audit text

### Primary Job

Collect and maintain a single coherent representation of a person's name without making users enter or manage duplicate fields.

### Feel

Clear, predictable, and operational. Users should understand that they provide their first and last name once, and the system handles the compatibility value behind the scenes.

## Data Model Direction

### Structured Stored Fields

- Better Auth `user.firstName`
- Better Auth `user.lastName`
- org-scoped `employee.firstName`
- org-scoped `employee.lastName`

The app keeps `firstName` and `lastName` as the only user-facing editable concepts. Better Auth stores account-level structured values for sign-up and session access. The employee table continues to store org-scoped structured values used by existing workforce flows.

### Derived Compatibility Value

- Better Auth `user.name`

This remains required at Better Auth integration boundaries and continues to back existing `session.user.name` consumers. It is not edited directly in the UI.

### Derivation Rule

Build the compatibility value with:

- `const name = [firstName, lastName].map((value) => value.trim()).filter(Boolean).join(" ")`

For this project scope, both fields are required in sign-up and in the main profile save flow. Avatar-only updates must not require re-entering name data.

### Persistence Policy

- sign-up persists `firstName` and `lastName` into Better Auth user fields and derives `name`
- profile save updates Better Auth `firstName`, Better Auth `lastName`, and derived Better Auth `name`
- profile save also updates the current user's active-org employee record when one exists
- if no employee record exists for the active org, the auth-level fields still update successfully and employee creation remains owned by existing onboarding / member-creation flows

This keeps sign-up data from being transient while preserving the app's existing org-scoped employee model.

## Component and File Design

### `apps/webapp/src/components/signup-form.tsx`

Replace the single `name` field with `firstName` and `lastName` and migrate the form to `@tanstack/react-form` as part of this touched-form change.

Required changes:

- update local form state shape
- update Zod validation to require both fields
- update field-level validation and first-invalid-field focus behavior
- update labels, placeholders, autocomplete attributes, and error IDs
- pass `firstName`, `lastName`, and derived `name` to Better Auth sign-up

The submitted Better Auth payload remains compatible, persists structured fields at account creation time, and no longer exposes a duplicate freeform name field.

### `apps/webapp/src/components/signup-form.test.tsx`

Update tests to reflect the new structured fields and the migrated form behavior.

Required coverage:

- first invalid field focus when first name is missing
- validation messaging for first and last name
- sign-up payload composition using `firstName`, `lastName`, and derived `name`
- continued password and turnstile behavior after the field change

### `apps/webapp/src/components/settings/profile-form.tsx`

Remove the standalone editable `name` field from the profile settings form and migrate the edited form flow to `@tanstack/react-form`.

The form should:

- keep avatar and email sections intact
- keep `firstName` and `lastName` in the personal information section
- derive the auth compatibility name during save instead of letting the user edit it directly
- prefill from employee `firstName` / `lastName` when available, otherwise fall back to Better Auth `firstName` / `lastName`

This reduces the profile surface to one user-facing representation of personal name data.

### `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`

Refactor the profile update action contract so Better Auth is updated with structured fields plus a derived value rather than a user-provided freeform `name`.

The action should:

- validate the relevant incoming shape
- normalize image handling exactly as it does today
- compute the compatibility `name` on the server before calling `auth.api.updateUser`
- avoid trusting a client-provided raw `name`
- update Better Auth `firstName` and `lastName` alongside the derived `name`
- update the current user's active-org employee record with the same structured fields when one exists

The main save contract should require `firstName` and `lastName` and derive `name` on the server. Avatar-only updates should either use a dedicated image-only auth action or preserve existing structured values server-side without requiring the client to resend a raw `name`.

### `apps/webapp/src/lib/validations/profile.ts`

Update profile validation so it matches the post-duplication contract.

At minimum:

- remove reliance on a user-editable standalone `name`
- validate `firstName` and `lastName` for the main profile save path
- allow an image-only update path if the implementation keeps avatar upload/removal separate
- preserve existing image validation behavior

### Auth Typing and Helpers

Review auth-related types and helpers that currently assume a raw editable `name` input, especially:

- `apps/webapp/src/lib/effect/services/auth.service.ts`
- any local action contracts or helper types touched by the profile update path

Add Better Auth user additional fields for `firstName` and `lastName` in `apps/webapp/src/lib/auth.ts`, then regenerate the generated auth schema through the documented flow rather than editing `apps/webapp/src/db/auth-schema.ts` directly.

`session.user.name` remains part of the returned session shape for compatibility and should not be removed in this scope.

## Better Auth Handling

### Integration Boundary

Better Auth still expects and returns `name`, so the app keeps supplying that field where required.

### App-Level Policy

- `name` is compatibility data
- `firstName` and `lastName` are the only user-facing inputs
- Better Auth also stores structured `firstName` and `lastName` so sign-up data persists immediately
- server-side code derives compatibility values whenever it persists name updates through Better Auth

### Schema Rules

- do not manually edit `apps/webapp/src/db/auth-schema.ts`
- if auth configuration changes require regeneration, use the documented Better Auth generation flow from project docs

## Error Handling

### Sign-Up

- both `firstName` and `lastName` are required
- the first invalid field receives focus, preserving the current accessibility pattern
- field-level errors stay associated via `aria-describedby`
- Better Auth receives structured fields plus the derived compatibility name

### Profile

- the main profile flow should not accept a separate freeform `name`
- the derived Better Auth `name` should be produced from validated structured fields
- avatar upload and removal must still work when the user is only changing image data
- when employee name data is missing, the profile UI should prefer auth-level structured fields before falling back to blanks

### Data Integrity

The implementation should prevent drift by ensuring the compatibility value is always derived during the relevant write path, never independently edited.

## Testing Strategy

Follow TDD during implementation.

### Tests To Add or Update First

- `apps/webapp/src/components/signup-form.test.tsx`
- profile action tests if they exist or new focused tests around the profile update contract
- profile form tests if practical for the current component structure

### Expected Assertions

- sign-up renders first and last name instead of a single name field
- validation errors target the correct field IDs and focus order
- sign-up passes `firstName`, `lastName`, and derived `name` to Better Auth
- profile updates compute the compatibility name from first and last name and no longer expose a duplicate editable field
- profile save synchronizes auth-level and employee-level structured fields for the active organization when that employee record exists
- avatar-only update behavior remains functional after the contract change

## Security and Trust Boundaries

- do not trust the client for the compatibility `name` value
- continue using existing authenticated profile update paths
- keep auth/session semantics unchanged outside the narrowed name-field behavior
- avoid unrelated auth configuration or provider changes while touching sensitive code

## Rollout Notes

This is intentionally a compatibility-first change. The app will still read `session.user.name` broadly after implementation, but new writes from sign-up and profile will come from structured first/last-name inputs only. A future project can migrate display surfaces away from `user.name` if the team wants a fuller structured-name model.
