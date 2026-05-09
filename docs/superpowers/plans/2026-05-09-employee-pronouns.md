# Employee Pronouns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional employee pronouns with preset plus custom entry, profile/admin editing, and consistent app UI identity display.

**Architecture:** Store pronouns as nullable text on the organization-scoped `employee` table and validate normalized strings through shared schemas. Add one reusable pronoun input and one small identity formatting helper so profile, employee settings, selectors, directory, and org chart surfaces share behavior instead of duplicating display logic.

**Tech Stack:** Next.js server actions, Drizzle ORM, PostgreSQL, Zod, TanStack Form, React, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/db/schema/organization.ts` adds `employee.pronouns`.
- Create: `apps/webapp/drizzle/0017_employee_pronouns.sql` adds the database migration.
- Modify: `apps/webapp/src/lib/validations/employee.ts` adds `pronounsSchema`, normalization, and employee create/update/profile schema fields.
- Modify: `apps/webapp/src/lib/validations/profile.ts` accepts pronouns in profile updates.
- Create: `apps/webapp/src/lib/employee-identity.ts` formats employee names with optional pronouns.
- Create: `apps/webapp/src/lib/employee-identity.test.ts` covers formatting behavior.
- Create: `apps/webapp/src/components/settings/pronouns-field.tsx` provides the shared preset plus custom TanStack Form field UI.
- Modify: `apps/webapp/src/components/settings/profile-form.tsx` loads, edits, and submits pronouns.
- Modify: `apps/webapp/src/components/settings/profile-form.test.tsx` verifies profile pronouns UI and payloads.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts` syncs pronouns to the active employee record.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts` verifies normalized pronoun persistence.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts` includes pronouns in detail form values.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx` displays and edits pronouns.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx` verifies detail display and form copy.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-scope.ts` lets scoped managers update pronouns.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts` persists normalized pronouns through create/update/profile actions.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts` adds pronouns to selectable employee shapes.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts` selects pronouns for directory and employee selectors.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx` renders directory names with pronouns.
- Modify: `apps/webapp/src/components/employee-select/types.ts` adds pronouns to local selectable employee type.
- Modify: `apps/webapp/src/components/employee-select/employee-select-item.tsx` renders selectable employee names with pronouns.
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-types.ts` includes pronouns in org chart employee nodes and search results.
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.ts` carries pronouns into graph nodes.
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/actions.ts` selects pronouns for org chart graph and search.
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx` renders org chart names with pronouns.

---

### Task 1: Validation, Formatting, And Schema

**Files:**
- Create: `apps/webapp/src/lib/employee-identity.test.ts`
- Create: `apps/webapp/src/lib/employee-identity.ts`
- Modify: `apps/webapp/src/lib/validations/employee.ts`
- Modify: `apps/webapp/src/lib/validations/profile.ts`
- Modify: `apps/webapp/src/db/schema/organization.ts:142-151`
- Create: `apps/webapp/drizzle/0017_employee_pronouns.sql`

- [ ] **Step 1: Write failing identity helper tests**

Create `apps/webapp/src/lib/employee-identity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatEmployeeIdentityName, normalizePronouns } from "./employee-identity";

describe("employee identity helpers", () => {
	const fallbackUser = { name: "Ada Lovelace", email: "ada@example.com" };

	it("formats names with pronouns when present", () => {
		expect(
			formatEmployeeIdentityName({
				firstName: "Ada",
				lastName: "Lovelace",
				pronouns: "she/her",
				user: fallbackUser,
			}),
		).toBe("Ada Lovelace (she/her)");
	});

	it("preserves the current display name when pronouns are absent", () => {
		expect(
			formatEmployeeIdentityName({
				firstName: null,
				lastName: null,
				pronouns: null,
				user: fallbackUser,
			}),
		).toBe("Ada Lovelace");
	});

	it("falls back to email local part when no display name exists", () => {
		expect(
			formatEmployeeIdentityName({
				firstName: null,
				lastName: null,
				pronouns: "they/them",
				user: { name: "", email: "sam@example.com" },
			}),
		).toBe("sam (they/them)");
	});

	it("normalizes empty and whitespace pronouns to null", () => {
		expect(normalizePronouns("   ")).toBeNull();
		expect(normalizePronouns(null)).toBeNull();
		expect(normalizePronouns(undefined)).toBeNull();
	});

	it("trims custom pronouns", () => {
		expect(normalizePronouns("  xe/xem  ")).toBe("xe/xem");
	});
});
```

- [ ] **Step 2: Run identity helper tests to verify they fail**

Run from repo root:

```bash
pnpm --dir apps/webapp test src/lib/employee-identity.test.ts
```

Expected: FAIL because `apps/webapp/src/lib/employee-identity.ts` does not exist.

- [ ] **Step 3: Implement identity helper**

Create `apps/webapp/src/lib/employee-identity.ts`:

```ts
export type EmployeeIdentityInput = {
	firstName?: string | null;
	lastName?: string | null;
	pronouns?: string | null;
	user: {
		name?: string | null;
		email: string;
	};
};

