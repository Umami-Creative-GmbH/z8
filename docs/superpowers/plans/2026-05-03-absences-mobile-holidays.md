# Absences Mobile Holidays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/absences` mobile overview cards readable and show all holidays assigned to the current employee through org, team, and employee rules.

**Architecture:** Keep UI changes inside `VacationBalanceCard`. Add a focused employee-scoped holiday query in the absence page query module that returns concrete `Holiday[]` values for custom holidays and holiday preset holidays.

**Tech Stack:** Next.js server actions, Drizzle ORM, React, Tailwind CSS, pnpm.

---

### Task 1: Mobile Vacation Balance Cards

**Files:**
- Modify: `apps/webapp/src/components/absences/vacation-balance-card.tsx`

- [ ] Change the balance card grid from two columns on the smallest screens to one column by default, two columns from `sm`, and four columns at `@xl/card`.
- [ ] Update the remaining-days card and carryover warning spans so they occupy the full available row on mobile.

### Task 2: Employee-Scoped Holiday Query

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/queries.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/page.tsx`

- [ ] Add imports for `holidayAssignment`, `holidayPreset`, `holidayPresetAssignment`, and `holidayPresetHoliday`.
- [ ] Change the absence holiday query to accept `employeeId` and look up the employee's organization and team.
- [ ] Return active custom holidays that overlap the requested date range and have an active org, team, or employee assignment.
- [ ] Return active preset holidays from active presets with active org, team, or employee assignments whose effective range overlaps the requested date range.
- [ ] Expand preset holidays into concrete `Holiday[]` dates for the requested year, using `durationDays`.
- [ ] Deduplicate holidays by ID/date source key before returning them to the calendar.

### Task 3: Verification

**Files:**
- Check modified files only unless the project exposes a targeted test command.

- [ ] Run formatter/type/lint checks available for the webapp.
- [ ] Run targeted tests if present for absence queries/components.
- [ ] Inspect `git diff` to confirm the changes are limited to the approved scope.
