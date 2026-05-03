# User Week Start Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose whether weeks start on Sunday or Monday and apply that preference to profile settings, calendars, and week range calculations.

**Architecture:** Store a user-level `weekStartDay` value in `user_settings` with a Sunday default. Provide a reusable utility for converting the setting into calendar/date behavior, then thread the value through profile settings and relevant calendar/date components.

**Tech Stack:** Next.js server actions, Drizzle ORM, React, Tailwind CSS, Luxon, react-day-picker, pnpm, Vitest.

---

### Task 1: Week Start Types And Utilities

**Files:**
- Create: `apps/webapp/src/lib/user-preferences/week-start.ts`
- Test: `apps/webapp/src/lib/user-preferences/week-start.test.ts`

- [ ] Add failing tests for defaulting to Sunday, parsing Sunday/Monday only, converting to DayPicker `weekStartsOn`, and computing Luxon week bounds.
- [ ] Implement `WeekStartDay`, `normalizeWeekStartDay`, `weekStartDayToDayPickerValue`, `getWeekBounds`, and `WEEK_START_OPTIONS`.

### Task 2: Persist User Preference

**Files:**
- Modify: `apps/webapp/src/db/schema/user-settings.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts`

- [ ] Add `weekStartDay` as text with default `sunday` in `user_settings`.
- [ ] Add `getWeekStartDay` and `updateWeekStartDay` server actions, authenticated by current user session.
- [ ] Use upsert behavior matching existing timezone settings so missing `user_settings` rows are created safely.

### Task 3: Profile UI Control

**Files:**
- Create: `apps/webapp/src/components/settings/week-start-settings.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/page.tsx`

- [ ] Add a card near timezone settings with a Sunday/Monday select and save button.
- [ ] Fetch `currentWeekStartDay` in the profile page in parallel with timezone and pass actions into the card.

### Task 4: Apply Preference To Calendars And Week Calculations

**Files:**
- Modify: `apps/webapp/src/components/ui/calendar.tsx`
- Modify: `apps/webapp/src/components/absences/absence-year-calendar.tsx`
- Modify: `apps/webapp/src/components/absences/absence-calendar.tsx`
- Modify: `apps/webapp/src/components/absences/absences-view-container.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/page.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- Modify week calculation call sites found during implementation.

- [ ] Set `Calendar` default `weekStartsOn` from a prop, defaulting to Sunday when unspecified.
- [ ] Pass profile preference into absence calendars and rotate mini calendar weekday headers/days accordingly.
- [ ] Update schedule week range labels and server week calculations to use `getWeekBounds`.

### Task 5: Verification

**Files:**
- Check all changed files.

- [ ] Run targeted utility tests.
- [ ] Run changed component/action tests where the repo test environment allows them.
- [ ] Run Biome on changed files.
- [ ] Run TypeScript check and report unrelated pre-existing failures separately if present.
