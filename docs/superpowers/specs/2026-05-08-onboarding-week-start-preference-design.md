# Onboarding Week Start Preference Design

## Goal

Let each user choose whether their week starts on Sunday or Monday during onboarding. The choice should use the existing per-user `user_settings.week_start_day` preference and should affect the same calendar and weekly-summary behavior already powered by `getUserWeekStartDay`.

## Approach

Add the preference to the existing profile onboarding step. This step already collects user-level information, uses TanStack Form, and routes through `OnboardingService.updateProfile`, making it the smallest change that keeps the setting per-user without adding another onboarding step.

## UI

The profile form will include a `First day of the week` select after the existing personal fields. It will offer the same two options as profile settings: `Sunday` and `Monday`. The helper text should explain that the setting controls calendars and weekly summaries.

Skipping profile setup will keep the existing database default of Sunday.

## Data Flow

`onboardingProfileSchema` will accept `weekStartDay` as a Sunday/Monday value. The profile page will initialize it to Sunday and submit it with the rest of the profile form.

`OnboardingService.updateProfile` will validate the incoming profile payload and upsert `userSettings.weekStartDay` for the signed-in user. Existing onboarding step progression remains unchanged.

## Error Handling

Invalid values will fail schema validation or be rejected before persistence. The UI will continue to show the existing onboarding error toast if the save fails.

## Testing

Add or update focused tests for the validation/service path where the current test structure supports it. Run the relevant test target and type/lint checks available for the touched package.
