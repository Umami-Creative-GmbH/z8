# Absence Cancel Refresh Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh absence data after cancellation, add a translated tooltip to the cancel absence button, and make the absence table search field non-transparent.

**Architecture:** Keep refresh ownership in `AbsencesViewContainer`, using the existing `onUpdate` callback from `AbsenceEntriesTable`. Add tooltip UI locally around the cancel button with existing tooltip components and translated copy. Apply the existing `bg-background` design token to the table search input.

**Tech Stack:** React, Next.js client components, Tolgee `t()`, shadcn tooltip components, Vitest, React Testing Library.

---

## Task 1: Absence Cancel Refresh And Tooltip

**Files:**
- Modify: `apps/webapp/src/components/absences/absence-entries-table.tsx`
- Modify: `apps/webapp/src/components/absences/absence-entries-table.test.tsx`
- Verify: `apps/webapp/src/components/absences/absences-view-container.test.tsx`

- [ ] **Step 1: Write failing tests**

In `apps/webapp/src/components/absences/absence-entries-table.test.tsx`, add tests that mock `cancelAbsenceRequest`, render a cancellable absence, click the cancel button and confirmation action, and verify `onUpdate` is called after success. Also assert the tooltip text `Cancel absence` is present and the search input includes `bg-background`.

- [ ] **Step 2: Run tests to verify failure**

Run from `apps/webapp`: `pnpm vitest run src/components/absences/absence-entries-table.test.tsx`

Expected: FAIL because tooltip content is missing, the refresh callback behavior is not covered by the new test, or the search input background class is not applied directly enough for the assertion.

- [ ] **Step 3: Implement tooltip and refresh behavior**

In `absence-entries-table.tsx`, import tooltip components from `@/components/ui/tooltip`. Wrap the cancel button in `TooltipProvider`, `Tooltip`, `TooltipTrigger asChild`, and `TooltipContent`. Use `t("absences.table.cancelAbsenceTooltip", "Cancel absence")` for tooltip text. Keep the existing `aria-label` translated. Keep successful cancellation calling `router.refresh()` and `onUpdate?.()`. Ensure the search input is rendered with an explicit `bg-background` class.

- [ ] **Step 4: Run focused tests**

Run from `apps/webapp`: `pnpm vitest run src/components/absences/absence-entries-table.test.tsx src/components/absences/absences-view-container.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/components/absences/absence-entries-table.tsx apps/webapp/src/components/absences/absence-entries-table.test.tsx docs/superpowers/plans/2026-05-20-absence-cancel-refresh-tooltip.md
git commit -m "feat: refresh absences after cancellation"
```

## Self-Review

- Spec coverage: refresh callback, router refresh preservation, translated tooltip, search input background, and focused tests are covered.
- Red-flag scan: no incomplete requirement markers or unspecified implementation steps remain.
- Type consistency: `onUpdate`, `cancelAbsenceRequest`, and tooltip component names match existing code.
