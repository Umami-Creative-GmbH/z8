# React Doctor Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the remaining `apps/webapp` React Doctor warning categories in narrow, verified, committed phases without regressing score or behavior.

**Architecture:** Use React Doctor diagnostics as the static failing test for lint-style issues, add behavior tests where code behavior changes, and keep each commit scoped to one warning family. Prefer small, local edits over broad rewrites.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, React Doctor, pnpm.

---

## Current Baseline

- Working directory for commands: `apps/webapp`
- Current full diagnostic source: `/tmp/react-doctor-c3e44f8d-8c32-4f1a-aeef-72e72efa4d9e/diagnostics.json`
- Current summary includes `0` errors and these requested warning categories: metadata, hydration time, accessibility controls, Suspense for search params, array iteration, await parallelization, preventDefault forms, unused files, query invalidation, exhaustive deps, bundle size, and security-style server action auth checks.

## Task 1: Static SSR And Accessibility Warnings

**Files:**
- Modify: `src/app/[locale]/onboarding/notifications/page.tsx`
- Modify: `src/app/[locale]/onboarding/complete/page.tsx`
- Modify: `src/app/[locale]/onboarding/holiday-setup/page.tsx`
- Modify: `src/app/[locale]/onboarding/organization/page.tsx`
- Modify: `src/app/[locale]/onboarding/wellness/page.tsx`
- Modify: `src/app/[locale]/onboarding/profile/page.tsx`
- Modify: `src/app/[locale]/onboarding/vacation-policy/page.tsx`
- Modify: `src/app/[locale]/onboarding/work-templates/page.tsx`
- Modify: `src/app/[locale]/onboarding/work-schedule/page.tsx`
- Modify: `src/app/[locale]/onboarding/welcome/page.tsx`
- Modify: `src/app/[locale]/(setup)/setup/page.tsx`
- Modify: `src/app/[locale]/access-denied/page.tsx`
- Modify: `src/app/[locale]/init/page.tsx`
- Modify hydration-time files reported by React Doctor.
- Modify accessibility files reported by React Doctor.
- Modify Suspense/search-param files reported by React Doctor.

- [ ] **Step 1: Verify RED diagnostics**

Run: `pnpm dlx react-doctor@latest --verbose --diff`

Expected: current diff/full scan still reports some or all of `nextjs-missing-metadata`, `rendering-hydration-mismatch-time`, `click-events-have-key-events`, `control-has-associated-label`, and `nextjs-no-use-search-params-without-suspense`.

- [ ] **Step 2: Add page metadata**

Add static `metadata` exports to pages that can use them. If a page already has server-only code that prevents a static export, use `generateMetadata` with a simple localized-independent title/description.

- [ ] **Step 3: Fix hydration-time diagnostics minimally**

Replace render-time `new Date()`/time values with stable server-provided values, Luxon parsing, `useEffect` client-only state, or `suppressHydrationWarning` only when the value is intentionally live.

- [ ] **Step 4: Fix accessibility controls**

Prefer native `<button type="button">` for clickable options. Add `aria-label`/`aria-labelledby` only when visible text cannot label the control.

- [ ] **Step 5: Add Suspense boundaries**

