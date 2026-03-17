# Sign-In Wrapper and Form Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/sign-in` so the auth wrapper and sign-in flow feel calm, operational, and reusable for future auth routes while keeping credential sign-in as the clearest default path.

**Architecture:** Keep the existing `AuthFormWrapper` / `LoginForm` boundary. `AuthFormWrapper` owns the shell, background treatment, title/description, readiness-ledger API, and mobile trust compression. `LoginForm` owns auth-method precedence, password recovery placement, credential-first hierarchy, and 2FA continuity. Add focused Vitest + Testing Library coverage so the new structure cannot drift back toward a generic auth template.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, Tolgee inline defaults, Vitest, Testing Library

---

## File Structure

- Modify: `apps/webapp/src/components/auth-form-wrapper.tsx`
  - Add the wrapper content contract (`title`, `description`, `ledgerHeading`, `ledgerDescription`, `ledgerItems`, `branding`, `formProps`) with backward-compatible defaults.
  - Replace the media-style right rail with a text-only readiness ledger.
  - Move any optional branded image treatment to the shell backdrop layer instead of a visible split media panel.
- Modify: `apps/webapp/src/components/auth-form-wrapper.test.tsx`
  - Lock the wrapper contract, desktop/mobile trust behavior, and removal of process-rail remnants.
- Create: `apps/webapp/src/components/login-form.test.tsx`
  - Add a reusable harness for auth config permutations and focused sign-in hierarchy tests.
- Modify: `apps/webapp/src/components/login-form.tsx`
  - Supply wrapper-owned header copy.
  - Move recovery next to the password group.
  - Make credential sign-in the lead path whenever enabled.
  - Keep SSO-first only when credentials are unavailable.
  - Preserve account context during 2FA and suppress alternate auth while verifying.

## Scope Guards

- Do not change backend auth behavior or API contracts.
- Do not touch `apps/webapp/src/components/signup-form.tsx`, `apps/webapp/src/components/forgot-password-form.tsx`, or other auth routes in this plan.
- Keep new wrapper props optional so existing callers continue to compile unchanged.
- Use inline `t("key", "Default copy")` defaults in touched components, matching the current auth component pattern.
- Keep these state inputs as the source of truth for precedence decisions:
  - `showEmailPassword`
  - `showSSO`
  - `showPasskey`
  - `filteredProviders`
  - `requires2FA`

## Implementation Notes Before Starting

- Follow @test-driven-development for every behavior change.
- Run commands from the repo root with `pnpm --dir apps/webapp ...`.
- Reuse the saved Z8 interface system from `.interface-design/system.md`: blue-slate neutrals, indigo primary, borders-only depth, no large auth-card shadow.
- Add stable DOM hooks where they simplify behavior tests:
  - `data-testid="auth-readiness-ledger"`
  - `data-testid="auth-mobile-support"`
  - `data-testid="password-field-group"`
  - `data-testid="alternate-auth"`
  - `data-testid="account-context"`
- Implementation choice for precedence (allowed by the approved spec):
  - If `showEmailPassword === true`, credentials are first and all other methods move below the primary submit action.
  - If `showEmailPassword === false` and `showSSO === true`, SSO is the lead action.
  - If `showEmailPassword === false` and `showSSO === false`, keep the existing passkey/social ordering in place for this iteration; only ensure those methods remain secondary to any explicit lead action and do not hide the sign-up footer.

### Task 1: Lock the auth wrapper contract and shell

**Files:**
- Modify: `apps/webapp/src/components/auth-form-wrapper.test.tsx`
- Modify: `apps/webapp/src/components/auth-form-wrapper.tsx`
- Test: `apps/webapp/src/components/auth-form-wrapper.test.tsx`

- [ ] **Step 1: Replace the existing wrapper test with a failing contract test**

Update `apps/webapp/src/components/auth-form-wrapper.test.tsx` to import `within` and use this exact test block:

