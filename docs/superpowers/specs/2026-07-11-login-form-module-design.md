# Login Form Module Design

## Goal

Split the monolithic login form into focused modules without changing credential, two-factor, Turnstile, SSO, passkey, social login, or onboarding redirect behavior.

## Structure

- `components/login/login-form.tsx` exports the public suspense-wrapped `LoginForm`.
- `components/login/login-form-content.tsx` composes UI sections and owns no auth transport details.
- `components/login/login-state.ts` owns reducer state, actions, validation schema, and state types.
- `components/login/use-login-auth.ts` owns credential, passkey, SSO, social, Turnstile, two-factor, and post-auth routing behavior.
- `components/login/credentials-fields.tsx`, `alternative-auth.tsx`, `two-factor-form.tsx`, and `login-actions.tsx` render focused UI regions through explicit props.

## Boundaries

The auth hook remains the only code that calls Better Auth, Turnstile verification, and onboarding-status APIs. UI modules receive values and event handlers only. Existing callback sanitization and post-sign-in redirect logic remain unchanged.

## Validation

Add focused tests for reducer transitions and login UI modes before moving behavior. Verify the sign-in page import, webapp typecheck, targeted tests, and React Doctor after the refactor.
