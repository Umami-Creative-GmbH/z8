# React Doctor Async State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove actionable stale-effect and stuck-loading warnings without changing navigation, toast, form, or mutation semantics.

**Architecture:** Effects receive an occurrence-local cancellation or request-identity guard and suppress every post-await state/router/toast write after cleanup. Event handlers place busy-state reset in `finally` only when an exception can currently bypass reset; handlers that already convert rejection or intentionally retain loading through navigation remain unchanged and are documented as non-actionable.

**Tech Stack:** React 19, Next.js 16, TanStack Form, Vitest, Testing Library, React Doctor 0.9.2, pnpm.

---

All implementation changes remain unstaged in the existing worktree.

### Task 1: Guard Settings And Authentication Effects

**Files:**
- Modify and test `settings/permissions/permissions-page-client.tsx`
- Modify and test `(auth)/verify-email/page.tsx`
- Modify and test `onboarding/complete/page-client.tsx`
- Modify and test `components/join-organization-form.tsx`
- Modify and test `settings/scheduled-exports/execution-history-dialog.tsx`

- [ ] Add deferred-promise tests proving stale or unmounted requests cannot set state, navigate, or toast.
- [ ] Add effect-local cancellation/request identity and check it after every await before side effects.
- [ ] Preserve authenticated organization arguments and existing success/error behavior.
- [ ] Run focused tests, typecheck, Biome, and the pinned scanner.

### Task 2: Guard Onboarding Load Effects

**Files:**
- Modify and test onboarding `holiday-setup`, `organization`, `vacation-policy`, `work-schedule`, and `work-templates` page clients.

- [ ] Add unmount/stale-resolution tests for each load effect.
- [ ] Guard post-await state updates with local cancellation cleanup.
- [ ] Map rejected access checks to the same fallback route already used by that page's `{ success: false }` branch; membership-summary rejection only settles loading.
- [ ] Do not alter action payloads, route transitions, or onboarding completion state.
- [ ] Run focused tests, typecheck, Biome, and the pinned scanner.

### Task 3: Finalize Onboarding Busy State

**Files:**
- Modify actionable submit/skip handlers in onboarding `holiday-setup`, `notifications`, `organization`, `profile`, `vacation-policy`, `wellness`, `work-schedule`, and `work-templates` page clients.

- [ ] Add rejection tests proving loading resets when the action rejects.
- [ ] Use `try/catch/finally`; keep success navigation and result-error presentation unchanged.
- [ ] Avoid duplicate resets and callback invocations.
- [ ] Run onboarding suites, typecheck, Biome, and scanner.

### Task 4: Finalize Settings Busy State

**Files:**
- Modify actionable handlers in password change, calendar settings, demo data wizard, branding, domain add/auth, SSO provider, vacation policy, wellness settings, work-policy preset review, and works-council settings.

- [ ] Add rejection tests for every changed handler or shared behavior boundary.
- [ ] Move only busy reset into `finally`; preserve mutation/toast/dialog semantics.
- [ ] Run settings suites, typecheck, Biome, and scanner.

### Task 5: Validate Intentional Loading Semantics

- [ ] Verify remaining loading diagnostics already catch/convert rejection, reset every exit, or intentionally remain loading through navigation.
- [ ] Do not rewrite signup, organization redirect, audit download, manual time entry, quick break, clock widget, or other validated cases merely to silence syntax matching.
- [ ] Run full scanner and record occurrence-level justifications.
