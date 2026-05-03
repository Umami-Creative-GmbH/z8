# Profile Picture Mobile Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the `/settings/profile` profile picture action buttons inside the mobile viewport.

**Architecture:** Update the existing `ProfileForm` avatar action layout only. The avatar and actions stack on narrow screens and retain the current horizontal layout at `sm` and wider breakpoints.

**Tech Stack:** React, Tailwind CSS, shadcn/ui Button, Vitest, pnpm.

---

### Task 1: Responsive Avatar Actions

**Files:**
- Modify: `apps/webapp/src/components/settings/profile-form.tsx`
- Test: `apps/webapp/src/components/settings/profile-form.test.tsx`

- [ ] Add a focused test that renders `ProfileForm` and asserts the profile picture action row includes mobile-safe classes: `flex-col`, `sm:flex-row`, and action buttons include `w-full sm:w-auto`.
- [ ] Run `pnpm test src/components/settings/profile-form.test.tsx` from `apps/webapp` and verify the new test fails before implementation.
- [ ] Update the profile picture wrapper to `flex flex-col items-start gap-6 sm:flex-row sm:items-center`.
- [ ] Update the action row to `flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center`.
- [ ] Add `className="w-full sm:w-auto"` to the visible Change Picture and Remove Picture buttons.
- [ ] Add `aria-hidden="true"` to decorative upload/trash/loading icons in the touched buttons.
- [ ] Re-run `pnpm test src/components/settings/profile-form.test.tsx` and `pnpm exec biome check src/components/settings/profile-form.tsx src/components/settings/profile-form.test.tsx`.