```tsx
it("renders the wrapper header, desktop ledger, and condensed mobile support without process-rail leftovers", () => {
  render(
    <AuthFormWrapper
      title="Sign in to your workspace"
      description="Use your work email to get back to schedules, approvals, and payroll records."
      ledgerHeading="Workspace access, without loose ends"
      ledgerDescription="Keep schedules, approvals, and records aligned from the first step back in."
      ledgerItems={[
        "Schedules stay current",
        "Approvals remain traceable",
        "Records stay payroll-ready",
      ]}
    >
      <div>form body</div>
    </AuthFormWrapper>,
  )

  expect(screen.getByRole("heading", { name: "Sign in to your workspace" })).toBeTruthy()
  expect(
    screen.getByText("Use your work email to get back to schedules, approvals, and payroll records."),
  ).toBeTruthy()

  const desktopLedger = screen.getByTestId("auth-readiness-ledger")
  expect(within(desktopLedger).getByText("Workspace access, without loose ends")).toBeTruthy()
  expect(within(desktopLedger).getAllByRole("listitem")).toHaveLength(3)

  const mobileSupport = screen.getByTestId("auth-mobile-support")
  expect(within(mobileSupport).getByText("Workspace access, without loose ends")).toBeTruthy()
  expect(
    within(mobileSupport).getByText(
      "Keep schedules, approvals, and records aligned from the first step back in.",
    ),
  ).toBeTruthy()
  expect(within(mobileSupport).queryAllByRole("listitem")).toHaveLength(0)

  expect(screen.queryByText("Capture")).toBeNull()
  expect(screen.queryByText("Review")).toBeNull()
  expect(screen.queryByText("Close")).toBeNull()
})
```

- [ ] **Step 2: Run the wrapper test to verify it fails**

Run: `pnpm --dir apps/webapp exec vitest run src/components/auth-form-wrapper.test.tsx`
Expected: FAIL because the current wrapper does not expose the new prop contract or readiness-ledger structure.

- [ ] **Step 3: Implement the minimal wrapper redesign**

In `apps/webapp/src/components/auth-form-wrapper.tsx`:

- extend `AuthFormWrapperProps` with optional `description`, `ledgerHeading`, `ledgerDescription`, and `ledgerItems?: string[]`
- provide backward-compatible defaults in the component body:

```tsx
const descriptionText = description ?? t(
  "auth.default-support-copy",
  "Use your work email to continue into schedules, approvals, and payroll records.",
)

const readinessHeading = ledgerHeading ?? t(
  "auth.default-ledger-heading",
  "Workspace access, without loose ends",
)

const readinessDescription = ledgerDescription ?? t(
  "auth.default-ledger-description",
  "Keep schedules, approvals, and records aligned from the first step back in.",
)

const readinessItems = ledgerItems ?? [
  t("auth.ledger-schedules", "Schedules stay current"),
  t("auth.ledger-approvals", "Approvals remain traceable"),
  t("auth.ledger-records", "Records stay payroll-ready"),
]
```

- keep the atmospheric backdrop, but move branded/fallback imagery to an absolutely positioned shell backdrop instead of a visible right-side media panel
- remove `shadow-xl` and keep a borders-only shell treatment
- render the wrapper header once in the working column and make `title` the only semantic page heading
- render the brand/app name as logo or non-heading branding text so the wrapper never exposes two competing headings
- add `data-testid="auth-mobile-support"` for the condensed mobile support block
- render the mobile support block with the ledger heading plus the exact `ledgerDescription`; do not substitute a different condensed sentence in this implementation
- add `data-testid="auth-readiness-ledger"` for the desktop ledger and map `ledgerItems` into exactly one `<ul>`; in the sign-in/default case that list contains three rows

- [ ] **Step 4: Re-run the wrapper test to verify it passes**

