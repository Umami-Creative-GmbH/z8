# Gender-Aware Default Avatars Design

## Goal

Default user profile icons should reflect the user's selected gender when a custom avatar image is not set. Male users should receive a male DiceBear avatar, female users should receive a female DiceBear avatar, and users with `other` or no gender selected should keep the existing deterministic random variant behavior.

## Scope

- Preserve uploaded avatar images as the first-priority source.
- Extend DiceBear fallback generation to accept an optional gender value.
- Keep fallback avatars deterministic by continuing to seed generation with the existing user or employee seed.
- Treat missing gender the same as `other`.

## Approach

Add an optional `gender` parameter to the shared avatar generator and `UserAvatar` component. The generator will map `male` and `female` to DiceBear's corresponding sex option, while leaving that option unset for `other` and missing values so the current seed-driven variant behavior remains in place.

Call sites that already have employee or profile gender data should pass it through to `UserAvatar`. Call sites without gender data can omit the prop and keep current behavior.

## Data Flow

1. A page or component renders `UserAvatar` with `image`, `seed`, `name`, and optional `gender`.
2. `UserAvatar` uses the uploaded image when present.
3. Without an uploaded image, `UserAvatar` calls `generateAvatarDataUri({ seed, size, gender })`.
4. The avatar generator applies DiceBear's `sex` option only for `male` or `female`.
5. `other` and missing gender leave DiceBear variant selection seed-driven.

## Error Handling

No new failure paths are expected. Existing avatar image load and fallback behavior remains unchanged.

## Testing

Add focused tests around avatar generation behavior if the existing test setup can inspect DiceBear options directly. At minimum, verify that `male` and `female` are passed through from `UserAvatar` to the generator and that `other` or missing gender does not force a gendered option.