export function normalizePronouns(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed || null;
}

export function getEmployeeBaseDisplayName(employee: EmployeeIdentityInput): string {
	const structuredName = [employee.firstName, employee.lastName]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(" ");

	if (structuredName) return structuredName;

	const userName = employee.user.name?.trim();
	if (userName) return userName;

	return employee.user.email.split("@")[0] || employee.user.email;
}

export function formatEmployeeIdentityName(employee: EmployeeIdentityInput): string {
	const name = getEmployeeBaseDisplayName(employee);
	const pronouns = normalizePronouns(employee.pronouns);

	return pronouns ? `${name} (${pronouns})` : name;
}
```

- [ ] **Step 4: Add pronouns validation schema**

Modify `apps/webapp/src/lib/validations/employee.ts` near the existing gender schema:

```ts
export const genderSchema = z.enum(["male", "female", "other"]);

export const pronounsSchema = z
	.string()
	.max(50, "Pronouns must be 50 characters or less")
	.transform((value) => value.trim())
	.transform((value) => value || null)
	.optional()
	.nullable();
```

Then add `pronouns: pronounsSchema,` immediately after each existing `gender` field in `personalInformationSchema`, `createEmployeeSchema`, and `updateEmployeeSchema`:

```ts
gender: genderSchema.optional().nullable(),
pronouns: pronounsSchema,
birthday: z.date().max(new Date(), "Birthday must be in the past").optional().nullable(),
```

For `personalInformationSchema`, keep the existing optional gender shape and add:

```ts
gender: genderSchema.optional(),
pronouns: pronounsSchema,
birthday: z.date().max(new Date(), "Birthday must be in the past").optional().nullable(),
```

- [ ] **Step 5: Add profile validation field**

Modify `apps/webapp/src/lib/validations/profile.ts` imports and schema:

```ts
import { genderSchema, pronounsSchema } from "./employee";
```

Add pronouns to `profileDetailsUpdateSchema` after `gender`:

```ts
gender: genderSchema.optional().nullable(),
pronouns: pronounsSchema,
birthday: z.date().max(new Date(), "Birthday must be in the past").optional().nullable(),
```

- [ ] **Step 6: Add database schema and migration**

Modify `apps/webapp/src/db/schema/organization.ts` in the personal information block:

```ts
firstName: text("first_name"),
lastName: text("last_name"),
gender: genderEnum("gender"),
pronouns: text("pronouns"),
birthday: timestamp("birthday", { mode: "date" }),
```

Create `apps/webapp/drizzle/0017_employee_pronouns.sql`:

```sql
ALTER TABLE "employee" ADD COLUMN "pronouns" text;
```

- [ ] **Step 7: Run focused tests**

Run from repo root:

```bash
pnpm --dir apps/webapp test src/lib/employee-identity.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit validation and schema work**

```bash
git add apps/webapp/src/lib/employee-identity.ts apps/webapp/src/lib/employee-identity.test.ts apps/webapp/src/lib/validations/employee.ts apps/webapp/src/lib/validations/profile.ts apps/webapp/src/db/schema/organization.ts apps/webapp/drizzle/0017_employee_pronouns.sql
git commit -m "feat: add employee pronouns data model"
```

---

