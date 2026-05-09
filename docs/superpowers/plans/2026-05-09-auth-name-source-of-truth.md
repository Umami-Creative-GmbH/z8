# Auth Name Source Of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Better Auth `user.firstName` and `user.lastName` the application source of truth for structured personal names while leaving deprecated employee name columns in the database.

**Architecture:** Keep `employee.firstName` and `employee.lastName` in the schema, but stop application reads and writes from depending on them. Employee records continue to own organization-scoped employment fields, while display/search flows use joined auth user data with a shared display-name helper.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM, Better Auth, Effect services, TanStack Form, TanStack Query, Vitest, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/lib/auth/derived-user-name.ts` - add a reusable display-name helper for auth user rows.
- Modify: `apps/webapp/src/lib/auth/derived-user-name.test.ts` - cover auth-name fallback behavior.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts` - stop writing employee name fields during profile updates.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts` - assert profile updates keep employee names untouched.
- Modify: `apps/webapp/src/components/settings/profile-form.tsx` - initialize form names from auth user data instead of employee data.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts` - sort/search/select using auth structured names and include them in selected user data.
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts` - source-level guard for auth-name search expressions.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts` - add auth structured names to selectable employee user type.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx` - display employee names via auth helper.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx` - remove employee-owned name form fields and display auth helper output.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts` - remove name fields from employee detail form state.
- Modify: `apps/webapp/src/lib/query/use-employee.ts` - remove manager name duplication from local types and rely on `manager.user`.
- Modify: `apps/webapp/src/lib/validations/employee.ts` - remove first/last name from employee create/update schemas.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts` - stop writing employee name fields on create/update.
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.ts` - write onboarding names to Better Auth and keep employee writes to employee-owned fields.
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.test.ts` - cover onboarding auth-name write and employee-name non-write.

## Task 1: Add Auth Display Name Helper

**Files:**
- Modify: `apps/webapp/src/lib/auth/derived-user-name.ts`
- Modify: `apps/webapp/src/lib/auth/derived-user-name.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add these tests to `apps/webapp/src/lib/auth/derived-user-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	buildAuthUserDisplayName,
	toAuthStructuredName,
} from "./derived-user-name";

describe("buildAuthUserDisplayName", () => {
	it("uses structured auth names first", () => {
		expect(
			buildAuthUserDisplayName({
				firstName: " Ada ",
				lastName: " Lovelace ",
				name: "Countess",
				email: "ada@example.com",
			}),
		).toBe("Ada Lovelace");
	});

	it("falls back to auth name and email", () => {
		expect(
			buildAuthUserDisplayName({
				firstName: null,
				lastName: null,
				name: "Grace Hopper",
				email: "grace@example.com",
			}),
		).toBe("Grace Hopper");

		expect(
			buildAuthUserDisplayName({
				firstName: "",
				lastName: "",
				name: "",
				email: "unknown@example.com",
			}),
		).toBe("unknown@example.com");
	});
});
```

- [ ] **Step 2: Run helper tests and verify failure**

Run: `pnpm --filter webapp test src/lib/auth/derived-user-name.test.ts`

Expected: FAIL because `buildAuthUserDisplayName` is not exported.

- [ ] **Step 3: Implement helper**

Add this to `apps/webapp/src/lib/auth/derived-user-name.ts`:

```ts
export interface AuthUserDisplayNameInput {
	firstName?: string | null;
	lastName?: string | null;
	name?: string | null;
	email?: string | null;
}

export function buildAuthUserDisplayName(user: AuthUserDisplayNameInput): string {
	return deriveUserName({
		firstName: user.firstName,
		lastName: user.lastName,
		fallbackName: user.name,
	}) || trimStructuredNamePart(user.email) || "";
}
```

- [ ] **Step 4: Run helper tests and verify pass**

Run: `pnpm --filter webapp test src/lib/auth/derived-user-name.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/webapp/src/lib/auth/derived-user-name.ts apps/webapp/src/lib/auth/derived-user-name.test.ts
git commit -m "feat: add auth display name helper"
```

## Task 2: Stop Profile Updates From Writing Employee Names

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts`
- Modify: `apps/webapp/src/components/settings/profile-form.tsx`

- [ ] **Step 1: Write failing action test**

In `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts`, add or update the profile-details test so the employee update payload contains only employee-owned fields:

```ts
expect(employeeUpdateSetSpy).toHaveBeenCalledWith({
	gender: "other",
	birthday: birthday,
});
expect(employeeUpdateSetSpy).not.toHaveBeenCalledWith(
	expect.objectContaining({ firstName: "Ada", lastName: "Lovelace" }),
);
```

- [ ] **Step 2: Run profile action test and verify failure**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/settings/profile/actions.test.ts'`

Expected: FAIL because the current update payload includes `firstName` and `lastName`.

- [ ] **Step 3: Update profile action implementation**

In `syncActiveEmployeeProfile` inside `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`, change the employee update payload to:

```ts
.set({
	gender: data.gender ?? null,
	birthday: data.birthday ?? null,
})
```

Then remove the unused `trimStructuredNamePart` import from the file.

- [ ] **Step 4: Update profile form initialization**

In `apps/webapp/src/components/settings/profile-form.tsx`, change the form initialization lines to always prefer auth user names:

```ts
form.setFieldValue("image", user.image || "");
form.setFieldValue("firstName", user.firstName || "");
form.setFieldValue("lastName", user.lastName || "");
form.setFieldValue("gender", (emp?.gender as ProfileFormValues["gender"] | null) || "");
form.setFieldValue("birthday", emp?.birthday ? new Date(emp.birthday) : null);
```

- [ ] **Step 5: Run profile tests and verify pass**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/settings/profile/actions.test.ts'`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts' apps/webapp/src/components/settings/profile-form.tsx
git commit -m "fix: stop syncing auth names to employee profiles"
```

## Task 3: Use Auth Names In Employee Queries And Directory UI

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx`

- [ ] **Step 1: Write failing source guard test**

Create `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./employee-queries.actions.ts", import.meta.url)), "utf8");

describe("employee query name source", () => {
	it("uses auth user structured names for employee search and sort", () => {
		expect(source).toContain("${user.firstName}");
		expect(source).toContain("${user.lastName}");
		expect(source).toContain("ilike(user.firstName, pattern)");
		expect(source).toContain("ilike(user.lastName, pattern)");
		expect(source).not.toContain("ilike(employee.firstName, pattern)");
		expect(source).not.toContain("ilike(employee.lastName, pattern)");
	});
});
```

- [ ] **Step 2: Run employee query tests and verify failure**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts'`

Expected: FAIL because current search references employee name columns.

- [ ] **Step 3: Update employee query name expressions**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts`, change `employeeSortName` to:

```ts
const employeeSortName = sql<string>`
	coalesce(
		nullif(concat_ws(' ', ${user.firstName}, ${user.lastName}), ''),
		nullif(${user.name}, ''),
		${user.email}
	)
`;
```

In `buildEmployeeFilters`, replace employee-name search with auth structured names:

```ts
or(
	ilike(user.firstName, pattern),
	ilike(user.lastName, pattern),
	ilike(user.name, pattern),
	ilike(user.email, pattern),
	ilike(employee.position, pattern),
)!
```

In `SelectableEmployeeRow`, change the selected user type to include structured names:

```ts
user: Pick<typeof user.$inferSelect, "id" | "name" | "firstName" | "lastName" | "email" | "image">;
```

In the `listEmployeesForSelect` select shape, add:

```ts
firstName: user.firstName,
lastName: user.lastName,
```

- [ ] **Step 4: Update selectable employee type**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts`, change `SelectableEmployee["user"]` to:

```ts
user: {
	id: string;
	name: string;
	firstName: string | null;
	lastName: string | null;
	email: string;
	image: string | null;
};
```

- [ ] **Step 5: Update directory display**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx`, import the helper:

```ts
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
```

Use it in the employee cell:

```tsx
const displayName = buildAuthUserDisplayName(row.original.user);

return (
	<div className="flex items-center gap-3">
		<UserAvatar image={row.original.user.image} seed={row.original.user.id} name={displayName} size="sm" />
		<div>
			<div className="font-medium">{displayName}</div>
			<div className="text-sm text-muted-foreground">{row.original.user.email}</div>
		</div>
	</div>
);
```

- [ ] **Step 6: Run employee query tests and typecheck**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/settings/employees/employee-queries.actions.test.ts'`

Expected: PASS.

Run: `pnpm --filter webapp typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx'
git commit -m "fix: derive employee directory names from auth users"
```

## Task 4: Remove Employee-Owned Name Editing From Employee Detail

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts`
- Modify: `apps/webapp/src/lib/query/use-employee.ts`

- [ ] **Step 1: Write failing UI utility test**

If `page-utils.ts` has no test file, create `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { syncEmployeeForm } from "./page-utils";