Run: `pnpm --dir apps/webapp exec vitest run src/components/auth-form-wrapper.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit the wrapper redesign**

```bash
git add apps/webapp/src/components/auth-form-wrapper.tsx apps/webapp/src/components/auth-form-wrapper.test.tsx
git commit -m "refactor(auth): redesign auth wrapper shell"
```

### Task 2: Create the login-form test harness and lock the wrapper-owned header copy

**Files:**
- Create: `apps/webapp/src/components/login-form.test.tsx`
- Modify: `apps/webapp/src/components/login-form.tsx`
- Test: `apps/webapp/src/components/login-form.test.tsx`

- [ ] **Step 1: Create the new login-form test file with shared mocks**

Create `apps/webapp/src/components/login-form.test.tsx` with this exact setup block:

```tsx
/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  pushMock,
  signInEmailMock,
  signInPasskeyMock,
  signInSocialMock,
  signInSSOMock,
  useDomainAuthMock,
  useEnabledProvidersMock,
  useTurnstileMock,
  verifyTotpMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signInEmailMock: vi.fn(),
  signInPasskeyMock: vi.fn(),
  signInSocialMock: vi.fn(),
  signInSSOMock: vi.fn(),
  useDomainAuthMock: vi.fn(),
  useEnabledProvidersMock: vi.fn(),
  useTurnstileMock: vi.fn(),
  verifyTotpMock: vi.fn(),
}))

vi.mock("@tolgee/react", () => ({
  useTranslate: () => ({
    t: (_k: string, d?: string, params?: Record<string, string | number>) => {
      if (!d) return _k
      if (!params) return d
      return d.replace(/\{(\w+)\}/g, (_, token: string) => String(params[token] ?? `{${token}}`))
    },
  }),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock("@/navigation", () => ({
  Link: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
  useRouter: () => ({ push: pushMock }),
}))
vi.mock("@/lib/auth/domain-auth-context", () => ({ useDomainAuth: useDomainAuthMock, useTurnstile: useTurnstileMock }))
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: signInEmailMock,
      social: signInSocialMock,
      passkey: signInPasskeyMock,
      sso: signInSSOMock,
    },
    twoFactor: { verifyTotp: verifyTotpMock },
  },
}))
vi.mock("@/lib/hooks/use-enabled-providers", () => ({ useEnabledProviders: useEnabledProvidersMock }))
vi.mock("@/lib/turnstile/verify", () => ({ verifyTurnstileWithServer: vi.fn() }))
vi.mock("./auth-form-wrapper", () => ({
  AuthFormWrapper: ({ children, description, formProps, title }: { children: ReactNode; description?: string; formProps?: ComponentProps<"form">; title: string }) => (
    <form {...formProps}>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </form>
  ),
}))
vi.mock("./turnstile-widget", () => ({ TurnstileWidget: () => <div>turnstile</div> }))

import { LoginForm } from "./login-form"

beforeEach(() => {
  pushMock.mockReset()
  signInEmailMock.mockReset()
  signInPasskeyMock.mockReset()
  signInSocialMock.mockReset()
  signInSSOMock.mockReset()
  verifyTotpMock.mockReset()
  useTurnstileMock.mockReturnValue(null)
  useEnabledProvidersMock.mockReturnValue({ enabledProviders: [], error: null, isLoading: false })
  setupDomainAuth()
})

function setupDomainAuth(overrides?: Partial<any>) {
  useDomainAuthMock.mockReturnValue({
    authConfig: {
      emailPasswordEnabled: true,
      passkeyEnabled: true,
      ssoEnabled: false,
      socialProvidersEnabled: [],
      ...overrides?.authConfig,
    },
    branding: null,
    socialOAuthConfigured: {},
    ...overrides,
  })
}

function renderLoginForm() {
  return render(<LoginForm />)
}
```

- [ ] **Step 2: Add the first failing header-copy test**

Add this exact test under the helpers:

```tsx
it("uses wrapper-owned returning-user copy", () => {
  renderLoginForm()

  expect(screen.getByRole("heading", { name: "Sign in to your workspace" })).toBeTruthy()
  expect(
    screen.getByText("Use your work email to get back to schedules, approvals, and payroll records."),
  ).toBeTruthy()
})
```

- [ ] **Step 3: Run the header-copy test to verify it fails**

Run: `pnpm --dir apps/webapp exec vitest run src/components/login-form.test.tsx -t "uses wrapper-owned returning-user copy"`
Expected: FAIL because `LoginForm` still passes the old login title and no wrapper description.

- [ ] **Step 4: Implement the minimal header-copy change**

Update the `AuthFormWrapper` call in `apps/webapp/src/components/login-form.tsx`:

```tsx
<AuthFormWrapper
  className={className}
  formProps={{ onSubmit: handleSubmit }}
  title={t("auth.sign-in-to-workspace", "Sign in to your workspace")}
  description={t(
    "auth.sign-in-support-copy",
    "Use your work email to get back to schedules, approvals, and payroll records.",
  )}
  branding={branding}
  {...props}
