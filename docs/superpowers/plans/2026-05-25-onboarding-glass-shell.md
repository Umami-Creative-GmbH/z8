# Onboarding Glass Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update onboarding to use the auth-style full-screen background, bottom info links, and glass card surfaces.

**Architecture:** The onboarding route layout owns the background image, overlay, top language switcher, main content positioning, bottom footer, and a scoped class that restyles descendant card primitives. Existing onboarding pages keep their current page-level structure and behavior.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, shadcn/ui, Vitest, Testing Library.

---

## Files

- Modify: `apps/webapp/src/app/[locale]/onboarding/layout.tsx` - render full-screen background, bottom footer, and scoped glass card styling.
- Create: `apps/webapp/src/app/[locale]/onboarding/layout.test.tsx` - verify shell structure and card glass scope.

## Task 1: Onboarding Layout Shell

- [ ] Add a layout test that mocks `next/image`, `LanguageSwitcher`, and `InfoFooter`, renders `OnboardingLayout`, and expects an absolute full-screen image, a top-right language switcher, a bottom footer, and a scoped onboarding glass container.
- [ ] Run `./node_modules/.bin/vitest run 'src/app/[locale]/onboarding/layout.test.tsx'` and confirm it fails before implementation.
- [ ] Update `apps/webapp/src/app/[locale]/onboarding/layout.tsx` to import `next/image`, the auth background image, and render the auth-style shell with scoped descendant card classes.
- [ ] Run `./node_modules/.bin/vitest run 'src/app/[locale]/onboarding/layout.test.tsx'` and confirm it passes.
- [ ] Run `./node_modules/.bin/tsc --noEmit --pretty false` and confirm it passes.