describe("syncEmployeeForm", () => {
	it("does not sync deprecated employee name fields into the edit form", () => {
		const form = {
			reset: vi.fn(),
			setFieldValue: vi.fn(),
		};

		syncEmployeeForm(form as never, {
			firstName: "Stale",
			lastName: "Employee",
			gender: "other",
			position: "Engineer",
			employeeNumber: "E-1",
			role: "employee",
			contractType: "fixed",
			currentHourlyRate: null,
			user: { canUseWebapp: true, canUseDesktop: true, canUseMobile: true },
		} as never);

		expect(form.setFieldValue).not.toHaveBeenCalledWith("firstName", expect.anything());
		expect(form.setFieldValue).not.toHaveBeenCalledWith("lastName", expect.anything());
	});
});
```

- [ ] **Step 2: Run utility test and verify failure**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts'`

Expected: FAIL because `syncEmployeeForm` currently writes `firstName` and `lastName`.

- [ ] **Step 3: Remove name fields from form values**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts`, remove `firstName` and `lastName` from `EmployeeDetailFormValues` and `defaultFormValues`, and remove these lines from `syncEmployeeForm`:

```ts
form.setFieldValue("firstName", employee.firstName || "");
form.setFieldValue("lastName", employee.lastName || "");
```

- [ ] **Step 4: Remove name inputs and use auth display helper**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx`, import the helper:

```ts
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
```

In `EmployeeOverviewCard`, replace `employee.user.name` display and avatar name with:

```tsx
const displayName = buildAuthUserDisplayName(employee.user);
```

Use `displayName` for `UserAvatar` and the visible name. Remove the first-name and last-name `<TextField>` block from `EmployeeEditFormCard`.

Change the `TextField` prop type at the bottom of the file from:

```ts
name: "firstName" | "lastName" | "position" | "employeeNumber";
```

to:

```ts
name: "position" | "employeeNumber";
```

- [ ] **Step 5: Update manager local type**

In `apps/webapp/src/lib/query/use-employee.ts`, remove `firstName` and `lastName` from the local `Manager` type. The manager display path already uses `manager.user.name`.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts'`

Expected: PASS.

Run: `pnpm --filter webapp typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx' 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.test.ts' apps/webapp/src/lib/query/use-employee.ts
git commit -m "fix: remove employee-owned name editing"
```

## Task 5: Stop Employee Mutations From Writing Name Columns

**Files:**
- Modify: `apps/webapp/src/lib/validations/employee.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts`

- [ ] **Step 1: Write failing mutation test**

In `employee-mutations.actions.test.ts`, add or update create/update expectations so insert and update payloads do not include employee name fields:

```ts
expect(employeeInsertValuesSpy).not.toHaveBeenCalledWith(
	expect.objectContaining({ firstName: expect.anything() }),
);
expect(employeeInsertValuesSpy).not.toHaveBeenCalledWith(
	expect.objectContaining({ lastName: expect.anything() }),
);
expect(employeeUpdateSetSpy).not.toHaveBeenCalledWith(
	expect.objectContaining({ firstName: expect.anything(), lastName: expect.anything() }),
);
```

- [ ] **Step 2: Run mutation tests and verify failure**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts'`

Expected: FAIL because create/update currently accepts or writes employee name fields.

- [ ] **Step 3: Remove names from employee validation schemas**

In `apps/webapp/src/lib/validations/employee.ts`, remove `firstName` and `lastName` from `createEmployeeSchema` and `updateEmployeeSchema`. Leave `personalInformationSchema` unchanged because self-service profile validation still accepts structured names.

- [ ] **Step 4: Remove create payload name writes**

In `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`, remove these lines from the create payload:

```ts
firstName: validatedData.firstName || null,
lastName: validatedData.lastName || null,
```

The update path should not need extra filtering after schema removal, but keep the destructuring pattern intact:

```ts
const { canUseWebapp, canUseDesktop, canUseMobile, ...employeeUpdateData } = updatePayload;
```

- [ ] **Step 5: Run mutation tests and typecheck**

Run: `pnpm --filter webapp test 'src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts'`

Expected: PASS.

Run: `pnpm --filter webapp typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/webapp/src/lib/validations/employee.ts 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts'
git commit -m "fix: stop writing employee name columns"
```

## Task 6: Move Onboarding Names To Better Auth Only