Wrap components using `useSearchParams()` in a local `<Suspense>` boundary from their nearest page/client boundary, preserving existing fallback layout.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm exec tsc --noEmit`

Run: `pnpm dlx react-doctor@latest --verbose --diff`

Expected: TypeScript passes, score does not regress, and Task 1 warning counts decrease or clear.

- [ ] **Step 7: Commit**

Run: `git add <changed task 1 files> && git commit -m "fix: address react doctor ssr and accessibility warnings"`

## Task 2: Exhaustive Deps And Event-State Warnings

**Files:**
- Modify files reported for `react-doctor/exhaustive-deps`, `no-event-handler`, `no-pass-data-to-parent`, and adjacent effect/state rules.

- [ ] **Step 1: Verify RED diagnostics**

Run: `pnpm dlx react-doctor@latest --verbose --diff`

- [ ] **Step 2: Add focused tests for behavior changes**

For any effect change that alters user-visible behavior, add or update the closest Vitest/Testing Library test before editing production code.

- [ ] **Step 3: Implement minimal effect fixes**

Use stable dependencies, move event logic into event handlers, and avoid passing data upward from effects when the parent can own the data flow.

- [ ] **Step 4: Verify and commit**

Run targeted tests, `pnpm exec tsc --noEmit`, and React Doctor diff. Commit as `fix: clean up react effect diagnostics`.

## Task 3: Async Parallelization Warnings

**Files:**
- Modify files reported for `async-await-in-loop`, `server-sequential-independent-await`, `async-parallel`, `async-defer-await`, and `server auth action` false/true positives after review.

- [ ] **Step 1: Verify RED diagnostics**

Run: `pnpm dlx react-doctor@latest --verbose --diff`

- [ ] **Step 2: Add tests where ordering or error behavior matters**

Before changing loops or awaits, add tests that preserve ordering, permissions, and error semantics.

- [ ] **Step 3: Implement minimal parallelization**

Use `Promise.all` only for independent awaits. Keep sequential awaits where ordering, transactions, rate limits, or permissions require it.

- [ ] **Step 4: Verify and commit**

Run targeted tests, `pnpm exec tsc --noEmit`, and React Doctor diff. Commit as `fix: parallelize independent async work`.

## Task 4: Query Invalidation And Form Progressive Enhancement

**Files:**
- Modify files reported for `query-mutation-missing-invalidation` and `no-prevent-default`.

- [ ] **Step 1: Verify RED diagnostics**

Run: `pnpm dlx react-doctor@latest --verbose --diff`

- [ ] **Step 2: Add mutation tests where cache behavior is observable**

Add tests that prove stale list/detail data is invalidated or refreshed after mutation success.

- [ ] **Step 3: Fix invalidation and forms minimally**

Invalidate precise query keys after successful mutations. Convert forms to server actions only when it preserves current validation and TanStack Form behavior; otherwise document intentional exceptions.

- [ ] **Step 4: Verify and commit**

Run targeted tests, `pnpm exec tsc --noEmit`, and React Doctor diff. Commit as `fix: refresh data after mutations` or a narrower form-specific message.

## Task 5: JavaScript Iteration And Bundle Warnings

**Files:**
- Modify files reported for `js-combine-iterations`, `js-set-map-lookups`, `js-flatmap-filter`, `js-index-maps`, `prefer-dynamic-import`, `no-barrel-import`, and bundle-size diagnostics.

- [ ] **Step 1: Verify RED diagnostics**

Run: `pnpm dlx react-doctor@latest --verbose --diff`

- [ ] **Step 2: Add tests for any transformed data logic**

Before replacing chained transforms with loops/maps, add tests for representative input/output if no test already covers the transformation.

- [ ] **Step 3: Implement local transformations**

Combine repeated array passes only when readability remains acceptable. Use dynamic imports or narrower imports for high-impact bundle findings.

- [ ] **Step 4: Verify and commit**

Run targeted tests, `pnpm exec tsc --noEmit`, and React Doctor diff. Commit as `fix: reduce repeated iteration diagnostics` or a narrower bundle-specific message.

## Task 6: Unused Files And Exports

**Files:**
- Modify/delete files reported by `deslop/unused-file`, `deslop/unused-export`, and dependency warnings after confirming they are not framework entrypoints, generated files, or intended public exports.

- [ ] **Step 1: Verify RED diagnostics**

Run: `pnpm dlx react-doctor@latest --verbose --diff`

- [ ] **Step 2: Confirm each candidate independently**

Search references with `grep`/`glob` tooling and inspect package/framework conventions before deleting anything.

- [ ] **Step 3: Delete or unexport only confirmed dead code**

Keep public API and generated/auth schema files intact unless explicitly verified safe.

- [ ] **Step 4: Verify and commit**

Run `pnpm exec tsc --noEmit`, relevant tests, and React Doctor diff. Commit as `fix: remove unused webapp code`.
