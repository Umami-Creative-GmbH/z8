# Login Form Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic login form with focused login modules while preserving every authentication and redirect behavior.

**Architecture:** `login-form.tsx` remains the stable public import and renders the suspense boundary. A `login/` directory contains reducer state, one auth-flow hook, and focused credentials, alternative-auth, two-factor, and action UI sections. The hook remains the sole caller of Better Auth, Turnstile verification, and onboarding-status APIs.

**Tech Stack:** React 19, Next.js, Better Auth, Turnstile, Zod, Vitest, Tolgee.

---

### Task 1: Extract Login State

**Files:**
- Create: `apps/webapp/src/components/login/login-state.ts`
- Create: `apps/webapp/src/components/login/login-state.test.ts`
- Modify: `apps/webapp/src/components/login-form.tsx`

- [ ] **Step 1: Write reducer tests**

Test that `SET_FIELD` updates only the selected credential while clearing its field error and general error, and that `SET_REQUIRES_2FA` clears loading.

```ts
expect(loginReducer(initialLoginState, { type: "SET_FIELD", field: "email", value: "a@b.com" })).toMatchObject({ email: "a@b.com", error: null });
```

- [ ] **Step 2: Run the reducer test and verify the missing-module failure**

Run: `pnpm --dir apps/webapp test src/components/login/login-state.test.ts`

- [ ] **Step 3: Move `FormState`, `FormAction`, `initialState`, `formReducer`, and `loginSchema` unchanged into `login/login-state.ts`**

Export them as `LoginState`, `LoginAction`, `initialLoginState`, `loginReducer`, and `loginSchema`. Update the existing form to import them.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --dir apps/webapp test src/components/login/login-state.test.ts && pnpm --dir apps/webapp typecheck`

```bash
git add apps/webapp/src/components/login/login-state.ts apps/webapp/src/components/login/login-state.test.ts apps/webapp/src/components/login-form.tsx
```

### Task 2: Extract Focused Login UI

**Files:**
- Create: `apps/webapp/src/components/login/credentials-fields.tsx`
- Create: `apps/webapp/src/components/login/alternative-auth.tsx`
- Create: `apps/webapp/src/components/login/two-factor-form.tsx`
- Create: `apps/webapp/src/components/login/login-actions.tsx`
- Modify: `apps/webapp/src/components/login-form.tsx`

- [ ] **Step 1: Create focused rendering tests**

Test credentials disable during two-factor mode, alternative auth hides during two-factor mode, and the two-factor form disables verification until six digits are present.

- [ ] **Step 2: Run tests and verify imports fail before extraction**

Run: `pnpm --dir apps/webapp test src/components/login`

- [ ] **Step 3: Move existing JSX without changing handlers**

Move `LoginCredentialsFields` and `LoginAlternativeAuth` unchanged. Move the inline two-factor JSX into `TwoFactorForm`, and Turnstile/login/forgot-password/sign-up controls into `LoginActions`. Each component receives explicit state and callback props; none calls Better Auth or router APIs directly.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --dir apps/webapp test src/components/login && pnpm --dir apps/webapp typecheck`

```bash
git add apps/webapp/src/components/login apps/webapp/src/components/login-form.tsx
```

### Task 3: Extract Authentication Flow Hook

**Files:**
- Create: `apps/webapp/src/components/login/use-login-auth.ts`
- Modify: `apps/webapp/src/components/login/login-form-content.tsx`
- Modify: `apps/webapp/src/components/login-form.tsx`
- Test: `apps/webapp/src/components/login/login-form-content.test.tsx`

- [ ] **Step 1: Write auth-flow regression tests**

Mock Better Auth and assert: an email sign-in requiring two-factor mode renders the two-factor form; failed Turnstile verification resets its token; an incomplete onboarding response routes to `getOnboardingStepPath`; and a sanitized callback URL remains the final redirect for completed onboarding.

- [ ] **Step 2: Run the test and verify it fails before the hook export exists**

Run: `pnpm --dir apps/webapp test src/components/login/login-form-content.test.tsx`

- [ ] **Step 3: Move every auth transport handler into `useLoginAuth`**

The hook owns reducer dispatch, credential validation, Turnstile lifecycle, email sign-in, passkey, SSO, social login, TOTP verification, and onboarding redirect resolution. It returns view state plus explicit callbacks. Preserve callback URL sanitization, error text, Turnstile reset on failure, and domain-auth provider filtering.

- [ ] **Step 4: Create the composition module and stable public wrapper**

Move `LoginFormContent` to `login/login-form-content.tsx`, compose the extracted UI modules from the hook’s returned values, and replace `components/login-form.tsx` with a compatibility wrapper that imports and suspense-wraps it. Keep `@/components/login-form` valid for the sign-in route.

- [ ] **Step 5: Verify full behavior and scanner result**

Run: `pnpm --dir apps/webapp test src/components/login && pnpm --dir apps/webapp typecheck && npx react-doctor@latest --verbose --scope changed`

Expected: login tests pass, public import remains valid, and `LoginFormContent` no longer appears in `no-giant-component` diagnostics.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/components/login apps/webapp/src/components/login-form.tsx
```
