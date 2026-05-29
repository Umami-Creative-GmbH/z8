# Calendar Async Day Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make day/week calendar summaries appear automatically after async data loads and show skeleton pills while summary data is fetching.

**Architecture:** Keep existing calendar data fetching and summary calculation. Expose React Query's fetch-in-progress state, pass it through `CalendarView`, and make the Schedule-X header DOM injection retry briefly until header cells exist.

**Tech Stack:** Next.js client components, React Query, Schedule-X, Luxon, Vitest, Testing Library, Tailwind/CSS.

---

## File Map

- Modify `apps/webapp/src/hooks/use-calendar-data.ts` to expose `isFetching`.
- Modify `apps/webapp/src/components/calendar/calendar-view.tsx` to pass `isSummaryLoading`.
- Modify `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx` to type and forward `isSummaryLoading`.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.tsx` to render summary skeletons and retry header injection.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.css` to style skeleton pills.
- Modify `apps/webapp/src/components/calendar/month-work-summary-view.tsx` to accept `isSummaryLoading` for consistent prop wiring.
- Modify `apps/webapp/src/components/calendar/calendar-view.test.tsx` and `schedule-x-calendar.test.tsx` for behavior coverage.

### Task 1: Expose And Wire Summary Loading State

**Files:**
- Modify: `apps/webapp/src/hooks/use-calendar-data.ts`
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx`
- Modify: `apps/webapp/src/components/calendar/month-work-summary-view.tsx`
- Test: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

- [ ] **Step 1: Write failing prop wiring tests**

Add assertions that mocked `ScheduleXWrapper` and `MonthWorkSummaryView` receive `isSummaryLoading` when `mockCalendarData.isFetching = true`.

- [ ] **Step 2: Run focused test and verify failure**

Run: `pnpm vitest run src/components/calendar/calendar-view.test.tsx`

Expected: FAIL because the props are not passed yet.

- [ ] **Step 3: Implement minimal prop wiring**

Add `isFetching` to `UseCalendarDataResult`, return it from React Query, and pass `isSummaryLoading={isFetching}` through `CalendarView` to Schedule-X and month views.

- [ ] **Step 4: Run focused test and verify pass**

Run: `pnpm vitest run src/components/calendar/calendar-view.test.tsx`

Expected: PASS.

### Task 2: Retry Header Injection And Render Skeleton Pills

**Files:**
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.css`
- Test: `apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx`

- [ ] **Step 1: Write failing retry helper tests**

Add unit tests for a helper that returns `true` when fewer header cells exist than visible dates and `false` when all expected cells exist.

- [ ] **Step 2: Run focused test and verify failure**

Run: `pnpm vitest run src/components/calendar/schedule-x-calendar.test.tsx`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement minimal injection retry and skeleton rendering**

Add `isSummaryLoading` to `ScheduleXCalendarWrapper`. Clear both summary and skeleton nodes before each injection pass. Insert skeleton pills when `isSummaryLoading` is true. Retry with `setTimeout` for a bounded number of attempts when header cells are not ready.

- [ ] **Step 4: Add CSS for skeleton pills**

Style skeleton pills as small rounded animated placeholders in the existing header summary area.

- [ ] **Step 5: Run focused test and verify pass**

Run: `pnpm vitest run src/components/calendar/schedule-x-calendar.test.tsx`

Expected: PASS.

### Task 3: Final Verification

**Files:**
- Check all modified files.

- [ ] **Step 1: Run calendar tests**

Run: `pnpm vitest run src/components/calendar/calendar-view.test.tsx src/components/calendar/schedule-x-calendar.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run formatting/lint checks if available from package scripts**

Run the relevant existing pnpm script if the package defines one. Do not introduce a new script.

- [ ] **Step 3: Inspect diff**

Run: `git diff -- apps/webapp/src/hooks/use-calendar-data.ts apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/schedule-x-wrapper.tsx apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/schedule-x-calendar.css apps/webapp/src/components/calendar/month-work-summary-view.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx apps/webapp/src/components/calendar/schedule-x-calendar.test.tsx docs/superpowers/specs/2026-05-29-calendar-async-day-summaries-design.md docs/superpowers/plans/2026-05-29-calendar-async-day-summaries.md`

Expected: Diff only contains the async summary loading fix, tests, spec, and plan.
