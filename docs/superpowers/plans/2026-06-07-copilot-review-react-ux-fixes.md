# Copilot Review React UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the valid Copilot PR review findings without introducing React Doctor regressions.

**Architecture:** URL filters on platform-admin pages should be available to React Query on the first render, not copied into query state through an effect. Controlled dialogs that can stay mounted should reset by remounting their form instance when opened for a new context, not by synchronously resetting form state from a prop-change effect.

**Tech Stack:** Next.js client components, React 19, TanStack Query, TanStack Form, Vitest, Testing Library, React Doctor.

---

### Task 1: URL Filter First-Render Regression Tests

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx`

- [ ] **Step 1: Add failing tests for first query keys**

Add a users test that renders with `?search=ada&status=active&organizationId=org-acme` and asserts `useQueryMock.mock.calls[0][0].queryKey` is `['admin-users', 'ada', 'active', 'org-acme', 1]`.

Add an organizations test that renders with `?search=acme&status=suspended` and asserts `useQueryMock.mock.calls[0][0].queryKey` is `['admin-organizations', 'acme', 'suspended', 1]`.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter webapp test -- apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx`

Expected: both new tests fail because the first query key uses empty/default filters.

### Task 2: Initialize Platform Admin URL Filters During First Render

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.tsx`
- Modify: `apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.tsx`

- [ ] **Step 1: Replace URL-copying effects with state initializers**

In users page, initialize `search`, `status`, and `organizationId` from `searchParams` directly in `useState` initializers and remove the effect that sets those three values plus page.

In organizations page, initialize `search` and `status` from `searchParams` directly in `useState` initializers and remove the effect that sets those values plus page.

- [ ] **Step 2: Verify URL tests pass**

Run: `pnpm --filter webapp test -- apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx`

Expected: the new first-query tests pass and existing filter tests remain green.

### Task 3: Controlled Dialog Reset Regression Tests

**Files:**
- Modify: `apps/webapp/src/components/settings/work-policy/work-policy-preset-import.test.tsx`
- Create: `apps/webapp/src/components/settings/location-employee-dialog.test.tsx`

- [ ] **Step 1: Add failing controlled reopen tests**

Add a work-policy test wrapper that renders `WorkPolicyPresetReviewDialog` closed, opens it with `systemPreset`, edits the name, closes it, then opens with another preset and asserts the name field shows the second preset value rather than stale edited text.

Add a location employee dialog test wrapper that renders `LocationEmployeeDialog` closed, opens it, toggles the primary checkbox, closes it, reopens it, and asserts the primary checkbox is unchecked.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter webapp test -- apps/webapp/src/components/settings/work-policy/work-policy-preset-import.test.tsx apps/webapp/src/components/settings/location-employee-dialog.test.tsx`

Expected: controlled reopen tests fail because mounted form state persists.

### Task 4: Remount Forms On Controlled Open Context Changes

**Files:**
- Modify: `apps/webapp/src/components/settings/location-detail.tsx`
- Modify: `apps/webapp/src/components/settings/work-policy/work-policy-preset-import.tsx`

- [ ] **Step 1: Add keys at parent boundaries**

Key `LocationEmployeeDialog` by `addEmployeeOpen ? `${locationId}:open` : `${locationId}:closed`` so reopening remounts the TanStack form instance.

Key `WorkPolicyPresetReviewDialog` by `uiState.reviewOpen ? `${uiState.reviewMode}:${uiState.reviewPreset?.id ?? 'new'}:open` : 'closed'` so reopening for a new preset remounts the TanStack form instance.

Subarea dialog already conditionally mounts only while open, so no production change is required there.

- [ ] **Step 2: Verify dialog tests pass**

Run: `pnpm --filter webapp test -- apps/webapp/src/components/settings/work-policy/work-policy-preset-import.test.tsx apps/webapp/src/components/settings/location-employee-dialog.test.tsx`

Expected: controlled reopen tests pass.

### Task 5: React Doctor And Targeted Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run targeted tests**

Run: `pnpm --filter webapp test -- apps/webapp/src/app/[locale]/(admin)/platform-admin/users/page.test.tsx apps/webapp/src/app/[locale]/(admin)/platform-admin/organizations/page.test.tsx apps/webapp/src/components/settings/work-policy/work-policy-preset-import.test.tsx apps/webapp/src/components/settings/location-employee-dialog.test.tsx`

Expected: all targeted tests pass.

- [ ] **Step 2: Run React Doctor diff**

Run: `pnpm dlx react-doctor@latest --verbose --diff`

Expected: the two platform-admin derived-state/effect findings are gone from the changed files; no new reset-effect findings are introduced for the dialog fixes.

---

## Self-Review

Spec coverage: covers all 8 Copilot comments: 2 URL-query comments, 4 location/subarea import-level comments, and 2 work-policy comments. Subarea is explicitly assessed as already remounted by parent conditional rendering.

Placeholder scan: no placeholder implementation steps remain.

Type consistency: status filters reuse existing `getUserStatusFilter` and `getOrganizationStatusFilter`; dialog keys use existing parent state variables.
