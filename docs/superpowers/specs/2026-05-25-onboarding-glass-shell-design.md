# Onboarding Glass Shell Design

## Goal

Make the onboarding flow visually consistent with the refreshed auth routes by using the same full-screen background image, bottom info links, and translucent glass card treatment.

## Approved Design

The localized onboarding layout owns the full-screen shell. It uses the same auth background image as `(auth)/layout.tsx`, rendered as a full-viewport `object-cover` image with a light/dark overlay. `LanguageSwitcher` remains in the top-right. The main onboarding content is centered in a wide responsive container, and `InfoFooter` moves to the bottom of the viewport with auth-like spacing.

Cards inside onboarding pages receive a scoped glass surface through the onboarding layout wrapper. The styling uses `bg-white/20`, `dark:bg-slate-950/45`, `backdrop-blur-md`, translucent white borders, and the existing shadow treatment. This avoids editing every onboarding page while keeping the existing forms, steps, and routing behavior unchanged.

## Scope

- Modify `apps/webapp/src/app/[locale]/onboarding/layout.tsx`.
- Add or update tests for the onboarding layout shell.
- Do not change onboarding business logic, step order, data mutations, or route behavior.

## Verification

Run the targeted onboarding layout test and TypeScript check. If no onboarding layout test exists, add one that verifies the full-screen image, top language switcher, bottom info footer, and scoped glass-card wrapper are present.