>
```

- [ ] **Step 5: Re-run the header-copy test to verify it passes**

Run: `pnpm --dir apps/webapp exec vitest run src/components/login-form.test.tsx -t "uses wrapper-owned returning-user copy"`
Expected: PASS

- [ ] **Step 6: Commit the header baseline**

```bash
git add apps/webapp/src/components/login-form.tsx apps/webapp/src/components/login-form.test.tsx
git commit -m "refactor(auth): set sign-in header baseline"
```

### Task 3: Make credentials the lead path and move recovery into the password group

**Files:**
- Modify: `apps/webapp/src/components/login-form.test.tsx`
- Modify: `apps/webapp/src/components/login-form.tsx`
- Test: `apps/webapp/src/components/login-form.test.tsx`

- [ ] **Step 1: Add a failing credential-first hierarchy test**

Append this exact test:

```tsx
it("keeps credentials first when email/password is enabled", () => {
  setupDomainAuth({
    authConfig: {
      emailPasswordEnabled: true,
      ssoEnabled: true,
      passkeyEnabled: true,
      socialProvidersEnabled: ["google"],
    },
  })
  useEnabledProvidersMock.mockReturnValue({
    enabledProviders: [
      { id: "google", name: "Google", icon: () => <svg aria-hidden="true" /> },
    ],
    error: null,
    isLoading: false,
  })

  renderLoginForm()

  const submitButton = screen.getByRole("button", { name: "Sign in" })
  const passwordGroup = screen.getByTestId("password-field-group")
  const alternateAuth = screen.getByTestId("alternate-auth")

  expect(within(passwordGroup).getByRole("link", { name: "Forgot your password?" })).toBeTruthy()
  expect(screen.getByText("Other ways to sign in")).toBeTruthy()
  expect(submitButton.compareDocumentPosition(alternateAuth) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(alternateAuth).getByRole("button", { name: "Sign in with SSO" })).toBeTruthy()
})
```

- [ ] **Step 2: Run the credential-first test to verify it fails**

Run: `pnpm --dir apps/webapp exec vitest run src/components/login-form.test.tsx -t "keeps credentials first when email/password is enabled"`
Expected: FAIL because recovery is still below submit and SSO still renders above the credential path.

- [ ] **Step 3: Implement the minimal credential-first hierarchy**

In `apps/webapp/src/components/login-form.tsx`:

- wrap the password label + recovery link + input in a container with `data-testid="password-field-group"`
- move the recovery link into the password label row:

```tsx
<div className="flex items-center justify-between gap-3">
  <Label htmlFor="password">{t("auth.password", "Password")}</Label>
  <Link className="text-xs underline-offset-2 hover:underline" href="/forgot-password">
    {t("auth.forgot-password", "Forgot your password?")}
  </Link>
