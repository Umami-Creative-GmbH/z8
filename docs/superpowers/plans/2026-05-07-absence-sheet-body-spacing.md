# Absence Sheet Body Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/absences` request sheet body read as a compact vertical form instead of an oddly distributed grid.

**Architecture:** Keep the existing `RequestAbsenceDialog` component and `ActionPanel` primitives. Change only the sheet body layout classes so the form fields stack with consistent vertical rhythm.

**Tech Stack:** React, TanStack Form, Tailwind CSS, Vitest, Testing Library.

---

### Task 1: Request Absence Sheet Layout

**Files:**
- Modify: `apps/webapp/src/components/absences/request-absence-dialog.tsx`
- Test: `apps/webapp/src/components/absences/request-absence-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that renders the open dialog and asserts the action panel body uses stacked spacing instead of grid layout.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm --filter webapp test src/components/absences/request-absence-dialog.test.tsx --run`

Expected: the new layout assertion fails because the body still uses `grid gap-4`.

- [ ] **Step 3: Write minimal implementation**

Change `ActionPanelBody` in `RequestAbsenceDialog` from `className="grid gap-4"` to `className="space-y-4"`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm --filter webapp test src/components/absences/request-absence-dialog.test.tsx --run`

Expected: all tests in the file pass.
