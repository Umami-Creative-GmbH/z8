# Product Improvement Consent Design

## Goal

Track product analytics only when the signed-in user has allowed it. The setting must be presented with generic, user-facing copy such as "Help us improve this app" and must not mention PostHog in the UI.

The preference is global per user, not organization-scoped.

## Data Model

Add `helpImproveProduct` to `user_settings`:

- Type: boolean
- Database default: `true`
- Not nullable
- Scope: one value per user via the existing `user_settings.userId` uniqueness

Existing users should receive `true` from the migration default. Users who opt out later should keep `false` across organizations and devices.

## Onboarding Flow

Add the preference to the existing onboarding profile step.

The form default should be checked (`true`). The copy should be generic and calm, for example:

- Label: "Help us improve this app"
- Description: "Share usage insights so we can make Z8 more reliable and useful. You can change this later in your profile settings."

Submitting onboarding profile data should persist the value through `onboardingProfileSchema` and `OnboardingService.updateProfile` into `user_settings.helpImproveProduct`.

Skipping the profile step should not write a value; the database default remains `true`.

## Profile Settings

Add the same preference to the profile settings page, likely near personal preferences rather than identity fields.

The profile page should load the current saved value from `user_settings`, defaulting to `true` when no settings row exists yet. Saving the profile should persist the updated preference alongside the existing profile details.

The UI copy should remain generic and must not mention PostHog, analytics vendor names, event names, or implementation details.

## Provider Behavior

Update `PostHogProvider` so tracking only initializes when both conditions are true:

1. `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` is configured.
2. The current signed-in user's `helpImproveProduct` value is `true`.

If the preference is `false`, do not initialize PostHog and render children without the PostHog provider wrapper.

If the preference changes from `true` to `false` during an active session, the client should call PostHog's opt-out/reset API so no further events are sent after the user opts out.

Unauthenticated or unknown preference states should not send tracking events until the app has enough information to know the user opted in. This avoids sending events before consent is known.

## Server/Data Access

Use a small server-side helper or existing settings access pattern to read the user's global preference in the locale app layout, then pass it into `PostHogProvider` as a prop. The provider must not rely on localStorage as the source of truth.

Profile and onboarding writes should use authenticated server actions and must only update the current user's `user_settings` row.

## Testing

Add or update focused tests for:

- The new `user_settings.helpImproveProduct` schema column and default.
- Onboarding profile form defaulting the preference to checked and submitting the value.
- Onboarding profile action/service persisting the value.
- Profile settings form/action loading and persisting the preference.
- PostHog provider behavior so PostHog initialization is skipped when the value is `false`.

## Non-Goals

- No organization-level consent setting.
- No UI mention of PostHog.
- No tenant-specific environment variable for analytics consent.
- No broader analytics event instrumentation changes in this scope.