### Task 2: Profile Pronouns Editing

**Files:**
- Create: `apps/webapp/src/components/settings/pronouns-field.tsx`
- Modify: `apps/webapp/src/components/settings/profile-form.tsx`
- Modify: `apps/webapp/src/components/settings/profile-form.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts`

- [ ] **Step 1: Write failing profile form test**

Modify the default employee mock in `apps/webapp/src/components/settings/profile-form.test.tsx`:

```ts
getCurrentEmployeeMock.mockResolvedValue({
	firstName: "Employee",
	lastName: "Record",
	gender: "female",
	pronouns: "she/her",
	birthday: "2020-01-02T00:00:00.000Z",
});
```

Update the existing submit expectation in `submits structured names through updateProfileDetails`:

```ts
expect(updateProfileDetailsMock).toHaveBeenCalledWith({
	firstName: "Ada",
	lastName: "Lovelace",
	gender: "female",
	pronouns: "she/her",
	birthday: new Date("2020-01-02T00:00:00.000Z"),
	image: "/avatar.png",
});
```

Update the no-employee fallback expectation:

```ts
expect(updateProfileDetailsMock).toHaveBeenCalledWith({
	firstName: "Auth",
	lastName: "User",
	gender: null,
	pronouns: null,
	birthday: null,
	image: "/avatar.png",
});
```

Add this test in the same describe block:

```ts
it("submits custom pronouns through updateProfileDetails", async () => {
	renderProfileForm();

	const pronounsInput = await screen.findByLabelText("Pronouns");
	fireEvent.change(pronounsInput, { target: { value: "xe/xem" } });
	fireEvent.click(screen.getByRole("button", { name: "Update Profile" }));

	await waitFor(() => {
		expect(updateProfileDetailsMock).toHaveBeenCalledWith(
			expect.objectContaining({ pronouns: "xe/xem" }),
		);
	});
});
```

- [ ] **Step 2: Run profile form test to verify it fails**

Run from repo root:

```bash
pnpm --dir apps/webapp test src/components/settings/profile-form.test.tsx
```

Expected: FAIL because the profile form does not render a `Pronouns` field or submit `pronouns`.

- [ ] **Step 3: Create shared pronouns field component**

Create `apps/webapp/src/components/settings/pronouns-field.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	fieldHasError,
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";

const PRONOUN_PRESETS = ["she/her", "he/him", "they/them"] as const;
const CUSTOM_VALUE = "__custom__";

type PronounsFieldApi = {
	state: { value: unknown };
	handleChange: (value: string) => void;
	handleBlur: () => void;
};

type PronounsForm = {
	Field: (props: { name: string; children: (field: PronounsFieldApi) => ReactNode }) => ReactNode;
};

export function PronounsField({
	form,
	name,
	disabled = false,
	label,
	placeholder,
	customLabel,
	customPlaceholder,
}: {
	form: PronounsForm;
	name: string;
	disabled?: boolean;
	label: string;
	placeholder: string;
	customLabel: string;
	customPlaceholder: string;
}) {
	return (
		<form.Field name={name}>
			{(field) => {
				const value = typeof field.state.value === "string" ? field.state.value : "";
				const isPreset = PRONOUN_PRESETS.includes(value as (typeof PRONOUN_PRESETS)[number]);
				const selectValue = isPreset ? value : "";

				return (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field as never)}>{label}</TFormLabel>
						<Select
							value={selectValue}
							disabled={disabled}
							onValueChange={(nextValue) => {
								field.handleChange(nextValue === CUSTOM_VALUE ? "" : nextValue);
							}}
						>
							<TFormControl hasError={fieldHasError(field as never)}>
								<SelectTrigger aria-label={label}>
									<SelectValue placeholder={placeholder} />
								</SelectTrigger>
							</TFormControl>
							<SelectContent>
								<SelectItem value="she/her">she/her</SelectItem>
								<SelectItem value="he/him">he/him</SelectItem>
								<SelectItem value="they/them">they/them</SelectItem>
								<SelectItem value={CUSTOM_VALUE}>{customLabel}</SelectItem>
							</SelectContent>
						</Select>

						<div className="space-y-2">
							<Label className="text-xs text-muted-foreground">{customLabel}</Label>
							<Input
								aria-label={label}
								value={value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								placeholder={customPlaceholder}
								disabled={disabled}
							/>
						</div>
						<TFormMessage field={field as never} />
					</TFormItem>
				);
			}}
		</form.Field>
	);
}
```