**Files:**
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.ts`
- Modify: `apps/webapp/src/lib/effect/services/onboarding.service.test.ts`

- [ ] **Step 1: Write failing onboarding test**

In `onboarding.service.test.ts`, update the profile completion test to assert that employee update payload excludes names and that Better Auth receives structured names. Use existing mocks in the file and add expectations shaped like:

```ts
expect(authUpdateUserSpy).toHaveBeenCalledWith(
	expect.objectContaining({
		body: expect.objectContaining({
			firstName: "Ada",
			lastName: "Lovelace",
			name: "Ada Lovelace",
		}),
	}),
);

expect(employeeUpdateSetSpy).not.toHaveBeenCalledWith(
	expect.objectContaining({ firstName: "Ada", lastName: "Lovelace" }),
);
```

- [ ] **Step 2: Run onboarding tests and verify failure**

Run: `pnpm --filter webapp test src/lib/effect/services/onboarding.service.test.ts`

Expected: FAIL because onboarding currently writes names to employee records and may not update Better Auth in the profile step.

- [ ] **Step 3: Update onboarding profile flow**

In `apps/webapp/src/lib/effect/services/onboarding.service.ts`, import the auth-name helper used by profile actions:

```ts
import { toAuthStructuredName } from "@/lib/auth/derived-user-name";
```

In the profile update section around the existing `profileData`, add a Better Auth update before employee writes:

```ts
await auth.api.updateUser({
	body: toAuthStructuredName({
		firstName: data.firstName,
		lastName: data.lastName,
		fallbackName: session.user.name,
	}),
	headers: await headers(),
});
```

Then change `profileData` to employee-owned fields only:

```ts
const profileData = {
	gender: data.gender || null,
	birthday: data.birthday || null,
};
```

Keep the existing employee create/update logic so onboarding still creates an employee record when an active organization exists.

- [ ] **Step 4: Update profile completion check**

In the profile status logic near `profileCompleted`, change the check from employee names to auth names:

```ts
profileCompleted: !!(session.user.firstName && session.user.lastName),
```

Do not read `employee.firstName` or `employee.lastName` in the profile completion calculation.

- [ ] **Step 5: Run onboarding tests**

Run: `pnpm --filter webapp test src/lib/effect/services/onboarding.service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/webapp/src/lib/effect/services/onboarding.service.ts apps/webapp/src/lib/effect/services/onboarding.service.test.ts
git commit -m "fix: store onboarding names in auth users"
```

## Task 7: Sweep Remaining Employee Name Reads And Verify

**Files:**
- Modify any remaining application files found by the sweep that still use employee-owned names for display/search/write behavior.

- [ ] **Step 1: Search remaining code references**

Run: `rg "employee\.firstName|employee\.lastName|\.firstName.*\.lastName|firstName: validatedData|lastName: validatedData" apps/webapp/src`

Expected: Remaining references are limited to database schema/types, tests intentionally covering deprecated columns, or auth-user name handling. Any product display or mutation reference to employee-owned names must be updated to auth user names or removed.

- [ ] **Step 2: Update scheduling and selector displays if found**

For UI code that has joined `user`, use:

```ts
const displayName = buildAuthUserDisplayName(employee.user);
```

For UI code that only receives employee fields and no user object, update the query or action that feeds it to include the joined user fields `id`, `name`, `firstName`, `lastName`, `email`, and `image`.

- [ ] **Step 3: Run targeted tests**

Run these commands:

```bash
pnpm --filter webapp test src/lib/auth/derived-user-name.test.ts
pnpm --filter webapp test 'src/app/[locale]/(app)/settings/profile/actions.test.ts'
pnpm --filter webapp test 'src/app/[locale]/(app)/settings/employees/employee-mutations.actions.test.ts'
pnpm --filter webapp test src/lib/effect/services/onboarding.service.test.ts
```

Expected: PASS for each command.

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm --filter webapp typecheck
pnpm --filter webapp test
```

Expected: PASS.

- [ ] **Step 5: Commit final sweep if changes were made**

Run:

```bash
git add apps/webapp/src
git commit -m "fix: finish auth-based employee name migration"
```

If Step 1 finds no additional product references and no files changed in this task, do not create an empty commit.

## Notes

- Do not edit `apps/webapp/src/db/auth-schema.ts`; it is generated.
- Do not drop `employee.firstName` or `employee.lastName` in this implementation.
- Use `pnpm`, not `npm` or `bun`.
- Preserve organization scoping on all employee queries and mutations.
- Do not introduce organization-specific legal names in this change.
