# Mobile Webapp Reconnect and Expo UI Design

## Goal

Restore the Expo mobile app so it works with the current webapp authentication and mobile API contracts, then move the mobile UX toward `@expo/ui` components as broadly as practical.

The work should keep the existing employee self-service scope: sign in through the webapp, select an active organization, clock in/out, view schedule, review requests, and manage absences. It should not add new mobile product capabilities beyond the UX conversion and compatibility fixes.

## Current State

The mobile app already has screens and data hooks for session, home, schedule, my requests, absences, absence requests, and profile organization switching. The matching webapp routes exist under `/api/mobile/*` and mostly align with the mobile data types.

The blocking compatibility issue is app authentication. The webapp now requires a PKCE-style `challenge` on `/api/auth/app-login` and a `verifier` on `/api/auth/app-exchange`. The mobile app still opens `/api/auth/app-login` without a challenge and exchanges codes with only `{ code }`.

Mobile TypeScript also fails because Luxon is used without `@types/luxon` in the mobile app dependency set.

## Scope

In scope:

- Add mobile PKCE verifier/challenge generation for app login.
- Exchange app auth codes with `{ code, verifier }`.
- Preserve support for callback errors such as `access_denied`.
- Stop relying on legacy direct `token` callback handling for sign-in; the supported callback path is `code` plus verifier exchange.
- Add missing Luxon typings for mobile typechecking.
- Install and use `@expo/ui`.
- Convert visible mobile screens toward `@expo/ui` universal components, using React Native primitives only where `@expo/ui` lacks a practical equivalent or where the current primitive is required by Expo Router or tests.
- Improve absence request date entry with a native date picking experience instead of raw `YYYY-MM-DD` text fields.
- Keep existing TanStack Query and TanStack Form data/control flow.
- Update tests for auth and screen behavior.

Out of scope:

- Adding new backend routes.
- Changing mobile API response shapes unless a verified mismatch appears during implementation.
- Reworking tenant permissions, CASL policy, billing access, or organization membership behavior.
- Full native iOS/Android custom components beyond what `@expo/ui` provides.

## Architecture

### Authentication

Create a small mobile auth PKCE utility inside `apps/mobile/src/lib/auth`.

It will expose functions for:

- Creating a random verifier suitable for SHA-256 challenge generation.
- Converting the verifier to a base64url SHA-256 challenge using Expo/React Native compatible APIs.
- Building the app-login URL with `app=mobile`, `redirect`, and `challenge`.
- Exchanging the returned code with both `code` and `verifier`.

The sign-in route will generate the verifier before calling `WebBrowser.openAuthSessionAsync`. The verifier stays in memory for the active sign-in attempt and is passed to the callback handler when the browser returns. This is sufficient because the callback is handled immediately by the same mounted screen. If the browser returns an error, the verifier is discarded.

The session token storage remains unchanged in `expo-secure-store`.

### API Contracts

Keep `createMobileApiClient` as the shared Bearer-token client for `/api/mobile/*` endpoints. It will continue sending `Authorization: Bearer <token>` and `X-Z8-App-Type: mobile`.

Organization switching can remain in the profile route for now because it calls the existing `/api/organizations/switch` endpoint with the same Bearer token and mobile header. If this code is touched, the fetch/error handling should be aligned with `MobileApiClientError` style, but no new abstraction is required unless reuse appears.

### Expo UI Conversion

Add `@expo/ui` and use universal imports where possible. Converted screen subtrees should be wrapped in `Host`. The implementation should prefer one `Host` per screen or major screen body, not many nested hosts, to keep layout predictable.

Primary conversion targets:

- Sign-in screen: `Host`, `Column`, `Text`, `Button`.
- Home screen: native layout groups for the primary clock action and summary rows; keep work-location selection accessible and simple.
- Profile screen: native list-style organization options and sign-out action.
- Schedule screen: native scroll/list presentation for shifts and effective schedule days.
- My Requests screen: native list rows with status/action metadata.
- Absences screen: native list/field groups where practical, with native buttons for request/cancel actions.
- Request Absence screen: native text, buttons, picker-like controls where practical, and native date picking.

Fallback rule: if `@expo/ui` cannot express a needed layout, accessibility state, alert, or testable interaction cleanly, keep the smallest React Native primitive for that part and document the exception in code only if it is not obvious.

Expo Router `Stack`, `Tabs`, and route files remain Expo Router primitives. The `@expo/ui` conversion applies to screen content, not navigation infrastructure.

### Date Picking

Replace manual start/end date text entry in the absence request form with a native date picker flow. Prefer `@expo/ui` drop-in replacement for `@react-native-community/datetimepicker` if it is stable in SDK 56 and works with tests. If the drop-in replacement is too limited during implementation, use `@react-native-community/datetimepicker` directly but keep the rest of the form conversion.

Dates will still be submitted as `YYYY-MM-DD` strings. Luxon remains the date formatting and validation library for consistency with the repo.

## UX Direction

The mobile app should feel operational and native rather than decorative. Use the current Z8 blue/neutral direction, clear status labels, and restrained spacing.

The conversion should improve:

- Faster, less error-prone absence date entry.
- More native-feeling buttons and list controls.
- Clear loading, error, disabled, and selected states.
- Readability on small screens.
- Preservation of accessibility roles/states where `@expo/ui` supports them.

The conversion should avoid:

- Generic visual churn that does not improve the task flow.
- Deep custom native component work.
- Replacing reliable data flow with UI-specific state abstractions.

## Error Handling

Auth errors should remain user-facing on sign-in:

- `access_denied` maps to the current administrator-contact message.
- Failed code exchange maps to a retryable sign-in error.
- Missing callback code or token is ignored.

API errors should continue to surface existing screen-level error messages. Any new parsing should preserve the current `MobileApiClientError` status and message behavior.

## Testing

Update and add tests for:

- Login URL includes `challenge`.
- Code exchange sends both `code` and `verifier`.
- Callback handler stores the returned token after a successful exchange.
- Failed exchange returns `code_exchange_failed`.
- Absence request form still submits the same payload shape after date-picker UX changes.
- Existing home, schedule, absences, my requests, profile, and routing behavior remains intact.

Verification commands:

- `pnpm --dir apps/mobile test`
- `pnpm --dir apps/mobile exec tsc --noEmit`

If `@expo/ui` changes test rendering behavior under Vitest, adjust tests toward user-visible text and callback assertions rather than implementation-specific tree structure.

## Risks

`@expo/ui` is a native UI layer with `Host` boundaries, so a strict full conversion may expose platform or test limitations. The design handles this by converting broadly while allowing minimal React Native fallbacks when they protect behavior or accessibility.

PKCE generation needs a React Native compatible SHA-256/base64url implementation. If Expo SDK 56 does not provide the needed primitive directly through installed packages, add the smallest Expo-compatible dependency rather than using Node-only crypto.

Date picker behavior differs across platforms. The form should normalize selected dates to `YYYY-MM-DD` before validation/submission so backend contracts remain unchanged.

## Acceptance Criteria

- Mobile sign-in succeeds against the current webapp app-login/app-exchange contract.
- Mobile session, home, schedule, my requests, absences, and profile flows continue using organization-scoped Bearer-token API calls.
- Mobile TypeScript typecheck passes with Luxon typings available.
- Primary mobile screens use `@expo/ui` components for most visible controls/layouts, with documented minimal fallbacks where needed.
- Absence request date entry no longer relies on manual date text input.
- Mobile tests pass.