- [ ] **Step 4: Wire pronouns into profile form**

Modify `apps/webapp/src/components/settings/profile-form.tsx` imports:

```tsx
import { PronounsField } from "@/components/settings/pronouns-field";
```

Add `pronouns` to `ProfileFormValues` and default values:

```ts
pronouns: string;
```

```ts
pronouns: "",
```

Submit normalized value:

```ts
pronouns: value.pronouns || null,
```

Load employee data:

```ts
form.setFieldValue("pronouns", emp?.pronouns || "");
```

Render the field after the gender controls and before birthday:

```tsx
<PronounsField
	form={form as never}
	name="pronouns"
	label={t("settings.profile.pronouns", "Pronouns")}
	placeholder={t("settings.profile.pronouns.placeholder", "Select pronouns")}
	customLabel={t("settings.profile.pronouns.custom", "Custom pronouns")}
	customPlaceholder={t("settings.profile.pronouns.customPlaceholder", "Enter pronouns")}
	disabled={isSubmitting}
/>
```

- [ ] **Step 5: Wire pronouns into profile server action**

Modify `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.ts` types:

```ts
type StructuredProfileDetailsInput = {
	firstName: string;
	lastName: string;
	gender?: "male" | "female" | "other" | null;
	pronouns?: string | null;
	birthday?: Date | null;
	image?: string | null;
};
```

Add `pronouns` to the public input type for `updateProfileDetails`:

```ts
pronouns?: string | null;
```

Add the field to `syncActiveEmployeeProfile` update payload:

```ts
pronouns: result.data.pronouns ?? null,
```

Use `data.pronouns ?? null` if applying inside the existing `data` scope rather than the outer action result scope.

- [ ] **Step 6: Update profile action tests**

Modify each `updateProfileDetails` call in `apps/webapp/src/app/[locale]/(app)/settings/profile/actions.test.ts` that represents a valid profile details save to include pronouns:

```ts
pronouns: "she/her",
```

In `syncs the active organization employee record when profile details change`, expect:

```ts
expect(mockState.employeeUpdateSet).toHaveBeenCalledWith({
	firstName: "Grace",
	lastName: "Hopper",
	gender: "female",
	pronouns: "she/her",
	birthday: new Date("1906-12-09T00:00:00.000Z"),
});
```

Add a validation test:

```ts
it("rejects pronouns longer than 50 characters", async () => {
	const result = await updateProfileDetails({
		firstName: "Grace",
		lastName: "Hopper",
		gender: "female",
		pronouns: "x".repeat(51),
		birthday: null,
		image: null,
	});

	expect(result).toEqual({
		success: false,
		error: "Pronouns must be 50 characters or less",
		code: "ValidationError",
	});
	expect(mockState.updateUser).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Run profile tests**

Run from repo root:

```bash
pnpm --dir apps/webapp test src/components/settings/profile-form.test.tsx src/app/\[locale\]/\(app\)/settings/profile/actions.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit profile editing work**

```bash
git add apps/webapp/src/components/settings/pronouns-field.tsx apps/webapp/src/components/settings/profile-form.tsx apps/webapp/src/components/settings/profile-form.test.tsx apps/webapp/src/app/\[locale\]/\(app\)/settings/profile/actions.ts apps/webapp/src/app/\[locale\]/\(app\)/settings/profile/actions.test.ts
git commit -m "feat: add profile pronouns editing"
```

---

### Task 3: Employee Detail Pronouns Editing

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-scope.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts`

- [ ] **Step 1: Write failing employee detail tests**

Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.test.tsx` translations:

```ts
["settings.employees.detailView.pronouns", "Pronomen"],
["settings.employees.detailView.pronounsPlaceholder", "Pronomen auswählen"],
["settings.employees.detailView.pronounsCustom", "Eigene Pronomen"],
["settings.employees.detailView.pronounsCustomPlaceholder", "Pronomen eingeben"],
```

