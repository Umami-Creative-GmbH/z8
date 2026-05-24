# Admin Employee Name Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let organization admins update employee first and last names from `/settings/employees/{id}`.

**Architecture:** Extend the existing employee detail TanStack Form and `updateEmployeeAction` instead of adding a new mutation. Employee-owned fields continue to update `employee`; org-admin-only name fields update the linked Better Auth `user` row after the target employee is access-checked.

**Tech Stack:** Next.js App Router, React, TanStack Form, TanStack Query, Drizzle ORM, Better Auth schema, Vitest.

---

### Task 1: Add Form State and UI Fields

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts`

- [ ] **Step 1: Write failing sync test**

Add assertions that `syncEmployeeForm` writes `firstName` and `lastName` from `employee.user`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts`
Expected: FAIL because form values do not include synced name fields.

- [ ] **Step 3: Add form fields**

Add `firstName` and `lastName` to `EmployeeDetailFormValues`, `defaultFormValues`, invalid-field focus order, and `syncEmployeeForm`.

- [ ] **Step 4: Render name inputs**

In `EmployeeEditFormCard`, add two `TextField` inputs before gender. Allow `TextField.name` to include `firstName` and `lastName`. Disable both unless `canEditOrgAdminFields` is true or the form is updating.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts`
Expected: PASS.

### Task 2: Validate and Persist Admin Name Changes

**Files:**
- Modify: `apps/webapp/src/lib/validations/employee.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-scope.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`

- [ ] **Step 1: Write failing schema/action tests**

Update tests so `updateEmployeeSchema` accepts trimmed `firstName` and `lastName`, admin updates write the linked `user` row, and manager-scoped updates omit names.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`
Expected: FAIL because names are stripped and no `user` update is performed.

- [ ] **Step 3: Add validation**

Add optional `firstName` and `lastName` fields to `updateEmployeeSchema` using trimmed required strings with max length 100 when present.

- [ ] **Step 4: Keep managers scoped out**

Ensure `filterEmployeeUpdateForScopedManager` does not pass `firstName` or `lastName` through.

- [ ] **Step 5: Persist names to Better Auth user**

In `updateEmployeeAction`, strip name fields from the employee update payload. If `actor.accessTier === "orgAdmin"` and either name is present, update `user.firstName`, `user.lastName`, `user.name`, and `user.updatedAt` for `targetEmployee.userId`.

- [ ] **Step 6: Run tests to verify pass**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`
Expected: PASS.

### Task 3: Verify Feature Integration

**Files:**
- Existing modified files only.

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter webapp test -- src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`
Expected: PASS.

- [ ] **Step 2: Run type/lint checks if available through project scripts**

Run the repository's standard validation command if present; otherwise run the focused test commands above and report the limitation.

- [ ] **Step 3: Review diff**

Run: `git diff -- apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx apps/webapp/src/lib/validations/employee.ts apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts apps/webapp/src/app/[locale]/(app)/settings/employees/employee-scope.ts apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts`
Expected: Diff only contains the admin name editing change and tests.