</div>
```

- change the submit copy to `t("auth.sign-in", "Sign in")`
- remove the early SSO button block when `showEmailPassword === true`
- create a single secondary auth section after the submit button with `data-testid="alternate-auth"` and divider copy `t("auth.other-sign-in-methods", "Other ways to sign in")`
- place SSO inside that secondary section before passkey/social buttons when credentials are enabled

- [ ] **Step 4: Re-run the credential-first test to verify it passes**

Run: `pnpm --dir apps/webapp exec vitest run src/components/login-form.test.tsx -t "keeps credentials first when email/password is enabled"`
Expected: PASS

- [ ] **Step 5: Commit the credential-first hierarchy**

```bash
git add apps/webapp/src/components/login-form.tsx apps/webapp/src/components/login-form.test.tsx
git commit -m "refactor(auth): restore primary sign-in hierarchy"
```

### Task 4: Lock precedence for credential-off and SSO-first organizations

**Files:**
- Modify: `apps/webapp/src/components/login-form.test.tsx`
- Modify: `apps/webapp/src/components/login-form.tsx`
- Test: `apps/webapp/src/components/login-form.test.tsx`

- [ ] **Step 1: Add the SSO-first failing test**

Append this test:

```tsx
it("makes SSO the lead action only when credentials are unavailable", () => {
  setupDomainAuth({
    authConfig: {
      emailPasswordEnabled: false,
      ssoEnabled: true,
      ssoProviderId: "workos",
      passkeyEnabled: true,
      socialProvidersEnabled: ["google"],
    },
  })
  useEnabledProvidersMock.mockReturnValue({
    enabledProviders: [
      { id: "google", name: "Google", icon: () => <svg aria-hidden="true" /> },
    ],
    error: null,
    isLoading: false,
  })

  renderLoginForm()

  expect(screen.queryByLabelText("Email")).toBeNull()
  expect(screen.queryByLabelText("Password")).toBeNull()
  expect(screen.getByRole("button", { name: "Sign in with SSO" })).toBeTruthy()
  expect(screen.getByRole("link", { name: "Sign up" })).toBeTruthy()

  const alternateAuth = screen.getByTestId("alternate-auth")
  expect(within(alternateAuth).getByRole("button", { name: "Login with Passkey" })).toBeTruthy()
  expect(within(alternateAuth).queryByRole("button", { name: "Sign in with SSO" })).toBeNull()

  fireEvent.click(screen.getByRole("button", { name: "Sign in with SSO" }))
  expect(signInSSOMock).toHaveBeenCalledWith({
    callbackURL: "/init",
    providerId: "workos",
  })
})