Modify the `employee` fixture:

```ts
pronouns: "he/him",
```

Modify `values` in `createForm()`:

```ts
pronouns: "he/him",
```

Add assertions in `renders the detail view strings in German`:

```ts
expect(screen.getByText("Johannes Glier (he/him)")).toBeTruthy();
```

Add assertions in `renders the edit form strings in German`:

```ts
expect(screen.getByText("Pronomen")).toBeTruthy();
expect(screen.getByText("he/him")).toBeTruthy();
```

- [ ] **Step 2: Run employee detail section test to verify it fails**

Run from repo root:

```bash
pnpm --dir apps/webapp test src/app/\[locale\]/\(app\)/settings/employees/\[employeeId\]/page-sections.test.tsx
```

Expected: FAIL because employee detail UI does not render pronouns.

- [ ] **Step 3: Add pronouns to detail form values**

Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-utils.ts`:

```ts
export interface EmployeeDetailFormValues {
	firstName: string;
	lastName: string;
	gender: "male" | "female" | "other" | undefined;
	pronouns: string;
	position: string;
```

Add default value:

```ts
pronouns: "",
```

Add sync line:

```ts
form.setFieldValue("pronouns", employee.pronouns || "");
```

- [ ] **Step 4: Render and edit pronouns in employee detail**

Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/[employeeId]/page-sections.tsx` imports:

```tsx
import { PronounsField } from "@/components/settings/pronouns-field";
import { formatEmployeeIdentityName } from "@/lib/employee-identity";
```

In `EmployeeOverviewCard`, compute and render the identity name:

```tsx
const employeeDisplayName = formatEmployeeIdentityName(employee);
```

Use it in the card header area:

```tsx
<UserAvatar image={employee.user.image} seed={employee.user.id} name={employeeDisplayName} size="lg" />
<div>
	<div className="font-medium">{employeeDisplayName}</div>
	<div className="text-sm text-muted-foreground">{employee.user.email}</div>
</div>
```

Render the pronouns field after the gender select:

```tsx
<PronounsField
	form={form as never}
	name="pronouns"
	label={t("settings.employees.detailView.pronouns", "Pronouns")}
	placeholder={t("settings.employees.detailView.pronounsPlaceholder", "Select pronouns")}
	customLabel={t("settings.employees.detailView.pronounsCustom", "Custom pronouns")}
	customPlaceholder={t(
		"settings.employees.detailView.pronounsCustomPlaceholder",
		"Enter pronouns",
	)}
	disabled={!canEditManagerFields || isUpdating}
/>
```

- [ ] **Step 5: Allow managers to edit pronouns and persist normalized value**

Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-scope.ts`:

```ts
const SCOPED_MANAGER_EDITABLE_EMPLOYEE_FIELDS = [
	"firstName",
	"lastName",
	"gender",
	"pronouns",
	"position",
] as const;
```

Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-mutations.actions.ts` create payload:

```ts
pronouns: validatedData.pronouns || null,
```

No special update payload code is needed after Task 1 validation, because `updateEmployeeSchema` already normalizes `pronouns` and `employeeUpdateData` spreads validated fields.

In `updateOwnProfile`, add:

```ts
pronouns: validatedData.pronouns,
```

- [ ] **Step 6: Run employee detail tests**

Run from repo root:

```bash
pnpm --dir apps/webapp test src/app/\[locale\]/\(app\)/settings/employees/\[employeeId\]/page-sections.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit employee detail editing work**

```bash
git add apps/webapp/src/app/\[locale\]/\(app\)/settings/employees/\[employeeId\]/page-utils.ts apps/webapp/src/app/\[locale\]/\(app\)/settings/employees/\[employeeId\]/page-sections.tsx apps/webapp/src/app/\[locale\]/\(app\)/settings/employees/\[employeeId\]/page-sections.test.tsx apps/webapp/src/app/\[locale\]/\(app\)/settings/employees/employee-scope.ts apps/webapp/src/app/\[locale\]/\(app\)/settings/employees/employee-mutations.actions.ts
git commit -m "feat: add employee detail pronouns editing"
```

---

### Task 4: Directory And Employee Select Identity Display

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx`
- Modify: `apps/webapp/src/components/employee-select/types.ts`
- Modify: `apps/webapp/src/components/employee-select/employee-select-item.tsx`

- [ ] **Step 1: Add pronouns to selectable employee types and queries**

Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-action-types.ts`:

```ts
export interface SelectableEmployee {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	pronouns: string | null;
	position: string | null;
```

Modify `apps/webapp/src/components/employee-select/types.ts`:

```ts
export interface SelectableEmployee {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	pronouns: string | null;
	position: string | null;
```

Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-queries.actions.ts` selectable pick type:

```ts
"id" | "userId" | "firstName" | "lastName" | "pronouns" | "position" | "role" | "isActive" | "teamId"
```

Add `pronouns` to both selectable query projections:

```ts
pronouns: employee.pronouns,
```

- [ ] **Step 2: Render directory names with pronouns**

Modify `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx` import:

```tsx
import { formatEmployeeIdentityName } from "@/lib/employee-identity";
```

Update the employee cell:

```tsx
cell: ({ row }) => {
	const displayName = formatEmployeeIdentityName(row.original);

	return (
		<div className="flex items-center gap-3">
			<UserAvatar
				image={row.original.user.image}
				seed={row.original.user.id}
				name={displayName}
				size="sm"
			/>
			<div>
				<div className="font-medium">{displayName}</div>
				<div className="text-sm text-muted-foreground">{row.original.user.email}</div>
			</div>
		</div>
	);
},
```

- [ ] **Step 3: Render employee selector names with pronouns**

Modify `apps/webapp/src/components/employee-select/employee-select-item.tsx` imports:

```tsx
import { formatEmployeeIdentityName, getEmployeeBaseDisplayName } from "@/lib/employee-identity";
```

Replace local `getEmployeeName` implementation with:

```tsx
function getEmployeeName(employee: EmployeeSelectItemProps["employee"]): string {
	return getEmployeeBaseDisplayName(employee);
}
```

In `EmployeeSelectItem`, add:

```tsx
const displayName = formatEmployeeIdentityName(employee);
```

Use `displayName` for the visible name and keep `name` for avatar fallback if desired:

```tsx
<UserAvatar seed={employee.userId} image={employee.user.image} name={displayName} size="sm" />
<span className="font-medium truncate">{displayName}</span>
```

- [ ] **Step 4: Run type-focused test command**

Run from repo root:

```bash
pnpm --dir apps/webapp test src/lib/employee-identity.test.ts
```

Expected: PASS. This task mainly updates TypeScript query/UI wiring; full type validation happens in the final verification task.

- [ ] **Step 5: Commit directory and selector display work**

```bash
git add apps/webapp/src/app/\[locale\]/\(app\)/settings/employees/employee-action-types.ts apps/webapp/src/app/\[locale\]/\(app\)/settings/employees/employee-queries.actions.ts apps/webapp/src/app/\[locale\]/\(app\)/settings/employees/columns.tsx apps/webapp/src/components/employee-select/types.ts apps/webapp/src/components/employee-select/employee-select-item.tsx
git commit -m "feat: show pronouns in employee identity UI"
```

---

### Task 5: Organization Chart Pronouns Display

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/actions.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx`

- [ ] **Step 1: Add pronouns to org chart types**

Modify `apps/webapp/src/app/[locale]/(app)/organization/org-chart-types.ts`:

```ts
export type OrgChartEmployeeNode = {
	id: string;
	kind: "employee";
	employeeId: string;
	userId: string;
	name: string;
	pronouns: string | null;
	email: string;
```

Add pronouns to search result:

```ts
export type OrgChartSearchResult = {
	employeeId: string;
	name: string;
	pronouns: string | null;
	email: string;
```

- [ ] **Step 2: Carry pronouns through org chart graph builder**

Modify `apps/webapp/src/app/[locale]/(app)/organization/org-chart-graph.ts` `OrgChartEmployeeInput`:

```ts
name: string;
pronouns: string | null;
email: string;
```

Add pronouns to node construction:

```ts
name: employee.name,
pronouns: employee.pronouns,
email: employee.email,
```

- [ ] **Step 3: Select pronouns in organization actions**

Modify `apps/webapp/src/app/[locale]/(app)/organization/actions.ts` `EmployeeGraphRow`:

```ts
name: string;
pronouns: string | null;
email: string;
```

Add `pronouns: employee.pronouns` to `searchOrgEmployees`, `loadActiveEmployees`, and `loadActiveEmployeesByIds` select projections:

```ts
pronouns: employee.pronouns,
```

- [ ] **Step 4: Render org chart node names with pronouns**

Modify `apps/webapp/src/app/[locale]/(app)/organization/org-chart-client.tsx` import:

```tsx
import { normalizePronouns } from "@/lib/employee-identity";
```

Inside `EmployeeFlowNode`, add:

```tsx
const pronouns = normalizePronouns(node.pronouns);
const displayName = pronouns ? `${node.name} (${pronouns})` : node.name;
```

Use `displayName` in the visible name and expand aria-label:

```tsx
<p className="truncate text-sm font-semibold">{displayName}</p>
```

```tsx
aria-label={`Expand ${displayName} neighborhood`}
```

- [ ] **Step 5: Run org chart related tests if present**

Run from repo root:

```bash
pnpm --dir apps/webapp test src/app/\[locale\]/\(app\)/organization
```

Expected: PASS if tests exist. If Vitest reports no test files for this path, record that result and continue to final verification.

- [ ] **Step 6: Commit org chart display work**

```bash
git add apps/webapp/src/app/\[locale\]/\(app\)/organization/org-chart-types.ts apps/webapp/src/app/\[locale\]/\(app\)/organization/org-chart-graph.ts apps/webapp/src/app/\[locale\]/\(app\)/organization/actions.ts apps/webapp/src/app/\[locale\]/\(app\)/organization/org-chart-client.tsx
git commit -m "feat: show pronouns in org chart identities"
```

---

### Task 6: Final Verification And Scope Check

**Files:**
- Read/verify: all files modified in Tasks 1-5

- [ ] **Step 1: Run focused test suite**

Run from repo root:

```bash
pnpm --dir apps/webapp test src/lib/employee-identity.test.ts src/components/settings/profile-form.test.tsx src/app/\[locale\]/\(app\)/settings/profile/actions.test.ts src/app/\[locale\]/\(app\)/settings/employees/\[employeeId\]/page-sections.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full app test suite**

Run from repo root:

```bash
pnpm --dir apps/webapp test
```

Expected: PASS. If unrelated pre-existing tests fail, capture the failing test names and confirm the focused pronouns tests still pass.

- [ ] **Step 3: Run production build only if environment allows**

Run from repo root:

```bash
pnpm --dir apps/webapp build
```

Expected: PASS. If the build fails because required system environment variables are unavailable to agents, do not create environment variables; record the skipped/failing env-gated build in the final response.

- [ ] **Step 4: Review export scope**

Check the diff to confirm payroll/report export files were not modified:

```bash
git diff --name-only HEAD~5..HEAD
```

Expected: changed files do not include `apps/webapp/src/lib/payroll-export`, `apps/webapp/src/lib/reports/exporters`, or export schema files.

- [ ] **Step 5: Confirm no extra export files changed**

Run from repo root:

```bash
git status --short
```

Expected: the working tree contains no unexpected changes under payroll or report export paths. If verification revealed a defect, fix it in the task that introduced the defect and amend that task's implementation before considering the plan complete.

---

## Self-Review

- Spec coverage: Task 1 covers storage, nullable text, normalization, max length validation, and the shared identity helper. Task 2 covers employee self-editing through profile settings. Task 3 covers manager/admin editing through employee details and existing permission tiers. Tasks 4 and 5 cover app UI identity display without changing payroll or report exports. Task 6 covers focused and broad verification.
- Placeholder scan: The plan contains no unresolved markers, no open implementation gaps, and each task includes concrete file paths, code snippets, commands, and expected results.
- Type consistency: The property name is consistently `pronouns`, the stored value is `string | null`, the UI form value is a string with empty string representing unset, and display goes through `formatEmployeeIdentityName` or `normalizePronouns`.
