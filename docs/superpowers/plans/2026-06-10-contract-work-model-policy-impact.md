# Contract Work Model Policy Impact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make confirmed Contract & Work Model rows drive employee-specific expected-hours and work-balance behavior.

**Architecture:** Treat `employee_employment_history` as the employee contract override timeline. Requirement generation resolves confirmed rows by date, overlays row-specific policy and weekly minutes, then applies existing absence and holiday adjustments.

**Tech Stack:** Next.js server actions, Drizzle, Effect services, Luxon, TanStack Query/Form, Vitest.

---

### Task 1: Requirement Resolution

**Files:**
- Modify: `apps/webapp/src/lib/calendar/work-policy-requirements.ts`
- Test: `apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`

- [ ] Add failing tests for confirmed fixed employment-history rows overriding simple weekly policy hours.
- [ ] Add failing tests for hourly employment-history rows using published shifts.
- [ ] Implement slice-based confirmed employment-history resolution.
- [ ] Preserve absence and holiday adjustments after base requirements are built.
- [ ] Run `pnpm vitest apps/webapp/src/lib/calendar/work-policy-requirements.test.ts`.

### Task 2: Employee Detail Policy Selection

**Files:**
- Modify: `apps/webapp/src/components/settings/employee-employment-history-card.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx`
- Modify: `apps/webapp/src/lib/query/use-employee.ts`
- Test: `apps/webapp/src/components/settings/employee-employment-history-card.test.tsx`

- [ ] Load active work policies for the employee organization.
- [ ] Add a policy selector with an inherit option to the add-change form.
- [ ] Submit selected policy as `workPolicyId`, or `null` for inherit.
- [ ] Display selected policy name when present.
- [ ] Run `pnpm vitest apps/webapp/src/components/settings/employee-employment-history-card.test.tsx apps/webapp/src/lib/query/use-employee.test.ts`.

### Task 3: Work-Balance Invalidation

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts`

- [ ] Add tests that create, confirm, and cancel dirty work balance from the affected `validFrom` date.
- [ ] Call `markEmployeeWorkBalanceDirty` after successful timeline mutation.
- [ ] Use best-effort logging so the contract mutation does not fail if dirty marking fails.
- [ ] Run `pnpm vitest apps/webapp/src/app/[locale]/(app)/settings/employees/employment-history-actions.test.ts`.

### Task 4: Final Verification

- [ ] Run all targeted tests from Tasks 1-3.
- [ ] Run `pnpm test -- --runInBand` only if targeted tests expose broad coupling.
- [ ] Run `CI=true pnpm build` if TypeScript changes are broad enough to risk build-only failures.