it("keeps the sign-up footer visible when credentials are unavailable without SSO", () => {
  setupDomainAuth({
    authConfig: {
      emailPasswordEnabled: false,
      ssoEnabled: false,
      passkeyEnabled: true,
      socialProvidersEnabled: [],
    },
  })

  renderLoginForm()

  expect(screen.getByRole("button", { name: "Login with Passkey" })).toBeTruthy()
  expect(screen.getByRole("link", { name: "Sign up" })).toBeTruthy()
})
```

- [ ] **Step 2: Run the credential-off tests to verify they fail**

Run: `pnpm --dir apps/webapp exec vitest run src/components/login-form.test.tsx -t "credentials are unavailable"`
Expected: FAIL because the current structure does not distinguish the credential-off lead path cleanly and currently hides the sign-up footer when email/password is disabled.

- [ ] **Step 3: Implement the precedence branch**

In `apps/webapp/src/components/login-form.tsx`:

- compute a small precedence helper near the render path:

```tsx
const credentialsLead = showEmailPassword
const ssoLead = !showEmailPassword && showSSO
```

- when `credentialsLead`, keep Task 3 structure
- when `ssoLead`, render the SSO button as the only primary action and keep passkey/social in the secondary section below it
- when credentials are unavailable and `ssoLead` is false, keep the current passkey/social rendering order for this iteration rather than adding new precedence branches without tests
- render `data-testid="alternate-auth"` only when at least one non-primary method is available
- keep the sign-up CTA in the footer whenever `requires2FA === false`, even if credentials are unavailable

- [ ] **Step 4: Re-run the credential-off tests to verify they pass**

Run: `pnpm --dir apps/webapp exec vitest run src/components/login-form.test.tsx -t "credentials are unavailable"`
Expected: PASS

- [ ] **Step 5: Commit the precedence rules**

```bash
git add apps/webapp/src/components/login-form.tsx apps/webapp/src/components/login-form.test.tsx
git commit -m "refactor(auth): define sign-in method precedence"
```

### Task 5: Preserve account context and suppress alternate auth during 2FA

**Files:**
- Modify: `apps/webapp/src/components/login-form.test.tsx`
- Modify: `apps/webapp/src/components/login-form.tsx`
- Test: `apps/webapp/src/components/login-form.test.tsx`

- [ ] **Step 1: Add the failing 2FA continuity test**

Append this test:

```tsx
it("keeps account context visible and hides alternate auth during 2FA", async () => {
  signInEmailMock.mockResolvedValue({ data: { twoFactorRedirect: true } })

  renderLoginForm()

  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "worker@example.com" } })
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } })
  fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form")!)

  expect((await screen.findByTestId("account-context")).textContent).toContain("worker@example.com")
  expect(screen.queryByLabelText("Email")).toBeNull()
  expect(screen.queryByLabelText("Password")).toBeNull()
  expect(screen.queryByTestId("alternate-auth")).toBeNull()
  expect(screen.getByRole("button", { name: "Verify and sign in" })).toBeTruthy()
})
```

- [ ] **Step 2: Run the 2FA continuity test to verify it fails**

Run: `pnpm --dir apps/webapp exec vitest run src/components/login-form.test.tsx -t "keeps account context visible and hides alternate auth during 2FA"`
Expected: FAIL because the current 2FA state leaves the original credential emphasis mounted and does not expose dedicated account context.

- [ ] **Step 3: Implement the minimal 2FA continuity treatment**

In `apps/webapp/src/components/login-form.tsx`:

- render a read-only account context line with `data-testid="account-context"` when `requires2FA === true`:

```tsx
{requires2FA ? (
  <p data-testid="account-context" className="text-sm text-muted-foreground">
    {t("auth.verifying-account", "Verifying {email}", { email })}
  </p>
) : null}
```

- stop rendering the password field group once `requires2FA === true`
- stop rendering the editable email field once `requires2FA === true`; the account-context line fully replaces editable credential fields during verification
- keep the wrapper title/description unchanged in 2FA state
- keep the global error surface at the top of the form stack
- change the verify button copy to `t("auth.verify-and-sign-in", "Verify and sign in")`
- do not render `data-testid="alternate-auth"` when `requires2FA === true`

- [ ] **Step 4: Re-run the 2FA continuity test to verify it passes**

Run: `pnpm --dir apps/webapp exec vitest run src/components/login-form.test.tsx -t "keeps account context visible and hides alternate auth during 2FA"`
Expected: PASS

- [ ] **Step 5: Commit the 2FA continuity update**

```bash
git add apps/webapp/src/components/login-form.tsx apps/webapp/src/components/login-form.test.tsx
git commit -m "refactor(auth): keep 2fa in the sign-in flow"
```

### Task 6: Run the full auth-wrapper/sign-in verification pass

**Files:**
- Test: `apps/webapp/src/components/auth-form-wrapper.test.tsx`
- Test: `apps/webapp/src/components/login-form.test.tsx`
- Verify: `apps/webapp` production build

- [ ] **Step 1: Run the focused auth component suites**

Run: `pnpm --dir apps/webapp exec vitest run src/components/auth-form-wrapper.test.tsx src/components/login-form.test.tsx`
Expected: PASS

- [ ] **Step 2: Run a non-mutating production build to catch shared-wrapper regressions**

Run: `pnpm --dir apps/webapp exec next build`
Expected: PASS

- [ ] **Step 3: Verify the rendered sign-in route in a local preview**

Run: `pnpm --dir apps/webapp dev`
Open: `http://localhost:3000/en/sign-in`
Confirm this exact checklist against the rendered page and the approved spec in `docs/superpowers/specs/2026-03-17-sign-in-form-refinement-design.md`:

- the wrapper owns the title and support sentence
- the desktop right side is a text-only readiness ledger, not a process rail or media rail
- the mobile support block contains zero ledger rows
- credentials lead whenever enabled
- recovery sits with the password group
- alternate auth is visually and structurally secondary
- 2FA keeps account context in the same form column

- [ ] **Step 4: Run the required auth UI quality gates from `AGENTS.md`**

Review the touched auth UI against these required skills before sign-off:

- `@vercel-react-best-practices`
- `@web-design-guidelines`
- `@vercel-composition-patterns`

Invoke each skill directly against `apps/webapp/src/components/auth-form-wrapper.tsx` and `apps/webapp/src/components/login-form.tsx`, capture any findings, and resolve them before completion.

Expected: no unresolved issues remain in `apps/webapp/src/components/auth-form-wrapper.tsx` or `apps/webapp/src/components/login-form.tsx`
